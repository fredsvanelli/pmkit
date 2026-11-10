// issues bulk over the Linear adapter with the fake API: the same flow, and the changes Linear does not write.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { linearDescriptor } from './lib/linear/adapter.mjs'
import { useLinear } from './fake-hosted.mjs'
import { FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeLinearProjects, fakeWorkspace } from './fake-linear-api.mjs'
import { childEnv } from './golden-helpers.mjs'
import { makeRepo, userStoreEnv } from './test-helpers.mjs'

process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir())

function setup() {
  const root = useLinear(makeRepo('basic'))
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('    workspace: acme', '    workspace: acme\n    team: ACME'))
  return { root, env: { ...childEnv(), ...userStoreEnv().env, LINEAR_API_KEY: FAKE_KEY } }
}

function withIssues(titles) {
  const fake = fakeLinearIssues()
  for (const title of titles) fake.seed({ title })
  return { fake, fetch: fakeLinearFetch({ ...fakeWorkspace(), ...fake.routes }) }
}

async function bulk(context, fetch, args) {
  const result = await run(['issues', 'bulk', ...args, '--json'], { cwd: context.root, env: context.env, adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch }) } })
  return { code: result.code, body: JSON.parse(result.stdout) }
}

test('assign previews every issue, then writes them with the digest', async () => {
  const { fake, fetch } = withIssues(['One', 'Two'])
  const context = setup()
  const dry = await bulk(context, fetch, ['assign', 'me', '--category', 'backlog', '--dry-run'])
  assert.equal(dry.code, 0, JSON.stringify(dry.body))
  assert.deepEqual(dry.body.items.map((item) => [item.id, item.state]), [['ACME-1', 'change'], ['ACME-2', 'change']])
  assert.deepEqual(fake.mutations, [])
  const real = await bulk(context, fetch, ['assign', 'me', '--category', 'backlog', '--expect', dry.body.digest])
  assert.equal(real.code, 0, JSON.stringify(real.body))
  assert.deepEqual(real.body.applied, ['ACME-1', 'ACME-2'])
  assert.deepEqual(fake.mutations, ['PmkitIssueUpdate', 'PmkitIssueUpdate'])
})

test('a set Linear cut at 1000 issues is refused, never written from', async () => {
  const { fake, fetch } = withIssues([])
  for (let index = 0; index < 1001; index += 1) fake.seed({ title: `Issue ${index}` })
  const result = await bulk(setup(), fetch, ['assign', 'me', '--category', 'backlog', '--dry-run'])
  assert.equal(result.code, 2)
  assert.equal(result.body.error.code, 'INVALID_INPUT')
  assert.match(result.body.error.message, /more matching issues/)
  assert.deepEqual(fake.mutations, [])
})

test('an epic as the parent is written on Linear, as issues parent does', async () => {
  const issues = fakeLinearIssues()
  const projects = fakeLinearProjects({ issues })
  projects.seed({ id: '00000000-0000-4000-8000-0000000000a1', name: 'Launch', teamIds: ['team-acme'], startDate: '2026-11-01' })
  issues.seed({ title: 'Loose' })
  const fetch = fakeLinearFetch({ ...fakeWorkspace(), ...issues.routes, ...projects.routes })
  const context = setup()
  const dry = await bulk(context, fetch, ['parent', 'P-ACM-1', '--category', 'backlog', '--dry-run'])
  assert.equal(dry.code, 0, JSON.stringify(dry.body))
  assert.deepEqual(dry.body.items.map((item) => item.state), ['change'])
  const real = await bulk(context, fetch, ['parent', 'P-ACM-1', '--category', 'backlog', '--expect', dry.body.digest])
  assert.equal(real.code, 0, JSON.stringify(real.body))
  assert.deepEqual(real.body.applied, ['ACME-1'])
})

test('an agent as the assignee is one INVALID_INPUT on Linear', async () => {
  const { fake, fetch } = withIssues(['One', 'Two'])
  const result = await bulk(setup(), fetch, ['assign', 'agent:claude', '--category', 'backlog', '--dry-run'])
  assert.equal(result.code, 2)
  assert.equal(result.body.error.code, 'INVALID_INPUT')
  assert.deepEqual(fake.mutations, [])
})

const PROJECT_ID = '00000000-0000-4000-8000-0000000000a1'
const OTHER_ID = '00000000-0000-4000-8000-0000000000a2'
const MILESTONE = '11111111-1111-4111-8111-111111111111'
const ELSEWHERE = '22222222-2222-4222-8222-222222222222'

