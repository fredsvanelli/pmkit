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
  assert.deepEqual(fake.reads[0].variables.orderBy, { field: 'CREATED_AT', direction: 'ASC' })
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

// Writes. The fake's Project has Status, a four-option Priority and a Due date; estimate maps to the issue field Effort.
const STATUS_OPTIONS = ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done']
const WRITE_FIELDS = [
  { __typename: 'ProjectV2Field', id: 'PF_0', name: 'Title', dataType: 'TITLE', isIssueField: false },
  { __typename: 'ProjectV2SingleSelectField', id: 'PF_1', name: 'Status', dataType: 'SINGLE_SELECT', isIssueField: false, options: STATUS_OPTIONS.map((name, index) => ({ id: `S${index}`, name })) },
  { __typename: 'ProjectV2SingleSelectField', id: 'PF_3', name: 'Priority', dataType: 'SINGLE_SELECT', isIssueField: false, options: ['P0', 'P1', 'P2', 'P3'].map((name, index) => ({ id: `P${index}`, name })) },
  { __typename: 'ProjectV2Field', id: 'PF_5', name: 'Due', dataType: 'DATE', isIssueField: false },
]
const WRITE_PMKIT = {
  tracker: { system: 'github', scope: { host: 'github.com', repo: 'acme/widgets', project: 'acme/7' } },
  mappings: {
    status: { backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress', done: 'Done', canceled: 'none' },
    types: { bug: 'Bug', task: 'Task' },
    fields: { priority: 'project:Priority', estimate: 'issue:Effort', target_date: 'none' },
  },
}
const NO_PROJECT = { ...WRITE_PMKIT, tracker: { ...WRITE_PMKIT.tracker, scope: { ...WRITE_PMKIT.tracker.scope, project: 'none' } }, mappings: { types: WRITE_PMKIT.mappings.types } }
const ME = 'octocat'

async function writeSetup({ pmkit = WRITE_PMKIT, project = { fields: WRITE_FIELDS }, ...options } = {}) {
  const fake = fakeGithubIssues({ project, ...options })
  const client = createGithubClient({ exec: fake.exec, retries: 0, sleep: async () => {} })
  const scopeProject = project === null ? 'none' : 'acme/7'
  const refreshes = []
  const discover = async () => makeContext(await fetchDiscovery(client, { host: 'github.com', repo: 'acme/widgets', project: scopeProject, exec: fake.exec, users: true }), pmkit)
  let context = await discover()
  const getContext = async ({ refresh = false } = {}) => {
    if (refresh) {
      refreshes.push(true)
      context = await discover()
    }
    return context
  }
  fake.reads.splice(0)
  const ops = issueOperations({ client, config: { pmkit }, getContext })
  return { fake, ops, refreshes }
}
const sent = (fake) => fake.mutations.map((call) => call.name)

test('createIssue sends the create, the item, the field write and the Status, then reads in_progress back', async () => {
  const { fake, ops } = await writeSetup()
  const input = { title: 'A', type: 'bug', labels: ['bug'], acceptanceCriteria: [{ text: 'x', done: false }], priority: 'high', status: 'In Progress' }
  const dry = await ops.createIssue(input, ME, { dryRun: true })
  assert.deepEqual(fake.mutations, [])
  assert.equal(dry.before, null)
  assert.equal(dry.after.id, null)
  assert.deepEqual(dry.after.status, { name: 'In Progress', category: 'in_progress' })
  const result = await ops.createIssue(input, ME)
  assert.deepEqual(sent(fake), ['PmkitCreateIssue', 'PmkitAddProjectItem', 'PmkitSetProjectField', 'PmkitSetProjectField'])
  assert.deepEqual(fake.mutations[2].input.value, { singleSelectOptionId: 'P1' })
  assert.deepEqual(fake.mutations[3].input.value, { singleSelectOptionId: 'S2' })
  assert.equal(result.before, null)
  assert.equal(result.after.id, '1')
  assert.equal(result.after.type, 'bug')
  assert.equal(result.after.priority, 'high')
  assert.deepEqual(result.after.status, { name: 'In Progress', category: 'in_progress' })
  assert.deepEqual(result.after.acceptanceCriteria, [{ text: 'x', done: false }])
  assert.deepEqual({ ...dry.after, id: '1', created: null, updated: null }, { ...result.after, created: null, updated: null })
})

test('createIssue writes an issue field with setIssueFieldValue and closes for done', async () => {
  const { fake, ops } = await writeSetup()
  const result = await ops.createIssue({ title: 'B', estimate: 5, status: 'Done' }, ME)
  assert.deepEqual(sent(fake), ['PmkitCreateIssue', 'PmkitAddProjectItem', 'PmkitSetIssueField', 'PmkitSetProjectField', 'PmkitCloseIssue'])
  assert.deepEqual(fake.mutations[2].input, { issueId: 'I_1', issueFields: [{ fieldId: 'IF_2', numberValue: 5 }] })
  assert.equal(result.after.estimate, 5)
  assert.deepEqual(result.after.status, { name: 'Done', category: 'done' })
})

test('a failure after the create throws UPSTREAM naming the new issue', async () => {
  const { fake, ops } = await writeSetup()
  fake.failNext('PmkitSetProjectField')
  await assert.rejects(ops.createIssue({ title: 'A', priority: 'high' }, ME), (error) =>
    error.code === 'UPSTREAM' && error.message.startsWith('GitHub created issue 1, but') && error.nextStep === 'pmkit issues get 1, then repeat the step that failed')
})

test('createIssue in a repository with no Project sends only the create', async () => {
  const { fake, ops } = await writeSetup({ project: null, pmkit: NO_PROJECT })
  const result = await ops.createIssue({ title: 'Plain' }, ME)
  assert.deepEqual(sent(fake), ['PmkitCreateIssue'])
  assert.deepEqual(result.after.status, { name: 'Open', category: 'todo' })
})

test('updateIssue with no change sends nothing', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({ title: 'Same', labels: ['bug'], item: { status: 'Todo', values: { Priority: 'P1' } } })
  const result = await ops.updateIssue('1', { title: 'Same', labels: ['bug'], priority: 'high' }, ME)
  assert.deepEqual(fake.mutations, [])
  assert.deepEqual(result.after, result.before)
})

