// The notes that say which path a command took, over Linear (fake API) and Local. No network, no real user store.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { linearDescriptor } from './lib/linear/adapter.mjs'
import { useLinear } from './fake-hosted.mjs'
import { ACME_TEAM, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeLinearProjects, fakeWorkspace } from './fake-linear-api.mjs'
import { childEnv } from './golden-helpers.mjs'
import { makeRepo, tempDir, userStoreEnv } from './test-helpers.mjs'

process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir())

function linear(args, { teams, cycles, calls, gitHost, seed, routes = {}, prepare } = {}) {
  const root = useLinear(makeRepo('basic'))
  const file = path.join(root, '.pmkit', 'config.yaml')
  const text = fs.readFileSync(file, 'utf8').replace('    workspace: acme', '    workspace: acme\n    team: ACME')
  fs.writeFileSync(file, gitHost ? text.replace('  system: none', `  system: github\n  repo: ${gitHost}`) : text)
  prepare?.(root)
  const env = { ...childEnv(), ...userStoreEnv().env, LINEAR_API_KEY: FAKE_KEY }
  const fake = fakeLinearIssues({ ...(teams ? { teams } : {}), ...(cycles ? { cycles } : {}) })
  const projects = fakeLinearProjects({ issues: fake, ...(teams ? { teams } : {}) })
  seed?.(fake)
  const fetch = fakeLinearFetch({ ...fakeWorkspace(teams ? { teams } : {}), ...fake.routes, ...projects.routes, ...routes })
  if (calls) calls.fetch = fetch
  return run(args, { cwd: root, env, adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch }) } })
}

const noteLines = (stderr) => stderr.split('\n').filter((line) => line.startsWith('note: '))

test('docs next-adr on Linear names a repository file and reads no tracker folder', async () => {
  const result = await linear(['docs', 'next-adr', '--title', 'Use Linear', '--json'])
  assert.equal(result.code, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.destination, 'repo')
  assert.equal(data.path, 'docs/adr/0001-use-linear.md')
  assert.equal(data.docPath, null)
})

test('docs adr-status on Linear finds no tracker folder and answers NOT_FOUND for a number docs/adr lacks (PMK-228)', async () => {
  const result = await linear(['docs', 'adr-status', '1', 'deprecated', '--json'])
  assert.equal(result.code, 2)
  assert.equal(JSON.parse(result.stdout).error.code, 'NOT_FOUND')
})

test('docs adr-get on Linear reads docs/adr and answers NOT_FOUND for a number it lacks (PMK-263)', async () => {
  const result = await linear(['docs', 'adr-get', '1', '--json'])
  assert.equal(result.code, 2)
  assert.equal(JSON.parse(result.stdout).error.code, 'NOT_FOUND')
})

test('validate on Linear reports two ADRs of one number in docs/adr (PMK-263)', async () => {
  const prepare = (root) => {
    fs.mkdirSync(path.join(root, 'docs', 'adr'), { recursive: true })
    fs.writeFileSync(path.join(root, 'docs', 'adr', '0002-a.md'), '# A\n')
    fs.writeFileSync(path.join(root, 'docs', 'adr', '0002-b.md'), '# B\n')
  }
  const result = await linear(['validate', '--json'], { prepare })
  const adr = JSON.parse(result.stdout).problems.filter((problem) => problem.code === 'adr')
  assert.deepEqual(adr.map((problem) => problem.path), ['docs/adr/0002-a.md', 'docs/adr/0002-b.md'])
  assert.match(adr[0].message, /ADR number 0002 is also used by docs\/adr\/0002-b\.md/)
})

test('issues update --add-doc on Linear with no GitHub repo is NOT_CONFIGURED and writes nothing (PMK-252)', async () => {
  const calls = {}
  const result = await linear(['issues', 'update', 'ACME-1', '--add-doc', 'docs/adr/0001-a.md', '--json'], { calls, seed: (fake) => fake.seed({ title: 'One' }) })
  assert.equal(result.code, 2)
  const error = JSON.parse(result.stdout).error
  assert.equal(error.code, 'NOT_CONFIGURED')
  assert.equal(error.nextStep, '/pmkit:link-repo')
  assert.ok(!calls.fetch.calls.some((call) => /^\s*mutation/.test(call.body.query)))
})

