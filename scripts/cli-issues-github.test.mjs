// The issue commands of the CLI over the GitHub adapter and the stateful fake GitHub, run in process. No test starts gh or opens a socket.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { githubDescriptor } from './lib/github/adapter.mjs'
import { fakeGithubIssues } from './fake-github-issues.mjs'
import { childEnv } from './golden-helpers.mjs'
import { makeRepo, tempDir, userStoreEnv } from './test-helpers.mjs'
import { addBareOrigin } from './fake-gh.mjs'

process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir())

const CONFIG = (host) => `version: 1
tracker:
  system: github
  scope:
    host: ${host}
    repo: acme/widgets
    project: acme/7
git_host:
  system: github
write_policy:
  confirm: none
mappings:
  status:
    backlog: Backlog
    todo: Todo
    in_progress: In Progress
    in_review: In Review
    done: Done
`

/** A git repository whose .pmkit/config.yaml names GitHub, and a CLI runner over one fake GitHub. */
function githubRepo({ host = 'github.com', ghesVersion = null } = {}) {
  const root = tempDir('pmkit-github-issues-')
  spawnSync('git', ['init', '-q'], { cwd: root })
  fs.mkdirSync(path.join(root, '.pmkit'))
  fs.writeFileSync(path.join(root, '.pmkit', 'config.yaml'), CONFIG(host))
  const fake = fakeGithubIssues({ host, ghesVersion })
  const env = { ...childEnv(), ...userStoreEnv().env }
  const adapters = { ...ADAPTERS, github: githubDescriptor({ exec: fake.exec }) }
  const cli = (args) => run(args, { cwd: root, env, adapters })
  return { root, fake, cli }
}

const dataOf = (result) => {
  assert.equal(result.code, 0, result.stdout + result.stderr)
  return JSON.parse(result.stdout)
}

test('issues delete removes a GitHub issue, and its dry run deletes nothing', async () => {
  const { fake, cli } = githubRepo()
  const created = dataOf(await cli(['issues', 'create', '--title', 'Delete me', '--json']))
  const { id } = created.after
  assert.equal(id, '1')
  const dry = dataOf(await cli(['issues', 'delete', id, '--dry-run', '--json']))
  assert.equal(dry.before.id, id)
  assert.equal(dry.after, null)
  assert.equal(dry.removes.issue, true)
  assert.equal(fake.mutations.filter((call) => call.name === 'PmkitDeleteIssue').length, 0)
  const text = await cli(['issues', 'delete', id, '--dry-run'])
  assert.equal(text.code, 0, text.stderr)
  assert.match(text.stdout, /^would delete 1 {2}Delete me/)
  assert.match(text.stdout, /removes: GitHub deletes the issue for good, and nothing can bring it back/)
  const done = dataOf(await cli(['issues', 'delete', id, '--json']))
  assert.equal(done.after, null)
  assert.equal(fake.mutations.filter((call) => call.name === 'PmkitDeleteIssue').length, 1)
  const gone = await cli(['issues', 'get', id, '--json'])
  assert.equal(JSON.parse(gone.stdout).error.code, 'NOT_FOUND')
})

const STATUS_WARNING = 'on GitHub Enterprise Server before 3.21, Status option changes have no events, so moves show only as opens and closes'

test('on GHES 3.20, issues get --history, events and the flow metrics print that Status changes have no events', async () => {
  const { cli } = githubRepo({ host: 'ghe.acme.test', ghesVersion: '3.20.0' })
  const { id } = dataOf(await cli(['issues', 'create', '--title', 'Old host', '--json'])).after
  for (const args of [['issues', 'get', id, '--history'], ['events'], ['metrics', 'cycle-time']]) {
    const json = await cli([...args, '--json'])
    assert.equal(json.code, 0, json.stdout + json.stderr)
    assert.ok(json.stderr.includes(STATUS_WARNING), `${args.join(' ')} --json: ${json.stderr}`)
    const text = await cli(args)
    assert.ok(text.stderr.includes(STATUS_WARNING), `${args.join(' ')}: ${text.stderr}`)
  }
})

