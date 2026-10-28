import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { FAKE_KEY, fakeLinearFetch, fakeWorkspace } from '../../fake-linear-api.mjs'
import { tempDir, userStoreEnv } from '../../test-helpers.mjs'
import { assertTracker } from '../contract.mjs'
import { cachePut, repoHash } from '../user-store.mjs'
import { operationName } from './client.mjs'
import { createLinearTracker } from './tracker.mjs'

const START = new Date('2026-10-27T12:00:00Z')
const at = (minutes) => () => new Date(START.getTime() + minutes * 60_000)
const DISCOVERY_OPERATIONS = ['PmkitSession', 'PmkitWorkspace', 'PmkitPlan', 'PmkitIntegrations', 'PmkitTeams', 'PmkitStates', 'PmkitLabels', 'PmkitUsers']
const callsOf = (fetch, name) => fetch.calls.filter((call) => operationName(call.body.query) === name).length

function setup({ scope = { workspace: 'acme' }, withKey = true, env: extraEnv = {} } = {}) {
  const root = tempDir()
  const { env } = userStoreEnv()
  const fullEnv = { ...env, ...(withKey ? { LINEAR_API_KEY: FAKE_KEY } : {}), ...extraEnv }
  const config = { root, pmkit: { tracker: { system: 'linear', scope }, git_host: { system: 'github' } } }
  return { root, env: fullEnv, config }
}

function tracker(context, { now = at(0), fetch = fakeLinearFetch(fakeWorkspace()) } = {}) {
  return { fetch, tracker: createLinearTracker(context.config, { env: context.env, now, fetch }) }
}

const filesUnder = (dir) =>
  fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name)) : []

test('the tracker passes assertTracker', () => {
  assert.doesNotThrow(() => assertTracker(tracker(setup()).tracker))
})

test('a stub throws NOT_SUPPORTED and sends no request', async () => {
  const { fetch, tracker: linear } = tracker(setup())
  await assert.rejects(linear.searchIssues({}), {
    code: 'NOT_SUPPORTED',
    message: 'the Linear adapter does not implement searchIssues yet',
    nextStep: 'Set tracker.system to local in .pmkit/config.yaml to use this command now',
  })
  assert.equal(fetch.calls.length, 0)
})

test('a stub without a workspace throws NOT_CONFIGURED', async () => {
  const { tracker: linear } = tracker(setup({ scope: {} }))
  await assert.rejects(linear.getIssue('ACME-1'), { code: 'NOT_CONFIGURED', message: 'tracker.scope.workspace is not set', nextStep: '/pmkit:setup' })
})

test('a missing key throws AUTH before any request', () => {
  const fetch = fakeLinearFetch(fakeWorkspace())
  assert.throws(() => tracker(setup({ withKey: false }), { fetch }), { code: 'AUTH' })
  assert.equal(fetch.calls.length, 0)
})

test('a secret-like key in the config throws INVALID_INPUT', () => {
  assert.throws(
    () => tracker(setup({ scope: { workspace: 'acme', token: 'plainvalue' } })),
    (error) => error.code === 'INVALID_INPUT' && error.message.includes('tracker.scope.token') && !error.message.includes('plainvalue'),
  )
})

test('discover and capabilities in one run share one discovery', async () => {
  const { fetch, tracker: linear } = tracker(setup())
  await Promise.all([linear.discover(), linear.capabilities()])
  await linear.discover()
  for (const name of DISCOVERY_OPERATIONS) assert.equal(callsOf(fetch, name), 1, name)
})

test('a second tracker on the same store sends no request until the TTL passes', async () => {
  const context = setup()
  await tracker(context).tracker.discover()
  const fresh = tracker(context, { now: at(59) })
  assert.equal((await fresh.tracker.discover()).statuses.length, 10)
  assert.equal(fresh.fetch.calls.length, 0)
  const stale = tracker(context, { now: at(61) })
  await stale.tracker.discover()
  for (const name of DISCOVERY_OPERATIONS) assert.equal(callsOf(stale.fetch, name), 1, name)
})

test('refresh fetches again and rewrites the cache', async () => {
  const context = setup()
  const { fetch, tracker: linear } = tracker(context)
  await linear.discover()
  const refreshed = tracker(context, { now: at(30), fetch })
  await refreshed.tracker.discover({ refresh: true })
  assert.equal(callsOf(fetch, 'PmkitTeams'), 2)
  const next = tracker(context, { now: at(80) })
  await next.tracker.discover()
  assert.equal(next.fetch.calls.length, 0)
})

