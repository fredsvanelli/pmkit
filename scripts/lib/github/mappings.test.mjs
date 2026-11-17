import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeGhExec, projectReply, repoReply, standardFixture } from '../../fake-github-api.mjs'
import { createGithubClient } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { brokenGithubMappings, iterationFieldOf, labelOf, parseFieldSource, parseLabelValue, proposeGithubSetup, proposeProject } from './mappings.mjs'

const TYPES = ['feature', 'bug', 'task', 'chore']

async function rawOf(fixture = standardFixture(), project = 'acme/7') {
  const { exec } = fakeGhExec(fixture)
  const client = createGithubClient({ root: '/repo', env: {}, exec, host: 'github.com' })
  return fetchDiscovery(client, { host: 'github.com', repo: 'acme/widgets', project })
}

const invalid = (fn, pattern) =>
  assert.throws(fn, (error) => {
    assert.equal(error.code, 'INVALID_INPUT')
    assert.match(`${error.message} | ${error.nextStep}`, pattern)
    return true
  })

const questionAt = (result, path) => result.questions.find((q) => q.path === path)

test('parseFieldSource reads issue:, project: and none', () => {
  assert.deepEqual(parseFieldSource('issue:Priority'), { source: 'issue', name: 'Priority' })
  assert.deepEqual(parseFieldSource('project:Story points'), { source: 'project', name: 'Story points' })
  assert.deepEqual(parseFieldSource('project:a:b'), { source: 'project', name: 'a:b' })
  assert.deepEqual(parseFieldSource('none'), { source: 'none', name: null })
  assert.equal(parseFieldSource('Priority'), null)
  assert.equal(parseFieldSource('issue:'), null)
  assert.equal(parseFieldSource('label:x'), null)
  assert.equal(parseFieldSource(3), null)
})

test('proposeProject asks with the linked Projects, and takes an answer or the held value', () => {
  const linked = [{ id: 'acme/7', title: 'Roadmap' }, { id: 'acme/8', title: 'Bugs' }]
  const asked = proposeProject({ linked })
  assert.equal(asked.value, undefined)
  assert.deepEqual(asked.question, { path: 'tracker.scope.project', flag: '--project <owner/number>', candidates: ['acme/7', 'acme/8'], titles: { 'acme/7': 'Roadmap', 'acme/8': 'Bugs' }, recommended: null, none: 'No Project' })
  assert.equal(proposeProject({ linked: [linked[0]] }).question.recommended, 'acme/7')
  assert.equal(proposeProject({ linked, answer: 'acme/9' }).value, 'acme/9')
  assert.equal(proposeProject({ linked, answer: 'none' }).value, 'none')
  assert.equal(proposeProject({ held: 'acme/8' }).value, 'acme/8')
  invalid(() => proposeProject({ answer: 'acme' }), /owner\/number/)
})

test('proposeProject offers only none with the step when the linked Projects could not be read', () => {
  const asked = proposeProject({ linkedError: { message: 'The gh login lacks a scope', nextStep: 'gh auth refresh -s project' } })
  assert.deepEqual(asked.question.candidates, [])
  assert.equal(asked.question.recommended, 'none')
  assert.match(asked.question.note, /gh auth refresh -s project/)
})

test('proposeProject asks again for a held Project GitHub no longer has', () => {
  const asked = proposeProject({ held: 'acme/9', heldMissing: true, linked: [{ id: 'acme/7', title: 'Roadmap' }] })
  assert.deepEqual(asked.question.broken, { was: 'acme/9', problem: 'tracker.scope.project names acme/9, which GitHub no longer has or the gh account cannot see' })
  assert.deepEqual(asked.broken, [{ path: 'tracker.scope.project', value: 'acme/9', problem: 'tracker.scope.project names acme/9, which GitHub no longer has or the gh account cannot see' }])
})

