// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sweepSamples,
  smoothFractionalOctave,
  findModes,
  residualCurve,
  DEFAULT_BAND,
  MIN_PROMINENCE_DB,
  MIN_SWEEP_SECONDS,
} from '../dsp/room.js'

/** Deterministic noise so every test is reproducible.
 * @param {number} seed
 */
function seededNoise(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 2 ** 32) * 2 - 1 }
}

/**
 * `count` points log-spaced between `loHz` and `hiHz` (inclusive), ascending.
 * Log spacing rather than linear because every downstream analysis here
 * (1/3-octave smoothing) thinks in octaves, not Hz.
 * @param {number} loHz
 * @param {number} hiHz
 * @param {number} count
 * @returns {number[]}
 */
function logSpacedHz(loHz, hiHz, count) {
  const logLo = Math.log(loHz)
  const logHi = Math.log(hiHz)
  /** @type {number[]} */
  const out = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    out.push(Math.exp(logLo + t * (logHi - logLo)))
  }
  return out
}

/**
 * A resonance-shaped bump in dB, peaking at `heightDb` at `f0` with the
 * standard Q relationship between center frequency and half-power width.
 * @param {number} f0
 * @param {number} q
 * @param {number} heightDb
 * @returns {(hz: number) => number}
 */
function lorentzianDb(f0, q, heightDb) {
  const halfWidth = f0 / (2 * q)
  return (hz) => heightDb / (1 + ((hz - f0) / halfWidth) ** 2)
}

/**
 * Estimate instantaneous frequency from rising zero-crossing spacing over a
 * sample range. Deliberately independent of the sweep's own phase formula so
 * this checks the OUTPUT samples, not a re-derivation of the input math.
 * @param {ArrayLike<number>} samples
 * @param {number} startIdx
 * @param {number} endIdx
 * @param {number} sampleRate
 * @returns {number} Hz, or NaN if too few crossings in range
 */
function zeroCrossingFreq(samples, startIdx, endIdx, sampleRate) {
  /** @type {number[]} */
  const crossings = []
  const lo = Math.max(1, startIdx)
  const hi = Math.min(samples.length, endIdx)
  for (let i = lo; i < hi; i++) {
    const prev = samples[i - 1] ?? 0
    const cur = samples[i] ?? 0
    if (prev < 0 && cur >= 0) crossings.push(i)
  }
  if (crossings.length < 2) return NaN
  let sumSpan = 0
  for (let i = 1; i < crossings.length; i++) sumSpan += (crossings[i] ?? 0) - (crossings[i - 1] ?? 0)
  const meanSpan = sumSpan / (crossings.length - 1)
  return sampleRate / meanSpan
}

// ---------------------------------------------------------------------------
// sweepSamples
// ---------------------------------------------------------------------------

test('sweepSamples spans the requested frequencies', () => {
  const sampleRate = 48000
  const f1 = 200
  const f2 = 4000
  const seconds = 10
  const x = sweepSamples({ f1, f2, seconds, sampleRate })

  const startFreq = zeroCrossingFreq(x, Math.round(0.06 * sampleRate), Math.round(0.2 * sampleRate), sampleRate)
  const endFreq = zeroCrossingFreq(x, Math.round(9.8 * sampleRate), Math.round(9.95 * sampleRate), sampleRate)

  assert.ok(Math.abs(startFreq - f1) / f1 < 0.1, `start freq should be near ${f1}, got ${startFreq}`)
  assert.ok(Math.abs(endFreq - f2) / f2 < 0.1, `end freq should be near ${f2}, got ${endFreq}`)
})

test('sweepSamples is exponential: midpoint frequency is sqrt(f1*f2), not the linear mean', () => {
  const sampleRate = 48000
  const f1 = 200
  const f2 = 4000
  const seconds = 10
  const x = sweepSamples({ f1, f2, seconds, sampleRate })

  const mid = seconds / 2
  const midFreq = zeroCrossingFreq(
    x, Math.round((mid - 0.1) * sampleRate), Math.round((mid + 0.1) * sampleRate), sampleRate,
  )

  const geometricMean = Math.sqrt(f1 * f2) // ~894 Hz
  const arithmeticMean = (f1 + f2) / 2 // 2100 Hz — far enough apart (~1.5x) to distinguish the two models

  assert.ok(
    Math.abs(midFreq - geometricMean) / geometricMean < 0.1,
    `midpoint should be near the geometric mean ${geometricMean.toFixed(1)}, got ${midFreq.toFixed(1)}`,
  )
  assert.ok(
    Math.abs(midFreq - geometricMean) < Math.abs(midFreq - arithmeticMean) / 3,
    'midpoint frequency should be far closer to the geometric mean than the arithmetic mean',
  )
})

