# PMK-7 Query Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Searches of the Local tracker read a query index in `.issues/.cache/index.json` and reparse only the issue files whose stat signature changed, with results identical to the plain scan, and `/pmkit:local:doctor` rebuilds the index through a new `reindex` CLI command.

**Architecture:** A new module, `scripts/lib/local/query-index.mjs`, loads, checks, saves and rebuilds the index. It does not parse issues: the tracker hands it the folder list, the path to sign and the plain read of one issue, and the module checks only the shape of a cached issue. `readAll()` in `tracker.mjs` goes through it, and falls back to the old scan on any error. The CLI builds the tracker with `index: 'read'` on a dry run and gets a `reindex` command.

**Tech Stack:** Node.js ESM (`.mjs`), `node:fs`, `node:crypto`, `node:test`. No dependencies (ADR-0003).

**Spec:** `docs/superpowers/specs/2026-10-25-pmk-7-query-index-design.md`. Read it before any task. This plan settles the points the spec leaves to the builder (see "Decisions this plan makes").

## Global Constraints

- Index file: `<tracker>/.cache/index.json`, where `<tracker>` is `tracker.path` from `.pmkit/config.yaml` (default `.issues`). Constants `CACHE_DIR = '.cache'` and `INDEX_FILE = 'index.json'` in `query-index.mjs`.
- `<tracker>/.cache/.gitignore` holds exactly `*\n`. The index code writes it before `index.json` whenever it is missing. Nothing edits `<tracker>/.gitignore`, `init` or `templates/issues.gitignore`.
- `index.json` is `JSON.stringify` output (no indentation) of `{ schema: 1, format: FORMAT_VERSION, parser, options, issues }`:
  - `schema`: `SCHEMA = 1`.
  - `format`: `FORMAT_VERSION` from `scripts/lib/local/migrations.mjs` (2 today).
  - `parser`: SHA-1 hex of the bytes of `scripts/lib/local/issue-file.mjs` followed by `scripts/lib/yaml.mjs`, read once per process through `import.meta.url`.
  - `options`: SHA-1 hex of `JSON.stringify(local.statuses)`.
  - `issues`: keyed by folder name, in `listIssueIds` order. Each value is `{ sig, issue }` or `{ sig, problem: { code, message } }`, with `sig = { size, mtimeMs, ctimeMs, ino }` from one `fs.statSync` of `issuePaths(issuesDir, normalizeId(id)).file`, taken before the read.
- A header that differs in any of `schema`, `format`, `parser` or `options` counts as an empty index.
- Racy rule: `RACY_MS = 2000`. An entry is racy when `max(sig.mtimeMs, sig.ctimeMs) >= indexMtimeMs - RACY_MS`, where `indexMtimeMs` comes from `fstat` of the open `index.json`. A racy entry is reparsed and the index is rewritten.
- Library option: `createLocalTracker(root, { index = true, onIndexRead = () => {} })`. `index` is `true` (read and write), `'read'` (use, never create or write) or `false` (never touch `.cache/`). Any other value throws `INVALID_INPUT`. `onIndexRead(stats)` receives `{ parsed, reused, written, error }` after each indexed read. No environment variable.
- Fallback rules, all silent on reads (no warning, no non-zero exit):
  - `index.json` missing, unreadable, invalid JSON, wrong header or wrong shape: empty index.
  - One entry with a bad `sig` or a bad `issue`/`problem`: that entry is reparsed.
  - Write failure (read-only disk, no permission, full disk, `.cache` is a file): reported in `stats.error`, the read returns its result.
  - Any error thrown by the index path: `readAll()` runs the plain scan and returns that.
  - `config.readDir` set (older tracker format): index off for that tracker instance.
  - Dry run: the CLI builds the tracker with `index: 'read'`; `relate` and `closeCycle` pass `save: !dryRun` to `readAll()`.
- `reindex` CLI command: one word, no positional arguments, no flags beyond `--json` and `--root`, not `write: true` (no `--as`, no `--dry-run`, no auto-commit, no event).
  - Success data: `{ written: true, path: '.issues/.cache/index.json', issues: <count>, problems: <count> }`. Text: `indexed <n> issues (<m> could not be read) in .issues/.cache/index.json`.
  - Failure data: `{ written: false, reason: '<message>' }`, exit 0. Text: `the query index was not written: <reason>`, plus the warning `searches still work, they read every issue file`.
- Unchanged: `FORMAT_VERSION`, the capability manifest, the tracker contract (`scripts/lib/contract.mjs`), `validate` (never reads or writes the index), `hashTree` in `scripts/test-helpers.mjs`. CLI writes never read or write the index.
- Tests: `node:test` with `node:assert/strict`. Run one file with `node --test scripts/<file>.test.mjs`, everything with `npm test`. Every test that creates a temp folder removes it in `finally` (follow-up PMK-111 tracks existing leaks; do not add new ones). A test that changes permissions restores them in `finally` before removing the folder. Tests that need `chmod` skip when `process.getuid?.() === 0` or `process.platform === 'win32'`.
- Code, comments, commits in English. Do not edit `.issues/` of this repository by hand, do not switch branches, do not push.
- Every commit message carries `(PMK-7)` and ends with the trailer `Co-Authored-By: Claude <model> <noreply@anthropic.com>`, where `<model>` names the model that made the commit (for example `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`). The commit commands below write `<model>`; replace it.

