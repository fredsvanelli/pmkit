import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { ACME_LABELS, ACME_TEAM, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeLinearProjects, fakeWorkspace } from '../../fake-linear-api.mjs'
import { tempDir, userStoreEnv } from '../../test-helpers.mjs'
import { assertTracker } from '../contract.mjs'
import { cachePut, repoHash } from '../user-store.mjs'
import { isMutation, operationName } from './client.mjs'
import { createLinearTracker } from './tracker.mjs'

const START = new Date('2026-10-27T12:00:00Z')
const at = (minutes) => () => new Date(START.getTime() + minutes * 60_000)
const DISCOVERY_OPERATIONS = ['PmkitSession', 'PmkitWorkspace', 'PmkitPlan', 'PmkitIntegrations', 'PmkitTeams', 'PmkitStates', 'PmkitLabels', 'PmkitUsers']
const callsOf = (fetch, name) => fetch.calls.filter((call) => operationName(call.body.query) === name).length

function setup({ scope = { workspace: 'acme', team: 'ACME' }, mappings, withKey = true, env: extraEnv = {} } = {}) {
  const root = tempDir()
  const { env } = userStoreEnv()
  const fullEnv = { ...env, ...(withKey ? { LINEAR_API_KEY: FAKE_KEY } : {}), ...extraEnv }
  const config = { root, pmkit: { tracker: { system: 'linear', scope }, git_host: { system: 'github' }, ...(mappings ? { mappings } : {}) } }
  return { root, env: fullEnv, config }
}

function tracker(context, { now = at(0), fetch = fakeLinearFetch(fakeWorkspace()) } = {}) {
  return { fetch, tracker: createLinearTracker(context.config, { env: context.env, now, fetch }) }
}

const filesUnder = (dir) =>
  fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name)) : []

test('the tracker passes assertTracker', () => {
  assert.doesNotThrow(() => assertTracker(tracker(setup()).tracker))
})

test('a stub throws NOT_SUPPORTED once the mapping check passes', async () => {
  const { fetch, tracker: linear } = tracker(setup())
  await assert.rejects(linear.listReleases(), {
    code: 'NOT_SUPPORTED',
    message: 'the Linear adapter does not implement listReleases yet',
    nextStep: 'Set tracker.system to local in .pmkit/config.yaml to use this command now',
  })
  assert.equal(callsOf(fetch, 'PmkitTeams'), 1)
  assert.ok(fetch.calls.every((call) => !/mutation/i.test(call.body.query)))
})

test('a stub without a workspace throws NOT_CONFIGURED', async () => {
  const { tracker: linear } = tracker(setup({ scope: {} }))
  await assert.rejects(linear.getIssue('ACME-1'), { code: 'NOT_CONFIGURED', message: 'tracker.scope.workspace is not set', nextStep: '/pmkit:setup' })
})

// Two operations that stay stubs after PMK-38, so the mapping check is all these tests reach.
const stubs = {
  read: (linear) => linear.listReleases(),
  write: (linear) => linear.logTime('ACME-1', 5, 'x'),
}

test('a stub with a status removed from the workspace throws NOT_CONFIGURED with details.mappings', async () => {
  for (const [kind, call] of Object.entries(stubs)) {
    const context = setup({ mappings: { status: { in_review: 'Peer Review' } } })
    const { fetch, tracker: linear } = tracker(context)
    await assert.rejects(call(linear), (error) => {
      assert.equal(error.code, 'NOT_CONFIGURED', kind)
      assert.equal(error.message, 'a mapping in .pmkit/config.yaml names something the workspace no longer has: mappings.status.in_review names Peer Review, which team ACME no longer has')
      assert.equal(error.nextStep, '/pmkit:setup')
      assert.deepEqual(error.details.mappings, [{ path: 'mappings.status.in_review', value: 'Peer Review', problem: 'mappings.status.in_review names Peer Review, which team ACME no longer has' }])
      return true
    })
    // A fresh fetch is not stale, so there is no second one.
    assert.equal(callsOf(fetch, 'PmkitTeams'), 1, kind)
  }
})

test('the history and comment operations are guarded by the mapping check', async () => {
  const calls = {
    getHistory: (linear) => linear.getHistory('ACME-1'),
    listComments: (linear) => linear.listComments('ACME-1'),
    comment: (linear) => linear.comment('ACME-1', 'x', 'user-1'),
    resolveThread: (linear) => linear.resolveThread('ACME-1', 'c-1', 'user-1'),
    metricEvents: (linear) => linear.metricEvents(),
  }
  for (const [name, call] of Object.entries(calls)) {
    const { fetch, tracker: linear } = tracker(setup({ mappings: { status: { in_review: 'Peer Review' } } }))
    await assert.rejects(call(linear), (error) => error.code === 'NOT_CONFIGURED' && error.details.mappings[0].path === 'mappings.status.in_review', name)
    assert.ok(fetch.calls.every((c) => !/mutation/i.test(c.body.query)), name)
  }
  const { tracker: noWorkspace } = tracker(setup({ scope: {} }))
  for (const [name, call] of Object.entries(calls)) await assert.rejects(call(noWorkspace), { code: 'NOT_CONFIGURED', message: 'tracker.scope.workspace is not set' }, name)
})


test('a broken mapping in a cached discovery refreshes exactly once, then throws', async () => {
  const context = setup({ mappings: { status: { in_review: 'Peer Review' } } })
  await tracker(context).tracker.discover()
  const { fetch, tracker: linear } = tracker(context, { now: at(1) })
  await assert.rejects(stubs.read(linear), { code: 'NOT_CONFIGURED' })
  assert.equal(callsOf(fetch, 'PmkitTeams'), 1)
  await assert.rejects(stubs.write(linear), { code: 'NOT_CONFIGURED' })
  assert.equal(callsOf(fetch, 'PmkitTeams'), 1)
})

test('a state that is back after the refresh lets the call reach NOT_SUPPORTED', async () => {
  const context = setup({ mappings: { status: { in_review: 'Peer Review' } } })
  await tracker(context).tracker.discover()
  const states = [...fakeWorkspaceStates(), { id: 'state-pr', name: 'Peer Review', type: 'started', position: 11, team: { id: 'team-acme' } }]
  const fetch = fakeLinearFetch(fakeWorkspace({ states }))
  const { tracker: linear } = tracker(context, { now: at(1), fetch })
  await assert.rejects(stubs.read(linear), { code: 'NOT_SUPPORTED' })
  assert.equal(callsOf(fetch, 'PmkitTeams'), 1)
})

function fakeWorkspaceStates() {
  return [{ id: 'state-1', name: 'Backlog', type: 'backlog', position: 0, team: { id: 'team-acme' } }]
}

test('no tracker.scope.team gives the one item "tracker.scope.team is not set" and sends no request', async () => {
  const { fetch, tracker: linear } = tracker(setup({ scope: { workspace: 'acme' } }))
  await assert.rejects(stubs.read(linear), (error) => {
    assert.equal(error.code, 'NOT_CONFIGURED')
    assert.equal(error.message, 'tracker.scope.team is not set')
    assert.deepEqual(error.details.mappings, [{ path: 'tracker.scope.team', value: null, problem: 'tracker.scope.team is not set' }])
    return true
  })
  assert.equal(fetch.calls.length, 0)
})

test('a team the workspace lost and a type label it lost are reported', async () => {
  const lost = tracker(setup({ scope: { workspace: 'acme', team: 'GONE' } }))
  await assert.rejects(stubs.read(lost.tracker), (error) => error.details.mappings[0].problem === 'tracker.scope.team names GONE, which this workspace no longer has')
  const label = tracker(setup({ mappings: { types: { bug: 'Lost' } } }))
  await assert.rejects(stubs.read(label.tracker), (error) => error.details.mappings[0].problem === 'mappings.types.bug names Lost, which is neither a label of team ACME nor of the workspace')
})

test('discover and capabilities warn about a broken mapping and do not throw', async () => {
  const context = setup({ mappings: { status: { in_review: 'Peer Review' } } })
  const { tracker: linear } = tracker(context)
  assert.deepEqual((await linear.discover()).warnings, ['mappings.status.in_review names Peer Review, which team ACME does not have'])
  assert.equal((await linear.capabilities()).capabilities.length, 20)
})

test('none and absent keys never throw', async () => {
  const context = setup({ mappings: { status: { in_review: 'none', blocked: 'none' }, fields: { estimate: 'none' }, types: {} } })
  const { tracker: linear } = tracker(context)
  await assert.rejects(stubs.read(linear), { code: 'NOT_SUPPORTED' })
  await assert.rejects(stubs.write(tracker(setup()).tracker), { code: 'NOT_SUPPORTED' })
})

test('a missing key throws AUTH before any request', () => {
  const fetch = fakeLinearFetch(fakeWorkspace())
  assert.throws(() => tracker(setup({ withKey: false }), { fetch }), { code: 'AUTH' })
  assert.equal(fetch.calls.length, 0)
})

