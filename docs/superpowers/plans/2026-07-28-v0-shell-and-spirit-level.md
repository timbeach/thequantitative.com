# thequantitative.com v0 — Shell + Spirit Level Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a phone-first, installable, fully-offline PWA at `https://thequantitative.com/` containing a working shelf and exactly one instrument — the Spirit Level — proving the instrument contract against the hardest path (real motion sensor, iOS permission gesture, persisted calibration).

**Architecture:** A single `index.html` shell loads vanilla ES modules. A hash router swaps routes into `<main id="app">`. Instrument metadata is eager (draws the shelf); instrument code arrives via dynamic `import()` on tap. Each instrument is one file default-exporting `{id, name, category, blurb, needs, mount(root, ctx)}` where `mount` returns its own teardown closure. Instruments never touch raw browser APIs — the shell hands them a managed resource kit (`ctx`) built on a disposal scope, so orphaned rAF loops and live listeners are structurally impossible. All numeric logic lives in pure, DOM-free modules under `dsp/` so it can be tested in node against known values.

**Tech Stack:** Vanilla ES modules, no bundler, no runtime dependencies. JSDoc + `// @ts-check` + `tsc --noEmit` for type safety. `node --test` for unit tests. Python 3 for the deploy-time service-worker manifest generator. nginx + rsync for deploy.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from `docs/superpowers/specs/2026-07-28-thequantitative-cabinet-design.md`.

- **No build step for shipped code.** No bundler. No npm package may be imported by anything that ships. The single permitted `devDependency` is `typescript`, used only as a type checker (`tsc --noEmit`); it emits nothing.
- **The file you inspect on the phone is the file you wrote.** No transpilation, no minification, no sourcemaps.
- **`// @ts-check` at the top of every `.js` file**, with JSDoc annotations. `npx tsc -p jsconfig.json --noEmit` must exit 0.
- **The math never touches the DOM.** Numeric cores live in `dsp/` and `stats/` with no canvas, no `window`, no `document`. Anything stochastic takes an injectable RNG.
- **Dark only.** No light mode, no theme toggle, no `prefers-color-scheme` branch.
- **Colour tokens (exact):** `--void: #000000`, `--surface: #0d0f12`, `--hairline: #1e2227`, `--ink: #e8eaed`, `--ink-label: #8b9299`, `--ink-dim: #4d545c`, `--alert: #ff4d4f`. `--signal` is the single accent, selected on-device in Task 14 from: amber `#ffb000`, green `#00e08a`, cyan `#38bdf8`.
- **Type:** IBM Plex Mono only, self-hosted woff2 subset, target < 25 KB. **Tabular figures and slashed zero are mandatory** on every numeric readout. Labels are uppercase, `letter-spacing: 0.08em`, colour `--ink-label`.
- **Layout:** `100dvh` never `100vh`. `env(safe-area-inset-*)` on all four edges. Canvas backed at `devicePixelRatio`.
- **Motion:** every readout exponentially smooths toward its true value. `prefers-reduced-motion` reduces animation, never accuracy.
- **Total precache payload target: < 200 KB.** The site must fully function in airplane mode.
- **No backend, no analytics, no network calls after first load.**
- **Commit messages must not contain `Co-Authored-By:`, AI attribution, or "Generated with" footers** — a repo hook (`block-ai-attribution.sh`) rejects them.
- **Deploy target:** `vultr:/var/www/thequantitative.com` (vhost already exists, HTTPS live on the `aegixlinux.com-0002` cert).

---

## File Structure

| Path | Responsibility |
|---|---|
| `index.html` | Shell only: head, masthead, `<main id="app">`, module entry |
| `css/site.css` | All CSS — tokens, base, shelf, instrument chrome, arm screen |
| `js/types.js` | JSDoc typedefs. No runtime code. Single source of truth for shapes |
| `js/scope.js` | Disposal scope — teardown registry, managed rAF and listeners. Pure, node-testable |
| `js/capability.js` | Feature detection → capability states. Pure, takes injected env |
| `js/router.js` | `parseRoute()` (pure) + `createRouter()` (thin window binding) |
| `js/ctx.js` | Managed resource kit — wires a scope to audio/mic/motion/store/wakeLock |
| `js/registry.js` | Instrument metadata + lazy `import()` loaders |
| `js/arm.js` | Shared permission/arm screen. All five permission states |
| `js/app.js` | Bootstrap, shelf rendering, route mounting/unmounting |
| `js/install.js` | `beforeinstallprompt` capture + iOS install coach sheet |
| `js/update.js` | Service worker update pill |
| `js/util.js` | DOM-free helpers, node-importable |
| `dsp/tilt.js` | Pure tilt math — gravity vector → pitch/roll, smoothing, calibration |
| `instruments/level.js` | The Spirit Level |
| `sw.js` | Service worker. Hand-written, readable |
| `sw-manifest.js` | **Generated** by `tools/build_sw.py`. Gitignored, rsynced |
| `manifest.webmanifest` | PWA manifest |
| `tools/build_sw.py` | Content-hashed precache manifest generator |
| `tools/test_build_sw.py` | Test for the above |
| `tests/*.test.js` | `node --test` suites |
| `tests/smoke.html` | Headless-Chrome browser harness, PASS/FAIL in `<title>` |
| `deploy.sh` | types → tests → build_sw → rsync |
| `.deployignore` | rsync exclusions, single source of truth |

---

## Task 1: Scaffolding, type gate, and archival

**Files:**
- Create: `package.json`, `jsconfig.json`, `js/types.js`, `.deployignore`
- Move: `asteroids.html` → `archive/asteroids.html`, `pong.html` → `archive/pong.html`
- Delete: `index.html` (the 2024 placeholder; replaced in Task 7)

**Interfaces:**
- Consumes: nothing
- Produces: all JSDoc typedefs used by every later task — `Category`, `CapabilityKey`, `CapabilityState`, `ArmState`, `Vec3`, `Tilt`, `Teardown`, `Store`, `Ctx`, `Instrument`, `Route`

- [ ] **Step 1: Move the 2023 games to `archive/` and remove the placeholder**

```bash
mkdir -p archive
git mv asteroids.html archive/asteroids.html
git mv pong.html archive/pong.html
git rm index.html
```

- [ ] **Step 2: Create `package.json`**

`typescript` is the only dependency and it ships nothing — it is a type checker invoked as `tsc --noEmit`.

```json
{
  "name": "thequantitative",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "A cabinet of instruments. No build step — typescript is a type checker only and emits nothing.",
  "scripts": {
    "types": "tsc -p jsconfig.json --noEmit",
    "test": "node --test",
    "check": "npm run types && npm run test"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 3: Create `jsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "strict": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true
  },
  "include": ["js/**/*.js", "dsp/**/*.js", "instruments/**/*.js", "tests/**/*.js", "sw.js"],
  "exclude": ["node_modules", "archive"]
}
```

- [ ] **Step 4: Create `js/types.js`**

```js
// @ts-check
// Typedefs only. This module has no runtime code and is never imported for value.

/** @typedef {'world'|'ideas'} Category */
/** @typedef {'motion'|'microphone'|'wakelock'} CapabilityKey */
/** @typedef {'available'|'needs-permission'|'unavailable'} CapabilityState */
/** @typedef {'idle'|'prompting'|'granted'|'denied'|'unavailable'} ArmState */
/** @typedef {() => void} Teardown */
/** @typedef {{ x:number, y:number, z:number }} Vec3 */
/** @typedef {{ pitch:number, roll:number }} Tilt */

/**
 * @typedef {{ name:'shelf' }
 *         | { name:'instrument', id:string }
 *         | { name:'about' }
 *         | { name:'not-found', hash:string }} Route
 */

/**
 * @typedef {Object} Store
 * @property {(key:string) => unknown} get
 * @property {(key:string, value:unknown) => void} set
 */

/**
 * @typedef {Object} Ctx
 * @property {(fn:(t:number) => void) => void} raf            Self-rescheduling loop, cancelled on unmount
 * @property {(target:EventTarget, type:string, fn:EventListener, opts?:AddEventListenerOptions) => void} on
 * @property {(fn:(g:Vec3, dt:number) => void) => void} motion Gravity vector in device frame, sign-normalised
 * @property {AbortSignal} signal
 * @property {Store} store
 * @property {() => void} wakeLock                            Best-effort; no-op where unsupported
 */

/**
 * @typedef {Object} Instrument
 * @property {string} id
 * @property {string} name
 * @property {Category} category
 * @property {string} blurb
 * @property {CapabilityKey[]} needs
 * @property {(root:HTMLElement, ctx:Ctx) => Teardown} mount
 */

/**
 * @typedef {Object} RegistryEntry
 * @property {string} id
 * @property {string} name
 * @property {Category} category
 * @property {string} blurb
 * @property {CapabilityKey[]} needs
 * @property {() => Promise<{ default: Instrument }>} load
 */

export {}
```

- [ ] **Step 5: Create `.deployignore`**

```
.git/
.gitignore
.claude/
.superpowers/
node_modules/
package.json
package-lock.json
jsconfig.json
deploy.sh
.deployignore
docs/
tests/
tools/
archive/
STATUS-*.md
CLAUDE.md
README.md
```

- [ ] **Step 6: Install and run the type gate**

Run: `npm install && npm run types`
Expected: PASS — exit 0, no output. If `tsc` reports errors in `js/types.js`, the typedef syntax is wrong; fix before proceeding.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold v0 — type gate, typedefs, archive 2023 games"
```

---

## Task 2: Pure tilt math (`dsp/tilt.js`)

The Spirit Level's entire numeric core, testable in node against hand-computed vectors.

**Convention, fixed here and depended on by Task 10:** phone flat with screen up is `{pitch: 0, roll: 0}`. Pitch is positive when the **top edge is raised**. Roll is positive when the **right edge is raised**.

**Files:**
- Create: `dsp/tilt.js`, `tests/tilt.test.js`

**Interfaces:**
- Consumes: `Vec3`, `Tilt` from `js/types.js`
- Produces:
  - `gravityToTilt(g: Vec3) => Tilt` — degrees
  - `alphaFor(dt: number, tau: number) => number` — first-order low-pass coefficient
  - `lowPassVec(prev: Vec3, next: Vec3, alpha: number) => Vec3`
  - `applyCalibration(t: Tilt, offset: Tilt) => Tilt`

- [ ] **Step 1: Write the failing test**

Create `tests/tilt.test.js`:

```js
// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gravityToTilt, alphaFor, lowPassVec, applyCalibration } from '../dsp/tilt.js'

/** @param {number} a @param {number} b @param {number} [eps] */
const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} to be within ${eps} of ${b}`)

const SQRT_HALF = Math.SQRT1_2 // 0.7071...

test('flat, screen up → level', () => {
  const t = gravityToTilt({ x: 0, y: 0, z: 1 })
  near(t.pitch, 0)
  near(t.roll, 0)
})

// The vectors below are what a REAL accelerometer at rest reports. An
// accelerometer measures specific force, which at rest is the normal force —
// straight up in the world frame. So the reading is the world "up" unit vector
// expressed in DEVICE coordinates. Raising the top edge by θ tips the device's
// +y axis toward world-up, so g.y goes POSITIVE: g = (0, sin θ, cos θ).
// This matches the documented Android behaviour of z = +9.81 when flat.

test('top edge raised 90° → pitch +90, roll 0', () => {
  const t = gravityToTilt({ x: 0, y: 1, z: 0 })
  near(t.pitch, 90)
  near(t.roll, 0)
})

test('top edge lowered 90° → pitch -90', () => {
  near(gravityToTilt({ x: 0, y: -1, z: 0 }).pitch, -90)
})

test('right edge raised 90° → roll +90, pitch 0', () => {
  const t = gravityToTilt({ x: 1, y: 0, z: 0 })
  near(t.roll, 90)
  near(t.pitch, 0)
})

test('left edge raised 90° → roll -90', () => {
  near(gravityToTilt({ x: -1, y: 0, z: 0 }).roll, -90)
})

test('top edge raised 45°', () => {
  const t = gravityToTilt({ x: 0, y: SQRT_HALF, z: SQRT_HALF })
  near(t.pitch, 45)
  near(t.roll, 0)
})

test('magnitude is irrelevant — only direction matters', () => {
  const a = gravityToTilt({ x: 0, y: SQRT_HALF, z: SQRT_HALF })
  const b = gravityToTilt({ x: 0, y: 9.81 * SQRT_HALF, z: 9.81 * SQRT_HALF })
  near(a.pitch, b.pitch)
  near(a.roll, b.roll)
})

