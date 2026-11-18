import assert from 'node:assert/strict'
import test from 'node:test'
import { isBlockedNode, itemOf, makeContext, optionForPriority, priorityRule, statusOf, toIssue, toIssueWithWarnings } from './issues.mjs'

const STATUS_OPTIONS = ['Backlog', 'Todo', 'In Progress', 'Done', 'Weird'].map((name) => ({ id: `o-${name}`, name }))
const raw = (over = {}) => ({
  version: 1, host: 'github.com', repo: 'acme/widgets', repositoryId: 'R1', ghesVersion: null,
  features: { issueFields: true, relatesTo: true, statusEvents: true },
  viewer: { id: 'U1', login: 'me', name: 'Me' }, owner: 'acme',
  issueTypes: [{ id: 'T1', name: 'Bug', description: '' }, { id: 'T2', name: 'Task', description: '' }],
  issueFields: [{ id: 'IF1', name: 'Estimate', dataType: 'NUMBER', options: [] }, { id: 'IF2', name: 'Prio', dataType: 'SINGLE_SELECT', options: [] }],
  labels: [], users: [],
  project: {
    id: 'P1', owner: 'acme', number: 1, title: 'Board', url: 'u',
    fields: [
      { id: 'F1', name: 'Status', dataType: 'SINGLE_SELECT', options: STATUS_OPTIONS, issueField: null },
      { id: 'F2', name: 'Priority', dataType: 'SINGLE_SELECT', options: ['P0', 'P1', 'P2', 'P3'].map((name) => ({ id: name, name })), issueField: null },
      { id: 'F3', name: 'Size', dataType: 'SINGLE_SELECT', options: ['S', 'M'].map((name) => ({ id: name, name })), issueField: null },
      { id: 'F4', name: 'Due', dataType: 'DATE', options: [], issueField: null },
    ],
  },
  truncated: false, ...over,
})
const pmkit = (mappings = {}) => ({
  tracker: { scope: { repo: 'acme/widgets', project: 'acme/1' } },
  mappings: {
    status: { todo: 'Todo', in_progress: 'In Progress', done: 'Done', backlog: 'Backlog' },
    fields: { priority: 'project:Priority', estimate: 'issue:Estimate', target_date: 'project:Due' },
    types: { bug: 'Bug', task: 'Task' },
    ...mappings,
  },
})
const ctx = (over, map) => makeContext(raw(over), pmkit(map))
const repository = { nameWithOwner: 'acme/widgets' }
const node = (over = {}) => ({
  id: 'I1', number: 12, title: 'T', body: '', state: 'OPEN', stateReason: null, createdAt: 'c', updatedAt: 'u', url: 'x', repository,
  author: { login: 'a' }, issueType: null, assignees: { nodes: [] }, labels: { nodes: [] }, parent: null,
  subIssues: { nodes: [] }, blockedBy: { nodes: [] }, blocking: { nodes: [] }, duplicateOf: null,
  relatesTo: { nodes: [] }, linkedBranches: { nodes: [] }, projectItems: { nodes: [] }, issueFieldValues: { nodes: [] }, ...over,
})
const item = (over = {}) => ({ id: 'IT1', isArchived: false, project: { id: 'P1' }, ...over })
const withItem = (it, over = {}) => node({ projectItems: { nodes: [it] }, ...over })
const sel = (name) => ({ __typename: 'ProjectV2ItemFieldSingleSelectValue', name, optionId: name })

test('makeContext shape', () => {
  const c = ctx()
  assert.equal(c.repo, 'acme/widgets')
  assert.equal(c.project.id, 'P1')
  assert.equal(c.project.statusField.name, 'Status')
  assert.deepEqual(c.projectFields, { status: true, priority: true, due: true })
  assert.deepEqual(c.fieldVariables, { fStatus: 'Status', fPriority: 'Priority', fDue: 'Due' })
  assert.deepEqual(c.priorities, ['urgent', 'high', 'medium', 'low'])
  assert.equal(c.categoryOfOption('Done'), 'done')
  assert.equal(c.categoryOfOption('Weird'), 'in_progress')
  assert.deepEqual(c.optionOf('todo'), { id: 'o-Todo', name: 'Todo' })
  assert.equal(c.optionOf('in_review'), null)
  assert.equal(c.typeOf('Bug'), 'bug')
  assert.equal(c.typeOf('Nope'), undefined)
  assert.deepEqual(c.issueTypeOf('task'), { id: 'T2', name: 'Task' })
  assert.equal(c.field('estimate').source, 'issue')
  assert.equal(c.field('priority').field.name, 'Priority')
  assert.equal(c.field('nothing'), null)
})

