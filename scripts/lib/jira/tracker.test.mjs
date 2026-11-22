import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { assertTracker } from '../contract.mjs'
import { ADAPTERS } from '../adapters.mjs'
import { FAKE_ENV, TRACKER, fakeJiraFetch, jiraSiteRoutes } from '../../fake-jira-api.mjs'
import { makeRepo } from '../../test-helpers.mjs'
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
  return { fetch, tracker: createJiraTracker(config(), { env, now: NOW, fetch }) }
}

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

test('every other operation is a NOT_SUPPORTED stub', async () => {
  await assert.rejects(setup().tracker.getIssue('ENG-1'), {
    code: 'NOT_SUPPORTED',
    message: 'the Jira adapter does not implement getIssue yet',
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
const cli = (args) => run(args, { cwd: jiraRepo(), env: { ...FAKE_ENV, PMKIT_NOW: '2026-11-22T12:00:00Z' }, adapters: { ...ADAPTERS, jira: jiraDescriptor({ fetch: fakeJiraFetch(jiraSiteRoutes()) }) } })

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
