import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ERROR_CODES, PmkitError, isPmkitError } from './lib/errors.mjs'
import { CATEGORIES, EVENT_OPS, LINK_KINDS, TERMINAL, compareTimes, isBlocked, isCategory } from './lib/model.mjs'

test('PmkitError carries a code, a message and a next step', () => {
  const error = new PmkitError('NOT_FOUND', 'no ISS-1', 'Run pmkit issues list', { id: 'ISS-1' })
  assert.equal(error.code, 'NOT_FOUND')
  assert.equal(error.message, 'no ISS-1')
  assert.equal(error.nextStep, 'Run pmkit issues list')
  assert.deepEqual(error.details, { id: 'ISS-1' })
  assert.ok(error instanceof Error)
  assert.ok(isPmkitError(error))
  assert.ok(!isPmkitError(new Error('x')))
})

test('PmkitError rejects an unknown code', () => {
  assert.throws(() => new PmkitError('NOPE', 'x', 'y'), TypeError)
})

test('ERROR_CODES lists the eight codes', () => {
  assert.deepEqual(ERROR_CODES, ['NOT_CONFIGURED', 'NOT_FOUND', 'NOT_SUPPORTED', 'INVALID_INPUT', 'CONFLICT', 'AUTH', 'RATE_LIMITED', 'UPSTREAM'])
})

test('the constants match the common model', () => {
  assert.deepEqual(CATEGORIES, ['triage', 'backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'])
  assert.deepEqual(TERMINAL, ['done', 'canceled'])
  assert.deepEqual(EVENT_OPS, ['create', 'update', 'move', 'assign', 'link', 'unlink', 'comment', 'log_time', 'archive'])
  assert.deepEqual(LINK_KINDS, ['blocks', 'related', 'duplicate'])
  assert.ok(isCategory('todo'))
  assert.ok(!isCategory('blocked'))
})

const issue = (id, category, blockedBy = []) => ({ id, status: { name: category, category }, blockedBy })

test('isBlocked follows the categories of the blockers', () => {
  const byId = new Map([issue('A', 'todo'), issue('B', 'done'), issue('C', 'canceled')].map((i) => [i.id, i]))
  assert.equal(isBlocked(issue('X', 'todo'), byId), false)
  assert.equal(isBlocked(issue('X', 'todo', ['A']), byId), true)
  assert.equal(isBlocked(issue('X', 'todo', ['B', 'C']), byId), false)
  assert.equal(isBlocked(issue('X', 'todo', ['B', 'A']), byId), true)
  assert.equal(isBlocked(issue('X', 'todo', ['GONE']), byId), true)
  assert.equal(isBlocked({ id: 'X', status: { category: 'todo' } }, byId), false)
})

test('compareTimes orders by instant across second and millisecond precision', () => {
  assert.equal(compareTimes('2026-10-23T12:00:00Z', '2026-10-23T12:00:00.123Z'), -1)
  assert.equal(compareTimes('2026-10-23T12:00:00.999Z', '2026-10-23T12:00:01Z'), -1)
  assert.equal(compareTimes('2026-10-23T12:00:00.000Z', '2026-10-23T12:00:00Z'), 0)
  assert.equal(compareTimes(undefined, '2026-10-23T12:00:00Z'), -1)
  assert.equal(compareTimes('not a time', undefined), 0)
})
