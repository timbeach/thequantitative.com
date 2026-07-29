// @ts-check
import { aWeightedLevelDb, binFrequencies } from '../dsp/a-weighting.js'
import { alphaFor } from '../dsp/smoothing.js'

/** @typedef {import('../js/types.js').Instrument} Instrument */
/** @typedef {import('../js/types.js').Ctx} Ctx */

const FFT_SIZE = 4096
const TAU_FAST = 0.125          // IEC 61672-1 "F"
const TAU_SLOW = 1.0            // IEC 61672-1 "S"
const DEFAULT_OFFSET = 100      // nominal only — see the honesty note below
const FLOOR_DB = -120

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
/** @param {number} db */
const fmt = (db) => (Number.isFinite(db) ? db.toFixed(1) : '—.—')

/** @type {Instrument} */
export default {
  id: 'db-meter',
  name: 'Sound Level',
  category: 'world',
  blurb: 'A-weighted sound pressure, live.',
  needs: ['microphone'],

  /**
   * @param {HTMLElement} root
   * @param {Ctx} ctx
   * @returns {() => void}
   */
  mount(root, ctx) {
    root.innerHTML = `
      <div class="dbm">
        <div class="dbm__main">
          <span class="label">Sound level <span data-weighting>A-weighted, fast</span></span>
          <span class="readout" data-level>—.—<span class="readout__unit">dB</span></span>
          <p class="dbm__caveat card__reason" data-caveat></p>
        </div>
        <canvas class="dbm__bar" data-bar></canvas>
        <div class="dbm__stats">
          <div class="dbm__stat"><span class="label">Min</span><span class="readout" data-min>—.—</span></div>
          <div class="dbm__stat"><span class="label">Mean</span><span class="readout" data-mean>—.—</span></div>
          <div class="dbm__stat"><span class="label">Max</span><span class="readout" data-max>—.—</span></div>
        </div>
        <div class="dbm__actions">
          <button class="arm__button arm__button--quiet" type="button" data-ballistics></button>
          <button class="arm__button arm__button--quiet" type="button" data-cal-down>Cal −1</button>
          <button class="arm__button arm__button--quiet" type="button" data-cal-up>Cal +1</button>
          <button class="arm__button arm__button--quiet" type="button" data-reset>Reset</button>
        </div>
      </div>`

    const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (root.querySelector(s))
    const canvas = /** @type {HTMLCanvasElement} */ (root.querySelector('[data-bar]'))
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))

    const store = ctx.store
    let offset = Number(store.get('offset'))
    let calibrated = store.get('calibrated') === true
    if (!Number.isFinite(offset)) offset = DEFAULT_OFFSET
    /** @type {'fast'|'slow'} */
    let ballistics = store.get('ballistics') === 'slow' ? 'slow' : 'fast'

    let smoothed = Number.NaN     // NaN until the first real sample
    let min = Infinity, max = -Infinity, sum = 0, count = 0
    let ready = false

    const styles = getComputedStyle(document.documentElement)
    const SIGNAL = styles.getPropertyValue('--signal').trim() || '#ffb000'
    const EDGE = styles.getPropertyValue('--edge').trim() || '#55606e'

    function syncLabels() {
      $('[data-weighting]').textContent = `A-weighted, ${ballistics}`
      $('[data-ballistics]').textContent = ballistics === 'fast' ? 'Fast (125 ms)' : 'Slow (1 s)'
      $('[data-caveat]').textContent = calibrated
        ? `Calibration offset ${offset > 0 ? '+' : ''}${offset} dB, set by you.`
        : `Offset ${offset > 0 ? '+' : ''}${offset} dB is nominal — readings are relative, not calibrated SPL. `
          + `A browser cannot know this microphone's sensitivity.`
    }

    function resetStats() {
      min = Infinity; max = -Infinity; sum = 0; count = 0; smoothed = Number.NaN
    }

    ctx.on($('[data-ballistics]'), 'click', () => {
      ballistics = ballistics === 'fast' ? 'slow' : 'fast'
      store.set('ballistics', ballistics)
      syncLabels()
    })
    ctx.on($('[data-cal-up]'), 'click', () => {
      offset = clamp(offset + 1, 0, 160); calibrated = true
      store.set('offset', offset); store.set('calibrated', true)
      resetStats(); syncLabels()
    })
    ctx.on($('[data-cal-down]'), 'click', () => {
      offset = clamp(offset - 1, 0, 160); calibrated = true
      store.set('offset', offset); store.set('calibrated', true)
      resetStats(); syncLabels()
    })
    ctx.on($('[data-reset]'), 'click', resetStats)

    function resize() {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(canvas.clientWidth * dpr)
      canvas.height = Math.round(canvas.clientHeight * dpr)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    ctx.on(window, 'resize', resize)
    ctx.on(window, 'orientationchange', resize)

    ctx.wakeLock()

    /** @type {AnalyserNode | null} */
    let analyser = null
    let spectrum = new Float32Array(0)
    /** @type {Float64Array} */
    let binHz = new Float64Array(0)

    ctx.mic().then((source) => {
      const audio = ctx.audio()
      analyser = audio.createAnalyser()
      analyser.fftSize = FFT_SIZE
      // Zero: the node's own smoothing would compound with our ballistics and
      // make the effective time constant unknowable. The standard's detector
      // is the only smoothing this instrument applies.
      analyser.smoothingTimeConstant = 0
      source.connect(analyser)
      spectrum = new Float32Array(analyser.frequencyBinCount)
      binHz = binFrequencies(analyser.frequencyBinCount, audio.sampleRate, FFT_SIZE)
      ready = true
    }).catch(() => {
      $('[data-caveat]').textContent = 'The microphone could not be opened.'
    })

    let last = 0
    ctx.raf((now) => {
      const dt = last === 0 ? 1 / 60 : Math.min((now - last) / 1000, 0.25)
      last = now

      if (ready && analyser) {
        analyser.getFloatFrequencyData(spectrum)
        const raw = aWeightedLevelDb(spectrum, binHz)
        if (Number.isFinite(raw)) {
          const level = raw + offset
          const tau = ballistics === 'fast' ? TAU_FAST : TAU_SLOW
          smoothed = Number.isNaN(smoothed)
            ? level
            : smoothed + alphaFor(dt, tau) * (level - smoothed)
          if (smoothed < min) min = smoothed
          if (smoothed > max) max = smoothed
          sum += smoothed
          count++
        }
      }

      $('[data-level]').firstChild &&
        (/** @type {ChildNode} */ ($('[data-level]').firstChild).textContent = fmt(smoothed))
      $('[data-min]').textContent = count ? fmt(min) : '—.—'
      $('[data-mean]').textContent = count ? fmt(sum / count) : '—.—'
      $('[data-max]').textContent = count ? fmt(max) : '—.—'

      // Bar: floor..offset+0 maps to the full width.
      const dpr = window.devicePixelRatio || 1
      const W = canvas.width / dpr, H = canvas.height / dpr
      g.clearRect(0, 0, W, H)
      g.strokeStyle = EDGE
      g.lineWidth = 1
      g.strokeRect(0.5, 0.5, W - 1, H - 1)
      if (Number.isFinite(smoothed)) {
        const lo = offset + FLOOR_DB, hi = offset
        const frac = clamp((smoothed - lo) / (hi - lo), 0, 1)
        g.fillStyle = SIGNAL
        g.fillRect(1, 1, (W - 2) * frac, H - 2)
      }
    })

    syncLabels()

    return () => { root.replaceChildren() }
  },
}
