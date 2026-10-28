import assert from 'node:assert/strict'
import test from 'node:test'
import { ACME_LABELS, ACME_STATES, ACME_TEAM, ACME_TEAM_ID, ACME_USERS, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeLinearProjects, fakeTriage, fakeWorkspace, json, page } from './fake-linear-api.mjs'
import {
  BLOCK_GRAPH_QUERY, COMMENT_BY_ID_QUERY, COMMENT_CREATE, COMMENT_RESOLVE, CYCLE_BY_NUMBER_QUERY, CYCLES_QUERY, ISSUE_ARCHIVE, ISSUE_BY_ID_QUERY, ISSUE_COMMENTS_QUERY, ISSUE_CREATE, ISSUE_EVENTS_QUERY, ISSUE_HISTORY_QUERY, ISSUE_UPDATE, ISSUES_QUERY, NESTED_PAGES, PARENT_CHAIN_QUERY, RELATION_CREATE, RELATION_DELETE,
} from './lib/linear/documents.mjs'
import { operationName } from './lib/linear/client.mjs'
import {
  DOCUMENT_QUERY, EPIC_ISSUES_QUERY, PROJECTS_QUERY, PROJECT_CREATE, PROJECT_MILESTONES_QUERY, PROJECT_MILESTONE_QUERY, PROJECT_UPDATES_QUERY, PROJECT_UPDATE_CREATE,
} from './lib/linear/projects.mjs'

const ENDPOINT = 'https://api.linear.app/graphql'
const post = (fetch, query, variables = {}, extra = {}) =>
  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: FAKE_KEY },
    body: JSON.stringify({ query, variables }),
    ...extra,
  })

test('operationName reads the name and skips comments', () => {
  assert.equal(operationName('query Issues($a: Int) { x }'), 'Issues')
  assert.equal(operationName('mutation IssueCreate { x }'), 'IssueCreate')
  assert.equal(operationName('{ viewer { id } }'), null)
  assert.equal(operationName('# note\nquery Q { x }'), 'Q')
})

test('a named mutation after a fragment routes by its name', async () => {
  const fetch = fakeLinearFetch({ PmkitIssueUpdate: json({ ok: true }) })
  const response = await post(fetch, 'fragment F on Issue { id } mutation PmkitIssueUpdate { x }')
  assert.deepEqual(JSON.parse(await response.text()), { data: { ok: true } })
  assert.deepEqual(fetch.unrouted, [])
})

test('the fake records each call with plain headers and a parsed body', async () => {
  const fetch = fakeLinearFetch({ Q: json({ a: 1 }) })
  await post(fetch, 'query Q { a }', { x: 1 })
  assert.equal(fetch.calls.length, 1)
  const [call] = fetch.calls
  assert.equal(call.url, ENDPOINT)
  assert.equal(call.method, 'POST')
  assert.deepEqual(call.headers, { 'Content-Type': 'application/json', Authorization: FAKE_KEY })
  assert.deepEqual(call.body, { query: 'query Q { a }', variables: { x: 1 } })
})

test('PmkitSession answers by default and can change the workspace', async () => {
  const doc = 'query PmkitSession { viewer { id name } }'
  const fetch = fakeLinearFetch()
  const body = JSON.parse(await (await post(fetch, doc)).text())
  assert.deepEqual(body, {
    data: {
      viewer: { id: 'user-1', name: 'Test User' },
      organization: { urlKey: 'acme', name: 'Acme', previousUrlKeys: [] },
    },
  })
  const other = fakeLinearFetch({}, { workspace: 'other', previousUrlKeys: ['acme'] })
  const data = JSON.parse(await (await post(other, doc)).text()).data
  assert.equal(data.organization.urlKey, 'other')
  assert.deepEqual(data.organization.previousUrlKeys, ['acme'])
})

test('a single route answers every call, a list answers by call number', async () => {
  const one = fakeLinearFetch({ Q: json({ a: 1 }) })
  for (let i = 0; i < 3; i++) assert.deepEqual(JSON.parse(await (await post(one, 'query Q { a }')).text()).data, { a: 1 })
  const list = fakeLinearFetch({ Q: [json({ n: 1 }), json({ n: 2 })] })
  const seen = []
  for (let i = 0; i < 3; i++) seen.push(JSON.parse(await (await post(list, 'query Q { a }')).text()).data.n)
  assert.deepEqual(seen, [1, 2, 2])
})

test('a function route receives the parsed body', async () => {
  const fetch = fakeLinearFetch({ Q: (body) => json({ echo: body.variables.x }) })
  assert.deepEqual(JSON.parse(await (await post(fetch, 'query Q { a }', { x: 7 })).text()).data, { echo: 7 })
})

test('raw text, status, headers and ok', async () => {
  const fetch = fakeLinearFetch({
    T: { text: 'oops', status: 400 },
    H: json({ a: 1 }, { headers: { 'X-RateLimit-Requests-Remaining': '5' } }),
  })
  const raw = await post(fetch, 'query T { a }')
  assert.equal(raw.status, 400)
  assert.equal(raw.ok, false)
  assert.equal(await raw.text(), 'oops')
  const withHeaders = await post(fetch, 'query H { a }')
  assert.equal(withHeaders.ok, true)
  assert.equal(withHeaders.headers.get('x-ratelimit-requests-remaining'), '5')
})

test('throws rejects with the given error', async () => {
  const error = new TypeError('fetch failed')
  const fetch = fakeLinearFetch({ Q: { throws: error } })
  await assert.rejects(post(fetch, 'query Q { a }'), (caught) => caught === error)
})

test('hang stays pending until the signal aborts', async () => {
  const fetch = fakeLinearFetch({ Q: { hang: true } })
  const signal = AbortSignal.timeout(10)
  await assert.rejects(post(fetch, 'query Q { a }', {}, { signal }), (caught) => caught === signal.reason)
})

test('textRejects resolves the response and rejects text()', async () => {
  const fetch = fakeLinearFetch({ Q: { textRejects: true, status: 200 } })
  const response = await post(fetch, 'query Q { a }')
  assert.equal(response.status, 200)
  await assert.rejects(response.text(), { name: 'TypeError', message: 'terminated' })
})

test('an operation with no route is recorded and rejected', async () => {
  const fetch = fakeLinearFetch()
  await assert.rejects(post(fetch, 'query Missing { a }'), { message: 'fake linear: no route for Missing' })
  await assert.rejects(post(fetch, '{ a }'), { message: 'fake linear: no route for (anonymous)' })
  assert.deepEqual(fetch.unrouted, ['Missing', '(anonymous)'])
})

test('page builds a Relay connection', () => {
  assert.deepEqual(page([{ id: 1 }], { hasNextPage: true, endCursor: 'c1' }), {
    pageInfo: { hasNextPage: true, endCursor: 'c1' },
    nodes: [{ id: 1 }],
  })
  assert.deepEqual(page([]).pageInfo, { hasNextPage: false, endCursor: null })
})

const DISCOVERY_OPERATIONS = ['PmkitWorkspace', 'PmkitPlan', 'PmkitIntegrations', 'PmkitTeams', 'PmkitStates', 'PmkitLabels', 'PmkitUsers']
const answer = async (fetch, name, variables = {}) => JSON.parse(await (await post(fetch, `query ${name} { x }`, variables)).text())

test('fakeWorkspace answers every discovery operation with the default data', async () => {
  const fetch = fakeLinearFetch(fakeWorkspace())
  for (const name of DISCOVERY_OPERATIONS) assert.ok((await answer(fetch, name, { first: 250 })).data, name)
  const states = (await answer(fetch, 'PmkitStates', { first: 250 })).data.workflowStates.nodes
  assert.equal(states.length, 10)
  assert.equal(states.filter((state) => state.type === 'duplicate').length, 1)
  assert.ok(states.every((state) => state.team.id === ACME_TEAM_ID))
  assert.equal((await answer(fetch, 'PmkitPlan')).data.organization.subscription, null)
})

