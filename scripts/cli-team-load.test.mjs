import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
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
  // The team fixture's agent member has its own row, with no work.
  assert.deepEqual(data.rows.map((row) => row.member), ['agent:claude', 'ana', 'fred'])
  const ana = rowOf(data, 'ana')
  assert.deepEqual([ana.issues, ana.estimate, ana.wip, ana.capacity, ana.daysOff, ana.flags], [2, 13, 2, 10, ['2026-10-16'], ['over_average', 'over_capacity']])
  assert.ok(ana.oldestWipDays > 0)
  const fred = rowOf(data, 'fred')
  assert.deepEqual([fred.issues, fred.estimate, fred.wip, fred.capacity, fred.flags], [2, 4, 1, 8, []])
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
  assert.ok(notes.includes('note: counted issues instead of estimates: no issue in scope has an estimate'), notes.join('\n'))
})

test('team load names a sprint with --sprint, and fails with NOT_FOUND for an unknown one', async () => {
  const closed = await load(makeRepo('team'), ['--sprint', '2026-09-28'])
  assert.equal(closed.code, 0, closed.stderr)
  assert.equal(closed.data.sprint.id, '2026-09-28')
  assert.deepEqual(closed.data.rows.map((row) => row.load), [0, 0, 0], 'a closed sprint has no open issues')
  const missing = await load(makeRepo('team'), ['--sprint', '2030-01-01'])
  assert.equal(missing.code, 2)
  assert.match(missing.stdout, /NOT_FOUND/)
})

const setEstimateUnit = (root, unit) => {
  const file = path.join(root, '.issues/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/estimate:\n  unit: points\n  scale: .*\n/, `estimate:\n  unit: ${unit}\n  scale: ${unit === 'sizes' ? '[XS, S, M, L, XL]' : '[1, 2, 3, 5, 8, 13]'}\n`))
}
const setEstimate = (root, id, value) => {
  const file = path.join(root, '.issues/issues', id, 'issue.md')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^estimate: .*\n/m, value === null ? '' : `estimate: ${value}\n`))
}

test('team load labels the load with hours when the tracker estimates in hours', async () => {
  const root = makeRepo('team')
  setEstimateUnit(root, 'hours')
  const { code, data, notes } = await load(root)
  assert.equal(code, 0)
  assert.equal(data.unit, 'hours')
  assert.deepEqual(notes.filter((line) => line.startsWith('note: counted')), [])
  const text = (await run(['team', 'load'], { cwd: root, env })).stdout
  assert.match(text, /load in hours/)
  assert.match(text, /Hours/)
  assert.doesNotMatch(text, /points/i)
})

test('team load counts issues for t-shirt sizes and says the sizes do not add up', async () => {
  const root = makeRepo('team')
  setEstimateUnit(root, 'sizes')
  for (const id of ['ISS-2X6D', 'ISS-5N1R', 'ISS-8C4W', 'ISS-4M2S']) setEstimate(root, id, 'M')
  const { code, data, notes } = await load(root)
  assert.equal(code, 0)
  assert.equal(data.unit, 'issues')
  assert.ok(notes.includes('note: counted issues instead of estimates: estimates are sizes and do not add up'), notes.join('\n'))
  assert.ok(!notes.some((line) => line.includes('no issue in scope has an estimate')), notes.join('\n'))
})

test('team load leaves a member whose issues have no estimate out of the balance, and says how many', async () => {
  const root = makeRepo('team')
  setEstimate(root, 'ISS-2X6D', null)
  setEstimate(root, 'ISS-8C4W', null)
  const { code, data, notes } = await load(root)
  assert.equal(code, 0)
  const ana = rowOf(data, 'ana')
  assert.deepEqual([ana.load, ana.unknown, ana.unestimated], [null, true, 2])
  assert.deepEqual(data.unknownLoad, ['ana'])
  assert.deepEqual(data.noWork, [])
  assert.deepEqual(data.suggestions, [])
  assert.ok(notes.includes('note: 1 member has open issues and no estimate: their load is unknown, so they stay out of the average, the flags and the proposed moves'), notes.join('\n'))
})

test('team load --sprint current reads the active sprint, as the default does', async () => {
  const root = makeRepo('team')
  const named = await load(root, ['--sprint', 'current'])
  assert.equal(named.code, 0, named.stderr)
  assert.equal(named.data.sprint.id, '2026-10-12')
  assert.deepEqual(named.data, (await load(root)).data)
})

