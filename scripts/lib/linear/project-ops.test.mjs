import assert from 'node:assert/strict'
import test from 'node:test'
import { ACME_STATES, ACME_TEAM, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeLinearProjects, fakeWorkspace } from '../../fake-linear-api.mjs'
import { createLinearClient, isMutation, operationName } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { PARENT_CHAIN_DEPTH } from './documents.mjs'
import { projectOperations } from './project-ops.mjs'

const TWO = { ...ACME_TEAM, id: 'team-two', key: 'TWO', name: 'Two' }
const NOW = new Date('2026-10-28T12:00:00Z')

/** Fakes, a client and a projectOperations instance for scope team `team`. `options` reach fakeLinearProjects. */
function kit({ team = 'ACME', identifiers = true, points = false } = {}) {
  const teams = [points ? { ...ACME_TEAM, issueEstimationType: 'fibonacci' } : ACME_TEAM, TWO]
  const states = [...ACME_STATES, ...ACME_STATES.map((state) => ({ ...state, id: `${state.id}-two`, team: { id: TWO.id } }))]
  const issues = fakeLinearIssues({ teams, states })
  const fake = fakeLinearProjects({ issues, teams, states, identifiers })
  const fetch = fakeLinearFetch({ ...fakeWorkspace({ teams, states }), ...issues.routes, ...fake.routes })
  const config = { pmkit: { tracker: { system: 'linear', scope: { workspace: 'acme', team } }, ...(points ? { mappings: { fields: { estimate: 'native' } } } : {}) } }
  const client = createLinearClient({ env: { LINEAR_API_KEY: FAKE_KEY }, tracker: config.pmkit.tracker, fetch })
  let memo
  const discovery = () => (memo ??= fetchDiscovery(client, { now: () => NOW }).then((raw) => ({ raw })))
  let count = 0
  const ops = projectOperations({ client, discovery, config, now: () => NOW, uuid: () => `generated-${++count}` })
  const sent = (name) => fetch.calls.filter((call) => operationName(call.body.query) === name)
  const mutationsSent = () => fetch.calls.filter((call) => isMutation(call.body.query)).length
  return { issues, fake, fetch, ops, client, sent, mutationsSent }
}
const names = (list) => list.map((item) => item.title)
const seedProject = (fake, name, extra = {}) => fake.seed({ name, teamIds: ['team-acme'], ...extra })

test('listDeliverables returns the team projects in start, creation, id order, without the lists', async () => {
  const { fake, ops } = kit()
  seedProject(fake, 'Late', { startDate: '2026-12-01' })
  seedProject(fake, 'Early', { startDate: '2026-11-01' })
  seedProject(fake, 'Undated')
  fake.seed({ name: 'Elsewhere', teamIds: ['team-two'] })
  const epics = await ops.listDeliverables()
  assert.deepEqual(names(epics), ['Early', 'Late', 'Undated'])
  assert.deepEqual(epics.map((epic) => epic.id), ['P-ACM-2', 'P-ACM-1', 'P-ACM-3'])
  for (const epic of epics) for (const key of ['milestones', 'documents']) assert.equal(key in epic, false)
})

test('a project that spans two teams shows for both', async () => {
  const both = kit({ team: 'ACME' })
  both.fake.seed({ name: 'Shared', teamIds: ['team-acme', 'team-two'] })
  assert.deepEqual(names(await both.ops.listDeliverables()), ['Shared'])
  const other = kit({ team: 'TWO' })
  other.fake.seed({ name: 'Shared', teamIds: ['team-acme', 'team-two'] })
  assert.deepEqual(names(await other.ops.listDeliverables()), ['Shared'])
})

test('listDeliverables reads every page', async () => {
  const { fake, ops } = kit()
  for (let n = 0; n < 120; n += 1) seedProject(fake, `P${n}`)
  assert.equal((await ops.listDeliverables()).length, 120)
})

test('getDeliverable finds a project by identifier in any case, by slug and by UUID, with one canonical id', async () => {
  const { fake, ops } = kit()
  const project = seedProject(fake, 'Launch', { id: '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0' })
  fake.seedMilestone(project.id, { id: 'm-1', name: 'Alpha', targetDate: '2026-11-15', status: 'next' })
  fake.seedMilestone(project.id, { id: 'm-2', name: 'Beta', status: 'unstarted' })
  fake.seedDocument(project.id, { slugId: 'abcdef012345', title: 'Plan', content: 'x' })
  for (const key of ['P-ACM-1', 'p-acm-1', project.slugId, project.id]) {
    const epic = await ops.getDeliverable(key)
    assert.equal(epic.id, 'P-ACM-1', key)
    assert.equal(epic.title, 'Launch')
    assert.deepEqual(epic.milestones, [{ id: 'm-1', name: 'Alpha', due: '2026-11-15', status: 'next' }, { id: 'm-2', name: 'Beta', status: 'unstarted' }])
    assert.deepEqual(epic.documents, [{ path: 'abcdef012345', title: 'Plan' }])
  }
})

test('getDeliverable sets milestonesMore when a 51st milestone exists', async () => {
  const { fake, ops } = kit()
  const project = seedProject(fake, 'Big')
  for (let n = 0; n < 51; n += 1) fake.seedMilestone(project.id, { id: `m-${n}`, name: `M${n}` })
  const epic = await ops.getDeliverable('P-ACM-1')
  assert.equal(epic.milestones.length, 50)
  assert.equal(epic.milestonesMore, true)
})

