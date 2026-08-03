// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  rk4Step, advance, energy, separation, derivative, DEFAULT_PARAMS,
} from '../dsp/pendulum.js'

const P = DEFAULT_PARAMS
/** @param {number} a @param {number} b @param {number} eps @param {string} [what] */
const near = (a, b, eps, what = '') =>
  assert.ok(Math.abs(a - b) < eps, `${what} expected ${a} within ${eps} of ${b}`)

/**
 * @typedef {[number, number, number, number]} State
 */

/**
 * Run for `seconds` at `dt`, returning the final state.
 * @param {State} state
 * @param {number} seconds
 * @param {number} dt
 * @returns {State}
 */
function run(state, seconds, dt) {
  const steps = Math.round(seconds / dt)
  let s = state
  for (let i = 0; i < steps; i++) s = rk4Step(s, P, dt)
  return s
}

/**
 * Period of θ1 measured between upward zero crossings.
 * @param {State} state
 * @param {number} [dt]
 * @param {number} [maxSeconds]
 */
function periodOf(state, dt = 1 / 2000, maxSeconds = 100) {
  let s = state
  let prev = s[0]
  /** @type {number[]} */
  const crossings = []
  for (let i = 1; i < maxSeconds / dt; i++) {
    s = rk4Step(s, P, dt)
    if (prev < 0 && s[0] >= 0) crossings.push(i * dt)
    prev = s[0]
    if (crossings.length >= 3) break
  }
  return (crossings[2] ?? NaN) - (crossings[1] ?? NaN)
}

test('a pendulum hanging straight down at rest stays there', () => {
  const s = run([0, 0, 0, 0], 10, 1 / 240)
  for (const v of s) near(v, 0, 1e-12)
})

test('hanging straight down is the minimum-energy state', () => {
  const rest = energy([0, 0, 0, 0], P)
  /** @type {[number, number][]} */
  const pairs = [[0.3, 0], [0, 0.3], [1, 1], [Math.PI, 0]]
  for (const [t1, t2] of pairs) {
    assert.ok(energy([t1, t2, 0, 0], P) > rest,
      `state ${t1},${t2} should have more energy than rest`)
  }
})

test('ENERGY IS CONSERVED — the integrator quality check', () => {
  // A chaotic system whose energy drifts is lying about its own trajectory.
  const s0 = /** @type {[number,number,number,number]} */ ([Math.PI / 2 + 0.4, Math.PI / 2, 0, 0])
  const E0 = energy(s0, P)
  const s = run(s0, 60, 1 / 240)
  const drift = Math.abs((energy(s, P) - E0) / E0)
  assert.ok(drift < 1e-4, `energy drifted by ${drift.toExponential(2)} over 60 s at dt=1/240`)
})

test('a finer step conserves energy better', () => {
  const s0 = /** @type {[number,number,number,number]} */ ([Math.PI / 2 + 0.4, Math.PI / 2, 0, 0])
  const E0 = energy(s0, P)
  const coarse = Math.abs((energy(run(s0, 20, 1 / 60), P) - E0) / E0)
  const fine = Math.abs((energy(run(s0, 20, 1 / 240), P) - E0) / E0)
  assert.ok(fine < coarse / 10, `1/240 (${fine.toExponential(2)}) should beat 1/60 (${coarse.toExponential(2)}) by >10x`)
})

test('THE SLOW NORMAL MODE MATCHES THEORY — validates the equations themselves', () => {
  // Energy conservation cannot catch wrong equations: any Hamiltonian system
  // conserves its own energy while modelling the wrong universe. The normal
  // mode frequencies omega^2 = (2 +/- sqrt2)g/L pin the actual physics.
  const A = 1e-4
  const theory = 2 * Math.PI / Math.sqrt((2 - Math.SQRT2) * P.g / P.l1)
  near(periodOf([A, A * Math.SQRT2, 0, 0]), theory, 0.01, 'slow mode:')
})

test('THE FAST NORMAL MODE MATCHES THEORY', () => {
  const A = 1e-4
  const theory = 2 * Math.PI / Math.sqrt((2 + Math.SQRT2) * P.g / P.l1)
  near(periodOf([A, -A * Math.SQRT2, 0, 0]), theory, 0.01, 'fast mode:')
})

test('the simulation is deterministic', () => {
  const s0 = /** @type {[number,number,number,number]} */ ([1.2, 0.7, 0, 0])
  const a = run(s0, 5, 1 / 240)
  const b = run(s0, 5, 1 / 240)
  a.forEach((v, i) => assert.equal(v, b[i], `component ${i} differed between identical runs`))
})

