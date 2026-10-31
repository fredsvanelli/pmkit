// PMK-40: the commands whose capability a Linear workspace lacks refuse offline with NOT_SUPPORTED, and every command that a capability names is accounted for. The per-command note tests are in cli-degraded.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { SERVED_BY } from './lib/capabilities.mjs'
import { linearDescriptor } from './lib/linear/adapter.mjs'
import { isMutation } from './lib/linear/client.mjs'
import { fakeGh } from './fake-gh.mjs'
import { useLinear } from './fake-hosted.mjs'
import { ACME_TEAM, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeWorkspace } from './fake-linear-api.mjs'
import { childEnv } from './golden-helpers.mjs'
import { makeRepo, tempDir, userStoreEnv } from './test-helpers.mjs'

process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir())

function freeWorkspace() {
  const root = useLinear(makeRepo('basic'))
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('    workspace: acme', '    workspace: acme\n    team: ACME'))
  const env = { ...childEnv(), ...userStoreEnv().env, LINEAR_API_KEY: FAKE_KEY }
  const fake = fakeLinearIssues()
  const fetch = fakeLinearFetch({ ...fakeWorkspace(), ...fake.routes })
  return { fetch, run: (args) => run(args, { cwd: root, env, adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch }) } }) }
}

const BODY = path.join(tempDir('pmkit-degraded-'), 'body.md')
fs.writeFileSync(BODY, 'text\n')

// A write the Free plan cannot do refuses with NOT_SUPPORTED and sends no mutation.
const REFUSALS = [
  ['cycle', 'open', '--start', '2026-11-02'],
  ['cycle', 'close', '1'],
  ['milestone', 'create', 'm1'],
  ['docs', 'create', 'a.md', '--body-file', BODY],
  ['release', 'create', '1.0'],
  ['release', 'mark-released', '1.0'],
  ['issues', 'log-time', 'ACME-1', '5'],
  ['issues', 'time-entries', 'ACME-1'],
  ['issues', 'delegate', 'ACME-1', 'agent:claude'],
  ['views', 'list'],
  ['views', 'save', 'v', '--category', 'done'],
  ['views', 'run', 'v'],
  ['goal', 'list'],
  ['goal', 'get', 'GOAL-1'],
  ['goal', 'create', '--title', 'G'],
  ['goal', 'progress', 'GOAL-1'],
  ['epic', 'goal', 'P-ACM-1', 'GOAL-1'],
  ['epic', 'create', '--title', 'E', '--goal', 'GOAL-1'],
  ['customers', 'list'],
  ['customers', 'show', 'CUS-1'],
  ['customers', 'create', '--name', 'Acme'],
  ['requests', 'list'],
  ['requests', 'get', 'REQ-1'],
  ['requests', 'create', '--title', 'R'],
  ['requests', 'accept', 'REQ-1', 'ACME-1'],
  ['requests', 'decline', 'REQ-1'],
  ['demand', 'list'],
]

for (const args of REFUSALS) {
  test(`${args.slice(0, 2).join(' ')} refuses on a Free Linear workspace and sends no mutation`, async () => {
    const world = freeWorkspace()
    const result = await world.run([...args, '--json'])
    assert.equal(result.code, 2, result.stdout + result.stderr)
    assert.equal(JSON.parse(result.stdout).error.code, 'NOT_SUPPORTED', result.stdout)
    assert.ok(!world.fetch.calls.some((call) => isMutation(call.body.query)))
  })
}

