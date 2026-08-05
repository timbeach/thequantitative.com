// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCtx } from '../js/ctx.js'

/** A controllable stand-in for a single AudioBufferSourceNode. */
class FakeSourceNode extends EventTarget {
  /** @param {FakeAudioContext} context */
  constructor(context) {
    super()
    this.context = context
    /** @type {any} */
    this.buffer = null
    this.started = false
    this.stopCalls = 0
    this.disconnectCalls = 0
    /** @type {any} */
    this.connectedTo = null
  }

  /** @param {any} dest */
  connect(dest) { this.connectedTo = dest }

  disconnect() { this.disconnectCalls++ }

  start() {
    if (this.started) throw new Error('start() called twice')
    this.started = true
  }

  // Real AudioScheduledSourceNode.stop() never throws, including on a node
  // that was never started or has already ended — matched here so the fake
  // exercises the same contract playSamples() is written against.
  stop() { this.stopCalls++ }

  /** Simulate the browser firing 'ended' once playback completes. */
  fireEnded() { this.dispatchEvent(new Event('ended')) }
}

class FakeAudioBuffer {
  /** @param {number} channels @param {number} length @param {number} sampleRate */
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels
    this.length = length
    this.sampleRate = sampleRate
    this._channels = Array.from({ length: channels }, () => new Float32Array(length))
  }

  /** @param {number} i */
  getChannelData(i) { return this._channels[i] }
}

/** A controllable stand-in for the browser's AudioContext. */
class FakeAudioContext {
  constructor() {
    this.sampleRate = 48000
    this.state = 'suspended'
    this.destination = { fake: 'destination' }
    this.resumeCalls = 0
    this.closeCalls = 0
    /** @type {FakeSourceNode[]} */
    this.sources = []
  }

  resume() {
    this.resumeCalls++
    this.state = 'running'
    return Promise.resolve()
  }

  close() {
    this.closeCalls++
    this.state = 'closed'
    return Promise.resolve()
  }

  /** @param {number} channels @param {number} length @param {number} sampleRate */
  createBuffer(channels, length, sampleRate) {
    return new FakeAudioBuffer(channels, length, sampleRate)
  }

  createBufferSource() {
    const node = new FakeSourceNode(this)
    this.sources.push(node)
    return node
  }
}

/** Minimal fake window: just enough for createCtx() to build a scope and an audio(). */
function fakeWin() {
  return /** @type {any} */ ({
    AudioContext: FakeAudioContext,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  })
}

/** Wait for the microtask queue to drain so promise chains inside ctx.js settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

test('playSamples resumes the AudioContext before playing', async () => {
  const win = fakeWin()
  const { ctx } = createCtx(win, 'test')
  ctx.playSamples(new Float32Array([0, 1, 0, -1]))
  await flush()
  const audio = /** @type {any} */ (ctx.audio())
  assert.equal(audio.resumeCalls, 1)
  assert.equal(audio.state, 'running')
})

test('playSamples builds a mono buffer at the context sample rate by default', async () => {
  const win = fakeWin()
  const { ctx } = createCtx(win, 'test')
  const samples = new Float32Array([0.1, 0.2, 0.3])
  ctx.playSamples(samples)
  await flush()
  const audio = /** @type {any} */ (ctx.audio())
  const node = audio.sources[0]
  assert.ok(node, 'a source node should have been created')
  assert.equal(node.buffer.numberOfChannels, 1)
  assert.equal(node.buffer.sampleRate, audio.sampleRate)
  // Compare against a Float32Array round-trip of the same literals, not the
  // literals themselves — Float32 storage cannot hold these exactly, and
  // that's a property of the buffer, not a bug in playSamples().
  assert.deepEqual([...node.buffer.getChannelData(0)], [...new Float32Array([0.1, 0.2, 0.3])])
})

test('playSamples sets an explicit sample rate on the buffer when passed', async () => {
  const win = fakeWin()
  const { ctx } = createCtx(win, 'test')
  ctx.playSamples(new Float32Array([0, 0]), 8000)
  await flush()
  const audio = /** @type {any} */ (ctx.audio())
  assert.equal(audio.sources[0].buffer.sampleRate, 8000)
})

