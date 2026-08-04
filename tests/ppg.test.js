// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { highPass2, estimateRate, resampleCubic, MIN_BPM, MAX_BPM } from '../dsp/ppg.js'

const SR = 30           // fps — a phone camera's typical capture rate
const DURATION = 15      // seconds, matching the verified table

/** Deterministic noise so every test is reproducible.
 * @param {number} seed
 */
function seededNoise(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 2 ** 32) * 2 - 1 }
}

/**
 * Synthetic PPG: a sharp systolic peak plus a dicrotic notch, repeating once
 * per pulse period, with optional linear drift, respiration, and noise
 * layered on top.
 * @param {number} bpm
 * @param {{
 *   sampleRate?: number, duration?: number, driftPerSec?: number,
 *   breathingHz?: number, breathingAmplitude?: number,
 *   noiseAmplitude?: number, seed?: number
 * }} [opts]
 */
function syntheticPPG(bpm, opts = {}) {
  const sampleRate = opts.sampleRate ?? SR
  const duration = opts.duration ?? DURATION
  const driftPerSec = opts.driftPerSec ?? 0
  const breathingHz = opts.breathingHz ?? 0.25
  const breathingAmplitude = opts.breathingAmplitude ?? 0
  const noiseAmplitude = opts.noiseAmplitude ?? 0
  const rnd = seededNoise(opts.seed ?? 1)

  const n = Math.round(sampleRate * duration)
  const x = new Float64Array(n)
  const hz = bpm / 60
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    const phase = (t * hz) % 1
    const pulse = Math.exp(-((phase - 0.15) ** 2) / 0.004) +
      0.35 * Math.exp(-((phase - 0.35) ** 2) / 0.006)
    const breathing = breathingAmplitude * Math.sin(2 * Math.PI * breathingHz * t)
    const drift = driftPerSec * t
    x[i] = pulse + breathing + drift + noiseAmplitude * rnd()
  }
  return x
}

/** @param {ArrayLike<number>} arr */
function rms(arr) {
  let sum = 0
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i] ?? 0
    sum += v * v
  }
  return Math.sqrt(sum / arr.length)
}

test('highPass2 removes a constant (DC) entirely', () => {
  const x = new Float64Array(200).fill(5)
  const y = highPass2(x, SR, 0.7)
  for (const v of y) assert.ok(Math.abs(v) < 1e-9, `expected ~0 for a DC input, got ${v}`)
})

test('highPass2 attenuates 0.25 Hz far more than 1.2 Hz', () => {
  const n = Math.round(SR * DURATION)
  const lowFreq = new Float64Array(n)
  const highFreq = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    lowFreq[i] = Math.sin(2 * Math.PI * 0.25 * t)
    highFreq[i] = Math.sin(2 * Math.PI * 1.2 * t)
  }
  const lowOut = highPass2(lowFreq, SR, 0.7)
  const highOut = highPass2(highFreq, SR, 0.7)

  // Compare steady-state RMS over the back half, past the filter's transient.
  const half = Math.floor(n / 2)
  const lowRatio = rms(lowOut.slice(half)) / rms(lowFreq.slice(half))
  const highRatio = rms(highOut.slice(half)) / rms(highFreq.slice(half))

  assert.ok(highRatio > 0.5, `1.2 Hz should pass through mostly intact, got ratio ${highRatio}`)
  assert.ok(lowRatio < highRatio / 3,
    `0.25 Hz must be attenuated far more than 1.2 Hz: low ratio ${lowRatio}, high ratio ${highRatio}`)
})

test('recovers clean synthetic PPG within 1 BPM at 45/60/72/140/180', () => {
  for (const bpm of [45, 60, 72, 140, 180]) {
    const x = syntheticPPG(bpm, { seed: bpm })
    const r = estimateRate(x, SR)
    assert.ok(r, `${bpm} BPM was not detected`)
    assert.ok(Math.abs(r.bpm - bpm) <= 1, `${bpm} BPM target -> got ${r.bpm}`)
  }
})

test('drift + breathing + noise at 72 BPM recovers within 2 BPM', () => {
  const x = syntheticPPG(72, { driftPerSec: 0.02, breathingAmplitude: 0.3, noiseAmplitude: 0.05, seed: 3 })
  const r = estimateRate(x, SR)
  assert.ok(r, '72 BPM with drift + breathing + noise was not detected')
  assert.ok(Math.abs(r.bpm - 72) <= 2, `got ${r.bpm}`)
})

