// Tests of the Jira Relations family (link, unlink, setParent) over
// the stateful fake Jira, through the tracker that gives them their context.
import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_ENV, TRACKER, fakeJiraFetch } from '../../fake-jira-api.mjs'
import { fakeJiraIssues } from '../../fake-jira-issues.mjs'
import { tempDir, userStoreEnv } from '../../test-helpers.mjs'
import { textToAdf } from './adf.mjs'
import { groupEventsByIssue, throughput } from '../metrics.mjs'
import { createJiraTracker } from './tracker.mjs'

globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

const NOW = () => new Date('2026-11-22T12:00:00Z')
const TYPES = { story: 'Story', bug: 'Bug', epic: 'Epic', subtask: 'Sub-task' }
const STATUS = {
  todo: { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
  doing: { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
  done: { id: '5', name: 'Done', statusCategory: { key: 'done' } },
}
const WORK_TYPE = { story: { id: '10001', name: 'Story' }, epic: { id: '10000', name: 'Epic' } }

/** A tracker over a fresh fake, its own user store and repository root. */
function setup({ requireResolution, pmkit = {}, routes = {}, context, sprints } = {}) {
  const fake = fakeJiraIssues({ requireResolution, sprints })
  const fetch = fakeJiraFetch({ ...fake.routes, ...routes })
  const at = context ?? { root: tempDir(), env: { ...FAKE_ENV, ...userStoreEnv().env } }
  const config = { root: at.root, pmkit: { version: 1, tracker: TRACKER, mappings: { types: TYPES }, ...pmkit } }
  const tracker = createJiraTracker(config, { env: at.env, now: NOW, fetch })
  return { fake, fetch, tracker, context: at }
}

/** Puts `count` Story items into the fake's state directly, one second apart, with `fields` over the defaults. */
function seed(state, count = 1, fields = {}) {
  const keys = []
  for (let index = 0; index < count; index += 1) {
    const number = state.next.item++
    const time = new Date(Date.parse('2026-11-01T00:00:00Z') + number * 1000).toISOString().replace('Z', '+0000')
    const key = `ENG-${number}`
    state.items[key] = {
      id: String(10000 + number), key,
      fields: {
        summary: `Item ${number}`, description: null, status: STATUS.todo, issuetype: WORK_TYPE.story, priority: null, assignee: null,
        labels: [], parent: null, duedate: null, resolution: null, creator: { accountId: 'acc-1' }, created: time, updated: time,
        ...(typeof fields === 'function' ? fields(number) : fields),
      },
    }
    keys.push(key)
  }
  return keys
}

const ME = 'acc-1'

test('getHistory gives create, update and comment events in time order', async () => {
  const { fake, tracker } = setup()
  seed(fake.state)
  await tracker.updateIssue('ENG-1', { title: 'New' }, ME)
  await tracker.comment('ENG-1', 'Hello', ME)
  const events = await tracker.getHistory('ENG-1')
  assert.deepEqual(events.map((e) => e.op), ['create', 'update', 'comment'])
  assert.equal(events[1].field, 'title')
  assert.equal(events[1].to, 'New')
})

test('getHistory gives a sprint event when an item joins a sprint and when it goes back to the backlog', async () => {
  const sprint = { id: 1, state: 'active', name: 'Sprint 1', startDate: '2026-11-09T12:00:00.000Z', endDate: '2026-11-20T12:00:00.000Z' }
  const { fake, tracker } = setup({ sprints: [sprint], pmkit: { mappings: { types: TYPES, fields: { sprint: 'customfield_10020' } } } })
  const [key] = seed(fake.state)
  await tracker.updateIssue(key, { sprint: '1' }, ME)
  await tracker.updateIssue(key, { sprint: null }, ME)
  const events = (await tracker.getHistory(key)).filter((e) => e.field === 'sprint')
  assert.deepEqual(events.map((e) => [e.op, e.from, e.to]), [['update', null, '1'], ['update', '1', null]])
})

test('getHistory since keeps the events at or after the instant', async () => {
  const { fake, tracker } = setup()
  seed(fake.state)
  await tracker.updateIssue('ENG-1', { title: 'New' }, ME)
  const all = await tracker.getHistory('ENG-1')
  const since = all[1].at.replace('.000Z', 'Z')
  assert.deepEqual((await tracker.getHistory('ENG-1', { since })).map((e) => e.op), ['update'])
})

test('getHistory of an unknown key is NOT_FOUND', async () => {
  const { tracker } = setup()
  await assert.rejects(tracker.getHistory('ENG-99'), { code: 'NOT_FOUND' })
})

test('listComments gives the comments with their text in created order', async () => {
  const { fake, tracker } = setup()
  seed(fake.state)
  await tracker.comment('ENG-1', 'First', ME)
  await tracker.comment('ENG-1', 'Second', ME)
  const comments = await tracker.listComments('ENG-1')
  assert.deepEqual(comments.map((c) => [c.issue, c.author, c.body]), [['ENG-1', ME, 'First'], ['ENG-1', ME, 'Second']])
})

test('comment posts the body as ADF and returns the comment', async () => {
  const { fake, tracker } = setup()
  seed(fake.state)
  const made = await tracker.comment('ENG-1', ' Hi there ', ME)
  assert.equal(made.body, 'Hi there')
  assert.equal(made.issue, 'ENG-1')
  assert.deepEqual(fake.writes(), [{ method: 'POST', path: '/rest/api/3/issue/ENG-1/comment', body: { body: textToAdf('Hi there') } }])
})

test('comment dry run returns the comment with id null and sends nothing', async () => {
  const { fake, tracker } = setup()
  seed(fake.state)
  const made = await tracker.comment('ENG-1', 'Hi', ME, { dryRun: true })
  assert.deepEqual(made, { id: null, issue: 'ENG-1', author: ME, body: 'Hi', created: '2026-11-22T12:00:00.000Z' })
  assert.deepEqual(fake.writes(), [])
})

test('comment refuses an empty body, a reply and another actor, sending nothing', async () => {
  const { fake, tracker } = setup()
  seed(fake.state)
  await assert.rejects(tracker.comment('ENG-1', '  ', ME), { code: 'INVALID_INPUT', message: 'comment body must be a non-empty string' })
  await assert.rejects(tracker.comment('ENG-1', 'x', ME, { replyTo: '1' }), { code: 'NOT_SUPPORTED', message: 'Jira comments have no threads' })
  await assert.rejects(tracker.comment('ENG-1', 'x', 'acc-9'), { code: 'INVALID_INPUT' })
  assert.deepEqual(fake.writes(), [])
})

test('resolveThread is NOT_SUPPORTED', async () => {
  const { tracker } = setup()
  await assert.rejects(tracker.resolveThread('ENG-1', '1', ME), { code: 'NOT_SUPPORTED', message: 'Jira comments have no threads' })
})

test('metricEvents tags the issue, filters by since and until, and sorts by time', async () => {
  const { fake, tracker } = setup()
  seed(fake.state, 2)
  await tracker.updateIssue('ENG-2', { title: 'B' }, ME)
  await tracker.updateIssue('ENG-1', { title: 'A' }, ME)
  const all = await tracker.metricEvents()
  assert.deepEqual(all.map((e) => [e.issue, e.op]), [['ENG-1', 'create'], ['ENG-2', 'create'], ['ENG-2', 'update'], ['ENG-1', 'update']])
  assert.equal(all.warnings, undefined)
  const times = all.map((e) => e.at)
  assert.deepEqual(times, [...times].sort())
  const cut = await tracker.metricEvents({ since: times[2], until: times[2] })
  assert.deepEqual(cut.map((e) => [e.issue, e.op]), [['ENG-2', 'update']])
  assert.deepEqual((await tracker.metricEvents({ until: '2000-01-01' })), [])
})

test('metricEvents feed throughput per pmkit type', async () => {
  const { fake, tracker } = setup()
  seed(fake.state, 1)
  seed(fake.state, 1, { status: STATUS.done, issuetype: { id: '10004', name: 'Bug' } })
  seed(fake.state, 1, { status: STATUS.done })
  const byIssue = groupEventsByIssue(await tracker.metricEvents())
  const categoryOf = (name) => ({ 'To Do': 'todo', 'In Progress': 'in_progress', Done: 'done' })[name] ?? null
  assert.deepEqual(throughput(byIssue, { categoryOf }).byType, { bug: 1, story: 1 })
})

test('metricEvents leave epics out (ADR 0017)', async () => {
  const { fake, tracker } = setup()
  seed(fake.state, 1, { status: STATUS.done })
  seed(fake.state, 1, { status: STATUS.done, issuetype: WORK_TYPE.epic })
  assert.deepEqual([...new Set((await tracker.metricEvents()).map((e) => e.issue))], ['ENG-1'])
})

test('metricEvents searches the space by update date, newest first, with the changelog', async () => {
  const seen = []
  const fake = fakeJiraIssues()
  const search = fake.routes['GET /rest/api/3/search/jql']
  const routes = { 'GET /rest/api/3/search/jql': (call) => { seen.push(Object.fromEntries(new URL(call.url).searchParams)); return search(call) } }
  const { tracker } = setup({ routes: { ...fake.routes, ...routes } })
  assert.ok(tracker)
  seed(fake.state)
  await tracker.metricEvents({ since: '2026-11-10T08:00:00Z' })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].jql, 'project = "ENG" AND issuetype not in ("10000") AND updated >= "2026-11-09" ORDER BY updated DESC')
  assert.equal(seen[0].expand, 'changelog')
  assert.equal(seen[0].maxResults, '100')
})

