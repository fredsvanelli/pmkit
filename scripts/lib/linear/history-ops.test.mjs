import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeWorkspace } from '../../fake-linear-api.mjs'
import { createLinearClient, isMutation } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { historyOperations } from './history-ops.mjs'
import { issueOperations } from './issue-ops.mjs'

const ACTOR = 'user-1'
const PMKIT = {
  tracker: { system: 'linear', scope: { workspace: 'acme', team: 'ACME' } },
  mappings: { status: { in_review: 'In Review' }, types: { bug: 'Bug', feature: 'Feature' } },
}

/** The Linear operations over the stateful fake, with a counter for the client UUIDs. */
async function setup({ routes, ...options } = {}) {
  const fake = fakeLinearIssues(options)
  const fetch = fakeLinearFetch({ ...fakeWorkspace(), ...fake.routes, ...routes })
  const client = createLinearClient({ env: { LINEAR_API_KEY: FAKE_KEY }, tracker: PMKIT.tracker, fetch })
  const raw = await fetchDiscovery(client, { now: () => new Date('2026-10-27T12:00:00Z') })
  const config = { pmkit: PMKIT }
  let count = 0
  const uuid = () => `uuid-${++count}`
  const ops = issueOperations({ client, discovery: async () => ({ raw }), config, uuid })
  const history = historyOperations({ client, ops, config })
  const sent = () => fetch.calls.filter((call) => isMutation(call.body.query)).length
  return { fake, fetch, ops, history, sent }
}

test('getHistory returns the create, update, comment and archive events in order', async () => {
  const { fake, ops, history } = await setup()
  const { after } = await ops.createIssue({ title: 'First' }, ACTOR)
  await ops.updateIssue(after.id, { title: 'Second' }, ACTOR)
  fake.comment(after.id, { id: 'c-1', body: 'Looks fine' })
  await ops.archive(after.id, ACTOR)
  const events = await history.getHistory(after.id)
  assert.deepEqual(events.map((e) => [e.op, e.field]), [['create', undefined], ['update', 'title'], ['comment', undefined], ['archive', undefined]])
  assert.deepEqual(events[0].to.title, 'First')
  assert.deepEqual(events[1], { at: events[1].at, by: ACTOR, op: 'update', field: 'title', from: 'First', to: 'Second' })
  assert.deepEqual(events[2], { at: events[2].at, by: ACTOR, op: 'comment', to: 'c-1' })
  const stamps = events.map((e) => e.at)
  assert.deepEqual(stamps, [...stamps].sort())
})

test('since drops earlier events and keeps the boundary', async () => {
  const { ops, history } = await setup()
  const { after } = await ops.createIssue({ title: 'First' }, ACTOR)
  await ops.updateIssue(after.id, { title: 'Second' }, ACTOR)
  await ops.updateIssue(after.id, { title: 'Third' }, ACTOR)
  const all = await history.getHistory(after.id)
  const boundary = all[1].at
  assert.deepEqual((await history.getHistory(after.id, { since: boundary })).map((e) => e.to?.title ?? e.to), ['Second', 'Third'])
})

test('a malformed id sends no request and a trashed issue is NOT_FOUND', async () => {
  const { fake, fetch, history } = await setup()
  await assert.rejects(history.getHistory('nope'), { code: 'NOT_FOUND' })
  const before = fetch.calls.length
  await assert.rejects(history.getHistory('not an id'), { code: 'NOT_FOUND' })
  assert.equal(fetch.calls.length, before)
  fake.seed({ title: 'Gone' })
  fake.records[0].trashed = true
  await assert.rejects(history.getHistory('ACME-1'), { code: 'NOT_FOUND' })
})

test('a history past the page cap carries a hidden truncated flag', async () => {
  const { fake, history, sent } = await setup()
  fake.seed({ title: 'Busy' })
  for (let n = 0; n < 1001; n += 1) fake.history('ACME-1', { createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(), updatedDescription: true })
  const events = await history.getHistory('ACME-1')
  assert.equal(events.truncated, true)
  assert.deepEqual(Object.keys(events), events.map((_, index) => String(index)))
  assert.equal(JSON.stringify(events).includes('truncated'), false)
  assert.equal(events.filter((e) => e.field === 'description').length, 1000)
  assert.equal(sent(), 0)
  assert.equal((await history.getHistory('ACME-1', { since: '2030-01-01' })).truncated, true)
})

