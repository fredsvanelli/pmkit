import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeRaw } from '../../fake-linear-nodes.mjs'
import { makeContext } from './issues.mjs'
import { finishSearch, translateFilter } from './filter.mjs'

const raw = await fakeRaw()
const VIEWER = { id: 'user-1', name: 'Test User' }
const mappings = { status: { in_review: 'In Review' }, types: { bug: 'Bug', feature: 'Feature' } }
const context = makeContext(raw, { tracker: { system: 'linear', scope: { workspace: 'acme', team: 'ACME' } }, mappings }, VIEWER)
const workspaceContext = makeContext(raw, { tracker: { system: 'linear', scope: { workspace: 'acme' } }, mappings }, VIEWER)
const priorities = ['urgent', 'high', 'medium', 'low']
const clauses = (filter, ctx = context) => translateFilter(filter, ctx).variables.filter.and

test('scope: the team key when set, nothing for the workspace', () => {
  assert.deepEqual(clauses({}), [{ team: { key: { eq: 'ACME' } } }])
  assert.deepEqual(clauses({}, workspaceContext), [])
})
test('text', () => assert.deepEqual(clauses({ text: 'Drop' })[1], { or: [{ title: { containsIgnoreCase: 'Drop' } }, { description: { containsIgnoreCase: 'Drop' } }] }))
test('categories become the state ids of the scoped team', () => {
  assert.deepEqual(clauses({ categories: ['in_review'] })[1], { state: { id: { in: ['state-4'] } } })
  assert.deepEqual(clauses({ categories: ['canceled'] })[1], { state: { id: { in: ['state-9', 'state-10'] } } })
})
test('categories with no state give empty', () => {
  assert.equal(translateFilter({ categories: ['triage'] }, context).empty, true)
  assert.equal(translateFilter({ categories: ['done'] }, context).empty, false)
})
test('types become their label names', () => assert.deepEqual(clauses({ types: ['bug', 'feature'] })[1], { labels: { some: { name: { in: ['Bug', 'Feature'] } } } }))
test('assignee id, me and none', () => {
  assert.deepEqual(clauses({ assignee: 'user-2' })[1], { assignee: { id: { eq: 'user-2' } } })
  assert.deepEqual(clauses({ assignee: 'me' })[1], { assignee: { id: { eq: 'user-1' } } })
  assert.deepEqual(clauses({ assignee: 'none' })[1], { assignee: { null: true } })
})
test('labels, one clause each', () => assert.deepEqual(clauses({ labels: ['Docs', 'S'] }).slice(1), [{ labels: { some: { name: { eq: 'Docs' } } } }, { labels: { some: { name: { eq: 'S' } } } }]))
test('parent by identifier; anything else is NOT_SUPPORTED', () => {
  assert.deepEqual(clauses({ parent: 'acme-2' })[1], { parent: { id: { eq: 'ACME-2' } } })
  assert.throws(() => translateFilter({ parent: 'EPC-1x' }, context), { code: 'NOT_SUPPORTED' })
})
test('blocked true narrows on the server and checks on the client; false is client only', () => {
  const yes = translateFilter({ blocked: true }, context)
  assert.deepEqual(yes.variables.filter.and[1], { hasBlockedByRelations: { eq: true } })
  assert.deepEqual(yes.clientSteps, ['blocked'])
  const no = translateFilter({ blocked: false }, context)
  assert.equal(no.variables.filter.and.length, 1)
  assert.deepEqual(no.clientSteps, ['blocked'])
})
test('updated before and after', () => assert.deepEqual(clauses({ updatedBefore: '2026-10-02', updatedAfter: '2026-10-01' }).slice(1),
  [{ updatedAt: { lt: '2026-10-02' } }, { updatedAt: { gt: '2026-10-01' } }]))
