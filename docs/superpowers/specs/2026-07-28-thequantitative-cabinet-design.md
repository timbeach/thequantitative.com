# thequantitative.com — A Cabinet of Instruments

**Date:** 2026-07-28
**Status:** Design approved, ready for implementation planning

---

## 1. Thesis

> **Every item on the site is an instrument. You touch it with your thumb and numbers come out.**

Some instruments point *outward* at physical reality — a spirit level, a sound-level
meter, a tuner, a seismograph. Some point *inward* at mathematical reality — a Galton
board, Monte Carlo π, Bayes, the law of large numbers. Same gesture, same visual
grammar, same shelf.

thequantitative.com is a phone-first, installable, fully-offline PWA that houses them.

## 2. Why this, and why here

Three sites, three jobs. The niche was defined by what the other two already own:

| Site | Job |
|---|---|
| **timbeach.com** | Prose. Articles, read-aloud audio, RSS, search. Thinking in words. |
| **zenshinsuru.com** | Commerce. The $500 website business, with `demos/` as the sales floor. |
| **thequantitative.com** | **Number.** This document. |

The site serves three purposes, in this order:

1. **A tool** — instruments worth putting on a home screen and opening without thinking.
2. **A playground** — an open-ended shelf where each new instrument is one weekend and
   touches nothing that already exists.
3. **A portfolio artifact** — the four-second answer to "can this person actually
   build?", which is a question zenshinsuru.com's customers implicitly ask.

The PWA form isn't decoration. A phone carries an accelerometer, gyroscope,
magnetometer, microphone and camera; a laptop carries none of them usefully. Half this
site *cannot exist* anywhere but a phone, which is what makes it worth building as one.

## 3. Non-goals

- **Not a publication.** No articles, no feed, no CMS, no content pipeline. That is
  timbeach.com's job and duplicating it would weaken both.
- **Not a quantified-self tracker.** No accounts, no sync, no server-side state.
- **No light mode.** It is a device. Devices don't have a light mode.
- **No backend.** No API, no database, no analytics beacon. The site never needs the
  network after first load.
- **No build step**, no npm at build or runtime. See §5.

## 4. Personality — laboratory instrument

Dark, precise, unshowy. A Fluke meter designed by Dieter Rams. Restraint reads as
accuracy; ornament reads as a toy, and a toy's numbers aren't believable.

### 4.1 Colour

| Token | Value | Use |
|---|---|---|
| `--void` | `#000000` | Instrument route background. True black — OLED pixels off: measurable battery saving, and the device bezel visually disappears. |
| `--surface` | `#0d0f12` | Shelf cards, sheets, arm screens |
| `--hairline` | `#1e2227` | Rules, tick marks, card borders |
| `--ink` | `#e8eaed` | Primary readouts |
| `--ink-label` | `#8b9299` | Labels, units, secondary values |
| `--ink-dim` | `#4d545c` | Disabled / unavailable |
| `--signal` | *single accent — selected on-device during v0, see below* | Live values, needles, active state |
| `--alert` | `#ff4d4f` | Out-of-range only. Never decorative. |

Exactly one accent colour site-wide. `--alert` is semantic, not part of the palette.

**Accent selection is a build-time step, not a design-time guess:** render the Spirit
Level in three candidates (amber `#ffb000`, signal green `#00e08a`, cyan `#38bdf8`) and
choose on a real phone in real light. Amber is the leading candidate — it echoes HP and
Tektronix phosphor, reads warm against black as *device* rather than *web app*, and is
uncommon enough to be identity-forming.

### 4.2 Type

**IBM Plex Mono**, self-hosted, subset to Latin + digits + required punctuation, woff2,
target < 25 KB, precached. One family for everything: readouts, labels, and the about
page. One download, total coherence, byte-identical rendering on both platforms.

Two non-negotiables:

- **Tabular figures.** Fixed-width digits and fixed decimal places. The signature
  amateur tell in a live readout is digits shifting horizontally as they update. Dead-still
  numerals are the single largest contributor to "instrument" over "web page showing a number."