test('on github.com, issues get --history prints no warning, and events notes the GitHub history it read', async () => {
  const { cli } = githubRepo()
  const { id } = dataOf(await cli(['issues', 'create', '--title', 'New host', '--json'])).after
  const history = await cli(['issues', 'get', id, '--history'])
  assert.equal(history.code, 0, history.stderr)
  assert.equal(history.stderr, '')
  const events = await cli(['events'])
  assert.equal(events.code, 0, events.stderr)
  assert.equal(events.stderr, 'note: events computed from GitHub issue history\n')
})

test('issues unarchive and issues bulk unarchive refuse on GitHub and point at the Project', async () => {
  const { cli, fake } = githubRepo()
  for (const args of [['issues', 'unarchive', '1'], ['issues', 'bulk', 'unarchive']]) {
    const result = await cli([...args, '--json'])
    assert.equal(result.code, 2, args.join(' '))
    assert.deepEqual(JSON.parse(result.stdout).error, {
      code: 'NOT_SUPPORTED',
      message: 'unarchive works on the Local tracker only',
      nextStep: 'Restore the item from the archived items of the Project on GitHub',
    })
  }
  assert.equal(fake.mutations.length, 0)
})

test('a cut metric events read on GHES 3.20 prints the cut warning and the Status warning once each', async () => {
  const { cli, fake } = githubRepo({ host: 'ghe.acme.test', ghesVersion: '3.20.0' })
  for (let index = 0; index < 1001; index += 1) fake.seed({ title: `S${index}` })
  const cut = 'GitHub has more issues than the 1000 pmkit read; the result covers the 1000 most recently updated'
  const count = (text, line) => text.split('\n').filter((entry) => entry === `warning: ${line}`).length
  for (const args of [['events', '--json'], ['events'], ['metrics', 'throughput']]) {
    const result = await cli(args)
    assert.equal(result.code, 0, result.stderr)
    assert.equal(count(result.stderr, cut), 1, `${args.join(' ')}: ${result.stderr}`)
    assert.equal(count(result.stderr, STATUS_WARNING), 1, `${args.join(' ')}: ${result.stderr}`)
  }
})