test('a short history has no truncated flag and no request is a mutation', async () => {
  const { ops, history, sent } = await setup()
  const { after } = await ops.createIssue({ title: 'First' }, ACTOR)
  const before = sent()
  const events = await history.getHistory(after.id)
  assert.equal(events.truncated, undefined)
  assert.equal(sent(), before)
})

// listComments and comment

const seedIssue = (fake) => fake.seed({ title: 'Threaded' })

test('listComments returns roots and replies sorted by creation, with parent', async () => {
  const { fake, history } = await setup()
  seedIssue(fake)
  fake.comment('ACME-1', { id: 'c-1', body: ' First ', createdAt: '2026-10-01T00:00:01.000Z' })
  fake.comment('ACME-1', { id: 'c-3', body: 'Third', createdAt: '2026-10-01T00:00:03.000Z', parentId: 'c-1' })
  fake.comment('ACME-1', { id: 'c-2', body: 'Second', createdAt: '2026-10-01T00:00:02.000Z' })
  const comments = await history.listComments('ACME-1')
  assert.deepEqual(comments.map((c) => [c.id, c.body, c.parent]), [['c-1', 'First', undefined], ['c-2', 'Second', undefined], ['c-3', 'Third', 'c-1']])
  assert.deepEqual(comments[0], { id: 'c-1', issue: 'ACME-1', author: 'user-1', body: 'First', created: '2026-10-01T00:00:01.000Z' })
  await assert.rejects(history.listComments('nope'), { code: 'NOT_FOUND' })
})