// Each command a capability names is covered by a path test elsewhere, or exempt with a reason. A new command in SERVED_BY fails here until it is listed.
const COVERED = {
  'cycle list': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'cycle current': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'cycle issues': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'cycle open': 'REFUSALS', 'cycle close': 'REFUSALS',
  'cycle add': 'native write, PMK-39', 'cycle capacity': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'release-notes': 'cli-linear.test.mjs or cli-degraded.test.mjs',
  'issues create': 'native write, PMK-39', 'issues update': 'native write, PMK-39', 'issues parent': 'native write, PMK-39', 'issues link': 'native write, PMK-39',
  'issues dependencies': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'issues move': 'native write, PMK-39', 'issues branch': 'PATH_CASES', 'issues log-time': 'REFUSALS', 'issues time-entries': 'REFUSALS',
  'epic list': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'epic get': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'epic create': 'native write, PMK-39', 'epic progress': 'cli-linear.test.mjs or cli-degraded.test.mjs',
  'epic update-status': 'native write, PMK-39', 'epic updates': 'cli-linear.test.mjs or cli-degraded.test.mjs',
  'release list': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'release get': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'release issues': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'release create': 'REFUSALS', 'release mark-released': 'REFUSALS',
  'metrics velocity': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'metrics cycle-time': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'metrics lead-time': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'metrics throughput': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'metrics aging': 'cli-linear.test.mjs or cli-degraded.test.mjs', events: 'cli-linear.test.mjs or cli-degraded.test.mjs',
  'docs list': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'docs read': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'docs create': 'REFUSALS',
  'pr open': 'PATH_CASES', 'pr ready': 'PATH_CASES', 'pr status': 'PATH_CASES', 'pr sync': 'PATH_CASES', 'deploys list': 'PATH_CASES', 'ci logs': 'PATH_CASES', 'pr diff': 'PATH_CASES', 'pr blockers': 'PATH_CASES',
  'views list': 'REFUSALS', 'views save': 'REFUSALS', 'views run': 'REFUSALS',
  'goal list': 'REFUSALS', 'goal get': 'REFUSALS', 'goal create': 'REFUSALS', 'goal progress': 'REFUSALS', 'epic goal': 'REFUSALS',
  'customers list': 'REFUSALS', 'customers show': 'REFUSALS', 'customers create': 'REFUSALS', 'demand list': 'REFUSALS',
  'requests list': 'REFUSALS', 'requests get': 'REFUSALS', 'requests create': 'REFUSALS', 'requests accept': 'REFUSALS', 'requests decline': 'REFUSALS',
  'alerts list': 'REPO_SCAN',
  'issues delegate': 'REFUSALS',
}

test('every command a capability names has a degraded-path case or an exemption', () => {
  const named = [...new Set(Object.values(SERVED_BY).flat())]
  assert.deepEqual(named.filter((command) => !(command in COVERED)), [])
})

// The argv literal of a command as a test writes it: 'pr status' is ['pr', 'status'.
const argvLiteral = (command) => `[${command.split(' ').map((word) => `'${word}'`).join(', ')}`
const FILES = 'cli-linear.test.mjs or cli-degraded.test.mjs'
const EXEMPT = 'native write, PMK-39'

test('every COVERED place names a case that exists', () => {
  const refusals = new Set(REFUSALS.map((args) => args.slice(0, 2).join(' ')))
  const pathCases = new Set(PATH_CASES.map(({ argv }) => argv.slice(0, 2).join(' ')))
  const sources = FILES.split(' or ').map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8'))
  for (const [command, where] of Object.entries(COVERED)) {
    if (where === 'REFUSALS') assert.ok(refusals.has(command), `${command} is listed under REFUSALS but REFUSALS lacks it`)
    else if (where === 'PATH_CASES') assert.ok(pathCases.has(command), `${command} is listed under PATH_CASES but PATH_CASES lacks it`)
    else if (where === 'REPO_SCAN') assert.ok(fs.readFileSync(new URL('cli-alerts.test.mjs', import.meta.url), 'utf8').includes(argvLiteral(command)), `${command} is listed under REPO_SCAN but cli-alerts.test.mjs does not run it`)
    else if (where === FILES) assert.ok(sources.some((source) => source.includes(argvLiteral(command))), `${command} is listed under ${FILES} but neither file runs it`)
    else assert.equal(where, EXEMPT, `${command} has an unknown COVERED place`)
  }
})

