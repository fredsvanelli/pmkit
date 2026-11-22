import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_EMAIL, FAKE_ENV, FAKE_HEADER, FAKE_TOKEN, TRACKER, fakeJiraFetch } from '../../fake-jira-api.mjs'
import { PmkitError } from '../errors.mjs'
import { createJiraClient } from './client.mjs'

// A client created without a fake fetch fails loudly instead of reaching the network.
globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

const SITE = 'https://acme.atlassian.net'
const ISSUE = 'GET /rest/api/3/issue/ENG-1'
const RETRY_STEP = 'Retry, and check status.atlassian.com if it keeps failing'
const CHANGE_STEP = 'Check in Jira whether the change was applied before you retry'

function setup(routes = {}, options = {}) {
  const fetch = fakeJiraFetch(routes)
  const sleeps = []
  const client = createJiraClient({ env: FAKE_ENV, tracker: TRACKER, fetch, sleep: async (ms) => sleeps.push(ms), ...options })
  return { fetch, client, sleeps }
}

/** The error a promise or function throws. Every error is checked for the credential on the way out. */
async function failure(run) {
  try {
    await run()
  } catch (error) {
    assertNoSecret(error)
    return error
  }
  assert.fail('did not throw')
}

function assertNoSecret(error) {
  const texts = [error.message, error.nextStep ?? '', JSON.stringify(error.details ?? {}), String(error)]
  for (const text of texts) {
    for (const secret of [FAKE_TOKEN, FAKE_EMAIL, FAKE_HEADER, FAKE_HEADER.slice(6), 'TESTTOKEN']) assert.ok(!text.includes(secret), `${secret} leaked into ${text}`)
  }
}

function assertError(error, code, message, nextStep) {
  assert.ok(error instanceof PmkitError, String(error))
  assert.equal(error.code, code)
  assert.equal(error.message, message)
  if (nextStep !== undefined) assert.equal(error.nextStep, nextStep)
}

const paths = (fetch) => fetch.calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)

test('creating a client sends nothing', () => {
  const { fetch } = setup()
  assert.equal(fetch.calls.length, 0)
})

test('a missing credential fails at creation with no request', async () => {
  const fetch = fakeJiraFetch()
  const error = await failure(() => createJiraClient({ env: {}, tracker: TRACKER, fetch }))
  assertError(error, 'AUTH', 'JIRA_EMAIL is not set', '/pmkit:setup')
  assert.equal(fetch.calls.length, 0)
})

test('a missing site is NOT_CONFIGURED', async () => {
  const error = await failure(() => createJiraClient({ env: FAKE_ENV, tracker: { system: 'jira', scope: {} }, fetch: fakeJiraFetch() }))
  assertError(error, 'NOT_CONFIGURED', 'tracker.scope.site is not set', '/pmkit:setup')
})

test('a site that is not a bare host is NOT_CONFIGURED', async () => {
  for (const site of ['https://acme.atlassian.net/', 'acme.atlassian.net/x', 'acme.atlassian.net:443', 'u@acme.atlassian.net', 'ac me.net', 'localhost', 42]) {
    const error = await failure(() => createJiraClient({ env: FAKE_ENV, tracker: { system: 'jira', scope: { site } }, fetch: fakeJiraFetch() }))
    assertError(
      error, 'NOT_CONFIGURED', 'tracker.scope.site must be a host such as acme.atlassian.net',
      "Set tracker.scope.site in .pmkit/config.yaml to the site's host, with no https:// or path",
    )
  }
})

test('the site is lowercased', async () => {
  const fetch = fakeJiraFetch({ [ISSUE]: { json: {} } })
  const client = createJiraClient({ env: FAKE_ENV, tracker: { system: 'jira', scope: { site: 'ACME.atlassian.net' } }, fetch })
  await client.request('GET', '/rest/api/3/issue/ENG-1')
  assert.ok(fetch.calls.every((call) => call.url.startsWith(`${SITE}/`)))
})

test('a secret-like key in the tracker block is INVALID_INPUT naming the path only, with no request', async () => {
  const fetch = fakeJiraFetch()
  const tracker = { system: 'jira', scope: { site: 'acme.atlassian.net', api_token: FAKE_TOKEN } }
  const error = await failure(() => createJiraClient({ env: FAKE_ENV, tracker, fetch }))
  assertError(error, 'INVALID_INPUT', '.pmkit/config.yaml holds a secret-like key at tracker.scope.api_token', 'Remove it from .pmkit/config.yaml and keep the Jira token in JIRA_API_TOKEN')
  assert.equal(fetch.calls.length, 0)
})

