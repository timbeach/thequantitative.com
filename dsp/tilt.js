// @ts-check
/** @typedef {import('../js/types.js').Vec3} Vec3 */
/** @typedef {import('../js/types.js').Tilt} Tilt */

const RAD_TO_DEG = 180 / Math.PI

/**
 * Convert a gravity vector expressed in the device frame to pitch and roll.
 *
 * Device frame: +x points to the right edge of the screen, +y to the top edge,
 * +z out of the screen toward the user. Flat and screen-up therefore reads
 * approximately {x:0, y:0, z:+1} once normalised — see js/ctx.js, which is
 * responsible for normalising the platform sign difference before calling this.
 *
 * Only the direction of `g` matters; magnitude is divided out by atan2.
 *
 * @param {Vec3} g gravity vector, any magnitude
 * @returns {Tilt} degrees. pitch > 0 = top edge raised. roll > 0 = right edge raised.
 */
export function gravityToTilt(g) {
  return {
    pitch: Math.atan2(-g.y, Math.hypot(g.x, g.z)) * RAD_TO_DEG,
    roll: Math.atan2(-g.x, g.z) * RAD_TO_DEG,
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