test('makeContext without a Project has no project fields', () => {
  const c = ctx({ project: null }, { fields: { priority: 'issue:Prio', estimate: 'none', target_date: 'none' } })
  assert.equal(c.project, null)
  assert.deepEqual(c.projectFields, {})
  assert.deepEqual(c.fieldVariables, {})
  assert.equal(c.optionOf('todo'), null)
  assert.equal(c.field('estimate'), null)
})

test('status rule', () => {
  const c = ctx()
  assert.deepEqual(statusOf(withItem(item({ status: sel('In Progress') }), { state: 'CLOSED', stateReason: 'COMPLETED' }), c), { name: 'In Progress', category: 'done' })
  assert.deepEqual(statusOf(node({ state: 'CLOSED', stateReason: 'NOT_PLANNED' }), c), { name: 'Closed as not planned', category: 'canceled' })
  assert.deepEqual(statusOf(node({ state: 'CLOSED', stateReason: 'DUPLICATE' }), c), { name: 'Closed as not planned', category: 'canceled' })
  assert.deepEqual(statusOf(withItem(item({ status: sel('Done') })), c), { name: 'Done', category: 'done' })
  assert.deepEqual(statusOf(node(), c), { name: 'Open', category: 'todo' })
  assert.deepEqual(statusOf(withItem(item({ status: null })), c), { name: 'Open', category: 'todo' })
  assert.deepEqual(statusOf(withItem(item({ status: sel('Weird') })), c), { name: 'Weird', category: 'in_progress' })
})

test('status rule without a Project', () => {
  const c = ctx({ project: null })
  assert.deepEqual(statusOf(node(), c), { name: 'Open', category: 'todo' })
  assert.deepEqual(statusOf(node({ state: 'CLOSED', stateReason: 'COMPLETED' }), c), { name: 'Closed', category: 'done' })
  assert.deepEqual(statusOf(node({ state: 'CLOSED', stateReason: 'NOT_PLANNED' }), c), { name: 'Closed as not planned', category: 'canceled' })
})

test('priority rule', () => {
  const names = (list) => list.map((name) => ({ id: name, name }))
  assert.deepEqual([...priorityRule(names(['P0', 'P1', 'P2', 'P3', 'P4']))], [['P0', 'urgent'], ['P1', 'high'], ['P2', 'medium'], ['P3', 'low']])
  assert.deepEqual([...priorityRule(names(['Low', 'High']))], [['Low', 'low'], ['High', 'high']])
  assert.deepEqual(optionForPriority(names(['P0', 'P1', 'P2', 'P3']), 'medium'), { id: 'P2', name: 'P2' })
  assert.equal(optionForPriority(names(['Low', 'High']), 'urgent'), undefined)
})

test('toIssue reads priority, estimate and due from their sources', () => {
  const c = ctx()
  const n = withItem(item({ fPriority: sel('P1'), fDue: { __typename: 'ProjectV2ItemFieldDateValue', date: '2026-12-01' } }), {
    issueFieldValues: { nodes: [{ __typename: 'IssueFieldNumberValue', value: 3, field: { id: 'IF1', name: 'Estimate' } }] },
  })
  const issue = toIssue(n, c)
  assert.equal(issue.priority, 'high')
  assert.equal(issue.estimate, 3)
  assert.equal(issue.due, '2026-12-01')
  const fifth = toIssue(withItem(item({ fPriority: sel('P4') })), ctx({}, {}))
  assert.equal('priority' in fifth, false)
})