test('the first run asks every Status category with a name match recommended', async () => {
  const result = proposeGithubSetup(await rawOf(), {}, {}, TYPES)
  const status = result.questions.filter((q) => q.path.startsWith('mappings.status.'))
  assert.deepEqual(status.map((q) => q.path), ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'blocked'].map((key) => `mappings.status.${key}`))
  const todo = questionAt(result, 'mappings.status.todo')
  assert.deepEqual(todo, { path: 'mappings.status.todo', flag: '--status todo=<option>', candidates: ['Todo', 'Backlog', 'In Progress', 'In Review', 'Done'], recommended: 'Todo', none: null, required: true })
  assert.equal(questionAt(result, 'mappings.status.in_review').recommended, 'In Review')
  assert.equal(questionAt(result, 'mappings.status.in_review').required, undefined)
  assert.equal(questionAt(result, 'mappings.status.in_review').none, 'No Status option means in review')
  assert.equal(questionAt(result, 'mappings.status.canceled').recommended, 'none')
  assert.equal(questionAt(result, 'mappings.status.blocked').recommended, 'none')
})

test('a required category with no name match recommends nothing', async () => {
  const raw = await rawOf(standardFixture({ graphql: { PmkitRepo: repoReply(), PmkitProject: projectReply({ status: ['Icebox', 'Doing', 'Shipped'] }) } }))
  const result = proposeGithubSetup(raw, {}, {}, TYPES)
  assert.equal(questionAt(result, 'mappings.status.todo').recommended, null)
  assert.equal(questionAt(result, 'mappings.status.in_progress').recommended, 'Doing')
  assert.equal(questionAt(result, 'mappings.status.done').recommended, null)
})

