import assert from 'node:assert/strict'
import test from 'node:test'
import { conn, fakeRaw, inv, lab, node, rel } from '../../fake-linear-nodes.mjs'
import { replay } from '../local/events.mjs'
import { RELATION_CODES, actorOf, toComment, toEvents } from './history.mjs'
import { makeContext, toIssue } from './issues.mjs'

test('the actor is the user id, else bot:<type>, else external:<id>, else linear', () => {
  assert.equal(actorOf({ user: { id: 'user-1' } }), 'user-1')
  assert.equal(actorOf({ actor: { id: 'user-2' } }), 'user-2')
  assert.equal(actorOf({ user: null, botActor: { type: 'github', name: 'GitHub' } }), 'bot:github')
  assert.equal(actorOf({ externalUser: { id: 'ext-1' } }), 'external:ext-1')
  assert.equal(actorOf({}), 'linear')
  assert.equal(actorOf({ actor: null, autoClosed: true }), 'linear')
  assert.equal(actorOf({ user: { id: 'user-1' }, botActor: { type: 'x' } }), 'user-1')
})

const commentNode = { id: 'c-1', createdAt: '2026-10-01T00:00:00.000Z', body: '  Hello\n', user: { id: 'user-1' }, botActor: null, externalUser: null, parentId: null, resolvedAt: null, resolvingUser: null }

test('a plain comment has the common keys only, with the body trimmed', () => {
  const comment = toComment(commentNode, 'ACME-1')
  assert.deepEqual(comment, { id: 'c-1', issue: 'ACME-1', author: 'user-1', body: 'Hello', created: '2026-10-01T00:00:00.000Z' })
  assert.deepEqual(Object.keys(comment), ['id', 'issue', 'author', 'body', 'created'])
})

test('a reply holds parent, and a resolved root holds resolved, in that key order', () => {
  assert.equal(toComment({ ...commentNode, parentId: 'c-0' }, 'ACME-1').parent, 'c-0')
  const resolved = toComment({ ...commentNode, parentId: 'c-0', resolvedAt: '2026-10-02T00:00:00.000Z', resolvingUser: { id: 'user-2' } }, 'ACME-1')
  assert.deepEqual(Object.keys(resolved), ['id', 'issue', 'author', 'body', 'created', 'parent', 'resolved'])
  assert.deepEqual(resolved.resolved, { at: '2026-10-02T00:00:00.000Z', by: 'user-2' })
  assert.equal(toComment({ ...commentNode, resolvedAt: '2026-10-02T00:00:00.000Z' }, 'ACME-1').resolved.by, 'linear')
})

test('a bot, an external and a Linear comment get their author', () => {
  assert.equal(toComment({ ...commentNode, user: null, botActor: { type: 'slack', name: 'Slack' } }, 'ACME-1').author, 'bot:slack')
  assert.equal(toComment({ ...commentNode, user: null, externalUser: { id: 'e1' } }, 'ACME-1').author, 'external:e1')
  assert.equal(toComment({ ...commentNode, user: null }, 'ACME-1').author, 'linear')
})

// toEvents

const raw = await fakeRaw()
const VIEWER = { id: 'user-1', name: 'Test User' }
const BASE_MAPPINGS = { status: { in_review: 'In Review' }, types: { bug: 'Bug', feature: 'Feature' } }
const pmkit = (mappings) => ({ tracker: { system: 'linear', scope: { workspace: 'acme', team: 'ACME' } }, mappings: { ...BASE_MAPPINGS, ...mappings } })
const context = makeContext(raw, pmkit({}), VIEWER)
const TEAM = { id: 'team-acme', key: 'ACME', name: 'Acme', parent: null, cyclesEnabled: false, triageEnabled: false, issueEstimationType: 'notUsed', issueEstimationAllowZero: false, issueEstimationExtended: false }
const contextWithTeam = async (team, mappings = { fields: { estimate: 'native' } }) => makeContext(await fakeRaw({ teams: [{ ...TEAM, ...team }] }), pmkit(mappings), VIEWER)
const STATES = { Backlog: { id: 'state-1', name: 'Backlog', type: 'backlog' }, Todo: { id: 'state-2', name: 'Todo', type: 'unstarted' }, 'In Progress': { id: 'state-3', name: 'In Progress', type: 'started' }, Done: { id: 'state-8', name: 'Done', type: 'completed' } }
const at = (n) => `2026-10-0${n}T00:00:00.000Z`
const entry = (createdAt, fields = {}) => ({ createdAt, actor: { id: 'user-1' }, botActor: null, autoClosed: false, autoArchived: false, archived: false, updatedDescription: false, ...fields })
const origin = { creator: { id: 'user-1' }, botActor: null }
const without = (events) => events.slice(1)