test('fakeWorkspace pages a connection by first and after', async () => {
  const fetch = fakeLinearFetch(fakeWorkspace())
  const first = (await answer(fetch, 'PmkitStates', { first: 4 })).data.workflowStates
  assert.equal(first.nodes.length, 4)
  assert.deepEqual(first.pageInfo, { hasNextPage: true, endCursor: '4' })
  const last = (await answer(fetch, 'PmkitStates', { first: 4, after: '8' })).data.workflowStates
  assert.equal(last.nodes.length, 2)
  assert.equal(last.pageInfo.hasNextPage, false)
})

test('fakeWorkspace refuses and loops on request', async () => {
  const fetch = fakeLinearFetch(fakeWorkspace({ refuse: ['PmkitPlan'], endless: ['PmkitLabels'] }))
  assert.equal((await answer(fetch, 'PmkitPlan')).errors[0].extensions.code, 'FORBIDDEN')
  let after = null
  for (let index = 0; index < 3; index++) {
    const labels = (await answer(fetch, 'PmkitLabels', { first: 250, after })).data.issueLabels
    assert.equal(labels.pageInfo.hasNextPage, true)
    assert.notEqual(labels.pageInfo.endCursor, after)
    after = labels.pageInfo.endCursor
  }
})

test('fakeTriage answers the five triage operations and records them by name', async () => {
  const responsibility = { id: 'tr-1', action: 'assign', manualSelection: { userIds: ['user-2'], assignmentIndex: 0 }, timeSchedule: null, currentUser: { id: 'user-2', name: 'Ada Lovelace' } }
  const issues = [{ identifier: 'ACME-1', title: 'One', suggestions: { nodes: [] } }, { identifier: 'ACME-2', title: 'Two', suggestions: { nodes: [] } }]
  for (const subscription of [null, { type: 'Business' }]) {
    const fetch = fakeLinearFetch({ ...fakeWorkspace({ subscription }), ...fakeTriage({ responsibility, issues }) })
    const read = async (query, variables) => (await (await post(fetch, query, variables)).text().then(JSON.parse)).data
    assert.deepEqual((await read('query PmkitTriageShow($teamId: String!) { x }', { teamId: ACME_TEAM_ID })).team.triageResponsibility, responsibility)
    const found = (await read('query PmkitTriageSuggestions($first: Int!) { x }', { first: 1 })).issues
    assert.deepEqual(found.nodes.map((node) => node.identifier), ['ACME-1'])
    assert.equal(found.pageInfo.hasNextPage, true)
    const created = await read('mutation PmkitTriageCreate($input: TriageResponsibilityCreateInput!) { x }', {
      input: { teamId: ACME_TEAM_ID, action: 'notify', manualSelection: { userIds: ['user-2', 'user-3'], assignmentIndex: 1 } },
    })
    assert.deepEqual(created.triageResponsibilityCreate.triageResponsibility.currentUser, { id: 'user-3', name: 'Gone' })
    assert.equal(created.triageResponsibilityCreate.triageResponsibility.action, 'notify')
    const updated = await read('mutation PmkitTriageUpdate($id: String!, $input: TriageResponsibilityUpdateInput!) { x }', { id: 'tr-1', input: { action: 'notify' } })
    assert.equal(updated.triageResponsibilityUpdate.triageResponsibility.id, 'tr-1')
    assert.equal((await read('mutation PmkitTriageDelete($id: String!) { x }', { id: 'tr-1' })).triageResponsibilityDelete.success, true)
    assert.deepEqual(fetch.calls.map((call) => operationName(call.body.query)), ['PmkitTriageShow', 'PmkitTriageSuggestions', 'PmkitTriageCreate', 'PmkitTriageUpdate', 'PmkitTriageDelete'])
  }
})

const send = (fetch, query, variables) =>
  post(fetch, query, variables).then(async (response) => ({ status: response.status, body: response.status === 200 ? JSON.parse(await response.text()) : null }))
const idsOf = (body) => body.data.issues.nodes.map((node) => node.identifier)

function issueStore(options) {
  const fake = fakeLinearIssues(options)
  return { fake, fetch: fakeLinearFetch(fake.routes) }
}

test('the acme fixtures are exported for tests to extend', () => {
  assert.equal(ACME_TEAM.id, ACME_TEAM_ID)
  assert.equal(ACME_STATES.length, 10)
  assert.ok(ACME_LABELS.some((label) => label.name === 'Docs' && label.team === null))
  assert.ok(ACME_USERS.some((user) => user.id === 'user-1'))
})

test('create assigns identifiers, honors a client id, and records the mutation', async () => {
  const { fake, fetch } = issueStore()
  const first = await send(fetch, ISSUE_CREATE, { input: { id: 'uuid-1', teamId: 'team-acme', title: 'A' } })
  assert.equal(first.body.data.issueCreate.issue.identifier, 'ACME-1')
  assert.equal(first.body.data.issueCreate.issue.id, 'uuid-1')
  assert.equal(first.body.data.issueCreate.issue.branchName, 'acme-1-a')
  assert.deepEqual(first.body.data.issueCreate.issue.state, { id: 'state-1', name: 'Backlog', type: 'backlog' })
  assert.equal(first.body.data.issueCreate.issue.createdAt, '2026-10-27T12:00:01.000Z')
  const second = await send(fetch, ISSUE_CREATE, { input: { teamId: 'team-acme', title: 'B', stateId: 'state-2', labelIds: ['label-bug'] } })
  assert.equal(second.body.data.issueCreate.issue.identifier, 'ACME-2')
  assert.equal(second.body.data.issueCreate.issue.state.name, 'Todo')
  assert.deepEqual(second.body.data.issueCreate.issue.labels.nodes, [{ id: 'label-bug', name: 'Bug', parent: null }])
  assert.deepEqual(fake.mutations, ['PmkitIssueCreate', 'PmkitIssueCreate'])
  assert.equal(fake.nodes().length, 2)
})

test('an unknown input field fails with GRAPHQL_VALIDATION_FAILED', async () => {
  const { fetch } = issueStore()
  const { body } = await send(fetch, ISSUE_CREATE, { input: { teamId: 'team-acme', title: 'A', branch: 'x' } })
  assert.equal(body.errors[0].extensions.code, 'GRAPHQL_VALIDATION_FAILED')
})

test('by id matches lowercase identifiers, UUIDs and archived issues; a missing one is an empty list', async () => {
  const { fake, fetch } = issueStore()
  fake.seed({ id: 'uuid-1', title: 'One' })
  await send(fetch, ISSUE_ARCHIVE, { id: 'ACME-1' })
  assert.deepEqual(idsOf((await send(fetch, ISSUE_BY_ID_QUERY, { id: 'acme-1' })).body), ['ACME-1'])
  assert.deepEqual(idsOf((await send(fetch, ISSUE_BY_ID_QUERY, { id: 'uuid-1' })).body), ['ACME-1'])
  assert.deepEqual(idsOf((await send(fetch, ISSUE_BY_ID_QUERY, { id: 'ACME-99' })).body), [])
})

test('search filters, sorts oldest first and pages by first and after', async () => {
  const { fake, fetch } = issueStore()
  for (const title of ['Alpha', 'Beta', 'Gamma']) fake.seed({ title })
  const sort = [{ createdAt: { order: 'Ascending' } }]
  const one = (await send(fetch, ISSUES_QUERY, { filter: { and: [{ team: { key: { eq: 'ACME' } } }] }, first: 2, sort })).body.data.issues
  assert.deepEqual(one.nodes.map((node) => node.identifier), ['ACME-1', 'ACME-2'])
  assert.deepEqual(one.pageInfo, { hasNextPage: true, endCursor: '2' })
  const two = (await send(fetch, ISSUES_QUERY, { filter: { and: [] }, first: 2, after: '2', sort })).body.data.issues
  assert.deepEqual(two.nodes.map((node) => node.identifier), ['ACME-3'])
  assert.equal(two.pageInfo.hasNextPage, false)
  const newest = (await send(fetch, ISSUES_QUERY, { first: 5, sort: [{ createdAt: { order: 'Descending' } }] })).body
  assert.deepEqual(idsOf(newest), ['ACME-3', 'ACME-2', 'ACME-1'])
  const text = { or: [{ title: { containsIgnoreCase: 'ET' } }, { description: { containsIgnoreCase: 'ET' } }] }
  assert.deepEqual(idsOf((await send(fetch, ISSUES_QUERY, { filter: { and: [text] }, first: 5, sort })).body), ['ACME-2'])
})