test('toIssue reads a Project single-select estimate and an unset one', () => {
  const c = ctx({}, { fields: { priority: 'none', estimate: 'project:Size', target_date: 'none' } })
  assert.equal(toIssue(withItem(item({ fEstimate: sel('M') })), c).estimate, 'M')
  const bare = toIssue(node(), c)
  assert.equal('estimate' in bare, false)
  assert.equal('due' in bare, false)
  assert.equal('priority' in bare, false)
})

test('archived follows only the configured Project item', () => {
  const c = ctx()
  assert.equal(toIssue(withItem(item({ isArchived: true })), c).archived, true)
  assert.equal(toIssue(withItem(item({ isArchived: false })), c).archived, false)
  assert.equal(toIssue(withItem(item({ isArchived: true, project: { id: 'P2' } })), c).archived, false)
  assert.equal(itemOf(withItem(item({ project: { id: 'P2' } })), c), null)
  assert.equal(itemOf(withItem(item()), c).id, 'IT1')
})

test('toIssue maps relations, branch, type, people and the body', () => {
  const c = ctx()
  const ref = (number, nameWithOwner = 'acme/widgets') => ({ number, repository: { nameWithOwner }, state: 'OPEN', stateReason: null })
  const issue = toIssue(node({
    title: 'Hello', body: 'Intro\n\n## Acceptance criteria\n- [x] one\n- [ ] two', issueType: { id: 'T1', name: 'Bug' },
    assignees: { nodes: [{ login: 'zed' }, { login: 'amy' }] }, labels: { nodes: [{ name: 'b' }, { name: 'a' }] },
    parent: ref(2), subIssues: { nodes: [ref(9), ref(4)] },
    blockedBy: { nodes: [ref(5, 'acme/other'), ref(3)] }, blocking: { nodes: [ref(8), ref(7)] },
    duplicateOf: ref(1), relatesTo: { nodes: [ref(6)] },
    linkedBranches: { nodes: [{ ref: { name: '12-hello' } }, { ref: { name: 'x' } }] },
  }), c)
  assert.equal(issue.id, '12')
  assert.equal(issue.title, 'Hello')
  assert.equal(issue.type, 'bug')
  assert.equal(issue.assignee, 'zed')
  assert.deepEqual(issue.labels, ['a', 'b'])
  assert.equal(issue.parent, '2')
  assert.deepEqual(issue.children, ['9', '4'])
  assert.deepEqual(issue.blockedBy, ['3', 'acme/other#5'])
  assert.deepEqual(issue.blocks, ['7', '8'])
  assert.deepEqual(issue.related, ['6'])
  assert.deepEqual(issue.duplicateOf, ['1'])
  assert.equal(issue.branch, '12-hello')
  assert.equal(issue.description, 'Intro')
  assert.deepEqual(issue.acceptanceCriteria, [{ text: 'one', done: true }, { text: 'two', done: false }])
  assert.equal(issue.created, 'c')
  assert.equal(issue.updated, 'u')
  assert.deepEqual(issue.status, { name: 'Open', category: 'todo' })
})

test('toIssue leaves unset keys out and related empty without relatesTo', () => {
  const issue = toIssue(node({ relatesTo: undefined }), ctx())
  for (const key of ['type', 'assignee', 'parent', 'branch', 'sprint', 'milestone', 'release']) assert.equal(key in issue, false, key)
  assert.deepEqual(issue.related, [])
  assert.deepEqual(issue.duplicateOf, [])
  assert.equal(issue.archived, false)
})

test('isBlockedNode is false for a blocker in a terminal category', () => {
  const c = ctx()
  const blocker = (over) => ({ number: 3, repository, state: 'OPEN', stateReason: null, projectItems: { nodes: [] }, ...over })
  assert.equal(isBlockedNode(blocker(), c), true)
  assert.equal(isBlockedNode(blocker({ state: 'CLOSED', stateReason: 'COMPLETED' }), c), false)
  assert.equal(isBlockedNode(blocker({ projectItems: { nodes: [item({ status: sel('Done') })] } }), c), false)
  assert.equal(isBlockedNode(blocker({ projectItems: { nodes: [item({ status: sel('Todo') })] } }), c), true)
})