test('sweepSamples fades in and out and never exceeds unity amplitude', () => {
  const sampleRate = 48000
  const x = sweepSamples({ f1: 200, f2: 4000, seconds: 8, sampleRate })

  assert.ok(Math.abs(x[0] ?? 1) < 0.05, `first sample should be ~0, got ${x[0]}`)
  assert.ok(Math.abs(x[x.length - 1] ?? 1) < 0.05, `last sample should be ~0, got ${x[x.length - 1]}`)

  let maxAbs = 0
  for (const v of x) maxAbs = Math.max(maxAbs, Math.abs(v))
  assert.ok(maxAbs <= 1.0 + 1e-6, `amplitude must never exceed 1.0, got ${maxAbs}`)
})

// ---------------------------------------------------------------------------
// smoothFractionalOctave
// ---------------------------------------------------------------------------

test('smoothFractionalOctave leaves a flat response flat', () => {
  const points = logSpacedHz(300, 2000, 300).map((hz) => ({ hz, db: -12 }))
  const smoothed = smoothFractionalOctave(points, 3)
  for (const p of smoothed) assert.ok(Math.abs(p.db - -12) < 1e-9, `expected -12 dB, got ${p.db}`)
})

test('smoothFractionalOctave removes a narrow spike but preserves a broad tilt', () => {
  const hzList = logSpacedHz(300, 2000, 400)
  const tiltDbPerOctave = -3
  const spikeIndex = Math.floor(hzList.length / 2)
  const spikeHz = hzList[spikeIndex] ?? 0
  const points = hzList.map((hz) => {
    const tilt = tiltDbPerOctave * Math.log2(hz / 300)
    const spike = hz === spikeHz ? 15 : 0
    return { hz, db: tilt + spike }
  })

  const smoothed = smoothFractionalOctave(points, 3)
  const spikeOut = smoothed[spikeIndex]
  assert.ok(spikeOut)
  const localTilt = tiltDbPerOctave * Math.log2(spikeHz / 300)
  assert.ok(
    Math.abs(spikeOut.db - localTilt) < 3,
    `narrow spike should be smoothed away, got ${spikeOut.db} vs local tilt baseline ${localTilt}`,
  )

  const firstOut = smoothed[20]
  const lastOut = smoothed[smoothed.length - 21]
  const hzFirst = hzList[20] ?? 0
  const hzLast = hzList[hzList.length - 21] ?? 0
  assert.ok(firstOut && lastOut)
  const expectedTiltSpan = tiltDbPerOctave * Math.log2(hzLast / hzFirst)
  const observedTiltSpan = lastOut.db - firstOut.db
  assert.ok(
    Math.abs(observedTiltSpan - expectedTiltSpan) < 1,
    `broad tilt should survive smoothing: expected span ~${expectedTiltSpan.toFixed(2)} dB, got ${observedTiltSpan.toFixed(2)} dB`,
  )
})

// ---------------------------------------------------------------------------
// findModes
// ---------------------------------------------------------------------------

/**
 * A "wild" room-response envelope: a downward tilt (speaker rolloff) plus
 * two broad, low-Q bumps (speaker/mic resonance) — everything findModes
 * should treat as background, not a mode.
 * @param {number} hz
 */
function wildEnvelopeDb(hz) {
  const tilt = -6 * Math.log2(hz / 300)
  const bump1 = lorentzianDb(450, 1, 6)(hz)
  const bump2 = lorentzianDb(1400, 1, 5)(hz)
  return tilt + bump1 + bump2
}

test('findModes recovers narrow peaks planted on a wild broad response', () => {
  const rnd = seededNoise(101)
  const hzList = logSpacedHz(280, 2100, 900)
  const plantedHz = [550, 900, 1600]
  const modes = plantedHz.map((f0) => lorentzianDb(f0, 30, 12))

  const points = hzList.map((hz) => {
    const db = wildEnvelopeDb(hz) + modes.reduce((sum, m) => sum + m(hz), 0) + 0.4 * rnd()
    return { hz, db }
  })

  const found = findModes(points)
  for (const f0 of plantedHz) {
    const match = found.find((m) => Math.abs(m.hz - f0) / f0 < 0.06)
    assert.ok(match, `expected a mode near ${f0} Hz, got ${JSON.stringify(found)}`)
  }
})

