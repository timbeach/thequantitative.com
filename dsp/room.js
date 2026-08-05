// @ts-check

/**
 * Room resonance — find the frequencies a room rings at by playing an
 * exponential sine sweep through the phone speaker and analysing what comes
 * back through the microphone.
 *
 * The hard problem this module solves is that neither the speaker nor the
 * microphone has a flat response, and neither can be calibrated away on an
 * arbitrary phone. What CAN be relied on is shape: a room mode is a narrow
 * resonance (Q roughly 20-50 in a furnished room), while the speaker's and
 * microphone's own frequency responses are broad by comparison. So the
 * measured response is smoothed with a 1/3-octave kernel to estimate the
 * broad part (transducer response, general room tonality), and whatever is
 * left over after subtracting that estimate — the residual, in dB — is
 * narrow enough to be the room, not the hardware.
 *
 * No AudioContext, no microphone, no DOM: sample rate and measured points
 * are passed in by the caller, so this is testable with synthetic data.
 */

/** The band room modes are searched in. Below it, a phone speaker's own
 * rolloff dominates and would be mistaken for room response; above it,
 * modes are so densely packed (mode density rises with the cube of
 * frequency) that they blur into a smooth reverberant tail rather than
 * standing out as distinct peaks. */
export const DEFAULT_BAND = { lo: 300, hi: 2000 }

/** Gate on residual height, in dB, below which a bump is not reported as a
 * mode. Measured, not chosen for taste: at 5 dB a simulated dead room (no
 * real modes, just transducer response and noise) grows two phantom modes;
 * at 8 dB real planted modes start being missed. 7 dB is the knee between
 * those failure directions — do not lower it to "find more modes". */
export const MIN_PROMINENCE_DB = 7

/** Shortest sweep this analysis should be run on, in seconds. A domestic
 * room's decay time (RT60) is commonly a few hundred ms; a sweep has to
 * move slowly relative to that or a mode's ring-down bleeds into the
 * frequencies swept immediately after it, smearing the very peaks this
 * module is trying to isolate. */
export const MIN_SWEEP_SECONDS = 8

/** Raised-cosine fade at each end of the sweep, in seconds. A hard edge is
 * both an audible click and a broadband transient — energy spread across
 * the whole spectrum that the analysis has no way to attribute to a
 * frequency, and so would show up as spurious response everywhere. */
const FADE_SECONDS = 0.05

/**
 * @typedef {Object} SweepOptions
 * @property {number} f1 start frequency, Hz
 * @property {number} f2 end frequency, Hz
 * @property {number} seconds sweep duration
 * @property {number} sampleRate Hz
 */

/**
 * An exponential ("log") sine sweep from f1 to f2: instantaneous frequency
 * rises so that equal TIME is spent per octave, not per Hz. That matters
 * here because the analysis (see `smoothFractionalOctave`) also thinks in
 * octaves — an exponential sweep gives every octave-wide analysis band the
 * same dwell time and therefore comparable signal-to-noise, where a linear
 * sweep would starve the bass octaves and drown the treble ones in samples.
 *
 * @param {SweepOptions} opts
 * @returns {Float32Array}
 */
export function sweepSamples(opts) {
  const { f1, f2, seconds, sampleRate } = opts
  const n = Math.max(0, Math.round(seconds * sampleRate))
  const out = new Float32Array(n)
  if (n === 0) return out

  // Standard log-sweep phase: integrating f(t) = f1 * (f2/f1)^(t/seconds)
  // over time gives phase(t) = 2*pi*f1/k * (exp(k*t) - 1), where
  // k = ln(f2/f1)/seconds. At t=0 this is f1; at t=seconds it is f2.
  const k = Math.log(f2 / f1) / seconds
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    const phase = ((2 * Math.PI * f1) / k) * (Math.exp(k * t) - 1)
    out[i] = Math.sin(phase)
  }

  const fadeSamples = Math.min(Math.round(FADE_SECONDS * sampleRate), Math.floor(n / 2))
  for (let i = 0; i < fadeSamples; i++) {
    const gain = 0.5 * (1 - Math.cos((Math.PI * i) / fadeSamples))
    out[i] = (out[i] ?? 0) * gain
    out[n - 1 - i] = (out[n - 1 - i] ?? 0) * gain
  }

  return out
}

/**
 * @typedef {Object} SpectrumPoint
 * @property {number} hz
 * @property {number} db
 */

/**
 * Smooth a frequency-response curve with a constant-fractional-octave
 * kernel: each output point is the mean, in dB, of every input point within
 * ±½ of a 1/fraction octave of it.
 *
 * The window is defined in octaves rather than Hz because a room's modes
 * (and the analysis grid) are dense near 300 Hz and sparse near 2000 Hz — a
 * fixed Hz-wide window would blur bass modes into their neighbours while
 * barely touching treble ones. A fixed-ratio window treats every part of
 * the band the same way.
 *
 * @param {SpectrumPoint[]} points sorted ascending by hz
 * @param {number} fraction e.g. 3 for 1/3-octave smoothing
 * @returns {SpectrumPoint[]}
 */
