// The notes that say which path a command took, over Linear (fake API) and Local. No network, no real user store.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { linearDescriptor } from './lib/linear/adapter.mjs'
import { useLinear } from './fake-hosted.mjs'
import { ACME_TEAM, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeLinearProjects, fakeWorkspace } from './fake-linear-api.mjs'
import { childEnv } from './golden-helpers.mjs'
import { makeRepo, userStoreEnv } from './test-helpers.mjs'

process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir())

function linear(args, { teams, cycles } = {}) {
  const root = useLinear(makeRepo('basic'))
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('    workspace: acme', '    workspace: acme\n    team: ACME'))
  const env = { ...childEnv(), ...userStoreEnv().env, LINEAR_API_KEY: FAKE_KEY }
  const fake = fakeLinearIssues({ ...(teams ? { teams } : {}), ...(cycles ? { cycles } : {}) })
  const projects = fakeLinearProjects({ issues: fake, ...(teams ? { teams } : {}) })
  const fetch = fakeLinearFetch({ ...fakeWorkspace(teams ? { teams } : {}), ...fake.routes, ...projects.routes })
  return run(args, { cwd: root, env, adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch }) } })
}

const noteLines = (stderr) => stderr.split('\n').filter((line) => line.startsWith('note: '))

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
