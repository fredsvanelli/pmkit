// CLI `jira ideas list` and `jira ideas connect` over the fake Jira with Jira Product Discovery (PMK-83).
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
import { INSIGHTS_UNREAD } from './lib/jira/ideas.mjs'

globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

function session() {
  const root = makeRepo('basic')
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^ {2}system: local$/m, '  system: jira\n  scope:\n    site: acme.atlassian.net\n    space: ENG'))
  const fake = fakeJiraIssues({ discovery: true })
  const fetch = fakeJiraFetch(fake.routes)
  const env = { ...FAKE_ENV, ...userStoreEnv().env, PMKIT_NOW: '2026-11-23T12:00:00Z' }
  const cli = (args) => run(args, { cwd: root, env, adapters: { ...ADAPTERS, jira: jiraDescriptor({ fetch }) } })
  return { cli, fake, fetch }
}
const data = (result) => {
  const body = JSON.parse(result.stdout)
  return body.data ?? body
}
const linkWrites = (fake) => fake.writes().filter((write) => write.path === '/rest/api/3/issueLink')

test('jira ideas list prints the ideas in JSON with the insights warning, and in text', async () => {
  const { cli } = session()
  const json = await cli(['jira', 'ideas', 'list', '--json'])
  assert.equal(json.code, 0, json.stdout + json.stderr)
  assert.deepEqual(data(json).ideas.map((idea) => idea.id), ['IDEA-2', 'IDEA-1'])
  assert.ok(JSON.stringify(JSON.parse(json.stdout)).includes(INSIGHTS_UNREAD))
  const text = await cli(['jira', 'ideas', 'list'])
  assert.equal(text.code, 0, text.stderr)
  assert.match(text.stdout, /IDEA-1 {2}Bulk export {2}\(Discovery\) {2}votes 7 {2}insights unread {2}delivery none/)
})

test('jira ideas list --limit 0 is a usage error and reads nothing', async () => {
  const { cli, fetch } = session()
  const result = await cli(['jira', 'ideas', 'list', '--limit', '0', '--json'])
  assert.equal(result.code, 2, result.stdout)
  assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
  assert.match(JSON.parse(result.stdout).error.message, /--limit must be at least 1/)
  assert.equal(fetch.calls.length, 0)
})

test('jira ideas connect previews with --dry-run, then connects the idea to the epic', async () => {
  const { cli, fake } = session()
  const epic = await cli(['epic', 'create', '--title', 'Exports', '--json'])
  assert.equal(epic.code, 0, epic.stdout + epic.stderr)
  const preview = await cli(['jira', 'ideas', 'connect', 'IDEA-1', 'ENG-1', '--dry-run', '--json'])
  assert.equal(preview.code, 0, preview.stdout + preview.stderr)
  assert.deepEqual(data(preview).after.epics, ['ENG-1'])
  assert.equal(linkWrites(fake).length, 0)
  const real = await cli(['jira', 'ideas', 'connect', 'IDEA-1', 'ENG-1'])
  assert.equal(real.code, 0, real.stdout + real.stderr)
  assert.match(real.stdout, /connected IDEA-1 to ENG-1/)
  const listed = data(await cli(['jira', 'ideas', 'list', '--json']))
  assert.deepEqual(listed.ideas.find((idea) => idea.id === 'IDEA-1').epics, ['ENG-1'])
})

test('jira ideas list reads Jira again when the cached discovery has no JPD project', async () => {
  const root = makeRepo('basic')
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^ {2}system: local$/m, '  system: jira\n  scope:\n    site: acme.atlassian.net\n    space: ENG'))
  const env = { ...FAKE_ENV, ...userStoreEnv().env, PMKIT_NOW: '2026-11-23T12:00:00Z' }
  const cli = (discovery) => run(['jira', 'ideas', 'list', '--json'], { cwd: root, env, adapters: { ...ADAPTERS, jira: jiraDescriptor({ fetch: fakeJiraFetch(fakeJiraIssues({ discovery }).routes) }) } })
  assert.equal(data(await cli(false)).available, false, 'the first run caches a discovery with no JPD project')
  const after = await cli(true)
  assert.equal(after.code, 0, after.stdout + after.stderr)
  assert.equal(data(after).available, true)
})

test('jira ideas list on a Local tracker is NOT_SUPPORTED', async () => {
  const result = await run(['jira', 'ideas', 'list', '--json'], { cwd: makeRepo('basic'), env: { ...FAKE_ENV, ...userStoreEnv().env } })
  assert.equal(result.code, 2, result.stdout)
  assert.equal(JSON.parse(result.stdout).error.code, 'NOT_SUPPORTED')
})
