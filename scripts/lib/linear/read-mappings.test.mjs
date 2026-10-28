import assert from 'node:assert/strict'
import test from 'node:test'
import { readMappings } from './read-mappings.mjs'

const read = (mappings) => readMappings({ mappings })

test('status keeps categories, drops blocked and none', () => {
  const found = read({ status: { in_review: 'In Review', blocked: 'Blocked', triage: 'none' } })
  assert.deepEqual(found.status, { in_review: 'In Review' })
  assert.deepEqual(found.statusNone, ['triage'])
  assert.equal(found.blockedStatus, 'Blocked')
})

test('blocked mapped to none reads as no blocked status', () => {
  assert.equal(read({ status: { blocked: 'none' } }).blockedStatus, null)
})

test('types is the map in key order, without none', () => {
  const found = read({ types: { feature: 'Feature', bug: 'Bug', chore: 'none' } })
  assert.deepEqual(found.types, { feature: 'Feature', bug: 'Bug' })
  assert.deepEqual(Object.keys(found.types), ['feature', 'bug'])
})

test('typeOf picks the first mapped type, in map order, whose label the issue has', () => {
  const { typeOf } = read({ types: { feature: 'Feature', bug: 'Bug' } })
  assert.equal(typeOf(['Docs', 'Bug']), 'bug')
  assert.equal(typeOf(['Bug', 'Feature']), 'feature')
  assert.equal(typeOf(['Docs']), null)
  assert.equal(readMappings({}).typeOf(['Bug']), null)
})

test('a types value that is not a map of names reads as absent with a problem', () => {
  for (const types of [['Bug'], 'Bug', { bug: 3 }, { bug: '' }, null]) {
    const found = read({ types })
    assert.deepEqual(found.types, {})
    assert.deepEqual(found.problems, ['mappings.types must be a map from a pmkit type to a Linear label name'])
  }
})

test('the estimate is native only when mapped to native', () => {
  assert.equal(read({}).estimate, null)
  assert.equal(read({ fields: { estimate: 'native' } }).estimate, 'native')
  assert.equal(read({ fields: { estimate: 'none' } }).estimate, null)
  assert.equal(read({ fields: { estimate: 'Size' } }).estimate, null)
})

test('no mappings gives empty values', () => {
  const { typeOf, ...rest } = readMappings({})
  assert.equal(typeof typeOf, 'function')
  assert.deepEqual(rest, { status: {}, statusNone: [], blockedStatus: null, types: {}, estimate: null, problems: [] })
})
