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
import { tempDir, userStoreEnv } from './test-helpers.mjs'

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
