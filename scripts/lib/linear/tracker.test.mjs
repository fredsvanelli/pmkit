import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeWorkspace } from '../../fake-linear-api.mjs'
import { tempDir, userStoreEnv } from '../../test-helpers.mjs'
import { assertTracker } from '../contract.mjs'
import { cachePut, repoHash } from '../user-store.mjs'
import { operationName } from './client.mjs'
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
  await assert.rejects(linear.getHistory('ACME-1'), {
    code: 'NOT_SUPPORTED',
    message: 'the Linear adapter does not implement getHistory yet',
    nextStep: 'Set tracker.system to local in .pmkit/config.yaml to use this command now',
  })
  assert.equal(callsOf(fetch, 'PmkitTeams'), 1)
  assert.ok(fetch.calls.every((call) => !/mutation/i.test(call.body.query)))
})

test('a stub without a workspace throws NOT_CONFIGURED', async () => {
  const { tracker: linear } = tracker(setup({ scope: {} }))
  await assert.rejects(linear.getIssue('ACME-1'), { code: 'NOT_CONFIGURED', message: 'tracker.scope.workspace is not set', nextStep: '/pmkit:setup' })
})

// Two operations that stay stubs after PMK-35, so the mapping check is all these tests reach.
const stubs = {
  read: (linear) => linear.listComments('ACME-1'),
  write: (linear) => linear.comment('ACME-1', 'x'),
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
  const fetch = fakeLinearFetch({ ...fakeWorkspace(workspace), ...fake.routes })
  context.config.pmkit.mappings = mappings
  const linear = createLinearTracker(context.config, { env: context.env, now, fetch, ...(uuid ? { uuid } : {}) })
  return { tracker: linear, fake, fetch, context }
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

test('sprint and release fail with NOT_SUPPORTED', async () => {
  const { tracker: linear } = linearSetup()
  await assert.rejects(linear.searchIssues({ sprint: 'current' }), { code: 'NOT_SUPPORTED' })
  await assert.rejects(linear.searchIssues({ release: '1.0' }), { code: 'NOT_SUPPORTED' })
})