test('updateIssue sends the update for its own keys and clears a Project field for null', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({ title: 'Old', item: { status: 'Todo', values: { Priority: 'P1' } } })
  const dry = await ops.updateIssue('1', { title: 'New', priority: null }, ME, { dryRun: true })
  assert.deepEqual(fake.mutations, [])
  assert.equal(dry.after.title, 'New')
  const result = await ops.updateIssue('1', { title: 'New', priority: null }, ME)
  assert.deepEqual(sent(fake), ['PmkitUpdateIssue', 'PmkitClearProjectField'])
  assert.deepEqual(fake.mutations[1].input, { projectId: 'PVT_1', itemId: 'PVTI_1', fieldId: 'PF_3' })
  assert.equal(result.before.priority, 'high')
  assert.equal('priority' in result.after, false)
  assert.equal(result.after.title, 'New')
})

test('updateIssue refuses sprint, a field mapped none and an issue of another repository', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({})
  fake.seed({ repo: 'acme/other', number: 5 })
  await assert.rejects(ops.updateIssue('1', { sprint: 'x' }, ME), { code: 'NOT_SUPPORTED' })
  await assert.rejects(ops.updateIssue('1', { due: '2026-12-01' }, ME), { code: 'NOT_SUPPORTED' })
  await assert.rejects(ops.updateIssue('acme/other#5', { title: 'X' }, ME), { code: 'INVALID_INPUT', message: 'pmkit writes issues of acme/widgets only' })
  assert.deepEqual(fake.mutations, [])
})

test('an unknown label refreshes the discovery once, then fails with INVALID_INPUT', async () => {
  const { fake, ops, refreshes } = await writeSetup()
  fake.seed({})
  await assert.rejects(ops.updateIssue('1', { labels: ['nope'] }, ME), (error) =>
    error.code === 'INVALID_INPUT' && error.nextStep === 'Create the label on GitHub, then run pmkit discover')
  assert.equal(refreshes.length, 1)
  assert.deepEqual(fake.mutations, [])
})

test('a branch equal to the linked branch sends nothing', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({ branches: ['1-a'] })
  const result = await ops.updateIssue('1', { branch: '1-a' }, ME, { base: 'develop' })
  assert.deepEqual(fake.mutations, [])
  assert.deepEqual(names(fake), ['PmkitIssue'])
  assert.deepEqual(result.after, result.before)
})

