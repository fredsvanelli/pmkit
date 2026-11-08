// PMK-66: pmkit roadmap review reads the tracker, reports epics and milestones, and writes nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { PmkitError } from './lib/errors.mjs'
import { makeRepo, userStoreEnv } from './test-helpers.mjs'
import { readTree } from './scenario-helpers.mjs'
import { childEnv } from './golden-helpers.mjs'
import { linearDescriptor } from './lib/linear/adapter.mjs'
import { isMutation } from './lib/linear/client.mjs'
import { useLinear } from './fake-hosted.mjs'
import { FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeLinearProjects, fakeWorkspace } from './fake-linear-api.mjs'

const NOW = '2026-10-23T12:00:00Z'

function teamRepo() {
  const root = makeRepo('team')
  fs.mkdirSync(path.join(root, '.issues/milestones'), { recursive: true })
  fs.writeFileSync(path.join(root, '.issues/milestones/beta.md'), '---\nname: Beta\ndue: 2026-10-20\n---\n\nBeta.\n')
  const epic = path.join(root, '.issues/epics/EPC-2M9D/epic.md')
  fs.writeFileSync(epic, fs.readFileSync(epic, 'utf8').replace('\ntarget: ', '\nmilestone: beta\ntarget: '))
  const store = userStoreEnv()
  const env = { ...process.env, ...store.env, PMKIT_USER: 'fred', PMKIT_NOW: NOW, PMKIT_SEED: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }
  return { root, env, home: store.home }
}

/** The local adapter with some tracker reads replaced. */
const localWith = (overrides) => ({
  ...ADAPTERS,
  local: { ...ADAPTERS.local, create: async (...args) => ({ ...(await ADAPTERS.local.create(...args)), ...overrides }) },
})

async function review(context, args = [], adapters) {
  const result = await run(['roadmap', 'review', ...args], { cwd: context.root, env: context.env, ...(adapters ? { adapters } : {}) })
  return { ...result, json: args.includes('--json') && result.code === 0 ? JSON.parse(result.stdout) : null }
}

test('roadmap review reports the epic, its milestone and the missing update, and writes nothing', async () => {
  const context = teamRepo()
  const before = readTree(context.root)
  const home = readTree(context.home)
  const { code, json, stderr } = await review(context, ['--json'])
  assert.equal(code, 0, stderr)
  assert.equal(json.today, '2026-10-23')
  assert.equal(json.statusUpdateWindowDays, 14)
  const [epic] = json.epics
  assert.equal(epic.id, 'EPC-2M9D')
  assert.deepEqual([epic.start, epic.target, epic.milestone, epic.health, epic.delayDays], ['2026-09-28', '2026-11-13', 'beta', null, 0])
  assert.deepEqual(epic.reasons, ['no_recent_update'])
  assert.equal(typeof epic.progress.total, 'number')
  assert.deepEqual(json.noRecentUpdates, ['EPC-2M9D'])
  assert.deepEqual(json.updatesNotChecked, [])
  const beta = json.milestones.find((m) => m.id === 'beta')
  assert.deepEqual([beta.due, beta.filed, beta.epics, beta.delayDays], ['2026-10-20', true, ['EPC-2M9D'], 3])
  assert.equal(json.lateIssues, null)
  // ISS-3Q6T holds conflict markers: it is skipped, so issue counts may be short and the review says it is incomplete.
  assert.deepEqual(json.problems.map((p) => p.id), ['ISS-3Q6T'])
  assert.equal(json.incomplete, true)
  assert.deepEqual(beta.issues, null)
  assert.deepEqual(readTree(context.root), before, 'no tracked file changes')
  assert.deepEqual(readTree(context.home), home, 'the user store does not change')
})

test('roadmap review prints the text report', async () => {
  const { code, stdout } = await review(teamRepo())
  assert.equal(code, 0)
  assert.match(stdout, /^roadmap review on 2026-10-23: status updates due every 14 days\n/)
  assert.match(stdout, /epics with no recent status update \(1\)/)
})

test('roadmap review takes no argument', async () => {
  const { code, stderr } = await review(teamRepo(), ['extra'])
  assert.equal(code, 2)
  assert.match(stderr, /roadmap review takes no arguments/)
})

test('one failed progress read keeps the other rows, is unknown and makes the review incomplete', async () => {
  const adapters = localWith({ deliverableProgress: async (id) => { throw new PmkitError('UPSTREAM', `progress of ${id} failed`) } })
  const { code, json, stderr } = await review(teamRepo(), ['--json'], adapters)
  assert.equal(code, 0, stderr)
  assert.equal(json.epics[0].progress, null)
  assert.deepEqual(json.epics[0].reasons, ['no_recent_update'])
  assert.equal(json.incomplete, true)
  assert.deepEqual(json.problems.find((p) => p.id === 'EPC-2M9D'), { id: 'EPC-2M9D', code: 'UPSTREAM', message: 'progress of EPC-2M9D failed' })
  assert.match(stderr, /EPC-2M9D: UPSTREAM progress of EPC-2M9D failed/)
})

