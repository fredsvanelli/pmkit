import assert from 'node:assert/strict'
import test from 'node:test'
import { createGithubClient, parseIncluded } from './client.mjs'
import { INSTALL_STEP } from './host.mjs'

const TOKEN = `ghp_${'a1B2'.repeat(9)}`
const QUERY = 'query Repo($owner: String!) { repository(owner: $owner, name: "r") { id } }'
const MUTATION = 'mutation Close($id: ID!) { closeIssue(input: { issueId: $id }) { issue { id } } }'
const ARGS = ['api', 'graphql', '--include', '--input', '-']

/** A gh api --include answer: the status line, the headers, a blank line and the body. */
function answer({ status = 200, headers = {}, body = { data: { ok: true } }, stderr = '', exit } = {}) {
  const head = [`HTTP/2.0 ${status} ${status === 200 ? 'OK' : 'Error'}`, 'Content-Type: application/json; charset=utf-8', ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)]
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  const failed = status !== 200 || (typeof body === 'object' && Array.isArray(body.errors))
  return { status: exit ?? (failed ? 1 : 0), stdout: `${head.join('\r\n')}\r\n\r\n${text}`, stderr }
}

/** An exec that records each call and answers from a queue. A function entry runs, so it can throw. */
function fakeExec(...queue) {
  const calls = []
  const exec = (cmd, args, options = {}) => {
    calls.push({ cmd, args, ...options })
    const next = queue.length > 1 ? queue.shift() : queue[0]
    if (next === undefined) throw new Error('fake exec: no answer queued')
    return typeof next === 'function' ? next() : next
  }
  return { exec, calls }
}

const spawnError = (code) => () => {
  const error = new Error(`spawnSync gh ${code}`)
  error.code = code
  throw error
}

function setup(queue, options = {}) {
  const fake = fakeExec(...queue)
  const sleeps = []
  const client = createGithubClient({ root: '/repo', env: { GH_TOKEN: TOKEN }, exec: fake.exec, sleep: async (ms) => sleeps.push(ms), ...options })
  return { client, calls: fake.calls, sleeps }
}

async function failure(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  assert.fail('expected the call to throw')
}

const noToken = (error) => {
  const text = JSON.stringify({ message: error.message, nextStep: error.nextStep, details: error.details })
  assert.ok(!text.includes(TOKEN), 'the token leaked into the error')
}

// The request path

test('request runs gh api graphql with the body on stdin and returns data', async () => {
  const { client, calls } = setup([answer({ body: { data: { repository: { id: 'R_1' } } } })])
  const data = await client.request(QUERY, { owner: '@etc/passwd' })
  assert.deepEqual(data, { repository: { id: 'R_1' } })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].cmd, 'gh')
  assert.deepEqual(calls[0].args, ARGS)
  assert.deepEqual(JSON.parse(calls[0].input), { query: QUERY, variables: { owner: '@etc/passwd' } })
  assert.equal(calls[0].timeout, 30_000)
})

test('request passes --hostname when a host is set', async () => {
  const { client, calls } = setup([answer()], { host: 'github.acme.com' })
  await client.request(QUERY)
  assert.deepEqual(calls[0].args, ['api', '--hostname', 'github.acme.com', 'graphql', '--include', '--input', '-'])
  assert.deepEqual(JSON.parse(calls[0].input).variables, {})
})

test('a host that is not a host name is refused before any call', () => {
  for (const host of ['--jq', 'a b', 'https://github.com', '', 'acme.com/x', 7]) {
    assert.throws(
      () => createGithubClient({ root: '/repo', env: {}, host, exec: () => assert.fail('gh ran') }),
      (error) => error.code === 'INVALID_INPUT',
      String(host),
    )
  }
  assert.doesNotThrow(() => createGithubClient({ root: '/repo', env: {}, host: 'ghes.acme.com:8443', exec: () => {} }))
})

test('the token in env never reaches argv or stdin', async () => {
  const { client, calls } = setup([answer()])
  await client.request(QUERY, { a: 1 })
  assert.ok(!JSON.stringify(calls).includes(TOKEN))
})

test('request refuses a document that is not a string', async () => {
  const { client } = setup([answer()])
  await assert.rejects(client.request(undefined), TypeError)
})