- **Slashed zero.** Unambiguous at a glance, and it is what measurement equipment does.

Labels are uppercase, `letter-spacing: 0.08em`, small, in `--ink-label`.

### 4.3 Layout

- `100dvh`, never `100vh` — mobile browser chrome collapses on scroll and `vh` doesn't know.
- `env(safe-area-inset-*)` on all four edges. Nothing hides under a notch or home indicator.
- Canvas backed at `devicePixelRatio`, so hairlines are hairlines and not blurred 2px smudges.
- Instrument route is full-bleed; chrome reduces to a back chevron and the instrument name.

### 4.4 Motion — ballistics, not values

Real meters are damped. Every needle, bar and readout exponentially smooths toward its
true value rather than rendering it raw. Where a standard specifies a time constant, the
standard's value is used (sound level: *fast* = 125 ms, *slow* = 1 s).

This is the difference between a readout that feels like an instrument and one that
looks like a number twitching.

`prefers-reduced-motion` reduces or removes animation. It never reduces accuracy.

## 5. Architecture

### 5.1 Stack: no-build ES modules with JSDoc types

Vanilla ES modules, zero dependencies, no bundler, no npm. Type safety comes from
`// @ts-check` plus JSDoc annotations, a `jsconfig.json` with `checkJs: true`, and
`tsc --noEmit` as a pre-deploy gate — full editor intellisense and real type errors on
`.js` files that ship byte-for-byte as written.

**Rationale.** A Vite/Preact build offers exactly two real wins here — TypeScript and
Workbox's content-hashed precache manifest — and both are obtainable above for roughly a
hundred lines of tooling. Against that it costs a dependency treadmill on a site whose
value proposition is *still working in 2032*, and, decisively, it costs phone-debugging
clarity: sensor code can only be debugged on-device, the development machine runs Artix
(so iOS Safari remote inspection is already the hardest problem here), and bundling would
make the only available view of that code indirect. No-build means the file inspected on
the phone is the file that was written.

**Tripwire for revisiting this:** a genuine application-state layer — accounts, sync, a
large shared data model, many interlocking views. A cabinet of independent instruments
does not trip it. Any future dependency is vendored into `vendor/` as an ES module.

### 5.2 Routes

Hash router, matching the pattern already proven on timbeach.com:

```
#/          the shelf       grid of instrument cards, split World / Ideas
#/i/<id>    one instrument  full-bleed
#/about     colophon        what it is, how it works, install coach
```

The shell ships the shelf and nothing else. Instrument **metadata** is eager (needed to
draw cards); instrument **code** arrives via dynamic `import()` only on tap. Cold-cache
shelf load on 4G is the primary performance budget, because it is the competence proof.

### 5.3 The instrument contract

One file per instrument, self-contained, quarantined.

```js
// instruments/db-meter.js
// @ts-check
/** @type {import('../js/types.js').Instrument} */
export default {
  id:       'db-meter',
  name:     'Sound Level',
  category: 'world',              // 'world' | 'ideas'
  blurb:    'A-weighted sound pressure, live.',
  needs:    ['microphone'],       // capability keys

  /**
   * @param {HTMLElement} root
   * @param {import('../js/types.js').Ctx} ctx
   * @returns {() => void} teardown
   */
  mount(root, ctx) { /* ... */ return () => { /* ... */ } }
}
```

`mount` returns its own teardown closure — no `this`, no lifecycle class, directly testable.

### 5.4 The managed resource kit (`ctx`)

The most likely bug on a site like this is not a wrong number. It is a forgotten
`requestAnimationFrame` loop or a live `AudioContext` quietly draining a battery after
the user navigated away. Discipline will not prevent that at instrument #14.

So the shell never hands instruments raw browser APIs:

