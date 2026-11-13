import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { run } from './pmkit.mjs'
import { branchName } from './lib/ids.mjs'
import { hashTree, makeRepo, tempDir } from './test-helpers.mjs'
import { addBareOrigin, fakeGh, ghCalls } from './fake-gh.mjs'

const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'

const scratch = () => tempDir('pmkit-pr-')

const envWith = ({ dir, responses }) => ({
  ...process.env,
  PATH: `${dir}${path.delimiter}${process.env.PATH}`,
  PMKIT_FAKE_GH: responses,
  PMKIT_USER: 'fred',
  PMKIT_NOW: '2026-10-23T12:00:00Z',
  PMKIT_SEED: '1',
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
})

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' } })

function teamRepo({ github = true } = {}) {
  const root = makeRepo('team')
  git(root, 'init', '-q')
  if (github) {
    const file = path.join(root, '.pmkit/config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('system: none', 'system: github\n  default_branch: main'))
  }
  return root
}

const call = (root, env, args) => run(args, { env, cwd: root })
const callJson = async (root, env, args) => {
  const result = await call(root, env, [...args, '--json'])
  assert.equal(result.code, 0, result.stdout + result.stderr)
  return JSON.parse(result.stdout)
}
const errorOf = (result) => JSON.parse(result.stdout).error

const prJson = (overrides = {}) => JSON.stringify({ number: 7, url: 'https://github.com/o/r/pull/7', title: 'T', state: 'OPEN', isDraft: false, headRefName: 'x', author: { login: 'fred' }, mergedAt: null, ...overrides })
const view = (branch) => `pr view ${branch} --json ${VIEW}`
// pr status and pr blockers read the pull request with its reviews and merge state in one call.
const detailView = (branch) => `pr view ${branch} --json ${VIEW},reviews,reviewRequests,mergeable,mergeStateStatus,reviewDecision,baseRefName`
const detailJson = (overrides = {}, detail = {}) => JSON.stringify({ ...JSON.parse(prJson(overrides)), reviews: [], reviewRequests: [], mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: '', baseRefName: 'main', ...detail })

async function inReview(root, env, id, branch) {
  await callJson(root, env, ['issues', 'update', id, '--branch', branch])
  await callJson(root, env, ['issues', 'move', id, 'in_review'])
}

test('pr sync moves merged issues, leaves open ones and reports failed lookups', async () => {
  const root = teamRepo()
  const gh = fakeGh({
    [view('merged-branch')]: { stdout: prJson({ number: 11, mergedAt: '2026-10-22T10:00:00Z', state: 'MERGED' }) },
    [view('open-branch')]: { stdout: prJson({ number: 12 }) },
    [view('broken-branch')]: { status: 1, stderr: 'GraphQL: boom\n' },
  })
  const env = envWith(gh)
  await inReview(root, env, 'ISS-2X6D', 'merged-branch')
  await inReview(root, env, 'ISS-5N1R', 'open-branch')
  await callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'broken-branch'])

  const result = await callJson(root, env, ['pr', 'sync'])
  assert.equal(result.checked, 3)
  assert.deepEqual(result.moved, [{ id: 'ISS-2X6D', pr: 11 }])
  // ISS-3Q6T has conflict markers in the fixture, so it cannot be read.
  assert.deepEqual(result.problems.map((p) => [p.id, p.code]), [['ISS-3Q6T', 'CONFLICT'], ['ISS-8C4W', 'UPSTREAM']])

  const moved = await callJson(root, env, ['issues', 'get', 'ISS-2X6D', '--history'])
  assert.equal(moved.status.category, 'done')
  const last = moved.history[moved.history.length - 1]
  assert.equal(last.field, 'status')
  assert.equal(last.by, 'fred')
  assert.equal((await callJson(root, env, ['issues', 'get', 'ISS-5N1R'])).status.category, 'in_review')
})

test('pr sync --dry-run reports the moves and leaves the repo unchanged', async () => {
  const root = teamRepo()
  const gh = fakeGh({ [view('merged-branch')]: { stdout: prJson({ number: 11, mergedAt: '2026-10-22T10:00:00Z' }) } })
  const env = envWith(gh)
  await inReview(root, env, 'ISS-2X6D', 'merged-branch')
  const before = hashTree(root)
  const result = await callJson(root, env, ['pr', 'sync', '--dry-run'])
  assert.deepEqual(result.moved, [{ id: 'ISS-2X6D', pr: 11 }])
  assert.equal(hashTree(root), before)
})

function autoCommitRepo() {
  const root = teamRepo()
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@x.dev')
  const file = path.join(root, '.issues/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('auto_commit: false', 'auto_commit: true'))
  assert.equal(git(root, 'add', '-A').status, 0)
  assert.equal(git(root, 'commit', '-qm', 'initial').status, 0)
  return root
}

const subjects = (root) => git(root, 'log', '--format=%s').stdout

test('pr sync with nothing merged moves nothing and does not commit', async () => {
  const root = autoCommitRepo()
  const env = envWith(fakeGh({ [view('open-branch')]: { stdout: prJson() } }))
  await callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'open-branch'])
  const before = subjects(root)
  assert.match(before, /pmkit: issues update ISS-8C4W/)
  const result = await callJson(root, env, ['pr', 'sync'])
  assert.equal(result.checked, 1)
  assert.deepEqual(result.moved, [])
  assert.equal(subjects(root), before)
})

test('pr sync --dry-run with auto_commit true does not commit', async () => {
  const root = autoCommitRepo()
  const gh = fakeGh({ [view('merged-branch')]: { stdout: prJson({ number: 11, mergedAt: '2026-10-22T10:00:00Z' }) } })
  try {
    const env = envWith(gh)
    await inReview(root, env, 'ISS-2X6D', 'merged-branch')
    const before = subjects(root)
    const tree = hashTree(root)
    const result = await callJson(root, env, ['pr', 'sync', '--dry-run'])
    assert.deepEqual(result.moved, [{ id: 'ISS-2X6D', pr: 11 }])
    assert.equal(subjects(root), before)
    assert.equal(hashTree(root), tree)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(gh.dir, { recursive: true, force: true })
  }
})

test('pr sync commits with the moved ids when auto_commit is on', async () => {
  const root = autoCommitRepo()
  const env = envWith(fakeGh({ [view('merged-branch')]: { stdout: prJson({ number: 11, mergedAt: '2026-10-22T10:00:00Z' }) } }))
  await inReview(root, env, 'ISS-2X6D', 'merged-branch')
  const before = subjects(root)
  const result = await callJson(root, env, ['pr', 'sync'])
  assert.deepEqual(result.moved, [{ id: 'ISS-2X6D', pr: 11 }])
  assert.equal(git(root, 'log', '-1', '--format=%s').stdout.trim(), 'pmkit: pr sync ISS-2X6D')
  assert.notEqual(subjects(root), before)
})

test('every pr command with git_host.system none exits 2 with NOT_SUPPORTED', async () => {
  const root = teamRepo({ github: false })
  const env = envWith(fakeGh({}))
  const commands = [['pr', 'status', '--branch', 'x'], ['pr', 'sync'], ['pr', 'open', '--issue', 'ISS-2X6D'], ['pr', 'ready', '--issue', 'ISS-2X6D'], ['issues', 'branch', 'ISS-2X6D', '--dry-run']]
  for (const args of commands) {
    const result = await call(root, env, [...args, '--json'])
    assert.equal(result.code, 2, args.join(' '))
    const error = errorOf(result)
    assert.equal(error.code, 'NOT_SUPPORTED')
    assert.equal(error.nextStep, 'Set git_host.system to github in .pmkit/config.yaml, or run /pmkit:setup')
  }
})

test('a PATH without gh exits 2 with NOT_CONFIGURED, and a logged out gh with AUTH', async () => {
  const root = teamRepo()
  const env = { ...envWith(fakeGh({})), PATH: scratch() }
  const missing = await call(root, env, ['pr', 'status', '--branch', 'x', '--json'])
  assert.equal(missing.code, 2)
  assert.equal(errorOf(missing).code, 'NOT_CONFIGURED')

  const login = { status: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' }
  const loggedOut = envWith(fakeGh({ [view('x')]: login, [detailView('x')]: login }))
  const auth = await call(root, loggedOut, ['pr', 'status', '--branch', 'x', '--json'])
  assert.equal(auth.code, 2)
  assert.equal(errorOf(auth).code, 'AUTH')

  await inReview(root, loggedOut, 'ISS-2X6D', 'x')
  const sync = await call(root, loggedOut, ['pr', 'sync', '--json'])
  assert.equal(sync.code, 2)
  assert.equal(errorOf(sync).code, 'AUTH')
})

/** The blocker reads of pull request 7 on main: no thread, no protection, no rule. */
async function cleanReads(protection = { status: 1, stderr: 'gh: Branch not protected (HTTP 404)\n' }) {
  return {
    [await graphqlKey()]: { stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false},"nodes":[]}}}}}' },
    'api repos/{owner}/{repo}/branches/main/protection': protection,
    'api repos/{owner}/{repo}/rules/branches/main?per_page=100&page=1': { stdout: '[]' },
  }
}

test('pr status shows the blockers of an open pull request and reads it once', async () => {
  const root = teamRepo()
  const gh = fakeGh({
    [detailView('feat')]: { stdout: detailJson({ number: 7, isDraft: true }) },
    'pr checks 7 --json name,state,bucket,link': { stdout: '[]' },
    ...(await cleanReads()),
  })
  const status = await callJson(root, envWith(gh), ['pr', 'status', '--branch', 'feat'])
  assert.equal(status.blockers.blocked, true)
  assert.deepEqual(status.blockers.blocking, [{ area: 'draft', message: 'the pull request is a draft' }])
  assert.deepEqual(Object.keys(status.blockers), ['blocked', 'blocking', 'pending', 'unknown', 'unchecked'])
  assert.equal('detail' in status.pr, false)
  assert.equal(ghCalls(gh).filter((c) => c.startsWith('pr view')).length, 1)
  assert.equal(ghCalls(gh).filter((c) => c.startsWith('pr checks')).length, 1)
  const text = (await call(root, envWith(gh), ['pr', 'status', '--branch', 'feat'])).stdout
  assert.match(text, /^blockers: blocked: the pull request is a draft$/m)
})

test('pr status says the blockers are not verified when the protection is refused, never that nothing blocks', async () => {
  const root = teamRepo()
  const gh = fakeGh({
    [detailView('feat')]: { stdout: detailJson({ number: 7 }) },
    'pr checks 7 --json name,state,bucket,link': { stdout: '[]' },
    ...(await cleanReads({ status: 1, stderr: 'gh: Resource not accessible by integration (HTTP 403)\n' })),
  })
  const status = await callJson(root, envWith(gh), ['pr', 'status', '--branch', 'feat'])
  assert.equal(status.blockers.blocked, null)
  assert.deepEqual(status.blockers.unchecked.map((u) => u.area), ['policies'])
  const text = (await call(root, envWith(gh), ['pr', 'status', '--branch', 'feat'])).stdout
  assert.match(text, /^blockers: blockers not verified: policies$/m)
  assert.doesNotMatch(text, /nothing blocks/)
})

