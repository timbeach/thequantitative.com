// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shortestAngleDiff, smoothAngle, createAimSmoother, createStarLock } from '../dsp/aim.js'

/** @param {number} a @param {number} b @param {number} [eps] @param {string} [what] */
const near = (a, b, eps = 1e-9, what = '') =>
  assert.ok(Math.abs(a - b) < eps, `${what} expected ${a} within ${eps} of ${b}`)

test('shortestAngleDiff takes the short way around', () => {
  near(shortestAngleDiff(0, 10), 10)
  near(shortestAngleDiff(10, 0), -10)
  near(shortestAngleDiff(359, 1), 2, 1e-9, 'crossing north forwards:')
  near(shortestAngleDiff(1, 359), -2, 1e-9, 'crossing north backwards:')
  near(shortestAngleDiff(350, 20), 30)
  near(shortestAngleDiff(20, 350), -30)
})

test('shortestAngleDiff is bounded to (-180, 180]', () => {
  for (let a = 0; a < 360; a += 7) {
    for (let b = 0; b < 360; b += 11) {
      const d = shortestAngleDiff(a, b)
      assert.ok(d > -180.0001 && d <= 180.0001, `${a}->${b} gave ${d}`)
    }
  }
})

test('SMOOTHING ACROSS NORTH TAKES THE SHORT ARC, NOT THE LONG ONE', () => {
  // The bug this exists to prevent: naive smoothing from 359 toward 1 passes
  // through 180, sweeping the aim backwards across the entire sky.
  let a = 359
  for (let i = 0; i < 8; i++) a = smoothAngle(a, 1, 0.3)
  // After eight steps it should be close to 1, having crossed 0 — never near 180.
  const dist = Math.abs(shortestAngleDiff(a, 1))
  assert.ok(dist < 15, `expected to converge on 1, ended at ${a}`)
  // And it must never have gone the wrong way on the first step.
  const first = smoothAngle(359, 1, 0.3)
  assert.ok(first > 359 || first < 1, `first step went the long way: ${first}`)
})

test('smoothAngle output stays in [0, 360)', () => {
  let a = 5
  for (let i = 0; i < 200; i++) {
    a = smoothAngle(a, (i * 37) % 360, 0.4)
    assert.ok(a >= 0 && a < 360, `escaped range: ${a}`)
  }
})

test('smoothAngle with alpha 1 jumps straight there, alpha 0 holds', () => {
  near(smoothAngle(100, 250, 1), 250, 1e-9)
  near(smoothAngle(100, 250, 0), 100, 1e-9)
})

test('the smoother converges on a held direction', () => {
  const smooth = createAimSmoother()
  let out = { alt: 0, az: 0, speed: 0 }
  for (let i = 0; i < 200; i++) out = smooth(45, 120, 1 / 60)
  near(out.alt, 45, 0.5)
  near(out.az, 120, 0.5)
  assert.ok(out.speed < 1, `a held aim should read near-zero speed, got ${out.speed}`)
})

test('the smoother is heavier when still than when sweeping', () => {
  // A step change applied to a still smoother should move LESS in one frame
  // than the same step applied to one already sweeping fast.
  const still = createAimSmoother()
  for (let i = 0; i < 60; i++) still(10, 10, 1 / 60)
  const afterStill = still(10, 40, 1 / 60)

  const moving = createAimSmoother()
  let az = 10
  for (let i = 0; i < 60; i++) { az += 2; moving(10, az, 1 / 60) }   // ~120 deg/s
  const before = moving(10, az, 1 / 60).az
  const afterMoving = moving(10, before + 30, 1 / 60)

  const stillStep = Math.abs(shortestAngleDiff(10, afterStill.az))
  const movingStep = Math.abs(shortestAngleDiff(before, afterMoving.az))
  assert.ok(movingStep > stillStep,
    `sweeping should respond faster: still moved ${stillStep}, moving moved ${movingStep}`)
})

test('the smoother reports angular speed in degrees per second', () => {
  const smooth = createAimSmoother({ tauStill: 0, tauMoving: 0 })   // no smoothing
  let az = 0
  let out = { alt: 0, az: 0, speed: 0 }
  for (let i = 0; i < 30; i++) { az += 1; out = smooth(0, az, 1 / 60) }  // 60 deg/s
  assert.ok(out.speed > 30 && out.speed < 90, `expected ~60 deg/s, got ${out.speed}`)
})