test('search evaluates every clause pmkit sends', async () => {
  const { fake, fetch } = issueStore()
  fake.seed({ title: 'A', stateId: 'state-3', assigneeId: 'user-2', labelIds: ['label-bug', 'label-xs'] })
  fake.seed({ title: 'B', parentId: 'ACME-1' })
  const sort = [{ createdAt: { order: 'Ascending' } }]
  const find = async (clause) => idsOf((await send(fetch, ISSUES_QUERY, { filter: { and: [clause] }, first: 10, sort })).body)
  assert.deepEqual(await find({ id: { in: ['acme-2'] } }), ['ACME-2'])
  assert.deepEqual(await find({ state: { id: { in: ['state-3'] } } }), ['ACME-1'])
  assert.deepEqual(await find({ labels: { some: { name: { in: ['Bug'] } } } }), ['ACME-1'])
  assert.deepEqual(await find({ labels: { some: { name: { eq: 'XS' } } } }), ['ACME-1'])
  assert.deepEqual(await find({ assignee: { id: { eq: 'user-2' } } }), ['ACME-1'])
  assert.deepEqual(await find({ assignee: { null: true } }), ['ACME-2'])
  assert.deepEqual(await find({ parent: { id: { eq: 'ACME-1' } } }), ['ACME-2'])
  assert.deepEqual(await find({ hasBlockedByRelations: { eq: true } }), [])
  assert.deepEqual(await find({ updatedAt: { gt: '2026-10-27T12:00:01.500Z' } }), ['ACME-2'])
  assert.deepEqual(await find({ updatedAt: { lt: '2026-10-27T12:00:01.500Z' } }), ['ACME-1'])
})

test('an unknown filter key fails with GRAPHQL_VALIDATION_FAILED', async () => {
  const { fetch } = issueStore()
  const { body } = await send(fetch, ISSUES_QUERY, { filter: { and: [{ priority: { eq: 1 } }] }, first: 5 })
  assert.equal(body.errors[0].extensions.code, 'GRAPHQL_VALIDATION_FAILED')
  assert.equal(body.errors[0].message, 'Unknown filter priority')
})

test('update sets state, assignee, labels, parent and clears with null', async () => {
  const { fake, fetch } = issueStore()
  fake.seed({ id: 'uuid-1', title: 'Parent' })
  fake.seed({ title: 'Child', assigneeId: 'user-2' })
  const input = { stateId: 'state-8', assigneeId: null, labelIds: ['label-feature'], parentId: 'uuid-1', title: 'Renamed', priority: 2, dueDate: '2026-11-01' }
  const issue = (await send(fetch, ISSUE_UPDATE, { id: 'ACME-2', input })).body.data.issueUpdate.issue
  assert.equal(issue.state.name, 'Done')
  assert.equal(issue.assignee, null)
  assert.deepEqual(issue.labels.nodes.map((label) => label.name), ['Feature'])
  assert.deepEqual(issue.parent, { identifier: 'ACME-1' })
  assert.equal(issue.title, 'Renamed')
  assert.equal(issue.priority, 2)
  assert.equal(issue.dueDate, '2026-11-01')
  assert.equal(issue.updatedAt, '2026-10-27T12:00:03.000Z')
  const parent = (await send(fetch, ISSUE_BY_ID_QUERY, { id: 'ACME-1' })).body.data.issues.nodes[0]
  assert.deepEqual(parent.children.nodes, [{ identifier: 'ACME-2' }])
  const cleared = (await send(fetch, ISSUE_UPDATE, { id: 'ACME-2', input: { parentId: null, dueDate: null } })).body.data.issueUpdate.issue
  assert.equal(cleared.parent, null)
  assert.equal(cleared.dueDate, null)
})

test('a mutation on an unknown issue answers INPUT_ERROR', async () => {
  const { fetch } = issueStore()
  const { body } = await send(fetch, ISSUE_UPDATE, { id: 'ACME-9', input: { title: 'x' } })
  assert.equal(body.errors[0].extensions.code, 'INPUT_ERROR')
  assert.equal(body.errors[0].message, 'Could not find referenced Issue.')
})

test('archive hides the issue from search without includeArchived', async () => {
  const { fake, fetch } = issueStore()
  fake.seed({ title: 'Kept' })
  fake.seed({ title: 'Gone' })
  assert.equal((await send(fetch, ISSUE_ARCHIVE, { id: 'ACME-2' })).body.data.issueArchive.success, true)
  assert.deepEqual(idsOf((await send(fetch, ISSUES_QUERY, { first: 5, sort: [{ createdAt: { order: 'Ascending' } }] })).body), ['ACME-1'])
  const all = (await send(fetch, ISSUES_QUERY, { first: 5, includeArchived: true, sort: [{ createdAt: { order: 'Ascending' } }] })).body
  assert.deepEqual(idsOf(all), ['ACME-1', 'ACME-2'])
  assert.notEqual(all.data.issues.nodes[1].archivedAt, null)
})

test('nested connections page at nestedPage and the page documents read the rest', async () => {
  const { fake, fetch } = issueStore({ nestedPage: 1 })
  fake.seed({ id: 'uuid-1', title: 'Two labels', labelIds: ['label-docs', 'label-s'] })
  const node = (await send(fetch, ISSUE_BY_ID_QUERY, { id: 'ACME-1' })).body.data.issues.nodes[0]
  assert.deepEqual(node.labels.nodes.map((label) => label.name), ['Docs'])
  assert.deepEqual(node.labels.pageInfo, { hasNextPage: true, endCursor: '1' })
  const rest = (await send(fetch, NESTED_PAGES.labels, { id: 'uuid-1', first: 50, after: '1' })).body.data.issue.labels
  assert.deepEqual(rest.nodes, [{ id: 'label-s', name: 'S', parent: { name: 'Size' } }])
  assert.equal(rest.pageInfo.hasNextPage, false)
})

test('unconfirm answers 502 once, with or without applying', async () => {
  const { fake, fetch } = issueStore()
  fake.unconfirm('PmkitIssueCreate', { applied: true })
  assert.equal((await send(fetch, ISSUE_CREATE, { input: { teamId: 'team-acme', title: 'A' } })).status, 502)
  assert.equal(fake.nodes().length, 1)
  fake.unconfirm('PmkitIssueCreate', { applied: false })
  assert.equal((await send(fetch, ISSUE_CREATE, { input: { teamId: 'team-acme', title: 'B' } })).status, 502)
  assert.equal(fake.nodes().length, 1)
  assert.equal((await send(fetch, ISSUE_CREATE, { input: { teamId: 'team-acme', title: 'C' } })).status, 200)
  assert.deepEqual(fake.mutations, ['PmkitIssueCreate', 'PmkitIssueCreate', 'PmkitIssueCreate'])
})

