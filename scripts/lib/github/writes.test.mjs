// The pure write planning of the GitHub adapter: planWrite and planMove over a context from a real discovery of the fake.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeGithubIssues } from '../../fake-github-issues.mjs'
import { createGithubClient } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { makeContext } from './issues.mjs'
import { planMove, planWrite } from './writes.mjs'

const STATUS = ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done']
const PROJECT_FIELDS = [
  { __typename: 'ProjectV2Field', id: 'PF_0', name: 'Title', dataType: 'TITLE', isIssueField: false },
  { __typename: 'ProjectV2SingleSelectField', id: 'PF_1', name: 'Status', dataType: 'SINGLE_SELECT', isIssueField: false, options: STATUS.map((name, index) => ({ id: `S${index}`, name })) },
  { __typename: 'ProjectV2SingleSelectField', id: 'PF_3', name: 'Priority', dataType: 'SINGLE_SELECT', isIssueField: false, options: ['P0', 'P1', 'P2', 'P3'].map((name, index) => ({ id: `P${index}`, name })) },
  { __typename: 'ProjectV2Field', id: 'PF_5', name: 'Due', dataType: 'DATE', isIssueField: false },
]
const PMKIT = {
  tracker: { system: 'github', scope: { host: 'github.com', repo: 'acme/widgets', project: 'acme/7' } },
  mappings: {
    status: { backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress', in_review: 'In Review', done: 'Done', canceled: 'none' },
    types: { bug: 'Bug', task: 'Task' },
    fields: { priority: 'project:Priority', estimate: 'issue:Effort', target_date: 'none' },
  },
}

async function contextOf({ pmkit = PMKIT, project = { fields: PROJECT_FIELDS }, ...options } = {}) {
  const fake = fakeGithubIssues({ project, ...options })
  const client = createGithubClient({ exec: fake.exec, retries: 0, sleep: async () => {} })
  const raw = await fetchDiscovery(client, { host: 'github.com', repo: 'acme/widgets', project: project === null ? 'none' : 'acme/7', exec: fake.exec, users: true })
  return { fake, client, context: makeContext(raw, pmkit) }
}

/** The fragment node of a seeded issue, read through the fake with the context's field variables. */
function nodeOf(fake, context, number) {
  return fake.handle('PmkitIssue', { owner: 'acme', name: 'widgets', number, ...context.fieldVariables }).data.repository.issue
}

test('planWrite builds the create input, the field writes and the after of a new issue', async () => {
  const { context } = await contextOf()
  const plan = planWrite(
    { title: 'A', type: 'bug', labels: ['bug'], acceptanceCriteria: [{ text: 'x', done: false }], priority: 'high', estimate: 3 },
    { mode: 'create', before: null, context },
  )
  assert.deepEqual(plan.input, { repositoryId: 'R_1', title: 'A', body: '## Acceptance criteria\n\n- [ ] x', issueTypeId: 'IT_2', labelIds: ['LA_1'] })
  assert.deepEqual(plan.fields.map((item) => [item.role, item.value]), [['priority', 'high'], ['estimate', 3]])
  assert.equal(plan.after.id, null)
  assert.equal(plan.after.type, 'bug')
  assert.equal(plan.after.priority, 'high')
  assert.equal(plan.after.estimate, 3)
  assert.deepEqual(plan.fields[1].shown, { __typename: 'IssueFieldNumberValue', numberValue: 3 })
  assert.deepEqual(plan.after.labels, ['bug'])
  assert.deepEqual(plan.after.acceptanceCriteria, [{ text: 'x', done: false }])
})

test('planWrite refuses a missing title, an unknown key, an owned key and a line break', async () => {
  const { context } = await contextOf()
  const create = (patch) => () => planWrite(patch, { mode: 'create', before: null, context })
  assert.throws(create({}), { code: 'INVALID_INPUT', message: 'title is required' })
  assert.throws(create({ title: 'A', colour: 'red' }), { code: 'INVALID_INPUT', message: 'unknown field "colour"' })
  assert.throws(create({ title: 'A\nB' }), { code: 'INVALID_INPUT', message: 'title must not contain a line break' })
  assert.throws(create({ title: 'A', branch: 'x' }), { code: 'INVALID_INPUT' })
  assert.throws(create({ title: 'A', type: 'epic' }), { code: 'INVALID_INPUT', message: 'type "epic" has no issue type in mappings.types (bug, task)' })
  assert.throws(create({ title: 'A', priority: 'huge' }), { code: 'INVALID_INPUT' })
  assert.throws(create({ title: 'A', status: 'Nope' }), { code: 'INVALID_INPUT' })
})

test('planWrite refuses release values, and passes null', async () => {
  const { context } = await contextOf()
  assert.throws(() => planWrite({ title: 'A', release: 'x' }, { mode: 'create', before: null, context }), { code: 'NOT_SUPPORTED' })
  assert.doesNotThrow(() => planWrite({ title: 'A', release: null }, { mode: 'create', before: null, context }))
})

const MILESTONES = [{ id: 'MI_1', number: 1, title: 'v1.0' }, { id: 'MI_2', number: 2, title: 'v2.0' }]

test('planWrite sets milestoneId from the title, and shows the milestone in the after', async () => {
  const { context } = await contextOf()
  const plan = planWrite({ title: 'A', milestone: 'v1.0' }, { mode: 'create', before: null, context, milestones: MILESTONES })
  assert.equal(plan.input.milestoneId, 'MI_1')
  assert.equal(plan.after.milestone, 'v1.0')
})

test('planWrite on update sends milestoneId only when the milestone changes, and null clears it', async () => {
  const { fake, context } = await contextOf({ milestones: [{ title: 'v1.0' }, { title: 'v2.0' }] })
  fake.seed({ title: 'Has one', milestone: 'v1.0' })
  const before = nodeOf(fake, context, 1)
  const update = (patch) => planWrite(patch, { mode: 'update', before, context, milestones: MILESTONES })
  assert.deepEqual(update({ milestone: 'v1.0' }).input, {})
  assert.deepEqual(update({ milestone: 'v2.0' }).input, { milestoneId: 'MI_2' })
  const cleared = update({ milestone: null })
  assert.deepEqual(cleared.input, { milestoneId: null })
  assert.equal(cleared.after.milestone, undefined)
})

test('planWrite refuses an unknown milestone title with the create step, and a create with null sends no milestoneId', async () => {
  const { context } = await contextOf()
  assert.throws(() => planWrite({ title: 'A', milestone: 'v9' }, { mode: 'create', before: null, context, milestones: MILESTONES }),
    (error) => error.code === 'INVALID_INPUT' && error.message === 'milestone v9 does not exist' && error.nextStep === 'pmkit milestone create v9')
  assert.equal('milestoneId' in planWrite({ title: 'A', milestone: null }, { mode: 'create', before: null, context, milestones: MILESTONES }).input, false)
})

test('planWrite refuses a field role mapped none with NOT_SUPPORTED and /pmkit:setup', async () => {
  const { context } = await contextOf()
  assert.throws(() => planWrite({ title: 'A', due: '2026-12-01' }, { mode: 'create', before: null, context }), (error) => error.code === 'NOT_SUPPORTED' && error.nextStep === '/pmkit:setup')
})

test('planWrite marks an unknown label as stale, with the spec next step', async () => {
  const { context } = await contextOf()
  assert.throws(() => planWrite({ title: 'A', labels: ['nope'] }, { mode: 'create', before: null, context }), (error) =>
    error.code === 'INVALID_INPUT' && error.details?.stale === true && error.nextStep === 'Create the label on GitHub, then run pmkit discover')
})

test('planWrite on update keeps only what changes', async () => {
  const { fake, context } = await contextOf()
  fake.seed({ title: 'Same', labels: ['bug'], type: 'Bug', item: { status: 'Todo', values: { Priority: 'P1' } } })
  const before = nodeOf(fake, context, 1)
  const same = planWrite({ title: 'Same', labels: ['bug'], type: 'bug', priority: 'high' }, { mode: 'update', before, context })
  assert.deepEqual(same.input, {})
  assert.deepEqual(same.fields, [])
  const changed = planWrite({ title: 'New', type: null, priority: null }, { mode: 'update', before, context })
  assert.deepEqual(changed.input, { title: 'New', issueTypeId: null })
  assert.deepEqual(changed.fields.map((item) => [item.role, item.value]), [['priority', null]])
  assert.equal(changed.after.title, 'New')
  assert.equal('type' in changed.after, false)
  assert.equal('priority' in changed.after, false)
})

test('planMove picks the option and the state of each category', async () => {
  const { fake, context } = await contextOf()
  fake.seed({ item: { status: 'Todo' } })
  const open = nodeOf(fake, context, 1)
  assert.deepEqual(planMove(open, 'in_progress', {}, context).steps.map((step) => step.op), ['setStatus'])
  assert.deepEqual(planMove(open, 'done', {}, context).steps.map((step) => [step.op, step.option?.name ?? step.reason]), [['setStatus', 'Done'], ['close', 'COMPLETED']])
  assert.deepEqual(planMove(open, 'canceled', {}, context).steps.map((step) => [step.op, step.reason]), [['close', 'NOT_PLANNED']])
  assert.deepEqual(planMove(open, 'todo', {}, context).steps, [])
  assert.equal(planMove(open, 'done', {}, context).after.status.category, 'done')
  assert.throws(() => planMove(open, 'triage', {}, context), { code: 'NOT_SUPPORTED', message: 'no Status option of acme/7 stands for triage' })
  assert.throws(() => planMove(open, 'done', { status: 'Todo' }, context), { code: 'INVALID_INPUT', message: 'status Todo is not in category done' })
  assert.throws(() => planMove(open, 'nowhere', {}, context), { code: 'INVALID_INPUT' })
})

test('planMove takes the state statuses of discover as targets with no option', async () => {
  const { fake, context } = await contextOf()
  fake.seed({ item: { status: 'In Progress' } })
  fake.seed({ state: 'CLOSED', stateReason: 'COMPLETED', item: { status: 'In Progress' } })
  const open = nodeOf(fake, context, 1)
  const closed = nodeOf(fake, context, 2)
  const ops = (plan) => plan.steps.map((step) => [step.op, step.option?.name ?? step.reason])
  assert.deepEqual(ops(planMove(open, 'done', { status: 'Closed' }, context)), [['close', 'COMPLETED']])
  assert.deepEqual(ops(planMove(open, 'canceled', { status: 'Closed as not planned' }, context)), [['close', 'NOT_PLANNED']])
  assert.deepEqual(planMove(open, 'canceled', { status: 'Closed as not planned' }, context).after.status, { name: 'In Progress', category: 'canceled' })
  assert.throws(() => planMove(open, 'done', { status: 'Closed as not planned' }, context), { code: 'INVALID_INPUT', message: 'status Closed as not planned is not in category done' })
  assert.throws(() => planMove(open, 'canceled', { status: 'Closed' }, context), { code: 'INVALID_INPUT' })
  // Todo is mapped to an option, so Open is not a todo target here.
  assert.throws(() => planMove(closed, 'todo', { status: 'Open' }, context), { code: 'INVALID_INPUT', message: 'status Open is not in category todo' })
})

test('planMove takes Open for todo, reopening and keeping the option, when no option maps to todo', async () => {
  const pmkit = { ...PMKIT, mappings: { ...PMKIT.mappings, status: { ...PMKIT.mappings.status, todo: 'none' } } }
  const { fake, context } = await contextOf({ pmkit })
  fake.seed({ state: 'CLOSED', stateReason: 'COMPLETED', item: { status: 'Backlog' } })
  const plan = planMove(nodeOf(fake, context, 1), 'todo', { status: 'Open' }, context)
  assert.deepEqual(plan.steps.map((step) => step.op), ['reopen'])
  assert.equal(plan.after.status.name, 'Backlog')
})

test('the first status of each category in discover moves an issue there, with canceled mapped to none', async () => {
  const { fake, context } = await contextOf()
  const { discoveryView } = await import('./discovery.mjs')
  const statuses = discoveryView(context.raw, PMKIT).statuses
  fake.seed({ item: { status: 'Todo' } })
  let node = nodeOf(fake, context, 1)
  for (const category of ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'todo']) {
    const status = statuses.find((candidate) => candidate.category === category)
    const plan = planMove(node, category, { status: status.name }, context)
    assert.equal(plan.after.status.category, category, `${category} through ${status.name}`)
    node = plan.node
  }
})