test('every row of the field table becomes its event', () => {
  const run = (fields, overrides = {}, ctx = context) => without(toEvents({ node: node(overrides), origin, entries: [entry(at(2), fields)] }, ctx))
  const meta = { at: at(2), by: 'user-1' }
  assert.deepEqual(run({ fromState: STATES.Backlog, toState: STATES.Todo }, { state: STATES.Todo }), [{ ...meta, op: 'move', field: 'status', from: 'Backlog', to: 'Todo' }])
  assert.deepEqual(run({ fromAssigneeId: null, toAssigneeId: 'user-2' }, { assignee: { id: 'user-2' } }), [{ ...meta, op: 'assign', field: 'assignee', from: null, to: 'user-2' }])
  assert.deepEqual(run({ fromAssigneeId: 'user-2', toAssigneeId: null }), [{ ...meta, op: 'assign', field: 'assignee', from: 'user-2', to: null }])
  assert.deepEqual(run({ fromTitle: 'Old', toTitle: 'New' }, { title: 'New' }), [{ ...meta, op: 'update', field: 'title', from: 'Old', to: 'New' }])
  assert.deepEqual(run({ fromPriority: 0, toPriority: 2 }, { priority: 2 }), [{ ...meta, op: 'update', field: 'priority', from: null, to: 'high' }])
  assert.deepEqual(run({ fromPriority: 3, toPriority: 0 }), [{ ...meta, op: 'update', field: 'priority', from: 'medium', to: null }])
  assert.deepEqual(run({ fromDueDate: null, toDueDate: '2026-12-01' }, { dueDate: '2026-12-01' }), [{ ...meta, op: 'update', field: 'due', from: null, to: '2026-12-01' }])
  assert.deepEqual(run({ fromParent: null, toParent: { identifier: 'ACME-9' } }, { parent: { identifier: 'ACME-9' } }), [{ ...meta, op: 'update', field: 'parent', from: null, to: 'ACME-9' }])
  assert.deepEqual(run({ fromParent: { identifier: 'ACME-9' }, toParent: null }), [{ ...meta, op: 'update', field: 'parent', from: 'ACME-9', to: null }])
  assert.deepEqual(run({ fromCycle: null, toCycle: { number: 4 } }), [{ ...meta, op: 'update', field: 'sprint', from: null, to: '4' }])
  // The project is named by its epic id: the identifier, else the slug when the identifier has another shape (PMK-38).
  const project = { id: '00000000-0000-4000-8000-0000000000a1', slugId: 'a1b2c3d4e5f6', identifier: 'P-ACM-1' }
  assert.deepEqual(run({ fromProject: project, toProject: null }), [{ ...meta, op: 'update', field: 'project', from: 'P-ACM-1', to: null }])
  assert.deepEqual(run({ fromProject: null, toProject: { ...project, identifier: 'LAUNCH' } }), [{ ...meta, op: 'update', field: 'project', from: null, to: 'a1b2c3d4e5f6' }])
  assert.deepEqual(run({ fromProjectMilestone: null, toProjectMilestone: { id: 'm1' } }), [{ ...meta, op: 'update', field: 'milestone', from: null, to: 'm1' }])
  assert.deepEqual(run({ updatedDescription: true }), [{ ...meta, op: 'update', field: 'description' }])
  assert.deepEqual(run({ archived: true }), [{ ...meta, op: 'archive' }])
  assert.deepEqual(run({ autoArchived: true, actor: null }), [{ at: at(2), by: 'linear', op: 'archive' }])
  assert.deepEqual(run({ relationChanges: [{ identifier: 'ACME-4', type: 'ar' }] }, { relations: conn([rel('related', 'ACME-4')]) }), [{ ...meta, op: 'link', field: 'related', to: 'ACME-4' }])
})

