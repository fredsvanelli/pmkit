import assert from 'node:assert/strict'
import test from 'node:test'
import { ACME_LABELS, ACME_STATES, ACME_TEAM, ACME_TEAM_ID, ACME_USERS, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeTriage, fakeWorkspace, json, page } from './fake-linear-api.mjs'
import {
  BLOCK_GRAPH_QUERY, COMMENT_BY_ID_QUERY, COMMENT_CREATE, COMMENT_RESOLVE, ISSUE_COMMENTS_QUERY, ISSUE_EVENTS_QUERY, ISSUE_HISTORY_QUERY, ISSUES_QUERY, ISSUE_ARCHIVE, ISSUE_BY_ID_QUERY, ISSUE_CREATE, ISSUE_UPDATE, NESTED_PAGES, PARENT_CHAIN_QUERY, RELATION_CREATE, RELATION_DELETE,
} from './lib/linear/documents.mjs'
import { operationName } from './lib/linear/client.mjs'

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
