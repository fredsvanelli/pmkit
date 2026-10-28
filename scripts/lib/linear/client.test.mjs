import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { FAKE_KEY, fakeLinearFetch, json } from '../../fake-linear-api.mjs'
import { PmkitError } from '../errors.mjs'
import { LINEAR_ENDPOINT, createLinearClient, isMutation, secretKeyPaths } from './client.mjs'

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

test('request sends the session query first, then one POST with the key and the body', async () => {
  const { client, f } = make({ routes: { Q: json({ a: 1 }) } })
  const data = await client.request('query Q { a }', { x: 1 })
  assert.deepEqual(data, { a: 1 })
  assert.equal(f.calls.length, 2)
  assert.match(f.calls[0].body.query, /PmkitSession/)
  const call = f.calls[1]
  assert.equal(call.url, LINEAR_ENDPOINT)
  assert.equal(call.method, 'POST')
  assert.equal(call.headers['Content-Type'], 'application/json')
  assert.equal(call.headers.Authorization, FAKE_KEY)
  assert.deepEqual(call.body, { query: 'query Q { a }', variables: { x: 1 } })
})

test('variables default to an empty object', async () => {
  const { client, f } = make({ routes: { Q: json({ a: 1 }) } })
  await client.request('query Q { a }')
  assert.deepEqual(f.calls[1].body.variables, {})
})

test('concurrent first calls share one session request', async () => {
  const { client, f } = make({ routes: { Q: json({ a: 1 }) } })
  await Promise.all([client.request('query Q { a }'), client.request('query Q { a }'), client.session()])
  assert.equal(f.calls.filter((call) => /PmkitSession/.test(call.body.query)).length, 1)
})

test('session reports the viewer, the workspace and the pin', async () => {
  const { client } = make()
  assert.deepEqual(await client.session(), {
    source: 'LINEAR_API_KEY',
    viewer: { id: 'user-1', name: 'Test User' },
    workspace: { urlKey: 'acme', name: 'Acme' },
    pinned: true,
    warnings: [],
  })
})

test('a renamed workspace passes with a warning', async () => {
  const { client } = make({ fake: { workspace: 'acme-new', previousUrlKeys: ['acme'] } })
  const session = await client.session()
  assert.equal(session.pinned, true)
  assert.deepEqual(session.warnings, [
    'Linear renamed workspace acme to acme-new; set tracker.scope.workspace to acme-new in .pmkit/config.yaml',
  ])
})

test('a key of another workspace is AUTH and every later request fails the same way', async () => {
  const { client, f } = make({ routes: { Q: json({ a: 1 }) }, fake: { workspace: 'other' } })
  const error = await client.session().catch((caught) => caught)
  assert.equal(error.code, 'AUTH')
  assert.equal(error.message, 'LINEAR_API_KEY belongs to workspace other, and .pmkit/config.yaml names acme')
  assert.equal(error.nextStep, 'Export a LINEAR_API_KEY created in the acme workspace')
  const later = await client.request('query Q { a }').catch((caught) => caught)
  assert.equal(later, error)
  assert.equal(f.calls.length, 1)
})

test('an answer with no organization is UPSTREAM', async () => {
  const { client } = make({ routes: { PmkitSession: json({ viewer: { id: 'user-1', name: 'Test User' } }) } })
  const error = await client.session().catch((caught) => caught)
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.message, 'Linear returned no organization for this key')
})

test('without a workspace and with requireWorkspace false, the session is not pinned', async () => {
  const { client } = make({ tracker: { system: 'linear', scope: {} }, requireWorkspace: false })
  const session = await client.session()
  assert.equal(session.pinned, false)
  assert.deepEqual(session.warnings, [])
})
