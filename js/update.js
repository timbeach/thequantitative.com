// @ts-check
import { el } from './util.js'

/**
 * Register the worker and surface a tap-to-reload pill when a new version is
 * waiting. Never reloads on its own — a silent reload mid-measurement discards
 * whatever the user was reading.
 *
 * @param {Window} win
 */
export function startUpdateWatch(win) {
  if (!('serviceWorker' in win.navigator)) return

  win.navigator.serviceWorker.register('/sw.js').then((reg) => {
    /** @param {ServiceWorker|null} worker */
    const watch = (worker) => {
      if (!worker) return
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && win.navigator.serviceWorker.controller) offer(worker)
      })
    }

    if (reg.waiting && win.navigator.serviceWorker.controller) offer(reg.waiting)
    reg.addEventListener('updatefound', () => watch(reg.installing))
  }).catch(() => { /* registration failed — the site still works, just online-only */ })

  let expectReload = false
  win.navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only reload for an update the user accepted. A first visit also fires
    // this — sw.js calls clients.claim() on activate — and reloading then
    // discards an iOS motion grant, which does not survive a page load.
    if (!expectReload) return
    expectReload = false
    win.location.reload()
  })

  /** @param {ServiceWorker} worker */
  function offer(worker) {
    if (win.document.querySelector('[data-update-pill]')) return
    const button = el('button', { class: 'arm__button', type: 'button' }, ['Reload'])
    // No persistence for this dismissal — unlike the install coach, the update
    // really is still pending, so it should offer again on the next load.
    const dismiss = el('button', { class: 'sheet__dismiss', type: 'button' }, ['Not now'])
    const pill = el('div', { class: 'sheet', 'data-update-pill': '', role: 'status' }, [
      el('p', {}, ['New version available.']),
      button,
      dismiss,
    ])
    button.addEventListener('click', () => {
      expectReload = true
      worker.postMessage('skip-waiting')
    }, { once: true })
    dismiss.addEventListener('click', () => pill.remove(), { once: true })
    win.document.body.append(pill)
  }
}
