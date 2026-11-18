// The pure mapping of GitHub milestones to pmkit milestones.
import assert from 'node:assert/strict'
import test from 'node:test'
import { MILESTONES_QUERY, STATUS_OF, parseEpicId, toEpic, toMilestone, toStatusUpdate } from './projects.mjs'

test('toMilestone uses the title as id and name, the date part of dueOn and the lower-case status', () => {
  assert.deepEqual(
    toMilestone({ id: 'MI_1', number: 1, title: 'v1.0', description: 'First release', dueOn: '2026-12-31T00:00:00Z', state: 'OPEN' }),
    { id: 'v1.0', name: 'v1.0', due: '2026-12-31', description: 'First release', status: 'open' },
  )
})

test('toMilestone omits a null due date and an empty description, and maps CLOSED', () => {
  assert.deepEqual(toMilestone({ id: 'MI_2', number: 2, title: 'Old', description: '', dueOn: null, state: 'CLOSED' }), { id: 'Old', name: 'Old', status: 'closed' })
  assert.deepEqual(toMilestone({ id: 'MI_3', number: 3, title: 'New', description: null, dueOn: null, state: 'OPEN' }), { id: 'New', name: 'New', status: 'open' })
})

test('toMilestone reads a REST answer, with due_on and a lower-case state', () => {
  assert.deepEqual(toMilestone({ number: 4, title: 'v2', node_id: 'MI_4', due_on: '2026-12-31T00:00:00Z', state: 'open', description: null }), { id: 'v2', name: 'v2', due: '2026-12-31', status: 'open' })
})

test('MILESTONES_QUERY starts with its operation and reads open and closed milestones', () => {
  assert.match(MILESTONES_QUERY, /^query PmkitMilestones\(/)
  assert.match(MILESTONES_QUERY, /states: \[OPEN, CLOSED\]/)
})

// The epic part: Projects as epics.
const PROJECT = { id: 'PVT_E12', number: 12, title: 'Epic twelve', closed: false, url: 'https://github.com/orgs/acme/projects/12', shortDescription: 'Short', readme: '', owner: { login: 'acme' } }
const update = (status, extra = {}) => ({ id: 'PVTSU_1', status, body: 'Text', startDate: null, targetDate: null, createdAt: '2026-11-10T09:00:00Z', creator: { login: 'octocat' }, ...extra })

test('parseEpicId reads owner/number and refuses anything else', () => {
  assert.deepEqual(parseEpicId('acme/12'), { owner: 'acme', number: 12 })
  assert.deepEqual(parseEpicId('ACME/12'), { owner: 'ACME', number: 12 })
  for (const bad of ['12', 'acme/x', 'acme/12/3', 'acme', '#12', 'acme/widgets#12', undefined, 12]) assert.equal(parseEpicId(bad), null, String(bad))
})

test('STATUS_OF holds the five statuses of a Project update', () => {
  assert.deepEqual(STATUS_OF, { INACTIVE: ['Inactive', 'backlog'], ON_TRACK: ['On track', 'in_progress'], AT_RISK: ['At risk', 'in_progress'], OFF_TRACK: ['Off track', 'in_progress'], COMPLETE: ['Complete', 'done'] })
})

test('toEpic maps each status to a name, a category and a health', () => {
  const cases = [
    ['ON_TRACK', 'On track', 'in_progress', 'on_track'],
    ['AT_RISK', 'At risk', 'in_progress', 'at_risk'],
    ['OFF_TRACK', 'Off track', 'in_progress', 'off_track'],
    ['INACTIVE', 'Inactive', 'backlog', undefined],
    ['COMPLETE', 'Complete', 'done', undefined],
  ]
  for (const [status, name, category, health] of cases) {
    const epic = toEpic(PROJECT, update(status))
    assert.deepEqual(epic.status, { name, category }, status)
    assert.equal(epic.health, health, status)
    assert.equal('health' in epic, health !== undefined, status)
  }
})

test('toEpic without an update reads No update as todo, and a closed Project reads Closed as done without a health', () => {
  assert.deepEqual(toEpic(PROJECT, null), { id: 'acme/12', title: 'Epic twelve', status: { name: 'No update', category: 'todo' }, description: 'Short', url: PROJECT.url })
  const closed = toEpic({ ...PROJECT, closed: true }, update('ON_TRACK'))
  assert.deepEqual(closed.status, { name: 'Closed', category: 'done' })
  assert.equal('health' in closed, false)
})

test('toEpic takes start and target from the latest update, omits null dates and prefers the readme', () => {
  const dated = toEpic({ ...PROJECT, readme: 'Long text' }, update('INACTIVE', { startDate: '2026-12-01', targetDate: '2027-01-31' }))
  assert.equal(dated.start, '2026-12-01')
  assert.equal(dated.target, '2027-01-31')
  assert.equal(dated.description, 'Long text')
  const undated = toEpic(PROJECT, update('INACTIVE'))
  assert.equal('start' in undated || 'target' in undated, false)
  assert.equal(toEpic({ ...PROJECT, shortDescription: null }, null).description, '')
})

test('toStatusUpdate gives a health for a health status and a status for INACTIVE and COMPLETE', () => {
  assert.deepEqual(toStatusUpdate(update('AT_RISK'), 'acme/12'), { epic: 'acme/12', at: '2026-11-10T09:00:00Z', author: 'octocat', health: 'at_risk', body: 'Text' })
  assert.deepEqual(toStatusUpdate(update('INACTIVE', { body: null }), 'acme/12'), { epic: 'acme/12', at: '2026-11-10T09:00:00Z', author: 'octocat', status: 'inactive', body: '' })
  assert.equal(toStatusUpdate(update('COMPLETE'), 'acme/12').status, 'complete')
})
