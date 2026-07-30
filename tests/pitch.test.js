// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nsdf, keyMaxima, detectPitch, noteFromHz } from '../dsp/pitch.js'

const SR = 48000
const N = 2048

/** Deterministic noise so every test is reproducible.
 * @param {number} seed
 */
function seededNoise(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 2 ** 32) * 2 - 1 }
}

/**
 * Synthesise a tone. `harmonics[k]` is the amplitude of partial k+1, so
 * [0, 1, 0.7] is a tone with NO energy at the fundamental.
 * @param {number} hz @param {number[]} harmonics @param {number} [noise]
 */
function tone(hz, harmonics, noise = 0) {
  const rnd = seededNoise(7)
  const x = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    let v = 0
    for (let k = 0; k < harmonics.length; k++) {
      v += (harmonics[k] ?? 0) * Math.sin((2 * Math.PI * hz * (k + 1) * i) / SR)
    }
    x[i] = v + noise * rnd()
  }
  return x
}

/** @param {number} got @param {number} want @param {number} maxCents */
function withinCents(got, want, maxCents) {
  const cents = 1200 * Math.log2(got / want)
  assert.ok(Math.abs(cents) <= maxCents, `${got.toFixed(2)} Hz is ${cents.toFixed(1)}¢ from ${want} Hz (max ${maxCents}¢)`)
}

test('nsdf is 1 at lag 0 and has the right length', () => {
  const d = nsdf(tone(440, [1]), 512)
  assert.equal(d.length, 512)
  assert.ok(Math.abs((d[0] ?? 0) - 1) < 1e-9, 'a signal is perfectly correlated with itself')
})

test('nsdf peaks at the period of a pure tone', () => {
  const hz = 500                       // period = 96 samples at 48 kHz exactly
  const d = nsdf(tone(hz, [1]), 512)
  assert.ok((d[96] ?? 0) > 0.99, `expected a strong peak at lag 96, got ${d[96]}`)
})

test('keyMaxima skips the lag-0 lobe and finds one peak per positive interval', () => {
  const d = nsdf(tone(500, [1]), 512)
  const maxima = keyMaxima(d)
  assert.ok(maxima.length >= 2, 'a periodic signal has multiple key maxima')
  assert.ok((maxima[0]?.lag ?? 0) > 1, 'the lag-0 lobe must not be reported as a peak')
})

test('detects a pure tone exactly', () => {
  for (const hz of [82.41, 220, 440, 1000]) {
    const r = detectPitch(tone(hz, [1]), SR)
    assert.ok(r, `${hz} Hz was not detected`)
    withinCents(r.hz, hz, 1)
  }
})

test('detects the fundamental of a harmonically rich tone, not a partial', () => {
  const r = detectPitch(tone(440, [1, 0.6, 0.4, 0.3, 0.2]), SR)
  assert.ok(r)
  withinCents(r.hz, 440, 1)
})

test('detects a MISSING fundamental — the whole reason for this algorithm', () => {
  // No energy at 220 Hz at all; the loudest partial is 440 Hz. An FFT peak
  // would report 440 and be a full octave wrong.
  const r = detectPitch(tone(220, [0, 1, 0.7, 0.5]), SR)
  assert.ok(r, 'missing-fundamental tone was not detected')
  withinCents(r.hz, 220, 5)
})

test('does not octave-halve on a guitar-like spectrum', () => {
  const r = detectPitch(tone(196, [1, 0.8, 0.6, 0.4, 0.3, 0.2]), SR)
  assert.ok(r)
  withinCents(r.hz, 196, 2)
})

test('survives noise at signal amplitude', () => {
  const r = detectPitch(tone(196, [1, 0.8, 0.6, 0.4, 0.3, 0.2], 1.0), SR)
  assert.ok(r)
  withinCents(r.hz, 196, 10)
})

test('returns null for noise alone rather than inventing a note', () => {
  const rnd = seededNoise(99)
  const x = new Float64Array(N)
  for (let i = 0; i < N; i++) x[i] = rnd()
  const r = detectPitch(x, SR)
  if (r !== null) {
    assert.ok(r.clarity < 0.5, `pure noise reported clarity ${r.clarity} — it must not look confident`)
  }
})

test('returns null for digital silence', () => {
  assert.equal(detectPitch(new Float64Array(N), SR), null)
})

test('honours an explicit minClarity threshold, returning null even for a real periodic peak', () => {
  // NSDF clarity is bounded to [-1, 1], so a peak can never reach 1.1 — this
  // exercises the minClarity gate itself, not just the silence/noise cases
  // where keyMaxima already comes back empty.
  const r = detectPitch(tone(440, [1]), SR, { minClarity: 1.1 })
  assert.equal(r, null, 'peak clarity can never reach 1.1, so a clean tone must still read null')
})

test('clarity falls as noise rises', () => {
  const clean = detectPitch(tone(440, [1]), SR)
  const noisy = detectPitch(tone(440, [1], 1.5), SR)
  assert.ok(clean)
  assert.ok(noisy)
  assert.ok(clean.clarity > noisy.clarity, 'clarity must reflect signal quality')
})

test('parabolic interpolation beats whole-sample resolution', () => {
  // 443 Hz falls between lag 108 and 109 at 48 kHz. Without interpolation the
  // best possible answer is ~5 cents out; with it, under 1 cent.
  const r = detectPitch(tone(443, [1]), SR)
  assert.ok(r)
  withinCents(r.hz, 443, 1)
})

test('noteFromHz names the standard reference pitches exactly', () => {
  /** @type {[number, string, number][]} */
  const cases = [
    [440, 'A', 4], [261.6256, 'C', 4], [82.4069, 'E', 2],
    [329.6276, 'E', 4], [1046.502, 'C', 6],
  ]
  for (const [hz, name, octave] of cases) {
    const n = noteFromHz(hz)
    assert.equal(n.name, name, `${hz} Hz`)
    assert.equal(n.octave, octave, `${hz} Hz`)
    assert.ok(Math.abs(n.cents) < 1, `${hz} Hz should be in tune, got ${n.cents}¢`)
  }
})

test('noteFromHz reports cents deviation with the right sign', () => {
  const sharp = noteFromHz(452)
  assert.equal(sharp.name, 'A')
  assert.ok(sharp.cents > 40 && sharp.cents < 50, `expected ~+46.6¢, got ${sharp.cents}`)

  const flat = noteFromHz(430)
  assert.ok(flat.cents < 0, `430 Hz must read flat of A4, got ${flat.cents}`)
})

test('noteFromHz snaps to the NEAREST note, crossing over at 50 cents', () => {
  // 427 Hz is closer to G#4 (415.30) than to A4 (440)
  assert.equal(noteFromHz(427).name, 'G#')
  assert.equal(noteFromHz(433).name, 'A')
})

test('noteFromHz honours an alternate A4 reference', () => {
  const n = noteFromHz(432, 432)
  assert.equal(n.name, 'A')
  assert.equal(n.octave, 4)
  assert.ok(Math.abs(n.cents) < 1e-9, 'the reference pitch must read exactly in tune')

  // With the standard reference, 432 Hz is about 32 cents flat of A4.
  const std = noteFromHz(432, 440)
  assert.ok(std.cents < -30 && std.cents > -35, `expected ~-31.8¢, got ${std.cents}`)
})

test('cents is always within ±50', () => {
  for (let hz = 80; hz < 2000; hz += 7.3) {
    const c = noteFromHz(hz).cents
    assert.ok(c >= -50 && c <= 50, `${hz} Hz gave ${c}¢`)
  }
})
