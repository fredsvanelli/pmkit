import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fakeRaw } from '../../fake-linear-nodes.mjs'
import { ACME_STATES, ACME_TEAM, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeWorkspace } from '../../fake-linear-api.mjs'
import { tempDir } from '../../test-helpers.mjs'
import { createLinearClient, operationName } from './client.mjs'
import { cycleOperations } from './cycle-ops.mjs'
import { issueOperations } from './issue-ops.mjs'

const ACME = { ...ACME_TEAM, cyclesEnabled: true }
const OPS = { ...ACME_TEAM, id: 'team-ops', key: 'OPS', name: 'Ops', cyclesEnabled: true }
const OPS_STATES = ACME_STATES.map((state) => ({ ...state, id: `ops-${state.id}`, team: { id: OPS.id } }))
const ALL_STATES = [...ACME_STATES, ...OPS_STATES]
const ACTOR = 'user-1'
// The clock is 2026-10-27: cycle 1 is over, cycle 2 runs, cycle 3 is next.
const CYCLES = [
  { number: 1, startsAt: '2026-10-05T00:00:00.000Z', endsAt: '2026-10-19T00:00:00.000Z', completedAt: '2026-10-19T00:00:00.000Z' },
  { number: 2, name: 'Autumn', description: 'Ship it', startsAt: '2026-10-19T00:00:00.000Z', endsAt: '2026-11-02T00:00:00.000Z' },
  { number: 3, startsAt: '2026-11-02T00:00:00.000Z', endsAt: '2026-11-13T00:00:00.000Z' },
]

/** The cycle operations over the fake. `teams` decides which teams have cycles on; `cycles` seeds them. */
async function setup({ teams = [ACME, OPS], cycles = CYCLES, scope = 'ACME' } = {}) {
  const states = ALL_STATES
  const raw = await fakeRaw({ teams, states })
  const fake = fakeLinearIssues({ teams, states, cycles })
  const fetch = fakeLinearFetch({ ...fakeWorkspace({ teams, states }), ...fake.routes })
  const client = createLinearClient({ env: { LINEAR_API_KEY: FAKE_KEY }, tracker: { system: 'linear', scope: { workspace: 'acme' } }, fetch })
  const root = tempDir()
  const config = { root, pmkit: { tracker: { system: 'linear', scope: { workspace: 'acme', team: scope } }, mappings: { status: { in_review: 'In Review' }, types: { bug: 'Bug', feature: 'Feature' } } } }
  const discovery = async () => ({ raw, session: undefined, warnings: [] })
  const issues = issueOperations({ client, discovery, config, uuid: randomUUID })
  const ops = cycleOperations({ client, discovery, issues, config })
  return { ops, issues, fake, fetch, root, config }
}
const names = (fetch) => fetch.calls.map((call) => operationName(call.body.query))
const cycleCalls = (fetch) => names(fetch).filter((name) => /Cycle/.test(name)).length
const ids = (list) => list.map((item) => item.id)

test('listCycles returns sprints sorted by number, with the Local shape', async () => {
  const { ops } = await setup({ cycles: [CYCLES[2], CYCLES[0], CYCLES[1]] })
  const sprints = await ops.listCycles()
  assert.deepEqual(ids(sprints), ['1', '2', '3'])
  assert.deepEqual(sprints.map((sprint) => sprint.state), ['closed', 'active', 'planned'])
  assert.deepEqual(sprints[1], { id: '2', name: 'Autumn', start: '2026-10-19', end: '2026-11-02', goal: 'Ship it', state: 'active', capacity: {}, daysOff: {} })
  assert.equal(sprints[0].closed, '2026-10-19T00:00:00.000Z')
})

test('listCycles with a state sends the matching flag and returns only those', async () => {
  const { ops, fetch } = await setup()
  assert.deepEqual(ids(await ops.listCycles({ state: 'active' })), ['2'])
  assert.deepEqual(ids(await ops.listCycles({ state: 'planned' })), ['3'])
  assert.deepEqual(ids(await ops.listCycles({ state: 'closed' })), ['1'])
  const filters = fetch.calls.filter((call) => operationName(call.body.query) === 'PmkitCycles').map((call) => JSON.stringify(call.body.variables.filter))
  assert.match(filters[0], /"isActive":\{"eq":true\}/)
  assert.match(filters[1], /"isFuture":\{"eq":true\}/)
  assert.match(filters[2], /"isPast":\{"eq":true\}/)
  assert.ok(filters.every((filter) => filter.includes('"key":{"eq":"ACME"}')))
})

