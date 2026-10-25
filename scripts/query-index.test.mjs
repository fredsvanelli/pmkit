import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig } from './lib/config.mjs'
import { PmkitError } from './lib/errors.mjs'
import { FORMAT_VERSION } from './lib/local/migrations.mjs'
import {
  INDEX_FILE, RACY_MS, SCHEMA, clearIndex, indexHeader, isRacy, loadIndex, readThroughIndex,
} from './lib/local/query-index.mjs'
import { writeFileAtomic } from './lib/local/store.mjs'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { fixedNow, makeRepo } from './test-helpers.mjs'

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
    // A whole-second mtime survives the Date round trip below exactly, so only ctime can reveal the edit.
    const pinned = new Date(Math.floor(Date.now() / 1000 - 3600) * 1000)
    fs.utimesSync(f.fileOf('B'), pinned, pinned)
    f.run(['A', 'B'])
    settle(f.cacheDir)
    fs.writeFileSync(f.fileOf('A'), 'one, edited')
    let result = f.run(['A', 'B'])
    assert.deepEqual(result.issues[0], issueOf('A', 'one, edited'))
    assert.deepEqual(counts(result.stats), { parsed: 1, reused: 1, written: true })
    settle(f.cacheDir)
    while (fs.statSync(f.fileOf('B')).ctimeMs > Date.now() - 25);
    fs.writeFileSync(f.fileOf('B'), 'TWO')
    fs.utimesSync(f.fileOf('B'), pinned, pinned)
    assert.equal(fs.statSync(f.fileOf('B')).mtimeMs, pinned.getTime())
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

const indexFileOf = (root) => path.join(root, '.issues', '.cache', 'index.json')
const cacheOf = (root) => path.join(root, '.issues', '.cache')
const settleRepo = (root) => settle(cacheOf(root))
const trackerFor = (root, options = {}) => createLocalTracker(root, { now: fixedNow(), gitEmail: 'ana@example.com', env: {}, ...options })
const canChmod = process.platform !== 'win32' && process.getuid?.() !== 0

