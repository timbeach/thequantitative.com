// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { highPass2, estimateRate, MIN_BPM, MAX_BPM } from '../dsp/ppg.js'

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
