// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  julianDate, gmstDegrees, lstDegrees, eqToAltAz, angularSeparation, lightLeftYear,
} from '../dsp/astro.js'
import { STARS } from '../data/stars.js'

/** @param {number} a @param {number} b @param {number} eps @param {string} [what] */
const near = (a, b, eps, what = '') =>
  assert.ok(Math.abs(a - b) < eps, `${what} expected ${a} within ${eps} of ${b}`)

const POLARIS = { ra: 37.954, dec: 89.264 }

test('julianDate matches the J2000.0 epoch', () => {
  // 2000-01-01 12:00 UT is JD 2451545.0 by definition.
  near(julianDate(new Date(Date.UTC(2000, 0, 1, 12, 0, 0))), 2451545.0, 1e-6)
})

test('julianDate advances by exactly one per day', () => {
  const a = julianDate(new Date(Date.UTC(2026, 5, 1, 0, 0, 0)))
  const b = julianDate(new Date(Date.UTC(2026, 5, 2, 0, 0, 0)))
  near(b - a, 1, 1e-9)
})

test('GMST at J2000.0 is the textbook 280.4606 degrees', () => {
  const g = gmstDegrees(new Date(Date.UTC(2000, 0, 1, 12, 0, 0)))
  near(g, 280.46061837, 1e-4)
  near(g / 15, 18.6974, 1e-4)          // 18h 41m 51s
})

test('GMST advances by a sidereal day, not a solar one', () => {
  const t0 = new Date(Date.UTC(2026, 5, 1, 0, 0, 0))
  const t1 = new Date(Date.UTC(2026, 5, 2, 0, 0, 0))
  const drift = ((gmstDegrees(t1) - gmstDegrees(t0)) % 360 + 360) % 360
  // The sky gains ~3m56s per solar day = 0.9856 degrees.
  near(drift, 0.9856, 0.01)
})

test('local sidereal time shifts with longitude, one hour per 15 degrees', () => {
  const d = new Date(Date.UTC(2026, 7, 2, 3, 0, 0))
  const west = lstDegrees(d, -75)
  const green = lstDegrees(d, 0)
  near(((green - west) % 360 + 360) % 360, 75, 1e-6)
})

test('POLARIS SITS AT AN ALTITUDE EQUAL TO YOUR LATITUDE', () => {
  // The celestial-navigation check. It holds at every latitude, from any
  // longitude, at any time — which is exactly how it was used for centuries.
  for (const lat of [0, 15, 35.2, 51.5, 70]) {
    for (let h = 0; h < 24; h += 3) {
      const d = new Date(Date.UTC(2026, 7, 2, h, 0, 0))
      const { alt } = eqToAltAz(POLARIS.ra, POLARIS.dec, lat, lstDegrees(d, -84.4))
      // Polaris is 0.74 degrees off the true pole, so it circles by that much.
      near(alt, lat, 0.8, `lat ${lat}, hour ${h}:`)
    }
  }
})

test('Polaris circles the pole by its true 0.74 degree offset — no more, no less', () => {
  /** @type {number[]} */
  const alts = []
  for (let h = 0; h < 24; h++) {
    const d = new Date(Date.UTC(2026, 7, 2, h, 0, 0))
    alts.push(eqToAltAz(POLARIS.ra, POLARIS.dec, 40, lstDegrees(d, 0)).alt)
  }
  const spread = Math.max(...alts) - Math.min(...alts)
  near(spread, 1.47, 0.1)              // twice the 0.736 degree polar distance
})

test('a star on the meridian is due south in the northern hemisphere', () => {
  // Hour angle zero: LST equals RA.
  const { alt, az } = eqToAltAz(100, -16.7, 35.2, 100)
  near(az, 180, 1e-6)
  near(alt, 90 - 35.2 + -16.7, 1e-6)
})

test('a circumpolar star never sets, an equatorial one does', () => {
  /** @param {number} dec @param {number} lat */
  const minAlt = (dec, lat) => {
    let lo = 90
    for (let lstDeg = 0; lstDeg < 360; lstDeg += 5) {
      lo = Math.min(lo, eqToAltAz(0, dec, lat, lstDeg).alt)
    }
    return lo
  }
  assert.ok(minAlt(80, 50) > 0, 'dec +80 must be circumpolar from lat 50')
  assert.ok(minAlt(0, 50) < 0, 'an equatorial star must set from lat 50')
})

test('the celestial pole is straight overhead at the geographic pole', () => {
  const { alt } = eqToAltAz(0, 90, 90, 123)
  near(alt, 90, 1e-6)
})

test('azimuth is measured from north through east', () => {
  // A star due east rises at azimuth 90 from the equator.
  const { az } = eqToAltAz(90, 0, 0, 0)
  near(az, 90, 1)
})

test('angularSeparation is zero for identical directions and 180 for opposite', () => {
  near(angularSeparation(30, 100, 30, 100), 0, 1e-9)
  near(angularSeparation(90, 0, -90, 0), 180, 1e-6)
  near(angularSeparation(0, 0, 0, 90), 90, 1e-6)
})

test('angularSeparation handles the azimuth wrap at 360', () => {
  near(angularSeparation(0, 359, 0, 1), 2, 1e-6)
})

test('lightLeftYear subtracts the travel time', () => {
  const now = new Date(Date.UTC(2026, 0, 1))
  assert.equal(lightLeftYear(25, now), 2001)        // Vega
  assert.equal(lightLeftYear(8.6, now), 2017)       // Sirius
  assert.equal(lightLeftYear(0, now), 2026)
})

test('every catalogue entry is complete and physically plausible', () => {
  assert.ok(STARS.length >= 50, 'the catalogue should carry the bright stars')
  for (const s of STARS) {
    assert.equal(typeof s.name, 'string', 'name')
    assert.ok(s.name.length > 0, 'name must not be empty')
    assert.ok(s.ra >= 0 && s.ra < 360, `${s.name} ra out of range: ${s.ra}`)
    assert.ok(s.dec >= -90 && s.dec <= 90, `${s.name} dec out of range: ${s.dec}`)
    assert.ok(s.mag > -2 && s.mag < 7, `${s.name} magnitude implausible: ${s.mag}`)
    assert.ok(s.distanceLy > 0 && s.distanceLy < 10000, `${s.name} distance implausible: ${s.distanceLy}`)
  }
})

test('the catalogue contains the stars people actually point at', () => {
  const names = new Set(STARS.map((s) => s.name))
  for (const n of ['Sirius', 'Vega', 'Betelgeuse', 'Rigel', 'Polaris', 'Arcturus']) {
    assert.ok(names.has(n), `${n} is missing from the catalogue`)
  }
})

test('star names are unique', () => {
  const names = STARS.map((s) => s.name)
  assert.equal(new Set(names).size, names.length)
})

test('Sirius really is the brightest star in the catalogue', () => {
  const brightest = STARS.reduce((a, b) => (b.mag < a.mag ? b : a))
  assert.equal(brightest.name, 'Sirius')
})
