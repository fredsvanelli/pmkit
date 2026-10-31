// Candidate issues from the TODO and FIXME comments of a repository. See
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
/** A text shorter than this matches an issue only through its key. */
export const MIN_TEXT_MATCH = 15
/** The most issues the scan reads from the tracker. A read that reaches it is incomplete. */
export const READ_LIMIT = 100000
const TITLE_MAX = 80

// ---- Comments ----

const C_LIKE = { line: ['//'], block: [['/*', '*/']], strings: ['"', "'", '`'] }
const HASH = { line: ['#'], strings: ['"', "'"] }
const MARKUP = { block: [['<!--', '-->']] }
const STYLES = {
  c: C_LIKE,
  c_hash: { ...C_LIKE, line: ['//', '#'] }, // php and Terraform take both marks
  dash: { line: ['--'], strings: ['"', "'"] },
  go: { line: ['//'], block: [['/*', '*/']], strings: ['"', '`'], chars: true },
  rs: { line: ['//'], block: [['/*', '*/']], strings: ['"'], chars: true },
  css: { block: [['/*', '*/']] },
  py: { ...HASH, triple: true },
  hash: HASH,
  markup: MARKUP,
  md: { ...MARKUP, markdown: true },
}
const EXTENSIONS = {
  c: ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'java', 'kt', 'kts', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'scala', 'dart', 'gradle', 'scss', 'less'],
  c_hash: ['php', 'tf'],
  dash: ['sql', 'lua', 'hs'],
  go: ['go'],
  rs: ['rs'],
  css: ['css'],
  py: ['py'],
  hash: ['sh', 'bash', 'zsh', 'rb', 'yaml', 'yml', 'toml', 'r', 'pl', 'ex', 'exs', 'ps1', 'mk'],
  markup: ['html', 'htm', 'xml', 'svg', 'vue', 'svelte'],
  md: ['md', 'markdown'],
}
const BY_EXTENSION = new Map(Object.entries(EXTENSIONS).flatMap(([style, list]) => list.map((ext) => [ext, STYLES[style]])))
const BY_NAME = new Map(['Makefile', 'Dockerfile', 'Containerfile', 'Gemfile', 'Rakefile'].map((name) => [name, STYLES.hash]))

/** The comment syntax of a file, chosen by its name, or null for a file type the scan does not read. */
export function commentStyle(file) {
  const name = file.split('/').pop()
  return BY_NAME.get(name) ?? BY_EXTENSION.get(name.includes('.') ? name.split('.').pop().toLowerCase() : '') ?? null
}

// A line comment starts at the mark. `//` after a colon is a URL, and `#` or `--` after code that is not a space is not a mark.
const markOk = (mark, source, i) => (mark === '//' ? source[i - 1] !== ':' : i === 0 || /\s/.test(source[i - 1]))

/** Markdown keeps its code blocks and inline code out of the scan: they become blanks of the same length. */
function blankMarkdownCode(source) {
  let fenced = false
  return source
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced
        return ' '.repeat(line.length)
      }
      return fenced ? ' '.repeat(line.length) : line.replace(/`[^`\n]*`/g, (span) => ' '.repeat(span.length))
    })
    .join('\n')
}

/** The text of every comment line, as { line, content }, outside strings. A block comment gives one entry per line. */
function commentLines(source, style) {
  const out = []
  let mode = 'code'
  let close = ''
  let quote = ''
  let buf = ''
  let line = 1
  let start = 0
  let i = 0
  const push = () => {
    out.push({ line: start, content: buf })
    buf = ''
  }
  while (i < source.length) {
    const ch = source[i]
    if (mode === 'code') {
      const block = style.block?.find(([open]) => source.startsWith(open, i))
      const mark = style.line?.find((m) => source.startsWith(m, i) && markOk(m, source, i))
      if (ch === '\n') line += 1
      if (block) {
        mode = 'block'
        close = block[1]
        i += block[0].length
        buf = ''
        start = line
        continue
      }
      if (mark) {
        mode = 'line'
        i += mark.length
        buf = ''
        start = line
        continue
      }
      if (style.chars && ch === "'") {
        // A Rust lifetime or a Go rune: skip a whole character literal, and treat a lone quote as code.
        const literal = /^'(?:\\.|[^\\'\n])'/.exec(source.slice(i, i + 8))
        i += literal ? literal[0].length : 1
        continue
      }
      if (style.strings?.includes(ch)) {
        quote = style.triple && source.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch
        mode = 'string'
        i += quote.length
        continue
      }
      i += 1
    } else if (mode === 'string') {
      if (ch === '\\') {
        if (source[i + 1] === '\n') line += 1
        i += 2
        continue
      }
      if (source.startsWith(quote, i)) {
        mode = 'code'
        i += quote.length
        continue
      }
      if (ch === '\n') {
        line += 1
        // A quote that is not a template literal, a raw string or a triple quote ends at the end of its line.
        if (quote.length === 1 && quote !== '`') mode = 'code'
      }
      i += 1
    } else if (mode === 'line') {
      if (ch === '\n') {
        push()
        mode = 'code'
        line += 1
      } else buf += ch
      i += 1
    } else if (source.startsWith(close, i)) {
      push()
      mode = 'code'
      i += close.length
    } else {
      if (ch === '\n') {
        push()
        line += 1
        start = line
      } else buf += ch
      i += 1
    }
  }
  if (mode === 'line' || mode === 'block') push()
  return out
}