## Decisions this plan makes

The spec leaves these to the builder. They hold for every task.

- The tracker does not keep the index in memory between `readAll()` calls. Each call parses `index.json` once. One code path, no aliasing between returned objects and a cached map.
- Parse and reuse counts reach tests through the `onIndexRead` option, fed by the `stats` object `readThroughIndex` returns.
- `reindex` is a method on the Local tracker object (`tracker.reindex()`), outside the contract. It refuses with `written: false` when `index !== true` or when the tracker reads an older format.
- `writeFileAtomic` in `store.mjs` removes its temp file when the write or the rename fails. Reads now write, so a full disk would otherwise leave one temp file per search.
- `loadIndex` opens `index.json` once and takes the mtime with `fstat` on that descriptor, so the mtime always belongs to the text it reads.
- A cached `issue` must have `id` (string), `status` (object) and the arrays `labels`, `blockedBy`, `related`, `duplicateOf`, `acceptanceCriteria`. Without them `withComputed` and `runQuery` would throw outside the fallback.
- Doctor step 1 with no problems goes to step 6 (the rebuild), not to "Output", so the doctor rebuilds the index on a healthy tracker too.
- The changelog entry goes under `## Unreleased`. `parseChangelog` skips that heading, and `scripts/changelog.test.mjs` pins the parsed releases to `0.1.0` and `0.2.0`, so a `0.3.0` heading would break it and claim a release that `plugin.json` does not have.

## Review Focus

The reviewer checks these cases against the code and the named tests.

- **Coarse mtime (racy entry).** A same-size edit inside one timestamp step keeps `size`, `mtimeMs` and `ino`. The entry must be reparsed while its `mtimeMs` or `ctimeMs` is within 2000 ms of the index mtime, and the index rewritten until it settles. Pinned by `isRacy` boundary values (Task 1) and "racy entries are reparsed until the index settles" (Task 2).
- **Deleted file or folder.** A folder removed by hand drops its entry and rewrites the index. A folder whose `issue.md` is missing yields the same `NOT_FOUND` problem as the scan and gets no entry. Pinned in Task 1 and the "deleted folder" state of Task 3.
- **New issue.** A folder added by hand (or by `git pull`) with no entry is parsed and added. Pinned by the "added by hand" state of Task 3.
- **Corrupt or foreign index.** Truncated, invalid JSON, another `parser`, `format` or `options`, an entry without `sig`: results equal the scan, and poisoned entries in a discarded index never surface. Pinned in Task 1 (`loadIndex`) and the corruption states of Task 3.
- **Two processes.** No lock. A slower process that renames an older index over a newer one only costs a reparse, because every entry pairs content with the signature taken before the read. Pinned by the "older index overwrites a newer one" state of Task 3. Also check that temp names stay `index.json.tmp-<pid>-<n>`.
- **Dry run.** No `--dry-run` command and no library call with `dryRun: true` creates `.cache/` or changes `index.json` by one byte. Pinned in Task 2 (library) and Task 4 (CLI, `pr open --dry-run`).
- **Older tracker format.** With `config.readDir` set, no `.cache/` appears in the real tracker folder or in the temp copy, and `reindex` returns `written: false`. `planMigration` never copies `.cache`. Pinned in Task 2 and Task 4.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `scripts/lib/local/query-index.mjs` | Create | Header, signature, racy rule, load, save, clear, read through the index. No issue knowledge. |
| `scripts/lib/local/store.mjs` | Modify `writeFileAtomic` | Remove the temp file when the write fails. |
| `scripts/lib/local/tracker.mjs` | Modify | `index` and `onIndexRead` options, `readAll({ save })` with fallback, `save` in `relate` and `closeCycle`, `reindex()`. |
| `scripts/lib/local/migrations.mjs` | Modify `planMigration` | Skip `.cache` when copying the tracker folder. |
| `scripts/pmkit.mjs` | Modify | `index: 'read'` on dry runs, `reindex` command. |
| `scripts/query-index.test.mjs` | Create | Module tests, tracker tests, equivalence suite. |
| `scripts/contract.test.mjs`, `scripts/migrations.test.mjs`, `scripts/cli.test.mjs`, `scripts/cli-pr.test.mjs` | Modify | Contract with `index: false`, migration copy, CLI behavior. |
| `commands/local/doctor.md`, `README.md`, `CHANGELOG.md`, `CONTEXT.md`, `docs/adr/0001-local-tracker-is-the-reference-implementation.md` | Modify | Docs. |

---

### Task 1: The query index module

Complexity: hard
Covers: "`issues list` reads the index and rebuilds the entries whose files changed" (change detection and the rebuild of changed entries), "Results are the same with and without the index" (stat before read, racy rule, header discards, write failures never fail a read).

