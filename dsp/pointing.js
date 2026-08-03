// @ts-check

/**
 * Full-orientation pointing maths for the Sky Pointer.
 *
 * The shipped-and-buggy version pointed the sky using a single heading
 * scalar (360 − alpha, or webkitCompassHeading) and threw away beta and
 * gamma. The W3C device-orientation convention is R = Rz(alpha)·Rx(beta)·
 * Ry(gamma), and that decomposition has a gimbal lock at beta = ±90° —
 * exactly the posture of holding a phone up toward the sky. There, a real
 * body rotation lands almost entirely in gamma, leaving alpha nearly
 * unchanged, so an alpha-only reading reports no movement while the true
 * aim swings up to 90 degrees.
 *
 * The rotation matrix itself has no singularity — only the Euler angle
 * decomposition does. So instead of reading a heading off alpha, this
 * module builds the full device→world matrix and transforms a pointing
 * vector through it, reading altitude and azimuth off the world-frame
 * result. That vector is a parameter rather than a constant so the same
 * maths serves both the back camera (POINT_BACK) and the screen face
 * (POINT_FRONT).
 *
 * This module is pure maths: no DOM, no clock, no globals. The screen
 * angle is passed in by the caller, which is the only place that knows
 * about window.screen.orientation.
 *
 * World frame: x = east, y = north, z = up. Azimuth is measured from
 * north toward east, matching dsp/astro.js's eqToAltAz output so the two
 * are directly comparable.
 */

const DEG2RAD = Math.PI / 180

/** @param {number} deg */
function toRad(deg) {
  return deg * DEG2RAD
}

/**
 * Device→world rotation matrix for W3C device-orientation angles, row-major
 * (index = row * 3 + col), following R = Rz(alpha)·Rx(beta)·Ry(gamma):
 *
 *   cA·cG − sA·sB·sG    −sA·cB    cA·sG + sA·sB·cG
 *   sA·cG + cA·sB·sG     cA·cB    sA·sG − cA·sB·cG
 *         −cB·sG           sB           cB·cG
 *
 * @param {number} alpha degrees
 * @param {number} beta degrees
 * @param {number} gamma degrees
 * @returns {number[]} 9 elements, row-major
 */
export function orientationMatrix(alpha, beta, gamma) {
  const a = toRad(alpha)
  const b = toRad(beta)
  const g = toRad(gamma)

  const cA = Math.cos(a), sA = Math.sin(a)
  const cB = Math.cos(b), sB = Math.sin(b)
  const cG = Math.cos(g), sG = Math.sin(g)

  return [
    cA * cG - sA * sB * sG, -sA * cB, cA * sG + sA * sB * cG,
    sA * cG + cA * sB * sG, cA * cB, sA * sG - cA * sB * cG,
    -cB * sG, sB, cB * cG,
  ]
}

/**
 * Multiply a row-major 3x3 matrix by a column vector.
 *
 * @param {number[]} m 9 elements, row-major
 * @param {[number, number, number]} v
 * @returns {[number, number, number]}
 */
export function applyMatrix(m, v) {
  const m0 = m[0] ?? 0, m1 = m[1] ?? 0, m2 = m[2] ?? 0
  const m3 = m[3] ?? 0, m4 = m[4] ?? 0, m5 = m[5] ?? 0
  const m6 = m[6] ?? 0, m7 = m[7] ?? 0, m8 = m[8] ?? 0
  const [x, y, z] = v
  return [
    m0 * x + m1 * y + m2 * z,
    m3 * x + m4 * y + m5 * z,
    m6 * x + m7 * y + m8 * z,
  ]
}

/**
 * Rotation about the world z axis by −screenAngle, correcting for a device
 * held in a rotated screen orientation (e.g. landscape).
 *
 * @param {number} screenAngleDeg
 * @returns {number[]} 9 elements, row-major
 */
export function screenCorrection(screenAngleDeg) {
  const s = toRad(-screenAngleDeg)
  const c = Math.cos(s), sn = Math.sin(s)
  return [
    c, -sn, 0,
    sn, c, 0,
    0, 0, 1,
  ]
}

/** @param {unknown} v */
function orZero(v) {
  return typeof v === 'number' && !Number.isNaN(v) ? v : 0
}

/** @param {number} deg */
function normalizeAz(deg) {
  return ((deg % 360) + 360) % 360
}

export const POINT_BACK = /** @type {[number, number, number]} */ ([0, 0, -1])
export const POINT_FRONT = /** @type {[number, number, number]} */ ([0, 0, 1])

/**
 * Transform a device-local pointing vector into world-frame altitude and
 * azimuth, given the device's full orientation.
 *
 * @param {{ alpha?: number, beta?: number, gamma?: number, screenAngle?: number }} o
 * @param {[number, number, number]} vector device-local pointing vector,
 *   e.g. POINT_BACK or POINT_FRONT
 * @returns {{ alt: number, az: number }}
 */
export function pointingDirection(o, vector) {
  const alpha = orZero(o.alpha)
  const beta = orZero(o.beta)
  const gamma = orZero(o.gamma)
  const screenAngle = orZero(o.screenAngle)

  const device = orientationMatrix(alpha, beta, gamma)
  const screen = screenCorrection(screenAngle)
  const w = applyMatrix(screen, applyMatrix(device, vector))

  const alt = Math.asin(Math.min(1, Math.max(-1, w[2]))) / DEG2RAD
  const az = normalizeAz(Math.atan2(w[0], w[1]) / DEG2RAD)

  return { alt, az }
}
