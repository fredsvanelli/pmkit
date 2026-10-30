import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parseView, serializeView, validViewName } from './lib/local/views.mjs'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { hashTree, makeRepo } from './test-helpers.mjs'

test('validViewName accepts letters, digits, dots, underscores and dashes, and refuses paths', () => {
  for (const name of ['mine', 'open-bugs', 'v1.0', 'a_b', 'A1']) assert.equal(validViewName(name), true, name)
  for (const name of ['a/b', '..', '', '-a', 'a b', undefined, 5]) assert.equal(validViewName(name), false, String(name))
})

test('a filter round trips through the file and keeps sprint current symbolic', () => {
  const filter = { categories: ['in_progress', 'in_review'], assignee: 'me', sprint: 'current', blocked: true, limit: 5, text: '123', sort: 'priority' }
  const text = serializeView(filter)
  assert.match(text, /sprint: current/)
  assert.deepEqual(parseView(text, 'mine'), { name: 'mine', filter })
})

test('parseView refuses a file whose filter is not a map', () => {
  for (const text of ['filter: 3\n', 'other: 1\n', '']) {
    assert.throws(() => parseView(text, 'x'), (error) => error.code === 'INVALID_INPUT' && error.nextStep === '/pmkit:local:doctor', text)
  }
})

function setup() {
  const root = makeRepo('team')
  return { root, views: path.join(root, '.issues', 'views'), tracker: createLocalTracker(root, { now: () => new Date('2026-10-23T12:00:00Z') }) }
}
const code = (value) => (error) => error.code === value

test('saveView writes views/<name>.yaml, listViews lists it and runView runs the stored filter', () => {
  const { tracker, views } = setup()
  const filter = { categories: ['in_progress'], sort: 'created' }
  const saved = tracker.saveView('active', filter, 'fred')
  assert.deepEqual(saved, { before: null, after: { name: 'active', filter } })
  assert.equal(fs.readFileSync(path.join(views, 'active.yaml'), 'utf8'), 'filter:\n  categories: [in_progress]\n  sort: created\n')
  assert.deepEqual(tracker.listViews(), [{ name: 'active', filter }])
  const run = tracker.runView('active')
  assert.deepEqual(run.issues.map((i) => i.id), tracker.searchIssues(filter).issues.map((i) => i.id))
  assert.ok(run.issues.length > 0)
})

test('listViews is empty without a views folder and sorted by name otherwise', () => {
  const { tracker } = setup()
  assert.deepEqual(tracker.listViews(), [])
  tracker.saveView('b', { blocked: true }, 'fred')
  tracker.saveView('a', { blocked: true }, 'fred')
  assert.deepEqual(tracker.listViews().map((v) => v.name), ['a', 'b'])
})

test('saveView refuses an existing name, a name that differs by case and an invalid name, and replace overwrites', () => {
  const { tracker, views } = setup()
  tracker.saveView('Mine', { assignee: 'me' }, 'fred')
  assert.throws(() => tracker.saveView('Mine', { blocked: true }, 'fred'), code('CONFLICT'))
  assert.throws(() => tracker.saveView('mine', { blocked: true }, 'fred'), code('CONFLICT'))
  assert.throws(() => tracker.saveView('../x', { blocked: true }, 'fred'), code('INVALID_INPUT'))
  tracker.saveView('other', { blocked: true }, 'fred')
  const other = fs.readFileSync(path.join(views, 'other.yaml'), 'utf8')
  const result = tracker.saveView('Mine', { blocked: true }, 'fred', { replace: true })
  assert.deepEqual(result.before, { name: 'Mine', filter: { assignee: 'me' } })
  assert.deepEqual(tracker.listViews().map((v) => v.name), ['Mine', 'other'])
  assert.equal(fs.readFileSync(path.join(views, 'other.yaml'), 'utf8'), other)
})

test('saveView refuses an empty or invalid filter and a dry run writes nothing', () => {
  const { tracker, root } = setup()
  const before = hashTree(root)
  assert.throws(() => tracker.saveView('x', {}, 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.saveView('x', { categories: ['nope'] }, 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.saveView('x', { bogus: 1 }, 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.saveView('x', { blocked: true }, 'nobody'), code('INVALID_INPUT'))
  const dry = tracker.saveView('x', { blocked: true }, 'fred', { dryRun: true })
  assert.deepEqual(dry.after, { name: 'x', filter: { blocked: true } })
  assert.equal(hashTree(root), before)
})

test('runView of a missing view is NOT_FOUND and of a view with a stale value is INVALID_INPUT', () => {
  const { tracker, views } = setup()
  assert.throws(() => tracker.runView('missing'), code('NOT_FOUND'))
  assert.throws(() => tracker.runView('../x'), code('INVALID_INPUT'))
  fs.mkdirSync(views, { recursive: true })
  fs.writeFileSync(path.join(views, 'stale.yaml'), 'filter:\n  types: [gone]\n')
  assert.throws(() => tracker.runView('stale'), code('INVALID_INPUT'))
  fs.writeFileSync(path.join(views, 'broken.yaml'), 'filter: 3\n')
  assert.throws(() => tracker.runView('broken'), code('INVALID_INPUT'))
})
