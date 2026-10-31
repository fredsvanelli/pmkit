// PMK-58: `issues track-agents` lists the open issues of agent members with the delegation record and the pull request state.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { run } from './pmkit.mjs'
import { delegationComment } from './lib/delegation.mjs'
import { makeRepo, tempDir } from './test-helpers.mjs'
import { fakeGh, ghCalls } from './fake-gh.mjs'

const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'
const view = (branch) => `pr view ${branch} --json ${VIEW}`
const pr = (overrides = {}) => JSON.stringify({ number: 7, url: 'https://github.com/o/r/pull/7', title: 'T', state: 'MERGED', isDraft: false, headRefName: 'x', author: { login: 'a' }, mergedAt: '2026-10-20T00:00:00Z', ...overrides })

function setup({ github = true, canned = {} } = {}) {
  const root = makeRepo('team')
  spawnSync('git', ['init', '-q'], { cwd: root })
  const config = path.join(root, '.issues', 'config.yaml')
  fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace(/^members:\n/m, 'members:\n  agent:claude: { name: Claude, availability: 1 }\n  agent:codex: { name: Codex, availability: 1 }\n'))
  if (github) {
    const file = path.join(root, '.pmkit/config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('system: none', 'system: github\n  default_branch: main'))
  }
  const gh = fakeGh(canned, tempDir('pmkit-track-'))
  const env = { ...process.env, PATH: `${gh.dir}${path.delimiter}${process.env.PATH}`, PMKIT_FAKE_GH: gh.responses, PMKIT_USER: 'fred', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }
  const cli = (...args) => run(args, { env, cwd: root })
  const track = async (...extra) => {
    const result = await cli('issues', 'track-agents', '--json', ...extra)
    assert.equal(result.code, 0, result.stdout + result.stderr)
    return JSON.parse(result.stdout)
  }
  return { root, cli, track, gh }
}

async function delegate(cli, issue, agent, body) {
  const file = path.join(tempDir('pmkit-track-body-'), 'c.md')
  fs.writeFileSync(file, body ?? delegationComment({ issue, agent, by: 'fred', instructions: 'Do it.' }))
  assert.equal((await cli('issues', 'assign', issue, agent)).code, 0)
  assert.equal((await cli('issues', 'comment', issue, '--body-file', file)).code, 0)
}

const dataOf = (result) => result.data ?? result

test('without a git host the rows carry no pull request state and a note says why', async () => {
  const { cli, track } = setup({ github: false })
  await delegate(cli, 'ISS-5N1R', 'agent:claude')
  const out = await track()
  const data = dataOf(out)
  assert.deepEqual(data.issues.map((i) => [i.id, i.assignee, i.delegation.state, i.pr]), [['ISS-5N1R', 'agent:claude', 'current', null]])
  assert.ok(data.notes.some((n) => n.includes('git_host is none')))
})

function setBranch(root, id, branch) {
  const file = path.join(root, '.issues', 'issues', id, 'issue.md')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^status: .*$/m, (line) => `${line}\nbranch: ${branch}`))
}

test('no branch, no pull request, a merged pull request and a failed read are reported per issue', async () => {
  const { root, cli, track } = setup({
    canned: {
      [view('b-merged')]: { stdout: pr() },
      [view('b-none')]: { status: 1, stderr: 'no pull requests found for branch "b-none"' },
      [view('b-broken')]: { status: 1, stderr: 'HTTP 502 bad gateway' },
    },
  })
  for (const id of ['ISS-5N1R', 'ISS-2X6D', 'ISS-8C4W', 'ISS-4M2S']) await delegate(cli, id, 'agent:claude')
  setBranch(root, 'ISS-2X6D', 'b-merged')
  setBranch(root, 'ISS-8C4W', 'b-none')
  setBranch(root, 'ISS-4M2S', 'b-broken')
  const data = dataOf(await track())
  const row = (id) => data.issues.find((i) => i.id === id)
  assert.deepEqual(row('ISS-5N1R').pr, { state: 'no_branch' })
  assert.equal(row('ISS-2X6D').pr.state, 'merged')
  assert.equal(row('ISS-2X6D').pr.number, 7)
  assert.deepEqual(row('ISS-8C4W').pr, { state: 'no_pr' })
  assert.equal(row('ISS-4M2S').pr.state, 'unknown')
  assert.equal(row('ISS-4M2S').problems.length, 1)
  assert.equal(data.incomplete, true)
})

test('an issue handed to another agent since the record is stale, and a CRLF record still reads', async () => {
  const { cli, track } = setup()
  await delegate(cli, 'ISS-5N1R', 'agent:claude')
  await cli('issues', 'assign', 'ISS-5N1R', 'agent:codex')
  const crlf = 'Delegated to agent:codex by fred, to run locally. \r\n\r\nDo it.\r\n'
  await delegate(cli, 'ISS-2X6D', 'agent:codex', crlf)
  const data = dataOf(await track())
  assert.equal(data.issues.find((i) => i.id === 'ISS-5N1R').delegation.state, 'stale')
  assert.equal(data.issues.find((i) => i.id === 'ISS-2X6D').delegation.state, 'current')
})

test('an issue assigned to an agent without a record has delegation none, and humans are not listed', async () => {
  const { cli, track } = setup({ github: false })
  await cli('issues', 'assign', 'ISS-5N1R', 'agent:claude')
  const data = dataOf(await track())
  assert.deepEqual(data.issues.map((i) => [i.id, i.delegation.state]), [['ISS-5N1R', 'none']])
})

