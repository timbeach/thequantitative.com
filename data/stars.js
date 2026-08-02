// @ts-check

/**
 * @typedef {Object} Star
 * @property {string} name
 * @property {number} ra right ascension, degrees
 * @property {number} dec declination, degrees
 * @property {number} mag apparent visual magnitude
 * @property {number} distanceLy
 * @property {boolean} [uncertain] distance known only to tens of percent
 */

/**
 * The bright named stars. Positions are J2000.0 epoch.
 *
 * Distances are the awkward figures here: parallax is excellent for nearby
 * stars and poor for distant luminous ones, so Sirius at 8.61 ly is known to
 * better than a percent while Deneb is somewhere between about 1500 and
 * 2600 ly. Entries marked `uncertain` are displayed with a leading `~` — the
 * hot and cool supergiants (Rigel, Betelgeuse, Deneb, Antares' neighbors in
 * Orion, Cygnus and Scorpius) whose parallaxes are small, whose Gaia
 * measurements saturate because the stars are too bright, or whose published
 * values disagree by 20% or more between sources.
 *
 * @type {Star[]}
 */
export const STARS = [
  { name: 'Sirius', ra: 101.287, dec: -16.716, mag: -1.46, distanceLy: 8.61 },
  { name: 'Canopus', ra: 95.988, dec: -52.696, mag: -0.72, distanceLy: 310 },
  { name: 'Arcturus', ra: 213.915, dec: 19.182, mag: -0.04, distanceLy: 36.7 },
  { name: 'Vega', ra: 279.234, dec: 38.783, mag: 0.03, distanceLy: 25.0 },
  { name: 'Capella', ra: 79.172, dec: 45.998, mag: 0.08, distanceLy: 42.9 },
  { name: 'Rigel', ra: 78.634, dec: -8.202, mag: 0.13, distanceLy: 860, uncertain: true },
  { name: 'Procyon', ra: 114.825, dec: 5.225, mag: 0.38, distanceLy: 11.5 },
  { name: 'Betelgeuse', ra: 88.793, dec: 7.407, mag: 0.50, distanceLy: 548, uncertain: true },
  { name: 'Altair', ra: 297.696, dec: 8.868, mag: 0.77, distanceLy: 16.7 },
  { name: 'Aldebaran', ra: 68.980, dec: 16.509, mag: 0.85, distanceLy: 65.3 },
  { name: 'Antares', ra: 247.352, dec: -26.432, mag: 0.96, distanceLy: 550 },
  { name: 'Spica', ra: 201.298, dec: -11.161, mag: 1.04, distanceLy: 250 },
  { name: 'Pollux', ra: 116.329, dec: 28.026, mag: 1.14, distanceLy: 33.8 },
  { name: 'Fomalhaut', ra: 344.413, dec: -29.622, mag: 1.16, distanceLy: 25.1 },
  { name: 'Deneb', ra: 310.358, dec: 45.280, mag: 1.25, distanceLy: 2600, uncertain: true },
  { name: 'Regulus', ra: 152.093, dec: 11.967, mag: 1.35, distanceLy: 79.3 },
  { name: 'Adhara', ra: 104.656, dec: -28.972, mag: 1.50, distanceLy: 430 },
  { name: 'Castor', ra: 113.650, dec: 31.888, mag: 1.57, distanceLy: 51.6 },
  { name: 'Bellatrix', ra: 81.283, dec: 6.350, mag: 1.64, distanceLy: 245 },
  { name: 'Elnath', ra: 84.411, dec: 28.608, mag: 1.65, distanceLy: 131 },
  { name: 'Alnilam', ra: 84.053, dec: -1.202, mag: 1.69, distanceLy: 1340, uncertain: true },
  { name: 'Alnitak', ra: 85.190, dec: -1.943, mag: 1.77, distanceLy: 800, uncertain: true },
  { name: 'Alioth', ra: 193.507, dec: 55.960, mag: 1.77, distanceLy: 82.6 },
  { name: 'Mirfak', ra: 51.081, dec: 49.861, mag: 1.79, distanceLy: 510 },
  { name: 'Dubhe', ra: 165.932, dec: 61.751, mag: 1.79, distanceLy: 123 },
  { name: 'Alkaid', ra: 206.885, dec: 49.313, mag: 1.86, distanceLy: 104 },
  { name: 'Polaris', ra: 37.954, dec: 89.264, mag: 1.98, distanceLy: 433 },
  { name: 'Denebola', ra: 177.265, dec: 14.572, mag: 2.14, distanceLy: 35.9 },
  { name: 'Alphard', ra: 141.897, dec: -8.659, mag: 1.98, distanceLy: 177 },
  { name: 'Mizar', ra: 200.981, dec: 54.925, mag: 2.27, distanceLy: 82.9 },
  { name: 'Kochab', ra: 222.676, dec: 74.156, mag: 2.08, distanceLy: 131 },
  { name: 'Schedar', ra: 10.127, dec: 56.537, mag: 2.23, distanceLy: 228 },
  { name: 'Algol', ra: 47.042, dec: 40.956, mag: 2.12, distanceLy: 92.8 },
  { name: 'Hamal', ra: 31.793, dec: 23.462, mag: 2.00, distanceLy: 65.9 },
  { name: 'Diphda', ra: 10.897, dec: -17.987, mag: 2.04, distanceLy: 95.8 },
  { name: 'Nunki', ra: 283.816, dec: -26.297, mag: 2.02, distanceLy: 228 },
  { name: 'Saiph', ra: 86.939, dec: -9.670, mag: 2.09, distanceLy: 650, uncertain: true },
  { name: 'Menkalinan', ra: 89.882, dec: 44.947, mag: 2.08, distanceLy: 81.1 },
  { name: 'Alpheratz', ra: 2.097, dec: 29.091, mag: 2.06, distanceLy: 97.0 },
  { name: 'Mirach', ra: 17.433, dec: 35.621, mag: 2.06, distanceLy: 197 },
  { name: 'Rasalhague', ra: 263.733, dec: 12.560, mag: 2.08, distanceLy: 48.6 },
  { name: 'Alderamin', ra: 319.644, dec: 62.585, mag: 2.44, distanceLy: 49.0 },
  { name: 'Shaula', ra: 263.402, dec: -37.104, mag: 1.63, distanceLy: 570, uncertain: true },
  { name: 'Sargas', ra: 264.330, dec: -42.998, mag: 1.87, distanceLy: 300, uncertain: true },
  { name: 'Sadr', ra: 305.557, dec: 40.257, mag: 2.20, distanceLy: 1800, uncertain: true },
  { name: 'Eltanin', ra: 269.152, dec: 51.489, mag: 2.23, distanceLy: 154 },
  { name: 'Enif', ra: 326.046, dec: 9.875, mag: 2.39, distanceLy: 690 },
  { name: 'Scheat', ra: 345.943, dec: 28.083, mag: 2.42, distanceLy: 196 },
  { name: 'Sabik', ra: 258.662, dec: -15.725, mag: 2.43, distanceLy: 88.0 },
  { name: 'Phecda', ra: 178.457, dec: 53.695, mag: 2.44, distanceLy: 83.2 },
  { name: 'Acrux', ra: 186.650, dec: -63.099, mag: 0.77, distanceLy: 320, uncertain: true },
  { name: 'Gacrux', ra: 187.792, dec: -57.113, mag: 1.63, distanceLy: 88.6 },
  { name: 'Mimosa', ra: 191.930, dec: -59.689, mag: 1.25, distanceLy: 280 },
  { name: 'Achernar', ra: 24.429, dec: -57.237, mag: 0.46, distanceLy: 139 },
]
