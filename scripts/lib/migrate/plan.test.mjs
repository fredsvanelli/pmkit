import test from 'node:test'
import assert from 'node:assert/strict'
import { RESERVE, orderParentsFirst, parentLoops, planBudget, planDigest, planMigration } from './plan.mjs'

const SOURCE = { system: 'local', path: '.issues', commit: '87cc467' }
const TARGET = { system: 'linear', workspace: 'acme', team: 'ACME' }

const issue = (id, created, parent) => ({ id, created, parent })
const record = (key, fields = {}, refs = {}) => ({ key, source: { id: key }, target: null, fields, refs, dropped: [] })

function snapshotOf({ issues = [], comments = [], epics = [] } = {}) {
  return { system: 'local', people: [], labels: [], epics, sprints: [], issues, links: [], comments }
}

function mappedOf(records, extra = {}) {
  return { records, losses: [], problems: [], people: [], readRequests: 10, ...extra }
}

const plan = (snapshot, mapped, options = {}) => planMigration({ direction: 'export', source: SOURCE, target: TARGET, snapshot, mapped, map: null, known: {}, ...options })

test('issues go parents first, then by creation time', () => {
  const issues = [issue('ISS-3', '2026-10-01T00:00:00Z', 'ISS-2'), issue('ISS-2', '2026-10-02T00:00:00Z', 'ISS-1'), issue('ISS-1', '2026-10-03T00:00:00Z')]
  assert.deepEqual(orderParentsFirst(issues).map((entry) => entry.id), ['ISS-1', 'ISS-2', 'ISS-3'])
  const result = plan(snapshotOf({ issues }), mappedOf({ issue: issues.map((entry) => record(entry.id)) }))
  assert.deepEqual(result.records.issue.map((entry) => entry.key), ['ISS-1', 'ISS-2', 'ISS-3'])
})

test('an epic parent does not hold an issue back', () => {
  const issues = [issue('ISS-2', '2026-10-02T00:00:00Z', 'EPC-1'), issue('ISS-1', '2026-10-03T00:00:00Z')]
  assert.deepEqual(orderParentsFirst(issues).map((entry) => entry.id), ['ISS-2', 'ISS-1'])
})

test('a parent loop is a problem and blocks the plan', () => {
  const issues = [issue('ISS-2', '2026-10-01T00:00:00Z', 'ISS-1'), issue('ISS-1', '2026-10-02T00:00:00Z', 'ISS-2'), issue('ISS-3', '2026-10-03T00:00:00Z', 'ISS-1')]
  assert.deepEqual(parentLoops(issues), [['ISS-1', 'ISS-2']])
  const result = plan(snapshotOf({ issues }), mappedOf({ issue: issues.map((entry) => record(entry.id)) }))
  assert.deepEqual(result.problems, [{ kind: 'issue', key: 'ISS-1', code: 'parent_loop', message: 'parent loop ISS-1 > ISS-2 > ISS-1' }])
})

test('comments go roots before replies, oldest first', () => {
  const comments = [
    { id: 'ISS-1/c3', issue: 'ISS-1', created: '2026-10-01T00:00:00Z', parent: 'ISS-1/c2' },
    { id: 'ISS-1/c2', issue: 'ISS-1', created: '2026-10-02T00:00:00Z', parent: null },
    { id: 'ISS-1/c1', issue: 'ISS-1', created: '2026-10-03T00:00:00Z', parent: null },
  ]
  const result = plan(snapshotOf({ comments }), mappedOf({ comment: comments.map((entry) => record(entry.id)) }))
  assert.deepEqual(result.records.comment.map((entry) => entry.key), ['ISS-1/c2', 'ISS-1/c1', 'ISS-1/c3'])
})

test('status updates go oldest first', () => {
  const epics = [{ id: 'EPC-1', updates: [{ id: 'EPC-1/b', at: '2026-10-02T00:00:00Z' }, { id: 'EPC-1/a', at: '2026-10-01T00:00:00Z' }] }]
  const result = plan(snapshotOf({ epics }), mappedOf({ update: [record('EPC-1/b'), record('EPC-1/a')] }))
  assert.deepEqual(result.records.update.map((entry) => entry.key), ['EPC-1/a', 'EPC-1/b'])
})

test('archive is the last step', () => {
  const result = plan(snapshotOf(), mappedOf({ archive: [record('ISS-1')], label: [record('x')] }))
  assert.deepEqual(result.steps.map((step) => step.kind), ['reads', 'label', 'epic', 'issue', 'link', 'comment', 'thread', 'update', 'archive'])
  assert.deepEqual(result.steps.map((step) => step.step), [0, 1, 2, 3, 4, 5, 6, 7, 8])
})

test('an import plans its own order and costs only its reads', () => {
  const result = planMigration({ direction: 'import', source: TARGET, target: SOURCE, snapshot: snapshotOf(), mapped: mappedOf({ member: [record('u1')], issue: [record('ACME-1')] }, { readRequests: 25 }), map: null, known: {} })
  assert.deepEqual(result.steps.map((step) => step.kind), ['reads', 'member', 'label', 'sprint', 'epic', 'update', 'issue', 'comment'])
  assert.equal(result.requests, 25)
  assert.ok(result.steps.slice(1).every((step) => step.requests === 0))
})

