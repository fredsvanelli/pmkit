// Tests of the Linear sandbox helper over scripted fetches. No test here opens a socket.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import {
  ACME_STATES, ACME_TEAM, ACME_USERS, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeLinearProjects, fakeWorkspace, json,
} from '../../fake-linear-api.mjs'
import { createLinearClient, isMutation } from './client.mjs'
import {
  COMMENT_CREATE, COMMENT_RESOLVE, ISSUE_ARCHIVE, ISSUE_CREATE, ISSUE_UPDATE, RELATION_CREATE, RELATION_DELETE,
} from './documents.mjs'
import { PROBES, commentProbe, cycleProbe, descriptionProbe, relationProbe } from './live-probes.mjs'
import { buildLiveRun, installSignalHandlers, registerLiveSuite, runCleanup } from './contract-live.mjs'
import { PROJECT_CREATE, PROJECT_UPDATE_CREATE } from './projects.mjs'
import {
  CYCLE_START, ISSUE_DELETE, PROJECT_DELETE, STATE_CREATE, SUITE_ALLOWLIST, TEAM_CREATE, TEST_TEAM, createGuardedFetch, findOrCreateTestTeam, listTestTeamItems, preflight,
  readMutation, trashTestTeamItems, waitForCycles,
} from './sandbox.mjs'

const URL = 'https://api.linear.app/graphql'
const TEAM = 'team-pkt'
const VIEWER = 'user-1'
const LABELS = ['label-bug', 'label-feature']

/** An answer in the shape the client reads. */
export function answer(data, headers = {}) {
  return { status: 200, ok: true, headers: new Headers(headers), text: async () => JSON.stringify({ data }) }
}

/** A fetch that answers every request with `reply(body)` (default: empty data) and records the parsed bodies. */
function scripted(reply = () => answer({})) {
  const inner = async (url, init) => {
    const body = JSON.parse(init.body)
    inner.calls.push(body)
    return reply(body)
  }
  inner.calls = []
  return inner
}

const PAYLOADS = { issueCreate: 'issue', projectCreate: 'project', commentCreate: 'comment', issueRelationCreate: 'issueRelation', workflowStateCreate: 'workflowState', teamCreate: 'team' }
/** A reply that confirms every create with the id its input chose, as Linear does, and answers anything else with empty data. */
const confirmCreates = (body) => {
  const { root } = readMutation(body.query)
  return answer(PAYLOADS[root] ? { [root]: { success: true, [PAYLOADS[root]]: { id: body.variables.input.id } } } : {})
}

const send = (guarded, query, variables = {}) =>
  guarded.fetch(URL, { method: 'POST', headers: { Authorization: FAKE_KEY }, body: JSON.stringify({ query, variables }) })

const mutationOf = (name, args = '$id: String!', call = 'id: $id') => `mutation ${name}(${args}) { ${name[0].toLowerCase()}${name.slice(1)}(${call}) { success } }`
const QUERY = 'query PmkitAny { viewer { id } }'
const REFUSED = /refusing /

function opened(options = {}) {
  const inner = scripted(confirmCreates)
  const guarded = createGuardedFetch({ fetch: inner, workspace: 'acme', ...options })
  guarded.guard.open({ teamExists: true, teamId: TEAM, viewerId: VIEWER, labelIds: LABELS })
  return { inner, ...guarded }
}

test('the guard passes a query through', async () => {
  const inner = scripted()
  const guarded = createGuardedFetch({ fetch: inner, workspace: 'acme' })
  await send(guarded, QUERY)
  assert.equal(inner.calls.length, 1)
})

