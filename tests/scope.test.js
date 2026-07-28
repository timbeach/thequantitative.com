// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createScope } from '../js/scope.js'

/** A controllable stand-in for the browser's animation clock. */
function fakeHost() {
  /** @type {Map<number, FrameRequestCallback>} */
  const pending = new Map()
  let nextId = 1
  return {
    cancelled: /** @type {number[]} */ ([]),
    requestAnimationFrame(/** @type {FrameRequestCallback} */ cb) {
      const id = nextId++
      pending.set(id, cb)
      return id
    },
    cancelAnimationFrame(/** @type {number} */ id) {
      this.cancelled.push(id)
      pending.delete(id)
    },
    /** Run every currently-pending callback once. */
    tick(t = 0) {
      const due = [...pending.entries()]
      pending.clear()
      for (const [, cb] of due) cb(t)
    },
    get pendingCount() { return pending.size },
  }
}

test('teardowns run in reverse registration order', () => {
  const host = fakeHost()
  const scope = createScope(host)
  /** @type {string[]} */
  const order = []
  scope.add(() => order.push('first'))
  scope.add(() => order.push('second'))
  scope.add(() => order.push('third'))
  scope.dispose()
  assert.deepEqual(order, ['third', 'second', 'first'])
})

test('dispose is idempotent — teardowns never run twice', () => {
  const host = fakeHost()
  const scope = createScope(host)
  let count = 0
  scope.add(() => { count++ })
  scope.dispose()
  scope.dispose()
  scope.dispose()
  assert.equal(count, 1)
})

test('a throwing teardown does not prevent the others', () => {
  const host = fakeHost()
  const scope = createScope(host)
  let reached = false
  scope.add(() => { reached = true })
  scope.add(() => { throw new Error('boom') })
  scope.dispose()
  assert.equal(reached, true)
})

test('raf loop reschedules itself until disposed', () => {
  const host = fakeHost()
  const scope = createScope(host)
  let frames = 0
  scope.raf(() => { frames++ })
  host.tick(); host.tick(); host.tick()
  assert.equal(frames, 3)
  scope.dispose()
  host.tick()
  assert.equal(frames, 3, 'no further frames after dispose')
})

test('disposing cancels the outstanding animation frame', () => {
  const host = fakeHost()
  const scope = createScope(host)
  scope.raf(() => {})
  assert.equal(host.pendingCount, 1)
  scope.dispose()
  assert.equal(host.cancelled.length, 1)
  assert.equal(host.pendingCount, 0)
})

test('listeners are removed on dispose', () => {
  const host = fakeHost()
  const scope = createScope(host)
  const target = new EventTarget()
  let hits = 0
  scope.on(target, 'ping', () => { hits++ })
  target.dispatchEvent(new Event('ping'))
  assert.equal(hits, 1)
  scope.dispose()
  target.dispatchEvent(new Event('ping'))
  assert.equal(hits, 1, 'listener still attached after dispose')
})

test('signal aborts on dispose', () => {
  const host = fakeHost()
  const scope = createScope(host)
  assert.equal(scope.signal.aborted, false)
  scope.dispose()
  assert.equal(scope.signal.aborted, true)
})

test('registering after dispose runs the teardown immediately', () => {
  const host = fakeHost()
  const scope = createScope(host)
  scope.dispose()
  let ran = false
  scope.add(() => { ran = true })
  assert.equal(ran, true, 'a late registration would otherwise leak forever')
})

test('raf and on are inert after dispose', () => {
  const host = fakeHost()
  const scope = createScope(host)
  const target = new EventTarget()
  scope.dispose()
  scope.raf(() => { throw new Error('should never run') })
  scope.on(target, 'ping', () => { throw new Error('should never run') })
  host.tick()
  target.dispatchEvent(new Event('ping'))
  assert.equal(host.pendingCount, 0)
})

test('disposed flag reflects state', () => {
  const scope = createScope(fakeHost())
  assert.equal(scope.disposed, false)
  scope.dispose()
  assert.equal(scope.disposed, true)
})
