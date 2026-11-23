// Tests of the Jira Deliverables family (PMK-79): epics as epic-level work items and status updates as comments with the
// pmkit.statusUpdate property, over the stateful fake Jira, through the tracker that wires them.
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
const TYPES = { story: 'Story', subtask: 'Sub-task' }

function setup({ requireResolution, routes = {}, fakeNow } = {}) {
  const fake = fakeJiraIssues({ requireResolution, now: fakeNow })
  const fetch = fakeJiraFetch({ ...fake.routes, ...routes })
  const config = { root: tempDir(), pmkit: { version: 1, tracker: TRACKER, mappings: { types: TYPES } } }
  const tracker = createJiraTracker(config, { env: { ...FAKE_ENV, ...userStoreEnv().env }, now: NOW, fetch })
  return { fake, fetch, tracker }
}

const writes = (fetch) => fetch.calls.filter((call) => call.method !== 'GET').length
const code = (expected, message) => (error) => error.code === expected && (message === undefined || error.message === message)

test('createDeliverable: a dry run sends no write, a real run creates an Epic work item with its dates', async () => {
  const { fetch, tracker } = setup()
  await tracker.listDeliverables()
  const sent = writes(fetch)
  const input = { title: 'Launch', start: '2026-12-01', target: '2026-12-31', description: 'Why we launch.' }
  const dry = await tracker.createDeliverable(input, ME, { dryRun: true })
  assert.equal(writes(fetch), sent)
  assert.deepEqual(dry, { before: null, after: { id: null, title: 'Launch', status: { name: 'To Do', category: 'todo' }, start: '2026-12-01', target: '2026-12-31', description: 'Why we launch.' } })
  const made = await tracker.createDeliverable(input, ME)
  assert.equal(made.before, null)
  assert.deepEqual(made.after, {
    id: 'ENG-1', title: 'Launch', status: { name: 'To Do', category: 'todo' }, start: '2026-12-01', target: '2026-12-31', description: 'Why we launch.', url: 'https://acme.atlassian.net/browse/ENG-1',
  })
  assert.deepEqual(await tracker.getDeliverable('eng-1'), made.after)
  const post = fetch.calls.find((call) => call.method === 'POST' && call.url.endsWith('/rest/api/3/issue'))
  const { fields } = JSON.parse(post.body)
  assert.deepEqual(fields.project, { key: 'ENG' })
  assert.deepEqual(fields.issuetype, { id: '10000' })
  assert.equal(fields.customfield_10015, '2026-12-01')
  assert.equal(fields.duedate, '2026-12-31')
})

test('createDeliverable refuses a milestone, a goal and a bad date before any write', async () => {
  const { fetch, tracker } = setup()
  await assert.rejects(tracker.createDeliverable({ title: 'x', milestone: 'm1' }, ME), code('NOT_SUPPORTED', 'Jira has no milestones'))
  await assert.rejects(tracker.createDeliverable({ title: 'x', goal: 'g1' }, ME), code('NOT_SUPPORTED', 'Jira goals live in Atlassian Home, which pmkit does not read'))
  await assert.rejects(tracker.createDeliverable({ title: 'x', target: '2026-02-30' }, ME), code('INVALID_INPUT'))
  await assert.rejects(tracker.createDeliverable({ title: '' }, ME), code('INVALID_INPUT'))
  await assert.rejects(tracker.createDeliverable({ title: 'x' }, 'someone-else'), code('INVALID_INPUT'))
  await assert.rejects(tracker.setEpicGoal('ENG-1', 'g1', ME), code('NOT_SUPPORTED', 'Jira goals live in Atlassian Home, which pmkit does not read'))
  assert.equal(writes(fetch), 0)
})

test('getDeliverable: a Story key, an unknown key, another space and a malformed id are NOT_FOUND', async () => {
  const { tracker } = setup()
  await tracker.createDeliverable({ title: 'Epic' }, ME)
  const story = (await tracker.createIssue({ title: 'A story', type: 'story' }, ME)).after.id
  for (const id of [story, 'ENG-99', 'OPS-1', 'not a key']) {
    await assert.rejects(tracker.getDeliverable(id), (error) => error.code === 'NOT_FOUND' && error.message === `epic ${id} does not exist` && error.nextStep === 'pmkit epic list')
  }
})

