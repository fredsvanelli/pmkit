import assert from 'node:assert/strict'
import test from 'node:test'
import { BB, FAKE_BB_ENV, FAKE_BB_TOKEN, fakeBitbucketFetch } from '../../fake-bitbucket-api.mjs'
import { PmkitError } from '../errors.mjs'
import { createBitbucketClient } from './client.mjs'

// A client created without a fake fetch fails loudly instead of reaching the network.
globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

const API = 'https://api.bitbucket.org'
const PRS = `GET ${BB}/pullrequests`
const RETRY_STEP = 'Retry, and check bitbucket.status.atlassian.com if it keeps failing'
const CHANGE_STEP = 'Check the pull request on Bitbucket before you retry'

function setup(routes = {}, options = {}) {
  const fetch = fakeBitbucketFetch(routes)
  const sleeps = []
  const client = createBitbucketClient({ env: FAKE_BB_ENV, repo: 'acme/widgets', fetch, sleep: async (ms) => sleeps.push(ms), ...options })
  return { fetch, client, sleeps }
}

/** The error a promise or function throws. Every error is checked for the token on the way out. */
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
  for (const text of [error.message, error.nextStep ?? '', JSON.stringify(error.details ?? {}), String(error)]) {
    for (const secret of [FAKE_BB_TOKEN, 'TESTTOKEN']) assert.ok(!text.includes(secret), `${secret} leaked into ${text}`)
  }
}

function assertError(error, code, message, nextStep) {
  assert.ok(error instanceof PmkitError, String(error))
  assert.equal(error.code, code)
  assert.equal(error.message, message)
  if (nextStep !== undefined) assert.equal(error.nextStep, nextStep)
}

const bbError = (message) => ({ type: 'error', error: { message } })

test('creating a client sends nothing', () => {
  const { fetch } = setup()
  assert.equal(fetch.calls.length, 0)
})

test('a missing token fails at creation with no request', async () => {
  const fetch = fakeBitbucketFetch()
  const error = await failure(() => createBitbucketClient({ env: {}, repo: 'acme/widgets', fetch }))
  assertError(error, 'AUTH', 'BITBUCKET_TOKEN is not set', '/pmkit:setup')
  assert.equal(fetch.calls.length, 0)
})

test('a repo that is not workspace/repo_slug is NOT_CONFIGURED', async () => {
  for (const repo of ['a', '', undefined, 'a/b/c', 'a b/c', './x', 'x/..', '../x', 'x/.']) {
    const error = await failure(() => createBitbucketClient({ env: FAKE_BB_ENV, repo, fetch: fakeBitbucketFetch() }))
    assertError(error, 'NOT_CONFIGURED', 'git_host.repo must be workspace/repo_slug')
  }
})

test('get sends the Bearer token to the repository URL with the query', async () => {
  const { client, fetch } = setup({ [PRS]: { json: { values: [] } } })
  assert.deepEqual(await client.get('pullrequests', { state: 'OPEN' }), { values: [] })
  const [call] = fetch.calls
  assert.equal(call.url, `${API}${BB}/pullrequests?state=OPEN`)
  assert.equal(call.method, 'GET')
  assert.equal(call.headers.authorization, `Bearer ${FAKE_BB_TOKEN}`)
})

test('get repeats a list query value and skips undefined ones', async () => {
  const { client, fetch } = setup({ [PRS]: { json: {} } })
  await client.get('pullrequests', { state: ['OPEN', 'MERGED'], q: 'source.branch.name="a b"', sort: undefined })
  assert.equal(fetch.calls[0].url, `${API}${BB}/pullrequests?state=OPEN&state=MERGED&q=source.branch.name%3D%22a+b%22`)
})

test("get('') reads the repository itself", async () => {
  const { client, fetch } = setup({ [`GET ${BB}`]: { json: { full_name: 'acme/widgets' } } })
  assert.deepEqual(await client.get(''), { full_name: 'acme/widgets' })
  assert.equal(fetch.calls[0].url, `${API}${BB}`)
})

test('a path outside the pattern is a TypeError with no request', async () => {
  const { client, fetch } = setup()
  for (const path of ['/pullrequests', 'pullrequests/', '../x', 'pullrequests/../../other', 'pullrequests/7?x=1', 'https://evil.example/x', 'Pull', 'a//b', 'a/.', undefined]) {
    await assert.rejects(client.get(path), TypeError, String(path))
  }
  assert.equal(fetch.calls.length, 0)
})