test('parseIncluded reads the status, lowercase headers and the body', () => {
  assert.deepEqual(parseIncluded('HTTP/2.0 502 Bad Gateway\r\nX-Ratelimit-Remaining: 4\r\n\r\n{"a":1}'), { status: 502, headers: { 'x-ratelimit-remaining': '4' }, body: '{"a":1}' })
  assert.deepEqual(parseIncluded('HTTP/1.1 200 OK\n\n{}'), { status: 200, headers: {}, body: '{}' })
  assert.equal(parseIncluded(''), null)
  assert.equal(parseIncluded('{"data":{}}'), null)
})

// The error table, in the spec's order

test('a missing gh is NOT_CONFIGURED with the git host install step', async () => {
  const { client } = setup([spawnError('ENOENT')])
  const error = await failure(client.request(QUERY))
  assert.equal(error.code, 'NOT_CONFIGURED')
  assert.equal(error.message, 'gh is not installed')
  assert.equal(error.nextStep, INSTALL_STEP)
})

test('output over the buffer is UPSTREAM', async () => {
  const { client } = setup([spawnError('ENOBUFS')])
  const error = await failure(client.request(QUERY))
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.message, 'gh api graphql output is too large to read')
  assert.equal(error.nextStep, 'Ask for fewer nodes per page')
})

test('an unknown spawn error is thrown as it is', async () => {
  const { client } = setup([spawnError('EACCES')])
  const error = await failure(client.request(QUERY))
  assert.equal(error.code, 'EACCES')
})

