import assert from 'node:assert/strict'
import test from 'node:test'
import { translateFilter } from './filter.mjs'
import { makeContext, toIssue } from './issues.mjs'

const OPTIONS = ['Backlog', 'Todo', 'In Progress', 'Done'].map((name) => ({ id: `o-${name}`, name }))
const raw = ({ project = true } = {}) => ({
  version: 1, host: 'github.com', repo: 'acme/widgets', repositoryId: 'R1', ghesVersion: null,
  features: { issueFields: true, relatesTo: true, statusEvents: true },
  viewer: { id: 'U1', login: 'octocat', name: 'Octo' }, owner: { login: 'acme', type: 'Organization' },
  issueTypes: [{ id: 'T1', name: 'Bug', description: '' }, { id: 'T2', name: 'Task', description: '' }],
  issueFields: [], labels: [], users: [],
  project: project ? { id: 'P1', owner: 'acme', number: 7, title: 'Board', url: 'u', fields: [{ id: 'F1', name: 'Status', dataType: 'SINGLE_SELECT', options: OPTIONS, issueField: null }] } : null,
  truncated: [],
})
const pmkit = { tracker: { scope: { repo: 'acme/widgets', project: 'acme/7' } }, mappings: { status: { backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress', done: 'Done' }, types: { bug: 'Bug', task: 'Task' } } }
const withProject = makeContext(raw(), pmkit)
const noProject = makeContext(raw({ project: false }), { ...pmkit, tracker: { scope: { repo: 'acme/widgets', project: 'none' } } })
const translate = (filter, context = noProject) => translateFilter(filter, context, 'octocat')

const repository = { nameWithOwner: 'acme/widgets' }
const node = (over = {}) => ({
  id: 'I1', number: 1, title: 'Fix the login', body: 'Body text', state: 'OPEN', stateReason: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z',
  url: 'x', repository, author: null, issueType: null, assignees: { nodes: [] }, labels: { nodes: [] }, parent: null, subIssues: { nodes: [] },
  blockedBy: { nodes: [] }, blocking: { nodes: [] }, duplicateOf: null, relatesTo: { nodes: [] }, linkedBranches: { nodes: [] }, projectItems: { nodes: [] }, ...over,
})
// Runs every client step on a node, as searchIssues does.
const keeps = (translated, n, context = noProject) => translated.clientSteps.every((step) => step(toIssue(n, context), n))
const itemWith = (status, isArchived = false) => ({ projectItems: { nodes: [{ id: 'IT', isArchived, project: { id: 'P1' }, status: { name: status } }] } })

test('an empty filter reads every issue with no client step and no filterBy key', () => {
  const translated = translate({})
  assert.deepEqual(translated.variables, { filterBy: {} })
  assert.deepEqual(translated.clientSteps, [])
  assert.equal(translated.sort, 'created')
  assert.equal(translated.empty, false)
})

test('categories without done or canceled set states OPEN and keep listed categories', () => {
  const translated = translate({ categories: ['todo', 'in_progress'] }, withProject)
  assert.deepEqual(translated.variables.filterBy.states, ['OPEN'])
  assert.equal(keeps(translated, node(itemWith('Todo')), withProject), true)
  assert.equal(keeps(translated, node(itemWith('Backlog')), withProject), false)
})

test('categories done sets no states, because an open issue can sit in a done option', () => {
  const translated = translate({ categories: ['done'] }, withProject)
  assert.equal(translated.variables.filterBy.states, undefined)
  assert.equal(keeps(translated, node(itemWith('Done')), withProject), true)
  assert.equal(keeps(translated, node({ state: 'CLOSED', stateReason: 'COMPLETED' }), withProject), true)
  assert.equal(keeps(translated, node(itemWith('Todo')), withProject), false)
})

test('categories canceled sets no states either', () => {
  assert.equal(translate({ categories: ['canceled'] }).variables.filterBy.states, undefined)
})

test('an empty categories list is empty, so no request is needed', () => {
  assert.equal(translate({ categories: [] }).empty, true)
})

test('assignee me uses the viewer login, a login goes as is', () => {
  assert.equal(translate({ assignee: 'me' }).variables.filterBy.assignee, 'octocat')
  assert.equal(translate({ assignee: 'hubot' }).variables.filterBy.assignee, 'hubot')
})

test('an assignee login also keeps only issues whose first assignee is that login', () => {
  const translated = translate({ assignee: 'hubot' })
  assert.equal(translated.clientSteps.length, 1)
  const both = (logins) => node({ assignees: { nodes: logins.map((login) => ({ login })) } })
  assert.equal(keeps(translated, both(['hubot', 'octocat'])), true)
  assert.equal(keeps(translated, both(['octocat', 'hubot'])), false)
  assert.equal(keeps(translated, node()), false)
})

test('assignee none is a client step that keeps unassigned issues', () => {
  const translated = translate({ assignee: 'none' })
  assert.equal(translated.variables.filterBy.assignee, undefined)
  assert.equal(translated.clientSteps.length, 1)
  assert.equal(keeps(translated, node()), true)
  assert.equal(keeps(translated, node({ assignees: { nodes: [{ login: 'hubot' }] } })), false)
})

test('one type sets filterBy.type to the mapped issue type', () => {
  const translated = translate({ types: ['bug'] })
  assert.equal(translated.variables.filterBy.type, 'Bug')
  assert.deepEqual(translated.clientSteps, [])
})

test('two types set no filterBy.type and keep matching issues', () => {
  const translated = translate({ types: ['bug', 'task'] })
  assert.equal(translated.variables.filterBy.type, undefined)
  assert.equal(keeps(translated, node({ issueType: { name: 'Task' } })), true)
  assert.equal(keeps(translated, node({ issueType: null })), false)
})

test('labels go to filterBy.labels, and several labels keep only issues with every one', () => {
  const one = translate({ labels: ['bug'] })
  assert.deepEqual(one.variables.filterBy.labels, ['bug'])
  assert.deepEqual(one.clientSteps, [])
  const two = translate({ labels: ['bug', 'ui'] })
  assert.deepEqual(two.variables.filterBy.labels, ['bug', 'ui'])
  assert.equal(keeps(two, node({ labels: { nodes: [{ name: 'ui' }, { name: 'bug' }] } })), true)
  assert.equal(keeps(two, node({ labels: { nodes: [{ name: 'bug' }] } })), false)
  assert.equal(keeps(translate({ labels: ['Bug', 'UI'] }), node({ labels: { nodes: [{ name: 'ui' }, { name: 'bug' }] } })), true)
})

test('updatedAfter sets since and a client step that drops the exact instant', () => {
  const translated = translate({ updatedAfter: '2026-02-01T00:00:00Z' })
  assert.equal(translated.variables.filterBy.since, '2026-02-01T00:00:00Z')
  assert.equal(translated.clientSteps.length, 1)
  assert.equal(keeps(translated, node()), false)
  assert.equal(keeps(translated, node({ updatedAt: '2026-02-01T00:00:01Z' })), true)
})

test('updatedBefore is a client step', () => {
  const translated = translate({ updatedBefore: '2026-02-01T00:00:00Z' })
  assert.deepEqual(translated.variables.filterBy, {})
  assert.equal(keeps(translated, node()), false)
  assert.equal(keeps(translated, node({ updatedAt: '2026-01-31T00:00:00Z' })), true)
})

test('text matches the title or the body without case', () => {
  const translated = translate({ text: 'LOGIN' })
  assert.deepEqual(translated.variables.filterBy, {})
  assert.equal(keeps(translated, node()), true)
  assert.equal(keeps(translated, node({ title: 'Other', body: 'the login page' })), true)
  assert.equal(keeps(translated, node({ title: 'Other', body: null })), false)
})

test('parent keeps the children of an issue id, in any form', () => {
  const child = node({ parent: { number: 4, repository } })
  assert.equal(keeps(translate({ parent: '4' }), child), true)
  assert.equal(keeps(translate({ parent: '#4' }), child), true)
  assert.equal(keeps(translate({ parent: 'ACME/widgets#4' }), child), true)
  assert.equal(keeps(translate({ parent: '5' }), child), false)
  assert.equal(keeps(translate({ parent: 'acme/other#4' }), child), false)
  assert.equal(keeps(translate({ parent: '4' }), node()), false)
  assert.throws(() => translate({ parent: 'EPIC-1' }), { code: 'INVALID_INPUT' })
})

test('blocked true keeps issues with an open blocker, false drops them', () => {
  const open = { number: 2, state: 'OPEN', stateReason: null, repository, projectItems: { nodes: [] } }
  const closed = { ...open, number: 3, state: 'CLOSED', stateReason: 'COMPLETED' }
  const blocked = node({ blockedBy: { nodes: [closed, open] } })
  const free = node({ blockedBy: { nodes: [closed] } })
  assert.equal(keeps(translate({ blocked: true }), blocked), true)
  assert.equal(keeps(translate({ blocked: true }), free), false)
  assert.equal(keeps(translate({ blocked: false }), blocked), false)
  assert.equal(keeps(translate({ blocked: false }), free), true)
})

test('archived items drop out unless archived is true', () => {
  const archived = node(itemWith('Todo', true))
  assert.equal(keeps(translate({}, withProject), archived, withProject), false)
  assert.equal(keeps(translate({}, withProject), node(itemWith('Todo')), withProject), true)
  assert.deepEqual(translate({ archived: true }, withProject).clientSteps, [])
})

test('sort and limit pass through, created is the default sort', () => {
  const translated = translate({ sort: 'priority', limit: 5 })
  assert.equal(translated.sort, 'priority')
  assert.equal(translated.limit, 5)
})

test('release answers NOT_SUPPORTED, and a null sprint adds no step', () => {
  assert.throws(() => translate({ release: 'v1' }), { code: 'NOT_SUPPORTED' })
  assert.equal(translate({ sprint: null }).clientSteps.length, 0)
})

test('a milestone title filters by its number, none by "none", and an unknown title matches nothing', () => {
  const milestones = [{ id: 'MI_1', number: 7, title: 'v1.0' }]
  const run = (milestone) => translateFilter({ milestone }, noProject, 'octocat', { milestones })
  assert.deepEqual(run('v1.0').variables, { filterBy: { milestoneNumber: '7' } })
  assert.deepEqual(run('none').variables, { filterBy: { milestoneNumber: 'none' } })
  assert.equal(run('v1.0').empty, false)
  assert.equal(run('V1.0').empty, true)
  assert.equal(run('nope').empty, true)
})

const sprintRaw = raw()
sprintRaw.project.fields.push({
  id: 'F2', name: 'Sprint', dataType: 'ITERATION', options: [], issueField: null,
  configuration: { duration: 14, startDay: 1, iterations: [{ id: 'IT_2', title: 'Sprint 2', startDate: '2026-11-16', duration: 14 }], completedIterations: [{ id: 'IT_1', title: 'Sprint 1', startDate: '2026-11-02', duration: 14 }] },
})
const withSprint = makeContext(sprintRaw, { ...pmkit, mappings: { ...pmkit.mappings, fields: { sprint: 'project:Sprint' } } })
const inSprint = (startDate) => ({ projectItems: { nodes: [{ id: 'IT', isArchived: false, project: { id: 'P1' }, fSprint: startDate ? { __typename: 'ProjectV2ItemFieldIterationValue', iterationId: 'x', title: 't', startDate, duration: 14 } : null }] } })

test('sprint current, a start date and none are client steps on the issue sprint', () => {
  const today = { today: '2026-11-17' }
  const run = (sprint) => translateFilter({ sprint }, withSprint, 'octocat', today)
  assert.equal(keeps(run('current'), node(inSprint('2026-11-16')), withSprint), true)
  assert.equal(keeps(run('current'), node(inSprint('2026-11-02')), withSprint), false)
  assert.equal(keeps(run('current'), node(), withSprint), false)
  assert.equal(keeps(run('2026-11-02'), node(inSprint('2026-11-02')), withSprint), true)
  assert.equal(keeps(run('2026-11-02'), node(inSprint('2026-11-16')), withSprint), false)
  assert.equal(keeps(run('none'), node(inSprint(null)), withSprint), true)
  assert.equal(keeps(run('none'), node(inSprint('2026-11-16')), withSprint), false)
  assert.equal(run('current').serverLimit, undefined)
})

test('sprint current with no active iteration is INVALID_INPUT', () => {
  assert.throws(() => translateFilter({ sprint: 'current' }, withSprint, 'octocat', { today: '2026-12-31' }), { code: 'INVALID_INPUT', message: 'there is no active sprint', nextStep: 'pmkit cycle list' })
})

test('any other sprint value is INVALID_INPUT with the exact message', () => {
  for (const value of ['x', '2026-13-45', '12', 'Sprint 2']) {
    assert.throws(() => translateFilter({ sprint: value }, withSprint, 'octocat'), { code: 'INVALID_INPUT', message: `sprint "${value}" is not current, none or a start date` })
  }
})

test('a sprint filter without a mapped iteration field is NOT_SUPPORTED, and none keeps every issue', () => {
  assert.throws(() => translate({ sprint: 'current' }, withProject), { code: 'NOT_SUPPORTED', nextStep: '/pmkit:setup' })
  assert.equal(translate({ sprint: 'none' }, withProject).clientSteps.length, translate({}, withProject).clientSteps.length)
})

test('serverLimit is set only for the created sort without client steps', () => {
  assert.equal(translate({ limit: 5 }).serverLimit, 5)
  assert.equal(translate({ limit: 5, sort: 'created' }).serverLimit, 5)
  assert.equal(translate({ limit: 5, sort: 'priority' }).serverLimit, undefined)
  assert.equal(translate({ limit: 5, text: 'x' }).serverLimit, undefined)
  assert.equal(translate({ limit: 5 }, withProject).serverLimit, undefined)
  assert.equal(translate({ limit: 5, archived: true }, withProject).serverLimit, 5)
  assert.equal(translate({}).serverLimit, undefined)
})

const typeLabels = makeContext(
  { ...raw({ project: false }), issueTypes: [], labels: [{ id: 'L1', name: 'bug' }, { id: 'L2', name: 'chore' }, { id: 'L3', name: 'ui' }] },
  { tracker: { scope: { repo: 'acme/widgets', project: 'none' } }, mappings: { types: { bug: 'label:bug', chore: 'label:chore' } } },
)
const withLabels = (...names) => node({ labels: { nodes: names.map((name) => typeLabels.raw.labels.find((label) => label.name === name)) } })

test('a single type with type labels filters by the label on GitHub', () => {
  const translated = translate({ types: ['bug'] }, typeLabels)
  assert.deepEqual(translated.variables.filterBy, { labels: ['bug'] })
  assert.ok(keeps(translated, withLabels('bug'), typeLabels))
})

test('a type label with a labels filter filters the type on the client', () => {
  const translated = translate({ types: ['bug'], labels: ['ui'] }, typeLabels)
  assert.deepEqual(translated.variables.filterBy, { labels: ['ui'] })
  assert.ok(keeps(translated, withLabels('bug', 'ui'), typeLabels))
  assert.ok(!keeps(translated, withLabels('chore', 'ui'), typeLabels))
})