test('a segment with braces, such as a pipeline uuid, is sent encoded', async () => {
  const { client, fetch } = setup({ [`GET ${BB}/pipelines/{uuid}/steps`]: (call) => ({ json: { uuid: call.params.uuid } }) })
  assert.deepEqual(await client.get('pipelines/{abc-1}/steps'), { uuid: '{abc-1}' })
  assert.equal(fetch.calls[0].url, `${API}${BB}/pipelines/%7Babc-1%7D/steps`)
})

test('post and put send JSON once and return the answer', async () => {
  const { client, fetch } = setup({ [`POST ${BB}/pullrequests`]: { status: 201, json: { id: 7 } }, [`PUT ${BB}/pullrequests/7`]: { json: { id: 7, draft: false } } })
  assert.deepEqual(await client.post('pullrequests', { title: 't' }), { id: 7 })
  assert.deepEqual(await client.put('pullrequests/7', { draft: false }), { id: 7, draft: false })
  assert.equal(fetch.calls[0].method, 'POST')
  assert.equal(fetch.calls[0].body, '{"title":"t"}')
  assert.equal(fetch.calls[0].headers['content-type'], 'application/json')
  assert.equal(fetch.calls[0].headers.authorization, `Bearer ${FAKE_BB_TOKEN}`)
  assert.equal(fetch.calls[1].method, 'PUT')
})

test('list follows next links and stops at limit with cut: true', async () => {
  const { client, fetch } = setup({
    [PRS]: [
      { json: { values: [1, 2], next: `${API}${BB}/pullrequests?page=2` } },
      { json: { values: [3, 4], next: `${API}${BB}/pullrequests?page=3` } },
    ],
  })
  assert.deepEqual(await client.list('pullrequests', { state: 'OPEN' }, { limit: 4 }), { values: [1, 2, 3, 4], cut: true })
  assert.deepEqual(fetch.calls.map((call) => call.url), [`${API}${BB}/pullrequests?state=OPEN`, `${API}${BB}/pullrequests?page=2`])
  for (const call of fetch.calls) assert.equal(call.headers.authorization, `Bearer ${FAKE_BB_TOKEN}`)
})

test('list ends with cut: false when no next is left, and trims to limit', async () => {
  const { client } = setup({ [PRS]: [{ json: { values: [1, 2], next: `${API}${BB}/pullrequests?page=2` } }, { json: { values: [3] } }] })
  assert.deepEqual(await client.list('pullrequests', {}, { limit: 10 }), { values: [1, 2, 3], cut: false })
  const short = setup({ [PRS]: { json: { values: [1, 2, 3] } } })
  assert.deepEqual(await short.client.list('pullrequests', {}, { limit: 2 }), { values: [1, 2], cut: true })
})

test('list needs a positive integer limit', async () => {
  const { client } = setup()
  for (const options of [undefined, {}, { limit: 0 }, { limit: 1.5 }]) await assert.rejects(client.list('pullrequests', {}, options), TypeError)
})

test('a next link off the repository is UPSTREAM and is never called', async () => {
  for (const next of ['https://evil.example/2.0/repositories/acme/widgets/pullrequests?page=2', 'http://api.bitbucket.org/2.0/repositories/acme/widgets/pullrequests', 'https://api.bitbucket.org/2.0/repositories/acme/other/pullrequests', 'https://api.bitbucket.org:8443/2.0/repositories/acme/widgets/pullrequests', 'https://user@api.bitbucket.org/2.0/repositories/acme/widgets/pullrequests', 'not a url']) {
    const { client, fetch } = setup({ [PRS]: { json: { values: [1], next } } })
    const error = await failure(() => client.list('pullrequests', {}, { limit: 5 }))
    assert.equal(error.code, 'UPSTREAM', next)
    assert.equal(fetch.calls.length, 1)
  }
})

test('a page with no values list, or an empty page with a next, is UPSTREAM', async () => {
  for (const json of [{ next: `${API}${BB}/pullrequests?page=2` }, { values: [], next: `${API}${BB}/pullrequests?page=2` }]) {
    const { client } = setup({ [PRS]: { json } })
    const error = await failure(() => client.list('pullrequests', {}, { limit: 5 }))
    assertError(error, 'UPSTREAM', 'Bitbucket returned a broken page for pullrequests')
  }
})

test('401 is AUTH and says the token may have expired or lack a scope', async () => {
  const { client } = setup({ [PRS]: { status: 401, json: bbError('Token is invalid') } })
  const error = await failure(() => client.get('pullrequests'))
  assertError(error, 'AUTH', 'Bitbucket refused BITBUCKET_TOKEN (HTTP 401): it may have expired or lack a scope')
  assert.equal(error.httpStatus, 401)
})