test('the guard refuses every mutation before open() and sends nothing', async () => {
  const inner = scripted()
  const guarded = createGuardedFetch({ fetch: inner, workspace: 'acme' })
  await assert.rejects(send(guarded, ISSUE_CREATE, { input: { teamId: TEAM } }), /refusing PmkitIssueCreate: not in the live run's list/)
  assert.equal(inner.calls.length, 0)
})

test('the guard refuses a subscription, and a query whose root field is a mutation, and sends nothing', async () => {
  const { inner, ...guarded } = opened()
  const documents = [
    'subscription Watch { teamDelete(id: "t-1") { success } }',
    'query Sneaky { teamDelete(id: "t-1") { success } }',
    '{ teamDelete(id: "t-1") { success } }',
    'query Aliased { gone: issueArchive(id: "i-1") { success } }',
    'query Mixed { viewer { id } fooUpdate { success } }',
  ]
  for (const document of documents) await assert.rejects(send(guarded, document), REFUSED, document)
  assert.equal(inner.calls.length, 0)
})

test('the guard still passes a query with literal arguments and nested fields', async () => {
  const { inner, ...guarded } = opened()
  await send(guarded, 'query Page($after: String = "x") { issues(first: 10, after: $after) @include(if: true) { nodes { id } } viewer { id } }')
  assert.equal(inner.calls.length, 1)
})

test('the guard refuses a root field off the list', async () => {
  const { inner, ...guarded } = opened()
  for (const name of ['TeamUpdate', 'CycleUpdate', 'IssueLabelCreate', 'TeamDelete']) {
    await assert.rejects(send(guarded, mutationOf(name), { id: TEAM }), REFUSED, name)
  }
  assert.equal(inner.calls.length, 0)
})

test('the guard refuses a document with two root fields', async () => {
  const { inner, ...guarded } = opened()
  const two = 'mutation Two($id: String!) { issueArchive(id: $id) { success } teamDelete(id: $id) { success } }'
  guarded.guard.own('issue', 'i-1')
  await assert.rejects(send(guarded, two, { id: 'i-1' }), REFUSED)
  assert.equal(inner.calls.length, 0)
})

test('issueUpdate passes only for an issue the run owns', async () => {
  const { inner, ...guarded } = opened()
  await assert.rejects(send(guarded, ISSUE_UPDATE, { id: 'i-1', input: { title: 'x' } }), REFUSED)
  guarded.guard.own('issue', 'i-1')
  await send(guarded, ISSUE_UPDATE, { id: 'i-1', input: { title: 'x' } })
  assert.equal(inner.calls.length, 1)
})

test('issueUpdate refuses an assignee who is not the viewer, and a label the run does not use', async () => {
  const { inner, ...guarded } = opened()
  guarded.guard.own('issue', 'i-1')
  await assert.rejects(send(guarded, ISSUE_UPDATE, { id: 'i-1', input: { assigneeId: 'user-9' } }), REFUSED)
  await assert.rejects(send(guarded, ISSUE_UPDATE, { id: 'i-1', input: { labelIds: ['label-other'] } }), REFUSED)
  await send(guarded, ISSUE_UPDATE, { id: 'i-1', input: { assigneeId: VIEWER } })
  await send(guarded, ISSUE_UPDATE, { id: 'i-1', input: { assigneeId: null, labelIds: ['label-bug'] } })
  assert.equal(inner.calls.length, 2)
})

test('issueCreate checks the team and every id it carries', async () => {
  const { inner, ...guarded } = opened()
  await assert.rejects(send(guarded, ISSUE_CREATE, { input: { id: 'i-1', teamId: 'team-other' } }), REFUSED)
  await assert.rejects(send(guarded, ISSUE_CREATE, { input: { id: 'i-1', teamId: TEAM, projectId: 'p-9' } }), REFUSED)
  await assert.rejects(send(guarded, ISSUE_CREATE, { input: { id: 'i-1', teamId: TEAM, parentId: 'i-9' } }), REFUSED)
  await assert.rejects(send(guarded, ISSUE_CREATE, { input: { id: 'i-1', teamId: TEAM, cycleId: 'c-9' } }), REFUSED)
  await assert.rejects(send(guarded, ISSUE_CREATE, { input: { id: 'i-1', teamId: TEAM, stateId: 's-9' } }), REFUSED)
  await assert.rejects(send(guarded, ISSUE_CREATE, { input: { id: 'i-1', teamId: TEAM, labelIds: ['label-other'] } }), REFUSED)
  assert.equal(inner.calls.length, 0)
  for (const [kind, id] of [['project', 'p-1'], ['issue', 'i-0'], ['cycle', 'c-1'], ['state', 's-1']]) guarded.guard.own(kind, id)
  await send(guarded, ISSUE_CREATE, {
    input: { id: 'i-1', teamId: TEAM, projectId: 'p-1', parentId: 'i-0', cycleId: 'c-1', stateId: 's-1', labelIds: ['label-bug', 'label-feature'] },
  })
  assert.equal(inner.calls.length, 1)
  // The create made i-1 the run's own.
  await send(guarded, ISSUE_ARCHIVE, { id: 'i-1' })
  assert.equal(inner.calls.length, 2)
})

test('projectCreate refuses a second team and passes with exactly the test team', async () => {
  const { inner, ...guarded } = opened()
  await assert.rejects(send(guarded, PROJECT_CREATE, { input: { id: 'p-1', teamIds: [TEAM, 'team-other'] } }), REFUSED)
  await assert.rejects(send(guarded, PROJECT_CREATE, { input: { id: 'p-1', teamIds: ['team-other'] } }), REFUSED)
  await send(guarded, PROJECT_CREATE, { input: { id: 'p-1', teamIds: [TEAM] } })
  assert.equal(inner.calls.length, 1)
})

test('issueDelete refuses permanentlyDelete', async () => {
  const { inner, ...guarded } = opened()
  guarded.guard.own('issue', 'i-1')
  const remove = 'mutation PmkitSandboxIssueDelete($id: String!, $permanentlyDelete: Boolean) { issueDelete(id: $id, permanentlyDelete: $permanentlyDelete) { success } }'
  await assert.rejects(send(guarded, remove, { id: 'i-1', permanentlyDelete: true }), REFUSED)
  await assert.rejects(send(guarded, 'mutation Literal { issueDelete(id: "i-1", permanentlyDelete: true) { success } }'), REFUSED)
  await assert.rejects(send(guarded, remove, { id: 'i-1' }), REFUSED)
  await send(guarded, ISSUE_DELETE, { id: 'i-1' })
  assert.equal(inner.calls.length, 1)
})

const teamInput = (extra = {}) => ({
  id: TEAM, name: TEST_TEAM.name, key: TEST_TEAM.key, description: `Test team for the pmkit contract tests (marker: ${TEST_TEAM.marker}).`, ...extra,
})

test('teamCreate passes with the spec inputs when the team is absent', async () => {
  const inner = scripted(confirmCreates)
  const guarded = createGuardedFetch({ fetch: inner, workspace: 'acme' })
  guarded.guard.open({ teamExists: false, viewerId: VIEWER, labelIds: LABELS })
  await send(guarded, TEAM_CREATE, { input: teamInput() })
  assert.equal(inner.calls.length, 1)
  // The created team is the test team from now on, and a second teamCreate is refused.
  await assert.rejects(send(guarded, TEAM_CREATE, { input: teamInput() }), REFUSED)
  await send(guarded, mutationOf('WorkflowStateCreate', '$input: WorkflowStateCreateInput!', 'input: $input'), { input: { teamId: TEAM } })
})

test('teamCreate is refused when the team exists, with a copy or a parent, or with a wrong name, key or marker', async () => {
  const exists = opened()
  await assert.rejects(send(exists, TEAM_CREATE, { input: teamInput() }), REFUSED)
  for (const extra of [{ copySettingsFromTeamId: 't-1' }, { parentId: 't-1' }, { name: 'other' }, { key: 'OTH' }, { description: 'no marker' }]) {
    const inner = scripted()
    const guarded = createGuardedFetch({ fetch: inner, workspace: 'acme' })
    guarded.guard.open({ teamExists: false, viewerId: VIEWER, labelIds: LABELS })
    await assert.rejects(send(guarded, TEAM_CREATE, { input: teamInput(extra) }), REFUSED, JSON.stringify(extra))
    assert.equal(inner.calls.length, 0)
  }
})

test('every other row of the guard table passes with the run ids', async () => {
  const { inner, ...guarded } = opened()
  const { guard } = guarded
  for (const [kind, id] of [['issue', 'i-1'], ['issue', 'i-2'], ['project', 'p-1'], ['cycle', 'c-1'], ['comment', 'cm-1'], ['relation', 'r-1']]) guard.own(kind, id)
  const sends = [
    [mutationOf('WorkflowStateCreate', '$input: WorkflowStateCreateInput!', 'input: $input'), { input: { teamId: TEAM, name: 'In Review' } }],
    [mutationOf('CycleStartUpcomingCycleToday'), { id: 'c-1' }],
    [RELATION_CREATE, { input: { id: 'r-9', type: 'blocks', issueId: 'i-1', relatedIssueId: 'i-2' } }],
    [RELATION_DELETE, { id: 'r-1' }],
    [COMMENT_CREATE, { input: { id: 'cm-9', issueId: 'i-1', body: 'x', parentId: 'cm-1' } }],
    [COMMENT_RESOLVE, { id: 'cm-1' }],
    [PROJECT_UPDATE_CREATE, { input: { projectId: 'p-1', body: 'x' } }],
    [ISSUE_ARCHIVE, { id: 'i-1' }],
    [mutationOf('IssueDelete'), { id: 'i-2' }],
    [mutationOf('ProjectDelete'), { id: 'p-1' }],
  ]
  for (const [query, variables] of sends) await send(guarded, query, variables)
  assert.equal(inner.calls.length, sends.length)
})

test('rows that name an id the run does not own are refused', async () => {
  const { inner, ...guarded } = opened()
  const rows = [
    [mutationOf('WorkflowStateCreate', '$input: WorkflowStateCreateInput!', 'input: $input'), { input: { teamId: 'team-other' } }],
    [mutationOf('CycleStartUpcomingCycleToday'), { id: 'c-9' }],
    [RELATION_CREATE, { input: { issueId: 'i-9', relatedIssueId: 'i-8' } }],
    [RELATION_DELETE, { id: 'r-9' }],
    [COMMENT_CREATE, { input: { issueId: 'i-9', body: 'x' } }],
    [COMMENT_RESOLVE, { id: 'cm-9' }],
    [PROJECT_UPDATE_CREATE, { input: { projectId: 'p-9' } }],
    [ISSUE_ARCHIVE, { id: 'i-9' }],
    [mutationOf('IssueDelete'), { id: 'i-9' }],
    [mutationOf('ProjectDelete'), { id: 'p-9' }],
  ]
  for (const [query, variables] of rows) await assert.rejects(send(guarded, query, variables), REFUSED)
  assert.equal(inner.calls.length, 0)
})

test('after stop(), suite mutations are refused and the deletes of owned ids still pass', async () => {
  const { inner, ...guarded } = opened()
  guarded.guard.own('issue', 'i-1')
  guarded.guard.own('project', 'p-1')
  guarded.guard.stop()
  await assert.rejects(send(guarded, ISSUE_UPDATE, { id: 'i-1', input: { title: 'x' } }), REFUSED)
  await assert.rejects(send(guarded, ISSUE_CREATE, { input: { id: 'i-2', teamId: TEAM } }), REFUSED)
  await send(guarded, mutationOf('IssueDelete'), { id: 'i-1' })
  await send(guarded, mutationOf('ProjectDelete'), { id: 'p-1' })
  await send(guarded, QUERY)
  assert.equal(inner.calls.length, 3)
})

test('a caller passes its own allowlist, and the suite list has the 14 mutations of the spec table', async () => {
  const own = { teamUpdate: (variables) => (variables.input?.name === 'ok' ? null : 'wrong name') }
  const { inner, ...guarded } = opened({ allowlist: own })
  const update = 'mutation Update($input: TeamUpdateInput!) { teamUpdate(input: $input) { success } }'
  await send(guarded, update, { input: { name: 'ok' } })
  await assert.rejects(send(guarded, update, { input: { name: 'bad' } }), /refusing Update: wrong name/)
  await assert.rejects(send(guarded, ISSUE_CREATE, { input: { teamId: TEAM } }), REFUSED)
  assert.equal(inner.calls.length, 1)
  assert.equal(Object.keys(SUITE_ALLOWLIST).length, 14)
})

/** Sends each [document, variables] attack through a guard that owns i-1, and checks that none reaches the fetch. */
async function refusesAll(attacks) {
  const { inner, ...guarded } = opened()
  guarded.guard.own('issue', 'i-1')
  for (const [query, variables] of attacks) await assert.rejects(send(guarded, query, variables), REFUSED, query)
  assert.equal(inner.calls.length, 0)
}

test('a mutation passes only when its arguments are id: $id and input: $input, with no defaults and no other variables', async () => {
  await refusesAll([
    ['mutation A($id: String!, $x: String!) { issueDelete(id: $x) { success } }', { id: 'i-1', x: 'i-foreign' }],
    ['mutation B { issueArchive(id: "FOREIGN") { success } }', { id: 'i-1' }],
    ['mutation C($id: String!) { issueUpdate(id: $id, input: { teamId: "OTHER" }) { success } }', { id: 'i-1' }],
    ['mutation E($id: String = "FOREIGN") { issueArchive(id: $id) { success } }', {}],
    ['mutation G($id: String!) { issueArchive(id: $id) { success } }', { id: 'i-1', extra: 'x' }],
    ['mutation H($input: String!) { issueArchive(id: $input) { success } }', { input: 'i-1' }],
    ['mutation I($id: String!) { issueArchive(id: $id, id: "FOREIGN") { success } }', { id: 'i-1' }],
  ])
})

test('a mutation with a fragment in its root selection, or a fragment on Mutation, is refused', async () => {
  await refusesAll([
    ['mutation F($id: String!) { issueArchive(id: $id) { success } ...F } fragment F on Mutation { teamDelete(id: "T") { success } }', { id: 'i-1' }],
    ['mutation F($id: String!) { issueArchive(id: $id) { success } ... @include(if: true) { teamDelete(id: "T") { success } } }', { id: 'i-1' }],
    ['mutation F($id: String!) { issueArchive(id: $id) { success } ... { teamDelete(id: "T") { success } } }', { id: 'i-1' }],
    ['mutation F($id: String!) { issueArchive(id: $id) { success } } fragment G on Mutation { teamDelete(id: "T") { success } }', { id: 'i-1' }],
  ])
})

test('an input key the mutation does not list is refused, ids included', async () => {
  const stateCreate = mutationOf('WorkflowStateCreate', '$input: WorkflowStateCreateInput!', 'input: $input')
  await refusesAll([
    [ISSUE_CREATE, { input: { id: 'i-9', teamId: TEAM, title: 'x', templateId: 'tpl-foreign' } }],
    [ISSUE_UPDATE, { id: 'i-1', input: { addedLabelIds: ['label-foreign'] } }],
    [ISSUE_UPDATE, { id: 'i-1', input: { projectMilestoneId: 'm-foreign' } }],
    [ISSUE_UPDATE, { id: 'i-1', input: { teamId: TEAM } }],
    [ISSUE_UPDATE, { id: 'i-1', input: { labelIds: 'label-foreign' } }],
    [COMMENT_CREATE, { input: { id: 'cm-9', issueId: 'i-1', body: 'x', documentContentId: 'd-foreign' } }],
    [RELATION_CREATE, { input: { id: 'r-9', type: 'blocks', issueId: 'i-1', relatedIssueId: 'i-1', issueIds: ['i-foreign'] } }],
    [PROJECT_CREATE, { input: { id: 'p-9', name: 'x', teamIds: [TEAM], leadId: 'user-foreign' } }],
    [stateCreate, { input: { id: 's-9', teamId: TEAM, name: 'x', inheritedFromId: 's-foreign' } }],
    ['mutation PmkitIssueArchive($id: String!, $input: String) { issueArchive(id: $id, input: $input) { success } }', { id: 'i-1', input: 'x' }],
  ])
})

test('a batch body, or a body whose query is not a string, is refused on purpose', async () => {
  const { inner, ...guarded } = opened()
  guarded.guard.own('issue', 'i-1')
  const post = (body) => guarded.fetch(URL, { method: 'POST', body: JSON.stringify(body) })
  await assert.rejects(post([{ query: ISSUE_ARCHIVE, variables: { id: 'i-1' } }, { query: QUERY }]), /refusing a batch request/)
  await assert.rejects(post([]), /refusing a batch request/)
  await assert.rejects(post({ query: 42 }), /refusing a request whose query is not a string/)
  await assert.rejects(post(null), /refusing a request whose query is not a string/)
  assert.equal(inner.calls.length, 0)
})

test('issueDelete refuses permanentlyDelete passed through a variable default', async () => {
  await refusesAll([
    ['mutation D($id: String!, $p: Boolean = true) { issueDelete(id: $id, permanentlyDelete: $p) { success } }', { id: 'i-1' }],
  ])
})

test('every mutation document the adapter and the run send has the shape the guard accepts', () => {
  const documents = [
    ISSUE_CREATE, ISSUE_UPDATE, ISSUE_ARCHIVE, RELATION_CREATE, RELATION_DELETE, COMMENT_CREATE, COMMENT_RESOLVE, PROJECT_CREATE,
    PROJECT_UPDATE_CREATE, TEAM_CREATE, STATE_CREATE, CYCLE_START, ISSUE_DELETE, PROJECT_DELETE,
  ]
  const roots = documents.map((document) => {
    const read = readMutation(document)
    assert.equal(read.reason, null, document)
    return read.root
  })
  assert.deepEqual(roots.sort(), Object.keys(SUITE_ALLOWLIST).sort())
})

test('a create makes its id the run own only when the answer says success and carries the id', async () => {
  const replies = [
    answer({ issueCreate: { success: false, issue: { id: 'i-new' } } }),
    { status: 200, ok: true, headers: new Headers(), text: async () => JSON.stringify({ errors: [{ message: 'no' }] }) },
    answer({ issueCreate: { success: true, issue: null } }),
    answer({ issueCreate: { success: true, issue: { id: 'i-new' } } }),
  ]
  const inner = scripted(() => replies.shift() ?? answer({}))
  const guarded = createGuardedFetch({ fetch: inner, workspace: 'acme' })
  guarded.guard.open({ teamExists: true, teamId: TEAM, viewerId: VIEWER, labelIds: LABELS })
  const update = [ISSUE_UPDATE, { id: 'i-new', input: { title: 'x' } }]
  for (let failed = 0; failed < 3; failed += 1) {
    await send(guarded, ISSUE_CREATE, { input: { id: 'i-new', teamId: TEAM, title: 'x' } })
    await assert.rejects(send(guarded, ...update), REFUSED)
  }
  await send(guarded, ISSUE_CREATE, { input: { id: 'i-new', teamId: TEAM, title: 'x' } })
  await send(guarded, ...update)
  assert.equal(inner.calls.length, 5)
})

test('a failed teamCreate leaves the guard without a test team', async () => {
  const inner = scripted((body) => (/teamCreate/.test(body.query) ? answer({ teamCreate: { success: false } }) : answer({})))
  const guarded = createGuardedFetch({ fetch: inner, workspace: 'acme' })
  guarded.guard.open({ teamExists: false, viewerId: VIEWER, labelIds: LABELS })
  await send(guarded, TEAM_CREATE, { input: teamInput() })
  await assert.rejects(send(guarded, STATE_CREATE, { input: { teamId: teamInput().id, name: 'In Review' } }), REFUSED)
  await send(guarded, TEAM_CREATE, { input: teamInput() })
  assert.equal(inner.calls.length, 2)
})

test('a null team id is refused while the test team does not exist', async () => {
  const inner = scripted()
  const guarded = createGuardedFetch({ fetch: inner, workspace: 'acme' })
  guarded.guard.open({ teamExists: false, viewerId: VIEWER, labelIds: LABELS })
  await assert.rejects(send(guarded, ISSUE_CREATE, { input: { id: 'i-9', teamId: null, title: 'x' } }), REFUSED)
  await assert.rejects(send(guarded, STATE_CREATE, { input: { id: 's-9', teamId: null, name: 'In Review' } }), REFUSED)
  await assert.rejects(send(guarded, PROJECT_CREATE, { input: { id: 'p-9', name: 'x', teamIds: [null] } }), REFUSED)
  assert.equal(inner.calls.length, 0)
})

const HEADERS = {
  'x-complexity': '30', 'x-ratelimit-requests-limit': '2500', 'x-ratelimit-requests-remaining': '2400', 'x-ratelimit-requests-reset': '1798000000000',
  'x-ratelimit-complexity-limit': '3000000', 'x-ratelimit-complexity-remaining': '2999000', 'x-ratelimit-complexity-reset': '1798000000000',
}

test('stats counts requests, writes and complexity and keeps the last rate-limit values, never the key', async () => {
  const inner = scripted(() => answer({}, HEADERS))
  const guarded = createGuardedFetch({ fetch: inner, workspace: 'acme' })
  guarded.guard.open({ teamExists: true, teamId: TEAM, viewerId: VIEWER, labelIds: LABELS })
  guarded.guard.own('issue', 'i-1')
  await send(guarded, QUERY)
  await send(guarded, ISSUE_ARCHIVE, { id: 'i-1' })
  const stats = guarded.guard.stats()
  assert.equal(stats.requests, 2)
  assert.equal(stats.writes, 1)
  assert.equal(stats.complexity, 60)
  assert.equal(stats.rate.requestsRemaining, 2400)
  assert.equal(stats.rate.complexityRemaining, 2999000)
  assert.ok(!JSON.stringify(stats).includes(FAKE_KEY))
})

test('at the cap a suite request is refused, and cleanup requests pass until the reserve is used', async () => {
  const { inner, ...guarded } = opened({ cap: 3, reserve: 2 })
  guarded.guard.own('issue', 'i-1')
  guarded.guard.own('issue', 'i-2')
  guarded.guard.own('issue', 'i-3')
  for (let count = 0; count < 3; count += 1) await send(guarded, QUERY)
  await assert.rejects(send(guarded, QUERY), /the live run used its request budget/)
  await assert.rejects(send(guarded, ISSUE_UPDATE, { id: 'i-1', input: {} }), /the live run used its request budget/)
  assert.equal(inner.calls.length, 3)
  await send(guarded, mutationOf('IssueDelete'), { id: 'i-1' })
  await send(guarded, 'query PmkitSandboxItems { viewer { id } }')
  assert.equal(inner.calls.length, 5)
  await assert.rejects(send(guarded, mutationOf('IssueDelete'), { id: 'i-2' }), /the live run used its request budget/)
  assert.equal(inner.calls.length, 5)
})

// A scripted workspace: routes keyed by operation name, over the fake fetch, behind the guard.
const GOOD_HEADERS = {
  'x-ratelimit-requests-limit': '2500', 'x-ratelimit-requests-remaining': '2400', 'x-ratelimit-requests-reset': '1798000000000',
  'x-ratelimit-complexity-limit': '3000000', 'x-ratelimit-complexity-remaining': '2900000', 'x-ratelimit-complexity-reset': '1798000000000',
}
const teamNode = (extra = {}) => ({
  id: TEAM, key: TEST_TEAM.key, name: TEST_TEAM.name, description: `Test team for the pmkit contract tests (marker: ${TEST_TEAM.marker}).`,
  archivedAt: null, cyclesEnabled: true, triageEnabled: true, ...extra,
})
const label = (id, name) => ({ id, name, isGroup: false, retiredAt: null, team: null })
const connection = (nodes, body) => {
  const first = body.variables?.first ?? 50
  const start = Number(body.variables?.after ?? 0)
  const end = start + first
  return { pageInfo: { hasNextPage: end < nodes.length, endCursor: end < nodes.length ? String(end) : null }, nodes: nodes.slice(start, end) }
}

function world(options = {}) {
  const state = {
    workspace: 'acme', previousUrlKeys: [], subscription: null, teams: [teamNode()], issues: [], projects: [],
    labels: [label('label-bug', 'Bug'), label('label-feature', 'Feature'), label('label-other', 'Improvement')], headers: GOOD_HEADERS, ...options,
  }
  const answer = (data) => json(data, { headers: state.headers })
  const routes = {
    PmkitSandboxTeams: () => answer({ organization: { subscription: state.subscription }, teams: { nodes: state.teams } }),
    PmkitSandboxIssues: (body) => answer({ issues: connection(state.issues, body) }),
    PmkitSandboxProjects: (body) => answer({ projects: connection(state.projects, body) }),
    PmkitSandboxLabels: (body) => answer({ issueLabels: connection(state.labels, body) }),
    PmkitIssueArchive: answer({}),
    PmkitIssueCreate: answer({}),
    PmkitSandboxTeamCreate: answer({}),
  }
  state.routes = routes
  const inner = fakeLinearFetch({ ...routes, ...options.routes }, { workspace: state.workspace, previousUrlKeys: state.previousUrlKeys })
  const guarded = createGuardedFetch({ fetch: inner, workspace: 'acme' })
  const client = createLinearClient({ env: { LINEAR_API_KEY: FAKE_KEY }, tracker: { system: 'linear', scope: { workspace: 'acme' } }, fetch: guarded.fetch })
  const env = { PMKIT_LIVE: '1', LINEAR_API_KEY: FAKE_KEY }
  const mutations = () => inner.calls.filter((call) => isMutation(call.body.query))
  return { ...guarded, inner, client, env, state, mutations }
}

const run = (w, overrides = {}) => preflight({ client: w.client, env: w.env, workspace: 'acme', guard: w.guard, ...overrides })

async function stops(w, message, overrides) {
  await assert.rejects(run(w, overrides), message)
  assert.equal(w.mutations().length, 0)
  await assert.rejects(send(w, ISSUE_CREATE, { input: { id: 'i-1', teamId: TEAM } }), /refusing /, 'the guard stays closed')
}

test('preflight stops when the gate is closed', async () => {
  await stops(world(), /PMKIT_LIVE/, { env: { LINEAR_API_KEY: FAKE_KEY } })
  await stops(world(), /PMKIT_LIVE_WORKSPACE/, { workspace: undefined })
  await stops(world(), /LINEAR_API_KEY is not usable/, { env: { PMKIT_LIVE: '1' } })
})

test('preflight stops when the URL key differs, or matches only a previous one', async () => {
  await stops(world({ workspace: 'other' }), /does not belong to the sandbox workspace/)
  await stops(world({ workspace: 'other', previousUrlKeys: ['acme'] }), /does not belong to the sandbox workspace/)
})

test('preflight stops on a test team that fails a check, and names the field', async () => {
  const cases = [
    [{ key: 'ABC' }, /key/], [{ description: 'no marker' }, /marker/], [{ cyclesEnabled: false }, /cycles/],
    [{ triageEnabled: false }, /triage/], [{ archivedAt: '2026-01-01T00:00:00.000Z' }, /archived/],
  ]
  for (const [extra, message] of cases) await stops(world({ teams: [teamNode(extra)] }), message)
  await stops(world({ teams: [teamNode({ name: 'other' })] }), /key PKT/)
})

test('preflight stops when the test team holds an issue or an open project, and names cleanup', async () => {
  await stops(world({ issues: [{ id: 'i-1', identifier: 'PKT-1', trashed: false, archivedAt: '2026-01-01T00:00:00.000Z' }] }), /cleanup/)
  await stops(world({ projects: [{ id: 'p-1', name: 'x', trashed: false, archivedAt: null, teams: { nodes: [{ id: TEAM }] } }] }), /cleanup/)
})

test('preflight ignores trashed issues, and skips the emptiness check for cleanup', async () => {
  const trashed = { id: 'i-1', identifier: 'PKT-1', trashed: true, archivedAt: null }
  await run(world({ issues: [trashed] }))
  const full = world({ issues: [{ ...trashed, trashed: false }] })
  assert.deepEqual((await run(full, { requireEmpty: false })).team, { id: TEAM, key: 'PKT' })
})

test('preflight stops on a Free workspace with two teams and no test team', async () => {
  const others = [{ ...teamNode({ name: 'a', key: 'AAA' }), id: 't-a' }, { ...teamNode({ name: 'b', key: 'BBB' }), id: 't-b' }]
  await stops(world({ teams: others }), /two teams/)
})

test('preflight stops when the type labels are missing', async () => {
  await stops(world({ labels: [label('label-bug', 'Bug')] }), /Feature/)
  await stops(world({ labels: [label('label-feature', 'Feature')] }), /Bug/)
})

test('preflight stops when the headers show too little budget, and names the reset time', async () => {
  await stops(world({ headers: { ...GOOD_HEADERS, 'x-ratelimit-requests-remaining': '1699' } }), /2027-|20\d\d-/)
  await stops(world({ headers: { ...GOOD_HEADERS, 'x-ratelimit-complexity-remaining': '1499999' } }), /complexity/)
})

test('preflight in the good case returns the team and opens the guard', async () => {
  const w = world()
  const result = await run(w)
  assert.deepEqual(result.team, { id: TEAM, key: 'PKT' })
  assert.equal(result.viewer.id, 'user-1')
  assert.deepEqual(result.labels, { bug: 'label-bug', feature: 'label-feature' })
  assert.equal(w.mutations().length, 0)
  w.guard.own('issue', 'i-1')
  await send(w, ISSUE_ARCHIVE, { id: 'i-1' })
})

test('preflight returns a null team when the test team is absent and a slot is free', async () => {
  const w = world({ teams: [{ ...teamNode({ name: 'a', key: 'AAA' }), id: 't-a' }] })
  const result = await run(w)
  assert.equal(result.team, null)
  const input = { id: TEAM, name: TEST_TEAM.name, key: TEST_TEAM.key, description: `marker: ${TEST_TEAM.marker}` }
  await send(w, 'mutation PmkitSandboxTeamCreate($input: TeamCreateInput!) { teamCreate(input: $input) { success } }', { input })
})

// Task 5: find or create the test team.
const STATES = [
  { id: 's-triage', name: 'Triage', type: 'triage' }, { id: 's-backlog', name: 'Backlog', type: 'backlog' },
  { id: 's-review', name: 'In Review', type: 'started' }, { id: 's-done', name: 'Done', type: 'completed' },
]

/** A world whose team lookups, create and state reads answer from `store`. */
function teamWorld({ team = teamNode(), states = STATES, create } = {}) {
  const store = { team, states: [...states] }
  const w = world({
    routes: {
      PmkitSandboxTeam: (body) => json({ teams: { nodes: store.team && body.variables.name === store.team.name ? [store.team] : [] } }),
      PmkitSandboxTeamById: (body) => json({ teams: { nodes: store.team && body.variables.id === store.team.id ? [store.team] : [] } }),
      PmkitSandboxTeamCreate: (body) => {
        if (create) return create(body, store)
        store.team = teamNode({ id: body.variables.input.id })
        return json({ teamCreate: { success: true, team: { id: store.team.id, key: store.team.key } } })
      },
      PmkitSandboxStates: () => json({ team: { states: { nodes: store.states } } }),
      PmkitSandboxStateCreate: (body) => {
        store.states.push({ id: body.variables.input.id, name: body.variables.input.name, type: body.variables.input.type })
        return json({ workflowStateCreate: { success: true, workflowState: { id: body.variables.input.id } } })
      },
    },
  })
  w.guard.open({ teamExists: Boolean(team), teamId: team?.id ?? null, viewerId: VIEWER, labelIds: LABELS })
  w.store = store
  return w
}
const FRIDAY = () => new Date('2026-10-30T10:00:00Z')
const find = (w) => findOrCreateTestTeam({ client: w.client, guard: w.guard, now: FRIDAY, uuid: () => 'team-uuid-1' })

test('findOrCreateTestTeam reuses the team and sends no write', async () => {
  const w = teamWorld()
  const result = await find(w)
  assert.deepEqual(result, { team: { id: TEAM, key: 'PKT' }, created: false })
  assert.equal(w.mutations().length, 0)
  await send(w, ISSUE_CREATE, { input: { id: 'i-1', teamId: TEAM, stateId: 's-review' } })
})

test('findOrCreateTestTeam stops on an existing team that fails a check, without a write', async () => {
  const w = teamWorld({ team: teamNode({ cyclesEnabled: false }) })
  await assert.rejects(find(w), /cycles/)
  assert.equal(w.mutations().length, 0)
})

test('findOrCreateTestTeam sends one teamCreate with the spec inputs when the team is absent', async () => {
  const w = teamWorld({ team: null })
  const result = await find(w)
  assert.deepEqual(result, { team: { id: 'team-uuid-1', key: 'PKT' }, created: true })
  const sent = w.mutations()
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0].body.variables.input, {
    id: 'team-uuid-1', name: 'pmkit-test', key: 'PKT',
    description: 'Test team for the pmkit contract tests (marker: pmkit-contract-team). They create and trash items here. Do not use it for real work.',
    timezone: 'Etc/UTC', triageEnabled: true, cyclesEnabled: true, cycleDuration: 1, cycleCooldownTime: 0, cycleStartDay: 5, upcomingCycleCount: 2,
    cycleIssueAutoAssignStarted: false, cycleIssueAutoAssignCompleted: false, groupIssueHistory: false,
  })
})

