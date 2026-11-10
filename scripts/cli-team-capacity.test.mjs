import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { linearDescriptor } from './lib/linear/adapter.mjs'
import { useLinear } from './fake-hosted.mjs'
import { ACME_TEAM, ACME_TEAM_ID, ACME_USERS, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeWorkspace } from './fake-linear-api.mjs'
import { childEnv } from './golden-helpers.mjs'
import { makeRepo, userStoreEnv } from './test-helpers.mjs'

const env = { ...process.env, PMKIT_USER: 'fred', PMKIT_NOW: '2026-10-23T12:00:00Z', PMKIT_SEED: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }
const capacity = async (root, args = []) => {
  const result = await run(['team', 'capacity', ...args, '--json'], { cwd: root, env })
  return { ...result, data: result.stdout ? JSON.parse(result.stdout) : null, notes: result.stderr.split('\n').filter((line) => line.startsWith('note: ')) }
}
const stored = async (root) => JSON.parse((await run(['cycle', 'capacity', '2026-10-12', '--json'], { cwd: root, env })).stdout)
const memberOf = (data, id) => data.members.find((member) => member.member === id)
// The team fixture has an issue with conflict markers, which makes every load read incomplete. Most tests use a copy without it.
const cleanRepo = () => {
  const root = makeRepo('team')
  fs.rmSync(path.join(root, '.issues/issues/ISS-3Q6T'), { recursive: true })
  return root
}
const sprintFile = (root) => path.join(root, '.issues/sprints/2026-10-12.yaml')

test('team capacity reads the active sprint per member and writes nothing', async () => {
  const root = cleanRepo()
  const before = fs.readFileSync(sprintFile(root), 'utf8')
  const { code, data, stderr } = await capacity(root)
  assert.equal(code, 0, stderr)
  assert.equal(data.sprint.id, '2026-10-12')
  assert.equal(data.unit, 'points')
  assert.equal(data.sprintWorkingDays, 10)
  assert.deepEqual(data.members.map((member) => member.member), ['ana', 'fred'])
  const ana = memberOf(data, 'ana')
  assert.deepEqual([ana.capacity, ana.daysOff, ana.workingDays, ana.availability, ana.estimate, ana.flags], [10, ['2026-10-16'], 9, 0.8, 13, ['over_average', 'over_capacity']])
  assert.deepEqual([memberOf(data, 'fred').capacity, memberOf(data, 'fred').workingDays], [8, 10])
  assert.equal(fs.readFileSync(sprintFile(root), 'utf8'), before)
})

test('team capacity --sprint current is the default and --sprint reads a closed sprint', async () => {
  const root = cleanRepo()
  assert.deepEqual((await capacity(root, ['--sprint', 'current'])).data, (await capacity(root)).data)
  const closed = await capacity(root, ['--sprint', '2026-09-28'])
  assert.equal(closed.code, 0, closed.stderr)
  assert.equal(closed.data.sprint.id, '2026-09-28')
  assert.equal(memberOf(closed.data, 'fred').capacity, 10)
})

test('team capacity fails with NOT_FOUND and a next step when no sprint is active', async () => {
  const { code, data } = await capacity(makeRepo('no-sprints'))
  assert.equal(code, 2)
  assert.equal(data.error.code, 'NOT_FOUND')
  assert.match(data.error.nextStep, /cycle:plan/)
})

test('team capacity --set --dry-run shows the change and the load effect and writes nothing', async () => {
  const root = cleanRepo()
  const before = fs.readFileSync(sprintFile(root), 'utf8')
  const { code, data, stderr } = await capacity(root, ['--set', 'ana=14', '--dry-run'])
  assert.equal(code, 0, stderr)
  assert.equal(data.dryRun, true)
  assert.deepEqual(data.changes, [{ member: 'ana', capacity: { before: 10, after: 14 }, daysOff: { before: ['2026-10-16'], after: ['2026-10-16'] } }])
  assert.deepEqual(data.load.before.imbalances.map((item) => [item.member, item.flag]), [['ana', 'over_average'], ['ana', 'over_capacity']])
  assert.deepEqual(data.load.after.imbalances.map((item) => [item.member, item.flag]), [['ana', 'over_average']])
  assert.equal(fs.readFileSync(sprintFile(root), 'utf8'), before)
})

