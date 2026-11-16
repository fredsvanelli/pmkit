import assert from 'node:assert/strict'
import { test } from 'node:test'
import { topLevelRollup } from './lib/initiatives.mjs'

const issue = (id, parent, category, estimate, extra = {}) => ({ id, parent, status: { name: category, category }, estimate, archived: false, ...extra })

test('top-level issues are those without an issue parent, and the rollup covers every descendant', () => {
  const issues = [
    issue('A', 'EPC-1', 'in_progress', 5), // parent is an epic, so A is top-level
    issue('B', 'A', 'done', 2),
    issue('C', 'B', 'todo', 3), // grandchild
    issue('D', 'A', 'canceled', 8), // leaves the total
    issue('E', undefined, 'done', 1), // top-level with no sub-issues
  ]
  const { items, withoutChildren } = topLevelRollup(issues)
  assert.equal(withoutChildren, 1)
  assert.equal(items.length, 1)
  const [a] = items
  assert.equal(a.issue.id, 'A')
  assert.deepEqual([a.total, a.done, a.canceled, a.points, a.pointsDone, a.progress], [2, 1, 1, 5, 2, 0.5])
})

test('an issue with no estimate adds no points and progress is null for no counted work', () => {
  const issues = [issue('A', undefined, 'todo'), issue('B', 'A', 'done'), issue('X', undefined, 'todo'), issue('Y', 'X', 'canceled', 2)]
  const { items } = topLevelRollup(issues)
  assert.deepEqual(items.map((i) => [i.issue.id, i.points, i.progress]), [['A', 0, 1], ['X', 0, null]])
})

test('archived issues are skipped and a parent cycle does not loop', () => {
  const issues = [issue('A', 'B', 'todo'), issue('B', 'A', 'todo'), issue('C', undefined, 'todo'), issue('D', 'C', 'done', 1, { archived: true })]
  const { items, withoutChildren } = topLevelRollup(issues)
  assert.deepEqual(items, [])
  assert.equal(withoutChildren, 1)
})

test('a live child of an archived parent or of an unreadable parent is not a top-level row and is unreached', () => {
  const issues = [issue('P', undefined, 'todo', undefined, { archived: true }), issue('C', 'P', 'todo'), issue('K', 'BAD', 'todo'), issue('L', 'K', 'done')]
  const { items, withoutChildren, unreached } = topLevelRollup(issues, { unreadable: new Set(['BAD']) })
  assert.deepEqual(items, [])
  assert.equal(withoutChildren, 0)
  assert.deepEqual(unreached.sort(), ['C', 'K', 'L'])
})
