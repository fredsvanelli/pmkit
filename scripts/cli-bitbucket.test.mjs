// PMK-81: the CLI on git_host.system bitbucket, over the fake Bitbucket fetch. No test opens a socket.
// See docs/superpowers/specs/2026-11-23-pmk-81-bitbucket-cloud-git-host-design.md, "The host".
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { BB, FAKE_BB_ENV, FAKE_BB_TOKEN, fakeBitbucketFetch } from './fake-bitbucket-api.mjs'
import { makeRepo, tempDir, userStoreEnv } from './test-helpers.mjs'
import { run } from './pmkit.mjs'

// A command that reaches the network without the fake fails loudly.
globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

const PRS = `GET ${BB}/pullrequests`
const STATUSES = `GET ${BB}/pullrequests/{id}/statuses`
const PIPELINES = `GET ${BB}/pipelines`
const STEPS = `GET ${BB}/pipelines/{uuid}/steps`
const LOG = `GET ${BB}/pipelines/{uuid}/steps/{step}/log`
const ENVIRONMENTS = `GET ${BB}/environments`
const DEPLOYMENTS = `GET ${BB}/deployments`

/** A Bitbucket pull request as the API returns it. */
const rawPr = (overrides = {}) => ({
  type: 'pullrequest', id: 7, title: 'Retry the sync', state: 'OPEN', draft: false,
  links: { html: { href: 'https://bitbucket.org/acme/widgets/pull-requests/7' } },
  source: { branch: { name: 'b' }, commit: { hash: 'abc123def456' } },
  destination: { branch: { name: 'main' }, commit: { hash: '000111222333' } },
  author: { type: 'user', nickname: 'fred', display_name: 'Fred' },
  created_on: '2026-11-20T10:00:00.000000+00:00', updated_on: '2026-11-21T12:00:00.000000+00:00', participants: [],
  ...overrides,
})

const pipeline = (n, result = 'FAILED') => ({
  type: 'pipeline', uuid: `{pipe-${n}}`, build_number: n, created_on: `2026-11-2${n % 10}T10:00:00.000Z`,
  state: { name: 'COMPLETED', result: { name: result } },
  target: { type: 'pipeline_ref_target', ref_name: 'b', selector: { type: 'branches', pattern: 'b' }, commit: { hash: `sha${n}abcdef` } },
})

const deployment = (n, env, status, { sha = `sha${n}abcdef` } = {}) => ({
  type: 'deployment', uuid: `{dep-${n}}`, environment: { uuid: env }, state: { name: 'COMPLETED', status: { name: status } },
  release: { name: `#${n}`, url: `https://bitbucket.org/acme/widgets/pipelines/results/${n}`, created_on: `2026-11-${10 + n}T10:00:00.000Z`, commit: sha === null ? undefined : { hash: sha } },
})

const deployRoutes = () => ({
  [ENVIRONMENTS]: { json: { values: [{ uuid: '{env-p}', name: 'Production' }] } },
  [DEPLOYMENTS]: { json: { values: [deployment(2, '{env-p}', 'SUCCESSFUL'), deployment(1, '{env-p}', 'FAILED', { sha: null })] } },
})

/** The team fixture on git_host bitbucket, and a cli over a fake Bitbucket whose output never holds the token. */
function setup(routes = {}, { env = { ...FAKE_BB_ENV } } = {}) {
  const root = makeRepo('team')
  spawnSync('git', ['init', '-q'], { cwd: root })
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('git_host:\n  system: none', 'git_host:\n  system: bitbucket\n  repo: acme/widgets\n  default_branch: main'))
  const fetch = fakeBitbucketFetch(routes)
  const fullEnv = { ...env, ...userStoreEnv().env, PATH: process.env.PATH, PMKIT_USER: 'fred', PMKIT_NOW: '2026-11-23T12:00:00Z', PMKIT_SEED: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }
  const cli = async (...args) => {
    const result = await run(args, { cwd: root, env: fullEnv, fetch })
    assert.ok(!(result.stdout + result.stderr).includes(FAKE_BB_TOKEN), 'the output holds the token')
    return result
  }
  const ok = async (...args) => {
    const result = await cli(...args)
    assert.equal(result.code, 0, result.stdout + result.stderr)
    return result
  }
  return { root, fetch, cli, ok }
}

