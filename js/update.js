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

  let reloading = false
  win.navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    win.location.reload()
  })

  /** @param {ServiceWorker} worker */
  function offer(worker) {
    if (win.document.querySelector('[data-update-pill]')) return
    const button = el('button', { class: 'arm__button', type: 'button' }, ['Reload'])
    const pill = el('div', { class: 'sheet', 'data-update-pill': '', role: 'status' }, [
      el('p', {}, ['New version available.']),
      button,
    ])
    button.addEventListener('click', () => worker.postMessage('skip-waiting'), { once: true })
    win.document.body.append(pill)
  }
}