test('team capacity --set keeps the capacity of the members it does not name', async () => {
  const root = cleanRepo()
  const { code, stderr } = await capacity(root, ['--set', 'ana=14'])
  assert.equal(code, 0, stderr)
  assert.deepEqual((await stored(root)).capacity, { fred: 8, ana: 14 })
})

test('team capacity --set member=none removes the capacity, which reads as unset and not 0', async () => {
  const root = cleanRepo()
  assert.equal((await capacity(root, ['--set', 'fred=none'])).code, 0)
  assert.deepEqual((await stored(root)).capacity, { ana: 10 })
  assert.equal(memberOf((await capacity(root)).data, 'fred').capacity, null)
})

test('team capacity writes a batch of capacity and days off for several members in one call', async () => {
  const root = cleanRepo()
  const { code, data, stderr } = await capacity(root, ['--set', 'ana=12,fred=9', '--days-off', 'fred=2026-10-14+2026-10-15'])
  assert.equal(code, 0, stderr)
  assert.deepEqual(data.changes.map((change) => change.member), ['ana', 'fred'])
  const after = await stored(root)
  assert.deepEqual(after.capacity, { fred: 9, ana: 12 })
  assert.deepEqual(after.days_off, { ana: ['2026-10-16'], fred: ['2026-10-14', '2026-10-15'] })
})

test('team capacity refuses the whole batch when one entry is invalid and writes nothing', async () => {
  const bad = [
    ['--set', 'ana=1,fred=2', '--days-off', 'ana=2026-10-17'],
    ['--set', 'ana=1,fred=2', '--days-off', 'ana=2026-11-02'],
    ['--set', 'ana=1,fred=2', '--days-off', 'ana=16/10'],
    ['--set', 'ana=1,fred=2', '--days-off', 'ana=2026-10-14+2026-10-14'],
    ['--set', 'ana=1,fred=-2'],
    ['--set', 'ana=1,zed=2'],
    ['--set', 'ana=1,agent:claude=2'],
  ]
  for (const args of bad) {
    const root = cleanRepo()
    const before = fs.readFileSync(sprintFile(root), 'utf8')
    const { code, data } = await capacity(root, args)
    assert.equal(code, 2, args.join(' '))
    assert.equal(data.error.code, 'INVALID_INPUT', args.join(' '))
    assert.equal(fs.readFileSync(sprintFile(root), 'utf8'), before, args.join(' '))
  }
})

test('team capacity says there is no change when the values stay the same', async () => {
  const root = cleanRepo()
  const { code, data } = await capacity(root, ['--days-off', 'ana=2026-10-16', '--dry-run'])
  assert.equal(code, 0)
  assert.deepEqual(data.changes, [])
  const text = await run(['team', 'capacity', '--days-off', 'ana=2026-10-16', '--dry-run'], { cwd: root, env })
  assert.match(text.stdout, /no change/)
})

test('team capacity --days-off recomputes the capacity of the member by working days and lists it', async () => {
  const root = cleanRepo()
  const { code, data, stderr } = await capacity(root, ['--days-off', 'fred=2026-10-14+2026-10-15'])
  assert.equal(code, 0, stderr)
  assert.deepEqual(data.recomputed, [{ member: 'fred', workingDays: { before: 10, after: 8 }, capacity: { before: 8, after: 6.4 } }])
  assert.deepEqual(data.changes.map((change) => [change.member, change.capacity.before, change.capacity.after]), [['fred', 8, 6.4]])
  assert.ok(data.notes.some((note) => /scaled by working days/.test(note)), data.notes.join('\n'))
  assert.ok(data.notes.every((note) => !note.includes('round(')), data.notes.join('\n'))
  assert.deepEqual((await stored(root)).capacity, { fred: 6.4, ana: 10 })
})