test('the first call reads serverInfo without the credential, then myself with it, then the request', async () => {
  const { fetch, client } = setup({ [ISSUE]: { json: { key: 'ENG-1' } } })
  assert.deepEqual(await client.request('GET', '/rest/api/3/issue/ENG-1'), { key: 'ENG-1' })
  assert.deepEqual(paths(fetch), ['GET /rest/api/3/serverInfo', 'GET /rest/api/3/myself', ISSUE])
  assert.equal(fetch.calls[0].headers.authorization, undefined)
  assert.equal(fetch.calls[1].headers.authorization, FAKE_HEADER)
  assert.equal(fetch.calls[2].headers.authorization, FAKE_HEADER)
})

test('two concurrent first calls share one session check', async () => {
  const { fetch, client } = setup({ [ISSUE]: { json: {} } })
  await Promise.all([client.request('GET', '/rest/api/3/issue/ENG-1'), client.request('GET', '/rest/api/3/issue/ENG-1')])
  assert.equal(paths(fetch).filter((p) => p.endsWith('/serverInfo')).length, 1)
  assert.equal(paths(fetch).filter((p) => p.endsWith('/myself')).length, 1)
})

test('session() returns the source, the site and the viewer, without the email', async () => {
  const { client } = setup()
  assert.deepEqual(await client.session(), { source: 'JIRA_API_TOKEN', site: 'acme.atlassian.net', viewer: { accountId: 'acc-1', displayName: 'Test User' } })
})

test('REST v3 and Agile reads go to the site with Accept, a manual redirect and the query string', async () => {
  const { fetch, client } = setup({ 'GET /rest/agile/1.0/board': { json: { values: [] } }, 'GET /rest/api/3/search/jql': { json: { issues: [] } } })
  await client.request('GET', '/rest/agile/1.0/board')
  await client.request('GET', '/rest/api/3/search/jql', { query: { jql: 'project = ENG', fields: ['summary', 'status'], skip: undefined } })
  const [board, search] = fetch.calls.slice(2)
  assert.equal(board.url, `${SITE}/rest/agile/1.0/board`)
  assert.equal(board.headers.accept, 'application/json')
  assert.equal(board.redirect, 'manual')
  assert.equal(search.url, `${SITE}/rest/api/3/search/jql?jql=project+%3D+ENG&fields=summary&fields=status`)
})

test('a POST sends JSON, and an empty 204 resolves null', async () => {
  const { fetch, client } = setup({ 'POST /rest/api/3/issue': { status: 201, json: { id: '10001' } }, 'PUT /rest/api/3/issue/ENG-1': { status: 204 } })
  assert.deepEqual(await client.request('POST', '/rest/api/3/issue', { body: { fields: { summary: 'x' } } }), { id: '10001' })
  assert.equal(await client.request('PUT', '/rest/api/3/issue/ENG-1', { body: {} }), null)
  const post = fetch.calls[2]
  assert.equal(post.headers['content-type'], 'application/json')
  assert.equal(post.body, JSON.stringify({ fields: { summary: 'x' } }))
})

test('a path outside REST v3 and Agile, a full URL or an unknown method throws TypeError with no request', async () => {
  const { fetch, client } = setup()
  for (const [method, path] of [['GET', '/wiki/x'], ['GET', 'https://evil.example/rest/api/3/x'], ['GET', '//evil.example/rest/api/3/x'], ['GET', '/rest/api/3/x?y=1'], ['GET', '/rest/api/3/../../wiki/x'], ['GET', '/rest/agile/1.0/./board'], ['PATCH', '/rest/api/3/x']]) {
    await assert.rejects(client.request(method, path), TypeError)
  }
  assert.equal(fetch.calls.length, 0)
})

test('a site that is not Cloud is NOT_SUPPORTED and myself is never called', async () => {
  const cases = [
    [{ json: { deploymentType: 'Server' } }, 'acme.atlassian.net runs Jira Server; pmkit supports Jira Cloud only'],
    [{ json: { version: '9.12.0' } }, 'acme.atlassian.net runs Jira Server or Data Center; pmkit supports Jira Cloud only'],
    [{ status: 401, json: {} }, 'acme.atlassian.net runs Jira Server or Data Center; pmkit supports Jira Cloud only'],
  ]
  for (const [answer, message] of cases) {
    const { fetch, client } = setup({ 'GET /rest/api/3/serverInfo': answer })
    assertError(await failure(() => client.session()), 'NOT_SUPPORTED', message, 'Use a Jira Cloud site (ADR 0013)')
    assert.deepEqual(paths(fetch), ['GET /rest/api/3/serverInfo'])
  }
})

