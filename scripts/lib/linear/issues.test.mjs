import assert from 'node:assert/strict'
import test from 'node:test'
import { conn, fakeRaw, inv, lab, node, rel } from '../../fake-linear-nodes.mjs'
import { blockedOpen, buildDescription, isIssueId, issueKey, makeContext, parseDescription, priorityOf, stateCategory, toIssue } from './issues.mjs'

test('isIssueId accepts identifiers only', () => {
  for (const id of ['ACME-1', 'acme-12', 'A_B2-3']) assert.equal(isIssueId(id), true, id)
  for (const id of ['ACME', 'ACME-', '1-2', 'ACME-1a', '00000000-0000-0000-0000-000000000000', '', null]) assert.equal(isIssueId(id), false, String(id))
  assert.equal(issueKey('acme-1'), 'ACME-1')
  assert.equal(issueKey('ACMEOIL-1'), 'ACMEOIL-1')
})

test('priorities map both ways', () => {
  assert.deepEqual([1, 2, 3, 4].map(priorityOf), ['urgent', 'high', 'medium', 'low'])
  assert.equal(priorityOf(0), undefined)
  assert.equal(priorityOf(null), undefined)
})

test('the criteria section parses -, *, [x] and [X], and keeps other lines in place', () => {
  const text = 'Intro\n\n## Acceptance criteria\n\n- [ ] one\n* [x] two\nA note\n- [X] three\n\n## Notes\n\nTail'
  assert.deepEqual(parseDescription(text), {
    description: 'Intro\n\nA note\n\n## Notes\n\nTail',
    acceptanceCriteria: [{ text: 'one', done: false }, { text: 'two', done: true }, { text: 'three', done: true }],
  })
})

test('Windows line ends parse the same', () => {
  assert.deepEqual(parseDescription('Body\r\n\r\n## Acceptance criteria\r\n\r\n- [ ] one'), { description: 'Body', acceptanceCriteria: [{ text: 'one', done: false }] })
})

test('null and a description without the section', () => {
  assert.deepEqual(parseDescription(null), { description: '', acceptanceCriteria: [] })
  assert.deepEqual(parseDescription('  Body  '), { description: 'Body', acceptanceCriteria: [] })
})

test('buildDescription writes the section and parses back unchanged', () => {
  const criteria = [{ text: 'one', done: false }, { text: 'two', done: true }]
  assert.equal(buildDescription('Body', criteria), 'Body\n\n## Acceptance criteria\n\n- [ ] one\n- [x] two')
  assert.equal(buildDescription('Body', []), 'Body')
  assert.equal(buildDescription('', criteria), '## Acceptance criteria\n\n- [ ] one\n- [x] two')
  assert.deepEqual(parseDescription(buildDescription('Body', criteria)), { description: 'Body', acceptanceCriteria: criteria })
})

const raw = await fakeRaw()
const pmkit = (mappings = {}, scope = { workspace: 'acme', team: 'ACME' }) => ({ tracker: { system: 'linear', scope }, mappings })
const VIEWER = { id: 'user-1', name: 'Test User' }
const BASE_MAPPINGS = { status: { in_review: 'In Review' }, types: { bug: 'Bug', feature: 'Feature' } }
const context = makeContext(raw, pmkit(BASE_MAPPINGS), VIEWER)
const contextWith = (mappings) => makeContext(raw, pmkit({ ...BASE_MAPPINGS, ...mappings }), VIEWER)
const contextWithTeam = async (team, mappings = { fields: { estimate: 'native' } }) => {
  const other = await fakeRaw({ teams: [{ ...rawTeam, ...team }] })
  return makeContext(other, pmkit({ ...BASE_MAPPINGS, ...mappings }), VIEWER)
}
const rawTeam = { id: 'team-acme', key: 'ACME', name: 'Acme', parent: null, cyclesEnabled: false, triageEnabled: false, issueEstimationType: 'notUsed', issueEstimationAllowZero: false, issueEstimationExtended: false }

test('makeContext holds the raw discovery, the mappings, the viewer and the scope team', () => {
  assert.equal(context.raw, raw)
  assert.equal(context.scopeTeam.key, 'ACME')
  assert.deepEqual(context.viewer, VIEWER)
  assert.deepEqual(context.priorities, ['urgent', 'high', 'medium', 'low'])
  assert.equal(makeContext(raw, pmkit({}, { workspace: 'acme' }), VIEWER).scopeTeam, null)
})

test('stateCategory uses the mapped name, then the type, then in_progress', () => {
  assert.equal(stateCategory({ name: 'In Review', type: 'started' }, context), 'in_review')
  assert.equal(stateCategory({ name: 'UAT', type: 'started' }, context), 'in_progress')
  assert.equal(stateCategory({ name: 'Done', type: 'completed' }, context), 'done')
  assert.equal(stateCategory({ name: 'Odd', type: 'paused' }, context), 'in_progress')
  assert.equal(stateCategory({ id: 'state-4', type: 'started' }, context), 'in_review')
})