test('listDeliverables lists the epics only, by start date, then key', async () => {
  const { tracker } = setup()
  await tracker.createDeliverable({ title: 'No start' }, ME)
  await tracker.createDeliverable({ title: 'Later', start: '2026-12-01' }, ME)
  await tracker.createIssue({ title: 'A story', type: 'story' }, ME)
  await tracker.createDeliverable({ title: 'Sooner', start: '2026-11-01' }, ME)
  assert.deepEqual((await tracker.listDeliverables()).map((epic) => [epic.id, epic.title]), [['ENG-4', 'Sooner'], ['ENG-2', 'Later'], ['ENG-1', 'No start']])
})

test('deliverableProgress counts the children of the epic and their subtasks', async () => {
  const { tracker } = setup({ requireResolution: false })
  const epic = (await tracker.createDeliverable({ title: 'Epic' }, ME)).after.id
  const story = (await tracker.createIssue({ title: 'Story', type: 'story', parent: epic }, ME)).after.id
  const sub = (await tracker.createIssue({ title: 'Sub', type: 'subtask', parent: story }, ME)).after.id
  await tracker.createIssue({ title: 'Elsewhere', type: 'story' }, ME)
  await tracker.moveToCategory(sub, 'done', ME)
  const progress = await tracker.deliverableProgress(epic)
  assert.equal(progress.total, 2)
  assert.equal(progress.done, 1)
  assert.deepEqual(progress.open, [story])
  assert.equal(progress.hasMore, undefined)
  await assert.rejects(tracker.deliverableProgress(story), code('NOT_FOUND'))
})

test('moveDeliverable refuses the category it has, dry runs with no write, and a done move needing a resolution fails with requiredFields', async () => {
  const { fetch, tracker } = setup({ requireResolution: true })
  const epic = (await tracker.createDeliverable({ title: 'Moves' }, ME)).after
  await assert.rejects(tracker.moveDeliverable(epic.id, 'todo', ME), code('INVALID_INPUT', `epic ${epic.id} is already in todo`))
  const sent = writes(fetch)
  const dry = await tracker.moveDeliverable(epic.id, 'in_progress', ME, { dryRun: true })
  assert.equal(writes(fetch), sent)
  assert.deepEqual(dry.after, { ...epic, status: { name: 'In Progress', category: 'in_progress' } })
  const moved = await tracker.moveDeliverable(epic.id, 'in_progress', ME)
  assert.deepEqual(moved.before, epic)
  assert.deepEqual(moved.after.status, { name: 'In Progress', category: 'in_progress' })
  await assert.rejects(tracker.moveDeliverable(epic.id, 'done', ME), (error) => error.code === 'INVALID_INPUT' && Array.isArray(error.details?.requiredFields) && /in Jira/.test(error.nextStep))
  assert.equal((await tracker.getDeliverable(epic.id)).status.category, 'in_progress')
})

test('updateDeliverable writes the title and description, and refuses an edit that changes nothing', async () => {
  const { tracker } = setup()
  const epic = (await tracker.createDeliverable({ title: 'Edits', description: 'First.' }, ME)).after
  await assert.rejects(tracker.updateDeliverable(epic.id, { title: 'Edits' }, ME), code('INVALID_INPUT', `epic ${epic.id} already has this title and description`))
  const edited = await tracker.updateDeliverable(epic.id, { title: 'Edited', description: '' }, ME)
  assert.equal(edited.before.title, 'Edits')
  assert.equal(edited.after.title, 'Edited')
  assert.equal(edited.after.description, '')
})