const LABELS = ['Doing', 'Review', 'Backlog', 'bug', 'enhancement', 'x'].map((name, index) => ({ id: `L${index + 1}`, name }))
const labelled = (names, over = {}) => node({ labels: { nodes: names.map((name) => LABELS.find((label) => label.name.toLowerCase() === name.toLowerCase())) }, ...over })
const noProject = (map = {}, over = {}) => ctx({ project: null, labels: LABELS, ...over }, { status: { in_progress: 'label:Doing', in_review: 'label:review', backlog: 'label:Backlog' }, ...map })

test('makeContext without a Project maps status labels, and type labels without issue types', () => {
  const c = noProject({ types: { feature: 'label:enhancement', bug: 'label:bug' } }, { issueTypes: [] })
  assert.deepEqual([...c.statusLabels], [['backlog', { id: 'L3', name: 'Backlog' }], ['in_progress', { id: 'L1', name: 'Doing' }], ['in_review', { id: 'L2', name: 'Review' }]])
  assert.deepEqual([...c.typeLabels], [['feature', { id: 'L5', name: 'enhancement' }], ['bug', { id: 'L4', name: 'bug' }]])
  assert.deepEqual([...c.mappedLabelIds].sort(), ['L1', 'L2', 'L3', 'L4', 'L5'])
  const withProject = ctx({ labels: LABELS }, { status: { in_progress: 'label:Doing' } })
  assert.equal(withProject.statusLabels.size, 0)
  assert.equal(noProject({ types: { bug: 'label:bug' } }).typeLabels.size, 0, 'issue types win')
})

test('status rule with status labels', () => {
  const c = noProject()
  assert.deepEqual(statusOf(labelled([]), c), { name: 'Open', category: 'todo' })
  assert.deepEqual(statusOf(labelled(['x']), c), { name: 'Open', category: 'todo' })
  assert.deepEqual(statusOf(labelled(['Doing']), c), { name: 'Doing', category: 'in_progress' })
  assert.deepEqual(statusOf(labelled(['Review', 'Doing']), c), { name: 'Review', category: 'in_review' })
  assert.deepEqual(statusOf(labelled(['Review'], { state: 'CLOSED', stateReason: 'COMPLETED' }), c), { name: 'Closed', category: 'done' })
  const { issue, warnings } = toIssueWithWarnings(labelled(['Doing', 'Backlog', 'Review']), c)
  assert.equal(issue.status.category, 'in_review')
  assert.deepEqual(warnings, ['12 has several status labels (Backlog, Doing, Review); pmkit reads Review'])
  assert.deepEqual(issue.labels, ['Backlog', 'Doing', 'Review'], 'status labels stay in labels')
})

test('a Project ignores status labels', () => {
  const c = ctx({ labels: LABELS })
  assert.deepEqual(statusOf(labelled(['Doing']), c), { name: 'Open', category: 'todo' })
})

test('type from a type label without issue types', () => {
  const c = noProject({ types: { feature: 'label:enhancement', bug: 'label:bug' } }, { issueTypes: [] })
  assert.equal(toIssue(labelled(['bug']), c).type, 'bug')
  assert.equal(toIssue(labelled(['x']), c).type, undefined)
  const { issue, warnings } = toIssueWithWarnings(labelled(['bug', 'enhancement']), c)
  assert.equal(issue.type, 'feature')
  assert.deepEqual(warnings, ['12 has several type labels (bug, enhancement); pmkit reads feature'])
  const typed = noProject({ types: { bug: 'Bug' } })
  assert.equal(toIssue(labelled(['bug'], { issueType: { name: 'Bug' } }), typed).type, 'bug')
  assert.equal(toIssue(labelled(['bug']), typed).type, undefined, 'with issue types a label is no type')
})

const SPRINT_FIELD = { id: 'F5', name: 'Sprint', dataType: 'ITERATION', options: [], issueField: null }
const sprintRaw = () => {
  const base = raw()
  return { ...base, project: { ...base.project, fields: [...base.project.fields, SPRINT_FIELD] } }
}
const sprintMap = { fields: { priority: 'project:Priority', estimate: 'issue:Estimate', target_date: 'project:Due', sprint: 'project:Sprint' } }
const iteration = (startDate) => ({ __typename: 'ProjectV2ItemFieldIterationValue', iterationId: 'IT_a', title: 'Sprint 1', startDate, duration: 14 })
const epicItem = (id, number) => ({ id: `IT_${id}`, isArchived: false, project: { id, number, owner: { login: 'acme' } } })
const epicContext = () => makeContext(raw(), pmkit(), { epics: new Map([['E12', 'acme/12'], ['E9', 'acme/9']]) })