test('403 is UPSTREAM with httpStatus 403 and quotes Bitbucket on one line', async () => {
  const { client } = setup({ [PRS]: { status: 403, json: bbError(`Your credentials lack\none or more required privilege scopes. ${'x'.repeat(300)}`) } })
  const error = await failure(() => client.get('pullrequests'))
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.httpStatus, 403)
  assert.match(error.message, /Your credentials lack one or more required privilege scopes\. x+$/)
  assert.ok(!error.message.includes('\n'))
  assert.equal(error.details.bitbucket.message.length, 200)
})

test('404 on a path is UPSTREAM with httpStatus 404', async () => {
  const { client } = setup({ [`GET ${BB}/pullrequests/9`]: { status: 404, json: bbError('Pull request not found') } })
  const error = await failure(() => client.get('pullrequests/9'))
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.httpStatus, 404)
  assert.match(error.message, /Pull request not found/)
})

test("404 on the repository itself is NOT_CONFIGURED", async () => {
  const { client } = setup({ [`GET ${BB}`]: { status: 404, json: bbError('Repository acme/widgets not found') } })
  const error = await failure(() => client.get(''))
  assertError(error, 'NOT_CONFIGURED', 'git_host.repo acme/widgets was not found or the token cannot read it', '/pmkit:setup')
})

test('429 is RATE_LIMITED and is not retried', async () => {
  const { client, fetch } = setup({ [PRS]: { status: 429, text: '' } })
  const error = await failure(() => client.get('pullrequests'))
  assert.equal(error.code, 'RATE_LIMITED')
  assert.equal(fetch.calls.length, 1)
})

test('500 on a GET is retried twice, then UPSTREAM', async () => {
  const { client, fetch, sleeps } = setup({ [PRS]: { status: 500, text: 'oops' } })
  const error = await failure(() => client.get('pullrequests'))
  assertError(error, 'UPSTREAM', 'Bitbucket did not answer: HTTP 500', RETRY_STEP)
  assert.equal(fetch.calls.length, 3)
  assert.deepEqual(sleeps, [500, 2000])
})

test('a GET that fails then succeeds returns the answer', async () => {
  const { client, fetch } = setup({ [PRS]: [{ throws: new TypeError('fetch failed') }, { json: { ok: true } }] })
  assert.deepEqual(await client.get('pullrequests'), { ok: true })
  assert.equal(fetch.calls.length, 2)
})

test('a write with no answer is sent once and says to check Bitbucket', async () => {
  for (const answer of [{ status: 500, text: '' }, { throws: new TypeError('fetch failed') }, { status: 200, text: 'not json' }, { hang: true }]) {
    const { client, fetch } = setup({ [`POST ${BB}/pullrequests`]: answer }, { timeoutMs: 20 })
    const error = await failure(() => client.post('pullrequests', { title: 't' }))
    assertError(error, 'UPSTREAM', 'Bitbucket did not confirm the change', CHANGE_STEP)
    assert.equal(fetch.calls.length, 1)
  }
})

test('a timeout on a GET says so', async () => {
  const { client } = setup({ [PRS]: { hang: true } }, { timeoutMs: 20, retries: 0 })
  const error = await failure(() => client.get('pullrequests'))
  assertError(error, 'UPSTREAM', 'Bitbucket did not answer: timed out after 0.02 s')
})

test("a network error never copies the fetch error's message", async () => {
  const leak = new TypeError(`fetch failed: Bearer ${FAKE_BB_TOKEN}`)
  leak.cause = { code: 'ECONNRESET', message: FAKE_BB_TOKEN }
  const { client } = setup({ [PRS]: { throws: leak } }, { retries: 0 })
  const error = await failure(() => client.get('pullrequests'))
  assertError(error, 'UPSTREAM', 'Bitbucket did not answer: ECONNRESET')
})

test("Bitbucket's message never carries the token out", async () => {
  const { client } = setup({ [PRS]: { status: 400, json: bbError(`bad token ${FAKE_BB_TOKEN}`) } })
  const error = await failure(() => client.get('pullrequests'))
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.httpStatus, 400)
})

test('a redirect on a JSON call is UPSTREAM and is not followed', async () => {
  const { client, fetch } = setup({ [PRS]: { status: 302, headers: { location: 'https://evil.example/x' } } })
  const error = await failure(() => client.get('pullrequests'))
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.httpStatus, 302)
  assert.equal(fetch.calls.length, 1)
  assert.equal(fetch.calls[0].redirect, 'manual')
})

