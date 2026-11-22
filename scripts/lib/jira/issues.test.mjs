import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_ENV, TRACKER, fakeJiraFetch, jiraSiteRoutes } from '../../fake-jira-api.mjs'
import { textToAdf } from './adf.mjs'
import { createJiraClient } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { ISSUE_FIELDS, jiraTime, makeContext, toFields, toIssue } from './issues.mjs'

globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

const NOW = () => new Date('2026-11-22T12:00:00Z')

async function context({ routes = {}, pmkit = {}, edit } = {}) {
  const fetch = fakeJiraFetch({ ...jiraSiteRoutes(), ...routes })
  const client = createJiraClient({ env: FAKE_ENV, tracker: TRACKER, fetch, sleep: async () => {} })
  const raw = await fetchDiscovery(client, { space: 'ENG', now: NOW })
  edit?.(raw)
  return makeContext(raw, { tracker: TRACKER, mappings: { types: { story: 'Story', bug: 'Bug', epic: 'Epic' } }, ...pmkit }, await client.session())
}

const TIME = '2026-11-22T10:00:00.000+0000'
const status = (name, key) => ({ name, statusCategory: { key } })

function item(fields = {}, extra = {}) {
  return {
    id: '10100',
    key: 'ENG-1',
    fields: {
      summary: 'First',
      status: status('To Do', 'new'),
      issuetype: { id: '10001', name: 'Story' },
      priority: { id: '3', name: 'Medium' },
      assignee: null,
      labels: [],
      parent: null,
      subtasks: [],
      issuelinks: [],
      duedate: null,
      description: null,
      created: TIME,
      updated: TIME,
      creator: { accountId: 'acc-1' },
      ...fields,
    },
    properties: {},
    ...extra,
  }
}

const link = (name, side, key, category = 'new') => ({ id: `l-${name}-${side}-${key}`, type: { name }, [side]: { key, fields: { status: { name: 'X', statusCategory: { key: category } } } } })

test('jiraTime turns a +0000 offset into Z', () => {
  assert.equal(jiraTime('2026-11-22T10:00:00.000+0000'), '2026-11-22T10:00:00.000Z')
  assert.equal(jiraTime('2026-11-22T12:00:00.000+0200'), '2026-11-22T10:00:00.000Z')
  assert.equal(jiraTime(null), undefined)
})

test('ISSUE_FIELDS lists the read fields with the estimate and criteria fields', async () => {
  const ctx = await context()
  assert.deepEqual(ISSUE_FIELDS(ctx), ['summary', 'status', 'issuetype', 'priority', 'assignee', 'labels', 'parent', 'subtasks', 'issuelinks', 'duedate', 'description', 'created', 'updated', 'creator', 'customfield_10016'])
  const withCriteria = await context({ edit: (raw) => raw.fields.push({ id: 'customfield_10200', name: 'Acceptance criteria', system: null, customType: 'x' }) })
  assert.deepEqual(ISSUE_FIELDS(withCriteria).slice(-2), ['customfield_10016', 'customfield_10200'])
})

