import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dependencyMap } from './lib/dependencies.mjs'

// The order of the issues array is the creation order.
const st = (category) => ({ name: category, category })
const issue = (id, fields = {}) => ({ id, title: id, status: st('todo'), blockedBy: [], related: [], archived: false, ...fields })
const epic = { id: 'EPC-1', kind: 'epic', title: 'Epic', status: st('in_progress') }
const ids = (map) => map.nodes.map((node) => node.id)
const node = (map, id) => map.nodes.find((entry) => entry.id === id)

test("an epic's scope is the non-archived issues whose parent chain reaches it, nested in creation order", () => {
  const issues = [
    issue('A', { parent: 'EPC-1' }),
    issue('B', { parent: 'A' }),
    issue('C', { parent: 'EPC-1', archived: true }),
    issue('D'),
    issue('E', { parent: 'EPC-1', status: st('done') }),
  ]
  const map = dependencyMap({ target: epic, issues })
  assert.deepEqual(ids(map), ['A', 'B', 'E'])
  assert.ok(map.nodes.every((entry) => entry.scope === true))
  assert.deepEqual(map.tree, [{ id: 'A', children: [{ id: 'B', children: [] }] }, { id: 'E', children: [] }])
  assert.deepEqual(map.target, { id: 'EPC-1', kind: 'epic', title: 'Epic', status: st('in_progress'), ancestors: [] })
})

test("an issue target's scope is the issue and its sub-issues, with its ancestors nearest first", () => {
  const T = issue('T', { parent: 'P' })
  const issues = [
    issue('P', { parent: 'EPC-1' }),
    T,
    issue('S', { parent: 'T' }),
    issue('S2', { parent: 'S' }),
    issue('X', { parent: 'T', archived: true }),
  ]
  const map = dependencyMap({ target: { ...T, kind: 'issue' }, issues })
  assert.deepEqual(ids(map), ['T', 'S', 'S2'])
  assert.deepEqual(map.tree, [{ id: 'T', children: [{ id: 'S', children: [{ id: 'S2', children: [] }] }] }])
  assert.deepEqual(map.target.ancestors, ['P', 'EPC-1'])
})

test('an open blocker outside the scope is upstream and brings its own blockers, not its sub-issues', () => {
  const issues = [
    issue('A', { parent: 'EPC-1', blockedBy: ['U'] }),
    issue('U', { blockedBy: ['V'] }),
    issue('V'),
    issue('W', { parent: 'U' }),
  ]
  const map = dependencyMap({ target: epic, issues })
  assert.deepEqual(ids(map), ['A', 'U', 'V'])
  assert.equal(node(map, 'U').scope, false)
  assert.deepEqual(node(map, 'U').blockedBy, ['V'])
  assert.equal(map.basis, 'blockers')
  assert.equal(map.reason, null)
})

test('an edge to a done or canceled blocker is dropped and counted', () => {
  const issues = [
    issue('A', { parent: 'EPC-1', blockedBy: ['D', 'K', 'O'] }),
    issue('D', { status: st('done') }),
    issue('K', { status: st('canceled') }),
    issue('O'),
  ]
  const map = dependencyMap({ target: epic, issues })
  assert.deepEqual(node(map, 'A').blockedBy, ['O'])
  assert.equal(map.resolved, 2)
  assert.equal(node(map, 'D'), undefined)
  assert.equal(node(map, 'K'), undefined)
})

test('a missing and an unreadable blocker are open nodes that are not followed', () => {
  const issues = [issue('A', { parent: 'EPC-1', blockedBy: ['M', 'R'] })]
  const map = dependencyMap({ target: epic, issues, unreadable: ['R'] })
  // M ends up on the critical path M → A: each node weighs 1, and M sorts before R.
  assert.deepEqual(node(map, 'M'), {
    id: 'M', title: null, status: null, assignee: null, estimate: null, parent: null,
    scope: false, open: true, archived: false, missing: true, unreadable: false, blockedBy: [], critical: true,
  })
  assert.equal(node(map, 'R').missing, false)
  assert.equal(node(map, 'R').unreadable, true)
  assert.deepEqual(ids(map), ['A', 'M', 'R'])
})

test('an archived blocker that is not done stays, marked archived', () => {
  const issues = [
    issue('A', { parent: 'EPC-1', blockedBy: ['Z'] }),
    issue('Z', { archived: true, status: st('in_progress') }),
  ]
  const map = dependencyMap({ target: epic, issues })
  assert.equal(node(map, 'Z').archived, true)
  assert.equal(node(map, 'Z').scope, false)
  assert.deepEqual(node(map, 'A').blockedBy, ['Z'])
})

