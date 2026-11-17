// The pure mapping of GitHub timeline items to pmkit events and of issue comments to pmkit comments.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeGithubIssues } from '../../fake-github-issues.mjs'
import { createGithubClient } from './client.mjs'
import { discoveryView, fetchDiscovery } from './discovery.mjs'
import { toComment, toEvents } from './history.mjs'
import { makeContext } from './issues.mjs'
import { categoryLookup, lastEntry } from '../metrics.mjs'

const PMKIT = {
  tracker: { system: 'github', scope: { host: 'github.com', repo: 'acme/widgets', project: 'acme/7' } },
  mappings: { status: { backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress', in_review: 'In Review', done: 'Done' }, types: { bug: 'Bug', task: 'Task' } },
}

const fake = fakeGithubIssues()
const client = createGithubClient({ exec: fake.exec, retries: 0, sleep: async () => {} })
const context = makeContext(await fetchDiscovery(client, { host: 'github.com', repo: 'acme/widgets', project: 'acme/7', exec: fake.exec, users: true }), PMKIT)

const ME = { login: 'octocat' }
const CREATED = '2026-11-01T10:00:00Z'
const node = (extra = {}) => ({
  id: 'I_1', number: 1, title: 'Now', state: 'OPEN', stateReason: null, createdAt: CREATED, author: ME,
  repository: { nameWithOwner: 'acme/widgets' }, projectItems: { nodes: [] }, ...extra,
})
const at = (minute) => `2026-11-01T10:${String(minute).padStart(2, '0')}:00Z`
const item = (typename, minute, fields = {}) => ({ __typename: typename, id: `E_${minute}`, actor: ME, createdAt: at(minute), ...fields })
const ref = (number, repo = 'acme/widgets') => ({ number, repository: { nameWithOwner: repo } })
/** The events of one item, without the create event. */
const one = (entry, extra) => toEvents(node(extra), [entry], context).slice(1)

test('the issue itself is a create event at createdAt by its author', () => {
  assert.deepEqual(toEvents(node(), [], context), [{ at: CREATED, by: 'octocat', op: 'create', to: { id: '1', title: 'Now' } }])
})

test('the create event carries the title before the first rename', () => {
  const events = toEvents(node(), [item('RenamedTitleEvent', 5, { previousTitle: 'First', currentTitle: 'Now' })], context)
  assert.deepEqual(events[0].to, { id: '1', title: 'First' })
})

test('a title rename is an update with from and to', () => {
  assert.deepEqual(one(item('RenamedTitleEvent', 5, { previousTitle: 'Old', currentTitle: 'New' })), [
    { at: at(5), by: 'octocat', op: 'update', field: 'title', from: 'Old', to: 'New' },
  ])
})

test('a label added and a label removed update labels to and from the label', () => {
  assert.deepEqual(one(item('LabeledEvent', 5, { label: { name: 'bug' } })), [{ at: at(5), by: 'octocat', op: 'update', field: 'labels', from: null, to: 'bug' }])
  assert.deepEqual(one(item('UnlabeledEvent', 6, { label: { name: 'bug' } })), [{ at: at(6), by: 'octocat', op: 'update', field: 'labels', from: 'bug', to: null }])
})

test('an issue type change updates type with the pmkit type, or the type name when unmapped', () => {
  assert.deepEqual(one(item('IssueTypeChangedEvent', 5, { prevIssueType: { name: 'Task' }, issueType: { name: 'Bug' } })), [
    { at: at(5), by: 'octocat', op: 'update', field: 'type', from: 'task', to: 'bug' },
  ])
  assert.deepEqual(one(item('IssueTypeAddedEvent', 5, { issueType: { name: 'Feature' } }))[0], { at: at(5), by: 'octocat', op: 'update', field: 'type', from: null, to: 'Feature' })
  assert.deepEqual(one(item('IssueTypeRemovedEvent', 5, { issueType: { name: 'Bug' } }))[0], { at: at(5), by: 'octocat', op: 'update', field: 'type', from: 'bug', to: null })
})

test('an assign and an unassign are assign events on assignee', () => {
  assert.deepEqual(one(item('AssignedEvent', 5, { assignee: { login: 'hubot' } })), [{ at: at(5), by: 'octocat', op: 'assign', field: 'assignee', from: null, to: 'hubot' }])
  assert.deepEqual(one(item('UnassignedEvent', 5, { assignee: { login: 'hubot' } })), [{ at: at(5), by: 'octocat', op: 'assign', field: 'assignee', from: 'hubot', to: null }])
})

test('a close is a move to Closed, or to Closed as not planned by its reason', () => {
  const close = (stateReason) => one(item('ClosedEvent', 5, { stateReason }))[0]
  assert.deepEqual(close('NOT_PLANNED'), { at: at(5), by: 'octocat', op: 'move', field: 'status', from: null, to: 'Closed as not planned' })
  assert.equal(close('DUPLICATE').to, 'Closed as not planned')
  assert.equal(close('COMPLETED').to, 'Closed')
  assert.equal(close(null).to, 'Closed')
})

test('a reopen is a move to the status the open issue reads now, else Open', () => {
  const inProgress = { projectItems: { nodes: [{ project: { id: 'PVT_1' }, status: { name: 'In Progress' } }] } }
  assert.deepEqual(one(item('ReopenedEvent', 5), inProgress), [{ at: at(5), by: 'octocat', op: 'move', field: 'status', from: null, to: 'In Progress' }])
  assert.equal(one(item('ReopenedEvent', 5))[0].to, 'Open')
  assert.equal(one(item('ReopenedEvent', 5), { ...inProgress, state: 'CLOSED', stateReason: 'COMPLETED' })[0].to, 'Open')
})

test('a Status change of the configured Project is a move between the two option names', () => {
  const change = item('ProjectV2ItemStatusChangedEvent', 5, { previousStatus: 'Todo', status: 'In Review', project: { id: 'PVT_1' } })
  assert.deepEqual(one(change), [{ at: at(5), by: 'octocat', op: 'move', field: 'status', from: 'Todo', to: 'In Review' }])
  assert.equal(one({ ...change, previousStatus: '' })[0].from, null)
  assert.deepEqual(one({ ...change, project: { id: 'PVT_OTHER' } }), [])
})

test('the metrics category lookup over discover statuses maps every move the history emits', () => {
  const categoryOf = categoryLookup(discoveryView(context.raw, PMKIT).statuses)
  const moves = toEvents(node({ projectItems: { nodes: [{ project: { id: 'PVT_1' }, status: { name: 'In Review' } }] } }), [
    item('ProjectV2ItemStatusChangedEvent', 1, { previousStatus: 'Backlog', status: 'In Progress', project: { id: 'PVT_1' } }),
    item('ClosedEvent', 2, { stateReason: 'NOT_PLANNED' }),
    item('ReopenedEvent', 3),
    item('ClosedEvent', 4, { stateReason: 'COMPLETED' }),
  ], context).filter((event) => event.op === 'move')
  assert.deepEqual(moves.map((event) => [event.from && categoryOf(event.from), categoryOf(event.to)]), [
    ['backlog', 'in_progress'], [null, 'canceled'], [null, 'in_review'], [null, 'done'],
  ])
  assert.equal(categoryOf('Open'), 'todo')
  assert.equal(lastEntry(moves, 'done', categoryOf), at(4))
})

test('relation events are link and unlink events on the pmkit relation field', () => {
  assert.deepEqual(one(item('BlockedByAddedEvent', 5, { blockingIssue: ref(2) })), [{ at: at(5), by: 'octocat', op: 'link', field: 'blockedBy', to: '2' }])
  assert.deepEqual(one(item('BlockedByRemovedEvent', 5, { blockingIssue: ref(2) }))[0].op, 'unlink')
  assert.deepEqual(one(item('BlockingAddedEvent', 5, { blockedIssue: ref(3) }))[0], { at: at(5), by: 'octocat', op: 'link', field: 'blocks', to: '3' })
  assert.deepEqual(one(item('ParentIssueAddedEvent', 5, { parent: ref(4) }))[0], { at: at(5), by: 'octocat', op: 'link', field: 'parent', to: '4' })
  assert.deepEqual(one(item('SubIssueAddedEvent', 5, { subIssue: ref(5, 'acme/other') })), [{ at: at(5), by: 'octocat', op: 'link', field: 'children', to: 'acme/other#5' }])
  assert.deepEqual(one(item('SubIssueRemovedEvent', 5, { subIssue: ref(5) }))[0], { at: at(5), by: 'octocat', op: 'unlink', field: 'children', to: '5' })
  assert.deepEqual(one(item('MarkedAsDuplicateEvent', 5, { canonical: ref(6) }))[0], { at: at(5), by: 'octocat', op: 'link', field: 'duplicateOf', to: '6' })
  assert.deepEqual(one(item('UnmarkedAsDuplicateEvent', 5, { canonical: ref(6) }))[0].op, 'unlink')
  assert.deepEqual(one(item('BlockedByAddedEvent', 5, { blockingIssue: null })), [], 'a deleted issue leaves no event')
})

test('a comment is a comment event with the comment id', () => {
  const comment = { __typename: 'IssueComment', id: 'IC_1', author: { login: 'hubot' }, body: 'Hi', createdAt: at(7) }
  assert.deepEqual(one(comment), [{ at: at(7), by: 'hubot', op: 'comment', to: 'IC_1' }])
})

test('a deleted account is by null', () => {
  assert.equal(one({ ...item('LabeledEvent', 5, { label: { name: 'bug' } }), actor: null })[0].by, null)
  assert.equal(toEvents(node({ author: null }), [], context)[0].by, null)
  assert.equal(one({ __typename: 'IssueComment', id: 'IC_1', author: null, body: 'x', createdAt: at(7) })[0].by, null)
})

test('events sort by at, and equal times keep the timeline order', () => {
  const events = toEvents(node(), [
    item('LabeledEvent', 9, { label: { name: 'b' } }),
    item('LabeledEvent', 5, { label: { name: 'a' } }),
    item('LabeledEvent', 9, { label: { name: 'c' } }),
    { __typename: 'SomethingElse', createdAt: at(1) },
  ], context)
  assert.deepEqual(events.map((event) => event.to?.title ?? event.to), ['Now', 'a', 'b', 'c'])
})

test('toComment maps a comment node to the pmkit comment', () => {
  assert.deepEqual(toComment({ id: 'IC_1', author: { login: 'hubot' }, body: '  Hello  ', createdAt: at(7) }, '1'), { id: 'IC_1', issue: '1', author: 'hubot', body: 'Hello', created: at(7) })
  assert.equal(toComment({ id: 'IC_2', author: null, body: null, createdAt: at(7) }, '1').author, null)
  assert.equal(toComment({ id: 'IC_2', author: null, body: null, createdAt: at(7) }, '1').body, '')
})

const LABEL_PMKIT = {
  tracker: { system: 'github', scope: { host: 'github.com', repo: 'acme/widgets', project: 'none' } },
  mappings: { status: { backlog: 'label:Backlog', in_progress: 'label:Doing', in_review: 'label:Review' }, types: { bug: 'label:bug', feature: 'label:enhancement' } },
}
const labelFake = fakeGithubIssues({ project: null, issueTypes: [], labels: ['Backlog', 'Doing', 'Review', 'bug', 'enhancement', 'x'] })
const labelClient = createGithubClient({ exec: labelFake.exec, retries: 0, sleep: async () => {} })
const labelContext = makeContext(await fetchDiscovery(labelClient, { host: 'github.com', repo: 'acme/widgets', project: 'none', exec: labelFake.exec, users: true }), LABEL_PMKIT)
const labelled = (typename, minute, name) => item(typename, minute, { label: { name } })
const replay = (items, extra) => toEvents(node(extra), items, labelContext).slice(1).map(({ op, field, from, to }) => [op, field, from, to])

test('status label items become moves when the read status changes', () => {
  // pmkit adds the target label, then removes the others, so a move forward or back is one event.
  assert.deepEqual(replay([labelled('LabeledEvent', 1, 'Doing'), labelled('LabeledEvent', 2, 'Review'), labelled('UnlabeledEvent', 3, 'Doing')]), [
    ['move', 'status', 'Open', 'Doing'],
    ['move', 'status', 'Doing', 'Review'],
  ])
  assert.deepEqual(replay([labelled('LabeledEvent', 1, 'Review'), labelled('LabeledEvent', 2, 'Doing'), labelled('UnlabeledEvent', 3, 'Review')]), [
    ['move', 'status', 'Open', 'Review'],
    ['move', 'status', 'Review', 'Doing'],
  ])
})

test('label items at the same instant count as one change', () => {
  assert.deepEqual(replay([labelled('LabeledEvent', 1, 'Doing'), labelled('UnlabeledEvent', 2, 'Doing'), labelled('LabeledEvent', 2, 'Review')]), [
    ['move', 'status', 'Open', 'Doing'],
    ['move', 'status', 'Doing', 'Review'],
  ])
})

test('a status label further back than the one held changes nothing', () => {
  assert.deepEqual(replay([labelled('LabeledEvent', 1, 'Review'), labelled('LabeledEvent', 2, 'backlog')]), [['move', 'status', 'Open', 'Review']])
})

test('status label items while the issue is closed give no move', () => {
  assert.deepEqual(replay([item('ClosedEvent', 1, { stateReason: 'COMPLETED' }), labelled('LabeledEvent', 2, 'Doing')], { state: 'CLOSED', stateReason: 'COMPLETED' }), [
    ['move', 'status', null, 'Closed'],
  ])
})

test('removing the last status label moves to Open', () => {
  assert.deepEqual(replay([labelled('LabeledEvent', 1, 'Doing'), labelled('UnlabeledEvent', 2, 'Doing')]), [
    ['move', 'status', 'Open', 'Doing'],
    ['move', 'status', 'Doing', 'Open'],
  ])
})

test('type label items become type updates, and other labels stay label updates', () => {
  assert.deepEqual(replay([labelled('LabeledEvent', 1, 'bug'), labelled('LabeledEvent', 2, 'x'), labelled('UnlabeledEvent', 3, 'bug'), labelled('LabeledEvent', 3, 'enhancement')]), [
    ['update', 'type', null, 'bug'],
    ['update', 'labels', null, 'x'],
    ['update', 'type', 'bug', 'feature'],
  ])
})

test('a reopen without a Project moves to the status the labels give at that time', () => {
  const items = [labelled('LabeledEvent', 1, 'Doing'), item('ClosedEvent', 2, { stateReason: 'COMPLETED' }), item('ReopenedEvent', 3), labelled('LabeledEvent', 4, 'Review')]
  assert.deepEqual(replay(items), [
    ['move', 'status', 'Open', 'Doing'],
    ['move', 'status', null, 'Closed'],
    ['move', 'status', null, 'Doing'],
    ['move', 'status', 'Doing', 'Review'],
  ])
})