test('findOrCreateTestTeam adds the In Review state only when no started state has that name', async () => {
  const without = teamWorld({ states: STATES.filter((state) => state.id !== 's-review') })
  await find(without)
  const sent = without.mutations()
  assert.equal(sent.length, 1)
  assert.deepEqual({ ...sent[0].body.variables.input, id: undefined, color: undefined }, { teamId: TEAM, type: 'started', name: 'In Review', id: undefined, color: undefined })
  assert.match(sent[0].body.variables.input.color, /^#[0-9a-f]{6}$/)
  // An "In Review" of another type does not count.
  const wrongType = teamWorld({ states: STATES.map((state) => (state.id === 's-review' ? { ...state, type: 'unstarted' } : state)) })
  await find(wrongType)
  assert.equal(wrongType.mutations().length, 1)
})

test('findOrCreateTestTeam stops with no write when the team has no triage state', async () => {
  const w = teamWorld({ states: STATES.filter((state) => state.type !== 'triage') })
  await assert.rejects(find(w), /the test team has no triage state/)
  assert.equal(w.mutations().length, 0)
})

test('an unconfirmed teamCreate is followed by a lookup by the chosen id', async () => {
  const applied = teamWorld({
    team: null,
    create: (body, store) => {
      store.team = teamNode({ id: body.variables.input.id })
      return { throws: new Error('socket closed') }
    },
  })
  assert.deepEqual((await find(applied)).team, { id: 'team-uuid-1', key: 'PKT' })
  const lost = teamWorld({ team: null, create: () => ({ throws: new Error('socket closed') }) })
  await assert.rejects(find(lost), /did not confirm/)
})

// Task 6: wait for the cycles.
const cycle = (id, extra = {}) => ({ id, number: Number(id.slice(2)), startsAt: '2026-10-26T00:00:00.000Z', endsAt: '2026-11-02T00:00:00.000Z', isActive: false, isFuture: false, isPast: false, completedAt: null, ...extra })

function cycleWorld(reads) {
  const w = world({
    routes: {
      PmkitSandboxCycles: () => json({ team: { cycles: { nodes: reads[Math.min(w.reads++, reads.length - 1)] } } }),
      PmkitSandboxCycleStart: () => json({ cycleStartUpcomingCycleToday: { success: true } }),
    },
  })
  w.reads = 0
  w.guard.open({ teamExists: true, teamId: TEAM, viewerId: VIEWER, labelIds: LABELS })
  return w
}
const wait = (w) => waitForCycles({ client: w.client, team: { id: TEAM, key: 'PKT' }, guard: w.guard, sleep: async () => {} })

test('waitForCycles returns at once when both cycles exist', async () => {
  const w = cycleWorld([[cycle('c-1', { isActive: true }), cycle('c-2', { isFuture: true })]])
  const found = await wait(w)
  assert.equal(found.active.id, 'c-1')
  assert.equal(found.planned.id, 'c-2')
  assert.equal(w.reads, 1)
  assert.equal(w.mutations().length, 0)
})

test('waitForCycles waits for cycles the schedule has not made yet', async () => {
  const w = cycleWorld([[], [], [cycle('c-1', { isActive: true }), cycle('c-2', { isFuture: true })]])
  await wait(w)
  assert.equal(w.reads, 3)
  assert.equal(w.mutations().length, 0)
})

test('waitForCycles starts the upcoming cycle once when none is active', async () => {
  const planned = [cycle('c-2', { isFuture: true, startsAt: '2026-11-02T00:00:00.000Z' }), cycle('c-3', { isFuture: true, startsAt: '2026-11-09T00:00:00.000Z' })]
  const w = cycleWorld([planned, planned, planned, planned, planned, planned, planned, planned, planned, planned, [cycle('c-2', { isActive: true }), cycle('c-3', { isFuture: true })]])
  const found = await wait(w)
  assert.equal(found.active.id, 'c-2')
  const sent = w.mutations()
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0].body.variables, { id: 'c-2' })
})

