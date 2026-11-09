import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { run } from './pmkit.mjs'
import { makeRepo, tempDir } from './test-helpers.mjs'
import { fakeGh, ghCalls } from './fake-gh.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { PmkitError } from './lib/errors.mjs'

const envWith = ({ dir, responses }) => ({
  ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, PMKIT_FAKE_GH: responses,
  PMKIT_USER: 'fred', PMKIT_NOW: '2026-10-23T12:00:00Z', PMKIT_SEED: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1',
})
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' } })

const PR_LIST = 'pr list --state open --limit 200 --json number,url,title,headRefName,isDraft,updatedAt,author,statusCheckRollup'
const DEPLOYMENTS = 'api repos/{owner}/{repo}/deployments?per_page=20'
const prs = [
  { number: 9, url: 'https://github.com/o/r/pull/9', title: 'DLQ', headRefName: 'feat-dlq', isDraft: false, updatedAt: '2026-10-20T10:00:00Z', author: { login: 'ana' }, statusCheckRollup: [] },
  { number: 11, url: 'https://github.com/o/r/pull/11', title: 'Other', headRefName: 'unrelated', isDraft: true, updatedAt: '2026-10-20T10:00:00Z', author: { login: 'ana' }, statusCheckRollup: [] },
]
const BY_TAG = 'api repos/{owner}/{repo}/deployments?per_page=100&ref=v1.0'
const BY_REF = 'api repos/{owner}/{repo}/deployments?per_page=100&ref=refs%2Ftags%2Fv1.0'
const cannedGh = (extra = {}) => ({
  [BY_TAG]: { stdout: '[]' },
  [BY_REF]: { stdout: '[]' },
  [PR_LIST]: { stdout: JSON.stringify(prs) },
  [DEPLOYMENTS]: { stdout: JSON.stringify([{ id: 5, environment: 'production', ref: 'v1.0', sha: 'abcdef123', created_at: '2026-10-22T10:00:00Z' }]) },
  'api repos/{owner}/{repo}/deployments/5/statuses?per_page=1': { stdout: JSON.stringify([{ state: 'success' }]) },
  ...extra,
})

function repo({ github = true, fixture = 'team' } = {}) {
  const root = makeRepo(fixture)
  git(root, 'init', '-q')
  if (github) {
    const file = path.join(root, '.pmkit/config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('system: none', 'system: github\n  default_branch: main'))
  }
  return root
}
const cli = (root, env, args) => run(args, { env, cwd: root })
const ok = async (root, env, args) => {
  const result = await cli(root, env, args)
  assert.equal(result.code, 0, result.stdout + result.stderr)
  return result
}
const setBranch = (root, id, branch) => {
  const file = path.join(root, '.issues/issues', id, 'issue.md')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('\ncreated: ', `\nbranch: ${branch}\ncreated: `))
}
async function withRelease(root, env) {
  await ok(root, env, ['release', 'create', '1.0', '--tag', 'v1.0'])
  for (const id of ['ISS-8C4W', 'ISS-4P8A']) await ok(root, env, ['issues', 'update', id, '--release', '1.0'])
  setBranch(root, 'ISS-8C4W', 'feat-dlq')
}

test('release-readiness lists the open issues, the pull requests and the deploys of the next planned release', async () => {
  const root = repo()
  const gh = fakeGh(cannedGh())
  const env = envWith(gh)
  await withRelease(root, env)
  const data = JSON.parse((await ok(root, env, ['release-readiness', '--json'])).stdout)
  assert.deepEqual([data.basis, data.reason, data.source.id], ['release', 'next_planned', '1.0'])
  assert.deepEqual(data.issues.open.map((i) => i.id), ['ISS-8C4W'])
  assert.deepEqual(data.issues.counts, { open: 1, done: 1, canceled: 0, total: 2 })
  assert.deepEqual(data.pullRequests.map((p) => [p.number, p.issue]), [[9, 'ISS-8C4W']])
  assert.deepEqual(data.deploys.map((d) => [d.environment, d.state, d.matchesRelease]), [['production', 'success', true]])
  assert.equal(data.ready, false)
  const text = (await ok(root, env, ['release-readiness'])).stdout
  assert.ok(text.startsWith('release 1.0'), text)
  assert.match(text, /not ready/)
})