test('a new branch starts at the GitHub head of the base, never at the GitHub default branch', async () => {
  const develop = 'd'.repeat(40)
  const pmkit = { ...WRITE_PMKIT, git_host: { system: 'github', repo: 'acme/widgets', default_branch: 'develop' } }
  const { fake, ops } = await writeSetup({ pmkit, branches: { main: 'a'.repeat(40), develop } })
  fake.seed({})
  const dry = await ops.updateIssue('1', { branch: '1-a' }, ME, { dryRun: true, base: 'develop' })
  assert.deepEqual(fake.mutations, [])
  assert.equal(dry.after.branch, '1-a')
  const result = await ops.updateIssue('1', { branch: '1-a' }, ME, { base: 'develop' })
  const head = fake.reads.filter((call) => call.name === 'PmkitBranchHead')
  assert.equal(head.at(-1).variables.qualifiedName, 'refs/heads/develop')
  assert.deepEqual(sent(fake), ['PmkitCreateLinkedBranch'])
  assert.deepEqual(fake.mutations[0].input, { issueId: 'I_1', repositoryId: 'R_1', name: '1-a', oid: develop })
  assert.equal(result.after.branch, '1-a')
  assert.equal(result.notes, undefined)
  // Without a base, pmkit's default branch (develop here) is the start, not GitHub's main.
  fake.seed({})
  await ops.updateIssue('2', { branch: '2-b' }, ME)
  assert.equal(fake.mutations.at(-1).input.oid, develop)
})

test('a base GitHub lacks falls back to the default branch with a note', async () => {
  const main = 'b'.repeat(40)
  const { fake, ops } = await writeSetup({ branches: { main } })
  fake.seed({})
  const result = await ops.updateIssue('1', { branch: '1-a' }, ME, { base: 'feature' })
  assert.equal(fake.mutations[0].input.oid, main)
  assert.deepEqual(result.notes, ['GitHub has no branch feature, so pmkit linked 1-a at the head of main there'])
})

test('no branch on GitHub at all fails with INVALID_INPUT and the push step', async () => {
  const { fake, ops } = await writeSetup({ branches: {} })
  fake.seed({})
  await assert.rejects(ops.updateIssue('1', { branch: '1-a' }, ME, { base: 'feature' }), {
    code: 'INVALID_INPUT', message: 'GitHub has no branch main to start 1-a from', nextStep: 'Push main to origin, or pass --from <a branch on GitHub>',
  })
  assert.deepEqual(fake.mutations, [])
})

test('a second, different branch name fails with INVALID_INPUT', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({ branches: ['1-a'] })
  await assert.rejects(ops.updateIssue('1', { branch: '1-other' }, ME), { code: 'INVALID_INPUT', message: 'GitHub links 1 to branch 1-a already' })
  assert.deepEqual(fake.mutations, [])
})

test('moveToCategory done sets the option, then closes as completed', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({ item: { status: 'Todo' } })
  const dry = await ops.moveToCategory('1', 'done', ME, { dryRun: true })
  assert.deepEqual(fake.mutations, [])
  assert.deepEqual(dry.after.status, { name: 'Done', category: 'done' })
  const result = await ops.moveToCategory('1', 'done', ME)
  assert.deepEqual(sent(fake), ['PmkitSetProjectField', 'PmkitCloseIssue'])
  assert.deepEqual(fake.mutations[0].input, { projectId: 'PVT_1', itemId: 'PVTI_1', fieldId: 'PF_1', value: { singleSelectOptionId: 'S4' } })
  assert.equal(fake.mutations[1].input.stateReason, 'COMPLETED')
  assert.deepEqual(result.before.status, { name: 'Todo', category: 'todo' })
  assert.deepEqual(result.after.status, { name: 'Done', category: 'done' })
})

test('moveToCategory canceled mapped none closes as not planned and keeps the option', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({ item: { status: 'In Progress' } })
  const result = await ops.moveToCategory('1', 'canceled', ME)
  assert.deepEqual(sent(fake), ['PmkitCloseIssue'])
  assert.equal(fake.mutations[0].input.stateReason, 'NOT_PLANNED')
  assert.deepEqual(result.after.status, { name: 'In Progress', category: 'canceled' })
})

