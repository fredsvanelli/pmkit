import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_ENV, TRACKER, fakeJiraFetch, jiraSiteRoutes } from '../../fake-jira-api.mjs'
import { createJiraClient } from './client.mjs'
import { categoryOfStatus, discoveryView, fetchDiscovery } from './discovery.mjs'

globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

const NOW = () => new Date('2026-11-22T12:00:00Z')

async function discover({ style, routes = {}, pmkit = {} } = {}) {
  const fetch = fakeJiraFetch({ ...jiraSiteRoutes({ style }), ...routes })
  const client = createJiraClient({ env: FAKE_ENV, tracker: TRACKER, fetch, sleep: async () => {} })
  const raw = await fetchDiscovery(client, { space: 'ENG', now: NOW })
  const view = discoveryView(raw, { tracker: TRACKER, ...pmkit }, { session: await client.session() })
  return { raw, view, fetch }
}

const denied = { status: 403, json: { errorMessages: ['no'] } }

test('categoryOfStatus reads the three Jira categories', () => {
  assert.equal(categoryOfStatus('new'), 'todo')
  assert.equal(categoryOfStatus('indeterminate'), 'in_progress')
  assert.equal(categoryOfStatus('done'), 'done')
  assert.equal(categoryOfStatus('undefined'), null)
})

test('the view leads with auth and names the viewer', async () => {
  const { view } = await discover()
  assert.equal(Object.keys(view)[0], 'auth')
  assert.deepEqual(view.auth, { source: 'JIRA_API_TOKEN', viewer: { accountId: 'acc-1', displayName: 'Test User' }, site: 'acme.atlassian.net' })
  assert.deepEqual(view.viewer, { id: 'acc-1', name: 'Test User' })
  assert.deepEqual(view.members, [{ id: 'acc-1', name: 'Test User' }, { id: 'acc-2', name: 'Second User' }])
  assert.equal(view.site, 'acme.atlassian.net')
  assert.deepEqual(view.plan, { software: 'paid' })
  assert.deepEqual(view.priorities, ['urgent', 'high', 'medium', 'low'])
  assert.deepEqual(view.labels, ['backend', 'frontend'])
  assert.equal(view.discoveredAt, '2026-11-22T12:00:00.000Z')
})

test('spaces carry their style', async () => {
  const { view } = await discover()
  assert.deepEqual(view.spaces, [
    { key: 'ENG', name: 'Engineering', style: 'company-managed', type: 'software' },
    { key: 'OPS', name: 'Operations', style: 'team-managed', type: 'business' },
  ])
  assert.deepEqual(view.space, { key: 'ENG', name: 'Engineering', style: 'company-managed', type: 'software' })
  assert.equal((await discover({ style: 'team-managed' })).view.space.style, 'team-managed')
})

test('work types have a level and their statuses', async () => {
  const { view } = await discover()
  assert.deepEqual(view.workTypes, [
    { name: 'Epic', level: 'epic', statuses: ['To Do', 'In Progress', 'Done'] },
    { name: 'Story', level: 'standard', statuses: ['To Do', 'In Progress', 'Review', 'Done'] },
    { name: 'Bug', level: 'standard', statuses: ['To Do', 'In Progress', 'Done'] },
    { name: 'Sub-task', level: 'subtask', statuses: ['To Do', 'Done'] },
  ])
  const deep = await discover({ routes: { 'GET /rest/api/3/project/ENG': { json: { id: '10001', key: 'ENG', name: 'Engineering', projectTypeKey: 'software', style: 'classic', issueTypes: [{ id: '9', name: 'Initiative', hierarchyLevel: 2 }] } } } })
  assert.equal(deep.view.workTypes[0].level, '2')
})

test('statuses take the Jira category or the mapping', async () => {
  const plain = await discover()
  assert.deepEqual(plain.view.statuses, [
    { name: 'To Do', category: 'todo' },
    { name: 'In Progress', category: 'in_progress' },
    { name: 'Done', category: 'done' },
    { name: 'Review', category: 'in_progress' },
  ])
  const mapped = await discover({ pmkit: { mappings: { status: { in_review: 'Review', canceled: 'Dropped', blocked: 'Review' } } } })
  assert.equal(mapped.view.statuses.find((s) => s.name === 'Review').category, 'in_review')
  assert.ok(mapped.view.warnings.includes('mappings.status.canceled names Dropped, which space ENG does not have'))
})