test('team capacity --set for the same member wins over the recompute', async () => {
  const root = cleanRepo()
  const { code, data } = await capacity(root, ['--days-off', 'fred=2026-10-14+2026-10-15', '--set', 'fred=8'])
  assert.equal(code, 0)
  assert.deepEqual(data.recomputed, [])
  assert.deepEqual((await stored(root)).capacity, { fred: 8, ana: 10 })
})

test('team capacity --days-off --dry-run previews the recomputed capacity and writes nothing', async () => {
  const root = cleanRepo()
  const before = fs.readFileSync(sprintFile(root), 'utf8')
  const { stdout } = await run(['team', 'capacity', '--days-off', 'fred=2026-10-14', '--dry-run'], { cwd: root, env })
  assert.match(stdout, /capacity 8 → 7\.2/)
  assert.equal(fs.readFileSync(sprintFile(root), 'utf8'), before)
})

test('team capacity --days-off leaves a member with no capacity unset', async () => {
  const root = cleanRepo()
  assert.equal((await capacity(root, ['--set', 'fred=none'])).code, 0)
  const { data } = await capacity(root, ['--days-off', 'fred=2026-10-14'])
  assert.deepEqual(data.recomputed, [])
  assert.equal(memberOf((await capacity(root)).data, 'fred').capacity, null)
})

test('team capacity writes with a stored capacity of a member who left the team, and keeps that key', async () => {
  const root = cleanRepo()
  fs.writeFileSync(sprintFile(root), fs.readFileSync(sprintFile(root), 'utf8').replace('capacity: { fred: 8, ana: 10 }', 'capacity: { fred: 8, ana: 10, bob: 5 }'))
  const off = await capacity(root, ['--days-off', 'fred=2026-10-14', '--dry-run'])
  assert.equal(off.code, 0, off.stdout)
  assert.deepEqual(off.data.changes.map((change) => change.member), ['fred'])
  assert.equal((await capacity(root, ['--days-off', 'fred=2026-10-14'])).code, 0)
  assert.equal((await capacity(root, ['--set', 'ana=12'])).code, 0)
  assert.deepEqual((await stored(root)).capacity, { fred: 7.2, ana: 12, bob: 5 })
})

test('team capacity gives exactly the capacity the user wrote back when the same days off are taken out', async () => {
  const root = cleanRepo()
  const days = 'fred=2026-10-13+2026-10-14+2026-10-15'
  assert.equal((await capacity(root, ['--days-off', days])).code, 0)
  assert.equal((await stored(root)).capacity.fred, 5.6)
  assert.match(fs.readFileSync(sprintFile(root), 'utf8'), /capacity_base:\n {2}fred: \[8, 10\]/)
  assert.equal((await capacity(root, ['--days-off', 'fred=none'])).code, 0)
  assert.equal((await stored(root)).capacity.fred, 8)
  assert.ok(!fs.readFileSync(sprintFile(root), 'utf8').includes('capacity_base'))
  // ana has 10 points on 9 working days: 10 -> 5.555556 -> 10, and the file says 10, not 10.000000001.
  assert.equal((await capacity(root, ['--days-off', 'ana=2026-10-12+2026-10-13+2026-10-14+2026-10-15+2026-10-16'])).code, 0)
  assert.equal((await stored(root)).capacity.ana, 5.555556)
  assert.equal((await capacity(root, ['--days-off', 'ana=2026-10-16'])).code, 0)
  assert.equal((await stored(root)).capacity.ana, 10)
  assert.match(fs.readFileSync(sprintFile(root), 'utf8'), /capacity: \{ fred: 8, ana: 10 \}/)
})