test('team load does not warn about unestimated issues when only a member with an unknown load has them', async () => {
  const root = makeRepo('team')
  setEstimate(root, 'ISS-2X6D', null)
  setEstimate(root, 'ISS-8C4W', null)
  const { stderr } = await load(root)
  assert.doesNotMatch(stderr, /no estimate and count 0/)
})

test('team load warns about unestimated issues of a member with a known load, and shows the row as partial', async () => {
  const root = makeRepo('team')
  setEstimate(root, 'ISS-2X6D', null)
  const result = await load(root)
  assert.match(result.stderr, /warning: some issues have no estimate and count 0 points/)
  const ana = rowOf(result.data, 'ana')
  assert.deepEqual([ana.partial, ana.unknown, ana.estimate], [true, false, 5])
  const text = (await run(['team', 'load'], { cwd: root, env })).stdout
  assert.match(text, /ana \(partial\)/)
})

test('team load says there is nobody to move an issue to without overloading someone', async () => {
  const root = makeRepo('team')
  const file = path.join(root, '.issues/issues/ISS-8C4W/issue.md')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^status: in_review$/m, 'status: todo'))
  const { code, data } = await load(root)
  assert.equal(code, 0)
  assert.deepEqual([data.suggestions, data.noMoves], [[], { reason: 'no_target', message: 'there is nobody to move an issue to without overloading someone' }])
  const text = (await run(['team', 'load'], { cwd: root, env })).stdout
  assert.match(text, /no proposed moves: there is nobody to move an issue to without overloading someone/)
  assert.deepEqual((await load(makeRepo('team'))).data.noMoves, { reason: 'no_candidates', message: 'the overloaded members have no issue in todo to move' }, 'ana has nothing in todo to move, so this is not a lack of targets')
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

test('team load --sprint current with no active sprint reads nothing and warns, as issues list --sprint current does', async () => {
  const root = makeRepo('no-sprints')
  const list = await run(['issues', 'list', '--sprint', 'current', '--json'], { cwd: root, env })
  const warning = 'warning: there is no active sprint, so --sprint current matches no issues; run pmkit cycle list'
  assert.match(list.stderr, new RegExp(warning))
  const { code, data, stderr, notes } = await load(root, ['--sprint', 'current'])
  assert.equal(code, 0, stderr)
  assert.equal(data.sprint, null)
  assert.deepEqual(data.rows.map((row) => row.issues), [0, 0])
  assert.equal(data.unassigned.issues, 0)
  assert.match(stderr, new RegExp(warning))
  assert.ok(!notes.some((line) => line.startsWith('note: no active sprint')), notes.join('\n'))
})

test('team load --sprint current with no active sprint says nothing false about estimates', async () => {
  const root = makeRepo('no-sprints')
  const { stderr, notes } = await load(root, ['--sprint', 'current'])
  assert.ok(!notes.some((line) => /no issue in scope has an estimate|estimates are off/.test(line)), notes.join('\n'))
  assert.match(stderr, /there is no active sprint/)
})

test('team load without the flag, and with a sprint id, still counts what the sprint or all open work holds', async () => {
  const none = await load(makeRepo('no-sprints'))
  assert.deepEqual([rowOf(none.data, 'fred').issues, rowOf(none.data, 'ana').issues], [1, 1])
  const named = await load(makeRepo('team'), ['--sprint', '2026-10-12'])
  assert.equal(named.data.sprint.id, '2026-10-12')
})

test('team load --sprint current with no active sprint has no noWork list and no aging note', async () => {
  const { data, notes } = await load(makeRepo('no-sprints'), ['--sprint', 'current'])
  assert.deepEqual(data.noWork, [], 'nobody was read, so nobody is known to have no work')
  assert.ok(!notes.some((line) => /aging/.test(line)), notes.join('\n'))
  assert.doesNotMatch((await run(['team', 'load', '--sprint', 'current'], { cwd: makeRepo('no-sprints'), env })).stdout, /no work in scope/)
})