test('planMove reopens a closed issue and closes it again for the other terminal category', async () => {
  const { fake, context } = await contextOf()
  fake.seed({ state: 'CLOSED', stateReason: 'COMPLETED', item: { status: 'Done' } })
  const steps = planMove(nodeOf(fake, context, 1), 'canceled', {}, context).steps
  assert.deepEqual(steps.map((step) => step.op), ['reopen', 'close'])
  assert.equal(steps[1].reason, 'NOT_PLANNED')
})

test('planMove adds an issue with no item to the Project first', async () => {
  const { fake, context } = await contextOf()
  fake.seed({})
  assert.deepEqual(planMove(nodeOf(fake, context, 1), 'in_progress', {}, context).steps.map((step) => step.op), ['addItem', 'setStatus'])
})

test('planMove without a Project opens and closes only', async () => {
  const pmkit = { ...PMKIT, tracker: { ...PMKIT.tracker, scope: { ...PMKIT.tracker.scope, project: 'none' } }, mappings: { types: PMKIT.mappings.types } }
  const { fake, context } = await contextOf({ project: null, pmkit })
  fake.seed({})
  const node = nodeOf(fake, context, 1)
  assert.deepEqual(planMove(node, 'done', {}, context).steps.map((step) => [step.op, step.reason]), [['close', 'COMPLETED']])
  assert.deepEqual(planMove(node, 'todo', {}, context).steps, [])
  assert.throws(() => planMove(node, 'in_progress', {}, context), { code: 'NOT_SUPPORTED', message: 'no label of acme/widgets stands for in_progress', nextStep: '/pmkit:setup' })
})

