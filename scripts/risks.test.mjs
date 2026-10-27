import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blockedIssues, needsPrLookup, prsByBranch, stalledIssues } from './lib/risks.mjs'

const TODAY = '2026-10-26' // a Monday
const issue = (id, category, extra = {}) => ({
  id, title: `Title ${id}`, status: { name: category, category }, blockedBy: [], archived: false,
  created: '2026-10-01T00:00:00Z', updated: '2026-10-01T00:00:00Z', ...extra,
})
const ev = (at) => ({ at, by: 'fred', op: 'update' })
const byIdOf = (list) => new Map(list.map((item) => [item.id, item]))
const stalledOpts = (extra = {}) => ({ eventsByIssue: {}, openPrsByBranch: {}, closedPrsByBranch: {}, today: TODAY, stuckBusinessDays: 3, ...extra })
const blockedOpts = (list, extra = {}) => ({ byId: byIdOf(list), problemsById: new Map(), activeSprintId: null, ...extra })

test('blockedIssues names each open blocker, a missing one and an unreadable one', () => {
  const list = [
    issue('A', 'in_progress', { blockedBy: ['B', 'C', 'D', 'E'], assignee: 'fred', estimate: 3 }),
    issue('B', 'todo'),
    issue('C', 'done'),
  ]
  const result = blockedIssues(list, blockedOpts(list, { problemsById: new Map([['E', 'CONFLICT']]) }))
  assert.deepEqual(result, [{
    id: 'A', title: 'Title A', status: 'in_progress', assignee: 'fred', estimate: 3,
    blockers: [{ id: 'B', category: 'todo' }, { id: 'D', error: 'NOT_FOUND' }, { id: 'E', error: 'CONFLICT' }],
  }])
})

test('blockedIssues keeps a backlog issue only when it is in the active sprint', () => {
  const list = [
    issue('F', 'backlog', { sprint: 'S1', blockedBy: ['B'] }),
    issue('G', 'backlog', { blockedBy: ['B'] }),
    issue('B', 'todo'),
  ]
  assert.deepEqual(blockedIssues(list, blockedOpts(list, { activeSprintId: 'S1' })).map((row) => row.id), ['F'])
  assert.deepEqual(blockedIssues(list, blockedOpts(list, { activeSprintId: null })).map((row) => row.id), [])
})

test('blockedIssues leaves out a done, an archived and a fully unblocked issue', () => {
  const list = [
    issue('H', 'done', { blockedBy: ['B'] }),
    issue('I', 'in_progress', { archived: true, blockedBy: ['B'] }),
    issue('J', 'in_progress', { blockedBy: ['C'] }),
    issue('B', 'todo'),
    issue('C', 'canceled'),
  ]
  assert.deepEqual(blockedIssues(list, blockedOpts(list)), [])
  const withK = [...list, issue('K', 'todo', { blockedBy: ['B'] })]
  const [row] = blockedIssues(withK, blockedOpts(withK))
  assert.equal(row.id, 'K')
  assert.equal(row.assignee, null)
  assert.equal(row.estimate, null)
})

test('stalledIssues lists an issue idle for more than N business days and not one idle for N', () => {
  const list = [issue('S', 'in_progress'), issue('T', 'in_review')]
  const eventsByIssue = { S: [ev('2026-10-20T10:00:00Z')], T: [ev('2026-10-21T10:00:00Z')] }
  assert.deepEqual(stalledIssues(list, stalledOpts({ eventsByIssue })), [{
    id: 'S', title: 'Title S', status: 'in_progress', assignee: null, estimate: null,
    lastActivity: '2026-10-20T10:00:00Z', idleBusinessDays: 4, reason: 'idle', pr: null,
  }])
})

test('stalledIssues counts across a weekend', () => {
  const list = [issue('U', 'in_progress')]
  assert.deepEqual(stalledIssues(list, stalledOpts({ eventsByIssue: { U: [ev('2026-10-23T18:00:00Z')] } })), [])
})

