// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normaliseGravity } from '../js/ctx.js'
import { gravityToTilt } from '../dsp/tilt.js'

test('android values pass through untouched', () => {
  const raw = { x: 0, y: 0, z: 9.81 }
  assert.deepEqual(normaliseGravity(raw, false), raw)
})

test('ios values are negated into the W3C convention', () => {
  // Expected value is +0, not -0: normaliseGravity collapses negative zero to
  // positive zero (see the exactly-zero-axis test below for why that matters).
  assert.deepEqual(normaliseGravity({ x: 0, y: 0, z: -9.81 }, true), { x: 0, y: 0, z: 9.81 })
})

test('both platforms flat-screen-up produce a level reading', () => {
  const android = gravityToTilt(normaliseGravity({ x: 0, y: 0, z: 9.81 }, false))
  const ios = gravityToTilt(normaliseGravity({ x: 0, y: 0, z: -9.81 }, true))
  assert.equal(Math.abs(android.pitch) < 1e-9, true)
  assert.equal(Math.abs(ios.pitch) < 1e-9, true)
  assert.equal(Math.abs(android.roll) < 1e-9, true)
  assert.equal(Math.abs(ios.roll) < 1e-9, true)
})

test('both platforms agree on the sign of a raised top edge', () => {
  // Top edge raised 45°: world-up in device coords is (0, +0.707, +0.707)·9.81.
  // Android reports that directly; iOS reports its negation.
  const android = gravityToTilt(normaliseGravity({ x: 0, y: 6.94, z: 6.94 }, false))
  const ios = gravityToTilt(normaliseGravity({ x: 0, y: -6.94, z: -6.94 }, true))
  assert.ok(android.pitch > 44 && android.pitch < 46, `android pitch was ${android.pitch}`)
  assert.ok(ios.pitch > 44 && ios.pitch < 46, `ios pitch was ${ios.pitch}`)
})

test('null components are treated as zero rather than producing NaN', () => {
  const g = normaliseGravity(/** @type {any} */ ({ x: null, y: undefined, z: 9.81 }), false)
  assert.equal(Number.isNaN(g.x), false)
  assert.equal(Number.isNaN(g.y), false)
  assert.equal(g.z, 9.81)
})

test('the platform-agreement test fails if iosSigns is ignored', () => {
  // Regression guard on the test suite itself: a normaliseGravity that ignores
  // iosSigns entirely (returns raw unchanged) must NOT satisfy the raised-edge
  // agreement above. This pins down that the test above is actually exercising
  // the flag, not just checking two coincidentally-equal numbers.
  const identity = (/** @type {{x:number,y:number,z:number}} */ raw) => raw
  const android = gravityToTilt(identity({ x: 0, y: 6.94, z: 6.94 }))
  const iosIgnored = gravityToTilt(identity({ x: 0, y: -6.94, z: -6.94 }))
  assert.ok(!(iosIgnored.pitch > 44 && iosIgnored.pitch < 46), `expected ignoring iosSigns to break agreement, got pitch ${iosIgnored.pitch}`)
  assert.ok(android.pitch > 44 && android.pitch < 46)
})

test('platforms agree at orientations with an exactly-zero axis', () => {
  // Top edge raised 90°: x and z are exactly zero, so a -0 leaking through
  // would send atan2 into a different quadrant on one platform only.
  const android = gravityToTilt(normaliseGravity({ x: 0, y: 9.81, z: 0 }, false))
  const ios = gravityToTilt(normaliseGravity({ x: -0, y: -9.81, z: -0 }, true))
  assert.equal(android.pitch, ios.pitch, 'pitch must agree across platforms')
  assert.equal(android.roll, ios.roll, `roll must agree: android ${android.roll}, ios ${ios.roll}`)
  assert.equal(Object.is(normaliseGravity({ x: -0, y: 0, z: 0 }, true).x, -0), false,
    'normaliseGravity must never emit negative zero')
})