test('alphaFor: one time constant of elapsed time → 1 - 1/e', () => {
  near(alphaFor(0.1, 0.1), 1 - Math.exp(-1), 1e-12)
})

test('alphaFor: tau of zero or less means no smoothing', () => {
  near(alphaFor(0.016, 0), 1)
  near(alphaFor(0.016, -1), 1)
})

test('alphaFor: never exceeds 1 even for a huge dt', () => {
  const a = alphaFor(100, 0.1)
  assert.ok(a <= 1 && a > 0.999)
})

test('lowPassVec: alpha 1 jumps straight to the new value', () => {
  const v = lowPassVec({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 3 }, 1)
  assert.deepEqual(v, { x: 1, y: 2, z: 3 })
})

test('lowPassVec: alpha 0 holds the previous value', () => {
  const v = lowPassVec({ x: 5, y: 5, z: 5 }, { x: 1, y: 2, z: 3 }, 0)
  assert.deepEqual(v, { x: 5, y: 5, z: 5 })
})

test('lowPassVec: alpha 0.5 lands halfway', () => {
  const v = lowPassVec({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 4 }, 0.5)
  near(v.x, 0.5); near(v.y, 1); near(v.z, 2)
})

test('applyCalibration subtracts the stored offset', () => {
  const t = applyCalibration({ pitch: 10, roll: -4 }, { pitch: 1.5, roll: -0.5 })
  near(t.pitch, 8.5)
  near(t.roll, -3.5)
})