| API | Guarantee |
|---|---|
| `ctx.raf(fn)` | Cancelled on unmount, and paused on `visibilitychange` |
| `ctx.on(target, type, fn)` | Listener removed on unmount |
| `ctx.audio()` | Shared `AudioContext`, suspended on unmount |
| `ctx.mic()` | Resolves only post-grant; tracks stopped on unmount |
| `ctx.motion()` | Resolves only post-grant; listeners removed on unmount |
| `ctx.signal` | `AbortSignal`, fired on unmount |
| `ctx.store(ns)` | Namespaced persistence (localStorage; IndexedDB if ever needed) |
| `ctx.wakeLock()` | Held while mounted, released on unmount, no-op where unsupported |

Leaking becomes structurally hard rather than a thing to remember.

### 5.5 Permissions

Permission handling lives entirely in a shared **arm screen**. An instrument declaring
`needs: ['motion']` gets the tap-to-grant flow for free, and `mount` is never called
until the grant lands. **No instrument file contains a line of permission boilerplate.**

Permission state is a discriminated union — `idle | prompting | granted | denied |
unavailable` — and every state has a designed screen, including `denied` (which explains
how to undo it per platform).

On the shelf, cards whose capabilities are unavailable on the current device render
dimmed with the real reason — *"needs a magnetometer · unavailable in iOS Safari"* —
rather than allowing a tap into something broken. Honest beats polished.

### 5.6 Registry

`instruments/registry.js` holds eager metadata plus a lazy loader per instrument:

```js
{ id, name, category, blurb, needs, load: () => import('./db-meter.js') }
```

Adding instrument #15 is: write one file, add one line here. It cannot break #1–#14.

## 6. Platform capability matrix

Verified against documentation; **re-verified on real hardware during v0.**

| Capability | Android Chrome | iOS Safari |
|---|---|---|
| `devicemotion` / `deviceorientation` | Yes | Yes, gated behind `DeviceMotionEvent.requestPermission()` from a user gesture |
| Compass heading | Yes (`absolute` orientation) | Yes (`webkitCompassHeading`) |
| Microphone (`getUserMedia`) | Yes | Yes |
| Camera torch (`torch` constraint) | Yes | **No** |
| Generic Sensor API classes (`Magnetometer`, `AmbientLightSensor`) | Yes (Chromium-only) | **No** |
| Vibration API | Yes | **No** |
| Screen Wake Lock | Yes | Yes (Safari 16.4+) |
| Install prompt | `beforeinstallprompt` | **No event** — manual Share → Add to Home Screen |
| Barometer | **No web API** | **No web API** |

All sensor APIs require a secure context.

## 7. PWA layer

**Offline is total.** Shell, registry, every instrument, and the font all precache. Total
payload target < 200 KB. In airplane mode, with no signal, in a basement, every
instrument still works — because none of them ever needed the network.

**Service worker.** `sw.js` is hand-written and readable; `tools/build_sw.py` generates
`sw-manifest.js`, a content-hashed list of every precached asset, at deploy time. This
is the same generated-artifact pattern already used by timbeach.com's `build_feed.py` and
`build_search_index.py`. Hashing is what makes a shipped fix actually reach users instead
of sitting behind a stale cache.

**Updates never surprise.** A new worker installs in the background, then a small pill
appears: *"New version · tap to reload."* Never a silent reload — a silent reload
mid-measurement is a betrayal.

**Install.**
- Android: capture and park `beforeinstallprompt`, surface a discreet install chip on the shelf.
- iOS: no such event, so detect iOS Safari + `!navigator.standalone` and show a dismissible
  sheet illustrating the Share → *Add to Home Screen* gesture. Dismissed once, remembered forever.

**Manifest.** `display: standalone`, `theme_color` and `background_color` both `#000000`
(no white launch flash), maskable icons at 192 and 512, plus `apple-touch-icon`.

## 8. The instruments

Eight at launch-plus, in four plumbing families. The second instrument in each family
costs a fraction of the first.

### World — mic

