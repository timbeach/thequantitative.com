// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gravityToTilt, alphaFor, lowPassVec, applyCalibration } from '../dsp/tilt.js'

/** @param {number} a @param {number} b @param {number} [eps] */
const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} to be within ${eps} of ${b}`)

const SQRT_HALF = Math.SQRT1_2 // 0.7071...

test('flat, screen up → level', () => {
  const t = gravityToTilt({ x: 0, y: 0, z: 1 })
  near(t.pitch, 0)
  near(t.roll, 0)
})

test('top edge raised 90° → pitch +90, roll 0', () => {
  const t = gravityToTilt({ x: 0, y: -1, z: 0 })
  near(t.pitch, 90)
  near(t.roll, 0)
})

test('top edge lowered 90° → pitch -90', () => {
  near(gravityToTilt({ x: 0, y: 1, z: 0 }).pitch, -90)
})

test('right edge raised 90° → roll +90, pitch 0', () => {
  const t = gravityToTilt({ x: -1, y: 0, z: 0 })
  near(t.roll, 90)
  near(t.pitch, 0)
})

test('left edge raised 90° → roll -90', () => {
  near(gravityToTilt({ x: 1, y: 0, z: 0 }).roll, -90)
})

test('top edge raised 45°', () => {
  const t = gravityToTilt({ x: 0, y: -SQRT_HALF, z: SQRT_HALF })
  near(t.pitch, 45)
  near(t.roll, 0)
})

test('magnitude is irrelevant — only direction matters', () => {
  const a = gravityToTilt({ x: 0, y: -SQRT_HALF, z: SQRT_HALF })
  const b = gravityToTilt({ x: 0, y: -9.81 * SQRT_HALF, z: 9.81 * SQRT_HALF })
  near(a.pitch, b.pitch)
  near(a.roll, b.roll)
})

test('alphaFor: one time constant of elapsed time → 1 - 1/e', () => {
  near(alphaFor(0.1, 0.1), 1 - Math.exp(-1), 1e-12)
})

test('alphaFor: tau of zero or less means no smoothing', () => {
  near(alphaFor(0.016, 0), 1)
  near(alphaFor(0.016, -1), 1)
})

test('alphaFor: never exceeds 1 even for a huge dt', () => {
  const a = alphaFor(100, 0.1)
  assert.ok(a <= 1 && a > 0.999)
})

test('lowPassVec: alpha 1 jumps straight to the new value', () => {
  const v = lowPassVec({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 3 }, 1)
  assert.deepEqual(v, { x: 1, y: 2, z: 3 })
})

test('lowPassVec: alpha 0 holds the previous value', () => {
  const v = lowPassVec({ x: 5, y: 5, z: 5 }, { x: 1, y: 2, z: 3 }, 0)
  assert.deepEqual(v, { x: 5, y: 5, z: 5 })
})

test('lowPassVec: alpha 0.5 lands halfway', () => {
  const v = lowPassVec({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 4 }, 0.5)
  near(v.x, 0.5); near(v.y, 1); near(v.z, 2)
})

test('applyCalibration subtracts the stored offset', () => {
  const t = applyCalibration({ pitch: 10, roll: -4 }, { pitch: 1.5, roll: -0.5 })
  near(t.pitch, 8.5)
  near(t.roll, -3.5)
})

test('calibrating at rest yields exactly zero', () => {
  const raw = gravityToTilt({ x: 0.02, y: -0.03, z: 0.999 })
  const t = applyCalibration(raw, raw)
  near(t.pitch, 0)
  near(t.roll, 0)
})