test('a status with no category counts as in_progress with a warning', async () => {
  const odd = { id: '9', name: 'Limbo', statusCategory: { key: 'undefined', name: 'No Category' } }
  const { view } = await discover({ routes: { 'GET /rest/api/3/project/ENG/statuses': { json: [{ id: '10001', name: 'Story', statuses: [odd] }] } } })
  assert.deepEqual(view.statuses, [{ name: 'Limbo', category: 'in_progress' }])
  assert.ok(view.warnings.includes('Jira status Limbo in space ENG has no status category pmkit knows; it counts as in_progress'))
})

test('fields resolve per role', async () => {
  const { view } = await discover()
  assert.deepEqual(view.fields, {
    estimate: { id: 'customfield_10016', name: 'Story Points' },
    priority: { id: 'priority', name: 'Priority' },
    target_date: { id: 'duedate', name: 'Due date' },
    start_date: { id: 'customfield_10015', name: 'Start date' },
    assignee: { id: 'assignee', name: 'Assignee' },
    acceptance_criteria: null,
    time_spent: { id: 'timespent', name: 'Time Spent' },
    sprint: { id: 'customfield_10020', name: 'Sprint' },
  })
  assert.deepEqual(view.estimate, { unit: 'points', scale: [] })
})

test('without a board the estimate comes from the story points field type', async () => {
  const { view } = await discover({ style: 'team-managed', routes: { 'GET /rest/agile/1.0/board': { json: { isLast: true, values: [] } } } })
  assert.deepEqual(view.fields.estimate, { id: 'customfield_10016', name: 'Story point estimate' })
})

test('a field mapping wins, warns when the site lacks it, and none clears the role', async () => {
  const hours = await discover({ pmkit: { mappings: { fields: { estimate: 'timeoriginalestimate', sprint: 'none' } } } })
  assert.deepEqual(hours.view.fields.estimate, { id: 'timeoriginalestimate', name: 'Original estimate' })
  assert.deepEqual(hours.view.estimate, { unit: 'hours', scale: [] })
  assert.equal(hours.view.fields.sprint, null)
  const missing = await discover({ pmkit: { mappings: { fields: { estimate: 'customfield_404' } } } })
  assert.equal(missing.view.fields.estimate.id, 'customfield_10016')
  assert.ok(missing.view.warnings.includes('mappings.fields.estimate names customfield_404, which acme.atlassian.net does not have'))
})

test('scoped fields of another space are dropped', async () => {
  const { raw, view } = await discover({ style: 'team-managed' })
  assert.deepEqual(raw.fields.filter((f) => f.name === 'Story point estimate').map((f) => f.id), ['customfield_10016'])
  assert.equal(view.fields.estimate.id, 'customfield_10016')
  assert.equal(view.workTypes.length, 4)
})

test('raw fields keep their schema type', async () => {
  const { raw } = await discover()
  assert.deepEqual(raw.fields.find((f) => f.id === 'customfield_10016'), { id: 'customfield_10016', name: 'Story Points', system: null, customType: 'com.atlassian.jira.plugin.system.customfieldtypes:float', type: 'number' })
  assert.equal(raw.fields.find((f) => f.id === 'summary').type, 'string')
})

test('optional reads degrade to warnings', async () => {
  const { raw, view } = await discover({
    routes: { 'GET /rest/api/3/label': denied, 'GET /rest/api/3/instance/license': denied, 'GET /rest/api/3/configuration': denied, 'GET /rest/agile/1.0/board': denied },
  })
  assert.equal(raw.labels, null)
  assert.deepEqual(raw.license, { software: null })
  assert.equal(raw.settings, null)
  assert.equal(raw.board, null)
  assert.deepEqual(view.labels, [])
  for (const what of ['labels', 'license', 'global settings', 'boards']) {
    assert.ok(view.warnings.some((w) => w.startsWith(`Jira refused to read the ${what}`)), what)
  }
})

