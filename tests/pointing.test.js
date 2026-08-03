// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  orientationMatrix, applyMatrix, pointingDirection, POINT_BACK, POINT_FRONT,
} from '../dsp/pointing.js'

/** @param {number} a @param {number} b @param {number} [eps] @param {string} [what] */
const near = (a, b, eps = 1e-6, what = '') =>
  assert.ok(Math.abs(a - b) < eps, `${what} expected ${a} within ${eps} of ${b}`)

/** Compare azimuths allowing for the 360 wrap.
 * @param {number} a @param {number} b @param {number} [eps] @param {string} [what] */
const nearAz = (a, b, eps = 1e-6, what = '') => {
  const d = Math.abs(((a - b + 540) % 360) - 180)
  assert.ok(d < eps, `${what} azimuth ${a} is ${d} from ${b}`)
}

test('the identity orientation gives the identity matrix', () => {
  const m = orientationMatrix(0, 0, 0)
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  m.forEach((v, i) => near(v, I[i] ?? NaN, 1e-12, `element ${i}:`))
})

test('the matrix is orthonormal at arbitrary angles', () => {
  // A rotation matrix must preserve length; if it does not, the decomposition
  // is wrong and every pointing direction is subtly distorted.
  /** @type {[number, number, number][]} */
  const angles = [[37, 61, 23], [180, 90, 45], [270, 150, -80]]
  for (const [a, b, g] of angles) {
    const m = orientationMatrix(a, b, g)
    for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      const w = applyMatrix(m, /** @type {[number,number,number]} */ (v))
      near(Math.hypot(w[0], w[1], w[2]), 1, 1e-12, `${a}/${b}/${g}:`)
    }
  }
})

test('orientationMatrix matches the closed-form values at a nontrivial angle', () => {
  // pointingDirection only ever multiplies the matrix by (0,0,+/-1), which
  // reaches just the third column — the first two columns (everything a
  // nonzero x or y component would touch, including the lone beta term at
  // index 7) are otherwise never checked against a real value, only via the
  // norm-preservation test above, and norm is insensitive to the sign of a
  // single squared term. Pin the whole matrix by value so a scrambled or
  // sign-flipped entry anywhere is caught even if it never reaches an alt/az
  // reading through POINT_BACK or POINT_FRONT.
  const m = orientationMatrix(30, 40, 50)
  const expected = [
    0.310468460973, -0.383022221559, 0.870001903752,
    0.747828070819, 0.663413948169, 0.025201386257,
    -0.586824088833, 0.642787609687, 0.492403876506,
  ]
  m.forEach((v, i) => near(v, expected[i] ?? NaN, 1e-9, `element ${i}:`))
})

test('flat on the table, the back points straight down', () => {
  const { alt } = pointingDirection({ alpha: 0, beta: 0, gamma: 0 }, POINT_BACK)
  near(alt, -90, 1e-9)
})

test('FLAT WITH THE SCREEN UP, THE FRONT POINTS AT THE ZENITH', () => {
  // This is what makes the flip worth having: the phone can be held
  // comfortably flat instead of overhead.
  const { alt } = pointingDirection({ alpha: 0, beta: 0, gamma: 0 }, POINT_FRONT)
  near(alt, 90, 1e-9)
})

test('screen down, the back points at the zenith', () => {
  const { alt } = pointingDirection({ alpha: 0, beta: 180, gamma: 0 }, POINT_BACK)
  near(alt, 90, 1e-9)
})

test('held upright, the back points at the horizon', () => {
  const { alt } = pointingDirection({ alpha: 0, beta: 90, gamma: 0 }, POINT_BACK)
  near(alt, 0, 1e-9)
})

test('alpha rotates the azimuth when the phone is upright', () => {
  /** @type {[number, number][]} */
  const cases = [[0, 0], [90, 270], [180, 180], [270, 90]]
  for (const [alpha, expected] of cases) {
    const { az } = pointingDirection({ alpha, beta: 90, gamma: 0 }, POINT_BACK)
    nearAz(az, expected, 1e-6, `alpha ${alpha}:`)
  }
})

test('GAMMA SWINGS THE AZIMUTH AT BETA 90 — the bug this module exists to fix', () => {
  // Alpha-only pointing reports a fixed azimuth here. The true aim swings
  // through 90 degrees as gamma changes, because at beta = 90 the Euler
  // decomposition is degenerate and a body turn lands in gamma, not alpha.
  /** @type {[number, number][]} */
  const cases = [[0, 0], [30, 330], [60, 300], [90, 270]]
  for (const [gamma, expected] of cases) {
    const { az } = pointingDirection({ alpha: 0, beta: 90, gamma }, POINT_BACK)
    nearAz(az, expected, 1e-6, `gamma ${gamma}:`)
  }
})

test('a tilted phone still tracks alpha correctly', () => {
  /** @type {[number, number][]} */
  const cases = [[0, 0], [90, 270], [180, 180]]
  for (const [alpha, expected] of cases) {
    const { az } = pointingDirection({ alpha, beta: 150, gamma: 0 }, POINT_BACK)
    nearAz(az, expected, 1e-6, `alpha ${alpha} at beta 150:`)
  }
})

test('front and back point in opposite directions', () => {
  for (const [a, b, g] of [[0, 45, 0], [90, 60, 20], [200, 120, -30]]) {
    const back = pointingDirection({ alpha: a, beta: b, gamma: g }, POINT_BACK)
    const front = pointingDirection({ alpha: a, beta: b, gamma: g }, POINT_FRONT)
    near(back.alt, -front.alt, 1e-9, `altitude at ${a}/${b}/${g}:`)
    nearAz(back.az, front.az + 180, 1e-6, `azimuth at ${a}/${b}/${g}:`)
  }
})

test('altitude is always within +/-90 and azimuth within [0,360)', () => {
  for (let a = 0; a < 360; a += 47) {
    for (let b = -180; b <= 180; b += 37) {
      for (let g = -90; g <= 90; g += 31) {
        const { alt, az } = pointingDirection({ alpha: a, beta: b, gamma: g }, POINT_BACK)
        assert.ok(alt >= -90.001 && alt <= 90.001, `alt ${alt} at ${a}/${b}/${g}`)
        assert.ok(az >= 0 && az < 360, `az ${az} at ${a}/${b}/${g}`)
      }
    }
  }
})

test('a rotated screen rotates the aim by the screen angle', () => {
  const upright = pointingDirection({ alpha: 0, beta: 90, gamma: 0, screenAngle: 0 }, POINT_BACK)
  const landscape = pointingDirection({ alpha: 0, beta: 90, gamma: 0, screenAngle: 90 }, POINT_BACK)
  // Turning the phone to landscape must not change where it points, once the
  // screen angle is accounted for — the device rotated, the aim did not.
  near(upright.alt, landscape.alt, 1e-6)
})

test('missing angles are treated as zero rather than producing NaN', () => {
  const r = pointingDirection(
    /** @type {any} */ ({ alpha: null, beta: undefined, gamma: NaN }), POINT_BACK)
  assert.equal(Number.isNaN(r.alt), false)
  assert.equal(Number.isNaN(r.az), false)
})
