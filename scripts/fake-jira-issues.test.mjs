// Tests of the stateful fake Jira for work items: the routes Tasks 8 to 13 of PMK-77 call, through fakeJiraFetch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeJiraFetch } from './fake-jira-api.mjs'
import { fakeJiraIssues } from './fake-jira-issues.mjs'
import { textToAdf } from './lib/jira/adf.mjs'

const BASE = 'https://acme.atlassian.net'

function setup(options) {
  const fake = fakeJiraIssues(options)
  const fetch = fakeJiraFetch(fake.routes)
  async function api(method, path, body) {
    const init = { method, headers: { 'content-type': 'application/json' } }
    if (body !== undefined) init.body = JSON.stringify(body)
    const response = await fetch(`${BASE}${path}`, init)
    const text = await response.text()
    return { status: response.status, json: text ? JSON.parse(text) : undefined }
  }
  const create = (fields) => api('POST', '/rest/api/3/issue', { fields: { project: { key: 'ENG' }, issuetype: { id: '10001' }, ...fields } })
  const read = async (key) => (await api('GET', `/rest/api/3/issue/${key}`)).json
  const search = async (jql, query = '') => api('GET', `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}${query}`)
  return { fake, fetch, api, create, read, search }
}

const keysOf = (response) => response.json.issues.map((item) => item.key)

test('create answers ENG-1 in To Do and the item reads back with its fields', async () => {
  const { create, read, api } = setup()
  const made = await create({ summary: 'First', description: textToAdf('Hello'), labels: ['x'], priority: { id: '2' }, assignee: { accountId: 'acc-2' }, duedate: '2026-12-01', customfield_10016: 3 })
  assert.equal(made.status, 201)
  assert.deepEqual([made.json.key, made.json.id], ['ENG-1', '10001'])
  const item = await read('eng-1')
  assert.equal(item.key, 'ENG-1')
  assert.equal(item.fields.summary, 'First')
  assert.deepEqual(item.fields.status, { id: '1', name: 'To Do', statusCategory: { key: 'new' } })
  assert.deepEqual(item.fields.issuetype, { id: '10001', name: 'Story' })
  assert.deepEqual(item.fields.priority, { id: '2', name: 'High' })
  assert.deepEqual(item.fields.assignee, { accountId: 'acc-2', displayName: 'Second User' })
  assert.deepEqual(item.fields.labels, ['x'])
  assert.equal(item.fields.parent, null)
  assert.deepEqual(item.fields.subtasks, [])
  assert.deepEqual(item.fields.issuelinks, [])
  assert.equal(item.fields.duedate, '2026-12-01')
  assert.equal(item.fields.customfield_10016, 3)
  assert.deepEqual(item.fields.creator, { accountId: 'acc-1' })
  assert.equal(item.fields.created, '2026-11-22T10:00:00.000+0000')
  assert.equal(item.fields.description.type, 'doc')
  assert.equal((await api('GET', '/rest/api/3/issue/ENG-9')).status, 404)
})

test('create without a summary answers 400, and a wrong space or work type too', async () => {
  const { create, api } = setup()
  const none = await create({})
  assert.equal(none.status, 400)
  assert.deepEqual(none.json.errors, { summary: 'You must specify a summary of the issue.' })
  assert.equal((await create({ summary: 'x', project: { key: 'OPS' } })).status, 400)
  assert.equal((await api('POST', '/rest/api/3/issue', { fields: { project: { key: 'ENG' }, summary: 'x' } })).status, 400)
})

test('JQL labels and assignee is EMPTY filter; unknown JQL answers 400', async () => {
  const { create, search } = setup()
  await create({ summary: 'a', labels: ['x'] })
  await create({ summary: 'b', labels: ['x'], assignee: { accountId: 'acc-1' } })
  await create({ summary: 'c', labels: ['y'] })
  const found = await search('project = "ENG" AND labels = "x" AND assignee is EMPTY ORDER BY created ASC, key ASC')
  assert.equal(found.status, 200)
  assert.deepEqual(keysOf(found), ['ENG-1'])
  assert.equal(found.json.isLast, true)
  const bad = await search('project = ENG OR labels = "x"')
  assert.equal(bad.status, 400)
  assert.deepEqual(bad.json.errorMessages, ['fake Jira does not understand: project = ENG OR labels = "x"'])
})