test('moveToCategory to an unmapped category fails with NOT_SUPPORTED', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({ item: { status: 'Todo' } })
  await assert.rejects(ops.moveToCategory('1', 'in_review', ME), { code: 'NOT_SUPPORTED', message: 'no Status option of acme/7 stands for in_review', nextStep: '/pmkit:setup' })
  assert.deepEqual(fake.mutations, [])
})

test('moveToCategory adds an issue with no item to the Project first', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({})
  const result = await ops.moveToCategory('1', 'in_progress', ME)
  assert.deepEqual(sent(fake), ['PmkitAddProjectItem', 'PmkitSetProjectField'])
  assert.deepEqual(result.before.status, { name: 'Open', category: 'todo' })
  assert.deepEqual(result.after.status, { name: 'In Progress', category: 'in_progress' })
})

test('moveToCategory from done to canceled reopens, then closes as not planned', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({ state: 'CLOSED', stateReason: 'COMPLETED', item: { status: 'Done' } })
  const result = await ops.moveToCategory('1', 'canceled', ME)
  assert.deepEqual(sent(fake), ['PmkitReopenIssue', 'PmkitCloseIssue'])
  assert.equal(fake.mutations[1].input.stateReason, 'NOT_PLANNED')
  assert.equal(result.after.status.category, 'canceled')
})

test('moveToCategory to where the issue is sends nothing', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({ item: { status: 'In Progress' } })
  const result = await ops.moveToCategory('1', 'in_progress', ME)
  assert.deepEqual(fake.mutations, [])
  assert.deepEqual(result.after, result.before)
})

test('moveToCategory with a status of another category fails with INVALID_INPUT', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({ item: { status: 'In Progress' } })
  await assert.rejects(ops.moveToCategory('1', 'done', ME, { status: 'Todo' }), { code: 'INVALID_INPUT', message: 'status Todo is not in category done' })
  assert.deepEqual(fake.mutations, [])
})

test('moveToCategory without a Project refuses in_progress and closes for done', async () => {
  const { fake, ops } = await writeSetup({ project: null, pmkit: NO_PROJECT })
  fake.seed({})
  await assert.rejects(ops.moveToCategory('1', 'in_progress', ME), { code: 'NOT_SUPPORTED', message: 'tracker.scope.project is none, so issues have no status but open and closed' })
  const result = await ops.moveToCategory('1', 'done', ME)
  assert.deepEqual(sent(fake), ['PmkitCloseIssue'])
  assert.deepEqual(result.after.status, { name: 'Closed', category: 'done' })
})

test('a move that fails after its first mutation names what changed and what did not', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({ item: { status: 'Todo' } })
  fake.failNext('PmkitCloseIssue')
  await assert.rejects(ops.moveToCategory('1', 'done', ME), (error) =>
    error.code === 'UPSTREAM' && error.message.startsWith('GitHub set the Status of 1 to Done, but closing it as completed failed:') && error.nextStep === 'pmkit issues get 1, then repeat the step that failed')
})

test('assign me assigns the viewer, null unassigns everyone', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({ assignees: ['hubot'] })
  const result = await ops.assign('1', 'me', ME)
  assert.deepEqual(fake.mutations[0].input, { id: 'I_1', assigneeIds: ['U_1'] })
  assert.equal(result.after.assignee, 'octocat')
  fake.mutations.splice(0)
  const again = await ops.assign('1', 'octocat', ME)
  assert.deepEqual(fake.mutations, [])
  assert.deepEqual(again.after, again.before)
  const cleared = await ops.assign('1', null, ME)
  assert.deepEqual(fake.mutations[0].input, { id: 'I_1', assigneeIds: [] })
  assert.equal('assignee' in cleared.after, false)
})

test('assign of an unknown login refreshes once, then fails with INVALID_INPUT', async () => {
  const { fake, ops, refreshes } = await writeSetup()
  fake.seed({})
  await assert.rejects(ops.assign('1', 'ghost', ME), { code: 'INVALID_INPUT' })
  assert.equal(refreshes.length, 1)
  assert.deepEqual(fake.mutations, [])
})