test('toIssue maps the scalar fields', () => {
  const issue = toIssue(node({ identifier: 'ACME-3', title: 'Three', priority: 2, dueDate: '2026-11-01', branchName: 'acme-3-x', assignee: { id: 'user-2' },
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', state: { id: 'state-4', name: 'In Review', type: 'started' },
    parent: { identifier: 'ACME-1' }, children: conn([{ identifier: 'ACME-10' }, { identifier: 'ACME-9' }]) }), context)
  assert.equal(issue.id, 'ACME-3')
  assert.equal(issue.title, 'Three')
  assert.equal(issue.priority, 'high')
  assert.equal(issue.due, '2026-11-01')
  assert.equal(issue.branch, 'acme-3-x')
  assert.equal(issue.assignee, 'user-2')
  assert.equal(issue.parent, 'ACME-1')
  assert.deepEqual(issue.children, ['ACME-9', 'ACME-10'])
  assert.deepEqual(issue.status, { name: 'In Review', category: 'in_review' })
  assert.equal(issue.archived, false)
  assert.equal(issue.created, '2026-10-01T00:00:00.000Z')
  assert.equal(issue.updated, '2026-10-02T00:00:00.000Z')
  for (const key of ['sprint', 'milestone', 'release', 'type', 'estimate']) assert.equal(key in issue, false, key)
})

test('sprint is the cycle number as a string, and absent without a cycle', () => {
  assert.equal(toIssue(node({ cycle: { id: 'cycle-uuid', number: 12 } }), context).sprint, '12')
  assert.equal('sprint' in toIssue(node({ cycle: null }), context), false)
  assert.equal('sprint' in toIssue(node(), context), false)
})

test('unset fields are absent keys', () => {
  const issue = toIssue(node(), context)
  for (const key of ['priority', 'assignee', 'parent', 'due']) assert.equal(key in issue, false, key)
  assert.deepEqual(issue.labels, [])
  assert.equal(issue.description, '')
  assert.deepEqual(issue.acceptanceCriteria, [])
})

test('relations in both directions, related without duplicates, similar ignored, sorted', () => {
  const issue = toIssue(node({
    relations: conn([rel('blocks', 'ACME-10'), rel('blocks', 'ACME-9'), rel('related', 'ACME-5'), rel('duplicate', 'ACME-6'), rel('similar', 'ACME-7')]),
    inverseRelations: conn([inv('blocks', 'ACME-2'), inv('related', 'ACME-5'), inv('related', 'ACME-4'), inv('duplicate', 'ACME-8')]),
  }), context)
  assert.deepEqual(issue.blocks, ['ACME-9', 'ACME-10'])
  assert.deepEqual(issue.blockedBy, ['ACME-2'])
  assert.deepEqual(issue.related, ['ACME-4', 'ACME-5'])
  assert.deepEqual(issue.duplicateOf, ['ACME-6'])
})

test('type comes from mappings.types and leaves labels', () => {
  const issue = toIssue(node({ labels: conn([lab('Feature'), lab('Docs'), lab('Bug')]) }), context)
  assert.equal(issue.type, 'bug')
  assert.deepEqual(issue.labels, ['Docs'])
  assert.equal(toIssue(node({ labels: conn([lab('Docs')]) }), context).type, undefined)
})

test('estimate: points as a number, t-shirt as a size, unset when not native or empty', async () => {
  assert.equal(toIssue(node({ estimate: 3 }), await contextWithTeam({ issueEstimationType: 'fibonacci' })).estimate, 3)
  assert.equal(toIssue(node({ estimate: 5 }), await contextWithTeam({ issueEstimationType: 'tShirt' })).estimate, 'L')
  assert.equal(toIssue(node({ estimate: 3 }), await contextWithTeam({ issueEstimationType: 'fibonacci' }, {})).estimate, undefined)
  assert.equal(toIssue(node({ estimate: 3 }), await contextWithTeam({ issueEstimationType: 'fibonacci' }, { fields: { estimate: 'none' } })).estimate, undefined)
  assert.equal(toIssue(node({ estimate: null }), await contextWithTeam({ issueEstimationType: 'fibonacci' })).estimate, undefined)
})

test('criteria come out of the description; a trashed node is null; archivedAt reads as archived', () => {
  const issue = toIssue(node({ description: 'Body\n\n## Acceptance criteria\n\n- [x] done' }), context)
  assert.equal(issue.description, 'Body')
  assert.deepEqual(issue.acceptanceCriteria, [{ text: 'done', done: true }])
  assert.equal(toIssue(node({ trashed: true }), context), null)
  assert.equal(toIssue(node({ archivedAt: '2026-10-03T00:00:00.000Z' }), context).archived, true)
})

test('blockedOpen counts open blockers and blockers without a state', () => {
  assert.equal(blockedOpen(node({ inverseRelations: conn([inv('blocks', 'ACME-2', { id: 'state-8', type: 'completed' })]) }), context), false)
  assert.equal(blockedOpen(node({ inverseRelations: conn([inv('blocks', 'ACME-2', { id: 'state-3', type: 'started' })]) }), context), true)
  assert.equal(blockedOpen(node({ inverseRelations: conn([inv('blocks', 'ACME-2', null)]) }), context), true)
  assert.equal(blockedOpen(node({ inverseRelations: conn([inv('related', 'ACME-2')]) }), context), false)
})