// The tag is the first word of the comment, so prose that names a TODO in passing is not one.
const TAG = /^(TODO|FIXME)(?:\(([^)]*)\))?(?::\s*|\s+|$)(.*)$/

/** The TODO and FIXME comments of one file, as { line, tag, owner, text }. The text can be empty. */
export function findTodos(source, file) {
  const style = commentStyle(file)
  if (!style) return []
  const found = []
  // Line endings first, as config.mjs does for YAML: a \r left at the end of a line would end up in the text.
  const text = source.replace(/\r\n?/g, '\n')
  for (const { line, content } of commentLines(style.markdown ? blankMarkdownCode(text) : text, style)) {
    const match = TAG.exec(content.replace(/^[\s*/!#]+/, ''))
    if (match) found.push({ line, tag: match[1], owner: match[2] ?? '', text: match[3].trim() })
  }
  return found
}

// ---- Candidates ----

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

// ---- Matching ----

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const KEY_LINE = /^todo-key:[ \t]*([0-9a-f]{12})[ \t]*\r?$/gm
const WORD = /[^\p{L}\p{N}]+/u

/**
 * Reads the issues once: the issue that holds each `todo-key:` line, and for each word the issues whose title, description
 * or body has it. A candidate then checks the few issues that share its rarest word, not every issue.
 */
function indexIssues(issues) {
  const keys = new Map()
  const words = new Map()
  const fields = issues.map((issue, index) => {
    for (const [, key] of `${issue.description ?? ''}\n${issue.body ?? ''}`.matchAll(KEY_LINE)) if (!keys.has(key)) keys.set(key, issue)
    const normalized = [issue.title ?? '', issue.description ?? '', issue.body ?? ''].map(normalizeText)
    for (const word of new Set(normalized.flatMap((field) => field.split(WORD)).filter(Boolean))) {
      const list = words.get(word)
      if (list) list.push(index)
      else words.set(word, [index])
    }
    return normalized
  })
  return { keys, words, fields }
}

/** The first issue, in list order, that holds the text as whole words, or undefined. The locations never match: a line number ages with the code. */
function textMatch(candidate, { words, fields }, issues) {
  const text = normalizeText(candidate.text)
  if (text.length < MIN_TEXT_MATCH) return undefined
  let rarest
  for (const word of text.split(WORD).filter(Boolean)) {
    const list = words.get(word)
    if (!list) return undefined
    if (!rarest || list.length < rarest.length) rarest = list
  }
  if (!rarest) return undefined
  const whole = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(text)}(?![\\p{L}\\p{N}])`, 'u')
  const position = rarest.find((index) => fields[index].some((field) => whole.test(field)))
  return position === undefined ? undefined : issues[position]
}

/** Splits candidates into the ones no issue matches and the matched ones. Every issue counts, whatever its status. */
export function matchTodos(candidates, issues) {
  const index = indexIssues(issues)
  const kept = []
  const matched = []
  for (const candidate of candidates) {
    const byKey = index.keys.get(candidate.key)
    const issue = byKey ?? textMatch(candidate, index, issues)
    if (issue) {
      const { key, tag, text, locations, title, description } = candidate
      matched.push({ key, tag, text, locations, title, description, issue: issue.id, status: issue.status?.name ?? null, reason: byKey ? 'key' : 'text' })
    } else kept.push(candidate)
  }
  return { candidates: kept, matched }
}

/**
 * Every issue of the tracker, archived ones included. `incomplete` says the read stopped short, either because the tracker
 * has more issues than it returned, the read reached `limit`, or some issue files could not be read (`unread` counts them
 * and lists their ids), so a comment may look new when an issue covers it.
 */
export async function readExistingIssues(tracker, { limit = READ_LIMIT } = {}) {
  const found = await tracker.searchIssues({ archived: true, limit })
  const problems = found.problems ?? []
  // An issue the tracker cannot read may hold the todo-key of a comment, so it counts as a cut read too.
  const unread = { count: problems.length, ids: problems.map((problem) => problem.id).filter(Boolean) }
  const cut = found.hasMore === true || found.issues.length >= limit
  return { issues: found.issues, problems, incomplete: cut || unread.count > 0, cut, unread }
}

// ---- Scan ----

const inside = (file, dir) => file === dir || file.startsWith(`${dir}/`)

/** The folder or file prefix a --path names, or null for the whole repository. It must stay inside the repository. */
function pathPrefix(given) {
  if (given === undefined) return null
  const bad = () => new PmkitError('INVALID_INPUT', `--path ${JSON.stringify(given)} must be a folder or file inside the repository`, 'Pass a relative path such as src/')
  if (typeof given !== 'string' || given === '' || path.isAbsolute(given) || /^[A-Za-z]:/.test(given)) throw bad()
  const normalized = path.posix.normalize(given.replace(/\\/g, '/')).replace(/\/+$/, '')
  if (normalized === '..' || normalized.startsWith('../')) throw bad()
  return normalized === '.' ? null : normalized
}

/**
 * Reads every file git lists (tracked, and untracked but not ignored) and returns its TODO and FIXME comments.
 * `path` keeps the files at or under that folder. `skip` lists folders to leave out, relative to `root`, besides
 * node_modules and .pmkit. Symbolic links are left out. File types without a comment syntax are left out too, and
 * `skipped.unsupported` counts them by extension (or by file name when there is none).
 */
export function scanRepo(root, { path: given, skip = [], env = process.env } = {}) {
  const prefix = pathPrefix(given)
  const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, env, maxBuffer: GIT_MAX_BUFFER })
  if (listed.error?.code === 'ENOENT') throw new PmkitError('NOT_CONFIGURED', 'git was not found, and the scan needs it to list the files', 'Install git and run the scan again')
  if (listed.error || listed.status !== 0) {
    const stderr = String(listed.stderr ?? '').trim()
    const why = listed.error?.code === 'ENOBUFS' ? 'git printed more than 256 MiB' : /not a git repository/.test(stderr) ? 'not a git repository' : stderr || listed.error?.message || 'git failed'
    throw new PmkitError('INVALID_INPUT', `cannot list the files of ${root}: ${why}`, 'Run the scan inside a git repository, so it can honor .gitignore')
  }
  const left = ['.pmkit', ...skip.filter((dir) => dir !== '' && dir !== '.')]
  const files = [...new Set(listed.stdout.toString('utf8').split('\0').filter(Boolean))].sort()
  const found = []
  let read = 0
  let skippedEmpty = 0
  const unsupported = {}
  for (const file of files) {
    if (file.split('/').includes('node_modules') || left.some((dir) => inside(file, dir)) || (prefix !== null && !inside(file, prefix))) continue
    if (!commentStyle(file)) {
      // A file type with no comment syntax is not read. The count by extension tells the user what the scan left out.
      const name = file.split('/').pop()
      const extension = path.extname(name).toLowerCase() || name
      unsupported[extension] = (unsupported[extension] ?? 0) + 1
      continue
    }
    const full = path.join(root, file)
    let buffer
    try {
      const stat = fs.lstatSync(full)
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue // a symbolic link is not followed
      buffer = fs.readFileSync(full)
    } catch {
      continue // listed by git but deleted on disk
    }
    if (buffer.subarray(0, 8000).includes(0)) continue
    read += 1
    for (const todo of findTodos(buffer.toString('utf8'), file)) {
      if (todo.text === '') skippedEmpty += 1
      else found.push({ file, line: todo.line, tag: todo.tag, text: todo.text })
    }
  }
  return { found, files: read, skippedEmpty, skipped: { unsupported } }
}