test('archived sets includeArchived', () => {
  assert.equal(translateFilter({ archived: true }, context).variables.includeArchived, true)
  assert.equal(translateFilter({}, context).variables.includeArchived, false)
})
test('sort is always createdAt ascending on the server; another sort is a client step', () => {
  assert.deepEqual(translateFilter({ sort: 'priority' }, context).variables.sort, [{ createdAt: { order: 'Ascending' } }])
  assert.deepEqual(translateFilter({ sort: 'priority' }, context).clientSteps, ['sort'])
  assert.deepEqual(translateFilter({ sort: 'created' }, context).clientSteps, [])
})
test('serverLimit only for created order without client steps', () => {
  assert.equal(translateFilter({ limit: 5 }, context).serverLimit, 5)
  assert.equal(translateFilter({ limit: 5, sort: 'created' }, context).serverLimit, 5)
  assert.equal(translateFilter({ limit: 5, sort: 'priority' }, context).serverLimit, undefined)
  assert.equal(translateFilter({ limit: 5, blocked: false }, context).serverLimit, undefined)
  assert.equal(translateFilter({ limit: 0 }, context).serverLimit, undefined)
  assert.equal(translateFilter({}, context).serverLimit, undefined)
})
test('release is NOT_SUPPORTED', () => {
  assert.throws(() => translateFilter({ release: '1.0' }, context), { code: 'NOT_SUPPORTED' })
})
const cycling = { ...context, cyclesEnabled: true }
const NO_CYCLES = { ...context, cyclesEnabled: false }
test('sprint: a cycle number, current and none become cycle clauses with no client step', () => {
  assert.deepEqual(clauses({ sprint: '12' }, cycling)[1], { cycle: { number: { eq: 12 } } })
  assert.deepEqual(clauses({ sprint: 'current' }, cycling)[1], { cycle: { isActive: { eq: true } } })
  assert.deepEqual(clauses({ sprint: 'none' }, cycling)[1], { cycle: { null: true } })
  for (const sprint of ['12', 'current', 'none']) {
    const translated = translateFilter({ sprint, limit: 3 }, cycling)
    assert.deepEqual(translated.clientSteps, [], sprint)
    assert.equal(translated.serverLimit, 3, sprint)
  }
})
test('sprint with cycles off: a number and current are NOT_SUPPORTED, none adds no clause', () => {
  for (const sprint of ['12', 'current']) {
    assert.throws(() => translateFilter({ sprint }, NO_CYCLES), {
      code: 'NOT_SUPPORTED', message: 'team ACME has cycles turned off', nextStep: "Turn on cycles in the team's settings in Linear",
    })
  }
  assert.deepEqual(clauses({ sprint: 'none' }, NO_CYCLES), [{ team: { key: { eq: 'ACME' } } }])
})
test('a malformed sprint value is INVALID_INPUT', () => {
  for (const sprint of ['abc', '0', '1.5', '']) assert.throws(() => translateFilter({ sprint }, cycling), { code: 'INVALID_INPUT' }, sprint)
})
test('several keys join with and', () => assert.equal(clauses({ text: 'x', assignee: 'none', labels: ['Docs'] }).length, 4))

const row = (id, fields, blocked) => ({ issue: { id, created: `2026-10-0${id.slice(-1)}T00:00:00.000Z`, updated: '2026-10-09T00:00:00.000Z', ...fields }, blocked })

test('finishSearch applies blocked, the sort and the limit', () => {
  const rows = [row('ACME-1', { priority: 'low' }, true), row('ACME-2', { priority: 'urgent' }, false), row('ACME-3', { priority: 'high' }, true)]
  assert.deepEqual(finishSearch(rows, { blocked: true }, { priorities }).map((i) => i.id), ['ACME-1', 'ACME-3'])
  assert.deepEqual(finishSearch(rows, { blocked: false }, { priorities }).map((i) => i.id), ['ACME-2'])
  assert.deepEqual(finishSearch(rows, { sort: 'priority', limit: 1 }, { priorities }).map((i) => i.id), ['ACME-2'])
  assert.deepEqual(finishSearch(rows, {}, { priorities }).map((i) => i.id), ['ACME-1', 'ACME-2', 'ACME-3'])
})
