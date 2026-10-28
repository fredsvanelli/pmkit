// The CLI over the Linear adapter with a fake fetch. No test here touches the network or the real user store.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { linearDescriptor } from './lib/linear/adapter.mjs'
import { isMutation, operationName } from './lib/linear/client.mjs'
import { useLinear } from './fake-hosted.mjs'
import { ACME_TEAM, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeLinearProjects, fakeTriage, fakeWorkspace } from './fake-linear-api.mjs'
import { childEnv } from './golden-helpers.mjs'
import { epicRecord } from './lib/format.mjs'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { categoryLookup, cycleTimes, doneInRange, groupEventsByIssue } from './lib/metrics.mjs'
import { makeRepo, userStoreEnv } from './test-helpers.mjs'

// gitUserEmail reads the process environment, so the in-process runs need the same git isolation as childEnv.
process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir())

function setup({ edit, withKey = true } = {}) {
  const root = useLinear(makeRepo('basic'))
  if (edit) {
    const file = path.join(root, '.pmkit', 'config.yaml')
    fs.writeFileSync(file, edit(fs.readFileSync(file, 'utf8')))
  }
  const env = { ...childEnv(), ...userStoreEnv().env, ...(withKey ? { LINEAR_API_KEY: FAKE_KEY } : {}) }
  return { root, env }
}

function cli(context, args, fetch = fakeLinearFetch(fakeWorkspace())) {
  return run(args, { cwd: context.root, env: context.env, adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch }) } })
}

const withTeam = (text) => text.replace('    workspace: acme', '    workspace: acme\n    team: ACME')
const callsOf = (fetch, name) => fetch.calls.filter((call) => operationName(call.body.query) === name).length
const errorOf = (result) => JSON.parse(result.stdout).error

test('discover --json returns auth before teams and statuses', async () => {
  const result = await cli(setup(), ['discover', '--json'])
  assert.equal(result.code, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.deepEqual(Object.keys(data).slice(0, 5), ['auth', 'workspace', 'team', 'teams', 'statuses'])
  assert.equal(data.statuses.find((status) => status.name === 'Duplicate').category, 'canceled')
  assert.equal(result.stderr, '')
})

test('discover always refreshes', async () => {
  const context = setup()
  const fetch = fakeLinearFetch(fakeWorkspace())
  assert.equal((await cli(context, ['discover', '--json'], fetch)).code, 0)
  assert.equal((await cli(context, ['discover', '--json'], fetch)).code, 0)
  assert.equal(callsOf(fetch, 'PmkitTeams'), 2)
  const before = fetch.calls.length
  const capabilities = await cli(context, ['capabilities', '--json'], fetch)
  assert.equal(capabilities.code, 0, capabilities.stderr)
  assert.equal(fetch.calls.length, before)
})

test('discover prints the workspace and teams lines', async () => {
  const result = await cli(setup(), ['discover'])
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /^workspace: Acme \(acme\), plan free, viewer Test User$/m)
  assert.match(result.stdout, /^teams:$/m)
  assert.match(result.stdout, /^ {2}ACME {2}Acme {2}cycles off, triage off, estimate notUsed$/m)
  assert.ok(result.stdout.indexOf('workspace:') < result.stdout.indexOf('statuses:'))
})

test('a cached discover result prints the workspace line without a viewer', async () => {
  const context = setup()
  const fetch = fakeLinearFetch(fakeWorkspace())
  await cli(context, ['discover', '--json'], fetch)
  const result = await cli(context, ['capabilities'], fetch)
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /^workspace: acme \(free\)$/m)
  assert.match(result.stdout, /^team: \(none\)$/m)
  assert.match(result.stdout, /^discovered: 2026-/m)
  assert.ok(result.stdout.indexOf('git host:') < result.stdout.indexOf('workspace:'))
})

test('discover without a key exits 2 with AUTH', async () => {
  const fetch = fakeLinearFetch(fakeWorkspace())
  const result = await cli(setup({ withKey: false }), ['discover', '--json'], fetch)
  assert.equal(result.code, 2)
  assert.equal(errorOf(result).code, 'AUTH')
  assert.equal(fetch.calls.length, 0)
})

test('a refused read prints no key', async () => {
  for (const args of [['discover', '--json'], ['discover']]) {
    const result = await cli(setup(), args, fakeLinearFetch(fakeWorkspace({ refuse: ['PmkitTeams'] })))
    assert.equal(result.code, 2, args.join(' '))
    if (args.includes('--json')) assert.equal(errorOf(result).code, 'AUTH')
    else assert.match(result.stderr, /^error: Linear refused the request for this key$/m)
    assert.ok(!result.stdout.includes(FAKE_KEY) && !result.stderr.includes(FAKE_KEY), args.join(' '))
  }
})

test('capabilities --json reports 20 entries', async () => {
  const result = await cli(setup(), ['capabilities', '--json'])
  assert.equal(result.code, 0, result.stderr)
  const manifest = JSON.parse(result.stdout)
  assert.equal(manifest.capabilities.length, 20)
  assert.equal(manifest.workspace.plan, 'free')
  assert.equal(manifest.tracker, 'linear')
})

test('validate lists a missing workspace and no secret-like key', async () => {
  const context = setup({ edit: (text) => text.replace('    workspace: acme', '    token: plainvalue') })
  const result = await cli(context, ['validate'])
  assert.match(result.stdout, /tracker\.scope\.workspace is required for linear/)
  assert.ok(!result.stdout.includes('token'), result.stdout)
})

test('discover with a secret-like key exits 2 with INVALID_INPUT', async () => {
  const context = setup({ edit: (text) => text.replace('    workspace: acme', '    workspace: acme\n    token: plainvalue') })
  const result = await cli(context, ['discover', '--json'])
  assert.equal(result.code, 2)
  const error = errorOf(result)
  assert.equal(error.code, 'INVALID_INPUT')
  assert.ok(error.message.includes('tracker.scope.token'))
  assert.ok(!error.message.includes('plainvalue'))
})

test('the workspace rename warning reaches stderr', async () => {
  const fetch = fakeLinearFetch(fakeWorkspace({ urlKey: 'acme-new' }), { workspace: 'acme-new', previousUrlKeys: ['acme'] })
  const result = await cli(setup(), ['discover', '--json'], fetch)
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stderr, /^warning: Linear renamed workspace acme to acme-new/m)
})

