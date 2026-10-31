// pmkit link-repo: the git host from the remote, the Linear team from the workspace, and a config file that keeps its lines.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { linearDescriptor } from './lib/linear/adapter.mjs'
import { FAKE_KEY, fakeLinearFetch, fakeWorkspace } from './fake-linear-api.mjs'
import { childEnv } from './golden-helpers.mjs'
import { hashTree, makeRepo, tempDir, userStoreEnv } from './test-helpers.mjs'

const CONFIG = `# yaml-language-server: $schema=https://raw.githubusercontent.com/fredsvanelli/pmkit/main/schemas/pmkit.config.schema.json
version: 1 # format
tracker:
  system: local
  path: .issues
git_host:
  system: none # no host yet
write_policy:
  confirm: single_writes
  preview: [bulk, delete, publish_update, move_scope]
`
const GITHUB_CONFIG = CONFIG.replace('  system: none # no host yet\n', '  system: github\n  repo: old/repo\n  default_branch: main\n')

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: childEnv() })
const file = (root) => path.join(root, '.pmkit', 'config.yaml')
const read = (root) => fs.readFileSync(file(root), 'utf8')
const dataOf = (result) => {
  assert.equal(result.code, 0, result.stderr + result.stdout)
  return JSON.parse(result.stdout)
}
const errorOf = (result) => {
  assert.equal(result.code, 2, result.stdout)
  return JSON.parse(result.stdout).error
}

// A copy of the basic fixture as a git repository with the given remotes and config text.
function local({ remotes = {}, config = CONFIG, repo = true } = {}) {
  const root = makeRepo('basic')
  if (repo) {
    git(root, 'init', '-q')
    for (const [name, url] of Object.entries(remotes)) git(root, 'remote', 'add', name, url)
  }
  fs.writeFileSync(file(root), config)
  return root
}

const link = (root, args = [], { adapters = ADAPTERS, env = childEnv() } = {}) => run(['link-repo', ...args, '--json'], { cwd: root, env, adapters })

test('an https origin gives github and owner/name, and the write keeps comments and key order', async () => {
  const root = local({ remotes: { origin: 'https://github.com/acme/app.git' } })
  const data = dataOf(await link(root))
  assert.equal(data.dryRun, false)
  assert.deepEqual(data.gitHost, { before: 'none', after: 'github', source: 'remote' })
  assert.deepEqual(data.repo, { before: null, after: 'acme/app', source: 'remote' })
  assert.equal(data.remote.name, 'origin')
  assert.equal(data.files[0].action, 'change')
  assert.equal(read(root), CONFIG.replace('  system: none # no host yet\n', '  system: github # no host yet\n  repo: acme/app\n'))
})

test('every URL form of a GitHub origin gives the same repo', async () => {
  for (const url of ['git@github.com:acme/app.git', 'ssh://git@github.com:22/acme/app.git', 'https://github.com/acme/app', 'https://user@github.com/acme/app.git/', 'git://github.com/acme/app.git']) {
    const data = dataOf(await link(local({ remotes: { origin: url } }), ['--dry-run']))
    assert.deepEqual([data.gitHost.after, data.repo.after], ['github', 'acme/app'], url)
  }
})

test('--dry-run shows the change and writes nothing', async () => {
  const root = local({ remotes: { origin: 'git@github.com:acme/app.git' } })
  const before = hashTree(root)
  const result = await link(root, ['--dry-run'])
  const data = dataOf(result)
  assert.equal(data.dryRun, true)
  assert.equal(data.files[0].action, 'change')
  assert.match(data.files[0].diff, /\+ {2}repo: acme\/app/)
  assert.deepEqual(hashTree(root), before)
  const plain = await run(['link-repo', '--dry-run'], { cwd: root, env: childEnv() })
  assert.match(plain.stdout, /git host: none -> github \(from remote origin\)/)
  assert.match(plain.stdout, /dry run: nothing was written/)
})

test('a remote that is not GitHub gives none, drops git_host.repo and says why', async () => {
  const root = local({ remotes: { origin: 'https://gitlab.com/acme/app.git' }, config: GITHUB_CONFIG })
  const data = dataOf(await link(root))
  assert.deepEqual(data.gitHost, { before: 'github', after: 'none', source: 'remote' })
  assert.deepEqual(data.repo, { before: 'old/repo', after: null, source: 'remote' })
  assert.ok(data.notes.some((note) => /gitlab\.com/.test(note) && /only GitHub/.test(note)), data.notes.join('\n'))
  assert.equal(read(root), CONFIG.replace('  system: none # no host yet\n', '  system: none\n  default_branch: main\n'))
})

