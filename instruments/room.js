// @ts-check
import {
  DEFAULT_BAND,
  MIN_PROMINENCE_DB,
  MIN_SWEEP_SECONDS,
  findModes,
  residualCurve,
  sweepSamples,
} from '../dsp/room.js'

/** @typedef {import('../js/types.js').Instrument} Instrument */
/** @typedef {import('../js/types.js').Ctx} Ctx */
/** @typedef {{ hz: number, db: number }} Point */

const SWEEP_LO = 200            // Hz. Deliberately wider than the 300 Hz
const SWEEP_HI = 4000           // analysis floor and the 2000 Hz ceiling: the
                                 // 1/3-octave smoothing kernel needs points on
                                 // both sides of a band edge to estimate the
                                 // broad response there, and a sweep that
                                 // stopped at the edges would leave the first
                                 // and last third of an octave estimated from
                                 // one side only.
const SWEEP_SECONDS = MIN_SWEEP_SECONDS  // 8 s, and 8 s is a measured floor,
                                 // not a taste: at 4 s a high-Q mode is not
                                 // driven long enough to reach steady state
                                 // and is missed outright. Do not shorten it.

const FFT_SIZE = 4096
/** Half-width, in bins, of the band summed for the level at each frame. The
 * dominant bin holds most of the sweep's energy but not all of it, and the
 * exact split between it and its neighbours wobbles with where the swept tone
 * happens to sit inside the bin. Summing a few bins makes the recorded level
 * independent of that wobble. */
const LEVEL_HALF_BINS = 2

/** Milliseconds of recording kept after playback reports it has finished.
 * Output-to-input latency is unknown and device-specific, so the last stretch
 * of the sweep arrives at the microphone after the buffer has stopped. Nothing
 * downstream aligns recording time with sweep time (that is the whole point of
 * reading the frequency off the dominant bin), so this is only about not
 * throwing the tail away. */
const TAIL_MS = 400

/** Modes shown as readouts. Four fits the grid on the narrowest phone, and a
 * room that genuinely rings at more than four frequencies in this band is
 * telling the user the same thing whether it lists four or nine. */
const MAX_SHOWN = 4

const LIVE_DB_LO = -110         // dB floor and ceiling of the live spectrum
const LIVE_DB_HI = -20          // plot. Analyser output, so not calibrated SPL.
const MIN_RESIDUAL_RANGE_DB = 10 // never scale the residual plot tighter than
                                 // this, or a dead-flat room's noise fills the
                                 // frame and looks like structure
const LABEL_PAD = 16            // px reserved at the top for mode labels

const WARN = 'This plays a loud sweep on purpose: the room has to be driven '
  + 'hard enough to ring before it will tell you anything. Turn the volume up, '
  + 'and set the phone down on a hard surface rather than cupping it in your '
  + 'hand, which favours the direct path from speaker to microphone over the '
  + 'room.'

const NOTHING_FOUND = 'Nothing narrow enough to be a room mode. This space is '
  + 'either large or well damped, so above roughly 400 Hz its sound is diffuse '
  + 'rather than modal. That is the ordinary, correct answer for a furnished '
  + 'room. Try a bathroom, a stairwell, a car, or a cupboard.'

const INVITES = [
  'Move a metre and run it again. A standing wave has loud places and quiet '
    + 'places, so the peaks should move when you do.',
  'Run it in a different room. Any peak that comes back at the same frequency '
    + 'in both rooms is this phone’s own case ringing, not the room.',
]

const MIC_ERROR = 'The microphone could not be opened, so there is nothing to '
  + 'measure the room with.'

