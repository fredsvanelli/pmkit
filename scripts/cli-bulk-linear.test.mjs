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
  assert.ok(['NOT_FOUND', 'INVALID_INPUT'].includes(missing.body.error.code))
  assert.deepEqual(issues.mutations, [])
})

test('release stays NOT_SUPPORTED on Linear and says releases are not mapped', async () => {
  const { fake, fetch } = withIssues(['One'])
  const result = await bulk(setup(), fetch, ['release', '1.0', '--category', 'backlog', '--dry-run'])
  assert.equal(result.body.error.code, 'NOT_SUPPORTED')
  assert.match(result.body.error.message, /releases are not mapped/)
  assert.deepEqual(fake.mutations, [])
})

test('due, type and archive are written on Linear', async () => {
  const { fake, fetch } = withIssues(['One', 'Two'])
  const context = setup()
  for (const [args, mutation] of [[['due', '2026-12-01'], 'PmkitIssueUpdate'], [['archive'], 'PmkitIssueArchive']]) {
    const dry = await bulk(context, fetch, [...args, '--category', 'backlog', '--dry-run'])
    assert.equal(dry.code, 0, JSON.stringify(dry.body))
    const real = await bulk(context, fetch, [...args, '--category', 'backlog', '--expect', dry.body.digest])
    assert.equal(real.code, 0, JSON.stringify(real.body))
    assert.ok(fake.mutations.includes(mutation), args.join(' '))
  }
})