test('release-readiness without releases uses the milestone due first and says so', async () => {
  const root = repo()
  const env = envWith(fakeGh(cannedGh()))
  await ok(root, env, ['milestone', 'create', 'beta', '--due', '2026-11-01'])
  await ok(root, env, ['issues', 'update', 'ISS-8C4W', '--milestone', 'beta'])
  const result = await ok(root, env, ['release-readiness'])
  assert.ok(result.stdout.startsWith('milestone beta (due 2026-11-01)\nno planned release, so the report uses milestone beta'), result.stdout)
  const data = JSON.parse((await ok(root, env, ['release-readiness', '--json'])).stdout)
  assert.deepEqual([data.basis, data.reason, data.skipped], ['milestone', 'earliest_due_milestone', [{ basis: 'release', reason: 'no_planned_release' }]])
  assert.deepEqual(data.issues.open.map((i) => i.id), ['ISS-8C4W'])
})

test('release-readiness without a release or a milestone uses the active sprint', async () => {
  const root = repo()
  const data = JSON.parse((await ok(root, envWith(fakeGh(cannedGh())), ['release-readiness', '--json'])).stdout)
  assert.deepEqual([data.basis, data.reason, data.source.id], ['sprint', 'active_sprint', '2026-10-12'])
  assert.deepEqual(data.skipped.map((s) => s.basis), ['release', 'milestone'])
})

test('release-readiness --milestone and --sprint pick that basis; flags exclude each other', async () => {
  const root = repo()
  const env = envWith(fakeGh(cannedGh()))
  await ok(root, env, ['milestone', 'create', 'beta'])
  assert.equal(JSON.parse((await ok(root, env, ['release-readiness', '--milestone', 'beta', '--json'])).stdout).reason, 'requested')
  assert.equal(JSON.parse((await ok(root, env, ['release-readiness', '--sprint', 'current', '--json'])).stdout).source.id, '2026-10-12')
  assert.equal((await cli(root, env, ['release-readiness', '--release', '1.0', '--sprint', 'current'])).code, 2)
  const missing = await cli(root, env, ['release-readiness', '--release', '9.9', '--json'])
  assert.equal(JSON.parse(missing.stdout).error.code, 'NOT_FOUND')
})

test('release-readiness with nothing to check is INVALID_INPUT', async () => {
  const root = repo({ github: false, fixture: 'no-sprints' })
  for (const dir of ['releases', 'milestones']) fs.rmSync(path.join(root, '.issues', dir), { recursive: true })
  const result = await cli(root, envWith(fakeGh({})), ['release-readiness', '--json'])
  assert.equal(result.code, 2, result.stdout)
  assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
})

test('release-readiness without a git host marks pull requests and deploys as not checked and ready as unknown', async () => {
  const root = repo({ github: false })
  const env = envWith(fakeGh({}))
  await ok(root, env, ['release', 'create', '2.0'])
  const { stdout, stderr } = await ok(root, env, ['release-readiness', '--json'])
  const data = JSON.parse(stdout)
  assert.equal(data.pullRequests, null)
  assert.equal(data.deploys, null)
  assert.equal(data.gitHost.available, false)
  assert.equal(data.ready, null)
  assert.match(stderr, /no git host/)
})