**Files:**
- Create: `scripts/lib/local/query-index.mjs`
- Modify: `scripts/lib/local/store.mjs` (`writeFileAtomic`)
- Test: `scripts/query-index.test.mjs` (create)

**Interfaces:**
- Consumes: `FORMAT_VERSION` from `./migrations.mjs`, `writeFileAtomic` from `./store.mjs`, `PmkitError` from `../errors.mjs`.
- Produces (all exported from `scripts/lib/local/query-index.mjs`):
  - `SCHEMA = 1`, `RACY_MS = 2000`, `CACHE_DIR = '.cache'`, `INDEX_FILE = 'index.json'`
  - `indexHeader(statuses: object) -> { schema, format, parser, options }`
  - `signature(file: string) -> { size, mtimeMs, ctimeMs, ino }` (throws when the file is missing)
  - `isRacy(sig, indexMtimeMs: number) -> boolean`
  - `loadIndex(file: string, header) -> { entries: Map<string, entry>, mtimeMs: number } | null`
  - `saveIndex(cacheDir: string, header, entries: Map) -> void` (throws on failure)
  - `clearIndex(cacheDir: string) -> void` (throws when `cacheDir` is not a folder)
  - `readThroughIndex({ cacheDir, header, ids, fileOf, read, write }) -> { issues, problems, stats: { parsed, reused, written, error } }`. `read(id)` returns the parsed value or throws. A `PmkitError` becomes `{ id, code, message }` in `problems`; any other error propagates. `write: false` never creates `.cache/`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/query-index.test.mjs` with these tests. A fake reader stands in for the tracker so the module is tested alone.

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/query-index.test.mjs`
Expected: FAIL with `Cannot find module` for `./lib/local/query-index.mjs`.

- [ ] **Step 3: Make `writeFileAtomic` clean up after itself**

In `scripts/lib/local/store.mjs`, keep the temp name `${file}.tmp-${process.pid}-${counter++}` and wrap the write and the rename:

```js
export function writeFileAtomic(file, text) {
  const temp = `${file}.tmp-${process.pid}-${counter++}`
  try {
    fs.writeFileSync(temp, text)
    fs.renameSync(temp, file)
  } catch (error) {
    // A full disk or a failed rename must not leave a temp file behind.
    fs.rmSync(temp, { force: true })
    throw error
  }
}
```

- [ ] **Step 4: Create `scripts/lib/local/query-index.mjs`**

This module holds the change detection, the racy rule and the atomic save. Transcribe it as written; the order of `signature` before `read`, and `fstat` on the descriptor that is read, are the point.