test('a relation shows on both issues and goes away on delete', async () => {
  const { fake, fetch } = issueStore()
  fake.seed({ id: 'uuid-1', title: 'A' })
  fake.seed({ id: 'uuid-2', title: 'B', stateId: 'state-8' })
  const created = await send(fetch, RELATION_CREATE, { input: { id: 'rel-1', type: 'blocks', issueId: 'uuid-1', relatedIssueId: 'uuid-2' } })
  assert.deepEqual(created.body.data.issueRelationCreate, { success: true, issueRelation: { id: 'rel-1' } })
  const byId = async (id) => (await send(fetch, ISSUE_BY_ID_QUERY, { id })).body.data.issues.nodes[0]
  assert.deepEqual((await byId('ACME-1')).relations.nodes, [{ id: 'rel-1', type: 'blocks', relatedIssue: { identifier: 'ACME-2', state: { id: 'state-8', type: 'completed' } } }])
  assert.deepEqual((await byId('ACME-2')).inverseRelations.nodes, [{ id: 'rel-1', type: 'blocks', issue: { identifier: 'ACME-1', state: { id: 'state-1', type: 'backlog' } } }])
  const second = await send(fetch, RELATION_CREATE, { input: { type: 'related', issueId: 'ACME-2', relatedIssueId: 'ACME-1' } })
  assert.equal(second.body.data.issueRelationCreate.issueRelation.id, 'relation-1')
  assert.equal((await send(fetch, RELATION_DELETE, { id: 'rel-1' })).body.data.issueRelationDelete.success, true)
  assert.deepEqual((await byId('ACME-1')).relations.nodes, [])
  assert.deepEqual((await byId('ACME-2')).inverseRelations.nodes, [])
  assert.equal((await send(fetch, RELATION_DELETE, { id: 'rel-1' })).body.errors[0].extensions.code, 'INPUT_ERROR')
  assert.deepEqual(fake.mutations, ['PmkitRelationCreate', 'PmkitRelationCreate', 'PmkitRelationDelete', 'PmkitRelationDelete'])
})

test('a relation to a missing issue answers INPUT_ERROR', async () => {
  const { fake, fetch } = issueStore()
  fake.seed({ title: 'A' })
  const { body } = await send(fetch, RELATION_CREATE, { input: { type: 'blocks', issueId: 'ACME-1', relatedIssueId: 'ACME-9' } })
  assert.equal(body.errors[0].extensions.code, 'INPUT_ERROR')
})

test('the block graph returns the blocks relations of the ids', async () => {
  const { fake, fetch } = issueStore()
  for (const title of ['A', 'B', 'C']) fake.seed({ title })
  fake.relate('blocks', 'ACME-1', 'ACME-2')
  fake.relate('related', 'ACME-1', 'ACME-3')
  fake.relate('blocks', 'ACME-2', 'ACME-3')
  const nodes = (await send(fetch, BLOCK_GRAPH_QUERY, { ids: ['ACME-1', 'acme-2'] })).body.data.issues.nodes
  assert.deepEqual(nodes.map((node) => [node.identifier, node.relations.nodes.map((item) => `${item.type}:${item.relatedIssue.identifier}`)]), [
    ['ACME-1', ['blocks:ACME-2', 'related:ACME-3']],
    ['ACME-2', ['blocks:ACME-3']],
  ])
})

test('the parent chain nests the ancestors', async () => {
  const { fake, fetch } = issueStore()
  fake.seed({ title: 'A' })
  fake.seed({ title: 'B', parentId: 'ACME-1' })
  fake.seed({ title: 'C', parentId: 'ACME-2' })
  const [node] = (await send(fetch, PARENT_CHAIN_QUERY, { id: 'ACME-3' })).body.data.issues.nodes
  assert.deepEqual(node, { identifier: 'ACME-3', parent: { identifier: 'ACME-2', parent: { identifier: 'ACME-1', parent: null } } })
})

test('hasBlockedByRelations filters on inverse blocks relations', async () => {
  const { fake, fetch } = issueStore()
  for (const title of ['A', 'B', 'C']) fake.seed({ title })
  fake.relate('blocks', 'ACME-1', 'ACME-2')
  fake.relate('related', 'ACME-1', 'ACME-3')
  const find = async (eq) => idsOf((await send(fetch, ISSUES_QUERY, { filter: { and: [{ hasBlockedByRelations: { eq } }] }, first: 10, sort: [{ createdAt: { order: 'Ascending' } }] })).body)
  assert.deepEqual(await find(true), ['ACME-2'])
  assert.deepEqual(await find(false), ['ACME-1', 'ACME-3'])
})

test('unconfirm works for a relation create', async () => {
  const { fake, fetch } = issueStore()
  fake.seed({ title: 'A' })
  fake.seed({ title: 'B' })
  fake.unconfirm('PmkitRelationCreate', { applied: true })
  assert.equal((await send(fetch, RELATION_CREATE, { input: { id: 'rel-x', type: 'related', issueId: 'ACME-1', relatedIssueId: 'ACME-2' } })).status, 502)
  assert.deepEqual(fake.relations.map((relation) => relation.id), ['rel-x'])
})

const commentsOf = async (fetch, id) => (await send(fetch, ISSUE_COMMENTS_QUERY, { id, first: 50, after: null })).body.data.issue.comments

test('comments: create honors the client id and parent, and the list is newest first', async () => {
  const { fake, fetch } = issueStore()
  fake.seed({ title: 'A' })
  const root = (await send(fetch, COMMENT_CREATE, { input: { id: 'c-1', issueId: 'issue-1', body: 'Question' } })).body.data.commentCreate
  assert.equal(root.success, true)
  assert.deepEqual(root.comment, {
    id: 'c-1', createdAt: root.comment.createdAt, body: 'Question', user: { id: 'user-1' }, botActor: null, externalUser: null,
    parentId: null, resolvedAt: null, resolvingUser: null, issue: { identifier: 'ACME-1' },
  })
  const reply = (await send(fetch, COMMENT_CREATE, { input: { id: 'c-2', issueId: 'ACME-1', body: 'Answer', parentId: 'c-1' } })).body.data.commentCreate.comment
  assert.equal(reply.parentId, 'c-1')
  const nested = await send(fetch, COMMENT_CREATE, { input: { id: 'c-3', issueId: 'ACME-1', body: 'More', parentId: 'c-2' } })
  assert.equal(nested.body.errors[0].extensions.code, 'INPUT_ERROR')
  assert.deepEqual((await commentsOf(fetch, 'issue-1')).nodes.map((c) => c.id), ['c-2', 'c-1'])
  assert.deepEqual(fake.mutations, ['PmkitCommentCreate', 'PmkitCommentCreate', 'PmkitCommentCreate'])
})

test('comments: an unknown issue is refused and the list pages', async () => {
  const { fake, fetch } = issueStore({ nestedPage: 2 })
  fake.seed({ title: 'A' })
  assert.equal((await send(fetch, COMMENT_CREATE, { input: { issueId: 'ACME-9', body: 'x' } })).body.errors[0].extensions.code, 'INPUT_ERROR')
  for (const id of ['c-1', 'c-2', 'c-3']) fake.comment('ACME-1', { id, body: id })
  const first = (await send(fetch, ISSUE_COMMENTS_QUERY, { id: 'ACME-1', first: 2, after: null })).body.data.issue.comments
  assert.deepEqual([first.nodes.map((c) => c.id), first.pageInfo.hasNextPage], [['c-3', 'c-2'], true])
  const second = (await send(fetch, ISSUE_COMMENTS_QUERY, { id: 'ACME-1', first: 2, after: first.pageInfo.endCursor })).body.data.issue.comments
  assert.deepEqual([second.nodes.map((c) => c.id), second.pageInfo.hasNextPage], [['c-1'], false])
})

test('comments: resolve marks a root, refuses a reply, and CommentById finds or misses', async () => {
  const { fake, fetch } = issueStore()
  fake.seed({ title: 'A' })
  fake.comment('ACME-1', { id: 'c-1', body: 'Q' })
  fake.comment('ACME-1', { id: 'c-2', body: 'A', parentId: 'c-1' })
  const refused = await send(fetch, COMMENT_RESOLVE, { id: 'c-2' })
  assert.equal(refused.body.errors[0].extensions.code, 'INPUT_ERROR')
  const done = (await send(fetch, COMMENT_RESOLVE, { id: 'c-1' })).body.data.commentResolve.comment
  assert.equal(done.resolvingUser.id, 'user-1')
  assert.equal(typeof done.resolvedAt, 'string')
  assert.deepEqual((await send(fetch, COMMENT_BY_ID_QUERY, { id: 'c-1' })).body.data.comments.nodes.map((c) => [c.id, c.issue.identifier]), [['c-1', 'ACME-1']])
  assert.deepEqual((await send(fetch, COMMENT_BY_ID_QUERY, { id: 'nope' })).body.data.comments.nodes, [])
})

