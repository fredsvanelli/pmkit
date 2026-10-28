import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { FAKE_KEY, fakeLinearFetch, json, page } from '../../fake-linear-api.mjs'
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

test('isMutation finds a mutation after a fragment or another operation', () => {
  assert.equal(isMutation('fragment F on Issue { id } mutation M { issueUpdate { issue { ...F } } }'), true)
  assert.equal(isMutation('query Q { a } mutation M { b }'), true)
  assert.equal(isMutation('fragment F on Issue { id } query Q { issue { ...F } }'), false)
  assert.equal(isMutation('query Q { a { b { c } } }\nfragment F on Issue { id }'), false)
})

test('isMutation ignores the word mutation inside strings, comments, fields and arguments', () => {
  assert.equal(isMutation('query Q { issues(filter: { title: { eq: "x } mutation M { y" } }) { id } }'), false)
  assert.equal(isMutation('query Q { issue(id: """\n} mutation M {\n""") { id } }'), false)
  assert.equal(isMutation('query Q { a(s: "\\" } mutation M {") }'), false)
  assert.equal(isMutation('query Q {\n  # } mutation M {\n  a\n}'), false)
  assert.equal(isMutation('query Q($kind: Kind = mutation) { mutation }'), false)
  assert.equal(isMutation('query Q @tag(name: mutation) { a }'), false)
})

test('isMutation counts a document it cannot read as a mutation', () => {
  assert.equal(isMutation('query Q { a(s: "open) }'), true)
  assert.equal(isMutation('query Q { a(s: """open) }'), true)
  assert.equal(isMutation('query Q { a '), true)
  assert.equal(isMutation('query Q { a } }'), true)
  assert.equal(isMutation('query Q ( { a }'), true)
  assert.equal(isMutation('subscribe S { a }'), true)
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

// Error mapping. Each row of the spec's table, run on a query after a passing session.
async function failure(answer, options = {}) {
  const { client } = make({ routes: { Q: answer }, ...options })
  const error = await client.request('query Q { a }').catch((caught) => caught)
  assert.ok(error instanceof PmkitError, `expected a PmkitError, got ${error}`)
  return error
}

const graphqlError = (code, extra = {}) => ({ message: `${code} happened`, extensions: { code }, ...extra })
const errorsBody = (status, ...errors) => ({ status, json: { errors } })
const expectError = (error, code, message, nextStep) => {
  assert.equal(error.code, code)
  assert.equal(error.message, message)
  assert.equal(error.nextStep, nextStep)
}

const REJECTED = 'Create a key in Linear, Settings, Security & access, and export it as LINEAR_API_KEY'
const FORBIDDEN_STEP = "Check the key's permissions in Linear, Settings, Security & access"
const RETRY = 'Retry, and check status.linear.app if it keeps failing'

test('HTTP 401 and AUTHENTICATION_ERROR map to AUTH', async () => {
  for (const answer of [errorsBody(401, graphqlError('AUTHENTICATION_ERROR')), errorsBody(200, graphqlError('AUTHENTICATION_ERROR'))]) {
    expectError(await failure(answer), 'AUTH', 'Linear rejected LINEAR_API_KEY', REJECTED)
  }
  expectError(await failure({ status: 401, text: '' }), 'AUTH', 'Linear rejected LINEAR_API_KEY', REJECTED)
})

test('HTTP 403 and FORBIDDEN map to AUTH', async () => {
  for (const answer of [errorsBody(403, graphqlError('FORBIDDEN')), errorsBody(200, graphqlError('FORBIDDEN'))]) {
    expectError(await failure(answer), 'AUTH', 'Linear refused the request for this key', FORBIDDEN_STEP)
  }
})

test('HTTP 429 and RATELIMITED map to RATE_LIMITED and name the bucket and the reset', async () => {
  const requestsOut = { 'x-ratelimit-requests-remaining': '0', 'x-ratelimit-requests-reset': '1793000000000' }
  for (const answer of [
    { status: 429, headers: requestsOut, json: { errors: [] } },
    { status: 400, headers: requestsOut, json: { errors: [graphqlError('RATELIMITED')] } },
  ]) {
    expectError(await failure(answer), 'RATE_LIMITED', "Linear's requests limit for this key is used up", 'Wait until 2026-10-26T07:33:20.000Z and retry')
  }
  const complexityOut = { 'x-ratelimit-complexity-remaining': '0', 'x-ratelimit-complexity-reset': '1793000000000' }
  expectError(
    await failure({ status: 429, headers: complexityOut, json: {} }),
    'RATE_LIMITED',
    "Linear's complexity limit for this key is used up",
    'Wait until 2026-10-26T07:33:20.000Z and retry',
  )
  expectError(await failure({ status: 429, json: {} }), 'RATE_LIMITED', "Linear's requests limit for this key is used up", 'Wait a few minutes and retry')
})

test('validation and parse errors map to UPSTREAM naming the query', async () => {
  for (const code of ['GRAPHQL_VALIDATION_FAILED', 'GRAPHQL_PARSE_FAILED']) {
    const error = await failure(errorsBody(400, { message: 'bad field', extensions: { code } }))
    expectError(error, 'UPSTREAM', "Linear rejected pmkit's query: bad field", 'Update pmkit; if it still fails, report the query error')
  }
})

test('another GraphQL error maps to UPSTREAM and keeps the detail for callers', async () => {
  const error = await failure({
    status: 200,
    json: {
      data: null,
      errors: [
        {
          message: 'Entity not found: Issue',
          path: ['issue'],
          extensions: { code: 'INPUT_ERROR', type: 'invalid input', userError: true, userPresentableMessage: 'Could not find referenced Issue.' },
        },
      ],
    },
  })
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.message, 'Linear answered with an error: Could not find referenced Issue.')
  assert.equal(error.nextStep, "Check the request against Linear's message")
  assert.deepEqual(error.details.linear.errors[0], { code: 'INPUT_ERROR', type: 'invalid input', path: ['issue'], userError: true })
  assert.equal(error.details.linear.status, 200)
})

test('userPresentableMessage at the error level is read too', async () => {
  const error = await failure(errorsBody(200, { message: 'internal', userPresentableMessage: 'Could not find referenced Issue.', extensions: { code: 'INPUT_ERROR' } }))
  assert.equal(error.message, 'Linear answered with an error: Could not find referenced Issue.')
})

test('an unreadable answer maps to UPSTREAM with the status', async () => {
  expectError(await failure({ status: 400, text: 'not json' }), 'UPSTREAM', 'Linear returned an unreadable answer (HTTP 400)', RETRY)
  expectError(await failure({ status: 200, json: {} }), 'UPSTREAM', 'Linear returned an unreadable answer (HTTP 200)', RETRY)
})

test('another non-2xx status maps to UPSTREAM', async () => {
  expectError(await failure({ status: 418, json: { data: null } }), 'UPSTREAM', 'Linear answered HTTP 418', RETRY)
})

test('errors with partial data still throw', async () => {
  const error = await failure({ status: 200, json: { data: { a: 1 }, errors: [{ message: 'partial' }] } })
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.message, 'Linear answered with an error: partial')
})