test('playSamples connects the source straight to destination — no intermediate node', async () => {
  const win = fakeWin()
  const { ctx } = createCtx(win, 'test')
  ctx.playSamples(new Float32Array([0, 0]))
  await flush()
  const audio = /** @type {any} */ (ctx.audio())
  assert.equal(audio.sources[0].connectedTo, audio.destination)
})

test('done resolves when the node fires ended', async () => {
  const win = fakeWin()
  const { ctx } = createCtx(win, 'test')
  const { done } = ctx.playSamples(new Float32Array([0, 0]))
  await flush()
  const audio = /** @type {any} */ (ctx.audio())
  let settled = false
  done.then(() => { settled = true })
  assert.equal(settled, false)
  audio.sources[0].fireEnded()
  await flush()
  assert.equal(settled, true)
})

test('stop() halts the node, disconnects it, and settles done — without throwing', async () => {
  const win = fakeWin()
  const { ctx } = createCtx(win, 'test')
  const { done, stop } = ctx.playSamples(new Float32Array([0, 0]))
  await flush()
  const audio = /** @type {any} */ (ctx.audio())
  const node = audio.sources[0]

  let settled = false
  done.then(() => { settled = true })

  assert.doesNotThrow(() => stop())
  assert.equal(node.stopCalls, 1)
  assert.equal(node.disconnectCalls, 1)
  await flush()
  assert.equal(settled, true)
})

test('stop() called twice does not throw and does not double-stop the node', async () => {
  const win = fakeWin()
  const { ctx } = createCtx(win, 'test')
  const { stop } = ctx.playSamples(new Float32Array([0, 0]))
  await flush()
  const audio = /** @type {any} */ (ctx.audio())
  const node = audio.sources[0]

  assert.doesNotThrow(() => { stop(); stop() })
  assert.equal(node.stopCalls, 1, 'the second stop() call must be a no-op')
})

test('stop() after natural end does not throw and does not re-fire done', async () => {
  const win = fakeWin()
  const { ctx } = createCtx(win, 'test')
  const { done, stop } = ctx.playSamples(new Float32Array([0, 0]))
  await flush()
  const audio = /** @type {any} */ (ctx.audio())
  audio.sources[0].fireEnded()
  await flush()
  assert.doesNotThrow(() => stop())
  await assert.doesNotReject(done)
})

test('stop() called before resume() resolves prevents the node from ever starting', async () => {
  const win = fakeWin()
  const { ctx } = createCtx(win, 'test')
  const { done, stop } = ctx.playSamples(new Float32Array([0, 0]))
  // No flush yet — resume()'s promise has not settled, so no source node exists.
  stop()
  await flush()
  const audio = /** @type {any} */ (ctx.audio())
  assert.equal(audio.sources.length, 0, 'no node should be created after an early stop()')
  await assert.doesNotReject(done)
})

// ---------------------------------------------------------------------------
// Teardown harness: mount, start playback, tear the scope down mid-playback,
// and observe the source node and the done promise.
// ---------------------------------------------------------------------------

test('harness: tearing down the scope mid-playback stops the node and settles done', async () => {
  const win = fakeWin()
  const { ctx, dispose } = createCtx(win, 'test')

  /** @type {string[]} */
  const observed = []

  const { done } = ctx.playSamples(new Float32Array(100))
  done.then(() => observed.push('done settled'))

  await flush() // let audio.resume() resolve so the source node is created
  const audio = /** @type {any} */ (ctx.audio())
  const node = audio.sources[0]
  assert.ok(node, 'harness precondition: node must exist before teardown')
  observed.push(`before dispose: started=${node.started} stopCalls=${node.stopCalls}`)

  dispose() // simulate the instrument unmounting mid-playback
  observed.push(`after dispose: stopCalls=${node.stopCalls} disconnectCalls=${node.disconnectCalls}`)

  await flush()
  observed.push(`after flush: done in observed = ${observed.includes('done settled')}`)

  assert.equal(node.stopCalls, 1, 'scope teardown must stop the source node')
  assert.equal(node.disconnectCalls, 1, 'scope teardown must disconnect the source node')
  assert.equal(observed.includes('done settled'), true, 'done must settle on scope teardown')

  // Report exactly what was observed, in order.
  console.log('harness observed sequence:', observed)
})
