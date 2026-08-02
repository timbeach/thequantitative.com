// @ts-check
import { alphaFor } from './smoothing.js'

/** @typedef {{ name: string, sep: number }} StarCandidate */
/** @typedef {{ name: string, dwell: number }} StarLock */

/**
 * Signed shortest angular difference from `from` to `to`, in degrees.
 *
 * Azimuth wraps at 360°, so a plain subtraction is wrong at the boundary:
 * naive smoothing from 359° toward 1° would sweep the long way round, through
 * 180°, dragging the aim backwards across the entire sky. This is the
 * primitive every angular operation in this module goes through — including
 * the speed calculation, where a raw difference would report a phantom
 * ~21540°/s the instant the user pans across north.
 *
 * @param {number} from degrees
 * @param {number} to degrees
 * @returns {number} signed degrees in (-180, 180]
 */
export function shortestAngleDiff(from, to) {
  return ((to - from + 540) % 360) - 180
}

/**
 * Exponentially smooth an angle toward `next`, taking the shortest arc.
 *
 * @param {number} prev previous smoothed angle, degrees
 * @param {number} next target angle, degrees
 * @param {number} alpha smoothing coefficient in [0, 1] — see alphaFor
 * @returns {number} smoothed angle, renormalised into [0, 360)
 */
export function smoothAngle(prev, next, alpha) {
  const out = prev + alpha * shortestAngleDiff(prev, next)
  return ((out % 360) + 360) % 360
}

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * Create a stateful smoother for altitude/azimuth aim, with an adaptive time
 * constant: heavy damping (`tauStill`) while nearly motionless, light damping
 * (`tauMoving`) once sweeping faster than `sweepDegPerSec`, interpolated
 * between by angular speed. A fixed time constant is a bad trade — enough
 * smoothing to hold a star steady makes sweeping feel like dragging treacle.
 *
 * Altitude does not wrap, so it is smoothed directly, but with the SAME alpha
 * as azimuth — otherwise a diagonal sweep curves as the two axes fall out of
 * step.
 *
 * @param {{ tauStill?: number, tauMoving?: number, sweepDegPerSec?: number }} [opts]
 * @returns {(alt: number, az: number, dt: number) => { alt: number, az: number, speed: number }}
 */
export function createAimSmoother(opts = {}) {
  const { tauStill = 0.35, tauMoving = 0.05, sweepDegPerSec = 40 } = opts

  /** @type {number | null} */
  let prevAlt = null
  /** @type {number | null} */
  let prevAz = null
  // Speed measured on the PREVIOUS frame, used to pick THIS frame's tau. A
  // single sudden target jump (a still readout that abruptly gets a fast new
  // sample) must not be judged by that same jump — that would make an
  // instrument at rest react exactly like one already sweeping fast, on the
  // very first frame, defeating the whole point of the heavy/light split.
  // Ballistic meters have the same one-step memory: how fast the needle has
  // *been* moving governs how eagerly it responds next, not the size of the
  // sample that just arrived.
  let prevSpeed = 0

  return function step(alt, az, dt) {
    if (prevAlt === null || prevAz === null) {
      prevAlt = alt
      prevAz = az
      prevSpeed = 0
      return { alt, az, speed: 0 }
    }

    const t = clamp(prevSpeed / sweepDegPerSec, 0, 1)
    const tau = tauStill + t * (tauMoving - tauStill)
    const alpha = alphaFor(dt, tau)

    const nextAz = smoothAngle(prevAz, az, alpha)
    const nextAlt = prevAlt + alpha * (alt - prevAlt)

    // Speed from the shortest arc — never the raw difference, or crossing
    // north reports a phantom spike (~21540 deg/s for a 1 deg/frame pan)
    // that would slam the smoother to its most responsive setting at exactly
    // the wrong moment.
    const speed = dt > 0 ? Math.abs(shortestAngleDiff(prevAz, az)) / dt : 0

    prevAlt = nextAlt
    prevAz = nextAz
    prevSpeed = speed

    return { alt: nextAlt, az: nextAz, speed }
  }
}

/**
 * Create a Schmitt-trigger star lock: acquire a candidate within `acquireDeg`
 * only after it wins `dwellFrames` consecutive frames, then hold it until it
 * drifts past `releaseDeg`. The gap between acquire and release is the whole
 * point — a single threshold makes a star sitting near the boundary flicker
 * in and out every frame, strobing the label.
 *
 * Candidates arrive sorted brightest-first; the first one within `acquireDeg`
 * (while unlocked) or `releaseDeg` (while holding that star) wins, preserving
 * the rule that a bright star just inside the cone beats a dim one dead
 * centre.
 *
 * @param {{ acquireDeg?: number, releaseDeg?: number, dwellFrames?: number }} [opts]
 * @returns {(candidates: StarCandidate[]) => StarLock | null}
 */
export function createStarLock(opts = {}) {
  const { acquireDeg = 8, releaseDeg = 14, dwellFrames = 3 } = opts

  /** @type {string | null} */
  let lockedName = null
  /** @type {string | null} */
  let candidateName = null
  let dwellCount = 0

  return function step(candidates) {
    if (lockedName !== null) {
      const held = candidates.find((c) => c.name === lockedName && c.sep <= releaseDeg)
      if (held) {
        candidateName = lockedName
        dwellCount = dwellFrames
        return { name: lockedName, dwell: 1 }
      }
      // Lost the lock — released, and start fresh from whatever is offered
      // this same frame.
      lockedName = null
      candidateName = null
      dwellCount = 0
    }

    const pick = candidates.find((c) => c.sep <= acquireDeg)
    if (!pick) {
      candidateName = null
      dwellCount = 0
      return null
    }

    if (pick.name !== candidateName) {
      candidateName = pick.name
      dwellCount = 0
    }
    dwellCount += 1

    if (dwellCount >= dwellFrames) {
      lockedName = pick.name
      return { name: pick.name, dwell: 1 }
    }

    return null
  }
}