const NO_LOGIN = { status: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n' }

test('no gh login is AUTH with gh auth login', async () => {
  const { client } = setup([NO_LOGIN])
  const error = await failure(client.request(QUERY))
  assert.equal(error.code, 'AUTH')
  assert.equal(error.message, 'GitHub CLI is not logged in')
  assert.equal(error.nextStep, 'gh auth login')
})

test('the host step names any host but github.com', async () => {
  const steps = {}
  for (const host of ['github.com', 'GitHub.com', 'acme.ghe.com', 'github.acme.com']) {
    const { client } = setup([NO_LOGIN], { host })
    steps[host] = (await failure(client.request(QUERY))).nextStep
  }
  assert.deepEqual(steps, {
    'github.com': 'gh auth login',
    'GitHub.com': 'gh auth login',
    'acme.ghe.com': 'gh auth login -h acme.ghe.com',
    'github.acme.com': 'gh auth login -h github.acme.com',
  })
})

test('HTTP 401 is AUTH and names the token variables', async () => {
  const { client } = setup([answer({ status: 401, body: { message: 'Bad credentials', status: '401' }, stderr: 'gh: Bad credentials (HTTP 401)\n' })], { host: 'github.acme.com' })
  const error = await failure(client.request(QUERY))
  assert.equal(error.code, 'AUTH')
  assert.equal(error.message, 'GitHub rejected the token of the gh login')
  assert.equal(error.nextStep, 'Run gh auth login -h github.acme.com, or fix the token in GH_TOKEN or GH_ENTERPRISE_TOKEN')
  noToken(error)
})

const scopesError = (scopes) => ({
  errors: [{ type: 'INSUFFICIENT_SCOPES', locations: [{ line: 1, column: 40 }], message: `Your token has not been granted the required scopes to execute this query. The 'id' field requires one of the following scopes: [${scopes}], but your token has only been granted the: ['gist', 'read:org', 'repo'] scopes. Please modify your token's scopes at: https://github.com/settings/tokens.` }],
})

test('INSUFFICIENT_SCOPES for a Project is AUTH with gh auth refresh -s project', async () => {
  const { client } = setup([answer({ body: scopesError("'read:project'") })])
  const error = await failure(client.request(QUERY))
  assert.equal(error.code, 'AUTH')
  assert.match(error.message, /^The gh login lacks a scope this query needs: Your token has not been granted/)
  assert.ok(error.message.length <= 'The gh login lacks a scope this query needs: '.length + 200)
  assert.equal(error.nextStep, 'gh auth refresh -s project')
  assert.deepEqual(error.details, { github: { status: 200, errors: [{ type: 'INSUFFICIENT_SCOPES', code: null, path: null }] } })
})

test('INSUFFICIENT_SCOPES names the scope GitHub asks for when it is not a Project scope', async () => {
  const { client } = setup([answer({ body: scopesError("'read:org', 'admin:org'") })], { host: 'github.acme.com' })
  const error = await failure(client.request(QUERY))
  assert.equal(error.nextStep, 'gh auth refresh -s read:org -h github.acme.com')
})

test('INSUFFICIENT_SCOPES without a scope list falls back to project', async () => {
  const { client } = setup([answer({ body: { errors: [{ type: 'INSUFFICIENT_SCOPES', message: 'Missing scopes.' }] } })], { host: 'acme.ghe.com' })
  const error = await failure(client.request(QUERY))
  assert.equal(error.nextStep, 'gh auth refresh -s project -h acme.ghe.com')
})

test("a fine-grained PAT's not accessible error is AUTH with the token step", async () => {
  const body = { data: { node: null }, errors: [{ type: 'FORBIDDEN', path: ['node'], message: 'Resource not accessible by personal access token' }] }
  const { client } = setup([answer({ body })], { host: 'github.acme.com' })
  const error = await failure(client.request(QUERY))
  assert.equal(error.code, 'AUTH')
  assert.equal(error.message, 'GitHub refused the personal access token: Resource not accessible by personal access token')
  assert.equal(error.nextStep, 'Give the token read and write access to Projects and Issues in its GitHub settings, or unset GH_TOKEN and run gh auth refresh -s project -h github.acme.com')
})

test('a PAT refusal names the permissions the caller gives, with no gh auth refresh', async () => {
  const body = { errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by personal access token' }] }
  const step = 'Give the token read and write access to Discussions in its GitHub settings, or unset GH_TOKEN to use the gh login'
  for (const host of [undefined, 'github.acme.com']) {
    const { client } = setup([answer({ body })], { host })
    const error = await failure(client.request(QUERY, {}, { permissions: 'Discussions' }))
    assert.equal(error.code, 'AUTH')
    assert.equal(error.message, 'GitHub refused the personal access token: Resource not accessible by personal access token')
    assert.equal(error.nextStep, step)
  }
})

test('options without permissions keep the Projects and Issues step', async () => {
  const body = { errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by personal access token' }] }
  const { client } = setup([answer({ body })])
  const error = await failure(client.request(QUERY, {}, {}))
  assert.equal(error.nextStep, 'Give the token read and write access to Projects and Issues in its GitHub settings, or unset GH_TOKEN and run gh auth refresh -s project')
})

test('request refuses permissions that are not a non-empty string before any call', async () => {
  const { client, calls } = setup([answer()])
  for (const permissions of ['', '  ', 7, null]) {
    await assert.rejects(client.request(QUERY, {}, { permissions }), TypeError)
  }
  assert.equal(calls.length, 0)
})

test('a SAML refusal is AUTH with the single sign-on step', async () => {
  const body = { errors: [{ type: 'FORBIDDEN', message: 'Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.' }] }
  const { client } = setup([answer({ body })])
  const error = await failure(client.request(QUERY))
  assert.equal(error.code, 'AUTH')
  assert.match(error.message, /^The organization's single sign-on blocks the gh token: Resource protected by organization SAML enforcement/)
  assert.equal(error.nextStep, "Authorize the gh token for the organization's single sign-on on GitHub, then retry")
})

test('a RATE_LIMITED error waits until the reset when the limit is at 0', async () => {
  const body = { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded for user ID 1.' }] }
  const { client } = setup([answer({ body, headers: { 'X-Ratelimit-Remaining': '0', 'X-Ratelimit-Reset': '1794855679' } })])
  const error = await failure(client.request(QUERY))
  assert.equal(error.code, 'RATE_LIMITED')
  assert.equal(error.message, "GitHub's rate limit for this login is used up")
  assert.equal(error.nextStep, `Wait until ${new Date(1794855679 * 1000).toISOString()} and retry`)
})

test('HTTP 429 with Retry-After names the seconds', async () => {
  const { client } = setup([answer({ status: 429, body: { message: 'slow down' }, headers: { 'Retry-After': '60' } })])
  const error = await failure(client.request(QUERY))
  assert.equal(error.code, 'RATE_LIMITED')
  assert.equal(error.nextStep, 'Wait 60 s and retry')
})

test('a secondary rate limit on HTTP 403 is RATE_LIMITED, not AUTH', async () => {
  const body = { message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' }
  const { client } = setup([answer({ status: 403, body, stderr: 'gh: You have exceeded a secondary rate limit. (HTTP 403)\n' })])
  const error = await failure(client.request(QUERY))
  assert.equal(error.code, 'RATE_LIMITED')
  assert.equal(error.nextStep, 'Wait a few minutes and retry')
})

test('another FORBIDDEN error is AUTH with the access step', async () => {
  const body = { data: { addSubIssue: null }, errors: [{ type: 'FORBIDDEN', path: ['addSubIssue'], message: 'Resource not accessible by integration' }] }
  const { client } = setup([answer({ body })])
  const error = await failure(client.request(MUTATION))
  assert.equal(error.code, 'AUTH')
  assert.equal(error.message, 'GitHub refused the request for the gh login: Resource not accessible by integration')
  assert.equal(error.nextStep, 'Check that the gh account can read and write the repository and its Project')
  assert.deepEqual(error.details.github.errors, [{ type: 'FORBIDDEN', code: null, path: ['addSubIssue'] }])
})

test('HTTP 403 without a GraphQL error is AUTH', async () => {
  const { client } = setup([answer({ status: 403, body: { message: 'Must have admin rights to Repository.' } })])
  const error = await failure(client.request(QUERY))
  assert.equal(error.code, 'AUTH')
  assert.equal(error.message, 'GitHub refused the request for the gh login: Must have admin rights to Repository.')
})

test('NOT_FOUND with partial data is NOT_FOUND and keeps the path in details', async () => {
  const body = { data: { viewer: { login: 'fred' }, repository: null }, errors: [{ type: 'NOT_FOUND', path: ['repository'], locations: [{ line: 1, column: 21 }], message: "Could not resolve to a Repository with the name 'o/nope'." }] }
  const { client } = setup([answer({ body })])
  const error = await failure(client.request(QUERY))
  assert.equal(error.code, 'NOT_FOUND')
  assert.equal(error.message, "GitHub found nothing: Could not resolve to a Repository with the name 'o/nope'.")
  assert.equal(error.nextStep, 'Check the owner, repository and Project number, and that the gh account can see them')
  assert.deepEqual(error.details, { github: { status: 200, errors: [{ type: 'NOT_FOUND', code: null, path: ['repository'] }] } })
})

test('a validation error is UPSTREAM: GitHub rejected the query', async () => {
  const body = { errors: [{ path: ['query', 'viewer', 'nosuchfield'], extensions: { code: 'undefinedField', typeName: 'User', fieldName: 'nosuchfield' }, message: "Field 'nosuchfield' doesn't exist on type 'User'" }] }
  const { client } = setup([answer({ body })])
  const error = await failure(client.request(QUERY))
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.message, "GitHub rejected pmkit's query: Field 'nosuchfield' doesn't exist on type 'User'")
  assert.equal(error.nextStep, 'Update pmkit; if it still fails, report the query error')
  assert.deepEqual(error.details.github.errors, [{ type: null, code: 'undefinedField', path: ['query', 'viewer', 'nosuchfield'] }])
})

test('a parse error is UPSTREAM: GitHub rejected the query', async () => {
  const body = { errors: [{ message: 'Expected NAME, actual: (none) ("") at [1, 14]', locations: [{ line: 1, column: 14 }] }] }
  const { client } = setup([answer({ body })])
  const error = await failure(client.request(QUERY))
  assert.equal(error.message, 'GitHub rejected pmkit\'s query: Expected NAME, actual: (none) ("") at [1, 14]')
})

test('another GraphQL error is UPSTREAM with the GitHub message on one line', async () => {
  const body = { errors: [{ type: 'UNPROCESSABLE', message: 'Sub issue may only\nhave one parent' }] }
  const { client } = setup([answer({ body })])
  const error = await failure(client.request(MUTATION))
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.message, 'GitHub answered with an error: Sub issue may only have one parent')
  assert.equal(error.nextStep, "Check the request against GitHub's message")
})

test('an unreadable body is UPSTREAM on a query', async () => {
  const { client, calls } = setup([answer({ body: '<html>oops</html>', exit: 1 })])
  const error = await failure(client.request(QUERY))
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.message, 'GitHub returned an unreadable answer (HTTP 200)')
  assert.equal(error.nextStep, 'Update the GitHub CLI and retry')
  assert.equal(calls.length, 1)
})

test('an answer with no data and no errors is unreadable', async () => {
  const { client } = setup([answer({ body: { data: null } })])
  const error = await failure(client.request(QUERY))
  assert.equal(error.message, 'GitHub returned an unreadable answer (HTTP 200)')
})

test('an unreadable body on a mutation is not confirmed', async () => {
  const { client } = setup([answer({ body: 'nope', exit: 1 })])
  const error = await failure(client.request(MUTATION))
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.message, 'GitHub did not confirm the change: unreadable answer (HTTP 200)')
  assert.equal(error.nextStep, 'Check on GitHub whether the change was applied before you retry')
})

test('an unexpected HTTP status with a valid envelope is UPSTREAM', async () => {
  const { client } = setup([answer({ status: 302, body: { data: { ok: true } }, exit: 1 })])
  const error = await failure(client.request(QUERY))
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.message, 'GitHub answered HTTP 302')
})

test('an unknown failure with no answer is UPSTREAM with the first stderr line', async () => {
  const { client } = setup([{ status: 1, stdout: '', stderr: '\nunknown flag: --include\n' }])
  const error = await failure(client.request(QUERY))
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.message, 'gh api graphql failed: unknown flag: --include')
  assert.equal(error.nextStep, 'Check the output of the same command in a terminal')
})