**Sound Level** (`db-meter`, needs `microphone`)
A-weighted sound pressure. `getFloatFrequencyData` from an `AnalyserNode`, A-weighting
applied per bin by bin centre frequency, energy summed, converted to dB. Live bar plus
min / mean / max, and selectable *fast* (125 ms) / *slow* (1 s) ballistics.

> **Honesty requirement.** A browser cannot know a microphone's absolute sensitivity, so
> this is **not** a calibrated SPL meter. The readout carries a user-settable calibration
> offset (stored per device in `ctx.store`) defaulting to a nominal phone value, and the
> UI states plainly that values are relative unless calibrated against a known source.
> On a site called The Quantitative, a confidently wrong number is the only unforgivable bug.

**Tuner + Spectrogram** (`tuner`, needs `microphone`)
Chromatic tuner using the McLeod pitch method (normalised square difference) over
`getFloatTimeDomainData` — substantially more robust than FFT peak-picking for musical
pitch, which mis-locks onto harmonics. Nearest note plus cents deviation on a damped
needle, over a live scrolling spectrogram. Configurable A4 reference (default 440 Hz).

### World — motion

**Spirit Level** (`level`, needs `motion`)
Two-axis inclinometer. Pitch and roll derived from a low-pass-filtered gravity vector
(`accelerationIncludingGravity`) rather than raw `deviceorientation` angles, which are
less stable near gimbal extremes. Bubble plus live degrees to one decimal.
Tap-to-zero calibration persists per device in `ctx.store`.

**Seismograph** (`seismo`, needs `motion`)
Rolling strip chart of linear acceleration magnitude (gravity high-pass removed).
Auto-ranging Y axis with peak markers and a running peak-hold. Catches footsteps, a door
closing, the phone being set down.

### Ideas — simulation

**Galton Board** (`galton`, no permissions)
Balls fall through a peg lattice and pile into a histogram while the theoretical normal
curve draws over it. Each ball is an exact binomial walk (per-peg `p`, default 0.5) with
eased animation and slight visual jitter — exact distribution, lively motion. `p` is
adjustable to show skew. The central limit theorem as a physical object.

**Law of Large Numbers** (`lln`, no permissions)
Thousands of coin flips; running proportion converges to 0.5 inside a drawn `±1/√n`
envelope, while a longest-streak readout keeps recording runs of 8+ heads. The point:
convergence and clustering are not in conflict.

### Ideas — diagram

**Monte Carlo π** (`monte-carlo-pi`, no permissions)
Uniform points in the unit square; those inside the quarter circle give π ≈ 4·inside/total.
Live estimate plus an absolute-error plot on log-log axes, where the `1/√n` envelope
becomes visible as a straight line. Point budget throttled per frame to hold 60 fps.

**Bayes** (`bayes`, no permissions)
Three sliders — base rate, sensitivity, specificity — driving a partitioned unit-square
area diagram and a live posterior. Results are shown *both* as a probability and as
natural frequencies ("of 10,000 people, 99 test positive and 8 are ill"), because the
natural-frequency framing is the one that actually changes minds.

## 9. Build order

| Stage | Contents | Rationale |
|---|---|---|
| **v0** | Shell, router, arm screen, `ctx` kit, service worker, manifest, install coach, deploy pipeline — plus **Spirit Level** only | Proves the contract against the hardest path: a real sensor, the iOS `requestPermission()` gesture requirement, and persisted calibration. If the contract is wrong, this is where it shows. |
| **v1 — go live** | **+ Galton Board + Sound Level** | Both categories, both permission states, one instrument from each of two plumbing families. Three cards read as a shelf. The 2024 placeholder is retired here. |
| **ongoing** | **Tuner → Seismograph → Monte Carlo π → LLN → Bayes** | Each reuses plumbing already paid for; each ships independently to a live site. |

There is no big-bang launch. Independent instruments mean the site grows in public, which
is the point of the playground.

## 10. Testing

