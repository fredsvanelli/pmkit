import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { run } from './pmkit.mjs'
import { makeRepo } from './test-helpers.mjs'
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
const callJson = (root, env, args) => {
  const result = call(root, env, [...args, '--json'])
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

test('risks without a git host lists tracker risks and marks pull requests and CI as not checked', () => {
  const root = teamRepo({ github: false })
  const env = envWith(fakeGh({}))
  const { data, stderr } = callJson(root, env, ['risks'])
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

  const text = call(root, env, ['risks'])
  assert.equal(text.code, 0, text.stderr)
  assert.ok(text.stdout.startsWith('risks on 2026-10-23: stalled after 3 business days without activity, status updates due every 14 days\ngit host: none, so issues are stalled by tracker activity only and PRs and CI are not checked\n'), text.stdout)
})

test('risks with the GitHub host lists stalled pull requests, merged branches and failing checks', () => {
  const root = githubRepo()
  const gh = fakeGh(cannedGh())
  const { data, stderr } = callJson(root, envWith(gh, '2026-10-28T12:00:00Z'), ['risks'])
  assert.deepEqual(data.gitHost, { system: 'github', available: true })
  // ISS-2X6D is not stalled, because PR 11 counts as its activity.
  assert.deepEqual(data.stalledIssues.map((r) => [r.id, r.reason, r.idleBusinessDays, r.pr]), [['ISS-5N1R', 'idle', 4, null], ['ISS-8C4W', 'pr_merged', 5, 9]])
  assert.deepEqual(data.stalledPullRequests.map((r) => [r.number, r.idleBusinessDays, r.issue]), [[12, 9, null]])
  assert.deepEqual(data.ci, {
    defaultBranch: { branch: 'main', workflows: 0, failing: [] },
    pullRequests: [{ number: 14, title: 'PR 14', url: 'https://github.com/o/r/pull/14', failing: ['lint'] }],
  })
  assert.deepEqual(ghCalls(gh), [PR_LIST, view('feat-dlq'), RUN_LIST])
  const lines = stderr.trim().split('\n')
  assert.equal(lines.length, 1, stderr)
  assert.ok(lines[0].startsWith('warning: ISS-3Q6T: CONFLICT'), stderr)
})

test('risks writes nothing', () => {
  const root = githubRepo()
  const gh = fakeGh(cannedGh())
  const env = envWith(gh, '2026-10-28T12:00:00Z')
  const before = readTree(root)
  callJson(root, env, ['risks'])
  assert.deepEqual(readTree(root), before)
  for (const line of ghCalls(gh)) assert.match(line, /^(pr list|pr view|run list) /)
  // The control: a write changes the tree, so the comparison above can fail.
  callJson(root, env, ['issues', 'assign', 'ISS-5N1R', 'ana'])
  assert.notDeepEqual(readTree(root), before)
})

test("risks keeps the report when an epic's status updates cannot be read", () => {
  const root = teamRepo({ github: false })
  const dir = path.join(root, '.issues/epics/EPC-2M9D/updates')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '2026-10-20-fred.md'), 'not a status update\n')
  const { data, stderr } = callJson(root, envWith(fakeGh({})), ['risks'])
  assert.deepEqual(data.epics[0].reasons, ['no_recent_update'])
  assert.equal(data.epics[0].lastUpdate, null)
  assert.ok(data.problems.some((p) => p.id === 'EPC-2M9D' && p.code === 'INVALID_INPUT' && p.message === 'The status update file has no frontmatter.'), JSON.stringify(data.problems))
  assert.ok(stderr.includes('warning: EPC-2M9D: INVALID_INPUT The status update file has no frontmatter.'), stderr)
})
