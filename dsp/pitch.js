// @ts-check

/** @type {readonly string[]} */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/**
 * Normalised Square Difference Function — the core of the McLeod Pitch Method.
 *
 *   n'(τ) = 2·Σ x[j]·x[j+τ] / Σ (x[j]² + x[j+τ]²)
 *
 * The normalisation is what makes the result amplitude-independent and bounded
 * to [-1, 1], so a single clarity threshold works at any input level.
 *
 * @param {ArrayLike<number>} x
 * @param {number} maxLag highest lag to evaluate; sets the lowest detectable pitch
 * @returns {Float64Array}
 */
export function nsdf(x, maxLag) {
  const n = x.length
  const out = new Float64Array(maxLag)
  for (let tau = 0; tau < maxLag; tau++) {
    let acf = 0
    let divisor = 0
    for (let j = 0; j + tau < n; j++) {
      const a = x[j] ?? 0
      const b = x[j + tau] ?? 0
      acf += a * b
      divisor += a * a + b * b
    }
    out[tau] = divisor > 0 ? (2 * acf) / divisor : 0
  }
  return out
}

/**
 * The highest point within each positive-going interval of the NSDF.
 *
 * The lag-0 lobe is skipped: every signal correlates perfectly with itself at
 * zero lag, which says nothing about its period.
 *
 * @param {ArrayLike<number>} d
 * @returns {{ lag: number, value: number }[]}
 */
export function keyMaxima(d) {
  /** @type {{ lag: number, value: number }[]} */
  const out = []
  let i = 1
  while (i < d.length - 1 && (d[i] ?? 0) > 0) i++      // leave the lag-0 lobe
  while (i < d.length - 1) {
    if ((d[i] ?? 0) <= 0) { i++; continue }
    let bestLag = i
    let best = d[i] ?? 0
    while (i < d.length - 1 && (d[i] ?? 0) > 0) {
      const v = d[i] ?? 0
      if (v > best) { best = v; bestLag = i }
      i++
    }
    out.push({ lag: bestLag, value: best })
  }
  return out
}

/**
 * Estimate the fundamental frequency.
 *
 * Two choices here are load-bearing:
 *
 * 1. The chosen peak is the FIRST key maximum reaching `threshold` × the
 *    tallest — not the tallest itself. The tallest frequently sits at twice
 *    the true period, and picking it produces an octave error. Preferring the
 *    shortest qualifying lag is what makes this robust on instruments with
 *    weak fundamentals, which is most of them.
 *
 * 2. Parabolic interpolation refines the peak to sub-sample precision. Without
 *    it, resolution is quantised to whole samples — at 48 kHz that is roughly
 *    8 cents of error near 440 Hz, and a tuner needs better than 1.
 *
 * @param {ArrayLike<number>} samples time-domain samples
 * @param {number} sampleRate Hz
 * @param {{ threshold?: number, minClarity?: number }} [opts]
 * @returns {{ hz: number, clarity: number } | null} null when there is no
 *   credible pitch — callers must display that as "no reading", never as a note
 */
export function detectPitch(samples, sampleRate, opts = {}) {
  const threshold = opts.threshold ?? 0.9
  const minClarity = opts.minClarity ?? 0.3

  const maxLag = Math.floor(samples.length / 2)
  if (maxLag < 4) return null

  const d = nsdf(samples, maxLag)
  const maxima = keyMaxima(d)
  if (maxima.length === 0) return null

  let peak = 0
  for (const m of maxima) if (m.value > peak) peak = m.value
  if (peak < minClarity) return null

  const chosen = maxima.find((m) => m.value >= peak * threshold)
  if (!chosen) return null

  const t = chosen.lag
  const y0 = d[t - 1] ?? d[t] ?? 0
  const y1 = d[t] ?? 0
  const y2 = d[t + 1] ?? d[t] ?? 0
  const denominator = 2 * (2 * y1 - y0 - y2)
  const shift = denominator !== 0 ? (y2 - y0) / denominator : 0

  const period = t + shift
  if (!(period > 0)) return null

  return { hz: sampleRate / period, clarity: peak }
}

/**
 * Nearest equal-tempered note and the deviation from it.
 *
 * @param {number} hz
 * @param {number} [a4] reference pitch for A4; 440 by convention, but 432 and
 *   415 (baroque) are both in real use
 * @returns {{ name: string, octave: number, midi: number, cents: number }}
 *   `cents` is always within ±50 because the note chosen is the nearest one
 */
export function noteFromHz(hz, a4 = 440) {
  const midi = 69 + 12 * Math.log2(hz / a4)
  const nearest = Math.round(midi)
  const name = NOTE_NAMES[((nearest % 12) + 12) % 12] ?? '?'
  return {
    name,
    octave: Math.floor(nearest / 12) - 1,
    midi: nearest,
    cents: (midi - nearest) * 100,
  }
}
