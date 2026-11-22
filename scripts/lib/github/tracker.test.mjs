import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fakeGhExec, standardFixture } from '../../fake-github-api.mjs'
import { fakeGithubIssues } from '../../fake-github-issues.mjs'
import { tempDir, userStoreEnv } from '../../test-helpers.mjs'
import { CAPABILITIES } from '../capabilities.mjs'
import { assertTracker } from '../contract.mjs'
import { githubConfigProblems, githubDescriptor } from './adapter.mjs'
import { createGithubTracker } from './tracker.mjs'

const TOKEN = `ghp_${'a1B2'.repeat(9)}`
const pmkit = (scope, mappings = {}) => ({ version: 1, tracker: { system: 'github', scope }, git_host: { system: 'github' }, write_policy: { confirm: 'single_writes' }, mappings })
const SCOPE = { host: 'github.com', repo: 'acme/widgets', project: 'acme/7' }

test('the config check needs host and repo, and reads project and field values', () => {
  assert.deepEqual(githubConfigProblems(pmkit(SCOPE)), [])
  assert.deepEqual(githubConfigProblems(pmkit({ ...SCOPE, project: 'none' })), [])
  assert.deepEqual(githubConfigProblems(pmkit({ repo: 'acme/widgets' })), ['tracker.scope.host is required for github'])
  assert.deepEqual(githubConfigProblems(pmkit({ host: '--jq', repo: 'acme/widgets' })), ['tracker.scope.host must be a host name, such as github.com'])
  assert.deepEqual(githubConfigProblems(pmkit({ host: 'github.com' })), ['tracker.scope.repo is required for github'])
  assert.deepEqual(githubConfigProblems(pmkit({ host: 'github.com', repo: 'widgets' })), ['tracker.scope.repo must be owner/name'])
  assert.deepEqual(githubConfigProblems(pmkit({ ...SCOPE, project: '7' })), ['tracker.scope.project must be owner/number or none'])
  assert.deepEqual(githubConfigProblems(pmkit(SCOPE, { fields: { priority: 'issue:Priority', estimate: 'none', start_date: 'Start' } })), ['mappings.fields.start_date must be issue:<name>, project:<name> or none for github'])
  assert.deepEqual(githubConfigProblems(pmkit(SCOPE, { types: { bug: 'none' } })), ['mappings.types.bug cannot be none; leave the type out instead'])
  assert.deepEqual(githubConfigProblems(pmkit(SCOPE, { status: { backlog: 'label: ' }, types: { bug: 'label:' } })), [
    'mappings.status.backlog must be label:<name> with a name',
    'mappings.types.bug must be label:<name> with a name',
  ])
})

async function trackerOf(scope = SCOPE, fixture = standardFixture(), mappings = {}) {
  const fake = fakeGhExec(fixture)
  const descriptor = githubDescriptor({ exec: fake.exec })
  const env = { ...userStoreEnv().env, GH_TOKEN: TOKEN }
  const tracker = await descriptor.create({ root: tempDir(), system: 'github', pmkit: pmkit(scope, mappings), hosted: true }, { now: () => new Date('2026-11-16T12:00:00Z'), env })
  return { tracker, ...fake, descriptor }
}

test('the descriptor is hosted and creates a contract tracker', async () => {
  const { tracker, descriptor } = await trackerOf()
  assert.equal(descriptor.system, 'github')
  assert.equal(descriptor.hosted, true)
  assert.doesNotThrow(() => assertTracker(tracker))
  assert.equal(descriptor.settings().epicPrefix, null)
})

test('discover returns the view with issue types and Project fields, through --hostname', async () => {
  const { tracker, calls } = await trackerOf(SCOPE, standardFixture(), { status: { todo: 'Todo' } })
  const found = await tracker.discover({ refresh: true })
  assert.deepEqual(found.issueTypes.map((type) => type.name), ['Task', 'Bug', 'Feature'])
  assert.ok(found.projectFields.some((field) => field.name === 'Status'))
  assert.equal(found.viewer.id, 'octocat')
  assert.ok(found.raw)
  for (const call of calls) {
    assert.deepEqual(call.args.slice(0, 3), ['api', '--hostname', 'github.com'])
    assert.ok(!call.args.join(' ').includes(TOKEN) && !String(call.input).includes(TOKEN))
  }
})

