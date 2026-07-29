// @ts-check
import { gravityToTilt, alphaFor, lowPassVec, applyCalibration } from '../dsp/tilt.js'

/** @typedef {import('../js/types.js').Instrument} Instrument */
/** @typedef {import('../js/types.js').Ctx} Ctx */
/** @typedef {import('../js/types.js').Tilt} Tilt */
/** @typedef {import('../js/types.js').Vec3} Vec3 */

const TAU = 0.12        // seconds — smoothing time constant
const RANGE = 15        // degrees of tilt mapped to full bubble travel
const LEVEL_EPS = 0.15  // degrees within which we call it level

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** @param {number} deg */
const fmt = (deg) => (Math.abs(deg) < 0.05 ? '0.0' : deg.toFixed(1))

/** @type {Instrument} */
export default {
  id: 'level',
  name: 'Spirit Level',
  category: 'world',
  blurb: 'Two-axis inclinometer. Tap to zero.',
  needs: ['motion'],

  /**
   * @param {HTMLElement} root
   * @param {Ctx} ctx
   * @returns {() => void}
   */
  mount(root, ctx) {
    root.innerHTML = `
      <div class="level">
        <div class="level__readouts">
          <div class="level__axis">
            <span class="label">Pitch</span>
            <span class="readout" data-pitch>—.—<span class="readout__unit">°</span></span>
          </div>
          <div class="level__axis">
            <span class="label">Roll</span>
            <span class="readout" data-roll>—.—<span class="readout__unit">°</span></span>
          </div>
        </div>
        <canvas class="level__vial" data-vial></canvas>
        <div class="level__actions">
          <button class="arm__button arm__button--quiet" type="button" data-zero>Tap to zero</button>
          <button class="arm__button arm__button--quiet" type="button" data-reset>Clear zero</button>
        </div>
      </div>`

    const pitchOut = /** @type {HTMLElement} */ (root.querySelector('[data-pitch]'))
    const rollOut = /** @type {HTMLElement} */ (root.querySelector('[data-roll]'))
    const canvas = /** @type {HTMLCanvasElement} */ (root.querySelector('[data-vial]'))
    const zeroBtn = /** @type {HTMLElement} */ (root.querySelector('[data-zero]'))
    const resetBtn = /** @type {HTMLElement} */ (root.querySelector('[data-reset]'))
    const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))

    const stored = /** @type {Tilt|undefined} */ (ctx.store.get('zero'))
    /** @type {Tilt} */
    let zero = stored && Number.isFinite(stored.pitch) && Number.isFinite(stored.roll)
      ? stored
      : { pitch: 0, roll: 0 }

    /** @type {Vec3} */
    let smoothed = { x: 0, y: 0, z: 1 }
    /** @type {Tilt} */
    let tilt = { pitch: 0, roll: 0 }
    let seenSample = false
    let noData = false

    // A confident-looking reading with no sensor data is worse than no reading
    // at all — the bubble must never claim "level" until a real sample has
    // arrived. If none arrives in a reasonable window, say so plainly instead
    // of leaving the instrument silently frozen at its seed values.
    const noDataTimer = setTimeout(() => {
      if (seenSample) return
      noData = true
      // The permission was granted and DeviceMotionEvent exists, yet nothing is
      // arriving. Feature detection cannot see this: browsers that block motion
      // as a fingerprinting vector — Brave's Shields by default — still expose
      // the constructor and simply never fire the event. Verified on a Pixel:
      // works in Chrome, silent in Brave. So name the likely cause rather than
      // blaming the device.
      root.innerHTML = `
        <div class="arm">
          <p class="arm__body">No motion data is arriving.</p>
          <p class="arm__body">Some browsers block motion sensors as a
          fingerprinting defence. In Brave, check Shields → Fingerprinting
          blocking. Otherwise this device may have no accelerometer.</p>
          <a class="label" href="#/">← All instruments</a>
        </div>`
    }, 1500)
    ctx.on(ctx.signal, 'abort', () => clearTimeout(noDataTimer))

    ctx.wakeLock()

    ctx.motion((g, dt) => {
      // First real sample seeds the filter directly, so the bubble does not
      // sweep in from a fictional starting position on mount.
      smoothed = seenSample ? lowPassVec(smoothed, g, alphaFor(dt, TAU)) : g
      seenSample = true
      tilt = applyCalibration(gravityToTilt(smoothed), zero)
    })

    ctx.on(zeroBtn, 'click', () => {
      zero = gravityToTilt(smoothed)
      ctx.store.set('zero', zero)
    })

    ctx.on(resetBtn, 'click', () => {
      zero = { pitch: 0, roll: 0 }
      ctx.store.set('zero', zero)
    })

    /** Size the backing store to the device pixel grid so hairlines stay hair-thin. */
    function resize() {
      const dpr = window.devicePixelRatio || 1
      const side = Math.min(canvas.clientWidth, canvas.clientHeight)
      canvas.width = Math.round(side * dpr)
      canvas.height = Math.round(side * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    ctx.on(window, 'resize', resize)
    ctx.on(window, 'orientationchange', resize)

    const styles = getComputedStyle(document.documentElement)
    const SIGNAL = styles.getPropertyValue('--signal').trim() || '#ffb000'
    const EDGE = styles.getPropertyValue('--edge').trim() || '#55606e'
    const INK_DIM = styles.getPropertyValue('--ink-dim').trim() || '#4d545c'

    ctx.raf(() => {
      if (noData) return

      // Never print a number, and never touch the ring below, until a real
      // sample has arrived — the seed values are not a measurement.
      if (seenSample) {
        pitchOut.firstChild && (pitchOut.firstChild.textContent = fmt(tilt.pitch))
        rollOut.firstChild && (rollOut.firstChild.textContent = fmt(tilt.roll))
      }

      const w = canvas.width / (window.devicePixelRatio || 1)
      const c = w / 2
      const r = c - 8

      context.clearRect(0, 0, w, w)

      // Vial: outer ring plus concentric tolerance rings and a crosshair.
      context.strokeStyle = EDGE
      context.lineWidth = 1
      context.beginPath(); context.arc(c, c, r, 0, Math.PI * 2); context.stroke()
      context.beginPath(); context.arc(c, c, r * 0.5, 0, Math.PI * 2); context.stroke()

      context.strokeStyle = INK_DIM
      context.beginPath()
      context.moveTo(c - r, c); context.lineTo(c + r, c)
      context.moveTo(c, c - r); context.lineTo(c, c + r)
      context.stroke()

      if (!seenSample) return

      // Bubble. Roll drives x, pitch drives y; y is inverted so raising the top
      // edge moves the bubble up the screen, matching a physical vial.
      const bx = c + (clamp(tilt.roll, -RANGE, RANGE) / RANGE) * r
      const by = c - (clamp(tilt.pitch, -RANGE, RANGE) / RANGE) * r
      const level = Math.abs(tilt.pitch) < LEVEL_EPS && Math.abs(tilt.roll) < LEVEL_EPS

      context.fillStyle = SIGNAL
      context.globalAlpha = level ? 1 : 0.55
      context.beginPath(); context.arc(bx, by, 9, 0, Math.PI * 2); context.fill()
      context.globalAlpha = 1

      if (level) {
        context.strokeStyle = SIGNAL
        context.lineWidth = 2
        context.beginPath(); context.arc(c, c, r * 0.5, 0, Math.PI * 2); context.stroke()
      }
    })

    return () => { root.replaceChildren() }
  },
}