test('listComments flags a read cut by the page cap', async () => {
  const { fake, history } = await setup()
  seedIssue(fake)
  for (let n = 0; n < 1001; n += 1) fake.comment('ACME-1', { body: `c${n}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString() })
  const comments = await history.listComments('ACME-1')
  assert.equal(comments.length, 1000)
  assert.equal(comments.truncated, true)
  assert.equal(Object.keys(comments).length, 1000)
})

test('comment returns the viewer as author and sends the trimmed body and nothing else', async () => {
  const { fake, fetch, history, sent } = await setup()
  seedIssue(fake)
  const made = await history.comment('ACME-1', '  Hi there \n', ACTOR)
  assert.deepEqual(made, { id: 'uuid-1', issue: 'ACME-1', author: ACTOR, body: 'Hi there', created: made.created })
  assert.equal(sent(), 1)
  const call = fetch.calls.find((c) => isMutation(c.body.query))
  assert.deepEqual(call.body.variables.input, { id: 'uuid-1', issueId: 'issue-1', body: 'Hi there' })
  assert.deepEqual((await history.listComments('ACME-1')).map((c) => c.body), ['Hi there'])
})

test('comment refuses another actor and a blank body, and sends nothing', async () => {
  const { fake, history, sent } = await setup()
  seedIssue(fake)
  await assert.rejects(history.comment('ACME-1', 'x', 'user-2'), { code: 'INVALID_INPUT' })
  await assert.rejects(history.comment('ACME-1', '   ', ACTOR), { code: 'INVALID_INPUT', message: 'comment body must be a non-empty string' })
  assert.equal(sent(), 0)
})

test('a reply attaches to the root, also when it answers a reply', async () => {
  const { fake, history } = await setup()
  seedIssue(fake)
  const root = await history.comment('ACME-1', 'Question', ACTOR)
  const reply = await history.comment('ACME-1', 'Answer', ACTOR, { replyTo: root.id })
  assert.equal(reply.parent, root.id)
  const nested = await history.comment('ACME-1', 'More', ACTOR, { replyTo: reply.id })
  assert.equal(nested.parent, root.id)
  assert.deepEqual((await history.listComments('ACME-1')).map((c) => c.parent), [undefined, root.id, root.id])
})

test('a reply to a missing comment or a comment of another issue is NOT_FOUND', async () => {
  const { fake, history, sent } = await setup()
  seedIssue(fake)
  fake.seed({ title: 'Other' })
  fake.comment('ACME-2', { id: 'elsewhere', body: 'x' })
  await assert.rejects(history.comment('ACME-1', 'x', ACTOR, { replyTo: 'missing' }), { code: 'NOT_FOUND', message: 'comment missing is not on ACME-1' })
  await assert.rejects(history.comment('ACME-1', 'x', ACTOR, { replyTo: 'elsewhere' }), { code: 'NOT_FOUND', message: 'comment elsewhere is not on ACME-1' })
  assert.equal(sent(), 0)
})

test('a dry-run comment sends no mutation and has the keys of the real result', async () => {
  const { fake, history, sent } = await setup()
  seedIssue(fake)
  const root = await history.comment('ACME-1', 'Question', ACTOR)
  const before = sent()
  const dry = await history.comment('ACME-1', 'Answer', ACTOR, { dryRun: true, replyTo: root.id })
  assert.equal(sent(), before)
  assert.deepEqual(dry, { id: null, issue: 'ACME-1', author: ACTOR, body: 'Answer', created: dry.created, parent: root.id })
  const real = await history.comment('ACME-1', 'Answer', ACTOR, { replyTo: root.id })
  assert.deepEqual(Object.keys(dry), Object.keys(real))
  assert.match(dry.created, /^\d{4}-\d\d-\d\dT/)
})

test('an unconfirmed create that was applied returns the comment, and one that was not rethrows', async () => {
  const { fake, history } = await setup()
  seedIssue(fake)
  fake.unconfirm('PmkitCommentCreate', { applied: true })
  const made = await history.comment('ACME-1', 'Once', ACTOR)
  assert.equal(made.body, 'Once')
  assert.equal(fake.comments.length, 1)
  fake.unconfirm('PmkitCommentCreate', { applied: false })
  await assert.rejects(history.comment('ACME-1', 'Never', ACTOR), { code: 'UPSTREAM' })
  assert.equal(fake.comments.length, 1)
})

// resolveThread

test('resolveThread marks the root and returns before and after', async () => {
  const { fake, history } = await setup()
  seedIssue(fake)
  const root = await history.comment('ACME-1', 'Question', ACTOR)
  const { before, after } = await history.resolveThread('ACME-1', root.id, ACTOR)
  assert.equal(before.resolved, undefined)
  assert.deepEqual(after, { ...root, resolved: { at: after.resolved.at, by: ACTOR } })
  assert.deepEqual((await history.listComments('ACME-1')).map((c) => c.resolved?.by), [ACTOR])
})

test('resolving through a reply resolves the root and not the reply', async () => {
  const { fake, history } = await setup()
  seedIssue(fake)
  const root = await history.comment('ACME-1', 'Question', ACTOR)
  const reply = await history.comment('ACME-1', 'Answer', ACTOR, { replyTo: root.id })
  const { after } = await history.resolveThread('ACME-1', reply.id, ACTOR)
  assert.equal(after.id, root.id)
  assert.deepEqual((await history.listComments('ACME-1')).map((c) => c.resolved?.by), [ACTOR, undefined])
})

test('resolving twice sends one mutation', async () => {
  const { fake, history, sent } = await setup()
  seedIssue(fake)
  const root = await history.comment('ACME-1', 'Question', ACTOR)
  await history.resolveThread('ACME-1', root.id, ACTOR)
  const count = sent()
  const again = await history.resolveThread('ACME-1', root.id, ACTOR)
  assert.deepEqual(again.after, again.before)
  assert.equal(sent(), count)
})

test('resolveThread refuses a missing comment, a comment of another issue and another actor', async () => {
  const { fake, history, sent } = await setup()
  seedIssue(fake)
  fake.seed({ title: 'Other' })
  fake.comment('ACME-2', { id: 'elsewhere', body: 'x' })
  await assert.rejects(history.resolveThread('ACME-1', 'missing', ACTOR), { code: 'NOT_FOUND' })
  await assert.rejects(history.resolveThread('ACME-1', 'elsewhere', ACTOR), { code: 'NOT_FOUND' })
  await assert.rejects(history.resolveThread('ACME-1', 'elsewhere', 'user-2'), { code: 'INVALID_INPUT' })
  assert.equal(sent(), 0)
})

test('a dry-run resolve has the shape of the real one and sends nothing', async () => {
  const { fake, history, sent } = await setup()
  seedIssue(fake)
  const root = await history.comment('ACME-1', 'Question', ACTOR)
  const count = sent()
  const dry = await history.resolveThread('ACME-1', root.id, ACTOR, { dryRun: true })
  assert.equal(sent(), count)
  assert.equal(dry.after.resolved.by, ACTOR)
  const real = await history.resolveThread('ACME-1', root.id, ACTOR)
  assert.deepEqual(Object.keys(dry.after), Object.keys(real.after))
  assert.deepEqual(Object.keys(dry.after.resolved), Object.keys(real.after.resolved))
  assert.deepEqual(dry.before, real.before)
})

// metricEvents

const eventsCalls = (fetch) => fetch.calls.filter((c) => /query PmkitIssueEvents/.test(c.body.query))

test('metricEvents tags the events of every issue with its id and sorts them', async () => {
  const { ops, history } = await setup()
  const a = (await ops.createIssue({ title: 'First' }, ACTOR)).after.id
  const b = (await ops.createIssue({ title: 'Second' }, ACTOR)).after.id
  await ops.updateIssue(a, { title: 'First, renamed' }, ACTOR)
  const all = await history.metricEvents()
  assert.deepEqual(all.map((e) => [e.issue, e.op]), [[a, 'create'], [b, 'create'], [a, 'update']])
  const stamps = all.map((e) => e.at)
  assert.deepEqual(stamps, [...stamps].sort())
  assert.deepEqual(Object.keys(all[2]), ['at', 'by', 'op', 'field', 'from', 'to', 'issue'])
})

test('a nested list longer than its page is completed', async () => {
  const { ops, history } = await setup({ nestedPage: 2 })
  const { after } = await ops.createIssue({ title: 'T0' }, ACTOR)
  for (const title of ['T1', 'T2', 'T3', 'T4']) await ops.updateIssue(after.id, { title }, ACTOR)
  const events = await history.metricEvents()
  assert.deepEqual(events.filter((e) => e.field === 'title').map((e) => e.to), ['T1', 'T2', 'T3', 'T4'])
  assert.equal(events[0].to.title, 'T0')
})

test('since goes to Linear as updatedAt gte and also drops earlier events', async () => {
  const { fetch, ops, history } = await setup()
  const a = (await ops.createIssue({ title: 'Old' }, ACTOR)).after.id
  const b = (await ops.createIssue({ title: 'Newer' }, ACTOR)).after.id
  const since = (await ops.updateIssue(b, { title: 'Newest' }, ACTOR)).after.updated
  const events = await history.metricEvents({ since })
  assert.deepEqual(events.map((e) => [e.issue, e.op]), [[b, 'update']])
  const sent = eventsCalls(fetch).at(-1).body.variables
  assert.deepEqual(sent.filter.and.at(-1), { updatedAt: { gte: since } })
  assert.deepEqual(sent.filter.and[0], { team: { key: { eq: 'ACME' } } })
  assert.equal(sent.includeArchived, true)
  assert.deepEqual(sent.sort, [{ updatedAt: { order: 'Descending' } }])
  assert.ok(a)
})

test('a date-only until includes the whole day', async () => {
  const { ops, history } = await setup({ start: '2026-10-05T10:00:00.000Z' })
  const { after } = await ops.createIssue({ title: 'Today' }, ACTOR)
  assert.equal((await history.metricEvents({ until: '2026-10-05' })).length, 1)
  assert.equal((await history.metricEvents({ until: '2026-10-04' })).length, 0)
  assert.equal((await history.metricEvents({ until: `${after.created.slice(0, 19)}Z` })).length, 1)
})

test('trashed and archived issues: trashed are skipped, archived are read', async () => {
  const { fake, ops, history } = await setup()
  const kept = (await ops.createIssue({ title: 'Kept' }, ACTOR)).after.id
  await ops.archive(kept, ACTOR)
  fake.seed({ title: 'Gone' })
  fake.records.find((r) => r.title === 'Gone').trashed = true
  const events = await history.metricEvents()
  assert.deepEqual([...new Set(events.map((e) => e.issue))], [kept])
  assert.ok(events.some((e) => e.op === 'archive'))
})

test('equal times order by issue id as numbers', async () => {
  const { fake, history } = await setup()
  for (let n = 0; n < 10; n += 1) fake.seed({ title: `I${n}` }, { createdAt: '2026-10-01T00:00:00.000Z' })
  assert.deepEqual((await history.metricEvents()).map((e) => e.issue), Array.from({ length: 10 }, (_, n) => `ACME-${n + 1}`))
})

test('the 1000-issue cap sets a hidden truncated flag', async () => {
  const { fake, history } = await setup()
  for (let n = 0; n < 1001; n += 1) fake.seed({ title: `I${n}` })
  const events = await history.metricEvents()
  assert.equal(events.truncated, true)
  assert.equal(new Set(events.map((e) => e.issue)).size, 1000)
  assert.equal(Object.keys(events).length, events.length)
})

test('a short read has no truncated flag', async () => {
  const { fake, history } = await setup()
  fake.seed({ title: 'One' })
  assert.equal((await history.metricEvents()).truncated, undefined)
})

test('an INPUT_ERROR from the by-id read means the comment is not on the issue, and another error propagates', async () => {
  const refused = (code) => ({ status: 200, json: { data: null, errors: [{ message: 'Argument Validation Error', extensions: { code } }] } })
  const input = await setup({ routes: { PmkitCommentById: refused('INPUT_ERROR') } })
  seedIssue(input.fake)
  await assert.rejects(input.history.comment('ACME-1', 'x', ACTOR, { replyTo: 'nope' }), { code: 'NOT_FOUND', message: 'comment nope is not on ACME-1' })
  await assert.rejects(input.history.resolveThread('ACME-1', 'nope', ACTOR), { code: 'NOT_FOUND' })
  const other = await setup({ routes: { PmkitCommentById: refused('INTERNAL_SERVER_ERROR') } })
  seedIssue(other.fake)
  await assert.rejects(other.history.comment('ACME-1', 'x', ACTOR, { replyTo: 'nope' }), { code: 'UPSTREAM' })
})

const queries = (fetch, name) => fetch.calls.filter((call) => call.body.query.includes(`query ${name}`)).length

test('a comment id with characters no Linear id has sends no by-id request', async () => {
  const { fake, fetch, history } = await setup()
  seedIssue(fake)
  for (const bad of ['bad id', 'x"y', '', 7, null]) {
    await assert.rejects(history.comment('ACME-1', 'x', ACTOR, { replyTo: bad }), { code: 'NOT_FOUND' })
    await assert.rejects(history.resolveThread('ACME-1', bad, ACTOR), { code: 'NOT_FOUND' })
  }
  assert.equal(queries(fetch, 'PmkitCommentById'), 0)
})

test('metricEvents reads no history or comments for a trashed issue', async () => {
  const { fake, fetch, history } = await setup({ nestedPage: 2 })
  fake.seed({ title: 'Gone' })
  fake.history('ACME-1', { fromTitle: 'a', toTitle: 'b' })
  for (const id of ['c-1', 'c-2', 'c-3']) fake.comment('ACME-1', { id, body: 'x' })
  fake.records[0].trashed = true
  assert.deepEqual(await history.metricEvents(), [])
  assert.equal(queries(fetch, 'PmkitIssueHistory') + queries(fetch, 'PmkitIssueComments'), 0)
})

test('metricEvents completes a comment list longer than its page', async () => {
  const { fake, history } = await setup({ nestedPage: 2 })
  fake.seed({ title: 'Talked' })
  for (const id of ['c-1', 'c-2', 'c-3', 'c-4', 'c-5']) fake.comment('ACME-1', { id, body: 'x' })
  const comments = (await history.metricEvents()).filter((event) => event.op === 'comment')
  assert.deepEqual(comments.map((event) => event.to).sort(), ['c-1', 'c-2', 'c-3', 'c-4', 'c-5'])
})