const NOT_VERIFIED = { area: 'blockers', code: 'NOT_SUPPORTED', message: 'blockers are not verified on Bitbucket' }

test('pr status returns the pull request and its checks, with the blockers not verified on Bitbucket', async () => {
  const { ok } = setup({
    [PRS]: { json: { values: [rawPr()] } },
    [STATUSES]: { json: { values: [{ key: 'build', name: 'Build', state: 'FAILED', url: 'https://bitbucket.org/acme/widgets/pipelines/results/42/steps/{x}' }] } },
  })
  const data = JSON.parse((await ok('pr', 'status', '--branch', 'b', '--json')).stdout)
  assert.equal(data.pr.number, 7)
  assert.equal(data.pr.url, 'https://bitbucket.org/acme/widgets/pull-requests/7')
  assert.deepEqual(data.checks.map((c) => [c.name, c.bucket, c.runId]), [['Build', 'fail', 42]])
  assert.deepEqual(data.blockers, { blocked: null, blocking: [], pending: [], unknown: [], unchecked: [NOT_VERIFIED] })
  const text = (await ok('pr', 'status', '--branch', 'b')).stdout
  assert.match(text, /Build fail \(ci logs --run 42\)/)
  assert.match(text, /^blockers: not verified on Bitbucket$/m)
  assert.doesNotMatch(text, /blockers not verified/)
})

test('pr status without BITBUCKET_TOKEN is AUTH', async () => {
  const { cli, fetch } = setup({}, { env: {} })
  const result = await cli('pr', 'status', '--branch', 'b', '--json')
  assert.equal(result.code, 2)
  assert.equal(JSON.parse(result.stdout).error.code, 'AUTH')
  assert.equal(fetch.calls.length, 0)
})

test('pr blockers and pr review answer NOT_SUPPORTED on Bitbucket, before any read', async () => {
  const { cli, fetch, root } = setup()
  const blockers = await cli('pr', 'blockers', '--branch', 'b', '--json')
  assert.equal(blockers.code, 2)
  assert.deepEqual(JSON.parse(blockers.stdout).error, { code: 'NOT_SUPPORTED', message: 'pr blockers is not supported on Bitbucket yet', nextStep: 'Read the merge checks on the pull request page' })
  const body = path.join(tempDir('pmkit-bb-'), 'review.md')
  fs.writeFileSync(body, 'Looks good.\n')
  const review = await cli('pr', 'review', '--issue', 'ISS-8C4W', '--body-file', body, '--json')
  assert.equal(review.code, 2)
  assert.deepEqual(JSON.parse(review.stdout).error, { code: 'NOT_SUPPORTED', message: 'pr review is not supported on Bitbucket yet', nextStep: 'Post the review on the pull request page, or post it on the issue with pmkit issues comment' })
  assert.equal(fetch.calls.length, 0)
  assert.ok(fs.existsSync(root))
})

test('inbox list --reviews lists the issues and says review requests are not read on Bitbucket', async () => {
  const { ok, fetch } = setup()
  const data = JSON.parse((await ok('inbox', 'list', '--reviews', '--json')).stdout)
  assert.deepEqual(data.reviews, { verified: false, requested: null, teamRequests: null, complete: false, reason: 'review requests are not read on Bitbucket yet', code: 'NOT_SUPPORTED' })
  assert.ok(Array.isArray(data.items))
  assert.equal(data.counts.reviewRequests, null)
  const text = (await ok('inbox', 'list', '--reviews')).stdout
  assert.match(text, /review requests not verified: review requests are not read on Bitbucket yet/)
  assert.equal(fetch.calls.length, 0)
})

