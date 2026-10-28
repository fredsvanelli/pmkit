import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_KEY, fakeLinearFetch, json, page } from './fake-linear-api.mjs'
import { operationName } from './lib/linear/client.mjs'

const ENDPOINT = 'https://api.linear.app/graphql'
const post = (fetch, query, variables = {}, extra = {}) =>
  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: FAKE_KEY },
    body: JSON.stringify({ query, variables }),
    ...extra,
  })

test('operationName reads the name and skips comments', () => {
  assert.equal(operationName('query Issues($a: Int) { x }'), 'Issues')
  assert.equal(operationName('mutation IssueCreate { x }'), 'IssueCreate')
  assert.equal(operationName('{ viewer { id } }'), null)
  assert.equal(operationName('# note\nquery Q { x }'), 'Q')
})

test('the fake records each call with plain headers and a parsed body', async () => {
  const fetch = fakeLinearFetch({ Q: json({ a: 1 }) })
  await post(fetch, 'query Q { a }', { x: 1 })
  assert.equal(fetch.calls.length, 1)
  const [call] = fetch.calls
  assert.equal(call.url, ENDPOINT)
  assert.equal(call.method, 'POST')
  assert.deepEqual(call.headers, { 'Content-Type': 'application/json', Authorization: FAKE_KEY })
  assert.deepEqual(call.body, { query: 'query Q { a }', variables: { x: 1 } })
})

test('PmkitSession answers by default and can change the workspace', async () => {
  const doc = 'query PmkitSession { viewer { id name } }'
  const fetch = fakeLinearFetch()
  const body = JSON.parse(await (await post(fetch, doc)).text())
  assert.deepEqual(body, {
    data: {
      viewer: { id: 'user-1', name: 'Test User' },
      organization: { urlKey: 'acme', name: 'Acme', previousUrlKeys: [] },
    },
  })
  const other = fakeLinearFetch({}, { workspace: 'other', previousUrlKeys: ['acme'] })
  const data = JSON.parse(await (await post(other, doc)).text()).data
  assert.equal(data.organization.urlKey, 'other')
  assert.deepEqual(data.organization.previousUrlKeys, ['acme'])
})

test('a single route answers every call, a list answers by call number', async () => {
  const one = fakeLinearFetch({ Q: json({ a: 1 }) })
  for (let i = 0; i < 3; i++) assert.deepEqual(JSON.parse(await (await post(one, 'query Q { a }')).text()).data, { a: 1 })
  const list = fakeLinearFetch({ Q: [json({ n: 1 }), json({ n: 2 })] })
  const seen = []
  for (let i = 0; i < 3; i++) seen.push(JSON.parse(await (await post(list, 'query Q { a }')).text()).data.n)
  assert.deepEqual(seen, [1, 2, 2])
})

test('a function route receives the parsed body', async () => {
  const fetch = fakeLinearFetch({ Q: (body) => json({ echo: body.variables.x }) })
  assert.deepEqual(JSON.parse(await (await post(fetch, 'query Q { a }', { x: 7 })).text()).data, { echo: 7 })
})

test('raw text, status, headers and ok', async () => {
  const fetch = fakeLinearFetch({
    T: { text: 'oops', status: 400 },
    H: json({ a: 1 }, { headers: { 'X-RateLimit-Requests-Remaining': '5' } }),
  })
  const raw = await post(fetch, 'query T { a }')
  assert.equal(raw.status, 400)
  assert.equal(raw.ok, false)
  assert.equal(await raw.text(), 'oops')
  const withHeaders = await post(fetch, 'query H { a }')
  assert.equal(withHeaders.ok, true)
  assert.equal(withHeaders.headers.get('x-ratelimit-requests-remaining'), '5')
})

test('throws rejects with the given error', async () => {
  const error = new TypeError('fetch failed')
  const fetch = fakeLinearFetch({ Q: { throws: error } })
  await assert.rejects(post(fetch, 'query Q { a }'), (caught) => caught === error)
})

test('hang stays pending until the signal aborts', async () => {
  const fetch = fakeLinearFetch({ Q: { hang: true } })
  const signal = AbortSignal.timeout(10)
  await assert.rejects(post(fetch, 'query Q { a }', {}, { signal }), (caught) => caught === signal.reason)
})

test('textRejects resolves the response and rejects text()', async () => {
  const fetch = fakeLinearFetch({ Q: { textRejects: true, status: 200 } })
  const response = await post(fetch, 'query Q { a }')
  assert.equal(response.status, 200)
  await assert.rejects(response.text(), { name: 'TypeError', message: 'terminated' })
})

test('an operation with no route is recorded and rejected', async () => {
  const fetch = fakeLinearFetch()
  await assert.rejects(post(fetch, 'query Missing { a }'), { message: 'fake linear: no route for Missing' })
  await assert.rejects(post(fetch, '{ a }'), { message: 'fake linear: no route for (anonymous)' })
  assert.deepEqual(fetch.unrouted, ['Missing', '(anonymous)'])
})

test('page builds a Relay connection', () => {
  assert.deepEqual(page([{ id: 1 }], { hasNextPage: true, endCursor: 'c1' }), {
    pageInfo: { hasNextPage: true, endCursor: 'c1' },
    nodes: [{ id: 1 }],
  })
  assert.deepEqual(page([]).pageInfo, { hasNextPage: false, endCursor: null })
})