test('every clause translateFilter emits is evaluated', async () => {
  const { create, search, api } = setup()
  await create({ summary: 'Epic', issuetype: { id: '10000' } })
  await create({ summary: 'Say "hi" here', parent: { key: 'ENG-1' }, assignee: { accountId: 'acc-1' } })
  await create({ summary: 'Other', description: textToAdf('Contains the Needle') })
  await api('POST', '/rest/api/3/issue/ENG-3/transitions', { transition: { id: 't3' } })
  const keys = async (clause) => keysOf(await search(`project = "ENG" AND ${clause} ORDER BY created ASC, key ASC`))
  assert.deepEqual(await keys('(summary ~ "needle" OR description ~ "needle")'), ['ENG-3'])
  assert.deepEqual(await keys('(summary ~ "say \\"hi\\"" OR description ~ "say \\"hi\\"")'), ['ENG-2'])
  assert.deepEqual(await keys('status in ("3", "5")'), ['ENG-3'])
  assert.deepEqual(await keys('issuetype in ("10000")'), ['ENG-1'])
  assert.deepEqual(await keys('assignee = "acc-1"'), ['ENG-2'])
  assert.deepEqual(await keys('parent = "eng-1"'), ['ENG-2'])
  assert.deepEqual(await keys('parent in ("ENG-1", "ENG-3")'), ['ENG-2'])
  assert.deepEqual(await keys('key in ("ENG-3", "ENG-1")'), ['ENG-1', 'ENG-3'])
  assert.deepEqual(await keys('updated >= "2026-11-22" AND updated < "2026-11-23"'), ['ENG-1', 'ENG-2', 'ENG-3'])
  assert.deepEqual(await keys('updated < "2026-11-22"'), [])
  assert.deepEqual(keysOf(await search('project = "OPS" ORDER BY created ASC, key ASC')), [])
  assert.deepEqual(keysOf(await search('project = "ENG" ORDER BY updated DESC')), ['ENG-3', 'ENG-2', 'ENG-1'])
  assert.equal((await search('project = "ENG" AND labels != "x"')).status, 400)
  assert.equal((await search('project = "ENG" ORDER BY summary ASC')).status, 400)
})

test('search pages by nextPageToken, returns asked properties and an inline changelog', async () => {
  const { create, search, api } = setup()
  for (const summary of ['a', 'b', 'c']) await create({ summary })
  await api('PUT', '/rest/api/3/issue/ENG-1/properties/pmkit.branch', 'feat/x')
  await api('PUT', '/rest/api/3/issue/ENG-1', { fields: { summary: 'A' } })
  const first = await search('project = "ENG" ORDER BY created ASC, key ASC', '&maxResults=2&properties=pmkit.branch&expand=changelog')
  assert.deepEqual(keysOf(first), ['ENG-1', 'ENG-2'])
  assert.equal(first.json.isLast, false)
  assert.deepEqual(first.json.issues[0].properties, { 'pmkit.branch': 'feat/x' })
  assert.deepEqual(first.json.issues[0].changelog.histories.map((history) => history.items[0].field), ['summary'])
  assert.equal(first.json.issues[0].changelog.total, 1)
  const second = await search('project = "ENG" ORDER BY created ASC, key ASC', `&maxResults=2&nextPageToken=${first.json.nextPageToken}`)
  assert.deepEqual(keysOf(second), ['ENG-3'])
  assert.equal(second.json.isLast, true)
  assert.equal(second.json.nextPageToken, undefined)
  assert.equal(second.json.issues[0].changelog, undefined)
})

test('PUT issue changes fields, records changelog items and bumps updated; parent null clears', async () => {
  const { create, read, api } = setup()
  await create({ summary: 'Epic', issuetype: { id: '10000' } })
  await create({ summary: 'Old', labels: ['a', 'b'], parent: { key: 'ENG-1' } })
  const put = await api('PUT', '/rest/api/3/issue/ENG-2', { fields: { summary: 'New', labels: ['b', 'c'], priority: { id: '5' }, parent: null, duedate: '2026-12-24', customfield_10016: 5 } })
  assert.equal(put.status, 204)
  const item = await read('ENG-2')
  assert.equal(item.fields.summary, 'New')
  assert.equal(item.fields.parent, null)
  assert.equal(item.fields.updated, '2026-11-22T10:00:02.000+0000')
  const log = (await api('GET', '/rest/api/3/issue/ENG-2/changelog')).json
  assert.equal(log.total, 1)
  const items = Object.fromEntries(log.values[0].items.map((change) => [change.fieldId ?? change.field, change]))
  assert.deepEqual([items.summary.fromString, items.summary.toString], ['Old', 'New'])
  assert.deepEqual([items.labels.fromString, items.labels.toString], ['a b', 'b c'])
  assert.deepEqual([items.priority.from, items.priority.toString], [null, 'Lowest'])
  assert.deepEqual([items.IssueParentAssociation.fromString, items.IssueParentAssociation.toString], ['ENG-1', null])
  assert.deepEqual([items.duedate.toString, items.customfield_10016.toString], ['2026-12-24', '5'])
  assert.equal(log.values[0].created, '2026-11-22T10:00:02.000+0000')
  assert.equal((await api('PUT', '/rest/api/3/issue/ENG-9', { fields: { summary: 'x' } })).status, 404)
})

