// @ts-check

/**
 * First-order low-pass coefficient. Frame-rate independent: derived from the
 * actual elapsed time rather than assuming a fixed interval, so the damping
 * feels identical whether samples arrive at 60 Hz or 30 Hz.
 *
 * Shared because every instrument on this site damps its readout — real meters
 * have ballistics, and the standards specify them (IEC 61672-1 gives 125 ms for
 * "fast" and 1 s for "slow" sound level weighting).
 *
 * @param {number} dt seconds elapsed since the previous sample
 * @param {number} tau time constant in seconds — larger is slower and steadier
 * @returns {number} coefficient in [0, 1]
 */
export function alphaFor(dt, tau) {
  if (tau <= 0) return 1
  return 1 - Math.exp(-dt / tau)
}