test('pr status keeps the pull request and its checks when a blocker read hits the rate limit, and reads no further', async () => {
  const root = teamRepo()
  const reads = await cleanReads()
  const threads = Object.keys(reads).find((key) => key.startsWith('api graphql'))
  const gh = fakeGh({
    [detailView('feat')]: { stdout: detailJson({ number: 7 }) },
    'pr checks 7 --json name,state,bucket,link': { stdout: JSON.stringify([{ name: 'build', state: 'SUCCESS', bucket: 'pass' }]) },
    ...reads,
    [threads]: { status: 1, stderr: 'gh: API rate limit exceeded for user ID 1. (HTTP 403)\n' },
  })
  const result = await call(root, envWith(gh), ['pr', 'status', '--branch', 'feat', '--json'])
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const status = JSON.parse(result.stdout)
  assert.equal(status.pr.number, 7)
  assert.deepEqual(status.checks.map((c) => c.name), ['build'])
  assert.equal(status.blockers.blocked, null)
  assert.deepEqual(status.blockers.unchecked.map((u) => [u.area, u.code]), [['blockers', 'RATE_LIMITED']])
  assert.ok(!ghCalls(gh).some((c) => c.includes('/protection') || c.includes('/rules/')), 'the rate limit stops the blocker reads')
  const text = (await call(root, envWith(gh), ['pr', 'status', '--branch', 'feat'])).stdout
  assert.match(text, /^checks: build pass$/m)
  assert.match(text, /^blockers: not verified \(GitHub rate limit reached\)$/m)
})

test('pr status keeps the pull request when a blocker read fails with a 5xx, and says the blockers are not verified', async () => {
  const root = teamRepo()
  const gh = fakeGh({
    [detailView('feat')]: { stdout: detailJson({ number: 7 }) },
    'pr checks 7 --json name,state,bucket,link': { stdout: '[]' },
    ...(await cleanReads()),
    'api repos/{owner}/{repo}/rules/branches/main?per_page=100&page=1': { status: 1, stderr: 'gh: HTTP 502: Bad Gateway\n' },
  })
  const status = await callJson(root, envWith(gh), ['pr', 'status', '--branch', 'feat'])
  assert.equal(status.pr.number, 7)
  assert.equal(status.blockers.blocked, null)
  assert.deepEqual(status.blockers.unchecked.map((u) => [u.area, u.code]), [['blockers', 'UPSTREAM']])
  assert.match(status.blockers.unchecked[0].message, /502/)
})

test('pr status on a merged pull request reads no blocker', async () => {
  const root = teamRepo()
  const gh = fakeGh({
    [detailView('done')]: { stdout: detailJson({ number: 9, state: 'MERGED', mergedAt: '2026-10-22T10:00:00Z' }) },
    'pr checks 9 --json name,state,bucket,link': { stdout: '[]' },
  })
  const status = await callJson(root, envWith(gh), ['pr', 'status', '--branch', 'done'])
  assert.equal(status.blockers.blocked, false)
  assert.deepEqual(ghCalls(gh), [detailView('done'), 'pr checks 9 --json name,state,bucket,link'])
  assert.doesNotMatch((await call(root, envWith(gh), ['pr', 'status', '--branch', 'done'])).stdout, /blockers:/)
})

test('pr status returns the pull request with checks and reviews, and an empty checks list when there are none', async () => {
  const root = teamRepo()
  const gh = fakeGh({
    [detailView('feat')]: { stdout: detailJson({ number: 7 }, { reviews: [{ state: 'APPROVED' }] }) },
    'pr checks 7 --json name,state,bucket,link': { status: 1, stderr: "no checks reported on the 'feat' branch\n" },
    ...(await cleanReads()),
    [detailView('none')]: { status: 1, stderr: 'no pull requests found for branch "none"\n' },
  })
  const env = envWith(gh)
  const status = await callJson(root, env, ['pr', 'status', '--branch', 'feat'])
  assert.equal(status.branch, 'feat')
  assert.equal(status.pr.number, 7)
  assert.deepEqual(status.checks, [])
  assert.deepEqual(status.reviews, [{ state: 'APPROVED' }])
  const none = await callJson(root, env, ['pr', 'status', '--branch', 'none'])
  assert.deepEqual(none, { branch: 'none', pr: null, checks: [], reviews: [], blockers: null })
})