test('planWrite refuses a field mapped issue: on a host with no issue fields', async () => {
  const { context } = await contextOf()
  const ghes = { ...context, features: { ...context.features, issueFields: false } }
  assert.throws(() => planWrite({ title: 'A', estimate: 3 }, { mode: 'create', before: null, context: ghes }), (error) => error.code === 'NOT_SUPPORTED' && error.nextStep === '/pmkit:setup')
})

const LABEL_PMKIT = {
  tracker: { system: 'github', scope: { host: 'github.com', repo: 'acme/widgets', project: 'none' } },
  mappings: { status: { backlog: 'label:Backlog', in_progress: 'label:Doing', in_review: 'label:Review' }, types: { bug: 'label:bug', feature: 'label:enhancement' } },
}
const LABEL_NAMES = ['Backlog', 'Doing', 'Review', 'bug', 'enhancement', 'x', 'y', 'Ready']
const labelContext = (pmkit = LABEL_PMKIT) => contextOf({ project: null, issueTypes: [], labels: LABEL_NAMES, pmkit })
const moveOps = (move) => move.steps.map((step) => [step.op, step.names ?? step.reason ?? null])
const labelIdsNamed = (context, ids) => ids.map((id) => context.raw.labels.find((label) => label.id === id).name)

test('planMove without a Project moves through status labels', async () => {
  const { fake, context } = await labelContext()
  fake.seed({ labels: ['Doing', 'x'] })
  const node = nodeOf(fake, context, 1)
  const review = planMove(node, 'in_review', {}, context)
  assert.deepEqual(moveOps(review), [['addLabels', ['Review']], ['removeLabels', ['Doing']]])
  assert.equal(review.after.status.category, 'in_review')
  assert.deepEqual(review.after.labels, ['Review', 'x'])
  // A terminal move closes first, so the label removal while closed changes no status.
  assert.deepEqual(moveOps(planMove(node, 'done', {}, context)), [['close', 'COMPLETED'], ['removeLabels', ['Doing']]])
  assert.deepEqual(moveOps(planMove(node, 'todo', {}, context)), [['removeLabels', ['Doing']]])
  assert.deepEqual(planMove(node, 'in_progress', {}, context).steps, [])
  fake.seed({ state: 'CLOSED', stateReason: 'COMPLETED' })
  assert.deepEqual(moveOps(planMove(nodeOf(fake, context, 2), 'backlog', {}, context)), [['addLabels', ['Backlog']], ['reopen', null]])
  fake.seed({ labels: ['Doing', 'Review'] })
  assert.deepEqual(moveOps(planMove(nodeOf(fake, context, 3), 'backlog', {}, context)), [['addLabels', ['Backlog']], ['removeLabels', ['Doing', 'Review']]])
})

