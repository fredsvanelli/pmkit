// Tests of the Linear sandbox helper over scripted fetches. No test here opens a socket.
import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_KEY } from '../../fake-linear-api.mjs'
import {
  COMMENT_CREATE, COMMENT_RESOLVE, ISSUE_ARCHIVE, ISSUE_CREATE, ISSUE_UPDATE, RELATION_CREATE, RELATION_DELETE,
} from './documents.mjs'
import { PROJECT_CREATE, PROJECT_UPDATE_CREATE } from './projects.mjs'
import { SUITE_ALLOWLIST, TEST_TEAM, createGuardedFetch } from './sandbox.mjs'

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

const send = (guarded, query, variables = {}) =>
  guarded.fetch(URL, { method: 'POST', headers: { Authorization: FAKE_KEY }, body: JSON.stringify({ query, variables }) })

const mutationOf = (name, args = '$id: String!', call = 'id: $id') => `mutation ${name}(${args}) { ${name[0].toLowerCase()}${name.slice(1)}(${call}) { success } }`
const QUERY = 'query PmkitAny { viewer { id } }'
const REFUSED = /refusing /

function opened(options = {}) {
  const inner = scripted()
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
  await send(guarded, remove, { id: 'i-1' })
  assert.equal(inner.calls.length, 1)
})

const TEAM_CREATE = 'mutation PmkitSandboxTeamCreate($input: TeamCreateInput!) { teamCreate(input: $input) { success team { id key } } }'
const teamInput = (extra = {}) => ({
  id: TEAM, name: TEST_TEAM.name, key: TEST_TEAM.key, description: `pmkit contract-test team (marker: ${TEST_TEAM.marker}).`, ...extra,
})

test('teamCreate passes with the spec inputs when the team is absent', async () => {
  const inner = scripted()
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
