import assert from 'node:assert/strict'
import test from 'node:test'
import { BB, FAKE_BB_ENV, fakeBitbucketFetch } from '../../fake-bitbucket-api.mjs'
import { PmkitError } from '../errors.mjs'
import { createBitbucketHost } from './host.mjs'

// A host created without a fake fetch fails loudly instead of reaching the network.
globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

const API = 'https://api.bitbucket.org'
const PRS = `GET ${BB}/pullrequests`

function setup(routes = {}, { env = FAKE_BB_ENV, exec } = {}) {
  const fetch = fakeBitbucketFetch(routes)
  const host = createBitbucketHost({ root: '/repo', env, repo: 'acme/widgets', fetch, exec })
  return { fetch, host }
}

/** A Bitbucket pull request as the API returns it, with overrides. */
function raw(overrides = {}) {
  return {
    type: 'pullrequest',
    id: 7,
    title: 'Retry the sync',
    state: 'OPEN',
    draft: false,
    links: { html: { href: 'https://bitbucket.org/acme/widgets/pull-requests/7' } },
    source: { branch: { name: 'iss-7k3q-retry' }, commit: { hash: 'abc123def456' } },
    destination: { branch: { name: 'main' }, commit: { hash: '000111222333' } },
    author: { type: 'user', nickname: 'fred', display_name: 'Fred' },
    created_on: '2026-11-20T10:00:00.000000+00:00',
    updated_on: '2026-11-21T12:00:00.000000+00:00',
    participants: [],
    ...overrides,
  }
}

const view = (overrides = {}) => ({
  number: 7,
  url: 'https://bitbucket.org/acme/widgets/pull-requests/7',
  title: 'Retry the sync',
  state: 'OPEN',
  isDraft: false,
  headRefName: 'iss-7k3q-retry',
  author: { login: 'fred', is_bot: false },
  mergedAt: null,
  ...overrides,
})

const query = (call) => new URL(call.url).searchParams

test('the host says it is bitbucket and creating it sends nothing', () => {
  const { host, fetch } = setup()
  assert.equal(host.system, 'bitbucket')
  assert.equal(fetch.calls.length, 0)
})

test('without BITBUCKET_TOKEN the git-only methods still work and a Bitbucket method is AUTH', async () => {
  const calls = []
  const exec = (cmd, args) => {
    calls.push([cmd, ...args])
    return { status: 0, stdout: '', stderr: '' }
  }
  const { host, fetch } = setup({}, { env: {}, exec })
  host.createBranch('iss-1', { from: 'origin/main' })
  host.push('iss-1')
  assert.deepEqual(calls[0], ['git', 'switch', '--no-track', '-c', 'iss-1', 'origin/main'])
  assert.equal(calls[1][0], 'git')
  await assert.rejects(host.getPullRequest({ number: 7 }), (error) => error instanceof PmkitError && error.code === 'AUTH')
  assert.equal(fetch.calls.length, 0)
})

test('getPullRequest by head asks for every state, newest first, with the branch in a q filter', async () => {
  const { host, fetch } = setup({ [PRS]: { json: { values: [raw()] } } })
  assert.deepEqual(await host.getPullRequest({ head: 'iss-7k3q-retry' }), view())
  const params = query(fetch.calls[0])
  assert.equal(params.get('q'), 'source.branch.name="iss-7k3q-retry"')
  assert.deepEqual(params.getAll('state'), ['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED'])
  assert.equal(params.get('sort'), '-created_on')
  assert.equal(params.get('pagelen'), '50')
})

test('getPullRequest escapes a quote and a backslash in the head', async () => {
  const { host, fetch } = setup({ [PRS]: { json: { values: [] } } })
  assert.equal(await host.getPullRequest({ head: 'a"b\\c' }), null)
  assert.equal(query(fetch.calls[0]).get('q'), 'source.branch.name="a\\"b\\\\c"')
})

test('getPullRequest picks the open pull request of a head over a newer merged one', async () => {
  const merged = raw({ id: 9, state: 'MERGED' })
  const open = raw({ id: 7 })
  const { host } = setup({ [PRS]: { json: { values: [merged, open] } } })
  assert.equal((await host.getPullRequest({ head: 'iss-7k3q-retry' })).number, 7)
})

