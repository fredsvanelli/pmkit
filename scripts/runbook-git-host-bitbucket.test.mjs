// E2E test of docs/runbooks/git-host-bitbucket.md: the real CLI as a subprocess, with globalThis.fetch replaced by the stateful
// fake Bitbucket (fakeBitbucketRepo in scripts/fake-bitbucket-api.mjs) before the CLI loads, so no socket opens. The launcher keeps
// the fake's state in a JSON file beside it. A local bare repository receives the pushes: origin's URL stays on bitbucket.org, so
// link-repo infers Bitbucket from it, and a pushInsteadOf rule sends the push to the bare repository (insteadOf would also rewrite
// the URL `git remote -v` prints, and link-repo would no longer see bitbucket.org).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { childEnv } from './golden-helpers.mjs'
import { FAKE_BB_ENV, FAKE_BB_TOKEN, fakeBitbucketRepo } from './fake-bitbucket-api.mjs'
import { makeRepo, tempDir } from './test-helpers.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'git-host-bitbucket.md')
const url = (name) => pathToFileURL(path.join(SCRIPTS, name)).href
const ORIGIN = 'git@bitbucket.org:acme/widgets.git'
const NOT_VERIFIED = { area: 'blockers', code: 'NOT_SUPPORTED', message: 'blockers are not verified on Bitbucket' }

function git(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x.dev', ...args], { cwd, encoding: 'utf8', env: childEnv() })
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

/** Writes a launcher that loads the fake's state from state.json beside it (absent: fresh), runs the CLI and saves the state. */
function launcher(bare) {
  const dir = tempDir('pmkit-bb-launcher-')
  const file = path.join(dir, 'launch.mjs')
  fs.writeFileSync(file, `import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fakeBitbucketFetch, fakeBitbucketRepo } from ${JSON.stringify(url('fake-bitbucket-api.mjs'))}
const stateFile = ${JSON.stringify(path.join(dir, 'state.json'))}
const bare = ${JSON.stringify(bare)}
const git = (...args) => spawnSync('git', ['--git-dir', bare, ...args], { encoding: 'utf8' }).stdout ?? ''
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : undefined
// The diff and the head commit come from the bare repository the branches were pushed to, as Bitbucket's come from its own.
const fake = fakeBitbucketRepo({
  state,
  diff: (source, destination) => git('diff', destination + '...' + source),
  commit: (branch) => git('rev-parse', '--short=12', 'refs/heads/' + branch).trim() || null,
})
globalThis.fetch = fakeBitbucketFetch(fake.routes)
const { run } = await import(${JSON.stringify(url('pmkit.mjs'))})
const result = await run(process.argv.slice(2))
fs.writeFileSync(stateFile, JSON.stringify(fake.state))
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
process.exitCode = result.code
`)
  return { file, stateFile: path.join(dir, 'state.json') }
}

/** The repository the runbook's "Before you start" describes: Local tracker, git_host none, main pushed to an origin on bitbucket.org. */
function bitbucketRepo() {
  const root = makeRepo('basic')
  const bare = path.join(tempDir('pmkit-bb-origin-'), 'widgets.git')
  git(path.dirname(bare), 'init', '-q', '--bare', '-b', 'main', bare)
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', `url.${bare}.pushInsteadOf`, ORIGIN)
  git(root, 'remote', 'add', 'origin', ORIGIN)
  fs.appendFileSync(path.join(root, '.git', 'info', 'exclude'), 'tmp/\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', 'init')
  git(root, 'push', '-q', '-u', 'origin', 'main')
  git(root, 'remote', 'set-head', 'origin', 'main')
  fs.mkdirSync(path.join(root, 'tmp'))
  return { root, bare }
}

function session() {
  const { root, bare } = bitbucketRepo()
  const { file: launch, stateFile } = launcher(bare)
  const pmkit = (args, env = FAKE_BB_ENV) => {
    const result = spawnSync(process.execPath, [launch, ...args], { cwd: root, env: { ...childEnv(), ...env }, encoding: 'utf8' })
    assert.ok(!`${result.stdout}${result.stderr}`.includes(FAKE_BB_TOKEN), 'the token reached the output')
    return { code: result.status, stdout: result.stdout, stderr: result.stderr }
  }
  const write = (name, text) => {
    // git removes src/ with the last file in it when a switch leaves it empty.
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), text)
  }
  /** What a reviewer does on bitbucket.org: merge or decline a pull request, in the fake's saved state. */
  const onBitbucket = (action, id) => {
    const fake = fakeBitbucketRepo({ state: JSON.parse(fs.readFileSync(stateFile, 'utf8')) })
    fake[action](id)
    fs.writeFileSync(stateFile, JSON.stringify(fake.state))
  }
  return { pmkit, write, onBitbucket, root, bare }
}

