// @ts-check
import { readEnv, isIos } from './capability.js'
import { el } from './util.js'

const DISMISS_KEY = 'tq:install:dismissed'

/** @param {Window} win */
function alreadyInstalled(win) {
  return win.matchMedia('(display-mode: standalone)').matches
    || /** @type {any} */ (win.navigator).standalone === true
}

/** @param {Window} win */
function dismissed(win) {
  try { return win.localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}

/**
 * @param {Window} win
 * @param {(Node|string)[]} content
 * @param {HTMLElement} [primary]
 */
function sheet(win, content, primary) {
  const dismiss = el('button', { class: 'sheet__dismiss', type: 'button' }, ['Not now'])
  const node = el('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Install' },
    [...content, ...(primary ? [primary] : []), dismiss])
  dismiss.addEventListener('click', () => {
    try { win.localStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode */ }
    node.remove()
  })
  win.document.body.append(node)
  return node
}

/**
 * Android fires beforeinstallprompt; iOS fires nothing and requires the user to
 * perform the Share → Add to Home Screen gesture themselves, so it gets drawn
 * instructions instead. Dismissed once, remembered forever.
 *
 * @param {Window} win
 */
export function startInstallCoach(win) {
  if (alreadyInstalled(win) || dismissed(win)) return

  win.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    const deferred = /** @type {any} */ (event)
    const button = el('button', { class: 'arm__button', type: 'button' }, ['Install'])
    const node = sheet(win, [el('p', {}, ['Install The Quantitative for offline use.'])], button)
    button.addEventListener('click', async () => {
      node.remove()
      deferred.prompt()
      await deferred.userChoice
    }, { once: true })
  })

  if (isIos(readEnv())) {
    sheet(win, [
      el('p', {}, [
        'Install to your home screen: tap the Share button in the toolbar, ',
        'then scroll down and choose ',
        el('strong', {}, ['Add to Home Screen']),
        '.',
      ]),
      el('p', { class: 'card__reason' }, ['Works in Safari and Chrome. Runs full-screen, and works with no signal.']),
    ])
  }
}