test('release-readiness with a logged out gh reports the host as unavailable and how to log in', async () => {
  const root = repo()
  const gh = fakeGh(cannedGh({ [PR_LIST]: { status: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' } }))
  const env = envWith(gh)
  await ok(root, env, ['release', 'create', '2.0'])
  const { stdout, stderr } = await ok(root, env, ['release-readiness', '--json'])
  const data = JSON.parse(stdout)
  assert.equal(data.gitHost.reason.code, 'AUTH')
  assert.equal(data.pullRequests, null)
  assert.equal(data.ready, null)
  assert.match(stderr, /gh auth login/)
  assert.deepEqual(ghCalls(gh), [PR_LIST])
})

test('release-readiness keeps the pull requests when only the deploys call fails', async () => {
  const root = repo()
  const env = envWith(fakeGh(cannedGh({ [DEPLOYMENTS]: { status: 1, stderr: 'HTTP 502: Bad Gateway\n' } })))
  await withRelease(root, env)
  const { stdout, stderr } = await ok(root, env, ['release-readiness', '--json'])
  const data = JSON.parse(stdout)
  assert.deepEqual(data.pullRequests.map((p) => p.number), [9])
  assert.equal(data.deploys.error.code, 'UPSTREAM')
  assert.match(stderr, /deploys not checked/)
})

test('release-readiness warns and flags the list when 200 pull requests were read', async () => {
  const root = repo()
  const many = Array.from({ length: 200 }, (_, i) => ({ ...prs[1], number: 100 + i, headRefName: `b${i}` }))
  const env = envWith(fakeGh(cannedGh({ [PR_LIST]: { stdout: JSON.stringify(many) } })))
  await ok(root, env, ['release', 'create', '2.0'])
  const { stdout, stderr } = await ok(root, env, ['release-readiness', '--json'])
  const data = JSON.parse(stdout)
  assert.equal(data.pullRequestsIncomplete, true)
  assert.equal(data.ready, null)
  assert.match(stderr, /200 most recently created/)
})

test('release-readiness skips an issue file that does not parse, warns and does not say ready', async () => {
  const root = repo()
  const env = envWith(fakeGh(cannedGh()))
  await ok(root, env, ['release', 'create', '2.0'])
  fs.writeFileSync(path.join(root, '.issues/issues/ISS-0G5E/issue.md'), '---\n: : bad\n\t- [\n---\n')
  const { stdout, stderr } = await ok(root, env, ['release-readiness', '--json'])
  const data = JSON.parse(stdout)
  assert.equal(data.complete, false)
  assert.equal(data.ready, null)
  assert.ok(data.problems.some((p) => p.id === 'ISS-0G5E'))
  assert.match(stderr, /ISS-0G5E/)
})

test('release-readiness writes nothing', async () => {
  const root = repo()
  const env = envWith(fakeGh(cannedGh()))
  await withRelease(root, env)
  const snapshot = () => spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout
  const before = snapshot()
  await ok(root, env, ['release-readiness'])
  assert.equal(snapshot(), before)
})

test('release-readiness drops the 200 pull requests warning when a later deploys call logs out', async () => {
  const root = repo()
  const many = Array.from({ length: 200 }, (_, i) => ({ ...prs[1], number: 100 + i, headRefName: `b${i}` }))
  const env = envWith(fakeGh(cannedGh({ [PR_LIST]: { stdout: JSON.stringify(many) }, [DEPLOYMENTS]: { status: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' } })))
  await ok(root, env, ['release', 'create', '2.0'])
  const { stdout, stderr } = await ok(root, env, ['release-readiness', '--json'])
  const data = JSON.parse(stdout)
  assert.equal(data.gitHost.reason.code, 'AUTH')
  assert.equal(data.pullRequestsIncomplete, false)
  assert.doesNotMatch(stderr, /200 most recently created/)
})

test('release-readiness keeps the failing checks of a pull request', async () => {
  const root = repo()
  const failing = [{ ...prs[0], statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }] }]
  const env = envWith(fakeGh(cannedGh({ [PR_LIST]: { stdout: JSON.stringify(failing) } })))
  await withRelease(root, env)
  const data = JSON.parse((await ok(root, env, ['release-readiness', '--json'])).stdout)
  assert.deepEqual(data.pullRequests[0].checks, { total: 1, failing: ['test'], pending: 0 })
  assert.match((await ok(root, env, ['release-readiness'])).stdout, /failing: test/)
})

test('release-readiness shows pending checks and never says nothing is open while it lists open work', async () => {
  const root = repo()
  const pending = [{ ...prs[0], statusCheckRollup: [{ __typename: 'CheckRun', name: 'build', status: 'IN_PROGRESS', conclusion: null }] }]
  const env = envWith(fakeGh(cannedGh({ [PR_LIST]: { stdout: JSON.stringify(pending) } })))
  await withRelease(root, env)
  const text = (await ok(root, env, ['release-readiness'])).stdout
  assert.match(text, /1 of 1 checks pending/)
  assert.doesNotMatch(text, /nothing found open/)
})

test('release-readiness labels a milestone by its name', async () => {
  const root = repo()
  const env = envWith(fakeGh(cannedGh()))
  await ok(root, env, ['milestone', 'create', 'beta', '--name', 'Public beta', '--due', '2026-11-01'])
  const text = (await ok(root, env, ['release-readiness', '--milestone', 'beta'])).stdout
  assert.ok(text.startsWith('milestone Public beta (due 2026-11-01)'), text)
})

const localWith = (overrides) => ({
  ...ADAPTERS,
  local: { ...ADAPTERS.local, create: async (...args) => ({ ...(await ADAPTERS.local.create(...args)), ...overrides }) },
})
const fail = (code, message) => async () => { throw new PmkitError(code, message) }
// What Linear with releases on does: the release reads are stubs that answer NOT_SUPPORTED.
const STUB = { listReleases: fail('NOT_SUPPORTED', 'the Linear adapter does not implement listReleases yet') }
const readiness = async (root, env, args, adapters) => {
  const result = await run(['release-readiness', ...args, '--json'], { cwd: root, env, adapters })
  return { ...result, json: JSON.parse(result.stdout) }
}

test('a selector reads only what its basis needs, so --milestone, --sprint and --release survive the release stub and failing reads', async () => {
  const root = repo()
  const env = envWith(fakeGh(cannedGh()))
  await ok(root, env, ['milestone', 'create', 'beta'])
  await ok(root, env, ['release', 'create', '1.0'])
  const adapters = localWith({ ...STUB, currentCycle: fail('UPSTREAM', 'cycles timed out'), listMilestones: fail('RATE_LIMITED', 'slow down') })
  for (const [args, basis] of [[['--milestone', 'beta'], 'milestone'], [['--sprint', '2026-10-12'], 'sprint'], [['--release', '1.0'], 'release']]) {
    const { code, json, stderr } = await readiness(root, env, args, adapters)
    assert.equal(code, 0, stderr)
    assert.deepEqual([json.basis, json.reason], [basis, 'requested'])
    assert.ok(!json.problems.some((p) => ['releases', 'milestones', 'cycles'].includes(p.id)), 'no unused read is attempted')
  }
})

test('--sprint current needs the active sprint: a failing read is the error, not an empty answer', async () => {
  const root = repo()
  const env = envWith(fakeGh(cannedGh()))
  const { code, json } = await readiness(root, env, ['--sprint', 'current'], localWith({ currentCycle: fail('UPSTREAM', 'cycles timed out') }))
  assert.equal(code, 2)
  assert.equal(json.error.code, 'UPSTREAM')
})

test('--sprint current on a tracker without cycles is NOT_SUPPORTED, not "no active sprint"', async () => {
  const root = repo({ github: false })
  const { code, json } = await readiness(root, envWith(fakeGh({})), ['--sprint', 'current'], localWith({ currentCycle: fail('NOT_SUPPORTED', 'cycles absent') }))
  assert.equal(code, 2)
  assert.equal(json.error.code, 'NOT_SUPPORTED')
  assert.match(json.error.message, /no cycles/)
})

test('the release stub on the automatic pick is not read: incomplete, never "no planned release"', async () => {
  const root = repo()
  const env = envWith(fakeGh(cannedGh()))
  const { code, json, stderr } = await readiness(root, env, [], localWith(STUB))
  assert.equal(code, 0, stderr)
  assert.deepEqual(json.skipped[0], { basis: 'release', reason: 'releases_not_read' })
  assert.equal(json.complete, false)
  assert.notEqual(json.ready, true)
  assert.ok(json.problems.some((p) => p.id === 'releases' && p.code === 'NOT_SUPPORTED'))
  assert.match(stderr, /releases not read/)
})

test('a failing read of a rung the pick never reaches does not make the report incomplete', async () => {
  const root = repo()
  const env = envWith(fakeGh(cannedGh()))
  await withRelease(root, env)
  const adapters = localWith({ currentCycle: fail('RATE_LIMITED', 'slow down'), listMilestones: fail('UPSTREAM', 'milestones timed out') })
  const { code, json, stderr } = await readiness(root, env, [], adapters)
  assert.equal(code, 0, stderr)
  assert.equal(json.basis, 'release')
  assert.ok(!json.problems.some((p) => ['milestones', 'cycles'].includes(p.id)))
  assert.doesNotMatch(stderr, /not read/)
})

test('only a transient error is "not read": an INVALID_INPUT or NOT_FOUND from a read is the error', async () => {
  const root = repo()
  const env = envWith(fakeGh(cannedGh()))
  for (const [override, code] of [[{ listReleases: fail('NOT_FOUND', 'x') }, 'NOT_FOUND'], [{ listMilestones: fail('INVALID_INPUT', 'x') }, 'INVALID_INPUT'], [{ currentCycle: fail('CONFLICT', 'x') }, 'CONFLICT']]) {
    const { code: exit, json } = await readiness(root, env, [], localWith(override))
    assert.deepEqual([exit, json.error.code], [2, code])
  }
})

test('the next step of --sprint current without cycles follows what the tracker has', async () => {
  const root = repo({ github: false })
  const { json } = await readiness(root, envWith(fakeGh({})), ['--sprint', 'current'], localWith({ currentCycle: fail('NOT_SUPPORTED', 'cycles absent') }))
  assert.match(json.error.nextStep, /--release <id>/)
  const noReleases = localWith({ currentCycle: fail('NOT_SUPPORTED', 'cycles absent'), capabilities: async () => ({ capabilities: [{ id: 'releases', path: 'absent', enableHint: 'h' }, { id: 'cycles', path: 'absent', enableHint: 'h' }] }) })
  const second = await readiness(root, envWith(fakeGh({})), ['--sprint', 'current'], noReleases)
  assert.doesNotMatch(second.json.error.nextStep, /--release/)
})

test('a transient milestones error falls through to the sprint and says the milestones were not read', async () => {
  const root = repo()
  const env = envWith(fakeGh(cannedGh()))
  const { code, json } = await readiness(root, env, [], localWith({ listMilestones: fail('UPSTREAM', 'milestones timed out') }))
  assert.equal(code, 0)
  assert.equal(json.basis, 'sprint')
  assert.deepEqual(json.skipped.map((s) => s.reason), ['no_planned_release', 'milestones_not_read'])
  assert.deepEqual([json.complete, json.ready], [false, false]) // open work is a fact even when a read failed
})

test('when nothing can be picked and a read failed, that error is the answer, not "nothing to check"', async () => {
  const root = repo()
  const env = envWith(fakeGh(cannedGh()))
  const { code, json } = await readiness(root, env, [], localWith({ listReleases: fail('UPSTREAM', 'releases timed out'), listMilestones: fail('UPSTREAM', 'milestones timed out'), currentCycle: fail('UPSTREAM', 'cycles timed out') }))
  assert.equal(code, 2)
  assert.equal(json.error.code, 'UPSTREAM')
})

test('a release with no issue is not ready: ready is null and empty is true', async () => {
  const root = repo({ fixture: 'no-sprints' })
  const env = envWith(fakeGh(cannedGh()))
  await ok(root, env, ['release', 'create', '2.0'])
  const { json } = await readiness(root, env, ['--release', '2.0'], undefined)
  assert.deepEqual([json.issues.counts.total, json.empty, json.ready], [0, true, null])
  assert.match((await ok(root, env, ['release-readiness', '--release', '2.0'])).stdout, /unknown: the release has no issue that is not canceled/)
})

test('the deploy of the release tag is found when it is older than the 20 newest, and through a refs/tags/ ref', async () => {
  const root = repo()
  const old = (id, ref) => ({ id, environment: 'production', ref, sha: `abcdef${id}`, created_at: '2026-09-01T10:00:00Z' })
  const gh = fakeGh(cannedGh({
    [BY_TAG]: { stdout: JSON.stringify([old(3, 'v1.0')]) },
    [BY_REF]: { stdout: JSON.stringify([old(2, 'refs/tags/v1.0')]) },
    'api repos/{owner}/{repo}/deployments/3/statuses?per_page=1': { stdout: JSON.stringify([{ state: 'success' }]) },
    'api repos/{owner}/{repo}/deployments/2/statuses?per_page=1': { stdout: JSON.stringify([{ state: 'success' }]) },
  }))
  const env = envWith(gh)
  await withRelease(root, env)
  const { json } = await readiness(root, env, [], undefined)
  assert.deepEqual(json.deploys.map((d) => [d.id, d.matchesRelease]), [[5, true], [3, true], [2, true]])
})

test('a failing deploy read by tag makes the deploys an error value, not a partial list', async () => {
  const root = repo()
  const env = envWith(fakeGh(cannedGh({ [BY_REF]: { status: 1, stderr: 'HTTP 502: Bad Gateway\n' } })))
  await withRelease(root, env)
  const { json, stderr } = await readiness(root, env, [], undefined)
  assert.equal(json.deploys.error.code, 'UPSTREAM')
  assert.match(stderr, /deploys not checked/)
})
