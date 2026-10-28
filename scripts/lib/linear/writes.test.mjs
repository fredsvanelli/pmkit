import assert from 'node:assert/strict'
import test from 'node:test'
import { conn, fakeRaw, lab, node } from '../../fake-linear-nodes.mjs'
import { makeContext, toIssue } from './issues.mjs'
import * as writes from './writes.mjs'
import { parentInput, applyInput, createTeam, skeletonNode, toInput } from './writes.mjs'

const TEAM = 'team-acme'
const label = (id, name, { team = TEAM, parent = null, isGroup = false } = {}) => ({ id, name, isGroup, retiredAt: null, team: team === null ? null : { id: team }, parent })
const SIZE = { id: 'label-size', name: 'Size' }
const LABELS = [
  label('label-bug', 'Bug'),
  label('label-feature', 'Feature'),
  label(SIZE.id, SIZE.name, { isGroup: true }),
  ...['XS', 'S', 'M', 'L', 'XL'].map((name) => label(`label-${name.toLowerCase()}`, name, { parent: SIZE })),
  label('label-docs-team', 'Docs'),
  label('label-docs', 'Docs', { team: null }),
]
const teamRecord = (extra = {}) => ({ id: TEAM, key: 'ACME', name: 'Acme', parent: null, cyclesEnabled: false, triageEnabled: false,
  issueEstimationType: 'notUsed', issueEstimationAllowZero: false, issueEstimationExtended: false, ...extra })
const VIEWER = { id: 'user-1', name: 'Test User' }
const BASE = { status: { in_review: 'In Review' }, types: { bug: 'Bug', feature: 'Feature' } }
const pmkit = (mappings = BASE, team = 'ACME') => ({ tracker: { system: 'linear', scope: { workspace: 'acme', ...(team ? { team } : {}) } }, mappings })

const raw = await fakeRaw({ labels: LABELS })
const context = makeContext(raw, pmkit(), VIEWER)
const team = raw.teams[0]
const create = { mode: 'create', team, context }
const update = { mode: 'update', beforeNode: node(), context }
const tShirtRaw = await fakeRaw({ labels: LABELS, teams: [teamRecord({ issueEstimationType: 'tShirt' })] })
const updateOnTShirtTeam = { mode: 'update', beforeNode: node(), context: makeContext(tShirtRaw, pmkit({ ...BASE, fields: { estimate: 'native' } }), VIEWER) }
const updateWithEstimateMappedToSize = { mode: 'update', beforeNode: node(), context: makeContext(tShirtRaw, pmkit({ ...BASE, fields: { estimate: 'Size' } }), VIEWER) }
const contextWithTeams = async (count) => {
  const teams = Array.from({ length: count }, (_, index) => teamRecord({ id: index === 0 ? TEAM : `team-${index}`, key: index === 0 ? 'ACME' : `ACM${index}` }))
  return makeContext(await fakeRaw({ teams }), pmkit(BASE, null), VIEWER)
}

test('create needs a one-line title and sends the team', () => {
  assert.throws(() => toInput({}, create), { code: 'INVALID_INPUT', message: 'title is required' })
  assert.throws(() => toInput({ title: '  ' }, create), { code: 'INVALID_INPUT', message: 'title is required' })
  assert.throws(() => toInput({ title: 'a\nb' }, create), { code: 'INVALID_INPUT' })
  assert.deepEqual(toInput({ title: ' T ' }, create), { teamId: 'team-acme', title: 'T' })
})

test('unknown and owned keys fail as in the Local tracker', () => {
  assert.throws(() => toInput({ nope: 1 }, update), { code: 'INVALID_INPUT', message: 'unknown field "nope"' })
  assert.throws(() => toInput({ status: 'Done' }, update), { code: 'INVALID_INPUT', message: 'status cannot be set here', nextStep: 'pmkit issues move' })
})

test('status on create names a state of the team', () => {
  assert.equal(toInput({ title: 'T', status: 'Todo' }, create).stateId, 'state-2')
  assert.throws(() => toInput({ title: 'T', status: 'Nope' }, create), { code: 'INVALID_INPUT', message: 'status Nope is not a status of team ACME' })
})

test('type swaps the type label and keeps the others', () => {
  const before = node({ labels: conn([lab('Bug', 'label-bug'), lab('Docs', 'label-docs')]) })
  assert.deepEqual(toInput({ type: 'feature' }, { ...update, beforeNode: before }).labelIds.sort(), ['label-docs', 'label-feature'])
  assert.deepEqual(toInput({ type: null }, { ...update, beforeNode: before }).labelIds, ['label-docs'])
  assert.throws(() => toInput({ type: 'epic' }, update), { code: 'INVALID_INPUT', nextStep: '/pmkit:setup' })
  assert.deepEqual(toInput({ title: 'T', type: 'bug' }, create).labelIds, ['label-bug'])
})

test('labels keep the type label the issue has', () => {
  const before = node({ labels: conn([lab('Bug', 'label-bug'), lab('Docs', 'label-docs')]) })
  assert.deepEqual(toInput({ labels: ['XS'] }, { ...update, beforeNode: before }).labelIds.sort(), ['label-bug', 'label-xs'])
  assert.deepEqual(toInput({ labels: [], type: 'feature' }, { ...update, beforeNode: before }).labelIds, ['label-feature'])
})