test('a failed session check fails every later call the same way', async () => {
  const { fetch, client } = setup({ 'GET /rest/api/3/serverInfo': { json: { deploymentType: 'DataCenter' } } })
  const first = await failure(() => client.request('GET', '/rest/api/3/issue/ENG-1'))
  const second = await failure(() => client.request('GET', '/rest/api/3/issue/ENG-1'))
  assert.equal(first, second)
  assert.equal(fetch.calls.length, 1)
})

test('a viewer with no displayName has null', async () => {
  const { client } = setup({ 'GET /rest/api/3/myself': { json: { accountId: 'acc-2' } } })
  assert.deepEqual((await client.session()).viewer, { accountId: 'acc-2', displayName: null })
})

test('an unreadable Retry-After falls back to X-RateLimit-Reset', async () => {
  const { client } = setup({ [ISSUE]: { status: 429, headers: { 'Retry-After': 'soon', 'X-RateLimit-Reset': '2025-10-08T15:00:00Z' }, text: '' } })
  assertError(await failure(() => client.request('GET', '/rest/api/3/issue/ENG-1')), 'RATE_LIMITED', "Jira's rate limit for this account is used up", 'Wait until 2025-10-08T15:00:00.000Z and retry')
})

test('myself without an accountId is UPSTREAM', async () => {
  const { client } = setup({ 'GET /rest/api/3/myself': { json: { displayName: 'x' } } })
  assertError(await failure(() => client.session()), 'UPSTREAM', 'Jira returned no account for this token', RETRY_STEP)
})

const ROWS = [
  ['CAPTCHA', { status: 401, headers: { 'X-Seraph-LoginReason': 'AUTHENTICATION_DENIED' }, json: {} }, 'AUTH',
    "Jira wants a CAPTCHA before it accepts this account's token", 'Sign in to acme.atlassian.net in a browser once to clear the CAPTCHA, then retry'],
  ['401', { status: 401, text: '' }, 'AUTH',
    'Jira rejected JIRA_EMAIL and JIRA_API_TOKEN; the token may have expired', 'Create an API token at id.atlassian.com and export JIRA_EMAIL and JIRA_API_TOKEN'],
  ['403', { status: 403, json: { errorMessages: ['You do not have permission.'] } }, 'AUTH',
    'Jira refused the request for this account: You do not have permission.', "Check that the token's owner has the permission in acme.atlassian.net"],
  ['429 with Retry-After', { status: 429, headers: { 'Retry-After': '120' }, text: '' }, 'RATE_LIMITED',
    "Jira's rate limit for this account is used up", 'Wait until 1970-01-01T00:02:00.000Z and retry'],
  ['429 with X-RateLimit-Reset', { status: 429, headers: { 'X-RateLimit-Reset': '2025-10-08T15:00:00Z' }, text: '' }, 'RATE_LIMITED',
    "Jira's rate limit for this account is used up", 'Wait until 2025-10-08T15:00:00.000Z and retry'],
  ['429 bare', { status: 429, text: '' }, 'RATE_LIMITED', "Jira's rate limit for this account is used up", 'Wait a few minutes and retry'],
  ['302', { status: 302, headers: { Location: 'https://other.example/' }, text: '' }, 'NOT_CONFIGURED',
    'Jira at acme.atlassian.net redirected the request (HTTP 302)', "Check tracker.scope.site in .pmkit/config.yaml; a renamed site needs its new host"],
  ['400 errorMessages', { status: 400, json: { errorMessages: ['  Bad\n  JQL  '] } }, 'INVALID_INPUT', 'Jira rejected the request: Bad JQL', "Check the request against Jira's message"],
  ['400 errors', { status: 400, json: { errors: { summary: 'Summary is required.' } } }, 'INVALID_INPUT', 'Jira rejected the request: Summary is required.', "Check the request against Jira's message"],
  ['404', { status: 404, json: { errorMessages: ['Issue does not exist'] } }, 'NOT_FOUND',
    'Jira found nothing at GET /rest/api/3/issue/ENG-1: Issue does not exist', "Check the key or id, and that the token's owner can see it"],
  ['409', { status: 409, json: { errorMessages: ['Version conflict'] } }, 'CONFLICT', 'Jira reported a conflict: Version conflict', 'Read the item again and retry'],
  ['2xx not JSON', { status: 200, text: '<html>oops</html>' }, 'UPSTREAM', 'Jira returned an unreadable answer (HTTP 200)', RETRY_STEP],
  ['418', { status: 418, text: 'teapot' }, 'UPSTREAM', 'Jira answered HTTP 418: no message', RETRY_STEP],
]

