// @ts-check

/**
 * IEC 61672-1 A-weighting.
 *
 * A-weighting approximates the ear's frequency response at conversational
 * levels — it is why a 100 Hz rumble at the same physical energy as a 1 kHz
 * tone is reported ~19 dB quieter: you genuinely hear it that way.
 *
 * The +2.00 dB term normalises the response to 0 dB at 1 kHz. It is itself
 * rounded in the standard, so aWeightDb(1000) is 1.4e-4, not exactly zero —
 * four orders of magnitude below any real measurement uncertainty.
 *
 * @param {number} freq Hz
 * @returns {number} weighting in dB, relative to 1 kHz
 */
export function aWeightDb(freq) {
  const f2 = freq * freq
  const numerator = 12194 ** 2 * f2 * f2
  const denominator =
    (f2 + 20.6 ** 2) *
    Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) *
    (f2 + 12194 ** 2)
  return 20 * Math.log10(numerator / denominator) + 2.0
}

/**
 * The same weighting as a linear amplitude factor.
 * @param {number} freq Hz
 * @returns {number}
 */
export function aWeightGain(freq) {
  return 10 ** (aWeightDb(freq) / 20)
}

/**
 * Centre frequency of each FFT bin. An AnalyserNode's frequencyBinCount is
 * fftSize / 2, and bin i is centred at i * sampleRate / fftSize.
 *
 * @param {number} binCount
 * @param {number} sampleRate Hz
 * @param {number} fftSize
 * @returns {Float64Array}
 */
export function binFrequencies(binCount, sampleRate, fftSize) {
  const hz = new Float64Array(binCount)
  for (let i = 0; i < binCount; i++) hz[i] = (i * sampleRate) / fftSize
  return hz
}

/**
 * Total A-weighted level across a spectrum.
 *
 * Summation happens in the POWER domain — amplitudes are squared before adding
 * — because uncorrelated sources add in power, not amplitude. Two equal bins
 * therefore sum to +3.01 dB, not +6.
 *
 * Non-finite bins (an AnalyserNode reports -Infinity for empty bins) are
 * skipped rather than allowed to poison the sum with NaN.
 *
 * @param {ArrayLike<number>} binDb per-bin magnitude in dBFS
 * @param {ArrayLike<number>} binHz per-bin centre frequency, same length
 * @returns {number} A-weighted level in dBFS, or -Infinity for digital silence
 */
export function aWeightedLevelDb(binDb, binHz) {
  let power = 0
  const n = Math.min(binDb.length, binHz.length)
  for (let i = 0; i < n; i++) {
    const db = binDb[i]
    const hz = binHz[i]
    if (db === undefined || hz === undefined || !Number.isFinite(db)) continue
    const amplitude = 10 ** (db / 20) * aWeightGain(hz)
    power += amplitude * amplitude
  }
  return power > 0 ? 10 * Math.log10(power) : -Infinity
}