test('Status answers are checked: an option of the field, none only when optional, one option per category', async () => {
  const raw = await rawOf()
  invalid(() => proposeGithubSetup(raw, {}, { status: { todo: 'Ready' } }, TYPES), /todo=Ready.*not an option.*Todo/)
  invalid(() => proposeGithubSetup(raw, {}, { status: { done: 'none' } }, TYPES), /done cannot be none/)
  invalid(() => proposeGithubSetup(raw, {}, { status: { todo: 'Todo', backlog: 'Todo' } }, TYPES), /Todo cannot answer both backlog and todo/)
  invalid(() => proposeGithubSetup(raw, {}, { status: { triage: 'Todo' } }, TYPES), /--status triage.*not something setup maps/)
  const result = proposeGithubSetup(raw, {}, { status: { backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress', in_review: 'In Review', done: 'Done', canceled: 'none', blocked: 'none' } }, TYPES)
  assert.equal(result.questions.filter((q) => q.path.startsWith('mappings.status.')).length, 0)
  assert.deepEqual(result.values.status, { backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress', in_review: 'In Review', done: 'Done', canceled: 'none', blocked: 'none' })
})

test('field roles list fields of the matching type, issue fields first, and recommend by name', async () => {
  const result = proposeGithubSetup(await rawOf(), {}, {}, TYPES)
  // The Project's Priority column is the issue field, so it is listed once, and the one matching candidate is applied.
  assert.equal(questionAt(result, 'mappings.fields.priority'), undefined)
  assert.ok(result.applied.some((item) => item.path === 'mappings.fields.priority' && item.value === 'issue:Priority'))
  const estimate = questionAt(result, 'mappings.fields.estimate')
  assert.deepEqual(estimate.candidates, ['issue:Effort', 'issue:Priority', 'project:Story points'])
  assert.equal(estimate.recommended, 'issue:Effort')
  assert.deepEqual(questionAt(result, 'mappings.fields.target_date').candidates, ['issue:Target date', 'issue:Start date', 'project:Due'])
  assert.equal(questionAt(result, 'mappings.fields.target_date').recommended, 'issue:Target date')
  assert.equal(questionAt(result, 'mappings.fields.start_date').none, 'No field holds the start date')
})

test('a role with one candidate that matches by name is applied, and a role with none is applied as none', async () => {
  const fixture = standardFixture({
    graphql: {
      PmkitRepo: repoReply({ fields: [{ __typename: 'IssueFieldSingleSelect', id: 'F', name: 'Priority', dataType: 'SINGLE_SELECT', options: [{ id: 'o', name: 'P0' }] }] }),
      PmkitProject: projectReply({ extra: [{ __typename: 'ProjectV2SingleSelectField', id: 'S', name: 'Status', dataType: 'SINGLE_SELECT', isIssueField: false, options: [{ id: 'a', name: 'Todo' }] }] }),
    },
  })
  const result = proposeGithubSetup(await rawOf(fixture), {}, {}, TYPES)
  assert.ok(result.applied.some((item) => item.path === 'mappings.fields.priority' && item.value === 'issue:Priority'))
  assert.ok(result.applied.some((item) => item.path === 'mappings.fields.start_date' && item.value === 'none'))
  assert.equal(questionAt(result, 'mappings.fields.start_date'), undefined)
  assert.equal(result.values.fields.start_date, 'none')
})

test('field answers are checked against the candidates', async () => {
  const raw = await rawOf()
  invalid(() => proposeGithubSetup(raw, {}, { fields: { priority: 'issue:Effort' } }, TYPES), /priority=issue:Effort.*issue:Priority/)
  invalid(() => proposeGithubSetup(raw, {}, { fields: { priority: 'Priority' } }, TYPES), /issue:<name>, project:<name> or none/)
  assert.equal(proposeGithubSetup(raw, {}, { fields: { estimate: 'project:Story points' } }, TYPES).values.fields.estimate, 'project:Story points')
})

test('types: one question per pmkit type, same name recommended, one issue type per pmkit type', async () => {
  const raw = await rawOf()
  const result = proposeGithubSetup(raw, {}, {}, TYPES)
  assert.deepEqual(questionAt(result, 'mappings.types.feature'), { path: 'mappings.types.feature', flag: '--type-label feature=<issue type>', candidates: ['Feature', 'Task', 'Bug'], recommended: 'Feature', none: 'No issue type stands for this type' })
  assert.equal(questionAt(result, 'mappings.types.chore').recommended, 'none')
  assert.equal(result.values.types, undefined)
  invalid(() => proposeGithubSetup(raw, {}, { types: { feature: 'Bug', bug: 'Bug' } }, TYPES), /bug=Bug/)
  const answered = proposeGithubSetup(raw, {}, { types: { feature: 'Feature', bug: 'Bug', task: 'Task', chore: 'none' } }, TYPES)
  assert.deepEqual(answered.values.types, { feature: 'Feature', bug: 'Bug', task: 'Task' })
})

test('a repository with no enabled issue type asks a label for each type', async () => {
  const raw = await rawOf(standardFixture({ graphql: { PmkitRepo: repoReply({ types: [] }), PmkitProject: projectReply() } }))
  const result = proposeGithubSetup(raw, {}, {}, TYPES)
  assert.deepEqual(result.questions.filter((q) => q.path.startsWith('mappings.types.')).map((q) => q.flag), TYPES.map((type) => `--type-label ${type}=<label>`))
})

test('without a Project setup asks status labels and offers only issue fields', async () => {
  const result = proposeGithubSetup(await rawOf(standardFixture(), 'none'), {}, {}, TYPES)
  assert.equal(result.questions.filter((q) => q.path.startsWith('mappings.status.')).length, 4)
  assert.deepEqual(questionAt(result, 'mappings.fields.estimate').candidates, ['issue:Effort', 'issue:Priority'])
})

test('an update keeps held values and asks again for the ones GitHub no longer has', async () => {
  const raw = await rawOf()
  const current = {
    status: { backlog: 'Backlog', todo: 'Ready', in_progress: 'In Progress', in_review: 'In Review', done: 'Done', canceled: 'none', blocked: 'none' },
    fields: { priority: 'issue:Priority', estimate: 'project:Size', start_date: 'none', target_date: 'issue:Target date' },
    types: { feature: 'Feature', bug: 'Bug', chore: 'Chore' },
  }
  const result = proposeGithubSetup(raw, current, {}, TYPES)
  assert.deepEqual(result.questions.map((q) => q.path), ['mappings.status.todo', 'mappings.fields.estimate', 'mappings.types.chore'])
  assert.deepEqual(questionAt(result, 'mappings.status.todo').broken, { was: 'Ready', problem: 'mappings.status.todo names Ready, which the Status field of acme/7 no longer has' })
  assert.equal(result.broken.length, 3)
  assert.equal(result.values.status.backlog, 'Backlog')
  assert.equal(result.values.fields.priority, 'issue:Priority')
})

test('brokenGithubMappings names a Project field while the repository has no Project', async () => {
  const raw = await rawOf(standardFixture(), 'none')
  const broken = brokenGithubMappings(raw, { mappings: { fields: { estimate: 'project:Story points' } } })
  assert.deepEqual(broken, [{ path: 'mappings.fields.estimate', value: 'project:Story points', problem: 'mappings.fields.estimate names Project field Story points, but tracker.scope.project is none' }])
})

test('parseLabelValue reads label:<name>', () => {
  assert.equal(parseLabelValue('label:Doing'), 'Doing')
  assert.equal(parseLabelValue('label: In review '), 'In review')
  for (const value of ['label:', 'label:  ', 'Label:x', 'Doing', 3, undefined]) assert.equal(parseLabelValue(value), null)
})

test('labelOf finds a label without case', async () => {
  const raw = await rawOf(standardFixture({ graphql: { PmkitRepo: repoReply({ labels: ['Doing'] }) } }), 'none')
  assert.deepEqual(labelOf(raw, 'doing'), { id: 'LA_1', name: 'Doing' })
  assert.equal(labelOf(raw, 'Review'), null)
})

test('brokenGithubMappings reports label values a Project or issue types rule out', async () => {
  const labels = ['Doing', 'bug']
  const withProject = await rawOf(standardFixture({ graphql: { PmkitRepo: repoReply({ labels }), PmkitProject: projectReply() } }))
  assert.deepEqual(brokenGithubMappings(withProject, { mappings: { status: { in_progress: 'label:Doing' } } }).map((item) => item.problem), [
    'mappings.status.in_progress names label Doing, but statuses come from the Status field of acme/7',
  ])
  const noProject = await rawOf(standardFixture({ graphql: { PmkitRepo: repoReply({ labels }) } }), 'none')
  assert.deepEqual(brokenGithubMappings(noProject, { mappings: { status: { in_progress: 'label:doing', in_review: 'label:Review', backlog: 'In Progress' } } }).map((item) => item.problem), [
    'mappings.status.in_review names label Review, which acme/widgets no longer has',
    'mappings.status.backlog names Status option In Progress, but tracker.scope.project is none',
  ])
  assert.deepEqual(brokenGithubMappings(noProject, { mappings: { types: { bug: 'label:bug' } } }).map((item) => item.problem), [
    'mappings.types.bug names label bug, but acme/widgets has issue types',
  ])
  const noTypes = await rawOf(standardFixture({ graphql: { PmkitRepo: repoReply({ labels, types: [] }) } }), 'none')
  assert.deepEqual(brokenGithubMappings(noTypes, { mappings: { types: { bug: 'label:Bug', task: 'label:task' } } }).map((item) => item.problem), [
    'mappings.types.task names label task, which acme/widgets no longer has',
  ])
})

const LABELS = ['bug', 'Doing', 'In review', 'needs triage', 'enhancement', 'Backlog']
const labelRaw = (types) => rawOf(standardFixture({ graphql: { PmkitRepo: repoReply({ labels: LABELS, ...(types ? { types } : {}) }) } }), 'none')

test('setup without a Project asks the four status label questions', async () => {
  const result = proposeGithubSetup(await labelRaw(), {}, {}, TYPES)
  const status = result.questions.filter((q) => q.path.startsWith('mappings.status.'))
  assert.deepEqual(status.map((q) => q.path), ['mappings.status.triage', 'mappings.status.backlog', 'mappings.status.in_progress', 'mappings.status.in_review'])
  assert.deepEqual(questionAt(result, 'mappings.status.triage'), {
    path: 'mappings.status.triage', flag: '--status triage=<label>', candidates: ['needs triage', 'bug', 'Doing', 'In review', 'enhancement', 'Backlog'],
    recommended: 'needs triage', none: 'No label means triage',
  })
  assert.equal(questionAt(result, 'mappings.status.in_progress').recommended, 'Doing')
  assert.equal(questionAt(result, 'mappings.status.in_review').recommended, 'In review')
  assert.ok(!result.notes.some((note) => note.includes('PMK-89')))
})

test('setup without a Project writes status answers as label:<name>', async () => {
  const raw = await labelRaw()
  const result = proposeGithubSetup(raw, {}, { status: { triage: 'none', backlog: 'backlog', in_progress: 'label:Doing', in_review: 'In review' } }, TYPES)
  assert.deepEqual(result.values.status, { triage: 'none', backlog: 'label:Backlog', in_progress: 'label:Doing', in_review: 'label:In review' })
  assert.equal(result.questions.filter((q) => q.path.startsWith('mappings.status.')).length, 0)
  invalid(() => proposeGithubSetup(raw, {}, { status: { in_progress: 'Gone' } }, TYPES), /in_progress=Gone is not a label of acme\/widgets.*none/)
  invalid(() => proposeGithubSetup(raw, {}, { status: { todo: 'Doing' } }, TYPES), /todo needs no label without a Project/)
  invalid(() => proposeGithubSetup(raw, {}, { status: { in_progress: 'Doing', in_review: 'Doing' } }, TYPES), /label Doing cannot answer both in_progress and in_review/)
})

test('setup without a Project keeps held labels and sets held Status options of todo, done and canceled to none', async () => {
  const raw = await labelRaw()
  const current = { status: { in_progress: 'label:Doing', todo: 'Todo', done: 'Done', in_review: 'In Review' } }
  const result = proposeGithubSetup(raw, current, {}, TYPES)
  assert.equal(result.values.status.in_progress, 'label:Doing')
  assert.equal(result.values.status.todo, 'none')
  assert.equal(result.values.status.done, 'none')
  assert.deepEqual(result.applied.find((item) => item.path === 'mappings.status.todo'), { path: 'mappings.status.todo', value: 'none', reason: 'without a Project, todo needs no label' })
  assert.deepEqual(questionAt(result, 'mappings.status.in_review').broken, { was: 'In Review', problem: 'mappings.status.in_review names Status option In Review, but tracker.scope.project is none' })
})

test('without issue types, type questions offer the labels no status took', async () => {
  const raw = await labelRaw([])
  const result = proposeGithubSetup(raw, {}, { status: { triage: 'none', backlog: 'Backlog', in_progress: 'Doing', in_review: 'none' } }, TYPES)
  assert.deepEqual(questionAt(result, 'mappings.types.bug'), {
    path: 'mappings.types.bug', flag: '--type-label bug=<label>', candidates: ['bug', 'In review', 'needs triage', 'enhancement'], recommended: 'bug', none: 'No label stands for this type',
  })
  assert.ok(!result.notes.some((note) => note.includes('no enabled issue type')))
  const answered = proposeGithubSetup(raw, {}, { status: { triage: 'none', backlog: 'none', in_progress: 'Doing', in_review: 'none' }, types: { feature: 'enhancement', bug: 'label:bug', task: 'none', chore: 'none' } }, TYPES)
  assert.deepEqual(answered.values.types, { feature: 'label:enhancement', bug: 'label:bug' })
  invalid(() => proposeGithubSetup(raw, {}, { status: { in_progress: 'Doing' }, types: { bug: 'Doing' } }, TYPES), /bug=Doing is not a free label of acme\/widgets/)
})

const ITERATION_FIELD = {
  __typename: 'ProjectV2IterationField', id: 'PF_4', name: 'Sprint', dataType: 'ITERATION', isIssueField: false,
  configuration: { duration: 14, startDay: 1, iterations: [{ id: 'IT_a', title: 'Sprint 1', startDate: '2026-11-16', duration: 14 }], completedIterations: [] },
}
const projectWith = (...extra) => {
  const nodes = projectReply().data.repositoryOwner.projectV2.fields.nodes.filter((node) => node.dataType !== 'ITERATION')
  return projectReply({ extra: [...nodes, ...extra] })
}
const sprintFixture = (...extra) => standardFixture({ graphql: { PmkitRepo: repoReply(), PmkitProject: projectWith(...extra) } })

test('sprint: setup offers the Project iteration fields only and recommends Sprint', async () => {
  const raw = await rawOf(sprintFixture(ITERATION_FIELD, { ...ITERATION_FIELD, id: 'PF_9', name: 'Cycle' }))
  const question = questionAt(proposeGithubSetup(raw, {}, {}, TYPES), 'mappings.fields.sprint')
  assert.deepEqual(question, { path: 'mappings.fields.sprint', flag: '--field sprint=<value>', candidates: ['project:Sprint', 'project:Cycle'], recommended: 'project:Sprint', none: 'No field holds the sprint' })
  assert.ok(!question.candidates.some((value) => value.startsWith('issue:')))
})

test('sprint: one matching iteration field is applied, and no iteration field applies none', async () => {
  const one = proposeGithubSetup(await rawOf(sprintFixture(ITERATION_FIELD)), {}, {}, TYPES)
  assert.ok(one.applied.some((item) => item.path === 'mappings.fields.sprint' && item.value === 'project:Sprint'))
  assert.equal(one.values.fields.sprint, 'project:Sprint')
  const none = proposeGithubSetup(await rawOf(sprintFixture()), {}, {}, TYPES)
  assert.equal(none.values.fields.sprint, 'none')
  assert.equal(questionAt(none, 'mappings.fields.sprint'), undefined)
})

test('sprint: tracker.scope.project none asks no sprint question and sets none', async () => {
  const result = proposeGithubSetup(await rawOf(standardFixture(), 'none'), {}, {}, TYPES)
  assert.equal(questionAt(result, 'mappings.fields.sprint'), undefined)
  assert.equal(result.values.fields.sprint, 'none')
})

test('sprint: tracker.scope.project none turns a held sprint field and a --field answer into none, with no question', async () => {
  const raw = await rawOf(standardFixture(), 'none')
  const held = proposeGithubSetup(raw, { fields: { sprint: 'project:Sprint' } }, {}, TYPES)
  assert.equal(questionAt(held, 'mappings.fields.sprint'), undefined)
  assert.equal(held.values.fields.sprint, 'none')
  const answered = proposeGithubSetup(raw, {}, { fields: { sprint: 'project:Sprint' } }, TYPES)
  assert.equal(answered.values.fields.sprint, 'none')
})

test('sprint: an answer must be an iteration field of the Project', async () => {
  const raw = await rawOf(sprintFixture(ITERATION_FIELD))
  invalid(() => proposeGithubSetup(raw, {}, { fields: { sprint: 'issue:Sprint' } }, TYPES), /sprint=issue:Sprint.*project:Sprint/)
  invalid(() => proposeGithubSetup(raw, {}, { fields: { sprint: 'project:Due' } }, TYPES), /sprint=project:Due/)
  assert.equal(proposeGithubSetup(raw, {}, { fields: { sprint: 'project:Sprint' } }, TYPES).values.fields.sprint, 'project:Sprint')
})

test('sprint: issue:Sprint is a broken mapping, and so is a Project field the Project lost', async () => {
  const raw = await rawOf(sprintFixture(ITERATION_FIELD))
  assert.deepEqual(brokenGithubMappings(raw, { mappings: { fields: { sprint: 'issue:Sprint' } } }), [{ path: 'mappings.fields.sprint', value: 'issue:Sprint', problem: 'mappings.fields.sprint must name a Project iteration field' }])
  assert.deepEqual(brokenGithubMappings(raw, { mappings: { fields: { sprint: 'project:Sprint' } } }), [])
  assert.equal(brokenGithubMappings(raw, { mappings: { fields: { sprint: 'project:Due' } } }).length, 1)
  const lost = await rawOf(sprintFixture())
  assert.deepEqual(brokenGithubMappings(lost, { mappings: { fields: { sprint: 'project:Sprint' } } }), [{ path: 'mappings.fields.sprint', value: 'project:Sprint', problem: 'mappings.fields.sprint names Project field Sprint, which acme/7 no longer has' }])
  const asked = proposeGithubSetup(lost, { fields: { sprint: 'project:Sprint' } }, {}, TYPES)
  assert.ok(questionAt(asked, 'mappings.fields.sprint').broken)
})

test('iterationFieldOf returns the iteration field the sprint mapping names, with its configuration', async () => {
  const raw = await rawOf(sprintFixture(ITERATION_FIELD))
  const field = iterationFieldOf(raw, { mappings: { fields: { sprint: 'project:Sprint' } } })
  assert.equal(field.id, 'PF_4')
  assert.equal(field.configuration.duration, 14)
  assert.deepEqual(field.configuration.iterations, [{ id: 'IT_a', title: 'Sprint 1', startDate: '2026-11-16', duration: 14 }])
  assert.deepEqual(field.configuration.completedIterations, [])
  assert.equal(iterationFieldOf(raw, { mappings: { fields: { sprint: 'none' } } }), null)
  assert.equal(iterationFieldOf(raw, { mappings: { fields: { sprint: 'project:Due' } } }), null)
  assert.equal(iterationFieldOf(raw, { mappings: { fields: { sprint: 'issue:Sprint' } } }), null)
  assert.equal(iterationFieldOf(raw, {}), null)
  assert.equal(iterationFieldOf(await rawOf(standardFixture(), 'none'), { mappings: { fields: { sprint: 'project:Sprint' } } }), null)
})