test('issues update --add-doc and --remove-doc work on Linear, and --dry-run sends no request that writes (PMK-252)', async () => {
  const seed = (fake) => fake.seed({ title: 'One' })
  const dry = {}
  const preview = await linear(['issues', 'update', 'ACME-1', '--add-doc', 'docs/adr/0001-a.md', '--dry-run', '--json'], { calls: dry, gitHost: 'acme/app', seed })
  assert.equal(preview.code, 0, preview.stderr)
  assert.deepEqual(JSON.parse(preview.stdout).after.docs, ['docs/adr/0001-a.md'])
  assert.ok(!dry.fetch.calls.some((call) => /^\s*mutation/.test(call.body.query)))
  const sent = {}
  const written = await linear(['issues', 'update', 'ACME-1', '--add-doc', 'docs/adr/0001-a.md', '--json'], { calls: sent, gitHost: 'acme/app', seed })
  assert.equal(written.code, 0, written.stderr)
  assert.deepEqual(JSON.parse(written.stdout).after.docs, ['docs/adr/0001-a.md'])
  assert.ok(sent.fetch.calls.some((call) => /PmkitAttachmentCreate/.test(call.body.query)))
})

test('issues update --add-doc on Linear refuses when the docs of the issue could not be read (PMK-252)', async () => {
  const tooComplex = { status: 200, json: { data: null, errors: [{ message: 'Query too complex', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] } }
  const routes = { PmkitIssuesAttachments: tooComplex, PmkitIssueAttachments: tooComplex }
  const calls = {}
  const result = await linear(['issues', 'update', 'ACME-1', '--add-doc', 'docs/adr/0001-a.md', '--json'], { calls, gitHost: 'acme/app', routes, seed: (fake) => fake.seed({ title: 'One' }) })
  assert.equal(result.code, 2)
  assert.match(JSON.parse(result.stdout).error.message, /unknown|Query too complex/)
  assert.ok(!calls.fetch.calls.some((call) => /^\s*mutation/.test(call.body.query)))
})

test('issues update --add-doc on Linear refuses a path that is not relative to the repository before any request (PMK-252 review)', async () => {
  for (const path of ['/Users/x/a.md', 'tracker:docs/adr/0001-a.md', '../a.md']) {
    const calls = {}
    const result = await linear(['issues', 'update', 'ACME-1', '--add-doc', path, '--json'], { calls, gitHost: 'acme/app', seed: (fake) => fake.seed({ title: 'One' }) })
    assert.equal(result.code, 2, path)
    assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT', path)
    assert.equal(calls.fetch.calls.length, 0, path)
  }
})

test('issues update --add-doc on Linear links ./docs/a.md and docs/a.md as one doc (PMK-252 review)', async () => {
  const calls = {}
  const result = await linear(['issues', 'update', 'ACME-1', '--add-doc', './docs/a.md', '--add-doc', 'docs/a.md', '--json'], { calls, gitHost: 'acme/app', seed: (fake) => fake.seed({ title: 'One' }) })
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout).after.docs, ['docs/a.md'])
  assert.equal(calls.fetch.calls.filter((call) => /PmkitAttachmentCreate/.test(call.body.query)).length, 1)
})

