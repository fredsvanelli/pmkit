// Tests of the stateful fake GitHub: it answers the documents of scripts/lib/github/documents.mjs through the real client.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answerGh, fakeGhExec, repoReply, standardFixture } from './fake-github-api.mjs'
import { fakeGithubIssues, fakeGithubIssuesFrom, TIMELINE_TYPENAMES } from './fake-github-issues.mjs'
import { createGithubClient } from './lib/github/client.mjs'
import { hostFeatures, issueDocuments, ITEM_TYPES } from './lib/github/documents.mjs'

const VARS = { fStatus: 'Status', fEstimate: 'Story points', fDue: 'Due' }
const REPO = { owner: 'acme', name: 'widgets' }

function setup(options = {}) {
  const fake = fakeGithubIssues(options)
  const features = hostFeatures({ host: options.host ?? 'github.com', ghesVersion: options.ghesVersion ?? null })
  const docs = issueDocuments(features, { status: true, estimate: true, due: true })
  const client = createGithubClient({ exec: fake.exec, retries: 0, sleep: async () => {} })
  const create = async (input) => (await client.request(docs.CREATE_ISSUE, { input: { repositoryId: 'R_1', ...input }, ...VARS })).createIssue.issue
  const read = async (number, repo = REPO) => (await client.request(docs.ISSUE, { ...repo, number, ...VARS })).repository.issue
  return { fake, docs, client, create, read, features }
}

test('two created issues get numbers 1 and 2 and read back by PmkitIssue and PmkitIssues', async () => {
  const { fake, docs, client, create, read } = setup()
  const first = await create({ title: 'First', body: 'one', labelIds: ['LA_1'], assigneeIds: ['U_1'], issueTypeId: 'IT_2' })
  await create({ title: 'Second' })
  assert.deepEqual([first.id, first.number, first.state], ['I_1', 1, 'OPEN'])
  const one = await read(1)
  assert.equal(one.title, 'First')
  assert.equal(one.body, 'one')
  assert.deepEqual(one.labels.nodes.map((label) => label.name), ['bug'])
  assert.deepEqual(one.assignees.nodes.map((user) => user.login), ['octocat'])
  assert.equal(one.issueType.name, 'Bug')
  assert.equal(one.repository.nameWithOwner, 'acme/widgets')
  assert.equal(one.author.login, 'octocat')
  assert.ok(one.createdAt < (await read(2)).createdAt)
  const list = await client.request(docs.ISSUES, { ...REPO, first: 10, ...VARS })
  assert.deepEqual(list.repository.issues.nodes.map((node) => node.number), [1, 2])
  assert.deepEqual(fake.mutations.map((call) => call.name), ['PmkitCreateIssue', 'PmkitCreateIssue'])
  assert.ok(fake.reads.some((call) => call.name === 'PmkitIssues'))
})

test('a missing issue answers NOT_FOUND through the client', async () => {
  const { read } = setup()
  await assert.rejects(read(9), (error) => error.code === 'NOT_FOUND')
})

test('closing as NOT_PLANNED sets the state, the reason and a ClosedEvent; filterBy.states narrows', async () => {
  const { docs, client, create, read } = setup()
  await create({ title: 'A' })
  await create({ title: 'B' })
  const closed = (await client.request(docs.CLOSE_ISSUE, { input: { issueId: 'I_1', stateReason: 'NOT_PLANNED' }, ...VARS })).closeIssue.issue
  assert.deepEqual([closed.state, closed.stateReason], ['CLOSED', 'NOT_PLANNED'])
  assert.equal((await read(1)).state, 'CLOSED')
  const open = await client.request(docs.ISSUES, { ...REPO, first: 10, filterBy: { states: ['OPEN'] }, ...VARS })
  assert.deepEqual(open.repository.issues.nodes.map((node) => node.number), [2])
  const timeline = await client.request(docs.TIMELINE, { id: 'I_1', first: 10 })
  assert.deepEqual(timeline.node.timelineItems.nodes.map((item) => [item.__typename, item.stateReason]), [['ClosedEvent', 'NOT_PLANNED']])
})

test('PmkitIssues pages by first and after, and filters by assignee, labels, type and since', async () => {
  const { docs, client, create } = setup()
  await create({ title: 'A', labelIds: ['LA_1'], issueTypeId: 'IT_2' })
  const b = await create({ title: 'B', assigneeIds: ['U_2'] })
  await create({ title: 'C', labelIds: ['LA_2'] })
  const page1 = (await client.request(docs.ISSUES, { ...REPO, first: 1, ...VARS })).repository.issues
  assert.deepEqual(page1.nodes.map((node) => node.number), [1])
  assert.equal(page1.pageInfo.hasNextPage, true)
  const page2 = (await client.request(docs.ISSUES, { ...REPO, first: 1, after: page1.pageInfo.endCursor, ...VARS })).repository.issues
  assert.deepEqual(page2.nodes.map((node) => node.number), [2])
  const all = await client.paginate(docs.ISSUES, { ...REPO, ...VARS }, { pageSize: 1, select: (data) => data.repository.issues })
  assert.deepEqual(all.nodes.map((node) => node.number), [1, 2, 3])
  const numbers = async (filterBy) => (await client.request(docs.ISSUES, { ...REPO, first: 10, filterBy, ...VARS })).repository.issues.nodes.map((node) => node.number)
  assert.deepEqual(await numbers({ assignee: 'hubot' }), [2])
  assert.deepEqual(await numbers({ labels: ['bug', 'documentation'] }), [1, 3])
  assert.deepEqual(await numbers({ type: 'Bug' }), [1])
  assert.deepEqual(await numbers({ since: b.updatedAt }), [2, 3])
})

test('a blocker lists its first 20 Project items, unarchived, with the page info', () => {
  const fake = fakeGithubIssues()
  fake.seed({ number: 1, title: 'Blocker', item: { status: 'Done', archived: true } })
  fake.seed({ number: 2, title: 'Waiting', blockedBy: [1] })
  fake.state.items.push(...Array.from({ length: 25 }, (_, index) => ({ id: `PVTI_X${index}`, projectId: `PVT_X${index}`, issueId: 'I_1', isArchived: false, values: {} })))
  const items = fake.handle('PmkitIssue', { owner: 'acme', name: 'widgets', number: 2 }).data.repository.issue.blockedBy.nodes[0].projectItems
  assert.equal(items.nodes.length, 20)
  assert.equal(items.nodes.some((node) => node.isArchived), false)
  assert.deepEqual(items.pageInfo, { hasNextPage: true, endCursor: '19' })
})

test('a blocker reads on both issues, with the Status of the blocker, and records events on both', async () => {
  const { docs, client, create, read } = setup()
  await create({ title: 'Blocked' })
  await create({ title: 'Blocker' })
  const item = (await client.request(docs.ADD_PROJECT_ITEM, { input: { projectId: 'PVT_1', contentId: 'I_2' } })).addProjectV2ItemById.item
  await client.request(docs.SET_PROJECT_FIELD, { input: { projectId: 'PVT_1', itemId: item.id, fieldId: 'PF_1', value: { singleSelectOptionId: 'S2' } } })
  const added = await client.request(docs.ADD_BLOCKED_BY, { input: { issueId: 'I_1', blockingIssueId: 'I_2' } })
  assert.deepEqual(added.addBlockedBy.blockingIssue, { id: 'I_2', number: 2 })
  const blocked = await read(1)
  assert.deepEqual(blocked.blockedBy.nodes.map((node) => node.number), [2])
  assert.deepEqual(blocked.blockedBy.nodes[0].projectItems.nodes[0].status, { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'In Progress', optionId: 'S2' })
  assert.deepEqual((await read(2)).blocking.nodes.map((node) => node.number), [1])
  const events = async (id) => (await client.request(docs.TIMELINE, { id, first: 10 })).node.timelineItems.nodes.map((node) => node.__typename)
  assert.deepEqual(await events('I_1'), ['BlockedByAddedEvent'])
  assert.deepEqual(await events('I_2'), ['ProjectV2ItemStatusChangedEvent', 'BlockingAddedEvent'])
})