test('data with an empty errors list is a success', async () => {
  const { client } = make({ routes: { Q: { status: 200, json: { data: { a: 1 }, errors: [] } } } })
  assert.deepEqual(await client.request('query Q { a }'), { a: 1 })
})

test('an error with no extensions, no message or a long message still gives a one-line message', async () => {
  const bare = await failure(errorsBody(200, {}))
  assert.equal(bare.message, 'Linear answered with an error: no message')
  const long = await failure(errorsBody(200, { message: `${'x'.repeat(150)}\n${'y'.repeat(150)}` }))
  const text = long.message.slice('Linear answered with an error: '.length)
  assert.equal(text.length, 200)
  assert.ok(!/\n/.test(long.message))
})

// Network failures, retries, timeouts and the rate state.
const econnreset = () => new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })

function sleeper() {
  const slept = []
  return { slept, sleep: async (ms) => void slept.push(ms) }
}

const callsTo = (f, name) => f.calls.filter((call) => call.body.query.includes(` ${name}`)).length

test('a query is retried after network errors with the 500 then 2000 ms delays', async () => {
  const { slept, sleep } = sleeper()
  const { client, f } = make({ routes: { Q: [{ throws: econnreset() }, { throws: econnreset() }, json({ a: 1 })] }, sleep })
  assert.deepEqual(await client.request('query Q { a }'), { a: 1 })
  assert.deepEqual(slept, [500, 2000])
  assert.equal(callsTo(f, 'Q'), 3)
})