test('deploys list maps the Bitbucket deployments and its text never prints a null ref or sha', async () => {
  const { ok } = setup(deployRoutes())
  const data = JSON.parse((await ok('deploys', 'list', '--json')).stdout)
  assert.deepEqual(data.deploys, [
    { id: '{dep-2}', environment: 'Production', ref: null, sha: 'sha2abcdef', createdAt: '2026-11-12T10:00:00.000Z', state: 'success', url: 'https://bitbucket.org/acme/widgets/pipelines/results/2' },
    { id: '{dep-1}', environment: 'Production', ref: null, sha: null, createdAt: '2026-11-11T10:00:00.000Z', state: 'failure', url: 'https://bitbucket.org/acme/widgets/pipelines/results/1' },
  ])
  const text = (await ok('deploys', 'list')).stdout
  assert.doesNotMatch(text, /null/)
  assert.equal(text, 'Production success sha2abc 2026-11-12T10:00:00.000Z https://bitbucket.org/acme/widgets/pipelines/results/2\nProduction failure 2026-11-11T10:00:00.000Z https://bitbucket.org/acme/widgets/pipelines/results/1\n')
})

test('ci logs reads the failed steps of the newest failed pipeline of a branch', async () => {
  const { ok } = setup({
    [PIPELINES]: { json: { values: [pipeline(7)] } },
    [STEPS]: { json: { values: [{ uuid: '{step-1}', name: 'Test', state: { name: 'COMPLETED', result: { name: 'FAILED' } } }] } },
    [LOG]: { text: 'boom\n' },
  })
  const data = JSON.parse((await ok('ci', 'logs', '--branch', 'b', '--json')).stdout)
  assert.equal(data.run.runId, 7)
  assert.equal(data.run.failed, true)
  assert.equal(data.run.log, '== Test ==\nboom\n')
})

test('ci logs names Bitbucket when a failed pipeline has no log', async () => {
  const { ok } = setup({ [PIPELINES]: { json: { values: [pipeline(7)] } }, [STEPS]: { json: { values: [] } } })
  const text = (await ok('ci', 'logs', '--branch', 'b')).stdout
  assert.match(text, /run 7 b failed \(failure\) but Bitbucket returned no log for it/)
})

test('risks warns that pull requests were not checked when Bitbucket refuses them, and exits 0', async () => {
  const { ok } = setup({
    [PRS]: { status: 403, json: { type: 'error', error: { message: 'Forbidden' } } },
    [PIPELINES]: { json: { values: [] } },
  })
  const result = await ok('risks', '--json')
  assert.match(result.stderr, /warning: pull requests not checked/)
})

test('release-readiness on Bitbucket reads the deploys once and leaves the tag match not verified', async () => {
  const { ok, fetch } = setup({ [PRS]: { json: { values: [] } }, ...deployRoutes() })
  await ok('release', 'create', '1.0', '--tag', 'v1.0')
  await ok('issues', 'update', 'ISS-8C4W', '--release', '1.0')
  const data = JSON.parse((await ok('release-readiness', '--json')).stdout)
  assert.deepEqual(data.deploys.map((d) => d.matchesRelease), [null, null])
  assert.equal(fetch.calls.filter((c) => new URL(c.url).pathname === `${BB}/deployments`).length, 1)
  const text = (await ok('release-readiness')).stdout
  assert.match(text, /not verified on Bitbucket/)
})