test('comments: seeding records no mutation, and an applied unconfirmed create leaves the comment readable', async () => {
  const { fake, fetch } = issueStore()
  fake.seed({ title: 'A' })
  fake.comment('ACME-1', { id: 'bot', body: 'Hi', userId: null, botActor: { type: 'github', name: 'GitHub' } })
  assert.deepEqual(fake.mutations, [])
  fake.unconfirm('PmkitCommentCreate', { applied: true })
  assert.equal((await send(fetch, COMMENT_CREATE, { input: { id: 'c-9', issueId: 'ACME-1', body: 'x' } })).status, 502)
  assert.deepEqual((await send(fetch, COMMENT_BY_ID_QUERY, { id: 'c-9' })).body.data.comments.nodes.map((c) => c.id), ['c-9'])
  assert.equal(fake.comments.length, 2)
})

const historyOf = async (fetch, id, variables = {}) => (await send(fetch, ISSUE_HISTORY_QUERY, { id, first: 50, after: null, ...variables })).body.data.issue

test('history: an update with two fields is one entry, creation has none, and the list is newest first', async () => {
  const { fake, fetch } = issueStore()
  fake.seed({ title: 'A' })
  assert.deepEqual((await historyOf(fetch, 'ACME-1')).history.nodes, [])
  await send(fetch, ISSUE_UPDATE, { id: 'ACME-1', input: { stateId: 'state-3', assigneeId: 'user-2' } })
  await send(fetch, ISSUE_UPDATE, { id: 'ACME-1', input: { title: 'B', priority: 2, labelIds: ['label-bug'] } })
  await send(fetch, ISSUE_UPDATE, { id: 'ACME-1', input: { title: 'B' } })
  const issue = await historyOf(fetch, 'ACME-1')
  assert.deepEqual(issue.creator, { id: 'user-1' })
  assert.equal(issue.botActor, null)
  const [newer, older] = issue.history.nodes
  assert.ok(newer.createdAt > older.createdAt)
  assert.deepEqual([older.fromState.name, older.toState.name, older.fromAssigneeId, older.toAssigneeId], ['Backlog', 'In Progress', null, 'user-2'])
  assert.deepEqual([newer.fromTitle, newer.toTitle, newer.fromPriority, newer.toPriority], ['A', 'B', 0, 2])
  assert.deepEqual(newer.addedLabels, [{ id: 'label-bug', name: 'Bug', parent: null }])
  assert.equal(newer.fromState, null)
  assert.equal(issue.history.nodes.length, 2)
  assert.deepEqual(newer.actor, { id: 'user-1' })
})

test('history: archive and a related relation add entries, a blocks relation adds none', async () => {
  const { fake, fetch } = issueStore()
  fake.seed({ title: 'A' })
  fake.seed({ title: 'B' })
  await send(fetch, RELATION_CREATE, { input: { type: 'related', issueId: 'ACME-1', relatedIssueId: 'ACME-2' } })
  await send(fetch, RELATION_CREATE, { input: { type: 'blocks', issueId: 'ACME-1', relatedIssueId: 'ACME-2' } })
  await send(fetch, ISSUE_ARCHIVE, { id: 'ACME-1' })
  const first = (await historyOf(fetch, 'ACME-1')).history.nodes
  assert.equal(first[0].archived, true)
  assert.deepEqual(first[1].relationChanges, [{ identifier: 'ACME-2', type: 'ar' }])
  assert.equal(first.length, 2)
  assert.deepEqual((await historyOf(fetch, 'ACME-2')).history.nodes[0].relationChanges, [{ identifier: 'ACME-1', type: 'ar' }])
})

test('history: a seeded entry records no mutation and pages', async () => {
  const { fake, fetch } = issueStore({ nestedPage: 2 })
  fake.seed({ title: 'A' })
  for (const n of [1, 2, 3]) fake.history('ACME-1', { createdAt: `2026-09-0${n}T00:00:00.000Z`, actor: null, botActor: { type: 'github', name: 'GitHub' }, fromTeam: { id: `t${n}` } })
  assert.deepEqual(fake.mutations, [])
  const page1 = (await historyOf(fetch, 'ACME-1', { first: 2 })).history
  assert.deepEqual(page1.nodes.map((n) => n.createdAt.slice(0, 10)), ['2026-09-03', '2026-09-02'])
  assert.equal(page1.nodes[0].botActor.name, 'GitHub')
  assert.equal(page1.nodes[0].actor, null)
  assert.equal(page1.pageInfo.hasNextPage, true)
  const page2 = (await historyOf(fetch, 'ACME-1', { first: 2, after: page1.pageInfo.endCursor })).history
  assert.deepEqual([page2.nodes.length, page2.pageInfo.hasNextPage], [1, false])
})

test('events: issues come by updatedAt descending with gte, and the nested lists page and run newest first', async () => {
  const { fake, fetch } = issueStore({ nestedPage: 2 })
  fake.seed({ title: 'A' })
  fake.seed({ title: 'B' })
  for (const title of ['x', 'y', 'z']) await send(fetch, ISSUE_UPDATE, { id: 'ACME-1', input: { title } })
  fake.comment('ACME-1', { id: 'c-1', body: 'one' })
  fake.comment('ACME-1', { id: 'c-2', body: 'two' })
  fake.comment('ACME-1', { id: 'c-3', body: 'three' })
  const before = fake.mutations.length
  const all = (await send(fetch, ISSUE_EVENTS_QUERY, { first: 10, includeArchived: true, sort: [{ updatedAt: { order: 'Descending' } }] })).body.data.issues
  assert.deepEqual(all.nodes.map((n) => n.identifier), ['ACME-1', 'ACME-2'])
  const [a] = all.nodes
  assert.deepEqual(a.history.nodes.map((n) => n.toTitle), ['z', 'y'])
  assert.equal(a.history.pageInfo.hasNextPage, true)
  assert.deepEqual(a.comments.nodes.map((c) => c.id), ['c-3', 'c-2'])
  assert.equal(a.comments.pageInfo.hasNextPage, true)
  assert.deepEqual(a.creator, { id: 'user-1' })
  assert.equal(a.title, 'z')
  const since = a.updatedAt
  const filtered = (await send(fetch, ISSUE_EVENTS_QUERY, { first: 10, filter: { and: [{ team: { key: { eq: 'ACME' } } }, { updatedAt: { gte: since } }] } })).body.data.issues
  assert.deepEqual(filtered.nodes.map((n) => n.identifier), ['ACME-1'])
  const paged = (await send(fetch, ISSUE_EVENTS_QUERY, { first: 1 })).body.data.issues
  assert.deepEqual([paged.nodes.length, paged.pageInfo.hasNextPage], [1, true])
  assert.equal(fake.mutations.length, before)
})

test('events: archived issues need includeArchived', async () => {
  const { fake, fetch } = issueStore()
  fake.seed({ title: 'A' })
  await send(fetch, ISSUE_ARCHIVE, { id: 'ACME-1' })
  assert.equal((await send(fetch, ISSUE_EVENTS_QUERY, { first: 10 })).body.data.issues.nodes.length, 0)
  assert.equal((await send(fetch, ISSUE_EVENTS_QUERY, { first: 10, includeArchived: true })).body.data.issues.nodes.length, 1)
})