test('publishStatusUpdate posts a marked comment; listStatusUpdates reads them newest first and leaves human comments out', async () => {
  const { fetch, tracker } = setup()
  const epic = (await tracker.createDeliverable({ title: 'Updates' }, ME)).after.id
  const sent = writes(fetch)
  const dry = await tracker.publishStatusUpdate({ epic, health: 'on_track', body: 'dry' }, ME, { dryRun: true })
  assert.equal(writes(fetch), sent)
  assert.deepEqual(dry, { before: null, after: { epic, at: '2026-11-22T12:00:00.000Z', author: ME, health: 'on_track', body: 'dry' } })
  const first = await tracker.publishStatusUpdate({ epic, health: 'on_track', body: ' All good. ' }, ME)
  assert.equal(first.after.body, 'All good.')
  assert.equal(first.after.author, ME)
  await tracker.comment(epic, 'Status update: On track\n\nfine', ME)
  await tracker.publishStatusUpdate({ epic, health: 'at_risk', body: 'Slipping.' }, ME)
  const post = fetch.calls.filter((call) => call.method === 'POST' && call.url.endsWith('/comment')).at(-1)
  assert.deepEqual(JSON.parse(post.body).properties, [{ key: 'pmkit.statusUpdate', value: { health: 'at_risk' } }])
  const updates = await tracker.listStatusUpdates(epic)
  assert.deepEqual(updates.map((update) => [update.health, update.body]), [['at_risk', 'Slipping.'], ['on_track', 'All good.']])
  assert.deepEqual(Object.keys(updates[0]).sort(), ['at', 'author', 'body', 'epic', 'health'])
  assert.equal((await tracker.getDeliverable(epic)).health, 'at_risk')
  await assert.rejects(tracker.publishStatusUpdate({ epic, health: 'fine', body: 'x' }, ME), code('INVALID_INPUT'))
  await assert.rejects(tracker.publishStatusUpdate({ epic, health: 'on_track', body: ' ' }, ME), code('INVALID_INPUT'))
})

test('status updates at the same time list the later comment first', async () => {
  const { tracker } = setup({ fakeNow: () => Date.parse('2026-11-22T10:00:00Z') })
  const epic = (await tracker.createDeliverable({ title: 'Ties' }, ME)).after.id
  for (const body of ['one', 'two', 'three']) await tracker.publishStatusUpdate({ epic, health: 'on_track', body }, ME)
  assert.deepEqual((await tracker.listStatusUpdates(epic)).map((update) => update.body), ['three', 'two', 'one'])
})

test('a space without an epic work type refuses every deliverable operation', async () => {
  const fake = fakeJiraIssues()
  const project = fake.routes['GET /rest/api/3/project/ENG'].json
  const { tracker } = setup({ routes: { 'GET /rest/api/3/project/ENG': { json: { ...project, issueTypes: project.issueTypes.filter((type) => type.name !== 'Epic') } } } })
  const refused = (error) => error.code === 'NOT_SUPPORTED' && error.message === 'Space ENG has no epic work type' && error.nextStep === '/pmkit:setup'
  await assert.rejects(tracker.listDeliverables(), refused)
  await assert.rejects(tracker.getDeliverable('ENG-1'), refused)
  await assert.rejects(tracker.createDeliverable({ title: 'x' }, ME), refused)
  await assert.rejects(tracker.listStatusUpdates('ENG-1'), refused)
  await assert.rejects(tracker.publishStatusUpdate({ epic: 'ENG-1', health: 'on_track', body: 'x' }, ME), refused)
  await assert.rejects(tracker.moveDeliverable('ENG-1', 'done', ME), refused)
  await assert.rejects(tracker.updateDeliverable('ENG-1', { title: 'x' }, ME), refused)
  await assert.rejects(tracker.deliverableProgress('ENG-1'), refused)
})

test('createDeliverable with a start date refuses a space with no start date field', async () => {
  const fake = fakeJiraIssues()
  const fetch = fakeJiraFetch(fake.routes)
  const config = { root: tempDir(), pmkit: { version: 1, tracker: TRACKER, mappings: { types: TYPES, fields: { start_date: 'none' } } } }
  const tracker = createJiraTracker(config, { env: { ...FAKE_ENV, ...userStoreEnv().env }, now: NOW, fetch })
  await assert.rejects(tracker.createDeliverable({ title: 'x', start: '2026-12-01' }, ME), code('NOT_SUPPORTED', 'No start date field in space ENG'))
  assert.equal(writes(fetch), 0)
})
