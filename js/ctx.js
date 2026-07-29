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
  let pending = false
  let wired = false

  const acquire = () => {
    const wl = /** @type {any} */ (win.navigator).wakeLock
    if (!wl?.request) return
    if (pending || (sentinel && !sentinel.released)) return
    pending = true
    wl.request('screen')
      .then((/** @type {any} */ s) => {
        sentinel = s
        s.addEventListener?.('release', () => { sentinel = null })
      })
      .catch(() => { /* denied, or document not visible — degrade silently */ })
      .finally(() => { pending = false })
  }

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
      if (!wl?.request || wired) return
      wired = true

      scope.add(() => { sentinel?.release?.().catch(() => {}); sentinel = null })

      // The UA silently releases the lock whenever the document is hidden, and
      // leaves the sentinel object in place with released === true. Track the
      // release event instead of testing the sentinel for null, and register
      // this listener exactly once — the previous recursive form re-registered
      // it on every foreground, doubling listeners each cycle.
      scope.on(win.document, 'visibilitychange', () => {
        if (win.document.visibilityState === 'visible') acquire()
      })

      acquire()
    },
  }

  return { ctx, dispose: () => scope.dispose() }
}
