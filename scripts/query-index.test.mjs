import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PmkitError } from './lib/errors.mjs'
import { FORMAT_VERSION } from './lib/local/migrations.mjs'
import {
  INDEX_FILE, RACY_MS, SCHEMA, clearIndex, indexHeader, isRacy, loadIndex, readThroughIndex,
} from './lib/local/query-index.mjs'
import { writeFileAtomic } from './lib/local/store.mjs'

function withDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-index-'))
  try {
    return fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const HEADER = indexHeader({})
const HOUR = 60 * 60 * 1000

// Moves the index mtime an hour ahead, so no entry is racy and the signature check decides.
function settle(cacheDir) {
  const file = path.join(cacheDir, INDEX_FILE)
  if (!fs.existsSync(file)) return
  const later = new Date(Date.now() + HOUR)
  fs.utimesSync(file, later, later)
}

// The smallest value that passes the cached-issue shape check in loadIndex.
const issueOf = (id, title) => ({ id, title, status: { name: 'todo', category: 'todo' }, labels: [], blockedBy: [], related: [], duplicateOf: [], acceptanceCriteria: [] })

// One file per id under dir/files. A file that starts with <<<<<<< is a PmkitError CONFLICT.
function fake(dir, contents) {
  const files = path.join(dir, 'files')
  fs.mkdirSync(files, { recursive: true })
  for (const [id, text] of Object.entries(contents)) fs.writeFileSync(path.join(files, id), text)
  const cacheDir = path.join(dir, '.cache')
  const fileOf = (id) => path.join(files, id)
  const read = (id) => {
    if (!fs.existsSync(fileOf(id))) throw new PmkitError('NOT_FOUND', `issue ${id} does not exist`)
    const text = fs.readFileSync(fileOf(id), 'utf8')
    if (text.startsWith('<<<<<<<')) throw new PmkitError('CONFLICT', 'The issue file contains git conflict markers.')
    return issueOf(id, text)
  }
  const run = (ids, { write = true, header = HEADER } = {}) => readThroughIndex({ cacheDir, header, ids, fileOf, read, write })
  return { cacheDir, fileOf, run, indexFile: path.join(cacheDir, INDEX_FILE) }
}
const counts = ({ parsed, reused, written }) => ({ parsed, reused, written })

describe('query index module', () => {
  test('isRacy treats an entry within RACY_MS of the index mtime, or later, as changed', () => {
    assert.equal(RACY_MS, 2000)
    assert.equal(isRacy({ mtimeMs: 1000, ctimeMs: 1000 }, 3000), true)
    assert.equal(isRacy({ mtimeMs: 999, ctimeMs: 999 }, 3000), false)
    assert.equal(isRacy({ mtimeMs: 0, ctimeMs: 5000 }, 3000), true)
    assert.equal(isRacy({ mtimeMs: 5000, ctimeMs: 0 }, 3000), true)
  })

  test('indexHeader holds the schema, the format, a parser hash and a hash of the statuses', () => {
    const a = indexHeader({ todo: { category: 'todo' } })
    const b = indexHeader({ todo: { category: 'in_progress' } })
    assert.deepEqual(Object.keys(a), ['schema', 'format', 'parser', 'options'])
    assert.equal(a.schema, SCHEMA)
    assert.equal(a.format, FORMAT_VERSION)
    assert.match(a.parser, /^[0-9a-f]{40}$/)
    assert.equal(a.parser, b.parser)
    assert.notEqual(a.options, b.options)
  })

  test('a cold read parses every file, writes .gitignore and index.json in folder order', () => withDir((dir) => {
    const f = fake(dir, { A: 'one', B: 'two' })
    const result = f.run(['A', 'B'])
    assert.deepEqual(result.issues, [issueOf('A', 'one'), issueOf('B', 'two')])
    assert.deepEqual(counts(result.stats), { parsed: 2, reused: 0, written: true })
    assert.equal(fs.readFileSync(path.join(f.cacheDir, '.gitignore'), 'utf8'), '*\n')
    const data = JSON.parse(fs.readFileSync(f.indexFile, 'utf8'))
    assert.deepEqual(Object.keys(data), ['schema', 'format', 'parser', 'options', 'issues'])
    assert.deepEqual(Object.keys(data.issues), ['A', 'B'])
    assert.deepEqual(Object.keys(data.issues.A.sig), ['size', 'mtimeMs', 'ctimeMs', 'ino'])
  }))

  test('a settled index reuses every entry and writes nothing', () => withDir((dir) => {
    const f = fake(dir, { A: 'one', B: 'two' })
    f.run(['A', 'B'])
    settle(f.cacheDir)
    const bytes = fs.readFileSync(f.indexFile)
    const result = f.run(['A', 'B'])
    assert.deepEqual(result.issues, [issueOf('A', 'one'), issueOf('B', 'two')])
    assert.deepEqual(counts(result.stats), { parsed: 0, reused: 2, written: false })
    assert.deepEqual(fs.readFileSync(f.indexFile), bytes)
  }))

  test('racy entries are reparsed and the index is rewritten', () => withDir((dir) => {
    const f = fake(dir, { A: 'one' })
    f.run(['A'])
    const { ctimeMs } = fs.statSync(f.fileOf('A'))
    const near = new Date(ctimeMs + 1000)
    fs.utimesSync(f.indexFile, near, near)
    assert.deepEqual(counts(f.run(['A']).stats), { parsed: 1, reused: 0, written: true })
  }))

  test('an edit reparses that file only, and a same-size edit with the mtime restored is caught by ctime', () => withDir((dir) => {
    const f = fake(dir, { A: 'one', B: 'two' })
    f.run(['A', 'B'])
    settle(f.cacheDir)
    fs.writeFileSync(f.fileOf('A'), 'one, edited')
    let result = f.run(['A', 'B'])
    assert.deepEqual(result.issues[0], issueOf('A', 'one, edited'))
    assert.deepEqual(counts(result.stats), { parsed: 1, reused: 1, written: true })
    settle(f.cacheDir)
    const { atime, mtime } = fs.statSync(f.fileOf('B'))
    fs.writeFileSync(f.fileOf('B'), 'TWO')
    fs.utimesSync(f.fileOf('B'), atime, mtime)
    result = f.run(['A', 'B'])
    assert.deepEqual(result.issues[1], issueOf('B', 'TWO'))
    assert.equal(result.stats.parsed, 1)
  }))

  test('problems are cached; an error that is not a PmkitError propagates', () => withDir((dir) => {
    const f = fake(dir, { A: 'one', C: '<<<<<<< HEAD' })
    const first = f.run(['A', 'C'])
    assert.deepEqual(first.problems, [{ id: 'C', code: 'CONFLICT', message: 'The issue file contains git conflict markers.' }])
    settle(f.cacheDir)
    const second = f.run(['A', 'C'])
    assert.deepEqual(second.problems, first.problems)
    assert.equal(second.stats.reused, 2)
    const broken = () => readThroughIndex({ cacheDir: f.cacheDir, header: HEADER, ids: ['A'], fileOf: f.fileOf, read: () => { throw new TypeError('bug') }, write: true })
    fs.writeFileSync(f.fileOf('A'), 'changed')
    assert.throws(broken, TypeError)
  }))

  test('a folder without its file is the read problem and gets no entry; a dropped folder rewrites the index', () => withDir((dir) => {
    const f = fake(dir, { A: 'one', B: 'two' })
    const result = f.run(['A', 'B', 'X'])
    assert.deepEqual(result.problems.map((p) => [p.id, p.code]), [['X', 'NOT_FOUND']])
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(f.indexFile, 'utf8')).issues), ['A', 'B'])
    settle(f.cacheDir)
    assert.equal(f.run(['A', 'B', 'X']).stats.written, false)
    const dropped = f.run(['A'])
    assert.equal(dropped.stats.written, true)
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(f.indexFile, 'utf8')).issues), ['A'])
  }))

  test('loadIndex returns null for a missing, corrupt, foreign or misshapen index, and drops a bad entry', () => withDir((dir) => {
    const f = fake(dir, { A: 'one', B: 'two' })
    assert.equal(loadIndex(f.indexFile, HEADER), null)
    f.run(['A', 'B'])
    const good = fs.readFileSync(f.indexFile, 'utf8')
    const data = JSON.parse(good)
    const variants = [
      good.slice(0, Math.floor(good.length / 2)),
      '{nope',
      'null',
      JSON.stringify({ ...data, issues: [] }),
      ...['schema', 'format', 'parser', 'options'].map((key) => JSON.stringify({ ...data, [key]: 'other' })),
    ]
    for (const text of variants) {
      fs.writeFileSync(f.indexFile, text)
      assert.equal(loadIndex(f.indexFile, HEADER), null, text.slice(0, 40))
    }
    const bad = structuredClone(data)
    delete bad.issues.A.sig.ino
    bad.issues.B.issue = 'not an object'
    fs.writeFileSync(f.indexFile, JSON.stringify(bad))
    assert.deepEqual([...loadIndex(f.indexFile, HEADER).entries.keys()], [])
  }))

  test('write: false never creates .cache', () => withDir((dir) => {
    const f = fake(dir, { A: 'one' })
    const result = f.run(['A'], { write: false })
    assert.deepEqual(result.issues, [issueOf('A', 'one')])
    assert.equal(result.stats.written, false)
    assert.equal(fs.existsSync(f.cacheDir), false)
  }))

  test('a write failure is caught in stats.error and the read still returns', () => withDir((dir) => {
    const f = fake(dir, { A: 'one' })
    fs.writeFileSync(f.cacheDir, 'a file, not a folder')
    const result = f.run(['A'])
    assert.deepEqual(result.issues, [issueOf('A', 'one')])
    assert.equal(result.stats.written, false)
    assert.ok(result.stats.error instanceof Error)
    assert.equal(fs.readFileSync(f.cacheDir, 'utf8'), 'a file, not a folder')
  }))

  test('clearIndex removes index.json and leftover temp files and keeps .gitignore', () => withDir((dir) => {
    const f = fake(dir, { A: 'one' })
    clearIndex(f.cacheDir)
    f.run(['A'])
    fs.writeFileSync(`${f.indexFile}.tmp-999-0`, 'partial')
    clearIndex(f.cacheDir)
    assert.deepEqual(fs.readdirSync(f.cacheDir), ['.gitignore'])
  }))

  test('writeFileAtomic removes its temp file when the rename fails', () => withDir((dir) => {
    const target = path.join(dir, 'target')
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, 'inside'), 'x')
    assert.throws(() => writeFileAtomic(target, 'text'))
    assert.deepEqual(fs.readdirSync(dir), ['target'])
  }))
})