test('three network failures end in UPSTREAM', async () => {
  const { slept, sleep } = sleeper()
  const error = await failure({ throws: econnreset() }, { sleep })
  expectError(error, 'UPSTREAM', 'Linear did not answer: ECONNRESET', RETRY)
  assert.deepEqual(slept, [500, 2000])
})

test('a lower-case cause code, no cause, or a message with the key gives "network error"', async () => {
  for (const thrown of [
    new TypeError('fetch failed', { cause: { code: 'econnreset' } }),
    new TypeError('fetch failed'),
    new Error(`header ${FAKE_KEY}`),
  ]) {
    const error = await failure({ throws: thrown }, { sleep: async () => {} })
    assert.equal(error.message, 'Linear did not answer: network error')
    assert.ok(!error.message.includes('TESTKEY'))
  }
})

test('HTTP 503 on a query is retried', async () => {
  const { slept, sleep } = sleeper()
  const error = await failure({ status: 503, json: { errors: [{ message: 'down' }] } }, { sleep })
  expectError(error, 'UPSTREAM', 'Linear did not answer: HTTP 503', RETRY)
  assert.deepEqual(slept, [500, 2000])
})

test('HTTP 503 with an unreadable body is retried and ends unreadable', async () => {
  const { slept, sleep } = sleeper()
  const error = await failure({ status: 503, text: '<html>' }, { sleep })
  expectError(error, 'UPSTREAM', 'Linear returned an unreadable answer (HTTP 503)', RETRY)
  assert.deepEqual(slept, [500, 2000])
})

test('a hung query times out', async () => {
  const error = await failure({ hang: true }, { timeoutMs: 20, retries: 0 })
  expectError(error, 'UPSTREAM', 'Linear did not answer: timed out after 0.02 s', RETRY)
})

test('a body that fails to arrive is a network failure and is retried', async () => {
  const { slept, sleep } = sleeper()
  const { client } = make({ routes: { Q: [{ textRejects: true, status: 200 }, json({ a: 1 })] }, sleep })
  assert.deepEqual(await client.request('query Q { a }'), { a: 1 })
  assert.deepEqual(slept, [500])
})

test('a mutation is sent once and its timeout asks the user to check', async () => {
  const { client, f } = make({ routes: { M: { hang: true } }, timeoutMs: 20 })
  const error = await client.request('mutation M { a }').catch((caught) => caught)
  expectError(
    error,
    'UPSTREAM',
    'Linear did not confirm the change: timed out after 0.02 s',
    'Check in Linear whether the change was applied before you retry',
  )
  assert.equal(callsTo(f, 'M'), 1)
})

test('a mutation that gets HTTP 503 is sent once', async () => {
  const { client, f } = make({ routes: { M: { status: 503, json: { errors: [{ message: 'down' }] } } }, sleep: async () => {} })
  const error = await client.request('mutation M { a }').catch((caught) => caught)
  assert.equal(error.message, 'Linear did not confirm the change: HTTP 503')
  assert.equal(callsTo(f, 'M'), 1)
})

test('a mutation that follows a fragment is sent once', async () => {
  const document = 'fragment F on Issue { id } mutation M { issueUpdate { issue { ...F } } }'
  const { client, f } = make({ routes: { '(anonymous)': { status: 503, json: { errors: [{ message: 'down' }] } } }, sleep: async () => {} })
  const error = await client.request(document).catch((caught) => caught)
  assert.equal(error.message, 'Linear did not confirm the change: HTTP 503')
  assert.equal(f.calls.filter((call) => call.body.query === document).length, 1)
})

test('AUTH, RATE_LIMITED and query errors are sent once with no sleep', async () => {
  for (const answer of [
    errorsBody(401, graphqlError('AUTHENTICATION_ERROR')),
    { status: 429, json: {} },
    errorsBody(400, graphqlError('RATELIMITED')),
    errorsBody(400, graphqlError('GRAPHQL_VALIDATION_FAILED')),
  ]) {
    const { slept, sleep } = sleeper()
    const { client, f } = make({ routes: { Q: answer }, sleep })
    await client.request('query Q { a }').catch(() => {})
    assert.equal(callsTo(f, 'Q'), 1)
    assert.deepEqual(slept, [])
  }
})

