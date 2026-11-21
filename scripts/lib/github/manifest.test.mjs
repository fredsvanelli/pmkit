import assert from 'node:assert/strict'
import test from 'node:test'
import { CAPABILITIES, SERVED_BY, unservedCapabilities } from '../capabilities.mjs'
import { hostFeatures } from './documents.mjs'
import { buildGithubCapabilities } from './manifest.mjs'

const RAW = {
  version: 1,
  host: 'github.com',
  repo: 'acme/widgets',
  ghesVersion: null,
  features: hostFeatures({ host: 'github.com', ghesVersion: null }),
  issueFields: [{ id: 'IF_2', name: 'Effort', dataType: 'NUMBER', options: [] }],
  project: { id: 'PVT_1', owner: 'acme', number: 7, title: 'Roadmap', fields: [{ id: 'PF_6', name: 'Size', dataType: 'SINGLE_SELECT', options: [{ id: 'X', name: 'S' }, { id: 'Y', name: 'L' }], issueField: false }] },
}
const GHES = { ...RAW, host: 'ghes.example.com', ghesVersion: '3.21.0', features: hostFeatures({ host: 'ghes.example.com', ghesVersion: '3.21.0' }) }
const pmkit = (fields, gitHost = 'github') => ({ tracker: { system: 'github' }, git_host: { system: gitHost }, mappings: { fields } })
const entryOf = (entries, id) => entries.find((entry) => entry.id === id)

test('the manifest has one entry per capability, in order', () => {
  assert.deepEqual(buildGithubCapabilities(RAW, pmkit({})).map((entry) => entry.id), CAPABILITIES)
})

test('estimation is native with the unit and scale of the mapped field, absent without one', () => {
  assert.deepEqual(entryOf(buildGithubCapabilities(RAW, pmkit({ estimate: 'issue:Effort' })), 'estimation'), { id: 'estimation', path: 'native', detail: { unit: 'points', scale: [] } })
  assert.deepEqual(entryOf(buildGithubCapabilities(RAW, pmkit({ estimate: 'project:Size' })), 'estimation'), { id: 'estimation', path: 'native', detail: { unit: 'sizes', scale: ['S', 'L'] } })
  const absent = { id: 'estimation', path: 'absent', enableHint: 'Map an estimate field with /pmkit:setup' }
  assert.deepEqual(entryOf(buildGithubCapabilities(RAW, pmkit({ estimate: 'none' })), 'estimation'), absent)
  assert.deepEqual(entryOf(buildGithubCapabilities(RAW, pmkit({})), 'estimation'), absent)
  assert.deepEqual(entryOf(buildGithubCapabilities(RAW, pmkit({ estimate: 'issue:Gone' })), 'estimation'), absent)
})

test('hierarchy, dependencies, metrics and linked code follow the spec table', () => {
  const entries = buildGithubCapabilities(RAW, pmkit({}))
  assert.deepEqual(entryOf(entries, 'multilevel_hierarchy'), { id: 'multilevel_hierarchy', path: 'native' })
  assert.deepEqual(entryOf(entries, 'dependencies'), { id: 'dependencies', path: 'native' })
  assert.deepEqual(entryOf(entries, 'native_metrics'), { id: 'native_metrics', path: 'derived', detail: { source: 'history' } })
  assert.deepEqual(entryOf(entries, 'linked_code'), { id: 'linked_code', path: 'derived', detail: { source: 'git' } })
  assert.deepEqual(entryOf(buildGithubCapabilities(RAW, pmkit({}, 'none')), 'linked_code'), { id: 'linked_code', path: 'derived', detail: { source: 'git' }, enableHint: 'Set git_host in .pmkit/config.yaml' })
})

test('dependencies lists related as unsupported on GHES only', () => {
  assert.deepEqual(entryOf(buildGithubCapabilities(GHES, pmkit({})), 'dependencies'), { id: 'dependencies', path: 'native', detail: { unsupported: ['related'] } })
  assert.equal(entryOf(buildGithubCapabilities(RAW, pmkit({})), 'dependencies').detail, undefined)
})

test('triage, delegation, time tracking and the rest are absent with their hints', () => {
  const entries = buildGithubCapabilities(RAW, pmkit({}))
  assert.deepEqual(entryOf(entries, 'native_triage'), { id: 'native_triage', path: 'absent', enableHint: 'GitHub has no triage; map a Status option to triage in .pmkit/config.yaml' })
  assert.deepEqual(entryOf(entries, 'agent_delegation'), { id: 'agent_delegation', path: 'absent', enableHint: 'The GitHub adapter does not delegate to agents yet' })
  assert.deepEqual(entryOf(entries, 'time_tracking'), { id: 'time_tracking', path: 'absent', enableHint: 'GitHub has no time tracking' })
  assert.deepEqual(entryOf(entries, 'releases'), { id: 'releases', path: 'absent', enableHint: 'The GitHub adapter does not serve releases yet (EPC-8)' })
})

