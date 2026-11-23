import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_ENV, TRACKER, fakeJiraFetch, jiraSiteRoutes } from '../../fake-jira-api.mjs'
import { textToAdf } from './adf.mjs'
import { createJiraClient } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { toComment, toEvents } from './history.mjs'
import { makeContext } from './issues.mjs'

globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

async function context({ edit } = {}) {
  const client = createJiraClient({ env: FAKE_ENV, tracker: TRACKER, fetch: fakeJiraFetch({ ...jiraSiteRoutes() }), sleep: async () => {} })
  const raw = await fetchDiscovery(client, { space: 'ENG', now: () => new Date('2026-11-22T12:00:00Z') })
  edit?.(raw)
  return makeContext(raw, { tracker: TRACKER, mappings: { types: { story: 'Story', bug: 'Bug' } } }, await client.session())
}

const ITEM = {
  key: 'ENG-1',
  fields: { created: '2026-11-20T10:00:00.000+0000', creator: { accountId: 'acc-1' }, summary: 'Now', issuetype: { name: 'Bug' }, status: { name: 'Done' } },
}
let n = 0
const history = (items, created = '2026-11-21T10:00:00.000+0000', author = { accountId: 'acc-2' }) => ({ id: String(++n), author, created, items })
const one = async (change, ctx) => (await toEvents(ITEM, [history([change])], ctx ?? (await context())))[1]
const CREATE = { at: '2026-11-20T10:00:00.000Z', by: 'acc-1', op: 'create', to: { id: 'ENG-1', title: 'Now', type: 'bug', status: 'Done' } }

test('the item gives the create event first', async () => {
  const events = toEvents(ITEM, [], await context())
  assert.deepEqual(events, [CREATE])
})

test('the create event starts from the first change of title, type and status', async () => {
  const events = toEvents(ITEM, [
    history([{ field: 'summary', fieldId: 'summary', fromString: 'Later', toString: 'Now' }], '2026-11-22T10:00:00.000+0000'),
    history([
      { field: 'summary', fieldId: 'summary', fromString: 'First', toString: 'Later' },
      { field: 'issuetype', fieldId: 'issuetype', fromString: 'Task', toString: 'Bug' },
      { field: 'status', fieldId: 'status', fromString: 'To Do', toString: 'Done' },
    ]),
  ], await context())
  assert.deepEqual(events[0].to, { id: 'ENG-1', title: 'First', type: 'Task', status: 'To Do' })
})

test('status is a move with the status names', async () => {
  assert.deepEqual(await one({ field: 'status', fieldId: 'status', from: '1', fromString: 'To Do', to: '3', toString: 'Done' }), { at: '2026-11-21T10:00:00.000Z', by: 'acc-2', op: 'move', field: 'status', from: 'To Do', to: 'Done' })
})

test('labels give one update per added and removed label', async () => {
  const events = toEvents(ITEM, [history([{ field: 'labels', fieldId: 'labels', fromString: 'a b', toString: 'b c d' }])], await context()).slice(1)
  assert.deepEqual(events.map((e) => [e.op, e.field, e.from, e.to]), [['update', 'labels', null, 'c'], ['update', 'labels', null, 'd'], ['update', 'labels', 'a', null]])
})

test('assignee is an assign with account ids', async () => {
  const e = await one({ field: 'assignee', fieldId: 'assignee', from: null, to: 'acc-9', fromString: null, toString: 'Ann' })
  assert.deepEqual([e.op, e.field, e.from, e.to], ['assign', 'assignee', null, 'acc-9'])
})

test('priority reads as a pmkit level, issuetype as a pmkit type else the name', async () => {
  const ctx = await context()
  const p = await one({ field: 'priority', fieldId: 'priority', fromString: 'Low', toString: 'Highest' }, ctx)
  assert.deepEqual([p.op, p.field, p.from, p.to], ['update', 'priority', 'low', 'urgent'])
  const t = await one({ field: 'issuetype', fieldId: 'issuetype', fromString: 'Story', toString: 'Task' }, ctx)
  assert.deepEqual([t.field, t.from, t.to], ['type', 'story', 'Task'])
})

test('summary, description and duedate keep their strings under pmkit names', async () => {
  const ctx = await context()
  const all = toEvents(ITEM, [history([
    { field: 'summary', fieldId: 'summary', fromString: 'A', toString: 'B' },
    { field: 'description', fieldId: 'description', fromString: null, toString: 'text' },
    { field: 'duedate', fieldId: 'duedate', from: '2026-11-01', to: '2026-11-02', fromString: '2026-11-01', toString: '2026-11-02' },
  ])], ctx).slice(1)
  assert.deepEqual(all.map((e) => [e.field, e.from, e.to]), [['title', 'A', 'B'], ['description', null, 'text'], ['due', '2026-11-01', '2026-11-02']])
})

test('the estimate field gives numbers, hours for timeoriginalestimate', async () => {
  const ctx = await context()
  const id = ctx.fields.estimate
  const e = await one({ field: 'Story point estimate', fieldId: id, fromString: null, toString: '5.0', to: '5.0' }, ctx)
  assert.deepEqual([e.op, e.field, e.from, e.to], ['update', 'estimate', null, id === 'timeoriginalestimate' ? 5 / 3600 : 5])
  const hours = { ...ctx, fields: { ...ctx.fields, estimate: 'timeoriginalestimate' } }
  const h = await one({ field: 'timeoriginalestimate', fieldId: 'timeoriginalestimate', from: '3600', to: '7200', fromString: '3600', toString: '7200' }, hours)
  assert.deepEqual([h.field, h.from, h.to], ['estimate', 1, 2])
})

