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
  assert.deepEqual(translate({ assignee: 'hubot' }).clientSteps, [])
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

test('sprint and release answer NOT_SUPPORTED', () => {
  assert.throws(() => translate({ sprint: 'current' }), { code: 'NOT_SUPPORTED' })
  assert.throws(() => translate({ release: 'v1' }), { code: 'NOT_SUPPORTED' })
  assert.equal(translate({ sprint: null }).empty, false)
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
