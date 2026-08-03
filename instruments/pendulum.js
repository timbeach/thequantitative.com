// @ts-check
import { advance, energy, separation, DEFAULT_PARAMS } from '../dsp/pendulum.js'

/** @typedef {import('../js/types.js').Instrument} Instrument */
/** @typedef {import('../js/types.js').Ctx} Ctx */
/** @typedef {import('../dsp/pendulum.js').State} State */

// Two pendulums start this far apart in theta1 and nowhere else. This is the
// whole experiment — everything downstream exists to make the moment they
// stop looking identical unmistakable.
const PERTURB = 1e-6

const HZ = 240              // integration rate — see dsp/pendulum.js verification
const MAX_FRAME_DT = 0.1    // clamp: a backgrounded tab returning must not run
                             // one huge integration step (max 24 substeps/frame)

const TRAIL_LEN = 130               // ~2.2s of lower-bob history at 60fps
const TRAIL_LEN_REDUCED = 24        // prefers-reduced-motion: shorter, not absent

const STRIP_WINDOW = 40     // seconds visible on the divergence strip before it scrolls
const LOG_MIN = 1e-7        // strip's vertical axis floor — below the 1e-6 start,
                             // so an early dip in separation never clips off-scale
const LOG_MAX = 10          // above pi*sqrt(2), the largest separation() can report

// The Lyapunov estimate is only trustworthy once the pair has visibly left the
// perturbation floor and before the chaotic mixing saturates it near order 1 —
// outside that band ln(sep/sep0)/t is measuring integration noise, not chaos.
const LYAP_LO = 10 * PERTURB
const LYAP_HI = 1.0

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * Position of both bobs (pivot-relative, meters; y positive downward, matching
 * canvas convention directly).
 * @param {State} state
 * @param {import('../dsp/pendulum.js').Params} params
 */
function bobPositions(state, params) {
  const [t1, t2] = state
  const x1 = params.l1 * Math.sin(t1)
  const y1 = params.l1 * Math.cos(t1)
  const x2 = x1 + params.l2 * Math.sin(t2)
  const y2 = y1 + params.l2 * Math.cos(t2)
  return { x1, y1, x2, y2 }
}

/** @param {number} sep */
function formatSeparation(sep) {
  return sep.toExponential(2)
}