test('pr status links a failing check to its ci logs run, and leaves a check without a run alone', async () => {
  const root = teamRepo()
  const gh = fakeGh({
    [detailView('feat')]: { stdout: detailJson({ number: 7 }) },
    'pr checks 7 --json name,state,bucket,link': { status: 1, stdout: JSON.stringify([
      { name: 'build', state: 'FAILURE', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/123/job/9' },
      { name: 'lint', state: 'SUCCESS', bucket: 'pass', link: 'https://github.com/o/r/actions/runs/124/job/1' },
      { name: 'ext', state: 'FAILURE', bucket: 'fail', link: 'https://ci.example.com/1' },
    ]) },
    ...(await cleanReads()),
  })
  const env = envWith(gh)
  const status = await callJson(root, env, ['pr', 'status', '--branch', 'feat'])
  assert.deepEqual(status.checks.map((c) => c.runId), [123, 124, null])
  const text = await run(['pr', 'status', '--branch', 'feat'], { env, cwd: root })
  assert.match(text.stdout, /build fail \(ci logs --run 123\)/)
  assert.doesNotMatch(text.stdout, /lint pass \(/)
  assert.doesNotMatch(text.stdout, /ext fail \(/)
})

test('issues branch --dry-run prints the branch name and creates no git branch', async () => {
  const root = teamRepo()
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init')
  git(root, 'branch', '-m', 'main')
  const env = envWith(fakeGh({}))
  const title = (await callJson(root, env, ['issues', 'get', 'ISS-2X6D'])).title
  const before = hashTree(root)
  const result = await callJson(root, env, ['issues', 'branch', 'ISS-2X6D', '--dry-run'])
  assert.deepEqual(result, { branch: branchName('ISS-2X6D', title), from: 'main' })
  assert.equal(git(root, 'branch', '--list', result.branch).stdout.trim(), '')
  assert.equal(hashTree(root), before)
  assert.ok((await call(root, env, ['issues', 'branch', 'ISS-2X6D', '--dry-run'])).stdout.includes(result.branch))
})

test('issues branch creates the branch and records it on the issue', async () => {
  const root = teamRepo()
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init')
  const start = git(root, 'branch', '--show-current').stdout.trim()
  const env = envWith(fakeGh({}))
  const result = await callJson(root, env, ['issues', 'branch', 'ISS-2X6D', '--from', start])
  assert.equal(git(root, 'branch', '--show-current').stdout.trim(), result.branch)
  assert.equal(result.before.branch, undefined)
  assert.equal(result.after.branch, result.branch)
  assert.equal((await callJson(root, env, ['issues', 'get', 'ISS-2X6D'])).branch, result.branch)
})

// A repository that has the default branch only as origin/main: the remote ref is there, the local branch is not (PMK-290).
function remoteOnlyRepo() {
  const root = teamRepo()
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init')
  git(root, 'branch', '-m', 'main')
  addBareOrigin(root, scratch())
  assert.equal(git(root, 'push', '-q', 'origin', 'main').status, 0)
  git(root, 'switch', '-q', '--detach')
  assert.equal(git(root, 'branch', '-D', 'main').status, 0)
  return root
}

test('issues branch with no local default branch starts from origin/<default> and says so', async () => {
  const root = remoteOnlyRepo()
  const env = envWith(fakeGh({}))
  const dry = await callJson(root, env, ['issues', 'branch', 'ISS-2X6D', '--dry-run'])
  assert.equal(dry.from, 'origin/main')
  assert.match((await call(root, env, ['issues', 'branch', 'ISS-2X6D', '--dry-run'])).stdout, /from origin\/main \(no local main\)/)
  const result = await callJson(root, env, ['issues', 'branch', 'ISS-2X6D'])
  assert.equal(result.from, 'origin/main')
  assert.equal(git(root, 'branch', '--show-current').stdout.trim(), result.branch)
  assert.equal(git(root, 'rev-parse', result.branch).stdout, git(root, 'rev-parse', 'refs/remotes/origin/main').stdout)
  // The new branch must not track origin/main, or a bare git push would target the default branch.
  assert.equal(git(root, 'config', '--get', `branch.${result.branch}.remote`).stdout, '')
  assert.equal(git(root, 'rev-parse', '--abbrev-ref', `${result.branch}@{upstream}`).status !== 0, true)
})

// A local main `behind` commits behind the last fetched origin/main (PMK-298).
function behindRepo(behind = 2) {
  const root = teamRepo()
  const commit = (message) => git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', message)
  commit('init')
  git(root, 'branch', '-m', 'main')
  addBareOrigin(root, scratch())
  for (let i = 0; i < behind; i++) commit(`c${i}`)
  assert.equal(git(root, 'push', '-q', 'origin', 'main').status, 0)
  git(root, 'switch', '-q', '--detach')
  assert.equal(git(root, 'update-ref', 'refs/heads/main', `HEAD~${behind}`).status, 0)
  return root
}

test('issues branch with a local default behind origin says how many commits and what to do, on the dry run and the real run', async () => {
  const root = behindRepo(2)
  const env = envWith(fakeGh({}))
  const dry = await call(root, env, ['issues', 'branch', 'ISS-2X6D', '--dry-run'])
  // Like defaultBranchNotes and capabilityNotes, the note goes to stderr in text mode and is not repeated in stdout.
  assert.match(noteLines(dry).join('\n'), /main is 2 commits behind origin\/main.*git pull --ff-only.*--from origin\/main/)
  assert.doesNotMatch(dry.stdout, /behind/)
  const dryRaw = await call(root, env, ['issues', 'branch', 'ISS-2X6D', '--dry-run', '--json'])
  const dryJson = JSON.parse(dryRaw.stdout)
  assert.equal(dryJson.from, 'main')
  assert.ok(dryJson.notes.some((n) => /main is 2 commits behind origin\/main.*--from origin\/main/.test(n)), JSON.stringify(dryJson))
  assert.ok(noteLines(dryRaw).some((n) => /2 commits behind/.test(n)), dryRaw.stderr)
  const real = await call(root, env, ['issues', 'branch', 'ISS-2X6D', '--json'])
  assert.equal(real.code, 0, real.stdout + real.stderr)
  // The branch exists by now, so a pull on main no longer helps: the note gives the rebase of the new branch.
  const realNotes = JSON.parse(real.stdout).notes.join('\n')
  assert.match(realNotes, /main is 2 commits behind origin\/main/)
  assert.match(realNotes, /git rebase --onto origin\/main main iss-2x6d\S*/i)
  assert.doesNotMatch(realNotes, /pull|pass --from/)
  assert.ok(noteLines(real).some((n) => /git rebase --onto/.test(n)), real.stderr)
})

test('issues branch says "1 commit" for one commit behind', async () => {
  const out = await call(behindRepo(1), envWith(fakeGh({})), ['issues', 'branch', 'ISS-2X6D', '--dry-run'])
  assert.match(out.stderr, /main is 1 commit behind origin\/main/)
})

test('issues branch has no behind note when the local default is up to date or ahead, or --from is given', async () => {
  const env = envWith(fakeGh({}))
  const text = async (root, ...extra) => (await call(root, env, ['issues', 'branch', 'ISS-2X6D', '--dry-run', '--json', ...extra])).stdout
  assert.doesNotMatch(await text(behindRepo(2), '--from', 'main'), /behind/)
  const same = behindRepo(2)
  git(same, 'update-ref', 'refs/heads/main', 'refs/remotes/origin/main')
  assert.doesNotMatch(await text(same), /behind/)
  const ahead = behindRepo(2)
  git(ahead, 'update-ref', 'refs/heads/main', 'refs/remotes/origin/main')
  git(ahead, 'switch', '-q', 'main')
  git(ahead, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'local only')
  assert.doesNotMatch(await text(ahead), /behind|diverged/)
})

test('issues branch with a local default that diverged from origin says how many commits on each side and does not suggest a pull', async () => {
  const root = behindRepo(3)
  git(root, 'switch', '-q', 'main')
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'local only')
  const env = envWith(fakeGh({}))
  for (const extra of [['--dry-run'], []]) {
    const result = await call(root, env, ['issues', 'branch', 'ISS-2X6D', ...extra, '--json'])
    assert.equal(result.code, 0, result.stdout + result.stderr)
    const data = JSON.parse(result.stdout)
    assert.equal(data.from, 'main')
    assert.equal(data.notes.length, 1)
    assert.match(data.notes[0], /main has diverged from origin\/main: 1 commit only here, 3 commits only there/)
    assert.doesNotMatch(data.notes[0], /pull|behind/)
    // Dry run: nothing is created yet, so --from is the way. Real run: the branch exists, so rebase it onto origin and leave the local-only commits behind.
    if (extra.length > 0) assert.match(data.notes[0], /--from origin\/main/)
    else {
      assert.match(data.notes[0], /git rebase --onto origin\/main main iss-2x6d\S*/i)
      // The command of the note does what it says: the new branch ends on origin/main, without the commit only main has.
      const [, branch] = data.notes[0].match(/git rebase --onto origin\/main main (\S+)/)
      assert.equal(git(root, 'rebase', '--onto', 'origin/main', 'main', branch).status, 0)
      assert.equal(tipOf(root, branch), tipOf(root, 'origin/main'))
    }
    assert.ok(noteLines(result).some((n) => /diverged/.test(n)), result.stderr)
  }
})

test('issues branch says it could not compare with origin when rev-list fails, and never reads that as up to date', async () => {
  const root = behindRepo(2)
  git(root, 'update-ref', 'refs/heads/main', 'origin/main~1')
  // A missing parent object: both refs resolve to commits, but the history between them cannot be walked.
  const root0 = git(root, 'rev-list', '--max-parents=0', 'origin/main').stdout.trim()
  fs.rmSync(path.join(root, '.git', 'objects', root0.slice(0, 2), root0.slice(2)), { force: true })
  const env = envWith(fakeGh({}))
  const result = await call(root, env, ['issues', 'branch', 'ISS-2X6D', '--dry-run', '--json'])
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.from, 'main')
  assert.match(data.notes.join('\n'), /could not compare main with origin\/main.*--from origin\/main/)
  const real = await call(root, env, ['issues', 'branch', 'ISS-2X6D', '--json'])
  assert.equal(real.code, 0, real.stdout + real.stderr)
  assert.match(JSON.parse(real.stdout).notes.join('\n'), /could not compare main with origin\/main.*git rebase --onto origin\/main main iss-2x6d/i)
  assert.ok(noteLines(result).some((n) => /could not compare/.test(n)), result.stderr)
})

test('issues branch --from <name> that only exists as origin/<name> names --from origin/<name> in the next step', async () => {
  const root = remoteOnlyRepo()
  const env = envWith(fakeGh({}))
  const result = await call(root, env, ['issues', 'branch', 'ISS-2X6D', '--from', 'main', '--json'])
  assert.equal(result.code, 2)
  assert.match(errorOf(result).nextStep, /--from origin\/main/)
})

test('issues branch with an unknown issue id is NOT_FOUND even when the base branch is missing', async () => {
  const root = remoteOnlyRepo()
  const env = envWith(fakeGh({}))
  const result = await call(root, env, ['issues', 'branch', 'ISS-0000', '--from', 'nope', '--json'])
  assert.equal(errorOf(result).code, 'NOT_FOUND')
})

test('issues branch with a --from that does not exist fails with a next step and writes nothing', async () => {
  const root = remoteOnlyRepo()
  const env = envWith(fakeGh({}))
  for (const args of [['--from', 'nope'], ['--from', 'nope', '--dry-run']]) {
    const before = hashTree(root, ['.issues/.cache'])
    const result = await call(root, env, ['issues', 'branch', 'ISS-2X6D', ...args, '--json'])
    assert.equal(result.code, 2)
    assert.equal(errorOf(result).code, 'INVALID_INPUT')
    assert.match(errorOf(result).message, /nope/)
    assert.match(errorOf(result).nextStep, /--from/)
    assert.equal(hashTree(root, ['.issues/.cache']), before)
  }
})

test('issues branch with the default branch neither local nor on origin fails and suggests fetching', async () => {
  const root = teamRepo()
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init')
  git(root, 'branch', '-m', 'other')
  const env = envWith(fakeGh({}))
  const result = await call(root, env, ['issues', 'branch', 'ISS-2X6D', '--json'])
  assert.equal(result.code, 2)
  assert.equal(errorOf(result).code, 'INVALID_INPUT')
  assert.match(errorOf(result).nextStep, /git fetch origin/)
  assert.match(errorOf(result).nextStep, /--from/)
})

test('pr open without a branch on the issue exits 2 with INVALID_INPUT', async () => {
  const root = teamRepo()
  const env = envWith(fakeGh({}))
  const result = await call(root, env, ['pr', 'open', '--issue', 'ISS-2X6D', '--json'])
  assert.equal(result.code, 2)
  const error = errorOf(result)
  assert.equal(error.code, 'INVALID_INPUT')
  assert.equal(error.nextStep, 'pmkit issues branch ISS-2X6D')
})

test('pr open --dry-run returns the title, body and branches without pushing or opening', async () => {
  const root = teamRepo()
  const gh = fakeGh({ [view('feat-x')]: { status: 1, stderr: 'no pull requests found for branch "feat-x"\n' } })
  const env = envWith(gh)
  await callJson(root, env, ['issues', 'update', 'ISS-2X6D', '--branch', 'feat-x'])
  const before = hashTree(root)
  const result = await callJson(root, env, ['pr', 'open', '--issue', 'ISS-2X6D', '--draft', '--dry-run'])
  // issues get is a read, so it writes the query index: check the tree before it.
  assert.equal(fs.existsSync(path.join(root, '.issues', '.cache')), false)
  assert.equal(hashTree(root), before)
  const issue = await callJson(root, env, ['issues', 'get', 'ISS-2X6D'])
  assert.equal(result.title, `${issue.title} (ISS-2X6D)`)
  assert.equal(result.head, 'feat-x')
  assert.equal(result.base, 'main')
  assert.equal(result.draft, true)
  assert.equal(result.existing, false)
  assert.ok(result.body.startsWith('Tracker issue: ISS-2X6D'))
  for (const item of issue.acceptanceCriteria) assert.ok(result.body.includes(`- [${item.done ? 'x' : ' '}] ${item.text}`))
  assert.deepEqual(ghCalls(gh), [view('feat-x')])
})

test('pr open pushes the branch and opens the pull request with gh', async () => {
  const root = teamRepo()
  const remote = scratch()
  addBareOrigin(root, remote)
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init')
  const gh = fakeGh({
    'pr create --title Dead-letter queue for webhooks (ISS-8C4W) --body-file - --head feat-x --base main': { stdout: 'https://github.com/o/r/pull/9\n' },
    [view('feat-x')]: { stdout: prJson({ number: 9, headRefName: 'feat-x' }) },
  })
  const env = envWith(gh)
  git(root, 'switch', '-c', 'feat-x')
  await callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'feat-x'])
  const pr = await callJson(root, env, ['pr', 'open', '--issue', 'ISS-8C4W'])
  assert.equal(pr.number, 9)
  assert.match(git(remote, 'branch', '--list', 'feat-x').stdout, /feat-x/)
})

function pushableRepo() {
  const root = teamRepo()
  const remote = scratch()
  addBareOrigin(root, remote)
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init')
  git(root, 'switch', '-c', 'feat-x')
  return { root, remote }
}

test('pr open on a branch that already has an open pull request pushes and returns it with existing: true', async () => {
  const { root, remote } = pushableRepo()
  const gh = fakeGh({ [view('feat-x')]: { stdout: prJson({ number: 9, headRefName: 'feat-x', isDraft: true }) } })
  const env = envWith(gh)
  await callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'feat-x'])
  const dry = await callJson(root, env, ['pr', 'open', '--issue', 'ISS-8C4W', '--dry-run'])
  assert.equal(dry.existing, true)
  assert.equal(dry.pr.number, 9)
  assert.equal(git(remote, 'branch', '--list', 'feat-x').stdout.trim(), '')
  const pr = await callJson(root, env, ['pr', 'open', '--issue', 'ISS-8C4W'])
  assert.equal(pr.number, 9)
  assert.equal(pr.existing, true)
  assert.match(git(remote, 'branch', '--list', 'feat-x').stdout, /feat-x/)
  assert.ok(ghCalls(gh).every((key) => !key.startsWith('pr create')), ghCalls(gh).join('\n'))
})