**The math never touches the DOM.** Numeric cores live in pure modules with no canvas and
no browser — `dsp/a-weighting.js`, `dsp/pitch.js`, `stats/galton.js`,
`stats/monte-carlo.js`, `stats/lln.js`, `stats/bayes.js`. Anything stochastic takes an
injectable RNG so tests are deterministic.

That makes real verification possible, which matters because on this site the numbers
*are* the product:

- **A-weighting** against published values: `0 dB` at 1 kHz, `≈ −19.1 dB` at 100 Hz,
  `≈ −2.5 dB` at 10 kHz, within tolerance.
- **Pitch detection** against synthesised sine waves at known frequencies, asserted to
  within one cent, including harmonic-rich waveforms to prove it doesn't octave-slip.
- **Bayes** against hand-computed cases, including the degenerate ones (base rate 0 and 1).
- **Galton / LLN / Monte Carlo** against closed-form expectations with a seeded RNG.

Test runner is `node --test` — built in, zero dependencies, same ethos as the rest.

Around that:
- `tsc --noEmit` as the type gate.
- A browser smoke test for shell, router and registry, reusing the existing
  `timbeach.com/tests/searchtest.html` pattern: headless Chrome, dump-dom, PASS/FAIL in `<title>`.
- **Device matrix, run manually each release:** one real iPhone (Safari) and one real
  Android (Chrome), tested against the staging vhost — not localhost.

### Development over HTTPS

`devicemotion`, microphone and camera all require a secure context, and a phone on the LAN
is not `localhost`, so `python3 -m http.server` is insufficient for sensor work.

**Chosen approach: a `staging.thequantitative.com` vhost on the existing VPS**, deployed to
with the same script. It exercises the real service worker, real install flow and real
certificate — none of which local development can faithfully simulate. `caddy` or `mkcert`
remain available as local fallbacks for quick iteration on non-sensor work.

## 11. Deploy

`deploy.sh`, mirroring timbeach.com's shape:

```
tsc --noEmit  →  node --test  →  tools/build_sw.py  →  rsync
```

Any failing gate aborts before rsync.

## 12. File layout

```
thequantitative.com/
├── index.html                  shell: head, masthead, <main id="app">
├── manifest.webmanifest
├── sw.js                       hand-written, imports generated manifest
├── sw-manifest.js              GENERATED, gitignored, rsynced
├── jsconfig.json               checkJs: true
├── deploy.sh
├── css/site.css                tokens, layout, components
├── js/
│   ├── app.js                  bootstrap, shelf rendering, route registration
│   ├── router.js               hash router
│   ├── registry.js             instrument metadata + lazy loaders
│   ├── ctx.js                  managed resource kit
│   ├── arm.js                  shared permission / arm screen
│   ├── capability.js           feature detection → card availability
│   ├── install.js              beforeinstallprompt + iOS install coach
│   ├── update.js               service worker update pill
│   ├── types.js                JSDoc typedefs (Instrument, Ctx, Capability, …)
│   └── util.js                 DOM-free helpers, node-importable
├── instruments/                one file each; see §8
├── dsp/                        pure: a-weighting.js, pitch.js
├── stats/                      pure: galton.js, monte-carlo.js, lln.js, bayes.js
├── fonts/                      IBM Plex Mono subset, woff2
├── icons/                      192, 512, maskable, apple-touch-icon
├── tests/                      node --test suites + browser smoke harness
├── tools/build_sw.py           hashed precache manifest generator
├── archive/                    asteroids.html, pong.html (2023, retired)
└── docs/superpowers/specs/
```

`asteroids.html` and `pong.html` move to `archive/` rather than being deleted. Pong could
plausibly return later as a reaction-time instrument. Asteroids is just Asteroids.

## 13. Decisions deferred to implementation

1. **Accent colour** — chosen on real hardware during v0 from three candidates (§4.1).
2. **Instrument order on the shelf** — fixed editorial order for now; usage-based ordering
   is a possible later refinement and requires no schema change.

Everything else in this document is decided.