// A forged manifest: the tracker reports the entry we choose for one capability, and the command must print its note or refuse.
// With `github`, the repository is a git repository on GitHub, a fake gh answers that branch x has no pull request, and ACME-1 exists.
function forged(id, entry, { github = false, gh: extra = {}, failManifest = false } = {}) {
  const root = useLinear(makeRepo('basic'))
  const file = path.join(root, '.pmkit', 'config.yaml')
  let config = fs.readFileSync(file, 'utf8').replace('    workspace: acme', '    workspace: acme\n    team: ACME')
  if (github) config = config.replace('  system: none', '  system: github\n  default_branch: main')
  fs.writeFileSync(file, config)
  const gh = github ? fakeGh({ [`pr view x --json ${PR_VIEW}`]: { status: 1, stderr: 'no pull requests found for branch "x"\n' }, ...extra }) : null
  const env = { ...childEnv(), ...userStoreEnv().env, LINEAR_API_KEY: FAKE_KEY, ...(gh ? { PATH: `${gh.dir}${path.delimiter}${process.env.PATH}`, PMKIT_FAKE_GH: gh.responses } : {}) }
  if (github) {
    for (const args of [['init', '-q', '-b', 'main'], ['-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init']]) {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env })
      assert.equal(result.status, 0, result.stderr)
    }
  }
  const cycles = [{ number: 1, startsAt: '2026-10-05T00:00:00.000Z', endsAt: '2026-10-19T00:00:00.000Z', completedAt: '2026-10-19T00:00:00.000Z' }]
  const teams = [{ ...ACME_TEAM, cyclesEnabled: true }]
  const fake = fakeLinearIssues({ teams, cycles })
  if (github) fake.seed({ title: 'Fix it' })
  const fetch = fakeLinearFetch({ ...fakeWorkspace({ teams }), ...fake.routes })
  const base = linearDescriptor({ fetch })
  const linear = {
    ...base,
    create: async (...args) => {
      const tracker = await base.create(...args)
      return { ...tracker, capabilities: async () => {
        if (failManifest) throw new Error('capabilities are not reachable')
        const manifest = await tracker.capabilities()
        return { ...manifest, capabilities: manifest.capabilities.map((c) => (c.id === id ? { ...c, ...entry } : c)) }
      } }
    },
  }
  return { fetch, run: (args) => run(args, { cwd: root, env, adapters: { ...ADAPTERS, linear } }) }
}

const PR_VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'
const noteLines = (stderr) => stderr.split('\n').filter((line) => line.startsWith('note: '))
const ABSENT = { path: 'absent', enableHint: 'Use the Business plan' }
const ISSUE_BRANCH = 'acme-1-fix-it'
const CONDITIONAL = { path: 'conditional', detail: { teams: ['OPS'] } }

// For each capability that has a note on a command, one forged entry per path. The expected line is the phrase of that path.
const PATH_CASES = [
  { id: 'native_metrics', argv: ['metrics', 'aging'], cases: [
    [{ path: 'derived', detail: { source: 'history' } }, 'note: aging computed from Linear issue history'],
    [{ path: 'derived', detail: { source: 'events' } }, 'note: aging computed from .issues/events.jsonl'],
    [CONDITIONAL, 'note: native_metrics is on for teams OPS only'],
    [ABSENT, 'note: native_metrics is absent: Use the Business plan'],
  ] },
  { id: 'capacity', argv: ['cycle', 'capacity', '1'], cases: [
    [{ path: 'derived', detail: { source: 'local' } }, 'note: capacity read from .pmkit/capacity.yaml; Linear has no capacity field'],
    [CONDITIONAL, 'note: capacity is on for teams OPS only'],
    [ABSENT, 'note: capacity is absent: Use the Business plan'],
  ] },
  { id: 'releases', argv: ['release', 'list'], cases: [
    [CONDITIONAL, 'note: releases is on for teams OPS only'],
    [ABSENT, 'note: releases is absent: Use the Business plan'],
  ] },
  ...[
    { argv: ['issues', 'branch', 'ACME-1'] },
    { argv: ['pr', 'status', '--branch', 'x'] },
    { argv: ['pr', 'open', '--issue', 'ACME-1', '--dry-run'], gh: { [`pr view ${ISSUE_BRANCH} --json ${PR_VIEW}`]: { status: 1, stderr: `no pull requests found for branch "${ISSUE_BRANCH}"\n` } } },
    { argv: ['pr', 'ready', '--issue', 'ACME-1', '--dry-run'], gh: { [`pr view ${ISSUE_BRANCH} --json ${PR_VIEW}`]: { stdout: JSON.stringify({ number: 7, url: 'https://github.com/o/r/pull/7', title: 'Fix it', state: 'OPEN', isDraft: true, headRefName: ISSUE_BRANCH, author: { login: 'a' }, mergedAt: null }) } } },
    { argv: ['pr', 'diff', '--branch', 'x'], gh: { [`pr view x --json ${PR_VIEW}`]: { stdout: JSON.stringify({ number: 7, url: 'https://github.com/o/r/pull/7', title: 'Fix it', state: 'OPEN', isDraft: false, headRefName: 'x', author: { login: 'a' }, mergedAt: null }) }, 'pr diff 7 --color never': { stdout: 'diff\n' } } },
    { argv: ['pr', 'blockers', '--branch', 'x'], gh: { [`pr view x --json ${PR_VIEW}`]: { status: 1, stderr: 'no pull requests found for branch "x"\n' } } },
    { argv: ['pr', 'sync'] },
    { argv: ['deploys', 'list'], gh: { 'api repos/{owner}/{repo}/deployments?per_page=20': { stdout: '[]' } } },
    { argv: ['ci', 'logs', '--run', '9'], gh: { 'run view 9 --log-failed': { stdout: 'failed\n' } } },
    { argv: ['ci', 'logs', '--branch', 'x'], gh: { 'run list --branch x --limit 50 --json databaseId,workflowName,status,conclusion,url,createdAt,headSha': { stdout: '[]' } } },
  ].map(({ argv, gh }) => ({ id: 'linked_code', argv, github: true, gh, cases: [
    [{ path: 'derived', detail: { source: 'git' } }, 'note: branch and PR state read from git, not from the tracker'],
    [CONDITIONAL, 'note: linked_code is on for teams OPS only'],
    [ABSENT, 'note: linked_code is absent: Use the Business plan'],
  ] })),
]

