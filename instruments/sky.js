// @ts-check
import { lstDegrees, eqToAltAz, lightLeftYear, angularSeparation } from '../dsp/astro.js'
import { createAimSmoother, createStarLock } from '../dsp/aim.js'
import { pointingDirection, POINT_BACK, POINT_FRONT } from '../dsp/pointing.js'
import { STARS } from '../data/stars.js'

/** @typedef {import('../js/types.js').Instrument} Instrument */
/** @typedef {import('../js/types.js').Ctx} Ctx */
/** @typedef {import('../js/types.js').OrientationReading} OrientationReading */
/** @typedef {import('../data/stars.js').Star} Star */

const DEG = Math.PI / 180
const V_HALF = 2            // degrees — the vertical half-width of the accuracy ellipse, fixed
const H_HALF_DEFAULT = 15   // degrees — assumed compass accuracy when the device reports none
const FOV = 60               // degrees — width of the pointing-mode view
const ACQUIRE_DEG = 8        // degrees — createStarLock's acquire threshold, mirrored below for the ring
const RELEASE_DEG = 14       // degrees — createStarLock's release threshold (hysteresis gap)
const DWELL_FRAMES = 3       // frames — createStarLock's dwell requirement, mirrored for ring progress
const TAP_RADIUS = 22        // CSS px — thumb-sized hit-test radius for tap-to-inspect
const POLARIS = STARS.find((s) => s.name === 'Polaris')

// The front vector (screen normal) is used with the phone held roughly flat,
// screen facing the sky — the observer looks DOWN at the screen from above
// it, so their gaze and the pointed-at direction are opposite (down vs up).
// That is the front/selfie-camera situation, not the back/rear-camera one:
// for POINT_BACK, held vertically like a window, the observer's gaze and the
// pointed-at direction are the SAME way (look through the screen at what the
// back camera sees), so left stays left. For POINT_FRONT the observer is on
// the far side of the aim from where it points, exactly like a selfie
// camera, so screen left/right is mirrored to read naturally — the same
// convention every front-facing camera app uses. Reasoned from geometry, not
// verified on a device; flip this if it looks backwards in hand.
const MIRROR_FRONT = true

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Year 0 does not exist in the conventional calendar, so 1 BC follows 1 AD directly. @param {number} y */
const fmtYear = (y) => (y <= 0 ? `${1 - y} BC` : `${y}`)

/** @param {number} ly */
const fmtDist = (ly) => (ly >= 100 ? Math.round(ly).toString() : ly.toFixed(1))

/** Bigger circle for a brighter (lower-magnitude) star. @param {number} mag */
const starRadius = (mag) => clamp(6.5 - mag * 1.6, 1.2, 6.5)

/** Wrap to (-180, 180]. @param {number} d */
const wrapDeg = (d) => (((d + 180) % 360 + 360) % 360) - 180

