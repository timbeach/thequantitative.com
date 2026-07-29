// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walkSteps, binOf, binomialPmf, momentsFor, sampleStats } from '../stats/galton.js'

/** Deterministic LCG so every stochastic test is reproducible.
 * @param {number} seed */
function seeded(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}

/** @param {number} a @param {number} b @param {number} [eps] */
const near = (a, b, eps = 1e-12) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} to be within ${eps} of ${b}`)

test('walkSteps returns one decision per row', () => {
  assert.equal(walkSteps(16, 0.5, seeded(1)).length, 16)
  assert.equal(walkSteps(3, 0.5, seeded(1)).length, 3)
})

test('walkSteps emits only 0 or 1', () => {
  for (const s of walkSteps(64, 0.5, seeded(7))) assert.ok(s === 0 || s === 1)
})

test('rng below p goes right every time; at or above p goes left', () => {
  // p = 0.5: a generator pinned at 0 must go one way for every peg,
  // and one pinned at 0.99 must go the other. Which way is the
  // convention fixed by binOf, asserted next.
  assert.deepEqual(walkSteps(4, 0.5, () => 0), [1, 1, 1, 1])
  assert.deepEqual(walkSteps(4, 0.5, () => 0.99), [0, 0, 0, 0])
})

test('p = 1 always goes right, p = 0 always goes left', () => {
  assert.equal(binOf(walkSteps(20, 1, seeded(3))), 20)
  assert.equal(binOf(walkSteps(20, 0, seeded(3))), 0)
})

test('binOf counts the rights', () => {
  assert.equal(binOf([1, 0, 1, 1, 0]), 3)
  assert.equal(binOf([]), 0)
})

test('the destination bin is always within [0, rows]', () => {
  const rng = seeded(42)
  for (let i = 0; i < 500; i++) {
    const b = binOf(walkSteps(12, 0.5, rng))
    assert.ok(b >= 0 && b <= 12, `bin ${b} out of range`)
  }
})

test('binomialPmf matches the closed form for n = 4, p = 0.5', () => {
  const pmf = binomialPmf(4, 0.5)
  assert.equal(pmf.length, 5)
  const expected = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16]
  pmf.forEach((v, i) => near(v, /** @type {number} */ (expected[i])))
})

test('binomialPmf sums to 1', () => {
  for (const pair of [[4, 0.5], [16, 0.5], [23, 0.3], [30, 0.87]]) {
    const [n, p] = /** @type {[number, number]} */ (pair)
    near(binomialPmf(n, p).reduce((a, b) => a + b, 0), 1, 1e-10)
  }
})

test('binomialPmf is symmetric at p = 0.5 and skewed otherwise', () => {
  const fair = binomialPmf(10, 0.5)
  for (let i = 0; i <= 10; i++) {
    near(/** @type {number} */ (fair[i]), /** @type {number} */ (fair[10 - i]))
  }
  const biased = binomialPmf(10, 0.8)
  assert.ok(
    /** @type {number} */ (biased[8]) > /** @type {number} */ (biased[2]),
    'p = 0.8 must lean right'
  )
})

test('momentsFor is the closed form np and sqrt(npq)', () => {
  const m = momentsFor(16, 0.5)
  near(m.mean, 8)
  near(m.sd, 2)                       // sqrt(16 * 0.5 * 0.5)
  const b = momentsFor(100, 0.25)
  near(b.mean, 25)
  near(b.sd, Math.sqrt(100 * 0.25 * 0.75))
})

test('sampleStats of an exact binomial histogram equals the closed form', () => {
  // counts for n = 4, p = 0.5 scaled by 16 — the pmf made whole numbers
  const stats = sampleStats([1, 4, 6, 4, 1])
  assert.equal(stats.n, 16)
  near(stats.mean, 2)
  near(stats.sd, 1)                   // sqrt(4 * 0.5 * 0.5)
  const closed = momentsFor(4, 0.5)
  near(stats.mean, closed.mean)
  near(stats.sd, closed.sd)
})

test('sampleStats handles an empty histogram without NaN', () => {
  const s = sampleStats([0, 0, 0])
  assert.equal(s.n, 0)
  assert.equal(Number.isNaN(s.mean), false)
  assert.equal(Number.isNaN(s.sd), false)
})

test('sampling converges on the closed form', () => {
  const rows = 16, p = 0.5, rng = seeded(2026)
  const counts = new Array(rows + 1).fill(0)
  for (let i = 0; i < 20000; i++) counts[binOf(walkSteps(rows, p, rng))]++
  const s = sampleStats(counts), c = momentsFor(rows, p)
  assert.ok(Math.abs(s.mean - c.mean) < 0.1, `mean ${s.mean} vs ${c.mean}`)
  assert.ok(Math.abs(s.sd - c.sd) < 0.1, `sd ${s.sd} vs ${c.sd}`)
})
