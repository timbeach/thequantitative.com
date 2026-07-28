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
