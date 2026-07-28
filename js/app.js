// @ts-check
import { createRouter, hrefFor } from './router.js'
import { REGISTRY, findEntry } from './registry.js'
import { readEnv, detectCapabilities, unavailableReason } from './capability.js'
import { createCtx } from './ctx.js'
import { requireCapabilities } from './arm.js'
import { el, escapeHtml } from './util.js'

/** @typedef {import('./types.js').Route} Route */
/** @typedef {import('./types.js').RegistryEntry} RegistryEntry */

const app = /** @type {HTMLElement} */ (document.getElementById('app'))

/** Teardown for whatever is currently mounted. Exactly one may be live. */
let active = /** @type {null | (() => void)} */ (null)

function clear() {
  if (active) { active(); active = null }
  app.replaceChildren()
}

/** @param {RegistryEntry} entry */
function card(entry) {
  const env = readEnv()
  const blocked = entry.needs.find((n) => detectCapabilities(env)[n] === 'unavailable')

  const children = [
    el('span', { class: 'card__name' }, [entry.name]),
    el('span', { class: 'card__blurb' }, [entry.blurb]),
  ]

  if (blocked) {
    children.push(el('span', { class: 'card__reason' }, [unavailableReason(blocked, env)]))
    return el('div', { class: 'card', 'aria-disabled': 'true' }, children)
  }

  return el('a', { class: 'card', href: hrefFor({ name: 'instrument', id: entry.id }) }, children)
}

function renderShelf() {
  const sections = /** @type {const} */ ([
    { key: 'world', heading: 'World' },
    { key: 'ideas', heading: 'Ideas' },
  ])

  const shelf = el('div', { class: 'shelf' })

  for (const section of sections) {
    const entries = REGISTRY.filter((e) => e.category === section.key)
    if (entries.length === 0) continue
    shelf.append(
      el('section', { class: 'shelf__section' }, [
        el('h2', { class: 'shelf__heading label' }, [section.heading]),
        el('div', { class: 'shelf__grid' }, entries.map(card)),
      ]),
    )
  }

  app.append(shelf)
}

function renderAbout() {
  const wrap = el('div', { class: 'shelf' })
  wrap.innerHTML = `
    <h2 class="shelf__heading label">About</h2>
    <p class="card__blurb">A cabinet of instruments. Some point outward at physical
    reality, some inward at mathematical reality. You touch one with your thumb and
    numbers come out.</p>
    <p class="card__blurb">No accounts, no tracking, no network. Everything here works
    with the aeroplane mode switch on.</p>`
  app.append(wrap)
}

/** @param {string} message */
function renderMessage(message) {
  app.append(el('div', { class: 'shelf' }, [
    el('p', { class: 'card__blurb' }, [message]),
    el('p', {}, [el('a', { class: 'label', href: '#/' }, ['← All instruments'])]),
  ]))
}

/** @param {string} id */
async function mountInstrument(id) {
  const entry = findEntry(id)
  if (!entry) { renderMessage(`No instrument called “${escapeHtml(id)}”.`); return }

  const stage = el('div', { class: 'stage' })
  app.append(stage)

  // The arm screen owns every permission state. mount() is never reached until
  // the grant lands, so no instrument file contains permission handling.
  const granted = await requireCapabilities(stage, entry.needs)
  if (!granted) return

  const mod = await entry.load()
  const { ctx, dispose } = createCtx(window, entry.id)
  stage.replaceChildren()
  const teardown = mod.default.mount(stage, ctx)

  active = () => { teardown(); dispose() }
}

/** @param {Route} route */
function onRoute(route) {
  clear()
  document.body.dataset.route = route.name
  app.focus({ preventScroll: true })

  switch (route.name) {
    case 'shelf': renderShelf(); break
    case 'about': renderAbout(); break
    case 'instrument': void mountInstrument(route.id); break
    case 'not-found': renderMessage('Nothing here.'); break
  }
}

createRouter(window, onRoute).start()

// Release the mounted instrument if the page goes away mid-measurement,
// so a backgrounded tab cannot keep a sensor listener alive.
window.addEventListener('pagehide', () => { if (active) { active(); active = null } })
