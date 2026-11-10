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
  fs.rmSync(path.join(root, '.issues/issues/ISS-3Q6T'), { recursive: true }) // the fixture issue with conflict markers makes the read incomplete
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

const linkedTeamRepo = async () => {
  const root = makeRepo('team')
  const goal = (await pmkit(root, ['goal', 'create', '--title', 'Grow'])).data.after.id
  await pmkit(root, ['epic', 'goal', 'EPC-2M9D', goal])
  return { root, goal }
}

test('an issue file that does not parse makes the goals path incomplete, with a warning', async () => {
  const { root } = await linkedTeamRepo() // ISS-3Q6T has conflict markers and hangs under EPC-2M9D
  const result = await pmkit(root, ['goals', 'overview'])
  assert.equal(result.data.source, 'goals')
  assert.equal(result.data.complete, false)
  assert.ok(result.data.warnings.some((line) => line.includes('ISS-3Q6T')), result.stdout)
  const text = await run(['goals', 'overview'], { cwd: root, env })
  assert.match(text.stdout, /incomplete/)
})

test('an epic file that does not parse is a warning, not a goal with no epics', async () => {
  const { root } = await linkedTeamRepo()
  fs.rmSync(path.join(root, '.issues/issues/ISS-3Q6T'), { recursive: true }) // only the epic is broken now
  fs.writeFileSync(path.join(root, '.issues/epics/EPC-2M9D/epic.md'), '---\ntitle: [\n---\n')
  const result = await pmkit(root, ['goals', 'overview'])
  assert.equal(result.data.complete, false)
  assert.ok(result.data.warnings.some((line) => line.includes('EPC-2M9D')), result.stdout)
})

test('an unreadable goal file does not trigger the top-level fallback', async () => {
  const root = makeRepo('team')
  fs.mkdirSync(path.join(root, '.issues', 'goals'))
  fs.writeFileSync(path.join(root, '.issues', 'goals', 'GOAL-1.md'), '<<<<<<< HEAD\n---\ntitle: A\n=======\n---\ntitle: B\n>>>>>>> x\n')
  const result = await pmkit(root, ['goals', 'overview'])
  assert.equal(result.data.source, 'goals')
  assert.deepEqual(result.data.items, [])
  assert.equal(result.data.complete, false)
  assert.ok(result.data.warnings.some((line) => line.includes('GOAL-1')))
  const text = await run(['goals', 'overview'], { cwd: root, env })
  assert.doesNotMatch(text.stdout, /no goals: using top-level/)
  assert.match(text.stdout, /incomplete/)
})

test('a parent cycle is a warning and the rollup is incomplete', async () => {
  const root = makeRepo('team')
  const [a, b] = [(await pmkit(root, ['issues', 'create', '--title', 'A'])).data.after.id, (await pmkit(root, ['issues', 'create', '--title', 'B'])).data.after.id]
  for (const [child, parent] of [[a, b], [b, a]]) {
    const file = path.join(root, '.issues/issues', child, 'issue.md')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\nparent: .*/, '').replace('\ncreated: ', `\nparent: ${parent}\ncreated: `))
  }
  const result = await pmkit(root, ['goals', 'overview'])
  assert.ok(result.data.warnings.some((line) => line.includes('parent cycle')), result.stdout)
  assert.equal(result.data.complete, false)
})

const breakEpic = (root) => {
  fs.rmSync(path.join(root, '.issues/issues/ISS-3Q6T'), { recursive: true }) // only the epic is broken
  fs.writeFileSync(path.join(root, '.issues/epics/EPC-2M9D/epic.md'), '---\ntitle: [\n---\n')
}

test('without goals a broken epic file does not make the top-level rollup incomplete', async () => {
  const root = makeRepo('team')
  breakEpic(root)
  const result = await pmkit(root, ['goals', 'overview'])
  assert.equal(result.data.source, 'top_level')
  assert.equal(result.data.complete, true, result.stdout)
  assert.deepEqual(result.data.warnings, [])
})

test('a file in .issues/goals that is not a goal does not block the fallback and is only noted', async () => {
  const root = makeRepo('team')
  fs.rmSync(path.join(root, '.issues/issues/ISS-3Q6T'), { recursive: true })
  fs.mkdirSync(path.join(root, '.issues', 'goals'))
  fs.writeFileSync(path.join(root, '.issues', 'goals', 'notes.md'), 'remember the milk\n')
  const result = await pmkit(root, ['goals', 'overview'])
  assert.equal(result.data.source, 'top_level')
  assert.equal(result.data.complete, true, result.stdout)
  assert.ok(result.data.notes.some((line) => line.includes('notes.md')), result.stdout)
})

const makeParent = async (root, title) => (await pmkit(root, ['issues', 'create', '--title', title])).data.after.id
const parentOf = async (root, child, parent) => pmkit(root, ['issues', 'parent', child, parent])

test('the live child of an archived parent is warned about, not a top-level row', async () => {
  const root = makeRepo('team')
  fs.rmSync(path.join(root, '.issues/issues/ISS-3Q6T'), { recursive: true })
  const [parent, child] = [await makeParent(root, 'Old parent'), await makeParent(root, 'Live child')]
  await parentOf(root, child, parent)
  await pmkit(root, ['issues', 'archive', parent])
  const result = await pmkit(root, ['goals', 'overview'])
  assert.equal(result.data.complete, false)
  assert.ok(result.data.warnings.some((line) => line.includes('archived parent') && line.includes(child)), result.stdout)
  assert.ok(!result.data.items.some((item) => item.issue.id === child))
})

