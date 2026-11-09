import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { run } from './pmkit.mjs'
import { makeRepo } from './test-helpers.mjs'
import { fakeGh, ghCalls } from './fake-gh.mjs'

const envWith = ({ dir, responses }) => ({
  ...process.env,
  PATH: `${dir}${path.delimiter}${process.env.PATH}`,
  PMKIT_FAKE_GH: responses,
  PMKIT_USER: 'fred',
  PMKIT_NOW: '2026-10-23T12:00:00Z',
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
})

function teamRepo({ github = true } = {}) {
  const root = makeRepo('team')
  spawnSync('git', ['init', '-q'], { cwd: root, env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' } })
  if (github) {
    const file = path.join(root, '.pmkit/config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('system: none', 'system: github\n  default_branch: main'))
  }
  return root
}

const call = (root, env, args) => run([...args, '--json'], { env, cwd: root })
const DEPLOYMENTS = 'api repos/{owner}/{repo}/deployments?per_page=20'
const STATUSES = (...ids) => `api graphql -f query=query($ids: [ID!]!) { nodes(ids: $ids) { ... on Deployment { latestStatus { state logUrl environmentUrl } } } } ${ids.map((id) => `ids[]=${id}`).join(' ')}`
const META = (id) => `run view ${id} --json workflowName,url,conclusion,status`
const RUNS = 'run list --branch main --limit 50 --json databaseId,workflowName,status,conclusion,url,createdAt,headSha'

test('deploys list prints the deployments with their state', async () => {
  const root = teamRepo()
  const gh = fakeGh({
    [DEPLOYMENTS]: { stdout: JSON.stringify([{ id: 5, node_id: 'N5', environment: 'production', ref: 'main', sha: 'abc', created_at: '2026-10-22T10:00:00Z' }]) },
    [STATUSES('N5')]: { stdout: JSON.stringify({ data: { nodes: [{ latestStatus: { state: 'SUCCESS', logUrl: 'https://l/5' } }] } }) },
  })
  const result = await call(root, envWith(gh), ['deploys', 'list'])
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const data = JSON.parse(result.stdout)
  assert.deepEqual(data.deploys.map((d) => [d.id, d.environment, d.state]), [[5, 'production', 'success']])
  const text = await run(['deploys', 'list'], { env: envWith(gh), cwd: root })
  assert.match(text.stdout, /production/)
  assert.match(text.stdout, /success/)
})

test('deploys list keeps the list and says the state is unknown when the status read fails', async () => {
  const root = teamRepo()
  const gh = fakeGh({
    [DEPLOYMENTS]: { stdout: JSON.stringify([{ id: 5, node_id: 'N5', environment: 'production', ref: 'main', sha: 'abc', created_at: '2026-10-22T10:00:00Z' }]) },
    [STATUSES('N5')]: { status: 1, stderr: 'HTTP 502: Bad Gateway' },
  })
  const json = await call(root, envWith(gh), ['deploys', 'list'])
  assert.equal(json.code, 0, json.stdout + json.stderr)
  const data = JSON.parse(json.stdout)
  assert.equal(data.deploys[0].state, null)
  assert.match(data.deploys[0].statusError, /502/)
  const text = await run(['deploys', 'list'], { env: envWith(gh), cwd: root })
  assert.match(text.stdout, /production unknown main/)
  assert.match(text.stderr, /state of 1 deployment\(s\) is unknown/)
})

test('deploys list with no deployments says so', async () => {
  const root = teamRepo()
  const gh = fakeGh({ [DEPLOYMENTS]: { stdout: '[]' } })
  const result = await run(['deploys', 'list'], { env: envWith(gh), cwd: root })
  assert.equal(result.code, 0)
  assert.match(result.stdout, /no deployments/)
})

test('deploys list refuses a bad limit before gh runs', async () => {
  const root = teamRepo()
  const gh = fakeGh({})
  for (const limit of ['0', '101', 'x']) {
    const result = await call(root, envWith(gh), ['deploys', 'list', '--limit', limit])
    assert.equal(result.code, 2)
    assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
  }
  assert.deepEqual(ghCalls(gh), [])
})

test('ci logs prints the log of the newest failed run of a branch', async () => {
  const root = teamRepo()
  const gh = fakeGh({
    [RUNS]: { stdout: JSON.stringify([{ databaseId: 42, workflowName: 'CI', conclusion: 'failure', url: 'https://r/42' }]) },
    'run view 42 --log-failed': { stdout: 'test failed\n' },
  })
  const result = await call(root, envWith(gh), ['ci', 'logs', '--branch', 'main'])
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.run.runId, 42)
  assert.equal(data.run.log, 'test failed\n')
  assert.equal(data.truncated, false)
})

test('ci logs keeps the last --tail lines of a long log', async () => {
  const root = teamRepo()
  const gh = fakeGh({ [META(9)]: { stdout: JSON.stringify({ workflowName: 'CI', url: 'https://r/9', conclusion: 'failure', status: 'completed' }) }, 'run view 9 --log-failed': { stdout: 'a\nb\nc\nd\n' } })
  const result = await call(root, envWith(gh), ['ci', 'logs', '--run', '9', '--tail', '2'])
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.run.log, 'c\nd\n')
  assert.equal(data.truncated, true)
})

test('ci logs with no failed run is not an error', async () => {
  const root = teamRepo()
  const gh = fakeGh({ [RUNS]: { stdout: JSON.stringify([{ databaseId: 1, conclusion: 'success' }]) } })
  const result = await run(['ci', 'logs', '--branch', 'main'], { env: envWith(gh), cwd: root })
  assert.equal(result.code, 0)
  assert.match(result.stdout, /no failed run/)
})

test('ci logs refuses bad --run and --tail values before gh runs', async () => {
  const root = teamRepo()
  const gh = fakeGh({})
  for (const args of [['--run', 'abc'], ['--run', '0'], ['--run', '9', '--tail', '0'], ['--run', '9', '--tail', 'x']]) {
    const result = await call(root, envWith(gh), ['ci', 'logs', ...args])
    assert.equal(result.code, 2, args.join(' '))
    assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
  }
  assert.deepEqual(ghCalls(gh), [])
})

test('ci logs refuses --run with --branch, and deploys list refuses an empty --environment', async () => {
  const root = teamRepo()
  const gh = fakeGh({})
  for (const args of [['ci', 'logs', '--run', '9', '--branch', 'main'], ['deploys', 'list', '--environment', '']]) {
    const result = await call(root, envWith(gh), args)
    assert.equal(result.code, 2, args.join(' '))
    assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
  }
  assert.deepEqual(ghCalls(gh), [])
})

test('both commands answer NOT_SUPPORTED without a git host', async () => {
  const root = teamRepo({ github: false })
  const gh = fakeGh({})
  for (const args of [['deploys', 'list'], ['ci', 'logs', '--branch', 'main']]) {
    const result = await call(root, envWith(gh), args)
    assert.equal(result.code, 2)
    assert.equal(JSON.parse(result.stdout).error.code, 'NOT_SUPPORTED')
  }
})

test('deploys list --environment and ci logs --branch with no value are refused before gh runs', async () => {
  const root = teamRepo()
  const gh = fakeGh({})
  for (const args of [['deploys', 'list', '--environment'], ['ci', 'logs', '--branch']]) {
    const result = await call(root, envWith(gh), args)
    assert.equal(result.code, 2, args.join(' '))
    assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
  }
  assert.deepEqual(ghCalls(gh), [])
})

test('ci logs --run returns the workflow name and URL, and no note for a failed run with a log', async () => {
  const root = teamRepo()
  const gh = fakeGh({ [META(9)]: { stdout: JSON.stringify({ workflowName: 'CI', url: 'https://r/9', conclusion: 'failure', status: 'completed' }) }, 'run view 9 --log-failed': { stdout: 'boom\n' } })
  const data = JSON.parse((await call(root, envWith(gh), ['ci', 'logs', '--run', '9'])).stdout)
  assert.deepEqual({ ...data.run }, { runId: 9, workflowName: 'CI', url: 'https://r/9', conclusion: 'failure', status: 'completed', failed: true, hasLog: true, logNote: null, log: 'boom\n' })
})

test('ci logs says when the run did not fail, has not finished, never started or has an empty log', async () => {
  const cases = [
    [{ conclusion: 'success', status: 'completed' }, /did not fail \(success\)/, false],
    [{ conclusion: null, status: 'in_progress' }, /has not finished \(in_progress\)/, false],
    [{ conclusion: 'startup_failure', status: 'completed' }, /never started a job/, true],
    [{ conclusion: 'failure', status: 'completed' }, /returned no log/, true],
  ]
  for (const [meta, note, failed] of cases) {
    const root = teamRepo()
    const gh = fakeGh({ [META(9)]: { stdout: JSON.stringify({ workflowName: 'CI', url: 'u', ...meta }) }, 'run view 9 --log-failed': { stdout: '' } })
    const json = await call(root, envWith(gh), ['ci', 'logs', '--run', '9'])
    assert.equal(json.code, 0, json.stdout)
    const data = JSON.parse(json.stdout)
    assert.equal(data.run.failed, failed)
    assert.equal(data.run.hasLog, false)
    assert.match(data.run.logNote, note)
    const text = await run(['ci', 'logs', '--run', '9'], { env: envWith(gh), cwd: root })
    assert.equal(text.code, 0)
    assert.match(text.stdout, note)
  }
})

test('ci logs --run shows the log of a cancelled run with the note that it did not fail', async () => {
  const root = teamRepo()
  const gh = fakeGh({ [META(9)]: { stdout: JSON.stringify({ workflowName: 'CI', url: 'u', conclusion: 'cancelled', status: 'completed' }) }, 'run view 9 --log-failed': { stdout: 'step failed\n' } })
  const json = JSON.parse((await call(root, envWith(gh), ['ci', 'logs', '--run', '9'])).stdout)
  assert.equal(json.run.failed, false)
  assert.equal(json.run.hasLog, true)
  assert.match(json.run.logNote, /did not fail \(cancelled\)/)
  const text = await run(['ci', 'logs', '--run', '9'], { env: envWith(gh), cwd: root })
  assert.match(text.stdout, /did not fail \(cancelled\)[^]*step failed/)
})
