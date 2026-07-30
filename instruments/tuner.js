// @ts-check
import { detectPitch, noteFromHz } from '../dsp/pitch.js'
import { alphaFor } from '../dsp/smoothing.js'

/** @typedef {import('../js/types.js').Instrument} Instrument */
/** @typedef {import('../js/types.js').Ctx} Ctx */

const FFT_SIZE = 4096
const TAU_NEEDLE = 0.08
const MIN_CLARITY = 0.5
const IN_TUNE_CENTS = 5
const SPEC_MIN_HZ = 60
const SPEC_MAX_HZ = 6000
const REFERENCES = [432, 435, 440, 442, 444]

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** @type {Instrument} */
export default {
  id: 'tuner',
  name: 'Tuner',
  category: 'world',
  blurb: 'Chromatic tuner with a live spectrogram.',
  needs: ['microphone'],

  /**
   * @param {HTMLElement} root
   * @param {Ctx} ctx
   * @returns {() => void}
   */
  mount(root, ctx) {
    root.innerHTML = `
      <div class="tuner">
        <div class="tuner__note">
          <span class="readout" data-note>—</span>
          <span class="tuner__cents label" data-cents>no signal</span>
        </div>
        <canvas class="tuner__meter" data-meter></canvas>
        <canvas class="tuner__spec" data-spec></canvas>
        <div class="tuner__actions">
          <button class="arm__button arm__button--quiet" type="button" data-ref></button>
        </div>
      </div>`

    const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (root.querySelector(s))
    const meter = /** @type {HTMLCanvasElement} */ (root.querySelector('[data-meter]'))
    const spec = /** @type {HTMLCanvasElement} */ (root.querySelector('[data-spec]'))
    const mg = /** @type {CanvasRenderingContext2D} */ (meter.getContext('2d'))
    const sg = /** @type {CanvasRenderingContext2D} */ (spec.getContext('2d'))

    const store = ctx.store
    let a4 = Number(store.get('a4'))
    if (!REFERENCES.includes(a4)) a4 = 440

    let cents = 0            // damped, for the needle
    let live = false         // is there a credible pitch right now
    let ready = false

    const styles = getComputedStyle(document.documentElement)
    const SIGNAL = styles.getPropertyValue('--signal').trim() || '#ffb000'
    const EDGE = styles.getPropertyValue('--edge').trim() || '#55606e'
    const DIM = styles.getPropertyValue('--ink-dim').trim() || '#727c88'

    function syncLabels() {
      $('[data-ref]').textContent = `A4 = ${a4} Hz`
    }

    ctx.on($('[data-ref]'), 'click', () => {
      a4 = REFERENCES[(REFERENCES.indexOf(a4) + 1) % REFERENCES.length] ?? 440
      store.set('a4', a4)
      syncLabels()
    })

    function resize() {
      const dpr = window.devicePixelRatio || 1
      for (const [c, g] of /** @type {[HTMLCanvasElement, CanvasRenderingContext2D][]} */ ([[meter, mg], [spec, sg]])) {
        c.width = Math.round(c.clientWidth * dpr)
        c.height = Math.round(c.clientHeight * dpr)
        g.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      sg.fillStyle = '#000'
      sg.fillRect(0, 0, spec.clientWidth, spec.clientHeight)
    }
    resize()
    ctx.on(window, 'resize', resize)
    ctx.on(window, 'orientationchange', resize)

    ctx.wakeLock()

    /** @type {AnalyserNode | null} */
    let analyser = null
    let timeData = new Float32Array(0)
    let freqData = new Uint8Array(0)

    ctx.mic().then((source) => {
      const audio = ctx.audio()
      analyser = audio.createAnalyser()
      analyser.fftSize = FFT_SIZE
      // Applies to frequency data only — the spectrogram. getFloatTimeDomainData
      // is unaffected, so the pitch path still sees raw samples. (Confirmed
      // against the Web Audio spec and cross-checked with db-meter.js, which
      // zeroes this same field for an unrelated reason: it never touches the
      // pitch path at all.)
      analyser.smoothingTimeConstant = 0.5
      source.connect(analyser)
      timeData = new Float32Array(analyser.fftSize)
      freqData = new Uint8Array(analyser.frequencyBinCount)
      ready = true
    }).catch(() => {
      $('[data-cents]').textContent = 'the microphone could not be opened'
    })

    let last = 0
    ctx.raf((now) => {
      const dt = last === 0 ? 1 / 60 : Math.min((now - last) / 1000, 0.25)
      last = now
      const dpr = window.devicePixelRatio || 1

      if (ready && analyser) {
        const audio = ctx.audio()
        analyser.getFloatTimeDomainData(timeData)
        const pitch = detectPitch(timeData, audio.sampleRate, { minClarity: MIN_CLARITY })

        if (pitch) {
          const n = noteFromHz(pitch.hz, a4)
          live = true
          cents += alphaFor(dt, TAU_NEEDLE) * (n.cents - cents)
          $('[data-note]').textContent = `${n.name}${n.octave}`
          const shown = Math.round(cents)
          $('[data-cents]').textContent =
            `${shown > 0 ? '+' : ''}${shown} cents · ${pitch.hz.toFixed(1)} Hz`
        } else {
          live = false
          $('[data-note]').textContent = '—'
          $('[data-cents]').textContent = 'no signal'
        }

        // ── spectrogram: scroll left one CSS pixel, draw the new column ────
        analyser.getByteFrequencyData(freqData)
        const SW = spec.width / dpr
        const SH = spec.height / dpr
        // The context already has setTransform(dpr, …) applied, so every
        // coordinate drawImage takes here is in CSS pixels, NOT device pixels
        // — offsetting by `dpr` would over-scroll by the device pixel ratio.
        //
        // But the offset is not the only trap: drawImage's 2-argument form
        // (dx, dy only) draws the source at ITS OWN intrinsic size — and a
        // canvas's intrinsic size is its backing-store (device-pixel) width
        // and height, not its CSS size. Fed through this context's dpr scale
        // a second time, that silently blows the image up by dpr² and (on a
        // self-blit) degenerates the whole canvas into a smeared crop within
        // a couple of frames — confirmed empirically: a marker pixel painted
        // at a known position vanished into solid color the instant a bare
        // `drawImage(spec, dx, 0)` ran under this transform, regardless of
        // dx. Passing explicit CSS-pixel dWidth/dHeight is what fixes both
        // problems at once, and was verified pixel-by-pixel to shift a
        // painted marker by exactly one CSS pixel per call, repeatably.
        sg.drawImage(spec, -1, 0, SW, SH)
        sg.fillStyle = '#000'
        sg.fillRect(SW - 1, 0, 1, SH)
        const bins = freqData.length
        const nyquist = audio.sampleRate / 2
        for (let y = 0; y < SH; y++) {
          // log frequency, low at the bottom
          const frac = 1 - y / SH
          const hz = SPEC_MIN_HZ * (SPEC_MAX_HZ / SPEC_MIN_HZ) ** frac
          const bin = Math.min(bins - 1, Math.round((hz / nyquist) * bins))
          const v = (freqData[bin] ?? 0) / 255
          if (v <= 0.04) continue
          sg.globalAlpha = v
          sg.fillStyle = SIGNAL
          sg.fillRect(SW - 1, y, 1, 1)
        }
        sg.globalAlpha = 1
      }

      // ── cents meter ───────────────────────────────────────────────────
      const W = meter.width / dpr
      const H = meter.height / dpr
      mg.clearRect(0, 0, W, H)
      const mid = W / 2

      // scale: ±50 cents across the full width
      mg.strokeStyle = EDGE
      mg.lineWidth = 1
      for (const c of [-50, -25, 0, 25, 50]) {
        const x = mid + (c / 50) * (W / 2 - 2)
        const tall = c === 0
        mg.beginPath()
        mg.moveTo(x, tall ? 2 : H * 0.28)
        mg.lineTo(x, H - (tall ? 2 : H * 0.28))
        mg.stroke()
      }

      // in-tune band
      mg.fillStyle = EDGE
      mg.globalAlpha = 0.35
      const bandW = (IN_TUNE_CENTS / 50) * (W / 2 - 2) * 2
      mg.fillRect(mid - bandW / 2, H * 0.2, bandW, H * 0.6)
      mg.globalAlpha = 1

      // needle
      const inTune = live && Math.abs(cents) <= IN_TUNE_CENTS
      mg.strokeStyle = live ? SIGNAL : DIM
      mg.globalAlpha = live ? 1 : 0.4
      mg.lineWidth = inTune ? 4 : 2
      const nx = mid + (clamp(live ? cents : 0, -50, 50) / 50) * (W / 2 - 2)
      mg.beginPath()
      mg.moveTo(nx, 0)
      mg.lineTo(nx, H)
      mg.stroke()
      mg.globalAlpha = 1
    })

    syncLabels()

    return () => { root.replaceChildren() }
  },
}