const CYCLES_TEAM = { ...ACME_TEAM, cyclesEnabled: true }
const OTHER_TEAM = { ...ACME_TEAM, id: 'team-ops', key: 'OPS', name: 'Ops', cyclesEnabled: true }
// Now is 2026-10-27T12:00Z: cycle 1 ended, cycle 2 runs, cycle 3 is ahead.
const CYCLES = [
  { number: 1, startsAt: '2026-10-05T00:00:00.000Z', endsAt: '2026-10-19T00:00:00.000Z', completedAt: '2026-10-19T00:00:00.000Z' },
  { number: 2, name: 'Autumn', description: 'Ship it', startsAt: '2026-10-19T00:00:00.000Z', endsAt: '2026-11-02T00:00:00.000Z' },
  { number: 3, startsAt: '2026-11-02T00:00:00.000Z', endsAt: '2026-11-16T00:00:00.000Z' },
]

function cycleStore(options = {}) {
  const fake = fakeLinearIssues({ teams: [CYCLES_TEAM, OTHER_TEAM], cycles: CYCLES, ...options })
  return { fake, fetch: fakeLinearFetch(fake.routes) }
}
const cycleNumbers = (body) => body.data.cycles.nodes.map((node) => node.number)
const teamFilter = (key) => ({ team: { key: { eq: key } } })

test('PmkitCycles returns the cycles of a team with flags computed from the clock', async () => {
  const { fetch } = cycleStore()
  const { body } = await send(fetch, CYCLES_QUERY, { filter: teamFilter('ACME'), first: 10 })
  assert.deepEqual(cycleNumbers(body), [1, 2, 3])
  const flags = body.data.cycles.nodes.map((node) => [node.isActive, node.isFuture, node.isPast])
  assert.deepEqual(flags, [[false, false, true], [true, false, false], [false, true, false]])
  const second = body.data.cycles.nodes[1]
  assert.deepEqual(Object.keys(second).sort(), ['completedAt', 'description', 'endsAt', 'id', 'isActive', 'isFuture', 'isPast', 'name', 'number', 'startsAt'])
  assert.equal(second.name, 'Autumn')
  assert.equal(body.data.cycles.nodes[0].name, null)
  assert.equal(body.data.cycles.nodes[0].description, null)
})

test('PmkitCycles honors the isActive, isFuture, isPast and team filters, and pages', async () => {
  const { fake, fetch } = cycleStore()
  fake.cycles.add({ number: 1, team: 'team-ops', startsAt: '2026-10-19T00:00:00.000Z', endsAt: '2026-11-02T00:00:00.000Z' })
  const find = async (clause, team = 'ACME') => cycleNumbers((await send(fetch, CYCLES_QUERY, { filter: { and: [teamFilter(team), clause] }, first: 10 })).body)
  assert.deepEqual(await find({ isActive: { eq: true } }), [2])
  assert.deepEqual(await find({ isFuture: { eq: true } }), [3])
  assert.deepEqual(await find({ isPast: { eq: true } }), [1])
  assert.deepEqual(await find({ isActive: { eq: true } }, 'OPS'), [1])
  assert.deepEqual(await find({ number: { eq: 3 } }), [3])
  const one = (await send(fetch, CYCLES_QUERY, { filter: teamFilter('ACME'), first: 2 })).body.data.cycles
  assert.deepEqual(one.nodes.map((node) => node.number), [1, 2])
  assert.deepEqual(one.pageInfo, { hasNextPage: true, endCursor: '2' })
  const two = (await send(fetch, CYCLES_QUERY, { filter: teamFilter('ACME'), first: 2, after: '2' })).body.data.cycles
  assert.deepEqual(two.nodes.map((node) => node.number), [3])
  assert.equal(two.pageInfo.hasNextPage, false)
})

test('the clock moves the flags', async () => {
  const { fake, fetch } = cycleStore()
  fake.cycles.setClock('2026-11-03T00:00:00.000Z')
  const active = await send(fetch, CYCLES_QUERY, { filter: { and: [teamFilter('ACME'), { isActive: { eq: true } }] }, first: 10 })
  assert.deepEqual(cycleNumbers(active.body), [3])
})

test('endsAt is an exclusive boundary: at the instant one cycle ends the next is active', async () => {
  const { fake, fetch } = cycleStore()
  const activeAt = async (instant) => {
    fake.cycles.setClock(instant)
    return cycleNumbers((await send(fetch, CYCLES_QUERY, { filter: { and: [teamFilter('ACME'), { isActive: { eq: true } }] }, first: 10 })).body)
  }
  assert.deepEqual(await activeAt('2026-11-01T23:59:59.999Z'), [2])
  assert.deepEqual(await activeAt('2026-11-02T00:00:00.000Z'), [3])
})

test('PmkitCycleByNumber returns the cycle with that number or an empty list', async () => {
  const { fetch } = cycleStore()
  const hit = await send(fetch, CYCLE_BY_NUMBER_QUERY, { filter: { and: [teamFilter('ACME'), { number: { eq: 2 } }] } })
  assert.deepEqual(cycleNumbers(hit.body), [2])
  const miss = await send(fetch, CYCLE_BY_NUMBER_QUERY, { filter: { and: [teamFilter('ACME'), { number: { eq: 99 } }] } })
  assert.deepEqual(cycleNumbers(miss.body), [])
})

test('a team with cycles off has no cycles', async () => {
  const fake = fakeLinearIssues({ teams: [ACME_TEAM], cycles: CYCLES })
  const fetch = fakeLinearFetch(fake.routes)
  assert.deepEqual(cycleNumbers((await send(fetch, CYCLES_QUERY, { filter: teamFilter('ACME'), first: 10 })).body), [])
})

test('an unknown cycle filter key fails with GRAPHQL_VALIDATION_FAILED', async () => {
  const { fetch } = cycleStore()
  const { body } = await send(fetch, CYCLES_QUERY, { filter: { and: [{ progress: { gt: 1 } }] }, first: 10 })
  assert.equal(body.errors[0].extensions.code, 'GRAPHQL_VALIDATION_FAILED')
})

test('the issue filter evaluates the cycle clauses', async () => {
  const { fake, fetch } = cycleStore()
  const [, two] = fake.cycles.list()
  fake.seed({ title: 'In two', cycleId: two.id })
  fake.seed({ title: 'Free' })
  const find = async (clause) => idsOf((await send(fetch, ISSUES_QUERY, { filter: { and: [clause] }, first: 10 })).body).sort()
  assert.deepEqual(await find({ cycle: { isActive: { eq: true } } }), ['ACME-1'])
  assert.deepEqual(await find({ cycle: { number: { eq: 2 } } }), ['ACME-1'])
  assert.deepEqual(await find({ cycle: { number: { eq: 3 } } }), [])
  assert.deepEqual(await find({ cycle: { null: true } }), ['ACME-2'])
  const { body } = await send(fetch, ISSUES_QUERY, { filter: { and: [{ cycle: { progress: { gt: 1 } } }] }, first: 10 })
  assert.equal(body.errors[0].extensions.code, 'GRAPHQL_VALIDATION_FAILED')
})

test('issues carry their cycle, and update sets and clears it', async () => {
  const { fake, fetch } = cycleStore()
  const [, two, three] = fake.cycles.list()
  fake.seed({ title: 'A' })
  assert.equal((await send(fetch, ISSUE_BY_ID_QUERY, { id: 'ACME-1' })).body.data.issues.nodes[0].cycle, null)
  const set = await send(fetch, ISSUE_UPDATE, { id: 'ACME-1', input: { cycleId: two.id } })
  assert.deepEqual(set.body.data.issueUpdate.issue.cycle, { id: two.id, number: 2 })
  const moved = await send(fetch, ISSUE_UPDATE, { id: 'ACME-1', input: { cycleId: three.id } })
  assert.equal(moved.body.data.issueUpdate.issue.cycle.number, 3)
  const cleared = await send(fetch, ISSUE_UPDATE, { id: 'ACME-1', input: { cycleId: null } })
  assert.equal(cleared.body.data.issueUpdate.issue.cycle, null)
})

