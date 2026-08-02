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
 * @property {(fn:(heading:number|null, accuracyDeg:number|null) => void) => void} orientation Compass heading, true-north only; null when unavailable
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
