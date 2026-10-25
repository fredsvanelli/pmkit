import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { requireDaysOff } from './lib/local/sprints.mjs'
import { parseYaml } from './lib/yaml.mjs'
import { fixedNow, hashTree, makeRepo } from './test-helpers.mjs'

function setup(fixture = 'team', iso) {
  const root = makeRepo(fixture)
  const sprints = path.join(root, '.issues', 'sprints')
  const tracker = createLocalTracker(root, { now: fixedNow(iso), random: () => 0 })
  const read = (id) => parseYaml(fs.readFileSync(path.join(sprints, `${id}.yaml`), 'utf8'))
  return { root, sprints, tracker, read }
}

const code = (expected, pattern) => (error) => {
  assert.equal(error.code, expected)
  if (pattern) assert.match(error.message, pattern)
  return true
}

test('listCycles returns sprints sorted by start and filters by state', () => {
  const { tracker } = setup()
  assert.deepEqual(tracker.listCycles().map((s) => s.id), ['2026-09-28', '2026-10-12'])
  assert.deepEqual(tracker.listCycles({ state: 'active' }).map((s) => s.id), ['2026-10-12'])
  assert.deepEqual(tracker.listCycles({ state: 'planned' }), [])
  assert.throws(() => tracker.listCycles({ state: 'open' }), code('INVALID_INPUT'))
  assert.deepEqual(setup('basic').tracker.listCycles(), [])
})

test('a sprint has id, name, dates, goal, state, capacity and daysOff', () => {
  const { tracker } = setup()
  const [closed, active] = tracker.listCycles()
  assert.deepEqual(active, {
    id: '2026-10-12',
    name: 'Sprint 2026-10-12',
    start: '2026-10-12',
    end: '2026-10-25',
    goal: 'Webhook retries and the billing export',
    state: 'active',
    capacity: { fred: 8, ana: 10 },
    daysOff: { ana: ['2026-10-16'] },
  })
  assert.deepEqual(closed.daysOff, {})
})

test('currentCycle returns the active sprint or null', () => {
  assert.equal(setup().tracker.currentCycle().id, '2026-10-12')
  assert.equal(setup('basic').tracker.currentCycle(), null)
})

test('a sprint file with a BOM and CRLF reads like its LF copy', () => {
  const { sprints, tracker } = setup()
  const file = path.join(sprints, '2026-10-12.yaml')
  const lf = tracker.currentCycle()
  fs.writeFileSync(file, `\uFEFF${fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n')}`)
  assert.deepEqual(tracker.currentCycle(), lf)
})

test('a sprint file that does not parse throws INVALID_INPUT naming the file, in currentCycle and in search', () => {
  const { sprints, tracker } = setup()
  fs.writeFileSync(path.join(sprints, '2026-10-12.yaml'), 'name: [broken\nstate active\n')
  for (const run of [() => tracker.currentCycle(), () => tracker.listCycles(), () => tracker.searchIssues({ sprint: 'current' })]) {
    assert.throws(run, (error) => {
      assert.equal(error.code, 'INVALID_INPUT')
      assert.match(error.message, /2026-10-12\.yaml/)
      assert.equal(error.nextStep, '/pmkit:local:doctor')
      return true
    })
  }
})

test('searchIssues with sprint current returns the issues of the active sprint', () => {
  const { tracker } = setup()
  const ids = tracker.searchIssues({ sprint: 'current' }).issues.map((issue) => issue.id).sort()
  assert.deepEqual(ids, ['ISS-2X6D', 'ISS-4M2S', 'ISS-5N1R', 'ISS-8C4W'])
  assert.deepEqual(setup('basic').tracker.searchIssues({ sprint: 'current' }).issues, [])
})

test('cycleIssues returns the issues of a sprint and refuses an unknown one', () => {
  const { tracker } = setup()
  assert.deepEqual(tracker.cycleIssues('2026-09-28').map((issue) => issue.id).sort(), ['ISS-4P8A', 'ISS-7K3Q', 'ISS-9T2M'])
  assert.throws(() => tracker.cycleIssues('2030-01-01'), code('NOT_FOUND'))
})

