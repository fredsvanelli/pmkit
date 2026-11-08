import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { linearDescriptor } from './lib/linear/adapter.mjs'
import { useLinear } from './fake-hosted.mjs'
import { FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeWorkspace } from './fake-linear-api.mjs'
import { childEnv } from './golden-helpers.mjs'
import { makeRepo, userStoreEnv } from './test-helpers.mjs'

const env = { ...process.env, PMKIT_USER: 'fred', PMKIT_NOW: '2026-10-23T12:00:00Z', PMKIT_SEED: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }
const pmkit = async (root, args) => {
  const result = await run([...args, '--json'], { cwd: root, env })
  return { ...result, data: result.stdout ? JSON.parse(result.stdout) : null }
}
const notes = (result) => result.stderr.split('\n').filter((line) => line.startsWith('note: '))

test('goals overview shows each goal with the progress of its epics', async () => {
  const root = makeRepo('team')
  const goal = (await pmkit(root, ['goal', 'create', '--title', 'Grow'])).data.after.id
  await pmkit(root, ['epic', 'goal', 'EPC-2M9D', goal])
  const expected = (await pmkit(root, ['goal', 'progress', goal])).data
  const result = await pmkit(root, ['goals', 'overview'])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.data.source, 'goals')
  assert.equal(result.data.complete, true)
  const [item] = result.data.items
  assert.equal(item.goal.id, goal)
  assert.deepEqual(item.epics.map((e) => e.id), ['EPC-2M9D'])
  assert.deepEqual([item.total, item.done, item.points, item.pointsDone], [expected.total, expected.done, expected.points, expected.pointsDone])
  assert.equal(item.progress, expected.total === 0 ? null : expected.done / expected.total)
  assert.match(result.stdout, /Grow/)
})

test('a goal with no epics has unknown progress, not 0%', async () => {
  const root = makeRepo('team')
  await pmkit(root, ['goal', 'create', '--title', 'Empty'])
  const { data, stdout } = await pmkit(root, ['goals', 'overview'])
  assert.equal(data.items[0].progress, null)
  assert.deepEqual(data.items[0].epics, [])
  const text = await run(['goals', 'overview'], { cwd: root, env })
  assert.match(text.stdout, /not known/)
  assert.ok(stdout)
})

test('without goals it uses top-level issues and says so', async () => {
  const root = makeRepo('team')
  const result = await pmkit(root, ['goals', 'overview'])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.data.source, 'top_level')
  assert.ok(notes(result).some((line) => line.startsWith('note: no goals: using top-level issues')), result.stderr)
  const text = await run(['goals', 'overview'], { cwd: root, env })
  assert.match(text.stdout, /no goals: using top-level issues/)
})

test('top-level rollup lists an issue with sub-issues', async () => {
  const root = makeRepo('team')
  const created = (await pmkit(root, ['issues', 'create', '--title', 'Parent'])).data.after.id
  const child = (await pmkit(root, ['issues', 'create', '--title', 'Child'])).data.after.id
  await pmkit(root, ['issues', 'parent', child, created])
  const { data } = await pmkit(root, ['goals', 'overview'])
  const item = data.items.find((entry) => entry.issue?.id === created)
  assert.deepEqual([item.total, item.done, item.progress], [1, 0, 0])
})

test('a goal file that does not parse is a warning and the result is incomplete', async () => {
  const root = makeRepo('team')
  await pmkit(root, ['goal', 'create', '--title', 'Ok'])
  fs.writeFileSync(path.join(root, '.issues', 'goals', 'GOAL-9.md'), '---\ntarget: soon\n---\n')
  const result = await pmkit(root, ['goals', 'overview'])
  assert.equal(result.data.complete, false)
  assert.ok(result.data.warnings.some((line) => line.includes('GOAL-9')), result.stdout)
})

test('an issue file with conflict markers makes the top-level rollup incomplete', async () => {
  const root = makeRepo('team') // the team fixture holds ISS-3Q6T, an issue with conflict markers
  const result = await pmkit(root, ['goals', 'overview'])
  assert.equal(result.data.complete, false)
  assert.ok(result.data.warnings.length > 0)
})

test('on Linear the goals read is not supported, so it falls back to top-level issues and says why', async () => {
  const root = useLinear(makeRepo('basic'))
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('    workspace: acme', '    workspace: acme\n    team: ACME'))
  const fake = fakeLinearIssues()
  const fetch = fakeLinearFetch({ ...fakeWorkspace(), ...fake.routes })
  const result = await run(['goals', 'overview', '--json'], { cwd: root, env: { ...childEnv(), ...userStoreEnv().env, LINEAR_API_KEY: FAKE_KEY }, adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch }) } })
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.source, 'top_level')
  assert.ok(data.notes.some((line) => line.includes('no goals: using top-level issues')), result.stdout)
})