test('an entry with a state and an assignee change yields a move then an assign with the entry time', () => {
  const events = without(toEvents({
    node: node({ state: STATES.Todo, assignee: { id: 'user-2' } }),
    origin,
    entries: [entry(at(2), { fromState: STATES.Backlog, toState: STATES.Todo, fromAssigneeId: null, toAssigneeId: 'user-2' })],
  }, context))
  assert.deepEqual(events.map((e) => [e.at, e.op]), [[at(2), 'move'], [at(2), 'assign']])
})

test('newest-first and oldest-first input give the same output', () => {
  const entries = [
    entry(at(2), { fromTitle: 'A', toTitle: 'B' }),
    entry(at(3), { fromTitle: 'B', toTitle: 'C' }),
    entry(at(4), { fromState: STATES.Backlog, toState: STATES.Done }),
  ]
  const input = (list) => ({ node: node({ title: 'C', state: STATES.Done }), origin, entries: list })
  const forward = toEvents(input(entries), context)
  assert.deepEqual(toEvents(input([...entries].reverse()), context), forward)
  assert.deepEqual(forward.map((e) => e.op), ['create', 'update', 'update', 'move'])
  assert.deepEqual(forward[0].to.title, 'A')
})

test('a type label change is a type event only, and a plain label change is a labels event with whole sorted lists', () => {
  const current = node({ labels: conn([lab('Bug'), lab('Docs')]) })
  const typeOnly = without(toEvents({ node: current, origin, entries: [entry(at(2), { addedLabels: [lab('Bug')], removedLabels: [lab('Feature')] })] }, context))
  assert.deepEqual(typeOnly.map((e) => [e.field, e.from, e.to]), [['type', 'feature', 'bug']])
  const labels = without(toEvents({ node: node({ labels: conn([lab('Docs'), lab('Zed'), lab('Alpha')]) }), origin, entries: [entry(at(2), { addedLabels: [lab('Zed')], removedLabels: [lab('Old')] })] }, context))
  assert.deepEqual(labels.map((e) => [e.field, e.from, e.to]), [['labels', ['Alpha', 'Docs', 'Old'], ['Alpha', 'Docs', 'Zed']]])
  const both = without(toEvents({ node: current, origin, entries: [entry(at(2), { addedLabels: [lab('Bug'), lab('Docs')], removedLabels: [] })] }, context))
  assert.deepEqual(both.map((e) => e.field), ['type', 'labels'])
})

test('label ids with no label object fall back to the discovery names, and an unknown id adds nothing', () => {
  const current = node({ labels: conn([lab('Bug')]) })
  const byId = entry(at(2), { addedLabelIds: ['label-bug'], removedLabelIds: ['label-feature', 'label-gone'] })
  assert.deepEqual(without(toEvents({ node: current, origin, entries: [byId] }, context)).map((e) => [e.field, e.from, e.to]), [['type', 'feature', 'bug']])
  const both = entry(at(2), { addedLabels: [lab('Bug')], addedLabelIds: ['label-bug'] })
  assert.deepEqual(without(toEvents({ node: current, origin, entries: [both] }, context)).map((e) => [e.field, e.from, e.to]), [['type', null, 'bug']])
})

test('estimates map like toIssue, and a non-native mapping gives no estimate event', async () => {
  const change = entry(at(2), { fromEstimate: 3, toEstimate: 5 })
  const tshirt = await contextWithTeam({ issueEstimationType: 'tShirt' })
  assert.deepEqual(without(toEvents({ node: node({ estimate: 5 }), origin, entries: [change] }, tshirt)).map((e) => [e.from, e.to]), [['M', 'L']])
  const points = await contextWithTeam({ issueEstimationType: 'fibonacci' })
  assert.deepEqual(without(toEvents({ node: node({ estimate: 5 }), origin, entries: [change] }, points)).map((e) => [e.from, e.to]), [[3, 5]])
  const notNative = await contextWithTeam({ issueEstimationType: 'fibonacci' }, {})
  assert.deepEqual(without(toEvents({ node: node({ estimate: 5 }), origin, entries: [change] }, notNative)), [])
  assert.equal('estimate' in toEvents({ node: node({ estimate: 5 }), origin, entries: [change] }, notNative)[0].to, false)
})