test('openCycle defaults end to start plus sprint_length_days minus 1 and name to Sprint <start>', () => {
  const { tracker, read } = setup('basic')
  const { before, after } = tracker.openCycle({ start: '2026-10-26' }, 'fred')
  assert.equal(before, null)
  assert.equal(after.end, '2026-11-08')
  assert.equal(after.name, 'Sprint 2026-10-26')
  assert.deepEqual(read('2026-10-26'), { name: 'Sprint 2026-10-26', start: '2026-10-26', end: '2026-11-08', state: 'planned' })
})

test('openCycle makes the sprint active when it starts today or earlier and none is active', () => {
  const { tracker, read } = setup('basic')
  const { after } = tracker.openCycle({ start: '2026-10-20', goal: 'Ship it', name: 'Alpha' }, 'fred')
  assert.equal(after.state, 'active')
  assert.deepEqual(read('2026-10-20'), { name: 'Alpha', start: '2026-10-20', end: '2026-11-02', goal: 'Ship it', state: 'active' })
  assert.equal(tracker.currentCycle().id, '2026-10-20')
})

test('openCycle on today uses the UTC date of now()', () => {
  const { tracker } = setup('basic', '2026-10-23T23:30:00Z')
  assert.equal(tracker.openCycle({ start: '2026-10-23' }, 'fred').after.state, 'active')
  const later = setup('basic', '2026-10-23T23:30:00Z').tracker
  assert.equal(later.openCycle({ start: '2026-10-24' }, 'fred').after.state, 'planned')
})

test('openCycle is planned when its start is in the future or a sprint is already active', () => {
  const { tracker } = setup('basic')
  assert.equal(tracker.openCycle({ start: '2026-11-02' }, 'fred').after.state, 'planned')
  const team = setup().tracker
  assert.equal(team.openCycle({ start: '2026-10-26' }, 'fred').after.state, 'planned')
  assert.equal(team.currentCycle().id, '2026-10-12')
})

test('openCycle refuses an overlap with a planned or active sprint and a start that already has a file', () => {
  const { tracker, sprints } = setup()
  assert.throws(() => tracker.openCycle({ start: '2026-10-20', end: '2026-10-30' }, 'fred'), code('INVALID_INPUT', /overlaps 2026-10-12/))
  assert.throws(() => tracker.openCycle({ start: '2026-10-01', end: '2026-10-12' }, 'fred'), code('INVALID_INPUT', /overlaps 2026-10-12/))
  assert.throws(() => tracker.openCycle({ start: '2026-10-12', end: '2026-10-12' }, 'fred'), code('INVALID_INPUT', /2026-10-12/))
  assert.throws(() => tracker.openCycle({ start: '2026-09-28' }, 'fred'), code('INVALID_INPUT', /already/))
  tracker.openCycle({ start: '2026-10-26' }, 'fred')
  assert.throws(() => tracker.openCycle({ start: '2026-11-01', end: '2026-11-10' }, 'fred'), code('INVALID_INPUT', /overlaps 2026-10-26/))
  assert.deepEqual(fs.readdirSync(sprints).sort(), ['2026-09-28.yaml', '2026-10-12.yaml', '2026-10-26.yaml'])
})

test('openCycle may start the day after another sprint ends', () => {
  const { tracker } = setup()
  assert.equal(tracker.openCycle({ start: '2026-10-26', end: '2026-10-26' }, 'fred').after.end, '2026-10-26')
})

