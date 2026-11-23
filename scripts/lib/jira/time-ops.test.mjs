// Tests of the Jira time tracking (PMK-80): logTime writes a worklog, listTimeEntries reads them, and worklogs are log_time events
// in the history and the metric events, over the stateful fake Jira, through the tracker that wires them.
import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_ENV, TRACKER, fakeJiraFetch } from '../../fake-jira-api.mjs'
import { fakeJiraIssues } from '../../fake-jira-issues.mjs'
import { tempDir, userStoreEnv } from '../../test-helpers.mjs'
import { createJiraTracker } from './tracker.mjs'

globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

const NOW = () => new Date('2026-11-22T12:00:00Z')
const ME = 'acc-1'
const ACTIVE = { id: 1, state: 'active', name: 'Sprint 1', startDate: '2026-11-16T12:00:00.000Z', endDate: '2026-11-27T12:00:00.000Z' }
const UNDATED = { id: 2, state: 'future', name: 'Sprint 2' }
const TIME_OFF = { 'GET /rest/api/3/configuration': { json: { issueLinkingEnabled: true, timeTrackingEnabled: false } } }
const HINT = "Turn on time tracking in Jira's global settings"

function setup({ routes = {}, sprints = [], timeTracking } = {}) {
  const fake = fakeJiraIssues({ sprints, timeTracking })
  const fetch = fakeJiraFetch({ ...fake.routes, ...routes })
  const config = { root: tempDir(), pmkit: { version: 1, tracker: TRACKER, mappings: { types: { story: 'Story' } } } }
  const env = { ...FAKE_ENV, ...userStoreEnv().env }
  const tracker = createJiraTracker(config, { env, now: NOW, fetch })
  // Another run on the same repository and user store: it reads the discovery cache the first one wrote.
  const nextRun = () => createJiraTracker(config, { env, now: NOW, fetch })
  return { fake, fetch, tracker, nextRun }
}

const created = async (tracker) => (await tracker.createIssue({ title: 'Timed' }, ME)).after.id
const posts = (fetch) => fetch.calls.filter((call) => call.method === 'POST' && call.url.includes('/worklog'))
const code = (expected, message) => (error) => error.code === expected && (message === undefined || error.message === message)
const worklog = (id, timeSpentSeconds, started, accountId = ME) => ({ id, author: { accountId }, started, created: started, timeSpentSeconds })

test('logTime: a dry run sends nothing, a real run adds a worklog started now', async () => {
  const { fetch, tracker } = setup()
  const id = await created(tracker)
  const issue = await tracker.getIssue(id)
  assert.deepEqual(await tracker.logTime(id, 45, ME, { dryRun: true }), { before: issue, after: issue })
  assert.equal(posts(fetch).length, 0)
  const result = await tracker.logTime(id, 45, ME)
  assert.deepEqual(result.after.id, id)
  assert.deepEqual(posts(fetch).map((call) => JSON.parse(call.body)), [{ timeSpentSeconds: 2700, started: '2026-11-22T12:00:00.000+0000' }])
})

test('logTime refuses bad minutes, another actor and an unknown key before any write', async () => {
  const { fetch, tracker } = setup()
  const id = await created(tracker)
  await assert.rejects(tracker.logTime(id, 0, ME), code('INVALID_INPUT', 'minutes must be a positive integer'))
  await assert.rejects(tracker.logTime(id, 1.5, ME), code('INVALID_INPUT', 'minutes must be a positive integer'))
  await assert.rejects(tracker.logTime(id, 10, 'acc-2'), code('INVALID_INPUT'))
  await assert.rejects(tracker.logTime('ENG-99', 10, ME), code('NOT_FOUND'))
  assert.equal(posts(fetch).length, 0)
})