test('Link is a link when to is set and an unlink when from is', async () => {
  const ctx = await context()
  const l = await one({ field: 'Link', from: null, fromString: null, to: 'ENG-2', toString: 'This issue blocks ENG-2' }, ctx)
  assert.deepEqual([l.op, l.field, l.from, l.to], ['link', 'links', null, 'ENG-2'])
  const u = await one({ field: 'Link', from: 'ENG-2', fromString: 'This issue blocks ENG-2', to: null, toString: null }, ctx)
  assert.deepEqual([u.op, u.field, u.from, u.to], ['unlink', 'links', 'ENG-2', null])
})

test('parent changes give an update of parent with the keys', async () => {
  const ctx = await context()
  for (const field of ['IssueParentAssociation', 'Parent']) {
    const e = await one({ field, fieldId: 'parent', from: '10', fromString: 'ENG-3', to: '11', toString: 'ENG-4' }, ctx)
    assert.deepEqual([e.op, e.field, e.from, e.to], ['update', 'parent', 'ENG-3', 'ENG-4'])
  }
})

test('any other field is an update of jira:<fieldId or field>', async () => {
  const ctx = await context()
  const a = await one({ field: 'Flagged', fieldId: 'customfield_10021', fromString: null, toString: 'Impediment' }, ctx)
  assert.deepEqual([a.op, a.field, a.from, a.to], ['update', 'jira:customfield_10021', null, 'Impediment'])
  const b = await one({ field: 'Resolution', fromString: null, toString: 'Done' }, ctx)
  assert.equal(b.field, 'jira:Resolution')
})

test('a missing author gives by null', async () => {
  const e = toEvents(ITEM, [history([{ field: 'status', fromString: 'a', toString: 'b' }], undefined, null)], await context())[1]
  assert.equal(e.by, null)
})

test('events sort by at, ties keep the changelog order, and comments join in', async () => {
  const ctx = await context()
  const same = '2026-11-22T10:00:00.000+0000'
  const events = toEvents(ITEM, [
    history([{ field: 'summary', toString: 'late' }], same),
    history([{ field: 'summary', toString: 'early' }], '2026-11-21T10:00:00.000+0000'),
    history([{ field: 'summary', toString: 'tie' }], same),
  ], ctx, [{ id: 7, author: { accountId: 'acc-3' }, created: '2026-11-21T12:00:00.000+0000', body: textToAdf('hi') }])
  assert.deepEqual(events.map((e) => (e.op === 'create' ? e.op : e.to ?? e.op)), ['create', 'early', 'comment', 'late', 'tie'])
  assert.deepEqual(events.map((e) => e.op), ['create', 'update', 'comment', 'update', 'update'])
  assert.deepEqual(events[2], { at: '2026-11-21T12:00:00.000Z', by: 'acc-3', op: 'comment' })
})

test('toComment maps a comment node with its body from ADF', () => {
  assert.deepEqual(toComment({ id: 7, author: { accountId: 'acc-3' }, created: '2026-11-21T12:00:00.000+0000', body: textToAdf('hello\n') }, 'ENG-1'), { id: '7', issue: 'ENG-1', author: 'acc-3', body: 'hello', created: '2026-11-21T12:00:00.000Z' })
  assert.equal(toComment({ id: 8, created: '2026-11-21T12:00:00.000+0000', body: null }, 'ENG-1').author, null)
})

test('sprint changes give one sprint event from the sprint ids removed and added', async () => {
  const base = await context()
  const ctx = { ...base, fields: { ...base.fields, sprint: 'customfield_10020' } }
  const sprint = async (from, to) => toEvents(ITEM, [history([{ field: 'Sprint', fieldtype: 'custom', fieldId: 'customfield_10020', from, to }])], ctx).slice(1).map((e) => [e.op, e.field, e.from, e.to])
  assert.deepEqual(await sprint('42, 43', '42'), [['update', 'sprint', '43', null]])
  assert.deepEqual(await sprint('43', '43, 44'), [['update', 'sprint', '43', '44']])
  assert.deepEqual(await sprint('', '44'), [['update', 'sprint', null, '44']])
  assert.deepEqual(await sprint(null, '44'), [['update', 'sprint', null, '44']])
  assert.deepEqual(await sprint('43', null), [['update', 'sprint', '43', null]])
  assert.deepEqual(await sprint('42, 43', '42, 43'), [])
})

test('the time a worklog adds is no event of the changelog, so it is not counted twice (PMK-80)', async () => {
  const events = toEvents(ITEM, [history([
    { field: 'timespent', fieldId: 'timespent', from: null, fromString: null, to: '2700', toString: '2700' },
    { field: 'WorklogId', from: null, fromString: null, to: '10000', toString: '10000' },
  ])], await context())
  assert.deepEqual(events, [CREATE])
  assert.equal((await one({ field: 'timeestimate', fieldId: 'timeestimate', from: '3600', to: '900' })).field, 'jira:timeestimate')
})

test('the worklogs join the events as log_time events, sorted by time (PMK-80)', async () => {
  const worklogs = [{ id: '1', author: { accountId: 'acc-2' }, started: '2026-11-21T09:00:00.000+0000', timeSpentSeconds: 600 }]
  const events = toEvents(ITEM, [], await context(), [], worklogs)
  assert.deepEqual(events, [CREATE, { at: '2026-11-21T09:00:00.000Z', by: 'acc-2', op: 'log_time', minutes: 10 }])
})