test('the blockers of a done scope issue are not followed', () => {
  const issues = [issue('A', { parent: 'EPC-1', status: st('done'), blockedBy: ['O'] }), issue('O')]
  const map = dependencyMap({ target: epic, issues })
  assert.deepEqual(ids(map), ['A'])
  assert.equal(map.resolved, 0)
  assert.equal(map.basis, 'hierarchy')
  assert.equal(map.reason, 'none')
})

test('the basis says why it is the hierarchy only', () => {
  const none = dependencyMap({ target: epic, issues: [issue('A', { parent: 'EPC-1' })] })
  assert.equal(none.basis, 'hierarchy')
  assert.equal(none.reason, 'none')
  assert.equal(none.criticalPath, null)

  const resolved = dependencyMap({ target: epic, issues: [issue('A', { parent: 'EPC-1', blockedBy: ['D'] }), issue('D', { status: st('done') })] })
  assert.equal(resolved.basis, 'hierarchy')
  assert.equal(resolved.reason, 'resolved')
  assert.equal(resolved.criticalPath, null)

  const absent = dependencyMap({ target: epic, issues: [issue('A', { parent: 'EPC-1', blockedBy: ['O'] }), issue('O')], dependencies: false })
  assert.equal(absent.basis, 'hierarchy')
  assert.equal(absent.reason, 'absent')
  assert.equal(absent.resolved, 0)
  assert.ok(absent.nodes.every((entry) => entry.blockedBy.length === 0))
  assert.equal(absent.criticalPath, null)
})

test('related pairs come from scope issues, each pair once', () => {
  const issues = [
    issue('A', { parent: 'EPC-1', related: ['B', 'Q'] }),
    issue('B', { parent: 'EPC-1', related: ['A'] }),
    issue('Q'),
  ]
  const map = dependencyMap({ target: epic, issues })
  assert.deepEqual(map.related, [['A', 'B'], ['A', 'Q']])
})

test('the weight unit follows the velocity rule', () => {
  const mixed = [issue('A', { parent: 'EPC-1', estimate: 3 }), issue('B', { parent: 'EPC-1' })]
  assert.deepEqual(dependencyMap({ target: epic, issues: mixed }).weight, { unit: 'points' })
  assert.deepEqual(dependencyMap({ target: epic, issues: mixed, unit: 'hours' }).weight, { unit: 'hours' })
  const bare = [issue('A', { parent: 'EPC-1' })]
  assert.deepEqual(dependencyMap({ target: epic, issues: bare }).weight, { unit: 'issues' })
  const sized = [issue('A', { parent: 'EPC-1', estimate: 'M' })]
  assert.deepEqual(dependencyMap({ target: epic, issues: sized, unit: 'sizes' }).weight, { unit: 'issues' })
  const doneOnly = [issue('A', { parent: 'EPC-1', status: st('done'), estimate: 5 }), issue('B', { parent: 'EPC-1' })]
  assert.deepEqual(dependencyMap({ target: epic, issues: doneOnly }).weight, { unit: 'issues' })
})

test('a parent loop under an issue target stops the tree', () => {
  const T = issue('T', { parent: 'P' })
  const issues = [T, issue('P', { parent: 'T' })]
  const map = dependencyMap({ target: { ...T, kind: 'issue' }, issues })
  assert.deepEqual(map.tree, [{ id: 'T', children: [{ id: 'P', children: [] }] }])
})

test('a done issue target with no open sub-issue is the hierarchy only', () => {
  const T = issue('T', { status: st('done'), blockedBy: ['O'] })
  const map = dependencyMap({ target: { ...T, kind: 'issue' }, issues: [T, issue('O')] })
  assert.equal(map.basis, 'hierarchy')
  assert.equal(map.reason, 'none')
  assert.deepEqual(map.tree, [{ id: 'T', children: [] }])
})

test('a blocked_by loop is broken at the edge that closes it', () => {
  const issues = [
    issue('S', { parent: 'EPC-1', blockedBy: ['A'] }),
    issue('A', { blockedBy: ['B'] }),
    issue('B', { blockedBy: ['A'] }),
  ]
  const map = dependencyMap({ target: epic, issues })
  assert.deepEqual(map.problems, [{ id: 'B', code: 'cycle', message: 'blocked_by loop: A → B → A; run /pmkit:local:doctor' }])
  assert.deepEqual(node(map, 'S').blockedBy, ['A'])
  assert.deepEqual(node(map, 'A').blockedBy, ['B'])
  assert.deepEqual(node(map, 'B').blockedBy, [])
  assert.equal(map.basis, 'blockers')
})

