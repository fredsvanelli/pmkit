// The Cycles and Capacity families of the GitHub adapter against the stateful fake GitHub, through the real client.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fakeGithubIssues } from '../../fake-github-issues.mjs'
import { tempDir } from '../../test-helpers.mjs'
import { createGithubClient } from './client.mjs'
import { cycleOperations } from './cycle-ops.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { issueOperations } from './issue-ops.mjs'
import { makeContext } from './issues.mjs'

const PMKIT = {
  tracker: { system: 'github', scope: { host: 'github.com', repo: 'acme/widgets', project: 'acme/7' } },
  mappings: {
    status: { backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress', done: 'Done', canceled: 'none' },
    types: { bug: 'Bug', task: 'Task' },
    fields: { sprint: 'project:Sprint' },
  },
}
const ME = 'octocat'
// The clock of the adapter: inside Sprint 2, one day after the fake's start.
const NOW = new Date('2026-11-17T09:00:00.000Z')
const COMPLETED = [{ id: 'IT_0', title: 'Sprint 1', startDate: '2026-11-02', duration: 14 }]
const CURRENT = [{ id: 'IT_1', title: 'Sprint 2', startDate: '2026-11-16', duration: 14 }]

async function setup({ host = 'github.com', ghesVersion = null, iterations = { iterations: CURRENT, completed: COMPLETED }, pmkit = PMKIT, now = NOW } = {}) {
  const fake = fakeGithubIssues({ host, ghesVersion, project: iterations === null ? {} : { iterations } })
  const client = createGithubClient({ exec: fake.exec, retries: 0, sleep: async () => {} })
  const root = tempDir()
  const config = { root, pmkit }
  const state = { context: null, refreshes: 0 }
  const load = async () => {
    const raw = await fetchDiscovery(client, { host, repo: 'acme/widgets', project: 'acme/7', exec: fake.exec, users: true })
    state.context = makeContext(raw, pmkit)
  }
  await load()
  const getContext = async ({ refresh = false } = {}) => {
    if (refresh) {
      state.refreshes += 1
      await load()
    }
    return state.context
  }
  const ops = issueOperations({ client, config, getContext, now: () => now })
  const cycles = cycleOperations({ client, ops, config, getContext, now: () => now })
  return { fake, ops, cycles, root, state, clear: () => { fake.reads.splice(0); fake.mutations.splice(0) } }
}
const names = (fake) => fake.mutations.map((call) => call.name)
const ids = (list) => list.map((item) => item.id)
const updateCalls = (fake) => fake.mutations.filter((call) => call.name === 'PmkitUpdateIterations')

test('listCycles lists the completed and current iterations in start order with their states', async () => {
  const { cycles } = await setup()
  const sprints = await cycles.listCycles()
  assert.deepEqual(sprints, [
    { id: '2026-11-02', name: 'Sprint 1', start: '2026-11-02', end: '2026-11-15', goal: '', state: 'closed', capacity: {}, daysOff: {} },
    { id: '2026-11-16', name: 'Sprint 2', start: '2026-11-16', end: '2026-11-29', goal: '', state: 'active', capacity: {}, daysOff: {} },
  ])
})

test('listCycles keeps the first of two iterations on one start date and carries the warning outside the list JSON', async () => {
  const { cycles } = await setup({ iterations: { iterations: [...CURRENT, { id: 'IT_2', title: 'Twin', startDate: '2026-11-16', duration: 7 }], completed: COMPLETED } })
  const sprints = await cycles.listCycles()
  assert.deepEqual(ids(sprints), ['2026-11-02', '2026-11-16'])
  assert.deepEqual(sprints.warnings, ['two iterations start on 2026-11-16; pmkit shows the first'])
  assert.equal(JSON.stringify(sprints).includes('warnings'), false)
})

test('listCycles filters by state and refuses an unknown state', async () => {
  const { cycles } = await setup()
  assert.deepEqual(ids(await cycles.listCycles({ state: 'active' })), ['2026-11-16'])
  assert.deepEqual(ids(await cycles.listCycles({ state: 'closed' })), ['2026-11-02'])
  assert.deepEqual(await cycles.listCycles({ state: 'planned' }), [])
  await assert.rejects(cycles.listCycles({ state: 'open' }), { code: 'INVALID_INPUT', message: 'state must be one of planned, active, closed' })
})

test('listCycles reads the field on every call, so an iteration added on GitHub shows at once', async () => {
  const { fake, cycles, clear } = await setup()
  await cycles.listCycles()
  clear()
  await cycles.listCycles()
  assert.equal(fake.reads.filter((call) => call.name === 'PmkitIterationField').length, 1)
})

test('searchIssues --sprint current refreshes the discovery once when the cached field has no active iteration', async () => {
  const { fake, ops, state } = await setup({ iterations: { iterations: [], completed: COMPLETED } })
  // GitHub gains the current iteration after the discovery was cached.
  fake.state.project.fields.find((field) => field.name === 'Sprint').configuration.iterations.push(...structuredClone(CURRENT))
  fake.seed({ number: 1, item: { status: 'Todo', values: { Sprint: '2026-11-16' } } })
  fake.seed({ number: 2, item: { status: 'Todo', values: { Sprint: '2026-11-02' } } })
  assert.deepEqual(ids((await ops.searchIssues({ sprint: 'current' })).issues), ['1'])
  assert.equal(state.refreshes, 1)
})

test('searchIssues --sprint current with no active sprint after the refresh answers INVALID_INPUT, after one refresh', async () => {
  const { ops, state } = await setup({ now: new Date('2026-12-30T00:00:00Z') })
  await assert.rejects(ops.searchIssues({ sprint: 'current' }), { code: 'INVALID_INPUT', message: 'there is no active sprint', nextStep: 'pmkit cycle list' })
  assert.equal(state.refreshes, 1)
})

test('currentCycle is the active sprint, or null when none is active', async () => {
  const { cycles } = await setup()
  assert.equal((await cycles.currentCycle()).id, '2026-11-16')
  const later = await setup({ now: new Date('2026-12-30T00:00:00Z') })
  assert.equal(await later.cycles.currentCycle(), null)
})

test('cycleIssues returns the issues of an iteration, and nothing for an unknown date', async () => {
  const { fake, cycles } = await setup()
  fake.seed({ number: 1, item: { status: 'Todo', values: { Sprint: '2026-11-16' } } })
  fake.seed({ number: 2, item: { status: 'Todo', values: { Sprint: '2026-11-02' } } })
  fake.seed({ number: 3, item: { status: 'Todo' } })
  assert.deepEqual(ids(await cycles.cycleIssues('2026-11-16')), ['1'])
  assert.deepEqual(ids(await cycles.cycleIssues('2026-11-02')), ['2'])
  assert.deepEqual(await cycles.cycleIssues('2027-01-04'), [])
  assert.deepEqual(await cycles.cycleIssues('x'), [])
})

const readNames = (fake) => fake.reads.map((call) => call.name)

test('cycleIssues on github.com reads the sprint\'s Project items, not the repository', async () => {
  const { fake, cycles, clear } = await setup()
  fake.seed({ number: 1, item: { status: 'Todo', values: { Sprint: '2026-11-16' } } })
  fake.seed({ number: 2, item: { status: 'Todo', values: { Sprint: '2026-11-02' } } })
  fake.seed({ number: 3, item: { status: 'Todo' } })
  fake.seed({ number: 4, item: { status: 'Todo', archived: true, values: { Sprint: '2026-11-16' } } })
  fake.seed({ number: 5, createdAt: '2026-11-01T00:00:00.000Z', item: { status: 'Todo', values: { Sprint: '2026-11-16' } } })
  fake.seedProjectItem('acme/7', { type: 'PULL_REQUEST', title: 'A pull request' })
  clear()
  assert.deepEqual(ids(await cycles.cycleIssues('2026-11-16')), ['5', '1'])
  assert.ok(readNames(fake).includes('PmkitSprintItems'))
  assert.ok(!readNames(fake).includes('PmkitIssues'))
  assert.equal(fake.reads.find((call) => call.name === 'PmkitSprintItems').variables.query, 'is:issue repo:acme/widgets sprint:"Sprint 2"')
  clear()
  assert.deepEqual(await cycles.cycleIssues('2027-01-04'), [])
  assert.ok(!readNames(fake).includes('PmkitSprintItems'), 'a date the cached field lacks scans, as before')
})

test('cycleIssues keeps only the asked sprint when two iterations share a title', async () => {
  const same = { iterations: [{ id: 'IT_1', title: 'Sprint', startDate: '2026-11-16', duration: 14 }], completed: [{ id: 'IT_0', title: 'Sprint', startDate: '2026-11-02', duration: 14 }] }
  const { fake, cycles } = await setup({ iterations: same })
  fake.seed({ number: 1, item: { status: 'Todo', values: { Sprint: '2026-11-16' } } })
  fake.seed({ number: 2, item: { status: 'Todo', values: { Sprint: '2026-11-02' } } })
  assert.deepEqual(ids(await cycles.cycleIssues('2026-11-16')), ['1'])
  assert.deepEqual(ids(await cycles.cycleIssues('2026-11-02')), ['2'])
})

test('cycleIssues on GHES, or for a title with a quote, scans the repository', async () => {
  const quoted = { iterations: [{ id: 'IT_1', title: 'Sprint "2"', startDate: '2026-11-16', duration: 14 }], completed: COMPLETED }
  for (const options of [{ host: 'ghe.acme.test', ghesVersion: '3.20.0' }, { iterations: quoted }]) {
    const { fake, cycles, clear } = await setup(options)
    fake.seed({ number: 1, item: { status: 'Todo', values: { Sprint: '2026-11-16' } } })
    clear()
    assert.deepEqual(ids(await cycles.cycleIssues('2026-11-16')), ['1'], JSON.stringify(options))
    assert.ok(readNames(fake).includes('PmkitIssues'))
    assert.ok(!readNames(fake).includes('PmkitSprintItems'))
  }
})

test('openCycle sends one update that keeps every id, and an item in a completed iteration keeps its sprint', async () => {
  const { fake, ops, cycles, clear } = await setup()
  fake.seed({ number: 1, item: { status: 'Todo', values: { Sprint: '2026-11-02' } } })
  fake.seed({ number: 2, item: { status: 'Todo', values: { Sprint: '2026-11-16' } } })
  clear()
  const result = await cycles.openCycle({ start: '2026-11-30' }, ME)
  assert.deepEqual(names(fake), ['PmkitUpdateIterations'])
  assert.deepEqual(updateCalls(fake)[0].input.iterationConfiguration, {
    startDate: '2026-11-02',
    duration: 14,
    iterations: [
      { id: 'IT_0', title: 'Sprint 1', startDate: '2026-11-02', duration: 14 },
      { id: 'IT_1', title: 'Sprint 2', startDate: '2026-11-16', duration: 14 },
      { title: 'Sprint 2026-11-30', startDate: '2026-11-30', duration: 14 },
    ],
  })
  assert.equal(result.before, null)
  assert.deepEqual(result.after, { id: '2026-11-30', name: 'Sprint 2026-11-30', start: '2026-11-30', end: '2026-12-13', goal: '', state: 'planned', capacity: {}, daysOff: {} })
  assert.equal((await ops.getIssue('1')).sprint, '2026-11-02')
  assert.equal((await ops.getIssue('2')).sprint, '2026-11-16')
  assert.deepEqual(ids(await cycles.listCycles()), ['2026-11-02', '2026-11-16', '2026-11-30'])
})

test('openCycle takes an end and a name, and the new sprint can then be written to an issue', async () => {
  const { fake, ops, cycles, state } = await setup()
  fake.seed({ number: 5, item: { status: 'Todo' } })
  const { after } = await cycles.openCycle({ start: '2026-12-01', end: '2026-12-05', name: 'Short one' }, ME)
  assert.deepEqual([after.name, after.start, after.end], ['Short one', '2026-12-01', '2026-12-05'])
  // The discovery memo is reread after the update, so the new iteration resolves in a write.
  assert.equal(state.refreshes, 1)
  const moved = await cycles.moveToCycle(['5'], '2026-12-01', ME)
  assert.equal(moved[0].after.sprint, '2026-12-01')
  assert.equal((await ops.getIssue('5')).sprint, '2026-12-01')
})

test('openCycle refuses a bad input, an existing start date and an overlap before any write', async () => {
  const { fake, cycles, clear } = await setup()
  clear()
  const bad = (input, expected) => assert.rejects(cycles.openCycle(input, ME), expected)
  await bad({}, { code: 'INVALID_INPUT', message: 'start must be a date as YYYY-MM-DD' })
  await bad({ start: '2026-11-30', end: 'soon' }, { code: 'INVALID_INPUT', message: 'end must be a date as YYYY-MM-DD' })
  await bad({ start: '2026-11-30', end: '2026-11-29' }, { code: 'INVALID_INPUT', message: 'start 2026-11-30 is after end 2026-11-29' })
  await bad({ start: '2026-11-30', name: '  ' }, { code: 'INVALID_INPUT', message: 'name must be a non-empty string' })
  await bad({ start: '2026-11-30', colour: 'red' }, { code: 'INVALID_INPUT', message: 'unknown field "colour"' })
  await bad({ start: '2026-11-16' }, { code: 'INVALID_INPUT', message: 'sprint 2026-11-16 already exists', nextStep: 'pmkit cycle list' })
  await bad({ start: '2026-11-20' }, { code: 'INVALID_INPUT', message: 'sprint 2026-11-20 to 2026-12-03 overlaps 2026-11-16 (2026-11-16 to 2026-11-29)', nextStep: 'pmkit cycle list' })
  assert.deepEqual(fake.mutations, [])
})

test('openCycle may overlap a closed sprint', async () => {
  const { cycles } = await setup()
  const { after } = await cycles.openCycle({ start: '2026-11-05', end: '2026-11-06' }, ME)
  assert.equal(after.start, '2026-11-05')
})

test('openCycle with a goal is NOT_SUPPORTED, and sends nothing', async () => {
  const { fake, cycles, clear } = await setup()
  clear()
  await assert.rejects(cycles.openCycle({ start: '2026-11-30', goal: 'Ship' }, ME), { code: 'NOT_SUPPORTED', message: 'a GitHub iteration has no goal' })
  assert.deepEqual(fake.mutations, [])
  assert.equal((await cycles.openCycle({ start: '2026-11-30', goal: '' }, ME, { dryRun: true })).after.id, '2026-11-30')
})

test('openCycle on GHES is NOT_SUPPORTED with the settings step, and sends nothing', async () => {
  const { fake, cycles, clear } = await setup({ host: 'github.acme.test', ghesVersion: '3.21' })
  clear()
  await assert.rejects(cycles.openCycle({ start: '2026-11-30' }, ME), { code: 'NOT_SUPPORTED', nextStep: 'Add the iteration in the Project settings on GitHub' })
  assert.deepEqual(fake.mutations, [])
})

test('an openCycle dry run sends nothing and shows the new sprint', async () => {
  const { fake, cycles, state, clear } = await setup()
  clear()
  const result = await cycles.openCycle({ start: '2026-11-30' }, ME, { dryRun: true })
  assert.deepEqual(fake.mutations, [])
  assert.equal(result.after.name, 'Sprint 2026-11-30')
  assert.equal(state.refreshes, 0)
  assert.deepEqual(ids(await cycles.listCycles()), ['2026-11-02', '2026-11-16'])
})

test('openCycle checks the actor', async () => {
  const { cycles } = await setup()
  await assert.rejects(cycles.openCycle({ start: '2026-11-30' }, 'stranger'), { code: 'INVALID_INPUT' })
})

test('closeCycle is NOT_SUPPORTED with the move step', async () => {
  const { cycles } = await setup()
  await assert.rejects(cycles.closeCycle('2026-11-16', ME), { code: 'NOT_SUPPORTED', message: 'GitHub ends an iteration on its end date', nextStep: 'pmkit cycle add <ids> --to <next sprint>' })
})

test('moveToCycle adds the item of an issue that has none, then the issue reads the sprint', async () => {
  const { fake, ops, cycles, clear } = await setup()
  fake.seed({ number: 12 })
  clear()
  assert.equal((await ops.getIssue('12')).sprint, undefined)
  const [result] = await cycles.moveToCycle(['12'], '2026-11-16', ME)
  assert.deepEqual(names(fake), ['PmkitAddProjectItem', 'PmkitSetProjectField'])
  assert.equal(result.before.sprint, undefined)
  assert.equal(result.after.sprint, '2026-11-16')
  assert.equal((await ops.getIssue('12')).sprint, '2026-11-16')
})

test('moveToCycle current uses the active sprint, null clears, and a dry run sends nothing', async () => {
  const { fake, ops, cycles, clear } = await setup()
  fake.seed({ number: 1, item: { status: 'Todo' } })
  clear()
  const dry = await cycles.moveToCycle(['1'], 'current', ME, { dryRun: true })
  assert.deepEqual(fake.mutations, [])
  assert.equal(dry[0].after.sprint, '2026-11-16')
  await cycles.moveToCycle(['1'], 'current', ME)
  assert.equal((await ops.getIssue('1')).sprint, '2026-11-16')
  const [cleared] = await cycles.moveToCycle(['1'], null, ME)
  assert.equal(cleared.after.sprint, undefined)
  assert.equal(names(fake).at(-1), 'PmkitClearProjectField')
})

test('moveToCycle reads each issue once before its write', async () => {
  const { fake, cycles, clear } = await setup()
  fake.seed({ number: 1, item: { status: 'Todo' } })
  fake.seed({ number: 2, item: { status: 'Todo' } })
  clear()
  await cycles.moveToCycle(['1', '2'], '2026-11-16', ME)
  // One read per issue before the writes, and the read of what GitHub holds after each write.
  assert.equal(fake.reads.filter((call) => call.name === 'PmkitIssue').length, 4)
})

test('moveToCycle of the same id twice plans the second write from a fresh read', async () => {
  const { fake, cycles, clear } = await setup()
  fake.seed({ number: 1, item: { status: 'Todo' } })
  clear()
  const results = await cycles.moveToCycle(['1', '1'], '2026-11-16', ME)
  assert.equal(results[1].before.sprint, '2026-11-16')
  assert.equal(fake.mutations.filter((call) => call.name === 'PmkitSetProjectField').length, 1)
})

test('moveToCycle checks every issue and the target before it writes', async () => {
  const { fake, cycles, clear } = await setup()
  fake.seed({ number: 1, item: { status: 'Todo' } })
  clear()
  await assert.rejects(cycles.moveToCycle(['1', '99'], '2026-11-16', ME), { code: 'NOT_FOUND' })
  await assert.rejects(cycles.moveToCycle(['1'], '2027-01-04', ME), { code: 'NOT_FOUND', message: 'sprint 2027-01-04 does not exist', nextStep: 'pmkit cycle list' })
  await assert.rejects(cycles.moveToCycle([], '2026-11-16', ME), { code: 'INVALID_INPUT', message: 'ids must be a non-empty list' })
  assert.deepEqual(fake.mutations, [])
  const later = await setup({ now: new Date('2026-12-30T00:00:00Z') })
  await assert.rejects(later.cycles.moveToCycle(['1'], 'current', ME), { code: 'INVALID_INPUT', message: 'there is no active sprint', nextStep: 'pmkit cycle list' })
})

test('moveToCycle accepts a closed sprint as Local does, and the issue reads it', async () => {
  const { fake, ops, cycles } = await setup()
  fake.seed({ number: 1, item: { status: 'Todo' } })
  const [result] = await cycles.moveToCycle(['1'], '2026-11-02', ME)
  assert.equal(result.after.sprint, '2026-11-02')
  assert.equal((await ops.getIssue('1')).sprint, '2026-11-02')
})

test('an issue of another repository stops moveToCycle before any write', async () => {
  const { fake, cycles, clear } = await setup()
  fake.seed({ number: 1, item: { status: 'Todo' } })
  fake.seed({ repo: 'acme/other', number: 5 })
  clear()
  await assert.rejects(cycles.moveToCycle(['1', 'acme/other#5'], '2026-11-16', ME), { code: 'INVALID_INPUT', message: 'the GitHub adapter writes issues of acme/widgets only' })
  assert.deepEqual(fake.mutations, [])
})

test('a failure on the second issue lists the first as moved', async () => {
  const { fake, ops, cycles } = await setup()
  fake.seed({ number: 1, item: { status: 'Todo' } })
  // The second issue has no item, and the add of its item fails.
  fake.seed({ number: 2 })
  fake.failNext('PmkitAddProjectItem')
  await assert.rejects(cycles.moveToCycle(['1', '2'], '2026-11-16', ME), (error) => {
    assert.equal(error.nextStep, '1 was moved; check GitHub before you retry')
    assert.deepEqual(error.details.moved, ['1'])
    return true
  })
  assert.equal((await ops.getIssue('1')).sprint, '2026-11-16')
})

test('openCycle checks start and end before it reads the field', async () => {
  const { fake, cycles, clear } = await setup()
  clear()
  await assert.rejects(cycles.openCycle({ start: '2026-13-45' }, ME), { code: 'INVALID_INPUT', message: 'start must be a date as YYYY-MM-DD' })
  await assert.rejects(cycles.openCycle({ start: '2026-11-30', end: 'x' }, ME), { code: 'INVALID_INPUT', message: 'end must be a date as YYYY-MM-DD' })
  assert.deepEqual(fake.reads, [])
})

test('capacity is set, read, patched and cleared through .pmkit/capacity.yaml', async () => {
  const { cycles, root } = await setup()
  const id = '2026-11-16'
  assert.deepEqual(await cycles.getCapacity(id), {})
  const set = await cycles.setCapacity(id, { octocat: 8 }, ME)
  assert.deepEqual(set.before.capacity, {})
  assert.deepEqual(set.after.capacity, { octocat: 8 })
  assert.deepEqual(await cycles.getCapacity(id), { octocat: 8 })
  const file = fs.readFileSync(path.join(root, '.pmkit/capacity.yaml'), 'utf8')
  assert.match(file, /github:acme\/7/)
  assert.match(file, /2026-11-16/)
  const patched = await cycles.updateCycleCapacity(id, { capacityPatch: { octocat: 5 }, daysOff: { octocat: ['2026-11-18'] } }, ME)
  assert.deepEqual(patched.after.capacity, { octocat: 5 })
  assert.deepEqual(await cycles.getDaysOff(id), { octocat: ['2026-11-18'] })
  assert.deepEqual((await cycles.listCycles({ state: 'active' }))[0].capacity, { octocat: 5 })
  await cycles.updateCycleCapacity(id, { capacityPatch: { octocat: null }, daysOff: { octocat: null } }, ME)
  assert.deepEqual(await cycles.getCapacity(id), {})
  assert.deepEqual(await cycles.getDaysOff(id), {})
})

test('capacity refuses an unknown sprint, a stranger and a day off outside the sprint, and a dry run writes nothing', async () => {
  const { cycles, root } = await setup()
  await assert.rejects(cycles.getCapacity('2027-01-04'), { code: 'NOT_FOUND', message: 'sprint 2027-01-04 does not exist', nextStep: 'pmkit cycle list' })
  await assert.rejects(cycles.setCapacity('2026-11-16', { stranger: 3 }, ME), { code: 'INVALID_INPUT', message: /not a member/ })
  await assert.rejects(cycles.updateCycleCapacity('2026-11-16', { daysOff: { octocat: ['2026-12-30'] } }, ME), { code: 'INVALID_INPUT', message: /outside the sprint/ })
  await assert.rejects(cycles.setCapacity('2026-11-16', { octocat: 3 }, 'stranger'), { code: 'INVALID_INPUT' })
  const dry = await cycles.setCapacity('2026-11-16', { octocat: 3 }, ME, { dryRun: true })
  assert.deepEqual(dry.after.capacity, { octocat: 3 })
  assert.equal(fs.existsSync(path.join(root, '.pmkit/capacity.yaml')), false)
})

test('a Project with no iteration field answers NOT_SUPPORTED for every cycle read', async () => {
  const { cycles } = await setup({ iterations: null, pmkit: { ...PMKIT, mappings: { ...PMKIT.mappings, fields: {} } } })
  await assert.rejects(cycles.listCycles(), { code: 'NOT_SUPPORTED', nextStep: '/pmkit:setup' })
  await assert.rejects(cycles.currentCycle(), { code: 'NOT_SUPPORTED' })
})