```js
// The query index of the Local tracker: <tracker>/.cache/index.json keeps each issue file parsed, next to
// the stat signature it was read with. A read reuses an entry only while its signature matches and the
// entry is not racy. See docs/superpowers/specs/2026-10-25-pmk-7-query-index-design.md.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PmkitError } from '../errors.mjs'
import { FORMAT_VERSION } from './migrations.mjs'
import { writeFileAtomic } from './store.mjs'

export const SCHEMA = 1
export const RACY_MS = 2000
export const CACHE_DIR = '.cache'
export const INDEX_FILE = 'index.json'

const SIG_KEYS = ['size', 'mtimeMs', 'ctimeMs', 'ino']
const ISSUE_LISTS = ['labels', 'blockedBy', 'related', 'duplicateOf', 'acceptanceCriteria']
const PARSER_FILES = ['./issue-file.mjs', '../yaml.mjs']

const sha1 = (...parts) => {
  const hash = crypto.createHash('sha1')
  for (const part of parts) hash.update(part)
  return hash.digest('hex')
}

let parserHash = null
// A pmkit upgrade, or an edit to the parser when pmkit runs from source, discards the index.
const parserVersion = () => (parserHash ??= sha1(...PARSER_FILES.map((rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url))))))

/** The four values an index must match to be used. `statuses` is `local.statuses`, which `parseIssueFile` reads. */
export const indexHeader = (statuses) => ({
  schema: SCHEMA, format: FORMAT_VERSION, parser: parserVersion(), options: sha1(JSON.stringify(statuses)),
})

/** The stat signature of a file. Throws when the file is missing. */
export function signature(file) {
  const stat = fs.statSync(file)
  return { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino }
}

const sameSig = (a, b) => SIG_KEYS.every((key) => a[key] === b[key])

/** True when the entry was signed too close to the index write to trust a coarse timestamp ("racy git"). */
export const isRacy = (sig, indexMtimeMs) => Math.max(sig.mtimeMs, sig.ctimeMs) >= indexMtimeMs - RACY_MS

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const validIssue = (issue) => isMap(issue) && typeof issue.id === 'string' && isMap(issue.status)
  && ISSUE_LISTS.every((key) => Array.isArray(issue[key]))
const validProblem = (problem) => isMap(problem) && typeof problem.code === 'string' && typeof problem.message === 'string'
const validEntry = (entry) => isMap(entry) && isMap(entry.sig)
  && SIG_KEYS.every((key) => Number.isFinite(entry.sig[key]))
  && (entry.problem === undefined ? validIssue(entry.issue) : entry.issue === undefined && validProblem(entry.problem))

/** The valid entries and the mtime of the index, or null when it is missing, does not parse, has another header or another shape. */
export function loadIndex(file, header) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    // The mtime comes from the descriptor that is read, so it belongs to this text even if another process renames a new index in.
    const { mtimeMs } = fs.fstatSync(fd)
    const data = JSON.parse(fs.readFileSync(fd, 'utf8'))
    if (!isMap(data) || !isMap(data.issues)) return null
    if (Object.keys(header).some((key) => data[key] !== header[key])) return null
    return { entries: new Map(Object.entries(data.issues).filter(([, entry]) => validEntry(entry))), mtimeMs }
  } catch {
    return null
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/** Writes `.gitignore` first, so git never sees index.json, then the index through a temp file and a rename. */
export function saveIndex(cacheDir, header, entries) {
  fs.mkdirSync(cacheDir, { recursive: true })
  const ignore = path.join(cacheDir, '.gitignore')
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n')
  writeFileAtomic(path.join(cacheDir, INDEX_FILE), JSON.stringify({ ...header, issues: Object.fromEntries(entries) }))
}

/** Removes index.json and the temp files a killed write left behind. A missing folder is fine. */
export function clearIndex(cacheDir) {
  if (!fs.existsSync(cacheDir)) return
  for (const name of fs.readdirSync(cacheDir)) {
    if (name === INDEX_FILE || name.startsWith(`${INDEX_FILE}.tmp-`)) fs.rmSync(path.join(cacheDir, name), { force: true })
  }
}

function attempt(id, read) {
  try {
    return { issue: read(id) }
  } catch (error) {
    if (!(error instanceof PmkitError)) throw error
    return { problem: { code: error.code, message: error.message } }
  }
}

/**
 * Reads every folder in `ids` through the index. `fileOf(id)` is the file to sign and `read(id)` the plain
 * read, which returns the parsed value or throws. Returns the values and problems in `ids` order. With
 * `write`, a changed index is saved; a failed save lands in `stats.error` and the read still returns.
 */
export function readThroughIndex({ cacheDir, header, ids, fileOf, read, write }) {
  const loaded = loadIndex(path.join(cacheDir, INDEX_FILE), header)
  const old = loaded?.entries ?? new Map()
  const next = new Map()
  const issues = []
  const problems = []
  const stats = { parsed: 0, reused: 0, written: false, error: null }
  let changed = loaded === null
  for (const id of ids) {
    let sig = null
    try {
      // Signed before the read: a change between the two leaves the old signature, so the next read reparses.
      sig = signature(fileOf(id))
    } catch {
      sig = null
    }
    const entry = sig === null ? undefined : old.get(id)
    let result
    if (entry && sameSig(entry.sig, sig) && !isRacy(entry.sig, loaded.mtimeMs)) {
      result = entry
      stats.reused++
    } else {
      result = attempt(id, read)
      stats.parsed++
      if (sig !== null) changed = true
    }
    // A folder without its file has nothing to sign and gets no entry.
    if (sig !== null) next.set(id, result.issue === undefined ? { sig, problem: result.problem } : { sig, issue: result.issue })
    if (result.issue === undefined) problems.push({ id, code: result.problem.code, message: result.problem.message })
    else issues.push(result.issue)
  }
  if (!changed) changed = [...old.keys()].some((id) => !next.has(id))
  if (changed && write) {
    try {
      saveIndex(cacheDir, header, next)
      stats.written = true
    } catch (error) {
      stats.error = error
    }
  }
  return { issues, problems, stats }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test scripts/query-index.test.mjs`
Expected: PASS, 13 tests.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS. Nothing calls the module yet; the `writeFileAtomic` change must not break any existing test.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/local/query-index.mjs scripts/lib/local/store.mjs scripts/query-index.test.mjs
git commit -m "feat: add the query index module (PMK-7)" -m "Co-Authored-By: Claude <model> <noreply@anthropic.com>"
```

---

### Task 2: The tracker reads through the index

Complexity: hard
Covers: "`issues list` reads the index and rebuilds the entries whose files changed" (every caller of `readAll()`, `searchIssues` included, uses the index), "Results are the same with and without the index" (fallback, older format, dry runs, contract suite with `index: false`).

**Files:**
- Modify: `scripts/lib/local/tracker.mjs` (`createLocalTracker` options, `readAll`, `scanIssues`, `searchIssues`, `relate`, `closeCycle`)
- Modify: `scripts/lib/local/migrations.mjs` (`planMigration`)
- Test: `scripts/query-index.test.mjs` (add a `describe('tracker with the index')`), `scripts/contract.test.mjs`, `scripts/migrations.test.mjs`, plus any existing test that `npm test` shows hashing a tree after a non-dry read

**Interfaces:**
- Consumes: from Task 1, `CACHE_DIR`, `INDEX_FILE`, `indexHeader`, `readThroughIndex`.
- Produces:
  - `createLocalTracker(root, { ..., index = true, onIndexRead = () => {} })`. `index` is `true`, `'read'` or `false`; anything else throws `PmkitError('INVALID_INPUT')`.
  - Inside the tracker: `readAll({ save = true } = {}) -> { issues, problems }`, `scanIssues(options) -> issues`, `search(filter, { save = true } = {})`. `searchIssues(filter = {})` keeps its signature and calls `search(filter)`.
  - Inside the tracker, for Task 4: `cacheDir` (`path.join(issuesDir, CACHE_DIR)`) and `indexedRead(write: boolean)`, which returns the `readThroughIndex` result.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/query-index.test.mjs`. Add `createLocalTracker` from `./lib/local/tracker.mjs`, `loadConfig` from `./lib/config.mjs` and `fixedNow`, `makeRepo` from `./test-helpers.mjs` to the imports.