function withMilestones() {
  const issues = fakeLinearIssues()
  const projects = fakeLinearProjects({ issues })
  const launch = projects.seed({ id: PROJECT_ID, name: 'Launch', teamIds: ['team-acme'], startDate: '2026-11-01' })
  projects.seed({ id: OTHER_ID, name: 'Other', teamIds: ['team-acme'], startDate: '2026-11-01' })
  issues.seed({ title: 'In launch', projectId: launch.id })
  issues.seed({ title: 'Also in launch', projectId: launch.id })
  projects.seedMilestone(PROJECT_ID, { id: MILESTONE, name: 'Alpha', targetDate: '2026-11-15', status: 'next' })
  projects.seedMilestone(OTHER_ID, { id: ELSEWHERE, name: 'Beta', targetDate: '2026-12-15', status: 'next' })
  return { issues, fetch: fakeLinearFetch({ ...fakeWorkspace(), ...issues.routes, ...projects.routes }) }
}

test('milestone is previewed and written on Linear, and none clears it', async () => {
  const { issues, fetch } = withMilestones()
  const context = setup()
  const dry = await bulk(context, fetch, ['milestone', MILESTONE, '--category', 'backlog', '--dry-run'])
  assert.equal(dry.code, 0, JSON.stringify(dry.body))
  assert.deepEqual(dry.body.items.map((item) => [item.id, item.state, item.changes[0].to]), [['ACME-1', 'change', MILESTONE], ['ACME-2', 'change', MILESTONE]])
  assert.deepEqual(issues.mutations, [])
  const real = await bulk(context, fetch, ['milestone', MILESTONE, '--category', 'backlog', '--expect', dry.body.digest])
  assert.equal(real.code, 0, JSON.stringify(real.body))
  assert.deepEqual(real.body.applied, ['ACME-1', 'ACME-2'])
  const clear = await bulk(context, fetch, ['milestone', 'none', '--category', 'backlog', '--dry-run'])
  assert.deepEqual(clear.body.items.map((item) => item.state), ['change', 'change'])
})

test('a milestone of another project is one INVALID_INPUT in the dry run, and an unknown milestone is NOT_FOUND', async () => {
  const { issues, fetch } = withMilestones()
  const wrong = await bulk(setup(), fetch, ['milestone', ELSEWHERE, '--category', 'backlog', '--dry-run'])
  assert.equal(wrong.code, 2)
  assert.equal(wrong.body.error.code, 'INVALID_INPUT')
  assert.match(wrong.body.error.message, /project/)
  const missing = await bulk(setup(), fetch, ['milestone', '33333333-3333-4333-8333-333333333333', '--category', 'backlog', '--dry-run'])
  assert.equal(missing.code, 2)
  assert.equal(missing.body.error.code, 'INVALID_INPUT')
  assert.match(missing.body.error.message, /does not exist/)
  assert.deepEqual(issues.mutations, [])
})

// PMK-246: one release per issue on Linear (decision PMK-246-1).
const REL_A = '00000000-0000-4000-8000-0000000000c1'
const REL_B = '00000000-0000-4000-8000-0000000000c2'
function withReleases() {
  const fake = fakeLinearIssues({
    pipelines: [{ id: 'pipe', name: 'Web', teams: ['team-acme'] }],
    releases: [{ id: REL_A, name: 'A', version: '1.0', pipeline: 'pipe' }, { id: REL_B, name: 'B', version: '1.1', pipeline: 'pipe' }],
  })
  fake.seed({ title: 'One' })
  fake.seed({ title: 'Two', releaseIds: [REL_A] })
  fake.seed({ title: 'Both', releaseIds: [REL_A, REL_B] })
  return { fake, fetch: fakeLinearFetch({ ...fakeWorkspace({ releasesEnabled: true }), ...fake.routes }) }
}

