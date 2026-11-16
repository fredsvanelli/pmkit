import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeGhExec, standardFixture } from '../../fake-github-api.mjs'
import { CAPABILITIES } from '../capabilities.mjs'
import { assertTracker } from '../contract.mjs'
import { githubConfigProblems, githubDescriptor } from './adapter.mjs'

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
  const tracker = await descriptor.create({ root: '/repo', system: 'github', pmkit: pmkit(scope, mappings), hosted: true }, { now: () => new Date('2026-11-16T12:00:00Z'), env: { GH_TOKEN: TOKEN } })
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

test('capabilities marks every capability absent but linked_code', async () => {
  const { tracker } = await trackerOf()
  const manifest = await tracker.capabilities()
  assert.equal(manifest.tracker, 'github')
  assert.equal(manifest.gitHost, 'github')
  assert.deepEqual(manifest.capabilities.map((entry) => entry.id), CAPABILITIES)
  for (const entry of manifest.capabilities) {
    if (entry.id === 'linked_code') assert.deepEqual(entry, { id: 'linked_code', path: 'derived', detail: { source: 'git' } })
    else assert.deepEqual(entry, { id: entry.id, path: 'absent', enableHint: `The GitHub adapter does not serve ${entry.id} yet (EPC-8)` })
  }
  assert.deepEqual(manifest.repo, 'acme/widgets')
})

test('every other operation answers NOT_SUPPORTED', async () => {
  const { tracker, calls } = await trackerOf()
  await assert.rejects(tracker.searchIssues({}), (error) => error.code === 'NOT_SUPPORTED' && error.message === 'the GitHub adapter does not implement searchIssues yet')
  assert.equal(calls.length, 0)
})

test('a config without host or repo fails with NOT_CONFIGURED before any call', async () => {
  const { tracker, calls } = await trackerOf({ repo: 'acme/widgets' })
  await assert.rejects(tracker.discover(), (error) => error.code === 'NOT_CONFIGURED' && error.nextStep === '/pmkit:setup')
  assert.equal(calls.length, 0)
})