test('openCycle refuses start after end, bad dates, a non-member actor and bad text', () => {
  const { tracker } = setup('basic')
  assert.throws(() => tracker.openCycle({ start: '2026-11-10', end: '2026-11-01' }, 'fred'), code('INVALID_INPUT', /start/))
  assert.throws(() => tracker.openCycle({ start: '2026-13-01' }, 'fred'), code('INVALID_INPUT', /start/))
  assert.throws(() => tracker.openCycle({}, 'fred'), code('INVALID_INPUT', /start/))
  assert.throws(() => tracker.openCycle({ start: '2026-11-01', end: 'soon' }, 'fred'), code('INVALID_INPUT', /end/))
  assert.throws(() => tracker.openCycle({ start: '2026-11-01' }, 'ghost'), code('INVALID_INPUT', /actor/))
  assert.throws(() => tracker.openCycle({ start: '2026-11-01', name: '' }, 'fred'), code('INVALID_INPUT', /name/))
  assert.throws(() => tracker.openCycle({ start: '2026-11-01', goal: 4 }, 'fred'), code('INVALID_INPUT', /goal/))
  assert.throws(() => tracker.openCycle({ start: '2026-11-01', capacity: { fred: 1 } }, 'fred'), code('INVALID_INPUT', /capacity/))
})

test('openCycle with dryRun writes nothing and returns before and after', () => {
  const { root, tracker } = setup()
  const hash = hashTree(root)
  const result = tracker.openCycle({ start: '2026-10-26' }, 'fred', { dryRun: true })
  assert.equal(result.before, null)
  assert.equal(result.after.state, 'planned')
  assert.equal(hashTree(root), hash)
})

test('closeCycle closes the active sprint and returns the issues not in a terminal category', () => {
  const { tracker, read } = setup()
  const { sprint, unfinished } = tracker.closeCycle('2026-10-12', 'fred')
  assert.equal(sprint.state, 'closed')
  assert.equal(read('2026-10-12').state, 'closed')
  assert.equal(read('2026-10-12').goal, 'Webhook retries and the billing export')
  assert.deepEqual(unfinished.map((issue) => issue.id).sort(), ['ISS-2X6D', 'ISS-4M2S', 'ISS-5N1R', 'ISS-8C4W'])
  assert.equal(unfinished[0].sprint, '2026-10-12')
  assert.equal(tracker.currentCycle(), null)
})

test('closeCycle leaves out done and canceled issues', () => {
  const { tracker } = setup()
  tracker.moveToCategory('ISS-5N1R', 'done', 'fred')
  tracker.moveToCategory('ISS-4M2S', 'canceled', 'fred')
  const { unfinished } = tracker.closeCycle('2026-10-12', 'fred')
  assert.deepEqual(unfinished.map((issue) => issue.id).sort(), ['ISS-2X6D', 'ISS-8C4W'])
})

test('closeCycle refuses a planned or closed sprint and an unknown one', () => {
  const { tracker, read } = setup()
  tracker.openCycle({ start: '2026-10-26' }, 'fred')
  assert.throws(() => tracker.closeCycle('2026-10-26', 'fred'), code('INVALID_INPUT', /not active/))
  assert.throws(() => tracker.closeCycle('2026-09-28', 'fred'), code('INVALID_INPUT', /not active/))
  assert.throws(() => tracker.closeCycle('2030-01-01', 'fred'), code('NOT_FOUND'))
  assert.throws(() => tracker.closeCycle('2026-10-12', 'ghost'), code('INVALID_INPUT', /actor/))
  assert.equal(read('2026-10-26').state, 'planned')
})

test('closeCycle with dryRun writes nothing and still reports the unfinished issues', () => {
  const { root, tracker } = setup()
  const hash = hashTree(root)
  const { sprint, unfinished } = tracker.closeCycle('2026-10-12', 'fred', { dryRun: true })
  assert.equal(sprint.state, 'closed')
  assert.equal(unfinished.length, 4)
  assert.equal(hashTree(root), hash)
})

