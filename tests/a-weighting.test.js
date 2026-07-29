// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aWeightDb, aWeightGain, binFrequencies, aWeightedLevelDb } from '../dsp/a-weighting.js'

/** @param {number} a @param {number} b @param {number} eps @param {string} [what] */
const near = (a, b, eps, what = '') =>
  assert.ok(Math.abs(a - b) < eps, `${what} expected ${a} within ${eps} of ${b}`)

// IEC 61672-1 Table 3, rounded to 0.1 dB in the standard itself — so 0.15 dB
// is the tightest tolerance the published figures can support.
/** @type {[number, number][]} */
const TABLE = [
  [20, -50.5], [31.5, -39.4], [63, -26.2], [100, -19.1], [200, -10.9],
  [500, -3.2], [1000, 0], [2000, 1.2], [4000, 1.0], [8000, -1.1],
  [10000, -2.5], [16000, -6.6],
]

test('aWeightDb matches the IEC 61672-1 published table', () => {
  for (const [f, want] of TABLE) near(aWeightDb(f), want, 0.15, `${f} Hz:`)
})

test('aWeightDb is ~0 at 1 kHz by definition', () => {
  // The standard's +2.00 normaliser is itself rounded, so this is 1.4e-4, not 0.
  near(aWeightDb(1000), 0, 1e-3)
})

test('aWeightDb rolls off hard at both extremes', () => {
  assert.ok(aWeightDb(10) < -60, 'infrasound must be heavily attenuated')
  assert.ok(aWeightDb(20000) < -9, 'ultrasound must be attenuated')
  assert.ok(aWeightDb(2500) > 0, 'the ear is most sensitive around 2.5 kHz')
})

test('aWeightGain is the dB value expressed as a linear amplitude factor', () => {
  for (const f of [50, 250, 1000, 4000, 12000]) {
    near(aWeightGain(f), 10 ** (aWeightDb(f) / 20), 1e-12, `${f} Hz:`)
  }
  near(aWeightGain(1000), 1, 1e-4)
})

test('binFrequencies spaces bins at sampleRate / fftSize', () => {
  const hz = binFrequencies(4, 48000, 1024)
  assert.equal(hz.length, 4)
  near(hz[0] ?? -1, 0, 1e-9)
  near(hz[1] ?? -1, 48000 / 1024, 1e-9)
  near(hz[3] ?? -1, 3 * 48000 / 1024, 1e-9)
})

test('a lone 1 kHz bin passes through unweighted', () => {
  // A(1000) = 0, so the A-weighted level of a pure 1 kHz tone is its own level.
  const hz = [0, 1000, 100, 10000]
  near(aWeightedLevelDb([-Infinity, -20, -Infinity, -Infinity], hz), -20, 0.01)
})

test('a lone 100 Hz bin is attenuated by the weighting', () => {
  const hz = [0, 1000, 100, 10000]
  near(aWeightedLevelDb([-Infinity, -Infinity, -20, -Infinity], hz), -39.15, 0.05)
})

test('a lone 10 kHz bin is attenuated by the weighting', () => {
  const hz = [0, 1000, 100, 10000]
  near(aWeightedLevelDb([-Infinity, -Infinity, -Infinity, -20], hz), -22.49, 0.05)
})

test('two equal uncorrelated bins sum to +3 dB', () => {
  // Doubling power is +3.0103 dB — the definitional check that the summation
  // is in the power domain and not the amplitude domain.
  const hz = [1000, 1000]
  near(aWeightedLevelDb([-20, -20], hz), -20 + 10 * Math.log10(2), 0.01)
})

test('digital silence is -Infinity, not NaN or 0', () => {
  assert.equal(aWeightedLevelDb([-Infinity, -Infinity], [1000, 2000]), -Infinity)
})

test('non-finite bins are skipped rather than poisoning the sum', () => {
  const hz = [1000, 1000, 1000]
  const withJunk = aWeightedLevelDb([-20, NaN, -Infinity], hz)
  const clean = aWeightedLevelDb([-20], [1000])
  near(withJunk, clean, 1e-9)
})

test('level scales 1:1 with input level', () => {
  const hz = [1000]
  near(aWeightedLevelDb([-40], hz) - aWeightedLevelDb([-50], hz), 10, 0.01)
})
