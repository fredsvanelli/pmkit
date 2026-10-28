import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { FAKE_KEY, fakeLinearFetch, json } from '../../fake-linear-api.mjs'
import { PmkitError } from '../errors.mjs'
import { createLinearClient, isMutation, secretKeyPaths } from './client.mjs'

// A client built without an injected fetch must fail loudly, not reach the network.
let realFetchCalls = 0
globalThis.fetch = () => {
  realFetchCalls += 1
  throw new Error('client.test.mjs: a test used the real fetch')
}
after(() => assert.equal(realFetchCalls, 0))

const made = []
afterEach(() => {
  for (const f of made.splice(0)) assert.deepEqual(f.unrouted, [])
})

const TRACKER = { system: 'linear', scope: { workspace: 'acme', team: 'ACME' } }
const ENV = { LINEAR_API_KEY: FAKE_KEY }

function fake(routes, options) {
  const f = fakeLinearFetch(routes, options)
  made.push(f)
  return f
}

function make(options = {}) {
  const f = options.fetch ?? fake(options.routes, options.fake)
  const { routes, fake: _fake, fetch: _fetch, ...rest } = options
  const client = createLinearClient({ env: ENV, tracker: TRACKER, fetch: f, ...rest })
  return { client, f }
}

function thrown(fn) {
  try {
    fn()
  } catch (error) {
    return error
  }
  assert.fail('did not throw')
}

test('secretKeyPaths names the paths of secret-like keys and values', () => {
  assert.deepEqual(secretKeyPaths({ token: 'x' }), ['tracker.token'])
  assert.deepEqual(secretKeyPaths({ scope: { api_key: 'x' } }), ['tracker.scope.api_key'])
  assert.deepEqual(secretKeyPaths({ scope: { apiKey: 'x' } }), ['tracker.scope.apiKey'])
  assert.deepEqual(secretKeyPaths({ scope: { note: FAKE_KEY } }), ['tracker.scope.note'])
  assert.deepEqual(secretKeyPaths(TRACKER), [])
  assert.deepEqual(secretKeyPaths({ scope: { teams: [{ secret: 'x' }] } }), ['tracker.scope.teams[0].secret'])
})

test('secretKeyPaths never includes a value', () => {
  assert.ok(!JSON.stringify(secretKeyPaths({ scope: { note: FAKE_KEY, token: FAKE_KEY } })).includes('TESTKEY'))
})

test('a secret-like key in the tracker config is refused before any request', () => {
  const f = fake()
  const tracker = { system: 'linear', scope: { workspace: 'acme', token: FAKE_KEY } }
  const error = thrown(() => createLinearClient({ env: ENV, tracker, fetch: f }))
  assert.ok(error instanceof PmkitError)
  assert.equal(error.code, 'INVALID_INPUT')
  assert.equal(error.message, '.pmkit/config.yaml holds a secret-like key at tracker.scope.token')
  assert.equal(error.nextStep, 'Remove it from .pmkit/config.yaml and keep the Linear key in LINEAR_API_KEY')
  for (const text of [error.message, error.nextStep, JSON.stringify(error.details ?? null)]) assert.ok(!text.includes('TESTKEY'))
  assert.equal(f.calls.length, 0)
})

test('two secret paths are joined with a comma', () => {
  const tracker = { system: 'linear', scope: { workspace: 'acme', token: 'x', note: FAKE_KEY } }
  const error = thrown(() => createLinearClient({ env: ENV, tracker, fetch: fake() }))
  assert.equal(error.message, '.pmkit/config.yaml holds a secret-like key at tracker.scope.note, tracker.scope.token')
})

test('a missing workspace is NOT_CONFIGURED unless requireWorkspace is false', () => {
  const tracker = { system: 'linear', scope: {} }
  const error = thrown(() => createLinearClient({ env: ENV, tracker, fetch: fake() }))
  assert.equal(error.code, 'NOT_CONFIGURED')
  assert.equal(error.message, 'tracker.scope.workspace is not set')
  assert.equal(error.nextStep, '/pmkit:setup')
  createLinearClient({ env: ENV, tracker, requireWorkspace: false, fetch: fake() })
})

test('a missing key fails at creation with no request', () => {
  const f = fake()
  const error = thrown(() => createLinearClient({ env: {}, tracker: TRACKER, fetch: f }))
  assert.equal(error.code, 'AUTH')
  assert.equal(f.calls.length, 0)
})

test('a valid client sends nothing at creation and is frozen with four methods', () => {
  const { client, f } = make()
  assert.equal(f.calls.length, 0)
  assert.ok(Object.isFrozen(client))
  assert.deepEqual(Object.keys(client).sort(), ['paginate', 'rateLimit', 'request', 'session'])
})

test('isMutation ignores comments and keyword prefixes', () => {
  assert.equal(isMutation('query MutationReport { a }'), false)
  assert.equal(isMutation('# mutation note\nquery Q { a }'), false)
  assert.equal(isMutation('  # note\n  mutation Create { a }'), true)
  assert.equal(isMutation('mutation{a}'), true)
  assert.equal(isMutation('{ a }'), false)
})