const body = (result) => {
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`)
  const parsed = JSON.parse(result.stdout)
  return parsed.data ?? parsed
}

const failure = (result) => {
  assert.equal(result.code, 2, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout).error
}

test('the runbook names every command the test runs', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8')
  const commands = [
    'link-repo --dry-run --json',
    'link-repo --json',
    'issues create --title-file tmp/title-1.txt --type feature --json',
    'issues create --title-file tmp/title-2.txt --type feature --json',
    'issues branch <issue-id> --json',
    'pr open --issue <issue-id> --draft --json',
    'pr ready --issue <issue-id> --json',
    'pr status --json',
    'pr diff --json',
    'ci logs --json',
    'deploys list --json',
    'pr blockers --json',
    'issues move <issue-id> in_review --json',
    'pr sync --json',
    'issues branch <second-issue-id> --json',
    'pr open --issue <second-issue-id> --json',
    'issues move <second-issue-id> in_review --json',
  ]
  for (const command of commands) assert.ok(text.includes(`node scripts/pmkit.mjs ${command}`), command)
  for (const line of ['git add src/retry.mjs', 'git add src/cache.mjs', 'git push origin main', 'EPC-14', 'export BITBUCKET_TOKEN=<token>']) assert.ok(text.includes(line), line)
})

test('the Bitbucket git host, step by step', () => {
  const { pmkit, write, onBitbucket, root, bare } = session()
  const config = path.join(root, '.pmkit', 'config.yaml')
  const before = fs.readFileSync(config, 'utf8')

  // 1. Without the token
  const noToken = failure(pmkit(['link-repo', '--dry-run', '--json'], {}))
  assert.equal(noToken.code, 'AUTH')
  assert.equal(noToken.message, 'BITBUCKET_TOKEN is not set')
  assert.equal(noToken.nextStep, '/pmkit:setup')

  // 2. Link: the dry run, then the write
  const dry = body(pmkit(['link-repo', '--dry-run', '--json']))
  assert.deepEqual(dry.gitHost, { before: 'none', after: 'bitbucket', source: 'remote' })
  assert.deepEqual(dry.repo, { before: null, after: 'acme/widgets', source: 'remote' })
  assert.deepEqual(dry.defaultBranch, { before: null, after: 'main', source: 'remote' })
  assert.equal(dry.remote.host, 'bitbucket.org')
  assert.equal(fs.readFileSync(config, 'utf8'), before)
  const linked = body(pmkit(['link-repo', '--json']))
  assert.equal(linked.gitHost.after, 'bitbucket')
  assert.match(fs.readFileSync(config, 'utf8'), /git_host:\n {2}system: bitbucket\n {2}repo: acme\/widgets\n {2}default_branch: main\n/)

  // 3. Two issues, committed with the link
  write('tmp/title-1.txt', 'Retry the sync')
  write('tmp/title-2.txt', 'Drop the cache')
  const first = body(pmkit(['issues', 'create', '--title-file', 'tmp/title-1.txt', '--type', 'feature', '--json'])).after.id
  const second = body(pmkit(['issues', 'create', '--title-file', 'tmp/title-2.txt', '--type', 'feature', '--json'])).after.id
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', 'Link Bitbucket')
  git(root, 'push', '-q', 'origin', 'main')

  // 4. The branch, created locally, and the work
  const branched = body(pmkit(['issues', 'branch', first, '--json']))
  const branch = `${first.toLowerCase()}-retry-the-sync`
  assert.equal(branched.branch, branch)
  assert.equal(branched.from, 'main')
  assert.equal(git(root, 'branch', '--show-current'), branch)
  assert.equal(spawnSync('git', ['--git-dir', bare, 'rev-parse', '--verify', '-q', `refs/heads/${branch}`]).status, 1, 'the branch is not pushed yet')
  write('src/retry.mjs', 'export const retries = 3\n')
  git(root, 'add', 'src/retry.mjs')
  git(root, 'commit', '-qm', 'Retry the sync')

  // 5. A draft pull request, after the push
  const opened = body(pmkit(['pr', 'open', '--issue', first, '--draft', '--json']))
  assert.equal(opened.number, 1)
  assert.equal(opened.isDraft, true)
  assert.equal(opened.existing, false)
  assert.equal(opened.state, 'OPEN')
  assert.equal(opened.title, `Retry the sync (${first})`)
  assert.equal(opened.headRefName, branch)
  assert.equal(opened.url, 'https://bitbucket.org/acme/widgets/pull-requests/1')
  assert.equal(git(bare, 'rev-parse', `refs/heads/${branch}`), git(root, 'rev-parse', 'HEAD'))

  // 6. Ready for review
  const ready = body(pmkit(['pr', 'ready', '--issue', first, '--json']))
  assert.equal(ready.number, 1)
  assert.equal(ready.isDraft, false)

  // 7. Status: the failed pipeline's build status, and the blockers not verified
  const status = body(pmkit(['pr', 'status', '--json']))
  assert.equal(status.pr.number, 1)
  assert.equal(status.pr.isDraft, false)
  assert.deepEqual(status.checks.map((check) => [check.name, check.bucket, check.runId]), [['Pipeline #1', 'fail', 1]])
  assert.deepEqual(status.reviews, [])
  assert.equal(status.blockers.blocked, null)
  assert.deepEqual(status.blockers.unchecked, [NOT_VERIFIED])

  // 8. The diff of the pull request
  const diff = body(pmkit(['pr', 'diff', '--json']))
  assert.equal(diff.source, 'pull_request')
  assert.equal(diff.pr.number, 1)
  assert.deepEqual(diff.files.map((file) => file.path), ['src/retry.mjs'])
  assert.match(diff.diff, /^\+export const retries = 3$/m)
  assert.equal(diff.uncommitted, true)

  // 9. The failed steps of the branch's pipeline
  const logs = body(pmkit(['ci', 'logs', '--json']))
  assert.equal(logs.run.runId, 1)
  assert.equal(logs.run.conclusion, 'failure')
  assert.equal(logs.run.failed, true)
  assert.equal(logs.run.url, 'https://bitbucket.org/acme/widgets/pipelines/results/1')
  assert.equal(logs.run.headSha, git(root, 'rev-parse', '--short=12', 'HEAD'))
  assert.match(logs.run.log, /^== Test ==\n/)

  // 10. The deployments, newest first
  const deploys = body(pmkit(['deploys', 'list', '--json'])).deploys
  assert.deepEqual(deploys.map((deploy) => [deploy.environment, deploy.state, deploy.ref]), [['Staging', 'failure', null], ['Production', 'success', null]])

  // 11. Blockers are refused
  assert.deepEqual(failure(pmkit(['pr', 'blockers', '--json'])), { code: 'NOT_SUPPORTED', message: 'pr blockers is not supported on Bitbucket yet', nextStep: 'Read the merge checks on the pull request page' })

  // 12. Merged on Bitbucket: the issue moves to done
  body(pmkit(['issues', 'move', first, 'in_review', '--json']))
  onBitbucket('merge', 1)
  const synced = body(pmkit(['pr', 'sync', '--json']))
  assert.equal(synced.checked, 1)
  assert.deepEqual(synced.moved, [{ id: first, pr: 1 }])
  assert.deepEqual(synced.problems, [])
  assert.equal(body(pmkit(['issues', 'get', first, '--json'])).status.category, 'done')

  // 13. Declined on Bitbucket: the issue stays in review
  const branch2 = body(pmkit(['issues', 'branch', second, '--json'])).branch
  assert.equal(git(root, 'branch', '--show-current'), branch2)
  write('src/cache.mjs', 'export const cache = null\n')
  git(root, 'add', 'src/cache.mjs')
  git(root, 'commit', '-qm', 'Drop the cache')
  const opened2 = body(pmkit(['pr', 'open', '--issue', second, '--json']))
  assert.equal(opened2.number, 2)
  assert.equal(opened2.isDraft, false)
  body(pmkit(['issues', 'move', second, 'in_review', '--json']))
  onBitbucket('decline', 2)
  assert.equal(body(pmkit(['pr', 'status', '--json'])).pr.state, 'CLOSED')
  const synced2 = body(pmkit(['pr', 'sync', '--json']))
  assert.equal(synced2.checked, 1)
  assert.deepEqual(synced2.moved, [])
  assert.equal(body(pmkit(['issues', 'get', second, '--json'])).status.category, 'in_review')
})
