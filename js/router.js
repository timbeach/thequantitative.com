// @ts-check
/** @typedef {import('./types.js').Route} Route */

// Lowercase kebab only. This is also the security boundary: the id is used to
// look up a registry entry, and anything outside this set must never match.
const INSTRUMENT_PATH = /^\/i\/([a-z0-9]+(?:-[a-z0-9]+)*)$/

/**
 * @param {string} hash the raw location.hash, with or without the leading '#'
 * @returns {Route}
 */
export function parseRoute(hash) {
  const path = (hash || '').replace(/^#/, '')
  if (path === '' || path === '/') return { name: 'shelf' }
  if (path === '/about') return { name: 'about' }

  const match = INSTRUMENT_PATH.exec(path)
  if (match?.[1]) return { name: 'instrument', id: match[1] }

  return { name: 'not-found', hash: path }
}

/**
 * @param {Route} route
 * @returns {string}
 */
export function hrefFor(route) {
  switch (route.name) {
    case 'shelf': return '#/'
    case 'about': return '#/about'
    case 'instrument': return `#/i/${route.id}`
    default: return '#/'
  }
}

/**
 * Binds parseRoute to a window's hashchange. Deliberately thin — all the logic
 * worth testing lives in parseRoute above.
 *
 * @param {Window} win
 * @param {(route:Route) => void} onRoute
 */
export function createRouter(win, onRoute) {
  const handle = () => onRoute(parseRoute(win.location.hash))
  return {
    start() {
      win.addEventListener('hashchange', handle)
      handle()
    },
    stop() {
      win.removeEventListener('hashchange', handle)
    },
  }
}
