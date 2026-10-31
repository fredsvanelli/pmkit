import { test } from 'node:test'
import assert from 'node:assert/strict'
import { delegationOf, prSummary, prText } from './lib/track-agents.mjs'
import { parseDelegation } from './lib/delegation.mjs'

const rec = (agent) => `Delegated to ${agent} by fred, to run locally.\r\n\r\n## Instructions`
const c = (id, created, body, parent) => ({ id, created, body, ...(parent ? { parent } : {}) })

test('parseDelegation ignores trailing space and a carriage return (PMK-181)', () => {
  const line = 'Delegated to agent:claude by fred, to run locally.'
  const expected = { agent: 'agent:claude', by: 'fred', run: 'local' }
  for (const body of [`${line} `, `${line}\r\n\r\nbody`, `${line}  \r`]) assert.deepEqual(parseDelegation(body), expected)
})

test('the newest root delegation wins and replies are ignored', () => {
  const comments = [c('a', '2026-01-01', rec('agent:one')), c('b', '2026-01-02', rec('agent:two')), c('r', '2026-01-03', rec('agent:one'), 'b')]
  const d = delegationOf(comments, 'agent:two')
  assert.equal(d.state, 'current')
  assert.equal(d.comment, 'b')
})

test('a record that names another agent is stale, and no record is none or unknown', () => {
  assert.equal(delegationOf([c('a', '1', rec('agent:one'))], 'agent:two').state, 'stale')
  assert.equal(delegationOf([c('a', '1', 'hello')], 'agent:two').state, 'none')
  assert.equal(delegationOf([], 'agent:two', { incomplete: true }).state, 'unknown')
})

test('prSummary names draft, open, merged and closed', () => {
  const found = { blocked: true, blocking: [{ message: 'a draft' }], unknown: [], unchecked: [] }
  assert.equal(prSummary({ number: 1, state: 'OPEN', isDraft: true }, found).state, 'draft')
  assert.equal(prSummary({ number: 1, state: 'OPEN' }, found).state, 'open')
  assert.equal(prSummary({ number: 1, state: 'MERGED' }, found).state, 'merged')
  assert.equal(prSummary({ number: 1, state: 'CLOSED' }, found).state, 'closed')
})

test('prText says blocked, unknown blockers, and the missing pieces', () => {
  const pr = { number: 3, state: 'open', blocked: null, blocking: [] }
  assert.equal(prText({ pr }), '#3 open, blockers not verified')
  assert.equal(prText({ pr: { ...pr, blocked: true, blocking: ['x', 'y'] } }), '#3 open, blocked: x; y')
  assert.equal(prText({ pr: { state: 'no_branch' } }), 'no branch recorded')
  assert.equal(prText({ pr: { state: 'no_pr' }, branch: 'b' }), 'no pull request for b')
  assert.equal(prText({ pr: null }), '')
})