test('getText returns the body and follows a redirect that stays in the repository', async () => {
  const { client, fetch } = setup({
    [`GET ${BB}/pullrequests/7/diff`]: { status: 302, headers: { location: `${API}${BB}/diff/acme/widgets:abc%0Ddef?from_pullrequest_id=7` } },
    [`GET ${BB}/diff/acme/widgets:abc%0Ddef`]: { text: 'diff --git a/x b/x\n' },
  })
  assert.equal(await client.getText('pullrequests/7/diff'), 'diff --git a/x b/x\n')
  assert.equal(fetch.calls.length, 2)
  assert.equal(fetch.calls[1].url, `${API}${BB}/diff/acme/widgets:abc%0Ddef?from_pullrequest_id=7`)
  assert.equal(fetch.calls[1].headers.authorization, `Bearer ${FAKE_BB_TOKEN}`)
})

test('getText resolves a relative redirect against the API host', async () => {
  const { client, fetch } = setup({
    [`GET ${BB}/pullrequests/7/diff`]: { status: 302, headers: { location: `${BB}/diff/x` } },
    [`GET ${BB}/diff/x`]: { text: 'd' },
  })
  assert.equal(await client.getText('pullrequests/7/diff'), 'd')
  assert.equal(fetch.calls[1].url, `${API}${BB}/diff/x`)
})

test('getText refuses a redirect off the repository and sends the token nowhere else', async () => {
  const { client, fetch } = setup({ [`GET ${BB}/pullrequests/7/diff`]: { status: 302, headers: { location: 'https://evil.example/diff' } } })
  const error = await failure(() => client.getText('pullrequests/7/diff'))
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(fetch.calls.length, 1)
})

test('getText maps an HTTP error with its status', async () => {
  const { client } = setup({ [`GET ${BB}/pullrequests/7/diff`]: { status: 413, json: bbError('too large') } })
  const error = await failure(() => client.getText('pullrequests/7/diff'))
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.httpStatus, 413)
})

test('a 5xx that never gets a good answer carries its httpStatus, on a read and on a write', async () => {
  const read = setup({ [PRS]: { status: 503, text: '' } })
  assert.equal((await failure(() => read.client.get('pullrequests'))).httpStatus, 503)
  const write = setup({ [`POST ${BB}/pullrequests`]: { status: 502, text: '' } })
  assert.equal((await failure(() => write.client.post('pullrequests', {}))).httpStatus, 502)
})

test('a next link or redirect whose workspace and slug differ only in case stays in the repository', async () => {
  const { client, fetch } = setup({
    [PRS]: [{ json: { values: [1], next: `${API}/2.0/repositories/ACME/Widgets/pullrequests?page=2` } }],
    'GET /2.0/repositories/ACME/Widgets/pullrequests': { json: { values: [2] } },
    [`GET ${BB}/pullrequests/7/diff`]: { status: 302, headers: { location: `${API}/2.0/repositories/Acme/WIDGETS/diff/x` } },
    'GET /2.0/repositories/Acme/WIDGETS/diff/x': { text: 'd' },
  })
  assert.deepEqual(await client.list('pullrequests', {}, { limit: 5 }), { values: [1, 2], cut: false })
  assert.equal(await client.getText('pullrequests/7/diff'), 'd')
  assert.equal(fetch.calls.length, 4)
})

test('a next link to a repository whose name only starts with the slug is refused', async () => {
  const { client, fetch } = setup({ [PRS]: { json: { values: [1], next: `${API}/2.0/repositories/acme/WIDGETS2/pullrequests` } } })
  assert.equal((await failure(() => client.list('pullrequests', {}, { limit: 5 }))).code, 'UPSTREAM')
  assert.equal(fetch.calls.length, 1)
})

test('404 whose message says the repository was not found is NOT_CONFIGURED on any path', async () => {
  for (const message of ['Repository acme/widgets not found', 'Repository not found']) {
    const { client } = setup({ [`GET ${BB}/pipelines`]: { status: 404, json: bbError(message) } })
    const error = await failure(() => client.get('pipelines'))
    assertError(error, 'NOT_CONFIGURED', 'git_host.repo acme/widgets was not found or the token cannot read it', '/pmkit:setup')
    assert.equal(error.httpStatus, 404)
  }
})

test('404 with another message on a path stays UPSTREAM', async () => {
  const { client } = setup({ [`GET ${BB}/pipelines/x`]: { status: 404, json: bbError('Pipeline not found') } })
  const error = await failure(() => client.get('pipelines/x'))
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.httpStatus, 404)
})

test('a path segment with braces, such as a pipeline uuid, is sent percent-encoded', async () => {
  const { client, fetch } = setup({ [`GET ${BB}/pipelines/{uuid}/steps`]: { json: { values: [] } } })
  await client.list('pipelines/{abc-1}/steps', {}, { limit: 10 })
  assert.equal(new URL(fetch.calls[0].url).pathname, `${BB}/pipelines/%7Babc-1%7D/steps`)
})
