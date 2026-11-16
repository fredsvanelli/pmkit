// PMK-215: `issues track-agents` on Linear finds the pull requests of bot authors, matched to issues by branch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { linearDescriptor } from './lib/linear/adapter.mjs'
import { useLinear } from './fake-hosted.mjs'
import { FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeWorkspace } from './fake-linear-api.mjs'
import { childEnv } from './golden-helpers.mjs'
import { makeRepo, tempDir, userStoreEnv } from './test-helpers.mjs'
import { fakeGh, ghCalls } from './fake-gh.mjs'

process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir())

const LIST = 'pr list --state open --limit 200 --json number,url,title,headRefName,isDraft,updatedAt,author,statusCheckRollup'
const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'
const view = (n) => `pr view ${n} --json ${VIEW},reviews,reviewRequests,mergeable,mergeStateStatus,reviewDecision,baseRefName`
const EMPTY_THREADS = '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false},"nodes":[]}}}}}'
const bot = (login) => ({ login, is_bot: true })
const listed = (number, branch, author) => ({ number, url: `https://github.com/acme/repo/pull/${number}`, title: `T${number}`, headRefName: branch, isDraft: true, updatedAt: '2026-11-09T00:00:00Z', author, statusCheckRollup: [] })
// A draft pull request: the verdict is blocked without any protection read succeeding.
const detail = (number, branch, author) => JSON.stringify({ ...listed(number, branch, author), state: 'OPEN', mergedAt: null, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: '', baseRefName: 'main', reviews: [], reviewRequests: [] })

async function threadsKey() {
  const { createGithubHost } = await import('./lib/github/host.mjs')
  let key
  createGithubHost({ root: '.', env: {}, exec: (cmd, args) => { key = args.join(' '); return { status: 0, stdout: EMPTY_THREADS, stderr: '' } } }).prThreads(1)
  return key.replace('number=1', 'number={N}')
}

async function world({ prs, github = true, seed = [], broken = [] }) {
  const root = useLinear(makeRepo('basic'))
  const file = path.join(root, '.pmkit', 'config.yaml')
  const text = fs.readFileSync(file, 'utf8').replace('    workspace: acme', '    workspace: acme\n    team: ACME')
  fs.writeFileSync(file, github ? text.replace(/git_host:\n  system: \w+/, 'git_host:\n  system: github\n  repo: acme/repo') : text)
  const key = await threadsKey()
  const canned = { [LIST]: { stdout: JSON.stringify(prs) }, 'api repos/{owner}/{repo}/branches/main/protection': { stdout: '{}' }, 'api repos/{owner}/{repo}/rules/branches/main?per_page=100&page=1': { stdout: '[]' } }
  for (const p of prs) {
    canned[view(p.number)] = { stdout: detail(p.number, p.headRefName, p.author) }
    canned[`pr checks ${p.number} --json name,state,bucket,link`] = { stdout: '[]' }
    canned[key.replace('{N}', String(p.number))] = { stdout: EMPTY_THREADS }
  }
  for (const n of broken) canned[view(n)] = { status: 1, stderr: 'HTTP 502 bad gateway' }
  const gh = fakeGh(canned, tempDir('pmkit-track-lin-'))
  const env = { ...childEnv(), ...userStoreEnv().env, LINEAR_API_KEY: FAKE_KEY, PATH: `${gh.dir}${path.delimiter}${process.env.PATH}`, PMKIT_FAKE_GH: gh.responses }
  const fake = fakeLinearIssues()
  for (const row of seed) fake.seed(row)
  const fetch = fakeLinearFetch({ ...fakeWorkspace(), ...fake.routes })
  const cli = (...args) => run(args, { cwd: root, env, adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch }) } })
  return { cli, gh, fake }
}

test('Linear: bot pull requests are listed, matched to an issue by branch, and people are skipped (PMK-215)', async () => {
  const prs = [listed(31, 'acme-1-fix-it', bot('app/claude')), listed(32, 'no-issue-branch', bot('codex[bot]')), listed(33, 'by-a-person', { login: 'ann', is_bot: false })]
  const { cli } = await world({ prs, seed: [{ title: 'Fix it', delegateId: 'user-4' }] })
  // The fake sets branchName from the title; read it the same way the command does.
  const result = await cli('issues', 'track-agents', '--json')
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.source, 'pull_requests')
  assert.deepEqual(data.issues.map((r) => [r.pr.number, r.agent, r.issueMatch]), [[31, 'claude', 'found'], [32, 'codex', 'none']])
  assert.equal(data.issues[0].id, 'ACME-1')
  assert.equal(data.issues[0].delegate, 'agent:user-4')
  assert.equal(data.issues[1].id, null)
  assert.equal(data.issues[0].pr.state, 'draft')
  assert.ok(data.notes.some((n) => /bot/.test(n)))
  assert.match((await cli('issues', 'track-agents')).stdout, /no issue with this branch/)
})