test('planMove without a label for the category fails with the setup step', async () => {
  const { fake, context } = await labelContext()
  fake.seed({})
  assert.throws(() => planMove(nodeOf(fake, context, 1), 'triage', {}, context), { code: 'NOT_SUPPORTED', message: 'no label of acme/widgets stands for triage', nextStep: '/pmkit:setup' })
})

test('planMove takes --status as the category label or a state status', async () => {
  const { fake, context } = await labelContext()
  fake.seed({})
  const node = nodeOf(fake, context, 1)
  assert.deepEqual(moveOps(planMove(node, 'in_progress', { status: 'doing' }, context)), [['addLabels', ['Doing']]])
  assert.deepEqual(moveOps(planMove(node, 'done', { status: 'Closed' }, context)), [['close', 'COMPLETED']])
  assert.throws(() => planMove(node, 'in_progress', { status: 'Review' }, context), { code: 'INVALID_INPUT', message: 'status Review is not in category in_progress', nextStep: 'Use one of: Doing' })
})

test('a todo label adds it on a move to todo', async () => {
  const pmkit = { ...LABEL_PMKIT, mappings: { ...LABEL_PMKIT.mappings, status: { ...LABEL_PMKIT.mappings.status, todo: 'label:Ready' } } }
  const { fake, context } = await labelContext(pmkit)
  fake.seed({ labels: ['Doing'] })
  assert.deepEqual(moveOps(planMove(nodeOf(fake, context, 1), 'todo', {}, context)), [['addLabels', ['Ready']], ['removeLabels', ['Doing']]])
})