test('a secret-like key in the config throws INVALID_INPUT', () => {
  assert.throws(
    () => tracker(setup({ scope: { workspace: 'acme', token: 'plainvalue' } })),
    (error) => error.code === 'INVALID_INPUT' && error.message.includes('tracker.scope.token') && !error.message.includes('plainvalue'),
  )
})

test('discover and capabilities in one run share one discovery', async () => {
  const { fetch, tracker: linear } = tracker(setup())
  await Promise.all([linear.discover(), linear.capabilities()])
  await linear.discover()
  for (const name of DISCOVERY_OPERATIONS) assert.equal(callsOf(fetch, name), 1, name)
})

test('capabilities() after a discover() sends no extra request', async () => {
  const { fetch, tracker: linear } = tracker(setup())
  await linear.discover()
  const before = fetch.calls.length
  await linear.capabilities()
  await linear.capabilities()
  assert.equal(fetch.calls.length, before)
})

test('a second tracker on the same store sends no request until the TTL passes', async () => {
  const context = setup()
  await tracker(context).tracker.discover()
  const fresh = tracker(context, { now: at(59) })
  assert.equal((await fresh.tracker.discover()).statuses.length, 10)
  assert.deepEqual(fresh.fetch.calls.map((call) => operationName(call.body.query)), ['PmkitSession'])
  const stale = tracker(context, { now: at(61) })
  await stale.tracker.discover()
  for (const name of DISCOVERY_OPERATIONS) assert.equal(callsOf(stale.fetch, name), 1, name)
})

test('refresh fetches again and rewrites the cache', async () => {
  const context = setup()
  const { fetch, tracker: linear } = tracker(context)
  await linear.discover()
  const refreshed = tracker(context, { now: at(30), fetch })
  await refreshed.tracker.discover({ refresh: true })
  assert.equal(callsOf(fetch, 'PmkitTeams'), 2)
  const next = tracker(context, { now: at(80) })
  await next.tracker.discover()
  assert.deepEqual(next.fetch.calls.map((call) => operationName(call.body.query)), ['PmkitSession'])
})

test('a fresh result has auth and a cached one does not', async () => {
  const context = setup()
  const fresh = await tracker(context).tracker.discover()
  assert.deepEqual(fresh.auth, { source: 'LINEAR_API_KEY', viewer: { id: 'user-1', name: 'Test User' }, workspace: { urlKey: 'acme', name: 'Acme' } })
  const cached = await tracker(context, { now: at(1) }).tracker.discover()
  assert.equal('auth' in cached, false)
  assert.equal(cached.statuses.length, 10)
})

test('without a workspace discover works and writes no cache', async () => {
  const context = setup({ scope: {} })
  const result = await tracker(context).tracker.discover()
  assert.equal(result.workspace.urlKey, 'acme')
  assert.deepEqual(filesUnder(context.env.PMKIT_HOME), [])
})

test('a cache entry in another format counts as a miss', async () => {
  const context = setup()
  cachePut(repoHash(context.root), 'linear-acme', { version: 0 }, { ttlSeconds: 3600 }, { env: context.env, now: at(0) })
  const { fetch, tracker: linear } = tracker(context, { now: at(1) })
  assert.equal((await linear.discover()).statuses.length, 10)
  assert.equal(callsOf(fetch, 'PmkitTeams'), 1)
})

test('a cache entry with a missing list counts as a miss', async () => {
  const context = setup()
  const { tracker: first } = tracker(context)
  await first.discover()
  const file = filesUnder(context.env.PMKIT_HOME)[0]
  const entry = JSON.parse(fs.readFileSync(file, 'utf8'))
  delete entry.value.labels
  fs.writeFileSync(file, JSON.stringify(entry))
  const { fetch, tracker: linear } = tracker(context, { now: at(1) })
  assert.equal((await linear.discover()).labels.length, 8)
  assert.equal(callsOf(fetch, 'PmkitLabels'), 1)
})

test('a new workspace key does not read the old cache', async () => {
  const context = setup()
  await tracker(context).tracker.discover()
  const other = { ...context, config: { ...context.config, pmkit: { ...context.config.pmkit, tracker: { system: 'linear', scope: { workspace: 'acme-two' } } } } }
  const fetch = fakeLinearFetch(fakeWorkspace({ urlKey: 'acme-two' }), { workspace: 'acme-two' })
  const result = await tracker(other, { now: at(1), fetch }).tracker.discover()
  assert.equal(callsOf(fetch, 'PmkitTeams'), 1)
  assert.equal(result.workspace.urlKey, 'acme-two')
})

test('a failing cache write warns and still returns the result', async () => {
  const repo = tempDir()
  fs.mkdirSync(path.join(repo, '.git'))
  const context = setup({ env: { PMKIT_HOME: path.join(repo, 'store') } })
  const result = await tracker(context).tracker.discover()
  assert.equal(result.statuses.length, 10)
  assert.ok(result.warnings.some((warning) => warning.startsWith('could not write the Linear discovery cache: ')))
})

test('capabilities returns the manifest object', async () => {
  const manifest = await tracker(setup()).tracker.capabilities()
  assert.deepEqual(Object.keys(manifest), ['tracker', 'gitHost', 'generatedAt', 'discoveredAt', 'workspace', 'team', 'capabilities', 'warnings'])
  assert.equal(manifest.tracker, 'linear')
  assert.equal(manifest.gitHost, 'github')
  assert.equal(manifest.generatedAt, '2026-10-27T12:00:00Z')
  assert.equal(manifest.discoveredAt, '2026-10-27T12:00:00.000Z')
  assert.deepEqual(manifest.workspace, { urlKey: 'acme', plan: 'free' })
  assert.equal(manifest.team, 'ACME')
  assert.equal(manifest.capabilities.length, 20)
  assert.deepEqual(manifest.warnings, [])
})

test('no file under the store holds the key', async () => {
  const context = setup()
  await tracker(context).tracker.discover()
  const files = filesUnder(context.env.PMKIT_HOME)
  assert.equal(files.length, 1)
  for (const file of files) assert.ok(!fs.readFileSync(file, 'utf8').includes(FAKE_KEY), file)
})

// A Linear tracker over the stateful fake, scoped to team ACME, with in_review and two types mapped.
function linearSetup({ mappings = { status: { in_review: 'In Review' }, types: { bug: 'Bug', feature: 'Feature' } }, scope = { workspace: 'acme', team: 'ACME' },
  workspace = {}, issues = {}, nestedPage, uuid, now = at(0), context = setup({ scope }) } = {}) {
  const fake = fakeLinearIssues({ ...workspace, ...issues, ...(nestedPage ? { nestedPage } : {}) })
  const projects = fakeLinearProjects({ issues: fake, teams: workspace.teams, states: workspace.states })
  const fetch = fakeLinearFetch({ ...fakeWorkspace(workspace), ...fake.routes, ...projects.routes })
  context.config.pmkit.mappings = mappings
  const linear = createLinearTracker(context.config, { env: context.env, now, fetch, ...(uuid ? { uuid } : {}) })
  return { tracker: linear, fake, projects, fetch, context }
}
const seed = (fake, input) => fake.seed(input)
const namesOf = (fetch) => fetch.calls.map((call) => operationName(call.body.query))
const lastVariables = (fetch, name) => fetch.calls.filter((call) => operationName(call.body.query) === name).at(-1).body.variables

test('getIssue reads by identifier, ignoring case', async () => {
  const { tracker: linear, fake } = linearSetup()
  seed(fake, { title: 'One', labelIds: ['label-bug', 'label-docs'] })
  const issue = await linear.getIssue('acme-1')
  assert.equal(issue.id, 'ACME-1')
  assert.equal(issue.title, 'One')
  assert.equal(issue.type, 'bug')
  assert.deepEqual(issue.labels, ['Docs'])
  assert.deepEqual(issue.status, { name: 'Backlog', category: 'backlog' })
})

test('getIssue fails with NOT_FOUND for a missing, malformed or trashed id', async () => {
  const { tracker: linear, fake, fetch } = linearSetup()
  await assert.rejects(linear.getIssue('ACME-99'), { code: 'NOT_FOUND', message: 'issue ACME-99 does not exist' })
  const sent = fetch.calls.length
  await assert.rejects(linear.getIssue('not an id'), { code: 'NOT_FOUND' })
  await assert.rejects(linear.getIssue('00000000-0000-0000-0000-000000000000'), { code: 'NOT_FOUND' })
  assert.equal(fetch.calls.length, sent)
  seed(fake, { title: 'Trashed' })
  fake.records[0].trashed = true
  await assert.rejects(linear.getIssue('ACME-1'), { code: 'NOT_FOUND' })
})