test('issues list --json returns the issues', async () => {
  const fake = fakeLinearIssues()
  fake.seed({ title: 'First' })
  const result = await cli(setup({ edit: withTeam }), ['issues', 'list', '--json'], fakeLinearFetch({ ...fakeWorkspace(), ...fake.routes }))
  assert.equal(result.code, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.deepEqual(data.issues.map((issue) => issue.id), ['ACME-1'])
  assert.equal(data.hasMore, false)
})

test('issues list --limit does not warn about the page cap', async () => {
  const { fetch } = withIssues(['A', 'B', 'C'])
  const result = await cli(setup({ edit: withTeam }), ['issues', 'list', '--limit', '2', '--json'], fetch)
  assert.equal(result.code, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.deepEqual(data.issues.map((issue) => issue.id), ['ACME-1', 'ACME-2'])
  assert.equal(data.hasMore, false)
  assert.equal(result.stderr, '')
})

// A fetch over the default workspace and a stateful issue store, with `titles` seeded as ACME-1, ACME-2 and so on.
function withIssues(titles = []) {
  const fake = fakeLinearIssues()
  for (const title of titles) fake.seed({ title })
  return { fake, fetch: fakeLinearFetch({ ...fakeWorkspace(), ...fake.routes }) }
}

test('issues dependencies sends a non-issue id to getDeliverable, which finds no such epic', async () => {
  const result = await cli(setup({ edit: withTeam }), ['issues', 'dependencies', 'EPC-1x', '--json'], withIssues().fetch)
  assert.equal(errorOf(result).code, 'NOT_FOUND')
  assert.equal(errorOf(result).message, 'epic EPC-1x does not exist')
})

test('issues dependencies reads an issue id as an issue', async () => {
  const result = await cli(setup({ edit: withTeam }), ['issues', 'dependencies', 'acme-1', '--json'], withIssues(['Fix it']).fetch)
  assert.equal(result.code, 0, result.stdout + result.stderr)
})

test('issues branch uses the name Linear suggests', async () => {
  const { fake, fetch } = withIssues(['Fix it'])
  fake.records[0].branchName = 'ada/acme-1-fix-it'
  const context = setup({ edit: (text) => withTeam(text.replace('  system: none', '  system: github')) })
  const result = await cli(context, ['issues', 'branch', 'ACME-1', '--as', 'user-1', '--dry-run', '--json'], fetch)
  assert.equal(result.code, 0, result.stdout + result.stderr)
  assert.equal(JSON.parse(result.stdout).branch, 'ada/acme-1-fix-it')
  assert.deepEqual(fake.mutations, [])
})

const lastFilter = (fetch) => fetch.calls.filter((call) => operationName(call.body.query) === 'PmkitIssues').at(-1).body.variables.filter

test('whoami prints the viewer', async () => {
  const json = await cli(setup({ edit: withTeam }), ['whoami', '--json'], withIssues().fetch)
  assert.equal(json.code, 0, json.stdout + json.stderr)
  assert.equal(JSON.parse(json.stdout).id, 'user-1')
  const text = await cli(setup({ edit: withTeam }), ['whoami'], withIssues().fetch)
  assert.equal(text.stdout, 'user-1 (Test User)\n')
})

test('issues list --assignee me sends the viewer id', async () => {
  const { fake, fetch } = withIssues()
  fake.seed({ title: 'Mine', assigneeId: 'user-1' })
  fake.seed({ title: 'Theirs', assigneeId: 'user-2' })
  const result = await cli(setup({ edit: withTeam }), ['issues', 'list', '--assignee', 'me', '--json'], fetch)
  assert.equal(result.code, 0, result.stdout + result.stderr)
  assert.deepEqual(JSON.parse(result.stdout).issues.map((issue) => issue.id), ['ACME-1'])
  assert.deepEqual(lastFilter(fetch).and, [{ team: { key: { eq: 'ACME' } } }, { assignee: { id: { eq: 'user-1' } } }])
})

test('issues assign ACME-1 me assigns the viewer', async () => {
  const { fake, fetch } = withIssues(['Assign me'])
  const result = await cli(setup({ edit: withTeam }), ['issues', 'assign', 'ACME-1', 'me', '--json'], fetch)
  assert.equal(result.code, 0, result.stdout + result.stderr)
  assert.equal(JSON.parse(result.stdout).after.assignee, 'user-1')
  assert.deepEqual(fake.mutations, ['PmkitIssueUpdate'])
})

test('--as another member exits 2 with INVALID_INPUT', async () => {
  const { fake, fetch } = withIssues(['Assign me'])
  const result = await cli(setup({ edit: withTeam }), ['issues', 'assign', 'ACME-1', 'me', '--as', 'user-2', '--json'], fetch)
  assert.equal(result.code, 2)
  assert.deepEqual(errorOf(result), {
    code: 'INVALID_INPUT',
    message: 'Linear records every write as the owner of LINEAR_API_KEY (Test User)',
    nextStep: 'Drop --as, or use a key created by that member',
  })
  assert.deepEqual(fake.mutations, [])
})

test('issues list warns when Linear has more', async () => {
  const { fake, fetch } = withIssues()
  for (let index = 0; index < 1001; index += 1) fake.seed({ title: `Issue ${index}` })
  const plain = await cli(setup({ edit: withTeam }), ['issues', 'list', '--json'], fetch)
  assert.equal(plain.code, 0, plain.stderr)
  assert.equal(plain.stderr, 'warning: Linear has more matching issues than the 1000 pmkit read; narrow the filter\n')
  const sorted = await cli(setup({ edit: withTeam }), ['issues', 'list', '--sort', 'priority', '--json'], fetch)
  assert.equal(sorted.stderr, 'warning: Linear has more matching issues than the 1000 pmkit read; narrow the filter; the order covers the issues read\n')
})

test('a dry-run create prints (new)', async () => {
  const { fake, fetch } = withIssues()
  const result = await cli(setup({ edit: withTeam }), ['issues', 'create', '--title', 'Fresh', '--dry-run'], fetch)
  assert.equal(result.code, 0, result.stdout + result.stderr)
  assert.ok(result.stdout.startsWith('(new)  Fresh\n'), result.stdout)
  assert.ok(result.stdout.endsWith('dry run: nothing was written\n'), result.stdout)
  assert.deepEqual(fake.mutations, [])
})

test('a create prints the new id and no key', async () => {
  const { fetch } = withIssues()
  const result = await cli(setup({ edit: withTeam }), ['issues', 'create', '--title', 'Fresh'], fetch)
  assert.equal(result.code, 0, result.stdout + result.stderr)
  assert.ok(result.stdout.startsWith('ACME-1  Fresh\n'), result.stdout)
  assert.ok(!result.stdout.includes(FAKE_KEY) && !result.stderr.includes(FAKE_KEY))
})

// ---------------------------------------------------------------------------
// init --tracker linear

import { spawnSync } from 'node:child_process'
import { tempDir } from './test-helpers.mjs'
import { parseYaml } from './lib/yaml.mjs'

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' })

// An empty repository whose origin is acme/app, for a first run.
function fresh({ withKey = true, remote = true } = {}) {
  const root = tempDir('pmkit-linear-init-')
  git(root, 'init', '-q')
  if (remote) git(root, 'remote', 'add', 'origin', 'git@github.com:acme/app.git')
  const env = { ...childEnv(), ...userStoreEnv().env, ...(withKey ? { LINEAR_API_KEY: FAKE_KEY } : {}) }
  return { root, env }
}

const read = (context, file) => fs.readFileSync(path.join(context.root, file), 'utf8')
const dataOf = (result) => {
  assert.equal(result.code, 0, result.stderr)
  return JSON.parse(result.stdout)
}
const INIT = ['init', '--tracker', 'linear', '--git-host', 'github']
const RECOMMENDED = ['--status', 'in_review=In Review', '--status', 'blocked=none']
const NO_TYPES = ['--type-label', 'feature=none', '--type-label', 'bug=none', '--type-label', 'task=none', '--type-label', 'chore=none']
const teamNode = (id, key, name) => ({ id, key, name, parent: null, cyclesEnabled: false, triageEnabled: false, issueEstimationType: 'notUsed', issueEstimationAllowZero: false, issueEstimationExtended: false })
const stateNode = (id, name, type, position, team) => ({ id, name, type, position, team: { id: team } })
// Two teams and a viewer who belongs to both. BETA has one started state, so it offers no in-review candidate.
const TWO_TEAMS = () =>
  fakeWorkspace({
    teams: [teamNode('team-acme', 'ACME', 'Acme'), teamNode('team-beta', 'BETA', 'Beta')],
    states: [
      stateNode('sa-1', 'Todo', 'unstarted', 0, 'team-acme'), stateNode('sa-2', 'Doing', 'started', 1, 'team-acme'), stateNode('sa-3', 'Review', 'started', 2, 'team-acme'),
      stateNode('sb-1', 'Todo', 'unstarted', 0, 'team-beta'), stateNode('sb-2', 'Doing', 'started', 1, 'team-beta'),
    ],
    users: [{ id: 'user-1', name: 'Test User', displayName: 'test', email: 't@example.com', active: true, guest: false, app: false, teams: { nodes: [{ id: 'team-acme' }, { id: 'team-beta' }] } }],
    labels: [],
  })

test('the first dry run applies the scope and asks the status and type questions', async () => {
  const context = fresh()
  const fetch = fakeLinearFetch(fakeWorkspace())
  const result = await cli(context, [...INIT, '--dry-run', '--json'], fetch)
  const data = dataOf(result)
  assert.deepEqual(Object.keys(data), ['dryRun', 'tracker', 'workspace', 'viewer', 'team', 'applied', 'questions', 'broken', 'statuses', 'notes', 'files'])
  assert.equal(data.dryRun, true)
  assert.equal(data.tracker, 'linear')
  assert.deepEqual(data.workspace, { urlKey: 'acme', name: 'Acme', plan: 'free' })
  assert.deepEqual(data.viewer, { id: 'user-1', name: 'Test User' })
  assert.equal(data.team, 'ACME')
  assert.deepEqual(data.applied.map((item) => [item.path, item.value]), [['tracker.scope.workspace', 'acme'], ['tracker.scope.team', 'ACME']])
  assert.deepEqual(data.questions.map((q) => q.path), [
    'mappings.status.in_review', 'mappings.status.blocked',
    'mappings.types.feature', 'mappings.types.bug', 'mappings.types.task', 'mappings.types.chore',
  ])
  assert.equal(data.questions[0].recommended, 'In Review')
  assert.equal(data.questions[0].flag, '--status in_review=<value>')
  assert.deepEqual(data.questions[2].candidates.slice(0, 2), ['Feature', 'Bug'])
  assert.deepEqual(data.broken, [])
  assert.equal(data.statuses.find((status) => status.name === 'Duplicate').category, 'canceled')
  assert.deepEqual(data.notes, ["team ACME has estimates off; turn them on in the team's settings in Linear and run setup again"])
  assert.deepEqual(data.files, [{ path: '.pmkit/config.yaml', action: 'create' }])
  assert.ok(!fs.existsSync(path.join(context.root, '.pmkit')))
  assert.ok(!result.stdout.includes(FAKE_KEY) && !result.stderr.includes(FAKE_KEY))
  assert.ok(callsOf(fetch, 'PmkitTeams') >= 1)
})

test('the text dry run prints the same parts as short lines', async () => {
  const result = await cli(fresh(), [...INIT, '--dry-run'])
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /^workspace: Acme \(acme\), plan free, viewer Test User$/m)
  assert.match(result.stdout, /^team: ACME$/m)
  assert.match(result.stdout, /^applied:$/m)
  assert.match(result.stdout, /^ {2}mappings\.status\.in_review {2}--status in_review=<value> {2}one of: In Review,/m)
  assert.match(result.stdout, /^dry run: nothing was written$/m)
})

test('with two teams and the viewer in both, only the team is a question', async () => {
  const data = dataOf(await cli(fresh(), [...INIT, '--dry-run', '--json'], fakeLinearFetch(TWO_TEAMS())))
  assert.equal(data.team, null)
  assert.deepEqual(data.questions.map((q) => [q.path, q.candidates]), [['tracker.scope.team', ['ACME', 'BETA']]])
  assert.deepEqual(data.statuses, [])
  const chosen = dataOf(await cli(fresh(), [...INIT, '--team', 'BETA', '--dry-run', '--json'], fakeLinearFetch(TWO_TEAMS())))
  assert.equal(chosen.team, 'BETA')
  assert.deepEqual(chosen.questions[0].candidates, [])
  assert.deepEqual(chosen.statuses.map((status) => status.name), ['Todo', 'Doing'])
})

test('a status value keeps its space and an answer outside the candidates exits 2 naming them', async () => {
  const context = fresh()
  const ok = dataOf(await cli(context, [...INIT, '--status', 'in_review=Code Review', '--dry-run', '--json']))
  assert.ok(!ok.questions.some((q) => q.path === 'mappings.status.in_review'))
  assert.match(ok.files[0].path, /config\.yaml/)
  const bad = await cli(context, [...INIT, '--status', 'in_review=Review', '--dry-run', '--json'])
  assert.equal(bad.code, 2)
  const error = errorOf(bad)
  assert.equal(error.code, 'INVALID_INPUT')
  assert.equal(error.message, '--status in_review=Review is not a status of team ACME')
  assert.match(error.nextStep, /^Pass one of: In Review, In Progress, Code Review, UAT, Ready to ship, none$/)
})

test('a Local-only flag is refused with the flag named', async () => {
  for (const flag of ['--prefix', '--id-style', '--estimate-unit', '--label', '--member', '--name', '--email', '--members-file']) {
    const fetch = fakeLinearFetch(fakeWorkspace())
    const result = await cli(fresh(), [...INIT, flag, 'x', '--dry-run', '--json'], fetch)
    assert.equal(result.code, 2, flag)
    assert.deepEqual(errorOf(result), { code: 'INVALID_INPUT', message: `Linear sets ${flag} itself`, nextStep: `Remove ${flag}` }, flag)
    assert.equal(fetch.calls.length, 0, flag)
  }
})

test('a Linear-only flag is refused for the Local tracker', async () => {
  const result = await cli(fresh(), ['init', '--team', 'ACME', '--dry-run', '--json'])
  assert.equal(result.code, 2)
  assert.equal(errorOf(result).code, 'INVALID_INPUT')
})

test('a missing key fails with AUTH before any request, and the dry run writes nothing', async () => {
  const fetch = fakeLinearFetch(fakeWorkspace())
  const context = fresh({ withKey: false })
  const result = await cli(context, [...INIT, '--dry-run', '--json'], fetch)
  assert.equal(result.code, 2)
  assert.equal(errorOf(result).code, 'AUTH')
  assert.equal(fetch.calls.length, 0)
  assert.ok(!fs.existsSync(path.join(context.root, '.pmkit')))
})

// ---------------------------------------------------------------------------
// init writes and updates

const WALKTHROUGH = `# yaml-language-server: $schema=https://raw.githubusercontent.com/fredsvanelli/pmkit/main/schemas/pmkit.config.schema.json
version: 1
tracker:
  system: linear
  scope:
    workspace: acme
    team: ACME
git_host:
  system: github
  repo: acme/app
write_policy:
  confirm: single_writes
  preview: [bulk, delete, publish_update, move_scope]
mappings:
  status:
    in_review: In Review
    blocked: none
  types: {}
`

test('the write with the recommended answers creates the walkthrough file and no .issues', async () => {
  const context = fresh()
  const result = await cli(context, [...INIT, ...RECOMMENDED, ...NO_TYPES, '--json'])
  const data = dataOf(result)
  assert.equal(data.dryRun, false)
  assert.deepEqual(data.files, [{ path: '.pmkit/config.yaml', action: 'create' }])
  assert.equal(read(context, '.pmkit/config.yaml'), WALKTHROUGH)
  assert.ok(!fs.existsSync(path.join(context.root, '.issues')))
  assert.ok(!result.stdout.includes(FAKE_KEY) && !read(context, '.pmkit/config.yaml').includes(FAKE_KEY))
})

test('a type answer writes mappings.types', async () => {
  const context = fresh()
  const answers = [...RECOMMENDED, '--type-label', 'bug=Bug', '--type-label', 'feature=Feature', '--type-label', 'task=none', '--type-label', 'chore=none']
  assert.equal((await cli(context, [...INIT, ...answers, '--json'])).code, 0)
  const written = parseYaml(read(context, '.pmkit/config.yaml'))
  assert.deepEqual(written.mappings.types, { feature: 'Feature', bug: 'Bug' })
  assert.deepEqual(Object.keys(written.mappings.types), ['feature', 'bug'])
})

test('a write with questions left exits 2 and writes nothing', async () => {
  const context = fresh()
  const result = await cli(context, [...INIT, '--json'])
  assert.equal(result.code, 2)
  assert.deepEqual(errorOf(result), {
    code: 'INVALID_INPUT',
    message: 'setup has unanswered questions: mappings.status.in_review, mappings.status.blocked, mappings.types.feature, mappings.types.bug, mappings.types.task, mappings.types.chore',
    nextStep: '/pmkit:setup',
  })
  assert.ok(!fs.existsSync(path.join(context.root, '.pmkit')))
})

test('an existing .pmkit/config.yaml on a first run is a CONFLICT', async () => {
  const context = setup()
  const result = await cli(context, [...INIT, '--dry-run', '--json'])
  assert.equal(result.code, 2)
  assert.equal(errorOf(result).code, 'CONFLICT')
})

async function written() {
  const context = fresh()
  assert.equal((await cli(context, [...INIT, ...RECOMMENDED, ...NO_TYPES, '--json'])).code, 0)
  return context
}

test('a second --update --dry-run has no questions, nothing broken and no change, even with types: {}', async () => {
  const context = await written()
  const data = dataOf(await cli(context, ['init', '--update', '--dry-run', '--json']))
  assert.deepEqual(data.questions, [])
  assert.deepEqual(data.broken, [])
  assert.deepEqual(data.applied, [])
  assert.deepEqual(data.files, [{ path: '.pmkit/config.yaml', action: 'keep' }])
  const plain = await cli(context, ['init', '--update', '--dry-run'])
  assert.match(plain.stdout, /\.pmkit\/config\.yaml: keep/)
})

test('--update after the workspace drops the in-review state lists it as the only question', async () => {
  const context = await written()
  const states = fakeWorkspace().PmkitStates
  const without = fakeWorkspace({ states: JSON.parse(JSON.stringify(states({ variables: { first: 250 } }).json.data.workflowStates.nodes)).filter((state) => state.name !== 'In Review') })
  const dry = dataOf(await cli(context, ['init', '--update', '--dry-run', '--json'], fakeLinearFetch(without)))
  assert.deepEqual(dry.broken, [{ path: 'mappings.status.in_review', value: 'In Review', problem: 'mappings.status.in_review names In Review, which team ACME no longer has' }])
  assert.deepEqual(dry.questions.map((q) => q.path), ['mappings.status.in_review'])
  assert.deepEqual(dry.questions[0].broken, { was: 'In Review', problem: 'mappings.status.in_review names In Review, which team ACME no longer has' })
  const write = dataOf(await cli(context, ['init', '--update', '--status', 'in_review=Code Review', '--json'], fakeLinearFetch(without)))
  assert.equal(write.files[0].action, 'change')
  assert.equal(read(context, '.pmkit/config.yaml'), WALKTHROUGH.replace('in_review: In Review', 'in_review: Code Review'))
})

test('--update asks again for a hand-written status and type that broke, and the answers repair them', async () => {
  const context = await written()
  const edited = WALKTHROUGH.replace('    blocked: none\n', '    blocked: none\n    done: Shipped\n').replace('  types: {}\n', '  types:\n    spike: Research\n')
  fs.writeFileSync(path.join(context.root, '.pmkit', 'config.yaml'), edited)
  const dry = dataOf(await cli(context, ['init', '--update', '--dry-run', '--json']))
  assert.deepEqual(dry.broken.map((item) => item.path), ['mappings.status.done', 'mappings.types.spike'])
  assert.deepEqual(dry.questions.map((q) => q.path), ['mappings.status.done', 'mappings.types.spike'])
  const [done, spike] = dry.questions
  assert.deepEqual(done.candidates, ['Backlog', 'Todo', 'In Progress', 'In Review', 'Code Review', 'UAT', 'Ready to ship', 'Done', 'Canceled', 'Duplicate'])
  assert.deepEqual(done.broken, { was: 'Shipped', problem: 'mappings.status.done names Shipped, which team ACME no longer has' })
  assert.deepEqual(spike.candidates, ['Bug', 'Feature', 'L', 'M', 'S', 'XL', 'XS', 'Docs'])
  dataOf(await cli(context, ['init', '--update', '--status', 'done=Done', '--type-label', 'spike=none', '--json']))
  assert.deepEqual(parseYaml(read(context, '.pmkit/config.yaml')).mappings, { status: { in_review: 'In Review', blocked: 'none', done: 'Done' }, types: {} })
})

test('--update repairs a lost team through to the write', async () => {
  const context = await written()
  const lost = WALKTHROUGH.replace('    team: ACME\n', '    team: GONE\n')
  fs.writeFileSync(path.join(context.root, '.pmkit', 'config.yaml'), lost)
  const dry = dataOf(await cli(context, ['init', '--update', '--dry-run', '--json']))
  assert.deepEqual(dry.questions.map((q) => q.path), ['tracker.scope.team'])
  assert.deepEqual(dry.questions[0].candidates, ['ACME'])
  const write = dataOf(await cli(context, ['init', '--update', '--team', 'ACME', '--json']))
  assert.equal(write.files[0].action, 'change')
  assert.equal(read(context, '.pmkit/config.yaml'), WALKTHROUGH)
})

test('--update with another tracker fails with NOT_SUPPORTED in both directions', async () => {
  const linear = await written()
  const toLocal = await cli(linear, ['init', '--update', '--tracker', 'local', '--dry-run', '--json'])
  assert.equal(toLocal.code, 2)
  assert.deepEqual(errorOf(toLocal), { code: 'NOT_SUPPORTED', message: 'setup cannot switch trackers', nextStep: 'Keep tracker.system as it is' })
  const local = { root: makeRepo('basic'), env: setup().env }
  const toLinear = await cli(local, ['init', '--update', '--tracker', 'linear', '--dry-run', '--json'])
  assert.equal(toLinear.code, 2)
  assert.equal(errorOf(toLinear).code, 'NOT_SUPPORTED')
})

test('--update adds mappings.status.blocked to a file with no mappings block and keeps its comments', async () => {
  const context = setup({ edit: (text) => `${withTeam(text)}# keep me\n` })
  const before = read(context, '.pmkit/config.yaml')
  const answers = ['--status', 'in_review=In Review', '--status', 'blocked=none', ...NO_TYPES]
  const data = dataOf(await cli(context, ['init', '--update', ...answers, '--json']))
  assert.equal(data.files[0].action, 'change')
  const after = read(context, '.pmkit/config.yaml')
  assert.ok(after.includes('# keep me'))
  const lines = after.split('\n')
  for (const line of before.split('\n').filter(Boolean)) assert.ok(lines.includes(line), line)
  assert.deepEqual(parseYaml(after).mappings, { status: { in_review: 'In Review', blocked: 'none' }, types: {} })
})

test('a broken mapping reaches the JSON error as error.mappings', async () => {
  const context = setup({ edit: (text) => `${withTeam(text)}mappings:\n  status:\n    in_review: Peer Review\n` })
  const result = await cli(context, ['issues', 'list', '--json'])
  assert.equal(result.code, 2)
  const error = errorOf(result)
  assert.equal(error.code, 'NOT_CONFIGURED')
  assert.equal(error.nextStep, '/pmkit:setup')
  assert.deepEqual(error.mappings, [{ path: 'mappings.status.in_review', value: 'Peer Review', problem: 'mappings.status.in_review names Peer Review, which team ACME no longer has' }])
  assert.deepEqual(Object.keys(error), ['code', 'message', 'nextStep', 'mappings'])
  const plain = await cli(context, ['issues', 'list'])
  assert.match(plain.stderr, /^error: a mapping in \.pmkit\/config\.yaml names something the workspace no longer has: /)
})

// Triage rotation (PMK-43). The Free workspace is the proof for the absent capability; the paid ones use the fake.
const BUSINESS = { type: 'Business' }
const paidTeam = (extra = {}) => ({ ...ACME_TEAM, triageEnabled: true, ...extra })
const MANUAL = {
  id: 'tr-1',
  action: 'assign',
  manualSelection: { userIds: ['user-2', 'user-1'], assignmentIndex: 0 },
  timeSchedule: null,
  currentUser: { id: 'user-2', name: 'Ada Lovelace' },
}
const SCHEDULED = {
  id: 'tr-2',
  action: 'notify',
  manualSelection: null,
  timeSchedule: { id: 'ts-1', name: 'On call', externalUrl: 'https://example.com/s', integration: { service: 'pagerDuty' } },
  currentUser: { id: 'user-1', name: 'Test User' },
}
const triageFetch = ({ workspace = {}, triage = {} } = {}) => fakeLinearFetch({ ...fakeWorkspace(workspace), ...fakeTriage(triage) })
const businessFetch = (triage = {}, workspace = {}) => triageFetch({ workspace: { subscription: BUSINESS, teams: [paidTeam()], ...workspace }, triage })
const TRIAGE_OPERATIONS = ['PmkitTriageShow', 'PmkitTriageSuggestions', 'PmkitTriageCreate', 'PmkitTriageUpdate', 'PmkitTriageDelete']
const triageCalls = (fetch) => fetch.calls.filter((call) => TRIAGE_OPERATIONS.includes(operationName(call.body.query)))
const mutationCalls = (fetch) => fetch.calls.filter((call) => isMutation(call.body.query))

test('linear triage show on a Free workspace says it is unavailable and sends no triage query', async () => {
  const fetch = triageFetch()
  const json = await cli(setup(), ['linear', 'triage', 'show', '--json'], fetch)
  assert.equal(json.code, 0, json.stderr)
  assert.deepEqual(JSON.parse(json.stdout), {
    available: false,
    reason: 'plan',
    plan: 'free',
    team: 'ACME',
    enableHint: 'Triage responsibility needs the Business or Enterprise plan',
  })
  const text = await cli(setup(), ['linear', 'triage', 'show'], fetch)
  assert.equal(text.code, 0, text.stderr)
  assert.equal(text.stdout, 'triage rotation: unavailable\nreason: plan\nplan: free\nenable: Triage responsibility needs the Business or Enterprise plan\n')
  assert.equal(triageCalls(fetch).length, 0)
  assert.equal(mutationCalls(fetch).length, 0)
})

test('linear triage show with triage off reports triage_off and sends no triage query', async () => {
  const fetch = triageFetch({ workspace: { subscription: BUSINESS } })
  const result = await cli(setup(), ['linear', 'triage', 'show', '--json'], fetch)
  assert.equal(result.code, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.reason, 'triage_off')
  assert.equal(data.enableHint, "Turn on triage in the team's settings in Linear")
  assert.equal(triageCalls(fetch).length, 0)
})

test('linear triage show prints a manual rotation, a schedule and no responsibility', async () => {
  const manual = await cli(setup(), ['linear', 'triage', 'show'], businessFetch({ responsibility: MANUAL }))
  assert.equal(manual.code, 0, manual.stderr)
  assert.equal(manual.stdout, 'team: ACME\naction: assign\nsource: manual\non duty: Ada Lovelace\nrotation: Ada Lovelace (current), Test User\n')
  const json = JSON.parse((await cli(setup(), ['linear', 'triage', 'show', '--json'], businessFetch({ responsibility: MANUAL }))).stdout)
  assert.equal(json.available, true)
  assert.equal(json.team, 'ACME')
  assert.deepEqual(json.duty.members.map((member) => member.id), ['user-2', 'user-1'])
  const scheduled = await cli(setup(), ['linear', 'triage', 'show'], businessFetch({ responsibility: SCHEDULED }))
  assert.equal(scheduled.stdout, 'team: ACME\naction: notify\nsource: schedule\non duty: Test User\nschedule: On call (pagerduty)\n')
  const none = await cli(setup(), ['linear', 'triage', 'show'], businessFetch({ responsibility: null }))
  assert.equal(none.stdout, 'team: ACME\nnobody is on triage duty\n')
})

test('linear triage show picks the team from --team, then the scope, then the only team', async () => {
  const second = paidTeam({ id: 'team-two', key: 'TWO', name: 'Two' })
  const fetch = () => businessFetch({ responsibility: null }, { teams: [paidTeam(), second] })
  const teamOf = async (context, args) => JSON.parse((await cli(context, ['linear', 'triage', 'show', '--json', ...args], fetch())).stdout).team
  assert.equal(await teamOf(setup(), ['--team', 'TWO']), 'TWO')
  const scoped = setup({ edit: (text) => text.replace('    workspace: acme', '    workspace: acme\n    team: TWO') })
  assert.equal(await teamOf(scoped, []), 'TWO')
  assert.equal(await teamOf(scoped, ['--team', 'ACME']), 'ACME')
  const many = await cli(setup(), ['linear', 'triage', 'show', '--json'], fetch())
  assert.equal(many.code, 2)
  assert.equal(errorOf(many).code, 'INVALID_INPUT')
  assert.match(errorOf(many).nextStep, /ACME, TWO/)
  const unknown = await cli(setup(), ['linear', 'triage', 'show', '--json', '--team', 'NOPE'], fetch())
  assert.equal(errorOf(unknown).code, 'INVALID_INPUT')
})

test('linear triage show on a Local repository exits 2 with NOT_SUPPORTED', async () => {
  const root = makeRepo('basic')
  const result = await run(['linear', 'triage', 'show', '--json'], { cwd: root, env: { ...childEnv(), ...userStoreEnv().env } })
  assert.equal(result.code, 2)
  assert.deepEqual(errorOf(result).code, 'NOT_SUPPORTED')
  assert.equal(errorOf(result).message, '`linear triage show` works only with the Linear tracker, and tracker.system is "local"')
})

test('linear triage show without a key exits 2 with AUTH and sends nothing', async () => {
  const fetch = businessFetch()
  const result = await cli(setup({ withKey: false }), ['linear', 'triage', 'show', '--json'], fetch)
  assert.equal(result.code, 2)
  assert.equal(errorOf(result).code, 'AUTH')
  assert.equal(fetch.calls.length, 0)
})

test('linear triage show prints no key', async () => {
  const fetch = businessFetch({ responsibility: MANUAL })
  const result = await cli(setup(), ['linear', 'triage', 'show', '--json'], fetch)
  assert.ok(!result.stdout.includes(FAKE_KEY) && !result.stderr.includes(FAKE_KEY))
})

const sug = (type, extra = {}) => ({ type, state: 'active', metadata: { score: 0.9, reasons: ['why'] }, presentedReasons: null, ...extra })
const inboxIssue = (identifier, createdAt, suggestions = []) => ({ identifier, title: `Title ${identifier}`, createdAt, suggestions: { nodes: suggestions } })
const label = { suggestedLabel: { id: 'l1', name: 'Bug' } }

test('linear triage suggestions on a Free workspace is unavailable and sends no query', async () => {
  const fetch = triageFetch()
  const result = await cli(setup(), ['linear', 'triage', 'suggestions', '--json'], fetch)
  assert.equal(result.code, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.available, false)
  assert.equal(data.reason, 'plan')
  assert.equal(triageCalls(fetch).length, 0)
})

test('linear triage suggestions lists active suggestions, oldest issue first, and drops stale ones', async () => {
  const issues = [
    inboxIssue('ACME-2', '2026-10-02T00:00:00Z', [sug('label', label), sug('label', { ...label, state: 'stale' })]),
    inboxIssue('ACME-1', '2026-10-01T00:00:00Z', [sug('assignee', { suggestedUser: { id: 'user-2', name: 'Ada Lovelace' }, metadata: { score: 0.5, reasons: [] } })]),
    inboxIssue('ACME-3', '2026-10-03T00:00:00Z', []),
  ]
  const json = JSON.parse((await cli(setup(), ['linear', 'triage', 'suggestions', '--json'], businessFetch({ issues }))).stdout)
  assert.equal(json.available, true)
  assert.deepEqual(json.issues.map((issue) => issue.id), ['ACME-1', 'ACME-2'])
  assert.equal(json.issues[1].suggestions.length, 1)
  assert.deepEqual(json.issues[1].suggestions[0], { type: 'label', target: { id: 'l1', name: 'Bug' }, score: 0.9, reasons: ['why'] })
  assert.equal(json.withoutSuggestions, 1)
  const text = await cli(setup(), ['linear', 'triage', 'suggestions'], businessFetch({ issues }))
  assert.match(text.stdout, /^ACME-1 {2}Title ACME-1\n {2}assignee Ada Lovelace \(score 0\.5\)\nACME-2 /)
})

test('linear triage suggestions on an empty inbox says so', async () => {
  const result = await cli(setup(), ['linear', 'triage', 'suggestions'], businessFetch({ issues: [] }))
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stdout, 'no issue is waiting in triage\n')
})