test('issues track-agents reads the pull request and leaves its blockers not verified on Bitbucket', async () => {
  const { ok, root } = setup({ [PRS]: { json: { values: [rawPr()] } } })
  const members = path.join(root, '.issues', 'config.yaml')
  fs.writeFileSync(members, fs.readFileSync(members, 'utf8').replace(/^members:\n/m, 'members:\n  agent:claude: { name: Claude, availability: 1 }\n'))
  await ok('issues', 'assign', 'ISS-5N1R', 'agent:claude')
  const issue = path.join(root, '.issues', 'issues', 'ISS-5N1R', 'issue.md')
  fs.writeFileSync(issue, fs.readFileSync(issue, 'utf8').replace(/^status: .*$/m, (line) => `${line}\nbranch: b`))
  const data = JSON.parse((await ok('issues', 'track-agents', '--json')).stdout)
  const row = data.issues.find((i) => i.id === 'ISS-5N1R')
  assert.deepEqual([row.pr.state, row.pr.number, row.pr.blocked, row.pr.unchecked], ['open', 7, null, ['blockers']])
  assert.ok(data.warnings.some((w) => w.includes('blockers are not verified on Bitbucket')), data.warnings.join('\n'))
})

test('capabilities names Bitbucket and the commands it does not support', async () => {
  const { ok } = setup()
  const data = JSON.parse((await ok('capabilities', '--json')).stdout)
  const linked = data.capabilities.find((entry) => entry.id === 'linked_code')
  assert.deepEqual(linked.detail, { source: 'git', host: 'bitbucket', unsupported: ['pr review', 'pr blockers'], degraded: ['inbox review requests'] })
})

test('risks names the pull requests whose checks Bitbucket refused, and exits 0', async () => {
  const { ok } = setup({
    [PRS]: { json: { values: [rawPr(), rawPr({ id: 8, source: { branch: { name: 'c' } } })] } },
    [`GET ${BB}/pullrequests/7/statuses`]: { status: 403, json: { type: 'error', error: { message: 'Forbidden' } } },
    [`GET ${BB}/pullrequests/8/statuses`]: { json: { values: [] } },
    [PIPELINES]: { json: { values: [] } },
  })
  const result = await ok('risks', '--json')
  assert.match(result.stderr, /warning: checks of #7 not read/)
  assert.doesNotMatch(result.stderr, /#8 not read/)
})

test('release-readiness shows the checks of a pull request whose statuses Bitbucket refused as not read', async () => {
  const { ok, root } = setup({
    [PRS]: { json: { values: [rawPr()] } },
    [STATUSES]: { status: 403, json: { type: 'error', error: { message: 'Forbidden' } } },
    ...deployRoutes(),
  })
  const issue = path.join(root, '.issues', 'issues', 'ISS-8C4W', 'issue.md')
  fs.writeFileSync(issue, fs.readFileSync(issue, 'utf8').replace(/^status: .*$/m, (line) => `${line}\nbranch: b`))
  await ok('release', 'create', '1.0', '--tag', 'v1.0')
  await ok('issues', 'update', 'ISS-8C4W', '--release', '1.0')
  const result = await ok('release-readiness', '--json')
  assert.equal(JSON.parse(result.stdout).pullRequests[0].checks, null)
  assert.match(result.stderr, /warning: checks of #7 not read/)
  assert.match((await ok('release-readiness')).stdout, /checks not read/)
})

test('deploys list warns that older deployments of an environment may be missing when the read was cut', async () => {
  const many = Array.from({ length: 100 }, (_, i) => deployment(i + 1, '{env-s}', 'SUCCESSFUL'))
  const { ok } = setup({
    [ENVIRONMENTS]: { json: { values: [{ uuid: '{env-p}', name: 'Production' }, { uuid: '{env-s}', name: 'Staging' }] } },
    [DEPLOYMENTS]: [1, 2, 3, 4, 5].map((n) => ({ json: { values: many, next: `https://api.bitbucket.org${BB}/deployments?page=${n + 1}` } })),
  })
  const result = await ok('deploys', 'list', '--environment', 'Production')
  assert.equal(result.stdout, 'no deployments\n')
  assert.match(result.stderr, /warning: only the 500 newest deployments were read, so older deployments of Production may be missing/)
  const staging = await ok('deploys', 'list', '--environment', 'Staging', '--limit', '5')
  assert.doesNotMatch(staging.stderr, /500 newest/)
})