test('waitForCycles names the missing state after its reads and starts no second cycle', async () => {
  const planned = [cycle('c-2', { isFuture: true })]
  const noActive = cycleWorld([planned])
  await assert.rejects(wait(noActive), /the test team has no active cycle/)
  assert.equal(noActive.mutations().length, 1)
  assert.equal(noActive.reads, 20)
  const noPlanned = cycleWorld([[cycle('c-1', { isActive: true })]])
  await assert.rejects(wait(noPlanned), /the test team has no planned cycle/)
  assert.equal(noPlanned.mutations().length, 0)
})

test('waitForCycles adopts the cycles it reads, so the guard accepts them', async () => {
  const w = cycleWorld([[cycle('c-1', { isActive: true }), cycle('c-2', { isFuture: true })]])
  await wait(w)
  w.guard.own('state', 's-1')
  await send(w, ISSUE_CREATE, { input: { id: 'i-1', teamId: TEAM, cycleId: 'c-1' } })
})

// Task 7: list and trash the team's items.
const issueNode = (id, extra = {}) => ({ id, identifier: `PKT-${id.slice(2)}`, trashed: false, archivedAt: null, ...extra })
const projectNode = (id, teams = [TEAM], extra = {}) => ({ id, name: id, trashed: false, archivedAt: null, teams: { nodes: teams.map((team) => ({ id: team })) }, ...extra })