const LIMIT_HEADERS = {
  'x-ratelimit-requests-limit': '2500',
  'x-ratelimit-requests-remaining': '2400',
  'x-ratelimit-requests-reset': '1793000000000',
  'x-ratelimit-complexity-limit': '3000000',
  'x-ratelimit-complexity-remaining': '2999000',
  'x-ratelimit-complexity-reset': '1793000060000',
  'x-complexity': '3',
}

test('rateLimit is null before any response and reads the headers after', async () => {
  const { client } = make({ routes: { Q: json({ a: 1 }, { headers: LIMIT_HEADERS }) } })
  assert.equal(client.rateLimit(), null)
  await client.request('query Q { a }')
  assert.deepEqual(client.rateLimit(), {
    requests: { limit: 2500, remaining: 2400, resetAt: '2026-10-26T07:33:20.000Z' },
    complexity: { limit: 3000000, remaining: 2999000, resetAt: '2026-10-26T07:34:20.000Z' },
    lastComplexity: 3,
  })
})

test('a bucket at zero with a future reset stops the next request before it is sent', async () => {
  let time = 1_000_000
  const headers = { 'x-ratelimit-requests-remaining': '0', 'x-ratelimit-requests-reset': String(time + 60_000) }
  const { client, f } = make({ routes: { Q: json({ a: 1 }, { headers }) }, now: () => time })
  await client.request('query Q { a }')
  const before = f.calls.length
  const error = await client.request('query Q { a }').catch((caught) => caught)
  expectError(error, 'RATE_LIMITED', "Linear's requests limit for this key is used up", `Wait until ${new Date(time + 60_000).toISOString()} and retry`)
  assert.equal(f.calls.length, before)
  time += 61_000
  assert.deepEqual(await client.request('query Q { a }'), { a: 1 })
})

test('missing, partial or unreadable rate headers never block and never leak NaN', async () => {
  for (const headers of [
    { 'x-ratelimit-requests-remaining': 'abc' },
    { 'x-ratelimit-requests-remaining': '0' },
    { 'x-ratelimit-requests-remaining': '0', 'x-ratelimit-requests-reset': 'soon' },
  ]) {
    const { client } = make({ routes: { Q: json({ a: 1 }, { headers }) } })
    await client.request('query Q { a }')
    assert.deepEqual(await client.request('query Q { a }'), { a: 1 })
    const text = JSON.stringify(client.rateLimit())
    assert.ok(!/NaN|Invalid Date/.test(text))
    assert.equal(client.rateLimit().requests.resetAt, null)
    assert.equal(client.rateLimit().requests.limit, null)
  }
})

// Paging.
const ISSUES =
  'query Issues($first: Int!, $after: String) { issues(first: $first, after: $after) { pageInfo { hasNextPage endCursor } nodes { id } } }'

// A connection of `total` nodes (Infinity for no end). The cursor is the offset after the page.
function issuesRoute(total) {
  return (body) => {
    const start = body.variables.after ? Number(body.variables.after.slice(1)) : 0
    const end = Math.min(start + body.variables.first, total)
    const nodes = Array.from({ length: end - start }, (_, index) => ({ id: `i${start + index}` }))
    return json({ issues: page(nodes, { hasNextPage: end < total, endCursor: `c${end}` }) })
  }
}

const select = (data) => data.issues
const firsts = (f) => f.calls.filter((call) => call.body.query.includes('Issues')).map((call) => call.body.variables.first)

test('paginate returns the pages in order and chains the cursors', async () => {
  const { client, f } = make({ routes: { Issues: issuesRoute(250) } })
  const result = await client.paginate(ISSUES, { teamId: 't1' }, { select, pageSize: 100 })
  assert.equal(result.nodes.length, 250)
  assert.deepEqual(result.nodes.map((node) => node.id).slice(0, 3), ['i0', 'i1', 'i2'])
  assert.equal(result.hasMore, false)
  const issueCalls = f.calls.filter((call) => call.body.query.includes('Issues'))
  assert.equal(issueCalls[0].body.variables.after ?? null, null)
  assert.deepEqual(issueCalls.map((call) => call.body.variables.after ?? null), [null, 'c100', 'c200'])
  for (const call of issueCalls) assert.equal(call.body.variables.teamId, 't1')
})