/** @param {number} drift fractional, signed */
function formatDrift(drift) {
  const pct = drift * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toExponential(2)}%`
}

/** @type {Instrument} */
export default {
  id: 'pendulum',
  name: 'Double Pendulum',
  category: 'ideas',
  blurb: 'Two pendulums, a millionth of a radian apart.',
  needs: [],

  /**
   * @param {HTMLElement} root
   * @param {Ctx} ctx
   * @returns {() => void}
   */
  mount(root, ctx) {
    root.innerHTML = `
      <div class="pend">
        <div class="pend__readouts">
          <div class="pend__stat">
            <span class="label">Separation</span>
            <span class="readout" data-sep>—</span>
          </div>
          <div class="pend__stat">
            <span class="label">Elapsed</span>
            <span class="readout" data-elapsed>—<span class="readout__unit">s</span></span>
          </div>
          <div class="pend__stat">
            <span class="label">Energy drift</span>
            <span class="readout" data-drift>—</span>
          </div>
          <div class="pend__stat">
            <span class="label">Lyapunov &lambda;</span>
            <span class="readout" data-lyap>&mdash;<span class="readout__unit">s&#8315;&sup1;</span></span>
          </div>
        </div>
        <canvas class="pend__view" data-view></canvas>
        <canvas class="pend__strip" data-strip></canvas>
        <p class="pend__hint label" data-hint>drag to set the starting angle, release to run</p>
        <div class="pend__actions">
          <button class="arm__button arm__button--quiet" type="button" data-reset>Reset</button>
        </div>
      </div>`

    const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (root.querySelector(s))
    const view = /** @type {HTMLCanvasElement} */ (root.querySelector('[data-view]'))
    const strip = /** @type {HTMLCanvasElement} */ (root.querySelector('[data-strip]'))
    const vg = /** @type {CanvasRenderingContext2D} */ (view.getContext('2d'))
    const stg = /** @type {CanvasRenderingContext2D} */ (strip.getContext('2d'))

    const params = DEFAULT_PARAMS

    const styles = getComputedStyle(document.documentElement)
    const SIGNAL = styles.getPropertyValue('--signal').trim() || '#ffb000'
    const ALERT = styles.getPropertyValue('--alert').trim() || '#ff4d4f'
    const EDGE = styles.getPropertyValue('--edge').trim() || '#55606e'
    const INK_DIM = styles.getPropertyValue('--ink-dim').trim() || '#727c88'

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const trailCap = reduceMotion ? TRAIL_LEN_REDUCED : TRAIL_LEN

    /** @type {'idle'|'dragging'|'running'} */
    let mode = 'idle'
    let dragAngle = 0

    /** @type {State} */
    let stateA = [0, 0, 0, 0]
    /** @type {State} */
    let stateB = [0, 0, 0, 0]
    let elapsed = 0
    let E0 = 0

    /** @type {{x:number,y:number}[]} */
    let trailA = []
    /** @type {{x:number,y:number}[]} */
    let trailB = []

    /** @type {{t:number,sep:number}[]} */
    let history = []

    function resetRun() {
      mode = 'idle'
      dragAngle = 0
      elapsed = 0
      trailA = []
      trailB = []
      history = []
      $('[data-sep]').textContent = '—'
      const elapsedEl = $('[data-elapsed]')
      if (elapsedEl.firstChild) elapsedEl.firstChild.textContent = '—'
      $('[data-drift]').textContent = '—'
      const lyapEl = $('[data-lyap]')
      if (lyapEl.firstChild) lyapEl.firstChild.textContent = '—'
      $('[data-hint]').textContent = 'drag to set the starting angle, release to run'
    }

    function startRun() {
      stateA = [dragAngle, dragAngle, 0, 0]
      stateB = [dragAngle + PERTURB, dragAngle, 0, 0]
      elapsed = 0
      E0 = energy(stateA, params)
      trailA = []
      trailB = []
      history = [{ t: 0, sep: separation(stateA, stateB) }]
      mode = 'running'
      $('[data-hint]').textContent = 'released — reset to start a fresh pair'
    }

    /** Pivot-relative pointer angle: atan2(dx, dy) so 0 is straight down. */
    function angleFromPointer(/** @type {PointerEvent} */ e) {
      const rect = view.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      return Math.atan2(e.clientX - cx, e.clientY - cy)
    }

    ctx.on(view, 'pointerdown', (ev) => {
      const e = /** @type {PointerEvent} */ (ev)
      view.setPointerCapture(e.pointerId)
      mode = 'dragging'
      dragAngle = angleFromPointer(e)
      $('[data-hint]').textContent = `angle ${(dragAngle * 180 / Math.PI).toFixed(0)}° — release to run`
    })
    ctx.on(view, 'pointermove', (ev) => {
      if (mode !== 'dragging') return
      const e = /** @type {PointerEvent} */ (ev)
      dragAngle = angleFromPointer(e)
      $('[data-hint]').textContent = `angle ${(dragAngle * 180 / Math.PI).toFixed(0)}° — release to run`
    })
    ctx.on(view, 'pointerup', () => {
      if (mode !== 'dragging') return
      startRun()
    })
    ctx.on(view, 'pointercancel', () => {
      if (mode === 'dragging') resetRun()
    })

    ctx.on($('[data-reset]'), 'click', resetRun)

    // ── sizing ─────────────────────────────────────────────────────────────
    let lastViewW = -1, lastViewH = -1, lastStripW = -1, lastStripH = -1
    function resize() {
      const dpr = window.devicePixelRatio || 1
      const vw = view.clientWidth, vh = view.clientHeight
      if (vw !== lastViewW || vh !== lastViewH) {
        lastViewW = vw; lastViewH = vh
        view.width = Math.round(vw * dpr)
        view.height = Math.round(vh * dpr)
        vg.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      const sw = strip.clientWidth, sh = strip.clientHeight
      if (sw !== lastStripW || sh !== lastStripH) {
        lastStripW = sw; lastStripH = sh
        strip.width = Math.round(sw * dpr)
        strip.height = Math.round(sh * dpr)
        stg.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
    }
    resize()
    ctx.on(window, 'resize', resize)
    ctx.on(window, 'orientationchange', resize)

    /** @param {{x:number,y:number}[]} trail @param {number} x @param {number} y */
    function pushTrail(trail, x, y) {
      trail.push({ x, y })
      if (trail.length > trailCap) trail.shift()
    }

    /**
     * @param {{x:number,y:number}[]} trail
     * @param {string} color
     * @param {number} scale
     * @param {number} cx
     * @param {number} cy
     */
    function drawTrail(trail, color, scale, cx, cy) {
      const n = trail.length
      if (n < 2) return
      vg.strokeStyle = color
      vg.lineWidth = 1.5
      for (let i = 1; i < n; i++) {
        const p0 = trail[i - 1]
        const p1 = trail[i]
        if (!p0 || !p1) continue
        vg.globalAlpha = (i / n) * 0.5
        vg.beginPath()
        vg.moveTo(cx + p0.x * scale, cy + p0.y * scale)
        vg.lineTo(cx + p1.x * scale, cy + p1.y * scale)
        vg.stroke()
      }
      vg.globalAlpha = 1
    }

    /**
     * @param {State} state
     * @param {string} color
     * @param {number} scale
     * @param {number} cx
     * @param {number} cy
     */
    function drawPendulum(state, color, scale, cx, cy) {
      const { x1, y1, x2, y2 } = bobPositions(state, params)
      const px1 = cx + x1 * scale, py1 = cy + y1 * scale
      const px2 = cx + x2 * scale, py2 = cy + y2 * scale

      vg.strokeStyle = color
      vg.lineWidth = 2
      vg.beginPath()
      vg.moveTo(cx, cy)
      vg.lineTo(px1, py1)
      vg.lineTo(px2, py2)
      vg.stroke()

      vg.fillStyle = color
      vg.beginPath(); vg.arc(px1, py1, 3, 0, Math.PI * 2); vg.fill()
      vg.beginPath(); vg.arc(px2, py2, 4.5, 0, Math.PI * 2); vg.fill()
    }

    function drawView() {
      const W = view.width / (window.devicePixelRatio || 1)
      const H = view.height / (window.devicePixelRatio || 1)
      vg.clearRect(0, 0, W, H)
      if (W <= 0 || H <= 0) return

      const cx = W / 2
      const cy = H / 2
      const reach = params.l1 + params.l2
      const scale = (Math.min(W, H) * 0.42) / reach

      vg.fillStyle = EDGE
      vg.beginPath(); vg.arc(cx, cy, 2.5, 0, Math.PI * 2); vg.fill()

      if (mode === 'idle') {
        drawPendulum([0, 0, 0, 0], INK_DIM, scale, cx, cy)
        return
      }

      if (mode === 'dragging') {
        drawPendulum([dragAngle, dragAngle, 0, 0], SIGNAL, scale, cx, cy)
        return
      }

      drawTrail(trailA, SIGNAL, scale, cx, cy)
      drawTrail(trailB, ALERT, scale, cx, cy)
      // Same line width, same bob size — colour is the only thing that may
      // distinguish them until physics itself pulls them apart.
      drawPendulum(stateA, SIGNAL, scale, cx, cy)
      drawPendulum(stateB, ALERT, scale, cx, cy)
    }

    function drawStrip() {
      const W = strip.width / (window.devicePixelRatio || 1)
      const H = strip.height / (window.devicePixelRatio || 1)
      stg.clearRect(0, 0, W, H)
      if (W <= 0 || H <= 0) return

      const logMin = Math.log10(LOG_MIN)
      const logMax = Math.log10(LOG_MAX)
      /** @param {number} sep */
      const yOf = (sep) => {
        const frac = (Math.log10(clamp(sep, LOG_MIN, LOG_MAX)) - logMin) / (logMax - logMin)
        return H - frac * H
      }

      // decade gridlines
      stg.strokeStyle = EDGE
      stg.globalAlpha = 0.35
      stg.lineWidth = 1
      for (let d = Math.ceil(logMin); d <= Math.floor(logMax); d++) {
        const y = yOf(10 ** d)
        stg.beginPath(); stg.moveTo(0, y); stg.lineTo(W, y); stg.stroke()
      }
      stg.globalAlpha = 1

      if (history.length < 2) return

      const tHi = Math.max(elapsed, STRIP_WINDOW)
      const tLo = Math.max(0, tHi - STRIP_WINDOW)
      /** @param {number} t */
      const xOf = (t) => ((t - tLo) / (tHi - tLo)) * W

      stg.strokeStyle = SIGNAL
      stg.lineWidth = 1.5
      stg.beginPath()
      let started = false
      for (const p of history) {
        if (p.t < tLo) continue
        const x = xOf(p.t)
        const y = yOf(p.sep)
        if (!started) { stg.moveTo(x, y); started = true } else { stg.lineTo(x, y) }
      }
      stg.stroke()
    }

    let last = 0
    ctx.raf((now) => {
      const rawDt = last === 0 ? 1 / 60 : (now - last) / 1000
      last = now
      const dt = Math.min(rawDt, MAX_FRAME_DT)

      resize()

      if (mode === 'running') {
        const substeps = Math.max(1, Math.round(dt * HZ))
        stateA = advance(stateA, params, dt, substeps)
        stateB = advance(stateB, params, dt, substeps)
        elapsed += dt

        const posA = bobPositions(stateA, params)
        const posB = bobPositions(stateB, params)
        pushTrail(trailA, posA.x2, posA.y2)
        pushTrail(trailB, posB.x2, posB.y2)

        const sep = separation(stateA, stateB)
        history.push({ t: elapsed, sep })
        const tLoKeep = elapsed - STRIP_WINDOW - 1
        while (history.length > 1 && (history[0]?.t ?? 0) < tLoKeep) history.shift()

        // Released from exactly rest (theta=0, omega=0), E0 is exactly zero —
        // a real equilibrium, not a numerical fluke — and dividing by it would
        // report NaN instead of an honest number. Fall back to the pendulum's
        // characteristic energy scale so the readout stays sane right up to
        // that boundary case.
        const echar = (params.m1 + params.m2) * params.g * (params.l1 + params.l2)
        const denom = Math.abs(E0) > 1e-6 ? E0 : echar
        const drift = (energy(stateA, params) - E0) / denom

        $('[data-sep]').textContent = formatSeparation(sep)
        const elapsedEl = $('[data-elapsed]')
        if (elapsedEl.firstChild) elapsedEl.firstChild.textContent = elapsed.toFixed(1)
        $('[data-drift]').textContent = formatDrift(drift)

        const lyapEl = $('[data-lyap]')
        if (sep > LYAP_LO && sep < LYAP_HI && elapsed > 0) {
          const lambda = Math.log(sep / PERTURB) / elapsed
          if (lyapEl.firstChild) lyapEl.firstChild.textContent = lambda.toFixed(2)
        } else if (lyapEl.firstChild) {
          lyapEl.firstChild.textContent = '—'
        }
      }

      drawView()
      drawStrip()
    })

    return () => { root.replaceChildren() }
  },
}