test('labels resolve to the team label first, refuse two of one group, and mark an unknown name stale', () => {
  assert.deepEqual(toInput({ labels: ['Docs'] }, update).labelIds, ['label-docs-team'])
  assert.throws(() => toInput({ labels: ['S', 'M'] }, update), { code: 'INVALID_INPUT', message: 'labels S and M are in the same Linear label group Size' })
  assert.throws(() => toInput({ labels: ['Nope'] }, update), (error) => error.code === 'INVALID_INPUT' && error.details.stale === true
    && error.nextStep === 'Create the label in Linear, then run pmkit discover')
  assert.throws(() => toInput({ labels: 'Docs' }, update), { code: 'INVALID_INPUT', message: 'labels must be a list of strings' })
})

test('assignee must be a member, not an app; an unknown id is stale', () => {
  assert.equal(toInput({ title: 'T', assignee: 'user-2' }, create).assigneeId, 'user-2')
  assert.throws(() => toInput({ title: 'T', assignee: 'user-4' }, create), { code: 'INVALID_INPUT' })
  assert.throws(() => toInput({ title: 'T', assignee: 'user-9' }, create), (error) => error.details.stale === true)
})

test('parent on create is an issue node or an epic node', () => {
  const issue = toInput({ title: 'T', parent: 'ACME-3' }, { ...create, parentNode: node({ id: 'uuid-3', identifier: 'ACME-3' }) })
  assert.equal(issue.parentId, 'uuid-3')
  assert.equal('projectId' in issue, false)
  const epic = toInput({ title: 'T', parent: 'P-ABC-12' }, { ...create, epicNode: { id: 'project-uuid' } })
  assert.equal(epic.projectId, 'project-uuid')
  assert.equal(epic.parentId, null)
  assert.throws(() => toInput({ title: 'T', parent: 'P-ABC-12' }, create), { code: 'INVALID_INPUT' })
})

test('parentInput sets an issue parent, an epic, or clears both', () => {
  assert.deepEqual(parentInput({ parentNode: { id: 'uuid-2' } }), { parentId: 'uuid-2' })
  assert.deepEqual(parentInput({ epicNode: { id: 'project-uuid' } }), { projectId: 'project-uuid', parentId: null })
  assert.deepEqual(parentInput({}), { parentId: null, projectId: null })
  assert.deepEqual(parentInput(), { parentId: null, projectId: null })
})

test('a milestone is NOT_SUPPORTED with the Linear message, and NOT_EPICS is gone', () => {
  assert.throws(() => toInput({ milestone: 'x' }, update), { code: 'NOT_SUPPORTED', message: 'set the milestone in Linear' })
  assert.equal('NOT_EPICS' in writes, false)
})

test('applyInput sets the project from the project option and the parent from the parent option', () => {
  const project = { id: 'project-uuid', slugId: 'a1b2c3d4e5f6', identifier: 'P-ABC-12' }
  const withProject = applyInput(node({ parent: { identifier: 'ACME-2' } }), { projectId: 'project-uuid', parentId: null }, context, { project })
  assert.deepEqual(withProject.project, project)
  assert.equal(withProject.parent, null)
  assert.equal(toIssue(withProject, context).parent, 'P-ABC-12')
  const cleared = applyInput(node({ project }), { projectId: null, parentId: null }, context)
  assert.equal(cleared.project, null)
  assert.equal(applyInput(node(), { parentId: 'uuid-2' }, context, { parent: 'ACME-2' }).parent.identifier, 'ACME-2')
})

test('priority, estimate, due and null clears', () => {
  assert.deepEqual(toInput({ priority: 'urgent', due: '2026-11-01' }, update), { priority: 1, dueDate: '2026-11-01' })
  assert.deepEqual(toInput({ priority: null, due: null }, update), { priority: 0, dueDate: null })
  assert.throws(() => toInput({ priority: 'asap' }, update), { code: 'INVALID_INPUT' })
  assert.throws(() => toInput({ due: '2026-13-01' }, update), { code: 'INVALID_INPUT' })
  assert.throws(() => toInput({ estimate: 3 }, update), { code: 'INVALID_INPUT', nextStep: "Turn on estimates in the team's settings in Linear" })
  assert.equal(toInput({ estimate: 'L' }, updateOnTShirtTeam).estimate, 5)
  assert.equal(toInput({ estimate: null }, updateOnTShirtTeam).estimate, null)
  assert.throws(() => toInput({ estimate: 'XXL' }, updateOnTShirtTeam), { code: 'INVALID_INPUT', message: 'estimate must be one of XS, S, M, L, XL' })
  assert.throws(() => toInput({ estimate: 3 }, updateWithEstimateMappedToSize), { code: 'NOT_SUPPORTED' })
})

