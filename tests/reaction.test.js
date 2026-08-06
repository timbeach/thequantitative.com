// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  foreperiodMs,
  classify,
  bootstrapMedianCI,
  summarise,
  ANTICIPATION_FLOOR_MS,
  MIN_FOREPERIOD_MS,
  FOREPERIOD_MEAN_EXCESS_MS,
  MAX_FOREPERIOD_MS,
} from '../stats/reaction.js'

/** Deterministic LCG so every stochastic test is reproducible.
 * @param {number} seed */
function seeded(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}

/**
 * Bin many draws into octiles of [MIN_FOREPERIOD_MS, MAX_FOREPERIOD_MS] and
 * compute the hazard of each bin: how many draws fired within the bin,
 * relative to how many were still waiting (unfired) at the bin's start. A
 * flat hazard is the whole point of the truncated-exponential design, see
 * stats/reaction.js for why.
 *
 * @param {number[]} draws
 * @param {number} nBins
 * @returns {number[]} hazard per bin, length nBins
 */
function hazardByOctile(draws, nBins = 8) {
  const width = (MAX_FOREPERIOD_MS - MIN_FOREPERIOD_MS) / nBins
  /** @type {number[]} */
  const hazards = []
  for (let i = 0; i < nBins; i++) {
    const start = MIN_FOREPERIOD_MS + i * width
    const end = start + width
    let atRisk = 0
    let fired = 0
    for (const d of draws) {
      if (d >= start) atRisk++
      if (d >= start && d < end) fired++
    }
    hazards.push(atRisk > 0 ? fired / atRisk : 0)
  }
  return hazards
}

test('foreperiodMs never returns below MIN_FOREPERIOD_MS nor above MAX_FOREPERIOD_MS', () => {
  const rand = seeded(1)
  for (let i = 0; i < 5000; i++) {
    const v = foreperiodMs(rand)
    assert.ok(v >= MIN_FOREPERIOD_MS, `${v} below MIN_FOREPERIOD_MS`)
    assert.ok(v <= MAX_FOREPERIOD_MS, `${v} above MAX_FOREPERIOD_MS`)
  }
})

test('foreperiodMs has an approximately flat hazard, unlike a uniform distribution', () => {
  const rand = seeded(2)
  /** @type {number[]} */
  const draws = []
  for (let i = 0; i < 20000; i++) draws.push(foreperiodMs(rand))

  const hazards = hazardByOctile(draws)
  const first = hazards[0] ?? 0
  const seventh = hazards[6] ?? 0
  const rise = first > 0 ? seventh / first : Infinity
  assert.ok(rise < 2.5, `hazard rose ${rise}x from octile 1 to 7, expected < 2.5x`)

  // The same check on a uniform distribution over the same range must FAIL
  // it, proving the octile check actually measures something rather than
  // rubber-stamping whatever the implementation happens to produce.
  const uRand = seeded(3)
  /** @type {number[]} */
  const uniformDraws = []
  for (let i = 0; i < 20000; i++) {
    uniformDraws.push(MIN_FOREPERIOD_MS + uRand() * (MAX_FOREPERIOD_MS - MIN_FOREPERIOD_MS))
  }
  const uHazards = hazardByOctile(uniformDraws)
  const uFirst = uHazards[0] ?? 0
  const uSeventh = uHazards[6] ?? 0
  const uRise = uFirst > 0 ? uSeventh / uFirst : Infinity
  assert.ok(uRise > 3, `expected a uniform distribution to fail the flat-hazard check (rise > 3x), got ${uRise}x`)
})

test('foreperiodMs never clamps: no mass piles up exactly at MAX_FOREPERIOD_MS', () => {
  const rand = seeded(4)
  let atCap = 0
  for (let i = 0; i < 20000; i++) {
    if (foreperiodMs(rand) === MAX_FOREPERIOD_MS) atCap++
  }
  assert.equal(atCap, 0, 'a clamp would pile duplicate draws exactly at the cap')
})

test('foreperiodMs is deterministic given a seeded rand', () => {
  const a = []
  const b = []
  const randA = seeded(9)
  const randB = seeded(9)
  for (let i = 0; i < 50; i++) a.push(foreperiodMs(randA))
  for (let i = 0; i < 50; i++) b.push(foreperiodMs(randB))
  assert.deepEqual(a, b)
})

test('classify: below ANTICIPATION_FLOOR_MS is anticipated, at and above is valid', () => {
  assert.equal(ANTICIPATION_FLOOR_MS, 100)
  assert.equal(classify(99), 'anticipated')
  assert.equal(classify(100), 'valid')
  assert.equal(classify(101), 'valid')
  assert.equal(classify(0), 'anticipated')
})