test('pr open opens a new pull request when the last one on the branch is merged', async () => {
  const { root } = pushableRepo()
  const gh = fakeGh({
    [view('feat-x')]: { stdout: prJson({ number: 3, headRefName: 'feat-x', state: 'MERGED', mergedAt: '2026-10-20T10:00:00Z' }) },
    'pr create --title Dead-letter queue for webhooks (ISS-8C4W) --body-file - --head feat-x --base main': { stdout: 'https://github.com/o/r/pull/9\n' },
  })
  const env = envWith(gh)
  await callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'feat-x'])
  const pr = await callJson(root, env, ['pr', 'open', '--issue', 'ISS-8C4W'])
  assert.equal(pr.existing, false)
  assert.ok(ghCalls(gh).some((key) => key.startsWith('pr create')))
})

test('pr ready marks the open draft pull request ready, and refuses a ready one or a missing one', async () => {
  const root = teamRepo()
  const gh = fakeGh({
    [view('draft-branch')]: { stdout: prJson({ number: 7, isDraft: true }) },
    'pr ready 7': { stdout: '' },
    [view(7)]: { stdout: prJson({ number: 7, isDraft: false }) },
    [view('ready-branch')]: { stdout: prJson({ number: 8, isDraft: false }) },
    [view('none-branch')]: { status: 1, stderr: 'no pull requests found for branch "none-branch"\n' },
  })
  const env = envWith(gh)
  await callJson(root, env, ['issues', 'update', 'ISS-2X6D', '--branch', 'draft-branch'])
  await callJson(root, env, ['issues', 'update', 'ISS-5N1R', '--branch', 'ready-branch'])
  await callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'none-branch'])

  const dry = await callJson(root, env, ['pr', 'ready', '--issue', 'ISS-2X6D', '--dry-run'])
  assert.equal(dry.number, 7)
  assert.ok(!ghCalls(gh).includes('pr ready 7'))
  const ready = await callJson(root, env, ['pr', 'ready', '--issue', 'ISS-2X6D'])
  assert.equal(ready.isDraft, false)
  assert.ok(ghCalls(gh).includes('pr ready 7'))

  for (const id of ['ISS-5N1R', 'ISS-8C4W']) {
    const result = await call(root, env, ['pr', 'ready', '--issue', id, '--json'])
    assert.equal(result.code, 2, id)
    assert.equal(errorOf(result).code, 'INVALID_INPUT', id)
  }
})

test('pr status on a detached HEAD asks for --branch', async () => {
  const root = teamRepo()
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init')
  git(root, 'checkout', '-q', '--detach')
  const gh = fakeGh({})
  const result = await call(root, envWith(gh), ['pr', 'status', '--json'])
  assert.equal(result.code, 2)
  const error = errorOf(result)
  assert.equal(error.code, 'INVALID_INPUT')
  assert.equal(error.message, 'no current branch (detached HEAD)')
  assert.match(error.nextStep, /--branch/)
  assert.deepEqual(ghCalls(gh), [])
})

test('pr sync reports an issue file it cannot read', async () => {
  const root = teamRepo()
  const env = envWith(fakeGh({}))
  const file = path.join(root, '.issues/issues/ISS-2X6D/issue.md')
  fs.writeFileSync(file, 'not: [an issue\n')
  const result = await callJson(root, env, ['pr', 'sync'])
  assert.deepEqual(result.problems.map((p) => p.id).sort(), ['ISS-2X6D', 'ISS-3Q6T'])
  assert.match((await call(root, env, ['pr', 'sync'])).stdout, /ISS-2X6D: /)
})

test('issues update refuses a branch that starts with a dash', async () => {
  const root = teamRepo()
  const env = envWith(fakeGh({}))
  const result = await call(root, env, ['issues', 'update', 'ISS-2X6D', '--branch=--receive-pack=touch pwned', '--json'])
  assert.equal(result.code, 2)
  assert.equal(errorOf(result).code, 'INVALID_INPUT')
})

test('issues branch with no actor leaves no branch behind and stays on the current branch', async () => {
  const root = teamRepo()
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init')
  const start = git(root, 'branch', '--show-current').stdout.trim()
  const env = envWith(fakeGh({}))
  delete env.PMKIT_USER
  const title = (await callJson(root, envWith(fakeGh({})), ['issues', 'get', 'ISS-2X6D'])).title
  for (const extra of [[], ['--dry-run']]) {
    const result = await call(root, env, ['issues', 'branch', 'ISS-2X6D', '--from', start, ...extra, '--json'])
    assert.equal(result.code, 2, result.stdout)
  }
  assert.equal(git(root, 'branch', '--show-current').stdout.trim(), start)
  assert.equal(git(root, 'branch', '--list', branchName('ISS-2X6D', title)).stdout.trim(), '')
})

function branchWithChange(root) {
  const commit = (message) => git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '-qam', message)
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n')
  git(root, 'add', 'a.txt')
  commit('init')
  const base = git(root, 'branch', '--show-current').stdout.trim()
  git(root, 'switch', '-qc', 'feat')
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\ntwo\nthree\nfour\n')
  commit('change')
  return base
}

const NO_PR = { status: 1, stderr: 'no pull requests found for branch "feat"\n' }

test('pr diff returns the pull request diff when the branch has a pull request', async () => {
  const root = teamRepo()
  const gh = fakeGh({
    [view('feat')]: { stdout: prJson({ number: 7 }) },
    'pr diff 7 --color never': { stdout: 'diff --git a/a b/a\n+x\n' },
  })
  const data = await callJson(root, envWith(gh), ['pr', 'diff', '--branch', 'feat'])
  assert.deepEqual(data, { branch: 'feat', source: 'pull_request', pr: JSON.parse(prJson({ number: 7 })), base: null, uncommitted: false, uncommittedIncluded: false, untracked: 0, incomplete: false, diff: 'diff --git a/a b/a\n+x\n', truncated: false, lines: 2, file: null, files: [{ path: 'a', lines: 2, cut: false }] })
  const text = (await call(root, envWith(gh), ['pr', 'diff', '--branch', 'feat'])).stdout
  assert.match(text, /^pull request #7, 2 lines\ndiff --git a\/a b\/a\n\+x\n/)
})

test('pr diff reads the local diff when the branch has no pull request', async () => {
  const root = teamRepo()
  const base = branchWithChange(root)
  const gh = fakeGh({ [view('feat')]: NO_PR })
  const data = await callJson(root, envWith(gh), ['pr', 'diff', '--branch', 'feat', '--base', base])
  assert.equal(data.source, 'local')
  assert.equal(data.pr, null)
  assert.equal(data.base, base)
  assert.match(data.diff, /^diff --git a\/a\.txt b\/a\.txt/)
  assert.match(data.diff, /\+two\n\+three\n\+four\n/)
  assert.equal(data.truncated, false)
  assert.match((await call(root, envWith(gh), ['pr', 'diff', '--branch', 'feat', '--base', base])).stdout, new RegExp(`^local diff of feat against ${base}, `))
})

const noteLines = (result) => result.stderr.split('\n').filter((line) => line.startsWith('note: '))

test('pr diff of a pull request closed without merge reads the local diff and says why', async () => {
  const root = teamRepo()
  const base = branchWithChange(root)
  const gh = fakeGh({ [view('feat')]: { stdout: prJson({ number: 7, state: 'CLOSED' }) } })
  const result = await call(root, envWith(gh), ['pr', 'diff', '--branch', 'feat', '--base', base, '--json'])
  const data = JSON.parse(result.stdout)
  assert.equal(data.source, 'local')
  assert.equal(data.pr, null)
  assert.ok(noteLines(result).includes('note: pull request #7 is closed without merge, so this is the local diff'), result.stderr)
  assert.ok(!ghCalls(gh).includes('pr diff 7 --color never'))
})

test('pr diff of a merged pull request reads the pull request diff', async () => {
  const root = teamRepo()
  const gh = fakeGh({
    [view('feat')]: { stdout: prJson({ number: 7, state: 'MERGED', mergedAt: '2026-10-29T10:00:00Z' }) },
    'pr diff 7 --color never': { stdout: 'merged diff\n' },
  })
  const data = await callJson(root, envWith(gh), ['pr', 'diff', '--branch', 'feat'])
  assert.deepEqual([data.source, data.pr.number, data.diff], ['pull_request', 7, 'merged diff\n'])
})

test('pr diff falls back to the local diff when GitHub refuses the diff as too large', async () => {
  const root = teamRepo()
  const base = branchWithChange(root)
  const gh = fakeGh({
    [view('feat')]: { stdout: prJson({ number: 7 }) },
    'pr diff 7 --color never': { status: 1, stderr: 'could not find pull request diff: HTTP 406: Sorry, the diff exceeded the maximum number of lines (20000)\n' },
  })
  const result = await call(root, envWith(gh), ['pr', 'diff', '--branch', 'feat', '--base', base, '--json'])
  assert.equal(result.code, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.source, 'local')
  assert.equal(data.pr?.number, 7, 'the open pull request stays in the result, so its checks and a review are still read')
  assert.match(data.diff, /\+two/)
  assert.ok(noteLines(result).includes('note: GitHub refused the diff of pull request #7 because it is too large, so this is the local diff'), result.stderr)
})

test('pr diff without a pull request includes the staged and unstaged changes of the checked out branch', async () => {
  const root = teamRepo()
  const base = branchWithChange(root)
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\ntwo\nthree\nfour\nfive\n')
  const gh = fakeGh({ [view('feat')]: NO_PR })
  const result = await call(root, envWith(gh), ['pr', 'diff', '--branch', 'feat', '--base', base, '--json'])
  const data = JSON.parse(result.stdout)
  assert.equal(data.uncommitted, true)
  assert.match(data.diff, /\+four\n\+five\n/)
  assert.ok(noteLines(result).includes('note: the local diff includes the uncommitted changes of tracked files'), result.stderr)
})

test('pr diff with a pull request says when local commits are not on origin', async () => {
  const root = teamRepo()
  const base = branchWithChange(root)
  addBareOrigin(root, scratch())
  git(root, 'push', '-q', 'origin', 'feat')
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\ntwo\nthree\nfour\nsix\n')
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '-qam', 'unpushed')
  const gh = fakeGh({ [view('feat')]: { stdout: prJson({ number: 7 }) }, 'pr diff 7 --color never': { stdout: 'pr diff\n' } })
  const result = await call(root, envWith(gh), ['pr', 'diff', '--branch', 'feat', '--base', base, '--json'])
  assert.equal(JSON.parse(result.stdout).source, 'pull_request')
  assert.ok(noteLines(result).includes('note: feat has 1 local commit that is not on origin, so the pull request diff does not include it'), result.stderr)
})