test('getIssue reads the rest of a nested connection', async () => {
  const { tracker: linear, fake, fetch } = linearSetup({ nestedPage: 1 })
  seed(fake, { title: 'Two labels', labelIds: ['label-docs', 'label-s'] })
  assert.deepEqual((await linear.getIssue('ACME-1')).labels, ['Docs', 'S'])
  assert.equal(callsOf(fetch, 'PmkitIssueLabelsPage') >= 1, true)
})

test('a state missing from the cached discovery refreshes once', async () => {
  const context = setup({ scope: { workspace: 'acme', team: 'ACME' } })
  await tracker(context).tracker.discover()
  const states = [...fakeWorkspace().PmkitStates({ variables: { first: 250 } }).json.data.workflowStates.nodes,
    { id: 'state-new', name: 'Parked', type: 'started', position: 20, team: { id: 'team-acme' } }]
  const { tracker: linear, fake, fetch } = linearSetup({ context, workspace: { states }, now: at(1) })
  seed(fake, { title: 'Parked one', stateId: 'state-new' })
  assert.deepEqual((await linear.getIssue('ACME-1')).status, { name: 'Parked', category: 'in_progress' })
  assert.equal(callsOf(fetch, 'PmkitStates'), 1)
})

test('discover adds the viewer on a fresh and on a cached read', async () => {
  const context = setup()
  const fresh = await tracker(context).tracker.discover()
  assert.deepEqual(fresh.viewer, { id: 'user-1', name: 'Test User' })
  assert.equal(Object.keys(fresh).at(-1), 'viewer')
  const cached = tracker(context, { now: at(1) })
  assert.deepEqual((await cached.tracker.discover()).viewer, { id: 'user-1', name: 'Test User' })
  assert.deepEqual(namesOf(cached.fetch), ['PmkitSession'])
})

test('an issue operation without a workspace is NOT_CONFIGURED before any request', async () => {
  const { tracker: linear, fetch } = tracker(setup({ scope: {} }))
  await assert.rejects(linear.getIssue('ACME-1'), { code: 'NOT_CONFIGURED', message: 'tracker.scope.workspace is not set', nextStep: '/pmkit:setup' })
  assert.equal(fetch.calls.length, 0)
})

test('search returns oldest first and filters on the server', async () => {
  const { tracker: linear, fake, fetch } = linearSetup()
  for (const title of ['A', 'B', 'C']) seed(fake, { title })
  const found = await linear.searchIssues({})
  assert.deepEqual(found.issues.map((issue) => issue.id), ['ACME-1', 'ACME-2', 'ACME-3'])
  assert.deepEqual(found.problems, [])
  assert.equal(found.hasMore, false)
  assert.deepEqual((await linear.searchIssues({ text: 'b' })).issues.map((issue) => issue.id), ['ACME-2'])
  assert.deepEqual(lastVariables(fetch, 'PmkitIssues').filter.and[1], { or: [{ title: { containsIgnoreCase: 'b' } }, { description: { containsIgnoreCase: 'b' } }] })
  assert.equal(lastVariables(fetch, 'PmkitIssues').first, 100)
})

test('search by category, type, label and blocked', async () => {
  const { tracker: linear, fake } = linearSetup()
  seed(fake, { title: 'Review', stateId: 'state-4', labelIds: ['label-bug'] })
  seed(fake, { title: 'Docs', labelIds: ['label-docs'] })
  const ids = async (filter) => (await linear.searchIssues(filter)).issues.map((issue) => issue.id)
  assert.deepEqual(await ids({ categories: ['in_review'] }), ['ACME-1'])
  assert.deepEqual(await ids({ types: ['bug'] }), ['ACME-1'])
  assert.deepEqual(await ids({ labels: ['Docs'] }), ['ACME-2'])
  assert.deepEqual(await ids({ blocked: false }), ['ACME-1', 'ACME-2'])
  assert.deepEqual(await ids({ blocked: true }), [])
})

test('assignee me sends the viewer id, also on a cached discovery', async () => {
  const context = setup({ scope: { workspace: 'acme', team: 'ACME' } })
  await tracker(context).tracker.discover()
  const { tracker: linear, fake, fetch } = linearSetup({ context, now: at(1) })
  seed(fake, { title: 'Mine', assigneeId: 'user-1' })
  seed(fake, { title: 'Theirs', assigneeId: 'user-2' })
  assert.deepEqual((await linear.searchIssues({ assignee: 'me' })).issues.map((issue) => issue.id), ['ACME-1'])
  assert.deepEqual(lastVariables(fetch, 'PmkitIssues').filter.and[1], { assignee: { id: { eq: 'user-1' } } })
  assert.equal(callsOf(fetch, 'PmkitTeams'), 0)
})

test('a priority sort with a limit reads every match, then cuts', async () => {
  const { tracker: linear, fake, fetch } = linearSetup()
  seed(fake, { title: 'Low', priority: 4 })
  seed(fake, { title: 'Urgent', priority: 1 })
  assert.deepEqual((await linear.searchIssues({ sort: 'priority', limit: 1 })).issues.map((issue) => issue.id), ['ACME-2'])
  assert.equal(lastVariables(fetch, 'PmkitIssues').first, 100)
  await linear.searchIssues({ limit: 1 })
  assert.equal(lastVariables(fetch, 'PmkitIssues').first, 1)
})

test('limit 0 and a category with no state send no request', async () => {
  const { tracker: linear, fake, fetch } = linearSetup()
  seed(fake, { title: 'A' })
  assert.deepEqual(await linear.searchIssues({ limit: 0 }), { issues: [], problems: [], hasMore: false })
  assert.deepEqual(await linear.searchIssues({ categories: ['triage'] }), { issues: [], problems: [], hasMore: false })
  assert.equal(callsOf(fetch, 'PmkitIssues'), 0)
})

test('a trashed issue drops out of search', async () => {
  const { tracker: linear, fake } = linearSetup()
  seed(fake, { title: 'A' })
  seed(fake, { title: 'B' })
  fake.records[1].trashed = true
  assert.deepEqual((await linear.searchIssues({})).issues.map((issue) => issue.id), ['ACME-1'])
})

test('a state missing from the cached discovery refreshes once in search', async () => {
  const context = setup({ scope: { workspace: 'acme', team: 'ACME' } })
  await tracker(context).tracker.discover()
  const states = [...fakeWorkspace().PmkitStates({ variables: { first: 250 } }).json.data.workflowStates.nodes,
    { id: 'state-new', name: 'Parked', type: 'started', position: 20, team: { id: 'team-acme' } }]
  const { tracker: linear, fake, fetch } = linearSetup({ context, workspace: { states }, now: at(1) })
  seed(fake, { title: 'A', stateId: 'state-new' })
  seed(fake, { title: 'B', stateId: 'state-new' })
  assert.deepEqual((await linear.searchIssues({})).issues.map((issue) => issue.status.name), ['Parked', 'Parked'])
  assert.equal(callsOf(fetch, 'PmkitStates'), 1)
})

test('the 10-page cap sets hasMore', async () => {
  const { tracker: linear, fake } = linearSetup()
  for (let index = 0; index < 1001; index += 1) seed(fake, { title: `Issue ${index}` })
  const found = await linear.searchIssues({})
  assert.equal(found.issues.length, 1000)
  assert.equal(found.hasMore, true)
})

test('an unknown type or member fails with INVALID_INPUT', async () => {
  const { tracker: linear } = linearSetup()
  await assert.rejects(linear.searchIssues({ types: ['epic'] }), { code: 'INVALID_INPUT' })
  await assert.rejects(linear.searchIssues({ assignee: 'user-4' }), { code: 'INVALID_INPUT' })
  await assert.rejects(linear.searchIssues({ nope: 1 }), { code: 'INVALID_INPUT' })
})

test('release fails with NOT_SUPPORTED', async () => {
  const { tracker: linear } = linearSetup()
  await assert.rejects(linear.searchIssues({ release: '1.0' }), { code: 'NOT_SUPPORTED' })
})

const CYCLE_TEAM = { ...ACME_TEAM, cyclesEnabled: true }
const CYCLE_SEEDS = [
  { number: 1, startsAt: '2026-10-05T00:00:00.000Z', endsAt: '2026-10-19T00:00:00.000Z' },
  { number: 2, startsAt: '2026-10-19T00:00:00.000Z', endsAt: '2026-11-02T00:00:00.000Z' },
  { number: 3, startsAt: '2026-11-02T00:00:00.000Z', endsAt: '2026-11-13T00:00:00.000Z' },
]
const cycling = ({ cycles = CYCLE_SEEDS } = {}) => linearSetup({ workspace: { teams: [CYCLE_TEAM] }, issues: { cycles } })