for (const { id, argv, github, gh, cases } of PATH_CASES) {
  for (const [entry, line] of cases) {
    test(`${argv.join(' ')} with ${id} ${entry.path}${entry.detail?.source ? ` (${entry.detail.source})` : ''} prints one note line`, async () => {
      const result = await forged(id, entry, { github, gh }).run(argv)
      assert.equal(result.code, 0, result.stderr)
      assert.deepEqual(noteLines(result.stderr), [line])
    })
  }
}

for (const argv of [['pr', 'status', '--branch', 'x'], ['pr', 'sync']]) {
  test(`${argv.slice(0, 2).join(' ')} still works and prints no note when the tracker cannot report its capabilities`, async () => {
    const result = await forged('linked_code', {}, { github: true, failManifest: true }).run(argv)
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(noteLines(result.stderr), [])
  })
}

test('issues create --estimate 3 refuses on a team with estimates off and sends no mutation', async () => {
  const world = freeWorkspace()
  const result = await world.run(['issues', 'create', '--title', 't', '--estimate', '3', '--json'])
  assert.notEqual(result.code, 0, result.stdout)
  assert.match(result.stdout, /estimates off/)
  assert.ok(['NOT_SUPPORTED', 'INVALID_INPUT'].includes(JSON.parse(result.stdout).error.code), result.stdout)
  assert.ok(!world.fetch.calls.some((call) => isMutation(call.body.query)))
})

test('init --tracker linear refuses to switch a repository filed for Local', async () => {
  const root = makeRepo('basic')
  const result = await run(['init', '--update', '--tracker', 'linear', '--json'], { cwd: root, env: { ...childEnv(), ...userStoreEnv().env } })
  assert.equal(result.code, 2, result.stdout + result.stderr)
  assert.equal(JSON.parse(result.stdout).error.code, 'NOT_SUPPORTED', result.stdout)
})

for (const args of [['migrate', '--dry-run'], ['reindex'], ['render', 'board']]) {
  test(`${args[0]} refuses on Linear because it works only with the Local tracker`, async () => {
    const world = freeWorkspace()
    const result = await world.run([...args, '--json'])
    assert.equal(result.code, 2, result.stdout + result.stderr)
    assert.equal(JSON.parse(result.stdout).error.code, 'NOT_SUPPORTED', result.stdout)
    assert.match(JSON.parse(result.stdout).error.message, /works only with the Local tracker/)
  })
}