test('limit trims the last page and sets hasMore', async () => {
  const { client, f } = make({ routes: { Issues: issuesRoute(Infinity) } })
  const result = await client.paginate(ISSUES, {}, { select, pageSize: 100, limit: 250 })
  assert.deepEqual(firsts(f), [100, 100, 50])
  assert.equal(result.nodes.length, 250)
  assert.equal(result.hasMore, true)
})

test('with no limit, paging stops after 10 pages', async () => {
  const { client, f } = make({ routes: { Issues: issuesRoute(Infinity) } })
  const result = await client.paginate(ISSUES, {}, { select })
  assert.equal(firsts(f).length, 10)
  assert.equal(result.nodes.length, 1000)
  assert.equal(result.hasMore, true)
})

test('a limit of 1500 runs 15 pages', async () => {
  const { client, f } = make({ routes: { Issues: issuesRoute(Infinity) } })
  const result = await client.paginate(ISSUES, {}, { select, pageSize: 100, limit: 1500 })
  assert.equal(firsts(f).length, 15)
  assert.equal(result.nodes.length, 1500)
  assert.equal(result.hasMore, true)
})

test('maxPages caps the loop, and a last page without a next page ends it', async () => {
  const capped = make({ routes: { Issues: issuesRoute(Infinity) } })
  const result = await capped.client.paginate(ISSUES, {}, { select, maxPages: 2 })
  assert.equal(firsts(capped.f).length, 2)
  assert.equal(result.hasMore, true)
  const single = make({ routes: { Issues: issuesRoute(5) } })
  assert.deepEqual(await single.client.paginate(ISSUES, {}, { select }), { nodes: ['i0', 'i1', 'i2', 'i3', 'i4'].map((id) => ({ id })), hasMore: false })
  assert.equal(firsts(single.f).length, 1)
})

test('select can reach a nested connection', async () => {
  const route = json({ team: { issues: page([{ id: 'a' }]) } })
  const { client } = make({ routes: { Issues: route } })
  const result = await client.paginate(ISSUES, {}, { select: (data) => data.team.issues })
  assert.deepEqual(result, { nodes: [{ id: 'a' }], hasMore: false })
})

test('a broken page is UPSTREAM', async () => {
  const broken = [
    json({ issues: { nodes: [] } }),
    json({ issues: { pageInfo: { hasNextPage: false, endCursor: null } } }),
    json({ issues: page([{ id: 'a' }], { hasNextPage: true, endCursor: null }) }),
    json({ issues: null }),
    json({}),
  ]
  for (const route of broken) {
    const { client } = make({ routes: { Issues: route } })
    const error = await client.paginate(ISSUES, {}, { select }).catch((caught) => caught)
    expectError(error, 'UPSTREAM', 'Linear returned a broken page for Issues', RETRY)
  }
  const returnsNull = make({ routes: { Issues: json({ team: null }) } })
  for (const pick of [() => null, () => undefined, (data) => data.team.issues]) {
    const error = await returnsNull.client.paginate(ISSUES, {}, { select: pick }).catch((caught) => caught)
    assert.equal(error.message, 'Linear returned a broken page for Issues')
  }
})

test('a repeated cursor stops the loop with UPSTREAM', async () => {
  const route = json({ issues: page([{ id: 'a' }], { hasNextPage: true, endCursor: 'same' }) })
  const { client, f } = make({ routes: { Issues: route } })
  const error = await client.paginate(ISSUES, {}, { select }).catch((caught) => caught)
  assert.equal(error.message, 'Linear returned a broken page for Issues')
  assert.equal(firsts(f).length, 2)
})

test('an anonymous document is named as such in the broken-page message', async () => {
  const { client } = make({ routes: { '(anonymous)': json({ issues: null }) } })
  const error = await client.paginate('{ issues { nodes { id } } }', {}, { select }).catch((caught) => caught)
  assert.equal(error.message, 'Linear returned a broken page for an anonymous query')
})

test('a caller bug throws TypeError before any request', async () => {
  const { client, f } = make({ routes: { Issues: issuesRoute(5) } })
  const bad = [
    { select, pageSize: 0 },
    { select, pageSize: 251 },
    { select, pageSize: 1.5 },
    { select, maxPages: 0 },
    { select, limit: 0 },
    {},
  ]
  for (const options of bad) await assert.rejects(client.paginate(ISSUES, {}, options), TypeError)
  await assert.rejects(client.paginate(ISSUES), TypeError)
  assert.equal(f.calls.length, 0)
})