test('relation code ar links, and an unknown code yields no event and leaves the related list', () => {
  assert.deepEqual(Object.keys(RELATION_CODES), ['ar'])
  const current = node({ relations: conn([rel('related', 'ACME-4')]), inverseRelations: conn([inv('related', 'ACME-5')]) })
  const events = toEvents({ node: current, origin, entries: [entry(at(2), { relationChanges: [{ identifier: 'ACME-4', type: 'ar' }] })] }, context)
  assert.deepEqual(events[0].to.related, ['ACME-5'])
  const unknown = toEvents({ node: current, origin, entries: [entry(at(2), { relationChanges: [{ identifier: 'ACME-4', type: 'zz' }] })] }, context)
  assert.deepEqual(unknown.map((e) => e.op), ['create'])
  assert.deepEqual(unknown[0].to.related, ['ACME-4', 'ACME-5'])
})

test('the create event holds the state before the oldest entry, with absent keys left out', () => {
  const current = node({ title: 'Now', priority: 2, state: STATES.Done, createdAt: at(1) })
  const [create] = toEvents({ node: current, origin, entries: [entry(at(3), { fromTitle: 'Then', toTitle: 'Now' }), entry(at(2), { fromPriority: 0, toPriority: 2 })] }, context)
  assert.deepEqual(create, { at: at(1), by: 'user-1', op: 'create', to: { id: 'ACME-1', title: 'Then', status: 'Done', created: at(1) } })
  assert.deepEqual(Object.keys(create), ['at', 'by', 'op', 'to'])
  const full = toEvents({
    node: node({ priority: 1, dueDate: '2026-11-01', parent: { identifier: 'ACME-2' }, assignee: { id: 'user-2' }, labels: conn([lab('Bug'), lab('Docs')]), relations: conn([rel('blocks', 'ACME-7'), rel('duplicate', 'ACME-8')]), inverseRelations: conn([inv('blocks', 'ACME-6')]) }),
    origin: { creator: null, botActor: { type: 'github', name: 'GitHub' } },
    entries: [],
  }, context)[0]
  assert.equal(full.by, 'bot:github')
  assert.deepEqual(Object.keys(full.to), ['id', 'title', 'type', 'status', 'priority', 'assignee', 'labels', 'parent', 'blocked_by', 'duplicate_of', 'due', 'created'])
  assert.deepEqual([full.to.type, full.to.labels, full.to.blocked_by, full.to.duplicate_of], ['bug', ['Docs'], ['ACME-6'], ['ACME-8']])
})

test('entries with no mappable change are dropped', () => {
  const dropped = [
    entry(at(2), { fromTeam: { id: 'x' }, toTeam: { id: 'y' } }),
    entry(at(3), { attachmentId: 'a1' }),
    entry(at(4), { addedToReleaseIds: ['r1'] }),
    entry(at(5), {}),
  ]
  assert.deepEqual(toEvents({ node: node(), origin, entries: dropped }, context).map((e) => e.op), ['create'])
})

test('comments and a resolution become comment events', () => {
  const comments = [
    { id: 'c-1', createdAt: at(2), body: 'Q', user: { id: 'user-2' }, botActor: null, externalUser: null, parentId: null, resolvedAt: at(4), resolvingUser: { id: 'user-1' } },
    { id: 'c-2', createdAt: at(3), body: 'A', user: null, botActor: { type: 'slack', name: 'Slack' }, externalUser: null, parentId: 'c-1', resolvedAt: null, resolvingUser: null },
  ]
  const events = without(toEvents({ node: node(), origin, entries: [], comments }, context))
  assert.deepEqual(events, [
    { at: at(2), by: 'user-2', op: 'comment', to: 'c-1' },
    { at: at(3), by: 'bot:slack', op: 'comment', to: 'c-2' },
    { at: at(4), by: 'user-1', op: 'comment', field: 'resolved', to: 'c-1' },
  ])
})

