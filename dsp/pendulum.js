// @ts-check

/**
 * @typedef {[number, number, number, number]} State
 * θ1, θ2, ω1, ω2 — angles from vertical (radians) and angular velocities
 * (radians/s) of the upper and lower arms.
 */

/**
 * @typedef {Object} Params
 * @property {number} g gravitational acceleration, m/s²
 * @property {number} l1 upper arm length, m
 * @property {number} l2 lower arm length, m
 * @property {number} m1 upper bob mass, kg
 * @property {number} m2 lower bob mass, kg
 * @property {number} gravityAngle direction gravity points, radians, measured
 * the same way as θ1/θ2 (0 = straight down). Lets gravity be a vector rather
 * than always pointing along the θ=0 axis — e.g. to drive the pendulum from a
 * phone accelerometer.
 */

/** @type {Params} */
export const DEFAULT_PARAMS = { g: 9.81, l1: 1, l2: 1, m1: 1, m2: 1, gravityAngle: 0 }

/**
 * Time derivative of the state under the standard double-pendulum
 * Lagrangian (two point masses on massless rigid rods, no friction).
 *
 * Standard closed-form equations of motion — see e.g. Eric Weisstein's
 * "Double Pendulum" or any classical-mechanics derivation via the
 * Euler-Lagrange equations for θ1 and θ2.
 *
 * @param {State} state
 * @param {Params} params
 * @returns {State}
 */
export function derivative(state, params) {
  const [t1, t2, w1, w2] = state
  const { g, l1, l2, m1, m2, gravityAngle: phi } = params

  const dt = t1 - t2
  const sinDt = Math.sin(dt)
  const cosDt = Math.cos(dt)
  const denom = 2 * m1 + m2 - m2 * Math.cos(2 * dt)

  const num1 =
    -g * (2 * m1 + m2) * Math.sin(t1 - phi) -
    m2 * g * Math.sin(t1 - 2 * t2 + phi) -
    2 * sinDt * m2 * (w2 * w2 * l2 + w1 * w1 * l1 * cosDt)
  const a1 = num1 / (l1 * denom)

  const num2 =
    2 * sinDt *
    (w1 * w1 * l1 * (m1 + m2) +
      g * (m1 + m2) * Math.cos(t1 - phi) +
      w2 * w2 * l2 * m2 * cosDt)
  const a2 = num2 / (l2 * denom)

  return [w1, w2, a1, a2]
}

/**
 * One classical fourth-order Runge-Kutta step.
 *
 * @param {State} state
 * @param {Params} params
 * @param {number} dt seconds
 * @returns {State}
 */
export function rk4Step(state, params, dt) {
  const k1 = derivative(state, params)
  const s2 = /** @type {State} */ ([
    state[0] + (dt / 2) * k1[0],
    state[1] + (dt / 2) * k1[1],
    state[2] + (dt / 2) * k1[2],
    state[3] + (dt / 2) * k1[3],
  ])
  const k2 = derivative(s2, params)
  const s3 = /** @type {State} */ ([
    state[0] + (dt / 2) * k2[0],
    state[1] + (dt / 2) * k2[1],
    state[2] + (dt / 2) * k2[2],
    state[3] + (dt / 2) * k2[3],
  ])
  const k3 = derivative(s3, params)
  const s4 = /** @type {State} */ ([
    state[0] + dt * k3[0],
    state[1] + dt * k3[1],
    state[2] + dt * k3[2],
    state[3] + dt * k3[3],
  ])
  const k4 = derivative(s4, params)

  return [
    state[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    state[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
    state[2] + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
    state[3] + (dt / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]),
  ]
}

/**
 * Advance by `dt` total, taken as `substeps` equal RK4 steps of `dt/substeps`
 * each — finer internal stepping without the caller managing the loop.
 *
 * @param {State} state
 * @param {Params} params
 * @param {number} dt total seconds to advance
 * @param {number} substeps number of RK4 steps to divide dt into
 * @returns {State}
 */
export function advance(state, params, dt, substeps) {
  const h = dt / substeps
  let s = state
  for (let i = 0; i < substeps; i++) s = rk4Step(s, params, h)
  return s
}

/**
 * Total mechanical energy (kinetic + potential), zeroed at both bobs
 * hanging along gravity (θ1 = θ2 = gravityAngle).
 *
 * KE = ½m₁(l₁ω₁)² + ½m₂[(l₁ω₁)² + (l₂ω₂)² + 2l₁l₂ω₁ω₂cos(θ₁−θ₂)]
 * PE = −(m₁+m₂)g·l₁cos(θ₁−φ) − m₂g·l₂cos(θ₂−φ)
 *
 * @param {State} state
 * @param {Params} params
 * @returns {number} joules (per unit mass scale implied by params)
 */
export function energy(state, params) {
  const [t1, t2, w1, w2] = state
  const { g, l1, l2, m1, m2, gravityAngle: phi } = params

  const v1sq = l1 * l1 * w1 * w1
  const v2sq = l2 * l2 * w2 * w2
  const cross = 2 * l1 * l2 * w1 * w2 * Math.cos(t1 - t2)

  const ke = 0.5 * m1 * v1sq + 0.5 * m2 * (v1sq + v2sq + cross)
  const pe = -(m1 + m2) * g * l1 * Math.cos(t1 - phi) - m2 * g * l2 * Math.cos(t2 - phi)

  return ke + pe
}

/** Wrap an angle into (−π, π]. @param {number} a */
function wrapAngle(a) {
  const twoPi = 2 * Math.PI
  let w = ((a + Math.PI) % twoPi + twoPi) % twoPi - Math.PI
  if (w <= -Math.PI) w += twoPi
  return w
}

/**
 * Angular distance between two states: the hypotenuse of the two angle
 * differences, each wrapped into (−π, π] so that a full turn reads as no
 * difference at all.
 *
 * @param {State} a
 * @param {State} b
 * @returns {number}
 */
export function separation(a, b) {
  const d1 = wrapAngle(a[0] - b[0])
  const d2 = wrapAngle(a[1] - b[1])
  return Math.sqrt(d1 * d1 + d2 * d2)
}