test('without a remote nothing is inferred and the file stays as it was', async () => {
  const root = local({ config: GITHUB_CONFIG })
  const data = dataOf(await link(root))
  assert.equal(data.files[0].action, 'keep')
  assert.equal(data.gitHost.source, 'file')
  assert.deepEqual(data.remotes, [])
  assert.ok(data.notes.some((note) => /no git remote/.test(note)), data.notes.join('\n'))
  assert.equal(read(root), GITHUB_CONFIG)
})

test('outside a git repository the remote state is unknown and the file stays as it was', async () => {
  const root = local({ config: GITHUB_CONFIG, repo: false })
  const data = dataOf(await link(root))
  assert.equal(data.files[0].action, 'keep')
  assert.equal(data.remote, null)
  assert.ok(data.notes.some((note) => /could not read the git remotes/.test(note)), data.notes.join('\n'))
  assert.equal(read(root), GITHUB_CONFIG)
})

test('an unreadable remote URL infers nothing', async () => {
  const root = local({ remotes: { origin: '/srv/git/app.git' }, config: GITHUB_CONFIG })
  const data = dataOf(await link(root))
  assert.equal(data.files[0].action, 'keep')
  assert.ok(data.notes.some((note) => /not recognized/.test(note)), data.notes.join('\n'))
})

test('origin wins over other remotes, and the others are named', async () => {
  const root = local({ remotes: { upstream: 'https://gitlab.com/x/y.git', origin: 'git@github.com:acme/app.git' } })
  const data = dataOf(await link(root, ['--dry-run']))
  assert.equal(data.remote.name, 'origin')
  assert.deepEqual(data.remotes.map((remote) => remote.name).sort(), ['origin', 'upstream'])
  assert.ok(data.notes.some((note) => /upstream/.test(note)), data.notes.join('\n'))
})

test('several remotes without origin are ambiguous, and --remote chooses one', async () => {
  const root = local({ remotes: { fork: 'git@github.com:me/app.git', main: 'git@github.com:acme/app.git' } })
  const ambiguous = dataOf(await link(root, ['--dry-run']))
  assert.equal(ambiguous.files[0].action, 'keep')
  assert.equal(ambiguous.remote, null)
  assert.ok(ambiguous.notes.some((note) => /--remote/.test(note)), ambiguous.notes.join('\n'))
  const chosen = dataOf(await link(root, ['--remote', 'main', '--dry-run']))
  assert.equal(chosen.repo.after, 'acme/app')
  assert.equal(errorOf(await link(root, ['--remote', 'nope'])).code, 'INVALID_INPUT')
})

test('the only remote is used even when it is not origin', async () => {
  const data = dataOf(await link(local({ remotes: { fork: 'git@github.com:me/app.git' } }), ['--dry-run']))
  assert.equal(data.remote.name, 'fork')
  assert.equal(data.repo.after, 'me/app')
})

test('flags override the remote', async () => {
  const root = local({ remotes: { origin: 'https://gitlab.com/acme/app.git' } })
  const data = dataOf(await link(root, ['--git-host', 'github', '--repo', 'acme/other']))
  assert.deepEqual(data.gitHost, { before: 'none', after: 'github', source: 'flag' })
  assert.deepEqual(data.repo, { before: null, after: 'acme/other', source: 'flag' })
  assert.ok(data.warnings.some((warning) => /gitlab\.com/.test(warning)), data.warnings.join('\n'))
  assert.match(read(root), /system: github/)
  assert.match(read(root), /repo: acme\/other/)
})

test('--git-host none removes the repo and warns when the remote is GitHub', async () => {
  const root = local({ remotes: { origin: 'git@github.com:acme/app.git' }, config: GITHUB_CONFIG })
  const data = dataOf(await link(root, ['--git-host', 'none']))
  assert.equal(data.gitHost.after, 'none')
  assert.equal(data.repo.after, null)
  assert.ok(data.warnings.some((warning) => /github\.com/.test(warning)), data.warnings.join('\n'))
  assert.doesNotMatch(read(root), /repo:/)
})

test('bad values are INVALID_INPUT', async () => {
  const root = local({ remotes: { origin: 'git@github.com:acme/app.git' } })
  assert.equal(errorOf(await link(root, ['--git-host', 'gitlab'])).code, 'INVALID_INPUT')
  assert.equal(errorOf(await link(root, ['--repo', 'justone'])).code, 'INVALID_INPUT')
  assert.equal(errorOf(await link(root, ['--git-host', 'none', '--repo', 'a/b'])).code, 'INVALID_INPUT')
  assert.match(errorOf(await link(root, ['--team', 'ENG'])).message, /local tracker has no scope/)
  assert.equal(read(root), CONFIG)
})