test('an issue file that does not parse is a warning and marks the list incomplete', async () => {
  const { root, cli, track } = setup({ github: false })
  await delegate(cli, 'ISS-5N1R', 'agent:claude')
  const file = path.join(root, '.issues', 'issues', 'ISS-2X6D', 'issue.md')
  fs.writeFileSync(file, '---\n<<<<<<< HEAD\n---\n')
  const out = await track()
  assert.equal(dataOf(out).issues.length, 1)
  assert.equal(dataOf(out).incomplete, true)
  assert.ok(dataOf(out).warnings.some((w) => w.includes('ISS-2X6D')))
})

// A pull request that goes through collectBlockers. `kind` picks the verdict: free (blocked false), draft (true) or notReady (null).
const EMPTY_THREADS = '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false},"nodes":[]}}}}}'
async function threadsKey() {
  const { createGithubHost } = await import('./lib/github/host.mjs')
  let key
  createGithubHost({ root: '.', env: {}, exec: (cmd, args) => { key = args.join(' '); return { status: 0, stdout: EMPTY_THREADS, stderr: '' } } }).prThreads(1)
  return key.replace('number=1', 'number={N}')
}
const PROTECTION = 'api repos/{owner}/{repo}/branches/main/protection'
function openPr(key, branch, number, kind) {
  const merge = kind === 'notReady' ? { mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN', reviewDecision: '', baseRefName: 'main' } : { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED', baseRefName: 'main' }
  return {
    [view(branch)]: { stdout: pr({ number, state: 'OPEN', isDraft: kind === 'draft', mergedAt: null }) },
    [`pr checks ${number} --json name,state,bucket`]: { stdout: JSON.stringify([{ name: 'test', state: 'SUCCESS', bucket: 'pass' }]) },
    [`pr view ${number} --json reviews,reviewRequests`]: { stdout: JSON.stringify({ reviews: [{ author: { login: 'ann' }, state: 'APPROVED' }], reviewRequests: [] }) },
    [`pr view ${number} --json mergeable,mergeStateStatus,reviewDecision,baseRefName`]: { stdout: JSON.stringify(merge) },
    [key.replace('{N}', String(number))]: { stdout: EMPTY_THREADS },
  }
}

test('a blocked pull request is never reported as free: blocked true, null and false each come out as they are', async () => {
  const key = await threadsKey()
  const { root, cli, track } = setup({ canned: { ...openPr(key, 'b-draft', 11, 'draft'), ...openPr(key, 'b-wait', 12, 'notReady'), ...openPr(key, 'b-free', 13, 'free'), [PROTECTION]: { stdout: '{}' } } })
  for (const id of ['ISS-5N1R', 'ISS-2X6D', 'ISS-8C4W']) await delegate(cli, id, 'agent:claude')
  setBranch(root, 'ISS-5N1R', 'b-draft')
  setBranch(root, 'ISS-2X6D', 'b-wait')
  setBranch(root, 'ISS-8C4W', 'b-free')
  const data = dataOf(await track())
  const prOf = (id) => data.issues.find((i) => i.id === id).pr
  assert.equal(prOf('ISS-5N1R').state, 'draft')
  assert.equal(prOf('ISS-5N1R').blocked, true)
  assert.deepEqual(prOf('ISS-5N1R').blocking, ['the pull request is a draft'])
  assert.equal(prOf('ISS-2X6D').blocked, null)
  assert.equal(prOf('ISS-8C4W').blocked, false)
  assert.equal(data.incomplete, true)
  assert.ok(data.warnings.some((w) => /not ready/.test(w)), data.warnings.join('\n'))
  const text = (await cli('issues', 'track-agents')).stdout
  assert.match(text, /#11 draft, blocked: the pull request is a draft/)
  assert.match(text, /#12 open, blockers not verified/)
  assert.match(text, /#13 open, nothing blocks it/)
})

test('the branch protection of a base is read once for all the issues', async () => {
  const key = await threadsKey()
  const { root, cli, track, gh } = setup({ canned: { ...openPr(key, 'b-one', 21, 'free'), ...openPr(key, 'b-two', 22, 'free'), [PROTECTION]: { stdout: '{}' } } })
  for (const id of ['ISS-5N1R', 'ISS-2X6D']) await delegate(cli, id, 'agent:claude')
  setBranch(root, 'ISS-5N1R', 'b-one')
  setBranch(root, 'ISS-2X6D', 'b-two')
  await track()
  assert.equal(ghCalls(gh).filter((line) => line === PROTECTION).length, 1)
})

test('after the first RATE_LIMITED no more gh calls are made and one warning is given', async () => {
  const { root, cli, track, gh } = setup({ canned: Object.fromEntries(['b-1', 'b-2', 'b-3'].map((b) => [view(b), { status: 1, stderr: 'API rate limit exceeded' }])) })
  for (const id of ['ISS-5N1R', 'ISS-2X6D', 'ISS-8C4W']) await delegate(cli, id, 'agent:claude')
  setBranch(root, 'ISS-5N1R', 'b-1')
  setBranch(root, 'ISS-2X6D', 'b-2')
  setBranch(root, 'ISS-8C4W', 'b-3')
  const data = dataOf(await track())
  assert.deepEqual(data.issues.map((i) => i.pr.state), ['unknown', 'unknown', 'unknown'])
  assert.equal(ghCalls(gh).length, 1)
  assert.equal(data.warnings.filter((w) => /rate limit/i.test(w)).length, 1, data.warnings.join('\n'))
  assert.equal(data.incomplete, true)
})

test('an issue in triage assigned to an agent is listed', async () => {
  const { cli, track } = setup({ github: false })
  await cli('issues', 'assign', 'ISS-1V9Z', 'agent:claude')
  const data = dataOf(await track())
  assert.deepEqual(data.issues.map((i) => i.id), ['ISS-1V9Z'])
})
