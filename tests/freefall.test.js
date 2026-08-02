// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heightFromHang, heightUncertainty, createJumpDetector } from '../dsp/freefall.js'

const G = 9.81

/** @param {number} a @param {number} b @param {number} eps @param {string} [what] */
const near = (a, b, eps, what = '') =>
  assert.ok(Math.abs(a - b) < eps, `${what} expected ${a} within ${eps} of ${b}`)

/**
 * Build a synthetic |a| trace at a given rate.
 * @param {[number, number][]} segments [durationMs, magnitude]
 * @param {number} [hz]
 * @returns {[number, number][]} [magnitude, tMs]
 */
function trace(segments, hz = 60) {
  const step = 1000 / hz
  /** @type {[number, number][]} */
  const out = []
  let t = 0
  for (const [ms, mag] of segments) {
    for (let i = 0; i < Math.round(ms / step); i++) { out.push([mag, t]); t += step }
  }
  return out
}

/** @param {[number, number][]} tr @param {object} [opts] */
function run(tr, opts) {
  const feed = createJumpDetector(opts)
  let last = null
  let count = 0
  for (const [m, t] of tr) { const j = feed(m, t); if (j) { last = j; count++ } }
  return { jump: last, count }
}

test('heightFromHang is g·t²/8', () => {
  near(heightFromHang(0.5), (G * 0.25) / 8, 1e-12)
  near(heightFromHang(0.5), 0.3066, 1e-3)
  near(heightFromHang(0.7), 0.6009, 1e-3)
  assert.equal(heightFromHang(0), 0)
})

test('heightFromHang scales with the square of hang time', () => {
  // Doubling hang time must quadruple height — the definitional check.
  near(heightFromHang(1.0) / heightFromHang(0.5), 4, 1e-12)
})

test('heightUncertainty follows dh/dt = g·t/4', () => {
  near(heightUncertainty(0.5, 1 / 60), (G * 0.5 / 4) * (1 / 60), 1e-12)
  // ~2 cm at a 31 cm jump sampled at 60 Hz
  near(heightUncertainty(0.5, 1 / 60), 0.0204, 1e-3)
  // halving the sample interval halves the uncertainty
  near(heightUncertainty(0.5, 1 / 120), heightUncertainty(0.5, 1 / 60) / 2, 1e-12)
})

test('detects a real jump and reports the hang time', () => {
  const { jump } = run(trace([[300, 9.8], [100, 22], [500, 0.5], [80, 30], [300, 9.8]]))
  assert.ok(jump, 'a real jump was not detected')
  near(jump.hangMs, 500, 40)
  near(jump.heightM, heightFromHang(jump.hangMs / 1000), 1e-9)
})

test('a bigger jump reads higher', () => {
  const small = run(trace([[300, 9.8], [100, 20], [300, 0.5], [80, 28], [300, 9.8]])).jump
  const big = run(trace([[300, 9.8], [100, 25], [700, 0.4], [80, 35], [300, 9.8]])).jump
  assert.ok(small && big)
  assert.ok(big.heightM > small.heightM * 3, 'a 700ms hang must dwarf a 300ms one')
})

test('REJECTS waving the phone — free fall with no push-off', () => {
  const { jump } = run(trace([[300, 9.8], [400, 2.0], [300, 9.8]]))
  assert.equal(jump, null, 'waving must not register as a jump')
})

test('REJECTS shaking — spikes with no free fall', () => {
  const { jump } = run(trace([[300, 9.8], [100, 25], [200, 8], [100, 25], [300, 9.8]]))
  assert.equal(jump, null, 'shaking must not register as a jump')
})

test('REJECTS a drop — free fall and impact but no push-off first', () => {
  // This is the one that matters: without the launch-window rule, dropping the
  // phone onto a sofa reads as an excellent jump.
  const { jump } = run(trace([[300, 9.8], [400, 0.3], [80, 40], [300, 9.8]]))
  assert.equal(jump, null, 'a drop must not register as a jump')
})

test('REJECTS an implausibly long hang', () => {
  const { jump } = run(trace([[300, 9.8], [100, 20], [1400, 0.4], [80, 30], [300, 9.8]]))
  assert.equal(jump, null, 'over 1.2s is not a human jump')
})

test('REJECTS an implausibly short hang', () => {
  const { jump } = run(trace([[300, 9.8], [100, 20], [60, 0.4], [80, 30], [300, 9.8]]))
  assert.equal(jump, null, 'under 120ms is a bump, not a jump')
})

test('free fall must follow the push-off promptly', () => {
  // Push-off, then a long quiet gap, then free fall — not one motion.
  const { jump } = run(trace([[300, 9.8], [100, 22], [600, 9.8], [500, 0.5], [80, 30], [300, 9.8]]))
  assert.equal(jump, null, 'free fall long after a spike is unrelated')
})

test('reports each jump exactly once', () => {
  const { count } = run(trace([[300, 9.8], [100, 22], [500, 0.5], [80, 30], [300, 9.8]]))
  assert.equal(count, 1)
})

test('detects two jumps in succession', () => {
  const { count } = run(trace([
    [300, 9.8], [100, 22], [500, 0.5], [80, 30],
    [400, 9.8], [100, 22], [400, 0.5], [80, 30], [300, 9.8],
  ]))
  assert.equal(count, 2)
})

test('uncertainty is reported alongside the height', () => {
  const { jump } = run(trace([[300, 9.8], [100, 22], [500, 0.5], [80, 30], [300, 9.8]]))
  assert.ok(jump)
  assert.ok(jump.uncertaintyM > 0, 'a measurement without a tolerance is not a measurement')
  assert.ok(jump.uncertaintyM < jump.heightM, 'uncertainty must not swamp the reading')
})

test('works at 30 Hz, with correspondingly larger uncertainty', () => {
  const slow = run(trace([[300, 9.8], [100, 22], [500, 0.5], [80, 30], [300, 9.8]], 30)).jump
  const fast = run(trace([[300, 9.8], [100, 22], [500, 0.5], [80, 30], [300, 9.8]], 120)).jump
  assert.ok(slow && fast)
  assert.ok(slow.uncertaintyM > fast.uncertaintyM, 'a slower sample rate must report less precision')
})

test('thresholds are configurable', () => {
  // With an impossible launch threshold nothing can ever qualify.
  const { jump } = run(trace([[300, 9.8], [100, 22], [500, 0.5], [80, 30], [300, 9.8]]), { launch: 1000 })
  assert.equal(jump, null)
})

test('a ringing landing (oscillating impact) does not double-count a jump', () => {
  // A hard landing can bounce the accelerometer above and below the landing
  // threshold for a few frames. That must still register as exactly one Jump.
  const { count } = run(trace([
    [300, 9.8], [100, 22], [500, 0.5],
    [16.7, 40], [16.7, 20], [16.7, 40], [16.7, 20], [16.7, 40],
    [300, 9.8],
  ]))
  assert.equal(count, 1, 'a ringing landing must not be counted as multiple jumps')
})