test('CHAOS — a millionth of a radian grows to order unity', () => {
  const a0 = /** @type {[number,number,number,number]} */ ([Math.PI / 2 + 0.4, Math.PI / 2, 0, 0])
  const b0 = /** @type {[number,number,number,number]} */ ([Math.PI / 2 + 0.4 + 1e-6, Math.PI / 2, 0, 0])
  assert.ok(separation(a0, b0) < 2e-6, 'they start essentially identical')
  const a = run(a0, 30, 1 / 240)
  const b = run(b0, 30, 1 / 240)
  assert.ok(separation(a, b) > 1, `expected full divergence, got ${separation(a, b)}`)
})

test('divergence is exponential, not linear', () => {
  const a0 = /** @type {[number,number,number,number]} */ ([Math.PI / 2 + 0.4, Math.PI / 2, 0, 0])
  const b0 = /** @type {[number,number,number,number]} */ ([Math.PI / 2 + 0.4 + 1e-6, Math.PI / 2, 0, 0])
  let a = a0, b = b0
  /** @type {number[]} */
  const seps = []
  for (let i = 0; i < 4; i++) {
    a = run(a, 5, 1 / 240)
    b = run(b, 5, 1 / 240)
    seps.push(separation(a, b))
  }
  // Each 5-second interval multiplies the separation; linear growth would add.
  for (let i = 1; i < seps.length; i++) {
    assert.ok((seps[i] ?? 0) > (seps[i - 1] ?? 0) * 1.5,
      `interval ${i} grew only ${((seps[i] ?? 0) / (seps[i - 1] ?? 1)).toFixed(2)}x`)
  }
})

test('separation measures angular distance and handles the wrap', () => {
  near(separation([0, 0, 0, 0], [0, 0, 0, 0]), 0, 1e-12)
  near(separation([0, 0, 0, 0], [0.3, 0.4, 0, 0]), 0.5, 1e-9)
  // 359 degrees apart is really 1 degree apart.
  const twoPi = Math.PI * 2
  assert.ok(separation([0.01, 0, 0, 0], [0.01 + twoPi, 0, 0, 0]) < 1e-9,
    'a full turn is the same angle')
})

test('advance with substeps equals the same number of single steps', () => {
  const s0 = /** @type {[number,number,number,number]} */ ([1.0, 0.5, 0, 0])
  const viaAdvance = advance(s0, P, 1 / 60, 4)
  let viaSteps = s0
  for (let i = 0; i < 4; i++) viaSteps = rk4Step(viaSteps, P, 1 / 240)
  viaAdvance.forEach((v, i) => near(v, viaSteps[i] ?? NaN, 1e-12, `component ${i}:`))
})

test('an inverted pendulum is unstable but does not produce NaN', () => {
  const s = run([Math.PI, Math.PI, 0, 0], 20, 1 / 240)
  for (const v of s) assert.ok(Number.isFinite(v), `produced ${v}`)
})

test('heavier or longer arms change the period', () => {
  const A = 1e-4
  const base = periodOf([A, A * Math.SQRT2, 0, 0])
  // A longer upper arm must slow the slow mode.
  const longer = { ...P, l1: 2, l2: 2 }
  let s = /** @type {[number,number,number,number]} */ ([A, A * Math.SQRT2, 0, 0])
  let prev = s[0]
  /** @type {number[]} */
  const crossings = []
  for (let i = 1; i < 200000; i++) {
    s = rk4Step(s, longer, 1 / 2000)
    if (prev < 0 && s[0] >= 0) crossings.push(i / 2000)
    prev = s[0]
    if (crossings.length >= 3) break
  }
  const longPeriod = (crossings[2] ?? NaN) - (crossings[1] ?? NaN)
  assert.ok(longPeriod > base * 1.3, `longer arms should swing slower: ${longPeriod} vs ${base}`)
})

test('ENERGY IS CONSERVED WITH UNEQUAL MASSES — m1 and m2 are not interchangeable', () => {
  // DEFAULT_PARAMS has m1 === m2 === 1, so a bug that swaps m1 and m2
  // anywhere symmetric-looking (e.g. in the shared denominator term) is
  // invisible against every other test in this file. Unequal masses break
  // that symmetry: gravity's known lever imbalance between the two bobs is
  // otherwise exactly as easy to get backwards as its overall sign.
  const P2 = { ...P, m1: 1, m2: 3 }
  const s0 = /** @type {State} */ ([Math.PI / 2 + 0.4, Math.PI / 2, 0, 0])
  const E0 = energy(s0, P2)
  const dt = 1 / 1000
  let s = s0
  for (let i = 0; i < 20 / dt; i++) s = rk4Step(s, P2, dt)
  const drift = Math.abs((energy(s, P2) - E0) / E0)
  assert.ok(drift < 1e-4, `energy drifted by ${drift.toExponential(2)} over 20 s with m1=1, m2=3`)
})