test('the smoother handles the wrap without a speed spike', () => {
  const smooth = createAimSmoother({ tauStill: 0, tauMoving: 0 })
  let out = { alt: 0, az: 0, speed: 0 }
  for (const az of [358, 359, 0, 1, 2]) out = smooth(0, az, 1 / 60)
  // 1 degree per frame at 60 Hz is 60 deg/s — crossing north must not read as 21540.
  assert.ok(out.speed < 200, `wrap produced a phantom speed spike: ${out.speed}`)
})

test('the speed reported ON THE CROSSING FRAME ITSELF is not a spike', () => {
  // The test above only inspects the value a few frames after the crossing,
  // by which point a spike would already have decayed back down — it would
  // pass even if the crossing frame briefly reported a huge phantom speed.
  // Check the frame that actually does the 359->0 wrap directly.
  const smooth = createAimSmoother({ tauStill: 0, tauMoving: 0 })
  smooth(0, 358, 1 / 60)
  smooth(0, 359, 1 / 60)
  const crossing = smooth(0, 0, 1 / 60)   // 359 -> 0 is one degree the short way
  assert.ok(crossing.speed < 200, `crossing frame itself spiked: ${crossing.speed}`)
})

test('the lock requires a dwell before acquiring', () => {
  const lock = createStarLock({ acquireDeg: 8, releaseDeg: 14, dwellFrames: 3 })
  assert.equal(lock([{ name: 'Vega', sep: 5 }]), null, 'frame 1')
  assert.equal(lock([{ name: 'Vega', sep: 5 }]), null, 'frame 2')
  assert.equal(lock([{ name: 'Vega', sep: 5 }])?.name, 'Vega', 'frame 3 acquires')
})

test('THE LOCK HOLDS PAST THE ACQUIRE THRESHOLD — the anti-flicker guarantee', () => {
  const lock = createStarLock({ acquireDeg: 8, releaseDeg: 14, dwellFrames: 3 })
  for (let i = 0; i < 3; i++) lock([{ name: 'Vega', sep: 5 }])
  // Now drift out past the ACQUIRE threshold but within RELEASE.
  for (const sep of [9, 11, 13]) {
    assert.equal(lock([{ name: 'Vega', sep }])?.name, 'Vega', `held at ${sep} degrees`)
  }
  // Past release it lets go.
  assert.equal(lock([{ name: 'Vega', sep: 15 }]), null, 'released past 14 degrees')
})

test('the lock reports dwell progress so the UI can show it acquiring', () => {
  const lock = createStarLock({ acquireDeg: 8, releaseDeg: 14, dwellFrames: 4 })
  const a = lock([{ name: 'Vega', sep: 5 }])
  const b = lock([{ name: 'Vega', sep: 5 }])
  assert.equal(a, null)
  assert.equal(b, null)
  // Once locked, dwell is at its maximum.
  lock([{ name: 'Vega', sep: 5 }])
  const locked = lock([{ name: 'Vega', sep: 5 }])
  assert.ok(locked)
  assert.equal(locked.dwell, 1, 'a held lock reports full dwell')
})

test('dwell resets when the candidate changes', () => {
  const lock = createStarLock({ acquireDeg: 8, releaseDeg: 14, dwellFrames: 3 })
  lock([{ name: 'Vega', sep: 5 }])
  lock([{ name: 'Vega', sep: 5 }])
  lock([{ name: 'Altair', sep: 4 }])          // different star — start over
  assert.equal(lock([{ name: 'Altair', sep: 4 }]), null, 'only two frames of Altair')
  assert.equal(lock([{ name: 'Altair', sep: 4 }])?.name, 'Altair', 'third frame acquires')
})

test('the lock takes the first candidate within range, preserving brightest-first', () => {
  const lock = createStarLock({ acquireDeg: 8, releaseDeg: 14, dwellFrames: 1 })
  // Candidates arrive sorted brightest-first. A mag 0 star at 7 degrees beats a
  // mag 2 star at 2 degrees — that is what the user meant to point at.
  const got = lock([{ name: 'Vega', sep: 7 }, { name: 'Dim', sep: 2 }])
  assert.equal(got?.name, 'Vega')
})

test('an empty candidate list releases the lock', () => {
  const lock = createStarLock({ acquireDeg: 8, releaseDeg: 14, dwellFrames: 1 })
  assert.equal(lock([{ name: 'Vega', sep: 5 }])?.name, 'Vega')
  assert.equal(lock([]), null, 'nothing in the cone means no lock')
})

test('a locked star that vanishes from the candidate list is released', () => {
  const lock = createStarLock({ acquireDeg: 8, releaseDeg: 14, dwellFrames: 1 })
  lock([{ name: 'Vega', sep: 5 }])
  assert.equal(lock([{ name: 'Altair', sep: 3 }])?.name, 'Altair')
})