```js
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
```

In `scripts/contract.test.mjs`, give `setupLocal` an options argument and run the suite a third time:

```js
function setupLocal(options = {}) {
  // ... unchanged, except: createLocalTracker(root, { now, random, ...options })
}

runTrackerContract({ name: 'Local tracker contract without the index', setup: () => setupLocal({ index: false }) })
```

In `scripts/migrations.test.mjs`, add:

```js
test('planMigration never copies the query index', () => {
  const { root } = setup()
  try {
    const cache = path.join(root, '.issues', '.cache')
    fs.mkdirSync(cache)
    fs.writeFileSync(path.join(cache, 'index.json'), '{}')
    const plan = planMigration({ root, trackerPath: '.issues', from: 1, to: 2, migrations: [renameLogTime] })
    assert.equal(fs.existsSync(path.join(plan.dir, '.cache')), false)
    assert.ok(plan.steps[0].changes.every((change) => !change.path.includes('.cache')))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/query-index.test.mjs scripts/migrations.test.mjs`
Expected: FAIL. "searchIssues builds the index" fails because `stats` stays empty; "planMigration never copies the query index" fails because `plan.dir/.cache` exists.

- [ ] **Step 3: Wire the index into `createLocalTracker`**

In `scripts/lib/local/tracker.mjs`:

1. Import `CACHE_DIR`, `indexHeader`, `readThroughIndex` from `./query-index.mjs`.
2. Add `index = true, onIndexRead = () => {}` to the options of `createLocalTracker`, and check the value right after `const { local } = config`: `if (![true, 'read', false].includes(index)) throw invalid('index must be true, read or false')`.
3. Rename the current `readAll()` body to `function scan()`, unchanged.
4. Add, after `scan`:

```js
  // The query index (PMK-7). A tracker on an older format reads a migrated temp copy, so the index is off there.
  const cacheDir = path.join(issuesDir, CACHE_DIR)
  const indexMode = config.readDir === undefined ? index : false

  function indexedRead(write) {
    return readThroughIndex({
      cacheDir,
      header: indexHeader(local.statuses),
      ids: listIssueIds(issuesDir, local.id_prefix),
      fileOf: (id) => issuePaths(issuesDir, normalizeId(id)).file,
      read: (id) => readIssue(id).issue,
      write,
    })
  }

  /** Every issue that parses, and a problem for each file that does not (conflict markers, bad frontmatter). `save: false` never writes the index. */
  function readAll({ save = true } = {}) {
    if (indexMode === false) return scan()
    let result
    try {
      result = indexedRead(indexMode === true && save)
    } catch {
      // The index only makes a read faster. Any error in its path leaves the answer to the plain scan.
      return scan()
    }
    onIndexRead(result.stats)
    return { issues: result.issues, problems: result.problems }
  }

  const scanIssues = (options) => readAll(options).issues
```

5. Split `searchIssues`: move its body into `function search(filter, { save = true } = {})`, with `readAll({ save })` in place of `readAll()`, and keep `function searchIssues(filter = {}) { return search(filter) }`.
6. In `relate`, `const all = scanIssues({ save: !dryRun })`.
7. In `closeCycle`, `search({ sprint: before.id }, { save: !dryRun })` in place of `searchIssues({ sprint: before.id })`.

- [ ] **Step 4: Skip `.cache` in `planMigration`**

In `scripts/lib/local/migrations.mjs`, replace the copy with:

```js
  // The query index is a cache: it never enters the migration copy, its snapshots or its list of changes.
  fs.cpSync(source, dir, { recursive: true, filter: (src) => path.relative(source, src).split(path.sep)[0] !== '.cache' })
```

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `node --test scripts/query-index.test.mjs scripts/migrations.test.mjs scripts/contract.test.mjs`
Expected: PASS.

- [ ] **Step 6: Run the whole suite and fix tests that hash after a read**

