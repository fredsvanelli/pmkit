// The History and Comments families of the GitHub adapter against the stateful fake GitHub, through the real client.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeGithubIssues } from '../../fake-github-issues.mjs'
import { createGithubClient } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { historyOperations } from './history-ops.mjs'
import { issueOperations } from './issue-ops.mjs'
import { makeContext } from './issues.mjs'

const PMKIT = {
  tracker: { system: 'github', scope: { host: 'github.com', repo: 'acme/widgets', project: 'acme/7' } },
  mappings: { status: { backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress', in_review: 'In Review', done: 'Done' }, types: { bug: 'Bug', task: 'Task' } },
}
const ME = 'octocat'
const NO_THREADS = { code: 'NOT_SUPPORTED', message: 'GitHub issue comments have no threads', nextStep: 'Post a new comment with pmkit issues comment' }
const STATUS_WARNING = 'on GitHub Enterprise Server before 3.20, Status option changes have no events, so moves show only as opens and closes'

async function setup({ host = 'github.com', ghesVersion = null } = {}) {
  const fake = fakeGithubIssues({ host, ghesVersion })
  const client = createGithubClient({ exec: fake.exec, retries: 0, sleep: async () => {} })
  const raw = await fetchDiscovery(client, { host, repo: 'acme/widgets', project: 'acme/7', exec: fake.exec, users: true })
  const context = makeContext(raw, PMKIT)
  const getContext = async () => context
  const ops = issueOperations({ client, config: { pmkit: PMKIT }, getContext })
  const history = historyOperations({ client, ops, getContext, now: () => new Date('2026-11-16T12:30:00Z') })
  return { fake, ops, history, clear: () => { fake.reads.splice(0); fake.mutations.splice(0) } }
}
const names = (calls) => calls.map((call) => call.name)

test('create, rename and comment give the ops create, update and comment in order', async () => {
  const { ops, history } = await setup()
  const { id } = (await ops.createIssue({ title: 'Talked about' }, ME)).after
  await ops.updateIssue(id, { title: 'Talked about more' }, ME)
  const posted = await history.comment(id, '  First thought ', ME)
  assert.deepEqual(posted, { id: posted.id, issue: id, author: ME, body: 'First thought', created: posted.created })
  const events = await history.getHistory(id)
  assert.deepEqual(events.map((event) => event.op), ['create', 'update', 'comment'])
  assert.deepEqual(events[1], { at: events[1].at, by: ME, op: 'update', field: 'title', from: 'Talked about', to: 'Talked about more' })
  assert.equal(events[2].to, posted.id)
  assert.equal(events.warnings, undefined)
  assert.deepEqual((await history.listComments(id)).map((comment) => comment.body), ['First thought'])
})

test('getHistory sends since and the item types to the timeline read, and drops a create before since', async () => {
  const { fake, ops, history, clear } = await setup()
  const { id } = (await ops.createIssue({ title: 'A' }, ME)).after
  await ops.updateIssue(id, { title: 'B' }, ME)
  const since = fake.state.clock
  clear()
  const events = await history.getHistory(id, { since })
  assert.deepEqual(events.map((event) => event.op), ['update'])
  const read = fake.reads.find((call) => call.name === 'PmkitTimeline')
  assert.equal(read.variables.since, since)
  assert.ok(read.variables.itemTypes.includes('PROJECT_V2_ITEM_STATUS_CHANGED_EVENT'))
})

test('getHistory maps a Status change and a close to moves', async () => {
  const { ops, history } = await setup()
  const { id } = (await ops.createIssue({ title: 'Moving' }, ME)).after
  await ops.moveToCategory(id, 'in_progress', ME)
  await ops.moveToCategory(id, 'done', ME)
  const moves = (await history.getHistory(id)).filter((event) => event.op === 'move')
  assert.ok(moves.some((event) => event.to === 'In Progress'))
  assert.equal(moves.at(-1).to, 'Closed')
})

test('getHistory on GHES 3.19 leaves the Status event type out and warns, without a JSON key', async () => {
  const { fake, ops, history, clear } = await setup({ host: 'ghe.acme.test', ghesVersion: '3.19.0' })
  const { id } = (await ops.createIssue({ title: 'Old host' }, ME)).after
  clear()
  const events = await history.getHistory(id)
  assert.deepEqual(events.warnings, [STATUS_WARNING])
  assert.equal(JSON.stringify(events).includes('warnings'), false)
  assert.equal(fake.reads.find((call) => call.name === 'PmkitTimeline').variables.itemTypes.includes('PROJECT_V2_ITEM_STATUS_CHANGED_EVENT'), false)
})

test('getHistory on GHES 3.20 reads a Status change with no warning', async () => {
  const { fake, ops, history, clear } = await setup({ host: 'ghe.acme.test', ghesVersion: '3.20.0' })
  const { id } = (await ops.createIssue({ title: 'Newer host' }, ME)).after
  await ops.moveToCategory(id, 'in_progress', ME)
  clear()
  const events = await history.getHistory(id)
  assert.ok(events.some((event) => event.op === 'move' && event.to === 'In Progress'))
  assert.equal(events.warnings, undefined)
  assert.ok(fake.reads.find((call) => call.name === 'PmkitTimeline').variables.itemTypes.includes('PROJECT_V2_ITEM_STATUS_CHANGED_EVENT'))
})

test('metricEvents on GHES 3.19 warns that Status changes have no events', async () => {
  const { ops, history } = await setup({ host: 'ghe.acme.test', ghesVersion: '3.19.0' })
  await ops.createIssue({ title: 'Old host' }, ME)
  const events = await history.metricEvents()
  assert.deepEqual(events.warnings, [STATUS_WARNING])
  assert.equal(events.truncated, undefined)
})

test('getHistory reads every page of a long timeline', async () => {
  const { fake, ops, history, clear } = await setup()
  const { id } = (await ops.createIssue({ title: 'Busy' }, ME)).after
  for (let index = 0; index < 120; index += 1) await history.comment(id, `note ${index}`, ME)
  clear()
  const events = await history.getHistory(id)
  assert.equal(events.length, 121)
  assert.deepEqual(names(fake.reads), ['PmkitIssue', 'PmkitTimeline', 'PmkitTimeline'])
})

test('comment refuses a blank body before any request', async () => {
  const { ops, history, fake, clear } = await setup()
  const { id } = (await ops.createIssue({ title: 'Quiet' }, ME)).after
  clear()
  await assert.rejects(history.comment(id, '   ', ME), { code: 'INVALID_INPUT', message: 'comment body must be a non-empty string' })
  await assert.rejects(history.comment(id, undefined, ME), { code: 'INVALID_INPUT' })
  assert.deepEqual(fake.reads, [])
  assert.deepEqual(fake.mutations, [])
})

test('comment checks the actor first', async () => {
  const { history, fake, clear } = await setup()
  clear()
  await assert.rejects(history.comment('1', '   ', 'hubot'), { code: 'INVALID_INPUT', message: 'GitHub records every write as the gh login (octocat)' })
  assert.deepEqual(fake.reads, [])
})

test('a reply and resolveThread are NOT_SUPPORTED with no request', async () => {
  const { history, fake, clear } = await setup()
  clear()
  await assert.rejects(history.comment('1', 'Answer', ME, { replyTo: 'IC_1' }), NO_THREADS)
  await assert.rejects(history.resolveThread('1', 'IC_1', ME), NO_THREADS)
  assert.deepEqual(fake.reads, [])
})

test('a dry-run comment sends nothing and returns the comment with a null id', async () => {
  const { ops, history, fake, clear } = await setup()
  const { id } = (await ops.createIssue({ title: 'Dry' }, ME)).after
  clear()
  const dry = await history.comment(id, 'Maybe', ME, { dryRun: true })
  assert.deepEqual(dry, { id: null, issue: id, author: ME, body: 'Maybe', created: '2026-11-16T12:30:00.000Z' })
  assert.deepEqual(fake.mutations, [])
})

test('comment sends addComment with the issue node as subject', async () => {
  const { ops, history, fake, clear } = await setup()
  const { id } = (await ops.createIssue({ title: 'Loud' }, ME)).after
  clear()
  await history.comment(id, 'Hello', ME)
  assert.deepEqual(fake.mutations.map((call) => [call.name, call.variables.input]), [['PmkitAddComment', { subjectId: 'I_1', body: 'Hello' }]])
})

test('listComments reads every page and keeps the creation order', async () => {
  const { ops, history, fake, clear } = await setup()
  const { id } = (await ops.createIssue({ title: 'Chatty' }, ME)).after
  for (let index = 0; index < 105; index += 1) await history.comment(id, `c${index}`, ME)
  clear()
  const comments = await history.listComments(id)
  assert.equal(comments.length, 105)
  assert.equal(comments[0].body, 'c0')
  assert.equal(comments.at(-1).body, 'c104')
  assert.deepEqual(names(fake.reads), ['PmkitIssue', 'PmkitComments', 'PmkitComments'])
})

test('metricEvents over 25 issues sends one issue read and two timeline reads and tags each event', async () => {
  const { fake, history, clear } = await setup()
  for (let index = 0; index < 25; index += 1) fake.seed({ title: `Seeded ${index}`, createdAt: `2026-11-0${1 + (index % 9)}T10:00:00.000Z` })
  clear()
  const events = await history.metricEvents()
  assert.deepEqual(names(fake.reads), ['PmkitMetricIssues', 'PmkitTimelines', 'PmkitTimelines'])
  assert.deepEqual(fake.reads.filter((call) => call.name === 'PmkitTimelines').map((call) => call.variables.ids.length), [20, 5])
  assert.equal(events.length, 25)
  assert.deepEqual(new Set(events.map((event) => event.issue)).size, 25)
  const stamps = events.map((event) => event.at)
  assert.deepEqual(stamps, [...stamps].sort())
  assert.equal(events.warnings, undefined)
})

test('metricEvents names the Status of a reopened issue whose configured item comes after 20 others', async () => {
  const { fake, history, clear } = await setup()
  fake.seed({ title: 'Popular', item: { status: 'In Review' } })
  fake.state.items.unshift(...Array.from({ length: 20 }, (_, index) => ({ id: `PVTI_X${index}`, projectId: `PVT_X${index}`, issueId: 'I_1', isArchived: false, values: {} })))
  fake.handle('PmkitCloseIssue', { input: { issueId: 'I_1', stateReason: 'COMPLETED' } })
  fake.handle('PmkitReopenIssue', { input: { issueId: 'I_1' } })
  clear()
  const events = await history.metricEvents()
  const reopened = events.filter((event) => event.op === 'move' && event.from === null && event.to !== 'Closed')
  assert.deepEqual(reopened.map((event) => event.to), ['In Review'])
  assert.ok(names(fake.reads).includes('PmkitIssueMore_projectItems'))
})

test('metricEvents filters by since and until and reads the issues updated since since', async () => {
  const { fake, ops, history, clear } = await setup()
  const a = (await ops.createIssue({ title: 'A' }, ME)).after.id
  const b = (await ops.createIssue({ title: 'B' }, ME)).after.id
  await ops.updateIssue(a, { title: 'A2' }, ME)
  const last = fake.state.clock
  await history.comment(b, 'later', ME)
  clear()
  const since = await history.metricEvents({ since: last })
  assert.deepEqual(since.map((event) => [event.issue, event.op]), [[a, 'update'], [b, 'comment']])
  assert.equal(fake.reads[0].variables.filterBy.since, last)
  const until = await history.metricEvents({ until: last })
  assert.ok(until.every((event) => event.at <= last))
  assert.ok(!until.some((event) => event.op === 'comment'))
  assert.equal((await history.metricEvents({ until: '2026-11-15' })).length, 0)
})

test('metricEvents reads the rest of a timeline longer than 100 items', async () => {
  const { fake, ops, history, clear } = await setup()
  const { id } = (await ops.createIssue({ title: 'Busy' }, ME)).after
  for (let index = 0; index < 120; index += 1) await history.comment(id, `note ${index}`, ME)
  clear()
  const events = await history.metricEvents()
  assert.equal(events.length, 121)
  assert.deepEqual(names(fake.reads), ['PmkitMetricIssues', 'PmkitTimelines', 'PmkitTimeline', 'PmkitTimeline'])
})

test('metricEvents marks the cut, without a JSON key and without a warning of its own, when the issue read stops at 1000 issues', async () => {
  const { fake, history, clear } = await setup()
  for (let index = 0; index < 1001; index += 1) fake.seed({ title: `S${index}` })
  clear()
  fake.seed({ title: 'Old', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
  clear()
  const events = await history.metricEvents()
  assert.deepEqual(fake.reads[0].variables.orderBy, { field: 'UPDATED_AT', direction: 'DESC' })
  assert.equal(events.length, 1000)
  assert.ok(!events.some((event) => event.at === '2026-01-01T00:00:00.000Z'), 'the least recently updated issue is the one left out')
  assert.equal(events.truncated, true)
  // The CLI writes the cut warning from truncated, so warnings does not repeat it.
  assert.equal(events.warnings, undefined)
  assert.equal(JSON.stringify(events).includes('truncated'), false)
})