test('team load prints load unknown, not null, for a no_availability member whose issues have no estimate', async () => {
  const root = makeRepo('team')
  const file = path.join(root, '.issues/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/(\n\s+ana: \{[^}]*availability: )[\d.]+/, '$10'))
  setEstimate(root, 'ISS-2X6D', null)
  setEstimate(root, 'ISS-8C4W', null)
  const text = (await run(['team', 'load'], { cwd: root, env })).stdout
  assert.match(text, /ana: no_availability, load unknown, limit 0/)
  assert.doesNotMatch(text, /load null/)
})

// PMK-220
const editIssue = (root, id, change) => {
  const file = path.join(root, '.issues/issues', id, 'issue.md')
  fs.writeFileSync(file, change(fs.readFileSync(file, 'utf8')))
}
/** `run` with the local tracker wrapped: `wrap(name, args, call)` sees every contract call, and `calls` counts them. */
const spied = (root, args, wrap = (name, a, call) => call()) => {
  const calls = {}
  const local = {
    ...ADAPTERS.local,
    create: async (...create) => {
      const tracker = await ADAPTERS.local.create(...create)
      return new Proxy(tracker, {
        get: (target, name) => (typeof target[name] === 'function'
          ? (...a) => {
            const key = name === 'searchIssues' ? `searchIssues:${(a[0]?.categories ?? []).join('+')}` : name
            calls[key] = (calls[key] ?? 0) + 1
            return wrap(name, a, () => target[name](...a))
          }
          : target[name]),
      })
    },
  }
  return run(args, { cwd: root, env, adapters: { ...ADAPTERS, local } }).then((result) => ({ ...result, calls, data: result.code === 0 && args.includes('--json') ? JSON.parse(result.stdout) : null }))
}

test('team load takes the overload factor from defaults.overload_factor, and the report says which one it used', async () => {
  assert.equal((await load(makeRepo('team'))).data.overloadFactor, 1.5)
  const root = makeRepo('team')
  const file = path.join(root, '.issues/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('  status_update_window_days: 14\n', '  status_update_window_days: 14\n  overload_factor: 2\n'))
  const { code, data } = await load(root)
  assert.equal(code, 0)
  assert.equal(data.overloadFactor, 2)
  assert.deepEqual(data.imbalances.map((item) => item.flag), ['over_capacity'])
  assert.match((await run(['team', 'load'], { cwd: root, env })).stdout, /overload factor 2/)
  assert.doesNotMatch((await run(['team', 'load'], { cwd: makeRepo('team'), env })).stdout, /overload factor/)
})

// The team fixture holds one issue file with conflict markers (ISS-3Q6T), which makes every read incomplete.
const withoutBadFile = (root) => fs.rmSync(path.join(root, '.issues/issues/ISS-3Q6T'), { recursive: true })

test('team load says the delivered count is not verified when an issue file does not parse', async () => {
  const { data, stderr } = await load(makeRepo('team'))
  assert.deepEqual(data.rows.map((row) => row.delivered), data.rows.map(() => null))
  assert.match(stderr, /warning: the delivered count is not verified: an issue file did not parse/)
  assert.match((await run(['team', 'load'], { cwd: makeRepo('team'), env })).stdout, /\| \? /)
})

test('team load counts the issues each member delivered in the sprint', async () => {
  const root = makeRepo('team')
  withoutBadFile(root)
  for (const id of ['ISS-7K3Q', 'ISS-9T2M']) editIssue(root, id, (text) => text.replace('sprint: 2026-09-28', 'sprint: 2026-10-12'))
  const { data } = await load(root)
  assert.deepEqual([rowOf(data, 'fred').delivered, rowOf(data, 'ana').delivered, rowOf(data, 'agent:claude').delivered, data.unassigned.delivered], [2, 0, 0, 0])
  assert.match((await run(['team', 'load'], { cwd: root, env })).stdout, /Delivered/)
})

test('team load has no delivered count without a sprint, and no column', async () => {
  const root = makeRepo('no-sprints')
  const { data } = await load(root)
  assert.deepEqual(data.rows.map((row) => row.delivered), data.rows.map(() => null))
  assert.doesNotMatch((await run(['team', 'load'], { cwd: root, env })).stdout, /Delivered/)
})

test('team load says the delivered count is not verified when the read of done issues is cut', async () => {
  const root = makeRepo('team')
  withoutBadFile(root)
  editIssue(root, 'ISS-7K3Q', (text) => text.replace('sprint: 2026-09-28', 'sprint: 2026-10-12'))
  const cut = (name, a, call) => (name === 'searchIssues' && a[0]?.categories?.includes('done') ? { ...call(), hasMore: true } : call())
  const { data, stderr } = await spied(root, ['team', 'load', '--json'], cut)
  assert.deepEqual(data.rows.map((row) => row.delivered), data.rows.map(() => null))
  assert.match(stderr, /the delivered count is not verified/)
})

test('team load counts the open issues that wait on an open blocker, and not the ones whose blocker is done', async () => {
  const { data } = await load(makeRepo('team'))
  assert.deepEqual([rowOf(data, 'ana').blocked, rowOf(data, 'ana').blockedIds, rowOf(data, 'fred').blocked], [1, ['ISS-2X6D'], 0])
  assert.match((await run(['team', 'load'], { cwd: makeRepo('team'), env })).stdout, /Blocked/)
})

const blockedTodoRepo = () => {
  const root = makeRepo('team')
  setEstimate(root, 'ISS-5N1R', 1)
  setEstimate(root, 'ISS-8C4W', 8)
  editIssue(root, 'ISS-2X6D', (text) => text.replace('status: in_progress', 'status: todo').replace(/^estimate: .*$/m, 'estimate: 3'))
  return root
}

test('team load does not propose moving a blocked issue in todo, and says why', async () => {
  const root = blockedTodoRepo()
  const { data } = await load(root)
  assert.deepEqual(data.suggestions, [])
  assert.deepEqual(data.noMoves, { reason: 'blocked', message: 'the issues in todo that could move are blocked, so moving them would not free anyone' })
  editIssue(root, 'ISS-2X6D', (text) => text.replace(/^blocked_by: .*\n/m, ''))
  assert.deepEqual((await load(root)).data.suggestions, [{ issue: 'ISS-2X6D', from: 'ana', to: 'fred' }])
})

test('team load reads each blocker outside the scope once, and an unreadable blocker still blocks, with a warning', async () => {
  const root = blockedTodoRepo()
  editIssue(root, 'ISS-2X6D', (text) => text.replace(/^blocked_by: .*$/m, 'blocked_by: [ISS-3F7H, ISS-6J0B]'))
  editIssue(root, 'ISS-8C4W', (text) => text.replace(/^blocked_by: .*$/m, 'blocked_by: [ISS-3F7H]'))
  const open = await spied(root, ['team', 'load', '--json'])
  assert.equal(open.calls.getIssue, 2, 'ISS-3F7H and ISS-6J0B, once each')
  assert.equal(rowOf(open.data, 'ana').blocked, 2)
  const unreadable = await spied(root, ['team', 'load', '--json'], (name, a, call) => {
    if (name === 'getIssue' && a[0] === 'ISS-6J0B') throw new Error('boom')
    return call()
  })
  assert.equal(unreadable.code, 0, unreadable.stderr)
  assert.match(unreadable.stderr, /ISS-6J0B.*blocker state is not verified|blocker state is not verified.*ISS-6J0B/)
  assert.equal(rowOf(unreadable.data, 'ana').blocked, 2)
  editIssue(root, 'ISS-3F7H', (text) => text.replace('status: backlog', 'status: done'))
  const done = await load(root)
  assert.deepEqual(rowOf(done.data, 'ana').blockedIds, ['ISS-2X6D'], 'ISS-3F7H is done now, ISS-6J0B is a backlog issue and still blocks')
})

test('team load reads open work, done work, capacity, days off, flow history, members and capabilities once', async () => {
  const { calls, code, stderr } = await spied(makeRepo('team'), ['team', 'load', '--json'])
  assert.equal(code, 0, stderr)
  assert.deepEqual(
    [calls['searchIssues:todo+in_progress+in_review'], calls['searchIssues:done'], calls.getCapacity, calls.getDaysOff, calls.metricEvents, calls.discover, calls.capabilities],
    [1, 1, 1, 1, 1, 1, 1],
  )
})

test('team capacity reads the load inputs once for the before and after of a change', async () => {
  const { calls, code, stderr } = await spied(makeRepo('team'), ['team', 'capacity', '--set', 'ana=12', '--dry-run', '--json'])
  assert.equal(code, 0, stderr)
  assert.deepEqual([calls['searchIssues:todo+in_progress+in_review'], calls.getCapacity, calls.getDaysOff, calls.metricEvents ?? 0, calls.discover, calls.capabilities, calls['searchIssues:done'] ?? 0], [1, 1, 1, 0, 2, 1, 0], 'discover: the load inputs once, the actor once')
})