test('getDeliverable answers NOT_FOUND for an unknown project, an empty string and a string that is no key, the last two without a request', async () => {
  const { fake, ops, fetch } = kit()
  seedProject(fake, 'Launch')
  await assert.rejects(ops.getDeliverable('NOPE-999999'), { code: 'NOT_FOUND', nextStep: 'pmkit epic list' })
  const before = fetch.calls.length
  await assert.rejects(ops.getDeliverable(''), { code: 'NOT_FOUND', nextStep: 'pmkit epic list' })
  await assert.rejects(ops.getDeliverable('x y'), { code: 'NOT_FOUND', nextStep: 'pmkit epic list' })
  assert.equal(fetch.calls.length, before)
  await assert.rejects(ops.getDeliverable('P-ZZZ-9'), { code: 'NOT_FOUND' })
  await assert.rejects(ops.getDeliverable('ffffffffffff'), { code: 'NOT_FOUND' })
})

test('a project without an identifier gets the lower-case slug as id, and getDeliverable finds it by that id', async () => {
  const { fake, ops } = kit({ identifiers: false })
  const project = seedProject(fake, 'Plain')
  const epic = await ops.getDeliverable(project.slugId)
  assert.equal(epic.id, project.slugId)
  assert.deepEqual((await ops.listDeliverables()).map((item) => item.id), [project.slugId])
})

test('resolveEpic returns the raw node or null with one request per call', async () => {
  const { fake, ops, sent } = kit()
  seedProject(fake, 'Launch')
  const node = await ops.resolveEpic('p-acm-1')
  assert.equal(node.name, 'Launch')
  assert.equal(typeof node.id, 'string')
  assert.equal(sent('PmkitProjects').length, 1)
  assert.equal(await ops.resolveEpic('P-ZZZ-9'), null)
  assert.equal(sent('PmkitProjects').length, 2)
  assert.equal(await ops.resolveEpic('ACME-1'), null)
  assert.equal(sent('PmkitProjects').length, 2)
})

const PID = '00000000-0000-4000-8000-0000000000a1'
const LOCAL_PROGRESS_KEYS = ['byCategory', 'canceled', 'done', 'points', 'pointsDone', 'total']

test('deliverableProgress counts through the parent chain with the Local rules', async () => {
  const { fake, issues, ops } = kit({ points: true })
  seedProject(fake, 'Launch', { id: PID })
  const a = issues.seed({ title: 'A', projectId: PID, stateId: 'state-8', estimate: 2 })
  issues.seed({ title: 'B', projectId: PID, stateId: 'state-2', estimate: 3 })
  issues.seed({ title: 'C', projectId: PID, stateId: 'state-9', estimate: 8 })
  const d = issues.seed({ title: 'D', projectId: PID, stateId: 'state-8', estimate: 5 })
  issues.records.find((record) => record.id === d.id).archivedAt = '2026-10-28T00:00:00.000Z'
  const e = issues.seed({ title: 'E', parentId: a.id, stateId: 'state-2', estimate: 1 })
  issues.seed({ title: 'F', parentId: e.id, stateId: 'state-3' })
  issues.seed({ title: 'Outside', stateId: 'state-8' })
  const progress = await ops.deliverableProgress('p-acm-1')
  assert.deepEqual(
    { ...progress, native: undefined },
    {
      total: 4, done: 1, canceled: 1, points: 6, pointsDone: 2, native: undefined,
      byCategory: { triage: 0, backlog: 0, todo: 2, in_progress: 1, in_review: 0, done: 1, canceled: 1 },
    },
  )
  assert.deepEqual(progress.native, { progress: (await ops.getDeliverable('P-ACM-1')).progress, scope: 3 })
  assert.equal('hasMore' in progress, false)
  for (const key of LOCAL_PROGRESS_KEYS) assert.ok(key in progress, key)
})

test('a parent chain deeper than PARENT_CHAIN_DEPTH stops there', async () => {
  const { fake, issues, ops } = kit()
  seedProject(fake, 'Launch', { id: PID })
  let parent = issues.seed({ title: 'Root', projectId: PID })
  for (let level = 1; level <= PARENT_CHAIN_DEPTH + 2; level += 1) parent = issues.seed({ title: `Level ${level}`, parentId: parent.id })
  assert.equal((await ops.deliverableProgress('P-ACM-1')).total, PARENT_CHAIN_DEPTH + 1)
})

test('a first step that fills 10 pages sets hasMore', async () => {
  const { fake, issues, ops } = kit()
  seedProject(fake, 'Launch', { id: PID })
  for (let n = 0; n < 1001; n += 1) issues.seed({ title: `I${n}`, projectId: PID })
  const progress = await ops.deliverableProgress('P-ACM-1')
  assert.equal(progress.hasMore, true)
  assert.equal(progress.total, 1000)
})

test('deliverableProgress of an unknown epic is NOT_FOUND', async () => {
  const { ops } = kit()
  await assert.rejects(ops.deliverableProgress('P-ZZZ-9'), { code: 'NOT_FOUND', nextStep: 'pmkit epic list' })
})