test('a fresh result has auth and a cached one does not', async () => {
  const context = setup()
  const fresh = await tracker(context).tracker.discover()
  assert.deepEqual(fresh.auth, { source: 'LINEAR_API_KEY', viewer: { id: 'user-1', name: 'Test User' }, workspace: { urlKey: 'acme', name: 'Acme' } })
  const cached = await tracker(context, { now: at(1) }).tracker.discover()
  assert.equal('auth' in cached, false)
  assert.equal(cached.statuses.length, 10)
})

test('without a workspace discover works and writes no cache', async () => {
  const context = setup({ scope: {} })
  const result = await tracker(context).tracker.discover()
  assert.equal(result.workspace.urlKey, 'acme')
  assert.deepEqual(filesUnder(context.env.PMKIT_HOME), [])
})

test('a cache entry in another format counts as a miss', async () => {
  const context = setup()
  cachePut(repoHash(context.root), 'linear-acme', { version: 0 }, { ttlSeconds: 3600 }, { env: context.env, now: at(0) })
  const { fetch, tracker: linear } = tracker(context, { now: at(1) })
  assert.equal((await linear.discover()).statuses.length, 10)
  assert.equal(callsOf(fetch, 'PmkitTeams'), 1)
})

test('a cache entry with a missing list counts as a miss', async () => {
  const context = setup()
  const { tracker: first } = tracker(context)
  await first.discover()
  const file = filesUnder(context.env.PMKIT_HOME)[0]
  const entry = JSON.parse(fs.readFileSync(file, 'utf8'))
  delete entry.value.labels
  fs.writeFileSync(file, JSON.stringify(entry))
  const { fetch, tracker: linear } = tracker(context, { now: at(1) })
  assert.equal((await linear.discover()).labels.length, 8)
  assert.equal(callsOf(fetch, 'PmkitLabels'), 1)
})

test('a new workspace key does not read the old cache', async () => {
  const context = setup()
  await tracker(context).tracker.discover()
  const other = { ...context, config: { ...context.config, pmkit: { ...context.config.pmkit, tracker: { system: 'linear', scope: { workspace: 'acme-two' } } } } }
  const fetch = fakeLinearFetch(fakeWorkspace({ urlKey: 'acme-two' }), { workspace: 'acme-two' })
  const result = await tracker(other, { now: at(1), fetch }).tracker.discover()
  assert.equal(callsOf(fetch, 'PmkitTeams'), 1)
  assert.equal(result.workspace.urlKey, 'acme-two')
})

test('a failing cache write warns and still returns the result', async () => {
  const repo = tempDir()
  fs.mkdirSync(path.join(repo, '.git'))
  const context = setup({ env: { PMKIT_HOME: path.join(repo, 'store') } })
  const result = await tracker(context).tracker.discover()
  assert.equal(result.statuses.length, 10)
  assert.ok(result.warnings.some((warning) => warning.startsWith('pmkit could not write the Linear discovery cache: ')))
})

test('capabilities returns the manifest object', async () => {
  const manifest = await tracker(setup()).tracker.capabilities()
  assert.deepEqual(Object.keys(manifest), ['tracker', 'gitHost', 'generatedAt', 'discoveredAt', 'workspace', 'team', 'capabilities', 'warnings'])
  assert.equal(manifest.tracker, 'linear')
  assert.equal(manifest.gitHost, 'github')
  assert.equal(manifest.generatedAt, '2026-10-27T12:00:00Z')
  assert.equal(manifest.discoveredAt, '2026-10-27T12:00:00.000Z')
  assert.deepEqual(manifest.workspace, { urlKey: 'acme', plan: 'free' })
  assert.equal(manifest.team, null)
  assert.equal(manifest.capabilities.length, 20)
  assert.deepEqual(manifest.warnings, [])
})

test('no file under the store holds the key', async () => {
  const context = setup()
  await tracker(context).tracker.discover()
  const files = filesUnder(context.env.PMKIT_HOME)
  assert.equal(files.length, 1)
  for (const file of files) assert.ok(!fs.readFileSync(file, 'utf8').includes(FAKE_KEY), file)
})