test('pr diff uses the current branch and git_host.default_branch by default', async () => {
  const root = teamRepo()
  const base = branchWithChange(root)
  const file = path.join(root, '.pmkit/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('default_branch: main', `default_branch: ${base}`))
  const gh = fakeGh({ [view('feat')]: NO_PR })
  const data = await callJson(root, envWith(gh), ['pr', 'diff'])
  assert.equal(data.branch, 'feat')
  assert.equal(data.base, base)
  assert.equal(data.source, 'local')
})

test('pr diff keeps the first --max-lines lines and says it cut the rest', async () => {
  const root = teamRepo()
  const log = `${Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n')}\n`
  const gh = fakeGh({ [view('feat')]: { stdout: prJson({ number: 7 }) }, 'pr diff 7 --color never': { stdout: log } })
  const data = await callJson(root, envWith(gh), ['pr', 'diff', '--branch', 'feat', '--max-lines', '3'])
  assert.equal(data.truncated, true)
  assert.equal(data.lines, 10)
  assert.equal(data.diff, 'line 0\nline 1\nline 2\n')
  assert.match((await call(root, envWith(gh), ['pr', 'diff', '--branch', 'feat', '--max-lines', '3'])).stdout, /^pull request #7, first 3 of 10 lines\n/)
})

const TWO_FILES = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n x\n+y\ndiff --git a/b c.txt b/b c.txt\n--- a/b c.txt\n+++ b/b c.txt\n@@ -1 +1,3 @@\n x\n+y\n+z\n'

test('pr diff lists its files and marks the ones the cut reaches', async () => {
  const root = teamRepo()
  const gh = fakeGh({ [view('feat')]: { stdout: prJson({ number: 7 }) }, 'pr diff 7 --color never': { stdout: TWO_FILES } })
  const whole = await callJson(root, envWith(gh), ['pr', 'diff', '--branch', 'feat'])
  assert.deepEqual(whole.files, [{ path: 'a.txt', lines: 6, cut: false }, { path: 'b c.txt', lines: 7, cut: false }])
  const cut = await callJson(root, envWith(gh), ['pr', 'diff', '--branch', 'feat', '--max-lines', '8'])
  assert.deepEqual(cut.files, [{ path: 'a.txt', lines: 6, cut: false }, { path: 'b c.txt', lines: 7, cut: true }])
})

test('pr diff --file reads one file of the diff, and refuses a file the diff does not hold', async () => {
  const root = teamRepo()
  const gh = fakeGh({ [view('feat')]: { stdout: prJson({ number: 7 }) }, 'pr diff 7 --color never': { stdout: TWO_FILES } })
  const one = await callJson(root, envWith(gh), ['pr', 'diff', '--branch', 'feat', '--file', 'b c.txt', '--max-lines', '5'])
  assert.equal(one.diff, 'diff --git a/b c.txt b/b c.txt\n--- a/b c.txt\n+++ b/b c.txt\n@@ -1 +1,3 @@\n x\n')
  assert.deepEqual([one.file, one.lines, one.truncated, one.files], ['b c.txt', 7, true, [{ path: 'b c.txt', lines: 7, cut: true }]])
  assert.match((await call(root, envWith(gh), ['pr', 'diff', '--branch', 'feat', '--file', 'b c.txt'])).stdout, /^pull request #7, b c\.txt, 7 lines\n/)
  const missing = await call(root, envWith(gh), ['pr', 'diff', '--branch', 'feat', '--file', 'nope.txt', '--json'])
  assert.equal(missing.code, 2)
  assert.equal(errorOf(missing).code, 'INVALID_INPUT')
  assert.match(errorOf(missing).message, /nope\.txt is not in the diff/)
})

test('pr diff of an empty diff has no lines', async () => {
  const root = teamRepo()
  const gh = fakeGh({ [view('feat')]: { stdout: prJson({ number: 7 }) }, 'pr diff 7 --color never': { stdout: '' } })
  const data = await callJson(root, envWith(gh), ['pr', 'diff', '--branch', 'feat'])
  assert.deepEqual([data.diff, data.lines, data.truncated], ['', 0, false])
})

test('pr diff refuses bad flags before gh or git runs', async () => {
  const root = teamRepo()
  const gh = fakeGh({})
  for (const args of [['--max-lines', '0'], ['--max-lines', 'x'], ['--branch', '-x'], ['--branch', 'feat', '--base', '-y']]) {
    const result = await call(root, envWith(gh), ['pr', 'diff', ...args, '--json'])
    assert.equal(result.code, 2, args.join(' '))
    assert.equal(errorOf(result).code, 'INVALID_INPUT', args.join(' '))
  }
  assert.deepEqual(ghCalls(gh), [])
})

test('pr diff refuses a repository with no git host', async () => {
  const root = teamRepo({ github: false })
  const result = await call(root, envWith(fakeGh({})), ['pr', 'diff', '--branch', 'feat', '--json'])
  assert.equal(result.code, 2)
  assert.equal(errorOf(result).code, 'NOT_SUPPORTED')
})

const RULES = 'api repos/{owner}/{repo}/rules/branches/main?per_page=100&page=1'
const blockerGh = (over = {}) => ({
  [detailView('feat')]: { stdout: detailJson({ number: 7 }, { reviews: [{ author: { login: 'ann' }, state: 'CHANGES_REQUESTED' }], reviewRequests: [{ __typename: 'User', login: 'bob' }], mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', reviewDecision: 'CHANGES_REQUESTED' }) },
  'pr checks 7 --json name,state,bucket,link': { status: 8, stdout: JSON.stringify([{ name: 'build', state: 'FAILURE', bucket: 'fail' }, { name: 'lint', state: 'PENDING', bucket: 'pending' }]) },
  [RULES]: { stdout: '[]' },
  ...over,
})

/** fakeGh matches whole argument strings, and the graphql call carries the query, so the key is built from the real call. */
async function graphqlKey() {
  const { createGithubHost } = await import('./lib/github/host.mjs')
  let key
  createGithubHost({ root: '.', env: {}, exec: (cmd, args) => { key = args.join(' '); return { status: 0, stdout: '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false},"nodes":[]}}}}}', stderr: '' } } }).prThreads(7)
  return key
}

test('pr blockers lists checks, reviews, conflicts, open threads and policies', async () => {
  const root = teamRepo()
  const key = await graphqlKey()
  const threads = { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [{ isResolved: false, isOutdated: false, path: 'a.js', line: 4, comments: { nodes: [{ url: 'https://x/c', author: { login: 'ann' } }] } }] } } } } }
  const gh = fakeGh(blockerGh({
    [key]: { stdout: JSON.stringify(threads) },
    'api repos/{owner}/{repo}/branches/main/protection': { stdout: JSON.stringify({ required_pull_request_reviews: { required_approving_review_count: 1 }, required_status_checks: { contexts: ['build'] } }) },
    [RULES]: { stdout: JSON.stringify([{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'lint' }] } }]) },
  }))
  const data = await callJson(root, envWith(gh), ['pr', 'blockers', '--branch', 'feat'])
  assert.equal(data.branch, 'feat')
  assert.equal(data.pr.number, 7)
  assert.equal('detail' in data.pr, false)
  assert.equal(ghCalls(gh).filter((c) => c.startsWith('pr view')).length, 1)
  assert.equal(data.blocked, true)
  assert.deepEqual(data.checks.failing.map((c) => c.name), ['build'])
  assert.deepEqual(data.checks.pending.map((c) => c.name), ['lint'])
  assert.deepEqual(data.reviews.changesRequested, ['ann'])
  assert.deepEqual(data.reviews.requested, ['bob'])
  assert.equal(data.conflicts.conflicting, true)
  assert.equal(data.threads.open[0].path, 'a.js')
  assert.deepEqual(data.policies.unmet, ['needs 1 more approval (0 of 1)', 'required check build does not pass', 'required check lint does not pass'])
  assert.deepEqual(data.policies.rulesets, ['required_status_checks'])
  assert.deepEqual(data.unchecked, [])
  const text = (await call(root, envWith(gh), ['pr', 'blockers', '--branch', 'feat'])).stdout
  assert.match(text, /^#7 /)
  for (const word of ['checks:', 'reviews:', 'conflicts:', 'threads:', 'policies:']) assert.ok(text.includes(word), word)
})

test('pr blockers reports a refused protection read as not checked and still exits 0', async () => {
  const root = teamRepo()
  const key = await graphqlKey()
  const gh = fakeGh(blockerGh({
    [key]: { status: 1, stderr: 'gh: Resource not accessible by integration (HTTP 403)\n' },
    'api repos/{owner}/{repo}/branches/main/protection': { status: 1, stderr: 'gh: Resource not accessible by integration (HTTP 403)\n' },
  }))
  const data = await callJson(root, envWith(gh), ['pr', 'blockers', '--branch', 'feat'])
  assert.equal(data.threads, null)
  assert.equal(data.policies.protected, null)
  assert.deepEqual(data.policies.unread, ['branch protection'])
  assert.deepEqual(data.unchecked.map((u) => u.area), ['threads', 'policies'])
  assert.equal(data.blocked, true)
  const text = (await call(root, envWith(gh), ['pr', 'blockers', '--branch', 'feat'])).stdout
  assert.match(text, /threads: not checked/)
  assert.match(text, /policies: not read: branch protection/)
})

test('pr blockers of a branch without a pull request has no verdict (blocked null) and is not an error', async () => {
  const root = teamRepo()
  const gh = fakeGh({ [detailView('none')]: { status: 1, stderr: 'no pull requests found for branch "none"\n' } })
  const data = await callJson(root, envWith(gh), ['pr', 'blockers', '--branch', 'none'])
  assert.equal(data.pr, null)
  assert.equal(data.blocked, null)
  assert.match((await call(root, envWith(gh), ['pr', 'blockers', '--branch', 'none'])).stdout, /no pull request for none/)
})

test('pr blockers of a merged pull request is not blocked and reads nothing more', async () => {
  const root = teamRepo()
  const gh = fakeGh({ [detailView('done')]: { stdout: detailJson({ number: 9, state: 'MERGED', mergedAt: '2026-10-22T10:00:00Z' }) } })
  const data = await callJson(root, envWith(gh), ['pr', 'blockers', '--branch', 'done'])
  assert.equal(data.blocked, false)
  assert.equal(data.state, 'MERGED')
  assert.deepEqual(ghCalls(gh), [detailView('done')])
})

test('pr blockers with git_host.system none is NOT_SUPPORTED', async () => {
  const root = teamRepo({ github: false })
  const result = await call(root, envWith(fakeGh({})), ['pr', 'blockers', '--branch', 'x', '--json'])
  assert.equal(result.code, 2)
  assert.equal(errorOf(result).code, 'NOT_SUPPORTED')
})