test('team capacity keeps a capacity of 1 through six days off and back, and 0 through all of them', async () => {
  const root = cleanRepo()
  assert.equal((await capacity(root, ['--set', 'fred=1'])).code, 0)
  const six = await capacity(root, ['--days-off', 'fred=2026-10-12+2026-10-13+2026-10-14+2026-10-15+2026-10-16+2026-10-19'])
  assert.deepEqual(six.data.recomputed.map((item) => item.capacity.after), [0.4])
  assert.equal((await capacity(root, ['--days-off', 'fred=none'])).code, 0)
  assert.equal((await stored(root)).capacity.fred, 1)
  const all = await capacity(root, ['--days-off', 'fred=2026-10-12+2026-10-13+2026-10-14+2026-10-15+2026-10-16+2026-10-19+2026-10-20+2026-10-21+2026-10-22+2026-10-23'])
  assert.equal(all.code, 0, all.stdout)
  assert.equal((await stored(root)).capacity.fred, 0)
  assert.equal((await capacity(root, ['--days-off', 'fred=none'])).code, 0)
  const back = await stored(root)
  assert.equal(back.capacity.fred, 1)
})

test('team capacity ignores a hand-edited capacity_base that is not a pair and builds a new one', async () => {
  const root = cleanRepo()
  fs.writeFileSync(sprintFile(root), fs.readFileSync(sprintFile(root), 'utf8').replace('days_off:', 'capacity_base:\n  fred: nope\ndays_off:'))
  assert.equal((await capacity(root, ['--days-off', 'fred=2026-10-13+2026-10-14'])).code, 0)
  assert.equal((await stored(root)).capacity.fred, 6.4)
  assert.match(fs.readFileSync(sprintFile(root), 'utf8'), /fred: \[8, 10\]/)
})

test('team capacity --set drops the base of the member, and the next days off build on the typed number', async () => {
  const root = cleanRepo()
  assert.equal((await capacity(root, ['--days-off', 'fred=2026-10-13+2026-10-14'])).code, 0)
  assert.equal((await capacity(root, ['--set', 'fred=5'])).code, 0)
  assert.ok(!fs.readFileSync(sprintFile(root), 'utf8').includes('capacity_base'))
  assert.equal((await capacity(root, ['--days-off', 'fred=none'])).code, 0)
  assert.equal((await stored(root)).capacity.fred, 6.25)
})

test('team capacity --days-off member=none clears the days off', async () => {
  const root = cleanRepo()
  assert.equal((await capacity(root, ['--days-off', 'ana=none'])).code, 0)
  assert.deepEqual((await stored(root)).days_off, {})
})

test('team capacity gives no load effect when an issue file cannot be read, says so, and still writes', async () => {
  const root = makeRepo('team')
  const read = await capacity(root)
  assert.equal(read.code, 0, read.stderr)
  assert.equal(read.data.imbalances, null)
  assert.equal(memberOf(read.data, 'ana').flags, null)
  assert.ok(read.data.warnings.some((line) => line.includes('ISS-3Q6T')), read.data.warnings.join('\n'))
  const write = await capacity(root, ['--set', 'ana=14'])
  assert.equal(write.code, 0, write.stderr)
  assert.equal(write.data.load.after, null)
  assert.ok(write.data.warnings.some((line) => line.includes('not verified')), write.data.warnings.join('\n'))
  assert.equal((await stored(root)).capacity.ana, 14)
})

test('team capacity text lists each change and the flags it moves', async () => {
  const root = cleanRepo()
  const { stdout } = await run(['team', 'capacity', '--set', 'ana=14', '--dry-run'], { cwd: root, env })
  assert.match(stdout, /capacity 10 → 14/)
  assert.match(stdout, /flags ana: over_average, over_capacity → over_average/)
  assert.match(stdout, /dry run: nothing was written/)
})