test('linear triage suggestions defaults --limit to 25, clamps it to 100 and warns when issues are left out', async () => {
  const issues = Array.from({ length: 30 }, (_, index) => inboxIssue(`ACME-${index + 1}`, `2026-10-01T00:${String(index).padStart(2, '0')}:00Z`, [sug('label', label)]))
  const firstOf = (fetch) => triageCalls(fetch)[0].body.variables.first
  const fetch = businessFetch({ issues })
  const base = await cli(setup(), ['linear', 'triage', 'suggestions', '--json'], fetch)
  assert.equal(firstOf(fetch), 25)
  assert.equal(JSON.parse(base.stdout).issues.length, 25)
  assert.match(base.stderr, /^warning: more issues are waiting in triage than --limit 25 shows/m)
  const huge = businessFetch({ issues })
  const clamped = await cli(setup(), ['linear', 'triage', 'suggestions', '--json', '--limit', '500'], huge)
  assert.equal(firstOf(huge), 100)
  assert.equal(JSON.parse(clamped.stdout).issues.length, 30)
  assert.match(clamped.stderr, /^warning: --limit 500 is above 100; using 100$/m)
  const bad = await cli(setup(), ['linear', 'triage', 'suggestions', '--json', '--limit', '0'], businessFetch({ issues }))
  assert.equal(errorOf(bad).code, 'INVALID_INPUT')
})

