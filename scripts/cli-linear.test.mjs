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
import { ACME_TEAM, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeTriage, fakeWorkspace } from './fake-linear-api.mjs'
import { childEnv } from './golden-helpers.mjs'
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

// A fetch over the default workspace and a stateful issue store, with `titles` seeded as ACME-1, ACME-2 and so on.
function withIssues(titles = []) {
  const fake = fakeLinearIssues()
  for (const title of titles) fake.seed({ title })
  return { fake, fetch: fakeLinearFetch({ ...fakeWorkspace(), ...fake.routes }) }
}

test('issues dependencies sends a non-issue id to getDeliverable', async () => {
  const result = await cli(setup({ edit: withTeam }), ['issues', 'dependencies', 'EPC-1x', '--json'], withIssues().fetch)
  assert.equal(result.code, 2)
  assert.equal(errorOf(result).code, 'NOT_SUPPORTED')
  assert.match(errorOf(result).message, /getDeliverable/)
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