test('metricEvents reads 1000 items and warns when Jira has more', async () => {
  const { fake, tracker } = setup()
  seed(fake.state, 1001)
  const events = await tracker.metricEvents()
  assert.equal(events.length, 1000)
  assert.deepEqual(events.warnings, ['Jira has more updated work items than the 1000 pmkit read; metrics cover the most recently updated'])
  assert.equal(Object.keys(events).length, 1000)
})

test('metricEvents reads the full changelog of an item whose search copy Jira cut', async () => {
  const fake = fakeJiraIssues()
  const search = fake.routes['GET /rest/api/3/search/jql']
  const cut = (call) => {
    const answer = search(call)
    for (const issue of answer.json.issues) if (issue.changelog) issue.changelog.total += 1
    return answer
  }
  const { tracker } = setup({ routes: { ...fake.routes, 'GET /rest/api/3/search/jql': cut } })
  seed(fake.state)
  await tracker.updateIssue('ENG-1', { title: 'A' }, ME)
  assert.deepEqual((await tracker.metricEvents()).map((e) => e.op), ['create', 'update'])
})

test('metricEvents with two events at the same time on two issues sorts by issue key', async () => {
  const { fake, tracker } = setup()
  seed(fake.state, 2, { created: '2026-11-01T00:00:00.000+0000', updated: '2026-11-01T00:00:00.000+0000' })
  const events = await tracker.metricEvents()
  assert.deepEqual(events.map((e) => [e.issue, e.op]), [['ENG-1', 'create'], ['ENG-2', 'create']])
  assert.equal(events[0].at, events[1].at)
})
