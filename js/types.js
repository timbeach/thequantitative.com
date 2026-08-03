// @ts-check
// Typedefs only. This module has no runtime code and is never imported for value.

/** @typedef {'world'|'ideas'} Category */
/** @typedef {'motion'|'microphone'|'wakelock'|'geolocation'} CapabilityKey */
/** @typedef {'available'|'needs-permission'|'unavailable'} CapabilityState */
/** @typedef {'idle'|'prompting'|'granted'|'denied'|'unavailable'} ArmState */
/** @typedef {() => void} Teardown */
/** @typedef {{ x:number, y:number, z:number }} Vec3 */
/** @typedef {{ pitch:number, roll:number }} Tilt */

/**
 * @typedef {{ name:'shelf' }
 *         | { name:'instrument', id:string }
 *         | { name:'about' }
 *         | { name:'not-found', hash:string }} Route
 */

/**
 * @typedef {Object} Store
 * @property {(key:string) => unknown} get
 * @property {(key:string, value:unknown) => void} set
 */

/**
 * @typedef {Object} Ctx
 * @property {(fn:(t:number) => void) => void} raf            Self-rescheduling loop, cancelled on unmount
 * @property {(target:EventTarget, type:string, fn:EventListener, opts?:AddEventListenerOptions) => void} on
 * @property {(fn:(g:Vec3, dt:number) => void) => void} motion Gravity vector in device frame, sign-normalised
 * @property {AbortSignal} signal
 * @property {Store} store
 * @property {() => void} wakeLock                            Best-effort; no-op where unsupported
 * @property {() => AudioContext} audio                     Shared, closed on unmount
 * @property {() => Promise<MediaStreamAudioSourceNode>} mic Stream stopped on unmount
 * @property {() => Promise<{ latitude:number, longitude:number, accuracyM:number }>} location One fix per mount, memoised
 * @property {(fn:(reading:OrientationReading) => void) => void} orientation Full device orientation each frame
 */

/**
 * @typedef {Object} OrientationReading
 * @property {number|null} alpha    Absolute heading in degrees, true-north-relative-to-magnetic-frame; null when no absolute reference is available
 * @property {number|null} beta     Front-back tilt in degrees, accelerometer/gyro-derived; absolute w.r.t. gravity regardless of compass state
 * @property {number|null} gamma    Left-right tilt in degrees, accelerometer/gyro-derived; absolute w.r.t. gravity regardless of compass state
 * @property {boolean} absolute     Whether alpha is a true absolute heading; false means alpha is null and the instrument must fall back
 * @property {number} screenAngle   Screen rotation angle in degrees, needed to correct alpha/beta/gamma for screen rotation
 * @property {number|null} accuracyDeg Reported heading accuracy in degrees, when the platform provides one
 */

/**
 * @typedef {Object} Instrument
 * @property {string} id
 * @property {string} name
 * @property {Category} category
 * @property {string} blurb
 * @property {CapabilityKey[]} needs
 * @property {(root:HTMLElement, ctx:Ctx) => Teardown} mount
 */

/**
 * @typedef {Object} RegistryEntry
 * @property {string} id
 * @property {string} name
 * @property {Category} category
 * @property {string} blurb
 * @property {CapabilityKey[]} needs
 * @property {() => Promise<{ default: Instrument }>} load
 */

export {}