for (const [name, answer, code, message, nextStep] of ROWS) {
  test(`error row: ${name}`, async () => {
    const { fetch, client } = setup({ [ISSUE]: answer }, { now: () => 0 })
    assertError(await failure(() => client.request('GET', '/rest/api/3/issue/ENG-1')), code, message, nextStep)
    assert.equal(paths(fetch).filter((p) => p === ISSUE).length, 1, 'not retried')
  })
}

test('details.jira holds the status and Jira\'s messages', async () => {
  const { client } = setup({ [ISSUE]: { status: 400, json: { errorMessages: ['a'], errors: { f: 'e' } } } })
  const error = await failure(() => client.request('GET', '/rest/api/3/issue/ENG-1'))
  assert.deepEqual(error.details, { jira: { status: 400, errorMessages: ['a'], errors: { f: 'e' } } })
})

test('a 404 message holds the path without the query string', async () => {
  const { client } = setup({ 'GET /rest/api/3/search/jql': { status: 404, json: { errorMessages: ['m'] } } })
  const error = await failure(() => client.request('GET', '/rest/api/3/search/jql', { query: { jql: 'summary ~ secret' } }))
  assertError(error, 'NOT_FOUND', 'Jira found nothing at GET /rest/api/3/search/jql: m')
})

const reset = () => ({ throws: Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }) })

test('a GET is retried after network errors with 500 and 2000 ms waits', async () => {
  const { fetch, client, sleeps } = setup({ [ISSUE]: [reset(), reset(), { json: { ok: true } }] })
  assert.deepEqual(await client.request('GET', '/rest/api/3/issue/ENG-1'), { ok: true })
  assert.deepEqual(sleeps, [500, 2000])
  assert.equal(paths(fetch).filter((p) => p === ISSUE).length, 3)
})

test('a GET that keeps failing is UPSTREAM after three attempts', async () => {
  for (const [answer, reason] of [[reset(), 'ECONNRESET'], [{ status: 503, text: '' }, 'HTTP 503']]) {
    const { fetch, client } = setup({ [ISSUE]: answer })
    assertError(await failure(() => client.request('GET', '/rest/api/3/issue/ENG-1')), 'UPSTREAM', `Jira did not answer: ${reason}`, RETRY_STEP)
    assert.equal(paths(fetch).filter((p) => p === ISSUE).length, 3)
  }
})

test('a write that fails without a clear answer is sent once and says the change is unconfirmed', async () => {
  const cases = [
    [{ hang: true }, 'Jira did not confirm the change: timed out after 0.02 s'],
    [{ status: 502, text: '' }, 'Jira did not confirm the change: HTTP 502'],
    [{ status: 200, text: 'not json' }, 'Jira did not confirm the change: unreadable answer (HTTP 200)'],
    [{ throws: new Error('boom') }, 'Jira did not confirm the change: network error'],
  ]
  for (const [answer, message] of cases) {
    const { fetch, client } = setup({ 'POST /rest/api/3/issue': answer }, { timeoutMs: 20 })
    assertError(await failure(() => client.request('POST', '/rest/api/3/issue', { body: {} })), 'UPSTREAM', message, CHANGE_STEP)
    assert.equal(paths(fetch).filter((p) => p === 'POST /rest/api/3/issue').length, 1)
  }
})

test('a GET that hangs times out', async () => {
  const { client } = setup({ [ISSUE]: { hang: true } }, { timeoutMs: 20, retries: 0 })
  assertError(await failure(() => client.request('GET', '/rest/api/3/issue/ENG-1')), 'UPSTREAM', 'Jira did not answer: timed out after 0.02 s')
})

test('a fetch error that quotes the header never reaches the error', async () => {
  const { client } = setup({ [ISSUE]: { throws: new Error(`bad header Authorization: ${FAKE_HEADER}`) } }, { retries: 0 })
  assertError(await failure(() => client.request('GET', '/rest/api/3/issue/ENG-1')), 'UPSTREAM', 'Jira did not answer: network error')
})

const BOARDS = 'GET /rest/agile/1.0/board'
const queryOf = (call) => Object.fromEntries(new URL(call.url).searchParams)
const answers = (bodies) => bodies.map((json) => ({ json }))
const pageCalls = (fetch, key) => fetch.calls.filter((call) => `${call.method} ${new URL(call.url).pathname}` === key)