test('a config that already matches says so and writes nothing', async () => {
  const root = local({ remotes: { origin: 'git@github.com:old/repo.git' }, config: GITHUB_CONFIG })
  const result = await run(['link-repo'], { cwd: root, env: childEnv() })
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /already linked/)
  assert.equal(read(root), GITHUB_CONFIG)
})

test('an invalid config refuses the dry run and the write and keeps the file', async () => {
  const bad = CONFIG.replace('confirm: single_writes', 'confirm: sometimes')
  const root = local({ remotes: { origin: 'git@github.com:acme/app.git' }, config: bad })
  for (const args of [['--dry-run'], []]) {
    const error = errorOf(await link(root, args))
    assert.match(error.message, /^\.pmkit\/config\.yaml is not valid/)
  }
  assert.equal(read(root), bad)
  const broken = local({ config: 'version: 1\ntracker: [\n' })
  assert.match(errorOf(await link(broken)).message, /^\.pmkit\/config\.yaml is not valid/)
})

test('a missing config is NOT_CONFIGURED', async () => {
  const root = local()
  fs.rmSync(file(root))
  const error = errorOf(await link(root))
  assert.equal(error.code, 'NOT_CONFIGURED')
  assert.equal(error.nextStep, '/pmkit:setup')
})

test('a CRLF config is read and written with LF', async () => {
  const root = local({ remotes: { origin: 'git@github.com:acme/app.git' }, config: CONFIG.replace(/\n/g, '\r\n') })
  dataOf(await link(root))
  assert.equal(read(root), CONFIG.replace('  system: none # no host yet\n', '  system: github # no host yet\n  repo: acme/app\n'))
})

test('it leaves the tracker files alone', async () => {
  const root = local({ remotes: { origin: 'git@github.com:acme/app.git' } })
  const before = hashTree(root, ['.pmkit', '.git'])
  dataOf(await link(root))
  assert.deepEqual(hashTree(root, ['.pmkit', '.git']), before)
})

// Linear

const linearConfig = ({ team = 'ACME', extra = '' } = {}) => `version: 1
tracker:
  system: linear
  scope:
    workspace: acme${team ? `\n    team: ${team}` : ''}
git_host:
  system: none
write_policy:
  confirm: single_writes
  preview: [bulk, delete, publish_update, move_scope]
${extra}`

function linear({ config = linearConfig(), withKey = true } = {}) {
  const root = tempDir('pmkit-link-linear-')
  git(root, 'init', '-q')
  git(root, 'remote', 'add', 'origin', 'git@github.com:acme/app.git')
  fs.mkdirSync(path.dirname(file(root)), { recursive: true })
  fs.writeFileSync(file(root), config)
  return { root, env: { ...childEnv(), ...userStoreEnv().env, ...(withKey ? { LINEAR_API_KEY: FAKE_KEY } : {}) } }
}
const linearRun = (context, args, fetch = fakeLinearFetch(fakeWorkspace())) =>
  link(context.root, args, { env: context.env, adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch }) } })

const teamNode = (id, key, name) => ({ id, key, name, parent: null, cyclesEnabled: false, triageEnabled: false, issueEstimationType: 'notUsed', issueEstimationAllowZero: false, issueEstimationExtended: false })
const stateNode = (id, name, type, position, team) => ({ id, name, type, position, team: { id: team } })
const viewer = (teams) => ({ id: 'user-1', name: 'Test User', displayName: 'test', email: 't@example.com', active: true, guest: false, app: false, teams: { nodes: teams.map((id) => ({ id })) } })
const twoTeams = (viewerTeams = ['team-acme', 'team-beta']) =>
  fakeWorkspace({
    teams: [teamNode('team-acme', 'ACME', 'Acme'), teamNode('team-beta', 'BETA', 'Beta')],
    states: [
      stateNode('sa-1', 'Todo', 'unstarted', 0, 'team-acme'), stateNode('sa-2', 'Doing', 'started', 1, 'team-acme'), stateNode('sa-3', 'Review', 'started', 2, 'team-acme'),
      stateNode('sb-1', 'Todo', 'unstarted', 0, 'team-beta'), stateNode('sb-2', 'Doing', 'started', 1, 'team-beta'),
    ],
    users: [viewer(viewerTeams)],
    labels: [],
  })

