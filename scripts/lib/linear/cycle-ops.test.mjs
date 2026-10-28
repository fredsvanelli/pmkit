import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fakeRaw } from '../../fake-linear-nodes.mjs'
import { ACME_STATES, ACME_TEAM, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeWorkspace } from '../../fake-linear-api.mjs'
import { tempDir } from '../../test-helpers.mjs'
import { overlaps } from '../local/sprints.mjs'
import { businessDaysBetween } from '../metrics.mjs'
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
async function setup({ teams = [ACME, OPS], cycles = CYCLES, scope = 'ACME', wrap = {} } = {}) {
  const states = ALL_STATES
  const raw = await fakeRaw({ teams, states })
  const fake = fakeLinearIssues({ teams, states, cycles })
  const routes = { ...fakeWorkspace({ teams, states }), ...fake.routes }
  for (const [name, wrapper] of Object.entries(wrap)) routes[name] = wrapper(routes[name])
  const fetch = fakeLinearFetch(routes)
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
  assert.deepEqual(sprints[1], { id: '2', name: 'Autumn', start: '2026-10-19', end: '2026-11-01', goal: 'Ship it', state: 'active', capacity: {}, daysOff: {} })
  assert.equal(sprints[0].closed, '2026-10-19T00:00:00.000Z')
})

test('listCycles with a state returns only those, filtering the cycles of the team by sprint state', async () => {
  const { ops, fetch } = await setup()
  assert.deepEqual(ids(await ops.listCycles({ state: 'active' })), ['2'])
  assert.deepEqual(ids(await ops.listCycles({ state: 'planned' })), ['3'])
  assert.deepEqual(ids(await ops.listCycles({ state: 'closed' })), ['1'])
  const filters = fetch.calls.filter((call) => operationName(call.body.query) === 'PmkitCycles').map((call) => call.body.variables.filter)
  assert.deepEqual(filters, Array(3).fill({ and: [{ team: { key: { eq: 'ACME' } } }] }))
})

test('a cycle with no flag (cooldown) is closed in the full list and in the closed filter alike', async () => {
  // Linear may answer isPast false while a team is in cooldown (spec, "Risks"); cycle 1 here has no flag at all.
  const cooldown = (route) => (body) => {
    const answer = route(body)
    const cycles = answer.json?.data?.cycles
    if (!cycles) return answer
    const flagged = /"is(Active|Future|Past)"/.test(JSON.stringify(body.variables.filter))
    cycles.nodes = cycles.nodes.filter((node) => !(flagged && node.number === 1))
    for (const node of cycles.nodes) if (node.number === 1) Object.assign(node, { isActive: false, isFuture: false, isPast: false })
    return answer
  }
  const { ops } = await setup({ wrap: { PmkitCycles: cooldown } })
  assert.equal((await ops.listCycles())[0].state, 'closed')
  assert.deepEqual(ids(await ops.listCycles({ state: 'closed' })), ['1'])
  assert.deepEqual(ids(await ops.listCycles({ state: 'active' })), ['2'])
})

test('listCycles refuses a bad state before any request', async () => {
  const { ops, fetch } = await setup()
  await assert.rejects(ops.listCycles({ state: 'open' }), { code: 'INVALID_INPUT', message: 'state must be one of planned, active, closed' })
  assert.equal(fetch.calls.length, 0)
})

test('a cycle ends the day before the next one starts, so consecutive sprints do not overlap', async () => {
  const { ops } = await setup()
  const [one, two, three] = await ops.listCycles()
  assert.deepEqual([one.end, two.end, three.end], ['2026-10-18', '2026-11-01', '2026-11-12'])
  assert.equal(overlaps(one, two), false)
  assert.equal(overlaps(two, three), false)
})