test('moveToCycle moves issues and writes one update event on field sprint for each', () => {
  const { tracker } = setup()
  tracker.openCycle({ start: '2026-10-26' }, 'fred')
  const results = tracker.moveToCycle(['ISS-3F7H', 'ISS-6J0B'], '2026-10-26', 'fred')
  assert.equal(results.length, 2)
  assert.equal(results[0].before.sprint, undefined)
  assert.equal(results[0].after.sprint, '2026-10-26')
  for (const id of ['ISS-3F7H', 'ISS-6J0B']) {
    assert.equal(tracker.getIssue(id).sprint, '2026-10-26')
    const event = tracker.getHistory(id).at(-1)
    assert.deepEqual([event.op, event.field, event.to], ['update', 'sprint', '2026-10-26'])
  }
})

test('moveToCycle to null clears the sprint', () => {
  const { tracker } = setup()
  const [result] = tracker.moveToCycle(['ISS-5N1R'], null, 'fred')
  assert.equal(result.before.sprint, '2026-10-12')
  assert.equal(result.after.sprint, undefined)
  assert.equal(tracker.getIssue('ISS-5N1R').sprint, undefined)
  const event = tracker.getHistory('ISS-5N1R').at(-1)
  assert.deepEqual([event.op, event.field, event.from, event.to], ['update', 'sprint', '2026-10-12', null])
})

test('moveToCycle checks every id and the sprint before it writes anything', () => {
  const { root, tracker } = setup()
  const hash = hashTree(root)
  assert.throws(() => tracker.moveToCycle(['ISS-3F7H', 'ISS-ZZZZ'], '2026-10-12', 'fred'), code('NOT_FOUND'))
  assert.throws(() => tracker.moveToCycle(['ISS-3F7H'], '2030-01-01', 'fred'), code('NOT_FOUND'))
  assert.throws(() => tracker.moveToCycle(['ISS-3F7H'], '2026-10-12', 'ghost'), code('INVALID_INPUT', /actor/))
  assert.throws(() => tracker.moveToCycle([], '2026-10-12', 'fred'), code('INVALID_INPUT'))
  assert.equal(hashTree(root), hash)
})

test('moveToCycle with dryRun writes nothing', () => {
  const { root, tracker } = setup()
  const hash = hashTree(root)
  const [result] = tracker.moveToCycle(['ISS-3F7H'], '2026-10-12', 'fred', { dryRun: true })
  assert.equal(result.after.sprint, '2026-10-12')
  assert.equal(hashTree(root), hash)
})

test('getCapacity returns the map, empty for a new sprint', () => {
  const { tracker } = setup()
  assert.deepEqual(tracker.getCapacity('2026-10-12'), { fred: 8, ana: 10 })
  tracker.openCycle({ start: '2026-10-26' }, 'fred')
  assert.deepEqual(tracker.getCapacity('2026-10-26'), {})
  assert.throws(() => tracker.getCapacity('2030-01-01'), code('NOT_FOUND'))
})

test('setCapacity replaces the whole map and keeps the other fields', () => {
  const { tracker, read } = setup()
  const { before, after } = tracker.setCapacity('2026-10-12', { fred: 5.5 }, 'ana')
  assert.deepEqual(before.capacity, { fred: 8, ana: 10 })
  assert.deepEqual(after.capacity, { fred: 5.5 })
  const file = read('2026-10-12')
  assert.deepEqual(file.capacity, { fred: 5.5 })
  assert.deepEqual(file.days_off, { ana: ['2026-10-16'] })
  assert.equal(file.state, 'active')
  tracker.setCapacity('2026-10-12', {}, 'ana')
  assert.deepEqual(tracker.getCapacity('2026-10-12'), {})
  tracker.setCapacity('2026-10-12', { fred: 0 }, 'ana')
  assert.deepEqual(tracker.getCapacity('2026-10-12'), { fred: 0 })
})