test('a record done in the map is a skip with its target', () => {
  const map = { file: '.pmkit/migrations/2026-10-28-export-linear.yaml', map: { records: { issue: { 'ISS-1': { state: 'done', uuid: 'u1', id: 'ACME-4' }, 'ISS-2': { state: 'sent', uuid: 'u2' } } } } }
  const result = plan(snapshotOf(), mappedOf({ issue: [record('ISS-1'), record('ISS-2')] }), { map })
  assert.deepEqual(result.records.issue.map(({ key, action, target }) => ({ key, action, target })), [
    { key: 'ISS-1', action: 'skip', target: 'ACME-4' },
    { key: 'ISS-2', action: 'create', target: null },
  ])
  assert.deepEqual(result.resume, { map: map.file, done: 1, sent: 1, failed: 0 })
})

test('refs to records of a finished map resolve as known', () => {
  const known = { issue: { 'ISS-1': { uuid: 'u1', id: 'ACME-1' } } }
  const result = plan(snapshotOf(), mappedOf({ issue: [record('ISS-9', {}, { parentId: { kind: 'issue', key: 'ISS-1' } })] }), { known })
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.records.issue.map((entry) => [entry.key, entry.action]), [['ISS-9', 'create']])
  assert.equal(result.steps.find((step) => step.kind === 'issue').requests, 1)
})

test('a record of a finished map is a skip', () => {
  const known = { issue: { 'ISS-1': { uuid: 'u1', id: 'ACME-1' } } }
  const result = plan(snapshotOf(), mappedOf({ issue: [record('ISS-1')] }), { known })
  assert.deepEqual(result.records.issue.map(({ action, target }) => ({ action, target })), [{ action: 'skip', target: 'ACME-1' }])
})

test('a ref to a record the plan cannot reach is a problem', () => {
  const result = plan(snapshotOf(), mappedOf({ issue: [record('ISS-9', {}, { parentId: { kind: 'issue', key: 'ISS-1' } })] }))
  assert.deepEqual(result.problems, [{ kind: 'issue', key: 'ISS-9', code: 'missing_ref', message: 'ISS-9 names issue ISS-1, which the migration does not hold' }])
})

function bigMapped() {
  const many = (kind, n) => Array.from({ length: n }, (_, i) => record(`${kind}-${i + 1}`))
  return mappedOf({ issue: many('ISS', 165), epic: many('EPC', 10), label: many('L', 2), link: many('LNK', 148), comment: many('C', 88), thread: many('T', 3), update: [], archive: [] })
}

test('the request count follows the spec formula', () => {
  const result = plan(snapshotOf(), bigMapped())
  assert.equal(result.requests, 426)
  assert.deepEqual(result.steps.map(({ kind, records, requests }) => [kind, records, requests]), [
    ['reads', null, 10], ['label', 2, 2], ['epic', 10, 10], ['issue', 165, 165], ['link', 148, 148],
    ['comment', 88, 88], ['thread', 3, 3], ['update', 0, 0], ['archive', 0, 0],
  ])
})

test('sent entries add one check read per 100 per kind', () => {
  const issues = Array.from({ length: 150 }, (_, i) => record(`ISS-${i + 1}`))
  const entries = Object.fromEntries(issues.map((entry, i) => [entry.key, { state: 'sent', uuid: `u${i}` }]))
  const result = plan(snapshotOf(), mappedOf({ issue: issues }), { map: { file: 'f', map: { records: { issue: entries } } } })
  assert.equal(result.steps[0].requests, 12)
  assert.equal(result.requests, 162)
})

test('planBudget says where the run stops', () => {
  const result = plan(snapshotOf(), bigMapped())
  assert.deepEqual(planBudget(result, { requests: { remaining: 300, resetAt: '2026-10-28T21:06:00Z' }, complexity: { remaining: 2900000 } }), {
    requests: 426, remaining: 300, reserve: RESERVE.requests, resetAt: '2026-10-28T21:06:00Z', fits: false, stopsAfter: 200,
  })
  assert.equal(planBudget(result, { requests: { remaining: 2488, resetAt: '2026-10-28T21:06:00Z' } }).fits, true)
  assert.equal(planBudget(result, { requests: { remaining: 2488 }, complexity: { remaining: 10000 } }).fits, false)
})

test('planBudget without rate headers leaves the budget unknown', () => {
  assert.deepEqual(planBudget(plan(snapshotOf(), bigMapped()), null), { requests: 426, remaining: null, reserve: 100, resetAt: null, fits: null, stopsAfter: null })
})

test('the digest changes when a record changes and not when the budget does', () => {
  const a = plan(snapshotOf(), mappedOf({ issue: [record('ISS-1', { title: 'a' })] }))
  const b = plan(snapshotOf(), mappedOf({ issue: [record('ISS-1', { title: 'b' })] }))
  const c = plan(snapshotOf(), mappedOf({ issue: [record('ISS-1', { title: 'a' })] }, { readRequests: 30 }))
  assert.match(a.digest, /^sha256:[0-9a-f]{64}$/)
  assert.notEqual(a.digest, b.digest)
  assert.equal(a.digest, c.digest)
  assert.equal(planDigest(a), a.digest)
})

test('losses and problems from the mapper pass through unchanged', () => {
  const losses = [{ what: 'history', count: 3, ids: ['ISS-1'], why: 'Linear history is written by Linear only' }]
  const problems = [{ kind: 'issue', key: 'ISS-1', code: 'no_state', message: 'no state' }]
  const people = [{ id: 'fred', match: 'u1' }]
  const result = plan(snapshotOf(), mappedOf({}, { losses, problems, people }))
  assert.deepEqual(result.losses, losses)
  assert.deepEqual(result.problems, problems)
  assert.deepEqual(result.people, people)
})