test('the sprint role is set only for a mapped iteration field of the scope Project', () => {
  const mapped = makeContext(sprintRaw(), pmkit(sprintMap))
  assert.equal(mapped.projectFields.sprint, true)
  assert.equal(mapped.fieldVariables.fSprint, 'Sprint')
  assert.equal(mapped.field('sprint').field.id, 'F5')
  for (const context of [makeContext(sprintRaw(), pmkit()), makeContext(raw(), pmkit(sprintMap)), makeContext(sprintRaw(), pmkit({ fields: { sprint: 'project:Size' } })), makeContext(sprintRaw(), pmkit({ fields: { sprint: 'issue:Sprint' } }))]) {
    assert.equal('sprint' in context.projectFields, false)
    assert.equal('fSprint' in context.fieldVariables, false)
    assert.equal(context.field('sprint'), null)
  }
})

test('a context has no epics unless the caller passes them', () => {
  assert.deepEqual([...ctx().epics], [])
  assert.deepEqual([...epicContext().epics], [['E12', 'acme/12'], ['E9', 'acme/9']])
})

test('toIssue reads the sprint from the start date of the iteration value of the item', () => {
  const c = makeContext(sprintRaw(), pmkit(sprintMap))
  assert.equal(toIssue(withItem(item({ fSprint: iteration('2026-11-16') })), c).sprint, '2026-11-16')
  assert.equal('sprint' in toIssue(withItem(item()), c), false)
  assert.equal('sprint' in toIssue(withItem(item({ fSprint: null })), c), false)
  assert.equal('sprint' in toIssue(node(), c), false)
  assert.equal('sprint' in toIssue(withItem(item({ fSprint: iteration('2026-11-16') })), ctx()), false)
})

test('toIssue reads the milestone title', () => {
  assert.equal(toIssue(node({ milestone: { id: 'M1', number: 3, title: 'v1.0' } }), ctx()).milestone, 'v1.0')
  assert.equal('milestone' in toIssue(node({ milestone: null }), ctx()), false)
  assert.equal('milestone' in toIssue(node(), ctx()), false)
})

test('toIssue reads the epic of the lowest Project number among the items in linked epic Projects', () => {
  assert.equal(toIssue(node({ projectItems: { nodes: [epicItem('E12', 12), epicItem('E9', 9)] } }), epicContext()).parent, 'acme/9')
  assert.equal(toIssue(node({ projectItems: { nodes: [epicItem('E9', 9), epicItem('E12', 12)] } }), epicContext()).parent, 'acme/9')
})

test('toIssue skips an archived epic item, as the epic progress does', () => {
  const archived = { ...epicItem('E9', 9), isArchived: true }
  assert.equal(toIssue(node({ projectItems: { nodes: [archived, epicItem('E12', 12)] } }), epicContext()).parent, 'acme/12')
  assert.equal('parent' in toIssue(node({ projectItems: { nodes: [archived] } }), epicContext()), false)
})

test('toIssue prefers the parent issue to an epic', () => {
  const parent = { id: 'I9', number: 9, repository }
  assert.equal(toIssue(node({ parent, projectItems: { nodes: [epicItem('E12', 12)] } }), epicContext()).parent, '9')
})

test('toIssue ignores items in Projects that are not linked epics, and the scope Project', () => {
  const c = epicContext()
  assert.equal('parent' in toIssue(node({ projectItems: { nodes: [epicItem('OTHER', 3), item()] } }), c), false)
  assert.equal(toIssue(node({ projectItems: { nodes: [epicItem('OTHER', 3), epicItem('E12', 12)] } }), c).parent, 'acme/12')
  assert.equal('parent' in toIssue(node({ projectItems: { nodes: [epicItem('E12', 12)] } }), ctx()), false)
})