const set = (context, args, fetch) => cli(context, ['linear', 'triage', 'set', '--json', ...args], fetch)

test('linear triage set on a Free workspace exits 2 with NOT_SUPPORTED and sends nothing', async () => {
  for (const args of [['--off'], ['--members', 'user-2', '--dry-run']]) {
    const fetch = triageFetch({ triage: { responsibility: MANUAL } })
    const result = await set(setup(), args, fetch)
    assert.equal(result.code, 2, args.join(' '))
    assert.deepEqual(errorOf(result), {
      code: 'NOT_SUPPORTED',
      message: 'triage rotation is unavailable on this workspace (plan free)',
      nextStep: 'Triage responsibility needs the Business or Enterprise plan',
    })
    assert.equal(triageCalls(fetch).length, 0)
    assert.equal(mutationCalls(fetch).length, 0)
  }
})

test('linear triage set creates a manual rotation with exactly one mutation', async () => {
  const fetch = businessFetch({ responsibility: null })
  const result = await set(setup(), ['--members', 'user-2,user-1'], fetch)
  assert.equal(result.code, 0, result.stderr)
  const calls = mutationCalls(fetch)
  assert.equal(calls.length, 1)
  assert.equal(operationName(calls[0].body.query), 'PmkitTriageCreate')
  assert.deepEqual(calls[0].body.variables.input, {
    teamId: 'team-acme',
    action: 'assign',
    manualSelection: { userIds: ['user-2', 'user-1'], assignmentIndex: 0 },
  })
  const data = JSON.parse(result.stdout)
  assert.equal(data.before.source, 'none')
  assert.equal(data.after.source, 'manual')
  assert.deepEqual(data.after.current, { id: 'user-2', name: 'Ada Lovelace' })
  assert.ok(!JSON.stringify(calls[0].body).includes(FAKE_KEY))
  assert.ok(!result.stdout.includes(FAKE_KEY) && !result.stderr.includes(FAKE_KEY))
})

