import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_KEY, fakeLinearFetch, fakeWorkspace, json, page } from '../../fake-linear-api.mjs'
import { tempDir, userStoreEnv } from '../../test-helpers.mjs'
import { operationName } from './client.mjs'
import { createLinearTracker } from './tracker.mjs'

const NOW = () => new Date('2026-10-31T12:00:00Z')
const ITEM_KEYS = ['key', 'kind', 'issue', 'title', 'at', 'by', 'in', 'comment', 'excerpt', 'from', 'to', 'synthetic', 'seen']

const note = (id, type, createdAt, extra = {}) => ({
  id, type, createdAt, readAt: null, actor: { id: 'user-2' }, issue: { identifier: 'ACME-1', title: 'First' }, comment: null, ...extra,
})

const NOTES = [
  note('n1', 'issueAssignedToYou', '2026-10-30T10:00:00.000Z'),
  note('n2', 'issueMention', '2026-10-30T11:00:00.000Z', { actor: null }),
  note('n3', 'issueCommentMention', '2026-10-30T12:00:00.000Z', { comment: { id: 'c1', body: '\n  hey @test can you look\nsecond line' } }),
  note('n4', 'issueStatusChanged', '2026-10-30T13:00:00.000Z', { readAt: '2026-10-30T14:00:00.000Z' }),
  note('n5', 'issueReaction', '2026-10-30T14:00:00.000Z'),
]

function setup({ notes = NOTES, pages, update } = {}) {
  const { env } = userStoreEnv()
  const config = { root: tempDir(), pmkit: { tracker: { system: 'linear', scope: { workspace: 'acme', team: 'ACME' } }, git_host: { system: 'github' } } }
  const routes = {
    ...fakeWorkspace(),
    PmkitNotifications: pages ?? json({ notifications: page(notes) }),
    PmkitNotificationRead: update ?? ((body) => json({ notificationUpdate: { success: true, notification: { id: body.variables.id, readAt: body.variables.readAt } } })),
  }
  const fetch = fakeLinearFetch(routes)
  const tracker = createLinearTracker(config, { env: { ...env, LINEAR_API_KEY: FAKE_KEY }, now: NOW, fetch })
  const mutations = () => fetch.calls.filter((call) => operationName(call.body.query) === 'PmkitNotificationRead').map((call) => call.body.variables)
  return { tracker, fetch, mutations }
}

test('listNotifications maps assignments, mentions and status changes, and leaves out other types', async () => {
  const { tracker } = setup()
  const result = await tracker.listNotifications({ user: 'user-1', all: true })
  assert.deepEqual(Object.keys(result), ['user', 'checked', 'since', 'hidden', 'items', 'counts', 'complete', 'problems'])
  assert.deepEqual(result.items.map((item) => [item.key, item.kind, item.in, item.seen]), [
    ['notification:n1', 'assignment', 'assignment', false],
    ['notification:n2', 'mention', 'description', false],
    ['notification:n3', 'mention', 'comment', false],
    ['notification:n4', 'status', 'status', true],
  ])
  assert.deepEqual(Object.keys(result.items[0]), ITEM_KEYS)
  assert.deepEqual(result.items[2], {
    key: 'notification:n3', kind: 'mention', issue: 'ACME-1', title: 'First', at: '2026-10-30T12:00:00Z', by: 'user-2', in: 'comment',
    comment: 'c1', excerpt: 'hey @test can you look', from: null, to: null, synthetic: false, seen: false,
  })
  assert.equal(result.items[1].by, null)
  assert.deepEqual(result.counts, { assignments: 1, mentions: 2, statusChanges: 1 })
  assert.deepEqual([result.checked, result.since, result.hidden, result.complete, result.problems], [null, null, 0, true, []])
})

test('listNotifications shows the unread items by default, and since keeps the newer ones and counts the older in hidden', async () => {
  const { tracker } = setup()
  assert.deepEqual((await tracker.listNotifications({ user: 'user-1' })).items.map((item) => item.key), ['notification:n1', 'notification:n2', 'notification:n3'])
  const cut = await tracker.listNotifications({ user: 'user-1', since: '2026-10-30T11:00:00Z' })
  assert.deepEqual([cut.items.map((item) => item.key), cut.since, cut.hidden], [['notification:n2', 'notification:n3'], '2026-10-30T11:00:00Z', 1])
  await assert.rejects(tracker.listNotifications({ user: 'user-1', since: 'yesterday' }), { code: 'INVALID_INPUT' })
  await assert.rejects(tracker.listNotifications({ user: 'user-1', since: '2026-10-30T11:00:00Z', all: true }), { code: 'INVALID_INPUT' })
})