test('calibrating at rest yields exactly zero', () => {
  const raw = gravityToTilt({ x: 0.02, y: -0.03, z: 0.999 })
  const t = applyCalibration(raw, raw)
  near(t.pitch, 0)
  near(t.roll, 0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tilt.test.js`
Expected: FAIL — `Cannot find module '../dsp/tilt.js'`

- [ ] **Step 3: Write the implementation**

Create `dsp/tilt.js`:

```js
// @ts-check
/** @typedef {import('../js/types.js').Vec3} Vec3 */
/** @typedef {import('../js/types.js').Tilt} Tilt */

const RAD_TO_DEG = 180 / Math.PI

/**
 * Convert a gravity vector expressed in the device frame to pitch and roll.
 *
 * Device frame: +x points to the right edge of the screen, +y to the top edge,
 * +z out of the screen toward the user.
 *
 * An accelerometer at rest measures specific force — the normal force, straight
 * UP in the world frame — so `g` is the world up-vector expressed in device
 * coordinates. Flat and screen-up therefore reads {x:0, y:0, z:+1} (matching
 * Android's documented z = +9.81), and raising the top edge by θ tips the
 * device's +y axis toward world-up, giving g = (0, sin θ, cos θ). Both
 * components are POSITIVE for a raised edge, which is why neither term below is
 * negated. See js/ctx.js, which normalises the iOS sign inversion into this
 * convention before calling here.
 *
 * Only the direction of `g` matters; magnitude is divided out by atan2.
 *
 * @param {Vec3} g gravity vector, any magnitude
 * @returns {Tilt} degrees. pitch > 0 = top edge raised. roll > 0 = right edge raised.
 */
export function gravityToTilt(g) {
  return {
    pitch: Math.atan2(g.y, Math.hypot(g.x, g.z)) * RAD_TO_DEG,
    roll: Math.atan2(g.x, g.z) * RAD_TO_DEG,
  }
}

/**
 * First-order low-pass coefficient. Frame-rate independent: derived from the
 * actual elapsed time rather than assuming a fixed interval, so the damping
 * feels identical whether the device delivers 60 Hz or 30 Hz.
 *
 * @param {number} dt seconds elapsed since the previous sample
 * @param {number} tau time constant in seconds — larger is slower and steadier
 * @returns {number} coefficient in (0, 1]
 */
export function alphaFor(dt, tau) {
  if (tau <= 0) return 1
  return 1 - Math.exp(-dt / tau)
}

/**
 * @param {Vec3} prev
 * @param {Vec3} next
 * @param {number} alpha
 * @returns {Vec3}
 */
export function lowPassVec(prev, next, alpha) {
  return {
    x: prev.x + alpha * (next.x - prev.x),
    y: prev.y + alpha * (next.y - prev.y),
    z: prev.z + alpha * (next.z - prev.z),
  }
}

/**
 * @param {Tilt} t
 * @param {Tilt} offset stored per-device zero, from ctx.store
 * @returns {Tilt}
 */
export function applyCalibration(t, offset) {
  return { pitch: t.pitch - offset.pitch, roll: t.roll - offset.roll }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/tilt.test.js`
Expected: PASS — 15 tests, 0 failures.

- [ ] **Step 5: Run the type gate**

Run: `npm run types`
Expected: PASS — exit 0.

- [ ] **Step 6: Commit**

```bash
git add dsp/tilt.js tests/tilt.test.js
git commit -m "feat: pure tilt math with frame-rate-independent smoothing"
```

---

## Task 3: Disposal scope (`js/scope.js`)

The mechanism that makes leaks structurally impossible. Everything an instrument registers is released exactly once, in reverse order, on unmount.

**Files:**
- Create: `js/scope.js`, `tests/scope.test.js`

**Interfaces:**
- Consumes: `Teardown` from `js/types.js`
- Produces: `createScope(host: {requestAnimationFrame, cancelAnimationFrame}) => Scope`, where `Scope` has `.signal`, `.disposed`, `.add(fn)`, `.raf(fn)`, `.on(target, type, fn, opts?)`, `.dispose()`

- [ ] **Step 1: Write the failing test**

Create `tests/scope.test.js`:

```js
// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createScope } from '../js/scope.js'

/** A controllable stand-in for the browser's animation clock. */
function fakeHost() {
  /** @type {Map<number, FrameRequestCallback>} */
  const pending = new Map()
  let nextId = 1
  return {
    cancelled: /** @type {number[]} */ ([]),
    requestAnimationFrame(/** @type {FrameRequestCallback} */ cb) {
      const id = nextId++
      pending.set(id, cb)
      return id
    },
    cancelAnimationFrame(/** @type {number} */ id) {
      this.cancelled.push(id)
      pending.delete(id)
    },
    /** Run every currently-pending callback once. */
    tick(t = 0) {
      const due = [...pending.entries()]
      pending.clear()
      for (const [, cb] of due) cb(t)
    },
    get pendingCount() { return pending.size },
  }
}

test('teardowns run in reverse registration order', () => {
  const host = fakeHost()
  const scope = createScope(host)
  /** @type {string[]} */
  const order = []
  scope.add(() => order.push('first'))
  scope.add(() => order.push('second'))
  scope.add(() => order.push('third'))
  scope.dispose()
  assert.deepEqual(order, ['third', 'second', 'first'])
})

test('dispose is idempotent — teardowns never run twice', () => {
  const host = fakeHost()
  const scope = createScope(host)
  let count = 0
  scope.add(() => { count++ })
  scope.dispose()
  scope.dispose()
  scope.dispose()
  assert.equal(count, 1)
})

test('a throwing teardown does not prevent the others', () => {
  const host = fakeHost()
  const scope = createScope(host)
  let reached = false
  scope.add(() => { reached = true })
  scope.add(() => { throw new Error('boom') })
  scope.dispose()
  assert.equal(reached, true)
})

test('raf loop reschedules itself until disposed', () => {
  const host = fakeHost()
  const scope = createScope(host)
  let frames = 0
  scope.raf(() => { frames++ })
  host.tick(); host.tick(); host.tick()
  assert.equal(frames, 3)
  scope.dispose()
  host.tick()
  assert.equal(frames, 3, 'no further frames after dispose')
})

test('disposing cancels the outstanding animation frame', () => {
  const host = fakeHost()
  const scope = createScope(host)
  scope.raf(() => {})
  assert.equal(host.pendingCount, 1)
  scope.dispose()
  assert.equal(host.cancelled.length, 1)
  assert.equal(host.pendingCount, 0)
})

test('listeners are removed on dispose', () => {
  const host = fakeHost()
  const scope = createScope(host)
  const target = new EventTarget()
  let hits = 0
  scope.on(target, 'ping', () => { hits++ })
  target.dispatchEvent(new Event('ping'))
  assert.equal(hits, 1)
  scope.dispose()
  target.dispatchEvent(new Event('ping'))
  assert.equal(hits, 1, 'listener still attached after dispose')
})

test('signal aborts on dispose', () => {
  const host = fakeHost()
  const scope = createScope(host)
  assert.equal(scope.signal.aborted, false)
  scope.dispose()
  assert.equal(scope.signal.aborted, true)
})

test('registering after dispose runs the teardown immediately', () => {
  const host = fakeHost()
  const scope = createScope(host)
  scope.dispose()
  let ran = false
  scope.add(() => { ran = true })
  assert.equal(ran, true, 'a late registration would otherwise leak forever')
})

test('raf and on are inert after dispose', () => {
  const host = fakeHost()
  const scope = createScope(host)
  const target = new EventTarget()
  scope.dispose()
  scope.raf(() => { throw new Error('should never run') })
  scope.on(target, 'ping', () => { throw new Error('should never run') })
  host.tick()
  target.dispatchEvent(new Event('ping'))
  assert.equal(host.pendingCount, 0)
})

test('disposed flag reflects state', () => {
  const scope = createScope(fakeHost())
  assert.equal(scope.disposed, false)
  scope.dispose()
  assert.equal(scope.disposed, true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scope.test.js`
Expected: FAIL — `Cannot find module '../js/scope.js'`

- [ ] **Step 3: Write the implementation**

Create `js/scope.js`:

```js
// @ts-check
/** @typedef {import('./types.js').Teardown} Teardown */

/**
 * @typedef {Object} ScopeHost
 * @property {(cb:FrameRequestCallback) => number} requestAnimationFrame
 * @property {(id:number) => void} cancelAnimationFrame
 */

/**
 * A disposal scope.
 *
 * Every resource registered here is released exactly once when dispose() runs.
 * This exists so that forgetting to clean up is not possible rather than not
 * advisable: instruments never see raw requestAnimationFrame or
 * addEventListener, so they cannot leave one running after unmount.
 *
 * Host injection is what makes this testable in node with no DOM.
 *
 * @param {ScopeHost} host
 */
export function createScope(host) {
  /** @type {Teardown[]} */
  const teardowns = []
  const controller = new AbortController()
  let disposed = false

  return {
    signal: controller.signal,

    get disposed() {
      return disposed
    },

    /**
     * Register an arbitrary teardown. Registering after dispose runs it
     * immediately — otherwise a late registration would leak forever.
     * @param {Teardown} fn
     */
    add(fn) {
      if (disposed) {
        fn()
        return
      }
      teardowns.push(fn)
    },

    /**
     * A self-rescheduling animation loop, cancelled on dispose.
     * @param {(t:number) => void} fn
     */
    raf(fn) {
      if (disposed) return
      let id = 0
      /** @type {FrameRequestCallback} */
      const step = (t) => {
        if (disposed) return
        fn(t)
        id = host.requestAnimationFrame(step)
      }
      id = host.requestAnimationFrame(step)
      teardowns.push(() => host.cancelAnimationFrame(id))
    },

    /**
     * @param {EventTarget} target
     * @param {string} type
     * @param {EventListener} fn
     * @param {AddEventListenerOptions} [opts]
     */
    on(target, type, fn, opts) {
      if (disposed) return
      target.addEventListener(type, fn, opts)
      teardowns.push(() => target.removeEventListener(type, fn, opts))
    },

    dispose() {
      if (disposed) return
      disposed = true
      controller.abort()
      for (let i = teardowns.length - 1; i >= 0; i--) {
        try {
          teardowns[i]?.()
        } catch (err) {
          console.error('scope: teardown threw', err)
        }
      }
      teardowns.length = 0
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/scope.test.js`
Expected: PASS — 10 tests, 0 failures.

- [ ] **Step 5: Run the full gate**

Run: `npm run check`
Expected: PASS — types exit 0, all tests across `tests/` pass.

- [ ] **Step 6: Commit**

```bash
git add js/scope.js tests/scope.test.js
git commit -m "feat: disposal scope — makes leaked rAF loops and listeners impossible"
```

---

## Task 4: Capability detection (`js/capability.js`)

Decides what each device can actually do, so shelf cards can be honestly dimmed rather than tapping into something broken.

**Files:**
- Create: `js/capability.js`, `tests/capability.test.js`

**Interfaces:**
- Consumes: `CapabilityKey`, `CapabilityState` from `js/types.js`
- Produces:
  - `detectCapabilities(env: CapabilityEnv) => Record<CapabilityKey, CapabilityState>`
  - `unavailableReason(key: CapabilityKey, env: CapabilityEnv) => string` — user-facing text for a dimmed card
  - `isIosSafari(env: CapabilityEnv) => boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/capability.test.js`:

```js
// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectCapabilities, unavailableReason, isIosSafari } from '../js/capability.js'

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** @param {object} over */
const env = (over = {}) => ({
  isSecureContext: true,
  userAgent: ANDROID_UA,
  hasDeviceMotionEvent: true,
  hasMotionPermissionApi: false,
  hasGetUserMedia: true,
  hasWakeLock: true,
  ...over,
})

test('android chrome: motion available without a prompt', () => {
  assert.equal(detectCapabilities(env()).motion, 'available')
})

test('ios safari: motion needs an explicit permission gesture', () => {
  const caps = detectCapabilities(env({ userAgent: IOS_UA, hasMotionPermissionApi: true }))
  assert.equal(caps.motion, 'needs-permission')
})

test('desktop with no motion sensor: unavailable', () => {
  const caps = detectCapabilities(env({ userAgent: DESKTOP_UA, hasDeviceMotionEvent: false }))
  assert.equal(caps.motion, 'unavailable')
})

test('insecure context disables every sensor capability', () => {
  const caps = detectCapabilities(env({ isSecureContext: false }))
  assert.equal(caps.motion, 'unavailable')
  assert.equal(caps.microphone, 'unavailable')
})

test('microphone always needs permission when getUserMedia exists', () => {
  assert.equal(detectCapabilities(env()).microphone, 'needs-permission')
})

test('microphone unavailable without getUserMedia', () => {
  assert.equal(detectCapabilities(env({ hasGetUserMedia: false })).microphone, 'unavailable')
})

test('wake lock degrades silently rather than blocking', () => {
  assert.equal(detectCapabilities(env({ hasWakeLock: false })).wakelock, 'unavailable')
})

test('ios safari detection: iphone yes, android no, desktop linux no', () => {
  assert.equal(isIosSafari(env({ userAgent: IOS_UA })), true)
  assert.equal(isIosSafari(env({ userAgent: ANDROID_UA })), false)
  assert.equal(isIosSafari(env({ userAgent: DESKTOP_UA })), false)
})

test('unavailable reason names the real cause, not a generic error', () => {
  const insecure = unavailableReason('motion', env({ isSecureContext: false }))
  assert.match(insecure, /secure|https/i)

  const noSensor = unavailableReason('motion', env({ hasDeviceMotionEvent: false }))
  assert.match(noSensor, /motion sensor/i)

  const noMic = unavailableReason('microphone', env({ hasGetUserMedia: false }))
  assert.match(noMic, /microphone/i)
})

test('unavailable reason is empty when the capability is fine', () => {
  assert.equal(unavailableReason('motion', env()), '')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/capability.test.js`
Expected: FAIL — `Cannot find module '../js/capability.js'`

- [ ] **Step 3: Write the implementation**

Create `js/capability.js`:

```js
// @ts-check
/** @typedef {import('./types.js').CapabilityKey} CapabilityKey */
/** @typedef {import('./types.js').CapabilityState} CapabilityState */

/**
 * Everything this module needs to know about the host, flattened so it can be
 * faked in node. js/ctx.js builds the real one from window/navigator.
 *
 * @typedef {Object} CapabilityEnv
 * @property {boolean} isSecureContext
 * @property {string} userAgent
 * @property {boolean} hasDeviceMotionEvent
 * @property {boolean} hasMotionPermissionApi  DeviceMotionEvent.requestPermission exists (iOS 13+)
 * @property {boolean} hasGetUserMedia
 * @property {boolean} hasWakeLock
 * @property {number} maxTouchPoints  navigator.maxTouchPoints; >1 means a touchscreen
 */

/**
 * Read the live browser into a CapabilityEnv.
 * @returns {CapabilityEnv}
 */
export function readEnv() {
  const DME = /** @type {any} */ (globalThis).DeviceMotionEvent
  return {
    isSecureContext: globalThis.isSecureContext === true,
    userAgent: globalThis.navigator?.userAgent ?? '',
    hasDeviceMotionEvent: typeof DME !== 'undefined',
    hasMotionPermissionApi: typeof DME?.requestPermission === 'function',
    hasGetUserMedia: typeof globalThis.navigator?.mediaDevices?.getUserMedia === 'function',
    // `!= null` rather than typeof === 'object': typeof null is also 'object',
    // so a disabled-by-policy null sentinel would read as supported.
    hasWakeLock: /** @type {any} */ (globalThis.navigator)?.wakeLock != null,
    maxTouchPoints: Number(globalThis.navigator?.maxTouchPoints) || 0,
  }
}

/**
 * @param {CapabilityEnv} env
 * @returns {Record<CapabilityKey, CapabilityState>}
 */
export function detectCapabilities(env) {
  return {
    motion: !env.isSecureContext || !env.hasDeviceMotionEvent
      ? 'unavailable'
      : env.hasMotionPermissionApi
        ? 'needs-permission'
        : 'available',

    // getUserMedia always prompts, so there is no 'available' state for it.
    microphone: !env.isSecureContext || !env.hasGetUserMedia
      ? 'unavailable'
      : 'needs-permission',

    wakelock: env.isSecureContext && env.hasWakeLock ? 'available' : 'unavailable',
  }
}

/**
 * iOS Safari has no beforeinstallprompt and no torch control, so the install
 * coach and certain cards branch on it. WebKit is the only engine allowed on
 * iOS, so matching the platform is equivalent to matching the engine.
 *
 * Since iPadOS 13, iPad defaults to "Request Desktop Website" and sends a UA
 * indistinguishable from macOS Safari, so the token test alone misses it. A Mac
 * with a touchscreen does not exist, so a Mac-like UA reporting multi-touch is
 * an iPad.
 *
 * @param {CapabilityEnv} env
 */
export function isIosSafari(env) {
  if (/iPad|iPhone|iPod/.test(env.userAgent)) return true
  return /Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1
}

/**
 * User-facing explanation for a dimmed shelf card. Empty string when usable.
 * @param {CapabilityKey} key
 * @param {CapabilityEnv} env
 * @returns {string}
 */
export function unavailableReason(key, env) {
  if (detectCapabilities(env)[key] !== 'unavailable') return ''
  if (!env.isSecureContext) return 'needs a secure connection · open over HTTPS'
  if (key === 'motion') return 'needs a motion sensor · not present on this device'
  if (key === 'microphone') return 'needs a microphone · not available in this browser'
  return 'not available on this device'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/capability.test.js`
Expected: PASS — 10 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add js/capability.js tests/capability.test.js
git commit -m "feat: capability detection with honest per-device reasons"
```

---

## Task 5: Router (`js/router.js`)

**Files:**
- Create: `js/router.js`, `tests/router.test.js`

**Interfaces:**
- Consumes: `Route` from `js/types.js`
- Produces:
  - `parseRoute(hash: string) => Route`
  - `hrefFor(route: Route) => string`
  - `createRouter(win: Window, onRoute: (r: Route) => void) => { start(): void, stop(): void }`

- [ ] **Step 1: Write the failing test**

Create `tests/router.test.js`:

```js
// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRoute, hrefFor } from '../js/router.js'

test('empty, bare hash, and root all resolve to the shelf', () => {
  assert.deepEqual(parseRoute(''), { name: 'shelf' })
  assert.deepEqual(parseRoute('#'), { name: 'shelf' })
  assert.deepEqual(parseRoute('#/'), { name: 'shelf' })
})

test('instrument route extracts the id', () => {
  assert.deepEqual(parseRoute('#/i/level'), { name: 'instrument', id: 'level' })
  assert.deepEqual(parseRoute('#/i/db-meter'), { name: 'instrument', id: 'db-meter' })
})

test('about route', () => {
  assert.deepEqual(parseRoute('#/about'), { name: 'about' })
})

test('unknown hashes resolve to not-found, carrying the original', () => {
  assert.deepEqual(parseRoute('#/nope'), { name: 'not-found', hash: '/nope' })
})

test('instrument ids are restricted to lowercase kebab — no path traversal', () => {
  assert.equal(parseRoute('#/i/../../etc/passwd').name, 'not-found')
  assert.equal(parseRoute('#/i/Level').name, 'not-found')
  assert.equal(parseRoute('#/i/a b').name, 'not-found')
  assert.equal(parseRoute('#/i/').name, 'not-found')
})

test('trailing slash on an instrument route is not a different route', () => {
  assert.equal(parseRoute('#/i/level/').name, 'not-found')
})

test('hrefFor round-trips through parseRoute', () => {
  /** @type {import('../js/types.js').Route[]} */
  const routes = [
    { name: 'shelf' },
    { name: 'about' },
    { name: 'instrument', id: 'level' },
  ]
  for (const r of routes) {
    assert.deepEqual(parseRoute(hrefFor(r)), r)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/router.test.js`
Expected: FAIL — `Cannot find module '../js/router.js'`

- [ ] **Step 3: Write the implementation**

Create `js/router.js`:

```js
// @ts-check
/** @typedef {import('./types.js').Route} Route */

// Lowercase kebab only. This is also the security boundary: the id is used to
// look up a registry entry, and anything outside this set must never match.
const INSTRUMENT_PATH = /^\/i\/([a-z0-9]+(?:-[a-z0-9]+)*)$/

/**
 * @param {string} hash the raw location.hash, with or without the leading '#'
 * @returns {Route}
 */
export function parseRoute(hash) {
  const path = (hash || '').replace(/^#/, '')
  if (path === '' || path === '/') return { name: 'shelf' }
  if (path === '/about') return { name: 'about' }

  const match = INSTRUMENT_PATH.exec(path)
  if (match?.[1]) return { name: 'instrument', id: match[1] }

  return { name: 'not-found', hash: path }
}

/**
 * @param {Route} route
 * @returns {string}
 */
export function hrefFor(route) {
  switch (route.name) {
    case 'shelf': return '#/'
    case 'about': return '#/about'
    case 'instrument': return `#/i/${route.id}`
    default: return '#/'
  }
}

/**
 * Binds parseRoute to a window's hashchange. Deliberately thin — all the logic
 * worth testing lives in parseRoute above.
 *
 * @param {Window} win
 * @param {(route:Route) => void} onRoute
 */
export function createRouter(win, onRoute) {
  const handle = () => onRoute(parseRoute(win.location.hash))
  return {
    start() {
      win.addEventListener('hashchange', handle)
      handle()
    },
    stop() {
      win.removeEventListener('hashchange', handle)
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/router.test.js`
Expected: PASS — 7 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add js/router.js tests/router.test.js
git commit -m "feat: hash router with kebab-only instrument ids"
```

---

## Task 6: Managed resource kit (`js/ctx.js`)

Wires a disposal scope to the real browser and normalises the platform accelerometer sign difference — the one place that difference is allowed to exist.

**Files:**
- Create: `js/ctx.js`, `tests/ctx-sign.test.js`

**Interfaces:**
- Consumes: `createScope` (Task 3), `readEnv`/`isIosSafari` (Task 4), `Ctx`/`Vec3`/`Store` types
- Produces:
  - `normaliseGravity(raw: Vec3, iosSigns: boolean) => Vec3`
  - `createCtx(win: Window, namespace: string) => { ctx: Ctx, dispose: () => void }`

**Critical platform note:** `DeviceMotionEvent.accelerationIncludingGravity` is reported with **opposite sign on iOS versus Android**. Android follows the W3C convention (flat screen-up reads `z ≈ +9.81`); iOS reports the negation. `dsp/tilt.js` is written against the W3C convention, so `normaliseGravity` flips iOS into it. This is the *only* place platform sign is handled. Task 14 verifies it on real hardware.

- [ ] **Step 1: Write the failing test**

Create `tests/ctx-sign.test.js`:

```js
// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normaliseGravity } from '../js/ctx.js'
import { gravityToTilt } from '../dsp/tilt.js'

test('android values pass through untouched', () => {
  const raw = { x: 0, y: 0, z: 9.81 }
  assert.deepEqual(normaliseGravity(raw, false), raw)
})

test('ios values are negated into the W3C convention', () => {
  // Expect +0, not -0. Negating a zero yields -0, and Math.atan2 treats -0 as a
  // different quadrant — so normaliseGravity collapses it. assert/strict's
  // deepEqual distinguishes the two, which is what pins this down.
  assert.deepEqual(normaliseGravity({ x: 0, y: 0, z: -9.81 }, true), { x: 0, y: 0, z: 9.81 })
})

test('both platforms flat-screen-up produce a level reading', () => {
  const android = gravityToTilt(normaliseGravity({ x: 0, y: 0, z: 9.81 }, false))
  const ios = gravityToTilt(normaliseGravity({ x: 0, y: 0, z: -9.81 }, true))
  assert.equal(Math.abs(android.pitch) < 1e-9, true)
  assert.equal(Math.abs(ios.pitch) < 1e-9, true)
  assert.equal(Math.abs(android.roll) < 1e-9, true)
  assert.equal(Math.abs(ios.roll) < 1e-9, true)
})

test('both platforms agree on the sign of a raised top edge', () => {
  // Top edge raised 45°: world-up in device coords is (0, +0.707, +0.707)·9.81.
  // Android reports that directly; iOS reports its negation.
  const android = gravityToTilt(normaliseGravity({ x: 0, y: 6.94, z: 6.94 }, false))
  const ios = gravityToTilt(normaliseGravity({ x: 0, y: -6.94, z: -6.94 }, true))
  assert.ok(android.pitch > 44 && android.pitch < 46, `android pitch was ${android.pitch}`)
  assert.ok(ios.pitch > 44 && ios.pitch < 46, `ios pitch was ${ios.pitch}`)
})

test('null components are treated as zero rather than producing NaN', () => {
  const g = normaliseGravity(/** @type {any} */ ({ x: null, y: undefined, z: 9.81 }), false)
  assert.equal(Number.isNaN(g.x), false)
  assert.equal(Number.isNaN(g.y), false)
  assert.equal(g.z, 9.81)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ctx-sign.test.js`
Expected: FAIL — `Cannot find module '../js/ctx.js'`

- [ ] **Step 3: Write the implementation**

Create `js/ctx.js`:

```js
// @ts-check
import { createScope } from './scope.js'
import { readEnv, isIosSafari } from './capability.js'

/** @typedef {import('./types.js').Ctx} Ctx */
/** @typedef {import('./types.js').Vec3} Vec3 */
/** @typedef {import('./types.js').Store} Store */

/**
 * DeviceMotionEvent.accelerationIncludingGravity is reported with opposite sign
 * on iOS versus Android. Android matches the W3C convention (flat screen-up
 * gives z ≈ +9.81); iOS gives the negation.
 *
 * dsp/tilt.js is written against the W3C convention, so this is the single
 * place in the codebase where platform sign is handled. Nothing downstream
 * should ever branch on platform for orientation again.
 *
 * @param {Vec3} raw
 * @param {boolean} iosSigns
 * @returns {Vec3}
 */
export function normaliseGravity(raw, iosSigns) {
  const s = iosSigns ? -1 : 1
  // Map -0 to +0. Negating a zero component yields -0, and Math.atan2 treats
  // -0 as a different quadrant than +0 — so without this, iOS and Android
  // disagree by 180° at any orientation where an axis reads exactly zero.
  // (`Number(-0) || 0` is not enough: the sign multiplication reintroduces -0.)
  const norm = (/** @type {unknown} */ v) => {
    const n = s * (Number(v) || 0)
    return n === 0 ? 0 : n
  }
  return { x: norm(raw?.x), y: norm(raw?.y), z: norm(raw?.z) }
}

/**
 * Namespaced persistence. Swallows quota and private-mode failures — losing a
 * calibration offset must never break an instrument.
 * @param {string} namespace
 * @returns {Store}
 */
function createStore(namespace) {
  const key = (/** @type {string} */ k) => `tq:${namespace}:${k}`
  return {
    get(k) {
      try {
        const raw = globalThis.localStorage?.getItem(key(k))
        return raw === null || raw === undefined ? undefined : JSON.parse(raw)
      } catch {
        return undefined
      }
    },
    set(k, value) {
      try {
        globalThis.localStorage?.setItem(key(k), JSON.stringify(value))
      } catch {
        /* quota exceeded or private mode — non-fatal by design */
      }
    },
  }
}

/**
 * Build the managed resource kit handed to an instrument's mount().
 *
 * Callers must invoke the returned dispose() exactly once, when the instrument
 * is unmounted. js/app.js owns that responsibility.
 *
 * @param {Window} win
 * @param {string} namespace instrument id, used to scope persistence
 * @returns {{ ctx: Ctx, dispose: () => void }}
 */
export function createCtx(win, namespace) {
  const scope = createScope({
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  })

  const iosSigns = isIosSafari(readEnv())

  /** @type {any} */
  let sentinel = null

  /** @type {Ctx} */
  const ctx = {
    raf: (fn) => scope.raf(fn),
    on: (target, type, fn, opts) => scope.on(target, type, fn, opts),
    signal: scope.signal,
    store: createStore(namespace),

    motion(fn) {
      let last = 0
      scope.on(win, 'devicemotion', (/** @type {Event} */ event) => {
        const e = /** @type {DeviceMotionEvent} */ (event)
        const raw = e.accelerationIncludingGravity
        if (!raw) return
        const now = event.timeStamp || performance.now()
        // First sample has no predecessor; assume a 60 Hz interval so the very
        // first smoothing step is sane rather than a divide-by-nothing.
        const dt = last === 0 ? 1 / 60 : Math.max((now - last) / 1000, 1e-4)
        last = now
        fn(normaliseGravity(/** @type {Vec3} */ (/** @type {unknown} */ (raw)), iosSigns), dt)
      })
    },

    wakeLock() {
      const wl = /** @type {any} */ (win.navigator).wakeLock
      if (!wl?.request) return
      wl.request('screen')
        .then((/** @type {any} */ s) => {
          sentinel = s
          scope.add(() => { sentinel?.release?.().catch(() => {}); sentinel = null })
        })
        .catch(() => { /* denied or unsupported — degrade silently */ })

      // A wake lock is dropped whenever the page is backgrounded; re-acquire on
      // return, otherwise the screen sleeps mid-measurement after any app switch.
      scope.on(win.document, 'visibilitychange', () => {
        if (win.document.visibilityState === 'visible' && sentinel === null) ctx.wakeLock()
      })
    },
  }

  return { ctx, dispose: () => scope.dispose() }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/ctx-sign.test.js`
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 5: Run the full gate**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/ctx.js tests/ctx-sign.test.js
git commit -m "feat: managed resource kit, normalising the iOS/Android gravity sign"
```

---

## Task 7: Shell, design tokens, and font

**Files:**
- Create: `index.html`, `css/site.css`, `fonts/IBMPlexMono-subset.woff2`, `fonts/README.md`

**Interfaces:**
- Consumes: nothing at runtime yet (`js/app.js` arrives in Task 8)
- Produces: `#app` mount point; CSS custom properties `--void`, `--surface`, `--hairline`, `--ink`, `--ink-label`, `--ink-dim`, `--signal`, `--alert`; utility classes `.readout`, `.label`, `.card`, `.sheet`

- [ ] **Step 1: Build the font subset**

IBM Plex Mono is OFL-licensed. Download the regular and semibold weights, then subset to the glyphs the site actually uses. `pyftsubset` ships with `fonttools`.

```bash
mkdir -p fonts tools/venv
python3 -m venv tools/venv
tools/venv/bin/pip install fonttools brotli

curl -L -o /tmp/plex-mono.zip \
  https://github.com/IBM/plex/releases/download/%40ibm%2Fplex-mono%401.1.0/ibm-plex-mono.zip
unzip -o -j /tmp/plex-mono.zip '*IBMPlexMono-Regular.ttf' -d /tmp/plex

tools/venv/bin/pyftsubset /tmp/plex/IBMPlexMono-Regular.ttf \
  --output-file=fonts/IBMPlexMono-subset.woff2 \
  --flavor=woff2 \
  --layout-features='kern,liga,tnum,zero' \
  --unicodes='U+0020-007E,U+00B0,U+00B7,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2026,U+2212'

ls -lh fonts/IBMPlexMono-subset.woff2
```

Expected: a file under 25 KB. `U+00B0` is the degree sign — the Spirit Level is unreadable without it. `tnum` and `zero` are the feature tags for tabular figures and the slashed zero.

- [ ] **Step 2: Record provenance in `fonts/README.md`**

```markdown
# Fonts

`IBMPlexMono-subset.woff2` — IBM Plex Mono Regular, subset for this site.

- Upstream: https://github.com/IBM/plex (SIL Open Font License 1.1)
- Regenerate with the `pyftsubset` command in
  `docs/superpowers/plans/2026-07-28-v0-shell-and-spirit-level.md`, Task 7.
- Subset covers ASCII plus the degree sign, middle dot, dashes, curly quotes,
  ellipsis and minus sign.
- `tnum` (tabular figures) and `zero` (slashed zero) are retained deliberately:
  both are mandatory for every numeric readout on the site.
```

- [ ] **Step 3: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>The Quantitative</title>
<meta name="description" content="A cabinet of instruments. Touch it with your thumb and numbers come out.">
<meta name="theme-color" content="#000000">
<meta name="color-scheme" content="dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Quantitative">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" href="/icons/icon-192.png" sizes="192x192">
<link rel="preload" href="/fonts/IBMPlexMono-subset.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/site.css">
</head>
<body>
<header class="masthead" id="masthead">
  <a class="masthead__home" href="#/" aria-label="All instruments">The Quantitative</a>
</header>

<main id="app" tabindex="-1"></main>

<script type="module" src="/js/app.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create `css/site.css`**

```css
/* ── Tokens ───────────────────────────────────────────────────────────── */
:root {
  --void:       #000000;
  --surface:    #0d0f12;
  --hairline:   #1e2227;
  --ink:        #e8eaed;
  --ink-label:  #8b9299;
  --ink-dim:    #4d545c;
  --signal:     #ffb000;   /* candidate — confirmed on-device in Task 14 */
  --alert:      #ff4d4f;

  --pad:        max(1rem, env(safe-area-inset-left));
  --masthead-h: 3rem;

  color-scheme: dark;
}

@font-face {
  font-family: 'IBM Plex Mono';
  src: url('/fonts/IBMPlexMono-subset.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

/* ── Base ─────────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  min-height: 100dvh;
  background: var(--void);
  color: var(--ink);
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  /* Tabular figures and slashed zero are mandatory site-wide: digits must not
     shift horizontally as a live readout updates. */
  font-variant-numeric: tabular-nums slashed-zero;
  font-feature-settings: 'tnum' 1, 'zero' 1;
  padding:
    env(safe-area-inset-top) env(safe-area-inset-right)
    env(safe-area-inset-bottom) env(safe-area-inset-left);
  overscroll-behavior: none;
}

a { color: inherit; text-decoration: none; }

:focus-visible { outline: 2px solid var(--signal); outline-offset: 2px; }

/* ── Masthead ─────────────────────────────────────────────────────────── */
.masthead {
  display: flex;
  align-items: center;
  height: var(--masthead-h);
  padding-inline: var(--pad);
  border-bottom: 1px solid var(--hairline);
}
.masthead__home {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ink-label);
}
/* On an instrument the chrome gets out of the way. */
body[data-route='instrument'] .masthead { border-bottom-color: transparent; }

/* ── Typographic roles ────────────────────────────────────────────────── */
.label {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ink-label);
}
.readout {
  font-size: clamp(2.75rem, 18vw, 5rem);
  line-height: 1;
  color: var(--signal);
  font-variant-numeric: tabular-nums slashed-zero;
}
.readout__unit { font-size: 0.3em; color: var(--ink-label); margin-inline-start: 0.4em; }

/* ── Shelf ────────────────────────────────────────────────────────────── */
.shelf { padding: var(--pad) var(--pad) 4rem; }
.shelf__section + .shelf__section { margin-top: 2rem; }
.shelf__heading { margin: 0 0 0.75rem; }
.shelf__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
  gap: 0.75rem;
}

.card {
  display: block;
  min-height: 7rem;
  padding: 0.875rem;
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: 0.5rem;
}
.card__name { display: block; margin-bottom: 0.35rem; font-size: 0.9375rem; }
.card__blurb { display: block; font-size: 0.75rem; line-height: 1.4; color: var(--ink-label); }
.card__reason { display: block; margin-top: 0.5rem; font-size: 0.6875rem; color: var(--ink-dim); }
.card[aria-disabled='true'] { color: var(--ink-dim); }
.card[aria-disabled='true'] .card__name,
.card[aria-disabled='true'] .card__blurb { color: var(--ink-dim); }

/* ── Instrument stage ─────────────────────────────────────────────────── */
.stage {
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - var(--masthead-h));
  padding: var(--pad);
}

/* ── Arm screen ───────────────────────────────────────────────────────── */
.arm {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 1rem;
  flex: 1;
  text-align: center;
  padding: var(--pad);
}
.arm__body { max-width: 22rem; font-size: 0.875rem; line-height: 1.5; color: var(--ink-label); }
.arm__button {
  font: inherit;
  font-size: 0.8125rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--void);
  background: var(--signal);
  border: 0;
  border-radius: 0.375rem;
  padding: 0.875rem 1.75rem;
  min-height: 2.75rem;   /* comfortable thumb target */
  cursor: pointer;
}
.arm__button--quiet { background: transparent; color: var(--ink-label); border: 1px solid var(--hairline); }

/* ── Sheets and pills ─────────────────────────────────────────────────── */
.sheet {
  position: fixed;
  left: 0; right: 0;
  bottom: calc(env(safe-area-inset-bottom) + 0.75rem);
  margin-inline: var(--pad);
  padding: 1rem;
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: 0.625rem;
  font-size: 0.8125rem;
  line-height: 1.5;
  z-index: 10;
}
.sheet__dismiss {
  font: inherit;
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  background: none;
  border: 0;
  color: var(--ink-label);
  padding: 0.5rem 0;
  cursor: pointer;
}

/* ── Motion ───────────────────────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 5: Verify the shell renders and the font loads**

```bash
python3 -m http.server 8000 &
SERVER=$!
sleep 1
curl -sf http://localhost:8000/ | grep -q 'id="app"' && echo "SHELL OK"
curl -sfI http://localhost:8000/fonts/IBMPlexMono-subset.woff2 | head -1
kill $SERVER
```

Expected: `SHELL OK` and a `200 OK` for the font.

- [ ] **Step 6: Commit**

```bash
git add index.html css/site.css fonts/
git commit -m "feat: shell, design tokens, and IBM Plex Mono subset"
```

---

## Task 8: Registry, shelf, and app bootstrap

**Files:**
- Create: `js/registry.js`, `js/util.js`, `js/app.js`

**Interfaces:**
- Consumes: `parseRoute`/`createRouter`/`hrefFor` (Task 5), `detectCapabilities`/`readEnv`/`unavailableReason` (Task 4), `createCtx` (Task 6)
- Produces:
  - `js/util.js`: `escapeHtml(s: string) => string`, `el(tag, attrs?, children?) => HTMLElement`
  - `js/registry.js`: `REGISTRY: RegistryEntry[]`, `findEntry(id: string) => RegistryEntry | undefined`
  - `js/app.js`: no exports — it is the entry point

- [ ] **Step 1: Write the failing test for the registry contract**

Create `tests/registry.test.js`:

```js
// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REGISTRY, findEntry } from '../js/registry.js'
import { parseRoute } from '../js/router.js'
import { escapeHtml } from '../js/util.js'

test('every entry has the full metadata set', () => {
  for (const e of REGISTRY) {
    assert.equal(typeof e.id, 'string', 'id')
    assert.equal(typeof e.name, 'string', 'name')
    assert.ok(['world', 'ideas'].includes(e.category), `category of ${e.id}`)
    assert.equal(typeof e.blurb, 'string', 'blurb')
    assert.ok(Array.isArray(e.needs), 'needs')
    assert.equal(typeof e.load, 'function', 'load')
  }
})

test('ids are unique', () => {
  const ids = REGISTRY.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('every id survives the router — catches a typo that would 404 its own card', () => {
  for (const e of REGISTRY) {
    assert.deepEqual(parseRoute(`#/i/${e.id}`), { name: 'instrument', id: e.id })
  }
})

test('findEntry resolves known ids and rejects unknown ones', () => {
  assert.equal(findEntry('level')?.id, 'level')
  assert.equal(findEntry('does-not-exist'), undefined)
})

test('v0 ships the spirit level', () => {
  const level = findEntry('level')
  assert.ok(level)
  assert.deepEqual(level.needs, ['motion'])
  assert.equal(level.category, 'world')
})

test('escapeHtml neutralises markup in metadata', () => {
  assert.equal(escapeHtml('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;')
  assert.equal(escapeHtml('a & b'), 'a &amp; b')
  assert.equal(escapeHtml('"q" \'p\''), '&quot;q&quot; &#39;p&#39;')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/registry.test.js`
Expected: FAIL — `Cannot find module '../js/registry.js'`

- [ ] **Step 3: Write `js/util.js`**

```js
// @ts-check

/**
 * @param {string} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Minimal element builder. Keeps rendering code readable without a template
 * library, and avoids innerHTML at every call site.
 *
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @param {(Node|string)[]} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  for (const c of children) node.append(c)
  return node
}
```

- [ ] **Step 4: Write `js/registry.js`**

```js
// @ts-check
/** @typedef {import('./types.js').RegistryEntry} RegistryEntry */

/**
 * Instrument metadata is eager — it draws the shelf. Instrument code is lazy —
 * it arrives only when a card is tapped.
 *
 * Adding an instrument is: write one file under instruments/, add one entry
 * here. It cannot affect any existing instrument.
 *
 * @type {RegistryEntry[]}
 */
export const REGISTRY = [
  {
    id: 'level',
    name: 'Spirit Level',
    category: 'world',
    blurb: 'Two-axis inclinometer. Tap to zero.',
    needs: ['motion'],
    load: () => import('../instruments/level.js'),
  },
]

/**
 * @param {string} id
 * @returns {RegistryEntry|undefined}
 */
export function findEntry(id) {
  return REGISTRY.find((e) => e.id === id)
}
```

- [ ] **Step 5: Write `js/app.js`**

```js
// @ts-check
import { createRouter, hrefFor } from './router.js'
import { REGISTRY, findEntry } from './registry.js'
import { readEnv, detectCapabilities, unavailableReason } from './capability.js'
import { createCtx } from './ctx.js'
import { requireCapabilities } from './arm.js'
import { el, escapeHtml } from './util.js'

/** @typedef {import('./types.js').Route} Route */
/** @typedef {import('./types.js').RegistryEntry} RegistryEntry */

const app = /** @type {HTMLElement} */ (document.getElementById('app'))

/** Teardown for whatever is currently mounted. Exactly one may be live. */
let active = /** @type {null | (() => void)} */ (null)

function clear() {
  if (active) { active(); active = null }
  app.replaceChildren()
}

/** @param {RegistryEntry} entry */
function card(entry) {
  const env = readEnv()
  const blocked = entry.needs.find((n) => detectCapabilities(env)[n] === 'unavailable')

  const children = [
    el('span', { class: 'card__name' }, [entry.name]),
    el('span', { class: 'card__blurb' }, [entry.blurb]),
  ]

  if (blocked) {
    children.push(el('span', { class: 'card__reason' }, [unavailableReason(blocked, env)]))
    return el('div', { class: 'card', 'aria-disabled': 'true' }, children)
  }

  return el('a', { class: 'card', href: hrefFor({ name: 'instrument', id: entry.id }) }, children)
}

function renderShelf() {
  const sections = /** @type {const} */ ([
    { key: 'world', heading: 'World' },
    { key: 'ideas', heading: 'Ideas' },
  ])

  const shelf = el('div', { class: 'shelf' })

  for (const section of sections) {
    const entries = REGISTRY.filter((e) => e.category === section.key)
    if (entries.length === 0) continue
    shelf.append(
      el('section', { class: 'shelf__section' }, [
        el('h2', { class: 'shelf__heading label' }, [section.heading]),
        el('div', { class: 'shelf__grid' }, entries.map(card)),
      ]),
    )
  }

  app.append(shelf)
}

function renderAbout() {
  const wrap = el('div', { class: 'shelf' })
  wrap.innerHTML = `
    <h2 class="shelf__heading label">About</h2>
    <p class="card__blurb">A cabinet of instruments. Some point outward at physical
    reality, some inward at mathematical reality. You touch one with your thumb and
    numbers come out.</p>
    <p class="card__blurb">No accounts, no tracking, no network. Everything here works
    with the aeroplane mode switch on.</p>`
  app.append(wrap)
}

/** @param {string} message */
function renderMessage(message) {
  app.append(el('div', { class: 'shelf' }, [
    el('p', { class: 'card__blurb' }, [message]),
    el('p', {}, [el('a', { class: 'label', href: '#/' }, ['← All instruments'])]),
  ]))
}

/** @param {string} id */
async function mountInstrument(id) {
  const entry = findEntry(id)
  if (!entry) { renderMessage(`No instrument called “${escapeHtml(id)}”.`); return }

  const stage = el('div', { class: 'stage' })
  app.append(stage)

  // The arm screen owns every permission state. mount() is never reached until
  // the grant lands, so no instrument file contains permission handling.
  const granted = await requireCapabilities(stage, entry.needs)
  if (!granted) return

  const mod = await entry.load()
  const { ctx, dispose } = createCtx(window, entry.id)
  stage.replaceChildren()
  const teardown = mod.default.mount(stage, ctx)

  active = () => { teardown(); dispose() }
}

/** @param {Route} route */
function onRoute(route) {
  clear()
  document.body.dataset.route = route.name
  app.focus({ preventScroll: true })

  switch (route.name) {
    case 'shelf': renderShelf(); break
    case 'about': renderAbout(); break
    case 'instrument': void mountInstrument(route.id); break
    case 'not-found': renderMessage('Nothing here.'); break
  }
}

createRouter(window, onRoute).start()

// Release the mounted instrument if the page goes away mid-measurement,
// so a backgrounded tab cannot keep a sensor listener alive.
window.addEventListener('pagehide', () => { if (active) { active(); active = null } })
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/registry.test.js`
Expected: PASS — 6 tests, 0 failures.

Note: `js/app.js` is not imported by any node test (it touches `document` at module scope). It is covered by the browser harness in Task 13.

- [ ] **Step 7: Commit**

```bash
git add js/registry.js js/util.js js/app.js tests/registry.test.js
git commit -m "feat: registry, shelf rendering, and route mounting"
```

---

## Task 9: Arm screen (`js/arm.js`)

Every permission state gets a designed screen, including denial. This is the only place in the codebase that calls `requestPermission`.

**Files:**
- Create: `js/arm.js`

**Interfaces:**
- Consumes: `readEnv`/`detectCapabilities`/`isIosSafari`/`unavailableReason` (Task 4), `el` (Task 8)
- Produces: `requireCapabilities(host: HTMLElement, needs: CapabilityKey[]) => Promise<boolean>` — resolves `true` only when every capability is granted. On `false`, it has already rendered an explanatory screen into `host`.

- [ ] **Step 1: Write the implementation**

Create `js/arm.js`:

```js
// @ts-check
import { readEnv, detectCapabilities, isIosSafari, unavailableReason } from './capability.js'
import { el } from './util.js'

/** @typedef {import('./types.js').CapabilityKey} CapabilityKey */

const COPY = {
  motion: {
    title: 'Motion access',
    why: 'The Spirit Level reads your phone’s accelerometer to work out which way is down. Nothing is recorded and nothing leaves the device.',
    action: 'Enable motion',
  },
  microphone: {
    title: 'Microphone access',
    why: 'This instrument analyses sound locally, in the page. No audio is recorded, stored, or transmitted.',
    action: 'Enable microphone',
  },
  wakelock: {
    title: 'Keep the screen awake',
    why: 'Holds the screen on while you are measuring.',
    action: 'Continue',
  },
}

/**
 * @param {HTMLElement} host
 * @param {string} title
 * @param {string} body
 * @param {{label:string, onClick:() => void}} [action]
 */
function screen(host, title, body, action) {
  const nodes = [
    el('h2', { class: 'label' }, [title]),
    el('p', { class: 'arm__body' }, [body]),
  ]
  if (action) {
    const button = el('button', { class: 'arm__button', type: 'button' }, [action.label])
    button.addEventListener('click', action.onClick, { once: true })
    nodes.push(button)
  }
  nodes.push(el('a', { class: 'label', href: '#/' }, ['← All instruments']))
  host.replaceChildren(el('div', { class: 'arm' }, nodes))
}

/**
 * Request one capability, rendering the appropriate screen for every outcome.
 * @param {HTMLElement} host
 * @param {CapabilityKey} key
 * @returns {Promise<boolean>}
 */
function requireOne(host, key) {
  const env = readEnv()
  const state = detectCapabilities(env)[key]
  const copy = COPY[key]

  if (state === 'available') return Promise.resolve(true)

  if (state === 'unavailable') {
    screen(host, 'Not available here', `${copy.title} is ${unavailableReason(key, env)}.`)
    return Promise.resolve(false)
  }

  // needs-permission: the request must originate from a user gesture, which is
  // exactly why this is a button and not an automatic call on mount.
  return new Promise((resolve) => {
    screen(host, copy.title, copy.why, {
      label: copy.action,
      onClick: () => {
        screen(host, copy.title, 'Waiting for your answer…')
        grant(key)
          .then((ok) => {
            if (ok) { resolve(true); return }
            screen(
              host,
              'Permission denied',
              isIosSafari(env)
                ? 'Motion access was declined. To undo it: Settings → Apps → Safari → Motion & Orientation Access, then reload this page.'
                : 'Access was declined. Tap the padlock in the address bar to review this site’s permissions, then reload.',
              { label: 'Try again', onClick: () => resolve(false) },
            )
            resolve(false)
          })
          .catch(() => {
            screen(host, 'Something went wrong', 'The permission request failed. Reload and try again.')
            resolve(false)
          })
      },
    })
  })
}

/**
 * @param {CapabilityKey} key
 * @returns {Promise<boolean>}
 */
async function grant(key) {
  if (key === 'motion') {
    const DME = /** @type {any} */ (globalThis).DeviceMotionEvent
    if (typeof DME?.requestPermission !== 'function') return true
    return (await DME.requestPermission()) === 'granted'
  }
  if (key === 'microphone') {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    // Release immediately — ctx.mic() opens its own stream when an instrument
    // actually needs one. This call exists purely to trigger the prompt.
    stream.getTracks().forEach((t) => t.stop())
    return true
  }
  return true
}

/**
 * Gate an instrument behind every capability it declares.
 * Resolves true only when all are granted.
 *
 * @param {HTMLElement} host
 * @param {CapabilityKey[]} needs
 * @returns {Promise<boolean>}
 */
export async function requireCapabilities(host, needs) {
  for (const key of needs) {
    if (!(await requireOne(host, key))) return false
  }
  return true
}
```

- [ ] **Step 2: Run the type gate**

Run: `npm run types`
Expected: PASS — exit 0.

- [ ] **Step 3: Commit**

```bash
git add js/arm.js
git commit -m "feat: arm screen owning all five permission states"
```

---

## Task 10: The Spirit Level (`instruments/level.js`)

**Files:**
- Create: `instruments/level.js`

**Interfaces:**
- Consumes: `gravityToTilt`/`alphaFor`/`lowPassVec`/`applyCalibration` (Task 2), `Ctx`/`Instrument`/`Tilt`/`Vec3` types
- Produces: default export satisfying `Instrument`

**Design notes fixed here:**
- Smoothing time constant `TAU = 0.12` seconds — steady enough to read, quick enough to feel live.
- Bubble travel saturates at `RANGE = 15°`; beyond that it pins to the edge and the numbers carry the information.
- `LEVEL_EPS = 0.15°` is the "actually level" threshold that recolours the vial.
- Calibration persists under `ctx.store` key `zero`.

- [ ] **Step 1: Write the implementation**

Create `instruments/level.js`:

```js
// @ts-check
import { gravityToTilt, alphaFor, lowPassVec, applyCalibration } from '../dsp/tilt.js'

/** @typedef {import('../js/types.js').Instrument} Instrument */
/** @typedef {import('../js/types.js').Ctx} Ctx */
/** @typedef {import('../js/types.js').Tilt} Tilt */
/** @typedef {import('../js/types.js').Vec3} Vec3 */

const TAU = 0.12        // seconds — smoothing time constant
const RANGE = 15        // degrees of tilt mapped to full bubble travel
const LEVEL_EPS = 0.15  // degrees within which we call it level

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** @param {number} deg */
const fmt = (deg) => (Math.abs(deg) < 0.05 ? '0.0' : deg.toFixed(1))

/** @type {Instrument} */
export default {
  id: 'level',
  name: 'Spirit Level',
  category: 'world',
  blurb: 'Two-axis inclinometer. Tap to zero.',
  needs: ['motion'],

  /**
   * @param {HTMLElement} root
   * @param {Ctx} ctx
   * @returns {() => void}
   */
  mount(root, ctx) {
    root.innerHTML = `
      <div class="level">
        <div class="level__readouts">
          <div class="level__axis">
            <span class="label">Pitch</span>
            <span class="readout" data-pitch>0.0<span class="readout__unit">°</span></span>
          </div>
          <div class="level__axis">
            <span class="label">Roll</span>
            <span class="readout" data-roll>0.0<span class="readout__unit">°</span></span>
          </div>
        </div>
        <canvas class="level__vial" data-vial></canvas>
        <div class="level__actions">
          <button class="arm__button arm__button--quiet" type="button" data-zero>Tap to zero</button>
          <button class="arm__button arm__button--quiet" type="button" data-reset>Clear zero</button>
        </div>
      </div>`

    const pitchOut = /** @type {HTMLElement} */ (root.querySelector('[data-pitch]'))
    const rollOut = /** @type {HTMLElement} */ (root.querySelector('[data-roll]'))
    const canvas = /** @type {HTMLCanvasElement} */ (root.querySelector('[data-vial]'))
    const zeroBtn = /** @type {HTMLElement} */ (root.querySelector('[data-zero]'))
    const resetBtn = /** @type {HTMLElement} */ (root.querySelector('[data-reset]'))
    const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))

    const stored = /** @type {Tilt|undefined} */ (ctx.store.get('zero'))
    /** @type {Tilt} */
    let zero = stored && typeof stored.pitch === 'number' ? stored : { pitch: 0, roll: 0 }

    /** @type {Vec3} */
    let smoothed = { x: 0, y: 0, z: 1 }
    /** @type {Tilt} */
    let tilt = { pitch: 0, roll: 0 }
    let seenSample = false

    ctx.wakeLock()

    ctx.motion((g, dt) => {
      // First real sample seeds the filter directly, so the bubble does not
      // sweep in from a fictional starting position on mount.
      smoothed = seenSample ? lowPassVec(smoothed, g, alphaFor(dt, TAU)) : g
      seenSample = true
      tilt = applyCalibration(gravityToTilt(smoothed), zero)
    })

    zeroBtn.addEventListener('click', () => {
      zero = gravityToTilt(smoothed)
      ctx.store.set('zero', zero)
    })

    resetBtn.addEventListener('click', () => {
      zero = { pitch: 0, roll: 0 }
      ctx.store.set('zero', zero)
    })

    /** Size the backing store to the device pixel grid so hairlines stay hair-thin. */
    function resize() {
      const dpr = window.devicePixelRatio || 1
      const side = Math.min(canvas.clientWidth, canvas.clientHeight)
      canvas.width = Math.round(side * dpr)
      canvas.height = Math.round(side * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    ctx.on(window, 'resize', resize)
    ctx.on(window, 'orientationchange', resize)

    const styles = getComputedStyle(document.documentElement)
    const SIGNAL = styles.getPropertyValue('--signal').trim() || '#ffb000'
    const HAIRLINE = styles.getPropertyValue('--hairline').trim() || '#1e2227'
    const INK_DIM = styles.getPropertyValue('--ink-dim').trim() || '#4d545c'

    ctx.raf(() => {
      pitchOut.firstChild && (pitchOut.firstChild.textContent = fmt(tilt.pitch))
      rollOut.firstChild && (rollOut.firstChild.textContent = fmt(tilt.roll))

      const w = canvas.width / (window.devicePixelRatio || 1)
      const c = w / 2
      const r = c - 8

      context.clearRect(0, 0, w, w)

      // Vial: outer ring plus concentric tolerance rings and a crosshair.
      context.strokeStyle = HAIRLINE
      context.lineWidth = 1
      context.beginPath(); context.arc(c, c, r, 0, Math.PI * 2); context.stroke()
      context.beginPath(); context.arc(c, c, r * 0.5, 0, Math.PI * 2); context.stroke()

      context.strokeStyle = INK_DIM
      context.beginPath()
      context.moveTo(c - r, c); context.lineTo(c + r, c)
      context.moveTo(c, c - r); context.lineTo(c, c + r)
      context.stroke()

      // Bubble. Roll drives x, pitch drives y; y is inverted so raising the top
      // edge moves the bubble up the screen, matching a physical vial.
      const bx = c + (clamp(tilt.roll, -RANGE, RANGE) / RANGE) * r
      const by = c - (clamp(tilt.pitch, -RANGE, RANGE) / RANGE) * r
      const level = Math.abs(tilt.pitch) < LEVEL_EPS && Math.abs(tilt.roll) < LEVEL_EPS

      context.fillStyle = SIGNAL
      context.globalAlpha = level ? 1 : 0.55
      context.beginPath(); context.arc(bx, by, 9, 0, Math.PI * 2); context.fill()
      context.globalAlpha = 1

      if (level) {
        context.strokeStyle = SIGNAL
        context.lineWidth = 2
        context.beginPath(); context.arc(c, c, r * 0.5, 0, Math.PI * 2); context.stroke()
      }
    })

    return () => { root.replaceChildren() }
  },
}
```

- [ ] **Step 2: Add the instrument's styles to `css/site.css`**

Append:

```css
/* ── Spirit Level ─────────────────────────────────────────────────────── */
.level {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  flex: 1;
  justify-content: center;
}
.level__readouts { display: flex; gap: 2.5rem; }
.level__axis { display: flex; flex-direction: column; align-items: center; gap: 0.25rem; }
.level__vial { width: min(70vw, 20rem); aspect-ratio: 1; }
.level__actions { display: flex; gap: 0.75rem; }
```

- [ ] **Step 3: Run the full gate**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 4: Verify by hand in a desktop browser**

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/#/`. Expected: the shelf shows one card, **dimmed**, reading `needs a motion sensor · not present on this device` — because a desktop has no accelerometer and `localhost` capability detection is honest about it. That dimmed card is the correct desktop result; real behaviour is verified on hardware in Task 14.

- [ ] **Step 5: Commit**

```bash
git add instruments/level.js css/site.css
git commit -m "feat: Spirit Level — damped two-axis inclinometer with tap-to-zero"
```

---

## Task 11: PWA — manifest, icons, and service worker

**Files:**
- Create: `manifest.webmanifest`, `icons/mark.svg`, `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-maskable-512.png`, `icons/apple-touch-icon.png`, `sw.js`, `tools/build_sw.py`, `tools/test_build_sw.py`

**Interfaces:**
- Consumes: nothing
- Produces: `tools/build_sw.py` writes `sw-manifest.js` defining `self.PRECACHE` (array of `{url, rev}`) and `self.PRECACHE_VERSION` (string), and rewrites the `CACHE_VERSION` line inside `sw.js`

- [ ] **Step 1: Create the icon source `icons/mark.svg`**

A readout reduced to its essentials: a centred signal dot inside a hairline vial, flanked by tick marks.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#000000"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#1e2227" stroke-width="10"/>
  <circle cx="256" cy="256" r="76" fill="none" stroke="#1e2227" stroke-width="10"/>
  <g stroke="#4d545c" stroke-width="10" stroke-linecap="round">
    <path d="M60 256h46M406 256h46M256 60v46M256 406v46"/>
  </g>
  <circle cx="256" cy="256" r="44" fill="#ffb000"/>
</svg>
```

- [ ] **Step 2: Render the PNG icons**

Maskable icons need their content inside a safe zone of 40% radius, so the maskable variant is the same mark scaled down with padding.

```bash
mkdir -p icons
magick -background none icons/mark.svg -resize 192x192 icons/icon-192.png
magick -background none icons/mark.svg -resize 512x512 icons/icon-512.png
magick -background none icons/mark.svg -resize 512x512 icons/apple-touch-icon.png
magick -background '#000000' icons/mark.svg -resize 358x358 \
       -gravity center -extent 512x512 icons/icon-maskable-512.png
ls -lh icons/
```

If `magick` is unavailable, `rsvg-convert -w 192 -h 192 icons/mark.svg -o icons/icon-192.png` is an equivalent substitute for the first three.

- [ ] **Step 3: Create `manifest.webmanifest`**

```json
{
  "name": "The Quantitative",
  "short_name": "Quantitative",
  "description": "A cabinet of instruments. Touch it with your thumb and numbers come out.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#000000",
  "theme_color": "#000000",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 4: Create `sw.js`**

```js
// @ts-nocheck
// Service worker. Classic script — importScripts is unavailable in module
// workers, and classic worker support is the more uniform of the two.
//
// The CACHE_VERSION line below is rewritten by tools/build_sw.py on every
// deploy. That matters: the browser detects a service worker update by
// byte-comparing this file, so if only sw-manifest.js changed, an unmodified
// sw.js would never trigger one and the fix would never reach anybody.
const CACHE_VERSION = 'dev'; // build_sw.py rewrites this line

const CACHE = `tq-${CACHE_VERSION}`;

importScripts('./sw-manifest.js');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(self.PRECACHE.map((entry) => entry.url))
    )
  );
  // Deliberately no skipWaiting() here — the new worker waits until the user
  // taps the update pill. A silent takeover mid-measurement is a betrayal.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('tq-') && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Cache-first. Everything is precached and the site makes no network calls,
  // so a cache miss means a genuinely new asset; falling through to the network
  // and storing the result keeps a partially-updated cache self-healing.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html'));
    })
  );
});
```

- [ ] **Step 5: Write the failing test for the manifest generator**

Create `tools/test_build_sw.py`:

```python
"""Tests for build_sw.py — the deploy-time precache manifest generator."""
import shutil
import tempfile
import unittest
from pathlib import Path

from build_sw import build, collect_files, file_revision

SW_TEMPLATE = "const CACHE_VERSION = 'dev'; // build_sw.py rewrites this line\n"


class BuildSwTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / "js").mkdir()
        (self.root / "docs").mkdir()
        (self.root / "index.html").write_text("<!DOCTYPE html>")
        (self.root / "js" / "app.js").write_text("export {}")
        (self.root / "sw.js").write_text(SW_TEMPLATE)
        (self.root / "docs" / "notes.md").write_text("not shipped")

    def tearDown(self):
        shutil.rmtree(self.root)

    def test_collects_shipped_files(self):
        urls = {f.url for f in collect_files(self.root)}
        self.assertIn("/index.html", urls)
        self.assertIn("/js/app.js", urls)

    def test_excludes_non_shipped_directories(self):
        urls = {f.url for f in collect_files(self.root)}
        self.assertNotIn("/docs/notes.md", urls)

    def test_never_precaches_the_worker_or_its_own_output(self):
        urls = {f.url for f in collect_files(self.root)}
        self.assertNotIn("/sw.js", urls)
        self.assertNotIn("/sw-manifest.js", urls)

    def test_revision_changes_when_content_changes(self):
        path = self.root / "js" / "app.js"
        before = file_revision(path)
        path.write_text("export const changed = 1")
        self.assertNotEqual(before, file_revision(path))

    def test_revision_is_stable_for_identical_content(self):
        path = self.root / "js" / "app.js"
        self.assertEqual(file_revision(path), file_revision(path))

    def test_build_writes_manifest_with_urls_and_revisions(self):
        build(self.root)
        out = (self.root / "sw-manifest.js").read_text()
        self.assertIn("self.PRECACHE", out)
        self.assertIn("/index.html", out)
        self.assertIn("self.PRECACHE_VERSION", out)

    def test_build_rewrites_the_cache_version_line_in_sw(self):
        build(self.root)
        sw = (self.root / "sw.js").read_text()
        self.assertNotIn("'dev'", sw)
        self.assertIn("build_sw.py rewrites this line", sw)

    def test_version_changes_when_any_shipped_file_changes(self):
        build(self.root)
        first = (self.root / "sw.js").read_text()
        (self.root / "js" / "app.js").write_text("export const changed = 1")
        build(self.root)
        self.assertNotEqual(first, (self.root / "sw.js").read_text())

    def test_version_is_reproducible_for_unchanged_input(self):
        build(self.root)
        first = (self.root / "sw.js").read_text()
        build(self.root)
        self.assertEqual(first, (self.root / "sw.js").read_text())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd tools && python3 -m unittest test_build_sw -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'build_sw'`

- [ ] **Step 7: Write `tools/build_sw.py`**

```python
#!/usr/bin/env python3
"""Generate the service worker precache manifest.

Emits sw-manifest.js (a content-hashed list of every shipped asset) and rewrites
the CACHE_VERSION line inside sw.js.

Rewriting sw.js is the point of the exercise: browsers detect a service worker
update by byte-comparing that file. Change sw-manifest.js alone and an
unmodified sw.js never triggers an update, so the fix never reaches anybody.

Run from the repo root, or pass a root: ./tools/build_sw.py [root]
"""
from __future__ import annotations

import hashlib
import re
import sys
from dataclasses import dataclass
from pathlib import Path

# Directories that exist for development and never ship.
EXCLUDED_DIRS = {
    ".git", ".claude", ".superpowers", "node_modules",
    "docs", "tests", "tools", "archive", "__pycache__",
}

# Files that must never be precached. sw.js is fetched by the browser directly
# and must stay uncached or updates stall; sw-manifest.js is this script's own
# output and is imported by sw.js, not fetched by the page.
EXCLUDED_FILES = {"sw.js", "sw-manifest.js"}

EXCLUDED_SUFFIXES = {".md", ".py", ".sh", ".json5"}
EXCLUDED_EXACT = {
    "package.json", "package-lock.json", "jsconfig.json", ".deployignore", ".gitignore",
}

VERSION_LINE = re.compile(r"^const CACHE_VERSION = '[^']*';.*$", re.MULTILINE)


@dataclass(frozen=True)
class Asset:
    url: str
    rev: str


def file_revision(path: Path) -> str:
    """First 12 hex characters of the file's SHA-256."""
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return digest[:12]


def collect_files(root: Path) -> list[Asset]:
    assets: list[Asset] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if any(part in EXCLUDED_DIRS for part in rel.parts):
            continue
        if path.name in EXCLUDED_FILES or path.name in EXCLUDED_EXACT:
            continue
        if path.suffix in EXCLUDED_SUFFIXES:
            continue
        if path.name.startswith("STATUS-"):
            continue
        assets.append(Asset(url="/" + rel.as_posix(), rev=file_revision(path)))
    return assets


def manifest_version(assets: list[Asset]) -> str:
    """A single hash over every url+rev pair — changes iff any shipped file changes."""
    joined = "\n".join(f"{a.url}:{a.rev}" for a in assets)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:12]


def render_manifest(assets: list[Asset], version: str) -> str:
    entries = ",\n".join(f'  {{ url: "{a.url}", rev: "{a.rev}" }}' for a in assets)
    return (
        "// GENERATED by tools/build_sw.py — do not edit.\n"
        f'self.PRECACHE_VERSION = "{version}";\n'
        f"self.PRECACHE = [\n{entries}\n];\n"
    )


def build(root: Path) -> str:
    assets = collect_files(root)
    version = manifest_version(assets)

    (root / "sw-manifest.js").write_text(render_manifest(assets, version), encoding="utf-8")

    sw_path = root / "sw.js"
    sw = sw_path.read_text(encoding="utf-8")
    replacement = f"const CACHE_VERSION = '{version}'; // build_sw.py rewrites this line"
    updated, count = VERSION_LINE.subn(replacement, sw, count=1)
    if count != 1:
        raise SystemExit("build_sw: could not find the CACHE_VERSION line in sw.js")
    sw_path.write_text(updated, encoding="utf-8")

    print(f"build_sw: {len(assets)} assets, version {version}")
    return version


if __name__ == "__main__":
    build(Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd())
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd tools && python3 -m unittest test_build_sw -v`
Expected: PASS — 9 tests, 0 failures.

- [ ] **Step 9: Generate the manifest and confirm the payload budget**

```bash
python3 tools/build_sw.py
du -ch $(node -e "
  const m = require('fs').readFileSync('sw-manifest.js','utf8');
  console.log([...m.matchAll(/url: \"([^\"]+)\"/g)].map(x => '.' + x[1]).join(' '))
") | tail -1
```

Expected: total under 200 KB. If it is over, the font subset is the first thing to check.

- [ ] **Step 10: Commit**

```bash
git add manifest.webmanifest icons/ sw.js tools/build_sw.py tools/test_build_sw.py
git commit -m "feat: PWA manifest, icons, and content-hashed service worker"
```

---

## Task 12: Install coach and update pill

**Files:**
- Create: `js/install.js`, `js/update.js`
- Modify: `js/app.js` — import and start both

**Interfaces:**
- Consumes: `readEnv`/`isIosSafari` (Task 4), `el` (Task 8)
- Produces:
  - `js/install.js`: `startInstallCoach(win: Window) => void`
  - `js/update.js`: `startUpdateWatch(win: Window) => void`

- [ ] **Step 1: Write `js/install.js`**

```js
// @ts-check
import { readEnv, isIosSafari } from './capability.js'
import { el } from './util.js'

const DISMISS_KEY = 'tq:install:dismissed'

/** @param {Window} win */
function alreadyInstalled(win) {
  return win.matchMedia('(display-mode: standalone)').matches
    || /** @type {any} */ (win.navigator).standalone === true
}

/** @param {Window} win */
function dismissed(win) {
  try { return win.localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}

/**
 * @param {Window} win
 * @param {(Node|string)[]} content
 * @param {HTMLElement} [primary]
 */
function sheet(win, content, primary) {
  const dismiss = el('button', { class: 'sheet__dismiss', type: 'button' }, ['Not now'])
  const node = el('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Install' },
    [...content, ...(primary ? [primary] : []), dismiss])
  dismiss.addEventListener('click', () => {
    try { win.localStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode */ }
    node.remove()
  })
  win.document.body.append(node)
  return node
}

/**
 * Android fires beforeinstallprompt; iOS fires nothing and requires the user to
 * perform the Share → Add to Home Screen gesture themselves, so it gets drawn
 * instructions instead. Dismissed once, remembered forever.
 *
 * @param {Window} win
 */
export function startInstallCoach(win) {
  if (alreadyInstalled(win) || dismissed(win)) return

  win.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    const deferred = /** @type {any} */ (event)
    const button = el('button', { class: 'arm__button', type: 'button' }, ['Install'])
    const node = sheet(win, [el('p', {}, ['Install The Quantitative for offline use.'])], button)
    button.addEventListener('click', async () => {
      node.remove()
      deferred.prompt()
      await deferred.userChoice
    }, { once: true })
  })

  if (isIosSafari(readEnv())) {
    sheet(win, [
      el('p', {}, ['Add to your home screen: tap the Share button, then ']),
      el('strong', {}, ['Add to Home Screen']),
      el('p', { class: 'card__reason' }, ['Runs full-screen and works with no signal.']),
    ])
  }
}
```

- [ ] **Step 2: Write `js/update.js`**

```js
// @ts-check
import { el } from './util.js'

/**
 * Register the worker and surface a tap-to-reload pill when a new version is
 * waiting. Never reloads on its own — a silent reload mid-measurement discards
 * whatever the user was reading.
 *
 * @param {Window} win
 */
export function startUpdateWatch(win) {
  if (!('serviceWorker' in win.navigator)) return

  win.navigator.serviceWorker.register('/sw.js').then((reg) => {
    /** @param {ServiceWorker|null} worker */
    const watch = (worker) => {
      if (!worker) return
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && win.navigator.serviceWorker.controller) offer(worker)
      })
    }

    if (reg.waiting && win.navigator.serviceWorker.controller) offer(reg.waiting)
    reg.addEventListener('updatefound', () => watch(reg.installing))
  }).catch(() => { /* registration failed — the site still works, just online-only */ })

  let reloading = false
  win.navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    win.location.reload()
  })

  /** @param {ServiceWorker} worker */
  function offer(worker) {
    if (win.document.querySelector('[data-update-pill]')) return
    const button = el('button', { class: 'arm__button', type: 'button' }, ['Reload'])
    const pill = el('div', { class: 'sheet', 'data-update-pill': '', role: 'status' }, [
      el('p', {}, ['New version available.']),
      button,
    ])
    button.addEventListener('click', () => worker.postMessage('skip-waiting'), { once: true })
    win.document.body.append(pill)
  }
}
```

- [ ] **Step 3: Wire both into `js/app.js`**

Add to the imports at the top:

```js
import { startInstallCoach } from './install.js'
import { startUpdateWatch } from './update.js'
```

And add at the very bottom of the file, after the `pagehide` listener:

```js
startUpdateWatch(window)
startInstallCoach(window)
```

- [ ] **Step 4: Run the full gate**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/install.js js/update.js js/app.js
git commit -m "feat: install coach and non-silent update pill"
```

---

## Task 13: Browser smoke harness, nginx headers, and deploy

**Files:**
- Create: `tests/smoke.html`, `deploy.sh`
- Modify: `_server-configs/nginx/vultr-2024` (the `thequantitative.com` server block, lines 184–211)

**Interfaces:**
- Consumes: everything
- Produces: `./deploy.sh` — the single command that ships the site

- [ ] **Step 1: Create `tests/smoke.html`**

Covers what node cannot: real module loading, the router against a real `location`, and shelf rendering. PASS/FAIL lands in `<title>`, matching the `timbeach.com/tests/searchtest.html` pattern.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>RUNNING</title>
</head>
<body>
<pre id="out"></pre>
<script type="module">
const results = []
const check = (name, fn) => {
  try { fn(); results.push(['PASS', name]) }
  catch (err) { results.push(['FAIL', `${name} — ${err.message}`]) }
}

const { parseRoute, hrefFor } = await import('/js/router.js')
const { REGISTRY, findEntry } = await import('/js/registry.js')
const { readEnv, detectCapabilities } = await import('/js/capability.js')
const { escapeHtml } = await import('/js/util.js')

check('every module loads over HTTP with real MIME types', () => {
  if (typeof parseRoute !== 'function') throw new Error('router missing')
  if (typeof findEntry !== 'function') throw new Error('registry missing')
  if (typeof escapeHtml !== 'function') throw new Error('util missing')
})

check('router resolves the shelf and an instrument', () => {
  if (parseRoute('#/').name !== 'shelf') throw new Error('shelf')
  if (parseRoute('#/i/level').name !== 'instrument') throw new Error('instrument')
})

check('registry is non-empty and hrefs round-trip', () => {
  if (REGISTRY.length === 0) throw new Error('registry empty')
  for (const e of REGISTRY) {
    if (parseRoute(hrefFor({ name: 'instrument', id: e.id })).name !== 'instrument') {
      throw new Error(`bad id ${e.id}`)
    }
  }
})

check('capability detection runs against the real browser', () => {
  const caps = detectCapabilities(readEnv())
  for (const key of ['motion', 'microphone', 'wakelock']) {
    if (!['available', 'needs-permission', 'unavailable'].includes(caps[key])) {
      throw new Error(`bad state for ${key}: ${caps[key]}`)
    }
  }
})

for (const entry of REGISTRY) {
  try {
    const mod = await entry.load()
    const inst = mod.default
    if (inst.id !== entry.id) throw new Error(`id mismatch: ${inst.id} vs ${entry.id}`)
    if (typeof inst.mount !== 'function') throw new Error('mount is not a function')
    results.push(['PASS', `instrument ${entry.id} loads and matches its registry entry`])
  } catch (err) {
    results.push(['FAIL', `instrument ${entry.id} — ${err.message}`])
  }
}

const failed = results.filter(([s]) => s === 'FAIL')
document.getElementById('out').textContent =
  results.map(([s, n]) => `${s} ${n}`).join('\n')
document.title = failed.length === 0 ? `PASS ${results.length}` : `FAIL ${failed.length}`
</script>
</body>
</html>
```

- [ ] **Step 2: Run the smoke harness headless**

```bash
python3 -m http.server 8000 >/dev/null 2>&1 &
SERVER=$!
sleep 1
chromium --headless --disable-gpu --virtual-time-budget=4000 \
  --dump-dom http://localhost:8000/tests/smoke.html 2>/dev/null \
  | grep -o '<title>[^<]*</title>'
kill $SERVER
```

Expected: `<title>PASS 5</title>`. Any `FAIL` must be fixed before continuing.

- [ ] **Step 3: Add the nginx headers for PWA correctness**

In `_server-configs/nginx/vultr-2024`, replace the `location / { try_files ... }` block inside the `thequantitative.com` server (currently lines 195–197) with:

```nginx
    location / {
        try_files $uri $uri/ =404;
    }

    # The service worker must never be served stale, or a shipped fix can sit
    # behind a cached worker for as long as the max-age.
    location = /sw.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        expires off;
    }

    location = /sw-manifest.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        expires off;
    }

    location = /manifest.webmanifest {
        types { } default_type application/manifest+json;
        add_header Cache-Control "no-cache";
    }

    # Content-addressed by the precache manifest, so a long max-age is safe.
    location ~* \.(woff2|png|svg)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
```

Apply it on the server, validating before reloading:

```bash
scp _server-configs/nginx/vultr-2024 vultr:/tmp/vultr-2024
ssh vultr 'sudo cp /tmp/vultr-2024 /etc/nginx/sites-available/vultr-2024 && sudo nginx -t && sudo systemctl reload nginx'
```

Expected: `nginx: configuration file /etc/nginx/nginx.conf test is successful` before any reload happens. If `nginx -t` fails, the `&&` chain stops and nothing is reloaded.

- [ ] **Step 4: Create `deploy.sh`**

```sh
#!/bin/sh
set -e

# Gate 1 — types. tsc emits nothing; it is a linter for JSDoc annotations.
echo "→ type checking"
npm run --silent types

# Gate 2 — unit tests. The numbers are the product, so they are tested.
echo "→ unit tests (node)"
# Bare `node --test` auto-discovers test files and skips node_modules. Passing
# a directory (`node --test tests/`) fails on Node 22+ — it resolves the path
# as a module, not a directory.
node --test

echo "→ unit tests (python)"
(cd tools && python3 -m unittest discover -p 'test_*.py' -q)

# Gate 3 — regenerate the precache manifest and stamp sw.js. Must run after the
# tests and before rsync so the shipped hashes match the shipped bytes.
echo "→ generating service worker manifest"
python3 tools/build_sw.py

# Exclusions live in .deployignore (single source of truth — keep it current).
echo "→ deploying"
rsync -vhrla --exclude-from="$PWD/.deployignore" "$PWD/" vultr:/var/www/thequantitative.com

echo "✓ https://thequantitative.com/"
```

```bash
chmod +x deploy.sh
```

- [ ] **Step 5: Verify the gates actually gate**

```bash
# A deliberate type error must abort before rsync.
printf '\n/** @type {number} */\nexport const broken = "not a number"\n' >> js/util.js
./deploy.sh && echo "BUG: deploy succeeded with a type error" || echo "OK: deploy aborted"
git checkout js/util.js
```

Expected: `OK: deploy aborted`. A green run here would mean the pipeline ships broken code.

- [ ] **Step 6: Deploy**

Run: `./deploy.sh`
Expected: all gates pass, rsync completes, final line prints the URL.

- [ ] **Step 7: Verify the live site**

```bash
curl -sfI https://thequantitative.com/ | head -1
curl -sf  https://thequantitative.com/manifest.webmanifest | head -3
curl -sfI https://thequantitative.com/sw.js | grep -i cache-control
curl -sf  https://thequantitative.com/sw-manifest.js | head -2
```

Expected: `200 OK` for the page; valid JSON from the manifest; `no-cache, no-store, must-revalidate` on `sw.js`; and a `PRECACHE_VERSION` that is not `dev`.

- [ ] **Step 8: Commit**

```bash
git add tests/smoke.html deploy.sh
git commit -m "feat: browser smoke harness and deploy pipeline"
```

Note: `_server-configs/nginx/vultr-2024` lives in the parent `sites/` directory, **outside this repository**. Commit it there separately if that directory is version-controlled; otherwise the edit stands on its own as the local record of what was applied to the server.

---

## Task 14: On-device verification and accent selection

The only task that cannot be automated, and the one v0 exists to perform. Everything above is a prediction until this runs.

**Files:**
- Modify: `css/site.css` (the `--signal` token), `docs/superpowers/specs/2026-07-28-thequantitative-cabinet-design.md` (§6 capability matrix)
- Create: `docs/device-notes-2026-07-28.md`

- [ ] **Step 1: Verify the Spirit Level on Android Chrome**

Open `https://thequantitative.com/` on the Android phone and confirm each of:

1. The shelf renders, the Spirit Level card is **enabled** (not dimmed).
2. Tapping it goes straight to the instrument — Android grants motion without a prompt.
3. Phone flat on a table → both readouts within ±1.0° of zero, bubble centred.
4. **Raising the top edge gives a positive pitch.** If negative, `normaliseGravity` has the sign backwards for this platform — fix it in `js/ctx.js` and re-run `tests/ctx-sign.test.js`.
5. **Raising the right edge gives a positive roll.** Same remedy if reversed.
6. Digits do not shift horizontally as they change (tabular figures working).
7. Zero is slashed.
8. "Tap to zero" zeroes both axes; reloading the page preserves the zero.
9. The screen does not sleep while the instrument is open.

- [ ] **Step 2: Verify on iOS Safari**

1. The Spirit Level card is enabled.
2. Tapping it shows the **arm screen** with an "Enable motion" button — it must *not* go straight to the instrument.
3. Tapping the button raises the native iOS permission dialog.
4. Granting it mounts the instrument; **pitch and roll signs match Android**. A mismatch means `isIosSafari` is not matching, or the iOS negation assumption is wrong.
5. Declining shows the denial screen with the Settings → Apps → Safari → Motion & Orientation Access instructions.
6. The install sheet appears with the Share → Add to Home Screen instructions.
7. After installing: launches full-screen with **no white flash**, and the content clears the notch and home indicator.

- [ ] **Step 3: Verify offline operation on both devices**

Load the site, then enable aeroplane mode and force-quit and relaunch the installed app.
Expected: the shelf and the Spirit Level both work completely. Any network request at all is a bug.

- [ ] **Step 4: Choose the accent colour on real hardware**

With the Spirit Level open on the phone, in normal indoor light and then in bright daylight, try each candidate:

```bash
# Edit css/site.css, change the --signal token, then:
./deploy.sh
```

Candidates: amber `#ffb000`, green `#00e08a`, cyan `#38bdf8`. Judge on: legibility of the readout at a glance, how the bubble reads against pure black, and whether it looks like a *device* rather than a web app. Set the winner in `css/site.css` and in `icons/mark.svg`, then re-render the icons per Task 11 Step 2.

- [ ] **Step 5: Record the findings**

Write `docs/device-notes-2026-07-28.md` with, for each device: model, OS version, browser version, every check above marked pass or fail, and any deviation from the §6 capability matrix. Then correct §6 of the spec wherever hardware disagreed with the prediction — the matrix was compiled from documentation and this is the first time it meets reality.

- [ ] **Step 6: Commit**

```bash
git add css/site.css icons/ docs/
git commit -m "feat: accent colour selected on-device; capability matrix corrected against hardware"
```

---

## Amendments to the spec made by this plan

1. **§10 — the staging vhost is dropped for v0.** `staging.thequantitative.com` needs a DNS record *and* a `certbot --expand` on the shared `aegixlinux.com-0002` certificate. It protects nothing right now, because the site is a dead placeholder. v0 deploys straight to production for the real HTTPS/service-worker/install loop. When there is something worth protecting, a `/_staging/` path gives an isolated service-worker scope with no DNS or certificate work at all.

2. **§5.4 — `ctx.audio()` and `ctx.mic()` are deferred to v1.** No v0 instrument uses audio, and building the plumbing before the Sound Level exists would be untested speculation. `ctx.motion`, `ctx.raf`, `ctx.on`, `ctx.signal`, `ctx.store` and `ctx.wakeLock` ship now.

3. **New, not in the spec: `normaliseGravity`.** `accelerationIncludingGravity` is sign-inverted on iOS relative to Android. The spec did not mention it and it would have produced a Spirit Level that reads backwards on one platform. `js/ctx.js` is now the single place platform sign is handled, and Task 14 Steps 1–2 verify the assumption against both devices.

## Self-review

**Spec coverage.** §1 thesis → Tasks 8, 10. §4.1 colour → Task 7 + Task 14 Step 4. §4.2 type → Task 7 Steps 1–2. §4.3 layout → Task 7 Step 4. §4.4 ballistics → Task 2 (`alphaFor`), Task 10 (`TAU`). §5.1 no-build + JSDoc → Task 1. §5.2 routes → Task 5. §5.3 contract → Tasks 8, 10. §5.4 `ctx` → Task 6 (audio/mic deferred, amendment 2). §5.5 permissions → Task 9. §5.6 registry → Task 8. §6 capability matrix → Task 4, verified Task 14. §7 PWA → Tasks 11, 12. §9 v0 scope → all. §10 testing → Tasks 2–5, 11, 13. §11 deploy → Task 13. §12 file layout → matches. §13 accent decision → Task 14 Step 4.

**Not in v0, by design:** every instrument other than the Spirit Level; `dsp/pitch.js`; `stats/`; the `#/about` route is a stub rather than a full colophon.

**Type consistency.** `Ctx` as defined in Task 1 is exactly what Task 6 constructs and Task 10 consumes — `raf`, `on`, `motion`, `signal`, `store`, `wakeLock`. `Store` is `{get, set}` throughout. `RegistryEntry` in Task 1 matches Task 8's `REGISTRY` literal field-for-field. `gravityToTilt`/`alphaFor`/`lowPassVec`/`applyCalibration` are named identically in Tasks 2, 6 and 10. `parseRoute`/`hrefFor`/`createRouter` identical in Tasks 5, 8 and 13. `requireCapabilities` identical in Tasks 8 and 9. `readEnv`/`detectCapabilities`/`isIosSafari`/`unavailableReason` identical in Tasks 4, 8, 9 and 12.