test('every capability the manifest claims has a command that serves it', () => {
  for (const raw of [RAW, GHES]) assert.deepEqual(unservedCapabilities(buildGithubCapabilities(raw, pmkit({ estimate: 'issue:Effort' })), SERVED_BY), [])
})

const NO_PROJECT = { ...RAW, project: null, labels: [{ id: 'L1', name: 'Triage' }] }
const PROJECT_ONLY = ['cycles', 'capacity', 'deliverables', 'status_update']

test('without a Project, the capabilities a Project gives are absent with the Project hint', () => {
  const entries = buildGithubCapabilities(NO_PROJECT, pmkit({}))
  for (const id of PROJECT_ONLY) {
    assert.deepEqual(entryOf(entries, id), { id, path: 'absent', enableHint: 'Needs a GitHub Project: set tracker.scope.project with /pmkit:setup' })
  }
  assert.deepEqual(entryOf(entries, 'native_triage'), { id: 'native_triage', path: 'absent', enableHint: 'Map a triage label with /pmkit:setup' })
})

test('without a Project, a triage label makes native_triage derived', () => {
  const triage = { ...pmkit({}), mappings: { status: { triage: 'label:triage' } } }
  assert.deepEqual(entryOf(buildGithubCapabilities(NO_PROJECT, triage), 'native_triage'), { id: 'native_triage', path: 'derived', detail: { source: 'label' } })
  const gone = { ...pmkit({}), mappings: { status: { triage: 'label:Gone' } } }
  assert.equal(entryOf(buildGithubCapabilities(NO_PROJECT, gone), 'native_triage').path, 'absent')
})

test('with a Project, the Project-only entries keep their hint', () => {
  for (const id of PROJECT_ONLY) assert.doesNotMatch(entryOf(buildGithubCapabilities(RAW, pmkit({})), id).enableHint ?? '', /Needs a GitHub Project/)
})

const SPRINT_FIELD = { id: 'PF_9', name: 'Sprint', dataType: 'ITERATION', options: [], issueField: false }
const WITH_SPRINT = { ...RAW, project: { ...RAW.project, fields: [...RAW.project.fields, SPRINT_FIELD] } }
const WITH_SPRINT_GHES = { ...GHES, project: WITH_SPRINT.project }
const sprint = { sprint: 'project:Sprint' }

test('with a Project and an iteration field, cycles are native and capacity is derived from the local file', () => {
  const entries = buildGithubCapabilities(WITH_SPRINT, pmkit(sprint))
  assert.deepEqual(entryOf(entries, 'cycles'), { id: 'cycles', path: 'native', detail: { field: 'Sprint', open: true, close: false, schedule: 'project', history: false } })
  assert.deepEqual(entryOf(entries, 'capacity'), { id: 'capacity', path: 'derived', detail: { source: 'local', file: '.pmkit/capacity.yaml' } })
  assert.deepEqual(unservedCapabilities(entries, SERVED_BY), [])
})

test('on GHES an iteration has no id, so cycles cannot be opened', () => {
  assert.equal(entryOf(buildGithubCapabilities(WITH_SPRINT_GHES, pmkit(sprint)), 'cycles').detail.open, false)
})

test('without an iteration mapping, cycles and capacity are absent with their hints', () => {
  const entries = buildGithubCapabilities(WITH_SPRINT, pmkit({}))
  assert.deepEqual(entryOf(entries, 'cycles'), { id: 'cycles', path: 'absent', enableHint: 'Map an iteration field of the Project with /pmkit:setup' })
  assert.deepEqual(entryOf(entries, 'capacity'), { id: 'capacity', path: 'absent', enableHint: 'Capacity needs cycles' })
})

test('with a Project, deliverables and status updates are native', () => {
  const entries = buildGithubCapabilities(RAW, pmkit({}))
  assert.deepEqual(entryOf(entries, 'deliverables'), { id: 'deliverables', path: 'native', detail: { entity: 'project', derived: ['deliverableProgress'], milestones: 'repository' } })
  assert.deepEqual(entryOf(entries, 'status_update'), { id: 'status_update', path: 'native', detail: { entity: 'project status update' } })
})

test('estimation is native with the scale of the estimate labels without a Project (PMK-339)', () => {
  const raw = { ...RAW, project: null, labels: [{ id: 'L1', name: 'size: 1' }, { id: 'L3', name: 'size: 3' }] }
  const labelled = (estimate, fields = { estimate: 'none' }) => ({ ...pmkit(fields), mappings: { fields, estimate } })
  assert.deepEqual(entryOf(buildGithubCapabilities(raw, labelled({ 1: 'label:size: 1', 3: 'label:size: 3', 5: 'none' })), 'estimation'), { id: 'estimation', path: 'native', detail: { unit: 'points', scale: [1, 3] } })
  assert.equal(entryOf(buildGithubCapabilities(raw, labelled({ 8: 'label:size: 8' })), 'estimation').path, 'absent', 'a label the repository lacks gives no scale')
  assert.equal(entryOf(buildGithubCapabilities({ ...raw, project: RAW.project }, labelled({ 1: 'label:size: 1' })), 'estimation').path, 'absent', 'a Project turns the labels off')
})