// The key-leak sweep.
function textsOf(error) {
  return [error.message, error.nextStep, JSON.stringify(error.details ?? null), String(error), error.stack ?? '']
}

test('no failure path exposes the key', async () => {
  const sleep = async () => {}
  const answers = {
    401: errorsBody(401, graphqlError('AUTHENTICATION_ERROR')),
    403: errorsBody(403, graphqlError('FORBIDDEN')),
    429: { status: 429, headers: { 'x-ratelimit-requests-remaining': '0', 'x-ratelimit-requests-reset': '1793000000000' }, json: {} },
    ratelimited: errorsBody(400, graphqlError('RATELIMITED')),
    validation: errorsBody(400, graphqlError('GRAPHQL_VALIDATION_FAILED')),
    parse: errorsBody(400, graphqlError('GRAPHQL_PARSE_FAILED')),
    other: errorsBody(200, graphqlError('INPUT_ERROR')),
    unreadable: { status: 400, text: 'not json' },
    teapot: { status: 418, json: { data: null } },
    unavailable: { status: 503, text: '<html>' },
    network: { throws: econnreset() },
    quoting: { throws: new Error(`header ${FAKE_KEY}`) },
    quotingCause: { throws: new TypeError('fetch failed', { cause: new Error(`Authorization: ${FAKE_KEY}`) }) },
  }
  const cases = []
  for (const [name, answer] of Object.entries(answers)) {
    cases.push([name, async () => (await make({ routes: { Q: answer }, sleep }).client.request('query Q { a }').catch((e) => e))])
  }
  cases.push(['hang', async () => make({ routes: { Q: { hang: true } }, timeoutMs: 10, retries: 0 }).client.request('query Q { a }').catch((e) => e)])
  cases.push(['mutation hang', async () => make({ routes: { M: { hang: true } }, timeoutMs: 10 }).client.request('mutation M { a }').catch((e) => e)])
  cases.push(['workspace mismatch', async () => make({ fake: { workspace: 'other' } }).client.session().catch((e) => e)])
  cases.push(['no organization', async () => make({ routes: { PmkitSession: json({}) } }).client.session().catch((e) => e)])
  cases.push(['secret in tracker', async () => {
    const tracker = { system: 'linear', scope: { workspace: 'acme', token: FAKE_KEY, note: FAKE_KEY } }
    try {
      createLinearClient({ env: ENV, tracker, fetch: fake() })
    } catch (error) {
      return error
    }
    return assert.fail('did not throw')
  }])
  cases.push(['bad credential', async () => {
    try {
      createLinearClient({ env: { LINEAR_API_KEY: `Bearer ${FAKE_KEY}` }, tracker: TRACKER, fetch: fake() })
    } catch (error) {
      return error
    }
    return assert.fail('did not throw')
  }])
  cases.push(['broken page', async () => {
    const { client } = make({ routes: { Issues: json({ issues: null }) } })
    return client.paginate(ISSUES, {}, { select }).catch((e) => e)
  }])
  cases.push(['pre-send rate refusal', async () => {
    const headers = { 'x-ratelimit-requests-remaining': '0', 'x-ratelimit-requests-reset': String(Date.now() + 60_000) }
    const { client } = make({ routes: { Q: json({ a: 1 }, { headers }) } })
    await client.request('query Q { a }')
    return client.request('query Q { a }').catch((e) => e)
  }])

  for (const [name, run] of cases) {
    const error = await run()
    assert.ok(error instanceof PmkitError, `${name}: expected a PmkitError`)
    for (const text of textsOf(error)) {
      assert.ok(!text.includes(FAKE_KEY) && !text.includes('TESTKEY'), `${name} leaks the key`)
    }
  }

  const renamed = make({ fake: { workspace: 'acme-new', previousUrlKeys: ['acme'] } })
  const passing = JSON.stringify(await renamed.client.session()) + JSON.stringify(renamed.client.rateLimit())
  assert.ok(!passing.includes('TESTKEY'))
  const limited = make({ routes: { Q: json({ a: 1 }, { headers: LIMIT_HEADERS }) } })
  await limited.client.request('query Q { a }')
  assert.ok(!JSON.stringify(limited.client.rateLimit()).includes('TESTKEY'))
})