const IDLE_HINT = 'Not measured yet.'

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** @type {Instrument} */
export default {
  id: 'room',
  name: 'Room Resonance',
  category: 'world',
  blurb: 'Find the notes your room rings at.',
  needs: ['microphone'],

  /**
   * @param {HTMLElement} root
   * @param {Ctx} ctx
   * @returns {() => void}
   */
  mount(root, ctx) {
    root.innerHTML = `
      <div class="room">
        <div class="room__main">
          <span class="label">Strongest resonance</span>
          <span class="readout" data-hz>—<span class="readout__unit">Hz</span></span>
          <span class="room__sub label" data-sub>${IDLE_HINT}</span>
        </div>
        <div class="room__view">
          <canvas class="room__canvas" data-canvas></canvas>
          <span class="room__axis label" data-axis></span>
        </div>
        <ul class="room__modes" data-modes></ul>
        <p class="room__note card__reason" data-note></p>
        <ul class="room__invites" data-invites hidden></ul>
        <p class="room__warn card__reason" data-warn>${WARN}</p>
        <div class="room__actions">
          <button class="arm__button" type="button" data-run>Play sweep</button>
        </div>
      </div>`

    const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (root.querySelector(s))
    const canvas = /** @type {HTMLCanvasElement} */ (root.querySelector('[data-canvas]'))
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))
    const runBtn = /** @type {HTMLButtonElement} */ ($('[data-run]'))
    const hzEl = $('[data-hz]')
    const subEl = $('[data-sub]')
    const axisEl = $('[data-axis]')
    const modesEl = $('[data-modes]')
    const noteEl = $('[data-note]')
    const warnEl = $('[data-warn]')
    const invitesEl = $('[data-invites]')

    const styles = getComputedStyle(document.documentElement)
    const SIGNAL = styles.getPropertyValue('--signal').trim() || '#ffb000'
    const EDGE = styles.getPropertyValue('--edge').trim() || '#55606e'
    const DIM = styles.getPropertyValue('--ink-dim').trim() || '#727c88'

    /** @type {'idle'|'sweeping'|'tail'|'result'|'error'} */
    let phase = 'idle'
    /** Recorded response, one point per animation frame of the sweep. */
    let points = /** @type {Point[]} */ ([])
    let residual = /** @type {{hz:number, residualDb:number}[]} */ ([])
    let modes = /** @type {{hz:number, prominenceDb:number}[]} */ ([])
    /** Dominant frequency of the most recent frame. This, not a clock, is what
     * marks "the sweep is here now" on the live plot: it is read straight from
     * the recording, so it carries whatever the output-to-input latency is
     * rather than pretending to know it. */
    let liveHz = 0
    let progress = 0
    let sweepT0 = 0
    let tailUntil = 0
    /** @type {{ stop: () => void } | null} */
    let playing = null

    /** @type {AnalyserNode | null} */
    let analyser = null
    let spectrum = new Float32Array(0)
    let binHz = 0
    let ready = false

    ctx.mic().then((source) => {
      const audio = ctx.audio()
      analyser = audio.createAnalyser()
      analyser.fftSize = FFT_SIZE
      // Zero, not the default 0.8: the node's smoothing averages each bin
      // across successive frames, and a sweep moves through the spectrum
      // between frames. Averaging would smear every measured peak sideways by
      // however long the smoothing remembers, which is exactly the peak shape
      // the whole instrument is trying to resolve.
      analyser.smoothingTimeConstant = 0
      source.connect(analyser)
      spectrum = new Float32Array(analyser.frequencyBinCount)
      binHz = audio.sampleRate / FFT_SIZE
      ready = true
      syncStatus()
    }).catch(() => {
      phase = 'error'
      runBtn.disabled = true
      syncStatus()
    })

    /** Sized to the device pixel grid so hairlines stay hair-thin. */
    let lastW = -1, lastH = -1
    function resize() {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth, h = canvas.clientHeight
      if (w === lastW && h === lastH) return
      lastW = w; lastH = h
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    ctx.on(window, 'resize', resize)
    ctx.on(window, 'orientationchange', resize)

    ctx.wakeLock()

    // ── running a sweep ───────────────────────────────────────────────────

    ctx.on(runBtn, 'click', () => {
      // Guarded twice on purpose. ctx.playSamples() is deliberately not
      // memoised and nothing below this instrument prevents two overlapping
      // sweeps, so the button is disabled for the duration; the phase test is
      // the backstop for a click that arrives before the disable takes effect.
      if (!ready || phase === 'sweeping' || phase === 'tail') return
      startSweep()
    })

    function startSweep() {
      const audio = ctx.audio()
      points = []
      residual = []
      modes = []
      liveHz = 0
      progress = 0
      sweepT0 = 0
      tailUntil = 0
      phase = 'sweeping'
      runBtn.disabled = true
      // Said once, before the first sweep. After that the user knows.
      warnEl.hidden = true
      invitesEl.hidden = true
      modesEl.replaceChildren()
      syncStatus()

      // Generated at the context's own rate so nothing resamples it: a
      // resampler is a filter, and a filter with an unknown response sitting
      // in front of the loudspeaker is exactly the sort of thing this
      // instrument would then report as a property of the room.
      const samples = sweepSamples({
        f1: SWEEP_LO,
        f2: SWEEP_HI,
        seconds: SWEEP_SECONDS,
        sampleRate: audio.sampleRate,
      })
      const handle = ctx.playSamples(samples)
      playing = handle
      handle.done.then(() => {
        if (phase !== 'sweeping') return   // torn down, or already finished
        phase = 'tail'
        progress = 1
      })
    }

    /** One frame of measurement: what frequency is arriving right now, and how
     * loud is it. The dominant bin IS the frequency being played at this
     * instant, read out of the recording itself, which is why no part of this
     * needs to know the output-to-input latency. */
    function collect() {
      if (!analyser || binHz <= 0) return
      analyser.getFloatFrequencyData(spectrum)

      const first = Math.max(1, Math.ceil(SWEEP_LO / binHz))
      const last = Math.min(spectrum.length - 2, Math.floor(SWEEP_HI / binHz))
      let peak = -1
      let peakDb = -Infinity
      for (let i = first; i <= last; i++) {
        const v = spectrum[i] ?? -Infinity
        if (v > peakDb) { peakDb = v; peak = i }
      }
      // Silence reads as -Infinity from the analyser. A frame with nothing in
      // it is not a measurement of anything and must not enter the response.
      if (peak < 0 || !Number.isFinite(peakDb)) return

      // Parabolic interpolation across the three dB values around the peak.
      // The swept tone almost never lands on a bin centre, and without this
      // every recorded frequency is quantised to the 11.7 Hz bin spacing,
      // which at 300 Hz is coarser than the modes being looked for.
      const a = spectrum[peak - 1] ?? peakDb
      const b = peakDb
      const c = spectrum[peak + 1] ?? peakDb
      const denom = a - 2 * b + c
      const delta = Number.isFinite(denom) && denom !== 0
        ? clamp((0.5 * (a - c)) / denom, -0.5, 0.5)
        : 0
      const hz = (peak + delta) * binHz
      if (!Number.isFinite(hz) || hz <= 0) return

      // Level over a narrow band, summed as power rather than averaged in dB:
      // adding dB values would weight a quiet neighbour as heavily as the peak
      // and drag every reading toward the noise floor.
      let power = 0
      for (let i = peak - LEVEL_HALF_BINS; i <= peak + LEVEL_HALF_BINS; i++) {
        const v = spectrum[i]
        if (v === undefined || !Number.isFinite(v)) continue
        power += 10 ** (v / 10)
      }
      if (power <= 0) return

      liveHz = hz
      points.push({ hz, db: 10 * Math.log10(power) })
    }

    function finishRun() {
      phase = 'result'
      playing = null
      residual = residualCurve(points)
      modes = findModes(points)
      runBtn.disabled = false
      runBtn.textContent = 'Run it again'
      renderModes()
      invitesEl.hidden = modes.length === 0
      syncStatus()
    }

    // ── readouts ──────────────────────────────────────────────────────────

    function renderModes() {
      modesEl.replaceChildren()
      for (const mode of modes.slice(0, MAX_SHOWN)) {
        const li = document.createElement('li')
        li.className = 'room__mode'
        const hz = document.createElement('span')
        hz.className = 'readout'
        hz.textContent = String(Math.round(mode.hz))
        const unit = document.createElement('span')
        unit.className = 'readout__unit'
        unit.textContent = 'Hz'
        hz.append(unit)
        const prom = document.createElement('span')
        prom.className = 'label'
        prom.textContent = `+${mode.prominenceDb.toFixed(1)} dB`
        li.append(hz, prom)
        modesEl.append(li)
      }

      invitesEl.replaceChildren()
      for (const text of INVITES) {
        const li = document.createElement('li')
        li.className = 'room__invite'
        li.textContent = text
        invitesEl.append(li)
      }
    }

    function syncStatus() {
      const hzText = hzEl.firstChild

      if (phase === 'error') {
        if (hzText) hzText.textContent = '—'
        subEl.textContent = 'no microphone'
        noteEl.textContent = MIC_ERROR
        warnEl.hidden = true
        axisEl.textContent = ''
        return
      }

      if (phase === 'sweeping' || phase === 'tail') {
        if (hzText) hzText.textContent = '—'
        subEl.textContent = `sweeping ${Math.round(progress * 100)}%`
        noteEl.textContent = ''
        axisEl.textContent = `${SWEEP_LO} to ${SWEEP_HI} Hz · live`
        return
      }

      if (phase === 'result') {
        const best = modes[0]
        if (best) {
          if (hzText) hzText.textContent = String(Math.round(best.hz))
          const shown = Math.min(modes.length, MAX_SHOWN)
          subEl.textContent = modes.length > MAX_SHOWN
            ? `${shown} strongest of ${modes.length} resonances`
            : `${modes.length} resonance${modes.length === 1 ? '' : 's'} found`
          noteEl.textContent =
            'Height is how far each peak stands above the smoothed response around it.'
        } else {
          if (hzText) hzText.textContent = '—'
          subEl.textContent = 'no resonances'
          noteEl.textContent = NOTHING_FOUND
        }
        axisEl.textContent = `${DEFAULT_BAND.lo} to ${DEFAULT_BAND.hi} Hz · residual`
        return
      }

      if (hzText) hzText.textContent = '—'
      subEl.textContent = ready ? IDLE_HINT : 'opening the microphone…'
      noteEl.textContent = ''
      axisEl.textContent = ''
    }

    // ── drawing ───────────────────────────────────────────────────────────

    /**
     * @param {number} hz @param {number} lo @param {number} hi @param {number} W
     * Log frequency axis: an octave takes the same width wherever it sits, to
     * match the octave-based smoothing the analysis is built on.
     */
    const xOf = (hz, lo, hi, W) => (Math.log(hz / lo) / Math.log(hi / lo)) * W

    /** @param {number} W @param {number} H */
    function drawLive(W, H) {
      /** @param {number} db */
      const yOf = (db) =>
        H - ((clamp(db, LIVE_DB_LO, LIVE_DB_HI) - LIVE_DB_LO) / (LIVE_DB_HI - LIVE_DB_LO)) * H

      // The analysis band, marked so the sweep is visibly wider than the part
      // that is actually examined.
      g.strokeStyle = EDGE
      g.globalAlpha = 0.5
      g.lineWidth = 1
      for (const hz of [DEFAULT_BAND.lo, DEFAULT_BAND.hi]) {
        const x = Math.round(xOf(hz, SWEEP_LO, SWEEP_HI, W)) + 0.5
        g.beginPath()
        g.moveTo(x, 0)
        g.lineTo(x, H)
        g.stroke()
      }
      g.globalAlpha = 1

      if (!analyser || binHz <= 0) return

      const first = Math.max(1, Math.ceil(SWEEP_LO / binHz))
      const last = Math.min(spectrum.length - 1, Math.floor(SWEEP_HI / binHz))
      g.strokeStyle = DIM
      g.lineWidth = 1
      g.beginPath()
      let started = false
      for (let i = first; i <= last; i++) {
        const x = xOf(i * binHz, SWEEP_LO, SWEEP_HI, W)
        const y = yOf(spectrum[i] ?? LIVE_DB_LO)
        if (!started) { g.moveTo(x, y); started = true } else { g.lineTo(x, y) }
      }
      g.stroke()

      if (liveHz >= SWEEP_LO && liveHz <= SWEEP_HI) {
        const x = xOf(liveHz, SWEEP_LO, SWEEP_HI, W)
        g.strokeStyle = SIGNAL
        g.lineWidth = 1.5
        g.beginPath()
        g.moveTo(x, 0)
        g.lineTo(x, H)
        g.stroke()
      }
    }

    /** @param {number} W @param {number} H */
    function drawResidual(W, H) {
      const top = Math.min(LABEL_PAD, H / 4)
      const mid = top + (H - top) / 2
      const half = (H - top) / 2

      g.strokeStyle = EDGE
      g.globalAlpha = 0.5
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(0, Math.round(mid) + 0.5)
      g.lineTo(W, Math.round(mid) + 0.5)
      g.stroke()
      g.globalAlpha = 1

      if (residual.length < 2 || half <= 0) return

      let maxAbs = 0
      for (const p of residual) maxAbs = Math.max(maxAbs, Math.abs(p.residualDb))
      const range = Math.max(MIN_RESIDUAL_RANGE_DB, maxAbs * 1.15)

      /** @param {number} db */
      const yOf = (db) => mid - (clamp(db, -range, range) / range) * half

      // The reporting threshold, drawn. A user can see for themselves which
      // bumps cleared it and how close the rest came, rather than taking the
      // instrument's word for which ones counted.
      g.strokeStyle = EDGE
      g.setLineDash([3, 3])
      g.beginPath()
      g.moveTo(0, yOf(MIN_PROMINENCE_DB))
      g.lineTo(W, yOf(MIN_PROMINENCE_DB))
      g.stroke()
      g.setLineDash([])

      const lo = DEFAULT_BAND.lo, hi = DEFAULT_BAND.hi
      g.strokeStyle = modes.length ? SIGNAL : DIM
      g.lineWidth = 1.5
      g.beginPath()
      let started = false
      for (const p of residual) {
        const x = xOf(p.hz, lo, hi, W)
        const y = yOf(p.residualDb)
        if (!started) { g.moveTo(x, y); started = true } else { g.lineTo(x, y) }
      }
      g.stroke()

      g.font = '11px "IBM Plex Mono", monospace'
      g.textAlign = 'center'
      g.textBaseline = 'bottom'
      for (const mode of modes.slice(0, MAX_SHOWN)) {
        const x = xOf(mode.hz, lo, hi, W)
        const y = yOf(mode.prominenceDb)
        g.strokeStyle = SIGNAL
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(x, y)
        g.lineTo(x, Math.max(top, y - 6))
        g.stroke()
        g.fillStyle = SIGNAL
        // Labels are clamped inside the canvas rather than centred blindly:
        // a mode near either band edge would otherwise have half its digits
        // outside the bitmap.
        g.fillText(`${Math.round(mode.hz)} Hz`, clamp(x, 26, W - 26), Math.max(top, y - 8))
      }
    }

    ctx.raf((now) => {
      resize()

      if (phase === 'sweeping' || phase === 'tail') {
        if (sweepT0 === 0) sweepT0 = now
        collect()
        if (phase === 'sweeping') {
          // Held below 1 until playback itself reports it is done: the clock
          // started on the first frame after the tap, which is a little before
          // the first sample actually leaves the speaker, so this estimate
          // runs slightly ahead of the sweep.
          progress = Math.min((now - sweepT0) / (SWEEP_SECONDS * 1000), 0.99)
        } else {
          if (tailUntil === 0) tailUntil = now + TAIL_MS
          else if (now >= tailUntil) finishRun()
        }
        syncStatus()
      }

      const dpr = window.devicePixelRatio || 1
      const W = canvas.width / dpr, H = canvas.height / dpr
      g.clearRect(0, 0, W, H)
      if (W <= 0 || H <= 0) return
      if (phase === 'sweeping' || phase === 'tail') drawLive(W, H)
      else drawResidual(W, H)
    })

    syncStatus()

    return () => {
      // Silence first, then empty the DOM. ctx's own teardown would stop the
      // node too, but it runs after this and a sweep left ringing across the
      // gap is audible.
      playing?.stop()
      root.replaceChildren()
    }
  },
}