test('the children of an issue file that does not parse are warned about, not split into top-level rows', async () => {
  const root = makeRepo('team')
  fs.rmSync(path.join(root, '.issues/issues/ISS-3Q6T'), { recursive: true })
  const [parent, a, b] = [await makeParent(root, 'Parent'), await makeParent(root, 'A'), await makeParent(root, 'B')]
  await parentOf(root, a, parent)
  await parentOf(root, b, parent)
  fs.writeFileSync(path.join(root, '.issues/issues', parent, 'issue.md'), '---\ntitle: [\n---\n')
  const result = await pmkit(root, ['goals', 'overview'])
  assert.equal(result.data.complete, false)
  assert.ok(result.data.warnings.some((line) => line.includes(a) && line.includes(b)), result.stdout)
  assert.ok(!result.data.items.some((item) => [a, b].includes(item.issue.id)))
})

test('goal progress is complete on a clean tree and incomplete with a warning when an epic file does not parse (PMK-213)', async () => {
  const root = makeRepo('no-sprints')
  const clean = await pmkit(root, ['goal', 'progress', 'GOAL-8K2W'])
  assert.equal(clean.data.complete, true)
  assert.deepEqual(clean.data.warnings, [])
  const other = (await pmkit(root, ['epic', 'create', '--title', 'Other'])).data.after.id
  fs.writeFileSync(path.join(root, '.issues', 'epics', other, 'epic.md'), '---\ntitle: [\n---\n')
  const broken = await pmkit(root, ['goal', 'progress', 'GOAL-8K2W'])
  assert.equal(broken.data.complete, false)
  assert.ok(broken.data.warnings.some((line) => line.startsWith(`${other}:`) && line.includes('may link to this goal')), broken.stdout)
  const text = await run(['goal', 'progress', 'GOAL-8K2W'], { cwd: root, env })
  assert.match(text.stdout, /^incomplete: /m)
  assert.match(text.stderr, new RegExp(other))
  const overview = await pmkit(root, ['goals', 'overview'])
  assert.ok(overview.data.items.every((item) => !('warnings' in item)), overview.stdout)
})

test('on a Linear Business workspace goals overview and goal list read initiatives, and a cut read is a warning without validate advice (PMK-213)', async () => {
  const root = useLinear(makeRepo('basic'))
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('    workspace: acme', '    workspace: acme\n    team: ACME'))
  const fake = fakeLinearIssues()
  const node = { id: 'i-1', slugId: 'abcdef123456', identifier: 'INI-1', name: 'Grow', description: '', content: null, status: 'Active', targetDate: '2026-12-31', url: 'u', projects: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'x' } } }
  const fetch = fakeLinearFetch({ ...fakeWorkspace({ subscription: { type: 'business' } }), ...fake.routes, PmkitInitiatives: { status: 200, json: { data: { initiatives: { nodes: [node], pageInfo: { hasNextPage: false, endCursor: null } } } } } })
  const options = { cwd: root, env: { ...childEnv(), ...userStoreEnv().env, LINEAR_API_KEY: FAKE_KEY }, adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch }) } }
  const overview = await run(['goals', 'overview', '--json'], options)
  assert.equal(overview.code, 0, overview.stdout + overview.stderr)
  const data = JSON.parse(overview.stdout)
  assert.equal(data.source, 'goals')
  assert.deepEqual(data.items.map((item) => item.goal.id), ['INI-1'])
  assert.equal(data.complete, false)
  assert.ok(data.warnings.some((line) => line.includes('more than 50 projects') && !line.includes('pmkit validate')), data.warnings.join('\n'))
  const list = await run(['goal', 'list'], options)
  assert.match(list.stdout, /INI-1 +\| Grow +\| active +\| 2026-12-31/)
  assert.match(list.stderr, /more than 50 projects/)
  assert.doesNotMatch(list.stderr, /pmkit validate/)
})

test('with goal_prefix set, an old GOAL- file is an unreadable goal: goals overview warns, is incomplete and does not fall back (PMK-213)', async () => {
  const root = makeRepo('no-sprints')
  fs.appendFileSync(path.join(root, '.issues', 'config.yaml'), 'goal_prefix: OKR\n')
  fs.writeFileSync(path.join(root, '.issues', 'goals', 'README.md'), '# Goals\n')
  const result = await pmkit(root, ['goals', 'overview'])
  assert.equal(result.data.source, 'goals')
  assert.equal(result.data.complete, false)
  assert.ok(result.data.warnings.some((line) => line.startsWith('GOAL-8K2W:') && /such as OKR-1/.test(line)), result.stdout)
  assert.ok(result.data.notes.some((line) => line.includes('README.md')), result.stdout)
})

test('goal get warns about an epic file that does not parse, like goal list and goal progress (PMK-213)', async () => {
  const root = makeRepo('no-sprints')
  const clean = await pmkit(root, ['goal', 'get', 'GOAL-8K2W'])
  assert.equal(clean.data.complete, true)
  assert.deepEqual(clean.data.warnings, [])
  const other = (await pmkit(root, ['epic', 'create', '--title', 'Other'])).data.after.id
  fs.writeFileSync(path.join(root, '.issues', 'epics', other, 'epic.md'), '---\ntitle: [\n---\n')
  const broken = await pmkit(root, ['goal', 'get', 'GOAL-8K2W'])
  assert.equal(broken.data.complete, false)
  assert.ok(broken.data.warnings.some((line) => line.startsWith(`${other}:`)), broken.stdout)
})