test('summarise excludes anticipated trials from median, best, and n', () => {
  const rand = seeded(5)
  // Two anticipated guesses (40, 80) mixed with three valid trials.
  const reactions = [40, 220, 80, 240, 260]
  const result = summarise(reactions, rand)
  assert.ok(result)
  assert.equal(result.n, 3)
  assert.equal(result.best, 220)
  assert.equal(result.median, 240)
})

test('summarise returns null when every trial is anticipated', () => {
  const rand = seeded(6)
  assert.equal(summarise([10, 20, 30], rand), null)
})

test('summarise returns null for an empty list', () => {
  const rand = seeded(7)
  assert.equal(summarise([], rand), null)
})

test("summarise's median is robust to a lapse; the mean is not", () => {
  const rand = seeded(8)
  const clean = [200, 210, 220, 230, 240]
  const lapsed = [200, 210, 220, 230, 900]

  const cleanResult = summarise(clean, seeded(8))
  const lapsedResult = summarise(lapsed, seeded(8))
  assert.ok(cleanResult)
  assert.ok(lapsedResult)

  const meanOf = (/** @type {number[]} */ xs) => xs.reduce((a, b) => a + b, 0) / xs.length
  const cleanMean = meanOf(clean)
  const lapsedMean = meanOf(lapsed)

  const medianShift = Math.abs(lapsedResult.median - cleanResult.median)
  const meanShift = Math.abs(lapsedMean - cleanMean)
  assert.ok(medianShift < meanShift,
    `median shift ${medianShift} should be far smaller than mean shift ${meanShift}`)
  void rand
})

test('bootstrapMedianCI brackets the median of the input', () => {
  const rand = seeded(10)
  const values = [200, 210, 215, 220, 230, 240, 260]
  const sorted = [...values].sort((a, b) => a - b)
  const median = sorted[3] ?? 0
  const [lo, hi] = bootstrapMedianCI(values, rand)
  assert.ok(lo <= median, `lo ${lo} should be <= median ${median}`)
  assert.ok(hi >= median, `hi ${hi} should be >= median ${median}`)
})

/**
 * Box-Muller normal draw from a seeded [0,1) generator, so "the same
 * distribution" means literally the same generating process rather than two
 * different slices of one fixed array.
 * @param {() => number} rand @param {number} mean @param {number} sd
 */
function normal(rand, mean, sd) {
  const u1 = rand() || Number.EPSILON // never log(0)
  const u2 = rand()
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

test('bootstrapMedianCI is wider for 5 values than for 20 from the same distribution', () => {
  const genRand = seeded(11)
  const small = Array.from({ length: 5 }, () => normal(genRand, 230, 40))
  const large = Array.from({ length: 20 }, () => normal(genRand, 230, 40))

  const [loSmall, hiSmall] = bootstrapMedianCI(small, seeded(12))
  const [loLarge, hiLarge] = bootstrapMedianCI(large, seeded(13))

  const widthSmall = hiSmall - loSmall
  const widthLarge = hiLarge - loLarge
  // A margin, not a bare ">", so floating-point rounding noise on a
  // fixed-width interval (two draws differing by ~1e-13) can never pass
  // this by accident: the difference must be real, not noise.
  assert.ok(widthSmall > widthLarge + 10,
    `n=5 width ${widthSmall} should exceed n=20 width ${widthLarge} by a real margin`)
})

test('bootstrapMedianCI on identical values returns a zero-width interval, not NaN', () => {
  const rand = seeded(13)
  const [lo, hi] = bootstrapMedianCI([250, 250, 250, 250, 250], rand)
  assert.equal(lo, 250)
  assert.equal(hi, 250)
  assert.ok(!Number.isNaN(lo))
  assert.ok(!Number.isNaN(hi))
})

test('bootstrapMedianCI is deterministic given a seeded rand', () => {
  const values = [200, 240, 260, 300, 310]
  const a = bootstrapMedianCI(values, seeded(14))
  const b = bootstrapMedianCI(values, seeded(14))
  assert.deepEqual(a, b)
})

test('summarise is deterministic given a seeded rand', () => {
  const reactions = [180, 220, 240, 260, 300]
  const a = summarise(reactions, seeded(15))
  const b = summarise(reactions, seeded(15))
  assert.deepEqual(a, b)
})

test('exposes the documented constants', () => {
  assert.equal(ANTICIPATION_FLOOR_MS, 100)
  assert.equal(MIN_FOREPERIOD_MS, 1500)
  assert.equal(FOREPERIOD_MEAN_EXCESS_MS, 2500)
  assert.equal(MAX_FOREPERIOD_MS, 9000)
})