test('createIssue and updateIssue with sprint store the cycle, and getIssue reads it back', async () => {
  const { tracker: linear, fetch } = cycling()
  const made = await linear.createIssue({ title: 'Made current', sprint: 'current' }, 'user-1')
  assert.equal(made.after.sprint, '2')
  assert.equal((await linear.getIssue(made.after.id)).sprint, '2')
  const plain = (await linear.createIssue({ title: 'Plain' }, 'user-1')).after.id
  const moved = await linear.updateIssue(plain, { sprint: '3' }, 'user-1')
  assert.equal('sprint' in moved.before, false)
  assert.equal(moved.after.sprint, '3')
  assert.equal(lastVariables(fetch, 'PmkitIssueUpdate').input.cycleId.startsWith('cycle-'), true)
  const cleared = await linear.updateIssue(plain, { sprint: null }, 'user-1')
  assert.equal('sprint' in cleared.after, false)
  assert.equal('sprint' in (await linear.getIssue(plain)), false)
})

test('sprint current with no active cycle is INVALID_INPUT and writes nothing', async () => {
  const { tracker: linear, fake } = cycling({ cycles: [CYCLE_SEEDS[0], CYCLE_SEEDS[2]] })
  const a = (await linear.createIssue({ title: 'A' }, 'user-1')).after.id
  const before = fake.mutations.length
  const expected = { code: 'INVALID_INPUT', message: 'there is no active sprint', nextStep: 'pmkit cycle list' }
  await assert.rejects(linear.createIssue({ title: 'Never', sprint: 'current' }, 'user-1'), expected)
  await assert.rejects(linear.updateIssue(a, { sprint: 'current' }, 'user-1'), expected)
  assert.equal(fake.mutations.length, before)
  assert.equal(fake.nodes().length, 1)
})

test('an unknown or malformed sprint on a write is NOT_FOUND', async () => {
  const { tracker: linear, fake } = cycling()
  const a = (await linear.createIssue({ title: 'A' }, 'user-1')).after.id
  const before = fake.mutations.length
  for (const sprint of ['99', 'abc']) {
    await assert.rejects(linear.updateIssue(a, { sprint }, 'user-1'), { code: 'NOT_FOUND', nextStep: 'pmkit cycle list' }, sprint)
    await assert.rejects(linear.createIssue({ title: 'Never', sprint }, 'user-1'), { code: 'NOT_FOUND' }, sprint)
  }
  assert.equal(fake.mutations.length, before)
})

test('a dry run with sprint shows the cycle and sends no mutation', async () => {
  const { tracker: linear, fake } = cycling()
  const a = (await linear.createIssue({ title: 'A' }, 'user-1')).after.id
  const before = fake.mutations.length
  assert.equal((await linear.updateIssue(a, { sprint: 'current' }, 'user-1', { dryRun: true })).after.sprint, '2')
  assert.equal((await linear.createIssue({ title: 'B', sprint: '3' }, 'user-1', { dryRun: true })).after.sprint, '3')
  assert.equal(fake.mutations.length, before)
})

test('with cycles off a sprint write is NOT_SUPPORTED, except null', async () => {
  const { tracker: linear, fetch } = linearSetup()
  const a = (await linear.createIssue({ title: 'A' }, 'user-1')).after.id
  const expected = { code: 'NOT_SUPPORTED', message: 'team ACME has cycles turned off', nextStep: "Turn on cycles in the team's settings in Linear" }
  await assert.rejects(linear.updateIssue(a, { sprint: 'current' }, 'user-1'), expected)
  await assert.rejects(linear.createIssue({ title: 'B', sprint: '2' }, 'user-1'), expected)
  assert.equal((await linear.updateIssue(a, { sprint: null }, 'user-1')).after.title, 'A')
  assert.ok(!namesOf(fetch).some((name) => /Cycle/.test(name)))
})

test('searchIssues by sprint: a number, current and none, and an unknown cycle gives an empty list', async () => {
  const { tracker: linear } = cycling()
  const inTwo = (await linear.createIssue({ title: 'In two', sprint: '2' }, 'user-1')).after.id
  const inThree = (await linear.createIssue({ title: 'In three', sprint: '3' }, 'user-1')).after.id
  const free = (await linear.createIssue({ title: 'Free' }, 'user-1')).after.id
  const found = async (sprint) => (await linear.searchIssues({ sprint })).issues.map((issue) => issue.id)
  assert.deepEqual(await found('current'), [inTwo])
  assert.deepEqual(await found('2'), [inTwo])
  assert.deepEqual(await found('3'), [inThree])
  assert.deepEqual(await found('none'), [free])
  assert.deepEqual(await found('99'), [])
  await assert.rejects(linear.searchIssues({ sprint: 'abc' }), { code: 'INVALID_INPUT' })
})

test('searchIssues by sprint with cycles off: current is NOT_SUPPORTED and none matches every issue', async () => {
  const { tracker: linear } = linearSetup()
  const a = (await linear.createIssue({ title: 'A' }, 'user-1')).after.id
  await assert.rejects(linear.searchIssues({ sprint: 'current' }), { code: 'NOT_SUPPORTED', message: 'team ACME has cycles turned off' })
  await assert.rejects(linear.searchIssues({ sprint: '2' }), { code: 'NOT_SUPPORTED' })
  assert.deepEqual((await linear.searchIssues({ sprint: 'none' })).issues.map((issue) => issue.id), [a])
})

const mutationsIn = (fetch) => fetch.calls.filter((call) => isMutation(call.body.query)).length
const comparable = ({ id, created, updated, branch, ...rest }) => rest

test('create sends a client UUID and returns the new issue', async () => {
  const { tracker: linear, fetch } = linearSetup({ uuid: () => 'uuid-7' })
  const { before, after } = await linear.createIssue({ title: 'New', type: 'bug', labels: ['Docs'], priority: 'high', acceptanceCriteria: ['works'] }, 'user-1')
  assert.equal(before, null)
  assert.equal(after.id, 'ACME-1')
  assert.equal(after.type, 'bug')
  assert.deepEqual(after.labels, ['Docs'])
  assert.equal(after.priority, 'high')
  assert.deepEqual(after.acceptanceCriteria, [{ text: 'works', done: false }])
  assert.equal(after.branch, 'acme-1-new')
  const sent = lastVariables(fetch, 'PmkitIssueCreate').input
  assert.equal(sent.id, 'uuid-7')
  assert.equal(sent.teamId, 'team-acme')
  assert.deepEqual(sent.labelIds.sort(), ['label-bug', 'label-docs'])
})

test('an unconfirmed create that happened returns it; one that did not rethrows', async () => {
  const applied = linearSetup({ uuid: () => 'uuid-7' })
  applied.fake.unconfirm('PmkitIssueCreate', { applied: true })
  assert.equal((await applied.tracker.createIssue({ title: 'A' }, 'user-1')).after.id, 'ACME-1')
  assert.deepEqual(applied.fake.mutations, ['PmkitIssueCreate'])
  const lost = linearSetup({ uuid: () => 'uuid-8' })
  lost.fake.unconfirm('PmkitIssueCreate', { applied: false })
  await assert.rejects(lost.tracker.createIssue({ title: 'B' }, 'user-1'), {
    code: 'UPSTREAM',
    nextStep: 'Check in Linear whether the change was applied before you retry',
  })
  assert.deepEqual(lost.fake.mutations, ['PmkitIssueCreate'])
  assert.equal(callsOf(lost.fetch, 'PmkitIssueById'), 1)
})

test('a dry run sends no mutation and matches the real write', async () => {
  const { tracker: linear, fetch } = linearSetup()
  const input = { title: 'New', type: 'feature', labels: ['Docs'], priority: 'low', due: '2026-11-01', description: 'Body', acceptanceCriteria: ['a'] }
  const dry = await linear.createIssue(input, 'user-1', { dryRun: true })
  assert.equal(mutationsIn(fetch), 0)
  assert.equal(dry.after.id, null)
  const real = await linear.createIssue(input, 'user-1')
  assert.deepEqual(comparable(dry.after), comparable(real.after))

  const patch = { title: 'Renamed', priority: null, acceptanceCriteria: [{ text: 'a', done: true }], labels: [] }
  const sent = mutationsIn(fetch)
  const dryUpdate = await linear.updateIssue('ACME-1', patch, 'user-1', { dryRun: true })
  assert.equal(mutationsIn(fetch), sent)
  assert.equal(dryUpdate.before.title, 'New')
  const realUpdate = await linear.updateIssue('ACME-1', patch, 'user-1')
  assert.deepEqual(comparable(dryUpdate.after), comparable(realUpdate.after))
  assert.equal(realUpdate.after.title, 'Renamed')
  assert.equal(realUpdate.after.type, 'feature')
  assert.deepEqual(realUpdate.after.labels, [])
  assert.deepEqual(realUpdate.after.acceptanceCriteria, [{ text: 'a', done: true }])
  assert.equal(realUpdate.after.description, 'Body')
})

test('an update that changes nothing sends no mutation', async () => {
  const { tracker: linear, fake, fetch } = linearSetup()
  seed(fake, { title: 'Same', priority: 2 })
  const result = await linear.updateIssue('ACME-1', { title: 'Same', priority: 'high' }, 'user-1')
  assert.equal(result.after, result.before)
  assert.equal(mutationsIn(fetch), 0)
})