test('an unknown failure with no answer hides absolute paths', async () => {
  const { client } = setup([{ status: 1, stdout: '', stderr: 'open /home/fred/secret/file: permission denied\n' }])
  const error = await failure(client.request(QUERY))
  assert.ok(!error.message.includes('/home/fred'), error.message)
})

test('an unknown failure with no answer on a mutation is not confirmed', async () => {
  const { client } = setup([{ status: 1, stdout: '', stderr: 'gh: something broke\n' }])
  const error = await failure(client.request(MUTATION))
  assert.equal(error.message, 'GitHub did not confirm the change: something broke')
})

test('no error message, next step or details holds the token', async () => {
  const cases = [NO_LOGIN, answer({ status: 401, body: { message: 'Bad credentials' } }), answer({ body: scopesError("'project'") }), { status: 1, stdout: '', stderr: 'error connecting to api.github.com\n' }]
  for (const result of cases) {
    const { client } = setup([result], { retries: 0 })
    noToken(await failure(client.request(QUERY)))
  }
})

// Retries and timeouts

test('a query is retried after a timeout, no connection and HTTP 502, with growing waits', async () => {
  const { client, calls, sleeps } = setup([spawnError('ETIMEDOUT'), { status: 1, stdout: '', stderr: 'error connecting to api.github.com\ncheck your internet connection\n' }, answer({ body: { data: { ok: 1 } } })])
  assert.deepEqual(await client.request(QUERY), { ok: 1 })
  assert.equal(calls.length, 3)
  assert.deepEqual(sleeps, [500, 2000])
})

