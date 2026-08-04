// @ts-check
import { highPass2, estimateRate } from '../dsp/ppg.js'

/** @typedef {import('../js/types.js').Instrument} Instrument */
/** @typedef {import('../js/types.js').Ctx} Ctx */
/** @typedef {import('../js/types.js').CameraHandle} CameraHandle */

const WINDOW_SECONDS = 15       // analysis window — long enough for the NSDF to
                                 // see several repetitions even at 40 BPM's
                                 // ~1.5 s cycle, which is what the clarity gate
                                 // actually needs to be trustworthy
const TRACE_SECONDS = 8         // visible width of the scrolling waveform
const ESTIMATE_INTERVAL = 0.3   // throttle for the NSDF recompute (~O(n²)); the
                                 // filtered trace itself redraws every frame
const CORNER_HZ = 0.7           // Passed explicitly to estimateRate below so the
                                 // drawn trace and the reading are provably the
                                 // same filtered signal, rather than relying on
                                 // two independent defaults to happen to agree.
                                 // See dsp/ppg.js for why 0.7 was chosen.
const MIN_CLARITY = 0.5
const OFFSCREEN_W = 20          // averaged, not viewed — a handful of pixels is
const OFFSCREEN_H = 15          // plenty and keeps this off the per-frame budget
const RANGE_HEADROOM = 1.2
const MIN_RANGE = 2             // red-channel units (0-255 scale) — floor so a
                                 // flat or barely-noisy trace isn't amplified
                                 // into something that looks like a signal

const INSTRUCTIONS = 'Cover the lens and the flash with a fingertip. Press ' +
  'gently — pressing hard blocks blood flow in the capillaries and kills the ' +
  'signal entirely. Hold still.'
const NO_READING_HINT = 'No credible pulse — check the fingertip fully covers ' +
  'the lens and the flash, press gently, and hold still.'
const NO_TORCH_HINT = 'This device has no torch control. It works fine here — ' +
  'it just needs decent ambient light.'