test('a tracker without status updates leaves every open epic not checked, never stale', async () => {
  const adapters = localWith({ listStatusUpdates: async () => { throw new PmkitError('NOT_SUPPORTED', 'no status updates') } })
  const { code, json, stderr } = await review(teamRepo(), ['--json'], adapters)
  assert.equal(code, 0, stderr)
  assert.deepEqual(json.noRecentUpdates, [])
  assert.deepEqual(json.updatesNotChecked, ['EPC-2M9D'])
  assert.deepEqual(json.epics[0].reasons, [])
  assert.equal(json.incomplete, true)
})

test('a tracker without epics falls back to milestones and late issues', async () => {
  const adapters = localWith({ listDeliverables: async () => { throw new PmkitError('NOT_SUPPORTED', 'no epics') } })
  const { code, json, stderr } = await review(teamRepo(), ['--json'], adapters)
  assert.equal(code, 0, stderr)
  assert.equal(json.epics, null)
  assert.ok(Array.isArray(json.milestones))
  assert.ok(json.lateIssues.every((row) => row.due < '2026-10-23' && row.delayDays > 0))
  assert.ok(json.lateIssues.length > 0)
  assert.equal(json.incomplete, true)
})

test('a cut issue read leaves milestone counts unknown', async () => {
  const context = teamRepo()
  // The local tracker never cuts a read; the cut is forged from its own result.
  const base = ADAPTERS.local
  const cut = { ...ADAPTERS, local: { ...base, create: async (...args) => {
    const tracker = await base.create(...args)
    return { ...tracker, searchIssues: async (filter) => ({ ...(await tracker.searchIssues(filter)), hasMore: true }) }
  } } }
  const { code, json, stderr } = await review(context, ['--json'], cut)
  assert.equal(code, 0, stderr)
  assert.equal(json.milestones.find((m) => m.id === 'beta').issues, null)
  assert.equal(json.incomplete, true)
  assert.match(stderr, /more issues/)
})

test('roadmap review on Linear awaits the project reads and sends no mutation', async () => {
  const PROJECT_ID = '00000000-0000-4000-8000-0000000000a1'
  const MILESTONE = '11111111-1111-4111-8111-111111111111'
  const issues = fakeLinearIssues()
  const projects = fakeLinearProjects({ issues })
  projects.seed({ id: PROJECT_ID, name: 'Launch', teamIds: ['team-acme'], startDate: '2026-11-01' })
  issues.seed({ title: 'Done one', projectId: PROJECT_ID, stateId: 'state-8', projectMilestoneId: MILESTONE })
  issues.seed({ title: 'Open one', projectId: PROJECT_ID, projectMilestoneId: MILESTONE })
  projects.seedUpdate(PROJECT_ID, { id: 'update-1', body: 'All good', health: 'onTrack', createdAt: '2026-10-27T10:00:00.000Z' })
  projects.seedMilestone(PROJECT_ID, { id: MILESTONE, name: 'Alpha', targetDate: '2026-11-15', status: 'next' })
  const fetch = fakeLinearFetch({ ...fakeWorkspace(), ...issues.routes, ...projects.routes })
  const root = useLinear(makeRepo('basic'))
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('    workspace: acme', '    workspace: acme\n    team: ACME'))
  const env = { ...childEnv(), ...userStoreEnv().env, LINEAR_API_KEY: FAKE_KEY, PMKIT_NOW: '2026-11-20T12:00:00Z' }
  const result = await run(['roadmap', 'review', '--json'], { cwd: root, env, adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch }) } })
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const json = JSON.parse(result.stdout)
  const [epic] = json.epics
  assert.deepEqual([epic.id, epic.health, epic.milestone, epic.reasons], ['P-ACM-1', 'on_track', MILESTONE, ['no_recent_update']])
  assert.deepEqual(epic.progress, { done: 1, total: 2, canceled: 0 })
  const [alpha] = json.milestones
  assert.deepEqual([alpha.name, alpha.due, alpha.epics, alpha.issues, alpha.delayDays], ['Alpha', '2026-11-15', ['P-ACM-1'], { open: 1, done: 1, canceled: 0 }, 5])
  assert.deepEqual(json.noRecentUpdates, ['P-ACM-1'])
  assert.equal(fetch.calls.filter((call) => isMutation(call.body.query)).length, 0)
})
