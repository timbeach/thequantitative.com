// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGravityFilter, createPeakHold, rms } from '../dsp/seismo.js'

const DT = 1 / 60
/** @param {number} a @param {number} b @param {number} eps @param {string} [what] */
const near = (a, b, eps, what = '') =>
  assert.ok(Math.abs(a - b) < eps, `${what} expected ${a} within ${eps} of ${b}`)

/**
 * Feed a constant vector for `seconds` and return the last output.
 * @param {(v: {x:number,y:number,z:number}, dt: number) => {linear:{x:number,y:number,z:number}, magnitude:number}} filter
 * @param {{x:number,y:number,z:number}} v
 * @param {number} [seconds]
 */
function settle(filter, v, seconds = 10) {
  let out = { linear: { x: 0, y: 0, z: 0 }, magnitude: 0 }
  for (let i = 0; i < seconds / DT; i++) out = filter(v, DT)
  return out
}

test('gravity is removed completely when the phone is still', () => {
  const f = createGravityFilter()
  const out = settle(f, { x: 0, y: 0, z: 9.81 })
  near(out.magnitude, 0, 1e-6, 'a still phone must read zero:')
})

test('gravity is removed whatever direction it points', () => {
  for (const v of [{ x: 9.81, y: 0, z: 0 }, { x: 0, y: -9.81, z: 0 }, { x: 5, y: 5, z: 5 }]) {
    near(settle(createGravityFilter(), v).magnitude, 0, 1e-6)
  }
})

test('the first sample does not register as a huge transient', () => {
  // Seeding the gravity estimate from the first reading, rather than zero,
  // is what stops the instrument screaming 9.81 the moment it mounts.
  const f = createGravityFilter()
  const first = f({ x: 0, y: 0, z: 9.81 }, DT)
  near(first.magnitude, 0, 1e-9, 'first sample:')
})

test('AN IMPULSE PASSES THROUGH — this is what a footstep is', () => {
  const f = createGravityFilter()
  settle(f, { x: 0, y: 0, z: 9.81 })
  let peak = 0
  for (let i = 0; i < 60; i++) {
    const bump = i < 6 ? 0.4 * Math.sin((Math.PI * i) / 6) : 0
    peak = Math.max(peak, f({ x: 0, y: 0, z: 9.81 + bump }, DT).magnitude)
  }
  assert.ok(peak > 0.3, `a 0.4 m/s^2 impulse should pass, got ${peak}`)
  assert.ok(peak < 0.45, `and should not be amplified, got ${peak}`)
})

test('a sustained offset decays away — it becomes the new gravity', () => {
  const f = createGravityFilter()
  settle(f, { x: 0, y: 0, z: 9.81 })
  const out = settle(f, { x: 0, y: 0, z: 10.5 }, 10)
  near(out.magnitude, 0, 1e-3, 'after 10 s a constant offset is absorbed:')
})

test('the corner frequency is where it should be', () => {
  // tau = 0.8 s puts the corner near 0.2 Hz: footsteps (1-5 Hz) pass,
  // deliberate tilting (well under 0.2 Hz) does not.
  /** @param {number} hz */
  const gain = (hz) => {
    const f = createGravityFilter()
    settle(f, { x: 0, y: 0, z: 9.81 })
    let mx = 0
    for (let i = 0; i < 6 / DT; i++) {
      const s = 0.5 * Math.sin(2 * Math.PI * hz * i * DT)
      mx = Math.max(mx, f({ x: 0, y: 0, z: 9.81 + s }, DT).magnitude)
    }
    return mx / 0.5
  }
  assert.ok(gain(0.05) < 0.4, `0.05 Hz should be rejected, got ${gain(0.05)}`)
  assert.ok(gain(1) > 0.9, `1 Hz should pass, got ${gain(1)}`)
  assert.ok(gain(3) > 0.9, `3 Hz should pass, got ${gain(3)}`)
})

test('magnitude is never negative', () => {
  const f = createGravityFilter()
  for (let i = 0; i < 500; i++) {
    const out = f({ x: Math.sin(i), y: Math.cos(i * 3), z: 9.81 + Math.sin(i * 7) }, DT)
    assert.ok(out.magnitude >= 0, `got ${out.magnitude}`)
  }
})

test('a longer time constant rejects more low frequency', () => {
  /** @param {number} tau */
  const slowGain = (tau) => {
    const f = createGravityFilter({ tau })
    settle(f, { x: 0, y: 0, z: 9.81 })
    let mx = 0
    for (let i = 0; i < 20 / DT; i++) {
      const s = 0.5 * Math.sin(2 * Math.PI * 0.1 * i * DT)
      mx = Math.max(mx, f({ x: 0, y: 0, z: 9.81 + s }, DT).magnitude)
    }
    return mx
  }
  assert.ok(slowGain(2) > slowGain(0.3), 'a longer tau should let more 0.1 Hz through')
})

test('peak hold captures a spike and decays', () => {
  const hold = createPeakHold({ decayPerSecond: 0.5 })
  near(hold(0.8, DT), 0.8, 1e-9, 'captures immediately:')
  for (let i = 0; i < 30; i++) hold(0.01, DT)
  const after = hold(0.01, DT)
  assert.ok(after < 0.8 && after > 0.1, `should decay gradually, got ${after}`)
})

test('peak hold rises instantly to a new maximum', () => {
  const hold = createPeakHold()
  hold(0.2, DT)
  near(hold(1.5, DT), 1.5, 1e-9, 'a bigger spike takes over at once:')
})

test('peak hold never goes negative', () => {
  const hold = createPeakHold({ decayPerSecond: 10 })
  hold(0.5, DT)
  for (let i = 0; i < 600; i++) assert.ok(hold(0, DT) >= 0)
})

test('rms of silence is zero and of a constant is that constant', () => {
  near(rms([0, 0, 0]), 0, 1e-12)
  near(rms([3, 3, 3, 3]), 3, 1e-12)
  near(rms([]), 0, 1e-12, 'empty input must not be NaN:')
})

test('rms of a sine is the amplitude over root two', () => {
  const xs = Array.from({ length: 1000 }, (_, i) => Math.sin((2 * Math.PI * i) / 100))
  near(rms(xs), 1 / Math.SQRT2, 0.01)
})