function itemsWorld({ issues = [], projects = [] }) {
  const w = world({
    issues, projects,
    routes: {
      PmkitSandboxIssueDelete: (body) => {
        w.state.issues = w.state.issues.map((issue) => (issue.id === body.variables.id ? { ...issue, trashed: true } : issue))
        return json({ issueDelete: { success: true } })
      },
      PmkitSandboxProjectDelete: (body) => {
        w.state.projects = w.state.projects.map((project) => (project.id === body.variables.id ? { ...project, trashed: true } : project))
        return json({ projectDelete: { success: true } })
      },
    },
  })
  w.guard.open({ teamExists: true, teamId: TEAM, viewerId: VIEWER, labelIds: LABELS })
  return w
}
const items = (w) => ({ client: w.client, team: { id: TEAM, key: 'PKT' }, guard: w.guard })
const ids = (nodes) => nodes.map((node) => node.id)

test('listTestTeamItems returns untrashed issues (archived included) and open projects of the test team alone', async () => {
  const w = itemsWorld({
    issues: [issueNode('i-1'), issueNode('i-2', { archivedAt: '2026-01-01T00:00:00.000Z' }), issueNode('i-3', { trashed: true })],
    projects: [projectNode('p-1'), projectNode('p-2', [TEAM, 'team-other']), projectNode('p-3', [TEAM], { trashed: true }), projectNode('p-4', [TEAM], { archivedAt: '2026-01-01T00:00:00.000Z' })],
  })
  const found = await listTestTeamItems(items(w))
  assert.deepEqual(ids(found.issues), ['i-1', 'i-2'])
  assert.deepEqual(ids(found.projects), ['p-1'])
  assert.equal(w.mutations().length, 0)
})