test('Linear: --agent keeps the pull requests of one agent author (PMK-215)', async () => {
  const prs = [listed(31, 'a', bot('app/claude')), listed(32, 'b', bot('codex[bot]'))]
  const { cli } = await world({ prs })
  const data = JSON.parse((await cli('issues', 'track-agents', '--agent', 'codex', '--json')).stdout)
  assert.deepEqual(data.issues.map((r) => r.pr.number), [32])
  const none = JSON.parse((await cli('issues', 'track-agents', '--agent', 'nobody', '--json')).stdout)
  assert.deepEqual(none.issues, [])
  assert.match((await cli('issues', 'track-agents', '--agent', 'nobody')).stdout, /no agent pull request for nobody was found/)
})

test('Linear: a full page of 200 pull requests may be cut, so the list is incomplete (PMK-215)', async () => {
  const prs = Array.from({ length: 200 }, (_, i) => listed(100 + i, `b-${i}`, i === 0 ? bot('app/claude') : { login: 'ann', is_bot: false }))
  const { cli } = await world({ prs })
  const data = JSON.parse((await cli('issues', 'track-agents', '--json')).stdout)
  assert.equal(data.incomplete, true)
  assert.ok(data.warnings.some((w) => /200/.test(w)))
})

test('Linear: no pull request is found as a list of nothing only when the read was whole (PMK-215)', async () => {
  const { cli } = await world({ prs: [] })
  assert.match((await cli('issues', 'track-agents')).stdout, /no open pull request has an agent author/)
})

test('Linear without a git host still answers NOT_SUPPORTED, and the issue path makes no gh call (PMK-215)', async () => {
  const { cli, gh } = await world({ prs: [], github: false })
  const result = await cli('issues', 'track-agents', '--json')
  assert.equal(result.code, 2)
  assert.equal(JSON.parse(result.stdout).error.code, 'NOT_SUPPORTED')
  assert.deepEqual(ghCalls(gh), [])
})

test('Linear: a pull request whose read fails is unknown, never free, and the list is incomplete (PMK-215)', async () => {
  const { cli } = await world({ prs: [listed(41, 'acme-1-fix-it', bot('app/claude'))], broken: [41], seed: [{ title: 'Fix it', delegateId: 'user-4' }] })
  const data = JSON.parse((await cli('issues', 'track-agents', '--json')).stdout)
  assert.equal(data.issues[0].pr.state, 'unknown')
  assert.equal(data.incomplete, true)
  assert.match((await cli('issues', 'track-agents')).stdout, /#41 .*not verified/)
})

test('Linear: dependency bots are skipped and only a pull request with an issue is read in detail (PMK-215 review)', async () => {
  const prs = [listed(51, 'acme-1-fix-it', bot('app/claude')), listed(52, 'dependabot/npm/x', bot('dependabot[bot]')), listed(53, 'lonely', bot('codex[bot]'))]
  const { cli, gh } = await world({ prs, seed: [{ title: 'Fix it', delegateId: 'user-4' }] })
  const data = JSON.parse((await cli('issues', 'track-agents', '--json')).stdout)
  assert.deepEqual(data.issues.map((r) => r.number), [51, 53])
  assert.deepEqual(ghCalls(gh).filter((line) => line.startsWith('pr view')).length, 1)
  const lonely = data.issues[1]
  assert.equal(lonely.pr.state, 'draft')
  assert.equal(lonely.pr.blocked, null)
  assert.match(lonely.pr.unknown.join(), /not read/)
  assert.equal(data.incomplete, false)
})

test('Linear: an issue with no delegate shows its delegation as unknown, not stale (PMK-215 review)', async () => {
  const { cli, fake } = await world({ prs: [listed(61, 'acme-1-fix-it', bot('app/claude'))], seed: [{ title: 'Fix it' }] })
  const file = path.join(tempDir('pmkit-deleg-'), 'c.md')
  fs.writeFileSync(file, 'Delegated to agent:user-4 by fred, to run locally.\n\nDo it.\n')
  assert.equal((await cli('issues', 'comment', 'ACME-1', '--body-file', file)).code, 0)
  const data = JSON.parse((await cli('issues', 'track-agents', '--json')).stdout)
  assert.equal(data.issues[0].delegation.state, 'unknown')
  assert.equal(data.incomplete, false)
})

test('Linear: hasMore says the pull request list may be cut, and --agent agent:<id> is refused with the reason (PMK-215 review)', async () => {
  const prs = Array.from({ length: 200 }, (_, i) => listed(100 + i, `b-${i}`, { login: 'ann', is_bot: false }))
  const { cli } = await world({ prs })
  assert.equal(JSON.parse((await cli('issues', 'track-agents', '--json')).stdout).hasMore, true)
  const refused = await cli('issues', 'track-agents', '--agent', 'agent:user-4', '--json')
  assert.equal(refused.code, 2)
  const error = JSON.parse(refused.stdout).error
  assert.equal(error.code, 'INVALID_INPUT')
  assert.match(error.message, /login of the pull request author/)
})
