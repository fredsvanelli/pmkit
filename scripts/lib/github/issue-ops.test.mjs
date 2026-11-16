// The read operations of the GitHub adapter against the stateful fake GitHub, through the real client.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeGithubIssues } from '../../fake-github-issues.mjs'
import { createGithubClient } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { issueOperations } from './issue-ops.mjs'
import { makeContext } from './issues.mjs'

const PMKIT = {
  tracker: { system: 'github', scope: { host: 'github.com', repo: 'acme/widgets', project: 'acme/7' } },
  mappings: { status: { backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress', in_review: 'In Review', done: 'Done' }, types: { bug: 'Bug', task: 'Task' } },
}

// The context comes from a real discovery of the fake; the reads it sends are cleared before the test runs.
async function setup(options = {}) {
  const fake = fakeGithubIssues(options)
  const client = createGithubClient({ exec: fake.exec, retries: 0, sleep: async () => {} })
  const raw = await fetchDiscovery(client, { host: 'github.com', repo: 'acme/widgets', project: 'acme/7', exec: fake.exec, users: true })
  const context = makeContext(raw, PMKIT)
  fake.reads.splice(0)
  const ops = issueOperations({ client, config: { pmkit: PMKIT }, getContext: async () => context })
  return { fake, ops }
}
const names = (fake) => fake.reads.map((call) => call.name)

test('getIssue maps an issue of the scope repository', async () => {
  const { fake, ops } = await setup()
  fake.seed({ title: 'First', labels: ['bug'], assignees: ['hubot'], type: 'Bug', item: { status: 'In Progress' } })
  const issue = await ops.getIssue('#1')
  assert.equal(issue.id, '1')
  assert.equal(issue.title, 'First')
  assert.equal(issue.type, 'bug')
  assert.equal(issue.assignee, 'hubot')
  assert.deepEqual(issue.status, { name: 'In Progress', category: 'in_progress' })
  assert.deepEqual(fake.reads[0].variables, { owner: 'acme', name: 'widgets', number: 1, fStatus: 'Status' })
})

test('getIssue of a missing number throws NOT_FOUND with the pmkit message', async () => {
  const { ops } = await setup()
  await assert.rejects(ops.getIssue('99'), { code: 'NOT_FOUND', message: 'issue 99 does not exist' })
})

test('getIssue of a malformed id throws NOT_FOUND before any request', async () => {
  const { fake, ops } = await setup()
  await assert.rejects(ops.getIssue('ISS-1'), { code: 'NOT_FOUND', message: 'issue ISS-1 does not exist' })
  assert.deepEqual(fake.reads, [])
})

test('getIssue reads another repository through its own owner and name, and returns the canonical id', async () => {
  const { fake, ops } = await setup()
  fake.seed({ repo: 'acme/other', number: 5, title: 'Elsewhere' })
  const issue = await ops.getIssue('ACME/Other#5')
  assert.equal(issue.id, 'acme/other#5')
  assert.equal(issue.title, 'Elsewhere')
  assert.deepEqual([fake.reads[0].variables.owner, fake.reads[0].variables.name], ['ACME', 'Other'])
  await assert.rejects(ops.getIssue('acme/other#6'), { code: 'NOT_FOUND', message: 'issue acme/other#6 does not exist' })
})

test('readNode returns the node and the issue, with every nested page read', async () => {
  const { fake, ops } = await setup()
  fake.seed({ number: 1, title: 'Parent' })
  for (let index = 0; index < 55; index += 1) fake.seed({ parent: 1, blockedBy: [] })
  const { node, issue } = await ops.readNode('1')
  assert.equal(node.id, 'I_1')
  assert.equal(node.subIssues.nodes.length, 55)
  assert.equal(issue.children.length, 55)
  assert.equal(issue.children.at(-1), '56')
  assert.deepEqual(names(fake), ['PmkitIssue', 'PmkitIssueMore_subIssues'])
})

test('a blockedBy list longer than a page is read in full, with the Status variable', async () => {
  const { fake, ops } = await setup()
  for (let index = 0; index < 52; index += 1) fake.seed({ state: 'CLOSED', stateReason: 'COMPLETED' })
  fake.seed({ number: 60, blockedBy: Array.from({ length: 52 }, (_, index) => index + 1) })
  const issue = await ops.getIssue('60')
  assert.equal(issue.blockedBy.length, 52)
  const more = fake.reads.find((call) => call.name === 'PmkitIssueMore_blockedBy')
  assert.equal(more.variables.fStatus, 'Status')
})

test('a search returns issues oldest first', async () => {
  const { fake, ops } = await setup()
  fake.seed({ number: 1, title: 'Newer', createdAt: '2026-03-01T00:00:00.000Z' })
  fake.seed({ number: 2, title: 'Older', createdAt: '2026-01-01T00:00:00.000Z' })
  const result = await ops.searchIssues({})
  assert.deepEqual(result.issues.map((issue) => issue.id), ['2', '1'])
  assert.deepEqual(result.problems, [])
  assert.equal(result.hasMore, false)
})

test('archived items drop out of a search unless archived is true', async () => {
  const { fake, ops } = await setup()
  fake.seed({ title: 'Live', item: { status: 'Todo' } })
  fake.seed({ title: 'Gone', item: { status: 'Todo', archived: true } })
  assert.deepEqual((await ops.searchIssues({})).issues.map((issue) => issue.id), ['1'])
  assert.deepEqual((await ops.searchIssues({ archived: true })).issues.map((issue) => issue.id), ['1', '2'])
})

test('blocked true keeps only issues with an open blocker', async () => {
  const { fake, ops } = await setup()
  fake.seed({ number: 1, title: 'Open blocker' })
  fake.seed({ number: 2, title: 'Closed blocker', state: 'CLOSED', stateReason: 'COMPLETED' })
  fake.seed({ number: 3, title: 'Blocked', blockedBy: [1] })
  fake.seed({ number: 4, title: 'Free', blockedBy: [2] })
  assert.deepEqual((await ops.searchIssues({ blocked: true })).issues.map((issue) => issue.id), ['3'])
  assert.deepEqual((await ops.searchIssues({ blocked: false })).issues.map((issue) => issue.id), ['1', '2', '4'])
})

test('a search sends filterBy and applies the sort and the limit', async () => {
  const { fake, ops } = await setup()
  fake.seed({ number: 1, title: 'A', assignees: ['octocat'] })
  fake.seed({ number: 2, title: 'B', assignees: ['octocat'], state: 'CLOSED', stateReason: 'COMPLETED' })
  fake.seed({ number: 3, title: 'C', assignees: ['octocat'] })
  const result = await ops.searchIssues({ assignee: 'me', categories: ['todo'], limit: 1, sort: 'updated' })
  assert.deepEqual(result.issues.map((issue) => issue.id), ['3'])
  assert.deepEqual(fake.reads[0].variables.filterBy, { states: ['OPEN'], assignee: 'octocat' })
})

test('an empty categories list and limit 0 send no request', async () => {
  const { fake, ops } = await setup()
  assert.deepEqual(await ops.searchIssues({ categories: [] }), { issues: [], problems: [], hasMore: false })
  assert.deepEqual(await ops.searchIssues({ limit: 0 }), { issues: [], problems: [], hasMore: false })
  assert.deepEqual(fake.reads, [])
})

test('a bad filter fails with INVALID_INPUT, sprint with NOT_SUPPORTED', async () => {
  const { ops } = await setup()
  await assert.rejects(ops.searchIssues({ assignee: 'stranger' }), { code: 'INVALID_INPUT' })
  await assert.rejects(ops.searchIssues({ types: ['epic'] }), { code: 'INVALID_INPUT' })
  await assert.rejects(ops.searchIssues({ sprint: '3' }), { code: 'NOT_SUPPORTED' })
})

test('a search completes the nested pages of each node that needs it', async () => {
  const { fake, ops } = await setup()
  fake.seed({ number: 1, title: 'Parent' })
  for (let index = 0; index < 51; index += 1) fake.seed({ parent: 1 })
  const { issues } = await ops.searchIssues({ archived: true, limit: 1 })
  assert.equal(issues[0].children.length, 51)
  assert.deepEqual(names(fake), ['PmkitIssues', 'PmkitIssueMore_subIssues'])
})

test('120 issues read in two pages with hasMore false', async () => {
  const { fake, ops } = await setup()
  for (let index = 0; index < 120; index += 1) fake.seed({})
  const result = await ops.searchIssues({})
  assert.equal(result.issues.length, 120)
  assert.equal(result.hasMore, false)
  assert.deepEqual(names(fake), ['PmkitIssues', 'PmkitIssues'])
})

test('the cap of 10 pages stops the read with hasMore true', async () => {
  const { fake, ops } = await setup()
  for (let index = 0; index < 1001; index += 1) fake.seed({})
  const result = await ops.searchIssues({})
  assert.equal(result.issues.length, 1000)
  assert.equal(result.hasMore, true)
  assert.equal(names(fake).length, 10)
})

test('with the created sort, a search stops reading once limit issues passed every step', async () => {
  const { fake, ops } = await setup()
  for (let index = 0; index < 250; index += 1) fake.seed({ item: { status: 'Todo' } })
  const result = await ops.searchIssues({ limit: 5, sort: 'created' })
  assert.deepEqual(result.issues.map((issue) => issue.id), ['1', '2', '3', '4', '5'])
  assert.equal(result.hasMore, false)
  assert.deepEqual(names(fake), ['PmkitIssues'])
})

test('another sort reads every page up to the cap before the limit', async () => {
  const { fake, ops } = await setup()
  for (let index = 0; index < 250; index += 1) fake.seed({})
  const result = await ops.searchIssues({ limit: 5, sort: 'updated' })
  assert.deepEqual(result.issues.map((issue) => issue.id), ['250', '249', '248', '247', '246'])
  assert.equal(result.hasMore, false)
  assert.deepEqual(names(fake), ['PmkitIssues', 'PmkitIssues', 'PmkitIssues'])
})

test('a search by assignee keeps only issues whose first assignee is that login', async () => {
  const { fake, ops } = await setup()
  fake.seed({ title: 'Both', assignees: ['octocat', 'hubot'] })
  assert.deepEqual((await ops.searchIssues({ assignee: 'hubot' })).issues, [])
  assert.deepEqual((await ops.searchIssues({ assignee: 'octocat' })).issues.map((issue) => issue.id), ['1'])
})
