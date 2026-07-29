# thequantitative.com

A cabinet of instruments. You touch one with your thumb and numbers come out.

A phone-first, installable, fully-offline PWA. Some instruments point outward at
physical reality — a spirit level, a sound meter, a tuner. Some point inward at
mathematical reality — a Galton board, Monte Carlo π, Bayes. Same grammar, same
shelf.

**Live:** <https://thequantitative.com>

v0 ships the shell and one instrument: a two-axis **Spirit Level**.

## Why it's built this way

**No build step.** Vanilla ES modules, zero runtime dependencies, no bundler.
Type safety comes from `// @ts-check` plus JSDoc plus `tsc --noEmit`, so the
files ship byte-for-byte as written. The deciding argument wasn't ideology — it
was debugging. Sensor code can only be debugged on the device, and the file you
inspect on the phone is the file you wrote.

**Instruments can't leak.** They never receive raw browser APIs. The shell hands
each one a managed resource kit (`js/ctx.js`) built over a disposal scope
(`js/scope.js`): `ctx.raf`, `ctx.on`, `ctx.motion`, `ctx.store`, `ctx.wakeLock`.
Everything registered is released exactly once on unmount, in reverse order,
even if a teardown throws. An orphaned animation loop draining someone's battery
after they navigate away is the most likely bug in a site like this, so it's made
structurally impossible rather than merely discouraged.

**The math never touches the DOM.** Numeric cores live in `dsp/` as pure modules
with no canvas and no browser, so they can be tested in node against known
values. On a site called The Quantitative, a confidently wrong number is the only
unforgivable bug.

**Offline is total.** The service worker precaches everything — 22 assets, 71 KB.
In airplane mode, with no signal, in a basement, every instrument still works,
because none of them ever needed the network.

## Layout

| Path | Role |
|---|---|
| `index.html` | Shell: head, masthead, `<main id="app">` |
| `css/site.css` | All CSS — tokens, layout, components. Dark only |
| `js/router.js` | Hash router (`#/`, `#/i/<id>`, `#/about`) |
| `js/registry.js` | Eager instrument metadata + lazy `import()` loaders |
| `js/scope.js` | Disposal scope — teardown registry, managed rAF and listeners |
| `js/ctx.js` | Managed resource kit handed to each instrument |
| `js/capability.js` | Feature detection → per-device capability state |
| `js/arm.js` | Shared permission screen. The only caller of `requestPermission` |
| `js/app.js` | Bootstrap, shelf rendering, route mount/unmount |
| `js/install.js` | `beforeinstallprompt` capture + iOS install coach |
| `js/update.js` | Service worker update pill |
| `dsp/tilt.js` | Pure tilt math — gravity vector → pitch/roll, smoothing, calibration |
| `instruments/level.js` | The Spirit Level |
| `sw.js` | Service worker (classic) |
| `tools/build_sw.py` | Content-hashed precache manifest generator |

## Two details worth knowing

**`accelerationIncludingGravity` is sign-inverted on iOS versus Android.** An
accelerometer at rest measures specific force — the normal force, straight up in
the world frame — so the reported vector is world-up expressed in device
coordinates. Android follows that; iOS reports its negation.
`normaliseGravity()` in `js/ctx.js` is the single place platform sign is handled;
everything downstream is platform-agnostic. It also collapses `-0` to `+0`,
because `Math.atan2` treats them as different quadrants and the two platforms
would otherwise disagree by 180° whenever an axis reads exactly zero.

**`tools/build_sw.py` rewrites a line inside `sw.js`, not just the manifest.**
Browsers detect a service worker update by byte-comparing that file. Regenerate
only the manifest and an unmodified `sw.js` never triggers an update — a shipped
fix sits behind a stale cache indefinitely, invisibly, because your own browser
is fine.

## Development

No build step. Serve statically:

```sh
python3 -m http.server 8000
```

Sensor APIs need a secure context, so motion won't work over plain HTTP from
another device — use HTTPS or test against the deployed site.

```sh
npm run check   # tsc --noEmit, then node --test
npm run types
npm test

cd tools && python3 -m unittest discover -p 'test_*.py'
```

Browser smoke harness (PASS/FAIL lands in the `<title>`):

```sh
python3 -m http.server 8000 &
chromium --headless --dump-dom http://localhost:8000/tests/smoke.html \
  | grep -o '<title>[^<]*</title>'
```

`typescript` and `@types/node` are the only dependencies. Both are types-only and
ship nothing.

## Deploy

```sh
./deploy.sh
```

Gates in order — types → node tests → python tests → precache manifest → rsync.
`set -e` aborts before rsync if any gate fails.

## Adding an instrument

Write one file under `instruments/` default-exporting
`{id, name, category, blurb, needs, mount(root, ctx)}` where `mount` returns its
own teardown. Add one line to `js/registry.js`. It cannot break any existing
instrument, and it cannot leak.

## Licence

Code: MIT. IBM Plex Mono is licensed under the SIL Open Font License 1.1 — see
`fonts/README.md`.