function withRepo(name, fn) {
  const root = makeRepo(name)
  try {
    return fn(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

describe('tracker with the index', () => {
  test('searchIssues builds the index, reuses it, and reparses only the edited issue', () => withRepo('team', (root) => {
    const stats = []
    const tracker = trackerFor(root, { onIndexRead: (s) => stats.push(s) })
    tracker.searchIssues({})
    assert.deepEqual(counts(stats[0]), { parsed: 13, reused: 0, written: true })
    assert.equal(fs.readFileSync(path.join(cacheOf(root), '.gitignore'), 'utf8'), '*\n')
    settleRepo(root)
    tracker.searchIssues({})
    assert.deepEqual(counts(stats[1]), { parsed: 0, reused: 13, written: false })
    const file = path.join(root, '.issues', 'issues', 'ISS-7K3Q', 'issue.md')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^title: .*$/m, 'title: Edited by hand'))
    const found = tracker.searchIssues({ archived: true }).issues.find((issue) => issue.id === 'ISS-7K3Q')
    assert.equal(found.title, 'Edited by hand')
    assert.deepEqual(counts(stats[2]), { parsed: 1, reused: 12, written: true })
  }))

  test('racy entries are reparsed until the index settles', () => withRepo('team', (root) => {
    const stats = []
    const tracker = trackerFor(root, { onIndexRead: (s) => stats.push(s) })
    tracker.searchIssues({})
    const { ctimeMs } = fs.statSync(path.join(root, '.issues', 'issues', 'ISS-7K3Q', 'issue.md'))
    const near = new Date(ctimeMs + 1000)
    fs.utimesSync(indexFileOf(root), near, near)
    tracker.searchIssues({})
    assert.ok(stats[1].parsed >= 1)
    assert.equal(stats[1].written, true)
    settleRepo(root)
    tracker.searchIssues({})
    assert.equal(stats[2].parsed, 0)
  }))

  test('index: false never creates .cache, index: read never writes, and a bad value throws', () => withRepo('team', (root) => {
    trackerFor(root, { index: false }).searchIssues({})
    trackerFor(root, { index: 'read' }).searchIssues({})
    assert.equal(fs.existsSync(cacheOf(root)), false)
    trackerFor(root).searchIssues({})
    settleRepo(root)
    const bytes = fs.readFileSync(indexFileOf(root))
    const file = path.join(root, '.issues', 'issues', 'ISS-7K3Q', 'issue.md')
    fs.appendFileSync(file, '\nMore text.\n')
    trackerFor(root, { index: 'read' }).searchIssues({})
    assert.deepEqual(fs.readFileSync(indexFileOf(root)), bytes)
    assert.throws(() => trackerFor(root, { index: 'yes' }), (error) => error.code === 'INVALID_INPUT')
  }))

  test('a .cache that is a file falls back silently to the scan result', () => withRepo('team', (root) => {
    fs.writeFileSync(cacheOf(root), 'not a folder')
    const plain = trackerFor(root, { index: false }).searchIssues({ archived: true })
    assert.deepEqual(trackerFor(root).searchIssues({ archived: true }), plain)
    assert.equal(fs.readFileSync(cacheOf(root), 'utf8'), 'not a folder')
  }))

  test('a read-only tracker folder falls back silently to the scan result', { skip: !canChmod }, () => withRepo('team', (root) => {
    const dir = path.join(root, '.issues')
    fs.chmodSync(dir, 0o555)
    try {
      const plain = trackerFor(root, { index: false }).searchIssues({ archived: true })
      assert.deepEqual(trackerFor(root).searchIssues({ archived: true }), plain)
      assert.equal(fs.existsSync(cacheOf(root)), false)
    } finally {
      fs.chmodSync(dir, 0o755)
    }
  }))

  test('a tracker on an older format reads without an index', () => withRepo('team', (root) => {
    const noop = { from: 2, to: 3, describe: 'nothing', run() {} }
    const config = loadConfig(root, { formatVersion: 3, migrations: [noop] })
    assert.ok(config.readDir)
    const tracker = trackerFor(root, { config })
    assert.equal(tracker.searchIssues({}).issues.length, 11)
    assert.equal(fs.existsSync(cacheOf(root)), false)
    assert.equal(fs.existsSync(path.join(config.readDir, '.cache')), false)
  }))

  test('library dry runs never create or change the index', () => withRepo('team', (root) => {
    const dry = () => {
      const tracker = trackerFor(root)
      tracker.link('ISS-0G5E', 'ISS-1V9Z', 'blocks', 'fred', { dryRun: true })
      tracker.closeCycle('2026-10-12', 'fred', { dryRun: true })
    }
    dry()
    assert.equal(fs.existsSync(cacheOf(root)), false)
    trackerFor(root).searchIssues({})
    const bytes = fs.readFileSync(indexFileOf(root))
    dry()
    assert.deepEqual(fs.readFileSync(indexFileOf(root)), bytes)
  }))
})

// Covers every key of FILTER_KEYS, each sort, and both special values. A filter a fixture rejects must be rejected the same way.
const FILTERS = [
  {}, { archived: true }, { text: 'webhook' }, { text: 'no such words' },
  { categories: ['todo', 'in_progress'] }, { types: ['bug'] },
  { assignee: 'me' }, { assignee: 'none' }, { assignee: 'ana' },
  { labels: ['backend'] }, { sprint: 'current' }, { sprint: 'none' }, { sprint: '2026-09-28' },
  { parent: 'EPC-2M9D' }, { blocked: true }, { blocked: false },
  { updatedBefore: '2026-10-10' }, { updatedAfter: '2026-10-01' },
  { sort: 'priority' }, { sort: 'updated' }, { sort: 'created' }, { sort: 'due' },
  { limit: 0 }, { limit: 3 },
  { sort: 'priority', limit: 2, labels: ['backend'], archived: true },
]

const outcome = (fn) => {
  try {
    return { value: fn() }
  } catch (error) {
    return { error: error.code ?? error.message }
  }
}
// File timestamps come from a coarse kernel clock, so wait for the next tick before an edit that must change ctime.
const tick = () => { for (const end = Date.now() + 25; Date.now() < end;); }
const edit = (file, change) => fs.writeFileSync(file, change(fs.readFileSync(file, 'utf8')))

/**
 * Compares every filter, and getIssue on every folder, with and without the index. `warm` settles the index
 * before each indexed call, so the signature check decides; otherwise the cache is removed first (cold).
 */
function assertSame(root, label, { warm, unsigned = 0 }) {
  const plain = trackerFor(root, { index: false })
  const stats = []
  const indexed = trackerFor(root, { onIndexRead: (s) => stats.push(s) })
  const prepare = () => (warm ? settleRepo(root) : fs.rmSync(cacheOf(root), { recursive: true, force: true }))
  for (const filter of FILTERS) {
    prepare()
    assert.deepEqual(outcome(() => indexed.searchIssues(filter)), outcome(() => plain.searchIssues(filter)), `${label}: ${JSON.stringify(filter)}`)
  }
  const folders = fs.readdirSync(path.join(root, '.issues', 'issues')).filter((name) => !name.startsWith('.'))
  for (const id of folders) {
    prepare()
    assert.deepEqual(outcome(() => indexed.getIssue(id)), outcome(() => plain.getIssue(id)), `${label}: getIssue ${id}`)
  }
  if (warm) {
    // `unsigned` counts folders without an issue file: they have no signature, so every read looks at them again.
    assert.equal(stats.at(-1).parsed, unsigned, `${label}: the last read reparsed files`)
    assert.ok(stats.at(-1).reused > 0, `${label}: the last read reused nothing`)
  }
  return stats
}

// Every value an index entry could serve stale, so a discarded index that is used anyway shows up.
function poisoned(text, only) {
  const data = JSON.parse(text)
  for (const [id, entry] of Object.entries(data.issues)) {
    if (entry.issue && (only === undefined || id === only)) entry.issue.title = 'Stale title from the index'
  }
  return data
}

function runStates(root, label) {
  const issuesDir = path.join(root, '.issues', 'issues')
  const fileOf = (id) => path.join(issuesDir, id, 'issue.md')
  const readable = () => trackerFor(root, { index: false }).searchIssues({ archived: true }).issues.map((issue) => issue.id)

  assertSame(root, `${label} cold`, { warm: false })
  assertSame(root, `${label} warm`, { warm: true })

  const [a] = readable()
  // A whole-second mtime survives the restore below exactly, so only ctime can reveal the same-size edit.
  const pinned = new Date(Math.floor(Date.now() / 1000 - 3600) * 1000)
  edit(fileOf(a), (text) => text.replace(/^title: .*$/m, 'title: Edited by hand'))
  assertSame(root, `${label} title edit`, { warm: true })

  fs.utimesSync(fileOf(a), pinned, pinned)
  assertSame(root, `${label} pinned mtime`, { warm: true })
  tick()
  edit(fileOf(a), (text) => text.replace('title: Edited by hand', 'title: edited by hand'))
  fs.utimesSync(fileOf(a), pinned, pinned)
  assert.equal(fs.statSync(fileOf(a)).mtimeMs, pinned.getTime(), `${label}: the mtime was not restored exactly`)
  assert.equal(assertSame(root, `${label} same-size edit`, { warm: true })[0].parsed, 1)

  const [m] = readable().filter((id) => id !== a)
  const kept = fs.readFileSync(fileOf(m))
  fs.rmSync(fileOf(m))
  assertSame(root, `${label} folder without issue.md`, { warm: true, unsigned: 1 })
  const withoutFile = trackerFor(root)
  withoutFile.searchIssues({})
  assert.ok(!(m in JSON.parse(fs.readFileSync(indexFileOf(root), 'utf8')).issues), `${label}: the folder without issue.md has an index entry`)
  assert.deepEqual(outcome(() => withoutFile.getIssue(m)), outcome(() => trackerFor(root, { index: false }).getIssue(m)))
  assert.equal(outcome(() => withoutFile.getIssue(m)).error, 'NOT_FOUND')
  fs.writeFileSync(fileOf(m), kept)
  assertSame(root, `${label} issue.md back`, { warm: true })

  fs.rmSync(path.join(issuesDir, a), { recursive: true })
  assertSame(root, `${label} deleted folder`, { warm: true })

  fs.mkdirSync(path.join(issuesDir, 'ISS-9W9W'))
  fs.writeFileSync(fileOf('ISS-9W9W'), '---\nid: ISS-9W9W\ntitle: Added by hand\nstatus: todo\ncreated: 2026-10-20T10:00:00Z\nupdated: 2026-10-20T10:00:00Z\n---\n\n## Description\n\nWritten without the CLI, about a webhook.\n')
  assertSame(root, `${label} added by hand`, { warm: true })

  const [b] = readable()
  edit(fileOf(b), (text) => `${text}\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n`)
  assertSame(root, `${label} conflict markers`, { warm: true })

  // A slower process renames an older index over a newer one: last writer wins, and it costs a reparse.
  const older = fs.readFileSync(indexFileOf(root))
  const [c] = readable()
  edit(fileOf(c), (text) => text.replace(/^title: .*$/m, 'title: Newer than the index'))
  trackerFor(root).searchIssues({})
  fs.writeFileSync(indexFileOf(root), older)
  assertSame(root, `${label} older index overwrites a newer one`, { warm: true })

  edit(path.join(root, '.issues', 'config.yaml'), (text) => text.replace('todo: { category: todo }', 'todo: { category: in_progress }'))
  assertSame(root, `${label} status moved to another category`, { warm: true })

  const corruptions = [
    ['truncated', (text) => text.slice(0, Math.floor(text.length / 2))],
    ['invalid JSON', () => '{nope'],
    ['another parser', (text) => JSON.stringify({ ...poisoned(text), parser: 'other' })],
    ['another format', (text) => JSON.stringify({ ...poisoned(text), format: FORMAT_VERSION - 1 })],
    ['an entry without sig', (text) => {
      const [first] = readable()
      const data = poisoned(text, first)
      delete data.issues[first].sig
      return JSON.stringify(data)
    }],
  ]
  for (const [name, corrupt] of corruptions) {
    trackerFor(root).searchIssues({})
    edit(indexFileOf(root), corrupt)
    assertSame(root, `${label} index ${name}`, { warm: true })
  }
}

describe('the index and the plain scan give the same results', () => {
  test('team fixture', () => withRepo('team', (root) => runStates(root, 'team')))
  test('broken fixture', () => withRepo('broken', (root) => runStates(root, 'broken')))
  test('basic fixture with issues created by the CLI library', () => withRepo('basic', (root) => {
    let n = 0
    const writer = createLocalTracker(root, { now: fixedNow(), random: (size) => n++ % size, index: false })
    const [x, y, z] = ['Webhook retries', 'Billing export', 'Docs page'].map((title) => writer.createIssue({ title }, 'fred').after.id)
    writer.link(x, y, 'blocks', 'fred')
    writer.setParent(z, x, 'fred')
    runStates(root, 'basic')
  }))
})
