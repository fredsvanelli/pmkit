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

const ACTOR = 'user-1'
const sentInput = (sent, name) => sent(name).at(-1).body.variables.input

test('createDeliverable sends projectCreate once with a client id, reads the project back and returns the canonical id', async () => {
  const { ops, sent, mutationsSent } = kit()
  const { before, after } = await ops.createDeliverable({ title: ' Launch ', start: '2026-11-01', target: '2026-12-01', description: 'Why' }, ACTOR)
  assert.equal(before, null)
  assert.equal(after.id, 'P-ACM-1')
  assert.equal(after.title, 'Launch')
  assert.equal(after.start, '2026-11-01')
  assert.equal(after.description, 'Why')
  assert.equal(mutationsSent(), 1)
  assert.deepEqual(sentInput(sent, 'PmkitProjectCreate'), { id: 'generated-1', name: 'Launch', teamIds: ['team-acme'], content: 'Why', startDate: '2026-11-01', targetDate: '2026-12-01' })
  assert.deepEqual((await ops.listDeliverables()).map((epic) => epic.id), ['P-ACM-1'])
})

test('createDeliverable refuses another actor, a milestone, an unknown field and bad input before any write', async () => {
  const { ops, mutationsSent } = kit()
  await assert.rejects(ops.createDeliverable({ title: 'x' }, 'user-2'), { code: 'INVALID_INPUT' })
  await assert.rejects(ops.createDeliverable({ title: 'x', milestone: 'x' }, ACTOR), { code: 'NOT_SUPPORTED' })
  await assert.rejects(ops.createDeliverable({ title: 'x', lead: 'y' }, ACTOR), { code: 'INVALID_INPUT' })
  await assert.rejects(ops.createDeliverable({ title: '  ' }, ACTOR), { code: 'INVALID_INPUT' })
  await assert.rejects(ops.createDeliverable({ title: 'x', start: 'soon' }, ACTOR), { code: 'INVALID_INPUT' })
  assert.equal(mutationsSent(), 0)
})

test('a createDeliverable dry run sends no mutation and returns a placeholder id', async () => {
  const { ops, mutationsSent } = kit()
  const { before, after } = await ops.createDeliverable({ title: 'Launch' }, ACTOR, { dryRun: true })
  assert.equal(before, null)
  assert.equal(after.id, null)
  assert.equal(after.title, 'Launch')
  assert.deepEqual(after.status, { name: 'Backlog', category: 'backlog' })
  assert.equal(mutationsSent(), 0)
  assert.deepEqual(await ops.listDeliverables(), [])
})

test('an unconfirmed createDeliverable that happened returns the project; one that did not rethrows', async () => {
  const applied = kit()
  applied.fake.unconfirm('PmkitProjectCreate', { applied: true })
  assert.equal((await applied.ops.createDeliverable({ title: 'Launch' }, ACTOR)).after.title, 'Launch')
  assert.equal(applied.mutationsSent(), 1)
  const lost = kit()
  lost.fake.unconfirm('PmkitProjectCreate', { applied: false })
  await assert.rejects(lost.ops.createDeliverable({ title: 'Launch' }, ACTOR), { code: 'UPSTREAM' })
  assert.equal(lost.mutationsSent(), 1)
})

test('publishStatusUpdate sends projectUpdateCreate once and the health shows on the epic', async () => {
  const { fake, ops, sent, mutationsSent } = kit()
  seedProject(fake, 'Launch', { id: PID })
  const { before, after } = await ops.publishStatusUpdate({ epic: 'p-acm-1', health: 'at_risk', body: ' Behind ' }, ACTOR)
  assert.equal(before, null)
  assert.deepEqual(Object.keys(after).sort(), ['at', 'author', 'body', 'epic', 'health'])
  assert.equal(after.epic, 'P-ACM-1')
  assert.equal(after.author, ACTOR)
  assert.equal(after.health, 'at_risk')
  assert.equal(after.body, 'Behind')
  assert.equal(mutationsSent(), 1)
  assert.deepEqual(sentInput(sent, 'PmkitProjectUpdateCreate'), { id: 'generated-1', projectId: PID, body: 'Behind', health: 'atRisk' })
  assert.equal((await ops.getDeliverable('P-ACM-1')).health, 'at_risk')
})