test('--as another member is refused before any mutation', async () => {
  const { tracker: linear, fetch } = linearSetup()
  await assert.rejects(linear.createIssue({ title: 'x' }, 'user-2'), {
    code: 'INVALID_INPUT',
    message: 'Linear records every write as the owner of LINEAR_API_KEY (Test User)',
    nextStep: 'Drop --as, or use a key created by that member',
  })
  assert.equal(mutationsIn(fetch), 0)
})

test('an unknown label refreshes the discovery once, then fails', async () => {
  const { tracker: linear, fetch } = linearSetup()
  await assert.rejects(linear.createIssue({ title: 'x', labels: ['Nope'] }, 'user-1'), { code: 'INVALID_INPUT', nextStep: 'Create the label in Linear, then run pmkit discover' })
  assert.equal(callsOf(fetch, 'PmkitLabels'), 2)
  assert.equal(mutationsIn(fetch), 0)
})

test('a label created in Linear after the cache is found after the refresh', async () => {
  const labels = [...ACME_LABELS, { id: 'label-new', name: 'New', isGroup: false, retiredAt: null, team: { id: 'team-acme' }, parent: null }]
  const fake = fakeLinearIssues({ labels })
  const workspace = fakeWorkspace()
  const later = fakeWorkspace({ labels }).PmkitLabels
  let calls = 0
  const fetch = fakeLinearFetch({ ...workspace, ...fake.routes, PmkitLabels: (body) => (calls++ === 0 ? workspace.PmkitLabels(body) : later(body)) })
  const context = setup({ scope: { workspace: 'acme', team: 'ACME' } })
  const linear = createLinearTracker(context.config, { env: context.env, now: at(0), fetch })
  assert.deepEqual((await linear.createIssue({ title: 'x', labels: ['New'] }, 'user-1')).after.labels, ['New'])
  assert.equal(calls, 2)
})

test('update with branch equal to branchName is a no-op; another name is refused', async () => {
  const { tracker: linear, fake, fetch } = linearSetup()
  seed(fake, { title: 'New' })
  const same = await linear.updateIssue('ACME-1', { branch: 'acme-1-new' }, 'user-1')
  assert.equal(same.after, same.before)
  assert.equal(mutationsIn(fetch), 0)
  await assert.rejects(linear.updateIssue('ACME-1', { branch: 'other' }, 'user-1'), { code: 'INVALID_INPUT', message: "Linear names this issue's branch acme-1-new" })
})

// The PMK-34 mapping check runs first and needs tracker.scope.team, so no workspace size gets past it.
test('create with several teams and no scope team is NOT_CONFIGURED', async () => {
  const teams = [ACME_TEAM, { ...ACME_TEAM, id: 'team-two', key: 'TWO', name: 'Two' }]
  const { tracker: linear } = linearSetup({ scope: { workspace: 'acme' }, workspace: { teams } })
  await assert.rejects(linear.createIssue({ title: 'x' }, 'user-1'), { code: 'NOT_CONFIGURED', message: 'tracker.scope.team is not set' })
})

test('create with parent sends the parent UUID', async () => {
  const { tracker: linear, fake, fetch } = linearSetup()
  seed(fake, { id: 'uuid-parent', title: 'Parent' })
  const { after } = await linear.createIssue({ title: 'Child', parent: 'acme-1' }, 'user-1')
  assert.equal(after.parent, 'ACME-1')
  assert.equal(lastVariables(fetch, 'PmkitIssueCreate').input.parentId, 'uuid-parent')
  const dry = await linear.createIssue({ title: 'Child', parent: 'ACME-1' }, 'user-1', { dryRun: true })
  assert.equal(dry.after.parent, 'ACME-1')
  await assert.rejects(linear.createIssue({ title: 'Orphan', parent: 'ACME-99' }, 'user-1'), { code: 'INVALID_INPUT', message: 'parent ACME-99 is not an existing issue or epic' })
})

test('update of a missing issue is NOT_FOUND', async () => {
  const { tracker: linear } = linearSetup()
  await assert.rejects(linear.updateIssue('ACME-9', { title: 'x' }, 'user-1'), { code: 'NOT_FOUND' })
})

const moved = async (linear, id, category, options) => (await linear.moveToCategory(id, category, 'user-1', options)).after.status.name

test('the mapped state wins; else the first state by position', async () => {
  const { tracker: linear, fake } = linearSetup()
  seed(fake, { title: 'Move me' })
  assert.equal(await moved(linear, 'ACME-1', 'in_review'), 'In Review')
  assert.equal(await moved(linear, 'ACME-1', 'in_progress'), 'In Progress')
  assert.equal(await moved(linear, 'ACME-1', 'todo'), 'Todo')
  assert.equal(await moved(linear, 'ACME-1', 'done'), 'Done')
  assert.equal(await moved(linear, 'ACME-1', 'canceled'), 'Canceled')
  assert.equal((await linear.getIssue('ACME-1')).status.name, 'Canceled')
})

// PMK-34 rule 2 takes the first state of the category by position, with states of type duplicate last.
test('canceled skips a Duplicate state that comes first by position', async () => {
  const states = fakeWorkspace().PmkitStates({ variables: { first: 250 } }).json.data.workflowStates.nodes
    .map((state) => (state.type === 'duplicate' ? { ...state, position: -5 } : state))
  const { tracker: linear, fake } = linearSetup({ workspace: { states } })
  seed(fake, { title: 'Move me' })
  assert.equal(await moved(linear, 'ACME-1', 'canceled'), 'Canceled')
  assert.deepEqual((await linear.getIssue('ACME-1')).duplicateOf, [])
})

test('canceled with only a Duplicate state is NOT_SUPPORTED and says to map it explicitly', async () => {
  const states = fakeWorkspace().PmkitStates({ variables: { first: 250 } }).json.data.workflowStates.nodes
    .filter((state) => state.type !== 'canceled')
  const { tracker: linear, fake } = linearSetup({ workspace: { states } })
  seed(fake, { title: 'Move me' })
  await assert.rejects(linear.moveToCategory('ACME-1', 'canceled', 'user-1'), {
    code: 'NOT_SUPPORTED',
    message: 'team ACME has no status in the canceled category except Duplicate',
    nextStep: 'Set mappings.status.canceled explicitly, for example mappings.status.canceled: Duplicate, to allow it',
  })
})

test('an explicit mapping to Duplicate still moves to it', async () => {
  const states = fakeWorkspace().PmkitStates({ variables: { first: 250 } }).json.data.workflowStates.nodes
    .filter((state) => state.type !== 'canceled')
  const { tracker: linear, fake } = linearSetup({ workspace: { states }, mappings: { status: { canceled: 'Duplicate' } } })
  seed(fake, { title: 'Move me' })
  assert.equal(await moved(linear, 'ACME-1', 'canceled'), 'Duplicate')
})

test('status names a state of the category; another name lists the choices', async () => {
  const { tracker: linear, fake } = linearSetup()
  seed(fake, { title: 'Move me' })
  assert.equal(await moved(linear, 'ACME-1', 'in_progress', { status: 'UAT' }), 'UAT')
  await assert.rejects(linear.moveToCategory('ACME-1', 'in_progress', 'user-1', { status: 'Done' }), {
    code: 'INVALID_INPUT',
    message: 'status Done is not in category in_progress',
    nextStep: 'Use one of: In Progress, Code Review, UAT, Ready to ship',
  })
})

test('mappings.status.blocked changes no target', async () => {
  const { tracker: linear, fake } = linearSetup({ mappings: { status: { in_review: 'In Review', blocked: 'In Progress' } } })
  seed(fake, { title: 'Move me' })
  assert.equal(await moved(linear, 'ACME-1', 'in_progress'), 'In Progress')
})

test('the same state sends no mutation', async () => {
  const { tracker: linear, fake, fetch } = linearSetup()
  seed(fake, { title: 'Stay' })
  const result = await linear.moveToCategory('ACME-1', 'backlog', 'user-1')
  assert.equal(result.after, result.before)
  assert.equal(mutationsIn(fetch), 0)
})

test('a move dry run sends no mutation and matches the real move', async () => {
  const { tracker: linear, fake, fetch } = linearSetup()
  seed(fake, { title: 'Move me' })
  const dry = await linear.moveToCategory('ACME-1', 'done', 'user-1', { dryRun: true })
  assert.equal(mutationsIn(fetch), 0)
  const real = await linear.moveToCategory('ACME-1', 'done', 'user-1')
  assert.deepEqual(comparable(dry.after), comparable(real.after))
})