test('description and criteria rebuild the whole description; the heading is refused', () => {
  const before = node({ description: 'Old\n\n## Acceptance criteria\n\n- [ ] a' })
  assert.equal(toInput({ description: 'New' }, { ...update, beforeNode: before }).description, 'New\n\n## Acceptance criteria\n\n- [ ] a')
  assert.equal(toInput({ acceptanceCriteria: [] }, { ...update, beforeNode: before }).description, 'Old')
  assert.equal(toInput({ acceptanceCriteria: [{ text: 'b', done: true }, 'c'] }, { ...update, beforeNode: before }).description,
    'Old\n\n## Acceptance criteria\n\n- [x] b\n- [ ] c')
  assert.throws(() => toInput({ description: 'x\n## Acceptance criteria' }, update), { code: 'INVALID_INPUT' })
  assert.throws(() => toInput({ acceptanceCriteria: [{ text: '' }] }, update), { code: 'INVALID_INPUT' })
})

test('milestone and release take only null', () => {
  assert.deepEqual(toInput({ milestone: null, release: null }, update), {})
  for (const key of ['milestone', 'release']) assert.throws(() => toInput({ [key]: 'x' }, update), { code: 'NOT_SUPPORTED' })
})

const cycleRaw = await fakeRaw({ labels: LABELS, teams: [teamRecord({ cyclesEnabled: true })] })
const cycleContext = makeContext(cycleRaw, pmkit(), VIEWER)
const cycleNode = { id: 'cycle-uuid', number: 12 }
const withCycles = (mode) => (mode === 'create' ? { mode, team: cycleRaw.teams[0], context: cycleContext } : { mode, beforeNode: node(), context: cycleContext })

test('sprint sets cycleId from the resolved cycle on create and update, and null clears it', () => {
  assert.equal(toInput({ sprint: '12' }, { ...withCycles('update'), cycleNode }).cycleId, 'cycle-uuid')
  assert.equal(toInput({ title: 'T', sprint: '12' }, { ...withCycles('create'), cycleNode }).cycleId, 'cycle-uuid')
  assert.equal(toInput({ sprint: null }, withCycles('update')).cycleId, null)
  assert.equal('cycleId' in toInput({ title: 'T', sprint: null }, withCycles('create')), false)
})

test('sprint with cycles off: a value is NOT_SUPPORTED and null changes nothing', () => {
  assert.throws(() => toInput({ sprint: '12' }, update), {
    code: 'NOT_SUPPORTED', message: 'team ACME has cycles turned off', nextStep: "Turn on cycles in the team's settings in Linear",
  })
  assert.throws(() => toInput({ sprint: 'current' }, update), { code: 'NOT_SUPPORTED' })
  assert.deepEqual(toInput({ sprint: null }, update), {})
})

test('applyInput reflects the cycle so toIssue reads it back', () => {
  const set = applyInput(node(), { cycleId: 'cycle-uuid' }, cycleContext, { cycle: cycleNode })
  assert.equal(toIssue(set, cycleContext).sprint, '12')
  const cleared = applyInput(node({ cycle: cycleNode }), { cycleId: null }, cycleContext)
  assert.equal('sprint' in toIssue(cleared, cycleContext), false)
})

test('branch is not an input', () => {
  assert.deepEqual(toInput({ branch: 'acme-1-x' }, update), {})
})

test('createTeam picks the scoped team, the only team, or fails', async () => {
  assert.equal(createTeam(context).key, 'ACME')
  assert.equal(createTeam(await contextWithTeams(1)).key, 'ACME')
  const three = await contextWithTeams(3)
  assert.throws(() => createTeam(three), { code: 'NOT_CONFIGURED', message: 'tracker.scope.team is not set and the workspace has 3 teams', nextStep: '/pmkit:setup' })
})

test('applyInput then toIssue gives the dry-run after', () => {
  const input = { title: 'New', priority: 2, labelIds: ['label-docs', 'label-bug'], stateId: 'state-4', assigneeId: 'user-2', dueDate: '2026-11-01', description: 'D\n\n## Acceptance criteria\n\n- [ ] a' }
  const after = toIssue(applyInput(node({ identifier: 'ACME-1' }), input, context), context)
  assert.equal(after.title, 'New')
  assert.equal(after.priority, 'high')
  assert.equal(after.type, 'bug')
  assert.deepEqual(after.labels, ['Docs'])
  assert.deepEqual(after.status, { name: 'In Review', category: 'in_review' })
  assert.equal(after.assignee, 'user-2')
  assert.equal(after.due, '2026-11-01')
  assert.equal(after.description, 'D')
  assert.deepEqual(after.acceptanceCriteria, [{ text: 'a', done: false }])
  assert.equal('assignee' in toIssue(applyInput(node({ assignee: { id: 'user-2' } }), { assigneeId: null }, context), context), false)
})

test('skeletonNode starts in the first backlog state with no identifier', () => {
  const skeleton = skeletonNode(team, '2026-10-27T12:00:00.000Z', context)
  assert.equal(skeleton.identifier, null)
  assert.deepEqual(skeleton.state, { id: 'state-1', name: 'Backlog', type: 'backlog' })
  assert.equal(skeleton.createdAt, '2026-10-27T12:00:00.000Z')
  assert.deepEqual(skeleton.team, { id: TEAM, key: 'ACME' })
})
