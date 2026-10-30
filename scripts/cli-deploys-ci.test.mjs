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
const RUNS = 'run list --branch main --limit 50 --json databaseId,workflowName,status,conclusion,url,createdAt,headSha'

test('deploys list prints the deployments with their state', async () => {
  const root = teamRepo()
  const gh = fakeGh({
    [DEPLOYMENTS]: { stdout: JSON.stringify([{ id: 5, environment: 'production', ref: 'main', sha: 'abc', created_at: '2026-10-22T10:00:00Z' }]) },
    'api repos/{owner}/{repo}/deployments/5/statuses?per_page=1': { stdout: JSON.stringify([{ state: 'success', log_url: 'https://l/5' }]) },
  })
  const result = await call(root, envWith(gh), ['deploys', 'list'])
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const data = JSON.parse(result.stdout)
  assert.deepEqual(data.deploys.map((d) => [d.id, d.environment, d.state]), [[5, 'production', 'success']])
  const text = await run(['deploys', 'list'], { env: envWith(gh), cwd: root })
  assert.match(text.stdout, /production/)
  assert.match(text.stdout, /success/)
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
  const gh = fakeGh({ 'run view 9 --log-failed': { stdout: 'a\nb\nc\nd\n' } })
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