test('gravityAngle 0 is bit-identical to the ungeneralised equations', () => {
  // A strict generalisation: this is what guarantees the existing 14 tests,
  // and the chaos demonstration, are untouched.
  const withAngle = { ...DEFAULT_PARAMS, gravityAngle: 0 }
  for (const s of [[1.2, 0.7, 0.3, -0.2], [0.1, -0.4, 0, 0], [2.5, 1.1, -1, 2]]) {
    const a = derivative(/** @type {any} */ (s), DEFAULT_PARAMS)
    const b = derivative(/** @type {any} */ (s), withAngle)
    a.forEach((v, i) => assert.equal(v, b[i], `component ${i} differed`))
  }
})

test('THE REST POSITION FOLLOWS GRAVITY', () => {
  for (const deg of [0, 20, 45, -30, 90]) {
    const phi = (deg * Math.PI) / 180
    const p = { ...DEFAULT_PARAMS, gravityAngle: phi }
    let s = /** @type {any} */ ([phi, phi, 0, 0])
    for (let i = 0; i < 2400; i++) s = rk4Step(s, p, 1 / 240)
    const moved = Math.hypot(s[0] - phi, s[1] - phi)
    assert.ok(moved < 1e-9, `phi=${deg} deg drifted ${moved} from equilibrium`)
  }
})

test('a hanging pendulum swings TOWARD tilted gravity', () => {
  const phi = Math.PI / 4
  const p = { ...DEFAULT_PARAMS, gravityAngle: phi }
  let s = /** @type {any} */ ([0, 0, 0, 0])
  for (let i = 0; i < 180; i++) s = rk4Step(s, p, 1 / 240)
  assert.ok(s[0] > 0.1, `expected a swing toward +45 deg, theta1 reached ${s[0]}`)
  assert.ok(s[0] < phi * 3, 'and it should not overshoot absurdly')
})

test('zero gravity leaves a resting pendulum at rest', () => {
  // Phone laid flat: in-plane gravity vanishes and the arms are weightless.
  const p = { ...DEFAULT_PARAMS, g: 0 }
  let s = /** @type {any} */ ([1.0, 0.5, 0, 0])
  for (let i = 0; i < 2400; i++) s = rk4Step(s, p, 1 / 240)
  assert.equal(Math.hypot(s[2], s[3]), 0, 'no gravity, no acceleration')
  assert.equal(s[0], 1.0)
})

test('zero gravity preserves existing angular momentum', () => {
  const p = { ...DEFAULT_PARAMS, g: 0 }
  let s = /** @type {any} */ ([1.0, 0.5, 0.4, -0.2])
  const E0 = energy(s, p)
  for (let i = 0; i < 2400; i++) s = rk4Step(s, p, 1 / 240)
  const drift = Math.abs((energy(s, p) - E0) / E0)
  assert.ok(drift < 1e-6, `energy drifted ${drift} with no gravity`)
})

test('energy accounts for the gravity direction', () => {
  const phi = Math.PI / 3
  const p = { ...DEFAULT_PARAMS, gravityAngle: phi }
  // Hanging along gravity is the minimum-energy state for that direction.
  const along = energy(/** @type {any} */ ([phi, phi, 0, 0]), p)
  for (const off of [0, 0.5, -0.5, Math.PI]) {
    assert.ok(energy(/** @type {any} */ ([phi + off || 0.2, phi, 0, 0]), p) >= along - 1e-9,
      'no state may sit below the hanging state')
  }
})

test('energy is conserved with gravity tilted', () => {
  const p = { ...DEFAULT_PARAMS, gravityAngle: 0.7 }
  const s0 = /** @type {any} */ ([Math.PI / 2 + 0.4, Math.PI / 2, 0, 0])
  const E0 = energy(s0, p)
  let s = s0
  for (let i = 0; i < 240 * 30; i++) s = rk4Step(s, p, 1 / 240)
  assert.ok(Math.abs((energy(s, p) - E0) / E0) < 1e-4, 'tilted gravity must still conserve energy')
})