test('listCycles refuses a bad state before any request', async () => {
  const { ops, fetch } = await setup()
  await assert.rejects(ops.listCycles({ state: 'open' }), { code: 'INVALID_INPUT', message: 'state must be one of planned, active, closed' })
  assert.equal(fetch.calls.length, 0)
})

test('listCycles reads only the cycles of the scope team', async () => {
  const { ops, fake } = await setup()
  fake.cycles.add({ number: 8, team: 'team-ops', startsAt: '2026-10-19T00:00:00.000Z', endsAt: '2026-11-02T00:00:00.000Z' })
  assert.deepEqual(ids(await ops.listCycles()), ['1', '2', '3'])
})

test('currentCycle returns the active sprint, or null between cycles', async () => {
  const { ops, fake } = await setup()
  assert.equal((await ops.currentCycle()).id, '2')
  fake.cycles.setClock('2026-11-14T00:00:00.000Z')
  assert.equal(await ops.currentCycle(), null)
})

test('cycleIssues returns the issues of the cycle and nothing from the others', async () => {
  const { ops, fake } = await setup()
  const [, two, three] = fake.cycles.list()
  fake.seed({ title: 'In two', cycleId: two.id })
  fake.seed({ title: 'In three', cycleId: three.id })
  fake.seed({ title: 'Free' })
  assert.deepEqual(ids(await ops.cycleIssues('2')), ['ACME-1'])
  assert.deepEqual(ids(await ops.cycleIssues('3')), ['ACME-2'])
})

test('cycleIssues of an unknown or malformed cycle is NOT_FOUND, and a malformed id sends no request', async () => {
  const { ops, fetch } = await setup()
  await assert.rejects(ops.cycleIssues('99'), { code: 'NOT_FOUND', message: 'sprint 99 does not exist', nextStep: 'pmkit cycle list' })
  const before = fetch.calls.length
  for (const id of ['abc', '0', '1.5']) await assert.rejects(ops.cycleIssues(id), { code: 'NOT_FOUND', nextStep: 'pmkit cycle list' }, id)
  assert.equal(fetch.calls.length, before)
})

test('sprints carry capacity and days off from the capacity file, which is read once per call', async () => {
  const { ops, root } = await setup()
  fs.mkdirSync(path.join(root, '.pmkit'))
  fs.writeFileSync(path.join(root, '.pmkit/capacity.yaml'), 'version: 1\ncycles:\n  ACME:\n    2:\n      capacity: { user-1: 8 }\n      days_off:\n        user-1: [2026-10-21]\n')
  const sprints = await ops.listCycles()
  assert.deepEqual(sprints[1].capacity, { 'user-1': 8 })
  assert.deepEqual(sprints[1].daysOff, { 'user-1': ['2026-10-21'] })
  assert.deepEqual(sprints[0].capacity, {})
  assert.deepEqual((await ops.currentCycle()).capacity, { 'user-1': 8 })
})

test('a bad capacity file fails the read with INVALID_INPUT', async () => {
  const { ops, root } = await setup()
  fs.mkdirSync(path.join(root, '.pmkit'))
  fs.writeFileSync(path.join(root, '.pmkit/capacity.yaml'), 'version: 7\n')
  await assert.rejects(ops.listCycles(), { code: 'INVALID_INPUT', nextStep: 'Fix or delete the file' })
})

test('with cycles off every read answers NOT_SUPPORTED with the hint', async () => {
  const { ops, fetch } = await setup({ teams: [{ ...ACME, cyclesEnabled: false }, OPS] })
  const expected = { code: 'NOT_SUPPORTED', message: 'team ACME has cycles turned off', nextStep: "Turn on cycles in the team's settings in Linear" }
  await assert.rejects(ops.listCycles(), expected)
  await assert.rejects(ops.currentCycle(), expected)
  await assert.rejects(ops.cycleIssues('2'), expected)
  assert.equal(cycleCalls(fetch), 0)
})