test('Linear: the git host is written without a Linear call when no team is asked for', async () => {
  const context = linear()
  const fetch = fakeLinearFetch(fakeWorkspace())
  const data = dataOf(await linearRun(context, [], fetch))
  assert.equal(fetch.calls.length, 0)
  assert.deepEqual(data.scope.team, { before: 'ACME', after: 'ACME', source: 'file', verified: false })
  assert.match(fs.readFileSync(file(context.root), 'utf8'), /system: github\n {2}repo: acme\/app/)
})

test('Linear: --team is checked against the workspace and written', async () => {
  const context = linear({ config: linearConfig({ team: null }) })
  const dry = dataOf(await linearRun(context, ['--team', 'ACME', '--dry-run']))
  assert.deepEqual(dry.scope.team, { before: null, after: 'ACME', source: 'flag', verified: true })
  assert.doesNotMatch(fs.readFileSync(file(context.root), 'utf8'), /team:/)
  dataOf(await linearRun(context, ['--team', 'ACME']))
  assert.match(fs.readFileSync(file(context.root), 'utf8'), /scope:\n {4}workspace: acme\n {4}team: ACME\n/)
})

test('Linear: an unknown team is INVALID_INPUT and lists the teams', async () => {
  const context = linear()
  const error = errorOf(await linearRun(context, ['--team', 'NOPE']))
  assert.equal(error.code, 'INVALID_INPUT')
  assert.match(error.message, /NOPE/)
  assert.match(error.nextStep, /ACME/)
  assert.equal(fs.readFileSync(file(context.root), 'utf8'), linearConfig())
})

test('Linear: with no team in the file, the viewer team is used when there is only one', async () => {
  const context = linear({ config: linearConfig({ team: null }) })
  const data = dataOf(await linearRun(context, []))
  assert.deepEqual(data.scope.team, { before: null, after: 'ACME', source: 'viewer', verified: true })
})

test('Linear: with no team in the file and two candidates it asks and refuses to write', async () => {
  const context = linear({ config: linearConfig({ team: null }) })
  const dry = dataOf(await linearRun(context, ['--dry-run'], fakeLinearFetch(twoTeams())))
  assert.deepEqual(dry.questions.map((q) => [q.path, q.candidates]), [['tracker.scope.team', ['ACME', 'BETA']]])
  const error = errorOf(await linearRun(context, [], fakeLinearFetch(twoTeams())))
  assert.match(error.message, /tracker\.scope\.team/)
  assert.equal(fs.readFileSync(file(context.root), 'utf8'), linearConfig({ team: null }))
})

const MAPPED = '\nmappings:\n  status:\n    in_review: Review\n    blocked: none\n  types: {}\n'

test('Linear: a team that breaks the mappings is listed by the dry run and refused by the write', async () => {
  const text = linearConfig({ extra: MAPPED.slice(1) })
  const context = linear({ config: text })
  const fetch = fakeLinearFetch(twoTeams())
  const dry = dataOf(await linearRun(context, ['--team', 'BETA', '--dry-run'], fetch))
  assert.deepEqual(dry.broken.map((item) => item.path), ['mappings.status.in_review'])
  assert.equal(dry.files[0].action, 'change')
  const error = errorOf(await linearRun(context, ['--team', 'BETA'], fakeLinearFetch(twoTeams())))
  assert.equal(error.code, 'NOT_CONFIGURED')
  assert.equal(error.nextStep, '/pmkit:setup')
  assert.equal(error.mappings[0].path, 'mappings.status.in_review')
  assert.equal(fs.readFileSync(file(context.root), 'utf8'), text)
})

test('Linear: a team that fits the mappings is written', async () => {
  const context = linear({ config: linearConfig({ team: 'BETA', extra: MAPPED.slice(1) }) })
  const data = dataOf(await linearRun(context, ['--team', 'ACME'], fakeLinearFetch(twoTeams())))
  assert.deepEqual(data.broken, [])
  assert.match(fs.readFileSync(file(context.root), 'utf8'), /team: ACME/)
})

test('Linear: --team changes only the team line', async () => {
  const context = linear({ config: linearConfig({ team: 'BETA' }) })
  dataOf(await linearRun(context, ['--team', 'ACME', '--git-host', 'none'], fakeLinearFetch(twoTeams())))
  assert.equal(fs.readFileSync(file(context.root), 'utf8'), linearConfig({ team: 'ACME' }))
})

test('Linear: a missing key fails with AUTH and writes nothing', async () => {
  const context = linear({ withKey: false })
  const error = errorOf(await linearRun(context, ['--team', 'ACME']))
  assert.equal(error.code, 'AUTH')
  assert.equal(fs.readFileSync(file(context.root), 'utf8'), linearConfig())
})