test('time tracking off: logTime and listTimeEntries refuse with the manifest hint', async () => {
  const { fetch, tracker } = setup({ routes: TIME_OFF })
  const id = await created(tracker)
  await assert.rejects(tracker.logTime(id, 10, ME), code('NOT_SUPPORTED', HINT))
  await assert.rejects(tracker.listTimeEntries(id), code('NOT_SUPPORTED', HINT))
  assert.equal(posts(fetch).length, 0)
})

test('listTimeEntries: the worklogs as entries, rounded, with the ignored ones counted and the board sprint of each', async () => {
  const { fake, tracker } = setup({ sprints: [ACTIVE, UNDATED] })
  const id = await created(tracker)
  fake.state.worklogs[id] = [
    worklog('1', 2700, '2026-11-20T10:00:00.000+0000'),
    worklog('2', 20, '2026-11-20T11:00:00.000+0000'),
    worklog('3', 5400, '2026-11-10T09:00:00.000+0000', 'acc-2'),
  ]
  const result = await tracker.listTimeEntries(id)
  assert.deepEqual(result, {
    issue: id,
    entries: [
      { at: '2026-11-20T10:00:00.000Z', by: 'acc-1', minutes: 45, time: '45m' },
      { at: '2026-11-10T09:00:00.000Z', by: 'acc-2', minutes: 90, time: '1h30' },
    ],
    total: 135,
    totalTime: '2h15',
    byPerson: [{ by: 'acc-1', minutes: 45, time: '45m' }, { by: 'acc-2', minutes: 90, time: '1h30' }],
    bySprint: [{ sprint: '1', minutes: 45, time: '45m' }, { sprint: null, minutes: 90, time: '1h30' }],
    ignored: 1,
  })
  await assert.rejects(tracker.listTimeEntries('ENG-99'), code('NOT_FOUND'))
})

test('the logged time is one log_time event in the history and the metric events, never a timespent change', async () => {
  const { tracker } = setup()
  const id = await created(tracker)
  await tracker.logTime(id, 45, ME)
  const history = await tracker.getHistory(id)
  assert.deepEqual(history.filter((event) => event.op === 'log_time'), [{ at: '2026-11-22T12:00:00.000Z', by: ME, op: 'log_time', minutes: 45 }])
  assert.ok(!history.some((event) => event.field === 'jira:timespent' || event.field === 'jira:WorklogId'))
  const metric = (await tracker.metricEvents()).filter((event) => event.op === 'log_time')
  assert.deepEqual(metric, [{ at: '2026-11-22T12:00:00.000Z', by: ME, op: 'log_time', minutes: 45, issue: id }])
})

test('metricEvents reads every worklog of an item that has more than the 20 a search carries', async () => {
  const { fake, tracker } = setup()
  const id = await created(tracker)
  fake.state.worklogs[id] = Array.from({ length: 25 }, (_, n) => worklog(String(n + 1), 60, '2026-11-21T10:00:00.000+0000'))
  assert.equal((await tracker.metricEvents()).filter((event) => event.op === 'log_time').length, 25)
  assert.equal((await tracker.getHistory(id)).filter((event) => event.op === 'log_time').length, 25)
})

test('time tracking off: the history still reads, with no log_time event', async () => {
  const { tracker } = setup({ timeTracking: false })
  const id = await created(tracker)
  assert.deepEqual((await tracker.getHistory(id)).map((event) => event.op), ['create'])
})

test('a cached answer that time tracking is off is read again before logTime refuses', async () => {
  let on = false
  const configuration = () => ({ status: 200, json: on ? { issueLinkingEnabled: true, timeTrackingEnabled: true } : { issueLinkingEnabled: true, timeTrackingEnabled: false } })
  const { fetch, tracker, nextRun } = setup({ routes: { 'GET /rest/api/3/configuration': configuration } })
  const id = await created(tracker)
  await assert.rejects(tracker.logTime(id, 10, ME), code('NOT_SUPPORTED', HINT))
  on = true
  await nextRun().logTime(id, 10, ME)
  assert.equal(posts(fetch).length, 1)
})
