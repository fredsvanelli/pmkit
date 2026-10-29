import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { run } from './pmkit.mjs'
import { makeRepo, tempDir } from './test-helpers.mjs'
import { fakeGh, ghCalls } from './fake-gh.mjs'
import { readTree } from './scenario-helpers.mjs'

const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'

const envWith = ({ dir, responses }, now = '2026-10-23T12:00:00Z') => ({
  ...process.env,
  PATH: `${dir}${path.delimiter}${process.env.PATH}`,
  PMKIT_FAKE_GH: responses,
  PMKIT_USER: 'fred',
  PMKIT_NOW: now,
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
  return { data: JSON.parse(result.stdout), stderr: result.stderr }
}

const prJson = (overrides = {}) => JSON.stringify({ number: 7, url: 'https://github.com/o/r/pull/7', title: 'T', state: 'OPEN', isDraft: false, headRefName: 'x', author: { login: 'fred' }, mergedAt: null, ...overrides })
const view = (branch) => `pr view ${branch} --json ${VIEW}`

// Sets a branch on an issue by editing its file, so no event is appended and idle days stay as the fixture has them.
function setBranch(root, id, branch) {
  const file = path.join(root, '.issues/issues', id, 'issue.md')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('\ncreated: ', `\nbranch: ${branch}\ncreated: `))
}
const PR_LIST = 'pr list --state open --limit 200 --json number,url,title,headRefName,isDraft,updatedAt,author,statusCheckRollup'
const RUN_LIST = 'run list --branch main --limit 50 --json databaseId,workflowName,status,conclusion,url,createdAt,headSha'

