import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHANGES, buildPreview, checkBulkFilter, fieldChanges, parseChange } from './lib/bulk.mjs'

const issue = (id, extra = {}) => ({ id, title: `Issue ${id}`, status: { name: 'Todo', category: 'todo' }, labels: [], updated: '2026-10-23T10:00:00Z', ...extra })
const calls = []
const tracker = new Proxy({}, { get: (_, op) => async (...args) => { calls.push([op, ...args]); return { before: issue('A'), after: issue('A') } } })
const actor = 'fred'

test('parseChange rejects an unknown change and lists the known ones', () => {
  assert.throws(() => parseChange('bogus', 'x', {}), (error) => error.code === 'INVALID_INPUT' && CHANGES.every((kind) => error.message.includes(kind)))
})

test('parseChange rejects link without a link kind and an estimate that is not a number', () => {
  assert.throws(() => parseChange('link', 'ISS-1', {}), /--kind/)
  assert.throws(() => parseChange('estimate', 'big', { scale: [1, 2, 3] }), /estimate/)
})

test('label-add and label-remove write the whole list through updateIssue', async () => {
  calls.length = 0
  await parseChange('label-add', 'legacy', {}).apply(tracker, issue('A', { labels: ['x'] }), actor, { dryRun: true })
  await parseChange('label-add', 'legacy', {}).apply(tracker, issue('A', { labels: ['legacy'] }), actor, { dryRun: true })
  await parseChange('label-remove', 'legacy', {}).apply(tracker, issue('A', { labels: ['x', 'legacy'] }), actor, { dryRun: false })
  assert.deepEqual(calls, [
    ['updateIssue', 'A', { labels: ['x', 'legacy'] }, actor, { dryRun: true }],
    ['updateIssue', 'A', { labels: ['legacy'] }, actor, { dryRun: true }],
    ['updateIssue', 'A', { labels: ['x'] }, actor, { dryRun: false }],
  ])
})

test('each change calls the operation the one-by-one command calls', async () => {
  calls.length = 0
  const run = (kind, value, flags = {}) => parseChange(kind, value, flags).apply(tracker, issue('A'), actor, { dryRun: true })
  await run('move', 'done', { status: 'Shipped' })
  await run('assign', 'none')
  await run('priority', 'high')
  await run('estimate', '3', { scale: [1, 2, 3] })
  await run('milestone', 'none')
  await run('sprint', 'current')
  await run('parent', 'EPC-1')
  await run('link', 'ISS-2', { linkKind: 'blocks' })
  await run('link', 'ISS-2', { linkKind: 'blocks', remove: true })
  assert.deepEqual(calls.map(([op]) => op), ['moveToCategory', 'assign', 'updateIssue', 'updateIssue', 'updateIssue', 'moveToCycle', 'setParent', 'link', 'unlink'])
  assert.deepEqual(calls[0], ['moveToCategory', 'A', 'done', actor, { status: 'Shipped', dryRun: true }])
  assert.deepEqual(calls[1].slice(1, 3), ['A', null])
  assert.deepEqual(calls[3][2], { estimate: 3 })
  assert.deepEqual(calls[4][2], { milestone: null })
  assert.deepEqual(calls[5].slice(1, 3), [['A'], 'current'])
})

test('moveToCycle returns a list and the change unwraps the single record', async () => {
  const one = { before: issue('A'), after: issue('A', { sprint: 'S1' }) }
  const result = await parseChange('sprint', 'S1', {}).apply({ moveToCycle: async () => [one] }, issue('A'), actor, { dryRun: true })
  assert.equal(result, one)
})

test('fieldChanges ignores updated and names status by its name', () => {
  const before = issue('A')
  const after = { ...before, updated: 'later', status: { name: 'Done', category: 'done' }, priority: 'high' }
  assert.deepEqual(fieldChanges(before, after), [
    { field: 'status', from: 'Todo', to: 'Done' },
    { field: 'priority', from: undefined, to: 'high' },
  ])
})

const change = parseChange('priority', 'high', {})
const found = (extra = {}) => ({ issues: [issue('A'), issue('B')], problems: [], hasMore: false, ...extra })
const results = [{ before: issue('A'), after: issue('A', { priority: 'high' }) }, { before: issue('B'), after: issue('B') }]

test('buildPreview counts writes, marks unchanged issues and gives a digest', () => {
  const preview = buildPreview({ change, found: found(), results })
  assert.deepEqual(preview.items.map((item) => item.state), ['change', 'unchanged'])
  assert.equal(preview.writes, 1)
  assert.deepEqual(preview.blockers, [])
  assert.match(preview.digest, /^sha256:[0-9a-f]{64}$/)
})

test('the digest follows the change, the updated stamp and the new values', () => {
  const base = buildPreview({ change, found: found(), results }).digest
  assert.equal(buildPreview({ change, found: found(), results }).digest, base)
  const touched = [{ before: issue('A', { updated: 'later' }), after: issue('A', { priority: 'high', updated: 'later' }) }, results[1]]
  assert.notEqual(buildPreview({ change, found: found({ issues: [issue('A', { updated: 'later' }), issue('B')] }), results: touched }).digest, base)
  assert.notEqual(buildPreview({ change: parseChange('priority', 'low', {}), found: found(), results }).digest, base)
  const extra = found({ issues: [...found().issues, issue('C')] })
  assert.notEqual(buildPreview({ change, found: extra, results: [...results, { before: issue('C'), after: issue('C') }] }).digest, base)
})

test('unreadable issues and a rejected issue block the write and the digest', () => {
  const problem = { id: 'ISS-9', code: 'PARSE', message: 'bad yaml' }
  const withProblem = buildPreview({ change, found: found({ problems: [problem] }), results })
  assert.equal(withProblem.digest, null)
  assert.match(withProblem.blockers.join('\n'), /ISS-9/)
  const rejected = buildPreview({ change, found: found(), results: [{ error: { code: 'INVALID_INPUT', message: 'no' } }, results[1]] })
  assert.equal(rejected.items[0].state, 'rejected')
  assert.equal(rejected.digest, null)
  assert.match(rejected.blockers.join('\n'), /A/)
})

test('nothing to write has no digest and no blocker', () => {
  const preview = buildPreview({ change, found: found({ issues: [] }), results: [] })
  assert.equal(preview.writes, 0)
  assert.equal(preview.digest, null)
  assert.deepEqual(preview.blockers, [])
})

test('a label value with a comma is refused, because it would be one label named "a,b"', () => {
  for (const kind of ['label-add', 'label-remove']) {
    assert.throws(() => parseChange(kind, 'a,b', {}), (error) => error.code === 'INVALID_INPUT' && /one label/.test(error.message))
  }
})

test('checkBulkFilter accepts a sort next to a criterion and refuses a sort alone, archived and limit', () => {
  assert.doesNotThrow(() => checkBulkFilter({ labels: ['legacy'], sort: 'priority' }, 'view v'))
  assert.throws(() => checkBulkFilter({ sort: 'priority' }, 'view v'), /narrows/)
  assert.throws(() => checkBulkFilter({ labels: ['x'], archived: true }, 'view v'), /archived/)
  assert.throws(() => checkBulkFilter({ labels: ['x'], limit: 1 }, 'view v'), /limit/)
})