test('getPullRequest takes the newest when none is open', async () => {
  const { host } = setup({ [PRS]: { json: { values: [raw({ id: 9, state: 'DECLINED' }), raw({ id: 7, state: 'MERGED' })] } } })
  assert.equal((await host.getPullRequest({ head: 'iss-7k3q-retry' })).number, 9)
})

test('getPullRequest maps every state, with mergedAt only for MERGED', async () => {
  const cases = [
    ['OPEN', 'OPEN', null],
    ['MERGED', 'MERGED', '2026-11-21T12:00:00.000000+00:00'],
    ['DECLINED', 'CLOSED', null],
    ['SUPERSEDED', 'CLOSED', null],
  ]
  for (const [state, expected, mergedAt] of cases) {
    const { host } = setup({ [`GET ${BB}/pullrequests/7`]: { json: raw({ state }) } })
    const pr = await host.getPullRequest({ number: 7 })
    assert.equal(pr.state, expected, state)
    assert.equal(pr.mergedAt, mergedAt, state)
  }
})

test('getPullRequest by number that does not exist is null', async () => {
  const { host } = setup({ [`GET ${BB}/pullrequests/7`]: { status: 404, json: { type: 'error', error: { message: 'not found' } } } })
  assert.equal(await host.getPullRequest({ number: 7 }), null)
})

test('getPullRequest refuses a missing selector and a head that reads as an option', async () => {
  const { host, fetch } = setup()
  for (const selector of [{}, { head: '' }, { head: '-x' }, { number: 0 }]) {
    await assert.rejects(host.getPullRequest(selector), (error) => error.code === 'INVALID_INPUT')
  }
  assert.equal(fetch.calls.length, 0)
})

test('an app user is a bot author', async () => {
  const { host } = setup({ [`GET ${BB}/pullrequests/7`]: { json: raw({ author: { type: 'app_user', nickname: 'renovate' } }) } })
  assert.deepEqual((await host.getPullRequest({ number: 7 })).author, { login: 'renovate', is_bot: true })
})

test('getPullRequest with detail carries the base and the reviews from the participants', async () => {
  const participants = [
    { user: { nickname: 'ana' }, role: 'REVIEWER', approved: true, state: 'approved', participated_on: '2026-11-21T09:00:00+00:00' },
    { user: { nickname: 'bo' }, role: 'REVIEWER', approved: false, state: 'changes_requested', participated_on: '2026-11-21T10:00:00+00:00' },
    { user: { nickname: 'cy' }, role: 'PARTICIPANT', approved: false, state: null, participated_on: null },
  ]
  const { host } = setup({ [`GET ${BB}/pullrequests/7`]: { json: raw({ participants }) } })
  const pr = await host.getPullRequest({ number: 7 }, { detail: true })
  assert.deepEqual(pr, {
    ...view(),
    detail: {
      baseRefName: 'main',
      reviews: [
        { author: { login: 'ana' }, state: 'APPROVED', submittedAt: '2026-11-21T09:00:00+00:00' },
        { author: { login: 'bo' }, state: 'CHANGES_REQUESTED', submittedAt: '2026-11-21T10:00:00+00:00' },
      ],
    },
  })
})

test('openPullRequest posts the pull request and returns it mapped, as a draft', async () => {
  const { host, fetch } = setup({ [`POST ${BB}/pullrequests`]: { status: 201, json: raw({ draft: true }) } })
  const pr = await host.openPullRequest({ title: 'Retry the sync', body: 'Closes ISS-1', head: 'iss-7k3q-retry', base: 'main', draft: true })
  assert.deepEqual(pr, view({ isDraft: true }))
  assert.equal(fetch.calls.length, 1)
  assert.deepEqual(JSON.parse(fetch.calls[0].body), {
    title: 'Retry the sync',
    description: 'Closes ISS-1',
    source: { branch: { name: 'iss-7k3q-retry' } },
    destination: { branch: { name: 'main' } },
    draft: true,
  })
})