test('a query stops after retries + 1 attempts', async () => {
  const { client, calls } = setup([answer({ status: 502, body: 'Bad Gateway', stderr: 'gh: HTTP 502\n' })])
  const error = await failure(client.request(QUERY))
  assert.equal(calls.length, 3)
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.message, 'GitHub did not answer: HTTP 502')
  assert.equal(error.nextStep, 'Retry, and check githubstatus.com if it keeps failing')
})

test('the timeout reason names the seconds', async () => {
  const { client, calls } = setup([spawnError('ETIMEDOUT')], { retries: 0, timeoutMs: 5000 })
  const error = await failure(client.request(QUERY))
  assert.equal(error.message, 'GitHub did not answer: timed out after 5 s')
  assert.equal(calls[0].timeout, 5000)
})

test('the connection reason is the gh line', async () => {
  const { client } = setup([{ status: 1, stdout: '', stderr: 'error connecting to github.acme.com\ncheck your internet connection or https://githubstatus.com\n' }], { retries: 0 })
  const error = await failure(client.request(QUERY))
  assert.equal(error.message, 'GitHub did not answer: error connecting to github.acme.com')
})

test('a mutation is sent once and is not confirmed after a timeout or a 5xx', async () => {
  for (const result of [spawnError('ETIMEDOUT'), answer({ status: 503, body: 'x' })]) {
    const { client, calls, sleeps } = setup([result])
    const error = await failure(client.request(MUTATION))
    assert.equal(calls.length, 1)
    assert.deepEqual(sleeps, [])
    assert.equal(error.code, 'UPSTREAM')
    assert.match(error.message, /^GitHub did not confirm the change: /)
    assert.equal(error.nextStep, 'Check on GitHub whether the change was applied before you retry')
  }
})

