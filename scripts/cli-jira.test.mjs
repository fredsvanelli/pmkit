// CLI `issues move --field id=value` over the stateful fake Jira (PMK-77, criterion 2).
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

function session() {
  const root = makeRepo('basic')
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^ {2}system: local$/m, '  system: jira\n  scope:\n    site: acme.atlassian.net\n    space: ENG'))
  const fetch = fakeJiraFetch(fakeJiraIssues().routes)
  const env = { ...FAKE_ENV, ...userStoreEnv().env, PMKIT_NOW: '2026-11-22T12:00:00Z' }
  return (args) => run(args, { cwd: root, env, adapters: { ...ADAPTERS, jira: jiraDescriptor({ fetch }) } })
}

async function withIssue() {
  const cli = session()
  const made = await cli(['issues', 'create', '--title', 'Ship it', '--json'])
  assert.equal(made.code, 0, made.stderr)
  return cli
}

test('a dry run to done lists the required Resolution in JSON and in text', async () => {
  const cli = await withIssue()
  const data = JSON.parse((await cli(['issues', 'move', 'ENG-1', 'done', '--dry-run', '--json'])).stdout)
  const fields = (data.data ?? data).requiredFields
  assert.equal(fields[0].name, 'Resolution')
  assert.deepEqual(fields[0].allowed, ['Done', "Won't Do"])
  const text = await cli(['issues', 'move', 'ENG-1', 'done', '--dry-run'])
  assert.equal(text.code, 0, text.stderr)
  assert.match(text.stdout, new RegExp(`^needs: Resolution \\(${fields[0].id}: Done, Won't Do\\)\\ndry run: nothing was written$`, 'm'))
})

test('a real move without a value for the required field is INVALID_INPUT', async () => {
  const cli = await withIssue()
  const result = await cli(['issues', 'move', 'ENG-1', 'done', '--json'])
  assert.equal(result.code, 2, result.stdout)
  assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
})

test('--field resolution=Done moves the issue to done', async () => {
  const cli = await withIssue()
  const result = await cli(['issues', 'move', 'ENG-1', 'done', '--field', 'resolution=Done', '--json'])
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const body = JSON.parse(result.stdout)
  assert.deepEqual((body.data ?? body).after.status, { name: 'Done', category: 'done' })
})

test('--field without = or with an empty id is a usage error naming the value', async () => {
  const cli = await withIssue()
  for (const bad of ['bad', '=Done']) {
    const result = await cli(['issues', 'move', 'ENG-1', 'done', '--field', bad, '--json'])
    assert.equal(result.code, 2)
    const error = JSON.parse(result.stdout).error
    assert.equal(error.code, 'INVALID_INPUT')
    assert.ok(error.message.includes(bad), error.message)
  }
})