test('replaying the events gives the current issue for the fields the events cover', async () => {
  const ctx = await contextWithTeam({ issueEstimationType: 'fibonacci' })
  const current = node({
    title: 'Final', state: STATES.Done, priority: 2, estimate: 5, assignee: { id: 'user-2' }, dueDate: '2026-12-01', parent: { identifier: 'ACME-9' },
    labels: conn([lab('Bug'), lab('Docs')]), relations: conn([rel('related', 'ACME-4')]),
    cycle: { number: 4 }, projectMilestone: { id: 'm1' },
  })
  const entries = [
    entry(at(2), { fromState: STATES.Backlog, toState: STATES.Todo, fromAssigneeId: null, toAssigneeId: 'user-1' }),
    entry(at(3), { fromTitle: 'Start', toTitle: 'Mid', fromPriority: 0, toPriority: 3, addedLabels: [lab('Feature'), lab('Docs')], removedLabels: [] }),
    entry(at(4), { fromEstimate: null, toEstimate: 3, fromDueDate: null, toDueDate: '2026-11-01', fromParent: null, toParent: { identifier: 'ACME-9' }, relationChanges: [{ identifier: 'ACME-4', type: 'ar' }] }),
    entry(at(5), {
      fromState: STATES.Todo, toState: STATES.Done, fromAssigneeId: 'user-1', toAssigneeId: 'user-2', fromTitle: 'Mid', toTitle: 'Final', fromPriority: 3, toPriority: 2,
      fromEstimate: 3, toEstimate: 5, fromDueDate: '2026-11-01', toDueDate: '2026-12-01', addedLabels: [lab('Bug')], removedLabels: [lab('Feature')],
    }),
    entry(at(6), { fromCycle: { number: 3 }, toCycle: { number: 4 }, fromProjectMilestone: { id: 'm0' }, toProjectMilestone: { id: 'm1' } }),
  ]
  const events = toEvents({ node: current, origin, entries, comments: [] }, ctx)
  const state = replay(events)
  const issue = toIssue(current, ctx)
  for (const [key, field] of [['title', 'title'], ['type', 'type'], ['priority', 'priority'], ['estimate', 'estimate'], ['assignee', 'assignee'], ['parent', 'parent'], ['due', 'due']]) {
    assert.deepEqual(state[key], issue[field], key)
  }
  assert.equal(state.status, issue.status.name)
  assert.deepEqual(state.labels ?? [], issue.labels)
  assert.deepEqual(state.related ?? [], issue.related)
  assert.deepEqual(events.map((e) => e.at), [...events.map((e) => e.at)].sort())
  // The undo of each field gives the create event's values and each event's `from`. Dropping one undo line changes these.
  assert.deepEqual(events[0].to, { id: 'ACME-1', title: 'Start', status: 'Backlog', created: at(1), sprint: '3', milestone: 'm0' })
  assert.deepEqual(events.slice(1).map((e) => [e.at.slice(9, 10), e.op, e.field, e.from, e.to]), [
    ['2', 'move', 'status', 'Backlog', 'Todo'],
    ['2', 'assign', 'assignee', null, 'user-1'],
    ['3', 'update', 'title', 'Start', 'Mid'],
    ['3', 'update', 'priority', null, 'medium'],
    ['3', 'update', 'type', null, 'feature'],
    ['3', 'update', 'labels', [], ['Docs']],
    ['4', 'update', 'estimate', null, 3],
    ['4', 'update', 'due', null, '2026-11-01'],
    ['4', 'update', 'parent', null, 'ACME-9'],
    ['4', 'link', 'related', undefined, 'ACME-4'],
    ['5', 'move', 'status', 'Todo', 'Done'],
    ['5', 'assign', 'assignee', 'user-1', 'user-2'],
    ['5', 'update', 'title', 'Mid', 'Final'],
    ['5', 'update', 'priority', 'medium', 'high'],
    ['5', 'update', 'estimate', 3, 5],
    ['5', 'update', 'due', '2026-11-01', '2026-12-01'],
    ['5', 'update', 'type', 'feature', 'bug'],
    ['6', 'update', 'sprint', '3', '4'],
    ['6', 'update', 'milestone', 'm0', 'm1'],
  ])
})