// issues branch on GitHub (decision 6): GitHub creates the linked branch on origin at the head there of the branch it starts from,
// so a local start that lacks commits of origin/<base> would make the push of pr open non-fast-forward.
const git = (cwd, ...args) => {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x.dev', ...args], { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}
const linkedNote = (from, branch, base, dryRun) => `GitHub creates ${branch} on origin at the head of ${base} there, and ${from} lacks commits of origin/${base} (as of the last fetch), so the push of pr open would be refused. ${dryRun ? `Pass --from origin/${base}` : `Run git fetch origin, then git rebase --onto origin/${base} ${from} ${branch}`}`
const noteLines = (result) => result.stderr.split('\n').filter((line) => line.startsWith('note: ')).map((line) => line.slice('note: '.length))

/**
 * A GitHub repository with one issue, a local `main` and a bare origin. `behind` commits are on origin/main only; `branches` maps more local
 * branches to the commit they point at ('origin' for origin/main's head, 'local' for main's), each pushed. GitHub's heads are the local ones.
 */
function branchRepo({ behind = 0, defaultBranch = null, extra = [] } = {}) {
  const repo = githubRepo()
  const { root } = repo
  if (defaultBranch !== null) fs.writeFileSync(path.join(root, '.pmkit', 'config.yaml'), CONFIG('github.com').replace('  system: github\nwrite_policy', `  system: github\n  default_branch: ${defaultBranch}\nwrite_policy`))
  git(root, 'commit', '--allow-empty', '-qm', 'init')
  git(root, 'branch', '-m', 'main')
  addBareOrigin(root, tempDir('pmkit-github-origin-'))
  for (let index = 0; index < behind; index += 1) git(root, 'commit', '--allow-empty', '-qm', `c${index}`)
  git(root, 'push', '-q', 'origin', 'main')
  for (const name of extra) {
    git(root, 'commit', '--allow-empty', '-qm', name)
    git(root, 'branch', name)
    git(root, 'push', '-q', 'origin', name)
    git(root, 'reset', '-q', '--hard', 'HEAD~1')
  }
  if (behind > 0) git(root, 'reset', '-q', '--hard', `HEAD~${behind}`)
  repo.fake.seedBranch('main', git(root, 'rev-parse', 'refs/remotes/origin/main'))
  for (const name of extra) repo.fake.seedBranch(name, git(root, 'rev-parse', `refs/remotes/origin/${name}`))
  return repo
}

async function issueBranch(cli, args) {
  const { id } = dataOf(await cli(['issues', 'create', '--title', 'Link me', '--json'])).after
  const dryText = await cli(['issues', 'branch', id, '--dry-run', ...args])
  assert.equal(dryText.code, 0, dryText.stdout + dryText.stderr)
  const dry = dataOf(await cli(['issues', 'branch', id, '--dry-run', '--json', ...args]))
  const real = await cli(['issues', 'branch', id, '--json', ...args])
  return { id, dryText, dry, real, realData: dataOf(real) }
}

test('issues branch on GitHub with main behind origin/main notes the refused push, on the dry run and the real run', async () => {
  const { cli, fake, root } = branchRepo({ behind: 1 })
  const { id, dryText, dry, real, realData } = await issueBranch(cli, [])
  const branch = dry.branch
  assert.equal(branch, `1-link-me`)
  assert.ok(dry.notes.includes(linkedNote('main', branch, 'main', true)), JSON.stringify(dry.notes))
  assert.ok(noteLines(dryText).includes(linkedNote('main', branch, 'main', true)), dryText.stderr)
  assert.ok(realData.notes.includes(linkedNote('main', branch, 'main', false)), JSON.stringify(realData.notes))
  assert.ok(noteLines(real).includes(linkedNote('main', branch, 'main', false)), real.stderr)
  assert.match(realData.notes.join('\n'), /git rebase --onto origin\/main main 1-link-me/)
  // The adapter's after is in the JSON, and the linked branch starts at main's head on GitHub.
  assert.equal(realData.after.branch, branch)
  const linked = fake.mutations.filter((call) => call.name === 'PmkitCreateLinkedBranch')
  assert.equal(linked.length, 1)
  assert.equal(linked[0].input.oid, git(root, 'rev-parse', 'refs/remotes/origin/main'))
  assert.equal(dataOf(await cli(['issues', 'get', id, '--json'])).branch, branch)
})

test('issues branch on GitHub with main level with origin/main has no linked-branch note', async () => {
  const { cli } = branchRepo()
  const { dryText, dry, real, realData } = await issueBranch(cli, [])
  assert.equal(dry.notes, undefined)
  assert.equal(realData.notes, undefined)
  assert.doesNotMatch(dryText.stderr + real.stderr, /GitHub creates/)
})

test('issues branch on GitHub --from a branch GitHub lacks notes the fallback to main, and the refused push when it lacks origin/main', async () => {
  const { cli, root } = branchRepo({ behind: 1 })
  git(root, 'branch', 'feature', 'main')
  const { dryText, dry, real, realData } = await issueBranch(cli, ['--from', 'feature'])
  const fallback = `GitHub has no branch feature, so pmkit linked ${dry.branch} at the head of main there`
  for (const notes of [dry.notes, noteLines(dryText)]) {
    assert.ok(notes.includes(fallback), JSON.stringify(notes))
    assert.ok(notes.includes(linkedNote('feature', dry.branch, 'main', true)), JSON.stringify(notes))
  }
  for (const notes of [realData.notes, noteLines(real)]) {
    assert.ok(notes.includes(fallback), JSON.stringify(notes))
    assert.ok(notes.includes(linkedNote('feature', dry.branch, 'main', false)), JSON.stringify(notes))
  }
})

test('issues branch on GitHub --from a branch GitHub lacks but that contains origin/main notes only the fallback', async () => {
  const { cli, root } = branchRepo({ behind: 1 })
  git(root, 'branch', 'feature', 'refs/remotes/origin/main')
  const { dry, real, realData } = await issueBranch(cli, ['--from', 'feature'])
  const fallback = `GitHub has no branch feature, so pmkit linked ${dry.branch} at the head of main there`
  assert.deepEqual(dry.notes, [fallback])
  assert.deepEqual(realData.notes, [fallback])
  assert.deepEqual(noteLines(real).filter((line) => line.startsWith('GitHub')), [fallback])
})

test('issues branch on GitHub notes that it could not check the start when git cannot walk its history', async () => {
  const { cli, root } = branchRepo({ behind: 1 })
  git(root, 'checkout', '-q', '-b', 'feature')
  git(root, 'commit', '--allow-empty', '-qm', 'f1')
  const lost = git(root, 'rev-parse', 'HEAD')
  git(root, 'commit', '--allow-empty', '-qm', 'f2')
  git(root, 'checkout', '-q', 'main')
  // With f1's object gone, git merge-base fails with status 128 instead of answering yes (0) or no (1).
  fs.rmSync(path.join(root, '.git', 'objects', lost.slice(0, 2), lost.slice(2)))
  const { id } = dataOf(await cli(['issues', 'create', '--title', 'Link me', '--json'])).after
  const dry = dataOf(await cli(['issues', 'branch', id, '--dry-run', '--json', '--from', 'feature']))
  const note = 'could not check whether feature contains origin/main, so the push of pr open may be refused. Run git fetch origin, then check with git log feature..origin/main'
  assert.ok(dry.notes.includes(note), JSON.stringify(dry.notes))
})

test('issues branch on GitHub starts the linked branch at pmkit default branch develop, not at main', async () => {
  const { cli, fake, root } = branchRepo({ defaultBranch: 'develop', extra: ['develop'] })
  git(root, 'branch', '-f', 'develop', 'refs/remotes/origin/develop')
  const develop = git(root, 'rev-parse', 'refs/remotes/origin/develop')
  assert.notEqual(develop, git(root, 'rev-parse', 'refs/remotes/origin/main'))
  const { dry, realData } = await issueBranch(cli, [])
  assert.equal(dry.from, 'develop')
  assert.equal(dry.notes, undefined)
  assert.equal(realData.notes, undefined)
  const linked = fake.mutations.filter((call) => call.name === 'PmkitCreateLinkedBranch')
  assert.equal(linked.length, 1)
  assert.equal(linked[0].input.oid, develop)
})

test('issues branch on GitHub --from origin/main passes main as the base', async () => {
  const { cli, fake, root } = branchRepo({ behind: 1 })
  const { dry, realData } = await issueBranch(cli, ['--from', 'origin/main'])
  assert.equal(dry.from, 'origin/main')
  assert.equal(dry.notes, undefined)
  assert.equal(realData.notes, undefined)
  assert.equal(fake.mutations.find((call) => call.name === 'PmkitCreateLinkedBranch').input.oid, git(root, 'rev-parse', 'refs/remotes/origin/main'))
})

test('issues branch on a Local tracker gives no linked-branch note', async () => {
  const root = makeRepo('team')
  git(root, 'init', '-q')
  const file = path.join(root, '.pmkit/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('system: none', 'system: github\n  default_branch: main'))
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', 'init')
  git(root, 'branch', '-m', 'main')
  addBareOrigin(root, tempDir('pmkit-local-origin-'))
  git(root, 'commit', '--allow-empty', '-qm', 'c0')
  git(root, 'push', '-q', 'origin', 'main')
  git(root, 'reset', '-q', '--hard', 'HEAD~1')
  const env = { ...childEnv(), ...userStoreEnv().env }
  const result = await run(['issues', 'branch', 'ISS-2X6D', '--json'], { cwd: root, env })
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const notes = JSON.parse(result.stdout).notes
  assert.ok(notes.some((note) => /main is 1 commit behind origin\/main/.test(note)), JSON.stringify(notes))
  assert.doesNotMatch(result.stdout + result.stderr, /GitHub creates/)
})
