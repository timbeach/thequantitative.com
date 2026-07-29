// @ts-check
/** @typedef {import('../js/types.js').Vec3} Vec3 */
/** @typedef {import('../js/types.js').Tilt} Tilt */

// alphaFor now lives in dsp/smoothing.js — every instrument damps its readout,
// so it is not tilt-specific. Re-exported here so existing importers are
// unaffected; tilt's own tests cover that this move changed nothing.
export { alphaFor } from './smoothing.js'

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
 * @param {Vec3} g gravity vector (accelerometer specific force), any magnitude
 * @returns {Tilt} degrees. pitch > 0 = top edge raised. roll > 0 = right edge raised.
 */
export function gravityToTilt(g) {
  return {
    pitch: Math.atan2(g.y, Math.hypot(g.x, g.z)) * RAD_TO_DEG,
    roll: Math.atan2(g.x, g.z) * RAD_TO_DEG,
  }
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