// Over Linear (fake API). The fake clock is 2026-10-27, so cycle 2 (2026-10-19 to 2026-11-02) is active.
const CYCLES = [
  { number: 1, startsAt: '2026-10-05T00:00:00.000Z', endsAt: '2026-10-19T00:00:00.000Z', completedAt: '2026-10-19T00:00:00.000Z' },
  { number: 2, name: 'Autumn', startsAt: '2026-10-19T00:00:00.000Z', endsAt: '2026-11-02T00:00:00.000Z' },
]
const OTHER_TEAM_USER = { ...ACME_USERS[0], id: 'user-5', name: 'Other Team', displayName: 'other', email: 'other@example.com', teams: { nodes: [] } }

function onLinear({ extraIssues = 0 } = {}) {
  const root = useLinear(makeRepo('basic'))
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('    workspace: acme', '    workspace: acme\n    team: ACME'))
  const teams = [{ ...ACME_TEAM, cyclesEnabled: true }]
  const users = [...ACME_USERS, OTHER_TEAM_USER]
  const fake = fakeLinearIssues({ teams, cycles: CYCLES, users })
  for (let n = 0; n < extraIssues; n += 1) fake.seed({ title: `Issue ${n}`, stateId: 'state-3', cycleId: fake.cycles.list()[1].id })
  const fetch = fakeLinearFetch({ ...fakeWorkspace({ teams, users }), ...fake.routes })
  const context = { root, env: { ...childEnv(), ...userStoreEnv().env, LINEAR_API_KEY: FAKE_KEY } }
  const call = async (args) => {
    const result = await run(['team', 'capacity', ...args, '--json'], { cwd: root, env: context.env, adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch }) } })
    return { ...result, data: result.stdout ? JSON.parse(result.stdout) : null, notes: result.stderr.split('\n').filter((line) => line.startsWith('note: ')) }
  }
  return { root, fake, call }
}

test('team capacity on Linear lists only the members of the scope team and agents never appear', async () => {
  const { call } = onLinear()
  const { code, data, stderr } = await call([])
  assert.equal(code, 0, stderr)
  assert.equal(data.sprint.id, '2')
  assert.deepEqual(data.members.map((member) => member.member), ['user-1', 'user-2'])
})

test('team capacity on Linear writes only .pmkit/capacity.yaml, sends no mutation and says so in a note', async () => {
  const { root, fake, call } = onLinear()
  const dry = await call(['--set', 'user-1=8', '--dry-run'])
  assert.equal(dry.code, 0, dry.stderr)
  assert.ok(!fs.existsSync(path.join(root, '.pmkit', 'capacity.yaml')))
  assert.ok(dry.data.notes.includes('capacity and days off would be written to .pmkit/capacity.yaml; Linear is not changed'), dry.data.notes.join('\n'))
  const set = await call(['--set', 'user-1=8,user-2=6', '--days-off', 'user-1=2026-10-21'])
  assert.equal(set.code, 0, set.stdout + set.stderr)
  const note = 'note: capacity and days off written to .pmkit/capacity.yaml; Linear was not changed'
  assert.ok(set.notes.includes(note), set.notes.join('\n'))
  assert.ok(set.data.notes.includes(note.replace('note: ', '')))
  assert.deepEqual(set.data.changes.map((change) => change.member), ['user-1', 'user-2'])
  assert.match(fs.readFileSync(path.join(root, '.pmkit', 'capacity.yaml'), 'utf8'), /^version: 1$/m)
  assert.deepEqual(fake.mutations, [])
  const read = await call([])
  assert.deepEqual(read.data.members.map((member) => [member.member, member.capacity, member.daysOff]), [['user-1', 8, ['2026-10-21']], ['user-2', 6, []]])
  assert.ok(read.data.notes.includes('capacity read from .pmkit/capacity.yaml; Linear has no capacity field'))
})

test('team capacity on Linear keeps the other capacities when --set names one member', async () => {
  const { call } = onLinear()
  await call(['--set', 'user-1=8,user-2=6'])
  await call(['--set', 'user-2=7'])
  assert.deepEqual((await call([])).data.members.map((member) => member.capacity), [8, 7])
})