test('Project field aliases resolve by field name; adding an item twice returns the same item', async () => {
  const { docs, client, create, read } = setup()
  await create({ title: 'A' })
  const add = async () => (await client.request(docs.ADD_PROJECT_ITEM, { input: { projectId: 'PVT_1', contentId: 'I_1' } })).addProjectV2ItemById.item.id
  const id = await add()
  assert.equal(await add(), id)
  const set = (fieldId, value) => client.request(docs.SET_PROJECT_FIELD, { input: { projectId: 'PVT_1', itemId: id, fieldId, value } })
  await set('PF_2', { number: 3 })
  await set('PF_5', { date: '2026-12-01' })
  const node = (await read(1)).projectItems.nodes[0]
  assert.equal(node.isArchived, false)
  assert.deepEqual(node.fEstimate, { __typename: 'ProjectV2ItemFieldNumberValue', number: 3 })
  assert.deepEqual(node.fDue, { __typename: 'ProjectV2ItemFieldDateValue', date: '2026-12-01' })
  assert.equal(node.status, null)
  await client.request(docs.CLEAR_PROJECT_FIELD, { input: { projectId: 'PVT_1', itemId: id, fieldId: 'PF_2' } })
  await client.request(docs.ARCHIVE_ITEM, { input: { projectId: 'PVT_1', itemId: id } })
  const after = (await read(1)).projectItems.nodes[0]
  assert.deepEqual([after.fEstimate, after.isArchived], [null, true])
})

test('the timeline of a renamed issue holds the rename, labels, type and comment in order', async () => {
  const { docs, client, create } = setup()
  await create({ title: 'Old', labelIds: ['LA_1'] })
  await client.request(docs.UPDATE_ISSUE, { input: { id: 'I_1', title: 'New', labelIds: ['LA_2'], issueTypeId: 'IT_1' }, ...VARS })
  const comment = await client.request(docs.ADD_COMMENT, { input: { subjectId: 'I_1', body: 'Hello' } })
  assert.equal(comment.addComment.commentEdge.node.id, 'IC_1')
  const items = (await client.request(docs.TIMELINE, { id: 'I_1', first: 20 })).node.timelineItems.nodes
  assert.deepEqual(items.map((item) => item.__typename), ['LabeledEvent', 'RenamedTitleEvent', 'LabeledEvent', 'UnlabeledEvent', 'IssueTypeAddedEvent', 'IssueComment'])
  const rename = items[1]
  assert.deepEqual([rename.previousTitle, rename.currentTitle, rename.actor.login], ['Old', 'New', 'octocat'])
  const sorted = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  assert.deepEqual(sorted, items)
  const since = (await client.request(docs.TIMELINE, { id: 'I_1', first: 20, since: items[5].createdAt, itemTypes: ['ISSUE_COMMENT'] })).node.timelineItems.nodes
  assert.deepEqual(since.map((item) => item.body), ['Hello'])
  const many = await client.request(docs.TIMELINES, { ids: ['I_1'], itemTypes: ['RENAMED_TITLE_EVENT'] })
  assert.deepEqual(many.nodes[0].timelineItems.nodes.map((item) => item.currentTitle), ['New'])
  const comments = (await client.request(docs.COMMENTS, { id: 'I_1', first: 10 })).node.comments.nodes
  assert.deepEqual(comments.map((item) => [item.body, item.author.login, item.isMinimized]), [['Hello', 'octocat', false]])
})

test('sub-issues, duplicates and deletion keep both sides of each link', async () => {
  const { docs, client, create, read } = setup()
  await create({ title: 'Parent' })
  await create({ title: 'Child', parentIssueId: 'I_1' })
  await create({ title: 'Other' })
  assert.equal((await read(2)).parent.number, 1)
  assert.deepEqual((await read(1)).subIssues.nodes.map((node) => node.number), [2])
  await assert.rejects(client.request(docs.ADD_SUB_ISSUE, { input: { issueId: 'I_3', subIssueId: 'I_2' } }))
  await client.request(docs.ADD_SUB_ISSUE, { input: { issueId: 'I_3', subIssueId: 'I_2', replaceParent: true } })
  assert.equal((await read(2)).parent.number, 3)
  assert.deepEqual((await read(1)).subIssues.nodes, [])
  await client.request(docs.CLOSE_ISSUE, { input: { issueId: 'I_1', stateReason: 'DUPLICATE', duplicateIssueId: 'I_3' }, ...VARS })
  const duplicate = await read(1)
  assert.deepEqual([duplicate.stateReason, duplicate.duplicateOf.number], ['DUPLICATE', 3])
  await client.request(docs.UNMARK_DUPLICATE, { input: { duplicateId: 'I_1', canonicalId: 'I_3' } })
  assert.equal((await read(1)).duplicateOf, null)
  await client.request(docs.ADD_BLOCKED_BY, { input: { issueId: 'I_1', blockingIssueId: 'I_3' } })
  await client.request(docs.DELETE_ISSUE, { input: { issueId: 'I_3' } })
  assert.deepEqual([(await read(1)).blockedBy.nodes, (await read(2)).parent], [[], null])
  await assert.rejects(read(3), (error) => error.code === 'NOT_FOUND')
})

test('an unknown node id answers NOT_FOUND with GitHub wording', () => {
  const { fake, docs } = setup()
  const reply = fake.handle('PmkitAddComment', { input: { subjectId: 'I_99', body: 'x' } }, docs.ADD_COMMENT)
  assert.deepEqual(reply.errors, [{ type: 'NOT_FOUND', message: "Could not resolve to a node with the global id of 'I_99'" }])
})

