// The next ADR: its number, slug and path. `docs next-adr` reads, this file computes. See
// docs/superpowers/specs/2026-10-31-pmk-65-record-decision-design.md.

import fs from 'node:fs'
import path from 'node:path'
import { PmkitError } from './errors.mjs'
import { stripComment } from './yaml.mjs'
import { climbsOut } from './paths.mjs'

export const ADR_SLUG_MAX = 60
// The display label of an ADR folder of a tracker outside the repository; never written into an ADR.
const OUTSIDE_LABEL = 'tracker:docs/adr'
// A name counts only in the form NNNN-<rest>.md (exactly four digits and a hyphen, unless a date YYYY-MM-DD follows), so 20261031.md, 0007a-x.md and 2026-10-31-x.md do not, and 0003-2fa-x.md does.
const NUMBERED = /^(\d{4})-(?!\d{2}-\d{2}(?:-|\.|$))[^/]*\.md$/
const QUOTES = /['"`‘’“”]/g
const LETTERS = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', ł: 'l', þ: 'th' }

/**
 * The file-name part of an ADR title: lowercase letters and digits of any script, accents of Latin letters and ß æ ø
 * transliterated, quotes dropped, every other run of characters a single hyphen, at most ADR_SLUG_MAX characters and cut at a word boundary.
 * A title with nothing left is refused.
 */
export function adrSlug(title) {
  if (typeof title !== 'string') throw new PmkitError('INVALID_INPUT', 'the ADR title must be a string', 'Pass --title with the decision title')
  const slug = title.normalize('NFD').replace(/(?<=\p{Script=Latin})\p{M}+/gu, '').normalize('NFC').toLowerCase().replace(QUOTES, '').replace(/[ßæœøđðłþ]/g, (c) => LETTERS[c]).replace(/[^\p{L}\p{N}\p{M}]+/gu, '-').replace(/^-+|-+$/g, '')
  if (!/[\p{L}\p{N}]/u.test(slug)) throw new PmkitError('INVALID_INPUT', `the title "${title}" has no letter or digit to make a file name from`, 'Pass --title with words, for example "Use event files as the audit log"')
  // Cut by code point, so a letter outside the basic plane is never split into a lone surrogate.
  const points = Array.from(slug)
  if (points.length <= ADR_SLUG_MAX) return slug
  const head = points.slice(0, ADR_SLUG_MAX).join('')
  const cut = points[ADR_SLUG_MAX] === '-' || !head.includes('-') ? head : head.slice(0, head.lastIndexOf('-'))
  return cut.replace(/-+$/, '')
}

/** The highest ADR number among the direct children `names` of one folder, and the names that carry no number. */
export function highestAdr(names) {
  let highest = 0
  const ignored = []
  for (const name of names) {
    const match = NUMBERED.exec(name)
    if (match) highest = Math.max(highest, Number(match[1]))
    else ignored.push(name)
  }
  return { highest, ignored }
}

/**
 * The ADR folders: the repository's docs/adr and, for the Local tracker, its docs/adr. When tracker.path puts that on the repository's
 * folder it is one folder, read once, and its place is `tracker`, so the ADRs in it follow the tracker's writes and auto_commit (PMK-247).
 * `label` is the folder relative to the repository, or `tracker:docs/adr` for a tracker folder outside it, so its paths never equal the
 * repository's and never show a path of this machine. `repoFolder` is null for a folder outside the repository, where no ref has it.
 */
export function adrFolders({ root, trackerDir, trackerFolder }) {
  const repoDir = path.join(root, 'docs', 'adr')
  if (trackerDir && path.resolve(trackerDir) === path.resolve(repoDir)) return [{ place: 'tracker', label: 'docs/adr', shown: 'docs/adr', dir: repoDir, repoFolder: 'docs/adr' }]
  const folders = [{ place: 'repo', label: 'docs/adr', shown: 'docs/adr', dir: repoDir, repoFolder: 'docs/adr' }]
  // `refFolder` is where an ADR text points a reader: the folder from the repository root, `../...` for a tracker outside it (PMK-257).
  if (trackerDir) folders.push({ place: 'tracker', label: trackerFolder ?? OUTSIDE_LABEL, shown: trackerFolder ?? 'docs/adr in the tracker', dir: trackerDir, repoFolder: trackerFolder, refFolder: trackerFolder ?? path.relative(root, trackerDir).split(path.sep).join('/') })
  return folders
}

/**
 * Where the Local tracker keeps its ADRs: `trackerDir` (absolute, null for a hosted tracker) and `trackerFolder`, the same folder
 * relative to the repository with `/`, or null when it lies outside the repository. `docs next-adr`, `docs adr-status` and `validate` share it.
 */
export function adrLocation({ root, issuesDir, hosted }) {
  const trackerDir = hosted || !issuesDir ? null : path.join(issuesDir, 'docs', 'adr')
  if (trackerDir === null) return { trackerDir, trackerFolder: null }
  const relative = path.relative(root, trackerDir)
  return { trackerDir, trackerFolder: climbsOut(relative) ? null : relative.split(path.sep).join('/') }
}

/** The numbered ADR files of the working tree in `folders`, as { number, name, path, ref, place, file }, sorted by path. `ref` is the path an ADR text may cite, from the repository root: `path` without the tracker: label, and `../...` for a tracker outside the repository. */
export function adrFiles(folders) {
  const found = []
  for (const { place, label, dir, refFolder = label } of folders) {
    for (const name of readTree(dir) ?? []) {
      const match = NUMBERED.exec(name)
      if (match) found.push({ number: match[1], name, path: `${label}/${name}`, ref: `${refFolder}/${name}`, place, file: path.join(dir, name) })
    }
  }
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** True when `name` is the file name of a numbered ADR. */
export const isAdrName = (name) => NUMBERED.test(name)

/**
 * The path an ADR text cites for `target`, written in `holder` (both { place, file, ref }): from the folder of `holder` when both are
 * in a tracker outside the repository (`trackerFolder` null), so a reader of the tracker alone can follow it; `target.ref` otherwise (PMK-268, PMK-270).
 */
export const adrRef = (holder, target, trackerFolder) =>
  holder.place === 'tracker' && target.place === 'tracker' && trackerFolder === null ? path.relative(path.dirname(holder.file), target.file).split(path.sep).join('/') : target.ref

/** Every ADR file whose number another file uses, with the paths of those others. */
export function duplicateAdrs(files) {
  return files.flatMap((file) => {
    const others = files.filter((other) => other !== file && other.number === file.number).map((other) => other.path)
    return others.length === 0 ? [] : [{ path: file.path, number: file.number, others }]
  })
}

export const ADR_STATUSES = ['accepted', 'deprecated', 'superseded']

/** The ADR text with BOM and CRLF removed. */
export const adrText = (text) => text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n')

// A status line above the first section: "Status: x", "**Status:** x", "**Status**: x", optionally as a list item.
const STATUS_LINE = /^(\s*[-*]\s+)?(\*\*Status:?\*\*:?|Status:)\s*(.*)$/i
// An ATX heading (CommonMark): up to three spaces, one to six #, then a blank or the end of the line. An empty heading (`##`) and a tab after the # count.
const ATX_HEADING = /^ {0,3}(#{1,6})([ \t]|$)/
// The level (1 to 6) of an ATX heading line, 0 for any other line: the one test for `title`, `head`, `## Status` and the end of a section.
const headingLevel = (item) => ATX_HEADING.exec(item)?.[1].length ?? 0
// The text of an ATX heading line without the opening #s and the closing sequence: a run of # after a space or tab, or the whole content (PMK-282). `Status#` has none.
const headingText = (item) => item.replace(/^ {0,3}#{1,6}/, '').trim().replace(/(^|[ \t]+)#+$/, '')
// A thematic break (`***`, `---`, `___`, spaces allowed).
const THEMATIC_BREAK = /^ {0,3}([-*_])( *\1){2,} *$/
// What interrupts a paragraph (CommonMark): a quote, a bullet item with content, an ordered item with content that starts at 1. An empty item and `2. foo` do not (PMK-281).
const INTERRUPTS_PARAGRAPH = /^ {0,3}(>|([-*+]|0*1[.)])[ \t]+\S)/
// What starts a block after a blank line, a heading or a break: any list item, empty or not, and a quote.
const BLOCK_START = /^ {0,3}(>|([-*+]|\d+[.)])([ \t]|$))/
// The underline of a setext heading: up to three spaces, then = or - only.
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/
// A list item line: spaces, the marker, the white space after it, then content (PMK-280).
const LIST_ITEM = /^( {0,3})([-*+]|\d+[.)])([ \t]+)\S/
// The columns of leading white space, a tab counting up to the next stop of 4: four or more start an indented code block (PMK-281).
// The column where the content of the list item `line` starts, null when it is not an item (a thematic break such as `- - -` is not one). CommonMark: one to four columns of white
// space after the marker (a tab goes to the next stop of 4) put the content after them; five or more put it one column after the marker (PMK-281 review).
const itemContent = (line) => {
  const item = THEMATIC_BREAK.test(line) ? null : LIST_ITEM.exec(line)
  if (item === null) return null
  const marker = item[1].length + item[2].length
  let column = marker
  for (const char of item[3]) column += char === '\t' ? 4 - (column % 4) : 1
  // Five or more columns open the item with indented code, not a paragraph (PMK-291 review).
  return { column: column - marker >= 5 ? marker + 1 : column, code: column - marker >= 5 }
}
// An item with nothing after its marker: its content column is one past the marker, and a blank line right after it ends it (PMK-291 review).
const EMPTY_ITEM = /^( {0,3})([-*+]|\d+[.)])[ \t]*$/
const indentColumns = (item) => {
  let columns = 0
  for (const char of item) {
    if (char === ' ') columns++
    else if (char === '\t') columns += 4 - (columns % 4)
    else break
  }
  return columns
}
const YAML_STATUS = /^status:/i
const capitalized = (text) => text.charAt(0).toUpperCase() + text.slice(1)
// Which lines are inside a fenced code block, fences included: a status or a heading there is an example, not the ADR's own (PMK-263).
// As in CommonMark, a fence is three or more backticks or tildes; a backtick fence with a backtick after it is inline code, and
// only a fence of the same character, at least as long and followed by blanks only, closes the block.
const fencedLines = (lines) => {
  let open = null
  return lines.map((item) => {
    const [, marker = '', rest = ''] = /^\s*(`{3,}|~{3,})(.*)$/.exec(item) ?? []
    if (open === null) {
      if (marker === '' || (marker[0] === '`' && rest.includes('`'))) return false
      open = marker
      return true
    }
    if (marker !== '' && marker[0] === open[0] && marker.length >= open.length && rest.trim() === '') open = null
    return true
  })
}
// A front matter value split into the value (with its quotes) and the YAML comment after it, which a `#` inside quotes never starts.
const splitYaml = (rest) => {
  const value = stripComment(rest).trimEnd()
  return { value, comment: rest.slice(value.length) }
}
// A quoted YAML scalar without its quotes; '' is an escaped quote in a single-quoted one.
const unquote = (value) => {
  const quoted = /^(["'])(.*)\1$/.exec(value.trim())
  return quoted === null ? value.trim() : quoted[1] === "'" ? quoted[2].replaceAll("''", "'") : quoted[2]
}

/**
 * The places of an ADR text that hold its title and status, found once for `adrInfo` and `setAdrStatus` so the two never disagree (PMK-263):
 * `yaml` (index of the `status:` line in the front matter, -1 when none), `line` (a `Status:` line above the first `## ` section),
 * `section` (a `## Status` heading: indented up to three spaces, a tab after the `##`, with or without a closing `#` sequence, PMK-282), `title` (the first `# ` heading) and `end(from)`, where the section that starts at `from` stops: at the next heading of any level, so a `### ` subsection is not part of it (PMK-269), in any CommonMark form: ATX (indented up to three spaces, a tab after the `#`, empty) or setext (PMK-273).
 * Lines inside a fenced code block never count.
 */
function locate(lines) {
  const close = lines[0] === '---' ? lines.indexOf('---', 1) : -1
  const start = close === -1 ? 0 : close + 1
  const code = fencedLines(lines)
  const at = (test, to = lines.length) => lines.findIndex((item, i) => i >= start && i < to && !code[i] && test(item))
  const head = at((item) => headingLevel(item) === 2)
  const yaml = close === -1 ? -1 : lines.slice(1, close).findIndex((item) => YAML_STATUS.test(item)) + 1 || -1
  const end = (from) => {
    const para = (i) => i > from && !code[i] && lines[i].trim() !== '' && headingLevel(lines[i]) === 0 && !THEMATIC_BREAK.test(lines[i])
    // Whether the line `top` sits inside a list item, so a setext underline below it is a thematic break (CommonMark gives a setext heading no
    // lazy continuation, PMK-280). A walk from the section start keeps the content columns of the open items: a line indented less than the
    // innermost one closes it, so a wider sibling item, a fence or any block at a lower column ends the list, unless it is a lazy continuation
    // of the paragraph above it (PMK-291). Not a list parser: no quotes, no numbering.
    const continuesItem = (top) => {
      const open = []
      const close = (indent) => { while (open.length > 0 && indent < open.at(-1)) open.pop() }
      let paragraph = false
      let empty = false
      for (let j = from + 1; j <= top; j++) {
        const item = lines[j]
        if (item.trim() === '') {
          if (empty) open.pop()
          paragraph = empty = false
          continue
        }
        if (code[j] && code[j - 1]) { paragraph = empty = false; continue }
        const indent = indentColumns(item)
        // After a blank line, four columns past the innermost item are indented code: it closes nothing and opens nothing.
        if (j !== top && !paragraph && indent >= (open.at(-1) ?? 0) + 4) continue
        if (j === top) { close(indent); return open.length > 0 }
        // Left of the innermost item, any item (an empty one, `2.`) starts a block; inside its paragraph only INTERRUPTS_PARAGRAPH does.
        const starts = code[j] || THEMATIC_BREAK.test(item) || (indent < (open.at(-1) ?? 0) ? BLOCK_START : INTERRUPTS_PARAGRAPH).test(item)
        if (paragraph && !starts) continue
        close(indent)
        const start = code[j] ? null : itemContent(item)
        const blank = !code[j] && !THEMATIC_BREAK.test(item) && EMPTY_ITEM.exec(item)
        if (start !== null) open.push(start.column)
        if (blank) open.push(blank[1].length + blank[2].length + 1)
        empty = Boolean(blank)
        paragraph = (!starts && !blank) || (start !== null && !start.code)
      }
      return false
    }
    for (let i = from + 1; i < lines.length; i++) {
      if (code[i]) continue
      if (headingLevel(lines[i]) > 0) return i
      if (!SETEXT_UNDERLINE.test(lines[i]) || !para(i - 1)) continue
      // A setext heading is the whole paragraph above its underline. The paragraph starts after a blank line, a heading or a thematic break,
      // and at a quote or a list item that interrupts one. When it opens with a quote or a list item, the underline is a thematic break or a
      // lazy continuation instead. A run of indented code that opens it (a line of 4 columns after a blank line) is not part of it: the
      // paragraph starts at the first line after the code, and with none before the underline there is no heading (PMK-281).
      let top = i - 1
      while (para(top - 1) && !INTERRUPTS_PARAGRAPH.test(lines[top])) top--
      // A line of 4 columns that continues a list item above it is not code (PMK-281 review).
      while (top < i && indentColumns(lines[top]) >= 4 && !continuesItem(top)) top++
      if (top < i && !BLOCK_START.test(lines[top]) && !continuesItem(top)) return top
    }
    return lines.length
  }
  return { close, start, yaml, head, line: at((item) => STATUS_LINE.test(item), head === -1 ? lines.length : head), section: at((item) => headingLevel(item) === 2 && headingText(item).toLowerCase() === 'status'), title: at((item) => headingLevel(item) === 1, head === -1 ? lines.length : head), end }
}
const withoutBlanks = (lines, from) => {
  let at = from
  while (at < lines.length && lines[at].trim() === '') at++
  return lines.slice(at)
}

/**
 * What `docs adr-get` shows (PMK-263): the title (the first `# ` heading, else the `title:` key of the front matter, else null) and the
 * status as each form holds it, in the order front matter key, `Status:` line above the first section, `## Status` section. `status` is the first.
 */
export function adrInfo(text) {
  const lines = adrText(text).split('\n')
  const { close, yaml, line, section, title, end } = locate(lines)
  const key = (name) => {
    const found = close === -1 ? undefined : lines.slice(1, close).find((item) => new RegExp(`^${name}:`, 'i').test(item))
    return found === undefined ? null : unquote(splitYaml(found.slice(name.length + 1)).value) || null
  }
  const body = section === -1 ? '' : lines.slice(section + 1, end(section)).map((item) => item.trim()).filter(Boolean).join(' ')
  const statuses = [yaml > 0 ? key('status') : null, line === -1 ? null : STATUS_LINE.exec(lines[line])[3].trim(), body].filter((value) => value)
  return { title: title === -1 ? key('title') : lines[title].replace(/^ {0,3}#/, '').trim(), status: statuses[0] ?? null, statuses }
}

/**
 * The ADR text with `status` (and `byPath`, the newer ADR, for superseded) written in the form the ADR already uses (PMK-228):
 * the `status:` key of YAML front matter, the body of a `## Status` section (Nygard, adr-tools), or a `Status:` or `**Status:**`
 * line above the first `## ` section. With none of them, a `Status:` line goes under the `# ` title, or under the front matter,
 * or at the top. Returns { text, before, after }: the status as it was (null when there was none) and as it is written. CRLF becomes LF.
 */
export function setAdrStatus(text, status, byPath) {
  const value = status === 'superseded' ? `superseded by ${byPath}` : status
  const lines = adrText(text).split('\n')
  const { start, yaml, line: found, section, title, end: sectionEnd } = locate(lines)
  const same = (current) => unquote(current).toLowerCase() === value.toLowerCase()
  // A status that is already the requested one leaves the text as it came, so the file is not rewritten (PMK-248).
  const done = (before, after, unchanged) => ({ text: unchanged ? adrText(text) : lines.join('\n'), before, after })

  // The front matter key and a `## Status` section can both hold a status (PMK-248): change every one and report both (PMK-257).
  if (yaml > 0 || section !== -1) {
    let unchanged = true
    const befores = []
    const afters = []
    // A `Status:` line above the first section is a third place that holds the status (PMK-263).
    if (yaml > 0) {
      // A YAML comment after the value is not part of the status, and the rewrite keeps it.
      const { value: current, comment } = splitYaml(lines[yaml].slice('status:'.length))
      befores.push(lines[yaml])
      if (!same(current)) unchanged = false
      lines[yaml] = `status: ${value}${comment}`
      afters.push(lines[yaml])
    }
    if (found !== -1) {
      const [, bullet = '', label, current] = STATUS_LINE.exec(lines[found])
      befores.push(lines[found])
      if (!same(current)) unchanged = false
      lines[found] = `${bullet}${label.startsWith('**') ? '**Status:**' : 'Status:'} ${value}`
      afters.push(lines[found])
    }
    if (section !== -1) {
      const end = sectionEnd(section)
      const body = lines.slice(section + 1, end).map((item) => item.trim()).filter(Boolean)
      if (body.length !== 1 || !same(body[0])) unchanged = false
      const label = befores.length > 0 ? '## Status: ' : ''
      if (body.length > 0) befores.push(`${label}${body.join(' ')}`)
      afters.push(`${label}${capitalized(value)}`)
      lines.splice(section + 1, end - section - 1, '', capitalized(value), '')
    }
    // A status that does not change reports the same text on both sides.
    return done(befores.length === 0 ? null : befores.join('; '), unchanged ? befores.join('; ') : afters.join('; '), unchanged)
  }

  if (found !== -1) {
    const [, bullet = '', label] = STATUS_LINE.exec(lines[found])
    const before = lines[found]
    const unchanged = same(STATUS_LINE.exec(before)[3])
    lines[found] = `${bullet}${label.startsWith('**') ? '**Status:**' : 'Status:'} ${value}`
    return done(before, unchanged ? before : lines[found], unchanged)
  }

  const line = `Status: ${value}`
  const anchor = title !== -1 ? title : start - 1
  const top = anchor === -1 ? [] : [...lines.slice(0, anchor + 1), '']
  return { text: [...top, line, '', ...withoutBlanks(lines, anchor + 1)].join('\n'), before: null, after: line }
}

const children = (paths, folder) => paths.filter((p) => p.startsWith(`${folder}/`)).map((p) => p.slice(folder.length + 1))

function readTree(dir) {
  if (!fs.existsSync(dir)) return null
  if (!fs.statSync(dir).isDirectory()) return null
  return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.')).map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
}

/**
 * Plans the next ADR. `git(args)` returns { status, stdout }. `createSupported` is whether the tracker can create documents.
 * `trackerDir` is the Local tracker's ADR folder as an absolute path, read from the working tree, or null for a hosted tracker.
 * `trackerFolder` is the same folder relative to the repository root, or null when it lies outside the repository,
 * where the ref has nothing to read.
 */
export function planNextAdr({ title, root, trackerFolder, trackerDir, hosted, createSupported, defaultBranch, defaultBranchNote, gitHost, git }) {
  const slug = adrSlug(title)
  const notes = []
  const ignored = []
  if (defaultBranchNote) notes.push(defaultBranchNote)

  const ref = `origin/${defaultBranch}`
  const refCheck = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  const refSha = refCheck.status === 0 ? refCheck.stdout.trim().slice(0, 7) : null
  if (refSha) notes.push(`numbered with ${ref} as last fetched (${refSha}), so it may be behind the remote`)
  else notes.push(`${ref} does not exist here, so only the working tree was read and an ADR merged on ${defaultBranch} may be missed`)

  const trackerLabel = trackerDir ? (trackerFolder ?? OUTSIDE_LABEL) : null
  const folders = adrFolders({ root, trackerDir, trackerFolder })
  if (trackerDir && !trackerFolder) notes.push(`the tracker folder is outside the repository, so ${ref} was not read for it and its paths start with tracker: and are relative to the tracker folder`)

  const sources = []
  for (const { place, label, shown, dir, repoFolder } of folders) {
    const entries = readTree(dir)
    const direct = entries?.filter((name) => !name.endsWith('/')) ?? []
    const dirs = entries?.filter((name) => name.endsWith('/')) ?? []
    const tree = highestAdr(direct)
    sources.push({ place, folder: label, where: 'working tree', exists: entries !== null, highest: tree.highest, files: direct.length })
    ignored.push(...tree.ignored.map((name) => `${shown}/${name}`), ...dirs.map((name) => `${shown}/${name}`))
    if (refSha && repoFolder) {
      const listed = git(['ls-tree', '-r', '-z', '--name-only', ref, '--', `${repoFolder}/`])
      if (listed.status !== 0) {
        notes.push(`could not list ${ref}:${repoFolder}, so its ADRs are not counted and the number may be behind`)
        continue
      }
      const names = children(listed.stdout.split('\0').filter(Boolean), repoFolder)
      const remoteDirect = names.filter((name) => !name.includes('/'))
      const remote = highestAdr(remoteDirect)
      sources.push({ place, folder: label, where: ref, exists: names.length > 0, highest: remote.highest, files: remoteDirect.length })
      ignored.push(...remote.ignored.map((name) => `${ref}:${repoFolder}/${name}`), ...names.filter((name) => name.includes('/')).map((name) => `${ref}:${repoFolder}/${name}`))
    }
  }

  const repoExists = sources.some((source) => source.place === 'repo' && source.exists)
  const destination = repoExists || hosted || !createSupported || !trackerDir ? 'repo' : 'tracker'
  const highest = Math.max(0, ...sources.map((source) => source.highest))
  const number = String(highest + 1).padStart(4, '0')
  const filename = `${number}-${slug}.md`
  const folder = destination === 'repo' ? 'docs/adr' : trackerLabel
  const other = sources.filter((source) => source.place !== destination && source.files > 0)
  if (other.length > 0) notes.push(`${[...new Set(other.map((source) => folders.find((f) => f.place === source.place).shown))].join(' and ')} also has ADRs, and the number counts them`)
  if (ignored.length > 0) notes.push(`not counted, no number in the name: ${ignored.join(', ')}`)

  return {
    number,
    slug,
    filename,
    destination,
    path: `${folder}/${filename}`,
    docPath: destination === 'tracker' ? `adr/${filename}` : null,
    defaultBranch,
    gitHost,
    ref: refSha ? { name: ref, sha: refSha } : null,
    sources,
    ignored,
    notes,
  }
}
