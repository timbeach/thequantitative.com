// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectCapabilities, unavailableReason, isIosSafari } from '../js/capability.js'

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const IPADOS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const MACOS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'

/** @param {object} over */
const env = (over = {}) => ({
  isSecureContext: true,
  userAgent: ANDROID_UA,
  hasDeviceMotionEvent: true,
  hasMotionPermissionApi: false,
  hasGetUserMedia: true,
  hasWakeLock: true,
  maxTouchPoints: 0,
  ...over,
})

test('android chrome: motion available without a prompt', () => {
  assert.equal(detectCapabilities(env()).motion, 'available')
})

test('ios safari: motion needs an explicit permission gesture', () => {
  const caps = detectCapabilities(env({ userAgent: IOS_UA, hasMotionPermissionApi: true }))
  assert.equal(caps.motion, 'needs-permission')
})

test('desktop with no motion sensor: unavailable', () => {
  const caps = detectCapabilities(env({ userAgent: DESKTOP_UA, hasDeviceMotionEvent: false }))
  assert.equal(caps.motion, 'unavailable')
})

test('insecure context disables every sensor capability', () => {
  const caps = detectCapabilities(env({ isSecureContext: false }))
  assert.equal(caps.motion, 'unavailable')
  assert.equal(caps.microphone, 'unavailable')
})

test('microphone always needs permission when getUserMedia exists', () => {
  assert.equal(detectCapabilities(env()).microphone, 'needs-permission')
})

test('microphone unavailable without getUserMedia', () => {
  assert.equal(detectCapabilities(env({ hasGetUserMedia: false })).microphone, 'unavailable')
})

test('wake lock degrades silently rather than blocking', () => {
  assert.equal(detectCapabilities(env({ hasWakeLock: false })).wakelock, 'unavailable')
})

test('ios safari detection: iphone yes, android no, desktop linux no', () => {
  assert.equal(isIosSafari(env({ userAgent: IOS_UA })), true)
  assert.equal(isIosSafari(env({ userAgent: ANDROID_UA })), false)
  assert.equal(isIosSafari(env({ userAgent: DESKTOP_UA })), false)
})

test('unavailable reason names the real cause, not a generic error', () => {
  const insecure = unavailableReason('motion', env({ isSecureContext: false }))
  assert.match(insecure, /secure|https/i)

  const noSensor = unavailableReason('motion', env({ hasDeviceMotionEvent: false }))
  assert.match(noSensor, /motion sensor/i)

  const noMic = unavailableReason('microphone', env({ hasGetUserMedia: false }))
  assert.match(noMic, /microphone/i)
})

test('unavailable reason is empty when the capability is fine', () => {
  assert.equal(unavailableReason('motion', env()), '')
})

test('ipadOS is detected despite sending a desktop mac user-agent', () => {
  assert.equal(isIosSafari(env({ userAgent: IPADOS_UA, maxTouchPoints: 5 })), true)
})

test('a real mac is not mistaken for an ipad', () => {
  assert.equal(isIosSafari(env({ userAgent: MACOS_UA, maxTouchPoints: 0 })), false)
})