test('stalledIssues counts the open pull request of the branch as activity', () => {
  const list = [issue('V', 'in_progress', { branch: 'feat-v' })]
  const eventsByIssue = { V: [ev('2026-10-14T10:00:00Z')] }
  const recent = { 'feat-v': { number: 5, updatedAt: '2026-10-23T10:00:00Z' } }
  assert.deepEqual(stalledIssues(list, stalledOpts({ eventsByIssue, openPrsByBranch: recent })), [])
  const old = { 'feat-v': { number: 5, updatedAt: '2026-10-15T10:00:00Z' } }
  const [row] = stalledIssues(list, stalledOpts({ eventsByIssue, openPrsByBranch: old }))
  assert.equal(row.lastActivity, '2026-10-15T10:00:00Z')
  assert.equal(row.idleBusinessDays, 7)
  assert.equal(row.pr, 5)
})

test('stalledIssues lists pr_merged and pr_closed whatever the idle days', () => {
  const list = [issue('M', 'in_review', { branch: 'm' }), issue('C2', 'in_review', { branch: 'c' }), issue('P', 'in_progress', { branch: 'p' })]
  const recent = [ev('2026-10-26T09:00:00Z')]
  const eventsByIssue = { M: recent, C2: recent, P: recent }
  const closedPrsByBranch = {
    m: { number: 7, state: 'MERGED', mergedAt: '2026-10-25T10:00:00Z' },
    c: { number: 8, state: 'CLOSED', mergedAt: null },
    p: { number: 9, state: 'MERGED', mergedAt: '2026-10-25T10:00:00Z' },
  }
  const rows = stalledIssues(list, stalledOpts({ eventsByIssue, closedPrsByBranch }))
  assert.deepEqual(rows.map((row) => [row.id, row.reason, row.pr, row.idleBusinessDays]), [['M', 'pr_merged', 7, 0], ['C2', 'pr_closed', 8, 0]])
})

test('stalledIssues uses updated when an issue has no events', () => {
  const list = [issue('W', 'in_progress', { updated: '2026-10-20T00:00:00Z' })]
  const [row] = stalledIssues(list, stalledOpts())
  assert.equal(row.lastActivity, '2026-10-20T00:00:00Z')
  assert.equal(row.idleBusinessDays, 4)
})

test('stalledIssues takes the newest event by instant, not the last line', () => {
  const list = [issue('X', 'in_progress')]
  const eventsByIssue = { X: [ev('2026-10-23T10:00:00Z'), ev('2026-10-14T10:00:00Z')] }
  assert.deepEqual(stalledIssues(list, stalledOpts({ eventsByIssue })), [])
})

test('stalledIssues leaves out todo, done and archived issues', () => {
  const list = [issue('Y1', 'todo'), issue('Y2', 'done'), issue('Y3', 'in_progress', { archived: true })]
  const old = [ev('2026-10-01T10:00:00Z')]
  assert.deepEqual(stalledIssues(list, stalledOpts({ eventsByIssue: { Y1: old, Y2: old, Y3: old } })), [])
})

test('prsByBranch keeps the newest pull request of a branch', () => {
  const map = prsByBranch([
    { number: 1, headRefName: 'b', updatedAt: '2026-10-20T10:00:00Z' },
    { number: 2, headRefName: 'b', updatedAt: '2026-10-22T10:00:00Z' },
    { number: 3, headRefName: 'c', updatedAt: '2026-10-01T10:00:00Z' },
  ])
  assert.equal(map.b.number, 2)
  assert.equal(map.c.number, 3)
  const reversed = prsByBranch([
    { number: 2, headRefName: 'b', updatedAt: '2026-10-22T10:00:00Z' },
    { number: 1, headRefName: 'b', updatedAt: '2026-10-20T10:00:00Z' },
  ])
  assert.equal(reversed.b.number, 2)
})

test('needsPrLookup returns idle in_review issues with a branch and no open pull request', () => {
  const old = [ev('2026-10-20T10:00:00Z')]
  const list = [
    issue('R1', 'in_review', { branch: 'r1' }),
    issue('R2', 'in_review', { branch: 'r2' }),
    issue('R3', 'in_review'),
    issue('R4', 'in_review', { branch: 'r4' }),
    issue('R5', 'in_progress', { branch: 'r5' }),
  ]
  const eventsByIssue = { R1: old, R2: old, R3: old, R4: [ev('2026-10-26T10:00:00Z')], R5: old }
  const openPrsByBranch = { r2: { number: 2, headRefName: 'r2', updatedAt: '2026-10-01T10:00:00Z' } }
  const result = needsPrLookup(list, { eventsByIssue, openPrsByBranch, today: TODAY, stuckBusinessDays: 3 })
  assert.deepEqual(result.map((item) => item.id), ['R1'])
})
