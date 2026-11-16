import assert from 'node:assert/strict'
import test from 'node:test'
import { isMutation, operationName } from './lib/graphql.mjs'

test('isMutation finds a mutation after a fragment', () => {
  assert.equal(isMutation('fragment F on Issue { id } mutation M { x { ...F } }'), true)
})

test('isMutation skips a mutation keyword inside a string or a comment', () => {
  assert.equal(isMutation('query Q { search(query: "mutation") { id } } # mutation'), false)
})

test('isMutation counts an unreadable document as a mutation', () => {
  assert.equal(isMutation('query Q { viewer { login }'), true)
  assert.equal(isMutation('query Q { s(q: "open) }'), true)
})

test('isMutation is false for an anonymous query', () => {
  assert.equal(isMutation('{ viewer { login } }'), false)
})

test('operationName skips fragments and returns null for an anonymous query', () => {
  assert.equal(operationName('fragment F on Issue { id } query Issues { x }'), 'Issues')
  assert.equal(operationName('{ viewer { login } }'), null)
})