export function smoothFractionalOctave(points, fraction) {
  const n = points.length
  const ratio = 2 ** (1 / (2 * fraction))
  /** @type {SpectrumPoint[]} */
  const out = []

  // Two-pointer sliding window: as the center point advances (points are
  // ascending by hz), the window's lower and upper edges only ever move
  // forward too, so the whole pass is O(n) rather than O(n²).
  let lo = 0
  let hi = 0
  for (let i = 0; i < n; i++) {
    const p = points[i]
    if (!p) continue
    const loBound = p.hz / ratio
    const hiBound = p.hz * ratio
    while (lo < n && (points[lo]?.hz ?? 0) < loBound) lo++
    if (hi < lo) hi = lo
    while (hi < n && (points[hi]?.hz ?? Infinity) <= hiBound) hi++

    let sum = 0
    for (let j = lo; j < hi; j++) sum += points[j]?.db ?? 0
    const count = Math.max(1, hi - lo)
    out.push({ hz: p.hz, db: sum / count })
  }
  return out
}

/**
 * @typedef {Object} FindModesOptions
 * @property {{ lo: number, hi: number }} [band] frequency band to search;
 *   default `DEFAULT_BAND`
 */

/** Two peaks closer together than this, as a fraction of frequency, are
 * treated as one mode smeared across adjacent analysis points rather than
 * two distinct modes. */
const MERGE_FRACTION = 0.04

/** The smoothing kernel findModes uses to estimate the broad (non-modal)
 * part of the response. 1/3-octave, not narrower: a room mode's Q (roughly
 * 20-50) corresponds to a bandwidth far narrower than a 1/3-octave window at
 * these frequencies, so the kernel averages across a mode rather than
 * tracking it. A narrower kernel (1/24-octave was measured) starts doing the
 * opposite — following the modes themselves — and the residual goes flat. */
const SMOOTHING_FRACTION = 3

/**
 * Find room modes in a measured frequency response.
 *
 * The whole chain follows from the shape argument in the module doc: band
 * limit first (so the speaker's sub-300 Hz rolloff never enters the
 * envelope estimate), smooth what's left to estimate the broad transducer
 * response, subtract to get the residual, and peak-pick the residual against
 * `MIN_PROMINENCE_DB`. An empty result is the correct, common answer — most
 * rooms most of the time have nothing to report.
 *
 * @param {SpectrumPoint[]} points sorted ascending by hz
 * @param {FindModesOptions} [opts]
 * @returns {{ hz: number, prominenceDb: number }[]} sorted by descending prominence
 */
export function findModes(points, opts = {}) {
  const band = opts.band ?? DEFAULT_BAND
  const banded = points.filter((p) => p.hz >= band.lo && p.hz <= band.hi)
  if (banded.length < 3) return []

  const smoothed = smoothFractionalOctave(banded, SMOOTHING_FRACTION)

  /** @type {{ hz: number, residualDb: number }[]} */
  const residual = banded.map((p, i) => ({ hz: p.hz, residualDb: p.db - (smoothed[i]?.db ?? p.db) }))

  /** @type {{ hz: number, prominenceDb: number }[]} */
  const peaks = []
  for (let i = 1; i < residual.length - 1; i++) {
    const prev = residual[i - 1]
    const cur = residual[i]
    const next = residual[i + 1]
    if (!prev || !cur || !next) continue
    if (cur.residualDb >= MIN_PROMINENCE_DB && cur.residualDb > prev.residualDb && cur.residualDb > next.residualDb) {
      peaks.push({ hz: cur.hz, prominenceDb: cur.residualDb })
    }
  }

  // Merge peaks within MERGE_FRACTION of each other — one mode smeared
  // across adjacent analysis points must not be reported twice. Peaks are
  // already ascending by hz (residual was built from ascending `banded`),
  // so a single forward pass catches every adjacent-enough pair, keeping
  // whichever of the two is more prominent.
  /** @type {{ hz: number, prominenceDb: number }[]} */
  const merged = []
  for (const peak of peaks) {
    const last = merged[merged.length - 1]
    if (last && Math.abs(peak.hz - last.hz) / last.hz <= MERGE_FRACTION) {
      if (peak.prominenceDb > last.prominenceDb) merged[merged.length - 1] = peak
    } else {
      merged.push(peak)
    }
  }

  merged.sort((a, b) => b.prominenceDb - a.prominenceDb)
  return merged
}
