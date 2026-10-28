import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ADAPTERS, adapterFor } from './lib/adapters.mjs'
import { builtInDefaults, loadConfig, withLocalDefaults } from './lib/config.mjs'
import { assertTracker } from './lib/contract.mjs'
import { withLinear } from './fake-hosted.mjs'
import { fixedNow, makeRepo } from './test-helpers.mjs'

test('the product registry holds local only', () => {
  assert.deepEqual(Object.keys(ADAPTERS), ['local'])
  assert.equal(adapterFor('local'), ADAPTERS.local)
  assert.equal(ADAPTERS.local.hosted, false)
  assert.equal(adapterFor('linear'), null)
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