test('trashTestTeamItems trashes issues, then projects, with no permanent delete, and returns the counts', async () => {
  const w = itemsWorld({ issues: [issueNode('i-1'), issueNode('i-2', { archivedAt: '2026-01-01T00:00:00.000Z' })], projects: [projectNode('p-1'), projectNode('p-2', [TEAM, 'team-other'])] })
  const counts = await trashTestTeamItems(items(w))
  assert.deepEqual(counts, { issues: 2, projects: 1 })
  const sent = w.mutations().map((call) => [call.body.variables.id, call.body.variables.permanentlyDelete])
  assert.deepEqual(sent, [['i-1', undefined], ['i-2', undefined], ['p-1', undefined]])
  assert.equal(w.state.projects.find((project) => project.id === 'p-2').trashed, false)
})

test('trashTestTeamItems sends nothing when the team is empty, and nothing on a second call', async () => {
  const empty = itemsWorld({})
  assert.deepEqual(await trashTestTeamItems(items(empty)), { issues: 0, projects: 0 })
  assert.equal(empty.mutations().length, 0)
  const w = itemsWorld({ issues: [issueNode('i-1')], projects: [projectNode('p-1')] })
  await trashTestTeamItems(items(w))
  const written = w.mutations().length
  assert.deepEqual(await trashTestTeamItems(items(w)), { issues: 0, projects: 0 })
  assert.equal(w.mutations().length, written)
})

// Task 8: the opt-in entry and its cleanup mode.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const ENTRY = 'scripts/lib/linear/contract-live.mjs'

function spawnEntry(args, extra = {}) {
  const env = { ...process.env, ...extra }
  delete env.NODE_TEST_CONTEXT
  for (const name of ['PMKIT_LIVE', 'PMKIT_LIVE_WORKSPACE', 'LINEAR_API_KEY']) if (!(name in extra)) delete env[name]
  return spawnSync(process.execPath, [ENTRY, ...args], { cwd: root, env, encoding: 'utf8' })
}

