// @ts-check
/** @typedef {import('./types.js').Teardown} Teardown */

/**
 * @typedef {Object} ScopeHost
 * @property {(cb:FrameRequestCallback) => number} requestAnimationFrame
 * @property {(id:number) => void} cancelAnimationFrame
 */

/**
 * A disposal scope.
 *
 * Every resource registered here is released exactly once when dispose() runs.
 * This exists so that forgetting to clean up is not possible rather than not
 * advisable: instruments never see raw requestAnimationFrame or
 * addEventListener, so they cannot leave one running after unmount.
 *
 * Host injection is what makes this testable in node with no DOM.
 *
 * @param {ScopeHost} host
 */
export function createScope(host) {
  /** @type {Teardown[]} */
  const teardowns = []
  const controller = new AbortController()
  let disposed = false

  return {
    signal: controller.signal,

    get disposed() {
      return disposed
    },

    /**
     * Register an arbitrary teardown. Registering after dispose runs it
     * immediately — otherwise a late registration would leak forever.
     * @param {Teardown} fn
     */
    add(fn) {
      if (disposed) {
        fn()
        return
      }
      teardowns.push(fn)
    },

    /**
     * A self-rescheduling animation loop, cancelled on dispose.
     * @param {(t:number) => void} fn
     */
    raf(fn) {
      if (disposed) return
      let id = 0
      /** @type {FrameRequestCallback} */
      const step = (t) => {
        if (disposed) return
        fn(t)
        id = host.requestAnimationFrame(step)
      }
      id = host.requestAnimationFrame(step)
      teardowns.push(() => host.cancelAnimationFrame(id))
    },

    /**
     * @param {EventTarget} target
     * @param {string} type
     * @param {EventListener} fn
     * @param {AddEventListenerOptions} [opts]
     */
    on(target, type, fn, opts) {
      if (disposed) return
      target.addEventListener(type, fn, opts)
      teardowns.push(() => target.removeEventListener(type, fn, opts))
    },

    dispose() {
      if (disposed) return
      disposed = true
      controller.abort()
      for (let i = teardowns.length - 1; i >= 0; i--) {
        try {
          teardowns[i]?.()
        } catch (err) {
          console.error('scope: teardown threw', err)
        }
      }
      teardowns.length = 0
    },
  }
}