const BAD_BRANCH = 'main; curl x|sh'
const NOTE = 'note: git_host.default_branch is not a valid branch name, so main is used'
function badBranchRepo() {
  const root = teamRepo()
  const file = path.join(root, '.pmkit/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('default_branch: main', `default_branch: "${BAD_BRANCH}"`))
  return root
}

test('an invalid git_host.default_branch becomes main with a note in issues branch, pr open and pr diff', async () => {
  const root = badBranchRepo()
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init')
  git(root, 'branch', '-m', 'main')
  const env = envWith(fakeGh({ [view('feat')]: NO_PR }))
  const branch = await call(root, env, ['issues', 'branch', 'ISS-2X6D', '--dry-run', '--json'])
  assert.equal(JSON.parse(branch.stdout).from, 'main')
  assert.ok(branch.stderr.includes(NOTE), branch.stderr)
  await callJson(root, env, ['issues', 'update', 'ISS-2X6D', '--branch', 'feat'])
  const open = await call(root, env, ['pr', 'open', '--issue', 'ISS-2X6D', '--dry-run', '--json'])
  assert.equal(JSON.parse(open.stdout).base, 'main')
  assert.ok(open.stderr.includes(NOTE), open.stderr)
  git(root, 'branch', '-M', 'main')
  git(root, 'switch', '-qc', 'feat')
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n')
  git(root, 'add', 'a.txt')
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '-qm', 'a')
  const diff = await call(root, env, ['pr', 'diff', '--json'])
  assert.equal(JSON.parse(diff.stdout).base, 'main')
  assert.ok(diff.stderr.includes(NOTE), diff.stderr)
})

test('a branch with letters outside ASCII is a valid git_host.default_branch', async () => {
  const root = teamRepo()
  const file = path.join(root, '.pmkit/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('default_branch: main', 'default_branch: développement'))
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init')
  git(root, 'branch', '-m', 'développement')
  const result = await call(root, envWith(fakeGh({})), ['issues', 'branch', 'ISS-2X6D', '--dry-run', '--json'])
  assert.equal(JSON.parse(result.stdout).from, 'développement')
  assert.ok(!result.stderr.includes('not a valid branch name'), result.stderr)
})

test('the default_branch fallback note is silent where the base is not used: pr diff from a pull request and pr open on an open one', async () => {
  const root = badBranchRepo()
  const gh = fakeGh({
    [view('feat')]: { stdout: prJson({ number: 7 }) },
    'pr diff 7 --color never': { stdout: 'diff\n' },
  })
  const env = envWith(gh)
  const diff = await call(root, env, ['pr', 'diff', '--branch', 'feat', '--json'])
  assert.equal(diff.code, 0, diff.stdout + diff.stderr)
  assert.ok(!diff.stderr.includes('not a valid branch name'), diff.stderr)
  await callJson(root, env, ['issues', 'update', 'ISS-2X6D', '--branch', 'feat'])
  const open = await call(root, env, ['pr', 'open', '--issue', 'ISS-2X6D', '--dry-run', '--json'])
  assert.equal(JSON.parse(open.stdout).existing, true)
  assert.ok(!open.stderr.includes('not a valid branch name'), open.stderr)
})

// PMK-177: the notes of the local diff, the PR base, merged pull requests and reused branch names.
const commitAll = (root, message = 'all') => {
  git(root, 'add', '-A')
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '-qm', message)
}
const REFS = 'pr view 7 --json baseRefName,headRefOid'
const refs = (baseRefName, headRefOid) => ({ [REFS]: { stdout: JSON.stringify({ baseRefName, headRefOid }) } })
const TOO_LARGE = { status: 1, stderr: 'could not find pull request diff: HTTP 406: Sorry, the diff exceeded the maximum number of lines (20000)\n' }
const MERGED = { number: 7, state: 'MERGED', mergedAt: '2026-10-29T10:00:00Z' }
const tipOf = (root, ref) => git(root, 'rev-parse', ref).stdout.trim()

test('pr diff of a clean checked out branch is not uncommitted and says nothing about it', async () => {
  const root = teamRepo()
  const base = branchWithChange(root)
  commitAll(root)
  const result = await call(root, envWith(fakeGh({ [view('feat')]: NO_PR })), ['pr', 'diff', '--base', base, '--json'])
  const data = JSON.parse(result.stdout)
  assert.deepEqual([data.uncommitted, data.uncommittedIncluded, data.untracked], [false, false, 0])
  assert.ok(!noteLines(result).some((n) => /uncommitted|untracked/.test(n)), result.stderr)
})

test('pr diff counts untracked files, which no diff holds, and says so', async () => {
  const root = teamRepo()
  const base = branchWithChange(root)
  commitAll(root)
  fs.writeFileSync(path.join(root, 'new.txt'), 'x\n')
  const gh = fakeGh({ [view('feat')]: NO_PR })
  const result = await call(root, envWith(gh), ['pr', 'diff', '--base', base, '--json'])
  const data = JSON.parse(result.stdout)
  assert.deepEqual([data.uncommitted, data.untracked], [false, 1])
  assert.ok(noteLines(result).includes('note: 1 untracked file is not in the diff'), result.stderr)
})

test('pr diff with a pull request says the uncommitted changes of the checked out branch are not in it', async () => {
  const root = teamRepo()
  branchWithChange(root)
  commitAll(root)
  fs.writeFileSync(path.join(root, 'a.txt'), 'changed\n')
  const gh = fakeGh({ [view('feat')]: { stdout: prJson({ number: 7 }) }, 'pr diff 7 --color never': { stdout: 'pr diff\n' } })
  const result = await call(root, envWith(gh), ['pr', 'diff', '--json'])
  const data = JSON.parse(result.stdout)
  assert.deepEqual([data.source, data.uncommitted, data.uncommittedIncluded], ['pull_request', true, false])
  assert.ok(noteLines(result).includes('note: feat has uncommitted changes, so the pull request diff does not include them'), result.stderr)
})

test('pr diff local fallback of a stacked pull request uses the PR base, and --base wins', async () => {
  const root = teamRepo()
  const base = branchWithChange(root)
  git(root, 'switch', '-q', base)
  git(root, 'switch', '-qc', 'stack')
  fs.writeFileSync(path.join(root, 'low.txt'), 'lower\n')
  commitAll(root, 'lower')
  git(root, 'switch', '-q', 'feat')
  git(root, 'rebase', '-q', 'stack')
  commitAll(root)
  const gh = fakeGh({ [view('feat')]: { stdout: prJson({ number: 7 }) }, 'pr diff 7 --color never': TOO_LARGE, ...refs('stack', 'abc') })
  const data = await callJson(root, envWith(gh), ['pr', 'diff'])
  assert.equal(data.base, 'stack')
  assert.doesNotMatch(data.diff, /low\.txt/)
  assert.match(data.diff, /a\.txt/)
  const wide = await callJson(root, envWith(gh), ['pr', 'diff', '--base', base])
  assert.match(wide.diff, /low\.txt/)
})