test('a mapped state the team lacks stops the move with NOT_CONFIGURED', async () => {
  const { tracker: linear, fake, fetch } = linearSetup({ mappings: { status: { in_review: 'Gone' } } })
  seed(fake, { title: 'Move me' })
  // The PMK-34 mapping check stops the move first. A fresh discovery is not stale, so it fetches once.
  await assert.rejects(linear.moveToCategory('ACME-1', 'in_review', 'user-1'), {
    code: 'NOT_CONFIGURED',
    message: 'a mapping in .pmkit/config.yaml names something the workspace no longer has: mappings.status.in_review names Gone, which team ACME no longer has',
    nextStep: '/pmkit:setup',
  })
  assert.equal(callsOf(fetch, 'PmkitStates'), 1)
  assert.equal(mutationsIn(fetch), 0)
})

test('in_review with no mapping or with none is NOT_SUPPORTED', async () => {
  for (const mappings of [{}, { status: { in_review: 'none' } }]) {
    const { tracker: linear, fake } = linearSetup({ mappings })
    seed(fake, { title: 'Move me' })
    await assert.rejects(linear.moveToCategory('ACME-1', 'in_review', 'user-1'), {
      code: 'NOT_SUPPORTED',
      message: 'team ACME has no status in the in_review category',
      nextStep: '/pmkit:setup',
    })
  }
})

// PMK-34 rule 2: none names no state, so the move falls back to the first state of the category by position.
test('a category set to none moves to the first state of that category', async () => {
  const { tracker: linear, fake } = linearSetup({ mappings: { status: { backlog: 'none' } } })
  seed(fake, { title: 'Move me', stateId: 'state-2' })
  assert.equal(await moved(linear, 'ACME-1', 'backlog'), 'Backlog')
})

test('a caller limit sent to Linear does not set hasMore', async () => {
  const { tracker: linear, fake } = linearSetup()
  for (const title of ['A', 'B', 'C']) seed(fake, { title })
  const found = await linear.searchIssues({ limit: 1 })
  assert.deepEqual(found.issues.map((issue) => issue.id), ['ACME-1'])
  assert.equal(found.hasMore, false)
})

test('triage on a team with triage off is NOT_SUPPORTED with the hint', async () => {
  const { tracker: linear, fake } = linearSetup()
  seed(fake, { title: 'Move me' })
  await assert.rejects(linear.moveToCategory('ACME-1', 'triage', 'user-1'), {
    code: 'NOT_SUPPORTED',
    message: 'team ACME has no status in the triage category',
    nextStep: "Turn on triage in the team's settings in Linear",
  })
})

test('another category with no state is NOT_SUPPORTED', async () => {
  const states = fakeWorkspace().PmkitStates({ variables: { first: 250 } }).json.data.workflowStates.nodes.filter((state) => !['canceled', 'duplicate'].includes(state.type))
  const { tracker: linear, fake } = linearSetup({ workspace: { states } })
  seed(fake, { title: 'Move me' })
  await assert.rejects(linear.moveToCategory('ACME-1', 'canceled', 'user-1'), { code: 'NOT_SUPPORTED', message: 'team ACME has no status in the canceled category' })
})

// The PMK-34 mapping check reads the workspace first; the category is checked before any issue read.
test('an unknown category is INVALID_INPUT before any issue read', async () => {
  const { tracker: linear, fetch } = linearSetup()
  await assert.rejects(linear.moveToCategory('ACME-1', 'later', 'user-1'), { code: 'INVALID_INPUT' })
  assert.equal(fetch.calls.filter((call) => /^PmkitIssue/.test(operationName(call.body.query))).length, 0)
  assert.equal(mutationsIn(fetch), 0)
})

test('assign takes a member, me or null, and skips an unchanged assignee', async () => {
  const { tracker: linear, fake, fetch } = linearSetup()
  seed(fake, { title: 'Assign me' })
  assert.equal((await linear.assign('ACME-1', 'me', 'user-1')).after.assignee, 'user-1')
  assert.equal((await linear.assign('ACME-1', 'user-2', 'user-1')).after.assignee, 'user-2')
  const sent = mutationsIn(fetch)
  const again = await linear.assign('ACME-1', 'user-2', 'user-1')
  assert.equal(again.after, again.before)
  assert.equal(mutationsIn(fetch), sent)
  const dry = await linear.assign('ACME-1', null, 'user-1', { dryRun: true })
  assert.equal('assignee' in dry.after, false)
  assert.equal(mutationsIn(fetch), sent)
  assert.equal('assignee' in (await linear.assign('ACME-1', null, 'user-1')).after, false)
  await assert.rejects(linear.assign('ACME-1', 'user-4', 'user-1'), { code: 'INVALID_INPUT' })
  await assert.rejects(linear.assign('ACME-1', 'user-9', 'user-1'), { code: 'INVALID_INPUT' })
})

test('archive archives once and returns the archived issue', async () => {
  const { tracker: linear, fake, fetch } = linearSetup()
  seed(fake, { title: 'Archive me' })
  const dry = await linear.archive('ACME-1', 'user-1', { dryRun: true })
  assert.equal(dry.after.archived, true)
  assert.equal(mutationsIn(fetch), 0)
  const { after } = await linear.archive('ACME-1', 'user-1')
  assert.equal(after.archived, true)
  assert.equal(mutationsIn(fetch), 1)
  const again = await linear.archive('ACME-1', 'user-1')
  assert.equal(again.after, again.before)
  assert.equal(mutationsIn(fetch), 1)
  assert.deepEqual((await linear.searchIssues({})).issues, [])
  assert.deepEqual((await linear.searchIssues({ archived: true })).issues.map((issue) => issue.id), ['ACME-1'])
})

const three = (fake) => {
  for (const [index, title] of ['One', 'Two', 'Three'].entries()) seed(fake, { id: `uuid-${index + 1}`, title })
}

test('link blocks, related and duplicate create the Linear relation type', async () => {
  let n = 0
  const { tracker: linear, fake, fetch } = linearSetup({ uuid: () => `rel-uuid-${++n}` })
  three(fake)
  const blocks = await linear.link('ACME-1', 'ACME-2', 'blocks', 'user-1')
  assert.deepEqual(lastVariables(fetch, 'PmkitRelationCreate').input, { id: 'rel-uuid-1', type: 'blocks', issueId: 'uuid-1', relatedIssueId: 'uuid-2' })
  assert.deepEqual(blocks.before.blocks, [])
  assert.deepEqual(blocks.after.blocks, ['ACME-2'])
  assert.deepEqual((await linear.getIssue('ACME-2')).blockedBy, ['ACME-1'])
  await linear.link('ACME-1', 'ACME-3', 'related', 'user-1')
  assert.equal(lastVariables(fetch, 'PmkitRelationCreate').input.type, 'related')
  assert.deepEqual((await linear.getIssue('ACME-3')).related, ['ACME-1'])
  const duplicate = await linear.link('ACME-1', 'ACME-3', 'duplicate', 'user-1')
  assert.equal(lastVariables(fetch, 'PmkitRelationCreate').input.type, 'duplicate')
  assert.deepEqual(duplicate.after.duplicateOf, ['ACME-3'])
})

test('an existing link and an empty unlink send no mutation', async () => {
  const { tracker: linear, fake, fetch } = linearSetup()
  three(fake)
  fake.relate('blocks', 'ACME-1', 'ACME-2')
  fake.relate('related', 'ACME-3', 'ACME-1')
  for (const [from, to, kind] of [['ACME-1', 'ACME-2', 'blocks'], ['ACME-1', 'ACME-3', 'related']]) {
    const result = await linear.link(from, to, kind, 'user-1')
    assert.equal(result.after, result.before)
  }
  const empty = await linear.unlink('ACME-2', 'ACME-3', 'blocks', 'user-1')
  assert.equal(empty.after, empty.before)
  assert.equal(mutationsIn(fetch), 0)
})

test('unlink removes the relation; related in either direction', async () => {
  const { tracker: linear, fake, fetch } = linearSetup()
  three(fake)
  fake.relate('blocks', 'ACME-1', 'ACME-2')
  fake.relate('related', 'ACME-2', 'ACME-1')
  const blocks = await linear.unlink('ACME-1', 'ACME-2', 'blocks', 'user-1')
  assert.deepEqual(blocks.after.blocks, [])
  assert.deepEqual((await linear.getIssue('ACME-2')).blockedBy, [])
  const related = await linear.unlink('ACME-1', 'ACME-2', 'related', 'user-1')
  assert.deepEqual(related.before.related, ['ACME-2'])
  assert.deepEqual(related.after.related, [])
  assert.deepEqual(fake.relations, [])
  assert.equal(callsOf(fetch, 'PmkitRelationDelete'), 2)
})