test('assignee PUT sets and unassigns with assignee changelog items', async () => {
  const { create, read, api } = setup()
  await create({ summary: 'a' })
  assert.equal((await api('PUT', '/rest/api/3/issue/ENG-1/assignee', { accountId: 'acc-2' })).status, 204)
  assert.equal((await read('ENG-1')).fields.assignee.accountId, 'acc-2')
  await api('PUT', '/rest/api/3/issue/ENG-1/assignee', { accountId: null })
  assert.equal((await read('ENG-1')).fields.assignee, null)
  const log = (await api('GET', '/rest/api/3/issue/ENG-1/changelog')).json.values
  assert.deepEqual(log.map((history) => [history.items[0].field, history.items[0].from, history.items[0].to]), [['assignee', null, 'acc-2'], ['assignee', 'acc-2', null]])
})

test('transitions list every other status; Done asks for a resolution', async () => {
  const { create, read, api } = setup()
  await create({ summary: 'a' })
  const list = (await api('GET', '/rest/api/3/issue/ENG-1/transitions?expand=transitions.fields')).json.transitions
  assert.deepEqual(list.map((transition) => [transition.id, transition.to.name]), [['t3', 'In Progress'], ['t4', 'Review'], ['t5', 'Done']])
  const done = list.find((transition) => transition.id === 't5')
  assert.equal(done.hasScreen, true)
  assert.equal(done.fields.resolution.required, true)
  assert.deepEqual(done.fields.resolution.allowedValues.map((value) => value.id), ['10000', '10001'])
  assert.deepEqual(list[0].fields, {})
  const missing = await api('POST', '/rest/api/3/issue/ENG-1/transitions', { transition: { id: 't5' } })
  assert.equal(missing.status, 400)
  assert.deepEqual(missing.json.errors, { resolution: 'Resolution is required.' })
  assert.equal((await api('POST', '/rest/api/3/issue/ENG-1/transitions', { transition: { id: 't9' } })).status, 400)
  const ok = await api('POST', '/rest/api/3/issue/ENG-1/transitions', { transition: { id: 't5' }, fields: { resolution: { id: '10000' } } })
  assert.equal(ok.status, 204)
  assert.equal((await read('ENG-1')).fields.status.name, 'Done')
  const log = (await api('GET', '/rest/api/3/issue/ENG-1/changelog')).json.values
  assert.deepEqual(log.at(-1).items, [{ field: 'status', fieldId: 'status', fieldtype: 'jira', from: '1', fromString: 'To Do', to: '5', toString: 'Done' }])
})

test('without requireResolution the Done transition has no fields', async () => {
  const { create, read, api } = setup({ requireResolution: false })
  await create({ summary: 'p' })
  assert.equal((await create({ summary: 'orphan', issuetype: { id: '10003' } })).status, 400)
  await create({ summary: 'a', issuetype: { id: '10003' }, parent: { key: 'ENG-1' } })
  const list = (await api('GET', '/rest/api/3/issue/ENG-2/transitions')).json.transitions
  assert.deepEqual(list.map((transition) => [transition.id, transition.hasScreen, transition.fields]), [['t5', false, {}]])
  await api('POST', '/rest/api/3/issue/ENG-2/transitions', { transition: { id: 't5' } })
  assert.equal((await read('ENG-2')).fields.status.id, '5')
})