test('release is previewed and written on Linear, and an issue in two releases is rejected', async () => {
  const { fake, fetch } = withReleases()
  const context = setup()
  const dry = await bulk(context, fetch, ['release', REL_B, '--category', 'backlog', '--dry-run'])
  assert.equal(dry.code, 0, JSON.stringify(dry.body))
  assert.deepEqual(dry.body.items.map((item) => [item.id, item.state]), [['ACME-1', 'change'], ['ACME-2', 'change'], ['ACME-3', 'rejected']])
  assert.deepEqual(dry.body.items[1].changes.map((change) => [change.field, change.from, change.to]), [['release', REL_A, REL_B]])
  assert.deepEqual(dry.body.items[2].error, { code: 'INVALID_INPUT', message: 'the issue is in 2 Linear releases, and pmkit sets one release per issue', nextStep: 'Change the releases of the issue in Linear' })
  assert.deepEqual(fake.mutations, [])
  // The rejected issue is a blocker, so the real run writes nothing.
  const real = await bulk(context, fetch, ['release', REL_B, '--category', 'backlog'])
  assert.equal(real.body.error.code, 'INVALID_INPUT')
  assert.match(real.body.error.message, /^issues bulk cannot write: ACME-3 was rejected: INVALID_INPUT the issue is in 2 Linear releases/)
  assert.deepEqual(fake.mutations, [])
})

test('release is written on Linear with the digest, and none clears it', async () => {
  const { fake, fetch } = withReleases()
  fake.seed({ title: 'Docs one', labelIds: ['label-docs'] })
  fake.seed({ title: 'Docs two', labelIds: ['label-docs'], releaseIds: [REL_A] })
  const context = setup()
  const dry = await bulk(context, fetch, ['release', REL_B, '--label', 'Docs', '--dry-run'])
  assert.equal(dry.code, 0, JSON.stringify(dry.body))
  const real = await bulk(context, fetch, ['release', REL_B, '--label', 'Docs', '--expect', dry.body.digest])
  assert.equal(real.code, 0, JSON.stringify(real.body))
  assert.deepEqual(real.body.applied, ['ACME-4', 'ACME-5'])
  assert.deepEqual(fake.records.slice(3).map((record) => record.releaseIds), [[REL_B], [REL_B]])
  const clear = await bulk(context, fetch, ['release', 'none', '--label', 'Docs', '--dry-run'])
  assert.deepEqual(clear.body.items.map((item) => item.state), ['change', 'change'])
})

test('release on a workspace with releases off refuses NOT_SUPPORTED', async () => {
  const { fake, fetch } = withIssues(['One'])
  const result = await bulk(setup(), fetch, ['release', REL_A, '--category', 'backlog', '--dry-run'])
  assert.equal(result.body.error.code, 'NOT_SUPPORTED')
  assert.equal(result.body.error.message, 'Linear releases are off in this workspace')
  assert.deepEqual(fake.mutations, [])
})

test('bulk unarchive is NOT_SUPPORTED on Linear before any read, even when nothing is archived', async () => {
  const { fake, fetch } = withIssues(['One'])
  const result = await bulk(setup(), fetch, ['unarchive', '--category', 'backlog', '--archived', '--dry-run'])
  assert.equal(result.body.error.code, 'NOT_SUPPORTED')
  assert.deepEqual(fake.mutations, [])
})

test('due, type and archive are written on Linear', async () => {
  const { fake, fetch } = withIssues(['One', 'Two'])
  const context = setup()
  fs.appendFileSync(path.join(context.root, '.pmkit', 'config.yaml'), 'mappings:\n  types:\n    bug: Bug\n')
  for (const [args, mutation] of [[['due', '2026-12-01'], 'PmkitIssueUpdate'], [['type', 'bug'], 'PmkitIssueUpdate'], [['archive'], 'PmkitIssueArchive']]) {
    const dry = await bulk(context, fetch, [...args, '--category', 'backlog', '--dry-run'])
    assert.equal(dry.code, 0, JSON.stringify(dry.body))
    const real = await bulk(context, fetch, [...args, '--category', 'backlog', '--expect', dry.body.digest])
    assert.equal(real.code, 0, JSON.stringify(real.body))
    assert.ok(fake.mutations.includes(mutation), args.join(' '))
    assert.deepEqual(real.body.applied, ['ACME-1', 'ACME-2'], args.join(' '))
  }
})

test('a milestone is read once for the whole batch, not once per issue', async () => {
  const { fetch } = withMilestones()
  let reads = 0
  const counting = async (...args) => {
    if (String(args[1]?.body).includes('PmkitProjectMilestone(')) reads += 1
    return fetch(...args)
  }
  const dry = await bulk(setup(), counting, ['milestone', MILESTONE, '--category', 'backlog', '--dry-run'])
  assert.equal(dry.code, 0, JSON.stringify(dry.body))
  assert.equal(reads, 1)
})
