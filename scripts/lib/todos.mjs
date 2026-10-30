// TODO and FIXME comments as candidate issues. See
// docs/superpowers/specs/2026-10-30-pmk-64-todos-to-issues-design.md.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { PmkitError } from './errors.mjs'

/** The most output git may print, in bytes. The same limit as the GitHub host. */
export const GIT_MAX_BUFFER = 256 * 1024 * 1024
/** The largest file the scan reads, in bytes. */
export const MAX_FILE_BYTES = 1024 * 1024
/** A line longer than this is minified or generated code, so the scan skips it. */
const MAX_LINE = 1000
/** A text shorter than this matches an issue only through its key or its source. */
export const MIN_TEXT_MATCH = 15
const TITLE_MAX = 80

// A comment leader, then anything, then the tag as a whole word: TODO(owner): text.
const TODO_LINE = /(?:\/\/+|\/\*+|<!--|#+|--|;+|%+|^\s*\*+)\s*(?:.*?\s)?(TODO|FIXME)\b(?:\(([^)]*)\))?:?(?:\s+|$)(.*)$/

/** The tag, owner and text of a TODO or FIXME comment on one line, or null. The text can be empty. */
export function parseTodoLine(line) {
  const match = TODO_LINE.exec(line)
  if (!match) return null
  const text = match[3].replace(/\s*(?:\*\/|-->)\s*$/, '').trim()
  return { tag: match[1], owner: match[2] ?? '', text }
}

/** Lowercase, collapsed whitespace, no punctuation at the edges. */
export const normalizeText = (text) => text.toLowerCase().replace(/\s+/g, ' ').replace(/^[\s.,;:!?'"`-]+|[\s.,;:!?'"`-]+$/g, '')

/** The first 12 hex characters of the SHA-256 of the normalized text. */
export const todoKey = (text) => crypto.createHash('sha256').update(normalizeText(text)).digest('hex').slice(0, 12)

const byLocation = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line)

/** One candidate per key. `found` is `{ file, line, tag, text }[]`. */
export function groupTodos(found) {
  const groups = new Map()
  for (const item of [...found].sort(byLocation)) {
    const key = todoKey(item.text)
    const group = groups.get(key) ?? { key, tag: 'TODO', text: item.text, locations: [] }
    if (item.tag === 'FIXME') group.tag = 'FIXME'
    group.locations.push(`${item.file}:${item.line}`)
    groups.set(key, group)
  }
  return [...groups.values()].map((group) => {
    const [first, ...rest] = group.locations
    const also = rest.length > 0 ? `Also at: ${rest.map((location) => `\`${location}\``).join(', ')}\n` : ''
    const title = group.text.length > TITLE_MAX ? `${group.text.slice(0, TITLE_MAX - 3)}...` : group.text
    return { ...group, title, description: `${group.text}\n\nSource: \`${first}\`\n${also}\ntodo-key: ${group.key}\n` }
  })
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function matchReason(candidate, issue) {
  const haystack = `${issue.description ?? ''}\n${issue.body ?? ''}`
  if (new RegExp(`^todo-key:\\s*${candidate.key}\\s*$`, 'm').test(haystack)) return 'key'
  if (candidate.locations.some((location) => new RegExp(`${escapeRegex(location)}(?!\\d)`).test(haystack))) return 'source'
  const text = normalizeText(candidate.text)
  if (text.length >= MIN_TEXT_MATCH && [issue.title ?? '', issue.description ?? '', issue.body ?? ''].some((field) => normalizeText(field).includes(text))) return 'text'
  return null
}

/** Splits candidates into the ones no issue matches and the matched ones. Every issue counts, whatever its status. */
export function matchTodos(candidates, issues) {
  const kept = []
  const matched = []
  for (const candidate of candidates) {
    let hit = null
    for (const reason of ['key', 'source', 'text']) {
      const issue = issues.find((item) => matchReason(candidate, item) === reason)
      if (issue) { hit = { issue, reason }; break }
    }
    if (hit) matched.push({ key: candidate.key, tag: candidate.tag, text: candidate.text, locations: candidate.locations, issue: hit.issue.id, status: hit.issue.status?.name ?? null, reason: hit.reason })
    else kept.push(candidate)
  }
  return { candidates: kept, matched }
}

const SKIPPED = (file) => file.split('/').some((part) => part === 'node_modules') || file.startsWith('.issues/') || file.startsWith('.pmkit/')

/**
 * Reads every file git lists (tracked, and untracked but not ignored) and returns its TODO and FIXME comments.
 * `path` keeps only the files under that prefix. A directory outside a git repository is an INVALID_INPUT error,
 * because without git the scan cannot honor .gitignore.
 */
export function scanRepo(root, { path: prefix } = {}) {
  const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, maxBuffer: GIT_MAX_BUFFER })
  if (listed.error || listed.status !== 0) {
    const why = listed.error?.code === 'ENOBUFS' ? 'git printed more than 256 MiB' : String(listed.stderr ?? '').trim() || listed.error?.message || 'git failed'
    throw new PmkitError('INVALID_INPUT', `cannot list the files of ${root}: ${why}`, 'Run the scan inside a git repository, so it can honor .gitignore')
  }
  const files = [...new Set(listed.stdout.toString('utf8').split('\0').filter(Boolean))].sort()
  const found = []
  let read = 0
  let skippedEmpty = 0
  for (const file of files) {
    if (SKIPPED(file) || (prefix && !file.startsWith(prefix))) continue
    const full = path.join(root, file)
    let buffer
    try {
      const stat = fs.statSync(full)
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue
      buffer = fs.readFileSync(full)
    } catch {
      continue // listed by git but deleted on disk
    }
    if (buffer.subarray(0, 8000).includes(0)) continue
    read += 1
    buffer.toString('utf8').split(/\r?\n/).forEach((line, index) => {
      if (line.length > MAX_LINE || !/TODO|FIXME/.test(line)) return
      const parsed = parseTodoLine(line)
      if (!parsed) return
      if (parsed.text === '') skippedEmpty += 1
      else found.push({ file, line: index + 1, tag: parsed.tag, text: parsed.text })
    })
  }
  return { found, files: read, skippedEmpty }
}