test('AUTH, NOT_FOUND and GraphQL errors are not retried', async () => {
  for (const result of [NO_LOGIN, answer({ body: { errors: [{ type: 'NOT_FOUND', message: 'x' }] } }), answer({ body: { errors: [{ type: 'SOMETHING', message: 'x' }] } })]) {
    const { client, calls } = setup([result])
    await failure(client.request(QUERY))
    assert.equal(calls.length, 1)
  }
})

// Rate limit

const RATE = { 'X-Ratelimit-Limit': '5000', 'X-Ratelimit-Remaining': '4993', 'X-Ratelimit-Used': '7', 'X-Ratelimit-Resource': 'graphql', 'X-Ratelimit-Reset': '1794855679' }

test('rateLimit is null before the first answer, then reads the headers', async () => {
  const { client } = setup([answer({ headers: RATE })])
  assert.equal(client.rateLimit(), null)
  await client.request(QUERY)
  assert.deepEqual(client.rateLimit(), { limit: 5000, remaining: 4993, used: 7, resource: 'graphql', resetAt: new Date(1794855679 * 1000).toISOString() })
})

test('an answer without rate headers keeps the last values', async () => {
  const { client } = setup([answer({ headers: RATE }), answer()])
  await client.request(QUERY)
  await client.request(QUERY)
  assert.equal(client.rateLimit().remaining, 4993)
})

test('a call after the limit hit 0 throws RATE_LIMITED without running gh', async () => {
  const reset = 2_000_000_000
  const { client, calls } = setup([answer({ headers: { ...RATE, 'X-Ratelimit-Remaining': '0', 'X-Ratelimit-Reset': String(reset) } })], { now: () => (reset - 60) * 1000 })
  await client.request(QUERY)
  const error = await failure(client.request(QUERY))
  assert.equal(error.code, 'RATE_LIMITED')
  assert.equal(error.nextStep, `Wait until ${new Date(reset * 1000).toISOString()} and retry`)
  assert.equal(calls.length, 1)
})

test('a call after the reset time runs gh again', async () => {
  const reset = 2_000_000_000
  let clock = (reset - 60) * 1000
  const { client, calls } = setup([answer({ headers: { ...RATE, 'X-Ratelimit-Remaining': '0', 'X-Ratelimit-Reset': String(reset) } }), answer()], { now: () => clock })
  await client.request(QUERY)
  clock = (reset + 1) * 1000
  await client.request(QUERY)
  assert.equal(calls.length, 2)
})

// Paging

const ISSUES = 'query Issues($first: Int!, $after: String) { repository(owner: "o", name: "r") { issues(first: $first, after: $after) { pageInfo { hasNextPage endCursor } nodes { number } } } }'
const page = (numbers, next) => answer({ body: { data: { repository: { issues: { pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes: numbers.map((number) => ({ number })) } } } } })
const select = (data) => data.repository.issues

test('paginate joins pages and passes first and after', async () => {
  const { client, calls } = setup([page([1, 2], 'c1'), page([3], null)])
  const result = await client.paginate(ISSUES, { label: 'bug' }, { select, pageSize: 2 })
  assert.deepEqual(result, { nodes: [{ number: 1 }, { number: 2 }, { number: 3 }], hasMore: false })
  assert.deepEqual(calls.map((call) => JSON.parse(call.input).variables), [{ label: 'bug', first: 2, after: null }, { label: 'bug', first: 2, after: 'c1' }])
})

test('paginate stops at limit and says there is more', async () => {
  const { client, calls } = setup([page([1, 2], 'c1'), page([3], 'c2')])
  const result = await client.paginate(ISSUES, {}, { select, pageSize: 2, limit: 3 })
  assert.deepEqual(result, { nodes: [{ number: 1 }, { number: 2 }, { number: 3 }], hasMore: true })
  assert.equal(JSON.parse(calls[1].input).variables.first, 1)
})

