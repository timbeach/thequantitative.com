// @ts-check
import { detectPitch } from './pitch.js'

/**
 * Photoplethysmography — the pulse-oximeter principle. With a fingertip
 * pressed over the camera, light reaching the sensor is modulated by blood
 * volume in the capillaries: each heartbeat absorbs slightly more. Averaging
 * the red channel per frame gives a signal that oscillates at heart rate,
 * riding on top of much larger, slower drift (finger pressure easing, the
 * sensor's auto-exposure) and a genuine physiological rival: breathing.
 *
 * No wall-clock or randomness lives here — sample rate is passed in by the
 * caller, so this module is testable without a camera and without a DOM.
 */

/** Below this a "pulse" is almost certainly filter drift or a slow artefact. */
export const MIN_BPM = 40
/** Above this a "pulse" is almost certainly a harmonic lock or noise spike. */
export const MAX_BPM = 200

/**
 * One first-order (RC) high-pass section, via the standard bilinear-ish
 * difference equation y[n] = α·(y[n-1] + x[n] - x[n-1]).
 *
 * α is derived from the corner frequency rather than hard-coded per sample
 * rate, so the same corner means the same thing whether frames arrive at 30
 * fps or 60 fps.
 *
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate Hz
 * @param {number} cornerHz -3 dB point
 * @returns {Float64Array}
 */
function highPass1(samples, sampleRate, cornerHz) {
  const n = samples.length
  const out = new Float64Array(n)
  if (n === 0) return out

  const dt = 1 / sampleRate
  const rc = 1 / (2 * Math.PI * cornerHz)
  const alpha = rc / (rc + dt)

  let prevX = samples[0] ?? 0
  let prevY = 0
  out[0] = 0
  for (let i = 1; i < n; i++) {
    const x = samples[i] ?? 0
    const y = alpha * (prevY + x - prevX)
    out[i] = y
    prevX = x
    prevY = y
  }
  return out
}

/**
 * Two cascaded first-order high-pass sections. A single first-order section
 * rolls off at only 6 dB/octave — too gentle to separate a ~0.9-1.2 Hz pulse
 * from ~0.2-0.35 Hz breathing without either passing respiration or eating
 * into slow-but-real pulses. Cascading two sections steepens the rolloff to
 * 12 dB/octave, which is what actually separates them (see
 * `dsp/ppg.test.js` for the measured attenuation ratio).
 *
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate Hz
 * @param {number} cornerHz -3 dB point of EACH section
 * @returns {Float64Array}
 */
export function highPass2(samples, sampleRate, cornerHz) {
  return highPass1(highPass1(samples, sampleRate, cornerHz), sampleRate, cornerHz)
}

/**
 * The effective sample rate the period finder works at, in Hz.
 *
 * A camera samples at 15-60 fps, and at those rates a heart rate's period is
 * only a handful of samples long — 170 BPM at 30 fps is 10.59 of them. The
 * NSDF is only evaluated at whole-sample lags, so a period that lands between
 * samples is measured out of phase with itself and its correlation is
 * depressed, while twice that period may happen to land much closer to a whole
 * sample and score higher. `detectPitch` then picks the first lag reaching its
 * threshold, skips the true period entirely, and reports half the heart rate
 * with a clarity of 1.000 — confidently, which is the worst way to be wrong.
 *
 * Resampling to at least this rate first makes the lag grid fine enough that
 * the true period is never the one that misses. 120 Hz was measured, not
 * assumed: see the sweep test in `tests/ppg.test.js`.
 */
const WORKING_RATE = 120

/**
 * Catmull-Rom cubic interpolation, upsampling by a whole-number factor.
 *
 * Cubic rather than linear because linear interpolation flattens peaks, and a
 * flattened peak is exactly the thing being measured here.
 *
 * @param {ArrayLike<number>} samples
 * @param {number} factor whole number ≥ 1; 1 returns a copy
 * @returns {Float64Array} length `(n - 1) * factor + 1`
 */
export function resampleCubic(samples, factor) {
  const n = samples.length
  if (n === 0) return new Float64Array(0)
  if (factor <= 1 || n === 1) return Float64Array.from(samples)

  const out = new Float64Array((n - 1) * factor + 1)
  /** @param {number} i */
  const at = (i) => samples[Math.min(n - 1, Math.max(0, i))] ?? 0

  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    for (let j = 0; j < factor; j++) {
      const t = j / factor
      const t2 = t * t
      const t3 = t2 * t
      out[i * factor + j] =
        0.5 *
        (2 * p1 +
          (-p0 + p2) * t +
          (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
          (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
    }
  }
  out[(n - 1) * factor] = at(n - 1)
  return out
}

/**
 * @typedef {Object} EstimateRateOptions
 * @property {number} [cornerHz] high-pass corner in Hz. Default 0.7 — found
 *   empirically: below it, breathing (~0.2-0.35 Hz) wins the clarity contest;
 *   above it, slow-but-genuine pulses start to suffer.
 * @property {number} [minClarity] confidence gate passed through to
 *   `detectPitch`. Default 0.5 — the honesty threshold below which a reading
 *   must be refused rather than shown.
 */

/**
 * Estimate heart rate from a per-frame red-channel PPG trace.
 *
 * Period-finding is exactly the Tuner's problem — a quasi-periodic waveform
 * with a well-defined fundamental — so this reuses `detectPitch` rather than
 * a second period finder. Its clarity measure doubles as the confidence gate
 * here: a camera pointed at a ceiling has a strongest period too, and
 * without this gate the instrument would confidently report a heart rate
 * for a table.
 *
 * The 40-200 BPM range check is a second, independent safety net: NSDF can
 * still lock onto a strong non-pulse artefact (breathing, a hand tremor)
 * with high clarity, and the filter alone does not guarantee that can never
 * happen.
 *
 * @param {ArrayLike<number>} samples per-frame red-channel average
 * @param {number} sampleRate frames per second
 * @param {EstimateRateOptions} [opts]
 * @returns {{ bpm: number, clarity: number } | null} null when there is no
 *   credible pulse — callers must display that as "no reading", never a guess
 */
export function estimateRate(samples, sampleRate, opts = {}) {
  const cornerHz = opts.cornerHz ?? 0.7
  const minClarity = opts.minClarity ?? 0.5

  const filtered = highPass2(samples, sampleRate, cornerHz)

  const factor = Math.max(1, Math.ceil(WORKING_RATE / sampleRate))
  const dense = resampleCubic(filtered, factor)

  // 0.8 rather than the Tuner's 0.9. A PPG waveform's second harmonic is
  // strong — the dicrotic notch is literally a second bump per beat — so the
  // key maximum at the true period sits lower relative to the tallest than a
  // plucked string's does. Measured across the full 40-200 BPM sweep.
  const r = detectPitch(dense, sampleRate * factor, { threshold: 0.8, minClarity })
  if (!r) return null

  const bpm = r.hz * 60
  if (bpm < MIN_BPM || bpm > MAX_BPM) return null

  return { bpm, clarity: r.clarity }
}
