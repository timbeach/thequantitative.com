// @ts-check
import { walkSteps, binOf, binomialPmf, momentsFor, sampleStats } from '../stats/galton.js'

/** @typedef {import('../js/types.js').Instrument} Instrument */
/** @typedef {import('../js/types.js').Ctx} Ctx */

const MIN_ROWS = 8
const MAX_ROWS = 24
const MAX_IN_FLIGHT = 60          // frame-budget guard, not a physical limit
const FALL_MS_PER_ROW = 55        // eased descent time per peg row

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Ease-in to suggest gravity without simulating it. @param {number} t */
const easeIn = (t) => t * t

/** @type {Instrument} */
export default {
  id: 'galton',
  name: 'Galton Board',
  category: 'ideas',
  blurb: 'Watch the normal distribution assemble itself.',
  needs: [],

  /**
   * @param {HTMLElement} root
   * @param {Ctx} ctx
   * @returns {() => void}
   */
  mount(root, ctx) {
    root.innerHTML = `
      <div class="galton">
        <div class="galton__stats">
          <div class="galton__stat">
            <span class="label">Balls</span>
            <span class="readout" data-n>0</span>
          </div>
          <div class="galton__stat">
            <span class="label">Mean</span>
            <span class="readout" data-mean>—.—</span>
          </div>
          <div class="galton__stat">
            <span class="label">Std dev</span>
            <span class="readout" data-sd>—.—</span>
          </div>
        </div>
        <p class="galton__theory label" data-theory></p>
        <canvas class="galton__board" data-board></canvas>
        <div class="galton__controls">
          <label class="galton__control">
            <span class="label">Rows <span data-rows-value></span></span>
            <input type="range" min="${MIN_ROWS}" max="${MAX_ROWS}" step="1" data-rows>
          </label>
          <label class="galton__control">
            <span class="label">Bias p <span data-p-value></span></span>
            <input type="range" min="0.05" max="0.95" step="0.05" data-p>
          </label>
        </div>
        <div class="galton__actions">
          <button class="arm__button arm__button--quiet" type="button" data-rate></button>
          <button class="arm__button arm__button--quiet" type="button" data-dump>Dump 1000</button>
          <button class="arm__button arm__button--quiet" type="button" data-reset>Reset</button>
        </div>
      </div>`

    const $ = (/** @type {string} */ sel) => /** @type {HTMLElement} */ (root.querySelector(sel))
    const canvas = /** @type {HTMLCanvasElement} */ (root.querySelector('[data-board]'))
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))
    const rowsInput = /** @type {HTMLInputElement} */ (root.querySelector('[data-rows]'))
    const pInput = /** @type {HTMLInputElement} */ (root.querySelector('[data-p]'))
    const rateBtn = $('[data-rate]')

    const store = ctx.store
    let rows = clamp(Number(store.get('rows')) || 16, MIN_ROWS, MAX_ROWS)
    let p = clamp(Number(store.get('p')) || 0.5, 0.05, 0.95)
    /** @type {'slow'|'fast'} */
    let rate = store.get('rate') === 'fast' ? 'fast' : 'slow'

    let counts = new Array(rows + 1).fill(0)
    /** @type {{ steps:(0|1)[], row:number, t:number, x:number, bin:number }[]} */
    let flight = []
    let spawnAccumulator = 0

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const styles = getComputedStyle(document.documentElement)
    const SIGNAL = styles.getPropertyValue('--signal').trim() || '#ffb000'
    const EDGE = styles.getPropertyValue('--edge').trim() || '#55606e'
    const INK_DIM = styles.getPropertyValue('--ink-dim').trim() || '#727c88'

    function resetBoard() {
      counts = new Array(rows + 1).fill(0)
      flight = []
    }

    /** Add one completed result straight to the histogram. */
    function land(/** @type {number} */ bin) {
      counts[bin] = (counts[bin] ?? 0) + 1
    }

    function spawn() {
      if (flight.length >= MAX_IN_FLIGHT) return
      const steps = walkSteps(rows, p, Math.random)
      const bin = binOf(steps)
      if (reduceMotion) { land(bin); return }
      flight.push({ steps, row: 0, t: 0, x: 0, bin })
    }

    function syncControls() {
      rowsInput.value = String(rows)
      pInput.value = String(p)
      $('[data-rows-value]').textContent = String(rows)
      $('[data-p-value]').textContent = p.toFixed(2)
      rateBtn.textContent = rate === 'slow' ? 'Rate: slow' : 'Rate: fast'
      const m = momentsFor(rows, p)
      $('[data-theory]').textContent =
        `theoretical mean ${m.mean.toFixed(2)} · sd ${m.sd.toFixed(2)}`
    }

    ctx.on(rowsInput, 'input', () => {
      rows = clamp(Number(rowsInput.value), MIN_ROWS, MAX_ROWS)
      store.set('rows', rows)
      resetBoard()          // the bin count changed; the old histogram is meaningless
      syncControls()
    })

    ctx.on(pInput, 'input', () => {
      p = clamp(Number(pInput.value), 0.05, 0.95)
      store.set('p', p)
      resetBoard()          // a different p is a different distribution
      syncControls()
    })

    ctx.on(rateBtn, 'click', () => {
      rate = rate === 'slow' ? 'fast' : 'slow'
      store.set('rate', rate)
      syncControls()
    })

    ctx.on($('[data-dump]'), 'click', () => {
      // Straight to the histogram: animating a thousand balls would take a
      // minute and teach nothing that the pile does not already show.
      for (let i = 0; i < 1000; i++) land(binOf(walkSteps(rows, p, Math.random)))
    })

    ctx.on($('[data-reset]'), 'click', resetBoard)

    function resize() {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    ctx.on(window, 'resize', resize)
    ctx.on(window, 'orientationchange', resize)

    let last = 0
    ctx.raf((now) => {
      const dt = last === 0 ? 16 : Math.min(now - last, 100)
      last = now

      // ── spawn ──────────────────────────────────────────────────────────
      const perSecond = rate === 'slow' ? 2 : 30
      spawnAccumulator += (dt / 1000) * perSecond
      while (spawnAccumulator >= 1) { spawn(); spawnAccumulator -= 1 }

      // ── advance ────────────────────────────────────────────────────────
      for (let i = flight.length - 1; i >= 0; i--) {
        const b = flight[i]
        if (!b) continue
        b.t += dt / FALL_MS_PER_ROW
        while (b.t >= 1 && b.row < rows) {
          b.x += (b.steps[b.row] === 1 ? 1 : -1)
          b.row++
          b.t -= 1
        }
        if (b.row >= rows) { land(b.bin); flight.splice(i, 1) }
      }

      // ── draw ───────────────────────────────────────────────────────────
      const dpr = window.devicePixelRatio || 1
      const W = canvas.width / dpr
      const H = canvas.height / dpr
      g.clearRect(0, 0, W, H)

      const pegTop = 10
      const pegArea = H * 0.52
      const rowGap = pegArea / rows
      // Bounded by W/(rows+2), not W/rows: that leaves one full colGap of
      // margin split across both edges, which is exactly the half-column the
      // histogram bars below need so they don't clip the canvas — see the
      // histogram section, which reuses this same colGap rather than
      // deriving its own width from W.
      const colGap = Math.min(rowGap, W / (rows + 2))
      const cx = W / 2

      // pegs
      g.fillStyle = EDGE
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c <= r; c++) {
          const x = cx + (c - r / 2) * colGap
          const y = pegTop + r * rowGap
          g.beginPath(); g.arc(x, y, 1.5, 0, Math.PI * 2); g.fill()
        }
      }

      // balls in flight
      //
      // b.x accumulates ±1 per completed row, so after `row` rows it ranges
      // over [-row, row] in steps of 2 — i.e. b.x/2 ranges over [-row/2,
      // row/2] in steps of 1. That is exactly the set of peg offsets (in
      // colGap units) for row `row` above: `c - r/2` for c in 0..r. So
      // `cx + b.x * colGap / 2` lands a resting ball exactly on the peg it
      // just bounced off, at every intermediate row, not just at the bottom.
      // Half-spacing here is correct, not an off-by-one.
      g.fillStyle = SIGNAL
      for (const b of flight) {
        const eased = easeIn(clamp(b.t, 0, 1))
        const nextDir = b.steps[b.row] === 1 ? 1 : -1
        const x = cx + (b.x + (b.row < rows ? nextDir * eased : 0)) * colGap / 2
        const y = pegTop + (b.row + eased) * rowGap
        g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill()
      }

      // histogram
      //
      // Bin i is where a ball with `i` rights comes to rest: b.x = 2i - rows,
      // so its x-offset in colGap units is (2i - rows)/2 = i - rows/2 — the
      // same lattice the pegs and balls above are drawn on, extended one row
      // past the last real peg row. Deriving bin width from the full canvas
      // width instead (W/(rows+1)) would visibly detach the pile from the
      // pegs that produced it, so bars and the theory curve both use colGap.
      const histTop = pegTop + pegArea + 8
      const histH = H - histTop - 2
      const barW = Math.max(1, colGap - 1)
      const peak = Math.max(1, ...counts)

      g.fillStyle = SIGNAL
      g.globalAlpha = 0.55
      for (let i = 0; i <= rows; i++) {
        const h = ((counts[i] ?? 0) / peak) * histH
        const x = cx + (i - rows / 2) * colGap - barW / 2
        g.fillRect(x, histTop + histH - h, barW, h)
      }
      g.globalAlpha = 1

      // theoretical curve, scaled to the same peak so shape is comparable at
      // any sample size, on the same lattice x-coordinates as the bars above
      const pmf = binomialPmf(rows, p)
      const pmfPeak = Math.max(...pmf)
      g.strokeStyle = INK_DIM
      g.lineWidth = 1.5
      g.beginPath()
      for (let i = 0; i <= rows; i++) {
        const x = cx + (i - rows / 2) * colGap
        const y = histTop + histH - ((pmf[i] ?? 0) / pmfPeak) * histH
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
      }
      g.stroke()

      // ── readouts ───────────────────────────────────────────────────────
      const s = sampleStats(counts)
      $('[data-n]').textContent = String(s.n)
      $('[data-mean]').textContent = s.n ? s.mean.toFixed(2) : '—.—'
      $('[data-sd]').textContent = s.n ? s.sd.toFixed(2) : '—.—'
    })

    syncControls()

    return () => { root.replaceChildren() }
  },
}