const openPr = (number, headRefName, updatedAt, extra = {}) => ({
  number, url: `https://github.com/o/r/pull/${number}`, title: `PR ${number}`, headRefName, isDraft: false, updatedAt,
  author: { login: 'fred' }, statusCheckRollup: [], ...extra,
})
const FAILING_LINT = [{ __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' }]

/** The canned gh answers of the GitHub cases, as a fresh object so a test can override one key. */
const cannedGh = () => ({
  [PR_LIST]: { stdout: JSON.stringify([
    openPr(11, 'feat-csv', '2026-10-27T10:00:00Z', { isDraft: true }),
    openPr(12, 'feat-old', '2026-10-15T10:00:00Z'),
    openPr(14, 'feat-lint', '2026-10-27T10:00:00Z', { statusCheckRollup: FAILING_LINT }),
  ]) },
  [view('feat-dlq')]: { stdout: prJson({ number: 9, state: 'MERGED', mergedAt: '2026-10-24T10:00:00Z', headRefName: 'feat-dlq' }) },
  [RUN_LIST]: { stdout: '[]' },
})

/** The team fixture with the GitHub host and branches on ISS-2X6D and ISS-8C4W. */
function githubRepo() {
  const root = teamRepo()
  setBranch(root, 'ISS-2X6D', 'feat-csv')
  setBranch(root, 'ISS-8C4W', 'feat-dlq')
  return root
}

test('risks without a git host lists tracker risks and marks pull requests and CI as not checked', async () => {
  const root = teamRepo({ github: false })
  const env = envWith(fakeGh({}))
  const { data, stderr } = await callJson(root, env, ['risks'])
  assert.equal(data.today, '2026-10-23')
  assert.deepEqual(data.thresholds, { stuckBusinessDays: 3, statusUpdateWindowDays: 14 })
  assert.equal(data.gitHost.system, 'none')
  assert.equal(data.gitHost.available, false)
  assert.equal(data.gitHost.reason.code, 'NOT_SUPPORTED')
  assert.deepEqual(data.blocked, [{ id: 'ISS-2X6D', title: 'Billing export to CSV', status: 'in_progress', assignee: 'ana', estimate: 8, blockers: [{ id: 'ISS-5N1R', category: 'in_progress' }] }])
  assert.deepEqual(data.stalledIssues, [{ id: 'ISS-2X6D', title: 'Billing export to CSV', status: 'in_progress', assignee: 'ana', estimate: 8, lastActivity: '2026-10-14T09:00:00Z', idleBusinessDays: 7, reason: 'idle', pr: null }])
  assert.equal(data.stalledPullRequests, null)
  assert.equal(data.ci, null)
  assert.deepEqual(data.epics.map((e) => [e.id, e.reasons, e.lastUpdate]), [['EPC-2M9D', ['no_recent_update'], null]])
  assert.deepEqual(data.problems.map((p) => [p.id, p.code]), [['ISS-3Q6T', 'CONFLICT']])
  assert.ok(stderr.includes('warning: no git host is configured, so issues are stalled by tracker activity only and pull requests and CI are not checked'), stderr)

  const text = await call(root, env, ['risks'])
  assert.equal(text.code, 0, text.stderr)
  assert.ok(text.stdout.startsWith('risks on 2026-10-23: stalled after 3 business days without activity, status updates due every 14 days\ngit host: none, so issues are stalled by tracker activity only and pull requests and CI are not checked\n'), text.stdout)
})

test('risks with the GitHub host lists stalled pull requests, merged branches and failing checks', async () => {
  const root = githubRepo()
  const gh = fakeGh(cannedGh())
  const { data, stderr } = await callJson(root, envWith(gh, '2026-10-28T12:00:00Z'), ['risks'])
  assert.deepEqual(data.gitHost, { system: 'github', available: true })
  // ISS-2X6D is not stalled, because PR 11 counts as its activity.
  assert.deepEqual(data.stalledIssues.map((r) => [r.id, r.reason, r.idleBusinessDays, r.pr]), [['ISS-5N1R', 'idle', 4, null], ['ISS-8C4W', 'pr_merged', 5, 9]])
  assert.deepEqual(data.stalledPullRequests.map((r) => [r.number, r.idleBusinessDays, r.issue]), [[12, 9, null]])
  assert.deepEqual(data.ci, {
    defaultBranch: { branch: 'main', workflows: 0, failing: [] },
    pullRequests: [{ number: 14, title: 'PR 14', url: 'https://github.com/o/r/pull/14', failing: ['lint'] }],
  })
  assert.deepEqual(ghCalls(gh), [PR_LIST, view('feat-dlq'), RUN_LIST])
  const lines = stderr.trim().split('\n').filter((line) => !line.startsWith('note: '))
  assert.equal(lines.length, 1, stderr)
  assert.ok(lines[0].startsWith('warning: ISS-3Q6T: CONFLICT'), stderr)
})

test('risks treats a branch named like an Object property as an ordinary branch', async () => {
  const noHost = teamRepo({ github: false })
  setBranch(noHost, 'ISS-8C4W', 'constructor')
  const idle = (await callJson(noHost, envWith(fakeGh({}), '2026-10-28T12:00:00Z'), ['risks'])).data
  const row = idle.stalledIssues.find((r) => r.id === 'ISS-8C4W')
  assert.deepEqual([row.reason, row.pr], ['idle', null])

  const root = githubRepo()
  setBranch(root, 'ISS-2X6D', 'toString')
  const gh = fakeGh({ ...cannedGh(), [PR_LIST]: { stdout: JSON.stringify([openPr(11, 'toString', '2026-10-01T10:00:00Z')]) } })
  const { data } = await callJson(root, envWith(gh, '2026-10-28T12:00:00Z'), ['risks'])
  assert.deepEqual(data.stalledPullRequests.map((r) => [r.number, r.issue]), [[11, 'ISS-2X6D']])
  const unlinked = fakeGh({ ...cannedGh(), [PR_LIST]: { stdout: JSON.stringify([openPr(12, 'valueOf', '2026-10-01T10:00:00Z')]) } })
  const other = (await callJson(root, envWith(unlinked, '2026-10-28T12:00:00Z'), ['risks'])).data
  assert.deepEqual(other.stalledPullRequests.map((r) => [r.number, r.issue]), [[12, null]])
})

test('risks writes nothing', async () => {
  const root = githubRepo()
  const gh = fakeGh(cannedGh())
  const env = envWith(gh, '2026-10-28T12:00:00Z')
  const before = readTree(root)
  await callJson(root, env, ['risks'])
  assert.deepEqual(readTree(root), before)
  for (const line of ghCalls(gh)) assert.match(line, /^(pr list|pr view|run list) /)
  // The control: a write changes the tree, so the comparison above can fail.
  await callJson(root, env, ['issues', 'assign', 'ISS-5N1R', 'ana'])
  assert.notDeepEqual(readTree(root), before)
})

test("risks keeps the report when an epic's status updates cannot be read", async () => {
  const root = teamRepo({ github: false })
  const dir = path.join(root, '.issues/epics/EPC-2M9D/updates')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '2026-10-20-fred.md'), 'not a status update\n')
  const { data, stderr } = await callJson(root, envWith(fakeGh({})), ['risks'])
  assert.deepEqual(data.epics[0].reasons, ['no_recent_update'])
  assert.equal(data.epics[0].lastUpdate, null)
  assert.ok(data.problems.some((p) => p.id === 'EPC-2M9D' && p.code === 'INVALID_INPUT' && p.message === 'The status update file has no frontmatter.'), JSON.stringify(data.problems))
  assert.ok(stderr.includes('warning: EPC-2M9D: INVALID_INPUT The status update file has no frontmatter.'), stderr)
})