test('a rate limit on an optional read propagates', async () => {
  await assert.rejects(discover({ routes: { 'GET /rest/api/3/instance/license': { status: 429, json: {} } } }), { code: 'RATE_LIMITED' })
})

test('an unknown space is NOT_CONFIGURED', async () => {
  await assert.rejects(discover({ routes: { 'GET /rest/api/3/project/ENG': { status: 404, json: { errorMessages: ['No project'] } } } }), {
    code: 'NOT_CONFIGURED',
    message: "tracker.scope.space names ENG, which acme.atlassian.net does not have or the token's owner cannot browse",
    nextStep: '/pmkit:setup',
  })
})

test('an unknown space is NOT_CONFIGURED when its statuses are 404 too, as on a real site', async () => {
  const missing = { status: 404, json: { errorMessages: ['No project'] } }
  await assert.rejects(discover({ routes: { 'GET /rest/api/3/project/ENG': missing, 'GET /rest/api/3/project/ENG/statuses': missing } }), {
    code: 'NOT_CONFIGURED',
    nextStep: '/pmkit:setup',
  })
})

test('a business space reads no board', async () => {
  const business = { json: { id: '10001', key: 'ENG', name: 'Engineering', projectTypeKey: 'business', style: 'classic', issueTypes: [] } }
  const { raw, fetch } = await discover({ routes: { 'GET /rest/api/3/project/ENG': business } })
  assert.equal(raw.board, null)
  assert.ok(!fetch.calls.some((call) => call.url.includes('/rest/agile/')))
})

test('the board read asks for the space and picks the Scrum board', async () => {
  const { raw, fetch } = await discover()
  assert.ok(fetch.calls.some((call) => call.url.includes('/rest/agile/1.0/board?') && call.url.includes('projectKeyOrId=ENG')))
  assert.deepEqual(raw.board, { id: 1, type: 'scrum', estimationField: 'customfield_10016' })
})

test('discovery reads the assignable users, the priorities and the link types', async () => {
  const { raw, view } = await discover()
  assert.deepEqual(raw.members, [{ id: 'acc-1', name: 'Test User' }, { id: 'acc-2', name: 'Second User' }])
  assert.deepEqual(raw.priorities.map((p) => p.name), ['Highest', 'High', 'Medium', 'Low', 'Lowest'])
  assert.deepEqual(raw.linkTypes.map((t) => t.name), ['Blocks', 'Duplicate', 'Relates'])
  assert.deepEqual(raw.linkTypes[0], { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' })
  assert.deepEqual(view.priorities, ['urgent', 'high', 'medium', 'low'])
})

test('a refused assignable read leaves the viewer as the only member, with a warning', async () => {
  const { raw, view } = await discover({ routes: { 'GET /rest/api/3/user/assignable/search': denied } })
  assert.equal(raw.members, null)
  assert.deepEqual(view.members, [{ id: 'acc-1', name: 'Test User' }])
  assert.ok(view.warnings.some((w) => w.includes('assignable users')))
})

test('a refused priority or link type read gives null and a warning', async () => {
  const { raw, view } = await discover({ routes: { 'GET /rest/api/3/priority': denied, 'GET /rest/api/3/issueLinkType': denied } })
  assert.equal(raw.priorities, null)
  assert.equal(raw.linkTypes, null)
  assert.ok(view.warnings.some((w) => w.includes('priorities')))
  assert.ok(view.warnings.some((w) => w.includes('link types')))
})

test('1000 assignable users give the truncation warning', async () => {
  const users = Array.from({ length: 1000 }, (_, i) => ({ accountId: `u-${i}`, displayName: `User ${i}`, accountType: 'atlassian' }))
  const { view } = await discover({ routes: { 'GET /rest/api/3/user/assignable/search': { json: users } } })
  assert.ok(view.warnings.some((w) => w.includes('Jira has more assignable users than pmkit read')))
})

test('the viewer is added to the members when Jira leaves it out', async () => {
  const { view } = await discover({ routes: { 'GET /rest/api/3/user/assignable/search': { json: [{ accountId: 'acc-9', displayName: 'Nine', accountType: 'atlassian' }] } } })
  assert.deepEqual(view.members, [{ id: 'acc-1', name: 'Test User' }, { id: 'acc-9', name: 'Nine' }])
})