test('publishStatusUpdate refuses a bad health, an empty body and an unknown epic before any write', async () => {
  const { fake, ops, mutationsSent, fetch } = kit()
  seedProject(fake, 'Launch')
  const before = fetch.calls.length
  await assert.rejects(ops.publishStatusUpdate({ epic: 'P-ACM-1', health: 'fine', body: 'x' }, ACTOR), { code: 'INVALID_INPUT' })
  await assert.rejects(ops.publishStatusUpdate({ epic: 'P-ACM-1', health: 'on_track', body: '  ' }, ACTOR), { code: 'INVALID_INPUT' })
  assert.equal(fetch.calls.length, before)
  await assert.rejects(ops.publishStatusUpdate({ epic: 'P-ZZZ-9', health: 'on_track', body: 'x' }, ACTOR), { code: 'NOT_FOUND', nextStep: 'pmkit epic list' })
  await assert.rejects(ops.publishStatusUpdate({ epic: 'P-ACM-1', health: 'on_track', body: 'x' }, 'user-2'), { code: 'INVALID_INPUT' })
  assert.equal(mutationsSent(), 0)
})

test('a publishStatusUpdate dry run returns the update from the clock and the actor and sends nothing', async () => {
  const { fake, ops, mutationsSent } = kit()
  seedProject(fake, 'Launch')
  const { before, after } = await ops.publishStatusUpdate({ epic: 'P-ACM-1', health: 'off_track', body: 'Late' }, ACTOR, { dryRun: true })
  assert.equal(before, null)
  assert.deepEqual(after, { epic: 'P-ACM-1', at: NOW.toISOString(), author: ACTOR, health: 'off_track', body: 'Late' })
  assert.equal(mutationsSent(), 0)
  assert.deepEqual(await ops.listStatusUpdates('P-ACM-1'), [])
})

test('an unconfirmed publishStatusUpdate reads the update by its id; one that did not happen rethrows', async () => {
  const applied = kit()
  seedProject(applied.fake, 'Launch')
  applied.fake.unconfirm('PmkitProjectUpdateCreate', { applied: true })
  const { after } = await applied.ops.publishStatusUpdate({ epic: 'P-ACM-1', health: 'on_track', body: 'Fine' }, ACTOR)
  assert.equal(after.body, 'Fine')
  assert.equal(applied.mutationsSent(), 1)
  assert.equal((await applied.ops.listStatusUpdates('P-ACM-1')).length, 1)
  const lost = kit()
  seedProject(lost.fake, 'Launch')
  lost.fake.unconfirm('PmkitProjectUpdateCreate', { applied: false })
  await assert.rejects(lost.ops.publishStatusUpdate({ epic: 'P-ACM-1', health: 'on_track', body: 'Fine' }, ACTOR), { code: 'UPSTREAM' })
  assert.equal(lost.mutationsSent(), 1)
})

test('listStatusUpdates returns newest first with a stable order for updates of one second, and NOT_FOUND for an unknown epic', async () => {
  const { fake, ops } = kit()
  seedProject(fake, 'Launch', { id: PID })
  assert.deepEqual(await ops.listStatusUpdates('P-ACM-1'), [])
  fake.seedUpdate(PID, { id: 'old', body: 'old', health: 'onTrack', createdAt: '2026-10-27T10:00:00.000Z' })
  fake.seedUpdate(PID, { id: 'b', body: 'b', health: 'atRisk', createdAt: '2026-10-28T10:00:00.000Z' })
  fake.seedUpdate(PID, { id: 'a', body: 'a', health: 'offTrack', createdAt: '2026-10-28T10:00:00.000Z' })
  const updates = await ops.listStatusUpdates('p-acm-1')
  assert.deepEqual(updates.map((update) => update.body), ['a', 'b', 'old'])
  assert.deepEqual(updates[0], { epic: 'P-ACM-1', at: '2026-10-28T10:00:00.000Z', author: ACTOR, health: 'off_track', body: 'a' })
  await assert.rejects(ops.listStatusUpdates('P-ZZZ-9'), { code: 'NOT_FOUND' })
})

