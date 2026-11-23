import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { assertTracker } from '../contract.mjs'
import { ADAPTERS } from '../adapters.mjs'
import { FAKE_EMAIL, FAKE_ENV, FAKE_TOKEN, TRACKER, fakeJiraFetch, jiraSiteRoutes } from '../../fake-jira-api.mjs'
import { fakeJiraIssues } from '../../fake-jira-issues.mjs'
import { makeRepo, tempDir, userStoreEnv } from '../../test-helpers.mjs'
import { cachePut, repoHash } from '../user-store.mjs'
import { run } from '../../pmkit.mjs'
import { jiraDescriptor } from './adapter.mjs'
import { createJiraTracker } from './tracker.mjs'

globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

const NOW = () => new Date('2026-11-22T12:00:00Z')
const config = (pmkit = {}) => ({ root: '/nowhere', pmkit: { version: 1, tracker: TRACKER, git_host: { system: 'github' }, ...pmkit } })

function setup(routes = {}, env = FAKE_ENV) {
  const fetch = fakeJiraFetch({ ...jiraSiteRoutes(), ...routes })
  return { fetch, tracker: createJiraTracker(config(), { env: { ...env, ...userStoreEnv().env }, now: NOW, fetch }) }
}

/** A tracker over the stateful fake, with its own user store and root; `at` shares them between trackers. */
function issuesSetup({ pmkit = {}, at = { root: tempDir(), env: { ...FAKE_ENV, ...userStoreEnv().env } } } = {}) {
  const fake = fakeJiraIssues()
  const fetch = fakeJiraFetch(fake.routes)
  const tracker = createJiraTracker({ root: at.root, pmkit: { version: 1, tracker: TRACKER, mappings: { types: { story: 'Story' } }, ...pmkit } }, { env: at.env, now: NOW, fetch })
  return { fake, fetch, tracker, at }
}
const projectReads = (fetch) => fetch.calls.filter((call) => new URL(call.url).pathname === '/rest/api/3/project/ENG').length

test('the Jira tracker holds every contract operation', () => {
  assertTracker(setup().tracker)
})

test('a missing token fails at creation with no request', () => {
  const fetch = fakeJiraFetch(jiraSiteRoutes())
  assert.throws(() => createJiraTracker(config(), { env: { JIRA_EMAIL: 'a@b.c' }, now: NOW, fetch }), { code: 'AUTH' })
  assert.equal(fetch.calls.length, 0)
})

test('one discovery per run, and discover refresh reads again', async () => {
  const { fetch, tracker } = setup()
  const found = await tracker.discover()
  assert.equal(found.space.key, 'ENG')
  assert.equal(found.raw.space.key, 'ENG')
  const calls = fetch.calls.length
  const manifest = await tracker.capabilities()
  assert.equal(fetch.calls.length, calls)
  assert.deepEqual(Object.keys(manifest), ['tracker', 'gitHost', 'generatedAt', 'discoveredAt', 'site', 'space', 'plan', 'capabilities', 'warnings'])
  assert.equal(manifest.tracker, 'jira')
  assert.equal(manifest.generatedAt, '2026-11-22T12:00:00Z')
  assert.deepEqual(manifest.space, { key: 'ENG', name: 'Engineering', style: 'company-managed', type: 'software' })
  assert.equal(manifest.capabilities.length, 20)
  await tracker.discover({ refresh: true })
  assert.ok(fetch.calls.length > calls)
})

test('an operation of a later task is a NOT_SUPPORTED stub', async () => {
  await assert.rejects(setup().tracker.listDeliverables(), {
    code: 'NOT_SUPPORTED',
    message: 'the Jira adapter does not implement listDeliverables yet',
    nextStep: 'Set tracker.system to local in .pmkit/config.yaml to use this command now',
  })
})

test('a Data Center site is NOT_SUPPORTED', async () => {
  await assert.rejects(setup({ 'GET /rest/api/3/serverInfo': { json: { deploymentType: 'DataCenter' } } }).tracker.discover(), { code: 'NOT_SUPPORTED' })
})

function jiraRepo() {
  const root = makeRepo('basic')
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^ {2}system: local$/m, '  system: jira\n  scope:\n    site: acme.atlassian.net\n    space: ENG'))
  return root
}
const cli = (args) => run(args, { cwd: jiraRepo(), env: { ...FAKE_ENV, ...userStoreEnv().env, PMKIT_NOW: '2026-11-22T12:00:00Z' }, adapters: { ...ADAPTERS, jira: jiraDescriptor({ fetch: fakeJiraFetch(jiraSiteRoutes()) }) } })