test('55 BPM with heavy breathing recovers — the case that fails at a 0.5 Hz corner', () => {
  const x = syntheticPPG(55, { breathingAmplitude: 0.7, seed: 5 })
  const r = estimateRate(x, SR)
  assert.ok(r, '55 BPM with heavy breathing was not detected')
  assert.ok(Math.abs(r.bpm - 55) <= 1, `got ${r.bpm}`)
})

test('pure noise returns null rather than inventing a pulse', () => {
  const rnd = seededNoise(42)
  const n = Math.round(SR * DURATION)
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) x[i] = rnd()
  const r = estimateRate(x, SR)
  assert.equal(r, null, 'pure noise must not be reported as a pulse')
})

test('breathing alone, with no pulse, returns null', () => {
  const n = Math.round(SR * DURATION)
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) x[i] = Math.sin(2 * Math.PI * 0.25 * (i / SR))
  const r = estimateRate(x, SR)
  assert.equal(r, null, 'respiration alone must not be reported as a pulse')
})

test('noise refused by clarity ALONE — not by the range check riding to the rescue', () => {
  // Both "pure noise" and "breathing alone" above happen to settle on a rate
  // outside 40-200 BPM, so the range check alone is enough to null them —
  // a clean-signals-only suite could pass even with the clarity gate ripped
  // out. Seed 5 was picked because, with the gate disabled, this exact noise
  // resolves to 129.9 BPM: comfortably inside range, clarity 0.156. Only the
  // clarity gate — not the range check — can refuse this one.
  const rnd = seededNoise(5)
  const n = Math.round(SR * DURATION)
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) x[i] = rnd()
  const r = estimateRate(x, SR)
  assert.equal(r, null, 'low-clarity noise landing inside the BPM range must still be refused')
})

test('a constant signal returns null', () => {
  const x = new Float64Array(Math.round(SR * DURATION)).fill(3)
  const r = estimateRate(x, SR)
  assert.equal(r, null, 'a flat signal has no period to report')
})

test('rejects out-of-range results even when the filter does not catch them', () => {
  // 15 BPM = 0.25 Hz sits right on the breathing frequency the 0.7 Hz corner
  // is designed to suppress. Widen the corner here so the filter does NOT
  // catch it, proving the 40-200 BPM range check is a real, independent
  // safety net rather than dead code shadowed by the filter.
  const x = syntheticPPG(15, { seed: 9 })
  const r = estimateRate(x, SR, { cornerHz: 0.05 })
  assert.equal(r, null, '15 BPM is outside the physiological range and must be rejected')
})

test('clarity falls as noise rises', () => {
  const clean = estimateRate(syntheticPPG(70, { seed: 11 }), SR)
  const noisy = estimateRate(syntheticPPG(70, { noiseAmplitude: 0.4, seed: 11 }), SR)
  assert.ok(clean, 'clean signal should be detected')
  assert.ok(noisy, 'noisy signal should still be detected')
  assert.ok(clean.clarity > noisy.clarity, 'clarity must reflect signal quality')
})

test('exposes MIN_BPM and MAX_BPM as the documented physiological range', () => {
  assert.equal(MIN_BPM, 40)
  assert.equal(MAX_BPM, 200)
})

// ---------------------------------------------------------------------------
// The sweep.
//
// Five hand-picked rates (45/60/72/140/180) passed while eight rates between
// them reported exactly half or a third of the truth, every one of them at
// clarity 1.000. Spot checks cannot find that class of bug: whether a rate
// works depends on where its period falls relative to the sample grid, which
// is not a property any human would think to sample. So the range is swept
// whole, at every frame rate a phone camera plausibly delivers.
// ---------------------------------------------------------------------------

/**
 * PPG as a camera actually captures it: the sensor integrates light over the
 * exposure, so a frame is the MEAN of the signal across the frame interval,
 * not a point sample of it. That distinction matters at the top of the range —
 * point-sampling a sharp systolic peak at 20 fps aliases it, and the aliasing
 * masquerades as an algorithm failure.
 *
 * @param {number} bpm
 * @param {{ sampleRate?: number, duration?: number, driftPerSec?: number,
 *   breathingAmplitude?: number, noiseAmplitude?: number, seed?: number }} [opts]
 */