test('the weekdays of a sprint stop before the next cycle starts', async () => {
  const { ops } = await setup()
  const two = (await ops.listCycles())[1]
  // businessDaysBetween counts the days after its first argument, so start from the day before the sprint.
  const before = new Date(Date.parse(`${two.start}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
  assert.equal(businessDaysBetween(before, two.end), 10)
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

const mutationCount = (fetch) => names(fetch).filter((name) => name === 'PmkitIssueUpdate').length
const sprintOf = async (issues, id) => (await issues.getIssue(id)).sprint

test('moveToCycle to a number, to current and to null gives { before, after } per id in order', async () => {
  const { ops, issues, fake } = await setup()
  const a = fake.seed({ title: 'A' }).identifier
  const b = fake.seed({ title: 'B' }).identifier
  const toThree = await ops.moveToCycle([b, a], '3', ACTOR)
  assert.deepEqual(toThree.map((entry) => entry.after.id), [b, a])
  assert.deepEqual(toThree.map((entry) => entry.after.sprint), ['3', '3'])
  assert.equal('sprint' in toThree[0].before, false)
  const toCurrent = await ops.moveToCycle([a, b], 'current', ACTOR)
  assert.deepEqual(toCurrent.map((entry) => [entry.before.sprint, entry.after.sprint]), [['3', '2'], ['3', '2']])
  assert.equal(await sprintOf(issues, a), '2')
  const out = await ops.moveToCycle([a], null, ACTOR)
  assert.equal('sprint' in out[0].after, false)
  assert.equal(await sprintOf(issues, a), undefined)
  assert.equal(await sprintOf(issues, b), '2')
})

test('an issue already in the target cycle sends no mutation', async () => {
  const { ops, fake, fetch } = await setup()
  const [, two] = fake.cycles.list()
  const a = fake.seed({ title: 'A', cycleId: two.id }).identifier
  const [entry] = await ops.moveToCycle([a], '2', ACTOR)
  assert.deepEqual(entry.before, entry.after)
  assert.equal(mutationCount(fetch), 0)
})

test('current with no active cycle is INVALID_INPUT, and an unknown cycle is NOT_FOUND', async () => {
  const { ops, fake, fetch } = await setup({ cycles: [CYCLES[0], CYCLES[2]] })
  const a = fake.seed({ title: 'A' }).identifier
  await assert.rejects(ops.moveToCycle([a], 'current', ACTOR), { code: 'INVALID_INPUT', message: 'there is no active sprint', nextStep: 'pmkit cycle list' })
  await assert.rejects(ops.moveToCycle([a], '99', ACTOR), { code: 'NOT_FOUND', message: 'sprint 99 does not exist' })
  await assert.rejects(ops.moveToCycle([a], 'abc', ACTOR), { code: 'NOT_FOUND' })
  assert.equal(mutationCount(fetch), 0)
})

test('an unknown issue is NOT_FOUND and no issue moves', async () => {
  const { ops, issues, fake, fetch } = await setup()
  const a = fake.seed({ title: 'A' }).identifier
  await assert.rejects(ops.moveToCycle([a, 'ACME-99'], '3', ACTOR), { code: 'NOT_FOUND', message: 'issue ACME-99 does not exist' })
  assert.equal(mutationCount(fetch), 0)
  assert.equal(await sprintOf(issues, a), undefined)
})

test('an issue of another team is INVALID_INPUT naming both teams, and no mutation is sent', async () => {
  const { ops, issues, fake, fetch } = await setup()
  const a = fake.seed({ title: 'A' }).identifier
  const foreign = fake.seed({ title: 'Other team', teamId: OPS.id }).identifier
  await assert.rejects(ops.moveToCycle([a, foreign], '3', ACTOR), {
    code: 'INVALID_INPUT', message: `issue ${foreign} belongs to team OPS, and cycle 3 belongs to ACME`,
  })
  assert.equal(mutationCount(fetch), 0)
  assert.equal(await sprintOf(issues, a), undefined)
})

test('an empty or missing ids list is INVALID_INPUT', async () => {
  const { ops } = await setup()
  for (const ids of [[], undefined, 'ACME-1']) await assert.rejects(ops.moveToCycle(ids, '3', ACTOR), { code: 'INVALID_INPUT', message: 'ids must be a non-empty list' })
})

test('an actor other than the viewer is refused before anything is read', async () => {
  const { ops, fake, fetch } = await setup()
  const a = fake.seed({ title: 'A' }).identifier
  await assert.rejects(ops.moveToCycle([a], '3', 'user-2'), { code: 'INVALID_INPUT', message: /owner of LINEAR_API_KEY/ })
  assert.equal(mutationCount(fetch), 0)
})

test('a dry run sends no mutation and returns the same after', async () => {
  const { ops, issues, fake, fetch } = await setup()
  const a = fake.seed({ title: 'A' }).identifier
  const dry = await ops.moveToCycle([a], 'current', ACTOR, { dryRun: true })
  assert.equal(mutationCount(fetch), 0)
  assert.equal(await sprintOf(issues, a), undefined)
  const real = await ops.moveToCycle([a], 'current', ACTOR)
  const untimed = (results) => results.map(({ before, after }) => ({ before, after: { ...after, updated: undefined } }))
  assert.deepEqual(untimed(dry), untimed(real))
})

test('a failure halfway stops the loop and lists the ids already moved', async () => {
  let calls = 0
  const failSecond = (route) => (body) => (++calls === 2 ? { status: 200, json: { data: null, errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] } } : route(body))
  const { ops, issues, fake, fetch } = await setup({ wrap: { PmkitIssueUpdate: failSecond } })
  const ids3 = ['A', 'B', 'C'].map((title) => fake.seed({ title }).identifier)
  await assert.rejects(ops.moveToCycle(ids3, '3', ACTOR), (error) => {
    assert.notEqual(error.code, 'UNKNOWN')
    assert.deepEqual(error.details.moved, [ids3[0]])
    assert.equal(error.nextStep, `${ids3[0]} was moved; check Linear before you retry`)
    return true
  })
  assert.equal(mutationCount(fetch), 2)
  assert.equal(await sprintOf(issues, ids3[0]), '3')
  assert.equal(await sprintOf(issues, ids3[2]), undefined)
})

test('with cycles off, a move to a cycle is NOT_SUPPORTED and a move to null changes nothing', async () => {
  const { ops, fake, fetch } = await setup({ teams: [{ ...ACME, cyclesEnabled: false }, OPS] })
  const a = fake.seed({ title: 'A' }).identifier
  await assert.rejects(ops.moveToCycle([a], 'current', ACTOR), { code: 'NOT_SUPPORTED', message: 'team ACME has cycles turned off' })
  const [entry] = await ops.moveToCycle([a], null, ACTOR)
  assert.deepEqual(entry.before, entry.after)
  assert.equal(mutationCount(fetch), 0)
})

test('openCycle and closeCycle are NOT_SUPPORTED with their reason and next step, and send no request', async () => {
  const { ops, fetch } = await setup()
  await assert.rejects(ops.openCycle({ start: '2026-11-16' }, ACTOR), {
    code: 'NOT_SUPPORTED',
    message: "Linear creates cycles from the team's schedule, so pmkit cannot open one",
    nextStep: "Set the schedule in the team's cycle settings in Linear (duration, start day, upcoming cycles)",
  })
  await assert.rejects(ops.closeCycle('2', ACTOR), {
    code: 'NOT_SUPPORTED',
    message: 'Linear ends a cycle on its end date, so pmkit cannot close one',
    nextStep: 'Move the unfinished issues with pmkit cycle add --to <cycle|none>; Linear closes the cycle on its end date',
  })
  assert.equal(fetch.calls.length, 0)
})

test('openCycle and closeCycle do not validate their input', async () => {
  const { ops } = await setup()
  for (const call of [() => ops.openCycle(undefined), () => ops.openCycle({ start: 'garbage', nope: 1 }, 'user-2', { dryRun: true }), () => ops.closeCycle(undefined), () => ops.closeCycle('abc', 'user-2')]) {
    await assert.rejects(call(), { code: 'NOT_SUPPORTED' })
  }
})

const CAPACITY_FILE = '.pmkit/capacity.yaml'
const WEDNESDAY = '2026-10-21'

test('getCapacity and getDaysOff read the entry, and an unknown cycle is NOT_FOUND', async () => {
  const { ops, root } = await setup()
  assert.deepEqual(await ops.getCapacity('2'), {})
  assert.deepEqual(await ops.getDaysOff('2'), {})
  fs.mkdirSync(path.join(root, '.pmkit'))
  fs.writeFileSync(path.join(root, CAPACITY_FILE), `version: 1\ncycles:\n  ACME:\n    2:\n      capacity: { user-1: 8 }\n      days_off:\n        user-1: [${WEDNESDAY}]\n`)
  assert.deepEqual(await ops.getCapacity('2'), { 'user-1': 8 })
  assert.deepEqual(await ops.getDaysOff('2'), { 'user-1': [WEDNESDAY] })
  for (const call of [() => ops.getCapacity('99'), () => ops.getDaysOff('99'), () => ops.getCapacity('abc')]) {
    await assert.rejects(call(), { code: 'NOT_FOUND', nextStep: 'pmkit cycle list' })
  }
})

test('setCapacity and updateCycleCapacity return { before, after } as sprints, write the file and send no mutation', async () => {
  const { ops, root, fetch } = await setup()
  const set = await ops.setCapacity('2', { 'user-1': 8, 'user-2': 5 }, ACTOR)
  assert.deepEqual(set.before.capacity, {})
  assert.deepEqual(set.after.capacity, { 'user-1': 8, 'user-2': 5 })
  assert.equal(set.after.id, '2')
  assert.equal(set.after.state, 'active')
  const off = await ops.updateCycleCapacity('2', { daysOff: { 'user-1': [WEDNESDAY] } }, ACTOR)
  assert.deepEqual(off.before.capacity, { 'user-1': 8, 'user-2': 5 })
  assert.deepEqual(off.after.daysOff, { 'user-1': [WEDNESDAY] })
  assert.deepEqual(off.after.capacity, { 'user-1': 8, 'user-2': 5 })
  assert.ok(fs.existsSync(path.join(root, CAPACITY_FILE)))
  assert.deepEqual(await ops.getCapacity('2'), { 'user-1': 8, 'user-2': 5 })
  await ops.updateCycleCapacity('2', { daysOff: { 'user-1': null } }, ACTOR)
  assert.deepEqual(await ops.getDaysOff('2'), {})
  assert.ok(names(fetch).every((name) => !/Create|Update|Archive|Delete/.test(name)))
  assert.deepEqual((await ops.listCycles())[1].capacity, { 'user-1': 8, 'user-2': 5 })
})

test('capacity writes check members and dates, and refuse an actor that is not the viewer', async () => {
  const { ops, root } = await setup()
  await assert.rejects(ops.setCapacity('2', { stranger: 3 }, ACTOR), { code: 'INVALID_INPUT', message: /not a member/ })
  await assert.rejects(ops.updateCycleCapacity('2', { daysOff: { 'user-1': ['2026-12-01'] } }, ACTOR), { code: 'INVALID_INPUT', message: /outside the sprint/ })
  await assert.rejects(ops.setCapacity('2', { 'user-1': 3 }, 'user-2'), { code: 'INVALID_INPUT', message: /owner of LINEAR_API_KEY/ })
  await assert.rejects(ops.setCapacity('99', { 'user-1': 3 }, ACTOR), { code: 'NOT_FOUND' })
  assert.equal(fs.existsSync(path.join(root, CAPACITY_FILE)), false)
})

test('a day off on the day of endsAt is outside the sprint, and the day before is inside', async () => {
  const { ops } = await setup()
  await assert.rejects(ops.updateCycleCapacity('2', { daysOff: { 'user-1': ['2026-11-02'] } }, ACTOR), { code: 'INVALID_INPUT', message: /outside the sprint 2026-10-19 to 2026-11-01/ })
  await assert.rejects(ops.updateCycleCapacity('3', { daysOff: { 'user-1': ['2026-11-13'] } }, ACTOR), { code: 'INVALID_INPUT', message: /outside the sprint 2026-11-02 to 2026-11-12/ })
  const last = await ops.updateCycleCapacity('3', { daysOff: { 'user-1': ['2026-11-12'] } }, ACTOR)
  assert.deepEqual(last.after.daysOff, { 'user-1': ['2026-11-12'] })
})

test('a dry run on capacity returns the after and writes no file', async () => {
  const { ops, root } = await setup()
  const dry = await ops.setCapacity('2', { 'user-1': 8 }, ACTOR, { dryRun: true })
  assert.deepEqual(dry.after.capacity, { 'user-1': 8 })
  assert.equal(fs.existsSync(path.join(root, '.pmkit')), false)
})

test('with cycles off, the capacity operations answer NOT_SUPPORTED', async () => {
  const { ops } = await setup({ teams: [{ ...ACME, cyclesEnabled: false }, OPS] })
  const expected = { code: 'NOT_SUPPORTED', message: 'team ACME has cycles turned off' }
  await assert.rejects(ops.getCapacity('2'), expected)
  await assert.rejects(ops.getDaysOff('2'), expected)
  await assert.rejects(ops.setCapacity('2', {}, ACTOR), expected)
  await assert.rejects(ops.updateCycleCapacity('2', { capacity: {} }, ACTOR), expected)
})
