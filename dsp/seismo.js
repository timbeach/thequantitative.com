// @ts-check
/** @typedef {import('../js/types.js').Vec3} Vec3 */

import { alphaFor, lowPassVec } from './tilt.js'

/**
 * @typedef {Object} GravityReading
 * @property {Vec3} linear the input with gravity subtracted out, m/s²
 * @property {number} magnitude |linear|, m/s² — always ≥ 0
 */

/**
 * @typedef {Object} GravityFilterOptions
 * @property {number} [tau] time constant of the gravity estimate, seconds.
 * Default 0.8, which puts the high-pass corner near 0.2 Hz: footsteps and
 * doors (roughly 1-5 Hz) pass through, while deliberate tilting (well under
 * 0.2 Hz) is absorbed back into "gravity".
 */

/**
 * Separates linear acceleration from gravity.
 *
 * An accelerometer reports specific force, not linear acceleration — at rest
 * it reads ~9.81 m/s² straight up, not zero. A seismograph wants the part
 * that ISN'T gravity, so gravity is tracked as a slow low-pass of the raw
 * vector and subtracted off. What's left is linear acceleration.
 *
 * This separates gravity from motion by TIMESCALE, not by physics — the
 * equivalence principle means no measurement can tell a constant tilt from a
 * constant acceleration in principle. A slow deliberate tilt therefore does
 * leak through as "motion" here (see the corner-frequency test); that isn't
 * a bug to chase, it's the boundary of what an accelerometer can know.
 *
 * The gravity estimate is seeded from the FIRST sample rather than zero.
 * Seeding at zero would make the filter spend its first second convinced
 * gravity is absent, so linear acceleration would start at ~9.81 m/s² the
 * instant the instrument mounts — a phantom earthquake on arrival.
 *
 * @param {GravityFilterOptions} [opts]
 * @returns {(v: Vec3, dt: number) => GravityReading} feed it the raw
 *   accelerometer vector and the elapsed time since the previous sample
 */
export function createGravityFilter(opts = {}) {
  const tau = opts.tau ?? 0.8

  let seeded = false
  /** @type {Vec3} */
  let gravity = { x: 0, y: 0, z: 0 }

  return function feed(v, dt) {
    if (!seeded) {
      gravity = { x: v.x, y: v.y, z: v.z }
      seeded = true
    } else {
      gravity = lowPassVec(gravity, v, alphaFor(dt, tau))
    }

    const linear = { x: v.x - gravity.x, y: v.y - gravity.y, z: v.z - gravity.z }
    return { linear, magnitude: Math.hypot(linear.x, linear.y, linear.z) }
  }
}

/**
 * @typedef {Object} PeakHoldOptions
 * @property {number} [decayPerSecond] how fast the held peak falls back down
 * once the signal drops below it, in magnitude units per second. Default 2.
 */

/**
 * A peak-hold readout: jumps up instantly to a new maximum, then bleeds back
 * down at a steady rate rather than following the signal straight back down
 * — the ballistic behaviour a physical peak-hold meter has, so a brief spike
 * stays legible on screen instead of vanishing the frame after it happens.
 *
 * @param {PeakHoldOptions} [opts]
 * @returns {(magnitude: number, dt: number) => number} feed it the latest
 *   |linear acceleration| and the elapsed time; returns the held peak
 */
export function createPeakHold(opts = {}) {
  const decayPerSecond = opts.decayPerSecond ?? 2

  let peak = 0

  return function feed(magnitude, dt) {
    // The decayed floor can go negative; magnitude (≥0 by construction) is
    // always in the max(), so peak itself never does.
    peak = Math.max(magnitude, peak - decayPerSecond * dt)
    return peak
  }
}

/**
 * Root-mean-square — the noise-floor readout. RMS rather than a plain mean
 * because signed samples average toward zero regardless of how much energy
 * is in them; squaring before averaging makes both halves of the wave count.
 *
 * @param {ArrayLike<number>} samples
 * @returns {number} 0 for an empty input, never NaN
 */
export function rms(samples) {
  const n = samples.length
  if (n === 0) return 0

  let sumSq = 0
  for (let i = 0; i < n; i++) {
    const v = samples[i] ?? 0
    sumSq += v * v
  }
  return Math.sqrt(sumSq / n)
}