test('openPullRequest sends draft false unless draft is true, and refuses a ref that reads as an option', async () => {
  const { host, fetch } = setup({ [`POST ${BB}/pullrequests`]: { status: 201, json: raw() } })
  await host.openPullRequest({ title: 't', body: '', head: 'a', base: 'main' })
  assert.equal(JSON.parse(fetch.calls[0].body).draft, false)
  await assert.rejects(host.openPullRequest({ title: 't', body: '', head: '-a', base: 'main' }), (error) => error.code === 'INVALID_INPUT')
  await assert.rejects(host.openPullRequest({ title: 't', body: '', head: 'a', base: '' }), (error) => error.code === 'INVALID_INPUT')
  assert.equal(fetch.calls.length, 1)
})

test('markReady sends PUT with draft false and returns the pull request', async () => {
  const { host, fetch } = setup({ [`PUT ${BB}/pullrequests/7`]: { json: raw() } })
  assert.deepEqual(await host.markReady(7), view())
  assert.equal(fetch.calls[0].method, 'PUT')
  assert.deepEqual(JSON.parse(fetch.calls[0].body), { draft: false })
  await assert.rejects(host.markReady(0), (error) => error.code === 'INVALID_INPUT')
})

test('prChecks maps the build statuses to buckets and reads the pipeline run from the link', async () => {
  const statuses = [
    { key: 'build', name: 'Pipeline #42 for main', state: 'FAILED', url: 'https://bitbucket.org/acme/widgets/pipelines/results/42/steps/{x}' },
    { key: 'lint', name: 'Lint', state: 'SUCCESSFUL', url: 'https://ci.example/runs/9' },
    { key: 'e2e', state: 'STOPPED', url: 'https://bitbucket.org/acme/widgets/addon/pipelines/home#!/results/7' },
    { key: 'deploy', name: 'Deploy', state: 'INPROGRESS', url: null },
  ]
  const { host, fetch } = setup({ [`GET ${BB}/pullrequests/7/statuses`]: { json: { values: statuses } } })
  assert.deepEqual(await host.prChecks(7), [
    { name: 'Pipeline #42 for main', state: 'FAILED', bucket: 'fail', link: 'https://bitbucket.org/acme/widgets/pipelines/results/42/steps/{x}', runId: 42 },
    { name: 'Lint', state: 'SUCCESSFUL', bucket: 'pass', link: 'https://ci.example/runs/9', runId: null },
    { name: 'e2e', state: 'STOPPED', bucket: 'cancel', link: 'https://bitbucket.org/acme/widgets/addon/pipelines/home#!/results/7', runId: null },
    { name: 'Deploy', state: 'INPROGRESS', bucket: 'pending', link: null, runId: null },
  ])
  assert.equal(fetch.calls[0].url.startsWith(`${API}${BB}/pullrequests/7/statuses`), true)
})

test('prChecks follows every page', async () => {
  const { host } = setup({
    [`GET ${BB}/pullrequests/7/statuses`]: [
      { json: { values: [{ key: 'a', state: 'SUCCESSFUL' }], next: `${API}${BB}/pullrequests/7/statuses?page=2` } },
      { json: { values: [{ key: 'b', state: 'FAILED' }] } },
    ],
  })
  assert.deepEqual((await host.prChecks(7)).map((c) => c.name), ['a', 'b'])
})

test('prRefs returns the base branch and the head commit', async () => {
  const { host } = setup({ [`GET ${BB}/pullrequests/7`]: { json: raw() } })
  assert.deepEqual(await host.prRefs(7), { baseRefName: 'main', headRefOid: 'abc123def456' })
})

test('prDiff returns the diff text', async () => {
  const { host } = setup({ [`GET ${BB}/pullrequests/7/diff`]: { text: 'diff --git a/x b/x\n' } })
  assert.equal(await host.prDiff(7), 'diff --git a/x b/x\n')
})

