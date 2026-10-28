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
async function setup(options = {}) {
  const fake = fakeLinearIssues(options)
  const fetch = fakeLinearFetch({ ...fakeWorkspace(), ...fake.routes })
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
