// CLI `issues move --field id=value` over the stateful fake Jira (PMK-77, criterion 2).
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { ADAPTERS } from './lib/adapters.mjs'
import { FAKE_ENV, fakeJiraFetch } from './fake-jira-api.mjs'
import { fakeJiraIssues } from './fake-jira-issues.mjs'
import { makeRepo, userStoreEnv } from './test-helpers.mjs'
import { fakeGh } from './fake-gh.mjs'
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
  assert.doesNotMatch(result.stderr, /--field is ignored/)
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

// PMK-77 final review I-4: a move to done that needs fields is a problem for that item in bulk and pr sync, never a planned move.

/** A Jira session whose git host is GitHub, with the fake gh on PATH answering `canned`. */
function hostedSession(canned) {
  const root = makeRepo('basic')
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
    .replace(/^ {2}system: local$/m, '  system: jira\n  scope:\n    site: acme.atlassian.net\n    space: ENG')
    .replace(/^ {2}system: none$/m, '  system: github\n  default_branch: main')
    .replace(/^git_host:$/m, 'mappings:\n  status:\n    in_review: Review\ngit_host:'))
  const fetch = fakeJiraFetch(fakeJiraIssues().routes)
  const gh = fakeGh(canned)
  const env = { ...FAKE_ENV, ...userStoreEnv().env, PMKIT_NOW: '2026-11-22T12:00:00Z', PATH: `${gh.dir}${path.delimiter}${process.env.PATH}`, PMKIT_FAKE_GH: gh.responses }
  return (args) => run(args, { cwd: root, env, adapters: { ...ADAPTERS, jira: jiraDescriptor({ fetch }) } })
}

const ok = async (cli, args) => {
  const result = await cli([...args, '--json'])
  assert.equal(result.code, 0, `${args.join(' ')}: ${result.stdout}${result.stderr}`)
  const body = JSON.parse(result.stdout)
  return body.data ?? body
}

test('bulk move to done rejects each item that needs Resolution, naming the field and the move with --field', async () => {
  const cli = session()
  await ok(cli, ['issues', 'create', '--title', 'One', '--label', 'ship'])
  await ok(cli, ['issues', 'create', '--title', 'Two', '--label', 'ship'])
  const preview = await ok(cli, ['issues', 'bulk', 'move', 'done', '--label', 'ship', '--dry-run'])
  assert.equal(preview.writes, 0)
  assert.deepEqual(preview.items.map((item) => item.state), ['rejected', 'rejected'])
  assert.equal(preview.blockers.length, 2)
  assert.match(preview.blockers[0], /^ENG-1 was rejected: INVALID_INPUT .*Resolution.*pmkit issues move ENG-1 done --field resolution=<value>/)
  assert.match(preview.blockers[1], /pmkit issues move ENG-2 done --field resolution=<value>/)
})

test('pr sync reports a merged item whose move to done needs Resolution as a problem, in a dry run and a real run', async () => {
  const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'
  const merged = JSON.stringify({ number: 11, url: 'https://github.com/o/r/pull/11', title: 'T', state: 'MERGED', isDraft: false, headRefName: 'b1', author: { login: 'fred' }, mergedAt: '2026-11-21T10:00:00Z' })
  const cli = hostedSession({ [`pr view b1 --json ${VIEW}`]: { stdout: merged } })
  await ok(cli, ['issues', 'create', '--title', 'One'])
  await ok(cli, ['issues', 'update', 'ENG-1', '--branch', 'b1'])
  await ok(cli, ['issues', 'move', 'ENG-1', 'in_review'])
  for (const dry of [['--dry-run'], []]) {
    const result = await ok(cli, ['pr', 'sync', ...dry])
    assert.deepEqual(result.moved, [], dry.join(''))
    assert.equal(result.problems.length, 1)
    assert.equal(result.problems[0].id, 'ENG-1')
    assert.equal(result.problems[0].code, 'INVALID_INPUT')
    assert.match(result.problems[0].message, /Resolution.*pmkit issues move ENG-1 done --field resolution=<value>/)
  }
  assert.equal((await ok(cli, ['issues', 'get', 'ENG-1'])).status.category, 'in_review')
})
