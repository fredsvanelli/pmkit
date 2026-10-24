import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { hashTree, makeRepo } from './test-helpers.mjs'

function setup() {
  const root = makeRepo()
  const docs = path.join(root, '.issues', 'docs')
  fs.mkdirSync(docs, { recursive: true })
  return { root, docs, tracker: createLocalTracker(root, { now: () => new Date('2026-10-23T12:00:00Z') }) }
}

const code = (value) => (error) => error.code === value

test('createDocument writes the file with LF and returns before null and the document', () => {
  const { tracker, docs } = setup()
  const result = tracker.createDocument('plans/launch.md', 'one\r\ntwo\r\n', 'fred')
  assert.deepEqual(result, { before: null, after: { path: 'plans/launch.md', body: 'one\ntwo\n' } })
  assert.equal(fs.readFileSync(path.join(docs, 'plans', 'launch.md'), 'utf8'), 'one\ntwo\n')
})

test('createDocument writes no event and touches no issue file', () => {
  const { tracker, root } = setup()
  const issues = path.join(root, '.issues', 'issues')
  const before = hashTree(issues)
  tracker.createDocument('a.md', 'x', 'fred')
  assert.equal(hashTree(issues), before)
  assert.deepEqual(tracker.metricEvents(), [])
})

test('readDocument strips a BOM and CRLF', () => {
  const { tracker, docs } = setup()
  fs.writeFileSync(path.join(docs, 'win.md'), '\uFEFFhello\r\nworld\r\n')
  assert.deepEqual(tracker.readDocument('win.md'), { path: 'win.md', body: 'hello\nworld\n' })
})

test('readDocument throws NOT_FOUND for a missing file and for a folder', () => {
  const { tracker, docs } = setup()
  fs.mkdirSync(path.join(docs, 'folder'))
  assert.throws(() => tracker.readDocument('missing.md'), code('NOT_FOUND'))
  assert.throws(() => tracker.readDocument('folder'), code('NOT_FOUND'))
})

test('createDocument refuses an existing file with CONFLICT and keeps its content', () => {
  const { tracker, docs } = setup()
  fs.writeFileSync(path.join(docs, 'a.md'), 'old')
  assert.throws(() => tracker.createDocument('a.md', 'new', 'fred'), code('CONFLICT'))
  assert.equal(fs.readFileSync(path.join(docs, 'a.md'), 'utf8'), 'old')
})

test('absolute paths, .. segments and escapes are INVALID_INPUT for read and create', () => {
  const { tracker, root } = setup()
  const before = hashTree(root)
  for (const bad of ['/etc/passwd', 'C:\\temp\\x.md', '../x.md', 'a/../../x.md', 'a/..\\x.md', '', '.', '   ', null, 42]) {
    assert.throws(() => tracker.readDocument(bad), code('INVALID_INPUT'), `read ${bad}`)
    assert.throws(() => tracker.createDocument(bad, 'x', 'fred'), code('INVALID_INPUT'), `create ${bad}`)
  }
  assert.equal(hashTree(root), before)
})

test('createDocument needs a member actor and a non-empty body', () => {
  const { tracker, root } = setup()
  const before = hashTree(root)
  assert.throws(() => tracker.createDocument('a.md', 'x', 'stranger'), code('INVALID_INPUT'))
  assert.throws(() => tracker.createDocument('a.md', '  \n', 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.createDocument('a.md', undefined, 'fred'), code('INVALID_INPUT'))
  assert.equal(hashTree(root), before)
})

test('a dry run returns the document and writes nothing, not even folders', () => {
  const { tracker, root } = setup()
  const before = hashTree(root)
  const result = tracker.createDocument('deep/er/a.md', 'x', 'fred', { dryRun: true })
  assert.deepEqual(result, { before: null, after: { path: 'deep/er/a.md', body: 'x' } })
  assert.equal(hashTree(root), before)
  assert.equal(fs.existsSync(path.join(root, '.issues', 'docs', 'deep')), false)
})