test('an issueLink shows on both items in the documented directions and deletes', async () => {
  const { create, read, api } = setup()
  await create({ summary: 'A' })
  await create({ summary: 'B' })
  const made = await api('POST', '/rest/api/3/issueLink', { type: { name: 'Blocks' }, inwardIssue: { key: 'ENG-1' }, outwardIssue: { key: 'ENG-2' } })
  assert.equal(made.status, 201)
  const [a] = (await read('ENG-1')).fields.issuelinks
  const [b] = (await read('ENG-2')).fields.issuelinks
  assert.deepEqual(a.type, { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' })
  assert.equal(a.outwardIssue.key, 'ENG-2')
  assert.equal(a.inwardIssue, undefined)
  assert.equal(a.outwardIssue.fields.status.name, 'To Do')
  assert.equal(b.inwardIssue.key, 'ENG-1')
  assert.equal(a.id, b.id)
  const linkLog = (await api('GET', '/rest/api/3/issue/ENG-2/changelog')).json.values
  assert.deepEqual(linkLog[0].items.map((change) => [change.field, change.to]), [['Link', 'ENG-1']])
  assert.equal((await api('DELETE', `/rest/api/3/issueLink/${a.id}`)).status, 204)
  assert.deepEqual((await read('ENG-1')).fields.issuelinks, [])
  const unlinkLog = (await api('GET', '/rest/api/3/issue/ENG-1/changelog')).json.values
  assert.deepEqual(unlinkLog.map((history) => [history.items[0].from, history.items[0].to]), [[null, 'ENG-2'], ['ENG-2', null]])
  assert.equal((await api('POST', '/rest/api/3/issueLink', { type: { name: 'Nope' }, inwardIssue: { key: 'ENG-1' }, outwardIssue: { key: 'ENG-2' } })).status, 404)
  assert.equal((await api('DELETE', '/rest/api/3/issueLink/999')).status, 404)
})

test('comments post and list; a subtask shows in its parent; delete drops links and comments', async () => {
  const { create, read, api, fake } = setup()
  await create({ summary: 'Parent' })
  await create({ summary: 'Sub', issuetype: { id: '10003' }, parent: { key: 'ENG-1' } })
  await create({ summary: 'Other' })
  assert.deepEqual((await read('ENG-1')).fields.subtasks.map((sub) => sub.key), ['ENG-2'])
  const posted = await api('POST', '/rest/api/3/issue/ENG-3/comment', { body: textToAdf('hi') })
  assert.equal(posted.status, 201)
  assert.deepEqual(posted.json.author, { accountId: 'acc-1' })
  const comments = (await api('GET', '/rest/api/3/issue/ENG-3/comment?orderBy=created')).json
  assert.deepEqual([comments.total, comments.comments[0].id], [1, posted.json.id])
  await api('POST', '/rest/api/3/issueLink', { type: { name: 'Relates' }, inwardIssue: { key: 'ENG-3' }, outwardIssue: { key: 'ENG-1' } })
  assert.equal((await api('DELETE', '/rest/api/3/issue/ENG-1')).status, 400)
  assert.equal((await api('DELETE', '/rest/api/3/issue/ENG-3')).status, 204)
  assert.equal((await api('GET', '/rest/api/3/issue/ENG-3')).status, 404)
  assert.deepEqual((await read('ENG-1')).fields.issuelinks, [])
  assert.deepEqual(fake.state.links, [])
  assert.equal(fake.state.comments['ENG-3'], undefined)
  assert.equal((await api('DELETE', '/rest/api/3/issue/ENG-1?deleteSubtasks=true')).status, 204)
  assert.equal((await api('GET', '/rest/api/3/issue/ENG-2')).status, 404)
})

test('the branch property sets, reads back and deletes', async () => {
  const { create, read, api } = setup()
  await create({ summary: 'a' })
  assert.equal((await api('PUT', '/rest/api/3/issue/ENG-1/properties/pmkit.branch', 'feat/a')).status, 201)
  assert.equal((await api('PUT', '/rest/api/3/issue/ENG-1/properties/pmkit.branch', 'feat/b')).status, 200)
  assert.deepEqual((await read('ENG-1')).properties, { 'pmkit.branch': 'feat/b' })
  assert.equal((await api('DELETE', '/rest/api/3/issue/ENG-1/properties/pmkit.branch')).status, 204)
  assert.equal((await read('ENG-1')).properties, undefined)
})

test('writes() lists the non-GET calls, and the state survives a JSON round trip', async () => {
  const first = setup()
  await first.create({ summary: 'a' })
  await first.api('POST', '/rest/api/3/issue/ENG-1/transitions', { transition: { id: 't3' } })
  await first.read('ENG-1')
  assert.deepEqual(first.fake.writes().map((call) => `${call.method} ${call.path}`), ['POST /rest/api/3/issue', 'POST /rest/api/3/issue/ENG-1/transitions'])
  assert.deepEqual(first.fake.writes()[1].body, { transition: { id: 't3' } })
  const state = JSON.parse(JSON.stringify(first.fake.state))
  const second = setup({ state })
  const made = await second.create({ summary: 'b' })
  assert.equal(made.json.key, 'ENG-2')
  assert.equal((await second.read('ENG-1')).fields.status.name, 'In Progress')
  assert.equal((await second.read('ENG-2')).fields.created, '2026-11-22T10:00:02.000+0000')
  assert.deepEqual(second.fake.writes().length, 1)
})

test('an injected now stamps the writes', async () => {
  const { create, read } = setup({ now: () => new Date('2027-01-02T03:04:05.678Z') })
  await create({ summary: 'a' })
  assert.equal((await read('ENG-1')).fields.created, '2027-01-02T03:04:05.678+0000')
})
