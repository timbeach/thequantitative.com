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
]

/**
 * @param {string} id
 * @returns {RegistryEntry|undefined}
 */
export function findEntry(id) {
  return REGISTRY.find((e) => e.id === id)
}