Run: `npm test`
Expected: tests that call `hashTree` after a non-dry read on the same folder now see `.cache/` and fail. Fix each one in the test, never in `hashTree`. Build that test's tracker with `index: false` when the read is incidental, or take the hash after the read when the read is part of the setup. Leave dry-run assertions as they are: they must keep passing untouched. Rerun until `npm test` passes, and list every test you changed in the commit body.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/local/tracker.mjs scripts/lib/local/migrations.mjs scripts/query-index.test.mjs scripts/contract.test.mjs scripts/migrations.test.mjs
# plus any test file changed in step 6
git commit -m "feat: read Local tracker searches through the query index (PMK-7)" -m "Co-Authored-By: Claude <model> <noreply@anthropic.com>"
```

---

### Task 3: Equivalence suite across fixtures, filters and states

Complexity: standard
Covers: "Results are the same with and without the index".

**Files:**
- Test: `scripts/query-index.test.mjs` (add `describe('the index and the plain scan give the same results')`)
- Modify, only if a state fails: `scripts/lib/local/query-index.mjs` or `scripts/lib/local/tracker.mjs`

**Interfaces:**
- Consumes: `createLocalTracker` options `index` and `onIndexRead` (Task 2), `settle`, `withRepo`, `trackerFor`, `indexFileOf`, `cacheOf` (test helpers from Tasks 1 and 2), `FORMAT_VERSION`.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the suite**

Append to `scripts/query-index.test.mjs`:

```js
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
const edit = (file, change) => fs.writeFileSync(file, change(fs.readFileSync(file, 'utf8')))

/**
 * Compares every filter, and getIssue on every folder, with and without the index. `warm` settles the index
 * before each indexed call, so the signature check decides; otherwise the cache is removed first (cold).
 */
