// @ts-check
import { createScope } from './scope.js'
import { readEnv, isIos } from './capability.js'

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

  const iosSigns = isIos(readEnv())

  /** @type {any} */
  let sentinel = null
  let pending = false
  let wired = false

  /** @type {AudioContext | null} */
  let audioCtx = null
  /** @type {Promise<MediaStreamAudioSourceNode> | null} */
  let micPromise = null
  /** @type {Promise<{ latitude:number, longitude:number, accuracyM:number }> | null} */
  let locationPromise = null

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

    audio() {
      if (audioCtx) return audioCtx
      const Ctor = /** @type {any} */ (win).AudioContext || /** @type {any} */ (win).webkitAudioContext
      audioCtx = new Ctor()
      scope.add(() => { audioCtx?.close().catch(() => {}); audioCtx = null })
      return /** @type {AudioContext} */ (audioCtx)
    },

    mic() {
      if (micPromise) return micPromise
      const audio = this.audio()

      // An AudioContext starts suspended until a user gesture. The arm screen
      // guarantees one has happened before mount(), so resuming here is safe —
      // but it must be explicit or every reading is silence.
      micPromise = audio.resume()
        .catch(() => {})
        .then(() => win.navigator.mediaDevices.getUserMedia({
          // CRITICAL: these three are ON by default and each destroys the
          // measurement. Automatic gain control normalises loudness, which is
          // precisely the quantity being measured; noise suppression and echo
          // cancellation subtract signal the meter is supposed to report.
          audio: {
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false,
          },
        }))
        .then((stream) => {
          scope.add(() => stream.getTracks().forEach((t) => t.stop()))
          return audio.createMediaStreamSource(stream)
        })

      return micPromise
    },

    location() {
      if (locationPromise) return locationPromise
      locationPromise = new Promise((resolve, reject) => {
        // No high accuracy: a kilometre of position error moves the sky by
        // under a hundredth of a degree, so the accuracy is not worth the
        // battery or the time. The timeout keeps a fixless device from
        // hanging this promise forever.
        win.navigator.geolocation.getCurrentPosition(
          (pos) => resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracyM: pos.coords.accuracy,
          }),
          reject,
          { timeout: 15000, enableHighAccuracy: false },
        )
      })
      return locationPromise
    },

    orientation(fn) {
      // Chrome/Android fires 'deviceorientationabsolute' as a separate,
      // continuous event stream alongside plain 'deviceorientation' (whose
      // alpha there is relative, not absolute). Once that stream has been
      // seen, it is treated as authoritative and the relative stream is
      // ignored — otherwise the heading would flicker to null and back every
      // other frame as the two events interleave.
      let sawAbsoluteStream = false

      /** @param {any} e */
      const emitFrom = (e) => {
        const beta = typeof e.beta === 'number' ? e.beta : null
        const gamma = typeof e.gamma === 'number' ? e.gamma : null
        const screenAngle = /** @type {any} */ (win).screen?.orientation?.angle ?? 0

        // Only an absolute reference is worth reporting as alpha — a relative
        // alpha is relative to wherever the page happened to start and
        // drifts, so it would confidently point at the wrong sky.
        const compass = e.webkitCompassHeading
        if (typeof compass === 'number') {
          fn({
            alpha: 360 - compass,
            beta,
            gamma,
            absolute: true,
            screenAngle,
            accuracyDeg: e.webkitCompassAccuracy ?? null,
          })
          return
        }
        if (e.absolute === true && typeof e.alpha === 'number') {
          fn({ alpha: e.alpha, beta, gamma, absolute: true, screenAngle, accuracyDeg: null })
          return
        }
        fn({ alpha: null, beta, gamma, absolute: false, screenAngle, accuracyDeg: null })
      }

      scope.on(win, 'deviceorientationabsolute', (/** @type {Event} */ event) => {
        sawAbsoluteStream = true
        emitFrom(/** @type {any} */ (event))
      })
      scope.on(win, 'deviceorientation', (/** @type {Event} */ event) => {
        if (sawAbsoluteStream) return
        emitFrom(/** @type {any} */ (event))
      })
    },
  }

  return { ctx, dispose: () => scope.dispose() }
}
