import assert from 'node:assert/strict'
import test from 'node:test'
import { CAPABILITIES } from '../capabilities.mjs'
import { CAPACITY_FILE } from '../capacity-store.mjs'
import { buildJiraCapabilities } from './manifest.mjs'

const raw = (overrides = {}) => ({
  space: { key: 'ENG', type: 'software' },
  workTypes: [{ name: 'Epic', level: 'epic' }, { name: 'Story', level: 'standard' }, { name: 'Sub-task', level: 'subtask' }],
  fields: [{ id: 'customfield_10016', name: 'Story Points', customType: 'com.pyxis.greenhopper.jira:jsw-story-points' }],
  license: { software: 'paid' },
  settings: { issueLinking: true, timeTracking: true },
  board: { id: 1, type: 'scrum', estimationField: 'customfield_10016' },
  site: 'acme.atlassian.net',
  ...overrides,
})
const GIT = { git_host: { system: 'github' } }
const entry = (entries, id) => entries.find((item) => item.id === id)

test('the manifest has every capability in order, absent until served', () => {
  const entries = buildJiraCapabilities(raw(), GIT)
  assert.deepEqual(entries.map((item) => item.id), CAPABILITIES)
  for (const item of entries) if (item.id !== 'linked_code') assert.equal(item.path, 'absent', item.id)
})

test('an unserved capability keeps the site answer and names its issue', () => {
  const entries = buildJiraCapabilities(raw(), GIT)
  assert.deepEqual(entry(entries, 'cycles'), { id: 'cycles', path: 'absent', detail: { site: 'native' }, enableHint: 'The Jira adapter does not serve cycles yet (PMK-78)' })
  assert.deepEqual(entry(entries, 'estimation'), {
    id: 'estimation', path: 'absent', detail: { site: 'native', unit: 'points', field: 'customfield_10016' }, enableHint: 'The Jira adapter does not serve estimation yet (PMK-77)',
  })
  assert.deepEqual(entry(entries, 'multilevel_hierarchy').detail, { site: 'native', levels: ['epic', 'standard', 'subtask'] })
  assert.deepEqual(entry(entries, 'deliverables').detail, { site: 'native', entity: 'epic' })
  assert.deepEqual(entry(entries, 'releases').detail, { site: 'native', entity: 'version' })
  assert.deepEqual(entry(entries, 'capacity').detail, { site: 'derived', source: 'local', file: CAPACITY_FILE })
  assert.deepEqual(entry(entries, 'native_metrics').detail, { site: 'derived', source: 'history' })
  assert.deepEqual(entry(entries, 'saved_views').detail, { site: 'native', source: 'filters' })
  assert.equal(entry(entries, 'saved_views').enableHint, 'The Jira adapter does not serve saved_views yet')
  assert.equal(entry(entries, 'dependencies').detail.site, 'native')
  assert.equal(entry(entries, 'time_tracking').detail.site, 'native')
})

test('a capability the site lacks gives the site hint and no site path', () => {
  const unlicensed = buildJiraCapabilities(raw({ license: { software: 'unlicensed' } }), GIT)
  assert.deepEqual(entry(unlicensed, 'cycles'), { id: 'cycles', path: 'absent', enableHint: 'Sprints need Jira Software' })
  assert.deepEqual(entry(unlicensed, 'capacity'), { id: 'capacity', path: 'absent', enableHint: 'Capacity needs cycles' })
  const kanban = buildJiraCapabilities(raw({ board: { id: 2, type: 'kanban', estimationField: null } }), GIT)
  assert.equal(entry(kanban, 'cycles').enableHint, 'Sprints need a Scrum board in space ENG')
  const off = buildJiraCapabilities(raw({ settings: { issueLinking: false, timeTracking: false } }), GIT)
  assert.equal(entry(off, 'time_tracking').enableHint, "Turn on time tracking in Jira's global settings")
  assert.equal(entry(off, 'dependencies').enableHint, "Turn on issue linking in Jira's global settings")
  const flat = buildJiraCapabilities(raw({ workTypes: [{ name: 'Task', level: 'standard' }], fields: [], board: null }), GIT)
  assert.equal(entry(flat, 'multilevel_hierarchy').detail, undefined)
  assert.equal(entry(flat, 'deliverables').detail, undefined)
  assert.equal(entry(flat, 'estimation').enableHint, 'No estimate field in space ENG')
  assert.equal(entry(buildJiraCapabilities(raw(), GIT), 'strategic_goals').enableHint, 'Jira goals live in Atlassian Home, which pmkit does not read')
})

test('free Jira Software still has sprints; an unread license defers to the board', () => {
  assert.equal(entry(buildJiraCapabilities(raw({ license: { software: 'free' } }), GIT), 'cycles').detail.site, 'native')
  assert.equal(entry(buildJiraCapabilities(raw({ license: { software: null } }), GIT), 'cycles').detail.site, 'native')
  assert.equal(entry(buildJiraCapabilities(raw({ license: { software: null }, board: null }), GIT), 'cycles').detail, undefined)
})

test('unread settings assume linking and time tracking are on', () => {
  const entries = buildJiraCapabilities(raw({ settings: null }), GIT)
  assert.equal(entry(entries, 'dependencies').detail.site, 'native')
  assert.equal(entry(entries, 'time_tracking').detail.site, 'native')
})

test('linked_code is served through git', () => {
  assert.deepEqual(entry(buildJiraCapabilities(raw(), GIT), 'linked_code'), { id: 'linked_code', path: 'derived', detail: { source: 'git' } })
  assert.deepEqual(entry(buildJiraCapabilities(raw(), {}), 'linked_code'), { id: 'linked_code', path: 'derived', detail: { source: 'git' }, enableHint: 'Set git_host in .pmkit/config.yaml' })
})

test('a served capability takes the site answer as its path', () => {
  const entries = buildJiraCapabilities(raw(), GIT, { linked_code: true, cycles: true })
  assert.deepEqual(entry(entries, 'cycles'), { id: 'cycles', path: 'native' })
})