function assertSame(root, label, { warm }) {
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
    assert.equal(stats.at(-1).parsed, 0, `${label}: the last read reparsed files`)
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
  edit(fileOf(a), (text) => text.replace(/^title: .*$/m, 'title: Edited by hand'))
  assertSame(root, `${label} title edit`, { warm: true })

  const { atime, mtime } = fs.statSync(fileOf(a))
  edit(fileOf(a), (text) => text.replace('title: Edited by hand', 'title: edited by hand'))
  fs.utimesSync(fileOf(a), atime, mtime)
  assert.equal(assertSame(root, `${label} same-size edit`, { warm: true })[0].parsed, 1)

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
```

- [ ] **Step 2: Run the suite**

Run: `node --test scripts/query-index.test.mjs`
Expected: PASS. A failing state is a bug in Task 1 or Task 2 code, not in the test. Fix the code with `superpowers:systematic-debugging`, and keep the state.

- [ ] **Step 3: Check that the suite can fail**

Temporarily make `sameSig` in `query-index.mjs` compare only `size`, run `node --test scripts/query-index.test.mjs`, and confirm the "title edit" or "same-size edit" state fails. Revert the change and rerun to PASS. Do not commit the broken version.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/query-index.test.mjs
# plus any fix to query-index.mjs or tracker.mjs from step 2
git commit -m "test: compare searches with and without the query index (PMK-7)" -m "Co-Authored-By: Claude <model> <noreply@anthropic.com>"
```

---

### Task 4: `reindex` command and CLI dry runs

Complexity: standard
Covers: "`/pmkit:local:doctor` rebuilds the index" (the `reindex` command the doctor runs), "`issues list` reads the index and rebuilds the entries whose files changed" (end to end through the CLI, never committed).

**Files:**
- Modify: `scripts/lib/local/tracker.mjs` (add `reindex` to the returned object)
- Modify: `scripts/pmkit.mjs` (`ctx.tracker`, `COMMANDS`)
- Test: `scripts/cli.test.mjs`, `scripts/cli-pr.test.mjs`

**Interfaces:**
- Consumes: `cacheDir`, `indexedRead(write)` inside the tracker (Task 2); `clearIndex`, `INDEX_FILE` from `query-index.mjs` (Task 1).
- Produces: `tracker.reindex() -> { written: true, path, issues, problems } | { written: false, reason }`; CLI command `reindex`.

- [ ] **Step 1: Write the failing tests**

In `scripts/cli.test.mjs` (it already has `run`, `json`, `git`, `makeRepo`):

```js
const canChmod = process.platform !== 'win32' && process.getuid?.() !== 0
const cacheIn = (root) => path.join(root, '.issues', '.cache')

test('reindex --json rebuilds the index and leaves issues list unchanged', () => {
  const root = makeRepo('team')
  try {
    const before = run(root, ['issues', 'list', '--archived', '--json']).stdout
    fs.mkdirSync(cacheIn(root), { recursive: true })
    fs.writeFileSync(path.join(cacheIn(root), 'index.json.tmp-999-0'), 'partial')
    assert.deepEqual(json(root, ['reindex']), { written: true, path: '.issues/.cache/index.json', issues: 12, problems: 1 })
    assert.deepEqual(fs.readdirSync(cacheIn(root)).sort(), ['.gitignore', 'index.json'])
    assert.equal(run(root, ['issues', 'list', '--archived', '--json']).stdout, before)
    const text = run(root, ['reindex'])
    assert.equal(text.status, 0)
    assert.equal(text.stdout, 'indexed 12 issues (1 could not be read) in .issues/.cache/index.json\n')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('reindex on a read-only tracker exits 0 with written: false', { skip: !canChmod }, () => {
  const root = makeRepo('team')
  const dir = path.join(root, '.issues')
  fs.chmodSync(dir, 0o555)
  try {
    const body = json(root, ['reindex'])
    assert.equal(body.written, false)
    assert.equal(typeof body.reason, 'string')
    const text = run(root, ['reindex'])
    assert.equal(text.status, 0)
    assert.match(text.stdout, /^the query index was not written: /)
    assert.match(text.stderr, /^warning: searches still work, they read every issue file$/m)
  } finally {
    fs.chmodSync(dir, 0o755)
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('issues list writes the index and CLI dry runs never touch it', () => {
  const root = makeRepo('team')
  try {
    const dryRuns = () => {
      for (const args of [['issues', 'link', 'ISS-0G5E', 'ISS-1V9Z', '--kind', 'blocks', '--dry-run'], ['cycle', 'close', '2026-10-12', '--dry-run']]) {
        assert.equal(run(root, [...args, '--json']).status, 0, args.join(' '))
      }
    }
    dryRuns()
    assert.equal(fs.existsSync(cacheIn(root)), false)
    json(root, ['issues', 'list'])
    const file = path.join(cacheIn(root), 'index.json')
    const bytes = fs.readFileSync(file)
    dryRuns()
    assert.deepEqual(fs.readFileSync(file), bytes)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the index never reaches git status or an auto-commit', () => {
  const root = makeRepo('team')
  try {
    assert.equal(fs.existsSync(path.join(root, '.issues', '.gitignore')), false)
    git(root, 'init', '-q')
    git(root, 'config', 'user.name', 'Test')
    git(root, 'config', 'user.email', 'test@x.dev')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'fixture')
    json(root, ['issues', 'list'])
    assert.ok(fs.existsSync(path.join(cacheIn(root), 'index.json')))
    assert.equal(git(root, 'status', '--porcelain').stdout, '')
    const config = path.join(root, '.issues', 'config.yaml')
    fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace('auto_commit: false', 'auto_commit: true'))
    git(root, 'commit', '-q', '-am', 'auto commit on')
    json(root, ['issues', 'create', '--title', 'Indexed'])
    assert.doesNotMatch(git(root, 'show', '--name-only', '--format=', 'HEAD').stdout, /\.cache/)
    assert.equal(git(root, 'ls-files', '.issues/.cache').stdout, '')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
```

In `scripts/cli-pr.test.mjs`, change the test "pr open --dry-run returns the title, body and branches without pushing or opening": right after the `pr open ... --dry-run` call, add `assert.equal(fs.existsSync(path.join(root, '.issues', '.cache')), false)` and `assert.equal(hashTree(root), before)`, and move the `issues get` call below them. `issues get` is a read, so it now writes the index, and the old order would compare a tree that the read changed.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/cli.test.mjs scripts/cli-pr.test.mjs`
Expected: FAIL. `reindex` gives `unknown command "reindex"`, and the dry-run test finds a `.cache/` that the dry runs created.

- [ ] **Step 3: Add `reindex` to the tracker**

In `scripts/lib/local/tracker.mjs`, import `clearIndex` and `INDEX_FILE`, add this function and put `reindex` in the returned object:

```js
  /** Rebuilds the query index from every issue file. Not a write: no actor, no dry run, no event, and only ignored files change. */
  function reindex() {
    if (config.readDir !== undefined) {
      return { written: false, reason: `this repository uses tracker format ${config.format.version}; run /pmkit:upgrade before the index can be written` }
    }
    if (index !== true) return { written: false, reason: 'the query index is off for this tracker' }
    try {
      clearIndex(cacheDir)
      const { issues, problems, stats } = indexedRead(true)
      if (stats.error) throw stats.error
      const rel = path.relative(root, path.join(cacheDir, INDEX_FILE)).split(path.sep).join('/')
      return { written: true, path: rel, issues: issues.length, problems: problems.length }
    } catch (error) {
      return { written: false, reason: error.message }
    }
  }
```

- [ ] **Step 4: Update the CLI**

In `scripts/pmkit.mjs`:

1. In `run()`, build the tracker with the index mode: `createLocalTracker(root, { config: ctx.config(), now, random, env, index: dryRun ? 'read' : true })`.
2. Add this entry to `COMMANDS`, between `migrate` and `validate`:

```js
  {
    name: 'reindex', summary: 'rebuilds the query index in .issues/.cache/ from the issue files; changes only files git ignores', flags: [],
    run: (ctx) => {
      const result = ctx.tracker().reindex()
      if (!result.written) {
        return { data: result, text: `the query index was not written: ${result.reason}`, warnings: ['searches still work, they read every issue file'] }
      }
      return { data: result, text: `indexed ${result.issues} issues (${result.problems} could not be read) in ${result.path}` }
    },
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test scripts/cli.test.mjs scripts/cli-pr.test.mjs`
Expected: PASS.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/local/tracker.mjs scripts/pmkit.mjs scripts/cli.test.mjs scripts/cli-pr.test.mjs
git commit -m "feat: add the reindex command and keep CLI dry runs off the index (PMK-7)" -m "Co-Authored-By: Claude <model> <noreply@anthropic.com>"
```

---

### Task 5: Doctor step and docs

Complexity: mechanical
Covers: "`/pmkit:local:doctor` rebuilds the index".

**Files:**
- Modify: `commands/local/doctor.md`, `README.md`, `CHANGELOG.md`, `CONTEXT.md`, `docs/adr/0001-local-tracker-is-the-reference-implementation.md`

**Interfaces:**
- Consumes: the `reindex` command and its JSON output (Task 4).
- Produces: nothing.

- [ ] **Step 1: Update `commands/local/doctor.md`**

- Step 1: replace "When there are none, go to \"Output\"." with "When there are none, go to step 6."
- Step 5: delete the bullet that starts with "Cache:".
- Insert a new step 6 before the current step 6, and renumber the current step 6 to step 7. The "go to step 6" jumps in step 3 stay as they are and now land on the rebuild.

```markdown
6. Rebuild the query index. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" reindex --json`. With `written: true`, report how many issues it indexed (`issues`) and how many files it could not read (`problems`). With `written: false`, report the `reason` and say that searches still work, because they read every issue file. Ask nothing: the rebuild changes only files git ignores. When the config does not load, the command fails like any other; report the error and go on.
```

- Step 7 (the former step 6) stays "Run `node \"${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs\" validate --json` a last time and compare with step 1."
- "Confirmation points": add the line `- Step 6 asks nothing: \`reindex\` changes only files git ignores.`
- "Output": after "the problems left with the manual step for each", add ", and the index rebuild: how many issues it indexed, or why it could not write the index".

- [ ] **Step 2: Update `README.md`**

Add a row to the CLI table, between `migrate` and `validate`:

```markdown
| `reindex` | rebuilds the query index in `.issues/.cache/` from the issue files; changes only files git ignores |
```

- [ ] **Step 3: Update `CHANGELOG.md`**

Insert above `## 0.2.0 - 2026-10-25`, with no `Tracker format:` and no `Setup:` line:

```markdown
## Unreleased

- Searches of the Local tracker read a query index in `.issues/.cache/index.json` and reparse only the issue files that changed. Git ignores the index, and pmkit rebuilds it on its own when it is missing or out of date.
- Adds the `reindex` command. `/pmkit:local:doctor` runs it to rebuild the index.
```

- [ ] **Step 4: Update `CONTEXT.md`**

Add after the **Local tracker** entry, with a blank line on each side, in the same shape as the other entries:

```markdown
**Query index**:
The cache of parsed issue files in `.issues/.cache/index.json`. Searches rebuild an entry when the stat signature of its `issue.md` changes. Git ignores it, and it is never a source of truth: deleting it only makes the next search slower.
_Avoid_: database, search engine
```

- [ ] **Step 5: Update ADR-0001**

In `docs/adr/0001-local-tracker-is-the-reference-implementation.md`, replace the consequence "The Local tracker has no index, so every search reads every issue file. A query index under `.issues/.cache/` is planned for phase 2." with:

```markdown
- Searches read the query index in `.issues/.cache/index.json` and reparse only the issue files whose stat signature changed (PMK-7). Git ignores the index, and it is never a source of truth.
```

- [ ] **Step 6: Run the checks that read these files**

Run: `node --test scripts/plugin.test.mjs scripts/changelog.test.mjs`
Expected: PASS. `plugin.test.mjs` checks that `reindex` in `doctor.md` names a CLI command and that the six sections stay in order. `changelog.test.mjs` still sees only `0.1.0` and `0.2.0`.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add commands/local/doctor.md README.md CHANGELOG.md CONTEXT.md docs/adr/0001-local-tracker-is-the-reference-implementation.md
git commit -m "docs: doctor rebuilds the query index, and document the index (PMK-7)" -m "Co-Authored-By: Claude <model> <noreply@anthropic.com>"
```

---

## Acceptance criteria map

| Criterion | Tasks | Tests |
|---|---|---|
| `issues list` reads the index and rebuilds the entries whose files changed | 1, 2, 4 | "a settled index reuses every entry", "an edit reparses that file only", "searchIssues builds the index, reuses it, and reparses only the edited issue", "issues list writes the index and CLI dry runs never touch it" |
| Results are the same with and without the index | 1, 2, 3 | "the index and the plain scan give the same results" (3 fixtures, 25 filters plus `getIssue`, 15 states), the contract suite with `index: false`, the fallback tests |
| `/pmkit:local:doctor` rebuilds the index | 4, 5 | "reindex --json rebuilds the index and leaves issues list unchanged", "reindex on a read-only tracker exits 0 with written: false", `plugin.test.mjs` on `doctor.md` |
