// @ts-check
import { readEnv, detectCapabilities, isIos, unavailableReason } from './capability.js'
import { el } from './util.js'

/** @typedef {import('./types.js').CapabilityKey} CapabilityKey */

const COPY = {
  motion: {
    title: 'Motion access',
    why: 'The Spirit Level reads your phone’s accelerometer to work out which way is down. Nothing is recorded and nothing leaves the device.',
    action: 'Enable motion',
  },
  microphone: {
    title: 'Microphone access',
    why: 'This instrument analyses sound locally, in the page. No audio is recorded, stored, or transmitted.',
    action: 'Enable microphone',
  },
  wakelock: {
    title: 'Keep the screen awake',
    why: 'Holds the screen on while you are measuring.',
    action: 'Continue',
  },
  geolocation: {
    title: 'Location access',
    why: 'Which stars are above you depends entirely on where you are standing. Your position is used to compute the sky and is never sent anywhere — this site has no server.',
    action: 'Use my location',
  },
}

/**
 * @param {HTMLElement} host
 * @param {string} title
 * @param {string} body
 * @param {{label:string, onClick:() => void}} [action]
 */
function screen(host, title, body, action) {
  const nodes = [
    el('h2', { class: 'label' }, [title]),
    el('p', { class: 'arm__body' }, [body]),
  ]
  if (action) {
    const button = el('button', { class: 'arm__button', type: 'button' }, [action.label])
    button.addEventListener('click', action.onClick, { once: true })
    nodes.push(button)
  }
  nodes.push(el('a', { class: 'label', href: '#/' }, ['← All instruments']))
  host.replaceChildren(el('div', { class: 'arm' }, nodes))
}

/**
 * Request one capability, rendering the appropriate screen for every outcome.
 * @param {HTMLElement} host
 * @param {CapabilityKey} key
 * @returns {Promise<boolean>}
 */
function requireOne(host, key) {
  const env = readEnv()
  const state = detectCapabilities(env)[key]
  const copy = COPY[key]

  if (state === 'available') return Promise.resolve(true)

  if (state === 'unavailable') {
    screen(host, 'Not available here', `${copy.title} is ${unavailableReason(key, env)}.`)
    return Promise.resolve(false)
  }

  // needs-permission: the request must originate from a user gesture, which is
  // exactly why this is a button and not an automatic call on mount.
  return new Promise((resolve) => {
    screen(host, copy.title, copy.why, {
      label: copy.action,
      onClick: () => {
        screen(host, copy.title, 'Waiting for your answer…')
        grant(key)
          .then((ok) => {
            if (ok) { resolve(true); return }
            screen(
              host,
              'Permission denied',
              isIos(env)
                ? 'Motion access was declined. To undo it: Settings → the browser you’re using (e.g. Safari or Chrome) → Motion & Orientation Access, then reload this page.'
                : 'Access was declined. Tap the padlock in the address bar to review this site’s permissions, then reload.',
              // A reload is not optional: once declined, the permission API
              // resolves 'denied' immediately without prompting again until the
              // page is reloaded. A button that merely re-called it would look
              // broken, so this reloads.
              { label: 'Reload', onClick: () => globalThis.location.reload() },
            )
            resolve(false)
          })
          .catch(() => {
            screen(host, 'Something went wrong', 'The permission request failed. Reload and try again.')
            resolve(false)
          })
      },
    })
  })
}

/**
 * @param {CapabilityKey} key
 * @returns {Promise<boolean>}
 */
async function grant(key) {
  if (key === 'motion') {
    const DME = /** @type {any} */ (globalThis).DeviceMotionEvent
    const DOE = /** @type {any} */ (globalThis).DeviceOrientationEvent

    // iOS gates DeviceOrientationEvent.requestPermission separately from
    // DeviceMotionEvent.requestPermission. Both must be requested from this
    // same click handler's gesture, or the compass silently never fires while
    // motion works fine — a bug that looks exactly like broken pointing maths.
    // Fired here, synchronously, before any await breaks the gesture context.
    if (typeof DOE?.requestPermission === 'function') {
      DOE.requestPermission().catch(() => {})
    }

    if (typeof DME?.requestPermission !== 'function') return true
    return (await DME.requestPermission()) === 'granted'
  }
  if (key === 'microphone') {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    // Release immediately — ctx.mic() opens its own stream when an instrument
    // actually needs one. This call exists purely to trigger the prompt.
    stream.getTracks().forEach((t) => t.stop())
    return true
  }
  if (key === 'geolocation') {
    await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 15000, enableHighAccuracy: false })
    })
    return true
  }
  return true
}

/**
 * Gate an instrument behind every capability it declares.
 * Resolves true only when all are granted.
 *
 * @param {HTMLElement} host
 * @param {CapabilityKey[]} needs
 * @returns {Promise<boolean>}
 */
export async function requireCapabilities(host, needs) {
  for (const key of needs) {
    if (!(await requireOne(host, key))) return false
  }
  return true
}