test('findModes on a smooth response with no narrow peaks returns []', () => {
  const rnd = seededNoise(202)
  const hzList = logSpacedHz(280, 2100, 900)
  const points = hzList.map((hz) => ({ hz, db: wildEnvelopeDb(hz) + 0.4 * rnd() }))

  const found = findModes(points)
  assert.deepEqual(found, [], `expected no modes in a smooth response, got ${JSON.stringify(found)}`)
})

test('findModes does not report a broad Q≈2 bump as a mode', () => {
  const rnd = seededNoise(303)
  const hzList = logSpacedHz(280, 2100, 900)
  const bump = lorentzianDb(800, 2, 9)
  const points = hzList.map((hz) => ({ hz, db: bump(hz) + 0.2 * rnd() }))

  const found = findModes(points)
  const nearBump = found.find((m) => Math.abs(m.hz - 800) / 800 < 0.1)
  assert.equal(nearBump, undefined, `broad Q≈2 bump must not be reported as a mode, got ${JSON.stringify(found)}`)
})

test('findModes rejects a narrow mode below the 7 dB prominence gate', () => {
  // A Q=30 mode at 6 dB survives 1/3-octave smoothing at ~4.8 dB residual —
  // comfortably between "a looser gate would report it" and "the real gate
  // rejects it" (verified against this exact implementation), so this
  // exercises MIN_PROMINENCE_DB directly rather than hoping noise happens
  // to land in the right place.
  const hzList = logSpacedHz(280, 2100, 900)
  const points = hzList.map((hz) => ({ hz, db: lorentzianDb(900, 30, 6)(hz) }))
  const found = findModes(points)
  assert.deepEqual(found, [], `a 6 dB mode must not clear the 7 dB gate, got ${JSON.stringify(found)}`)
})

test('findModes merges two peaks 2% apart into one, and keeps two peaks 20% apart as two', () => {
  const hzList = logSpacedHz(280, 2100, 900)

  // Q=50 here (not the 30 used elsewhere) so the two modes are narrow enough
  // to show up as two distinct local maxima with a dip between them — a
  // wider kernel would blend them into one hump on its own, which would
  // pass this test without the merge step actually doing anything.
  const closePoints = hzList.map((hz) => ({
    hz,
    db: lorentzianDb(800, 50, 12)(hz) + lorentzianDb(816, 50, 12)(hz), // 816/800 = 1.02
  }))
  const closeFound = findModes(closePoints)
  assert.equal(closeFound.length, 1, `2% apart should merge into one mode, got ${JSON.stringify(closeFound)}`)

  const farPoints = hzList.map((hz) => ({
    hz,
    db: lorentzianDb(800, 30, 12)(hz) + lorentzianDb(960, 30, 12)(hz), // 960/800 = 1.2
  }))
  const farFound = findModes(farPoints)
  assert.equal(farFound.length, 2, `20% apart should remain two modes, got ${JSON.stringify(farFound)}`)
})

test('findModes ignores everything outside DEFAULT_BAND', () => {
  assert.equal(DEFAULT_BAND.lo, 300)
  assert.equal(DEFAULT_BAND.hi, 2000)

  const hzList = logSpacedHz(80, 3500, 1200)
  const points = hzList.map((hz) => ({
    hz,
    db: lorentzianDb(900, 30, 12)(hz) + lorentzianDb(150, 30, 20)(hz) + lorentzianDb(3000, 30, 20)(hz),
  }))

  const found = findModes(points)
  assert.equal(found.length, 1, `expected only the in-band mode, got ${JSON.stringify(found)}`)
  assert.ok(Math.abs((found[0]?.hz ?? 0) - 900) / 900 < 0.06)
})

test('findModes results are sorted by descending prominence', () => {
  const hzList = logSpacedHz(280, 2100, 900)
  const points = hzList.map((hz) => ({
    hz,
    db: lorentzianDb(500, 30, 10)(hz) + lorentzianDb(900, 30, 14)(hz) + lorentzianDb(1500, 30, 18)(hz),
  }))

  const found = findModes(points)
  assert.ok(found.length >= 3, `expected at least 3 modes, got ${JSON.stringify(found)}`)
  for (let i = 1; i < found.length; i++) {
    const prev = found[i - 1]
    const cur = found[i]
    assert.ok(prev && cur)
    assert.ok(prev.prominenceDb >= cur.prominenceDb, 'results must be sorted by descending prominence')
  }
})