test('a blocks link that closes a loop is refused with the path', async () => {
  const { tracker: linear, fake, fetch } = linearSetup()
  three(fake)
  fake.relate('blocks', 'ACME-1', 'ACME-2')
  fake.relate('blocks', 'ACME-2', 'ACME-3')
  await assert.rejects(linear.link('ACME-3', 'ACME-1', 'blocks', 'user-1'), {
    code: 'INVALID_INPUT',
    message: 'ACME-3 blocks ACME-1 would close a cycle: ACME-3 → ACME-1 → ACME-2 → ACME-3',
  })
  assert.equal(mutationsIn(fetch), 0)
  assert.equal((await linear.link('ACME-1', 'ACME-3', 'blocks', 'user-1')).after.blocks.length, 2)
})

test('an unknown kind, a self link and a missing issue fail', async () => {
  const { tracker: linear, fake } = linearSetup()
  three(fake)
  await assert.rejects(linear.link('ACME-1', 'ACME-2', 'sibling', 'user-1'), { code: 'INVALID_INPUT', message: 'kind must be one of blocks, related, duplicate' })
  await assert.rejects(linear.link('ACME-1', 'acme-1', 'blocks', 'user-1'), { code: 'INVALID_INPUT', message: 'ACME-1 cannot be linked to itself' })
  await assert.rejects(linear.unlink('ACME-1', 'ACME-99', 'blocks', 'user-1'), { code: 'NOT_FOUND' })
  await assert.rejects(linear.link('ACME-1', 'ACME-2', 'blocks', 'user-2'), { code: 'INVALID_INPUT' })
})

test('an unconfirmed relation create that happened returns the link', async () => {
  const applied = linearSetup({ uuid: () => 'rel-uuid-1' })
  three(applied.fake)
  applied.fake.unconfirm('PmkitRelationCreate', { applied: true })
  assert.deepEqual((await applied.tracker.link('ACME-1', 'ACME-2', 'blocks', 'user-1')).after.blocks, ['ACME-2'])
  const lost = linearSetup({ uuid: () => 'rel-uuid-2' })
  three(lost.fake)
  lost.fake.unconfirm('PmkitRelationCreate', { applied: false })
  await assert.rejects(lost.tracker.link('ACME-1', 'ACME-2', 'blocks', 'user-1'), { code: 'UPSTREAM' })
  assert.deepEqual(lost.fake.mutations, ['PmkitRelationCreate'])
})

test('a dry-run link and unlink send no mutation and return the same after', async () => {
  const { tracker: linear, fake, fetch } = linearSetup()
  three(fake)
  for (const kind of ['blocks', 'related', 'duplicate']) {
    const dry = await linear.link('ACME-1', 'ACME-2', kind, 'user-1', { dryRun: true })
    const sent = mutationsIn(fetch)
    assert.equal(sent, ['blocks', 'related', 'duplicate'].indexOf(kind))
    const real = await linear.link('ACME-1', 'ACME-2', kind, 'user-1')
    assert.deepEqual(comparable(dry.after), comparable(real.after))
  }
  const sent = mutationsIn(fetch)
  const dryUnlink = await linear.unlink('ACME-1', 'ACME-2', 'related', 'user-1', { dryRun: true })
  assert.equal(mutationsIn(fetch), sent)
  const realUnlink = await linear.unlink('ACME-1', 'ACME-2', 'related', 'user-1')
  assert.deepEqual(comparable(dryUnlink.after), comparable(realUnlink.after))
})

test('setParent sets and clears the parent', async () => {
  const { tracker: linear, fake, fetch } = linearSetup()
  three(fake)
  const set = await linear.setParent('ACME-2', 'acme-1', 'user-1')
  assert.equal(set.before.parent, undefined)
  assert.equal(set.after.parent, 'ACME-1')
  assert.deepEqual(lastVariables(fetch, 'PmkitIssueUpdate').input, { parentId: 'uuid-1' })
  assert.deepEqual((await linear.getIssue('ACME-1')).children, ['ACME-2'])
  const cleared = await linear.setParent('ACME-2', null, 'user-1')
  assert.equal('parent' in cleared.after, false)
  assert.deepEqual(lastVariables(fetch, 'PmkitIssueUpdate').input, { parentId: null, projectId: null })
})

test('a parent that is neither an issue nor an epic is INVALID_INPUT', async () => {
  const { tracker: linear, fake } = linearSetup()
  three(fake)
  await assert.rejects(linear.setParent('ACME-2', 'EPC-1x', 'user-1'), { code: 'INVALID_INPUT', message: 'parent EPC-1x is not an existing issue or epic' })
  await assert.rejects(linear.setParent('ACME-2', 'ACME-99', 'user-1'), { code: 'INVALID_INPUT', message: 'parent ACME-99 is not an existing issue or epic' })
})

test('a self parent and a loop are refused', async () => {
  const { tracker: linear, fake, fetch } = linearSetup()
  three(fake)
  fake.records[1].parentId = 'uuid-1'
  fake.records[2].parentId = 'uuid-2'
  await assert.rejects(linear.setParent('ACME-1', 'acme-1', 'user-1'), { code: 'INVALID_INPUT', message: 'ACME-1 cannot be its own parent' })
  await assert.rejects(linear.setParent('ACME-1', 'ACME-2', 'user-1'), { code: 'INVALID_INPUT', message: 'parent loop: ACME-1 → ACME-2 → ACME-1' })
  await assert.rejects(linear.setParent('ACME-1', 'ACME-3', 'user-1'), { code: 'INVALID_INPUT', message: 'parent loop: ACME-1 → ACME-3 → ACME-2 → ACME-1' })
  assert.equal(mutationsIn(fetch), 0)
})

test('an unchanged parent sends no mutation, and a dry run matches the real write', async () => {
  const { tracker: linear, fake, fetch } = linearSetup()
  three(fake)
  fake.records[1].parentId = 'uuid-1'
  const same = await linear.setParent('ACME-2', 'ACME-1', 'user-1')
  assert.equal(same.after, same.before)
  assert.equal(mutationsIn(fetch), 0)
  const dry = await linear.setParent('ACME-3', 'ACME-1', 'user-1', { dryRun: true })
  assert.equal(mutationsIn(fetch), 0)
  const real = await linear.setParent('ACME-3', 'ACME-1', 'user-1')
  assert.deepEqual(comparable(dry.after), comparable(real.after))
})

const CYCLE_OPERATIONS = {
  listCycles: (linear) => linear.listCycles(),
  currentCycle: (linear) => linear.currentCycle(),
  cycleIssues: (linear) => linear.cycleIssues('2'),
  moveToCycle: (linear) => linear.moveToCycle(['ACME-1'], '2', 'user-1'),
  openCycle: (linear) => linear.openCycle({ start: '2026-11-16' }, 'user-1'),
  closeCycle: (linear) => linear.closeCycle('2', 'user-1'),
  getCapacity: (linear) => linear.getCapacity('2'),
  setCapacity: (linear) => linear.setCapacity('2', {}, 'user-1'),
  getDaysOff: (linear) => linear.getDaysOff('2'),
  updateCycleCapacity: (linear) => linear.updateCycleCapacity('2', { capacity: {} }, 'user-1'),
}

test('every cycle and capacity operation runs through guarded: no workspace gives NOT_CONFIGURED', async () => {
  const { tracker: linear, fetch } = tracker(setup({ scope: {} }))
  for (const [name, call] of Object.entries(CYCLE_OPERATIONS)) {
    await assert.rejects(call(linear), { code: 'NOT_CONFIGURED', message: 'tracker.scope.workspace is not set' }, name)
  }
  assert.equal(fetch.calls.length, 0)
})

test('every cycle and capacity operation checks the mappings first', async () => {
  const context = setup({ mappings: { status: { in_review: 'Peer Review' } } })
  for (const [name, call] of Object.entries(CYCLE_OPERATIONS)) {
    await assert.rejects(call(tracker(context).tracker), { code: 'NOT_CONFIGURED', nextStep: '/pmkit:setup' }, name)
  }
})