test('Linear gives only the inbox of the key owner, so another member is INVALID_INPUT', async () => {
  const { tracker, fetch } = setup()
  await assert.rejects(tracker.listNotifications({ user: 'user-2' }), (error) => error.code === 'INVALID_INPUT' && /LINEAR_API_KEY/.test(error.message))
  await assert.rejects(tracker.markRead({ user: 'user-2' }), { code: 'INVALID_INPUT' })
  assert.equal(fetch.calls.filter((call) => operationName(call.body.query) === 'PmkitNotifications').length, 0)
})

test('a read cut at 10 pages is incomplete, and markRead refuses it', async () => {
  let n = 0
  const pages = () => {
    n += 1
    return json({ notifications: page([note(`p${n}`, 'issueMention', '2026-10-30T10:00:00.000Z')], { hasNextPage: true, endCursor: `c${n}` }) })
  }
  const { tracker, mutations } = setup({ pages })
  const result = await tracker.listNotifications({ user: 'user-1' })
  assert.equal(result.items.length, 10)
  assert.equal(result.complete, false)
  assert.deepEqual(result.problems, [{ id: null, code: 'UPSTREAM', message: 'only the newest 1000 notifications were read' }])
  await assert.rejects(tracker.markRead({ user: 'user-1' }), (error) => error.code === 'INVALID_INPUT' && /incomplete/.test(error.message))
  assert.deepEqual(mutations(), [])
})

test('markRead: a dry run sends nothing, keys mark exactly those and an unknown key is reported', async () => {
  const { tracker, mutations } = setup()
  const dry = await tracker.markRead({ user: 'user-1', dryRun: true })
  assert.deepEqual([dry.marked, dry.changed, dry.dryRun], [['notification:n1', 'notification:n2', 'notification:n3'], true, true])
  assert.deepEqual(mutations(), [])
  const result = await tracker.markRead({ user: 'user-1', keys: ['notification:n3', 'notification:n4', 'notification:zz', 'notification:zz'] })
  assert.deepEqual(result, {
    user: 'user-1', previous: null, recorded: '2026-10-31T12:00:00Z', marked: ['notification:n3'], unknown: ['notification:zz'], pruned: 0, changed: true, dryRun: false, note: null,
  })
  assert.deepEqual(mutations(), [{ id: 'n3', readAt: '2026-10-31T12:00:00Z' }])
})

test('markRead stops at the first failed write and names the keys marked and the keys left', async () => {
  let calls = 0
  const update = (body) => {
    calls += 1
    return calls === 2 ? json({ notificationUpdate: { success: false, notification: null } }) : json({ notificationUpdate: { success: true, notification: { id: body.variables.id, readAt: body.variables.readAt } } })
  }
  const { tracker, mutations } = setup({ update })
  await assert.rejects(tracker.markRead({ user: 'user-1' }), (error) => {
    assert.equal(error.code, 'UPSTREAM')
    assert.deepEqual(error.details, { marked: ['notification:n1'], left: ['notification:n2', 'notification:n3'] })
    assert.match(error.message, /notification:n1/)
    assert.match(error.message, /notification:n2, notification:n3/)
    return true
  })
  assert.equal(mutations().length, 2)
})

test('PMK-225 review: with keys, markRead marks them even when the read is cut, because the key holds the notification id', async () => {
  let n = 0
  const pages = () => {
    n += 1
    return json({ notifications: page([note(`p${n}`, 'issueMention', '2026-10-30T10:00:00.000Z')], { hasNextPage: true, endCursor: `c${n}` }) })
  }
  const { tracker, mutations } = setup({ pages })
  const result = await tracker.markRead({ user: 'user-1', keys: ['notification:p1', 'notification:beyond'] })
  assert.deepEqual([result.marked, result.unknown], [['notification:beyond', 'notification:p1'], []])
  assert.deepEqual(mutations().map((call) => call.id), ['beyond', 'p1'])
  const odd = await tracker.markRead({ user: 'user-1', keys: ['assign:ISS-1:aaaaaaaaaaaa'] })
  assert.deepEqual([odd.marked, odd.unknown], [[], ['assign:ISS-1:aaaaaaaaaaaa']])
  assert.equal(mutations().length, 2)
})
