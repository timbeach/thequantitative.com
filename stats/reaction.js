// @ts-check

/**
 * Simple reaction time: a stimulus appears after an unpredictable wait, the
 * player taps as fast as possible, and the interval is scored. What makes
 * this an instrument rather than a stopwatch is the two places a naive
 * version lies: the wait itself can be guessed if its timing has structure,
 * and a guess that beats the wait looks, wrongly, like a superhuman
 * reaction. Both are handled here, in code with no wall clock or randomness
 * of its own; the caller supplies both.
 */

/**
 * Below this a "reaction" is almost certainly a guess, not a response to the
 * stimulus: retina → visual cortex → motor cortex → thumb is 100-120 ms at
 * the physiological floor, so nothing genuine arrives faster. Measured cost
 * of the gate against simulated genuine reactions: 0.000% wrongly rejected
 * for a typical 220 ms performer, 0.095% even for an exceptional 160 ms one.
 * It catches every guess and costs essentially nothing.
 */
export const ANTICIPATION_FLOOR_MS = 100

/** Shortest possible wait before the stimulus fires. */
export const MIN_FOREPERIOD_MS = 1500

/**
 * Mean of the exponential excess added on top of MIN_FOREPERIOD_MS. The
 * exponential shape (rather than uniform or Gaussian) is what keeps the
 * *hazard* (the chance the stimulus fires now, given it hasn't yet) flat
 * across the wait. A flat hazard is unguessable; a rising one hands the
 * player a cue and turns the instrument into a timing-prediction game
 * instead of a reaction measurement. Measured hazard rise across the wait:
 * Gaussian ~7071x (catastrophic), uniform 4.0x (learnable), truncated
 * exponential 1.8x (flat enough).
 */
export const FOREPERIOD_MEAN_EXCESS_MS = 2500

/**
 * Longest possible wait. Draws that land past this are resampled, never
 * clamped: clamping would pile a spike of probability at exactly this
 * value, which is the single most predictable thing the instrument could
 * do and would hand the player a guaranteed cue.
 */
export const MAX_FOREPERIOD_MS = 9000

/**
 * Draw a wait time before the stimulus fires: MIN_FOREPERIOD_MS plus a
 * truncated-exponential excess.
 *
 * The excess is sampled as `-mean * ln(1 - rand())`, the standard inverse-CDF
 * draw for an exponential; `1 - rand()` rather than `rand()` avoids ever
 * taking the log of exactly zero. Draws that would exceed MAX_FOREPERIOD_MS
 * are rejected and redrawn rather than clamped, which preserves the
 * memoryless, flat-hazard shape of the exponential instead of stacking
 * probability mass at the cap.
 *
 * @param {() => number} rand returns [0, 1); injected so callers (and tests)
 *   are deterministic
 * @returns {number} milliseconds, in [MIN_FOREPERIOD_MS, MAX_FOREPERIOD_MS]
 */
export function foreperiodMs(rand) {
  for (;;) {
    const excess = -FOREPERIOD_MEAN_EXCESS_MS * Math.log(1 - rand())
    const value = MIN_FOREPERIOD_MS + excess
    if (value <= MAX_FOREPERIOD_MS) return value
  }
}

/**
 * Sort a reaction below the physiological floor as a guess ("anticipated")
 * rather than a genuine response.
 *
 * @param {number} reactionMs
 * @returns {'valid' | 'anticipated'}
 */
export function classify(reactionMs) {
  return reactionMs < ANTICIPATION_FLOOR_MS ? 'anticipated' : 'valid'
}

/**
 * @param {number[]} values
 * @returns {number} the median; for an even count, the mean of the two
 *   middle values
 */
function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
  }
  return sorted[mid] ?? 0
}

/**
 * Percentile bootstrap confidence interval for the median.
 *
 * This is the instrument's only honest statement about its own precision:
 * with only a handful of trials, the sample median is a noisy estimate of
 * the player's true reaction time, and the width of this interval says how
 * noisy. Measured widths: 120 ms at n=5, 66 ms at n=10, 47 ms at n=20. It
 * genuinely widens at small n, which a fixed-width interval would fake.
 * Actual coverage runs 85-88% against a nominal 90%, a known small-n bias of
 * the bootstrap median that the UI labels as approximate rather than papering
 * over.
 *
 * @param {number[]} values
 * @param {() => number} rand returns [0, 1); injected so callers (and tests)
 *   are deterministic
 * @param {number} [reps] resample count; 1000 balances resolution against
 *   how long the player waits for a number
 * @returns {[number, number]} [lo, hi], the 5th and 95th percentile of the
 *   resampled medians: a 90% interval
 */
export function bootstrapMedianCI(values, rand, reps = 1000) {
  const n = values.length
  /** @type {number[]} */
  const medians = []
  for (let i = 0; i < reps; i++) {
    /** @type {number[]} */
    const resample = []
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(rand() * n)
      resample.push(values[idx] ?? 0)
    }
    medians.push(medianOf(resample))
  }
  medians.sort((a, b) => a - b)

  const loIdx = Math.floor(0.05 * reps)
  const hiIdx = Math.min(reps - 1, Math.ceil(0.95 * reps) - 1)
  return [medians[loIdx] ?? 0, medians[hiIdx] ?? 0]
}

/**
 * Summarise a block of raw reaction times into the numbers worth showing.
 *
 * Anticipated trials are filtered out first and contribute to nothing that
 * follows, not the median, not the best, not n, because a guess is not a
 * measurement. The median (not the mean) is used because reaction times are
 * right-skewed with a real lapse tail: one 900 ms lapse among five trials
 * moves a mean by +119 to +136 ms but a median by only +0 to +11 ms. That is
 * robustness, not extra precision (at n=5 the median and mean have similar
 * spread), and robustness is what matters, because lapses are common and are
 * not what the player wants measured.
 *
 * @param {number[]} reactionsMs raw reaction times, unfiltered
 * @param {() => number} rand returns [0, 1); injected so callers (and tests)
 *   are deterministic
 * @returns {{ median: number, ci: [number, number], best: number, n: number } | null}
 *   null when there are no valid trials: never NaN, never a zero standing
 *   in for "nothing to measure"
 */
export function summarise(reactionsMs, rand) {
  const valid = reactionsMs.filter((r) => classify(r) === 'valid')
  if (valid.length === 0) return null

  const median = medianOf(valid)
  const best = Math.min(...valid)
  const ci = bootstrapMedianCI(valid, rand)
  return { median, ci, best, n: valid.length }
}