test('create honors cycleId', async () => {
  const { fake, fetch } = cycleStore()
  const [, two] = fake.cycles.list()
  const created = await send(fetch, ISSUE_CREATE, { input: { teamId: 'team-acme', title: 'A', cycleId: two.id } })
  assert.equal(created.body.data.issueCreate.issue.cycle.number, 2)
})

test('a cycle of another team, or an unknown cycle, gets an INPUT_ERROR', async () => {
  const { fake, fetch } = cycleStore()
  fake.cycles.add({ number: 7, team: 'team-ops', startsAt: '2026-10-19T00:00:00.000Z', endsAt: '2026-11-02T00:00:00.000Z' })
  const foreign = fake.cycles.list().find((cycle) => cycle.teamId === 'team-ops')
  fake.seed({ title: 'A' })
  const other = await send(fetch, ISSUE_UPDATE, { id: 'ACME-1', input: { cycleId: foreign.id } })
  assert.equal(other.body.errors[0].extensions.code, 'INPUT_ERROR')
  assert.match(other.body.errors[0].message, /another team|belong/i)
  const unknown = await send(fetch, ISSUE_UPDATE, { id: 'ACME-1', input: { cycleId: 'nope' } })
  assert.equal(unknown.body.errors[0].extensions.code, 'INPUT_ERROR')
  assert.equal(fake.nodes()[0].cycle, null)
})

const PROJECT = { id: 'proj-1', slugId: 'a1b2c3d4e5f6', identifier: 'P-ACM-1' }
const withProjects = (options) => {
  const store = issueStore(options)
  store.fake.useProjects({ byRef: (ref) => (ref === PROJECT.id || ref === PROJECT.slugId || String(ref).toUpperCase() === PROJECT.identifier ? PROJECT : undefined) })
  return store
}

test('without useProjects an issue has no project and no milestone', async () => {
  const { fake } = issueStore()
  const node = fake.seed({ title: 'A' })
  assert.equal(node.project, null)
  assert.equal(node.projectMilestone, null)
})

test('an issue created or updated with projectId reads back its project', async () => {
  const { fake, fetch } = withProjects()
  const created = (await send(fetch, ISSUE_CREATE, { input: { teamId: 'team-acme', title: 'A', projectId: 'proj-1', projectMilestoneId: 'milestone-1' } })).body.data.issueCreate.issue
  assert.deepEqual(created.project, PROJECT)
  assert.deepEqual(created.projectMilestone, { id: 'milestone-1' })
  fake.seed({ title: 'B' })
  const updated = (await send(fetch, ISSUE_UPDATE, { id: 'ACME-2', input: { projectId: 'P-ACM-1' } })).body.data.issueUpdate.issue
  assert.deepEqual(updated.project, PROJECT)
  const cleared = (await send(fetch, ISSUE_UPDATE, { id: 'ACME-2', input: { projectId: null } })).body.data.issueUpdate.issue
  assert.equal(cleared.project, null)
  const unknown = await send(fetch, ISSUE_UPDATE, { id: 'ACME-2', input: { projectId: 'proj-9' } })
  assert.equal(unknown.body.errors[0].extensions.code, 'INPUT_ERROR')
})

test('the project and parent filters match by project, null parent and a list of parents', async () => {
  const { fake, fetch } = withProjects()
  fake.seed({ id: 'uuid-1', title: 'Root', projectId: 'proj-1' })
  fake.seed({ title: 'Child', parentId: 'uuid-1', projectId: 'proj-1' })
  fake.seed({ title: 'Outside' })
  const find = async (clause) => idsOf((await send(fetch, ISSUES_QUERY, { filter: { and: [clause] }, first: 10, sort: [{ createdAt: { order: 'Ascending' } }] })).body)
  assert.deepEqual(await find({ project: { id: { eq: 'proj-1' } } }), ['ACME-1', 'ACME-2'])
  assert.deepEqual(await find({ parent: { null: true } }), ['ACME-1', 'ACME-3'])
  assert.deepEqual(await find({ parent: { id: { in: ['ACME-1', 'ACME-3'] } } }), ['ACME-2'])
  assert.deepEqual(await find({ parent: { id: { eq: 'ACME-1' } } }), ['ACME-2'])
  const unknown = await send(fetch, ISSUES_QUERY, { filter: { and: [{ projectMilestone: { id: { eq: 'x' } } }] }, first: 5 })
  assert.equal(unknown.body.errors[0].extensions.code, 'GRAPHQL_VALIDATION_FAILED')
})

function projectStore(options = {}) {
  const issues = fakeLinearIssues()
  const fake = fakeLinearProjects({ issues, ...options })
  return { issues, fake, fetch: fakeLinearFetch({ ...issues.routes, ...fake.routes }) }
}
const created = async (fetch, input) => (await send(fetch, PROJECT_CREATE, { input })).body.data.projectCreate.project
const projectsOf = async (fetch, filter, extra = {}) =>
  (await send(fetch, PROJECTS_QUERY, { filter, first: 50, withLists: false, ...extra })).body.data.projects

test('projectCreate makes a backlog project with an identifier and a slug', async () => {
  const { fake, fetch } = projectStore()
  const project = await created(fetch, { id: 'proj-uuid', name: 'Launch', teamIds: ['team-acme'], content: 'Body', startDate: '2026-11-01', targetDate: '2026-12-01' })
  assert.equal(project.id, 'proj-uuid')
  assert.equal(project.name, 'Launch')
  assert.equal(project.identifier, 'P-ACM-1')
  assert.match(project.slugId, /^[0-9a-f]{12}$/)
  assert.deepEqual(project.status, { id: 'project-status-backlog', name: 'Backlog', type: 'backlog' })
  assert.equal(project.health, null)
  assert.equal(project.progress, 0)
  assert.equal(project.content, 'Body')
  assert.equal(project.startDate, '2026-11-01')
  assert.equal((await created(fetch, { name: 'Second', teamIds: ['team-acme'] })).identifier, 'P-ACM-2')
  assert.deepEqual(fake.mutations, ['PmkitProjectCreate', 'PmkitProjectCreate'])
})

test('a project without identifiers has a null identifier', async () => {
  const { fetch } = projectStore({ identifiers: false })
  assert.equal((await created(fetch, { name: 'Plain', teamIds: ['team-acme'] })).identifier, null)
})

test('projectCreate answers a validation error for an unknown field and INPUT_ERROR for an unknown team', async () => {
  const { fetch } = projectStore()
  assert.equal((await send(fetch, PROJECT_CREATE, { input: { name: 'x', teamIds: ['team-acme'], lead: 'y' } })).body.errors[0].extensions.code, 'GRAPHQL_VALIDATION_FAILED')
  assert.equal((await send(fetch, PROJECT_CREATE, { input: { name: 'x', teamIds: ['team-gone'] } })).body.errors[0].extensions.code, 'INPUT_ERROR')
  assert.equal((await send(fetch, PROJECT_CREATE, { input: { teamIds: ['team-acme'] } })).body.errors[0].extensions.code, 'INPUT_ERROR')
})

test('projects are found by id (UUID or identifier in any case) or by slug, and a slug in id finds nothing', async () => {
  const { fetch } = projectStore()
  const project = await created(fetch, { id: 'proj-uuid', name: 'Launch', teamIds: ['team-acme'] })
  await created(fetch, { name: 'Other', teamIds: ['team-acme'] })
  const ids = async (filter) => (await projectsOf(fetch, filter)).nodes.map((node) => node.name)
  assert.deepEqual(await ids({ id: { eq: 'proj-uuid' } }), ['Launch'])
  assert.deepEqual(await ids({ id: { eq: 'p-acm-1' } }), ['Launch'])
  assert.deepEqual(await ids({ id: { eq: 'P-ACM-1' } }), ['Launch'])
  assert.deepEqual(await ids({ slugId: { eq: project.slugId } }), ['Launch'])
  assert.deepEqual(await ids({ id: { eq: project.slugId } }), [])
  assert.deepEqual(await ids({ accessibleTeams: { some: { key: { eq: 'ACME' } } } }), ['Launch', 'Other'])
  assert.deepEqual(await ids({ accessibleTeams: { some: { key: { eq: 'NOPE' } } } }), [])
  assert.equal((await send(fetch, PROJECTS_QUERY, { filter: { lead: { id: { eq: 'x' } } }, first: 5, withLists: false })).body.errors[0].extensions.code, 'GRAPHQL_VALIDATION_FAILED')
})

