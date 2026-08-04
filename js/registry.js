// @ts-check
/** @typedef {import('./types.js').RegistryEntry} RegistryEntry */

/**
 * Instrument metadata is eager — it draws the shelf. Instrument code is lazy —
 * it arrives only when a card is tapped.
 *
 * Adding an instrument is: write one file under instruments/, add one entry
 * here. It cannot affect any existing instrument.
 *
 * @type {RegistryEntry[]}
 */
export const REGISTRY = [
  {
    id: 'level',
    name: 'Spirit Level',
    category: 'world',
    blurb: 'Two-axis inclinometer. Tap to zero.',
    needs: ['motion'],
    load: () => import('../instruments/level.js'),
  },
  {
    id: 'galton',
    name: 'Galton Board',
    category: 'ideas',
    blurb: 'Watch the normal distribution assemble itself.',
    needs: [],
    load: () => import('../instruments/galton.js'),
  },
  {
    id: 'db-meter',
    name: 'Sound Level',
    category: 'world',
    blurb: 'A-weighted sound pressure, live.',
    needs: ['microphone'],
    load: () => import('../instruments/db-meter.js'),
  },
  {
    id: 'tuner',
    name: 'Tuner',
    category: 'world',
    blurb: 'Chromatic tuner with a live spectrogram.',
    needs: ['microphone'],
    load: () => import('../instruments/tuner.js'),
  },
  {
    id: 'jump',
    name: 'Jump Height',
    category: 'world',
    blurb: 'Hold the phone and jump. Measured from hang time.',
    needs: ['motion'],
    load: () => import('../instruments/jump.js'),
  },
  {
    id: 'sky',
    name: 'Sky Pointer',
    category: 'world',
    blurb: 'Point at the sky. See what is there, and when its light left.',
    needs: ['motion', 'geolocation'],
    load: () => import('../instruments/sky.js'),
  },
  {
    id: 'pendulum',
    name: 'Double Pendulum',
    category: 'ideas',
    blurb: 'Two pendulums, a millionth of a radian apart.',
    needs: [],
    load: () => import('../instruments/pendulum.js'),
  },
  {
    id: 'seismo',
    name: 'Seismograph',
    category: 'world',
    blurb: 'Put it on a table. Watch the room.',
    needs: ['motion'],
    load: () => import('../instruments/seismo.js'),
  },
]

/**
 * @param {string} id
 * @returns {RegistryEntry|undefined}
 */
export function findEntry(id) {
  return REGISTRY.find((e) => e.id === id)
}
