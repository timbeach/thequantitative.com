// @ts-check

/** Standard gravity, m/s². */
const G = 9.81

/**
 * @typedef {Object} Jump
 * @property {number} hangMs airborne time in milliseconds
 * @property {number} heightM jump height in metres
 * @property {number} uncertaintyM ± metres, from the observed sample interval
 */

/**
 * @typedef {Object} DetectorOptions
 * @property {number} [freefall] |a| below this is free fall, m/s². Default 3.
 * @property {number} [launch] |a| above this is a push-off, m/s². Default 13.
 * @property {number} [land] |a| above this is a landing, m/s². Default 13.
 * @property {number} [minMs] shortest credible hang. Default 120.
 * @property {number} [maxMs] longest credible hang. Default 1200.
 * @property {number} [launchWindowMs] free fall must begin within this long
 *   after the push-off, else it is a drop rather than a jump. Default 400.
 */

/**
 * Height from hang time alone.
 *
 * In flight the phone is in free fall, so the airborne interval is directly
 * measurable. Total flight t = 2·t_up; at the apex v = 0, so t_up = v₀/g and
 * h = v₀²/(2g). Substituting v₀ = g·t/2 gives h = g·t²/8.
 *
 * @param {number} hangSeconds
 * @returns {number} metres
 */
export function heightFromHang(hangSeconds) {
  return (G * hangSeconds * hangSeconds) / 8
}

/**
 * Measurement uncertainty from the sampling interval.
 *
 * devicemotion fires at roughly 60 Hz, so hang time is quantised. Since
 * dh/dt = g·t/4, a 31 cm jump sampled at 60 Hz carries about ±2 cm. Reporting
 * the height without this would overstate what the instrument actually knows.
 *
 * @param {number} hangSeconds
 * @param {number} sampleIntervalSeconds
 * @returns {number} ± metres
 */
export function heightUncertainty(hangSeconds, sampleIntervalSeconds) {
  return ((G * hangSeconds) / 4) * sampleIntervalSeconds
}

/**
 * A jump detector.
 *
 * Requires the full ordered signature — push-off, then free fall promptly
 * after it, then a landing — because any weaker test produces false jumps.
 * Waving gives free fall with no push-off; shaking gives spikes with no free
 * fall; and dropping the phone gives free fall plus an impact, which without
 * the launch window would read as an excellent jump.
 *
 * @param {DetectorOptions} [opts]
 * @returns {(magnitude: number, tMs: number) => Jump | null} feed it |a| in
 *   m/s² with a timestamp; returns a Jump on the frame a jump completes
 */
export function createJumpDetector(opts = {}) {
  const freefall = opts.freefall ?? 3
  const launch = opts.launch ?? 13
  const land = opts.land ?? 13
  const minMs = opts.minMs ?? 120
  const maxMs = opts.maxMs ?? 1200
  const launchWindowMs = opts.launchWindowMs ?? 400

  let airborne = false
  let startMs = 0
  let sawLaunch = false
  let launchMs = 0
  let lastMs = 0
  let intervalMs = 1000 / 60      // running estimate of the true sample rate

  return function feed(magnitude, tMs) {
    if (lastMs !== 0) {
      const gap = tMs - lastMs
      if (gap > 0 && gap < 200) intervalMs += 0.1 * (gap - intervalMs)
    }
    lastMs = tMs

    if (!airborne) {
      if (magnitude > launch) {
        // A landing that rings re-arms sawLaunch here, but it cannot produce a
        // second Jump: another free-fall interval of credible length would have
        // to follow, and a ringing impact never goes quiet for 120 ms.
        sawLaunch = true
        launchMs = tMs
      } else if (magnitude < freefall) {
        if (sawLaunch && tMs - launchMs <= launchWindowMs) {
          airborne = true
          startMs = tMs
        } else {
          // Free fall with no recent push-off is a drop, not a jump.
          sawLaunch = false
        }
      }
      return null
    }

    const hangMs = tMs - startMs

    if (magnitude > land) {
      airborne = false
      sawLaunch = false
      if (hangMs >= minMs && hangMs <= maxMs) {
        const hangSeconds = hangMs / 1000
        return {
          hangMs,
          heightM: heightFromHang(hangSeconds),
          uncertaintyM: heightUncertainty(hangSeconds, intervalMs / 1000),
        }
      }
      return null
    }

    if (hangMs > maxMs) { airborne = false; sawLaunch = false }
    return null
  }
}