test('planWrite swaps type labels without issue types', async () => {
  const { fake, context } = await labelContext()
  fake.seed({ labels: ['enhancement', 'Doing', 'x'] })
  const before = nodeOf(fake, context, 1)
  const bug = planWrite({ type: 'bug' }, { mode: 'update', before, context })
  assert.deepEqual(labelIdsNamed(context, bug.input.labelIds).sort(), ['Doing', 'bug', 'x'])
  assert.equal(bug.input.issueTypeId, undefined)
  assert.equal(bug.after.type, 'bug')
  assert.deepEqual(labelIdsNamed(context, planWrite({ type: null }, { mode: 'update', before, context }).input.labelIds).sort(), ['Doing', 'x'])
  assert.deepEqual(planWrite({ type: 'feature' }, { mode: 'update', before, context }).input, {})
  const created = planWrite({ title: 'New', type: 'bug', labels: ['y'] }, { mode: 'create', context })
  assert.deepEqual(labelIdsNamed(context, created.input.labelIds).sort(), ['bug', 'y'])
  assert.throws(() => planWrite({ type: 'chore' }, { mode: 'update', before, context }), { code: 'INVALID_INPUT' })
})

test('a labels patch keeps the status and type labels and refuses them', async () => {
  const { fake, context } = await labelContext()
  fake.seed({ labels: ['Doing', 'bug', 'x'] })
  const before = nodeOf(fake, context, 1)
  assert.deepEqual(labelIdsNamed(context, planWrite({ labels: ['y'] }, { mode: 'update', before, context }).input.labelIds).sort(), ['Doing', 'bug', 'y'])
  assert.deepEqual(labelIdsNamed(context, planWrite({ labels: null }, { mode: 'update', before, context }).input.labelIds).sort(), ['Doing', 'bug'])
  assert.throws(() => planWrite({ labels: ['doing'] }, { mode: 'update', before, context }), { code: 'INVALID_INPUT', message: 'label doing holds a status; use pmkit issues move' })
  assert.throws(() => planWrite({ labels: ['bug'] }, { mode: 'update', before, context }), { code: 'INVALID_INPUT', message: 'label bug holds a type; use --type' })
})

