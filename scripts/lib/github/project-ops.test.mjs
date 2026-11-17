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