test('the loop walk starts from the scope, whatever the creation order', () => {
  const issues = [
    issue('B', { blockedBy: ['A'] }),
    issue('A', { blockedBy: ['B'] }),
    issue('S', { parent: 'EPC-1', blockedBy: ['A'] }),
  ]
  const map = dependencyMap({ target: epic, issues })
  assert.deepEqual(map.problems, [{ id: 'B', code: 'cycle', message: 'blocked_by loop: A → B → A; run /pmkit:local:doctor' }])
  assert.deepEqual(node(map, 'S').blockedBy, ['A'])
  assert.deepEqual(node(map, 'A').blockedBy, ['B'])
  assert.deepEqual(node(map, 'B').blockedBy, [])
})

test('a self-loop is dropped, and with no other edge the basis is none', () => {
  const map = dependencyMap({ target: epic, issues: [issue('S', { parent: 'EPC-1', blockedBy: ['S'] })] })
  assert.deepEqual(map.problems, [{ id: 'S', code: 'cycle', message: 'blocked_by loop: S → S; run /pmkit:local:doctor' }])
  assert.deepEqual(node(map, 'S').blockedBy, [])
  assert.equal(map.basis, 'hierarchy')
  assert.equal(map.reason, 'none')
})

// In the critical path tests, every issue whose ID starts with S is under EPC-1.
const scoped = (id, fields = {}) => issue(id, id.startsWith('S') ? { parent: 'EPC-1', ...fields } : fields)
const critical = (map) => map.nodes.filter((entry) => entry.critical).map((entry) => entry.id)

test('the critical path is the heaviest chain that ends at an open scope issue', () => {
  const issues = [scoped('S1', { estimate: 8, blockedBy: ['U'] }), scoped('U', { estimate: 3 }), scoped('S2', { estimate: 5 })]
  const map = dependencyMap({ target: epic, issues })
  assert.deepEqual(map.criticalPath, { ids: ['U', 'S1'], length: 11, unestimated: [] })
  assert.deepEqual(critical(map), ['S1', 'U'])
})

test('a lone heavy scope issue can be the critical path', () => {
  const issues = [scoped('S1', { estimate: 2, blockedBy: ['U'] }), scoped('U', { estimate: 1 }), scoped('S2', { estimate: 5 })]
  assert.deepEqual(dependencyMap({ target: epic, issues }).criticalPath, { ids: ['S2'], length: 5, unestimated: [] })
})

test('an unestimated node weighs 0 and is named', () => {
  const issues = [scoped('S1', { estimate: 5, blockedBy: ['U', 'M'] }), scoped('U'), scoped('S2', { estimate: 3 })]
  assert.deepEqual(dependencyMap({ target: epic, issues }).criticalPath, { ids: ['U', 'S1'], length: 5, unestimated: ['U'] })
})

test('with no numeric estimate each issue weighs 1', () => {
  const issues = [scoped('S1', { blockedBy: ['A'] }), scoped('A', { blockedBy: ['B'] }), scoped('B'), scoped('S2')]
  const map = dependencyMap({ target: epic, issues })
  assert.deepEqual(map.weight, { unit: 'issues' })
  assert.deepEqual(map.criticalPath, { ids: ['B', 'A', 'S1'], length: 3, unestimated: [] })
})

test('ties go to the chain whose nodes come first in creation order', () => {
  const blockers = [scoped('X', { estimate: 3 }), scoped('Y', { estimate: 3 }), scoped('S', { estimate: 2, blockedBy: ['Y', 'X'] })]
  assert.deepEqual(dependencyMap({ target: epic, issues: blockers }).criticalPath.ids, ['X', 'S'])
  const candidates = [
    scoped('S1', { estimate: 3 }),
    scoped('S2', { estimate: 3 }),
    scoped('S3', { estimate: 1, blockedBy: ['U'] }),
    scoped('U', { estimate: 1 }),
  ]
  assert.deepEqual(dependencyMap({ target: epic, issues: candidates }).criticalPath.ids, ['S1'])
})

test('the hierarchy basis has no critical path', () => {
  const map = dependencyMap({ target: epic, issues: [issue('A', { parent: 'EPC-1', blockedBy: ['D'] }), issue('D', { status: st('done') })] })
  assert.equal(map.reason, 'resolved')
  assert.equal(map.criticalPath, null)
  assert.deepEqual(critical(map), [])
})
