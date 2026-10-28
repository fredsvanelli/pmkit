import assert from 'node:assert/strict'
import test from 'node:test'
import { isMutation, operationName } from './client.mjs'
import * as projects from './projects.mjs'
import { HEALTH_FROM_LINEAR, HEALTH_TO_LINEAR, STATUS_CATEGORY, epicId, epicKey, toDocument, toEpic, toMilestone, toStatusUpdate } from './projects.mjs'

const UUID = '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0'

const project = (extra = {}) => ({
  id: UUID,
  slugId: 'a1b2c3d4e5f6',
  identifier: 'P-ABC-12',
  name: 'Launch',
  description: 'Short',
  content: null,
  status: { name: 'Backlog', type: 'backlog' },
  health: null,
  progress: 0,
  url: 'https://linear.app/acme/project/launch-a1b2c3d4e5f6',
  startDate: null,
  targetDate: null,
  ...extra,
})

test('epicKey classifies identifier, slug, uuid and anything else', () => {
  assert.deepEqual(epicKey('P-ABC-12'), { kind: 'identifier', value: 'P-ABC-12' })
  assert.deepEqual(epicKey('p-abc-12'), { kind: 'identifier', value: 'P-ABC-12' })
  assert.deepEqual(epicKey('0123456789ab'), { kind: 'slug', value: '0123456789ab' })
  assert.deepEqual(epicKey(UUID), { kind: 'uuid', value: UUID })
  for (const other of ['ACME-1', '', 'x y', undefined, 42]) assert.equal(epicKey(other).kind, 'other', String(other))
})

test('epicId is the identifier in upper case, else the slug in lower case', () => {
  assert.equal(epicId(project()), 'P-ABC-12')
  assert.equal(epicId(project({ identifier: 'p-abc-12' })), 'P-ABC-12')
  assert.equal(epicId(project({ identifier: null, slugId: 'A1B2C3D4E5F6' })), 'a1b2c3d4e5f6')
})

test('epicId uses the slug when the identifier has a shape epicKey does not know', () => {
  assert.equal(epicId(project({ identifier: 'ACME-1', slugId: 'A1B2C3D4E5F6' })), 'a1b2c3d4e5f6')
  assert.equal(epicKey(epicId(project({ identifier: 'ACME-1' }))).kind, 'slug')
})

test('toEpic maps every status type to a category and keeps the status name', () => {
  const expected = { backlog: 'backlog', planned: 'todo', started: 'in_progress', completed: 'done', canceled: 'canceled', paused: 'backlog' }
  assert.deepEqual(STATUS_CATEGORY, expected)
  for (const [type, category] of Object.entries(expected)) {
    assert.deepEqual(toEpic(project({ status: { name: `Name ${type}`, type } })).status, { name: `Name ${type}`, category })
  }
})

test('toEpic gives the identifier as id, or the lower-case slug without one', () => {
  assert.equal(toEpic(project()).id, 'P-ABC-12')
  assert.equal(toEpic(project({ identifier: null })).id, 'a1b2c3d4e5f6')
  assert.equal(toEpic(project()).title, 'Launch')
})

test('toEpic maps health, progress, url, dates and description', () => {
  assert.deepEqual(HEALTH_FROM_LINEAR, { onTrack: 'on_track', atRisk: 'at_risk', offTrack: 'off_track' })
  assert.deepEqual(HEALTH_TO_LINEAR, { on_track: 'onTrack', at_risk: 'atRisk', off_track: 'offTrack' })
  for (const [linear, health] of Object.entries(HEALTH_FROM_LINEAR)) assert.equal(toEpic(project({ health: linear })).health, health)
  const bare = toEpic(project())
  assert.equal('health' in bare, false)
  assert.equal('start' in bare, false)
  assert.equal('target' in bare, false)
  assert.equal(bare.progress, 0)
  assert.equal(bare.url, 'https://linear.app/acme/project/launch-a1b2c3d4e5f6')
  assert.equal(bare.description, 'Short')
  const full = toEpic(project({ startDate: '2026-11-01', targetDate: '2026-12-01', content: 'Long body', progress: 0.5 }))
  assert.equal(full.start, '2026-11-01')
  assert.equal(full.target, '2026-12-01')
  assert.equal(full.description, 'Long body')
  assert.equal(full.progress, 0.5)
  assert.equal('description' in toEpic(project({ description: '', content: null })), false)
  assert.equal('description' in toEpic(project({ description: null, content: '' })), false)
})

