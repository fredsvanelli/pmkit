import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_ENV, TRACKER, fakeJiraFetch, jiraSiteRoutes } from '../../fake-jira-api.mjs'
import { createJiraClient } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { makeContext } from './issues.mjs'
import { jqlString, translateFilter } from './filter.mjs'

globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

async function context({ edit, types = { story: 'Story', bug: 'Bug', epic: 'Epic' } } = {}) {
  const fetch = fakeJiraFetch(jiraSiteRoutes())
  const client = createJiraClient({ env: FAKE_ENV, tracker: TRACKER, fetch, sleep: async () => {} })
  const raw = await fetchDiscovery(client, { space: 'ENG', now: () => new Date('2026-11-22T12:00:00Z') })
  edit?.(raw)
  return makeContext(raw, { tracker: TRACKER, mappings: { types } }, await client.session())
}

const TAIL = ' ORDER BY created ASC, key ASC'

test('jqlString quotes and escapes backslash and quote', () => {
  assert.equal(jqlString('a"b\\c'), '"a\\"b\\\\c"')
  assert.equal(jqlString('plain'), '"plain"')
})

test('an empty filter is the scope and the order', async () => {
  assert.deepEqual(translateFilter({}, await context()), { jql: `project = "ENG"${TAIL}`, clientSteps: [], serverLimit: undefined })
})

test('categories become the ids of their statuses; none means empty', async () => {
  const ctx = await context()
  const done = ctx.raw.statuses.filter((s) => ctx.categoryOf(s.name, s.categoryKey) === 'done').map((s) => `"${s.id}"`)
  assert.ok(done.length > 0)
  assert.equal(translateFilter({ categories: ['done'] }, ctx).jql, `project = "ENG" AND status in (${done.join(', ')})${TAIL}`)
  assert.deepEqual(translateFilter({ categories: ['canceled'] }, ctx), { empty: true })
  assert.deepEqual(translateFilter({ categories: [] }, ctx), { empty: true })
})

test('types become the ids of the mapped work types', async () => {
  const ctx = await context()
  const ids = ['story', 'bug'].map((t) => `"${ctx.workTypeOf(t).id}"`).join(', ')
  assert.equal(translateFilter({ types: ['story', 'bug'] }, ctx).jql, `project = "ENG" AND issuetype in (${ids})${TAIL}`)
  assert.deepEqual(translateFilter({ types: ['task'] }, ctx), { empty: true })
})

test('assignee: me, an account, none', async () => {
  const ctx = await context()
  assert.equal(translateFilter({ assignee: 'me' }, ctx).jql, `project = "ENG" AND assignee = "acc-1"${TAIL}`)
  assert.equal(translateFilter({ assignee: 'acc-9' }, ctx).jql, `project = "ENG" AND assignee = "acc-9"${TAIL}`)
  assert.equal(translateFilter({ assignee: 'none' }, ctx).jql, `project = "ENG" AND assignee is EMPTY${TAIL}`)
})

test('labels give one clause each; parent one clause', async () => {
  const ctx = await context()
  assert.equal(translateFilter({ labels: ['a', 'b"'], parent: 'ENG-1' }, ctx).jql, `project = "ENG" AND labels = "a" AND labels = "b\\"" AND parent = "ENG-1"${TAIL}`)
})

test('text searches summary and description and adds the text step', async () => {
  const out = translateFilter({ text: 'a"b' }, await context())
  assert.equal(out.jql, `project = "ENG" AND (summary ~ "a\\"b" OR description ~ "a\\"b")${TAIL}`)
  assert.deepEqual(out.clientSteps, ['text'])
})

test('blocked adds only the blocked step', async () => {
  const out = translateFilter({ blocked: false }, await context())
  assert.equal(out.jql, `project = "ENG"${TAIL}`)
  assert.deepEqual(out.clientSteps, ['blocked'])
})

test('updated dates widen past any time zone and add the updated step once', async () => {
  const ctx = await context()
  const out = translateFilter({ updatedAfter: '2026-11-10T12:00:00Z', updatedBefore: '2026-11-30T23:59:00Z' }, ctx)
  assert.equal(out.jql, `project = "ENG" AND updated < "2026-12-02" AND updated >= "2026-11-09"${TAIL}`)
  assert.deepEqual(out.clientSteps, ['updated'])
})

test('a late-in-day updatedBefore is not cut for users east of UTC', async () => {
  const out = translateFilter({ updatedBefore: '2026-01-02T20:00:00Z' }, await context())
  assert.equal(out.jql, `project = "ENG" AND updated < "2026-01-04"${TAIL}`)
})

test('archived adds nothing; sort other than created adds the sort step', async () => {
  const ctx = await context()
  assert.deepEqual(translateFilter({ archived: true, sort: 'created' }, ctx).clientSteps, [])
  assert.deepEqual(translateFilter({ sort: 'priority' }, ctx).clientSteps, ['sort'])
})

test('clientSteps keep a stable order', async () => {
  assert.deepEqual(translateFilter({ sort: 'due', updatedAfter: '2026-11-10T00:00:00Z', blocked: true, text: 'x' }, await context()).clientSteps, ['text', 'blocked', 'updated', 'sort'])
})

test('serverLimit only without steps and with sort created', async () => {
  const ctx = await context()
  assert.equal(translateFilter({ limit: 5 }, ctx).serverLimit, 5)
  assert.equal(translateFilter({ limit: 5, sort: 'created' }, ctx).serverLimit, 5)
  assert.equal(translateFilter({ limit: 5, sort: 'due' }, ctx).serverLimit, undefined)
  assert.equal(translateFilter({ limit: 5, text: 'x' }, ctx).serverLimit, undefined)
  assert.equal(translateFilter({}, ctx).serverLimit, undefined)
})

test('sprint and release are NOT_SUPPORTED naming their issues', async () => {
  const ctx = await context()
  assert.throws(() => translateFilter({ sprint: 'current' }, ctx), (e) => e.code === 'NOT_SUPPORTED' && e.message.includes('PMK-78'))
  assert.throws(() => translateFilter({ release: 'v1' }, ctx), (e) => e.code === 'NOT_SUPPORTED' && e.message.includes('PMK-79'))
  assert.doesNotThrow(() => translateFilter({ sprint: undefined, release: undefined }, ctx))
})