test('linear triage set updates the rotation, the action, and turns the responsibility off', async () => {
  const members = businessFetch({ responsibility: MANUAL })
  const updated = await set(setup(), ['--members', 'user-1,user-2'], members)
  assert.equal(updated.code, 0, updated.stderr)
  const [update] = mutationCalls(members)
  assert.equal(operationName(update.body.query), 'PmkitTriageUpdate')
  assert.equal(update.body.variables.id, 'tr-1')
  assert.deepEqual(update.body.variables.input, { manualSelection: { userIds: ['user-1', 'user-2'], assignmentIndex: 1 } })
  assert.equal(JSON.parse(updated.stdout).after.current.id, 'user-2')

  const action = businessFetch({ responsibility: MANUAL })
  const notify = await set(setup(), ['--action', 'notify'], action)
  assert.equal(mutationCalls(action).length, 1)
  assert.deepEqual(mutationCalls(action)[0].body.variables.input, { action: 'notify' })
  assert.equal(JSON.parse(notify.stdout).after.action, 'notify')
  assert.equal(JSON.parse(notify.stdout).before.action, 'assign')

  const off = businessFetch({ responsibility: MANUAL })
  const removed = await set(setup(), ['--off'], off)
  assert.equal(removed.code, 0, removed.stderr)
  assert.equal(operationName(mutationCalls(off)[0].body.query), 'PmkitTriageDelete')
  assert.equal(mutationCalls(off).length, 1)
  assert.equal(JSON.parse(removed.stdout).after.source, 'none')
})