test('the cycle operations are wired: open and close are final NOT_SUPPORTED answers, and reads reach the cycles', async () => {
  const { tracker: linear } = cycling()
  await assert.rejects(linear.openCycle({ start: '2026-11-16' }, 'user-1'), { code: 'NOT_SUPPORTED', message: /Linear creates cycles from the team's schedule/ })
  await assert.rejects(linear.closeCycle('2', 'user-1'), { code: 'NOT_SUPPORTED', message: /Linear ends a cycle on its end date/ })
  assert.deepEqual((await linear.listCycles()).map((sprint) => sprint.id), ['1', '2', '3'])
  assert.equal((await linear.currentCycle()).id, '2')
})

// One project (P-ACM-1) and three issues, with the issue and project stores wired together.
const PID = '00000000-0000-4000-8000-0000000000a1'
function epicSetup() {
  const setupResult = linearSetup()
  setupResult.projects.seed({ id: PID, name: 'Launch', teamIds: ['team-acme'] })
  three(setupResult.fake)
  return setupResult
}

test('setParent with an epic id sets the project, clears the parent issue and reads back as the epic', async () => {
  const { tracker: linear, fake, fetch } = epicSetup()
  fake.records[2].parentId = 'uuid-2'
  const set = await linear.setParent('ACME-3', 'P-ACM-1', 'user-1')
  assert.equal(set.before.parent, 'ACME-2')
  assert.equal(set.after.parent, 'P-ACM-1')
  assert.deepEqual(lastVariables(fetch, 'PmkitIssueUpdate').input, { projectId: PID, parentId: null })
  assert.equal(fake.records[2].parentId, null)
  assert.equal((await linear.getIssue('ACME-3')).parent, 'P-ACM-1')
})

test('setParent with an issue id on an issue in an epic keeps the project', async () => {
  const { tracker: linear, fake, fetch } = epicSetup()
  await linear.setParent('ACME-3', 'P-ACM-1', 'user-1')
  const set = await linear.setParent('ACME-3', 'ACME-2', 'user-1')
  assert.equal(set.before.parent, 'P-ACM-1')
  assert.equal(set.after.parent, 'ACME-2')
  assert.deepEqual(lastVariables(fetch, 'PmkitIssueUpdate').input, { parentId: 'uuid-2' })
  assert.equal(fake.records[2].projectId, PID)
})

test('setParent null clears the parent issue and the project', async () => {
  const { tracker: linear, fake, fetch } = epicSetup()
  fake.records[2].parentId = 'uuid-2'
  fake.records[2].projectId = PID
  const cleared = await linear.setParent('ACME-3', null, 'user-1')
  assert.equal('parent' in cleared.after, false)
  assert.deepEqual(lastVariables(fetch, 'PmkitIssueUpdate').input, { parentId: null, projectId: null })
  assert.equal(fake.records[2].projectId, null)
  assert.equal(fake.records[2].parentId, null)
  assert.equal(mutationsIn(fetch), 1)
  await linear.setParent('ACME-3', null, 'user-1')
  assert.equal(mutationsIn(fetch), 1)
})

test('an epic parent dry run returns before and after and sends no mutation', async () => {
  const { tracker: linear, fetch } = epicSetup()
  const dry = await linear.setParent('ACME-3', 'P-ACM-1', 'user-1', { dryRun: true })
  assert.equal(mutationsIn(fetch), 0)
  assert.equal('parent' in dry.before, false)
  assert.equal(dry.after.parent, 'P-ACM-1')
  const real = await linear.setParent('ACME-3', 'P-ACM-1', 'user-1')
  assert.deepEqual(comparable(dry.after), comparable(real.after))
  const same = await linear.setParent('ACME-3', 'P-ACM-1', 'user-1')
  assert.equal(same.after, same.before)
  assert.equal(mutationsIn(fetch), 1)
})

test('setParent with an unknown issue or epic is INVALID_INPUT', async () => {
  const { tracker: linear, fetch } = epicSetup()
  await assert.rejects(linear.setParent('ACME-3', 'NOPE-77', 'user-1'), { code: 'INVALID_INPUT', message: 'parent NOPE-77 is not an existing issue or epic' })
  await assert.rejects(linear.setParent('ACME-3', 'P-ZZZ-9', 'user-1'), { code: 'INVALID_INPUT', message: 'parent P-ZZZ-9 is not an existing issue or epic' })
  assert.equal(mutationsIn(fetch), 0)
})

test('the history of an issue that joins and leaves an epic names the epic by its id', async () => {
  const { tracker: linear } = epicSetup()
  await linear.setParent('ACME-3', 'P-ACM-1', 'user-1')
  await linear.setParent('ACME-3', null, 'user-1')
  const moves = (await linear.getHistory('ACME-3')).filter((event) => event.field === 'parent')
  assert.deepEqual(moves.map(({ from, to }) => [from, to]), [[null, 'P-ACM-1'], ['P-ACM-1', null]])
})

test('createIssue with an epic parent puts the issue in the epic, and updateIssue still refuses parent', async () => {
  const { tracker: linear, fake, fetch } = epicSetup()
  const dry = await linear.createIssue({ title: 'In epic', parent: 'P-ACM-1' }, 'user-1', { dryRun: true })
  assert.equal(dry.after.parent, 'P-ACM-1')
  assert.equal(mutationsIn(fetch), 0)
  const { after } = await linear.createIssue({ title: 'In epic', parent: 'p-acm-1' }, 'user-1')
  assert.equal(after.parent, 'P-ACM-1')
  assert.equal(lastVariables(fetch, 'PmkitIssueCreate').input.projectId, PID)
  assert.equal(fake.records.at(-1).projectId, PID)
  await assert.rejects(linear.updateIssue('ACME-1', { parent: 'P-ACM-1' }, 'user-1'), { code: 'INVALID_INPUT', message: 'parent cannot be set here' })
})

test('each of the three project keys works as a parent and reads back as the canonical id', async () => {
  const { tracker: linear, projects } = epicSetup()
  const slug = projects.projects[0].slugId
  for (const [index, key] of ['P-ACM-1', slug, PID].entries()) {
    const issue = `ACME-${index + 1}`
    assert.equal((await linear.setParent(issue, key, 'user-1')).after.parent, 'P-ACM-1', key)
  }
})

test('searchIssues by epic returns the issues whose shown parent is the epic', async () => {
  const { tracker: linear, fake, fetch } = epicSetup()
  fake.records[0].projectId = PID
  fake.records[1].projectId = PID
  fake.records[1].parentId = 'uuid-3'
  assert.deepEqual((await linear.searchIssues({ parent: 'P-ACM-1' })).issues.map((issue) => issue.id), ['ACME-1'])
  assert.deepEqual((await linear.searchIssues({ parent: 'p-acm-1' })).issues.map((issue) => issue.id), ['ACME-1'])
  assert.deepEqual((await linear.searchIssues({ parent: 'ACME-3' })).issues.map((issue) => issue.id), ['ACME-2'])
  const before = namesOf(fetch).filter((name) => name === 'PmkitIssues').length
  assert.deepEqual(await linear.searchIssues({ parent: 'P-ZZZ-9' }), { issues: [], problems: [], hasMore: false })
  assert.equal(namesOf(fetch).filter((name) => name === 'PmkitIssues').length, before)
})

const PROJECT_OPERATIONS = {
  listDeliverables: [],
  getDeliverable: ['P-ACM-1'],
  deliverableProgress: ['P-ACM-1'],
  createDeliverable: [{ title: 'New' }, 'user-1', { dryRun: true }],
  publishStatusUpdate: [{ epic: 'P-ACM-1', health: 'on_track', body: 'Fine' }, 'user-1', { dryRun: true }],
  listStatusUpdates: ['P-ACM-1'],
  listMilestones: [],
  getMilestone: ['11111111-1111-4111-8111-111111111111'],
  readDocument: ['abcdef012345'],
}

test('the project operations are implemented and the milestone and document writes are NOT_SUPPORTED', async () => {
  const { tracker: linear } = epicSetup()
  for (const [operation, args] of Object.entries(PROJECT_OPERATIONS)) {
    try {
      await linear[operation](...args)
    } catch (error) {
      assert.ok(!/does not implement/.test(error.message), operation)
      assert.equal(error.code, 'NOT_FOUND', operation)
    }
  }
  assert.equal((await linear.listDeliverables())[0].id, 'P-ACM-1')
  await assert.rejects(linear.createMilestone({ id: 'm' }, 'user-1'), { code: 'NOT_SUPPORTED', nextStep: 'Create the milestone in Linear' })
  await assert.rejects(linear.createDocument('a.md', 'x', 'user-1'), { code: 'NOT_SUPPORTED', nextStep: 'Create the document in Linear' })
})

test('a broken mapping stops each project operation through guarded', async () => {
  const context = setup({ mappings: { status: { in_review: 'Peer Review' } } })
  const { tracker: linear, fetch } = tracker(context)
  for (const [operation, args] of Object.entries({ ...PROJECT_OPERATIONS, createMilestone: [{}, 'user-1'], createDocument: ['a.md', 'x', 'user-1'] })) {
    await assert.rejects(linear[operation](...args), { code: 'NOT_CONFIGURED' }, operation)
  }
  assert.ok(!namesOf(fetch).some((name) => /Project|Epic|Document/.test(name)))
})

test('logTime, createRelease and markReleased refuse with the manifest reason and send no request after discovery', async () => {
  const { fetch, tracker: linear } = tracker(setup())
  await assert.rejects(linear.logTime('ACME-1', 5, 'x'), { code: 'NOT_SUPPORTED', message: 'Linear has no time tracking', nextStep: 'Linear has no time tracking' })
  for (const call of [() => linear.createRelease({ name: 'r' }), () => linear.markReleased('r')]) {
    await assert.rejects(call(), (error) => error.code === 'NOT_SUPPORTED' && /needs releases/.test(error.message) && /Business or Enterprise plan/.test(error.nextStep))
  }
  assert.ok(fetch.calls.every((call) => !/mutation/i.test(call.body.query)))
})
