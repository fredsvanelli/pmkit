// Tests of the pure Jira epic model (PMK-79): an epic work item as a pmkit epic, and a comment as a status update.
import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_ENV, TRACKER, fakeJiraFetch, jiraSiteRoutes } from '../../fake-jira-api.mjs'
import { adfToText, textToAdf } from './adf.mjs'
import { createJiraClient } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { EPIC_FIELDS, STATUS_UPDATE, statusUpdateBody, toEpic, toStatusUpdate } from './epics.mjs'
import { makeContext } from './issues.mjs'

globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

async function context(pmkit = {}) {
  const fetch = fakeJiraFetch(jiraSiteRoutes())
  const client = createJiraClient({ env: FAKE_ENV, tracker: TRACKER, fetch, sleep: async () => {} })
  const raw = await fetchDiscovery(client, { space: 'ENG', now: () => new Date('2026-11-22T12:00:00Z') })
  return makeContext(raw, { tracker: TRACKER, ...pmkit }, await client.session())
}

const epicItem = (fields = {}) => ({
  key: 'ENG-1',
  fields: {
    summary: 'Launch', status: { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate' } }, issuetype: { id: '10000', name: 'Epic' },
    description: textToAdf('Why we launch.'), duedate: '2026-12-31', customfield_10015: '2026-12-01', ...fields,
  },
})

test('EPIC_FIELDS reads the summary, status, type, description, due date and the start date field', async () => {
  assert.deepEqual(EPIC_FIELDS(await context()), ['summary', 'status', 'issuetype', 'description', 'duedate', 'customfield_10015'])
  assert.deepEqual(EPIC_FIELDS(await context({ mappings: { fields: { start_date: 'none' } } })), ['summary', 'status', 'issuetype', 'description', 'duedate'])
})

test('toEpic maps the key, summary, status, start, target, description, health and url', async () => {
  const held = await context()
  assert.deepEqual(toEpic(epicItem(), held, { health: 'at_risk' }), {
    id: 'ENG-1', title: 'Launch', status: { name: 'In Progress', category: 'in_progress' }, start: '2026-12-01', target: '2026-12-31',
    description: 'Why we launch.', health: 'at_risk', url: 'https://acme.atlassian.net/browse/ENG-1',
  })
  assert.deepEqual(toEpic(epicItem({ description: null, duedate: null, customfield_10015: null }), held, null), {
    id: 'ENG-1', title: 'Launch', status: { name: 'In Progress', category: 'in_progress' }, description: '', url: 'https://acme.atlassian.net/browse/ENG-1',
  })
})

test('toEpic drops the health of a done epic', async () => {
  const done = toEpic(epicItem({ status: { id: '5', name: 'Done', statusCategory: { key: 'done' } } }), await context(), { health: 'on_track' })
  assert.equal(done.status.category, 'done')
  assert.equal('health' in done, false)
})

test('statusUpdateBody puts the health label first, then the body', () => {
  assert.equal(adfToText(statusUpdateBody('off_track', 'Blocked on review.')), 'Status update: Off track\n\nBlocked on review.')
  assert.equal(adfToText(statusUpdateBody('on_track', 'x')).split('\n')[0], 'Status update: On track')
})

test('toStatusUpdate reads a comment with the pmkit.statusUpdate property', () => {
  const comment = {
    id: '10001', author: { accountId: 'acc-1' }, created: '2026-11-22T10:00:00.000+0000',
    body: statusUpdateBody('at_risk', 'Slipping a week.\n\nSee the plan.'), properties: [{ key: STATUS_UPDATE, value: { health: 'at_risk' } }],
  }
  assert.equal(STATUS_UPDATE, 'pmkit.statusUpdate')
  assert.deepEqual(toStatusUpdate(comment, 'ENG-1'), { epic: 'ENG-1', at: '2026-11-22T10:00:00.000Z', author: 'acc-1', health: 'at_risk', body: 'Slipping a week.\n\nSee the plan.' })
})

test('toStatusUpdate is null for a human comment that only looks like an update', () => {
  const comment = { id: '10002', author: { accountId: 'acc-2' }, created: '2026-11-22T10:00:00.000+0000', body: textToAdf('Status update: On track\n\nfine') }
  assert.equal(toStatusUpdate(comment, 'ENG-1'), null)
  assert.equal(toStatusUpdate({ ...comment, properties: [{ key: 'other', value: {} }] }, 'ENG-1'), null)
})