test('paginate stops after 10 pages without a limit', async () => {
  let n = 0
  const { client, calls } = setup([() => page([n], `c${++n}`)])
  const result = await client.paginate(ISSUES, {}, { select })
  assert.equal(calls.length, 10)
  assert.equal(result.hasMore, true)
  assert.equal(JSON.parse(calls[0].input).variables.first, 100)
})

test('paginate checks its options before any call', async () => {
  const { client, calls } = setup([page([1], null)])
  await assert.rejects(client.paginate(ISSUES, {}, { select, pageSize: 101 }), TypeError)
  await assert.rejects(client.paginate(ISSUES, {}, { select, pageSize: 0 }), TypeError)
  await assert.rejects(client.paginate(ISSUES, {}, {}), TypeError)
  await assert.rejects(client.paginate(ISSUES, {}, { select, limit: 0 }), TypeError)
  await assert.rejects(client.paginate(ISSUES, {}, { select, maxPages: 1.5 }), TypeError)
  assert.equal(calls.length, 0)
})

test('a broken page is UPSTREAM and names the operation', async () => {
  const broken = [
    answer({ body: { data: { repository: null } } }),
    answer({ body: { data: { repository: { issues: { nodes: [] } } } } }),
    page([1], ''),
  ]
  for (const result of broken) {
    const { client } = setup([result])
    const error = await failure(client.paginate(ISSUES, {}, { select }))
    assert.equal(error.code, 'UPSTREAM')
    assert.equal(error.message, 'GitHub returned a broken page for Issues')
  }
})

test('a repeated cursor is a broken page, so the loop ends', async () => {
  const { client, calls } = setup([page([1], 'same'), page([2], 'same')])
  const error = await failure(client.paginate(ISSUES, {}, { select }))
  assert.equal(error.message, 'GitHub returned a broken page for Issues')
  assert.equal(calls.length, 2)
})

test('SAML in a name GitHub echoes is not a single sign-on refusal', async () => {
  const body = { data: { repository: null }, errors: [{ type: 'NOT_FOUND', path: ['repository'], message: "Could not resolve to a Repository with the name 'acme/SAML-tools'." }] }
  const { client } = setup([answer({ body })])
  const error = await failure(client.request(QUERY))
  assert.equal(error.code, 'NOT_FOUND')
})

test('a failure with no answer and no stderr names the exit status', async () => {
  const { client } = setup([{ status: 3, stdout: '', stderr: '' }])
  const error = await failure(client.request(QUERY))
  assert.equal(error.message, 'gh api graphql failed: exit status 3')
  assert.deepEqual(error.details, { github: { status: null, errors: [] } })
})

test('unreadable rate headers read as null, and a limit at 0 with no reset time does not block the next call', async () => {
  const { client, calls } = setup([answer({ headers: { 'X-Ratelimit-Limit': 'many', 'X-Ratelimit-Remaining': '0', 'X-Ratelimit-Reset': '' } }), answer()])
  await client.request(QUERY)
  assert.deepEqual(client.rateLimit(), { limit: null, remaining: 0, used: null, resource: null, resetAt: null })
  await client.request(QUERY)
  assert.equal(calls.length, 2)
})

// The REST call

const REST_PATH = 'repos/acme/widgets/milestones'
const restAnswer = (status, body, exit) => answer({ status, body, exit: exit ?? (status < 300 ? 0 : 1) })

test('rest POST runs gh api with the method, the path and the body on stdin, and returns the parsed body', async () => {
  const { client, calls } = setup([restAnswer(201, { number: 3, title: 'v1' })], { host: 'github.acme.com' })
  const data = await client.rest('POST', REST_PATH, { title: 'v1' })
  assert.deepEqual(data, { number: 3, title: 'v1' })
  assert.deepEqual(calls[0].args, ['api', '--hostname', 'github.acme.com', '--method', 'POST', REST_PATH, '--include', '--input', '-'])
  assert.deepEqual(JSON.parse(calls[0].input), { title: 'v1' })
})

test('rest sends no --input when there is no body', async () => {
  const { client, calls } = setup([restAnswer(200, { ok: true })])
  await client.rest('GET', 'repos/acme/widgets')
  assert.deepEqual(calls[0].args, ['api', '--method', 'GET', 'repos/acme/widgets', '--include'])
  assert.equal(calls[0].input, undefined)
})