// Priority and estimate labels without a Project (PMK-339, ADR 0012).
const VALUE_PMKIT = {
  ...LABEL_PMKIT,
  mappings: {
    ...LABEL_PMKIT.mappings, fields: { priority: 'none', estimate: 'none' },
    priority: { urgent: 'label:P0', high: 'label:P1', medium: 'none', low: 'none' }, estimate: { 1: 'label:size: 1', 3: 'label:size: 3' },
  },
}
const valueContext = () => contextOf({ project: null, issueTypes: [], labels: [...LABEL_NAMES, 'P0', 'P1', 'size: 1', 'size: 3'], pmkit: VALUE_PMKIT })

test('planWrite swaps priority and estimate labels without a Project, with no field write', async () => {
  const { fake, context } = await valueContext()
  fake.seed({ labels: ['P1', 'size: 3', 'x'] })
  const before = nodeOf(fake, context, 1)
  const urgent = planWrite({ priority: 'urgent' }, { mode: 'update', before, context })
  assert.deepEqual(labelIdsNamed(context, urgent.input.labelIds).sort(), ['P0', 'size: 3', 'x'])
  assert.deepEqual(urgent.fields, [])
  assert.equal(urgent.after.priority, 'urgent')
  const cleared = planWrite({ estimate: null, priority: null }, { mode: 'update', before, context })
  assert.deepEqual(labelIdsNamed(context, cleared.input.labelIds).sort(), ['x'])
  assert.deepEqual([cleared.after.priority, cleared.after.estimate], [undefined, undefined])
  assert.deepEqual(planWrite({ priority: 'high', estimate: 3 }, { mode: 'update', before, context }).input, {})
  const created = planWrite({ title: 'New', priority: 'high', estimate: 1 }, { mode: 'create', context })
  assert.deepEqual(labelIdsNamed(context, created.input.labelIds).sort(), ['P1', 'size: 1'])
  assert.deepEqual([created.after.priority, created.after.estimate], ['high', 1])
})

test('a priority or estimate no label stands for, and a labels patch naming one, are refused', async () => {
  const { fake, context } = await valueContext()
  fake.seed({ labels: ['P1'] })
  const before = nodeOf(fake, context, 1)
  assert.throws(() => planWrite({ estimate: 4 }, { mode: 'update', before, context }), { code: 'INVALID_INPUT', message: 'estimate 4 has no label in mappings.estimate (1, 3)', nextStep: '/pmkit:setup' })
  assert.throws(() => planWrite({ priority: 'low' }, { mode: 'update', before, context }), { code: 'INVALID_INPUT', message: 'priority low has no label in mappings.priority (urgent, high)', nextStep: '/pmkit:setup' })
  assert.throws(() => planWrite({ labels: ['P0'] }, { mode: 'update', before, context }), { code: 'INVALID_INPUT', message: 'label P0 holds a priority; use --priority' })
  assert.throws(() => planWrite({ labels: ['size: 1'] }, { mode: 'update', before, context }), { code: 'INVALID_INPUT', message: 'label size: 1 holds an estimate; use --estimate' })
})