test('linear triage set --dry-run reads, previews and sends no mutation', async () => {
  const fetch = businessFetch({ responsibility: MANUAL })
  const json = await set(setup(), ['--action', 'notify', '--dry-run'], fetch)
  assert.equal(json.code, 0, json.stderr)
  assert.equal(JSON.parse(json.stdout).after.action, 'notify')
  const text = await cli(setup(), ['linear', 'triage', 'set', '--members', 'user-1', '--dry-run'], fetch)
  assert.match(text.stdout, /^before:\n {2}action: assign/m)
  assert.match(text.stdout, /\nafter:\n {2}action: assign\n {2}source: manual\n {2}on duty: Test User\n/)
  assert.ok(text.stdout.endsWith('dry run: nothing was written\n'), text.stdout)
  assert.equal(mutationCalls(fetch).length, 0)
  assert.equal(callsOf(fetch, 'PmkitTriageShow'), 2)
})

test('linear triage set rejects a bad input before any mutation', async () => {
  const cases = [
    [['--members', 'user-9'], MANUAL, 'INVALID_INPUT'],
    [['--members', 'user-3'], MANUAL, 'INVALID_INPUT'],
    [['--action', 'notify'], null, 'INVALID_INPUT'],
    [[], MANUAL, 'INVALID_INPUT'],
    [['--off', '--action', 'notify'], MANUAL, 'INVALID_INPUT'],
    [['--members', 'user-1'], SCHEDULED, 'CONFLICT'],
  ]
  for (const [args, responsibility, code] of cases) {
    const fetch = businessFetch({ responsibility })
    const result = await set(setup(), args, fetch)
    assert.equal(result.code, 2, args.join(' '))
    assert.equal(errorOf(result).code, code, args.join(' '))
    assert.equal(mutationCalls(fetch).length, 0, args.join(' '))
  }
  const schedule = await set(setup(), ['--members', 'user-1'], businessFetch({ responsibility: SCHEDULED }))
  assert.match(errorOf(schedule).nextStep, /On call/)
})

test('only the three set paths send a mutation', async () => {
  for (const args of [['show'], ['suggestions'], ['set', '--off', '--dry-run'], ['set', '--members', 'user-1', '--dry-run']]) {
    const fetch = businessFetch({ responsibility: MANUAL })
    const result = await cli(setup(), ['linear', 'triage', ...args, '--json'], fetch)
    assert.equal(result.code, 0, `${args.join(' ')}: ${result.stderr}`)
    assert.equal(mutationCalls(fetch).length, 0, args.join(' '))
  }
})

// PMK-36: history, comments, threads and metrics over the fake.

const STATE = { backlog: { id: 'state-1', name: 'Backlog', type: 'backlog' }, progress: { id: 'state-3', name: 'In Progress', type: 'started' }, done: { id: 'state-8', name: 'Done', type: 'completed' } }
const linear = (fetch, args) => cli(setup({ edit: withTeam }), args, fetch)
const bodyFile = (text) => {
  const file = path.join(tempDir('pmkit-body-'), 'c.md')
  fs.writeFileSync(file, text)
  return file
}

test('issues get --history and --comments read Linear, with thread lines in the text', async () => {
  const { fake, fetch } = withIssues()
  fake.seed({ title: 'Talk' }, { createdAt: '2026-10-01T00:00:00.000Z' })
  fake.history('ACME-1', { createdAt: '2026-10-02T00:00:00.000Z', fromTitle: 'Chat', toTitle: 'Talk' })
  fake.comment('ACME-1', { id: 'c-1', body: 'Question?', createdAt: '2026-10-03T00:00:00.000Z', resolvedAt: '2026-10-05T00:00:00.000Z', resolvingUserId: 'user-1' })
  fake.comment('ACME-1', { id: 'c-2', body: 'Answer.', createdAt: '2026-10-04T00:00:00.000Z', parentId: 'c-1' })
  const json = await linear(fetch, ['issues', 'get', 'ACME-1', '--history', '--comments', '--json'])
  assert.equal(json.code, 0, json.stderr)
  const data = JSON.parse(json.stdout)
  assert.deepEqual(data.history.map((e) => [e.op, e.field]), [['create', undefined], ['update', 'title'], ['comment', undefined], ['comment', undefined], ['comment', 'resolved']])
  assert.deepEqual(data.comments.map((c) => [c.id, c.parent, c.resolved?.by]), [['c-1', undefined, 'user-1'], ['c-2', 'c-1', undefined]])
  const text = await linear(fetch, ['issues', 'get', 'ACME-1', '--history', '--comments'])
  assert.equal(text.code, 0, text.stderr)
  assert.match(text.stdout, /^2026-10-04T00:00:00\.000Z user-1 \(reply to c-1\)$/m)
  assert.match(text.stdout, /^resolved 2026-10-05T00:00:00\.000Z by user-1$/m)
  assert.match(text.stdout, /^comments:$/m)
  assert.match(text.stdout, /^history:$/m)
  assert.equal(text.stderr, '')
})

test('issues comment --reply-to and issues resolve write to Linear, and their dry runs write nothing', async () => {
  const { fake, fetch } = withIssues(['Talk'])
  const context = setup({ edit: withTeam })
  const root = JSON.parse((await cli(context, ['issues', 'comment', 'ACME-1', '--body-file', bodyFile('Question?'), '--json'], fetch)).stdout)
  const reply = JSON.parse((await cli(context, ['issues', 'comment', 'ACME-1', '--body-file', bodyFile('Answer.'), '--reply-to', root.id, '--json'], fetch)).stdout)
  assert.equal(reply.parent, root.id)
  assert.deepEqual(fake.mutations, ['PmkitCommentCreate', 'PmkitCommentCreate'])
  const dryComment = await cli(context, ['issues', 'comment', 'ACME-1', '--body-file', bodyFile('Draft'), '--dry-run', '--json'], fetch)
  assert.equal(dryComment.code, 0, dryComment.stderr)
  const dryResolve = await cli(context, ['issues', 'resolve', 'ACME-1', reply.id, '--dry-run'], fetch)
  assert.equal(dryResolve.code, 0, dryResolve.stderr)
  assert.match(dryResolve.stdout, new RegExp(`^resolved the thread ${root.id} on ACME-1`))
  assert.match(dryResolve.stdout, /dry run: nothing was written/)
  assert.equal(fake.mutations.length, 2)
  const done = await cli(context, ['issues', 'resolve', 'ACME-1', reply.id, '--json'], fetch)
  assert.equal(done.code, 0, done.stderr)
  assert.equal(JSON.parse(done.stdout).after.resolved.by, 'user-1')
  assert.deepEqual(fake.mutations.slice(2), ['PmkitCommentResolve'])
})

test('issues comment with --as another member exits 2 with INVALID_INPUT and writes nothing', async () => {
  const { fake, fetch } = withIssues(['Talk'])
  const result = await linear(fetch, ['issues', 'comment', 'ACME-1', '--body-file', bodyFile('x'), '--as', 'user-2', '--json'])
  assert.equal(result.code, 2)
  assert.equal(errorOf(result).code, 'INVALID_INPUT')
  assert.deepEqual(fake.mutations, [])
})

test('metrics cycle-time on Linear gives the days Local gives for the same moves', async () => {
  const { fake, fetch } = withIssues()
  fake.seed({ title: 'Flow', stateId: STATE.done.id }, { createdAt: '2026-10-01T00:00:00.000Z' })
  fake.history('ACME-1', { createdAt: '2026-10-02T00:00:00.000Z', fromState: STATE.backlog, toState: STATE.progress })
  fake.history('ACME-1', { createdAt: '2026-10-05T12:00:00.000Z', fromState: STATE.progress, toState: STATE.done })
  const result = await linear(fetch, ['metrics', 'cycle-time', '--since', '2026-10-01', '--until', '2026-10-31', '--json'])
  assert.equal(result.code, 0, result.stderr)
  const days = JSON.parse(result.stdout).issues.map((item) => item.days)

  const root = makeRepo('basic')
  let current = '2026-10-01T00:00:00Z'
  const local = createLocalTracker(root, { now: () => new Date(current) })
  const { id } = local.createIssue({ title: 'Flow' }, 'fred').after
  current = '2026-10-02T00:00:00Z'
  local.moveToCategory(id, 'in_progress', 'fred')
  current = '2026-10-05T12:00:00Z'
  local.moveToCategory(id, 'done', 'fred')
  const categoryOf = categoryLookup(local.discover().statuses)
  const expected = cycleTimes(doneInRange(groupEventsByIssue(local.metricEvents()), { categoryOf, since: '2026-10-01', until: '2026-10-31' }), { categoryOf }).map((item) => item.days)
  assert.deepEqual(expected, [3.5])
  assert.deepEqual(days, expected)
})