test('a GHES 3.19 fake rejects relatesTo, issueFieldValues and an unknown operation with an untyped error', async () => {
  const github = setup()
  const ghes = setup({ host: 'github.example.com', ghesVersion: '3.19.0' })
  assert.equal(ghes.features.relatesTo, false)
  const reply = ghes.fake.handle('PmkitIssue', { ...REPO, number: 1 }, github.docs.ISSUE)
  assert.deepEqual(reply, { errors: [{ message: "Field 'relatesTo' doesn't exist on type 'Issue'" }] })
  const fields = ghes.fake.handle('PmkitIssue', { ...REPO, number: 1 }, github.docs.ISSUE.replace(/relatesTo\(first: 50\)[^\n]*\n/, ''))
  assert.deepEqual(fields, { errors: [{ message: "Field 'issueFieldValues' doesn't exist on type 'Issue'" }] })
  await assert.rejects(github.client.request('query PmkitNope { viewer { login } }'), (error) => error.code === 'UPSTREAM' && /rejected pmkit's query/.test(error.message))
  await ghes.create({ title: 'A' })
  assert.equal((await ghes.read(1)).title, 'A')
  const item = (await ghes.client.request(ghes.docs.ADD_PROJECT_ITEM, { input: { projectId: 'PVT_1', contentId: 'I_1' } })).addProjectV2ItemById.item
  await ghes.client.request(ghes.docs.SET_PROJECT_FIELD, { input: { projectId: 'PVT_1', itemId: item.id, fieldId: 'PF_1', value: { singleSelectOptionId: 'S1' } } })
  assert.equal((await ghes.read(1)).projectItems.nodes[0].status.name, 'Todo')
  assert.deepEqual((await ghes.client.request(ghes.docs.TIMELINE, { id: 'I_1', first: 10 })).node.timelineItems.nodes, [])
  assert.deepEqual(ghes.fake.handle('PmkitTimeline', { id: 'I_1', first: 10 }, github.docs.TIMELINE).errors[0].message, "No such type ProjectV2ItemStatusChangedEvent, so it can't be a fragment condition")
})

test('issue fields and relatesTo read and write on github.com', async () => {
  const { docs, client, create, read } = setup()
  await create({ title: 'A' })
  await create({ title: 'B' })
  await client.request(docs.SET_ISSUE_FIELD, { input: { issueId: 'I_1', issueFields: [{ fieldId: 'IF_1', singleSelectOptionId: 'O2' }, { fieldId: 'IF_2', numberValue: 5 }, { fieldId: 'IF_4', dateValue: '2026-12-24' }] } })
  await client.request(docs.ADD_RELATES_TO, { input: { issueId: 'I_1', relatedIssueId: 'I_2' } })
  const one = await read(1)
  assert.deepEqual(one.issueFieldValues.nodes, [
    { __typename: 'IssueFieldSingleSelectValue', optionId: 'O2', name: 'P1', field: { id: 'IF_1', name: 'Priority' } },
    { __typename: 'IssueFieldNumberValue', value: 5, field: { id: 'IF_2', name: 'Effort' } },
    { __typename: 'IssueFieldDateValue', value: '2026-12-24', field: { id: 'IF_4', name: 'Target date' } },
  ])
  assert.deepEqual(one.relatesTo.nodes.map((node) => node.number), [2])
  assert.deepEqual((await read(2)).relatesTo.nodes.map((node) => node.number), [1])
  await client.request(docs.SET_ISSUE_FIELD, { input: { issueId: 'I_1', issueFields: [{ fieldId: 'IF_2', delete: true }] } })
  assert.equal((await read(1)).issueFieldValues.nodes.length, 2)
})

test('branch heads answer by qualified name, and createLinkedBranch adds the branch', async () => {
  const { fake, docs, client, create, read } = setup({ branches: { main: 'a'.repeat(40), develop: 'b'.repeat(40) } })
  const head = async (qualifiedName) => (await client.request(docs.BRANCH_HEAD, { ...REPO, qualifiedName })).repository
  assert.deepEqual(await head('refs/heads/develop'), { id: 'R_1', ref: { name: 'develop', target: { oid: 'b'.repeat(40) } } })
  assert.equal((await head('refs/heads/feature')).ref, null)
  await create({ title: 'A' })
  await client.request(docs.CREATE_LINKED_BRANCH, { input: { issueId: 'I_1', repositoryId: 'R_1', name: '1-a', oid: 'b'.repeat(40) } })
  assert.deepEqual((await read(1)).linkedBranches.nodes, [{ ref: { name: '1-a' } }])
  assert.equal(fake.state.repositories[0].branches['1-a'], 'b'.repeat(40))
  fake.seedBranch('develop', 'c'.repeat(40), 'acme/other')
  const other = (await client.request(docs.BRANCH_HEAD, { owner: 'acme', name: 'other', qualifiedName: 'refs/heads/develop' })).repository
  assert.deepEqual(other, { id: 'R_2', ref: { name: 'develop', target: { oid: 'c'.repeat(40) } } })
  assert.equal((await head('refs/heads/develop')).ref.target.oid, 'b'.repeat(40))
})

test('assignable users page, and the repository, Project and linked Projects answer from the state', async () => {
  const { client, fake } = setup()
  const users = await client.paginate('query PmkitAssignableUsers($owner: String!, $name: String!, $first: Int!, $after: String) { repository(owner: $owner, name: $name) { assignableUsers(first: $first, after: $after) { nodes { id login name } pageInfo { hasNextPage endCursor } } } }', REPO, { pageSize: 1, select: (data) => data.repository.assignableUsers })
  assert.deepEqual(users.nodes.map((user) => user.login), ['octocat', 'hubot'])
  const repo = fake.handle('PmkitRepo', REPO, 'query PmkitRepo { x }').data
  assert.deepEqual([repo.viewer.login, repo.viewer.id, repo.repository.id], ['octocat', 'U_1', 'R_1'])
  assert.deepEqual(repo.repository.labels.nodes[0], { id: 'LA_1', name: 'bug' })
  assert.equal(repo.repository.issueTypes.nodes.length, repoReply().data.repository.issueTypes.nodes.length)
  const project = fake.handle('PmkitProject', { owner: 'acme', number: 7 }, 'query PmkitProject { x }').data.repositoryOwner.projectV2
  assert.equal(project.id, 'PVT_1')
  assert.ok(project.fields.nodes.some((field) => field.name === 'Status'))
  assert.deepEqual(fake.handle('PmkitLinkedProjects', REPO, 'query PmkitLinkedProjects { x }').data.repository.projectsV2.nodes.map((node) => node.number), [7])
})

test('seed adds issues of another repository that PmkitIssue reads', async () => {
  const { fake, read } = setup()
  const seeded = fake.seed({ repo: 'acme/other', number: 5, title: 'Elsewhere', state: 'CLOSED', stateReason: 'COMPLETED', labels: ['bug'] })
  assert.equal(seeded.number, 5)
  const other = await read(5, { owner: 'acme', name: 'other' })
  assert.deepEqual([other.title, other.state, other.repository.nameWithOwner], ['Elsewhere', 'CLOSED', 'acme/other'])
  fake.seed({ title: 'Local', item: { status: 'Todo', archived: true } })
  const local = await read(1)
  assert.deepEqual([local.projectItems.nodes[0].status.name, local.projectItems.nodes[0].isArchived], ['Todo', true])
})

test('failNext answers the given error once for that operation', async () => {
  const { fake, create } = setup()
  fake.failNext('PmkitCreateIssue', { errors: [{ type: 'INTERNAL', message: 'boom' }] })
  await assert.rejects(create({ title: 'A' }), /boom/)
  assert.equal((await create({ title: 'A' })).number, 1)
})

test('toJSON round trips through fakeGithubIssuesFrom, and the clock continues', async () => {
  const { fake, create } = setup({ now: '2026-11-16T10:00:00.000Z' })
  const first = await create({ title: 'A' })
  const json = JSON.parse(JSON.stringify(fake.toJSON()))
  const restored = fakeGithubIssuesFrom(json)
  assert.deepEqual(restored.toJSON(), json)
  const client = createGithubClient({ exec: restored.exec, retries: 0 })
  const docs = issueDocuments(hostFeatures({ host: 'github.com' }), { status: true, estimate: true, due: true })
  const second = (await client.request(docs.CREATE_ISSUE, { input: { repositoryId: 'R_1', title: 'B' }, ...VARS })).createIssue.issue
  assert.equal(second.number, 2)
  assert.ok(second.createdAt > first.createdAt)
})

test('answerGh without fixture.issues still answers PmkitRepo from fixture.graphql', () => {
  const fixture = standardFixture()
  const { exec } = fakeGhExec(fixture)
  const answer = exec('gh', ['api', 'graphql', '--include', '--input', '-'], { input: JSON.stringify({ query: 'query PmkitRepo { x }', variables: {} }) })
  assert.equal(answer.status, 0)
  assert.deepEqual(JSON.parse(answer.stdout.split('\r\n\r\n')[1]), repoReply())
  const missing = answerGh(['api', 'graphql'], JSON.stringify({ query: 'query PmkitIssue { x }' }), fixture)
  assert.equal(missing.status, 1)
})

test('answerGh with fixture.issues answers from the fake and writes the new state back', () => {
  const docs = issueDocuments(hostFeatures({ host: 'github.com' }), {})
  const fixture = standardFixture({ issues: fakeGithubIssues().toJSON() })
  const call = (query, variables) => answerGh(['api', 'graphql', '--include', '--input', '-'], JSON.stringify({ query, variables }), fixture)
  assert.equal(call(docs.CREATE_ISSUE, { input: { repositoryId: 'R_1', title: 'A' } }).status, 0)
  const read = call(docs.ISSUE, { ...REPO, number: 1 })
  assert.equal(JSON.parse(read.stdout.split('\r\n\r\n')[1]).data.repository.issue.title, 'A')
  assert.equal(fixture.issues.issues.length, 1)
  assert.equal(JSON.parse(call('query PmkitRepo { x }', REPO).stdout.split('\r\n\r\n')[1]).data.viewer.name, 'The Octocat')
})

test('answerGh with fixture.issues routes POST milestones to the fake and writes the state back; a fixture without issues does not know it', () => {
  const fixture = standardFixture({ issues: fakeGithubIssues({ milestones: [{ title: 'v1.0' }] }).toJSON() })
  const post = (body) => answerGh(['api', '--hostname', 'github.com', '--method', 'POST', 'repos/acme/widgets/milestones', '--include', '--input', '-'], JSON.stringify(body), fixture)
  const created = post({ title: 'v2.0', due_on: '2026-12-31T00:00:00Z' })
  assert.equal(created.status, 0)
  assert.match(created.stdout, /^HTTP\/2\.0 201 Created\r\n/)
  assert.equal(restBody(created).number, 2)
  assert.deepEqual(fixture.issues.milestones.map((milestone) => milestone.title), ['v1.0', 'v2.0'])
  const taken = post({ title: 'v2.0' })
  assert.equal(taken.status, 1)
  assert.match(taken.stdout, /^HTTP\/2\.0 422 /)
  assert.equal(fixture.issues.milestones.length, 2)
  const bare = answerGh(['api', '--method', 'POST', 'repos/acme/widgets/milestones', '--input', '-'], '{"title":"x"}', standardFixture())
  assert.equal(bare.status, 1)
  assert.match(bare.stderr, /unknown api call/)
})

test('itemTypes filters keep every item type of ITEM_TYPES, the Status change event included', async () => {
  const { fake, docs, client, create } = setup()
  const all = ITEM_TYPES(hostFeatures({ host: 'github.com' }))
  assert.deepEqual(Object.keys(TIMELINE_TYPENAMES).sort(), [...all].sort())
  for (const itemType of all) {
    const typename = TIMELINE_TYPENAMES[itemType]
    assert.equal(typename.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase(), itemType)
  }
  await create({ title: 'A' })
  const item = (await client.request(docs.ADD_PROJECT_ITEM, { input: { projectId: 'PVT_1', contentId: 'I_1' } })).addProjectV2ItemById.item
  await client.request(docs.SET_PROJECT_FIELD, { input: { projectId: 'PVT_1', itemId: item.id, fieldId: 'PF_1', value: { singleSelectOptionId: 'S2' } } })
  const items = (await client.request(docs.TIMELINE, { id: 'I_1', first: 10, itemTypes: ['PROJECT_V2_ITEM_STATUS_CHANGED_EVENT'] })).node.timelineItems.nodes
  assert.deepEqual(items.map((node) => [node.__typename, node.previousStatus, node.status]), [['ProjectV2ItemStatusChangedEvent', null, 'In Progress']])
  const filtered = (await client.request(docs.TIMELINE, { id: 'I_1', first: 10, itemTypes: all })).node.timelineItems.nodes
  assert.equal(filtered.length, fake.state.issues[0].timeline.length)
})

test('closing as a duplicate of the same issue twice records one event and keeps updatedAt', async () => {
  const { docs, client, create, read } = setup()
  await create({ title: 'A' })
  await create({ title: 'B' })
  const close = () => client.request(docs.CLOSE_ISSUE, { input: { issueId: 'I_1', stateReason: 'DUPLICATE', duplicateIssueId: 'I_2' }, ...VARS })
  await close()
  const updated = (await read(1)).updatedAt
  await close()
  assert.equal((await read(1)).updatedAt, updated)
  const items = (await client.request(docs.TIMELINE, { id: 'I_1', first: 10 })).node.timelineItems.nodes
  assert.deepEqual(items.map((node) => node.__typename), ['MarkedAsDuplicateEvent', 'ClosedEvent'])
})

test('fake GitHub lists, reads and comments on seeded discussions, and keeps them in toJSON', () => {
  const fake = fakeGithubIssues()
  const first = fake.seedDiscussion({ title: 'RFC: plugins', body: 'Should we?', category: 'Ideas', author: 'hubot', labels: ['documentation'], updatedAt: '2026-11-10T00:00:00Z', comments: [{ author: 'octocat', body: 'Yes', upvotes: 2, replies: [{ author: 'hubot', body: 'Why?' }] }] })
  const second = fake.seedDiscussion({ title: 'How do I log in?', category: 'Q&A', updatedAt: '2026-11-12T00:00:00Z', comments: [{ body: 'Use gh', isAnswer: true }] })
  fake.seedDiscussion({ title: 'Old news', category: 'General', state: 'CLOSED', stateReason: 'OUTDATED' })
  assert.deepEqual([first.number, second.number], [1, 2])
  const listed = fake.handle('PmkitDiscussions', { owner: 'acme', name: 'widgets', first: 10, states: ['OPEN'] })
  assert.equal(listed.data.repository.hasDiscussionsEnabled, true)
  assert.deepEqual(listed.data.repository.discussions.nodes.map((node) => node.number), [2, 1])
  const ideas = fake.handle('PmkitDiscussionCategories', { owner: 'acme', name: 'widgets' }).data.repository.discussionCategories.nodes.find((node) => node.name === 'Ideas')
  assert.deepEqual(fake.handle('PmkitDiscussions', { owner: 'acme', name: 'widgets', first: 10, categoryId: ideas.id }).data.repository.discussions.nodes.map((node) => node.number), [1])
  assert.deepEqual(fake.handle('PmkitDiscussions', { owner: 'acme', name: 'widgets', first: 10, answered: true }).data.repository.discussions.nodes.map((node) => node.number), [2])
  const read = fake.handle('PmkitDiscussion', { owner: 'acme', name: 'widgets', number: 1, comments: 100, replies: 100 }).data.repository.discussion
  assert.equal(read.category.name, 'Ideas')
  assert.equal(read.comments.nodes[0].replies.nodes[0].body, 'Why?')
  assert.deepEqual(read.labels.nodes, [{ name: 'documentation' }])
  assert.equal(fake.handle('PmkitDiscussion', { owner: 'acme', name: 'widgets', number: 2, comments: 100, replies: 100 }).data.repository.discussion.answer.body, 'Use gh')
  const posted = fake.handle('PmkitAddDiscussionComment', { input: { discussionId: read.id, body: 'Tracked in #4' } })
  assert.match(posted.data.addDiscussionComment.comment.url, /^https:\/\/github\.com\/acme\/widgets\/discussions\/1#discussioncomment-\d+$/)
  const again = fakeGithubIssuesFrom(fake.toJSON())
  const comments = again.handle('PmkitDiscussion', { owner: 'acme', name: 'widgets', number: 1, comments: 100, replies: 100 }).data.repository.discussion.comments
  assert.deepEqual(comments.nodes.map((node) => node.body), ['Yes', 'Tracked in #4'])
  assert.equal(comments.totalCount, 2)
  const missing = fake.handle('PmkitDiscussion', { owner: 'acme', name: 'widgets', number: 9, comments: 100, replies: 100 })
  assert.deepEqual(missing.data, { repository: { discussion: null } })
  assert.equal(missing.errors[0].type, 'NOT_FOUND')
  const issue = fake.seed({ title: 'After the discussions' })
  assert.equal(issue.number, 4)
})

test('fake GitHub with Discussions off answers hasDiscussionsEnabled false and finds no discussion', () => {
  const fake = fakeGithubIssues({ discussionsEnabled: false })
  assert.equal(fake.handle('PmkitDiscussions', { owner: 'acme', name: 'widgets', first: 10 }).data.repository.hasDiscussionsEnabled, false)
  assert.equal(fake.handle('PmkitDiscussion', { owner: 'acme', name: 'widgets', number: 1, comments: 1, replies: 1 }).errors[0].type, 'NOT_FOUND')
})

// PMK-88: iterations, epic Projects, status updates and milestones.
const ITERATIONS = {
  duration: 14,
  iterations: [{ id: 'IT_a', title: 'Iteration 2', startDate: '2026-11-16', duration: 14 }, { id: 'IT_b', title: 'Iteration 3', startDate: '2026-11-30', duration: 14 }],
  completed: [{ id: 'IT_0', title: 'Iteration 1', startDate: '2026-11-02', duration: 14 }],
}
const EPICS = [
  { id: 'PVT_E12', owner: 'acme', number: 12, title: 'Epic twelve', readme: 'Goal', shortDescription: 'short' },
  { id: 'PVT_E13', owner: 'acme', number: 13, title: 'Epic thirteen', linked: false },
]
const SPRINT_VARS = { fStatus: 'Status', fSprint: 'Sprint' }
const data = (reply) => {
  assert.equal(reply.errors, undefined, JSON.stringify(reply.errors))
  return reply.data
}
const postMilestone = (fake, body, host = 'github.com') => fake.exec('gh', ['api', '--hostname', host, '--method', 'POST', 'repos/acme/widgets/milestones', '--include', '--input', '-'], { input: JSON.stringify(body) })
const restBody = (answer) => JSON.parse(answer.stdout.split('\r\n\r\n')[1])

test('PmkitIterationField answers the configuration of the iteration field with completed iterations', () => {
  const fake = fakeGithubIssues({ project: { iterations: ITERATIONS } })
  const { node } = data(fake.handle('PmkitIterationField', { project: 'PVT_1', field: 'Sprint' }))
  assert.equal(node.field.__typename, 'ProjectV2IterationField')
  assert.equal(node.field.configuration.duration, 14)
  assert.equal(node.field.configuration.startDay, 1)
  assert.deepEqual(node.field.configuration.iterations.map((entry) => entry.id), ['IT_a', 'IT_b'])
  assert.deepEqual(node.field.configuration.completedIterations, ITERATIONS.completed)
  assert.equal(data(fake.handle('PmkitIterationField', { project: 'PVT_1', field: 'Nope' })).node.field, null)
})

test('PmkitUpdateIterations replaces the configuration: an id is kept, none gets a new id, a gone iteration loses its items', () => {
  const fake = fakeGithubIssues({ project: { iterations: ITERATIONS } })
  const a = fake.seed({ item: { values: { Sprint: '2026-11-16' } } })
  const b = fake.seed({ item: { values: { Sprint: '2026-11-30' } } })
  const field = data(fake.handle('PmkitIterationField', { project: 'PVT_1', field: 'Sprint' })).node.field
  const reply = data(fake.handle('PmkitUpdateIterations', { input: { fieldId: field.id, iterationConfiguration: {
    startDate: '2026-11-02', duration: 14,
    iterations: [{ id: 'IT_0', title: 'Iteration 1', startDate: '2026-11-02', duration: 14 }, { id: 'IT_a', title: 'Iteration 2', startDate: '2026-11-16', duration: 14 }, { title: 'Iteration 4', startDate: '2026-12-14', duration: 14 }],
  } } }))
  const config = reply.updateProjectV2Field.projectV2Field.configuration
  assert.equal(reply.updateProjectV2Field.projectV2Field.id, field.id)
  assert.deepEqual(config.completedIterations.map((entry) => entry.id), ['IT_0'])
  assert.equal(config.iterations.length, 2)
  assert.equal(config.iterations[0].id, 'IT_a')
  assert.ok(config.iterations[1].id && config.iterations[1].id !== 'IT_b')
  const read = (id) => data(fake.handle('PmkitIssue', { ...REPO, number: id, ...SPRINT_VARS })).repository.issue.projectItems.nodes[0].fSprint
  assert.equal(read(a.number).iterationId, 'IT_a')
  assert.equal(read(b.number), null)
})

test('on a GHES fake an iteration with an id answers the validation error', () => {
  const fake = fakeGithubIssues({ host: 'ghe.example.com', ghesVersion: '3.15', project: { iterations: ITERATIONS } })
  const field = data(fake.handle('PmkitIterationField', { project: 'PVT_1', field: 'Sprint' })).node.field
  const withId = fake.handle('PmkitUpdateIterations', { input: { fieldId: field.id, iterationConfiguration: { startDate: '2026-11-16', duration: 14, iterations: [{ id: 'IT_a', title: 'x', startDate: '2026-11-16', duration: 14 }] } } })
  assert.deepEqual(withId, { errors: [{ message: "InputObject 'ProjectV2Iteration' doesn't accept argument 'id'" }] })
  const without = fake.handle('PmkitUpdateIterations', { input: { fieldId: field.id, iterationConfiguration: { startDate: '2026-11-16', duration: 14, iterations: [{ title: 'x', startDate: '2026-11-16', duration: 14 }] } } })
  assert.equal(data(without).updateProjectV2Field.projectV2Field.configuration.iterations.length, 1)
})

test('an item reads its sprint as ProjectV2ItemFieldIterationValue and updateProjectV2ItemFieldValue takes { iterationId }', () => {
  const fake = fakeGithubIssues({ project: { iterations: ITERATIONS } })
  const issue = fake.seed({ item: {} })
  const item = fake.state.items[0]
  const field = fake.state.project.fields.find((entry) => entry.name === 'Sprint')
  data(fake.handle('PmkitSetProjectField', { input: { projectId: 'PVT_1', itemId: item.id, fieldId: field.id, value: { iterationId: 'IT_b' } } }))
  const read = () => data(fake.handle('PmkitIssue', { ...REPO, number: issue.number, ...SPRINT_VARS })).repository.issue.projectItems.nodes[0]
  assert.deepEqual(read().fSprint, { __typename: 'ProjectV2ItemFieldIterationValue', iterationId: 'IT_b', title: 'Iteration 3', startDate: '2026-11-30', duration: 14 })
  assert.deepEqual(read().project, { id: 'PVT_1', number: 7, owner: { login: 'acme' } })
  const bad = fake.handle('PmkitSetProjectField', { input: { projectId: 'PVT_1', itemId: item.id, fieldId: field.id, value: { iterationId: 'IT_zzz' } } })
  assert.ok(bad.errors)
})

test('PmkitLinkedProjects pages the scope Project and the linked epics; without epics it lists the scope Project only', () => {
  const plain = fakeGithubIssues()
  assert.deepEqual(data(plain.handle('PmkitLinkedProjects', REPO)).repository.projectsV2.nodes.map((node) => [node.number, node.title, node.owner.login]), [[7, 'Roadmap', 'acme']])
  const fake = fakeGithubIssues({ epics: EPICS })
  const all = data(fake.handle('PmkitLinkedProjects', REPO)).repository.projectsV2
  assert.deepEqual(all.nodes.map((node) => node.number), [7, 12])
  assert.deepEqual(Object.keys(all.nodes[1]).sort(), ['closed', 'id', 'number', 'owner', 'readme', 'shortDescription', 'title', 'url'])
  assert.equal(all.nodes[1].readme, 'Goal')
  const first = data(fake.handle('PmkitLinkedProjects', { ...REPO, first: 1 })).repository.projectsV2
  assert.equal(first.pageInfo.hasNextPage, true)
  const second = data(fake.handle('PmkitLinkedProjects', { ...REPO, first: 1, after: first.pageInfo.endCursor })).repository.projectsV2
  assert.deepEqual(second.nodes.map((node) => node.number), [12])
})

test('PmkitEpic answers the Project with its status updates newest first, and NOT_FOUND for an unknown number', () => {
  const fake = fakeGithubIssues({ epics: EPICS })
  fake.seedStatusUpdate('PVT_E12', { status: 'ON_TRACK', body: 'old', createdAt: '2026-11-01T00:00:00Z' })
  fake.seedStatusUpdate('PVT_E12', { status: 'AT_RISK', body: 'new', startDate: '2026-11-01', targetDate: '2026-12-01', createdAt: '2026-11-10T00:00:00Z', creator: 'hubot' })
  const project = data(fake.handle('PmkitEpic', { owner: 'acme', number: 12 })).repositoryOwner.projectV2
  assert.deepEqual([project.id, project.number, project.closed, project.readme, project.shortDescription, project.owner.login], ['PVT_E12', 12, false, 'Goal', 'short', 'acme'])
  assert.deepEqual(project.statusUpdates.nodes.map((node) => [node.body, node.status, node.creator.login]), [['new', 'AT_RISK', 'hubot'], ['old', 'ON_TRACK', 'octocat']])
  assert.deepEqual(project.statusUpdates.nodes[0].startDate, '2026-11-01')
  const missing = fake.handle('PmkitEpic', { owner: 'acme', number: 99 })
  assert.equal(missing.errors[0].type, 'NOT_FOUND')
})

test('PmkitEpics answers Projects by node id with their latest status update, and NOT_FOUND with null for an unknown id', () => {
  const fake = fakeGithubIssues({ epics: EPICS })
  fake.seedStatusUpdate('PVT_E12', { status: 'ON_TRACK', body: 'old', createdAt: '2026-11-01T00:00:00Z' })
  fake.seedStatusUpdate('PVT_E12', { status: 'AT_RISK', body: 'new', createdAt: '2026-11-10T00:00:00Z' })
  const query = 'query PmkitEpics($ids: [ID!]!) { nodes(ids: $ids) { __typename ... on ProjectV2 { id } } }'
  const nodes = data(fake.handle('PmkitEpics', { ids: ['PVT_E12', 'PVT_1'] }, query)).nodes
  assert.deepEqual(nodes.map((node) => [node.__typename, node.id, node.number]), [['ProjectV2', 'PVT_E12', 12], ['ProjectV2', 'PVT_1', 7]])
  assert.deepEqual(nodes[0].statusUpdates.nodes.map((node) => node.body), ['new'])
  const missing = fake.handle('PmkitEpics', { ids: ['PVT_E12', 'nope'] }, query)
  assert.equal(missing.errors[0].type, 'NOT_FOUND')
  assert.deepEqual(missing.errors[0].path, ['nodes', 1])
  assert.equal(missing.data.nodes[1], null)
})

test('PmkitStatusUpdates pages newest first', () => {
  const fake = fakeGithubIssues({ epics: EPICS })
  for (const day of ['01', '02', '03']) fake.seedStatusUpdate('PVT_E12', { status: 'ON_TRACK', body: `day ${day}`, createdAt: `2026-11-${day}T00:00:00Z` })
  const one = data(fake.handle('PmkitStatusUpdates', { project: 'PVT_E12', first: 2 })).node.statusUpdates
  assert.deepEqual(one.nodes.map((node) => node.body), ['day 03', 'day 02'])
  const two = data(fake.handle('PmkitStatusUpdates', { project: 'PVT_E12', first: 2, after: one.pageInfo.endCursor })).node.statusUpdates
  assert.deepEqual(two.nodes.map((node) => node.body), ['day 01'])
  assert.equal(two.pageInfo.hasNextPage, false)
})

test('PmkitEpicItems lists the issues of an epic Project with their Status, archived ones included', () => {
  const fake = fakeGithubIssues({ epics: EPICS })
  const a = fake.seed({ title: 'In epic', epics: [{ project: 'acme/12', status: 'Todo' }] })
  fake.seed({ title: 'Archived', epics: ['acme/12'] })
  fake.seed({ title: 'Elsewhere', epics: ['acme/13'] })
  fake.state.items.find((item) => item.issueId === 'I_2').isArchived = true
  const items = data(fake.handle('PmkitEpicItems', { project: 'PVT_E12', ...SPRINT_VARS })).node.items
  assert.deepEqual(items.nodes.map((node) => [node.content.number, node.isArchived]), [[1, false], [2, true]])
  assert.equal(items.nodes[0].content.id, a.id)
  assert.equal(items.nodes[0].status.name, 'Todo')
  assert.equal(items.nodes[0].content.repository.nameWithOwner, 'acme/widgets')
  assert.deepEqual(items.nodes[0].content.projectItems.nodes.map((node) => node.project.number), [12])
  assert.equal(items.pageInfo.hasNextPage, false)
  const paged = data(fake.handle('PmkitEpicItems', { project: 'PVT_E12', first: 1 })).node.items
  assert.equal(paged.pageInfo.hasNextPage, true)
})

test('PmkitCreateProject numbers after the highest number, links the repository and answers id and number', () => {
  const fake = fakeGithubIssues({ epics: EPICS })
  const created = data(fake.handle('PmkitCreateProject', { input: { ownerId: 'O_1', title: 'New epic', repositoryId: 'R_1' } })).createProjectV2.projectV2
  assert.equal(created.number, 14)
  const linked = data(fake.handle('PmkitLinkedProjects', REPO)).repository.projectsV2.nodes
  assert.deepEqual(linked.map((node) => node.number), [7, 12, 14])
  assert.equal(linked[2].owner.login, 'acme')
  const unlinked = data(fake.handle('PmkitCreateProject', { input: { ownerId: 'O_1', title: 'Loose' } })).createProjectV2.projectV2
  assert.equal(unlinked.number, 15)
  assert.equal(data(fake.handle('PmkitLinkedProjects', REPO)).repository.projectsV2.nodes.length, 3)
  assert.equal(data(fake.handle('PmkitEpic', { owner: 'acme', number: 14 })).repositoryOwner.projectV2.id, created.id)
  assert.ok(fake.handle('PmkitCreateProject', { input: { ownerId: 'O_9', title: 'x' } }).errors)
})

test('PmkitUpdateProjectReadme sets the readme', () => {
  const fake = fakeGithubIssues({ epics: EPICS })
  assert.deepEqual(data(fake.handle('PmkitUpdateProjectReadme', { input: { projectId: 'PVT_E12', readme: 'New goal' } })), { updateProjectV2: { projectV2: { id: 'PVT_E12' } } })
  assert.equal(data(fake.handle('PmkitEpic', { owner: 'acme', number: 12 })).repositoryOwner.projectV2.readme, 'New goal')
})

test('PmkitCreateStatusUpdate stores the update with the viewer and the fake clock', () => {
  const fake = fakeGithubIssues({ epics: EPICS, now: '2026-11-16T10:00:00.000Z' })
  const reply = data(fake.handle('PmkitCreateStatusUpdate', { input: { projectId: 'PVT_E12', status: 'OFF_TRACK', body: 'late', startDate: '2026-11-01', targetDate: '2026-12-01' } }))
  assert.ok(reply.createProjectV2StatusUpdate.statusUpdate.id)
  const [update] = data(fake.handle('PmkitStatusUpdates', { project: 'PVT_E12' })).node.statusUpdates.nodes
  assert.deepEqual([update.status, update.body, update.startDate, update.targetDate, update.creator.login, update.createdAt], ['OFF_TRACK', 'late', '2026-11-01', '2026-12-01', 'octocat', '2026-11-16T10:00:01.000Z'])
  assert.ok(fake.handle('PmkitCreateStatusUpdate', { input: { projectId: 'PVT_E12', status: 'WEIRD' } }).errors)
})

test('PmkitDeleteProjectItem removes the item from a Project of the fake', () => {
  const fake = fakeGithubIssues({ epics: EPICS })
  fake.seed({ epics: ['acme/12'] })
  const item = fake.state.items[0]
  assert.deepEqual(data(fake.handle('PmkitDeleteProjectItem', { input: { projectId: 'PVT_E12', itemId: item.id } })), { deleteProjectV2Item: { deletedItemId: item.id } })
  assert.equal(data(fake.handle('PmkitEpicItems', { project: 'PVT_E12' })).node.items.nodes.length, 0)
})

test('addProjectV2ItemById and updateProjectV2ItemFieldValue work on an epic Project', () => {
  const fake = fakeGithubIssues({ epics: EPICS })
  fake.seed({})
  const item = data(fake.handle('PmkitAddProjectItem', { input: { projectId: 'PVT_E12', contentId: 'I_1' } })).addProjectV2ItemById.item
  const status = fake.state.projects[0].fields.find((field) => field.name === 'Status')
  data(fake.handle('PmkitSetProjectField', { input: { projectId: 'PVT_E12', itemId: item.id, fieldId: status.id, value: { singleSelectOptionId: status.options[1].id } } }))
  assert.equal(data(fake.handle('PmkitEpicItems', { project: 'PVT_E12' })).node.items.nodes[0].status.name, status.options[1].name)
})

test('milestones: PmkitMilestones lists them, createIssue and updateIssue set milestoneId (null clears) and filterBy.milestoneNumber filters', async () => {
  const { fake, docs, client, create, read } = setup({ milestones: [{ title: 'v1.0', number: 3, description: 'First', dueOn: '2026-12-01T00:00:00Z' }, { title: 'v0.9', state: 'CLOSED' }] })
  const listed = data(fake.handle('PmkitMilestones', REPO)).repository.milestones
  assert.deepEqual(listed.nodes.map((node) => [node.number, node.title, node.description, node.dueOn, node.state]), [[3, 'v1.0', 'First', '2026-12-01T00:00:00Z', 'OPEN'], [4, 'v0.9', null, null, 'CLOSED']])
  const id = listed.nodes[0].id
  await create({ title: 'with', milestoneId: id })
  await create({ title: 'without' })
  assert.deepEqual((await read(1)).milestone, { id, number: 3, title: 'v1.0' })
  assert.equal((await read(2)).milestone, null)
  const numbers = async (milestoneNumber) => (await client.request(docs.ISSUES, { ...REPO, first: 10, filterBy: { milestoneNumber }, ...VARS })).repository.issues.nodes.map((node) => node.number)
  assert.deepEqual(await numbers('3'), [1])
  assert.deepEqual(await numbers('none'), [2])
  await client.request(docs.UPDATE_ISSUE, { input: { id: 'I_2', milestoneId: id }, ...VARS })
  assert.deepEqual(await numbers('3'), [1, 2])
  await client.request(docs.UPDATE_ISSUE, { input: { id: 'I_1', milestoneId: null }, ...VARS })
  assert.deepEqual(await numbers('none'), [1])
  const events = (await client.request(docs.TIMELINE, { id: 'I_1', first: 10 })).node.timelineItems.nodes.map((node) => [node.__typename, node.milestoneTitle])
  assert.deepEqual(events, [['MilestonedEvent', 'v1.0'], ['DemilestonedEvent', 'v1.0']])
})

test('seed milestone by title and sprint by start date', () => {
  const fake = fakeGithubIssues({ milestones: [{ title: 'v1.0' }], project: { iterations: ITERATIONS } })
  fake.seed({ milestone: 'v1.0', item: { values: { Sprint: '2026-11-16' } } })
  const issue = data(fake.handle('PmkitIssue', { ...REPO, number: 1, ...SPRINT_VARS })).repository.issue
  assert.equal(issue.milestone.title, 'v1.0')
  assert.equal(issue.projectItems.nodes[0].fSprint.title, 'Iteration 2')
  assert.throws(() => fake.seed({ milestone: 'nope' }), /unknown milestone/)
})

test('REST POST milestones answers like gh --include: 201 with the milestone, 422 for a taken title', () => {
  const fake = fakeGithubIssues({ milestones: [{ title: 'v1.0' }] })
  const created = postMilestone(fake, { title: 'v2.0', due_on: '2026-12-31T00:00:00Z', description: 'Second' })
  assert.equal(created.status, 0)
  assert.match(created.stdout, /^HTTP\/2\.0 201 Created\r\n/)
  assert.deepEqual(restBody(created), { number: 2, title: 'v2.0', node_id: restBody(created).node_id, due_on: '2026-12-31T00:00:00Z', state: 'open', description: 'Second' })
  assert.ok(restBody(created).node_id)
  assert.deepEqual(data(fake.handle('PmkitMilestones', REPO)).repository.milestones.nodes.map((node) => node.title), ['v1.0', 'v2.0'])
  const taken = postMilestone(fake, { title: 'v1.0', due_on: '2026-12-31T00:00:00Z' })
  assert.equal(taken.status, 1)
  assert.match(taken.stdout, /^HTTP\/2\.0 422 /)
  assert.deepEqual(restBody(taken), { message: 'Validation Failed', errors: [{ resource: 'Milestone', code: 'already_exists', field: 'title' }] })
  assert.match(taken.stderr, /422/)
  assert.deepEqual(fake.mutations.map((call) => call.name), ['RestCreateMilestone', 'RestCreateMilestone'])
  assert.equal(fake.exec('gh', ['api', '--method', 'GET', 'repos/acme/widgets/labels'], {}).status, 1)
})

test('fakeGithubIssuesFrom accepts a version 1 JSON and fills the new keys empty', () => {
  const json = JSON.parse(JSON.stringify(fakeGithubIssues().toJSON()))
  for (const key of ['projects', 'milestones', 'statusUpdates', 'ownerId']) delete json[key]
  json.version = 1
  json.counters = { comment: 0, item: 0, event: 0 }
  const restored = fakeGithubIssuesFrom(json)
  assert.equal(restored.toJSON().version, 2)
  assert.deepEqual(data(restored.handle('PmkitMilestones', REPO)).repository.milestones.nodes, [])
  assert.equal(data(restored.handle('PmkitLinkedProjects', REPO)).repository.projectsV2.nodes.length, 1)
  assert.equal(data(restored.handle('PmkitCreateProject', { input: { ownerId: 'O_1', title: 'x' } })).createProjectV2.projectV2.number, 8)
  assert.throws(() => fakeGithubIssuesFrom({ version: 3 }), /needs the toJSON/)
})

test('the fake refuses a Project owner selected as owner { login }, as GitHub does for ProjectV2Owner', async () => {
  const { client } = setup({ epics: [{ id: 'PVT_E12', owner: 'acme', number: 12 }] })
  const bad = 'query PmkitEpic($owner: String!, $number: Int!) { repositoryOwner(login: $owner) { ... on ProjectV2Owner { projectV2(number: $number) { id owner { login } } } } }'
  await assert.rejects(client.request(bad, { owner: 'acme', number: 12 }), /Field 'login' doesn't exist on type 'ProjectV2Owner'/)
  const good = bad.replace('owner { login }', 'owner { ... on Organization { login } ... on User { login } }')
  assert.equal((await client.request(good, { owner: 'acme', number: 12 })).repositoryOwner.projectV2.owner.login, 'acme')
})

test('an epic Project can hold a pull request, a draft issue and a redacted item, and PmkitEpicItems answers their content', async () => {
  const { fake, client } = setup({ epics: [{ id: 'PVT_E12', owner: 'acme', number: 12 }] })
  fake.seedProjectItem('acme/12', { type: 'PULL_REQUEST', title: 'Fix the index' })
  fake.seedDraft({ project: 'PVT_E12', title: 'Idea' })
  fake.seedProjectItem('acme/12', { type: 'REDACTED' })
  const query = 'query PmkitEpicItems($project: ID!, $first: Int!, $after: String) { node(id: $project) { ... on ProjectV2 { items(first: $first, after: $after) { nodes { id content { __typename ... on PullRequest { title } ... on DraftIssue { title } } } } } } }'
  const { nodes } = await client.paginate(query, { project: 'PVT_E12' }, { select: (data) => data.node.items })
  assert.deepEqual(nodes.map((node) => node.content && [node.content.__typename, node.content.title]), [['PullRequest', 'Fix the index'], ['DraftIssue', 'Idea'], null])
})

test('every Project item has the type GitHub gives it, and the draft reads see a draft in an epic Project', () => {
  const fake = fakeGithubIssues({ epics: [{ id: 'PVT_E12', owner: 'acme', number: 12 }] })
  const issue = fake.seed({ number: 1, epics: ['acme/12'] })
  const { item: draft } = fake.seedDraft({ project: 'PVT_E12', title: 'Idea' })
  const { id: pull } = fake.seedProjectItem('acme/12', { type: 'PULL_REQUEST' })
  const typeOf = (id) => fake.state.items.find((item) => item.id === id).type
  assert.equal(fake.state.items.find((item) => item.issueId === issue.id).type, 'ISSUE')
  assert.deepEqual([typeOf(draft), typeOf(pull)], ['DRAFT_ISSUE', 'PULL_REQUEST'])
  const items = data(fake.handle('PmkitDraftItems', { project: 'PVT_E12', first: 10 })).node.items.nodes
  assert.deepEqual(items.map((item) => [item.type, item.content?.__typename]), [['ISSUE', 'Issue'], ['DRAFT_ISSUE', 'DraftIssue'], ['PULL_REQUEST', 'PullRequest']])
  assert.equal(items[1].content.title, 'Idea')
  assert.equal(fake.state.items.some((item) => 'kind' in item), false)
})

test('seedProjectItem takes only a pull request or a redacted item, and names the helper for the others', () => {
  const fake = fakeGithubIssues({ epics: [{ id: 'PVT_E12', owner: 'acme', number: 12 }] })
  assert.throws(() => fake.seedProjectItem('acme/12', { type: 'DRAFT_ISSUE' }), /seedDraft/)
  assert.throws(() => fake.seedProjectItem('acme/12', { type: 'ISSUE' }), /seed\(/)
  assert.throws(() => fake.seedProjectItem('acme/99', { type: 'PULL_REQUEST' }), /unknown Project acme\/99/)
  const { id } = fake.seedProjectItem('acme/7', { type: 'REDACTED' })
  assert.equal(fake.state.items.find((item) => item.id === id).projectId, 'PVT_1')
})

test('a field write on a draft item sets and clears the value, as GitHub does, with no issue event', () => {
  const fake = fakeGithubIssues()
  const { item } = fake.seedDraft({ title: 'Idea' })
  const field = fake.state.project.fields.find((candidate) => candidate.name === 'Status')
  const optionId = field.options[0].id
  data(fake.handle('PmkitSetProjectField', { input: { projectId: 'PVT_1', itemId: item, fieldId: field.id, value: { singleSelectOptionId: optionId } } }))
  assert.deepEqual(fake.state.items.find((candidate) => candidate.id === item).values[field.id], { optionId })
  data(fake.handle('PmkitClearProjectField', { input: { projectId: 'PVT_1', itemId: item, fieldId: field.id } }))
  assert.equal(fake.state.items.find((candidate) => candidate.id === item).values[field.id], undefined)
})

test('fakeGithubIssuesFrom fills the item type of a state saved before PMK-343', () => {
  const fake = fakeGithubIssues({ epics: [{ id: 'PVT_E12', owner: 'acme', number: 12 }] })
  fake.seed({ number: 1, epics: ['acme/12'] })
  fake.seedDraft({ project: 'PVT_E12', title: 'Idea' })
  const json = fake.toJSON()
  for (const item of json.items) delete item.type
  json.items.push({ id: 'PVTI_8', projectId: 'PVT_E12', issueId: null, kind: 'PULL_REQUEST', title: 'Old pull', isArchived: false, values: {} })
  json.items.push({ id: 'PVTI_9', projectId: 'PVT_E12', issueId: null, kind: 'DRAFT_ISSUE', title: 'Old draft', isArchived: false, values: {} })
  const restored = fakeGithubIssuesFrom(json)
  const nodes = data(restored.handle('PmkitEpicItems', { project: 'PVT_E12', first: 10 }, 'content { __typename')).node.items.nodes
  assert.deepEqual(restored.state.items.map((item) => item.type), ['ISSUE', 'DRAFT_ISSUE', 'PULL_REQUEST', 'DRAFT_ISSUE'])
  assert.deepEqual(nodes.map((node) => [node.content.__typename, node.content.title]), [['Issue', 'Seeded issue'], ['DraftIssue', 'Idea'], ['PullRequest', 'Old pull'], ['DraftIssue', 'Old draft']])
  assert.equal(restored.state.items.some((item) => 'kind' in item), false)
})

test('PmkitIssueNodes answers issues by node id in order, with null for an unknown id', async () => {
  const { fake, client } = setup()
  const one = fake.seed({ number: 1 })
  const two = fake.seed({ number: 2 })
  const query = 'query PmkitIssueNodes($ids: [ID!]!) { nodes(ids: $ids) { ... on Issue { id number } } }'
  const { nodes } = await client.request(query, { ids: [two.id, 'nope', one.id] })
  assert.deepEqual(nodes.map((node) => node?.number ?? null), [2, null, 1])
})