test('projects page by first and after', async () => {
  const { fetch } = projectStore()
  for (const name of ['A', 'B', 'C']) await created(fetch, { name, teamIds: ['team-acme'] })
  const first = await projectsOf(fetch, {}, { first: 2 })
  assert.deepEqual(first.nodes.map((node) => node.name), ['A', 'B'])
  assert.equal(first.pageInfo.hasNextPage, true)
  const second = await projectsOf(fetch, {}, { first: 2, after: first.pageInfo.endCursor })
  assert.deepEqual(second.nodes.map((node) => node.name), ['C'])
  assert.equal(second.pageInfo.hasNextPage, false)
})

test('a project update stores the update, sets the health and lists newest first', async () => {
  const { fake, fetch } = projectStore()
  await created(fetch, { id: 'proj-uuid', name: 'Launch', teamIds: ['team-acme'] })
  const first = (await send(fetch, PROJECT_UPDATE_CREATE, { input: { id: 'up-1', projectId: 'proj-uuid', body: 'one', health: 'onTrack' } })).body.data.projectUpdateCreate.projectUpdate
  assert.equal(first.user.id, 'user-1')
  assert.equal(first.health, 'onTrack')
  assert.deepEqual(first.project, { id: 'proj-uuid', slugId: first.project.slugId, identifier: 'P-ACM-1' })
  await send(fetch, PROJECT_UPDATE_CREATE, { input: { id: 'up-2', projectId: 'P-ACM-1', body: 'two', health: 'atRisk' } })
  assert.equal((await projectsOf(fetch, { id: { eq: 'proj-uuid' } })).nodes[0].health, 'atRisk')
  const listed = (await send(fetch, PROJECT_UPDATES_QUERY, { id: 'proj-uuid', first: 50 })).body.data.project.projectUpdates
  assert.deepEqual(listed.nodes.map((node) => node.body), ['two', 'one'])
  const missing = await send(fetch, PROJECT_UPDATE_CREATE, { input: { id: 'up-3', projectId: 'nope', body: 'x', health: 'onTrack' } })
  assert.equal(missing.body.errors[0].extensions.code, 'INPUT_ERROR')
  assert.deepEqual(fake.mutations, ['PmkitProjectCreate', 'PmkitProjectUpdateCreate', 'PmkitProjectUpdateCreate', 'PmkitProjectUpdateCreate'])
})

test('two updates stamped the same second list in a stable order by id', async () => {
  const { fake, fetch } = projectStore()
  await created(fetch, { id: 'proj-uuid', name: 'Launch', teamIds: ['team-acme'] })
  fake.seedUpdate('proj-uuid', { id: 'b', body: 'b', health: 'onTrack', createdAt: '2026-10-28T10:00:00.000Z' })
  fake.seedUpdate('proj-uuid', { id: 'a', body: 'a', health: 'onTrack', createdAt: '2026-10-28T10:00:00.000Z' })
  const listed = (await send(fetch, PROJECT_UPDATES_QUERY, { id: 'proj-uuid', first: 50 })).body.data.project.projectUpdates
  assert.deepEqual(listed.nodes.map((node) => node.id), ['a', 'b'])
})

test('seeded milestones and documents are listed, read by id and found by slug', async () => {
  const { fake, fetch } = projectStore()
  await created(fetch, { id: 'proj-uuid', name: 'Launch', teamIds: ['team-acme'] })
  fake.seedMilestone('proj-uuid', { id: 'm-2', name: 'Beta', targetDate: '2026-12-01', status: 'unstarted' })
  fake.seedMilestone('P-ACM-1', { id: 'm-1', name: 'Alpha', targetDate: '2026-11-01', status: 'next', progress: 0.5 })
  fake.seedDocument('proj-uuid', { slugId: 'abcdef012345', title: 'Plan', content: '# Plan' })
  const milestones = (await send(fetch, PROJECT_MILESTONES_QUERY, { first: 50 })).body.data.projectMilestones.nodes
  assert.deepEqual(milestones.map((node) => node.id), ['m-2', 'm-1'])
  assert.equal(milestones[0].project.identifier, 'P-ACM-1')
  assert.equal(milestones[1].progress, 0.5)
  assert.equal((await send(fetch, PROJECT_MILESTONE_QUERY, { id: 'm-1' })).body.data.projectMilestone.name, 'Alpha')
  const missing = await send(fetch, PROJECT_MILESTONE_QUERY, { id: 'm-9' })
  assert.equal(missing.body.errors[0].extensions.code, 'INPUT_ERROR')
  assert.match(missing.body.errors[0].message, /not found/i)
  const documents = (await send(fetch, DOCUMENT_QUERY, { filter: { slugId: { eq: 'abcdef012345' } } })).body.data.documents.nodes
  assert.equal(documents[0].title, 'Plan')
  assert.equal(documents[0].project.slugId, (await projectsOf(fetch, {})).nodes[0].slugId)
  assert.deepEqual((await send(fetch, DOCUMENT_QUERY, { filter: { slugId: { eq: 'ffffffffffff' } } })).body.data.documents.nodes, [])
  const withLists = (await projectsOf(fetch, {}, { withLists: true })).nodes[0]
  assert.deepEqual(withLists.projectMilestones.nodes.map((node) => node.id), ['m-2', 'm-1'])
  assert.deepEqual(withLists.documents.nodes, [{ slugId: 'abcdef012345', title: 'Plan' }])
  assert.equal('projectMilestones' in (await projectsOf(fetch, {})).nodes[0], false)
})

test('PmkitEpicIssues answers over the issue store and progress is the share of done issues', async () => {
  const { issues, fetch } = projectStore()
  await created(fetch, { id: 'proj-uuid', name: 'Launch', teamIds: ['team-acme'] })
  issues.seed({ title: 'A', projectId: 'proj-uuid', stateId: 'state-8' })
  issues.seed({ title: 'B', projectId: 'proj-uuid' })
  issues.seed({ title: 'C' })
  const found = (await send(fetch, EPIC_ISSUES_QUERY, { filter: { project: { id: { eq: 'proj-uuid' } } }, first: 10 })).body.data.issues.nodes
  assert.deepEqual(found.map((node) => node.identifier).sort(), ['ACME-1', 'ACME-2'])
  assert.equal((await projectsOf(fetch, {})).nodes[0].progress, 0.5)
})

test('mutations lists the project mutations after a call, and unconfirm answers 502 after applying', async () => {
  const { fake, fetch } = projectStore()
  assert.deepEqual(fake.mutations, [])
  await created(fetch, { id: 'proj-uuid', name: 'Launch', teamIds: ['team-acme'] })
  fake.unconfirm('PmkitProjectUpdateCreate', { applied: true })
  const answer = await send(fetch, PROJECT_UPDATE_CREATE, { input: { id: 'up-1', projectId: 'proj-uuid', body: 'x', health: 'onTrack' } })
  assert.equal(answer.status, 502)
  const listed = (await send(fetch, PROJECT_UPDATES_QUERY, { id: 'proj-uuid', first: 50 })).body.data.project.projectUpdates
  assert.deepEqual(listed.nodes.map((node) => node.id), ['up-1'])
  fake.unconfirm('PmkitProjectCreate', { applied: false })
  assert.equal((await send(fetch, PROJECT_CREATE, { input: { name: 'Lost', teamIds: ['team-acme'] } })).status, 502)
  assert.equal((await projectsOf(fetch, {})).nodes.length, 1)
})
