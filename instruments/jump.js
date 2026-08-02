// @ts-check
import { createJumpDetector } from '../dsp/freefall.js'

/** @typedef {import('../js/types.js').Instrument} Instrument */
/** @typedef {import('../js/types.js').Ctx} Ctx */
/** @typedef {import('../dsp/freefall.js').Jump} Jump */

const HISTORY = 8
const FLASH_FRAMES = 54          // ~0.9s at 60fps, counted in frames not clock time

/** @param {number} m @returns {string} */
const cm = (m) => (m * 100).toFixed(1)

/** @type {Instrument} */
export default {
  id: 'jump',
  name: 'Jump Height',
  category: 'world',
  blurb: 'Hold the phone and jump. Measured from hang time.',
  needs: ['motion'],

  /**
   * @param {HTMLElement} root
   * @param {Ctx} ctx
   * @returns {() => void}
   */
  mount(root, ctx) {
    root.innerHTML = `
      <div class="jump">
        <div class="jump__main">
          <span class="label">Jump height</span>
          <span class="readout" data-height>—<span class="readout__unit">cm</span></span>
          <span class="jump__pm label" data-pm>hold the phone and jump</span>
        </div>
        <div class="jump__stats">
          <div class="jump__stat"><span class="label">Hang</span><span class="readout" data-hang>—</span></div>
          <div class="jump__stat"><span class="label">Best</span><span class="readout" data-best>—</span></div>
        </div>
        <ol class="jump__history" data-history></ol>
        <div class="jump__actions">
          <button class="arm__button arm__button--quiet" type="button" data-reset>Clear best</button>
        </div>
      </div>`

    const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (root.querySelector(s))
    const store = ctx.store

    let best = Number(store.get('best'))
    if (!Number.isFinite(best) || best <= 0) best = 0
    /** @type {Jump[]} */
    const history = []
    let flashFrames = 0

    // Timestamps are accumulated from the dt ctx.motion already supplies, so
    // this module needs no clock of its own. Only relative time matters here.
    let tMs = 0
    const detect = createJumpDetector()

    function renderBest() {
      $('[data-best]').textContent = best > 0 ? cm(best) : '—'
    }

    function renderHistory() {
      const list = $('[data-history]')
      list.replaceChildren()
      for (const j of history) {
        const li = document.createElement('li')
        li.className = 'jump__row'
        const h = document.createElement('span')
        h.textContent = `${cm(j.heightM)} cm`
        const t = document.createElement('span')
        t.className = 'jump__row-hang'
        t.textContent = `${j.hangMs.toFixed(0)} ms`
        li.append(h, t)
        list.append(li)
      }
    }

    ctx.on($('[data-reset]'), 'click', () => {
      best = 0
      store.set('best', 0)
      history.length = 0
      renderBest()
      renderHistory()
    })

    ctx.wakeLock()

    ctx.motion((g, dt) => {
      tMs += dt * 1000
      const magnitude = Math.hypot(g.x, g.y, g.z)
      const jump = detect(magnitude, tMs)
      if (!jump) return

      history.unshift(jump)
      if (history.length > HISTORY) history.pop()

      const heightEl = $('[data-height]')
      if (heightEl.firstChild) heightEl.firstChild.textContent = cm(jump.heightM)
      $('[data-pm]').textContent =
        `± ${cm(jump.uncertaintyM)} cm · ${jump.hangMs.toFixed(0)} ms airborne`
      $('[data-hang]').textContent = jump.hangMs.toFixed(0)

      if (jump.heightM > best) {
        best = jump.heightM
        store.set('best', best)
        flashFrames = FLASH_FRAMES
      }
      renderBest()
      renderHistory()
    })

    // The flash is the only animation, and it is what makes a new best feel
    // like an event rather than a number quietly changing.
    ctx.raf(() => {
      if (flashFrames > 0) flashFrames--
      root.firstElementChild?.classList.toggle('jump--best', flashFrames > 0)
    })

    renderBest()
    renderHistory()

    return () => { root.replaceChildren() }
  },
}
