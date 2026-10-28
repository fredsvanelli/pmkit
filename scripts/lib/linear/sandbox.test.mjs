// Tests of the Linear sandbox helper over scripted fetches. No test here opens a socket.
import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_KEY, fakeLinearFetch, json } from '../../fake-linear-api.mjs'
import { createLinearClient, isMutation } from './client.mjs'
import {
  COMMENT_CREATE, COMMENT_RESOLVE, ISSUE_ARCHIVE, ISSUE_CREATE, ISSUE_UPDATE, RELATION_CREATE, RELATION_DELETE,
} from './documents.mjs'
import { PROJECT_CREATE, PROJECT_UPDATE_CREATE } from './projects.mjs'
import { SUITE_ALLOWLIST, TEST_TEAM, createGuardedFetch, findOrCreateTestTeam, preflight } from './sandbox.mjs'

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

// A scripted workspace: routes keyed by operation name, over the fake fetch, behind the guard.
const GOOD_HEADERS = {
  'x-ratelimit-requests-limit': '2500', 'x-ratelimit-requests-remaining': '2400', 'x-ratelimit-requests-reset': '1798000000000',
  'x-ratelimit-complexity-limit': '3000000', 'x-ratelimit-complexity-remaining': '2900000', 'x-ratelimit-complexity-reset': '1798000000000',
}
const teamNode = (extra = {}) => ({
  id: TEAM, key: TEST_TEAM.key, name: TEST_TEAM.name, description: `pmkit contract-test team (marker: ${TEST_TEAM.marker}).`,
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
    PmkitSandboxIssues: (body) => answer({ team: { issues: connection(state.issues, body) } }),
    PmkitSandboxProjects: (body) => answer({ team: { projects: connection(state.projects, body) } }),
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
    description: 'pmkit contract-test team (marker: pmkit-contract-team). The pmkit tests create and trash items here. Do not use it for real work.',
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
