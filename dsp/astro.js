// @ts-check

const DEG = Math.PI / 180

/**
 * Julian Date — days since noon UT on 1 January 4713 BC.
 *
 * The Unix epoch (1970-01-01 00:00 UT) is JD 2440587.5. Astronomy runs on JD
 * because it is a single continuous count with no months, leap years or time
 * zones to get wrong.
 *
 * @param {Date} date
 * @returns {number}
 */
export function julianDate(date) {
  return date.getTime() / 86400000 + 2440587.5
}

/**
 * Greenwich Mean Sidereal Time, in degrees.
 *
 * Sidereal time tracks the stars rather than the Sun, so it gains about
 * 3m56s per solar day — the Earth must turn slightly more than 360° to bring
 * the Sun back to the meridian, but exactly 360° to bring a star back.
 *
 * @param {Date} date
 * @returns {number} degrees in [0, 360)
 */
export function gmstDegrees(date) {
  const d = julianDate(date) - 2451545.0
  return ((280.46061837 + 360.98564736629 * d) % 360 + 360) % 360
}

/**
 * Local Sidereal Time — the right ascension currently on your meridian.
 * @param {Date} date
 * @param {number} lonDeg east-positive
 * @returns {number} degrees in [0, 360)
 */
export function lstDegrees(date, lonDeg) {
  return ((gmstDegrees(date) + lonDeg) % 360 + 360) % 360
}

/**
 * Equatorial (RA/Dec) to horizontal (altitude/azimuth).
 *
 * Azimuth is measured from north, through east. Altitude is degrees above the
 * horizon; negative means below it.
 *
 * @param {number} raDeg
 * @param {number} decDeg
 * @param {number} latDeg
 * @param {number} lstDeg
 * @returns {{ alt: number, az: number }}
 */
export function eqToAltAz(raDeg, decDeg, latDeg, lstDeg) {
  const ha = (((lstDeg - raDeg + 540) % 360) - 180) * DEG
  const dec = decDeg * DEG
  const lat = latDeg * DEG

  const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha)
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)))

  // atan2 form rather than acos: it is stable near the zenith and gives the
  // quadrant directly, so no sign correction is needed.
  const az = Math.atan2(
    -Math.sin(ha) * Math.cos(dec),
    Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(ha),
  )

  return { alt: alt / DEG, az: ((az / DEG) % 360 + 360) % 360 }
}

/**
 * Great-circle angle between two horizontal directions.
 * @param {number} alt1 @param {number} az1 @param {number} alt2 @param {number} az2
 * @returns {number} degrees
 */
export function angularSeparation(alt1, az1, alt2, az2) {
  const a1 = alt1 * DEG, a2 = alt2 * DEG
  const dAz = (az1 - az2) * DEG
  const cos = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(dAz)
  return Math.acos(Math.max(-1, Math.min(1, cos))) / DEG
}

/**
 * The calendar year the light you are seeing right now departed.
 *
 * This is the fact that makes people put their phone down and look up: a star
 * is not an object you are seeing, it is a photograph of one, dated.
 *
 * @param {number} distanceLy
 * @param {Date} now
 * @returns {number} calendar year
 */
export function lightLeftYear(distanceLy, now) {
  return Math.round(now.getUTCFullYear() - distanceLy)
}
