// CLI `jira plans list` and `jira plans get` over the fake Jira (PMK-82).
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { ADAPTERS } from './lib/adapters.mjs'
import { FAKE_ENV, fakeJiraFetch } from './fake-jira-api.mjs'
import { fakeJiraIssues } from './fake-jira-issues.mjs'
import { makeRepo, userStoreEnv } from './test-helpers.mjs'
import { run } from './pmkit.mjs'
import { jiraDescriptor } from './lib/jira/adapter.mjs'

globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

function session(options = {}) {
  const root = makeRepo('basic')
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^ {2}system: local$/m, '  system: jira\n  scope:\n    site: acme.atlassian.net\n    space: ENG'))
  const fetch = fakeJiraFetch(fakeJiraIssues(options).routes)
  const env = { ...FAKE_ENV, ...userStoreEnv().env, PMKIT_NOW: '2026-11-22T12:00:00Z' }
  return (args) => run(args, { cwd: root, env, adapters: { ...ADAPTERS, jira: jiraDescriptor({ fetch }) } })
}

test('jira plans list prints the plans in JSON and text', async () => {
  const cli = session()
  const json = await cli(['jira', 'plans', 'list', '--json'])
  assert.equal(json.code, 0, json.stdout + json.stderr)
  const body = JSON.parse(json.stdout)
  assert.equal((body.data ?? body).plans[0].id, '12')
  const text = await cli(['jira', 'plans', 'list'])
  assert.equal(text.code, 0, text.stderr)
  assert.match(text.stdout, /12 {2}Q1 roadmap {2}\(active\) {2}scenario 34/)
})

test('jira plans get prints the dependency mode, the scenario note and team capacity', async () => {
  const text = await session()(['jira', 'plans', 'get', '12'])
  assert.equal(text.code, 0, text.stdout + text.stderr)
  assert.match(text.stdout, /dependencies: sequential/)
  assert.match(text.stdout, /other scenarios are not readable/)
  assert.match(text.stdout, /capacity 30 story points per sprint/)
  assert.match(text.stdout, /Spring launch/)
})

test('jira plans list says Plans are not available on a 403', async () => {
  const cli = session({ plans: false })
  const text = await cli(['jira', 'plans', 'list'])
  assert.equal(text.code, 0, text.stdout + text.stderr)
  assert.match(text.stdout, /Jira Plans are not available on acme\.atlassian\.net: .*Jira Premium/)
  const body = JSON.parse((await cli(['jira', 'plans', 'list', '--json'])).stdout)
  assert.equal((body.data ?? body).available, false)
})

test('jira plans list on a Local tracker is NOT_SUPPORTED', async () => {
  const result = await run(['jira', 'plans', 'list', '--json'], { cwd: makeRepo('basic'), env: { ...FAKE_ENV, ...userStoreEnv().env } })
  assert.equal(result.code, 2, result.stdout)
  const { error } = JSON.parse(result.stdout)
  assert.equal(error.code, 'NOT_SUPPORTED')
  assert.match(error.message, /works only with the Jira tracker/)
})

test('jira plans get without an id is a usage error', async () => {
  const result = await session()(['jira', 'plans', 'get', '--json'])
  assert.equal(result.code, 2, result.stdout)
  assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
})