const CAMERA_ERROR_HINT = 'The camera could not be opened.'

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** @type {Instrument} */
export default {
  id: 'pulse',
  name: 'Heart Rate',
  category: 'world',
  blurb: 'Cover the camera with a fingertip.',
  needs: ['camera'],

  /**
   * @param {HTMLElement} root
   * @param {Ctx} ctx
   * @returns {() => void}
   */
  mount(root, ctx) {
    root.innerHTML = `
      <div class="pulse">
        <div class="pulse__main">
          <span class="label">Heart rate</span>
          <span class="readout" data-bpm>—<span class="readout__unit">bpm</span></span>
          <div class="pulse__gauge" data-gauge>
            <div class="pulse__gauge-fill" data-gauge-fill></div>
          </div>
          <span class="pulse__gauge-label label" data-gauge-label>—</span>
        </div>
        <canvas class="pulse__wave" data-wave></canvas>
        <p class="pulse__hint card__reason" data-hint></p>
        <p class="pulse__instructions card__reason">${INSTRUCTIONS}</p>
        <p class="pulse__torch-note card__reason" data-torch-note hidden></p>
        <div class="pulse__actions">
          <button class="arm__button arm__button--quiet" type="button" data-torch hidden></button>
        </div>
      </div>`

    const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (root.querySelector(s))
    const wave = /** @type {HTMLCanvasElement} */ (root.querySelector('[data-wave]'))
    const wg = /** @type {CanvasRenderingContext2D} */ (wave.getContext('2d'))
    const bpmEl = $('[data-bpm]')
    const gaugeFill = $('[data-gauge-fill]')
    const gaugeLabel = $('[data-gauge-label]')
    const hintEl = $('[data-hint]')
    const torchNote = $('[data-torch-note]')
    const torchBtn = /** @type {HTMLButtonElement} */ ($('[data-torch]'))

    const styles = getComputedStyle(document.documentElement)
    const SIGNAL = styles.getPropertyValue('--signal').trim() || '#ffb000'
    const EDGE = styles.getPropertyValue('--edge').trim() || '#55606e'
    const DIM = styles.getPropertyValue('--ink-dim').trim() || '#727c88'

    // Offscreen — never attached to the DOM. Frames are drawn small and
    // averaged here, never inspected pixel-by-pixel at capture resolution.
    const off = document.createElement('canvas')
    off.width = OFFSCREEN_W
    off.height = OFFSCREEN_H
    const og = /** @type {CanvasRenderingContext2D} */ (off.getContext('2d', { willReadFrequently: true }))

    /** @type {'opening'|'ready'|'error'} */
    let cameraState = 'opening'
    /** @type {CameraHandle | null} */
    let handle = null
    let torchSupported = false
    let torchOn = false

    function syncTorchUi() {
      torchBtn.hidden = !torchSupported
      torchBtn.textContent = `Torch: ${torchOn ? 'on' : 'off'}`
      torchNote.hidden = torchSupported
      if (!torchSupported) torchNote.textContent = NO_TORCH_HINT
    }

    ctx.camera().then((h) => {
      handle = h
      cameraState = 'ready'
      return h.setTorch(true)
    }).then((ok) => {
      torchSupported = ok
      torchOn = ok
      syncTorchUi()
    }).catch(() => {
      cameraState = 'error'
    })

    ctx.on(torchBtn, 'click', () => {
      if (!handle || !torchSupported) return
      const next = !torchOn
      handle.setTorch(next).then((ok) => {
        torchOn = ok ? next : torchOn
        syncTorchUi()
      })
    })

    /** Sized to the device pixel grid so hairlines stay hair-thin. */
    let lastW = -1, lastH = -1
    function resize() {
      const dpr = window.devicePixelRatio || 1
      const w = wave.clientWidth, h = wave.clientHeight
      if (w === lastW && h === lastH) return
      lastW = w; lastH = h
      wave.width = Math.round(w * dpr)
      wave.height = Math.round(h * dpr)
      wg.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    ctx.on(window, 'resize', resize)
    ctx.on(window, 'orientationchange', resize)

    ctx.wakeLock()

    let elapsed = 0
    let last = 0
    /** @type {number[]} */
    let rawT = []
    /** @type {number[]} */
    let rawV = []
    let sinceEstimate = 0
    /** @type {{ bpm: number, clarity: number } | null} */
    let lastResult = null
    // Set once, on the very first sample. The rolling buffer below is
    // continuously trimmed to at most WINDOW_SECONDS of history, which means
    // its own span asymptotically approaches WINDOW_SECONDS but — by that
    // same trimming — never actually reaches or exceeds it. "Ready" has to be
    // measured against wall-clock time since recording started instead, or
    // the fill gauge sits at "100%" forever without ever opening.
    /** @type {number | null} */
    let recordingStart = null

    /** @param {number} fillFrac */
    function updateReadouts(fillFrac) {
      const bpmText = bpmEl.firstChild

      if (cameraState === 'error') {
        if (bpmText) bpmText.textContent = '—'
        gaugeFill.style.width = '0%'
        gaugeFill.classList.remove('pulse__gauge-fill--live')
        gaugeLabel.textContent = '—'
        hintEl.textContent = CAMERA_ERROR_HINT
        return
      }
      if (cameraState === 'opening') {
        if (bpmText) bpmText.textContent = '—'
        gaugeFill.style.width = '0%'
        gaugeFill.classList.remove('pulse__gauge-fill--live')
        gaugeLabel.textContent = '—'
        hintEl.textContent = 'Opening camera…'
        return
      }
      if (fillFrac < 1) {
        if (bpmText) bpmText.textContent = '—'
        gaugeFill.style.width = `${Math.round(fillFrac * 100)}%`
        gaugeFill.classList.remove('pulse__gauge-fill--live')
        gaugeLabel.textContent = `Building signal — ${Math.round(fillFrac * 100)}%`
        hintEl.textContent = ''
        return
      }
      if (!lastResult) {
        if (bpmText) bpmText.textContent = '—'
        gaugeFill.style.width = '0%'
        gaugeFill.classList.remove('pulse__gauge-fill--live')
        gaugeLabel.textContent = 'no credible pulse'
        hintEl.textContent = NO_READING_HINT
        return
      }
      if (bpmText) bpmText.textContent = String(Math.round(lastResult.bpm))
      gaugeFill.style.width = `${Math.round(lastResult.clarity * 100)}%`
      gaugeFill.classList.add('pulse__gauge-fill--live')
      gaugeLabel.textContent = `confidence ${Math.round(lastResult.clarity * 100)}%`
      hintEl.textContent = ''
    }

    /** @param {Float64Array | null} filtered */
    function draw(filtered) {
      const dpr = window.devicePixelRatio || 1
      const W = wave.width / dpr, H = wave.height / dpr
      wg.clearRect(0, 0, W, H)
      if (W <= 0 || H <= 0) return

      wg.strokeStyle = EDGE
      wg.globalAlpha = 0.4
      wg.lineWidth = 1
      wg.beginPath()
      wg.moveTo(0, H / 2)
      wg.lineTo(W, H / 2)
      wg.stroke()
      wg.globalAlpha = 1

      if (!filtered || rawT.length < 2) return

      const tHi = Math.max(elapsed, TRACE_SECONDS)
      const tLo = tHi - TRACE_SECONDS

      let lo = Infinity, hi = -Infinity
      /** @type {[number, number][]} */
      const pts = []
      for (let i = 0; i < rawT.length; i++) {
        const t = rawT[i] ?? 0
        if (t < tLo) continue
        const v = filtered[i] ?? 0
        if (v < lo) lo = v
        if (v > hi) hi = v
        pts.push([t, v])
      }
      if (pts.length < 2) return

      const amp = Math.max(Math.abs(lo), Math.abs(hi), MIN_RANGE)
      const range = amp * RANGE_HEADROOM
      const halfH = H / 2
      /** @param {number} t */
      const xOf = (t) => ((t - tLo) / (tHi - tLo)) * W
      /** @param {number} v */
      const yOf = (v) => halfH - (clamp(v, -range, range) / range) * halfH

      wg.strokeStyle = lastResult ? SIGNAL : DIM
      wg.lineWidth = 1.5
      wg.beginPath()
      let started = false
      for (const [t, v] of pts) {
        const x = xOf(t), y = yOf(v)
        if (!started) { wg.moveTo(x, y); started = true } else { wg.lineTo(x, y) }
      }
      wg.stroke()
    }

    ctx.raf((now) => {
      const dt = last === 0 ? 1 / 30 : Math.min((now - last) / 1000, 0.5)
      last = now
      resize()

      if (cameraState === 'ready' && handle && handle.video.videoWidth > 0) {
        og.drawImage(handle.video, 0, 0, OFFSCREEN_W, OFFSCREEN_H)
        const frame = og.getImageData(0, 0, OFFSCREEN_W, OFFSCREEN_H).data
        let sum = 0
        const n = frame.length / 4
        for (let i = 0; i < frame.length; i += 4) sum += (frame[i] ?? 0)

        elapsed += dt
        if (recordingStart === null) recordingStart = elapsed
        rawT.push(elapsed)
        rawV.push(sum / n)
        while (rawT.length > 1 && elapsed - (rawT[0] ?? 0) > WINDOW_SECONDS) {
          rawT.shift()
          rawV.shift()
        }
      }

      const span = rawT.length > 1 ? (rawT[rawT.length - 1] ?? 0) - (rawT[0] ?? 0) : 0
      // Progress toward "ready" is wall-clock time since the first sample,
      // NOT the rolling buffer's own span — the trim loop above caps that
      // span at WINDOW_SECONDS by construction, so it can approach but never
      // reach 1 once actually full, and the gauge would sit at "100%" and
      // never gate open. See the comment on `recordingStart`.
      const fillFrac = recordingStart === null
        ? 0
        : clamp((elapsed - recordingStart) / WINDOW_SECONDS, 0, 1)
      // Measured, not assumed: the actual achieved sampling cadence of this
      // buffer, from real elapsed time. Real video frame rates vary by device
      // and drop under load — feeding estimateRate a wrong rate scales the
      // reported BPM proportionally, so this must never be a hard-coded 30.
      const sampleRate = span > 0 ? (rawT.length - 1) / span : 0

      /** @type {Float64Array | null} */
      let filtered = null
      if (rawV.length > 8 && sampleRate > 0) {
        filtered = highPass2(rawV, sampleRate, CORNER_HZ)
      }

      sinceEstimate += dt
      if (fillFrac < 1) {
        lastResult = null
      } else if (sampleRate > 0 && sinceEstimate >= ESTIMATE_INTERVAL) {
        sinceEstimate = 0
        lastResult = estimateRate(rawV, sampleRate, { cornerHz: CORNER_HZ, minClarity: MIN_CLARITY })
      }

      updateReadouts(fillFrac)
      draw(filtered)
    })

    return () => { root.replaceChildren() }
  },
}