test('rest maps 401 to AUTH', async () => {
  const { client } = setup([restAnswer(401, { message: 'Bad credentials' })])
  const error = await failure(client.rest('POST', REST_PATH, { title: 'v1' }))
  assert.equal(error.code, 'AUTH')
})

test('rest maps a taken milestone title to CONFLICT', async () => {
  const body = { message: 'Validation Failed', errors: [{ resource: 'Milestone', code: 'already_exists', field: 'title' }] }
  const { client } = setup([restAnswer(422, body)])
  const error = await failure(client.rest('POST', REST_PATH, { title: 'v1' }))
  assert.equal(error.code, 'CONFLICT')
  assert.equal(error.message, 'GitHub already has a milestone titled v1')
})

test('rest maps other 4xx answers to UPSTREAM with the message of GitHub', async () => {
  const { client } = setup([restAnswer(422, { message: 'Validation Failed', errors: [{ code: 'invalid', field: 'due_on' }] })])
  const error = await failure(client.rest('POST', REST_PATH, { title: 'v1', due_on: 'x' }))
  assert.equal(error.code, 'UPSTREAM')
  assert.match(error.message, /Validation Failed/)
})

test('rest write is never retried: a timeout or 5xx is the unconfirmed-mutation error', async () => {
  const timeout = setup([spawnError('ETIMEDOUT')])
  const first = await failure(timeout.client.rest('POST', REST_PATH, { title: 'v1' }))
  assert.equal(first.code, 'UPSTREAM')
  assert.match(first.message, /did not confirm the change/)
  assert.equal(timeout.calls.length, 1)
  const server = setup([restAnswer(502, { message: 'Bad Gateway' })])
  const second = await failure(server.client.rest('POST', REST_PATH, { title: 'v1' }))
  assert.match(second.message, /did not confirm the change/)
  assert.equal(server.calls.length, 1)
})

test('rest write with an unreadable answer is unconfirmed', async () => {
  const { client } = setup([restAnswer(200, 'not json', 0)])
  const error = await failure(client.rest('POST', REST_PATH, { title: 'v1' }))
  assert.match(error.message, /did not confirm the change/)
})

test('rest GET is retried like a query', async () => {
  const { client, calls } = setup([spawnError('ETIMEDOUT'), restAnswer(200, { ok: 1 })])
  assert.deepEqual(await client.rest('GET', 'repos/acme/widgets'), { ok: 1 })
  assert.equal(calls.length, 2)
})

// Rate limits are kept per resource

const limited = (resource) => ({ 'x-ratelimit-limit': 5000, 'x-ratelimit-remaining': 0, 'x-ratelimit-reset': Math.floor(Date.now() / 1000) + 3600, 'x-ratelimit-resource': resource })

test('a REST answer at remaining 0 does not stop the next GraphQL call', async () => {
  const rest = answer({ status: 200, body: { ok: 1 }, headers: limited('core') })
  const { client, calls } = setup([rest, answer()])
  await client.rest('GET', 'repos/acme/widgets')
  assert.deepEqual(await client.request(QUERY), { ok: true })
  assert.equal(calls.length, 2)
  assert.equal(client.rateLimit(), null)
})

test('a REST answer at remaining 0 blocks the next REST call with no request', async () => {
  const { client, calls } = setup([answer({ status: 200, body: { ok: 1 }, headers: limited('core') })])
  await client.rest('GET', 'repos/acme/widgets')
  const error = await failure(client.rest('GET', 'repos/acme/widgets'))
  assert.equal(error.code, 'RATE_LIMITED')
  assert.equal(calls.length, 1)
})

test('a GraphQL answer at remaining 0 does not stop a REST call, and rateLimit reports the GraphQL bucket', async () => {
  const { client, calls } = setup([answer({ headers: limited('graphql') }), restAnswer(200, { ok: 1 })])
  await client.request(QUERY)
  assert.deepEqual(await client.rest('GET', 'repos/acme/widgets'), { ok: 1 })
  assert.equal(calls.length, 2)
  assert.equal(client.rateLimit().resource, 'graphql')
})

test('rest names a too-large answer by its own command', async () => {
  const { client } = setup([spawnError('ENOBUFS')])
  const error = await failure(client.rest('GET', 'repos/acme/widgets'))
  assert.match(error.message, /^gh api output is too large/)
  assert.doesNotMatch(error.nextStep, /nodes per page/)
})