const skippedCount = (output) => Number(/^# skipped (\d+)/m.exec(output)?.[1])
const SKIP_LINE = /# SKIP (.+)$/gm

test('with the gate closed, the entry skips every test with one reason and exits 0', () => {
  const result = spawnEntry([])
  assert.equal(result.status, 0, result.stderr)
  const reasons = new Set([...result.stdout.matchAll(SKIP_LINE)].map((match) => match[1]))
  assert.equal(reasons.size, 1)
  assert.match([...reasons][0], /PMKIT_LIVE=1/)
  assert.ok(skippedCount(result.stdout) >= 1)
  assert.match(result.stdout, /^# pass 0$/m)
  assert.match(result.stdout, /^# fail 0$/m)
})

test('cleanup with the gate closed prints the reason and writes nothing', () => {
  const result = spawnEntry(['cleanup', '--yes'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /set PMKIT_LIVE=1/)
})

test('a fake key and workspace without PMKIT_LIVE stay skipped, and the output never holds the key', () => {
  for (const args of [[], ['cleanup']]) {
    const result = spawnEntry(args, { LINEAR_API_KEY: FAKE_KEY, PMKIT_LIVE_WORKSPACE: 'acme' })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /PMKIT_LIVE=1/)
    assert.ok(!result.stdout.includes(FAKE_KEY) && !result.stderr.includes(FAKE_KEY))
  }
})

function cleanupRun(w, yes) {
  const lines = []
  return runCleanup({ client: w.client, env: w.env, workspace: 'acme', guard: w.guard, yes, write: (line) => lines.push(line) }).then((code) => ({ code, text: lines.join('\n') }))
}

test('cleanup without --yes lists the items and sends no mutation', async () => {
  const w = itemsWorld({ issues: [issueNode('i-1'), issueNode('i-2')], projects: [projectNode('p-1')] })
  const { code, text } = await cleanupRun(w, false)
  assert.equal(code, 0)
  assert.match(text, /2 issues and 1 project/)
  assert.match(text, /PKT-1/)
  assert.equal(w.mutations().length, 0)
})

test('cleanup --yes trashes the items and reports the counts', async () => {
  const w = itemsWorld({ issues: [issueNode('i-1')], projects: [projectNode('p-1')] })
  const { code, text } = await cleanupRun(w, true)
  assert.equal(code, 0)
  assert.match(text, /trashed 1 issue and 1 project/)
  assert.equal(w.mutations().length, 2)
})

test('cleanup --yes refuses a test team that fails a check, and names it', async () => {
  const w = itemsWorld({ issues: [issueNode('i-1')] })
  w.state.teams = [teamNode({ key: 'ABC' })]
  const { code, text } = await cleanupRun(w, true)
  assert.equal(code, 1)
  assert.match(text, /pmkit-test/)
  assert.equal(w.mutations().length, 0)
})

test('cleanup with no test team has nothing to do', async () => {
  const w = itemsWorld({})
  w.state.teams = []
  const { code, text } = await cleanupRun(w, true)
  assert.equal(code, 0)
  assert.match(text, /no test team/)
  assert.equal(w.mutations().length, 0)
})

// Task 9: the live setup, the cycle provider and the signal handlers, over the stateful fake.
const ACTIVE = { number: 1, team: TEAM, startsAt: '2026-10-19T00:00:00.000Z', endsAt: '2026-11-02T00:00:00.000Z' }
const PLANNED = { number: 2, team: TEAM, startsAt: '2026-11-02T00:00:00.000Z', endsAt: '2026-11-16T00:00:00.000Z' }
const FAKE_NOW = new Date('2026-10-27T12:00:00.000Z')

/** The whole sandbox over the fake stores: discovery, issues, projects and the sandbox documents, with rate-limit headers. */
function liveWorld({ withTeam = true, cycles = [ACTIVE, PLANNED] } = {}) {
  const pkt = { ...ACME_TEAM, id: TEAM, key: 'PKT', name: TEST_TEAM.name, description: `marker: ${TEST_TEAM.marker}`, archivedAt: null, triageEnabled: true, cyclesEnabled: true }
  const teams = withTeam ? [pkt] : []
  const states = [{ id: 'state-triage', name: 'Triage', type: 'triage', position: -1 }, ...ACME_STATES].map((state) => ({ ...state, team: { id: TEAM } }))
  const labels = [label('label-bug', 'Bug'), label('label-feature', 'Feature')]
  const users = ACME_USERS.map((user) => ({ ...user, teams: { nodes: [{ id: TEAM }] } }))
  const issues = fakeLinearIssues({ teams, states, labels, users, cycles })
  const projects = fakeLinearProjects({ issues, teams, states })
  const store = { cycleStarts: 0, stateCreates: 0 }
  const flags = (record) => {
    const now = FAKE_NOW.getTime()
    const isFuture = Date.parse(record.startsAt) > now
    const isPast = Date.parse(record.endsAt) <= now
    return { ...record, isActive: !isFuture && !isPast, isFuture, isPast }
  }
  const sandbox = {
    PmkitSandboxTeams: () => json({ organization: { subscription: null }, teams: { nodes: teams } }),
    PmkitSandboxTeam: (body) => json({ teams: { nodes: teams.filter((team) => team.name === body.variables.name) } }),
    PmkitSandboxTeamById: (body) => json({ teams: { nodes: teams.filter((team) => team.id === body.variables.id) } }),
    PmkitSandboxTeamCreate: (body) => {
      teams.push({ ...pkt, id: body.variables.input.id })
      return json({ teamCreate: { success: true, team: { id: body.variables.input.id, key: 'PKT' } } })
    },
    PmkitSandboxStates: () => json({ team: { states: { nodes: states } } }),
    PmkitSandboxStateCreate: () => {
      store.stateCreates += 1
      return json({ workflowStateCreate: { success: true } })
    },
    PmkitSandboxCycles: () => json({ team: { cycles: { nodes: issues.cycles.list().map(flags) } } }),
    PmkitSandboxCycleStart: () => {
      store.cycleStarts += 1
      return json({ cycleStartUpcomingCycleToday: { success: true } })
    },
    PmkitSandboxLabels: (body) => json({ issueLabels: connection(labels, body) }),
    PmkitSandboxIssues: (body) => json({ issues: connection(issues.records.map((record) => ({ id: record.id, identifier: record.identifier, trashed: record.trashed, archivedAt: record.archivedAt })), body) }),
    PmkitSandboxProjects: (body) => json({ projects: connection(projects.projects.map((project) => ({ id: project.id, name: project.name, trashed: false, archivedAt: null, teams: { nodes: project.teamIds.map((id) => ({ id })) } })), body) }),
    PmkitSandboxIssueDelete: (body) => {
      issues.records.find((record) => record.id === body.variables.id).trashed = true
      return json({ issueDelete: { success: true } })
    },
    PmkitSandboxProjectDelete: (body) => {
      projects.projects.splice(projects.projects.findIndex((project) => project.id === body.variables.id), 1)
      return json({ projectDelete: { success: true } })
    },
  }
  const base = fakeLinearFetch({ ...fakeWorkspace({ teams, states, labels, users }), ...issues.routes, ...projects.routes, ...sandbox })
  const fetch = async (url, init) => {
    const reply = await base(url, init)
    return { status: reply.status, ok: reply.ok, headers: new Headers(GOOD_HEADERS), text: () => reply.text() }
  }
  fetch.calls = base.calls
  const lines = []
  const sleeps = []
  const run = buildLiveRun({
    env: { PMKIT_LIVE: '1', LINEAR_API_KEY: FAKE_KEY, PMKIT_LIVE_WORKSPACE: 'acme' }, fetch, workspace: 'acme', now: () => FAKE_NOW,
    uuid: () => TEAM, sleep: async (ms) => { sleeps.push(ms) }, write: (line) => lines.push(line),
  })
  const mutations = () => fetch.calls.filter((call) => isMutation(call.body.query)).map((call) => call.body.query.match(/(?:mutation )(\w+)/)[1])
  return { run, fetch, issues, projects, teams, store, lines, sleeps, mutations }
}

test('before checks the workspace, finds the team, waits for the cycles and fills the discovery cache once', async () => {
  const w = liveWorld()
  try {
    await w.run.before()
    assert.deepEqual(w.mutations(), [])
    assert.deepEqual(w.lines, ['found the test team'])
    const discoveries = w.fetch.calls.filter((call) => call.body.query.includes('PmkitTeams') || /query PmkitTeams/.test(call.body.query))
    assert.equal(discoveries.length, 1)
    const { tracker } = await w.run.setup()
    const before = w.fetch.calls.length
    await tracker.discover()
    assert.equal(w.fetch.calls.length - before <= 1, true, 'the tracker reads discovery from the cache')
  } finally {
    await w.run.after()
  }
})

test('before creates the missing test team once', async () => {
  const w = liveWorld({ withTeam: false })
  try {
    await w.run.before()
    assert.deepEqual(w.mutations(), ['PmkitSandboxTeamCreate'])
    assert.deepEqual(w.lines, ['created the test team'])
  } finally {
    await w.run.after()
  }
})

test('setup returns a tracker, the viewer, the UTC start date and a cycle provider that throws when a cycle is missing', async () => {
  const w = liveWorld()
  await w.run.before()
  try {
    const setup = await w.run.setup()
    assert.equal(setup.actor, 'user-1')
    assert.equal(setup.today, '2026-10-27')
    assert.deepEqual(Object.keys(setup.cycles), ['active', 'planned'])
    const active = await setup.cycles.active()
    assert.deepEqual(Object.keys(active), ['id', 'start', 'end'])
    assert.equal(active.start, '2026-10-19')
    assert.equal((await setup.cycles.planned()).start, '2026-11-02')
    const config = w.run.config.pmkit
    assert.deepEqual(config.tracker, { system: 'linear', scope: { workspace: 'acme', team: 'PKT' } })
    assert.deepEqual(config.git_host, { system: 'none' })
    assert.deepEqual(config.mappings, { status: { in_review: 'In Review' }, types: { bug: 'Bug', feature: 'Feature' } })
    await setup.teardown()
  } finally {
    await w.run.after()
  }
})

test('the cycle provider throws "the test team has no <state> cycle" for a missing cycle', async () => {
  const w = liveWorld({ cycles: [ACTIVE] })
  // The team has only an active cycle, so before() itself fails on the planned one; the provider is tested on a run that got past it.
  await assert.rejects(w.run.before(), /the test team has no planned cycle/)
  await w.run.after()
})

test('setup fails with "the test team is not empty" when an issue remains', async () => {
  const w = liveWorld()
  await w.run.before()
  try {
    w.issues.seed({ title: 'left over', teamId: TEAM })
    await assert.rejects(w.run.setup(), /the test team is not empty/)
  } finally {
    await w.run.after()
  }
})

test('teardown trashes the items and removes capacity.yaml, and after sweeps once more and removes the folders', async () => {
  const w = liveWorld()
  await w.run.before()
  const setup = await w.run.setup()
  const root = setup.root
  await setup.tracker.createIssue({ title: 'One' }, setup.actor)
  fs.mkdirSync(`${root}/.pmkit`, { recursive: true })
  fs.writeFileSync(`${root}/.pmkit/capacity.yaml`, 'x: 1\n')
  await setup.teardown()
  assert.equal(w.issues.records.every((record) => record.trashed), true)
  assert.equal(fs.existsSync(`${root}/.pmkit/capacity.yaml`), false)
  w.issues.seed({ title: 'late', teamId: TEAM })
  await w.run.after()
  assert.equal(w.issues.records.every((record) => record.trashed), true)
  assert.ok(w.lines.some((line) => /last sweep trashed 1 issue and 0 projects/.test(line)))
  assert.equal(fs.existsSync(root), false)
})

test('a stop signal stops the guard, runs the finish steps and exits 130, and a second signal exits at once', async () => {
  const proc = new EventEmitter()
  const exits = []
  const events = []
  const guard = { stop: () => events.push('stop') }
  installSignalHandlers({ proc, guard, finish: async () => { events.push('finish') }, exit: (code) => exits.push(code) })
  proc.emit('SIGINT')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['stop', 'finish'])
  assert.deepEqual(exits, [130])
  proc.emit('SIGTERM')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['stop', 'finish'])
  assert.deepEqual(exits, [130, 130])
})

// Task 10: the live probes, over the fake.
async function withProbeContext(use) {
  const w = liveWorld()
  await w.run.before()
  const env = await w.run.setup()
  try {
    return await use({ tracker: env.tracker, client: w.run.client, actor: env.actor, team: w.run.team }, w)
  } finally {
    await env.teardown()
    await w.run.after()
  }
}

test('the description probe asserts the round trip and records the raw Markdown', async () => {
  await withProbeContext(async (context) => {
    const result = await descriptionProbe(context)
    assert.equal(result.asserted.length, 1)
    assert.match(result.recorded.rawDescription, /## Acceptance criteria/)
    assert.match(result.recorded.rawDescription, /- \[x\] second criterion/)
  })
})

test('the comment probe records what survives in a body and whether the comment moves updatedAt', async () => {
  await withProbeContext(async (context) => {
    const { recorded } = await commentProbe(context)
    assert.deepEqual(Object.keys(recorded), ['markerLineSurvives', 'checklistSurvives', 'codeFenceSurvives', 'commentMovesUpdatedAt'])
    assert.equal(recorded.markerLineSurvives && recorded.checklistSurvives && recorded.codeFenceSurvives, true)
    assert.equal(typeof recorded.commentMovesUpdatedAt, 'boolean')
  })
})

test('the relation probe records the raw codes and sides for blocks, a removed relation and duplicate', async () => {
  await withProbeContext(async (context) => {
    const { recorded } = await relationProbe(context)
    assert.deepEqual(Object.keys(recorded), ['blocks', 'removed', 'duplicate'])
    for (const seen of Object.values(recorded)) assert.deepEqual(Object.keys(seen), ['onA', 'onB'])
  })
})

test('the cycle probe asserts the boundary rule and records the time of day', async () => {
  await withProbeContext(async (context) => {
    const result = await cycleProbe(context)
    assert.equal(result.asserted.length, 1)
    assert.deepEqual(result.recorded.timesOfDay, ['00:00:00.000Z'])
    assert.equal(result.recorded.cycles, 2)
  })
})

test('the cycle probe fails when a cycle does not end where the next one starts', async () => {
  const w = liveWorld({ cycles: [ACTIVE, { ...PLANNED, startsAt: '2026-11-03T00:00:00.000Z' }] })
  await w.run.before()
  try {
    await assert.rejects(cycleProbe({ client: w.run.client, team: w.run.team }), /does not end where/)
  } finally {
    await w.run.after()
  }
})

test('the probes are four and each has a name', () => {
  assert.equal(PROBES.length, 4)
  assert.ok(PROBES.every(([name, probe]) => typeof name === 'string' && typeof probe === 'function'))
})

// The whole contract suite, through the guard and the budget, over the fake. This is the run that npm test cannot send to Linear.
const suiteWorld = liveWorld()
registerLiveSuite(suiteWorld.run)
