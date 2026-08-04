// @ts-check
import { createGravityFilter, createPeakHold, rms } from '../dsp/seismo.js'
import { alphaFor } from '../dsp/smoothing.js'

/** @typedef {import('../js/types.js').Instrument} Instrument */
/** @typedef {import('../js/types.js').Ctx} Ctx */

const STRIP_WINDOW = 8        // seconds visible across the strip before it scrolls
const NOISE_WINDOW = 2        // seconds — "the last couple of seconds" for the floor
const MIN_NOISE_SAMPLES = 4   // buffer must hold at least this many before the
                               // floor is trusted enough to display
const NOISE_QUIET_RATIO = 4   // a window only updates the floor if its own peak
                               // sample is under this multiple of its own RMS —
                               // RMS <= max always, so this is really "did this
                               // window contain an outlier," not a fixed threshold
const NOISE_SMOOTH_TAU = 1.5  // seconds — damps the floor estimate so it doesn't
                               // twitch sample to sample

const RANGE_DECAY = 0.6       // m/s² per second — the axis half-scale relaxes
                               // back down at this rate after an event, rather
                               // than snapping straight back to the floor
const RANGE_HEADROOM = 1.3    // multiplier above the recent-peak envelope, so a
                               // fresh spike isn't drawn clipped against the top
const RANGE_FLOOR_MULT = 8    // the axis half-scale never drops below this many
                               // noise floors. THE anti-lie guard: anchoring the
                               // range to the measured noise floor, not to the
                               // raw peak, is what stops a noisy phone's own
                               // sensor noise from filling the chart and looking
                               // like it's detecting earthquakes.
const MIN_RANGE = 0.05        // m/s² — axis floor before any noise estimate exists

const PEAK_MARK_MULT = 4      // a sample above this many noise floors gets a
                               // marker on the trace

const CAVEAT = 'A slow, deliberate tilt also shows up here. Gravity and ' +
  'acceleration are indistinguishable in principle — this filter separates ' +
  'them by timescale, not by physics.'

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
/** @param {number} v @param {number} [digits] */
const fmt = (v, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : '—')

/**
 * @typedef {Object} TracePoint
 * @property {number} t seconds since mount
 * @property {number} z signed, gravity-removed acceleration along the device's
 *   own z axis — vertical, for the instrument's intended use lying flat on a
 *   table, which is what makes it worth drawing as a trace that reads both
 *   ways rather than an always-positive envelope
 * @property {boolean} peak whether this sample cleared PEAK_MARK_MULT × floor
 */

