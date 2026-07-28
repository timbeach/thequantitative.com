// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRoute, hrefFor } from '../js/router.js'

test('empty, bare hash, and root all resolve to the shelf', () => {
  assert.deepEqual(parseRoute(''), { name: 'shelf' })
  assert.deepEqual(parseRoute('#'), { name: 'shelf' })
  assert.deepEqual(parseRoute('#/'), { name: 'shelf' })
})

test('instrument route extracts the id', () => {
  assert.deepEqual(parseRoute('#/i/level'), { name: 'instrument', id: 'level' })
  assert.deepEqual(parseRoute('#/i/db-meter'), { name: 'instrument', id: 'db-meter' })
})

test('about route', () => {
  assert.deepEqual(parseRoute('#/about'), { name: 'about' })
})

test('unknown hashes resolve to not-found, carrying the original', () => {
  assert.deepEqual(parseRoute('#/nope'), { name: 'not-found', hash: '/nope' })
})

test('instrument ids are restricted to lowercase kebab — no path traversal', () => {
  assert.equal(parseRoute('#/i/../../etc/passwd').name, 'not-found')
  assert.equal(parseRoute('#/i/Level').name, 'not-found')
  assert.equal(parseRoute('#/i/a b').name, 'not-found')
  assert.equal(parseRoute('#/i/').name, 'not-found')
})

test('trailing slash on an instrument route is not a different route', () => {
  assert.equal(parseRoute('#/i/level/').name, 'not-found')
})

test('hrefFor round-trips through parseRoute', () => {
  /** @type {import('../js/types.js').Route[]} */
  const routes = [
    { name: 'shelf' },
    { name: 'about' },
    { name: 'instrument', id: 'level' },
  ]
  for (const r of routes) {
    assert.deepEqual(parseRoute(hrefFor(r)), r)
  }
})
