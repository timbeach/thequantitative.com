// @ts-check
import {
  ANTICIPATION_FLOOR_MS,
  MAX_FOREPERIOD_MS,
  MIN_FOREPERIOD_MS,
  classify,
  foreperiodMs,
  summarise,
} from '../stats/reaction.js'

/** @typedef {import('../js/types.js').Instrument} Instrument */
/** @typedef {import('../js/types.js').Ctx} Ctx */

/**
 * @typedef {Object} Trial
 * @property {'valid'|'anticipated'|'false-start'|'unusable'} kind
 * @property {number|null} ms null for the two kinds that never produced a time
 * @property {string} note the plain-words reason, used as the chip's title
 */

/** Valid taps before there is a result worth reading. */
const BLOCK = 5

/**
 * A reaction is only shown if it lands inside this window. Anything outside is
 * thrown away rather than displayed: a negative value means `event.timeStamp`
 * and the `raf` clock disagree (engines have not always shared a time origin),
 * and anything past three seconds is somebody putting the phone down mid-trial.
 * Neither is a reaction time, so neither gets rendered as one.
 */
const MAX_REACTION_MS = 3000

/**
 * Taps inside this window after a trial ends are ignored entirely. A second
 * finger, or the trailing half of an over-eager double tap, arrives as its own
 * pointerdown a few tens of milliseconds later, and without this it would
 * start the next trial and instantly false-start it.
 */
const SETTLE_MS = 300

/** Frame deltas kept for the display's frame-interval estimate. */
const FRAME_SAMPLES = 120
/** Below this many deltas the frame interval is not yet worth quoting. */
const MIN_FRAME_SAMPLES = 20

/** Valid taps before the interval is shown at all. See the note in render(). */
const MIN_INTERVAL_TRIALS = 3

/** Narrowest span the trial plot will scale to, in ms. Without a floor, four
 *  taps within 6 ms of each other would fill the strip and look like spread. */
const MIN_PLOT_RANGE_MS = 120

/** Aperiodic bounds for the waiting indicator, in ms. See the note at tickDots. */
const DOT_MIN_MS = 280
const DOT_MAX_MS = 820

const PLOT_LABEL_PAD = 14   // px reserved at the bottom of the plot for ticks

/**
 * The instrument's single source of randomness, kept behind one function for
 * the same reason stats/reaction.js takes `rand` as an argument: every draw in
 * the measurement path goes through one seam that can be pointed at a fixed
 * sequence. The foreperiod is the one thing a player must not be able to
 * anticipate, so it is worth drawing from the platform's real entropy rather
 * than a seeded generator that repeats across mounts.
 *
 * @returns {number} in [0, 1)
 */
const rand = () => {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return (buf[0] ?? 0) / 4294967296
}

/** @param {number[]} xs @returns {number} */
function medianOf(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  if (s.length === 0) return 0
  return s.length % 2 === 0 ? ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2 : (s[mid] ?? 0)
}

/** @param {number} v */
const ms0 = (v) => String(Math.round(v))

const SECONDS_RANGE =
  `${(MIN_FOREPERIOD_MS / 1000).toFixed(1)} to ${(MAX_FOREPERIOD_MS / 1000).toFixed(0)} seconds`

const ANTICIPATED_NOTE =
  `Under ${ANTICIPATION_FLOOR_MS} ms. Light reaching the retina and a signal ` +
  'reaching the thumb cannot happen that fast, so that was a guess rather ' +
  'than a reaction. It is listed below, and it counts towards nothing.'

const FALSE_START_NOTE =
  'You tapped before the change, so there was nothing to time. Nothing recorded.'

const FALSE_START_ESCALATION =
  ` The wait is drawn fresh every trial, anywhere from ${SECONDS_RANGE}, and it ` +
  'never becomes more likely the longer it runs. There is no pattern to catch, ' +
  'so waiting is the only way through it.'

const CLOCK_NOTE =
  'The tap clock and the frame clock disagreed, so that trial has no honest ' +
  'time. Discarded rather than shown.'