test('capabilities builds the manifest from the discovery and the mappings', async () => {
  const { tracker } = await trackerOf(SCOPE, standardFixture(), { fields: { estimate: 'issue:Effort' } })
  const manifest = await tracker.capabilities()
  assert.equal(manifest.tracker, 'github')
  assert.equal(manifest.gitHost, 'github')
  assert.deepEqual(manifest.capabilities.map((entry) => entry.id), CAPABILITIES)
  assert.deepEqual(manifest.capabilities.filter((entry) => entry.path !== 'absent').map((entry) => entry.id), ['estimation', 'multilevel_hierarchy', 'dependencies', 'deliverables', 'status_update', 'native_metrics', 'linked_code'])
  assert.deepEqual(manifest.capabilities.find((entry) => entry.id === 'estimation').detail, { unit: 'points', scale: [] })
  assert.deepEqual(manifest.repo, 'acme/widgets')
})

test('a stub answers NOT_SUPPORTED once the mapping check passes', async () => {
  const { tracker, calls } = await trackerOf()
  await assert.rejects(tracker.listReleases(), (error) => error.code === 'NOT_SUPPORTED' && error.message === 'the GitHub adapter does not implement listReleases yet')
  assert.ok(calls.length > 0)
  assert.ok(calls.every((call) => !String(call.input).includes('mutation')))
})

test('a config without host or repo fails with NOT_CONFIGURED before any call', async () => {
  const { tracker, calls } = await trackerOf({ repo: 'acme/widgets' })
  await assert.rejects(tracker.discover(), (error) => error.code === 'NOT_CONFIGURED' && error.nextStep === '/pmkit:setup')
  assert.equal(calls.length, 0)
})