test('events lists the Linear events of every issue', async () => {
  const { fake, fetch } = withIssues(['A', 'B'])
  fake.comment('ACME-2', { body: 'Hi', createdAt: '2026-10-30T00:00:00.000Z' })
  const result = await linear(fetch, ['events', '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout).map((e) => [e.issue, e.op]), [['ACME-1', 'create'], ['ACME-2', 'create'], ['ACME-2', 'comment']])
  assert.equal(result.stderr, '')
})

test('a history, a comment list and a metrics read cut by the cap warn on stderr and leave the JSON alone', async () => {
  const { fake, fetch } = withIssues(['Busy'])
  for (let n = 0; n < 1001; n += 1) {
    const at = new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString()
    fake.history('ACME-1', { createdAt: at, updatedDescription: true })
    fake.comment('ACME-1', { body: `c${n}`, createdAt: at })
  }
  const history = await linear(fetch, ['issues', 'get', 'ACME-1', '--history', '--json'])
  assert.equal(history.stderr, 'warning: Linear has more history for ACME-1 than the 1000 entries pmkit read; the oldest are missing\n')
  assert.equal('truncated' in JSON.parse(history.stdout), false)
  const comments = await linear(fetch, ['issues', 'get', 'ACME-1', '--comments', '--json'])
  assert.equal(comments.stderr, 'warning: Linear has more comments for ACME-1 than the 1000 pmkit read\n')
  assert.equal(JSON.parse(comments.stdout).comments.length, 1000)
})

test('events and the metrics commands warn when Linear has more than 1000 issues', async () => {
  const { fake, fetch } = withIssues()
  for (let n = 0; n < 1001; n += 1) fake.seed({ title: `Issue ${n}` })
  const warning = 'warning: Linear has more issues than the 1000 pmkit read; the result covers the 1000 most recently updated\n'
  for (const args of [['events', '--json'], ['metrics', 'cycle-time', '--json'], ['metrics', 'lead-time', '--json'], ['metrics', 'throughput', '--json'], ['metrics', 'aging', '--json']]) {
    const result = await linear(fetch, args)
    assert.equal(result.code, 0, `${args.join(' ')}: ${result.stderr}`)
    assert.equal(result.stderr, warning, args.join(' '))
  }
})

// The cycle commands over a team with cycles on. The fake's clock is 2026-10-27, so cycle 2 is active and cycle 3 is next.
const CYCLE_TEAM = { ...ACME_TEAM, cyclesEnabled: true }
const CYCLES = [
  { number: 1, startsAt: '2026-10-05T00:00:00.000Z', endsAt: '2026-10-19T00:00:00.000Z', completedAt: '2026-10-19T00:00:00.000Z' },
  { number: 2, name: 'Autumn', startsAt: '2026-10-19T00:00:00.000Z', endsAt: '2026-11-02T00:00:00.000Z' },
  { number: 3, startsAt: '2026-11-02T00:00:00.000Z', endsAt: '2026-11-13T00:00:00.000Z' },
]

function withCycles(titles = []) {
  const teams = [CYCLE_TEAM]
  const fake = fakeLinearIssues({ teams, cycles: CYCLES })
  for (const title of titles) fake.seed({ title })
  return { fake, fetch: fakeLinearFetch({ ...fakeWorkspace({ teams }), ...fake.routes }) }
}

const cycleCli = (context, args, fetch) => cli(context, [...args, '--json'], fetch)

test('cycle list, current and issues read Linear cycles as sprints', async () => {
  const { fake, fetch } = withCycles(['In two', 'Free'])
  fake.records[0].cycleId = fake.cycles.list()[1].id
  const context = setup({ edit: withTeam })
  const list = await cycleCli(context, ['cycle', 'list'], fetch)
  assert.equal(list.code, 0, list.stderr)
  assert.deepEqual(JSON.parse(list.stdout).map((sprint) => [sprint.id, sprint.state, sprint.start, sprint.end]), [
    ['1', 'closed', '2026-10-05', '2026-10-18'], ['2', 'active', '2026-10-19', '2026-11-01'], ['3', 'planned', '2026-11-02', '2026-11-12'],
  ])
  const planned = await cycleCli(context, ['cycle', 'list', '--state', 'planned'], fetch)
  assert.deepEqual(JSON.parse(planned.stdout).map((sprint) => sprint.id), ['3'])
  const current = await cycleCli(context, ['cycle', 'current'], fetch)
  assert.equal(JSON.parse(current.stdout).name, 'Autumn')
  const issues = await cycleCli(context, ['cycle', 'issues', '2'], fetch)
  assert.deepEqual(JSON.parse(issues.stdout).map((issue) => issue.id), ['ACME-1'])
  const text = await cli(context, ['cycle', 'list'], fetch)
  assert.match(text.stdout, /^2 +\| active +\| 2026-10-19 \| 2026-11-01 \| Autumn$/m)
})

test('cycle issues of an unknown cycle exits 2 with NOT_FOUND', async () => {
  const result = await cycleCli(setup({ edit: withTeam }), ['cycle', 'issues', '99'], withCycles().fetch)
  assert.equal(result.code, 2)
  assert.deepEqual(errorOf(result), { code: 'NOT_FOUND', message: 'sprint 99 does not exist', nextStep: 'pmkit cycle list' })
})

test('cycle add moves an issue to current and out with none, one mutation each', async () => {
  const { fake, fetch } = withCycles(['Move me'])
  const context = setup({ edit: withTeam })
  const into = await cycleCli(context, ['cycle', 'add', 'ACME-1', '--to', 'current'], fetch)
  assert.equal(into.code, 0, into.stdout + into.stderr)
  assert.equal(JSON.parse(into.stdout)[0].after.sprint, '2')
  assert.deepEqual(fake.mutations, ['PmkitIssueUpdate'])
  const out = await cycleCli(context, ['cycle', 'add', 'ACME-1', '--to', 'none'], fetch)
  assert.equal(out.code, 0, out.stdout + out.stderr)
  assert.equal('sprint' in JSON.parse(out.stdout)[0].after, false)
  assert.deepEqual(fake.mutations, ['PmkitIssueUpdate', 'PmkitIssueUpdate'])
})

test('cycle add --dry-run sends no mutation', async () => {
  const { fake, fetch } = withCycles(['Move me'])
  const result = await cycleCli(setup({ edit: withTeam }), ['cycle', 'add', 'ACME-1', '--to', '3', '--dry-run'], fetch)
  assert.equal(result.code, 0, result.stdout + result.stderr)
  assert.deepEqual(fake.mutations, [])
})

test('issues list --sprint current lists the active cycle', async () => {
  const { fake, fetch } = withCycles(['In two', 'Free'])
  fake.records[0].cycleId = fake.cycles.list()[1].id
  const result = await cli(setup({ edit: withTeam }), ['issues', 'list', '--sprint', 'current', '--json'], fetch)
  assert.equal(result.code, 0, result.stdout + result.stderr)
  assert.deepEqual(JSON.parse(result.stdout).issues.map((issue) => issue.id), ['ACME-1'])
})

test('cycle capacity --set and --days-off write .pmkit/capacity.yaml and read back, with no mutation to Linear', async () => {
  const { fake, fetch } = withCycles()
  const context = setup({ edit: withTeam })
  const set = await cycleCli(context, ['cycle', 'capacity', '2', '--set', 'user-1=8'], fetch)
  assert.equal(set.code, 0, set.stdout + set.stderr)
  assert.deepEqual(JSON.parse(set.stdout).after.capacity, { 'user-1': 8 })
  const off = await cycleCli(context, ['cycle', 'capacity', '2', '--days-off', 'user-1=2026-10-21'], fetch)
  assert.equal(off.code, 0, off.stdout + off.stderr)
  const read = await cycleCli(context, ['cycle', 'capacity', '2'], fetch)
  assert.deepEqual(JSON.parse(read.stdout), { capacity: { 'user-1': 8 }, days_off: { 'user-1': ['2026-10-21'] } })
  const file = fs.readFileSync(path.join(context.root, '.pmkit', 'capacity.yaml'), 'utf8')
  assert.match(file, /^version: 1$/m)
  assert.ok(!file.includes(FAKE_KEY))
  assert.deepEqual(fake.mutations, [])
})

test('cycle open and cycle close exit 2 with NOT_SUPPORTED, the reason and the next step', async () => {
  const { fake, fetch } = withCycles()
  const context = setup({ edit: withTeam })
  const open = await cycleCli(context, ['cycle', 'open', '--start', '2026-11-16'], fetch)
  assert.equal(open.code, 2)
  assert.deepEqual(errorOf(open), {
    code: 'NOT_SUPPORTED',
    message: "Linear creates cycles from the team's schedule, so pmkit cannot open one",
    nextStep: "Set the schedule in the team's cycle settings in Linear (duration, start day, upcoming cycles)",
  })
  const close = await cycleCli(context, ['cycle', 'close', '2'], fetch)
  assert.equal(close.code, 2)
  assert.equal(errorOf(close).code, 'NOT_SUPPORTED')
  assert.match(errorOf(close).message, /Linear ends a cycle on its end date/)
  assert.deepEqual(fake.mutations, [])
  const text = await cli(context, ['cycle', 'close', '2'], fetch)
  assert.match(text.stderr, /Linear ends a cycle on its end date/)
  assert.match(text.stderr, /Move the unfinished issues/)
})

test('capabilities --json says open and close are unavailable on a team with cycles', async () => {
  const result = await cli(setup({ edit: withTeam }), ['capabilities', '--json'], withCycles().fetch)
  assert.equal(result.code, 0, result.stderr)
  const cycles = JSON.parse(result.stdout).capabilities.find((entry) => entry.id === 'cycles')
  assert.deepEqual(cycles.detail, { open: false, close: false, schedule: 'team' })
})

test('a cycle move shows in the history with the sprint ids cycle list gives', async () => {
  const { fake, fetch } = withCycles(['Move me'])
  // Cycle 7 is the fourth cycle the fake stores, so its node id does not end in its number.
  fake.cycles.add({ number: 7, startsAt: '2026-11-16T00:00:00.000Z', endsAt: '2026-11-30T00:00:00.000Z' })
  const context = setup({ edit: withTeam })
  for (const to of ['3', '7']) {
    const moved = await cycleCli(context, ['cycle', 'add', 'ACME-1', '--to', to], fetch)
    assert.equal(moved.code, 0, moved.stdout + moved.stderr)
  }
  const ids = JSON.parse((await cycleCli(context, ['cycle', 'list'], fetch)).stdout).map((sprint) => sprint.id)
  assert.deepEqual(ids, ['1', '2', '3', '7'])
  const got = await cycleCli(context, ['issues', 'get', 'ACME-1', '--history'], fetch)
  assert.equal(got.code, 0, got.stderr)
  const moves = JSON.parse(got.stdout).history.filter((event) => event.field === 'sprint').map((event) => [event.from, event.to])
  assert.deepEqual(moves, [[null, '3'], ['3', '7']])
})

test('metrics velocity on Linear counts the issues done in each closed cycle before it completed', async () => {
  // The team has estimates off, so velocity counts issues.
  const { fake, fetch } = withCycles()
  const [one, two] = fake.cycles.list()
  const created = { createdAt: '2026-10-06T00:00:00.000Z' }
  fake.seed({ title: 'In time', stateId: STATE.done.id, cycleId: one.id }, created)
  fake.history('ACME-1', { createdAt: '2026-10-10T00:00:00.000Z', fromState: STATE.backlog, toState: STATE.done })
  fake.seed({ title: 'Too late', stateId: STATE.done.id, cycleId: one.id }, created)
  fake.history('ACME-2', { createdAt: '2026-10-20T00:00:00.000Z', fromState: STATE.backlog, toState: STATE.done })
  fake.seed({ title: 'Still open', stateId: STATE.done.id, cycleId: two.id }, created)
  fake.history('ACME-3', { createdAt: '2026-10-21T00:00:00.000Z', fromState: STATE.backlog, toState: STATE.done })
  const result = await cli(setup({ edit: withTeam }), ['metrics', 'velocity', '--json'], fetch)
  assert.equal(result.code, 0, result.stdout + result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { perSprint: [{ id: '1', points: 0, count: 1 }], average: 1, unit: 'issues' })
  assert.deepEqual(fake.mutations, [])
})

const PROJECT_ID = '00000000-0000-4000-8000-0000000000a1'
const MILESTONE = '11111111-1111-4111-8111-111111111111'

// A project P-ACM-1 with health on_track, progress 0.5 (one of two issues done), one milestone and one document.
function withProjects() {
  const issues = fakeLinearIssues()
  const projects = fakeLinearProjects({ issues })
  const project = projects.seed({ id: PROJECT_ID, name: 'Launch', teamIds: ['team-acme'], startDate: '2026-11-01' })
  issues.seed({ title: 'Done one', projectId: project.id, stateId: 'state-8' })
  issues.seed({ title: 'Open one', projectId: project.id })
  projects.seedUpdate(PROJECT_ID, { id: 'update-1', body: 'All good', health: 'onTrack', createdAt: '2026-10-27T10:00:00.000Z' })
  projects.seedMilestone(PROJECT_ID, { id: MILESTONE, name: 'Alpha', targetDate: '2026-11-15', status: 'next' })
  projects.seedDocument(PROJECT_ID, { slugId: 'abcdef012345', title: 'Plan', content: '# Plan' })
  return { issues, projects, fetch: fakeLinearFetch({ ...fakeWorkspace(), ...issues.routes, ...projects.routes }) }
}

test('epic list holds health and progress in the JSON and in two columns', async () => {
  const { fetch } = withProjects()
  const json = await cli(setup({ edit: withTeam }), ['epic', 'list', '--json'], fetch)
  assert.equal(json.code, 0, json.stdout + json.stderr)
  const [epic] = JSON.parse(json.stdout)
  assert.equal(epic.id, 'P-ACM-1')
  assert.equal(epic.health, 'on_track')
  assert.equal(epic.progress, 0.5)
  const text = await cli(setup({ edit: withTeam }), ['epic', 'list'], fetch)
  assert.match(text.stdout, /^ID\s+\| Title\s+\| Status\s+\| Start\s+\| Target\s+\| Health\s+\| Progress$/m)
  assert.match(text.stdout, /P-ACM-1\s+\| Launch\s+\| Backlog\s+\| 2026-11-01\s+\|\s+\| on_track\s+\| 50%$/m)
})

test('epic get prints health, progress, the milestones and the documents', async () => {
  const result = await cli(setup({ edit: withTeam }), ['epic', 'get', 'p-acm-1'], withProjects().fetch)
  assert.equal(result.code, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /^id: P-ACM-1$/m)
  assert.match(result.stdout, /^health: on_track$/m)
  assert.match(result.stdout, /^progress: 50%$/m)
  assert.match(result.stdout, new RegExp(`^milestones:\\n {2}${MILESTONE} {2}Alpha {2}due 2026-11-15 {2}next$`, 'm'))
  assert.match(result.stdout, /^documents:\n {2}abcdef012345 {2}Plan$/m)
})

test('epic create, progress, update-status and updates run over the fake', async () => {
  const { fetch } = withProjects()
  const context = setup({ edit: withTeam })
  const created = await cli(context, ['epic', 'create', '--title', 'Second', '--as', 'user-1', '--json'], fetch)
  assert.equal(created.code, 0, created.stdout + created.stderr)
  assert.equal(JSON.parse(created.stdout).after.id, 'P-ACM-2')
  const progress = await cli(context, ['epic', 'progress', 'P-ACM-1'], fetch)
  assert.equal(progress.code, 0, progress.stdout + progress.stderr)
  assert.match(progress.stdout, /^total: 2$/m)
  assert.match(progress.stdout, /^done: 1$/m)
  const body = path.join(tempDir(), 'body.md')
  fs.writeFileSync(body, 'Slipping a week')
  const published = await cli(context, ['epic', 'update-status', 'P-ACM-1', '--health', 'at_risk', '--body-file', body, '--as', 'user-1'], fetch)
  assert.equal(published.code, 0, published.stdout + published.stderr)
  assert.match(published.stdout, /^health: at_risk$/m)
  const updates = await cli(context, ['epic', 'updates', 'P-ACM-1'], fetch)
  assert.equal(updates.code, 0, updates.stdout + updates.stderr)
  assert.ok(updates.stdout.indexOf('Slipping a week') < updates.stdout.indexOf('All good'))
  const again = await cli(context, ['epic', 'get', 'P-ACM-1', '--json'], fetch)
  assert.equal(JSON.parse(again.stdout).health, 'at_risk')
})

test('a milestone, a document and a milestone of an issue are readable', async () => {
  const { fetch } = withProjects()
  const context = setup({ edit: withTeam })
  const list = await cli(context, ['milestone', 'list', '--json'], fetch)
  assert.equal(list.code, 0, list.stdout + list.stderr)
  assert.equal(JSON.parse(list.stdout)[0].id, MILESTONE)
  const docs = await cli(context, ['docs', 'read', 'abcdef012345'], fetch)
  assert.equal(docs.code, 0, docs.stdout + docs.stderr)
  assert.equal(docs.stdout.trim(), '# Plan')
})

test('a Local epic prints no health, progress, milestones or documents line', () => {
  const text = epicRecord({ id: 'EPC-1', title: 'Local', status: { name: 'Planned', category: 'todo' }, start: '2026-11-01', description: 'Body' })
  assert.equal(text, 'id: EPC-1\ntitle: Local\nstatus: Planned (todo)\nstart: 2026-11-01\n\nBody')
})