test('setCapacity validates members, values, sprint and actor', () => {
  const { root, tracker } = setup()
  const hash = hashTree(root)
  assert.throws(() => tracker.setCapacity('2026-10-12', { ghost: 3 }, 'fred'), code('INVALID_INPUT', /ghost/))
  for (const value of [-1, NaN, Infinity, '3', null, true]) {
    assert.throws(() => tracker.setCapacity('2026-10-12', { fred: value }, 'fred'), code('INVALID_INPUT', /fred/))
  }
  assert.throws(() => tracker.setCapacity('2026-10-12', [], 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.setCapacity('2030-01-01', { fred: 1 }, 'fred'), code('NOT_FOUND'))
  assert.throws(() => tracker.setCapacity('2026-10-12', { fred: 1 }, 'ghost'), code('INVALID_INPUT', /actor/))
  assert.equal(hashTree(root), hash)
})

test('setCapacity with dryRun writes nothing and returns before and after', () => {
  const { root, tracker } = setup()
  const hash = hashTree(root)
  const result = tracker.setCapacity('2026-10-12', { fred: 1 }, 'fred', { dryRun: true })
  assert.deepEqual(result.after.capacity, { fred: 1 })
  assert.equal(hashTree(root), hash)
})

test('openCycle refuses a line break in the name or the goal and writes nothing', () => {
  const { root, tracker } = setup('basic')
  const hash = hashTree(root)
  for (const input of [{ name: 'Sprint\none' }, { goal: 'Ship\nthe thing' }, { goal: 'Ship\rit' }]) {
    assert.throws(() => tracker.openCycle({ start: '2026-11-02', ...input }, 'fred'), code('INVALID_INPUT', /line break/))
  }
  assert.equal(hashTree(root), hash)
  assert.deepEqual(tracker.listCycles(), [])
})

test('a hand-added key in a sprint file survives the next write', () => {
  const { sprints, tracker, read } = setup()
  const file = path.join(sprints, '2026-10-12.yaml')
  fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}retro: 2026-10-26\n`)
  tracker.setCapacity('2026-10-12', { fred: 5 }, 'fred')
  assert.equal(read('2026-10-12').retro, '2026-10-26')
  assert.deepEqual(read('2026-10-12').capacity, { fred: 5 })
})

test('closeCycle reports the issues it could not read as problems', () => {
  const { tracker } = setup()
  const result = tracker.closeCycle('2026-10-12', 'fred')
  assert.deepEqual(result.problems.map((problem) => [problem.id, problem.code]), [['ISS-3Q6T', 'CONFLICT']])
})

const MEMBERS = { fred: {}, ana: {} }
const SPRINT = { start: '2026-10-12', end: '2026-10-25' }

test('requireDaysOff rejects unknown members, bad dates, out of range, weekends, repeats and non-arrays', () => {
  const cases = [
    [{ ghost: ['2026-10-14'] }, /days off member "ghost" is not a member/],
    [{ fred: ['2026-02-30'] }, /days off date "2026-02-30" for fred is not a valid date \(YYYY-MM-DD\)/],
    [{ fred: ['2026-10-11'] }, /days off date 2026-10-11 for fred is outside the sprint 2026-10-12 to 2026-10-25/],
    [{ fred: ['2026-10-26'] }, /days off date 2026-10-26 for fred is outside the sprint/],
    [{ fred: ['2026-10-17'] }, /days off date 2026-10-17 for fred is not a weekday/],
    [{ fred: ['2026-10-14', '2026-10-14'] }, /days off date 2026-10-14 for fred is repeated/],
    [{ fred: '2026-10-14' }, /fred/],
  ]
  for (const [value, pattern] of cases) {
    assert.throws(() => requireDaysOff(value, MEMBERS, SPRINT), code('INVALID_INPUT', pattern))
  }
  assert.throws(() => requireDaysOff([], MEMBERS, SPRINT), code('INVALID_INPUT'))
})

test('requireDaysOff accepts the sprint start and the last weekday, sorts lists and keeps null', () => {
  assert.deepEqual(requireDaysOff({ fred: ['2026-10-23', '2026-10-12'] }, MEMBERS, SPRINT), { fred: ['2026-10-12', '2026-10-23'] })
  assert.deepEqual(requireDaysOff({ ana: ['2026-10-19', '2026-10-16'], fred: null }, MEMBERS, SPRINT), { ana: ['2026-10-16', '2026-10-19'], fred: null })
})

test('requireDaysOff treats an empty list as a clear, like null', () => {
  assert.deepEqual(requireDaysOff({ fred: [], ana: ['2026-10-16'] }, MEMBERS, SPRINT), { fred: null, ana: ['2026-10-16'] })
})

test('updateCycleCapacity with an empty list removes the member entry', () => {
  const { tracker, read } = setup()
  tracker.updateCycleCapacity('2026-10-12', { daysOff: { ana: [] } }, 'fred')
  assert.equal(read('2026-10-12').days_off?.ana, undefined)
})

test('updateCycleCapacity merges days off and leaves capacity alone', () => {
  const { tracker, read } = setup()
  tracker.updateCycleCapacity('2026-10-12', { daysOff: { fred: ['2026-10-14'] } }, 'fred')
  const file = read('2026-10-12')
  assert.deepEqual(file.days_off, { ana: ['2026-10-16'], fred: ['2026-10-14'] })
  assert.deepEqual(file.capacity, { fred: 8, ana: 10 })
})

test('updateCycleCapacity replaces one member list and clears another with null', () => {
  const { tracker, read } = setup()
  tracker.updateCycleCapacity('2026-10-12', { daysOff: { ana: ['2026-10-19'] } }, 'fred')
  assert.deepEqual(read('2026-10-12').days_off, { ana: ['2026-10-19'] })
  tracker.updateCycleCapacity('2026-10-12', { daysOff: { ana: null } }, 'fred')
  assert.equal(Object.hasOwn(read('2026-10-12').days_off ?? {}, 'ana'), false)
  assert.deepEqual(tracker.getDaysOff('2026-10-12'), {})
  tracker.updateCycleCapacity('2026-10-12', { daysOff: { ana: null } }, 'fred')
})

test('updateCycleCapacity writes capacity and days off together once', () => {
  const { tracker, read } = setup()
  const { before, after } = tracker.updateCycleCapacity('2026-10-12', { capacity: { fred: 3 }, daysOff: { fred: ['2026-10-14'] } }, 'fred')
  assert.deepEqual(before.capacity, { fred: 8, ana: 10 })
  assert.deepEqual(after.capacity, { fred: 3 })
  assert.deepEqual(before.daysOff, { ana: ['2026-10-16'] })
  assert.deepEqual(after.daysOff, { ana: ['2026-10-16'], fred: ['2026-10-14'] })
  assert.deepEqual(read('2026-10-12').capacity, { fred: 3 })
})

test('updateCycleCapacity with dryRun or a rejected value leaves the tree unchanged', () => {
  const { root, tracker } = setup()
  const hash = hashTree(root)
  const result = tracker.updateCycleCapacity('2026-10-12', { daysOff: { fred: ['2026-10-14'] } }, 'fred', { dryRun: true })
  assert.deepEqual(result.after.daysOff, { ana: ['2026-10-16'], fred: ['2026-10-14'] })
  assert.equal(hashTree(root), hash)
  assert.throws(() => tracker.updateCycleCapacity('2026-10-12', { daysOff: { fred: ['2026-10-17'] } }, 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.updateCycleCapacity('2026-10-12', { capacity: { fred: 1 }, daysOff: { ghost: [] } }, 'fred'), code('INVALID_INPUT'))
  assert.equal(hashTree(root), hash)
})

test('getDaysOff returns the map of a sprint', () => {
  const { tracker } = setup()
  assert.deepEqual(tracker.getDaysOff('2026-10-12'), { ana: ['2026-10-16'] })
  assert.deepEqual(tracker.getDaysOff('2026-09-28'), {})
  assert.throws(() => tracker.getDaysOff('2030-01-01'), code('NOT_FOUND'))
})