// ---------------------------------------------------------------------------
// exported constants
// ---------------------------------------------------------------------------

test('exposes the documented constants', () => {
  assert.deepEqual(DEFAULT_BAND, { lo: 300, hi: 2000 })
  assert.equal(MIN_PROMINENCE_DB, 7)
  assert.equal(MIN_SWEEP_SECONDS, 8)
})

test('findModes is not fooled by badly ordered input', () => {
  // Both the smoothing window and the merge pass assume ascending frequency,
  // and neither fails loudly when that breaks — a reversed input previously
  // grew three phantom modes that are not in the signal. Sorting inside
  // findModes is what makes the caller's ordering irrelevant.
  const rnd = seededNoise(5)
  /** @type {{ hz: number, db: number }[]} */
  const ascending = []
  const planted = [430, 610, 880]
  for (let i = 0; i < 900; i++) {
    const hz = 250 * Math.pow(8000 / 250, i / 899)
    let db = -12 * Math.log2(hz / 250) + 6 * Math.exp(-((Math.log2(hz / 1250)) ** 2) / 0.25)
    for (const m of planted) db += 14 / (1 + ((hz - m) / (m / 28)) ** 2)
    ascending.push({ hz, db: db + 0.35 * rnd() })
  }

  const expected = findModes(ascending).map((m) => Math.round(m.hz)).sort((a, b) => a - b)
  assert.equal(expected.length, planted.length, `ascending input should find exactly ${planted.length} modes`)

  for (const [label, input] of [
    ['reversed', [...ascending].reverse()],
    ['shuffled', [...ascending].sort((a, b) => (a.hz % 7) - (b.hz % 7))],
  ]) {
    const got = findModes(/** @type {{hz: number, db: number}[]} */ (input))
      .map((m) => Math.round(m.hz)).sort((a, b) => a - b)
    assert.deepEqual(got, expected, `${label} input produced a different answer`)
  }
})

// ---------------------------------------------------------------------------
// residualCurve
// ---------------------------------------------------------------------------

test('residualCurve is band-limited, ascending, and empty when the band is thin', () => {
  const hzList = logSpacedHz(80, 3500, 900)
  const points = hzList.map((hz) => ({ hz, db: lorentzianDb(900, 30, 12)(hz) }))

  const curve = residualCurve([...points].reverse())
  assert.ok(curve.length > 0)
  for (const p of curve) {
    assert.ok(p.hz >= DEFAULT_BAND.lo && p.hz <= DEFAULT_BAND.hi, `${p.hz} escaped the band`)
  }
  for (let i = 1; i < curve.length; i++) {
    assert.ok((curve[i]?.hz ?? 0) >= (curve[i - 1]?.hz ?? 0), 'must be ascending by hz')
  }

  assert.deepEqual(residualCurve([{ hz: 400, db: 0 }, { hz: 500, db: 0 }]), [])
})

test('every mode findModes reports sits on a peak of residualCurve', () => {
  // The instrument draws residualCurve and labels findModes' output on top of
  // it. If the two ever disagreed, a label could sit where the drawn curve has
  // no peak — a confident mark with nothing under it, which is the one output
  // this instrument must never produce.
  const hzList = logSpacedHz(280, 2100, 900)
  const points = hzList.map((hz) => ({
    hz,
    db: lorentzianDb(500, 30, 10)(hz) + lorentzianDb(900, 30, 14)(hz) + lorentzianDb(1500, 30, 18)(hz),
  }))

  const curve = residualCurve(points)
  const found = findModes(points)
  assert.ok(found.length >= 3)

  for (const mode of found) {
    const i = curve.findIndex((p) => p.hz === mode.hz)
    assert.ok(i > 0 && i < curve.length - 1, `${mode.hz} Hz is not an interior point of the curve`)
    assert.equal(curve[i]?.residualDb, mode.prominenceDb, 'prominence must be the curve value')
    assert.ok((curve[i]?.residualDb ?? 0) > (curve[i - 1]?.residualDb ?? 0), 'must exceed its left neighbour')
    assert.ok((curve[i]?.residualDb ?? 0) > (curve[i + 1]?.residualDb ?? 0), 'must exceed its right neighbour')
  }
})