test('toEpic adds milestones and documents when the node holds the connections', () => {
  const node = project({
    projectMilestones: { nodes: [{ id: 'm-1', name: 'Alpha', targetDate: '2026-11-15', status: 'next' }, { id: 'm-2', name: 'Beta', targetDate: null, status: 'unstarted' }], pageInfo: { hasNextPage: true } },
    documents: { nodes: [{ slugId: 'abcdef012345', title: 'Plan' }], pageInfo: { hasNextPage: false } },
  })
  const epic = toEpic(node)
  assert.deepEqual(epic.milestones, [{ id: 'm-1', name: 'Alpha', due: '2026-11-15', status: 'next' }, { id: 'm-2', name: 'Beta', status: 'unstarted' }])
  assert.deepEqual(epic.documents, [{ path: 'abcdef012345', title: 'Plan' }])
  assert.equal(epic.milestonesMore, true)
  assert.equal('documentsMore' in epic, false)
  const plain = toEpic(project())
  for (const key of ['milestones', 'documents', 'milestonesMore', 'documentsMore']) assert.equal(key in plain, false)
  assert.equal(toEpic(project({ documents: { nodes: [], pageInfo: { hasNextPage: true } } })).documentsMore, true)
})

test('toStatusUpdate returns the Local shape with the user id as author', () => {
  const update = toStatusUpdate({ id: 'u-1', body: 'Going well', health: 'atRisk', createdAt: '2026-10-28T10:00:00.000Z', user: { id: 'user-1' }, project: { id: UUID, slugId: 'a1b2c3d4e5f6', identifier: 'P-ABC-12' } })
  assert.deepEqual(update, { epic: 'P-ABC-12', at: '2026-10-28T10:00:00.000Z', author: 'user-1', health: 'at_risk', body: 'Going well' })
})

test('toMilestone drops null keys and names the epic by its canonical id', () => {
  const node = { id: 'm-1', name: 'Alpha', description: null, targetDate: '2026-11-15', status: 'next', progress: 0.25, project: { id: UUID, slugId: 'a1b2c3d4e5f6', identifier: null } }
  assert.deepEqual(toMilestone(node), { id: 'm-1', name: 'Alpha', due: '2026-11-15', epic: 'a1b2c3d4e5f6', status: 'next', progress: 0.25 })
  assert.deepEqual(Object.keys(toMilestone({ ...node, description: 'Words' })), ['id', 'name', 'due', 'description', 'epic', 'status', 'progress'])
})

test('toDocument returns the slug as the path', () => {
  assert.deepEqual(toDocument({ slugId: 'abcdef012345', title: 'Plan', content: '# Plan' }), { path: 'abcdef012345', title: 'Plan', body: '# Plan' })
  assert.equal(toDocument({ slugId: 'abcdef012345', title: 'Empty', content: null }).body, '')
})

test('every project document has a name that operationName reads, and the two mutations start with mutation', () => {
  const documents = {
    PmkitProjects: projects.PROJECTS_QUERY,
    PmkitProjectCreate: projects.PROJECT_CREATE,
    PmkitProjectUpdateCreate: projects.PROJECT_UPDATE_CREATE,
    PmkitProjectUpdates: projects.PROJECT_UPDATES_QUERY,
    PmkitProjectMilestones: projects.PROJECT_MILESTONES_QUERY,
    PmkitProjectMilestone: projects.PROJECT_MILESTONE_QUERY,
    PmkitDocument: projects.DOCUMENT_QUERY,
    PmkitEpicIssues: projects.EPIC_ISSUES_QUERY,
  }
  for (const [name, document] of Object.entries(documents)) {
    assert.equal(operationName(document), name)
    assert.equal(isMutation(document), name === 'PmkitProjectCreate' || name === 'PmkitProjectUpdateCreate', name)
  }
  assert.match(projects.PROJECTS_QUERY, /\$withLists: Boolean!/)
  assert.match(projects.PROJECT_UPDATE_CREATE, /input: ProjectUpdateCreateInput!/)
  assert.match(projects.PROJECT_UPDATE_CREATE, /id body health createdAt user \{ id \} project \{ id slugId identifier \}/)
  assert.match(projects.EPIC_ISSUES_QUERY, /identifier archivedAt estimate/)
  assert.match(projects.EPIC_ISSUES_QUERY, /\$filter: IssueFilter, \$first: Int!, \$after: String/)
})
