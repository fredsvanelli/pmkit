import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { makeRepo } from './test-helpers.mjs'

const env = { ...process.env, PMKIT_USER: 'fred', PMKIT_NOW: '2026-10-23T12:00:00Z', PMKIT_SEED: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }
const load = async (root, args = []) => {
  const result = await run(['team', 'load', ...args, '--json'], { cwd: root, env })
  return { ...result, data: result.code === 0 ? JSON.parse(result.stdout) : null, notes: result.stderr.split('\n').filter((line) => line.startsWith('note: ')) }
}
const rowOf = (data, id) => data.rows.find((row) => row.member === id)

test('team load reads the active sprint, with points, work in progress, capacity and flags', async () => {
  const { code, data, stderr } = await load(makeRepo('team'))
  assert.equal(code, 0, stderr)
  assert.equal(data.sprint.id, '2026-10-12')
  assert.equal(data.unit, 'points')
  assert.deepEqual(data.rows.map((row) => row.member), ['ana', 'fred'])
  const ana = rowOf(data, 'ana')
  assert.deepEqual([ana.issues, ana.points, ana.wip, ana.capacity, ana.daysOff, ana.flags], [2, 13, 2, 10, ['2026-10-16'], ['over_average', 'over_capacity']])
  assert.ok(ana.oldestWipDays > 0)
  const fred = rowOf(data, 'fred')
  assert.deepEqual([fred.issues, fred.points, fred.wip, fred.capacity, fred.flags], [2, 4, 1, 8, []])
  assert.deepEqual(data.noWork, [])
  assert.deepEqual(data.suggestions, [])
  assert.deepEqual(data.imbalances.map((item) => [item.member, item.flag]), [['ana', 'over_average'], ['ana', 'over_capacity']])
})

test('team load writes nothing', async () => {
  const root = makeRepo('team')
  const before = fs.readdirSync(path.join(root, '.issues/issues/ISS-2X6D'))
  await load(root)
  assert.deepEqual(fs.readdirSync(path.join(root, '.issues/issues/ISS-2X6D')), before)
})

test('team load counts every open issue and says so when there is no sprint', async () => {
  const { code, data, notes } = await load(makeRepo('no-sprints'))
  assert.equal(code, 0)
  assert.equal(data.sprint, null)
  assert.deepEqual([rowOf(data, 'fred').issues, rowOf(data, 'ana').issues], [1, 1])
  assert.ok(notes.some((line) => line.startsWith('note: no active sprint')), notes.join('\n'))
})

test('team load counts issues and says so when no issue has an estimate', async () => {
  const root = makeRepo('team')
  const dir = path.join(root, '.issues/issues')
  for (const id of fs.readdirSync(dir)) {
    const file = path.join(dir, id, 'issue.md')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^estimate: .*\n/m, ''))
  }
  const { code, data, notes } = await load(root)
  assert.equal(code, 0)
  assert.equal(data.unit, 'issues')
  assert.equal(rowOf(data, 'ana').load, 2)
  assert.deepEqual(data.imbalances, [])
  assert.ok(notes.includes('note: counted issues, not points: no issue in scope has an estimate'), notes.join('\n'))
})

test('team load names a sprint with --sprint, and fails with NOT_FOUND for an unknown one', async () => {
  const closed = await load(makeRepo('team'), ['--sprint', '2026-09-28'])
  assert.equal(closed.code, 0, closed.stderr)
  assert.equal(closed.data.sprint.id, '2026-09-28')
  assert.deepEqual(closed.data.rows.map((row) => row.load), [0, 0], 'a closed sprint has no open issues')
  const missing = await load(makeRepo('team'), ['--sprint', '2030-01-01'])
  assert.equal(missing.code, 2)
  assert.match(missing.stdout, /NOT_FOUND/)
})

test('team load puts an unassigned issue and an agent member outside the balance', async () => {
  const root = makeRepo('team')
  const file = path.join(root, '.issues/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('members:\n', 'members:\n  agent:claude: { name: Claude, availability: 1 }\n'))
  const result = await run(['issues', 'assign', 'ISS-4M2S', 'agent:claude', '--json'], { cwd: root, env })
  assert.equal(result.code, 0, result.stderr)
  const { data } = await load(root)
  const agent = rowOf(data, 'agent:claude')
  assert.deepEqual([agent.agent, agent.issues], [true, 1])
  assert.equal(data.average, 8, 'the average of fred (3) and ana (13), without the agent')
})
