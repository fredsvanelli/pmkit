import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ADAPTERS, adapterFor } from './lib/adapters.mjs'
import { builtInDefaults, loadConfig, withLocalDefaults } from './lib/config.mjs'
import { assertTracker } from './lib/contract.mjs'
import { withLinear } from './fake-hosted.mjs'
import { FAKE_KEY, fakeLinearFetch, fakeWorkspace } from './fake-linear-api.mjs'
import { linearDescriptor } from './lib/linear/adapter.mjs'
import { fixedNow, makeRepo, tempDir, userStoreEnv } from './test-helpers.mjs'

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

test('the product registry holds local and linear', () => {
  assert.deepEqual(Object.keys(ADAPTERS), ['local', 'linear'])
  assert.equal(adapterFor('local'), ADAPTERS.local)
  assert.equal(ADAPTERS.local.hosted, false)
  assert.equal(adapterFor('linear').hosted, true)
  assert.equal(adapterFor('jira'), null)
  assert.equal(adapterFor('trello'), null)
  assert.equal(adapterFor('constructor'), null)
  assert.equal(adapterFor('linear', withLinear()).hosted, true)
})

test('the local descriptor creates a contract tracker and gives the config defaults', async () => {
  const root = makeRepo('basic')
  const config = loadConfig(root)
  const tracker = await ADAPTERS.local.create(config, { now: fixedNow(), random: Math.random, env: {}, dryRun: false })
  assert.doesNotThrow(() => assertTracker(tracker))
  assert.deepEqual(ADAPTERS.local.settings(loadConfig(root)), { defaults: config.local.defaults, epicPrefix: 'EPC' })
})

test('builtInDefaults returns a fresh copy of the built-in behavior defaults', () => {
  const first = builtInDefaults()
  assert.deepEqual(first, withLocalDefaults({}).defaults)
  first.stale_days = 1
  assert.equal(builtInDefaults().stale_days, withLocalDefaults({}).defaults.stale_days)
})

test('the linear descriptor asks for a workspace and lists no secret', () => {
  const linear = linearDescriptor()
  assert.equal(linear.system, 'linear')
  assert.deepEqual(linear.configProblems({ tracker: { system: 'linear' } }), ['tracker.scope.workspace is required for linear'])
  assert.deepEqual(linear.configProblems({ tracker: { system: 'linear', scope: { workspace: 'acme', token: 'plainvalue' } } }), [])
  assert.deepEqual(linear.settings(), { defaults: builtInDefaults(), epicPrefix: null })
})

test('the linear descriptor checks the estimate and type mappings offline', () => {
  const linear = linearDescriptor()
  const base = { tracker: { system: 'linear', scope: { workspace: 'acme' } } }
  const problems = (mappings) => linear.configProblems({ ...base, mappings })
  assert.deepEqual(problems({ fields: { estimate: 'Points' } }), ['mappings.fields.estimate must be native or none for linear'])
  assert.deepEqual(problems({ fields: { estimate: 'native' } }), [])
  assert.deepEqual(problems({ fields: { estimate: 'none' }, types: { bug: 'Bug' } }), [])
  assert.deepEqual(problems({ types: { bug: 'none' } }), ['mappings.types.bug cannot be none; leave the type out instead'])
  assert.deepEqual(problems({ types: {} }), [])
  assert.deepEqual(linear.configProblems(base), [])
})

test('the linear descriptor describes a workspace for setup', async () => {
  const raw = { workspace: { urlKey: 'acme' }, teams: [], states: [], labels: [], users: [] }
  const description = linearDescriptor().describe(raw, { workspace: { urlKey: 'acme', name: 'Acme', plan: 'free' } }, 'user-1', ['bug'])
  assert.deepEqual(description, { workspace: { urlKey: 'acme', name: 'Acme', plan: 'free' }, viewerTeams: [], types: ['bug'], teams: [] })
})

test('the linear descriptor creates a contract tracker from an injected fetch', async () => {
  const { env } = userStoreEnv()
  const config = { root: tempDir(), pmkit: { tracker: { system: 'linear', scope: { workspace: 'acme' } } } }
  const fetch = fakeLinearFetch(fakeWorkspace())
  const tracker = await linearDescriptor({ fetch }).create(config, { now: fixedNow(), env: { ...env, LINEAR_API_KEY: FAKE_KEY } })
  assert.doesNotThrow(() => assertTracker(tracker))
  assert.equal((await tracker.discover()).workspace.urlKey, 'acme')
  assert.ok(fetch.calls.length > 0)
})

test('adapter.mjs loads first or second without a cycle error', () => {
  const imports = {
    first: ['./scripts/lib/linear/adapter.mjs', './scripts/lib/adapters.mjs'],
    second: ['./scripts/lib/adapters.mjs', './scripts/lib/linear/adapter.mjs'],
    config: ['./scripts/lib/config.mjs', './scripts/lib/linear/adapter.mjs'],
  }
  for (const [order, [one, two]] of Object.entries(imports)) {
    const script = `import '${one}'; import '${two}'; import { ADAPTERS } from './scripts/lib/adapters.mjs'; console.log(JSON.stringify(ADAPTERS.linear.settings().epicPrefix))`
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: REPO_ROOT, encoding: 'utf8' })
    assert.equal(result.status, 0, `${order}: ${result.stderr}`)
    assert.equal(result.stdout.trim(), 'null', order)
  }
})
