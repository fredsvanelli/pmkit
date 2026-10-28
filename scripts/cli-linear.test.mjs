// The CLI over the Linear adapter with a fake fetch. No test here touches the network or the real user store.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { linearDescriptor } from './lib/linear/adapter.mjs'
import { operationName } from './lib/linear/client.mjs'
import { useLinear } from './fake-hosted.mjs'
import { FAKE_KEY, fakeLinearFetch, fakeWorkspace } from './fake-linear-api.mjs'
import { childEnv } from './golden-helpers.mjs'
import { makeRepo, userStoreEnv } from './test-helpers.mjs'

// gitUserEmail reads the process environment, so the in-process runs need the same git isolation as childEnv.
process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir())

function setup({ edit, withKey = true } = {}) {
  const root = useLinear(makeRepo('basic'))
  if (edit) {
    const file = path.join(root, '.pmkit', 'config.yaml')
    fs.writeFileSync(file, edit(fs.readFileSync(file, 'utf8')))
  }
  const env = { ...childEnv(), ...userStoreEnv().env, ...(withKey ? { LINEAR_API_KEY: FAKE_KEY } : {}) }
  return { root, env }
}

function cli(context, args, fetch = fakeLinearFetch(fakeWorkspace())) {
  return run(args, { cwd: context.root, env: context.env, adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch }) } })
}

const withTeam = (text) => text.replace('    workspace: acme', '    workspace: acme\n    team: ACME')
const callsOf = (fetch, name) => fetch.calls.filter((call) => operationName(call.body.query) === name).length
const errorOf = (result) => JSON.parse(result.stdout).error

test('discover --json returns auth before teams and statuses', async () => {
  const result = await cli(setup(), ['discover', '--json'])
  assert.equal(result.code, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.deepEqual(Object.keys(data).slice(0, 5), ['auth', 'workspace', 'team', 'teams', 'statuses'])
  assert.equal(data.statuses.find((status) => status.name === 'Duplicate').category, 'canceled')
  assert.equal(result.stderr, '')
})

test('discover always refreshes', async () => {
  const context = setup()
  const fetch = fakeLinearFetch(fakeWorkspace())
  assert.equal((await cli(context, ['discover', '--json'], fetch)).code, 0)
  assert.equal((await cli(context, ['discover', '--json'], fetch)).code, 0)
  assert.equal(callsOf(fetch, 'PmkitTeams'), 2)
  const before = fetch.calls.length
  const capabilities = await cli(context, ['capabilities', '--json'], fetch)
  assert.equal(capabilities.code, 0, capabilities.stderr)
  assert.equal(fetch.calls.length, before)
})

test('discover prints the workspace and teams lines', async () => {
  const result = await cli(setup(), ['discover'])
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /^workspace: Acme \(acme\), plan free, viewer Test User$/m)
  assert.match(result.stdout, /^teams:$/m)
  assert.match(result.stdout, /^ {2}ACME {2}Acme {2}cycles off, triage off, estimate notUsed$/m)
  assert.ok(result.stdout.indexOf('workspace:') < result.stdout.indexOf('statuses:'))
})

test('a cached discover result prints the workspace line without a viewer', async () => {
  const context = setup()
  const fetch = fakeLinearFetch(fakeWorkspace())
  await cli(context, ['discover', '--json'], fetch)
  const result = await cli(context, ['capabilities'], fetch)
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /^workspace: acme \(free\)$/m)
  assert.match(result.stdout, /^team: \(none\)$/m)
  assert.match(result.stdout, /^discovered: 2026-/m)
  assert.ok(result.stdout.indexOf('git host:') < result.stdout.indexOf('workspace:'))
})

test('discover without a key exits 2 with AUTH', async () => {
  const fetch = fakeLinearFetch(fakeWorkspace())
  const result = await cli(setup({ withKey: false }), ['discover', '--json'], fetch)
  assert.equal(result.code, 2)
  assert.equal(errorOf(result).code, 'AUTH')
  assert.equal(fetch.calls.length, 0)
})

test('a refused read prints no key', async () => {
  for (const args of [['discover', '--json'], ['discover']]) {
    const result = await cli(setup(), args, fakeLinearFetch(fakeWorkspace({ refuse: ['PmkitTeams'] })))
    assert.equal(result.code, 2, args.join(' '))
    if (args.includes('--json')) assert.equal(errorOf(result).code, 'AUTH')
    else assert.match(result.stderr, /^error: Linear refused the request for this key$/m)
    assert.ok(!result.stdout.includes(FAKE_KEY) && !result.stderr.includes(FAKE_KEY), args.join(' '))
  }
})

test('capabilities --json reports 20 entries', async () => {
  const result = await cli(setup(), ['capabilities', '--json'])
  assert.equal(result.code, 0, result.stderr)
  const manifest = JSON.parse(result.stdout)
  assert.equal(manifest.capabilities.length, 20)
  assert.equal(manifest.workspace.plan, 'free')
  assert.equal(manifest.tracker, 'linear')
})

test('validate lists a missing workspace and no secret-like key', async () => {
  const context = setup({ edit: (text) => text.replace('    workspace: acme', '    token: plainvalue') })
  const result = await cli(context, ['validate'])
  assert.match(result.stdout, /tracker\.scope\.workspace is required for linear/)
  assert.ok(!result.stdout.includes('token'), result.stdout)
})

test('discover with a secret-like key exits 2 with INVALID_INPUT', async () => {
  const context = setup({ edit: (text) => text.replace('    workspace: acme', '    workspace: acme\n    token: plainvalue') })
  const result = await cli(context, ['discover', '--json'])
  assert.equal(result.code, 2)
  const error = errorOf(result)
  assert.equal(error.code, 'INVALID_INPUT')
  assert.ok(error.message.includes('tracker.scope.token'))
  assert.ok(!error.message.includes('plainvalue'))
})

test('the workspace rename warning reaches stderr', async () => {
  const fetch = fakeLinearFetch(fakeWorkspace({ urlKey: 'acme-new' }), { workspace: 'acme-new', previousUrlKeys: ['acme'] })
  const result = await cli(setup(), ['discover', '--json'], fetch)
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stderr, /^warning: Linear renamed workspace acme to acme-new/m)
})

test('issues list exits 2 with NOT_SUPPORTED', async () => {
  const fetch = fakeLinearFetch(fakeWorkspace())
  const result = await cli(setup({ edit: withTeam }), ['issues', 'list', '--json'], fetch)
  assert.equal(result.code, 2)
  assert.deepEqual(errorOf(result), {
    code: 'NOT_SUPPORTED',
    message: 'the Linear adapter does not implement searchIssues yet',
    nextStep: 'Set tracker.system to local in .pmkit/config.yaml to use this command now',
  })
})