/** @param {number|null} deg */
function fmtHms(deg) {
  if (deg == null) return '—:—:—'
  const totalH = ((deg / 15) % 24 + 24) % 24
  const h = Math.floor(totalH)
  const mFull = (totalH - h) * 60
  const m = Math.floor(mFull)
  const s = Math.floor((mFull - m) * 60)
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

/** @type {Instrument} */
export default {
  id: 'sky',
  name: 'Sky Pointer',
  category: 'world',
  blurb: 'Point at the sky. See what is there, and when its light left.',
  needs: ['motion', 'geolocation'],

  /**
   * @param {HTMLElement} root
   * @param {Ctx} ctx
   * @returns {() => void}
   */
  mount(root, ctx) {
    root.innerHTML = `
      <div class="sky">
        <div class="sky__id">
          <span class="label" data-heading>Locating…</span>
          <span class="sky__name" data-star>—</span>
          <span class="card__reason" data-note></span>
        </div>
        <div class="sky__view">
          <canvas class="sky__canvas" data-canvas></canvas>
          <div class="sky__mode">
            <button class="sky__mode-btn" type="button" data-flip></button>
            <span class="sky__mode-hint" data-flip-hint></span>
          </div>
          <div class="sky__panel" data-panel hidden>
            <button class="sky__panel-dismiss" type="button" data-panel-dismiss aria-label="Dismiss">×</button>
            <span class="sky__panel-name" data-panel-name></span>
            <div class="sky__panel-row"><span class="label">Mag</span><span data-panel-mag></span></div>
            <div class="sky__panel-row"><span class="label">Dist</span><span data-panel-dist></span></div>
            <div class="sky__panel-row"><span class="label">Alt</span><span data-panel-alt></span></div>
            <div class="sky__panel-row"><span class="label">Az</span><span data-panel-az></span></div>
            <p class="sky__panel-light" data-panel-light></p>
          </div>
        </div>
        <p class="sky__light" data-light>—</p>
        <div class="sky__stats">
          <div class="sky__stat"><span class="label">Mag</span><span class="readout" data-mag>—.—</span></div>
          <div class="sky__stat"><span class="label">Dist</span><span class="readout" data-dist>—<span class="readout__unit">ly</span></span></div>
          <div class="sky__stat"><span class="label">Alt</span><span class="readout" data-alt>—.—<span class="readout__unit">°</span></span></div>
          <div class="sky__stat"><span class="label">Az</span><span class="readout" data-az>—.—<span class="readout__unit">°</span></span></div>
        </div>
        <p class="sky__caveat card__reason">The compass points at magnetic north, not true north — expect several degrees of drift, more in some regions. Not corrected here.</p>
        <p class="sky__polaris label" data-polaris></p>
        <p class="sky__clock label" data-clock></p>
      </div>`

    const $ = (/** @type {string} */ sel) => /** @type {HTMLElement} */ (root.querySelector(sel))
    const canvas = /** @type {HTMLCanvasElement} */ (root.querySelector('[data-canvas]'))
    const g2d = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))

    const headingLabelEl = $('[data-heading]')
    const nameEl = $('[data-star]')
    const noteEl = $('[data-note]')
    const lightEl = $('[data-light]')
    const magEl = $('[data-mag]')
    const distEl = $('[data-dist]')
    const altEl = $('[data-alt]')
    const azEl = $('[data-az]')
    const flipBtn = $('[data-flip]')
    const flipHintEl = $('[data-flip-hint]')
    const panelEl = $('[data-panel]')
    const panelDismissEl = $('[data-panel-dismiss]')
    const panelNameEl = $('[data-panel-name]')
    const panelMagEl = $('[data-panel-mag]')
    const panelDistEl = $('[data-panel-dist]')
    const panelAltEl = $('[data-panel-alt]')
    const panelAzEl = $('[data-panel-az]')
    const panelLightEl = $('[data-panel-light]')
    const polarisEl = $('[data-polaris]')
    const clockEl = $('[data-clock]')

    /** @type {{ latitude:number, longitude:number, accuracyM:number } | null} */
    let loc = null
    let locFailed = false
    ctx.location().then((l) => { loc = l }).catch(() => { locFailed = true })

    // Altitude used to come from the accelerometer (asin(-gz/|g|)) while
    // azimuth came from alpha alone. Both are now read off the same full
    // orientation matrix instead: algebraically, asin(-gz/|g|) for a
    // stationary device and the matrix's asin(w.z) for POINT_BACK are the
    // *same formula* (both reduce to asin(-cosβ·cosγ), independent of alpha)
    // — verified by direct comparison across a full β/γ sweep, max
    // disagreement 6e-14°, pure float noise. Running two sensors for one
    // quantity would only invite drift with no accuracy benefit, and the
    // orientation event's β/γ already benefit from the platform's own
    // gyro/accelerometer fusion rather than one raw instantaneous sample, so
    // the matrix is now the sole source for both axes. ctx.motion is no
    // longer needed here.
    /** @type {OrientationReading | null} */
    let reading = null
    ctx.orientation((o) => { reading = o })

    let pointFront = ctx.store.get('pointFront') === true

    /** @param {boolean} front */
    function updateFlipLabel(front) {
      flipBtn.textContent = front ? 'Pointing: screen' : 'Pointing: back camera'
      flipHintEl.textContent = front
        ? 'Hold the phone flat, screen up — no need to hold it overhead.'
        : 'Aim the back of the phone at the sky, like a camera.'
    }
    updateFlipLabel(pointFront)

    ctx.on(flipBtn, 'click', () => {
      pointFront = !pointFront
      ctx.store.set('pointFront', pointFront)
      updateFlipLabel(pointFront)
    })

    /** @type {Star | null} */
    let selected = null
    /** @type {{ star: Star, x: number, y: number }[]} */
    let projected = []

    ctx.on(canvas, 'pointerdown', (ev) => {
      const e = /** @type {PointerEvent} */ (ev)
      const rect = canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      /** @type {Star | null} */
      let hit = null
      let bestD = TAP_RADIUS
      for (const p of projected) {
        const d = Math.hypot(p.x - px, p.y - py)
        if (d <= bestD) { bestD = d; hit = p.star }
      }
      selected = hit
    })

    ctx.on(panelDismissEl, 'click', () => {
      selected = null
      panelEl.hidden = true
    })

    ctx.wakeLock()

    const smoothAim = createAimSmoother()
    const starLock = createStarLock({ acquireDeg: ACQUIRE_DEG, releaseDeg: RELEASE_DEG, dwellFrames: DWELL_FRAMES })
    let lastT = 0

    // createStarLock only reports dwell once fully locked (null while
    // acquiring, {dwell:1} once held) — it does not expose fractional
    // progress. This shadow counter mirrors its own unlocked-branch dwell
    // logic, over the same candidates and ACQUIRE_DEG, purely so the ring can
    // close smoothly; it never itself decides which star is identified —
    // starLock() remains the sole authority for that.
    /** @type {string | null} */
    let acquireName = null
    let acquireCount = 0

    // Unlike every other instrument's canvas, this one sits beside text that
    // populates asynchronously — the Polaris line and the sidereal clock
    // arrive only once ctx.location() resolves, after mount's first layout
    // pass. That shifts the canvas's CSS box height, so resize() must be
    // re-checked every frame rather than once at mount plus on window resize
    // events; the early-return keeps the common case (nothing changed) to a
    // single pair of property reads.
    let lastCw = -1, lastCh = -1
    function resize() {
      const cw = canvas.clientWidth, ch = canvas.clientHeight
      if (cw === lastCw && ch === lastCh) return
      lastCw = cw; lastCh = ch
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(cw * dpr)
      canvas.height = Math.round(ch * dpr)
      g2d.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    ctx.on(window, 'resize', resize)
    ctx.on(window, 'orientationchange', resize)

    const styles = getComputedStyle(document.documentElement)
    const SIGNAL = styles.getPropertyValue('--signal').trim() || '#ffb000'
    const EDGE = styles.getPropertyValue('--edge').trim() || '#55606e'
    const INK = styles.getPropertyValue('--ink').trim() || '#e8eaed'
    const INK_DIM = styles.getPropertyValue('--ink-dim').trim() || '#727c88'

    /** @param {string} headingLabel @param {string} name @param {string} note */
    function setIdle(headingLabel, name, note) {
      headingLabelEl.textContent = headingLabel
      nameEl.textContent = name
      noteEl.textContent = note
    }

    /**
     * @param {{ star: Star, alt:number, az:number } | null} best
     * @param {number | null} aimAlt
     * @param {number | null} aimAz
     */
    function setStats(best, aimAlt, aimAz) {
      const magNode = magEl.firstChild
      const distNode = distEl.firstChild
      const altNode = altEl.firstChild
      const azNode = azEl.firstChild
      if (magNode) magNode.textContent = best ? best.star.mag.toFixed(2) : '—.—'
      if (distNode) distNode.textContent = best ? `${best.star.uncertain ? '~' : ''}${fmtDist(best.star.distanceLy)}` : '—'
      if (altNode) altNode.textContent = aimAlt != null ? aimAlt.toFixed(1) : '—.—'
      if (azNode) azNode.textContent = aimAz != null ? aimAz.toFixed(1) : '—.—'
    }

    /** @param {number} w @param {number} h @param {string} text */
    function drawMessage(w, h, text) {
      g2d.fillStyle = INK_DIM
      g2d.font = '13px "IBM Plex Mono", monospace'
      g2d.textAlign = 'center'
      g2d.textBaseline = 'middle'
      g2d.fillText(text, w / 2, h / 2)
    }

    /**
     * Mark a star as tapped: a dashed signal-color ring, distinct from the
     * lock ring's solid sweep, so a selected star reads clearly even when it
     * is also the currently-locked one.
     * @param {number} x @param {number} y @param {number} mag
     */
    function drawSelection(x, y, mag) {
      g2d.strokeStyle = SIGNAL
      g2d.lineWidth = 1.5
      g2d.setLineDash([2, 3])
      g2d.beginPath()
      g2d.arc(x, y, starRadius(mag) + 6, 0, Math.PI * 2)
      g2d.stroke()
      g2d.setLineDash([])
    }

    /**
     * Pointing mode: a ~60° field around the aim point, the asymmetric
     * accuracy ellipse, and the identified star (if any) picked out in signal
     * color.
     * @param {number} w @param {number} h
     * @param {number} aimAlt @param {number} aimAz
     * @param {number} hHalf @param {number} lat @param {number} lst
     * @param {{ star: Star, alt:number, az:number } | null} best
     * @param {Star | null} ringTarget the star to ring, whether acquiring or locked
     * @param {number} ringProgress 0..1 while acquiring, 1 once locked
     * @param {boolean} mirror flip the horizontal axis (POINT_FRONT)
     * @param {Star | null} selectedStar the tapped star, if any
     */
    function drawPointing(w, h, aimAlt, aimAz, hHalf, lat, lst, best, ringTarget, ringProgress, mirror, selectedStar) {
      const scale = Math.min(w, h) / FOV   // px per degree
      const cx = w / 2, cy = h / 2
      const dir = mirror ? -1 : 1
      let ringX = /** @type {number | null} */ (null)
      let ringY = /** @type {number | null} */ (null)
      let selX = /** @type {number | null} */ (null)
      let selY = /** @type {number | null} */ (null)

      const dAltHorizon = -aimAlt
      if (Math.abs(dAltHorizon) < FOV / 2 + 5) {
        const y = cy - dAltHorizon * scale
        g2d.strokeStyle = INK_DIM
        g2d.setLineDash([4, 4])
        g2d.beginPath(); g2d.moveTo(0, y); g2d.lineTo(w, y); g2d.stroke()
        g2d.setLineDash([])
      }

      for (const s of STARS) {
        const { alt, az } = eqToAltAz(s.ra, s.dec, lat, lst)
        const dAlt = alt - aimAlt
        const dAz = wrapDeg(az - aimAz)
        if (Math.abs(dAlt) > FOV / 2 + 5 || Math.abs(dAz) > FOV / 2 + 5) continue
        const x = cx + dAz * scale * dir
        const y = cy - dAlt * scale
        projected.push({ star: s, x, y })
        const isBest = best != null && best.star === s
        g2d.beginPath()
        g2d.arc(x, y, starRadius(s.mag), 0, Math.PI * 2)
        g2d.fillStyle = isBest ? SIGNAL : (alt < 0 ? INK_DIM : INK)
        g2d.fill()

        if (ringTarget != null && s === ringTarget) { ringX = x; ringY = y }
        if (selectedStar != null && s === selectedStar) { selX = x; selY = y }
      }

      g2d.strokeStyle = SIGNAL
      g2d.lineWidth = 1.5
      g2d.beginPath()
      g2d.ellipse(cx, cy, hHalf * scale, V_HALF * scale, 0, 0, Math.PI * 2)
      g2d.stroke()

      // The lock ring: closes clockwise from the top while acquiring
      // (--ink-dim), solid once locked (--signal). Not drawn at all once
      // released — it simply disappears rather than lingering.
      if (ringTarget != null && ringX != null && ringY != null && ringProgress > 0) {
        const r = starRadius(ringTarget.mag) + 5
        const locked = ringProgress >= 1
        g2d.strokeStyle = locked ? SIGNAL : INK_DIM
        g2d.lineWidth = 1.5
        g2d.beginPath()
        const start = -Math.PI / 2
        const end = start + clamp(ringProgress, 0, 1) * Math.PI * 2
        g2d.arc(ringX, ringY, r, start, end)
        g2d.stroke()
      }

      if (selectedStar != null && selX != null && selY != null) {
        drawSelection(selX, selY, selectedStar.mag)
      }

      g2d.strokeStyle = EDGE
      g2d.lineWidth = 1
      g2d.beginPath()
      g2d.moveTo(cx - 10, cy); g2d.lineTo(cx + 10, cy)
      g2d.moveTo(cx, cy - 10); g2d.lineTo(cx, cy + 10)
      g2d.stroke()
    }

    /**
     * Fallback when no compass heading is available: a fisheye of the whole
     * sky centred on the zenith. It cannot be aligned to where the phone is
     * pointing — there is no heading — so it is not drawn as though it were.
     * @param {number} w @param {number} h @param {number} lat @param {number} lst
     * @param {Star | null} selectedStar the tapped star, if any
     */
    function drawZenith(w, h, lat, lst, selectedStar) {
      const R = Math.min(w, h) / 2 - 12
      const cx = w / 2, cy = h / 2

      g2d.strokeStyle = EDGE
      g2d.lineWidth = 1
      g2d.beginPath(); g2d.arc(cx, cy, R, 0, Math.PI * 2); g2d.stroke()

      for (const s of STARS) {
        const { alt, az } = eqToAltAz(s.ra, s.dec, lat, lst)
        if (alt < 0) continue
        const rr = ((90 - alt) / 90) * R
        const theta = az * DEG
        const x = cx + rr * Math.sin(theta)
        const y = cy - rr * Math.cos(theta)
        projected.push({ star: s, x, y })
        g2d.beginPath()
        g2d.arc(x, y, starRadius(s.mag), 0, Math.PI * 2)
        g2d.fillStyle = INK
        g2d.fill()

        if (selectedStar != null && s === selectedStar) drawSelection(x, y, s.mag)
      }
    }

    /**
     * Populate the tap-to-inspect panel for the currently-selected star, or
     * hide it if nothing is selected. Lives beside the aim readout, not over
     * it — the panel is positioned within the canvas view only.
     * @param {number} lat @param {number} lst @param {Date} now
     */
    function renderPanel(lat, lst, now) {
      if (!selected) { panelEl.hidden = true; return }
      const { alt, az } = eqToAltAz(selected.ra, selected.dec, lat, lst)
      const y = lightLeftYear(selected.distanceLy, now)
      panelNameEl.textContent = selected.name
      panelMagEl.textContent = selected.mag.toFixed(2)
      panelDistEl.textContent = `${selected.uncertain ? '~' : ''}${fmtDist(selected.distanceLy)} ly`
      panelAltEl.textContent = `${alt.toFixed(1)}°`
      panelAzEl.textContent = `${az.toFixed(1)}°`
      panelLightEl.textContent = `Light left in ${selected.uncertain ? '~' : ''}${fmtYear(y)}`
      panelEl.hidden = false
    }

    ctx.raf((t) => {
      resize()
      const dt = lastT === 0 ? 1 / 60 : Math.min((t - lastT) / 1000, 0.25)
      lastT = t

      const now = new Date()
      const o = reading
      const vector = pointFront ? POINT_FRONT : POINT_BACK
      const mirror = pointFront && MIRROR_FRONT

      // beta/gamma are present as soon as any orientation event has arrived,
      // whether or not there is an absolute heading — altitude does not
      // depend on alpha, so it stays available even without a compass (see
      // the zenith fallback below). Azimuth needs an absolute alpha, so it
      // is only trusted once o.absolute is true.
      const haveTilt = o != null && o.beta != null && o.gamma != null
      let rawAlt = /** @type {number | null} */ (null)
      let rawAz = /** @type {number | null} */ (null)
      if (haveTilt) {
        const oo = /** @type {OrientationReading} */ (o)
        // pointingDirection wants number|undefined; OrientationReading uses
        // number|null for "not available" — bridge the two here rather than
        // touching dsp/pointing.js, which is shared and already verified.
        const dir = pointingDirection({
          alpha: oo.alpha ?? undefined,
          beta: oo.beta ?? undefined,
          gamma: oo.gamma ?? undefined,
          screenAngle: oo.screenAngle,
        }, vector)
        rawAlt = dir.alt
        rawAz = oo.absolute === true ? dir.az : null
      }
      const hasHeading = rawAz != null
      const headingAccNow = o ? o.accuracyDeg : null
      const hHalf = clamp((headingAccNow != null && headingAccNow > 0) ? headingAccNow : H_HALF_DEFAULT, 2, 60)

      clockEl.textContent =
        `${now.toLocaleTimeString()} · LST ${fmtHms(loc ? lstDegrees(now, loc.longitude) : null)}`

      if (loc && POLARIS) {
        const lst = lstDegrees(now, loc.longitude)
        const { alt: polAlt } = eqToAltAz(POLARIS.ra, POLARIS.dec, loc.latitude, lst)
        polarisEl.textContent = polAlt > 0
          ? `Polaris ${polAlt.toFixed(1)}° up — that is your latitude`
          : 'Polaris is below the horizon from here'
      } else {
        polarisEl.textContent = ''
      }

      const w = canvas.width / (window.devicePixelRatio || 1)
      const h = canvas.height / (window.devicePixelRatio || 1)
      g2d.clearRect(0, 0, w, h)
      projected = []   // rebuilt fresh each frame — see ctx.on(canvas, 'pointerdown', …)

      if (!loc) {
        drawMessage(w, h, locFailed ? 'Location unavailable' : 'Finding your location…')
        setIdle('Locating…', '—', locFailed
          ? 'Location unavailable — cannot compute the sky.'
          : 'Waiting for your location…')
        lightEl.textContent = '—'
        setStats(null, rawAlt, null)
        panelEl.hidden = true
        return
      }

      if (rawAlt == null) {
        drawMessage(w, h, 'Waiting for motion data…')
        setIdle('Locating…', '—', 'Waiting for motion data…')
        lightEl.textContent = '—'
        setStats(null, null, null)
        panelEl.hidden = true
        return
      }

      const lst = lstDegrees(now, loc.longitude)

      if (!hasHeading) {
        drawZenith(w, h, loc.latitude, lst, selected)
        setIdle('Overhead', 'Whole sky',
          'No compass detected — showing everything above you, not where the phone points.')
        lightEl.textContent = '—'
        setStats(null, rawAlt, null)
        renderPanel(loc.latitude, lst, now)
        return
      }

      // Smoothed values are what the instrument is actually pointing at — used
      // for rendering, identification, and the displayed alt/az readout alike.
      const smoothed = smoothAim(rawAlt, /** @type {number} */ (rawAz), dt)
      const aimAlt = smoothed.alt
      const aimAz = smoothed.az

      /** @type {{ star: Star, alt: number, az: number, sep: number }[]} */
      const records = []
      for (const s of STARS) {
        const { alt, az } = eqToAltAz(s.ra, s.dec, loc.latitude, lst)
        if (alt < 0) continue
        records.push({ star: s, alt, az, sep: angularSeparation(aimAlt, aimAz, alt, az) })
      }
      records.sort((a, b) => a.star.mag - b.star.mag)   // brightest first

      /** @type {Map<string, { star: Star, alt: number, az: number }>} */
      const byName = new Map()
      const candidates = records.map((r) => {
        byName.set(r.star.name, r)
        return { name: r.star.name, sep: r.sep }
      })

      const lock = starLock(candidates)

      let acquireProgress = 0
      if (lock == null) {
        const pick = candidates.find((c) => c.sep <= ACQUIRE_DEG)
        if (!pick) {
          acquireName = null
          acquireCount = 0
        } else {
          if (pick.name !== acquireName) { acquireName = pick.name; acquireCount = 0 }
          acquireCount += 1
          acquireProgress = clamp(acquireCount / DWELL_FRAMES, 0, 1)
        }
      } else {
        acquireName = null
        acquireCount = 0
      }

      const best = lock ? (byName.get(lock.name) ?? null) : null
      const ringTarget = best
        ? best.star
        : (acquireName ? (byName.get(acquireName)?.star ?? null) : null)
      const ringProgress = best ? 1 : acquireProgress

      drawPointing(w, h, aimAlt, aimAz, hHalf, loc.latitude, lst, best, ringTarget, ringProgress, mirror, selected)

      if (best) {
        setIdle('Pointing at', best.star.name, `±${hHalf.toFixed(0)}° compass accuracy`)
        const y = lightLeftYear(best.star.distanceLy, now)
        lightEl.textContent = `Light left in ${best.star.uncertain ? '~' : ''}${fmtYear(y)}`
      } else if (ringTarget) {
        setIdle('Acquiring…', '—', `±${hHalf.toFixed(0)}° compass accuracy`)
        lightEl.textContent = '—'
      } else {
        setIdle('Pointing at', 'No match', `±${hHalf.toFixed(0)}° compass accuracy`)
        lightEl.textContent = '—'
      }
      setStats(best, aimAlt, aimAz)
      renderPanel(loc.latitude, lst, now)
    })

    return () => { root.replaceChildren() }
  },
}