const LOGGED_OUT = { status: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' }

test('risks with a logged out gh lists tracker risks and says how to log in', async () => {
  const root = teamRepo()
  const gh = fakeGh({ ...cannedGh(), [PR_LIST]: LOGGED_OUT })
  const { data, stderr } = await callJson(root, envWith(gh), ['risks'])
  assert.deepEqual(data.gitHost, { system: 'github', available: false, reason: { code: 'AUTH', message: 'GitHub CLI is not logged in', nextStep: 'gh auth login' } })
  assert.equal(data.stalledPullRequests, null)
  assert.equal(data.ci, null)
  assert.deepEqual(data.stalledIssues.map((r) => r.id), ['ISS-2X6D'])
  assert.deepEqual(ghCalls(gh), [PR_LIST])
  assert.ok(stderr.includes('warning: GitHub CLI is not logged in, so issues are stalled by tracker activity only and pull requests and CI are not checked; next: gh auth login'), stderr)
})

test('risks with no gh on the PATH reports NOT_CONFIGURED', async () => {
  const root = teamRepo()
  const env = { ...envWith(fakeGh({})), PATH: tempDir('pmkit-risks-') }
  const { data } = await callJson(root, env, ['risks'])
  assert.equal(data.gitHost.reason.code, 'NOT_CONFIGURED')
  assert.equal(data.stalledPullRequests, null)
})

test('risks drops every host list when gh logs out after pr list', async () => {
  const root = githubRepo()
  const gh = fakeGh({ ...cannedGh(), [RUN_LIST]: LOGGED_OUT })
  const { data } = await callJson(root, envWith(gh, '2026-10-28T12:00:00Z'), ['risks'])
  assert.equal(data.gitHost.reason.code, 'AUTH')
  assert.equal(data.stalledPullRequests, null)
  assert.equal(data.ci, null)
  // Tracker activity only: PR 11 no longer counts for ISS-2X6D, and the merged lookup for ISS-8C4W is dropped.
  assert.deepEqual(data.stalledIssues.map((r) => [r.id, r.reason, r.pr]), [['ISS-2X6D', 'idle', null], ['ISS-5N1R', 'idle', null], ['ISS-8C4W', 'idle', null]])
})

test('risks keeps the pull request lists when only run list fails', async () => {
  const root = githubRepo()
  const gh = fakeGh({ ...cannedGh(), [RUN_LIST]: { status: 1, stderr: 'HTTP 502: Bad Gateway\n' } })
  const { data, stderr } = await callJson(root, envWith(gh, '2026-10-28T12:00:00Z'), ['risks'])
  assert.equal(data.gitHost.available, true)
  assert.deepEqual(data.stalledPullRequests.map((r) => r.number), [12])
  assert.deepEqual(data.ci.pullRequests.map((r) => r.number), [14])
  assert.deepEqual(data.ci.defaultBranch, {
    branch: 'main',
    error: { code: 'UPSTREAM', message: 'gh run list failed: HTTP 502: Bad Gateway', nextStep: 'Check the output of the same command in a terminal' },
  })
  assert.ok(stderr.includes('warning: CI on main not checked: gh run list failed: HTTP 502: Bad Gateway'), stderr)
})

test('risks keeps the CI on main when only pr list fails', async () => {
  const root = githubRepo()
  const gh = fakeGh({ ...cannedGh(), [PR_LIST]: { status: 1, stderr: 'API rate limit exceeded\n' } })
  const { data, stderr } = await callJson(root, envWith(gh, '2026-10-28T12:00:00Z'), ['risks'])
  const error = { error: { code: 'RATE_LIMITED', message: 'GitHub rate limit reached', nextStep: 'Wait a few minutes and retry' } }
  assert.deepEqual(data.stalledPullRequests, error)
  assert.deepEqual(data.ci.pullRequests, error)
  assert.equal(data.ci.defaultBranch.workflows, 0)
  assert.ok(!ghCalls(gh).some((line) => line.startsWith('pr view ')), ghCalls(gh).join('\n'))
  assert.ok(stderr.includes('warning: pull requests not checked: GitHub rate limit reached'), stderr)
})

test('risks keeps an issue idle when its pull request lookup fails', async () => {
  const root = githubRepo()
  const gh = fakeGh({ ...cannedGh(), [view('feat-dlq')]: { status: 1, stderr: 'GraphQL: boom\n' } })
  const { data, stderr } = await callJson(root, envWith(gh, '2026-10-28T12:00:00Z'), ['risks'])
  const row = data.stalledIssues.find((r) => r.id === 'ISS-8C4W')
  assert.equal(row.reason, 'idle')
  assert.equal(row.pr, null)
  assert.ok(stderr.includes('warning: ISS-8C4W: the pull request of feat-dlq could not be read: gh pr view failed: GraphQL: boom'), stderr)
})

test('risks keeps an issue idle when its branch is not a valid ref', async () => {
  const root = githubRepo()
  setBranch(root, 'ISS-8C4W', '-x')
  const gh = fakeGh(cannedGh())
  const result = await call(root, envWith(gh, '2026-10-28T12:00:00Z'), ['risks', '--json'])
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const row = JSON.parse(result.stdout).stalledIssues.find((r) => r.id === 'ISS-8C4W')
  assert.deepEqual([row.reason, row.pr], ['idle', null])
  assert.ok(result.stderr.includes('warning: ISS-8C4W: the pull request of -x could not be read'), result.stderr)
})

test('risks warns when it reads 200 open pull requests', async () => {
  const root = teamRepo()
  const prs = Array.from({ length: 200 }, (_, i) => openPr(i + 1, `b${i + 1}`, '2026-10-22T10:00:00Z'))
  const gh = fakeGh({ [PR_LIST]: { stdout: JSON.stringify(prs) }, [RUN_LIST]: { stdout: '[]' } })
  const { stderr } = await callJson(root, envWith(gh), ['risks'])
  assert.ok(stderr.includes('warning: only the 200 most recently created open pull requests were read'), stderr)
})