test('prDiff is null when Bitbucket refuses the size (413, 406)', async () => {
  for (const status of [413, 406]) {
    const { host } = setup({ [`GET ${BB}/pullrequests/7/diff`]: { status, text: '' } })
    assert.equal(await host.prDiff(7), null, String(status))
  }
})

test('prDiff rethrows any other error', async () => {
  const { host } = setup({ [`GET ${BB}/pullrequests/7/diff`]: { status: 403, text: '' } })
  await assert.rejects(host.prDiff(7), (error) => error.code === 'UPSTREAM' && error.httpStatus === 403)
})

test('listPullRequests reads the open pull requests with their statuses as status contexts', async () => {
  const { host, fetch } = setup({
    [PRS]: { json: { values: [raw(), raw({ id: 8, draft: true, source: { branch: { name: 'iss-2' }, commit: { hash: 'f' } } })] } },
    [`GET ${BB}/pullrequests/7/statuses`]: { json: { values: [{ key: 'build', state: 'FAILED' }, { key: 'lint', state: 'SUCCESSFUL' }, { key: 'e2e', state: 'STOPPED' }, { key: 'up', state: 'INPROGRESS' }] } },
    [`GET ${BB}/pullrequests/8/statuses`]: { json: { values: [] } },
  })
  const prs = await host.listPullRequests()
  assert.deepEqual(prs, [
    {
      number: 7,
      url: 'https://bitbucket.org/acme/widgets/pull-requests/7',
      title: 'Retry the sync',
      headRefName: 'iss-7k3q-retry',
      isDraft: false,
      updatedAt: '2026-11-21T12:00:00.000000+00:00',
      author: { login: 'fred', is_bot: false },
      statusCheckRollup: [
        { context: 'build', state: 'FAILURE' },
        { context: 'lint', state: 'SUCCESS' },
        { context: 'e2e', state: 'ERROR' },
        { context: 'up', state: 'PENDING' },
      ],
    },
    { number: 8, url: 'https://bitbucket.org/acme/widgets/pull-requests/7', title: 'Retry the sync', headRefName: 'iss-2', isDraft: true, updatedAt: '2026-11-21T12:00:00.000000+00:00', author: { login: 'fred', is_bot: false }, statusCheckRollup: [] },
  ])
  const params = query(fetch.calls[0])
  assert.deepEqual(params.getAll('state'), ['OPEN'])
  assert.equal(params.get('sort'), '-created_on')
})

test('listPullRequests stops at 200 pull requests', async () => {
  const page = (from) => Array.from({ length: 50 }, (_, i) => raw({ id: from + i }))
  const routes = {
    [PRS]: [0, 1, 2, 3, 4].map((n) => ({ json: { values: page(n * 50 + 1), next: `${API}${BB}/pullrequests?page=${n + 2}` } })),
    [`GET ${BB}/pullrequests/{id}/statuses`]: { json: { values: [] } },
  }
  const { host, fetch } = setup(routes)
  assert.equal((await host.listPullRequests()).length, 200)
  assert.equal(fetch.calls.filter((c) => new URL(c.url).pathname === `${BB}/pullrequests`).length, 4)
})

test('listPullRequests leaves statusCheckRollup null on a pull request whose statuses are refused (403)', async () => {
  const { host } = setup({
    [PRS]: { json: { values: [raw(), raw({ id: 8 })] } },
    [`GET ${BB}/pullrequests/7/statuses`]: { status: 403, json: { type: 'error', error: { message: 'no' } } },
    [`GET ${BB}/pullrequests/8/statuses`]: { json: { values: [{ key: 'build', state: 'FAILED' }] } },
  })
  const prs = await host.listPullRequests()
  assert.equal(prs[0].statusCheckRollup, null)
  assert.deepEqual(prs[1].statusCheckRollup, [{ context: 'build', state: 'FAILURE' }])
})

test('listPullRequests rethrows a statuses error that is not a refusal', async () => {
  const { host } = setup({
    [PRS]: { json: { values: [raw()] } },
    [`GET ${BB}/pullrequests/7/statuses`]: { status: 429, text: '' },
  })
  await assert.rejects(host.listPullRequests(), (error) => error.code === 'RATE_LIMITED')
})
