// The Milestones family of the GitHub adapter against the stateful fake GitHub, through the real client.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeGithubIssues } from '../../fake-github-issues.mjs'
import { createGithubClient } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { issueOperations } from './issue-ops.mjs'
import { makeContext } from './issues.mjs'
import { projectOperations } from './project-ops.mjs'

const PMKIT = {
  tracker: { system: 'github', scope: { host: 'github.com', repo: 'acme/widgets', project: 'acme/7' } },
  mappings: { status: { backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress', done: 'Done' }, types: { bug: 'Bug', task: 'Task' } },
}
const MILESTONES = [
  { title: 'v2.0', dueOn: '2027-03-01T00:00:00Z' },
  { title: 'v1.0', dueOn: '2026-12-31T00:00:00Z', description: 'First release' },
  { title: 'Big Launch', dueOn: null },
  { title: 'Old', dueOn: '2026-01-15T00:00:00Z', state: 'CLOSED' },
]

async function setup(options = { milestones: MILESTONES }) {
  const fake = fakeGithubIssues(options)
  const client = createGithubClient({ exec: fake.exec, retries: 0, sleep: async () => {} })
  const raw = await fetchDiscovery(client, { host: 'github.com', repo: 'acme/widgets', project: 'acme/7', exec: fake.exec, users: true })
  const context = makeContext(raw, PMKIT)
  const getContext = async () => context
  const ops = issueOperations({ client, config: { pmkit: PMKIT }, getContext })
  const projects = projectOperations({ client, ops, config: { pmkit: PMKIT }, getContext, now: () => new Date('2026-11-17T09:00:00Z') })
  fake.reads.splice(0)
  return { fake, projects }
}
const ids = (list) => list.map((item) => item.id)

test('listMilestones sorts by due then id, with undated last, and includes a closed milestone', async () => {
  const { projects } = await setup()
  const list = await projects.listMilestones()
  assert.deepEqual(ids(list), ['Old', 'v1.0', 'v2.0', 'Big Launch'])
  assert.equal(list[0].status, 'closed')
  assert.deepEqual(list[1], { id: 'v1.0', name: 'v1.0', due: '2026-12-31', description: 'First release', status: 'open' })
})

test('getMilestone finds a milestone by exact title, and a title with spaces is a valid id', async () => {
  const { projects } = await setup()
  assert.equal((await projects.getMilestone('v1.0')).id, 'v1.0')
  assert.equal((await projects.getMilestone('Big Launch')).name, 'Big Launch')
})

test('getMilestone is case sensitive and answers NOT_FOUND with the list step', async () => {
  const { projects } = await setup()
  await assert.rejects(projects.getMilestone('V1.0'), (error) => error.code === 'NOT_FOUND' && error.message === 'milestone V1.0 does not exist' && error.nextStep === 'pmkit milestone list')
})

test('createMilestone sends title and due_on to the REST path and returns the milestone', async () => {
  const { fake, projects } = await setup()
  const result = await projects.createMilestone({ id: 'v3', due: '2026-12-31' }, 'octocat')
  assert.deepEqual(result, { before: null, after: { id: 'v3', name: 'v3', due: '2026-12-31', status: 'open' } })
  const calls = fake.mutations.filter((call) => call.name === 'RestCreateMilestone')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, 'repos/acme/widgets/milestones')
  assert.deepEqual(calls[0].input, { title: 'v3', due_on: '2026-12-31T00:00:00Z' })
  assert.equal((await projects.getMilestone('v3')).due, '2026-12-31')
})

test('createMilestone without a due date sends only the title', async () => {
  const { fake, projects } = await setup()
  await projects.createMilestone({ id: 'v3' }, 'octocat')
  assert.deepEqual(fake.mutations.find((call) => call.name === 'RestCreateMilestone').input, { title: 'v3' })
})

test('createMilestone of a taken title is CONFLICT and sends no request', async () => {
  const { fake, projects } = await setup()
  await assert.rejects(projects.createMilestone({ id: 'v1.0' }, 'octocat'), (error) => error.code === 'CONFLICT' && error.message === 'GitHub already has a milestone titled v1.0')
  assert.deepEqual(fake.mutations, [])
})

test('createMilestone still maps the CONFLICT of a 422 from GitHub', async () => {
  const { fake, projects } = await setup()
  // A milestone created on GitHub after the list was read would reach the REST call; the fake answers 422 for a case-insensitive match.
  await assert.rejects(projects.createMilestone({ id: 'V1.0' }, 'octocat'), { code: 'CONFLICT', message: 'GitHub already has a milestone titled V1.0' })
  assert.equal(fake.mutations.filter((call) => call.name === 'RestCreateMilestone').length, 1)
})

test('createMilestone with a name that differs from the id is INVALID_INPUT and sends no request', async () => {
  const { fake, projects } = await setup()
  await assert.rejects(projects.createMilestone({ id: 'v1.0x', name: 'Version one' }, 'octocat'), { code: 'INVALID_INPUT', message: 'a GitHub milestone has one name, its title' })
  await assert.rejects(projects.createMilestone({ id: 'v1.0', name: 'Version one' }, 'octocat'), { code: 'INVALID_INPUT', message: 'a GitHub milestone has one name, its title' })
  assert.deepEqual(fake.mutations, [])
  assert.deepEqual(fake.reads, [])
})

test('createMilestone accepts a name equal to the id', async () => {
  const { projects } = await setup()
  assert.equal((await projects.createMilestone({ id: 'v3', name: 'v3' }, 'octocat')).after.id, 'v3')
})

test('createMilestone refuses an unknown key, a missing id and a bad due date, with no request', async () => {
  const { fake, projects } = await setup()
  await assert.rejects(projects.createMilestone({ id: 'v3', goal: 'x' }, 'octocat'), { code: 'INVALID_INPUT' })
  await assert.rejects(projects.createMilestone({}, 'octocat'), { code: 'INVALID_INPUT' })
  await assert.rejects(projects.createMilestone({ id: 'v3', due: 'soon' }, 'octocat'), { code: 'INVALID_INPUT', message: 'due must be a date as YYYY-MM-DD' })
  assert.deepEqual(fake.mutations, [])
})

test('createMilestone by another actor than the gh login is INVALID_INPUT', async () => {
  const { fake, projects } = await setup()
  await assert.rejects(projects.createMilestone({ id: 'v3' }, 'someone'), { code: 'INVALID_INPUT' })
  assert.deepEqual(fake.mutations, [])
})

test('a dry run of createMilestone sends nothing and shows the milestone', async () => {
  const { fake, projects } = await setup()
  const result = await projects.createMilestone({ id: 'v3', due: '2026-12-31' }, 'octocat', { dryRun: true })
  assert.deepEqual(result, { before: null, after: { id: 'v3', name: 'v3', due: '2026-12-31', status: 'open' } })
  assert.deepEqual(fake.mutations, [])
})

// The epic part: linked Projects as epics, over the fake.
import { epicProjects } from './project-ops.mjs'

const EPIC_PMKIT = { ...PMKIT, mappings: { ...PMKIT.mappings, fields: { estimate: 'project:Story points' } } }
const EPICS = [
  { id: 'PVT_E12', owner: 'acme', number: 12, title: 'Epic twelve', readme: 'The long text', shortDescription: 'Short' },
  { id: 'PVT_E9', owner: 'acme', number: 9, title: 'Epic nine', shortDescription: 'Nine short', closed: true },
  { id: 'PVT_E30', owner: 'acme', number: 30, title: 'Not linked', linked: false },
]

async function epicSetup(options = {}) {
  const fake = fakeGithubIssues({ epics: EPICS, ...options })
  const client = createGithubClient({ exec: fake.exec, retries: 0, sleep: async () => {} })
  const raw = await fetchDiscovery(client, { host: 'github.com', repo: 'acme/widgets', project: 'acme/7', exec: fake.exec, users: true })
  const scope = PMKIT.tracker.scope
  const context = makeContext(raw, EPIC_PMKIT, { epics: await epicProjects(client, scope) })
  const getContext = async () => context
  const config = { pmkit: EPIC_PMKIT }
  const ops = issueOperations({ client, config, getContext })
  const projects = projectOperations({ client, ops, config, getContext, now: () => new Date('2026-11-17T09:00:00Z') })
  return { fake, projects, client }
}
const mutationNames = (fake) => fake.mutations.map((call) => call.name)

test('epicProjects drops the scope Project and an unlinked one, reads once, and with project none reads nothing', async () => {
  const { fake, client } = await epicSetup()
  fake.reads.splice(0)
  const map = await epicProjects(client, PMKIT.tracker.scope)
  assert.deepEqual([...map], [['PVT_E12', 'acme/12'], ['PVT_E9', 'acme/9']])
  assert.equal(fake.reads.filter((call) => call.name === 'PmkitLinkedProjects').length, 1)
  fake.reads.splice(0)
  assert.equal((await epicProjects(client, { ...PMKIT.tracker.scope, project: 'none' })).size, 0)
  assert.deepEqual(fake.reads, [])
})

test('epicProjects pages 20 at a time and warns past 10 pages', async () => {
  const many = Array.from({ length: 205 }, (_, at) => ({ id: `PVT_M${at}`, owner: 'acme', number: 100 + at }))
  const { fake, client } = await epicSetup({ epics: many })
  fake.reads.splice(0)
  const map = await epicProjects(client, PMKIT.tracker.scope)
  // The scope Project takes one of the 200 places a run reads.
  assert.equal(map.size, 199)
  assert.equal(fake.reads.filter((call) => call.name === 'PmkitLinkedProjects').length, 10)
  assert.match(map.warnings[0], /more than 200 linked Projects/)
})

test('epicProjects lets an upstream failure propagate', async () => {
  const { fake, client } = await epicSetup()
  fake.failNext('PmkitLinkedProjects')
  await assert.rejects(epicProjects(client, PMKIT.tracker.scope), { code: 'UPSTREAM' })
  assert.equal((await epicProjects(client, PMKIT.tracker.scope)).size, 2)
})

test('listDeliverables lists linked Projects without the scope one, sorted by start then id, closed ones as done', async () => {
  const { fake, projects } = await epicSetup()
  fake.seedStatusUpdate('PVT_E12', { status: 'ON_TRACK', body: 'Fine', startDate: '2026-12-01', targetDate: '2027-02-01', createdAt: '2026-11-10T09:00:00Z' })
  const list = await projects.listDeliverables()
  assert.deepEqual(list.map((epic) => epic.id), ['acme/12', 'acme/9'])
  assert.deepEqual(list[0].status, { name: 'On track', category: 'in_progress' })
  assert.equal(list[0].health, 'on_track')
  assert.equal(list[0].description, 'The long text')
  assert.deepEqual(list[1].status, { name: 'Closed', category: 'done' })
  assert.equal(list[1].description, 'Nine short')
})

test('getDeliverable finds an epic with or without the case of the owner', async () => {
  const { projects } = await epicSetup()
  assert.equal((await projects.getDeliverable('acme/12')).title, 'Epic twelve')
  assert.equal((await projects.getDeliverable('ACME/12')).id, 'acme/12')
})

test('getDeliverable of the scope Project, an unlinked Project, a missing one or a malformed id is NOT_FOUND with the list step', async () => {
  const { projects } = await epicSetup()
  for (const id of ['acme/7', 'acme/30', 'acme/99', 'epic-1', '12']) {
    await assert.rejects(projects.getDeliverable(id), (error) => error.code === 'NOT_FOUND' && error.nextStep === 'pmkit epic list', id)
  }
})

test('deliverableProgress counts an item, its sub-issue and a canceled issue with the Local rules, and skips archived ones', async () => {
  const { fake, projects } = await epicSetup()
  fake.seed({ number: 1, epics: ['acme/12'], item: { status: 'Done', values: { 'Story points': 5 } } })
  fake.seed({ number: 2, epics: ['acme/12'], item: { status: 'In Progress', values: { 'Story points': 3 } } })
  fake.seed({ number: 3, parent: 2, item: { status: 'Done', values: { 'Story points': 2 } } })
  fake.seed({ number: 4, epics: ['acme/12'], state: 'CLOSED', stateReason: 'NOT_PLANNED', item: { status: 'Done' } })
  fake.seed({ number: 5, epics: ['acme/12'], item: { status: 'Todo', archived: true } })
  fake.seed({ number: 6, epics: ['acme/12'], item: { status: 'Todo' } })
  // An issue of the epic that has a parent issue is counted under that parent, not twice.
  fake.seed({ number: 7, parent: 6, epics: ['acme/12'], item: { status: 'Done' } })
  fake.seed({ number: 8 })
  const progress = await projects.deliverableProgress('acme/12')
  assert.deepEqual(progress, {
    total: 5, done: 3, canceled: 1, points: 10, pointsDone: 7,
    byCategory: { triage: 0, backlog: 0, todo: 1, in_progress: 1, in_review: 0, done: 3, canceled: 1 },
  })
})

test('deliverableProgress of an empty epic is all zeros, and of an unknown epic is NOT_FOUND', async () => {
  const { projects } = await epicSetup()
  assert.equal((await projects.deliverableProgress('acme/12')).total, 0)
  await assert.rejects(projects.deliverableProgress('acme/30'), { code: 'NOT_FOUND' })
})

test('deliverableProgress sets hasMore past 10 pages of items', async () => {
  const { fake, projects } = await epicSetup()
  for (let number = 1; number <= 1001; number += 1) fake.seed({ number, epics: ['acme/12'] })
  const progress = await projects.deliverableProgress('acme/12')
  assert.equal(progress.hasMore, true)
  assert.equal(progress.total, 1000)
})

test('createDeliverable sends the three mutations and returns the epic with its dates', async () => {
  const { fake, projects } = await epicSetup()
  const { after } = await projects.createDeliverable({ title: 'Launch', start: '2026-12-01', target: '2027-01-31', description: 'Plan' }, 'octocat')
  assert.deepEqual(mutationNames(fake), ['PmkitCreateProject', 'PmkitUpdateProjectReadme', 'PmkitCreateStatusUpdate'])
  const [create, readme, status] = fake.mutations
  assert.deepEqual(create.input, { ownerId: 'O_1', title: 'Launch', repositoryId: 'R_1' })
  assert.equal(readme.input.readme, 'Plan')
  assert.deepEqual({ ...status.input, projectId: undefined }, { status: 'INACTIVE', startDate: '2026-12-01', targetDate: '2027-01-31', projectId: undefined })
  assert.equal(after.id, 'acme/31')
  assert.equal(after.title, 'Launch')
  assert.equal(after.start, '2026-12-01')
  assert.equal(after.target, '2027-01-31')
  assert.equal(after.status.name, 'Inactive')
  assert.equal(after.description, 'Plan')
})

test('createDeliverable without dates or description sends one mutation', async () => {
  const { fake, projects } = await epicSetup()
  const { after } = await projects.createDeliverable({ title: 'Plain' }, 'octocat')
  assert.deepEqual(mutationNames(fake), ['PmkitCreateProject'])
  assert.deepEqual(after.status, { name: 'No update', category: 'todo' })
})

test('createDeliverable with one date sends only that date', async () => {
  const { fake, projects } = await epicSetup()
  const { after } = await projects.createDeliverable({ title: 'Half', target: '2027-01-31' }, 'octocat')
  assert.deepEqual(Object.keys(fake.mutations[1].input).sort(), ['projectId', 'status', 'targetDate'])
  assert.equal('start' in after, false)
})

test('a failure of the readme mutation is UPSTREAM, names the Project and the step, and sends no third mutation', async () => {
  const { fake, projects } = await epicSetup()
  fake.failNext('PmkitUpdateProjectReadme')
  await assert.rejects(
    projects.createDeliverable({ title: 'Launch', start: '2026-12-01', description: 'Plan' }, 'octocat'),
    (error) => error.code === 'UPSTREAM' && error.message.includes('acme/31') && error.nextStep === 'Set the readme of the Project on GitHub',
  )
  assert.deepEqual(mutationNames(fake), ['PmkitCreateProject', 'PmkitUpdateProjectReadme'])
})

test('a failure of the status update mutation is UPSTREAM with the step to publish it', async () => {
  const { fake, projects } = await epicSetup()
  fake.failNext('PmkitCreateStatusUpdate')
  await assert.rejects(
    projects.createDeliverable({ title: 'Launch', start: '2026-12-01' }, 'octocat'),
    (error) => error.code === 'UPSTREAM' && error.message.includes('acme/31') && error.nextStep === 'Publish a status update with the dates on GitHub',
  )
})

test('createDeliverable refuses milestone and goal as NOT_SUPPORTED before any request', async () => {
  const { fake, projects } = await epicSetup()
  fake.reads.splice(0)
  for (const input of [{ title: 'A', milestone: 'v1' }, { title: 'A', goal: 'GOAL-1' }]) {
    await assert.rejects(projects.createDeliverable(input, 'octocat'), { code: 'NOT_SUPPORTED' })
  }
  assert.deepEqual(fake.mutations, [])
  assert.deepEqual(fake.reads, [])
})

test('createDeliverable refuses bad input and another actor with no mutation', async () => {
  const { fake, projects } = await epicSetup()
  await assert.rejects(projects.createDeliverable({ title: '' }, 'octocat'), { code: 'INVALID_INPUT' })
  await assert.rejects(projects.createDeliverable({ title: 'A', start: 'soon' }, 'octocat'), { code: 'INVALID_INPUT' })
  await assert.rejects(projects.createDeliverable({ title: 'A', colour: 'red' }, 'octocat'), { code: 'INVALID_INPUT' })
  await assert.rejects(projects.createDeliverable({ title: 'A' }, 'someone'), { code: 'INVALID_INPUT' })
  assert.deepEqual(fake.mutations, [])
})

test('a dry run of createDeliverable sends nothing', async () => {
  const { fake, projects } = await epicSetup()
  const { after } = await projects.createDeliverable({ title: 'Launch', start: '2026-12-01' }, 'octocat', { dryRun: true })
  assert.equal(after.status.name, 'Inactive')
  assert.deepEqual(fake.mutations, [])
})

test('publishStatusUpdate sends the upper-case status and copies the dates of the latest update', async () => {
  const { fake, projects } = await epicSetup()
  await projects.createDeliverable({ title: 'Launch', start: '2026-12-01', target: '2027-01-31' }, 'octocat')
  fake.mutations.splice(0)
  const { after } = await projects.publishStatusUpdate({ epic: 'acme/31', health: 'on_track', body: ' Going well ' }, 'octocat')
  assert.equal(after.health, 'on_track')
  assert.equal(after.body, 'Going well')
  assert.equal(fake.mutations.length, 1)
  assert.deepEqual({ ...fake.mutations[0].input, projectId: undefined }, { status: 'ON_TRACK', body: 'Going well', startDate: '2026-12-01', targetDate: '2027-01-31', projectId: undefined })
})

test('after an INACTIVE first update with dates and a new update, epic get shows the same dates', async () => {
  const { fake, projects } = await epicSetup()
  await projects.createDeliverable({ title: 'Launch', start: '2026-12-01', target: '2027-01-31' }, 'octocat')
  fake.seedStatusUpdate('PVT_E12', { status: 'INACTIVE', startDate: '2026-12-01', targetDate: '2027-01-31', createdAt: '2026-11-01T00:00:00Z' })
  await projects.publishStatusUpdate({ epic: 'acme/12', health: 'at_risk', body: 'Late' }, 'octocat')
  const epic = await projects.getDeliverable('acme/12')
  assert.equal(epic.start, '2026-12-01')
  assert.equal(epic.target, '2027-01-31')
  assert.equal(epic.health, 'at_risk')
})

test('publishStatusUpdate on an epic without updates sends no dates', async () => {
  const { fake, projects } = await epicSetup()
  await projects.publishStatusUpdate({ epic: 'acme/12', health: 'off_track', body: 'Bad' }, 'octocat')
  assert.deepEqual(Object.keys(fake.mutations[0].input).sort(), ['body', 'projectId', 'status'])
})

test('publishStatusUpdate refuses a bad health and an empty body, and an unknown epic is NOT_FOUND, all before a write', async () => {
  const { fake, projects } = await epicSetup()
  await assert.rejects(projects.publishStatusUpdate({ epic: 'acme/12', health: 'great', body: 'x' }, 'octocat'), { code: 'INVALID_INPUT' })
  await assert.rejects(projects.publishStatusUpdate({ epic: 'acme/12', health: 'on_track', body: '  ' }, 'octocat'), { code: 'INVALID_INPUT' })
  await assert.rejects(projects.publishStatusUpdate({ epic: 'acme/99', health: 'on_track', body: 'x' }, 'octocat'), { code: 'NOT_FOUND' })
  await assert.rejects(projects.publishStatusUpdate({ epic: 'acme/7', health: 'on_track', body: 'x' }, 'octocat'), { code: 'NOT_FOUND' })
  assert.deepEqual(fake.mutations, [])
})

test('a dry run of publishStatusUpdate sends nothing', async () => {
  const { fake, projects } = await epicSetup()
  const { after } = await projects.publishStatusUpdate({ epic: 'acme/12', health: 'on_track', body: 'x' }, 'octocat', { dryRun: true })
  assert.equal(after.epic, 'acme/12')
  assert.deepEqual(fake.mutations, [])
})

test('listStatusUpdates is newest first, with health or status', async () => {
  const { fake, projects } = await epicSetup()
  fake.seedStatusUpdate('PVT_E12', { status: 'INACTIVE', body: 'First', createdAt: '2026-11-01T00:00:00Z' })
  fake.seedStatusUpdate('PVT_E12', { status: 'ON_TRACK', body: 'Second', createdAt: '2026-11-05T00:00:00Z', creator: 'hubot' })
  fake.seedStatusUpdate('PVT_E12', { status: 'COMPLETE', body: 'Third', createdAt: '2026-11-09T00:00:00Z' })
  const list = await projects.listStatusUpdates('acme/12')
  assert.deepEqual(list.map((item) => item.body), ['Third', 'Second', 'First'])
  assert.deepEqual(list[0], { epic: 'acme/12', at: '2026-11-09T00:00:00Z', author: 'octocat', status: 'complete', body: 'Third' })
  assert.equal(list[1].health, 'on_track')
  assert.equal(list[1].author, 'hubot')
  await assert.rejects(projects.listStatusUpdates('acme/30'), { code: 'NOT_FOUND' })
})