test('discover prints the site, the space, the work types and the fields', async () => {
  const result = await cli(['discover'])
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /^site: acme\.atlassian\.net, viewer Test User, Jira Software paid$/m)
  assert.match(result.stdout, /^space: ENG Engineering \(company-managed, software\)$/m)
  assert.match(result.stdout, /^ {2}OPS {2}Operations {2}team-managed$/m)
  assert.match(result.stdout, /^ {2}Epic \(epic\), Story, Bug, Sub-task \(subtask\)$/m)
  assert.match(result.stdout, /^ {2}estimate +customfield_10016 +Story Points$/m)
  assert.match(result.stdout, /^ {2}acceptance_criteria +\(none\)$/m)
  assert.match(result.stdout, /^ {2}To Do \(todo\)$/m)
})

test('capabilities heads with the site, the space and the plan', async () => {
  const result = await cli(['capabilities'])
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /^site: acme\.atlassian\.net$/m)
  assert.match(result.stdout, /^space: ENG \(company-managed\)$/m)
  assert.match(result.stdout, /^plan: Jira Software paid$/m)
})

test('a second tracker reads the discovery from the cache, and discover with refresh reads Jira', async () => {
  const first = issuesSetup()
  await first.tracker.discover({ refresh: true })
  assert.equal(projectReads(first.fetch), 1)
  const second = issuesSetup({ at: first.at })
  await assert.rejects(second.tracker.getIssue('ENG-1'), { code: 'NOT_FOUND' })
  await second.tracker.capabilities()
  assert.equal(projectReads(second.fetch), 0, 'the guarded read and capabilities read the cache')
  await second.tracker.discover({ refresh: true })
  assert.equal(projectReads(second.fetch), 1)
})

test('a cached raw discovery from PMK-76, without members, is read again', async () => {
  const at = { root: tempDir(), env: { ...FAKE_ENV, ...userStoreEnv().env } }
  const old = issuesSetup({ at })
  const raw = (await old.tracker.discover({ refresh: true })).raw
  const { members: _members, ...pmk76 } = raw
  cachePut(repoHash(at.root), 'jira-acme.atlassian.net-eng', pmk76, { ttlSeconds: 3600 }, { env: at.env, now: NOW })
  const next = issuesSetup({ at })
  await next.tracker.capabilities()
  assert.equal(projectReads(next.fetch), 1)
})

test('a mapping Jira no longer has is NOT_CONFIGURED with the broken list, after one refresh of a cached discovery', async () => {
  const first = issuesSetup()
  await first.tracker.discover({ refresh: true })
  const broken = issuesSetup({ at: first.at, pmkit: { mappings: { types: { story: 'Story' }, status: { done: 'Gone' } } } })
  await assert.rejects(broken.tracker.getIssue('ENG-1'), (error) => {
    assert.equal(error.code, 'NOT_CONFIGURED')
    assert.equal(error.nextStep, '/pmkit:setup')
    assert.deepEqual(error.details.mappings.map((item) => item.key), ['mappings.status.done'])
    return true
  })
  assert.equal(projectReads(broken.fetch), 1, 'one refresh')
  assert.deepEqual(broken.fake.writes(), [])
})

test('archive, unarchive, restore and delegate are NOT_SUPPORTED with what Jira lacks', async () => {
  const { tracker, fake } = issuesSetup()
  const archive = "Jira archives work items only on Premium; archive it in Jira, and it leaves pmkit's searches"
  await assert.rejects(tracker.archive('ENG-1', 'acc-1'), { code: 'NOT_SUPPORTED', message: archive })
  await assert.rejects(tracker.unarchive('ENG-1', 'acc-1'), { code: 'NOT_SUPPORTED', message: archive })
  await assert.rejects(tracker.restore('ENG-1', 'acc-1'), { code: 'NOT_SUPPORTED', message: 'Jira has no trash, so a deleted work item cannot come back' })
  await assert.rejects(tracker.delegate('ENG-1', 'agent', 'acc-1'), { code: 'NOT_SUPPORTED', message: 'The Jira adapter does not serve agent_delegation yet' })
  assert.deepEqual(fake.writes(), [])
})

test('the discovery cache file holds no credential', async () => {
  const { tracker, at } = issuesSetup()
  await tracker.discover({ refresh: true })
  const file = path.join(at.env.PMKIT_HOME, 'cache', repoHash(at.root), 'jira-acme.atlassian.net-eng.json')
  const text = fs.readFileSync(file, 'utf8')
  assert.ok(text.includes('"members"'))
  for (const secret of [FAKE_TOKEN, FAKE_EMAIL]) assert.ok(!text.includes(secret), 'a credential reached the cache')
})