const M1 = '11111111-1111-4111-8111-111111111111'
const M2 = '22222222-2222-4222-8222-222222222222'
const M3 = '33333333-3333-4333-8333-333333333333'

function milestoneKit() {
  const { fake, ...rest } = kit()
  const launch = seedProject(fake, 'Launch', { id: PID })
  const other = fake.seed({ name: 'Elsewhere', teamIds: ['team-two'] })
  fake.seedMilestone(launch.id, { id: M2, name: 'Beta', targetDate: '2026-12-01', status: 'unstarted', progress: 0.1, description: 'Second' })
  fake.seedMilestone(launch.id, { id: M1, name: 'Alpha', targetDate: '2026-11-01', status: 'next', progress: 0.5 })
  fake.seedMilestone(other.id, { id: M3, name: 'Foreign', targetDate: '2026-10-01', status: 'overdue' })
  return { fake, ...rest }
}

test('listMilestones returns the milestones of the team projects by due date, with the canonical epic id', async () => {
  const { ops } = milestoneKit()
  assert.deepEqual(await ops.listMilestones(), [
    { id: M1, name: 'Alpha', due: '2026-11-01', epic: 'P-ACM-1', status: 'next', progress: 0.5 },
    { id: M2, name: 'Beta', due: '2026-12-01', description: 'Second', epic: 'P-ACM-1', status: 'unstarted', progress: 0.1 },
  ])
})

test('getMilestone returns what listMilestones holds, NOT_FOUND for an unknown UUID, and NOT_FOUND with no request for a non-UUID', async () => {
  const { ops, fetch } = milestoneKit()
  const [first] = await ops.listMilestones()
  assert.deepEqual(await ops.getMilestone(M1), first)
  await assert.rejects(ops.getMilestone('99999999-9999-4999-8999-999999999999'), { code: 'NOT_FOUND', nextStep: 'pmkit milestone list' })
  const before = fetch.calls.length
  await assert.rejects(ops.getMilestone('alpha'), { code: 'NOT_FOUND', message: 'milestone alpha does not exist', nextStep: 'pmkit milestone list' })
  assert.equal(fetch.calls.length, before)
})

test('readDocument returns path, title and body for a slug or a document URL, and NOT_FOUND for an unknown slug', async () => {
  const { fake, ops } = kit()
  const project = seedProject(fake, 'Launch')
  fake.seedDocument(project.id, { slugId: 'abcdef012345', title: 'Plan', content: '# Plan\n\nBody.' })
  const expected = { path: 'abcdef012345', title: 'Plan', body: '# Plan\n\nBody.' }
  assert.deepEqual(await ops.readDocument('abcdef012345'), expected)
  assert.deepEqual(await ops.readDocument('https://linear.app/acme/document/plan-abcdef012345'), expected)
  await assert.rejects(ops.readDocument('ffffffffffff'), { code: 'NOT_FOUND' })
  await assert.rejects(ops.readDocument('notes/plan.md'), { code: 'NOT_FOUND' })
})

test('createMilestone and createDocument are NOT_SUPPORTED and send no request', async () => {
  const { ops, fetch } = kit()
  const before = fetch.calls.length
  await assert.rejects(ops.createMilestone({ id: 'm' }, ACTOR), { code: 'NOT_SUPPORTED', nextStep: 'Create the milestone in Linear' })
  await assert.rejects(ops.createDocument('notes/plan.md', 'x', ACTOR), { code: 'NOT_SUPPORTED', nextStep: 'Create the document in Linear' })
  await assert.rejects(ops.createMilestone({ id: 'm' }, ACTOR, { dryRun: true }), { code: 'NOT_SUPPORTED' })
  assert.equal(fetch.calls.length, before)
})
