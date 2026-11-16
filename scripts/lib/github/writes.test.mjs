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

test('planWrite refuses sprint, milestone and release values, and passes null', async () => {
  const { context } = await contextOf()
  for (const key of ['sprint', 'milestone', 'release']) {
    assert.throws(() => planWrite({ title: 'A', [key]: 'x' }, { mode: 'create', before: null, context }), { code: 'NOT_SUPPORTED' })
    assert.doesNotThrow(() => planWrite({ title: 'A', [key]: null }, { mode: 'create', before: null, context }))
  }
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
  assert.throws(() => planMove(node, 'in_progress', {}, context), { code: 'NOT_SUPPORTED', message: 'tracker.scope.project is none, so issues have no status but open and closed' })
})

test('planWrite refuses a field mapped issue: on a host with no issue fields', async () => {
  const { context } = await contextOf()
  const ghes = { ...context, features: { ...context.features, issueFields: false } }
  assert.throws(() => planWrite({ title: 'A', estimate: 3 }, { mode: 'create', before: null, context: ghes }), (error) => error.code === 'NOT_SUPPORTED' && error.nextStep === '/pmkit:setup')
})
