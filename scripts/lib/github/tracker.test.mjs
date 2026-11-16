import assert from 'node:assert/strict'
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
  assert.deepEqual(manifest.capabilities.filter((entry) => entry.path !== 'absent').map((entry) => entry.id), ['estimation', 'multilevel_hierarchy', 'dependencies', 'native_metrics', 'linked_code'])
  assert.deepEqual(manifest.capabilities.find((entry) => entry.id === 'estimation').detail, { unit: 'points', scale: [] })
  assert.deepEqual(manifest.repo, 'acme/widgets')
})

test('a stub answers NOT_SUPPORTED once the mapping check passes', async () => {
  const { tracker, calls } = await trackerOf()
  await assert.rejects(tracker.searchIssues({}), (error) => error.code === 'NOT_SUPPORTED' && error.message === 'the GitHub adapter does not implement searchIssues yet')
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

test('a second tracker reads the discovery from the cache, while discover always reads GitHub', async () => {
  const context = issuesContext()
  const fake = fakeGithubIssues()
  await githubTracker(context, fake).discover()
  assert.equal(readsOf(fake, 'PmkitRepo'), 1)
  const second = githubTracker(context, fake)
  await assert.rejects(second.getIssue('1'), { code: 'NOT_SUPPORTED' })
  await second.capabilities()
  assert.equal(readsOf(fake, 'PmkitRepo'), 1, 'the guarded stub and capabilities read the cache')
  await second.discover()
  assert.equal(readsOf(fake, 'PmkitRepo'), 2, 'discover reads GitHub')
})

test('one tracker reads GitHub once per run', async () => {
  const fake = fakeGithubIssues()
  const tracker = githubTracker(issuesContext(), fake)
  await assert.rejects(tracker.getIssue('1'), { code: 'NOT_SUPPORTED' })
  await assert.rejects(tracker.comment('1', 'x'), { code: 'NOT_SUPPORTED' })
  await tracker.capabilities()
  assert.equal(readsOf(fake, 'PmkitRepo'), 1)
})

test('a broken mapping from a cached discovery refreshes once, then fails with NOT_CONFIGURED', async () => {
  const context = issuesContext()
  const fake = fakeGithubIssues()
  await githubTracker(context, fake).discover()
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
  await githubTracker(context, fake).discover()
  const other = createGithubTracker({ root: context.root, pmkit: pmkit({ ...SCOPE, project: 'none' }, {}) }, { env: context.env, exec: fake.exec })
  await assert.rejects(other.getIssue('1'), { code: 'NOT_SUPPORTED' })
  assert.equal(readsOf(fake, 'PmkitRepo'), 2)
})