const STATUS = { backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress', in_review: 'In Review', done: 'Done' }

function issuesContext() {
  return { root: tempDir(), env: { ...userStoreEnv().env, GH_TOKEN: TOKEN } }
}

function githubTracker(context, fake, mappings = { status: STATUS }) {
  const config = { root: context.root, pmkit: pmkit(SCOPE, mappings) }
  return createGithubTracker(config, { env: context.env, exec: fake.exec, now: () => new Date('2026-11-16T12:00:00Z') })
}

const readsOf = (fake, name) => fake.reads.filter((call) => call.name === name).length

test('discover lists the assignable users as members', async () => {
  const fake = fakeGithubIssues({ users: [{ id: 'U_1', login: 'octocat', name: 'The Octocat' }, { id: 'U_2', login: 'hubot', name: 'Hubot' }, { id: 'U_3', login: 'monalisa', name: 'Mona' }] })
  const found = await githubTracker(issuesContext(), fake).discover()
  assert.deepEqual(found.members.map((member) => member.id), ['octocat', 'hubot', 'monalisa'])
  assert.equal(found.raw.viewer.id, 'U_1')
  assert.equal(found.raw.repositoryId, 'R_1')
})

test('discover with refresh succeeds with a warning when the user store cannot take the cache', async () => {
  const context = issuesContext()
  // A file where the store folder should be makes every cache write fail.
  const blocker = path.join(tempDir(), 'store-is-a-file')
  fs.writeFileSync(blocker, '')
  context.env = { ...context.env, PMKIT_HOME: blocker }
  const found = await githubTracker(context, fakeGithubIssues()).discover({ refresh: true })
  assert.equal(found.repo, 'acme/widgets')
  assert.ok(found.warnings.some((warning) => warning.startsWith('could not write the GitHub discovery cache: ')), found.warnings.join('\n'))
})

test('a second tracker reads the discovery from the cache, while discover with refresh reads GitHub', async () => {
  const context = issuesContext()
  const fake = fakeGithubIssues()
  await githubTracker(context, fake).discover({ refresh: true })
  assert.equal(readsOf(fake, 'PmkitRepo'), 1)
  const second = githubTracker(context, fake)
  await assert.rejects(second.getIssue('1'), { code: 'NOT_FOUND' })
  await second.capabilities()
  assert.equal(readsOf(fake, 'PmkitRepo'), 1, 'the guarded read and capabilities read the cache')
  await second.discover({ refresh: true })
  assert.equal(readsOf(fake, 'PmkitRepo'), 2, 'discover with refresh reads GitHub')
})

test('discover reads a primed cache without a GitHub read, and discover with refresh sends one', async () => {
  const context = issuesContext()
  const fake = fakeGithubIssues()
  await githubTracker(context, fake).discover({ refresh: true })
  assert.equal(readsOf(fake, 'PmkitRepo'), 1)
  const fresh = githubTracker(context, fake)
  await fresh.discover()
  await fresh.discover()
  assert.equal(readsOf(fake, 'PmkitRepo'), 1, 'two discover calls over a primed cache send no PmkitRepo')
  await fresh.discover({ refresh: true })
  assert.equal(readsOf(fake, 'PmkitRepo'), 2, 'discover with refresh sends one')
})

test('one tracker reads GitHub once per run', async () => {
  const fake = fakeGithubIssues()
  const tracker = githubTracker(issuesContext(), fake)
  await assert.rejects(tracker.getIssue('1'), { code: 'NOT_FOUND' })
  await assert.rejects(tracker.comment('1', 'x', 'octocat'), { code: 'NOT_FOUND' })
  await tracker.capabilities()
  assert.equal(readsOf(fake, 'PmkitRepo'), 1)
})

test('a broken mapping from a cached discovery refreshes once, then fails with NOT_CONFIGURED', async () => {
  const context = issuesContext()
  const fake = fakeGithubIssues()
  await githubTracker(context, fake).discover({ refresh: true })
  const broken = githubTracker(context, fake, { status: { ...STATUS, done: 'Gone' } })
  await assert.rejects(broken.searchIssues({}), (error) => {
    assert.equal(error.code, 'NOT_CONFIGURED')
    assert.equal(error.message, 'a mapping in .pmkit/config.yaml names something GitHub no longer has: mappings.status.done names Gone, which the Status field of acme/7 no longer has')
    assert.equal(error.nextStep, '/pmkit:setup')
    assert.equal(error.details.mappings[0].path, 'mappings.status.done')
    return true
  })
  assert.equal(readsOf(fake, 'PmkitRepo'), 2, 'one read for the first discover, one refresh')
})

test('a broken mapping from a fresh discovery fails without a second read', async () => {
  const fake = fakeGithubIssues()
  const broken = githubTracker(issuesContext(), fake, { status: { ...STATUS, done: 'Gone' } })
  await assert.rejects(broken.searchIssues({}), { code: 'NOT_CONFIGURED' })
  assert.equal(readsOf(fake, 'PmkitRepo'), 1)
})

test('a guarded stub without a repo fails with NOT_CONFIGURED before any call', async () => {
  const fake = fakeGithubIssues()
  const context = issuesContext()
  const tracker = createGithubTracker({ root: context.root, pmkit: pmkit({ host: 'github.com' }) }, { env: context.env, exec: fake.exec })
  await assert.rejects(tracker.getIssue('1'), { code: 'NOT_CONFIGURED', message: 'tracker.scope.repo is not set in .pmkit/config.yaml', nextStep: '/pmkit:setup' })
  assert.equal(fake.reads.length, 0)
})

test('a cached discovery of another format or another Project counts as a miss', async () => {
  const context = issuesContext()
  const fake = fakeGithubIssues()
  await githubTracker(context, fake).discover({ refresh: true })
  const other = createGithubTracker({ root: context.root, pmkit: pmkit({ ...SCOPE, project: 'none' }, {}) }, { env: context.env, exec: fake.exec })
  await assert.rejects(other.getIssue('1'), { code: 'NOT_FOUND' })
  assert.equal(readsOf(fake, 'PmkitRepo'), 2)
})

test('the tracker serves the issue, relation and history operations through one discovery', async () => {
  const fake = fakeGithubIssues()
  const tracker = githubTracker(issuesContext(), fake)
  const a = (await tracker.createIssue({ title: 'A' }, 'octocat')).after.id
  const b = (await tracker.createIssue({ title: 'B' }, 'octocat')).after.id
  await tracker.link(a, b, 'blocks', 'octocat')
  await tracker.comment(b, 'Waiting on A', 'octocat')
  assert.deepEqual((await tracker.getIssue(b)).blockedBy, [a])
  assert.deepEqual((await tracker.listComments(b)).map((comment) => comment.body), ['Waiting on A'])
  assert.ok((await tracker.getHistory(b)).some((event) => event.op === 'comment'))
  assert.deepEqual((await tracker.searchIssues({})).issues.map((issue) => issue.id).sort(), [a, b].sort())
  assert.equal(readsOf(fake, 'PmkitRepo'), 1)
})

test('unarchive, restore, delegate, logTime and listTimeEntries answer NOT_SUPPORTED after the mapping check', async () => {
  const fake = fakeGithubIssues()
  const tracker = githubTracker(issuesContext(), fake)
  await assert.rejects(tracker.unarchive('1', 'octocat'), { code: 'NOT_SUPPORTED', message: 'unarchive works on the Local tracker and Linear, not on GitHub', nextStep: 'Restore the item from the archived items of the Project on GitHub' })
  await assert.rejects(tracker.restore('1', 'octocat'), { code: 'NOT_SUPPORTED', message: 'GitHub has no trash, so a deleted issue cannot come back', nextStep: 'pmkit issues create' })
  const delegation = 'The GitHub adapter does not delegate to agents yet'
  await assert.rejects(tracker.delegate('1', 'agent:bot', 'octocat'), { code: 'NOT_SUPPORTED', message: delegation, nextStep: delegation })
  for (const refused of [tracker.logTime('1', { minutes: 30 }, 'octocat'), tracker.listTimeEntries({})]) {
    await assert.rejects(refused, { code: 'NOT_SUPPORTED', message: 'GitHub has no time tracking', nextStep: 'GitHub has no time tracking' })
  }
  assert.equal(fake.mutations.length, 0)
  const broken = githubTracker(issuesContext(), fake, { status: { ...STATUS, done: 'Gone' } })
  await assert.rejects(broken.restore('1', 'octocat'), { code: 'NOT_CONFIGURED' })
})

test('a mapped label created after the cached discovery is found by the one refresh', async () => {
  const context = issuesContext()
  const fake = fakeGithubIssues({ project: null })
  const noProject = (mappings) => createGithubTracker({ root: context.root, pmkit: pmkit({ ...SCOPE, project: 'none' }, mappings) }, { env: context.env, exec: fake.exec, now: () => new Date('2026-11-16T12:00:00Z') })
  await noProject({}).discover({ refresh: true })
  fake.state.labels.push({ id: 'LA_9', name: 'Doing' })
  const tracker = noProject({ status: { in_progress: 'label:Doing' } })
  assert.deepEqual((await tracker.searchIssues({})).issues, [])
  assert.equal(readsOf(fake, 'PmkitRepo'), 2)
  const sent = fake.reads.filter((call) => call.name === 'PmkitRepo').at(-1)
  assert.equal(sent.variables.l0, 'Doing')
})

test('capabilities without a Project warns about the capabilities a Project gives', async () => {
  const { tracker } = await trackerOf({ ...SCOPE, project: 'none' })
  const manifest = await tracker.capabilities()
  assert.ok(manifest.warnings.includes('tracker.scope.project is none, so cycles, capacity, deliverables and status_update are absent'))
  const withProject = await (await trackerOf()).tracker.capabilities()
  assert.ok(!withProject.warnings.some((warning) => warning.includes('tracker.scope.project is none')))
})

const withEpics = (fakeOptions = {}) => fakeGithubIssues({ epics: [{ id: 'PVT_E12', owner: 'acme', number: 12, title: 'Epic twelve', linked: true }, { id: 'PVT_E9', owner: 'acme', number: 9, title: 'Epic nine', linked: true }], ...fakeOptions })

test('getIssue reads the epic Project of an issue as its parent, and the linked Projects once per run', async () => {
  const fake = withEpics()
  fake.seed({ number: 1, epics: ['acme/12', 'acme/9'] })
  fake.seed({ number: 2 })
  const tracker = githubTracker(issuesContext(), fake)
  assert.equal((await tracker.getIssue('1')).parent, 'acme/9')
  assert.equal('parent' in (await tracker.getIssue('2')), false)
  assert.equal(readsOf(fake, 'PmkitLinkedProjects'), 1)
})

test('getIssue does not read the linked Projects without a scope Project', async () => {
  const fake = withEpics()
  fake.seed({ number: 1 })
  const tracker = createGithubTracker({ root: issuesContext().root, pmkit: pmkit({ ...SCOPE, project: 'none' }, {}) }, { env: issuesContext().env, exec: fake.exec })
  assert.equal('parent' in (await tracker.getIssue('1')), false)
  assert.equal(readsOf(fake, 'PmkitLinkedProjects'), 0)
})

test('a failed read of the linked Projects fails getIssue and the next call retries it', async () => {
  const fake = withEpics()
  fake.seed({ number: 1, epics: ['acme/12'] })
  const tracker = githubTracker(issuesContext(), fake)
  await tracker.discover()
  const before = readsOf(fake, 'PmkitLinkedProjects')
  fake.failNext('PmkitLinkedProjects')
  await assert.rejects(tracker.getIssue('1'), { code: 'UPSTREAM' })
  assert.equal((await tracker.getIssue('1')).parent, 'acme/12')
  assert.equal(readsOf(fake, 'PmkitLinkedProjects'), before + 2)
})

const WIRED = [
  'listCycles', 'currentCycle', 'cycleIssues', 'openCycle', 'closeCycle', 'moveToCycle', 'getCapacity', 'setCapacity', 'getDaysOff', 'updateCycleCapacity',
  'listDeliverables', 'getDeliverable', 'deliverableProgress', 'createDeliverable', 'publishStatusUpdate', 'listStatusUpdates',
  'listMilestones', 'getMilestone', 'createMilestone',
]

test('the cycle, epic and milestone operations are not stubs, and each runs through the mapping check', async () => {
  const fake = fakeGithubIssues({ project: { statusOptions: ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done'] } })
  const working = githubTracker(issuesContext(), fake)
  for (const operation of WIRED) {
    await working[operation]('x', {}, 'octocat').catch((error) => assert.doesNotMatch(error.message, /does not implement/, operation))
  }
  const broken = githubTracker(issuesContext(), fake, { status: { ...STATUS, done: 'Gone' } })
  for (const operation of WIRED) {
    await assert.rejects(broken[operation]('x', {}, 'octocat'), { code: 'NOT_CONFIGURED' }, operation)
  }
})

test('capabilities shows the epic paging warning once the epics were read', async () => {
  const many = Array.from({ length: 205 }, (_, at) => ({ id: `PVT_M${at}`, owner: 'acme', number: 100 + at }))
  const fake = fakeGithubIssues({ project: { statusOptions: ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done'] }, epics: many })
  const tracker = githubTracker(issuesContext(), fake)
  const paging = (warnings) => warnings.filter((line) => line === 'acme/widgets has more than 200 linked Projects, so pmkit read the first 200 as epics')
  assert.deepEqual(paging((await tracker.capabilities()).warnings), [])
  assert.equal((await tracker.listDeliverables()).length, 199)
  assert.equal(paging((await tracker.capabilities()).warnings).length, 1)
})