const SLOW_NOTE =
  `Over ${MAX_REACTION_MS / 1000} seconds, which is inattention rather than ` +
  'reaction. Discarded rather than shown.'

/** @type {Instrument} */
export default {
  id: 'reaction',
  name: 'Reaction Time',
  category: 'ideas',
  blurb: 'Tap the moment it changes.',
  needs: [],

  /**
   * @param {HTMLElement} root
   * @param {Ctx} ctx
   * @returns {() => void}
   */
  mount(root, ctx) {
    root.innerHTML = `
      <div class="rxn">
        <div class="rxn__side">
          <button class="rxn__pad" type="button" data-pad data-phase="idle">
            <span class="rxn__word" data-word>TAP TO START</span>
            <span class="rxn__dots" data-dots aria-hidden="true">
              <i data-dot></i><i data-dot></i><i data-dot></i>
            </span>
            <span class="rxn__hint" data-hint></span>
          </button>
          <p class="rxn__verdict" data-verdict aria-live="polite"></p>
        </div>
        <div class="rxn__panel">
          <div class="rxn__stats">
            <div class="rxn__stat">
              <span class="label">Median</span>
              <span class="readout" data-median>—<span class="readout__unit">ms</span></span>
            </div>
            <div class="rxn__stat">
              <span class="label">Fastest</span>
              <span class="readout" data-best>—<span class="readout__unit">ms</span></span>
            </div>
            <div class="rxn__stat">
              <span class="label">Counted</span>
              <span class="readout" data-count>0</span>
            </div>
            <div class="rxn__stat">
              <span class="label">Record</span>
              <span class="readout" data-record>—<span class="readout__unit">ms</span></span>
            </div>
          </div>
          <p class="rxn__interval" data-interval></p>
          <canvas class="rxn__plot" data-plot></canvas>
          <ol class="rxn__trials" data-trials></ol>
          <p class="rxn__compare card__reason" data-compare></p>
          <p class="rxn__latency card__reason" data-latency></p>
          <div class="rxn__actions">
            <button class="arm__button arm__button--quiet" type="button" data-reset>Reset run</button>
            <button class="arm__button arm__button--quiet" type="button" data-clear>Clear record</button>
          </div>
        </div>
      </div>`

    const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (root.querySelector(s))
    const pad = /** @type {HTMLButtonElement} */ ($('[data-pad]'))
    const plot = /** @type {HTMLCanvasElement} */ (root.querySelector('[data-plot]'))
    const pg = /** @type {CanvasRenderingContext2D} */ (plot.getContext('2d'))
    const dots = /** @type {HTMLElement[]} */ ([...root.querySelectorAll('[data-dot]')])

    const styles = getComputedStyle(document.documentElement)
    const SIGNAL = styles.getPropertyValue('--signal').trim() || '#ffb000'
    const ALERT = styles.getPropertyValue('--alert').trim() || '#ff4d4f'
    const EDGE = styles.getPropertyValue('--edge').trim() || '#55606e'
    const DIM = styles.getPropertyValue('--ink-dim').trim() || '#727c88'

    const store = ctx.store
    let record = Number(store.get('bestMedian'))
    if (!Number.isFinite(record) || record <= 0) record = 0

    /** @type {'idle'|'waiting'|'go'|'shown'} */
    let phase = 'idle'
    /** @type {Trial[]} */
    const trials = []
    /** @type {ReturnType<typeof summarise>} */
    let summary = null
    let falseStreak = 0

    /** `raf` timestamp the go state should be painted at. */
    let goAt = 0
    /** `raf` timestamp of the frame that painted the go state: the onset. */
    let onset = 0
    /** Set on the frame a fresh trial is armed, cleared once its wait is drawn. */
    let armPending = false
    /**
     * Settle deadline, on the `raf` clock rather than the event clock. See
     * SETTLE_MS for what it is for; the reason it is not measured from
     * `event.timeStamp` is that a stamp from a different time origin would set
     * a deadline decades away and every later tap would be swallowed. The
     * frame clock cannot do that, and a gate that is one frame coarse is
     * plenty for a 300 ms hold-off.
     */
    let settleUntil = 0

    /** @type {number[]} */
    const frameDeltas = []
    let lastFrame = 0
    let frameTick = 0
    let plotDirty = true

    let dotIndex = 0
    let dotNextAt = 0

    // ── the measurement ────────────────────────────────────────────────────

    /**
     * A tap, at the moment the platform says the platform created it.
     *
     * `stamp` is `event.timeStamp` from a trusted input event, which is set
     * when the event was created, not when this handler finally ran. Those two
     * differ by however long the main thread was busy, and reading a clock here
     * instead would quietly add that delay to the player's score. This is the
     * whole reason the handler takes a timestamp rather than looking one up.
     *
     * @param {number} stamp
     */
    function tap(stamp) {
      if (lastFrame < settleUntil) return

      if (phase === 'go') {
        finish(stamp - onset)
        return
      }
      if (phase === 'waiting') {
        falseStart()
        return
      }
      begin()
    }

    function begin() {
      phase = 'waiting'
      armPending = true
      settleUntil = lastFrame + SETTLE_MS
      dotIndex = 0
      dotNextAt = 0
      render()
    }

    function falseStart() {
      falseStreak++
      settleUntil = lastFrame + SETTLE_MS
      push({
        kind: 'false-start',
        ms: null,
        note: falseStreak > 1 ? FALSE_START_NOTE + FALSE_START_ESCALATION : FALSE_START_NOTE,
      })
    }

    /** @param {number} reaction milliseconds since onset */
    function finish(reaction) {
      falseStreak = 0
      settleUntil = lastFrame + SETTLE_MS

      if (!Number.isFinite(reaction) || reaction < 0) {
        push({ kind: 'unusable', ms: null, note: CLOCK_NOTE })
        return
      }
      if (reaction > MAX_REACTION_MS) {
        push({ kind: 'unusable', ms: null, note: SLOW_NOTE })
        return
      }
      if (classify(reaction) === 'anticipated') {
        push({ kind: 'anticipated', ms: reaction, note: ANTICIPATED_NOTE })
        return
      }
      push({ kind: 'valid', ms: reaction, note: 'Counted.' })
    }

    /** @param {Trial} trial */
    function push(trial) {
      trials.push(trial)
      phase = 'shown'
      plotDirty = true

      // Anticipated trials are handed to summarise() rather than filtered out
      // here: rejecting a guess is its rule, stated once, in the module that
      // owns the statistics.
      const times = trials.flatMap((t) => (t.ms === null ? [] : [t.ms]))
      summary = summarise(times, rand)

      if (summary && summary.n >= BLOCK && (record === 0 || summary.median < record)) {
        record = summary.median
        store.set('bestMedian', record)
      }
      render()
    }

    // ── rendering ──────────────────────────────────────────────────────────

    /** @returns {Trial|undefined} */
    const lastTrial = () => trials[trials.length - 1]

    function renderPad() {
      pad.dataset.phase = phase
      const word = $('[data-word]')
      const hint = $('[data-hint]')

      if (phase === 'waiting') {
        word.textContent = 'WAIT'
        hint.textContent = 'Tapping now is a false start.'
        return
      }
      if (phase === 'go') {
        word.textContent = 'TAP'
        hint.textContent = ''
        return
      }
      if (phase === 'idle') {
        word.textContent = 'TAP TO START'
        hint.textContent =
          `Then wait. Anywhere from ${SECONDS_RANGE} later the whole screen ` +
          'changes. Tap it, anywhere, the instant it does.'
        return
      }

      const t = lastTrial()
      hint.textContent = 'Tap anywhere for the next one.'
      if (!t) { word.textContent = 'TAP TO START'; return }
      if (t.kind === 'false-start') { word.textContent = 'TOO SOON'; return }
      if (t.kind === 'unusable') { word.textContent = 'NO TIME'; return }
      word.textContent = `${ms0(t.ms ?? 0)} ms`
    }

    function renderVerdict() {
      const el = $('[data-verdict]')
      if (phase !== 'shown') { el.textContent = ''; return }
      const t = lastTrial()
      if (!t) { el.textContent = ''; return }

      if (t.kind !== 'valid') { el.textContent = t.note; return }

      const n = summary?.n ?? 0
      if (n === BLOCK) {
        el.textContent =
          `${BLOCK} valid taps, so there is a result below. Keep tapping: ` +
          'the interval narrows with every one.'
        return
      }
      el.textContent = n < BLOCK
        ? `Counted. ${n} of ${BLOCK} valid taps.`
        : `Counted. ${n} valid taps.`
    }

    function renderStats() {
      /** @param {string} sel @param {string} text */
      const setValue = (sel, text) => {
        const el = $(sel)
        // These cells carry a .readout__unit child, so only the leading text
        // node is the number. Same pattern as the Jump and Seismograph.
        if (el.firstChild) el.firstChild.textContent = text
      }
      setValue('[data-median]', summary ? ms0(summary.median) : '—')
      setValue('[data-best]', summary ? ms0(summary.best) : '—')
      setValue('[data-count]', String(summary?.n ?? 0))
      setValue('[data-record]', record > 0 ? ms0(record) : '—')
    }

    function renderInterval() {
      const el = $('[data-interval]')
      if (!summary) {
        el.textContent = 'No valid taps yet.'
        return
      }
      // A bootstrap interval from one or two taps is not narrow, it is
      // undefined: resampling a single value can only ever return that value,
      // so the interval would come out exactly zero wide. Printing that would
      // be the most confident thing this instrument ever said and the least
      // true, so nothing is printed until there is something to resample.
      if (summary.n < MIN_INTERVAL_TRIALS) {
        el.textContent = `Median of ${summary.n}. The interval needs ${MIN_INTERVAL_TRIALS} valid taps.`
        return
      }
      const [lo, hi] = summary.ci
      el.textContent =
        `Median ${ms0(summary.median)} ms, approximate interval ${ms0(lo)} to ${ms0(hi)} ms.`
    }

    function renderTrials() {
      const list = $('[data-trials]')
      list.replaceChildren()
      trials.forEach((t, i) => {
        const li = document.createElement('li')
        li.className = `rxn__chip rxn__chip--${t.kind}`
        li.title = `Trial ${i + 1}: ${t.note}`
        li.textContent =
          t.kind === 'false-start' ? 'FS'
            : t.kind === 'unusable' ? '??'
              : ms0(t.ms ?? 0)
        list.append(li)
      })
    }

    function renderCompare() {
      const el = $('[data-compare]')
      if (!summary || summary.n < MIN_INTERVAL_TRIALS) {
        el.textContent =
          `Run ${BLOCK} valid taps for a result. One tap is a stopwatch reading, ` +
          'not a measurement of you.'
        return
      }
      const width = summary.ci[1] - summary.ci[0]
      el.textContent =
        `At ${summary.n} valid taps that interval spans about ${ms0(width)} ms, and it is ` +
        'approximate rather than exact: at these sample sizes it covers the ' +
        'truth about 85 to 88 per cent of the time. So a friend who scores ' +
        '20 ms faster than you has not been shown to be faster. That gap sits ' +
        'inside the noise in both numbers. Widths run about 120 ms at 5 taps, ' +
        '66 at 10, 47 at 20, and more taps is the only thing that shrinks them.'
    }

    /**
     * The one component of the latency budget that is actually measurable, and
     * the statement of the part that is not. Kept separate from the rest of
     * render() because the frame estimate settles over the first couple of
     * seconds rather than changing with the trials.
     */
    let quotedFrameMs = -1
    function renderLatency() {
      const frame = frameIntervalMs()
      quotedFrameMs = frame ?? -1
      const measured = frame === null
        ? 'This screen has not been measured yet.'
        : `Measured on this screen: ${frame.toFixed(1)} ms a frame, about ${Math.round(1000 / frame)} Hz.`
      $('[data-latency]').textContent =
        'Every score here is long by roughly 20 to 40 ms. Onset is timed from ' +
        'the frame that paints the change, but the photons leave a frame ' +
        'later and the panel takes its own time on top of that, which no ' +
        `browser reports. ${measured} Nothing is subtracted: the frame ` +
        'interval is real and device-specific, the panel is not, and a ' +
        'partial correction would be neither the raw measurement nor the ' +
        'truth. Compare with someone on this same phone, not with a laboratory.'
    }

    function render() {
      renderPad()
      renderVerdict()
      renderStats()
      renderInterval()
      renderTrials()
      renderCompare()
      renderLatency()
    }

    /** @returns {number|null} the display's frame interval, ms, or null */
    function frameIntervalMs() {
      if (frameDeltas.length < MIN_FRAME_SAMPLES) return null
      // Median, not mean: a single dropped frame doubles one delta, and one
      // hitch must not be allowed to claim the screen runs at 30 Hz.
      const m = medianOf(frameDeltas)
      return m > 0 ? m : null
    }

    // ── the plot ───────────────────────────────────────────────────────────

    let lastW = -1, lastH = -1
    function resize() {
      const dpr = window.devicePixelRatio || 1
      const w = plot.clientWidth, h = plot.clientHeight
      if (w === lastW && h === lastH) return
      lastW = w; lastH = h
      plot.width = Math.round(w * dpr)
      plot.height = Math.round(h * dpr)
      pg.setTransform(dpr, 0, 0, dpr, 0, 0)
      plotDirty = true
    }
    resize()
    ctx.on(window, 'resize', resize)
    ctx.on(window, 'orientationchange', resize)

    function drawPlot() {
      const dpr = window.devicePixelRatio || 1
      const W = plot.width / dpr
      const H = plot.height / dpr
      pg.clearRect(0, 0, W, H)
      if (W <= 0 || H <= 0) return

      const rowY = (H - PLOT_LABEL_PAD) / 2
      const times = trials.flatMap((t) => (t.ms === null ? [] : [t.ms]))

      pg.strokeStyle = EDGE
      pg.globalAlpha = 0.4
      pg.lineWidth = 1
      pg.beginPath()
      pg.moveTo(0, rowY)
      pg.lineTo(W, rowY)
      pg.stroke()
      pg.globalAlpha = 1
      if (times.length === 0) return

      let lo = Math.min(...times)
      let hi = Math.max(...times)
      if (summary && summary.n >= MIN_INTERVAL_TRIALS) {
        lo = Math.min(lo, summary.ci[0])
        hi = Math.max(hi, summary.ci[1])
      }
      // A floor on the span, for the reason the Seismograph floors its axis:
      // without one, a handful of near-identical taps would be spread across
      // the full width and read as scatter that is not there.
      const centre = (lo + hi) / 2
      const span = Math.max(hi - lo, MIN_PLOT_RANGE_MS) * 1.2
      lo = centre - span / 2
      hi = centre + span / 2

      /** @param {number} v */
      const xOf = (v) => ((v - lo) / (hi - lo)) * W

      if (summary && summary.n >= MIN_INTERVAL_TRIALS) {
        const x0 = xOf(summary.ci[0])
        const x1 = xOf(summary.ci[1])
        pg.fillStyle = SIGNAL
        pg.globalAlpha = 0.16
        pg.fillRect(x0, 2, Math.max(1, x1 - x0), H - PLOT_LABEL_PAD - 4)
        pg.globalAlpha = 1

        pg.strokeStyle = SIGNAL
        pg.lineWidth = 1.5
        pg.beginPath()
        pg.moveTo(xOf(summary.median), 2)
        pg.lineTo(xOf(summary.median), H - PLOT_LABEL_PAD - 2)
        pg.stroke()
      }

      if (ANTICIPATION_FLOOR_MS > lo && ANTICIPATION_FLOOR_MS < hi) {
        pg.strokeStyle = ALERT
        pg.lineWidth = 1
        pg.setLineDash([3, 3])
        pg.beginPath()
        pg.moveTo(xOf(ANTICIPATION_FLOOR_MS), 2)
        pg.lineTo(xOf(ANTICIPATION_FLOOR_MS), H - PLOT_LABEL_PAD - 2)
        pg.stroke()
        pg.setLineDash([])
      }

      for (const t of trials) {
        if (t.ms === null) continue
        const x = xOf(t.ms)
        pg.beginPath()
        pg.arc(x, rowY, 3.5, 0, Math.PI * 2)
        if (t.kind === 'anticipated') {
          // Hollow and in the alert colour: on the axis, because it happened,
          // but visibly not one of the filled dots the median is built from.
          pg.strokeStyle = ALERT
          pg.lineWidth = 1.5
          pg.stroke()
        } else {
          pg.fillStyle = SIGNAL
          pg.globalAlpha = 0.75
          pg.fill()
          pg.globalAlpha = 1
        }
      }

      pg.fillStyle = DIM
      pg.font = '10px "IBM Plex Mono", monospace'
      pg.textAlign = 'left'
      pg.fillText(`${ms0(lo)} ms`, 2, H - 3)
      pg.textAlign = 'right'
      pg.fillText(`${ms0(hi)} ms`, W - 2, H - 3)
    }

    // ── input ──────────────────────────────────────────────────────────────

    // pointerdown, not click: click fires on release, which would time how
    // long the finger stayed down as part of the reaction.
    ctx.on(pad, 'pointerdown', (event) => tap(event.timeStamp))

    // The pad is a real button, so it is reachable by keyboard. Space would
    // otherwise scroll the page, and holding a key repeats.
    ctx.on(pad, 'keydown', (event) => {
      const e = /** @type {KeyboardEvent} */ (event)
      if (e.key !== ' ' && e.key !== 'Enter') return
      if (e.repeat) return
      e.preventDefault()
      tap(e.timeStamp)
    })

    ctx.on($('[data-reset]'), 'click', () => {
      trials.length = 0
      summary = null
      falseStreak = 0
      phase = 'idle'
      armPending = false
      plotDirty = true
      render()
    })

    ctx.on($('[data-clear]'), 'click', () => {
      record = 0
      store.set('bestMedian', 0)
      renderStats()
    })

    /**
     * The waiting indicator. Its steps are drawn from the same rand as the
     * foreperiod and are deliberately aperiodic: a steady blink would be a
     * metronome a player could entrain to, and the one thing the wait must not
     * offer is a rhythm. It exists because the tail of the foreperiod really
     * does reach nine seconds, and a still screen for nine seconds reads as a
     * hang, which is what makes people tap.
     *
     * @param {number} now
     */
    function tickDots(now) {
      if (now < dotNextAt) return
      dotNextAt = now + DOT_MIN_MS + rand() * (DOT_MAX_MS - DOT_MIN_MS)
      dotIndex = (dotIndex + 1) % dots.length
      dots.forEach((d, i) => d.classList.toggle('is-lit', i === dotIndex))
    }

    ctx.raf((now) => {
      // The go transition comes first, before anything else this callback
      // might do. Onset is defined as the timestamp of the frame that paints
      // the change, so every millisecond of work above it would be a
      // millisecond of the player's score.
      let fired = false
      if (phase === 'waiting' && !armPending && now >= goAt) {
        phase = 'go'
        onset = now
        fired = true
        renderPad()
      }

      if (lastFrame > 0) {
        frameDeltas.push(now - lastFrame)
        if (frameDeltas.length > FRAME_SAMPLES) frameDeltas.shift()
      }
      lastFrame = now

      if (fired) return   // nothing else touches the frame that defines onset

      if (armPending) {
        // Deferred to a frame on purpose: the foreperiod is measured against
        // the same `raf` clock the onset will be, so it is started from one.
        armPending = false
        goAt = now + foreperiodMs(rand)
        dotNextAt = now
      }

      if (phase === 'waiting') tickDots(now)
      else if (dotIndex !== -1) {
        dotIndex = -1
        dots.forEach((d) => d.classList.remove('is-lit'))
      }

      resize()
      if (plotDirty) { plotDirty = false; drawPlot() }

      // Once a second, and never on the frame that defines an onset.
      if (++frameTick >= 60) {
        frameTick = 0
        const frame = frameIntervalMs()
        if (frame !== null && Math.abs(frame - quotedFrameMs) > 0.1) renderLatency()
      }
    })

    render()

    return () => { root.replaceChildren() }
  },
}
