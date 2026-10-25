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

const IGNORE_TEXT = '*\n'
const ignoreIsSound = (cacheDir) => {
  try {
    return fs.readFileSync(path.join(cacheDir, '.gitignore'), 'utf8') === IGNORE_TEXT
  } catch {
    return false
  }
}

/** Writes `.gitignore` first, so git never sees index.json, then the index through a temp file and a rename. */
export function saveIndex(cacheDir, header, entries) {
  fs.mkdirSync(cacheDir, { recursive: true })
  if (!ignoreIsSound(cacheDir)) writeFileAtomic(path.join(cacheDir, '.gitignore'), IGNORE_TEXT)
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
  // A missing or altered cache .gitignore counts as a change, so a settled index repairs it.
  if (!changed && write) changed = !ignoreIsSound(cacheDir)
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