test('paginate walks offset pages until isLast', async () => {
  const pages = [{ values: [1, 2], isLast: false }, { values: [3, 4], isLast: false }, { values: [5, 6], isLast: true }]
  const { fetch, client } = setup({ [BOARDS]: answers(pages) })
  assert.deepEqual(await client.paginate('/rest/agile/1.0/board', { pageSize: 2, query: { type: 'scrum' } }), { items: [1, 2, 3, 4, 5, 6], hasMore: false })
  assert.deepEqual(pageCalls(fetch, BOARDS).map(queryOf), [
    { type: 'scrum', maxResults: '2' },
    { type: 'scrum', maxResults: '2', startAt: '2' },
    { type: 'scrum', maxResults: '2', startAt: '4' },
  ])
})

test('paginate moves startAt by the items Jira returned, not by the page size asked', async () => {
  const { fetch, client } = setup({ [BOARDS]: answers([{ values: [1], isLast: false }, { values: [2], isLast: true }]) })
  await client.paginate('/rest/agile/1.0/board', { pageSize: 2 })
  assert.equal(queryOf(pageCalls(fetch, BOARDS)[1]).startAt, '1')
})

test('paginate stops at total and at an empty page', async () => {
  const total = setup({ [BOARDS]: answers([{ values: [1, 2], total: 3 }, { values: [3], total: 3 }]) })
  assert.deepEqual(await total.client.paginate('/rest/agile/1.0/board', { pageSize: 2 }), { items: [1, 2, 3], hasMore: false })
  assert.equal(pageCalls(total.fetch, BOARDS).length, 2)
  const empty = setup({ [BOARDS]: answers([{ values: [1] }, { values: [] }]) })
  assert.deepEqual(await empty.client.paginate('/rest/agile/1.0/board'), { items: [1], hasMore: false })
})

test('paginate follows nextPageToken on search/jql', async () => {
  const search = 'GET /rest/api/3/search/jql'
  const { fetch, client } = setup({ [search]: answers([{ issues: [{ id: '1' }], nextPageToken: 't1' }, { issues: [{ id: '2' }], isLast: true }]) })
  const result = await client.paginate('/rest/api/3/search/jql', { key: 'issues', query: { jql: 'project = ENG' } })
  assert.deepEqual(result, { items: [{ id: '1' }, { id: '2' }], hasMore: false })
  const [first, second] = pageCalls(fetch, search).map(queryOf)
  assert.deepEqual(first, { jql: 'project = ENG', maxResults: '50' })
  assert.deepEqual(second, { jql: 'project = ENG', maxResults: '50', nextPageToken: 't1' })
})

test('paginate stops at the limit, asks for only what it needs and says Jira had more', async () => {
  const { fetch, client } = setup({ [BOARDS]: answers([{ values: [1, 2] }, { values: [3] }, { values: [4] }]) })
  assert.deepEqual(await client.paginate('/rest/agile/1.0/board', { pageSize: 2, limit: 3 }), { items: [1, 2, 3], hasMore: true })
  assert.deepEqual(pageCalls(fetch, BOARDS).map((call) => queryOf(call).maxResults), ['2', '1'])
})

test('paginate stops at 10 pages without a limit, and at maxPages', async () => {
  const endless = setup({ [BOARDS]: { json: { values: [1], isLast: false } } })
  const result = await endless.client.paginate('/rest/agile/1.0/board')
  assert.equal(result.items.length, 10)
  assert.equal(result.hasMore, true)
  assert.equal(pageCalls(endless.fetch, BOARDS).length, 10)
  const capped = setup({ [BOARDS]: { json: { values: [1], isLast: false } } })
  assert.equal((await capped.client.paginate('/rest/agile/1.0/board', { maxPages: 2 })).hasMore, true)
  assert.equal(pageCalls(capped.fetch, BOARDS).length, 2)
})

test('a broken page is UPSTREAM', async () => {
  for (const pages of [[{ json: { issues: [] } }], [{ json: { values: [1], nextPageToken: 't' } }, { json: { values: [2], nextPageToken: 't' } }]]) {
    const { client } = setup({ [BOARDS]: answers(pages) })
    assertError(await failure(() => client.paginate('/rest/agile/1.0/board')), 'UPSTREAM', 'Jira returned a broken page for /rest/agile/1.0/board', RETRY_STEP)
  }
})

test('bad paging options throw TypeError with no request', async () => {
  const { fetch, client } = setup()
  for (const options of [{ pageSize: 0 }, { pageSize: 101 }, { pageSize: 1.5 }, { maxPages: 0 }, { limit: 0 }]) {
    await assert.rejects(client.paginate('/rest/agile/1.0/board', options), TypeError)
  }
  await assert.rejects(client.paginate('/wiki/x'), TypeError)
  assert.equal(fetch.calls.length, 0)
})
