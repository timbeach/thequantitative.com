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
  const r = detectPitch(filtered, sampleRate, { minClarity })
  if (!r) return null

  const bpm = r.hz * 60
  if (bpm < MIN_BPM || bpm > MAX_BPM) return null

  return { bpm, clarity: r.clarity }
}