test('issues update --add-doc on Linear links the default branch of origin/HEAD when git_host has none, with its note (PMK-252 review)', async () => {
  const git = (root, ...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  const prepare = (root) => {
    git(root, 'init', '-q')
    git(root, 'add', '-A')
    git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x')
    git(root, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD')
    git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
  }
  const calls = {}
  const result = await linear(['issues', 'update', 'ACME-1', '--add-doc', 'docs/a.md', '--json'], { calls, gitHost: 'acme/app', prepare, seed: (fake) => fake.seed({ title: 'One' }) })
  assert.equal(result.code, 0, result.stderr)
  const create = calls.fetch.calls.find((call) => /PmkitAttachmentCreate/.test(call.body.query))
  assert.equal(create.body.variables.input.url, 'https://github.com/acme/app/blob/trunk/docs/a.md')
  assert.ok(noteLines(result.stderr).some((line) => /origin\/HEAD \(trunk\)/.test(line)), result.stderr)
})

// The step 6 of /pmkit:spec:record-decision on Linear (PMK-252 review): the comment and the docs link of each related issue.
test('record-decision step 6 on Linear: a comment and a docs link per issue, and the link is the comment alone without a GitHub repo', async () => {
  const seed = (fake) => { fake.seed({ title: 'One' }); fake.seed({ title: 'Two' }) }
  const body = path.join(tempDir(), 'comment.md')
  fs.writeFileSync(body, 'ADR 0001 docs/adr/0001-a.md')
  for (const id of ['ACME-1', 'ACME-2']) {
    const comment = await linear(['issues', 'comment', id, '--body-file', body, '--json'], { gitHost: 'acme/app', seed })
    assert.equal(comment.code, 0, comment.stderr)
  }
  const calls = {}
  const linked = await linear(['issues', 'update', 'ACME-2', '--add-doc', 'docs/adr/0001-a.md', '--json'], { calls, gitHost: 'acme/app', seed })
  assert.deepEqual(JSON.parse(linked.stdout).after.docs, ['docs/adr/0001-a.md'])
  const without = await linear(['issues', 'update', 'ACME-1', '--add-doc', 'docs/adr/0001-a.md', '--dry-run', '--json'], { seed })
  assert.equal(JSON.parse(without.stdout).error.code, 'NOT_CONFIGURED')
})

const METRICS = [
  [['metrics', 'cycle-time'], 'cycle-time'],
  [['metrics', 'lead-time'], 'lead-time'],
  [['metrics', 'throughput'], 'throughput'],
  [['metrics', 'aging'], 'aging'],
]

for (const [args, metric] of METRICS) {
  test(`${args.join(' ')} prints one history note on Linear`, async () => {
    const result = await linear(args)
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(noteLines(result.stderr), [`note: ${metric} computed from Linear issue history`])
  })
  test(`${args.join(' ')} prints one events note on Local`, async () => {
    const result = await run(args, { cwd: makeRepo('basic') })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(noteLines(result.stderr), [`note: ${metric} computed from .issues/events.jsonl`])
  })
}

test('events prints one note on Linear and on Local', async () => {
  const onLinear = await linear(['events'])
  assert.equal(onLinear.code, 0, onLinear.stderr)
  assert.deepEqual(noteLines(onLinear.stderr), ['note: events computed from Linear issue history'])
  const onLocal = await run(['events'], { cwd: makeRepo('basic') })
  assert.deepEqual(noteLines(onLocal.stderr), ['note: events computed from .issues/events.jsonl'])
})

test('metrics velocity names the closed sprints it used, and the estimates when they are off', async () => {
  const cycles = [{ number: 1, startsAt: '2026-10-05T00:00:00.000Z', endsAt: '2026-10-19T00:00:00.000Z', completedAt: '2026-10-19T00:00:00.000Z' }]
  const result = await linear(['metrics', 'velocity', '--window', '3'], { teams: [{ ...ACME_TEAM, cyclesEnabled: true }], cycles })
  assert.equal(result.code, 0, result.stderr)
  const lines = noteLines(result.stderr)
  assert.equal(lines.length, 1)
  assert.equal(lines[0], "note: velocity computed from the last 1 closed sprints; counted issues: estimates are off (Turn on estimates in the team's settings in Linear)")
})

test('cycle capacity says Linear has no capacity field', async () => {
  const cycles = [{ number: 1, startsAt: '2026-10-05T00:00:00.000Z', endsAt: '2026-10-19T00:00:00.000Z', completedAt: '2026-10-19T00:00:00.000Z' }]
  const result = await linear(['cycle', 'capacity', '1'], { teams: [{ ...ACME_TEAM, cyclesEnabled: true }], cycles })
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(noteLines(result.stderr), ['note: capacity read from .pmkit/capacity.yaml; Linear has no capacity field'])
})

test('risks prints one events note on Local', async () => {
  const result = await run(['risks'], { cwd: makeRepo('basic') })
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(noteLines(result.stderr), ['note: stalled-issue history computed from .issues/events.jsonl'])
})

test('risks prints one history note on Linear', async () => {
  const result = await linear(['risks'], { teams: [{ ...ACME_TEAM, cyclesEnabled: true }] })
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(noteLines(result.stderr), ['note: stalled-issue history computed from Linear issue history'])
})

test('risks on a Linear team with cycles off reads no sprint and says so in a note', async () => {
  const result = await linear(['risks', '--json'])
  assert.equal(result.code, 0, result.stdout + result.stderr)
  assert.deepEqual(noteLines(result.stderr), [
    "note: cycles is absent: Turn on cycles in the team's settings in Linear",
    'note: stalled-issue history computed from Linear issue history',
  ])
  assert.ok(Array.isArray(JSON.parse(result.stdout).blocked))
})

test('team load on a Linear team with cycles off reads all open work and says why in a note', async () => {
  const result = await linear(['team', 'load', '--json'])
  assert.equal(result.code, 0, result.stdout + result.stderr)
  assert.ok(noteLines(result.stderr).includes("note: cycles is absent: Turn on cycles in the team's settings in Linear"), result.stderr)
  assert.equal(JSON.parse(result.stdout).sprint, null)
})

test('team load --sprint on a Linear team with cycles off answers NOT_SUPPORTED', async () => {
  const result = await linear(['team', 'load', '--sprint', 'S-1', '--json'])
  assert.equal(result.code, 2)
  assert.equal(JSON.parse(result.stdout).error.code, 'NOT_SUPPORTED')
})

test('pr status refuses without a git host, on Local and on Linear', async () => {
  for (const result of [await run(['pr', 'status', '--branch', 'x'], { cwd: makeRepo('basic') }), await linear(['pr', 'status', '--branch', 'x'])]) {
    assert.equal(result.code, 2)
    assert.match(result.stderr, /this repository has no git host configured/)
    assert.deepEqual(noteLines(result.stderr), [])
  }
})