test('team capacity on Linear refuses a member of another team and an agent, and writes nothing', async () => {
  const { root, call } = onLinear()
  for (const name of ['user-5', 'agent:claude', 'user-4']) {
    const { code, data } = await call(['--set', `user-1=8,${name}=3`])
    assert.equal(code, 2, name)
    assert.equal(data.error.code, 'INVALID_INPUT', name)
  }
  assert.ok(!fs.existsSync(path.join(root, '.pmkit', 'capacity.yaml')))
})

test('team capacity on Linear writes with a stored capacity of a user of another team, and keeps that key', async () => {
  const { root, call } = onLinear()
  fs.mkdirSync(path.join(root, '.pmkit'), { recursive: true })
  fs.writeFileSync(path.join(root, '.pmkit', 'capacity.yaml'), 'version: 1\ncycles:\n  ACME:\n    2:\n      capacity:\n        user-1: 8\n        user-5: 3\n')
  const off = await call(['--days-off', 'user-1=2026-10-21'])
  assert.equal(off.code, 0, off.stdout + off.stderr)
  assert.equal((await call(['--set', 'user-2=6'])).code, 0)
  const file = fs.readFileSync(path.join(root, '.pmkit', 'capacity.yaml'), 'utf8')
  assert.match(file, /user-5: 3/)
  assert.match(file, /user-2: 6/)
})

test('team capacity on Linear keeps the base in .pmkit/capacity.yaml and gives the written capacity back', async () => {
  const { root, call } = onLinear()
  const file = path.join(root, '.pmkit', 'capacity.yaml')
  assert.equal((await call(['--set', 'user-1=7'])).code, 0)
  const days = ['2026-10-21', '2026-10-22', '2026-10-23']
  const off = await call(['--days-off', `user-1=${days.join('+')}`])
  assert.equal(off.code, 0, off.stdout + off.stderr)
  assert.match(fs.readFileSync(file, 'utf8'), /capacity_base:\n {8}user-1: \[7, 10\]/)
  assert.equal((await call([])).data.members.find((member) => member.member === 'user-1').capacity, 4.9)
  assert.equal((await call(['--days-off', 'user-1=none'])).code, 0)
  const text = fs.readFileSync(file, 'utf8')
  assert.ok(!text.includes('capacity_base'))
  assert.match(text, /capacity: \{ user-1: 7 \}/)
})

test('team capacity on Linear accepts --sprint 2 and refuses a cycle that does not exist', async () => {
  const { call } = onLinear()
  assert.equal((await call(['--sprint', '2'])).code, 0)
  const missing = await call(['--sprint', '9'])
  assert.equal(missing.code, 2)
  assert.equal(missing.data.error.code, 'NOT_FOUND')
})

test('team capacity on Linear reports no load effect when the issue read is cut, and the write still works', async () => {
  const { call } = onLinear({ extraIssues: 1001 })
  const read = await call([])
  assert.equal(read.code, 0, read.stderr)
  assert.equal(read.data.imbalances, null)
  const write = await call(['--set', 'user-1=8'])
  assert.equal(write.code, 0, write.stderr)
  assert.equal(write.data.load.after, null)
  assert.ok(write.data.warnings.some((line) => line.includes('not verified')), write.data.warnings.join('\n'))
})

test('team capacity answers INVALID_INPUT for a --days-off with bad syntax and writes nothing', async () => {
  for (const bad of ['ana', '=2026-10-14', 'ana=', 'ana=2026-10-14+', 'ana=2026-10-14,ana=2026-10-15']) {
    const root = cleanRepo()
    const before = fs.readFileSync(sprintFile(root), 'utf8')
    const { code, data } = await capacity(root, ['--days-off', bad])
    assert.equal(code, 2, bad)
    assert.equal(data.error.code, 'INVALID_INPUT', bad)
    assert.equal(fs.readFileSync(sprintFile(root), 'utf8'), before, bad)
  }
})