function capturedPPG(bpm, opts = {}) {
  const sampleRate = opts.sampleRate ?? SR
  const duration = opts.duration ?? DURATION
  const driftPerSec = opts.driftPerSec ?? 0
  const breathingAmplitude = opts.breathingAmplitude ?? 0
  const noiseAmplitude = opts.noiseAmplitude ?? 0
  const rnd = seededNoise(opts.seed ?? 1)

  const SUBSAMPLES = 32          // per frame, integrated to model the exposure
  const n = Math.round(sampleRate * duration)
  const x = new Float64Array(n)
  const hz = bpm / 60
  for (let i = 0; i < n; i++) {
    let acc = 0
    for (let j = 0; j < SUBSAMPLES; j++) {
      const t = (i + j / SUBSAMPLES) / sampleRate
      const phase = (t * hz) % 1
      acc += Math.exp(-((phase - 0.15) ** 2) / 0.004) +
        0.35 * Math.exp(-((phase - 0.35) ** 2) / 0.006) +
        breathingAmplitude * Math.sin(2 * Math.PI * 0.25 * t)
    }
    x[i] = acc / SUBSAMPLES + driftPerSec * (i / sampleRate) + noiseAmplitude * rnd()
  }
  return x
}

/** @type {number[]} */
const SWEEP_RATES = []
for (let bpm = 40; bpm <= 200; bpm += 5) SWEEP_RATES.push(bpm)

const SWEEP_CONDITIONS = [
  { label: 'clean 15 fps', sampleRate: 15 },
  { label: 'clean 20 fps', sampleRate: 20 },
  { label: 'clean 30 fps', sampleRate: 30 },
  { label: 'clean 60 fps', sampleRate: 60 },
  { label: 'noisy 20 fps', sampleRate: 20, noiseAmplitude: 0.15, breathingAmplitude: 0.5, driftPerSec: 0.05 },
  { label: 'noisy 30 fps', sampleRate: 30, noiseAmplitude: 0.15, breathingAmplitude: 0.5, driftPerSec: 0.05 },
]

test('NO HARMONIC ERRORS ANYWHERE IN 40-200 BPM, AT ANY FRAME RATE', () => {
  // The honesty property, and the one that actually failed: a refusal is
  // acceptable at any rate, but a confident number must never be a multiple
  // or a fraction of the truth. Half of 170 is a plausible-looking 85.
  for (const c of SWEEP_CONDITIONS) {
    for (const bpm of SWEEP_RATES) {
      const r = estimateRate(capturedPPG(bpm, c), c.sampleRate)
      if (!r) continue                       // refusing is always allowed
      const ratio = r.bpm / bpm
      assert.ok(
        Math.abs(ratio - 1) < 0.05,
        `${c.label} ${bpm} BPM -> ${r.bpm.toFixed(1)} (x${ratio.toFixed(3)}) ` +
        `at clarity ${r.clarity.toFixed(3)}`,
      )
    }
  }
})

test('and it does not simply refuse everything to pass that test', () => {
  // The complement of the honesty test. Without this, returning null
  // unconditionally would satisfy the sweep above.
  for (const c of SWEEP_CONDITIONS) {
    let read = 0
    for (const bpm of SWEEP_RATES) if (estimateRate(capturedPPG(bpm, c), c.sampleRate)) read++
    assert.ok(
      read >= SWEEP_RATES.length - 2,
      `${c.label}: only ${read}/${SWEEP_RATES.length} rates produced a reading`,
    )
  }
})

test('the sweep is accurate, not merely non-harmonic, at 30 fps', () => {
  for (const bpm of SWEEP_RATES) {
    const r = estimateRate(capturedPPG(bpm, { sampleRate: 30 }), 30)
    if (!r) {
      assert.ok(bpm >= 195, `30 fps refused a mid-range ${bpm} BPM`)
      continue
    }
    assert.ok(Math.abs(r.bpm - bpm) < 3, `30 fps ${bpm} BPM -> ${r.bpm.toFixed(1)}`)
  }
})

test('resampleCubic preserves the original samples at the factor boundaries', () => {
  const x = [0, 1, 4, 9, 16, 25, 36]
  const up = resampleCubic(x, 4)
  assert.equal(up.length, (x.length - 1) * 4 + 1)
  for (let i = 0; i < x.length; i++) {
    assert.ok(Math.abs((up[i * 4] ?? 0) - (x[i] ?? 0)) < 1e-12, `sample ${i} moved`)
  }
})

test('resampleCubic does not flatten a peak the way linear interpolation would', () => {
  // A peak sitting between two samples is the thing this whole fix is about.
  const x = [0, 0, 1, 1, 0, 0]
  const up = resampleCubic(x, 4)
  let mx = 0
  for (const v of up) mx = Math.max(mx, v)
  assert.ok(mx > 1, `cubic should overshoot slightly through a plateau edge, got ${mx}`)
})

test('resampleCubic with factor 1 or a degenerate input is a copy, not a crash', () => {
  assert.deepEqual(Array.from(resampleCubic([1, 2, 3], 1)), [1, 2, 3])
  assert.equal(resampleCubic([], 4).length, 0)
  assert.deepEqual(Array.from(resampleCubic([7], 4)), [7])
})