test('archive archives the Project item, refuses an issue with no item and a repository with no Project', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({ item: { status: 'Todo' } })
  fake.seed({})
  const dry = await ops.archive('1', ME, { dryRun: true })
  assert.deepEqual(fake.mutations, [])
  assert.equal(dry.after.archived, true)
  const result = await ops.archive('1', ME)
  assert.deepEqual(sent(fake), ['PmkitArchiveItem'])
  assert.deepEqual(fake.mutations[0].input, { projectId: 'PVT_1', itemId: 'PVTI_1' })
  assert.equal(result.after.archived, true)
  await assert.rejects(ops.archive('2', ME), { code: 'INVALID_INPUT', message: '2 is not in acme/7', nextStep: 'pmkit issues move 2 <category> adds it' })
  const bare = await writeSetup({ project: null, pmkit: NO_PROJECT })
  bare.fake.seed({})
  await assert.rejects(bare.ops.archive('1', ME), (error) => error.code === 'NOT_SUPPORTED' && error.nextStep === 'Set tracker.scope.project with /pmkit:setup')
})

test('delete refuses with CONFLICT while the issue blocks another, then deletes', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({ title: 'Blocker' })
  fake.seed({ title: 'Blocked', blockedBy: [1] })
  await assert.rejects(ops.delete('1', ME, { dryRun: true }), (error) => error.code === 'CONFLICT' && error.message.includes('2 (blockedBy)'))
  await assert.rejects(ops.delete('1', ME), { code: 'CONFLICT' })
  assert.deepEqual(fake.mutations, [])
  const dry = await ops.delete('2', ME, { dryRun: true })
  assert.deepEqual(fake.mutations, [])
  assert.equal(dry.after, null)
  assert.equal(dry.before.id, '2')
  const result = await ops.delete('2', ME)
  assert.deepEqual(sent(fake), ['PmkitDeleteIssue'])
  assert.deepEqual(fake.mutations[0].input, { issueId: 'I_2' })
  assert.equal(result.after, null)
  await assert.rejects(ops.getIssue('2'), { code: 'NOT_FOUND' })
})

test('every write by an actor other than the gh login fails with INVALID_INPUT', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({ item: { status: 'Todo' } })
  const refused = { code: 'INVALID_INPUT', message: 'GitHub records every write as the gh login (octocat)', nextStep: 'Drop --as, or log gh in as that user' }
  await assert.rejects(ops.requireActor('fred'), refused)
  await assert.rejects(ops.createIssue({ title: 'A' }, 'fred'), refused)
  await assert.rejects(ops.updateIssue('1', { title: 'B' }, 'fred'), refused)
  await assert.rejects(ops.moveToCategory('1', 'done', 'fred'), refused)
  await assert.rejects(ops.assign('1', null, 'fred'), refused)
  await assert.rejects(ops.archive('1', 'fred'), refused)
  await assert.rejects(ops.delete('1', 'fred'), refused)
  assert.deepEqual(fake.mutations, [])
})

test('an update that fails after its first mutation names what changed', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({ title: 'Old', item: { status: 'Todo' } })
  fake.failNext('PmkitSetProjectField')
  await assert.rejects(ops.updateIssue('1', { title: 'New', priority: 'low' }, ME), (error) =>
    error.code === 'UPSTREAM' && error.message.startsWith('GitHub updated 1, but writing its priority failed:') && error.nextStep === 'pmkit issues get 1, then repeat the step that failed')
})

test('an update whose first mutation fails keeps the client error', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({ title: 'Old' })
  fake.failNext('PmkitUpdateIssue')
  await assert.rejects(ops.updateIssue('1', { title: 'New' }, ME), (error) => error.code === 'UPSTREAM' && !error.message.startsWith('GitHub updated'))
})

test('a null payload after the create still throws UPSTREAM naming the new issue', async () => {
  const { fake, ops } = await writeSetup()
  fake.failNext('PmkitAddProjectItem', { data: { addProjectV2ItemById: null } })
  await assert.rejects(ops.createIssue({ title: 'A' }, ME), (error) =>
    error.code === 'UPSTREAM' && error.message.startsWith('GitHub created issue 1, but adding it to acme/7 failed:') && error.details.cause === 'TypeError')
})

test('moveToCategory canceled keeps an issue closed as a duplicate', async () => {
  const { fake, ops } = await writeSetup()
  fake.seed({ title: 'Canonical' })
  fake.seed({ state: 'CLOSED', stateReason: 'DUPLICATE', duplicateOf: 1 })
  const result = await ops.moveToCategory('2', 'canceled', ME)
  assert.deepEqual(fake.mutations, [])
  assert.deepEqual(result.after, result.before)
})