test('makeContext gives the viewer, the space, the link types and the field roles', async () => {
  const ctx = await context()
  assert.deepEqual(ctx.viewer, { id: 'acc-1', name: 'Test User' })
  assert.equal(ctx.space, 'ENG')
  assert.deepEqual(ctx.linkType('blocks'), { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' })
  assert.equal(ctx.linkType('related').name, 'Relates')
  assert.equal(ctx.linkType('duplicate').name, 'Duplicate')
  assert.deepEqual(ctx.fields, { estimate: 'customfield_10016', criteria: null })
  assert.equal(ctx.workTypeOf('story').id, '10001')
  assert.equal(ctx.workTypeOf('task'), undefined)
})

test('toIssue maps the common fields', async () => {
  const ctx = await context()
  const issue = toIssue(item({ assignee: { accountId: 'acc-2' }, labels: ['b', 'a'], parent: { key: 'ENG-9' }, duedate: '2026-12-01', subtasks: [{ key: 'ENG-11' }, { key: 'ENG-3' }] }, { properties: { 'pmkit.branch': 'eng-1-first' } }), ctx, { children: ['ENG-20', 'ENG-3'] })
  assert.deepEqual(issue, {
    id: 'ENG-1', title: 'First', type: 'story', status: { name: 'To Do', category: 'todo' }, priority: 'medium',
    assignee: 'acc-2', labels: ['a', 'b'], parent: 'ENG-9', blockedBy: [], blocks: [], related: [], duplicateOf: [],
    children: ['ENG-3', 'ENG-11', 'ENG-20'], archived: false, due: '2026-12-01', branch: 'eng-1-first',
    description: '', acceptanceCriteria: [], created: '2026-11-22T10:00:00.000Z', updated: '2026-11-22T10:00:00.000Z',
  })
})

test('an unmapped work type reads as no type', async () => {
  const ctx = await context()
  assert.equal('type' in toIssue(item({ issuetype: { id: '10003', name: 'Sub-task' } }), ctx), false)
})

test('Blocks with inwardIssue is blockedBy, with outwardIssue is blocks', async () => {
  const ctx = await context()
  const issue = toIssue(item({ issuelinks: [link('Blocks', 'inwardIssue', 'ENG-10', 'done'), link('Blocks', 'inwardIssue', 'ENG-2'), link('Blocks', 'outwardIssue', 'ENG-5')] }), ctx)
  assert.deepEqual(issue.blockedBy, ['ENG-2', 'ENG-10'])
  assert.deepEqual(issue.blocks, ['ENG-5'])
  assert.deepEqual([...issue.blockerCategories], [['ENG-10', 'done'], ['ENG-2', 'todo']])
  assert.equal(Object.keys(issue).includes('blockerCategories'), false)
})

test('Relates reads both ways without duplicates', async () => {
  const ctx = await context()
  const issue = toIssue(item({ issuelinks: [link('relates', 'inwardIssue', 'ENG-4'), link('Relates', 'outwardIssue', 'ENG-4'), link('Relates', 'outwardIssue', 'ENG-2')] }), ctx)
  assert.deepEqual(issue.related, ['ENG-2', 'ENG-4'])
})

test('Duplicate with outwardIssue is duplicateOf; inwardIssue and unknown types read as nothing', async () => {
  const ctx = await context()
  const issue = toIssue(item({ issuelinks: [link('Duplicate', 'outwardIssue', 'ENG-7'), link('Duplicate', 'inwardIssue', 'ENG-8'), link('Clones', 'outwardIssue', 'ENG-9')] }), ctx)
  assert.deepEqual(issue.duplicateOf, ['ENG-7'])
  assert.deepEqual([issue.blockedBy, issue.blocks, issue.related], [[], [], []])
})

test('the priority read rule', async () => {
  const ctx = await context()
  const read = (name) => toIssue(item({ priority: name ? { name } : null }), ctx).priority
  assert.equal(read('Highest'), 'urgent')
  assert.equal(read('Blocker'), 'urgent')
  assert.equal(read('Major'), 'high')
  assert.equal(read('Medium'), 'medium')
  assert.equal(read('Trivial'), 'low')
  assert.equal(read('P9'), undefined)
  assert.equal(read(null), undefined)
  assert.equal('priority' in toIssue(item({ priority: { name: 'P9' } }), ctx), false)
})

test('status takes the discovered category, then the mapping, then statusCategory.key', async () => {
  const ctx = await context({ pmkit: { mappings: { types: {}, status: { in_review: 'Review' } } } })
  assert.deepEqual(toIssue(item({ status: status('Review', 'indeterminate') }), ctx).status, { name: 'Review', category: 'in_review' })
  assert.deepEqual(toIssue(item({ status: status('Gone', 'done') }), ctx).status, { name: 'Gone', category: 'done' })
  assert.deepEqual(toIssue(item({ status: status('Odd', 'undefined') }), ctx).status, { name: 'Odd', category: 'in_progress' })
})

test('estimate reads points as the number and timeoriginalestimate as hours', async () => {
  const points = await context()
  assert.equal(toIssue(item({ customfield_10016: 3 }), points).estimate, 3)
  const hours = await context({ pmkit: { mappings: { types: {}, fields: { estimate: 'timeoriginalestimate' } } } })
  assert.equal(toIssue(item({ timeoriginalestimate: 7200 }), hours).estimate, 2)
  assert.equal('estimate' in toIssue(item({ timeoriginalestimate: null }), hours), false)
})

test('description and criteria come from the description, or from the criteria field', async () => {
  const plain = await context()
  const body = textToAdf('Intro\n\n## Acceptance criteria\n\n- [ ] one\n- [x] two')
  const read = toIssue(item({ description: body }), plain)
  assert.equal(read.description, 'Intro')
  assert.deepEqual(read.acceptanceCriteria, [{ text: 'one', done: false }, { text: 'two', done: true }])

  const field = await context({ edit: (raw) => raw.fields.push({ id: 'customfield_10200', name: 'Acceptance criteria', system: null, customType: 'x' }) })
  const split = toIssue(item({ description: textToAdf('Intro'), customfield_10200: textToAdf('- [ ] three') }), field)
  assert.equal(split.description, 'Intro')
  assert.deepEqual(split.acceptanceCriteria, [{ text: 'three', done: false }])
})

test('created and updated are UTC with Z', async () => {
  const issue = toIssue(item({ created: '2026-11-22T12:00:00.000+0200' }), await context())
  assert.equal(issue.created, '2026-11-22T10:00:00.000Z')
})

// Writes

async function before(ctx, fields, extra) {
  return toIssue(item(fields, extra), ctx)
}

test('a create needs a title and defaults the type to Task, then the first standard type', async () => {
  const ctx = await context()
  assert.throws(() => toFields({}, null, ctx, { create: true }), { code: 'INVALID_INPUT', message: /title/ })
  const first = toFields({ title: 'New' }, null, ctx, { create: true })
  assert.deepEqual(first.fields, { project: { key: 'ENG' }, summary: 'New', issuetype: { id: '10001' } })
  assert.equal(first.after.title, 'New')
  assert.equal(first.after.type, 'story')
  assert.deepEqual(first.after.status, { name: 'To Do', category: 'todo' })

  const task = await context({ edit: (raw) => raw.workTypes.push({ id: '10010', name: 'Task', level: 'standard', statuses: ['1', '5'] }) })
  assert.deepEqual(toFields({ title: 'New' }, null, task, { create: true }).fields.issuetype, { id: '10010' })
})

test('type maps through mappings.types; null and unknown types are refused', async () => {
  const ctx = await context()
  const old = await before(ctx)
  assert.deepEqual(toFields({ type: 'bug' }, old, ctx, {}).fields, { issuetype: { id: '10002' } })
  assert.deepEqual(toFields({ type: 'story' }, old, ctx, {}).fields, {})
  assert.throws(() => toFields({ type: null }, old, ctx, {}), { code: 'INVALID_INPUT' })
  assert.throws(() => toFields({ type: 'task' }, old, ctx, {}), { code: 'INVALID_INPUT', message: /task/ })
})

test('an update sends only changed fields', async () => {
  const ctx = await context()
  const old = await before(ctx, { labels: ['a'] })
  assert.deepEqual(toFields({ title: 'First', labels: ['a'] }, old, ctx, {}).fields, {})
  const { fields, after } = toFields({ title: 'Renamed' }, old, ctx, {})
  assert.deepEqual(fields, { summary: 'Renamed' })
  assert.equal(after.title, 'Renamed')
  assert.throws(() => toFields({ title: 'a\nb' }, old, ctx, {}), { code: 'INVALID_INPUT' })
})

test('priority writes the first discovered priority whose read matches, null clears', async () => {
  const ctx = await context()
  const old = await before(ctx)
  const high = toFields({ priority: 'high' }, old, ctx, {})
  assert.deepEqual(high.fields, { priority: { id: '2' } })
  assert.equal(high.after.priority, 'high')
  assert.deepEqual(toFields({ priority: 'urgent' }, old, ctx, {}).fields, { priority: { id: '1' } })
  const cleared = toFields({ priority: null }, old, ctx, {})
  assert.deepEqual(cleared.fields, { priority: null })
  assert.equal('priority' in cleared.after, false)
  assert.throws(() => toFields({ priority: 'huge' }, old, ctx, {}), { code: 'INVALID_INPUT' })
  const none = await context({ edit: (raw) => { raw.priorities = [{ id: '9', name: 'P1' }] } })
  assert.throws(() => toFields({ priority: 'high' }, old, none, {}), { code: 'INVALID_INPUT', message: /P1/ })
})

test('estimate hours become seconds; no estimate field is NOT_SUPPORTED', async () => {
  const hours = await context({ pmkit: { mappings: { types: {}, fields: { estimate: 'timeoriginalestimate' } } } })
  const old = await before(hours, { timeoriginalestimate: 3600 })
  const two = toFields({ estimate: 2 }, old, hours, {})
  assert.deepEqual(two.fields, { timeoriginalestimate: 7200 })
  assert.equal(two.after.estimate, 2)
  assert.deepEqual(toFields({ estimate: null }, old, hours, {}).fields, { timeoriginalestimate: null })
  const points = await context()
  assert.deepEqual(toFields({ estimate: 5 }, old, points, {}).fields, { customfield_10016: 5 })
  assert.throws(() => toFields({ estimate: -1 }, old, points, {}), { code: 'INVALID_INPUT' })
  const none = await context({ pmkit: { mappings: { types: {}, fields: { estimate: 'none' } } } })
  assert.throws(() => toFields({ estimate: 1 }, old, none, {}), { code: 'NOT_SUPPORTED', message: /No estimate field in space ENG/ })
})

test('labels holding a space are refused', async () => {
  const ctx = await context()
  const old = await before(ctx)
  assert.throws(() => toFields({ labels: ['a b'] }, old, ctx, {}), { code: 'INVALID_INPUT', message: /a b/ })
  const set = toFields({ labels: ['z', 'new'] }, old, ctx, {})
  assert.deepEqual(set.fields, { labels: ['new', 'z'] })
  assert.deepEqual(set.after.labels, ['new', 'z'])
})

test('sprint, milestone and release values name the issue that serves them; null passes', async () => {
  const ctx = await context()
  const old = await before(ctx)
  assert.throws(() => toFields({ sprint: 'x' }, old, ctx, {}), { code: 'NOT_SUPPORTED', message: /PMK-78/ })
  assert.throws(() => toFields({ milestone: 'x' }, old, ctx, {}), { code: 'NOT_SUPPORTED', message: /PMK-79/ })
  assert.throws(() => toFields({ release: 'x' }, old, ctx, {}), { code: 'NOT_SUPPORTED', message: /PMK-79/ })
  assert.deepEqual(toFields({ sprint: null, milestone: null, release: null }, old, ctx, {}).fields, {})
  assert.throws(() => toFields({ status: 'done' }, old, ctx, {}), { code: 'INVALID_INPUT' })
})

test('due writes duedate; null clears', async () => {
  const ctx = await context()
  const old = await before(ctx)
  assert.deepEqual(toFields({ due: '2026-12-01' }, old, ctx, {}).fields, { duedate: '2026-12-01' })
  assert.throws(() => toFields({ due: '12/01' }, old, ctx, {}), { code: 'INVALID_INPUT' })
  assert.deepEqual(toFields({ due: null }, await before(ctx, { duedate: '2026-12-01' }), ctx, {}).fields, { duedate: null })
})

test('description and criteria write ADF to the description, or the criteria to their field', async () => {
  const ctx = await context()
  const old = await before(ctx)
  const both = toFields({ description: 'Intro', acceptanceCriteria: [{ text: 'one' }] }, old, ctx, {})
  assert.deepEqual(both.fields, { description: textToAdf('Intro\n\n## Acceptance criteria\n\n- [ ] one') })
  assert.equal(both.after.description, 'Intro')
  assert.deepEqual(both.after.acceptanceCriteria, [{ text: 'one', done: false }])
  assert.throws(() => toFields({ description: '## Acceptance criteria' }, old, ctx, {}), { code: 'INVALID_INPUT' })

  const field = await context({ edit: (raw) => raw.fields.push({ id: 'customfield_10200', name: 'Acceptance criteria', system: null, customType: 'x' }) })
  const split = toFields({ description: 'Intro', acceptanceCriteria: ['one'] }, await before(field), field, {})
  assert.deepEqual(split.fields, { description: textToAdf('Intro'), customfield_10200: textToAdf('- [ ] one') })
})

test('assignee and parent on create; status must be a category', async () => {
  const ctx = await context()
  const made = toFields({ title: 'New', assignee: 'acc-2', parent: 'eng-9', status: 'in_progress' }, null, ctx, { create: true })
  assert.deepEqual(made.fields, { project: { key: 'ENG' }, summary: 'New', issuetype: { id: '10001' }, assignee: { accountId: 'acc-2' }, parent: { key: 'ENG-9' } })
  assert.equal(made.after.assignee, 'acc-2')
  assert.equal(made.after.parent, 'ENG-9')
  assert.throws(() => toFields({ title: 'New', assignee: 'ghost' }, null, ctx, { create: true }), (error) => error.code === 'INVALID_INPUT' && error.details?.stale === true)
  assert.throws(() => toFields({ title: 'New', parent: 'nope' }, null, ctx, { create: true }), { code: 'INVALID_INPUT' })
  assert.throws(() => toFields({ title: 'New', status: 'nowhere' }, null, ctx, { create: true }), { code: 'INVALID_INPUT' })
})

test('branch is a property, not a field, on update only', async () => {
  const ctx = await context()
  const old = await before(ctx, {}, { properties: { 'pmkit.branch': 'eng-1-first' } })
  const moved = toFields({ branch: 'eng-1-next' }, old, ctx, {})
  assert.deepEqual(moved.fields, {})
  assert.deepEqual(moved.property, { 'pmkit.branch': 'eng-1-next' })
  assert.equal(moved.after.branch, 'eng-1-next')
  assert.equal(toFields({ branch: 'eng-1-first' }, old, ctx, {}).property, undefined)
  assert.throws(() => toFields({ branch: 'bad..name' }, old, ctx, {}), { code: 'INVALID_INPUT' })
  assert.throws(() => toFields({ title: 'x', branch: 'b' }, null, ctx, { create: true }), { code: 'INVALID_INPUT' })
})