test('pr diff of a merged pull request that GitHub refuses and whose branch left no diff is incomplete, not empty', async () => {
  const root = teamRepo()
  const base = branchWithChange(root)
  git(root, 'switch', '-q', base)
  git(root, 'merge', '-q', '--ff-only', 'feat')
  const gh = fakeGh({ [view('feat')]: { stdout: prJson(MERGED) }, 'pr diff 7 --color never': TOO_LARGE, ...refs(base, tipOf(root, 'feat')) })
  const result = await call(root, envWith(gh), ['pr', 'diff', '--branch', 'feat', '--json'])
  const data = JSON.parse(result.stdout)
  assert.deepEqual([data.source, data.incomplete, data.diff], ['local', true, ''])
  assert.ok(noteLines(result).some((n) => /pull request #7 is merged and GitHub refused its diff as too large/.test(n) && /not available/.test(n)), result.stderr)
})

test('pr diff does not use a merged pull request whose head is not on the branch', async () => {
  const root = teamRepo()
  const base = branchWithChange(root)
  commitAll(root)
  const gh = fakeGh({ [view('feat')]: { stdout: prJson(MERGED) }, ...refs(base, 'f'.repeat(40)) })
  const result = await call(root, envWith(gh), ['pr', 'diff', '--base', base, '--json'])
  const data = JSON.parse(result.stdout)
  assert.deepEqual([data.source, data.pr, data.incomplete], ['local', null, false])
  assert.ok(noteLines(result).includes('note: pull request #7 is merged and its head is not on feat, so it is not used and this is the local diff'), result.stderr)
  assert.ok(!ghCalls(gh).includes('pr diff 7 --color never'))
})

test('pr diff uses a merged pull request whose head is the tip of the branch', async () => {
  const root = teamRepo()
  branchWithChange(root)
  commitAll(root)
  const gh = fakeGh({ [view('feat')]: { stdout: prJson(MERGED) }, 'pr diff 7 --color never': { stdout: 'merged diff\n' }, ...refs('main', tipOf(root, 'feat')) })
  const data = await callJson(root, envWith(gh), ['pr', 'diff'])
  assert.deepEqual([data.source, data.pr.number, data.incomplete], ['pull_request', 7, false])
})

const pushed = (root) => {
  addBareOrigin(root, scratch())
  git(root, 'push', '-q', 'origin', 'feat')
}
const head = (root, ref = 'HEAD') => tipOf(root, ref)

test('pr diff keeps a merged pull request when the local branch is behind or ahead of its head', async () => {
  const root = teamRepo()
  const base = branchWithChange(root)
  commitAll(root)
  fs.writeFileSync(path.join(root, 'h.txt'), 'h\n')
  commitAll(root, 'merged head')
  pushed(root)
  const merged = head(root)
  const gh = fakeGh({ [view('feat')]: { stdout: prJson(MERGED) }, 'pr diff 7 --color never': { stdout: 'merged diff\n' }, ...refs(base, merged) })
  const use = async () => (await callJson(root, envWith(gh), ['pr', 'diff'])).source
  fs.writeFileSync(path.join(root, 'b.txt'), 'b\n')
  commitAll(root, 'ahead')
  assert.equal(await use(), 'pull_request', 'local ahead, head is on origin')
  git(root, 'reset', '-q', '--hard', 'HEAD~2')
  assert.equal(await use(), 'pull_request', 'local behind, head is on origin')
})

test('pr diff keeps a merged pull request when the local branch is ahead of its head and origin is missing', async () => {
  const root = teamRepo()
  const base = branchWithChange(root)
  commitAll(root)
  const merged = head(root)
  fs.writeFileSync(path.join(root, 'b.txt'), 'b\n')
  commitAll(root, 'ahead')
  const gh = fakeGh({ [view('feat')]: { stdout: prJson(MERGED) }, 'pr diff 7 --color never': { stdout: 'merged diff\n' }, ...refs(base, merged) })
  assert.equal((await callJson(root, envWith(gh), ['pr', 'diff'])).source, 'pull_request')
})

test('pr diff of a merged pull request refused with 406 is incomplete when the working tree is dirty but the commits change nothing', async () => {
  const root = teamRepo()
  const base = branchWithChange(root)
  git(root, 'switch', '-q', base)
  git(root, 'merge', '-q', '--ff-only', 'feat')
  git(root, 'switch', '-q', 'feat')
  fs.writeFileSync(path.join(root, 'a.txt'), 'edited\n')
  const gh = fakeGh({ [view('feat')]: { stdout: prJson(MERGED) }, 'pr diff 7 --color never': TOO_LARGE, ...refs(base, head(root)) })
  const data = await callJson(root, envWith(gh), ['pr', 'diff'])
  assert.deepEqual([data.source, data.uncommitted, data.incomplete], ['local', true, true])
  assert.match(data.diff, /edited/)
})

test('pr diff turns an unreadable working tree into a note and incomplete, with or without a pull request', async () => {
  const root = teamRepo()
  const base = branchWithChange(root)
  commitAll(root)
  fs.writeFileSync(path.join(root, '.git/index'), 'not an index')
  const none = await call(root, envWith(fakeGh({ [view('feat')]: NO_PR })), ['pr', 'diff', '--base', base, '--json'])
  assert.equal(none.code, 0, none.stderr)
  assert.equal(JSON.parse(none.stdout).incomplete, true)
  assert.ok(noteLines(none).some((n) => n.startsWith('note: could not read the working tree of feat')), none.stderr)
  const gh = fakeGh({ [view('feat')]: { stdout: prJson({ number: 7 }) }, 'pr diff 7 --color never': { stdout: 'pr diff\n' } })
  const withPr = await call(root, envWith(gh), ['pr', 'diff', '--json'])
  assert.equal(withPr.code, 0, withPr.stderr)
  assert.deepEqual([JSON.parse(withPr.stdout).source, JSON.parse(withPr.stdout).incomplete], ['pull_request', true])
  assert.ok(noteLines(withPr).some((n) => n.startsWith('note: could not read the working tree of feat')), withPr.stderr)
})

test('pr diff falls back to the default branch with a note and incomplete when the base of the pull request is not here', async () => {
  const root = teamRepo()
  const base = branchWithChange(root)
  commitAll(root)
  const file = path.join(root, '.pmkit/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('default_branch: main', `default_branch: ${base}`))
  const gh = fakeGh({ [view('feat')]: { stdout: prJson({ number: 7 }) }, 'pr diff 7 --color never': TOO_LARGE, ...refs('release/9', 'abc') })
  const result = await call(root, envWith(gh), ['pr', 'diff', '--json'])
  assert.equal(result.code, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.deepEqual([data.source, data.base, data.incomplete], ['local', base, true])
  assert.ok(noteLines(result).some((n) => /base release\/9 of pull request #7 does not exist here or on origin/.test(n) && n.includes(base)), result.stderr)
})

test('pr diff counts every untracked file inside a new folder', async () => {
  const root = teamRepo()
  const base = branchWithChange(root)
  commitAll(root)
  fs.mkdirSync(path.join(root, 'dir'))
  for (const name of ['a', 'b', 'c']) fs.writeFileSync(path.join(root, 'dir', name), 'x\n')
  const result = await call(root, envWith(fakeGh({ [view('feat')]: NO_PR })), ['pr', 'diff', '--base', base, '--json'])
  assert.equal(JSON.parse(result.stdout).untracked, 3)
  assert.ok(noteLines(result).includes('note: 3 untracked files are not in the diff'), result.stderr)
})

// pr review (PMK-217): one review on the open pull request of an issue, with inline comments on lines of its diff.
const REVIEW_API = 'api repos/{owner}/{repo}/pulls/7/reviews --method POST --input -'
const REVIEWED = { stdout: JSON.stringify({ id: 99, html_url: 'https://github.com/o/r/pull/7#pullrequestreview-99' }) }

function reviewFiles(comments, body = 'Review against PMK criteria.\n') {
  const dir = scratch()
  fs.writeFileSync(path.join(dir, 'body.md'), body)
  fs.writeFileSync(path.join(dir, 'comments.json'), typeof comments === 'string' ? comments : JSON.stringify(comments))
  return { body: path.join(dir, 'body.md'), comments: path.join(dir, 'comments.json') }
}

async function reviewRepo(canned) {
  const root = teamRepo()
  const gh = fakeGh({ [view('feat')]: { stdout: prJson({ number: 7, headRefName: 'feat' }) }, 'pr diff 7 --color never': { stdout: TWO_FILES }, [REVIEW_API]: REVIEWED, ...refs('main', 'abc123'), ...canned })
  const env = envWith(gh)
  await callJson(root, env, ['issues', 'update', 'ISS-5N1R', '--branch', 'feat'])
  return { root, gh, env }
}

test('pr review previews, then posts one review with the inline comments on the open pull request', async () => {
  const { root, gh, env } = await reviewRepo()
  const files = reviewFiles([{ path: 'b c.txt', line: 3, body: 'gap: no test for z' }])
  const args = ['pr', 'review', '--issue', 'ISS-5N1R', '--body-file', files.body, '--comments-file', files.comments]
  const dry = await callJson(root, env, [...args, '--dry-run'])
  assert.deepEqual(dry, { pr: { number: 7, url: 'https://github.com/o/r/pull/7' }, event: 'COMMENT', commitId: 'abc123', body: 'Review against PMK criteria.\n', comments: [{ path: 'b c.txt', line: 3, body: 'gap: no test for z' }] })
  assert.ok(!ghCalls(gh).includes(REVIEW_API))
  const posted = await callJson(root, env, args)
  assert.deepEqual(posted.review, { id: 99, url: 'https://github.com/o/r/pull/7#pullrequestreview-99' })
  assert.equal(ghCalls(gh).filter((key) => key === REVIEW_API).length, 1)
  assert.match((await call(root, env, [...args, '--dry-run'])).stdout, /^would post a review with 1 inline comment on pull request #7 https:\/\/github\.com\/o\/r\/pull\/7\n/)
})

test('pr review refuses inline comments that do not land on a line of the diff, before any write', async () => {
  const { root, gh, env } = await reviewRepo()
  const cases = [
    [[{ path: 'b c.txt', line: 9, body: 'x' }], /comment 1 \(b c\.txt:9\) is not on a line of the diff/],
    [[{ path: 'nope.txt', line: 1, body: 'x' }], /comment 1 \(nope\.txt:1\) is not on a line of the diff/],
    [[{ path: 'a.txt', line: 1, body: 'ok' }, { path: 'a.txt', line: 2.5, body: 'x' }, { path: 'a.txt', body: 'x' }, { path: 'a.txt', line: 1, body: ' ' }], /comment 2 .*comment 3 .*comment 4 /s],
    ['not json', /is not a JSON array/],
    [{ path: 'a.txt' }, /is not a JSON array/],
  ]
  for (const [comments, message] of cases) {
    for (const dryRun of [['--dry-run'], []]) {
      const files = reviewFiles(comments)
      const result = await call(root, env, ['pr', 'review', '--issue', 'ISS-5N1R', '--body-file', files.body, '--comments-file', files.comments, ...dryRun, '--json'])
      assert.equal(result.code, 2, JSON.stringify(comments))
      assert.equal(errorOf(result).code, 'INVALID_INPUT')
      assert.match(errorOf(result).message, message)
    }
  }
  assert.ok(!ghCalls(gh).includes(REVIEW_API))
})

test('pr review needs a body, an issue with a branch and an open pull request', async () => {
  const { root, gh, env } = await reviewRepo({ [view('closed')]: { stdout: prJson({ number: 8, state: 'CLOSED' }) }, [view('gone')]: NO_PR })
  const empty = reviewFiles([], ' \n')
  const full = reviewFiles([])
  const refused = async (args, message) => {
    const result = await call(root, env, ['pr', 'review', ...args, '--json'])
    assert.equal(result.code, 2, args.join(' '))
    assert.equal(errorOf(result).code, 'INVALID_INPUT', args.join(' '))
    assert.match(errorOf(result).message, message)
  }
  await refused(['--issue', 'ISS-5N1R'], /needs --body-file/)
  await refused(['--body-file', full.body], /needs --issue/)
  await refused(['--issue', 'ISS-5N1R', '--body-file', empty.body], /body is empty/)
  await refused(['--issue', 'ISS-8C4W', '--body-file', full.body], /ISS-8C4W has no branch/)
  await callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'closed'])
  await refused(['--issue', 'ISS-8C4W', '--body-file', full.body], /closed has no open pull request/)
  await callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'gone'])
  await refused(['--issue', 'ISS-8C4W', '--body-file', full.body], /gone has no open pull request/)
  assert.ok(!ghCalls(gh).includes(REVIEW_API))
})

test('pr review refuses inline comments when GitHub refuses the diff as too large, and posts a review with only a body', async () => {
  const { root, gh, env } = await reviewRepo({ 'pr diff 7 --color never': TOO_LARGE })
  const files = reviewFiles([{ path: 'a.txt', line: 1, body: 'x' }])
  const result = await call(root, env, ['pr', 'review', '--issue', 'ISS-5N1R', '--body-file', files.body, '--comments-file', files.comments, '--json'])
  assert.equal(result.code, 2)
  assert.equal(errorOf(result).code, 'INVALID_INPUT')
  assert.match(errorOf(result).message, /too large.*cannot be checked/)
  assert.match(errorOf(result).nextStep, /body/)
  assert.ok(!ghCalls(gh).includes(REVIEW_API))
  const posted = await callJson(root, env, ['pr', 'review', '--issue', 'ISS-5N1R', '--body-file', files.body])
  assert.deepEqual(posted.comments, [])
  assert.ok(ghCalls(gh).includes(REVIEW_API))
})

test('pr diff --file and pr review read the paths git writes with a space (a TAB after it) and outside ASCII (quoted)', async () => {
  const diff = 'diff --git a/docs/my notes.md b/docs/my notes.md\n--- a/docs/my notes.md\t\n+++ b/docs/my notes.md\t\n@@ -1 +1,2 @@\n one\n+two\ndiff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"\n--- "a/caf\\303\\251.txt"\n+++ "b/caf\\303\\251.txt"\n@@ -1 +1,2 @@\n one\n+two\n'
  const { root, env } = await reviewRepo({ 'pr diff 7 --color never': { stdout: diff } })
  const listed = await callJson(root, env, ['pr', 'diff', '--branch', 'feat'])
  assert.deepEqual(listed.files.map((f) => f.path), ['docs/my notes.md', 'café.txt'])
  const one = await callJson(root, env, ['pr', 'diff', '--branch', 'feat', '--file', 'docs/my notes.md'])
  assert.equal(one.lines, 6)
  const files = reviewFiles([{ path: 'docs/my notes.md', line: 2, body: 'x' }, { path: 'café.txt', line: 2, body: 'y' }])
  const dry = await callJson(root, env, ['pr', 'review', '--issue', 'ISS-5N1R', '--body-file', files.body, '--comments-file', files.comments, '--dry-run'])
  assert.equal(dry.comments.length, 2)
})

test('pr review with inline comments reads the head commit before the diff and pins the review to it', async () => {
  const { root, gh, env } = await reviewRepo(refs('main', 'abc123'))
  const files = reviewFiles([{ path: 'a.txt', line: 2, body: 'x' }])
  const dry = await callJson(root, env, ['pr', 'review', '--issue', 'ISS-5N1R', '--body-file', files.body, '--comments-file', files.comments, '--dry-run'])
  assert.equal(dry.commitId, 'abc123')
  const calls = ghCalls(gh)
  assert.ok(calls.indexOf(REFS) < calls.indexOf('pr diff 7 --color never'), calls.join('\n'))
})

test('pr review --redact replaces the secrets of the body and of each inline comment, in the dry run too', async () => {
  const secret = `ghp_${'b'.repeat(36)}`
  const { root, env } = await reviewRepo(refs('main', 'abc123'))
  const files = reviewFiles([{ path: 'a.txt', line: 2, body: `token ${secret}` }], `Body GITHUB_TOKEN=${secret}\n`)
  const args = ['pr', 'review', '--issue', 'ISS-5N1R', '--body-file', files.body, '--comments-file', files.comments, '--redact']
  const dry = await callJson(root, env, [...args, '--dry-run'])
  assert.ok(!JSON.stringify(dry).includes(secret), JSON.stringify(dry))
  assert.equal(dry.redacted.count, 2)
  const plain = await callJson(root, env, [...args.slice(0, -1), '--dry-run'])
  assert.equal(plain.redacted, undefined)
})

// feat-x branches off main, then origin/main gets `ahead` more commits (PMK-305). The last fetch saw them.
function branchBehindRepo(ahead = 2) {
  const root = teamRepo()
  const commit = (message) => git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', message)
  commit('init')
  git(root, 'branch', '-m', 'main')
  const remote = scratch()
  addBareOrigin(root, remote)
  assert.equal(git(root, 'push', '-q', 'origin', 'main').status, 0)
  git(root, 'switch', '-q', '-c', 'feat-x')
  git(root, 'switch', '-q', 'main')
  for (let i = 0; i < ahead; i++) commit(`m${i}`)
  assert.equal(git(root, 'push', '-q', 'origin', 'main').status, 0)
  git(root, 'switch', '-q', 'feat-x')
  return { root, remote }
}

const noPr = { [view('feat-x')]: { status: 1, stderr: 'no pull requests found for branch "feat-x"\n' } }
const createKey = 'pr create --title Dead-letter queue for webhooks (ISS-8C4W) --body-file - --head feat-x --base main'

async function prOpenNotes(root, gh, ...extra) {
  const env = envWith(gh)
  await callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'feat-x'])
  const raw = await call(root, env, ['pr', 'open', '--issue', 'ISS-8C4W', '--json', ...extra])
  assert.equal(raw.code, 0, raw.stdout + raw.stderr)
  return { json: JSON.parse(raw.stdout), raw }
}

test('pr open on a branch behind origin/<default> says how many commits and what to do, on the dry run and the real run, and still pushes', async () => {
  const { root, remote } = branchBehindRepo(2)
  // The last PR of the branch is merged, so pr open takes the new-pull-request path (as in the merged-branch test).
  const gh = fakeGh({ [view('feat-x')]: { stdout: prJson({ number: 3, headRefName: 'feat-x', state: 'MERGED', mergedAt: '2026-10-20T10:00:00Z' }) }, [createKey]: { stdout: 'https://github.com/o/r/pull/9\n' } })
  const dry = await prOpenNotes(root, fakeGh(noPr), '--dry-run')
  assert.ok(dry.json.notes.some((n) => /feat-x is 2 commits behind origin\/main.*git fetch origin.*git rebase origin\/main/.test(n)), JSON.stringify(dry.json.notes))
  assert.ok(noteLines(dry.raw).some((n) => /2 commits behind/.test(n)), dry.raw.stderr)
  assert.doesNotMatch((await call(root, envWith(fakeGh(noPr)), ['pr', 'open', '--issue', 'ISS-8C4W', '--dry-run'])).stdout, /behind/)
  const real = await prOpenNotes(root, gh)
  assert.equal(real.json.existing, false)
  assert.ok(real.json.notes.some((n) => /feat-x is 2 commits behind origin\/main.*git rebase origin\/main/.test(n)), JSON.stringify(real.json))
  assert.ok(noteLines(real.raw).some((n) => /2 commits behind/.test(n)), real.raw.stderr)
  assert.match(git(remote, 'branch', '--list', 'feat-x').stdout, /feat-x/)
})

test('pr open says "1 commit" for one commit behind', async () => {
  const { root } = branchBehindRepo(1)
  const dry = await prOpenNotes(root, fakeGh(noPr), '--dry-run')
  assert.ok(dry.json.notes.some((n) => /is 1 commit behind origin\/main/.test(n)), JSON.stringify(dry.json.notes))
})

test('pr open adds the behind note when the branch already has an open pull request, on the dry run and the real run', async () => {
  const { root, remote } = branchBehindRepo(3)
  const gh = fakeGh({ [view('feat-x')]: { stdout: prJson({ number: 9, headRefName: 'feat-x' }) } })
  for (const extra of [['--dry-run'], []]) {
    const out = await prOpenNotes(root, gh, ...extra)
    assert.equal(out.json.existing, true)
    assert.ok(out.json.notes.some((n) => /3 commits behind origin\/main/.test(n)), JSON.stringify(out.json.notes))
  }
  assert.match(git(remote, 'branch', '--list', 'feat-x').stdout, /feat-x/)
})

test('pr open counts only what the branch lacks: a branch with its own commits is still behind, one with all of origin/<default> is not', async () => {
  const { root } = branchBehindRepo(2)
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'mine')
  const diverged = await prOpenNotes(root, fakeGh(noPr), '--dry-run')
  assert.ok(diverged.json.notes.some((n) => /2 commits behind origin\/main/.test(n)), JSON.stringify(diverged.json.notes))
  git(root, 'merge', '-q', '--no-edit', 'refs/remotes/origin/main')
  const level = await prOpenNotes(root, fakeGh(noPr), '--dry-run')
  assert.doesNotMatch(JSON.stringify(level.json.notes ?? []), /behind|could not compare/)
})