const ITERATIONS = [
  { id: 'IT_1', title: 'Sprint 1', startDate: '2026-11-16', duration: 14 },
  { id: 'IT_2', title: 'Sprint 2', startDate: '2026-11-30', duration: 14 },
]
const SPRINT_PMKIT = { ...PMKIT, mappings: { ...PMKIT.mappings, fields: { ...PMKIT.mappings.fields, sprint: 'project:Sprint' } } }
const sprintContext = () => contextOf({ pmkit: SPRINT_PMKIT, project: { fields: PROJECT_FIELDS, iterations: { iterations: ITERATIONS } } })
const NOW = '2026-11-17T09:00:00.000Z'

test('planWrite writes the iteration of a start date on create and shows it', async () => {
  const { context } = await sprintContext()
  const plan = planWrite({ title: 'A', sprint: '2026-11-16' }, { mode: 'create', before: null, context })
  assert.deepEqual(plan.fields.map((item) => [item.role, item.value, item.write]), [['sprint', '2026-11-16', { iterationId: 'IT_1' }]])
  assert.equal(plan.after.sprint, '2026-11-16')
})

test('planWrite resolves current to the active iteration by the clock it gets', async () => {
  const { context } = await sprintContext()
  const plan = planWrite({ title: 'A', sprint: 'current' }, { mode: 'create', before: null, context, now: NOW })
  assert.deepEqual(plan.fields[0].write, { iterationId: 'IT_1' })
  assert.equal(plan.after.sprint, '2026-11-16')
  assert.throws(() => planWrite({ title: 'A', sprint: 'current' }, { mode: 'create', before: null, context, now: '2026-10-01T00:00:00.000Z' }), { code: 'INVALID_INPUT', message: 'there is no active sprint', nextStep: 'pmkit cycle list' })
})

test('planWrite marks an unknown start date as stale and rejects a value that is not a date', async () => {
  const { context } = await sprintContext()
  assert.throws(() => planWrite({ title: 'A', sprint: '2027-01-04' }, { mode: 'create', before: null, context }), (error) =>
    error.code === 'INVALID_INPUT' && error.details?.stale === true && error.message === 'sprint 2027-01-04 is not an iteration of the field Sprint')
  assert.throws(() => planWrite({ title: 'A', sprint: 'soon' }, { mode: 'create', before: null, context }), { code: 'INVALID_INPUT', message: 'sprint must be current or a start date as YYYY-MM-DD' })
})

test('planWrite clears the sprint of an item with null and keeps an unchanged one', async () => {
  const { fake, context } = await sprintContext()
  fake.seed({ item: { status: 'Todo', values: { Sprint: '2026-11-16' } } })
  const before = nodeOf(fake, context, 1)
  const cleared = planWrite({ sprint: null }, { mode: 'update', before, context })
  assert.deepEqual(cleared.fields.map((item) => [item.role, item.write]), [['sprint', null]])
  assert.equal('sprint' in cleared.after, false)
  assert.deepEqual(planWrite({ sprint: '2026-11-16' }, { mode: 'update', before, context }).fields, [])
  assert.deepEqual(planWrite({ sprint: 'current' }, { mode: 'update', before, context, now: NOW }).fields, [])
  assert.equal(planWrite({ sprint: '2026-11-30' }, { mode: 'update', before, context }).after.sprint, '2026-11-30')
})
