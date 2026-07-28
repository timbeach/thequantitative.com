// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REGISTRY, findEntry } from '../js/registry.js'
import { parseRoute } from '../js/router.js'
import { escapeHtml } from '../js/util.js'

test('every entry has the full metadata set', () => {
  for (const e of REGISTRY) {
    assert.equal(typeof e.id, 'string', 'id')
    assert.equal(typeof e.name, 'string', 'name')
    assert.ok(['world', 'ideas'].includes(e.category), `category of ${e.id}`)
    assert.equal(typeof e.blurb, 'string', 'blurb')
    assert.ok(Array.isArray(e.needs), 'needs')
    assert.equal(typeof e.load, 'function', 'load')
  }
})

test('ids are unique', () => {
  const ids = REGISTRY.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('every id survives the router — catches a typo that would 404 its own card', () => {
  for (const e of REGISTRY) {
    assert.deepEqual(parseRoute(`#/i/${e.id}`), { name: 'instrument', id: e.id })
  }
})

test('findEntry resolves known ids and rejects unknown ones', () => {
  assert.equal(findEntry('level')?.id, 'level')
  assert.equal(findEntry('does-not-exist'), undefined)
})

test('v0 ships the spirit level', () => {
  const level = findEntry('level')
  assert.ok(level)
  assert.deepEqual(level.needs, ['motion'])
  assert.equal(level.category, 'world')
})

test('escapeHtml neutralises markup in metadata', () => {
  assert.equal(escapeHtml('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;')
  assert.equal(escapeHtml('a & b'), 'a &amp; b')
  assert.equal(escapeHtml('"q" \'p\''), '&quot;q&quot; &#39;p&#39;')
})