/** @type {Instrument} */
export default {
  id: 'seismo',
  name: 'Seismograph',
  category: 'world',
  blurb: 'Put it on a table. Watch the room.',
  needs: ['motion'],

  /**
   * @param {HTMLElement} root
   * @param {Ctx} ctx
   * @returns {() => void}
   */
  mount(root, ctx) {
    root.innerHTML = `
      <div class="seis">
        <div class="seis__readouts">
          <div class="seis__stat">
            <span class="label">Now</span>
            <span class="readout" data-now>—<span class="readout__unit">m/s²</span></span>
          </div>
          <div class="seis__stat">
            <span class="label">Peak</span>
            <span class="readout" data-peak>—<span class="readout__unit">m/s²</span></span>
          </div>
          <div class="seis__stat">
            <span class="label">Noise floor</span>
            <span class="readout" data-floor>—<span class="readout__unit">m/s²</span></span>
          </div>
        </div>
        <div class="seis__view">
          <canvas class="seis__strip" data-strip></canvas>
          <span class="seis__scale label" data-scale>—</span>
        </div>
        <p class="seis__caveat card__reason">${CAVEAT}</p>
        <div class="seis__actions">
          <button class="arm__button arm__button--quiet" type="button" data-reset>Reset peak</button>
        </div>
      </div>`

    const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (root.querySelector(s))
    const strip = /** @type {HTMLCanvasElement} */ (root.querySelector('[data-strip]'))
    const sg = /** @type {CanvasRenderingContext2D} */ (strip.getContext('2d'))

    const styles = getComputedStyle(document.documentElement)
    const SIGNAL = styles.getPropertyValue('--signal').trim() || '#ffb000'
    const ALERT = styles.getPropertyValue('--alert').trim() || '#ff4d4f'
    const EDGE = styles.getPropertyValue('--edge').trim() || '#55606e'

    const gravityFilter = createGravityFilter()
    // Two independent peak-holds, on purpose: the readout is a fact the user
    // reads and clears with the button below; the range envelope is a
    // rendering device that decays on its own slower schedule so the axis
    // doesn't snap. Conflating them would mean clearing one always clears
    // the other, which neither the readout nor the honest-axis requirement
    // wants.
    let peakHold = createPeakHold()
    const rangeEnvelope = createPeakHold({ decayPerSecond: RANGE_DECAY })

    let seenSample = false
    let elapsed = 0
    let current = 0
    let peak = 0
    let rangeSeed = 0

    let haveNoiseFloor = false
    let noiseFloor = 0
    /** @type {{t:number, magnitude:number}[]} */
    let noiseBuffer = []

    /** @type {TracePoint[]} */
    let trace = []

    ctx.on($('[data-reset]'), 'click', () => {
      peakHold = createPeakHold()
    })

    /** Sized to the device pixel grid so hairlines stay hair-thin. */
    let lastW = -1, lastH = -1
    function resize() {
      const dpr = window.devicePixelRatio || 1
      const w = strip.clientWidth, h = strip.clientHeight
      if (w === lastW && h === lastH) return
      lastW = w; lastH = h
      strip.width = Math.round(w * dpr)
      strip.height = Math.round(h * dpr)
      sg.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    ctx.on(window, 'resize', resize)
    ctx.on(window, 'orientationchange', resize)

    ctx.wakeLock()

    ctx.motion((g, dt) => {
      elapsed += dt
      const { linear, magnitude } = gravityFilter(g, dt)
      seenSample = true

      current = magnitude
      peak = peakHold(magnitude, dt)
      rangeSeed = rangeEnvelope(magnitude, dt)

      noiseBuffer.push({ t: elapsed, magnitude })
      const noiseLo = elapsed - NOISE_WINDOW
      while (noiseBuffer.length && (noiseBuffer[0]?.t ?? 0) < noiseLo) noiseBuffer.shift()

      if (noiseBuffer.length >= MIN_NOISE_SAMPLES) {
        const mags = noiseBuffer.map((s) => s.magnitude)
        const windowRms = rms(mags)
        const windowMax = Math.max(...mags)
        // RMS never exceeds max, so this is really asking "did this window
        // contain something that stands out above its own background" — a
        // window with an event in it fails and the floor holds its last
        // known value through the event instead of chasing it up.
        const quiet = windowMax <= windowRms * NOISE_QUIET_RATIO
        if (quiet) {
          noiseFloor = haveNoiseFloor
            ? noiseFloor + alphaFor(dt, NOISE_SMOOTH_TAU) * (windowRms - noiseFloor)
            : windowRms
          haveNoiseFloor = true
        }
      }

      const isPeak = haveNoiseFloor && magnitude > noiseFloor * PEAK_MARK_MULT
      trace.push({ t: elapsed, z: linear.z, peak: isPeak })
      const traceLo = elapsed - STRIP_WINDOW - 1
      while (trace.length && (trace[0]?.t ?? 0) < traceLo) trace.shift()
    })

    ctx.raf(() => {
      resize()

      const nowEl = $('[data-now]')
      const peakEl = $('[data-peak]')
      const floorEl = $('[data-floor]')
      if (nowEl.firstChild) nowEl.firstChild.textContent = seenSample ? fmt(current) : '—'
      if (peakEl.firstChild) peakEl.firstChild.textContent = seenSample ? fmt(peak) : '—'
      if (floorEl.firstChild) floorEl.firstChild.textContent = haveNoiseFloor ? fmt(noiseFloor, 3) : '—'

      const dpr = window.devicePixelRatio || 1
      const W = strip.width / dpr
      const H = strip.height / dpr
      sg.clearRect(0, 0, W, H)
      if (W <= 0 || H <= 0) return

      sg.strokeStyle = EDGE
      sg.globalAlpha = 0.4
      sg.lineWidth = 1
      sg.beginPath()
      sg.moveTo(0, H / 2)
      sg.lineTo(W, H / 2)
      sg.stroke()
      sg.globalAlpha = 1

      if (!seenSample) {
        $('[data-scale]').textContent = '—'
        return
      }

      const floorRange = haveNoiseFloor ? noiseFloor * RANGE_FLOOR_MULT : MIN_RANGE
      const range = Math.max(rangeSeed * RANGE_HEADROOM, floorRange, MIN_RANGE)
      $('[data-scale]').textContent = `full scale ±${range.toFixed(2)} m/s²`

      const halfH = H / 2
      /** @param {number} v */
      const yOf = (v) => halfH - (clamp(v, -range, range) / range) * halfH

      const tHi = Math.max(elapsed, STRIP_WINDOW)
      const tLo = tHi - STRIP_WINDOW
      /** @param {number} t */
      const xOf = (t) => ((t - tLo) / (tHi - tLo)) * W

      if (trace.length < 2) return

      sg.strokeStyle = SIGNAL
      sg.lineWidth = 1.5
      sg.beginPath()
      let started = false
      for (const p of trace) {
        if (p.t < tLo) continue
        const x = xOf(p.t), y = yOf(p.z)
        if (!started) { sg.moveTo(x, y); started = true } else { sg.lineTo(x, y) }
      }
      sg.stroke()

      sg.fillStyle = ALERT
      for (const p of trace) {
        if (p.t < tLo || !p.peak) continue
        const x = xOf(p.t), y = yOf(p.z)
        sg.beginPath()
        sg.arc(x, y, 2.5, 0, Math.PI * 2)
        sg.fill()
      }
    })

    return () => { root.replaceChildren() }
  },
}