test('pr open has no behind note when the branch is level with origin/<default>, or there is no origin/<default>', async () => {
  const { root } = pushableRepo()
  git(root, 'push', '-q', 'origin', 'HEAD:main')
  const level = await prOpenNotes(root, fakeGh(noPr), '--dry-run')
  assert.doesNotMatch(JSON.stringify(level.json.notes ?? []), /behind|could not compare/)
  assert.doesNotMatch(level.raw.stderr, /behind|could not compare/)
  const bare = pushableRepo()
  const none = await prOpenNotes(bare.root, fakeGh(noPr), '--dry-run')
  assert.doesNotMatch(JSON.stringify(none.json.notes ?? []), /behind|could not compare/)
  assert.doesNotMatch(none.raw.stderr, /behind|could not compare/)
})

test('pr open says it could not compare, not "up to date", when git cannot count', async () => {
  const { root } = branchBehindRepo(2)
  const env = envWith(fakeGh(noPr))
  // The issue names a branch that is not a local branch, so rev-list has nothing to count from.
  await callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'feat-x'])
  git(root, 'switch', '-q', '--detach')
  git(root, 'branch', '-D', 'feat-x')
  const raw = await call(root, env, ['pr', 'open', '--issue', 'ISS-8C4W', '--dry-run', '--json'])
  assert.equal(raw.code, 0, raw.stdout + raw.stderr)
  const notes = JSON.parse(raw.stdout).notes.join('\n')
  assert.match(notes, /could not compare feat-x with origin\/main.*git fetch origin.*git log feat-x\.\.origin\/main/)
  assert.doesNotMatch(notes, /commits? behind|up to date/)
})

test('pr open next step ends with the force-with-lease push when the branch is already on origin, and following it makes the push pass', async () => {
  const { root, remote } = branchBehindRepo(2)
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'mine')
  assert.equal(git(root, 'push', '-q', 'origin', 'feat-x').status, 0)
  const env = envWith(fakeGh({ [view('feat-x')]: { stdout: prJson({ number: 9, headRefName: 'feat-x' }) } }))
  await callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'feat-x'])
  const note = (await callJson(root, env, ['pr', 'open', '--issue', 'ISS-8C4W', '--dry-run'])).notes.join('\n')
  assert.match(note, /2 commits behind origin\/main.*git fetch origin.*git rebase origin\/main, then git push --force-with-lease origin feat-x/)
  // Follow the steps in order: fetch, rebase, push. A plain push would now be refused as non-fast-forward.
  assert.equal(git(root, 'fetch', '-q', 'origin').status, 0)
  assert.equal(git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'rebase', '-q', 'origin/main').status, 0)
  assert.notEqual(git(root, 'push', '-q', 'origin', 'feat-x').status, 0)
  assert.equal(git(root, 'push', '-q', '--force-with-lease', 'origin', 'feat-x').status, 0)
  const pr = await callJson(root, env, ['pr', 'open', '--issue', 'ISS-8C4W'])
  assert.equal(pr.existing, true)
  assert.equal(pr.notes, undefined)
  assert.equal(git(remote, 'rev-parse', 'feat-x').stdout, git(root, 'rev-parse', 'feat-x').stdout)
})

test('pr open next step has no push when the branch is not on origin yet', async () => {
  const { root } = branchBehindRepo(2)
  const dry = await prOpenNotes(root, fakeGh(noPr), '--dry-run')
  const note = dry.json.notes.join('\n')
  assert.match(note, /git rebase origin\/main$/m)
  assert.doesNotMatch(note, /push|force/)
})

test('pr open could-not-compare note also ends with the force-with-lease push when the branch is on origin', async () => {
  const { root } = branchBehindRepo(2)
  git(root, 'push', '-q', 'origin', 'feat-x')
  const env = envWith(fakeGh(noPr))
  await callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'feat-x'])
  git(root, 'switch', '-q', '--detach')
  git(root, 'branch', '-D', 'feat-x')
  git(root, 'update-ref', 'refs/remotes/origin/feat-x', 'refs/remotes/origin/main')
  const notes = (await callJson(root, env, ['pr', 'open', '--issue', 'ISS-8C4W', '--dry-run'])).notes.join('\n')
  assert.match(notes, /could not compare.*git rebase origin\/main, then git push --force-with-lease origin feat-x/)
})
