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
// The level (1 to 6) of an ATX heading line, 0 for any other line: the one test for `title`, `head` and `## Status`.
const headingLevel = (item) => ATX_HEADING.exec(item)?.[1].length ?? 0
// The text of an ATX heading line without the opening #s and the closing sequence: a run of # after a space or tab, or the whole content (PMK-282). `Status#` has none.
const headingText = (item) => item.replace(/^ {0,3}#{1,6}/, '').trim().replace(/(^|[ \t]+)#+$/, '')
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

// CommonMark block starts, read at the first character after the indent of what is left of a line.
const CM_ATX = /^#{1,6}(?:[ \t]+|$)/
const CM_FENCE = /^`{3,}(?!.*`)|^~{3,}/
const CM_CLOSING_FENCE = /^(?:`{3,}|~{3,})(?=[ \t]*$)/
const CM_SETEXT = /^(?:=+|-+)[ \t]*$/
const CM_BREAK = /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/
const CM_MARKER = /^(?:[*+-]|(\d{1,9})[.)])/
// The open blocks that take the rest of a line as their own, so no block starts inside them.
const LEAVES = new Set(['paragraph', 'code', 'fence', 'html', 'heading', 'break'])
// The seven starts of an HTML block (CommonMark 4.6), by kind 1 to 7, and the ends of kinds 1 to 5; kinds 6 and 7 end at a blank line.
// Kinds 1 to 6 interrupt a paragraph, kind 7 (any other complete tag alone on its line) does not.
const TAG = '[A-Za-z][A-Za-z0-9-]*'
const ATTRIBUTE = `(?:\\s+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:\\s*=\\s*(?:[^"'=<>\`\\x00-\\x20]+|'[^']*'|"[^"]*"))?)`
const HTML_OPEN = [
  /^<(?:script|pre|textarea|style)(?:\s|>|$)/i,
  /^<!--/,
  /^<[?]/,
  /^<![A-Za-z]/,
  /^<!\[CDATA\[/,
  /^<[/]?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[123456]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|search|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|[/]?[>]|$)/i,
  new RegExp(`^(?:<${TAG}${ATTRIBUTE}*\\s*/?>|</${TAG}\\s*[>])\\s*$`, 'i'),
]
const HTML_CLOSE = [null, /<\/(?:script|pre|textarea|style)>/i, /-->/, /\?>/, />/, /\]\]>/]
const ESCAPABLE = /^[!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-]/
// A backslash and the character after it are one step, so an escape never has two ways to match (commonmark.js 0.31.2 has two
// overlapping alternatives there, which backtrack twice per escape in an unclosed title: PMK-291 cycle 5 review).
const LINK_TITLE = /^(?:"(?:\\[\s\S]|[^\\"\x00])*"|'(?:\\[\s\S]|[^\\'\x00])*'|\((?:\\[\s\S]|[^\\()\x00])*\))/
const SPACE_NEWLINE = /^ *(?:\n *)?/
const LINE_END = /^ *(?:\n|$)/

// The length of the link reference definition at the start of `text`, 0 when there is none (CommonMark 4.7, as commonmark.js parses it):
// a label that is not blank, `:`, a destination (`<...>`, or a run without white space and with balanced parentheses), an optional
// title after white space, then the end of the line. A title that is followed by more text is dropped when the destination ends the line.
function referenceLength(text) {
  const label = /^\[(?:[^\\[\]]|\\.){0,1000}\]/s.exec(text)
  if (label === null || label[0].length > 1001 || text[label[0].length] !== ':' || label[0].slice(1, -1).trim() === '') return 0
  let at = label[0].length + 1
  at += SPACE_NEWLINE.exec(text.slice(at))[0].length
  const braces = /^<(?:[^<>\n\\\x00]|\\.)*>/.exec(text.slice(at))
  if (braces !== null) at += braces[0].length
  else {
    if (text[at] === '<') return 0
    const start = at
    let parens = 0
    while (at < text.length) {
      const char = text[at]
      if (char === '\\' && ESCAPABLE.test(text[at + 1] ?? '')) at += 2
      else if (char === '(') { at++; parens++ }
      else if (char === ')' && parens > 0) { at++; parens-- }
      else if (char === ')' || /[ \t\n\v\f\r]/.test(char)) break
      else at++
    }
    if ((at === start && text[at] !== ')') || parens !== 0) return 0
  }
  const beforeTitle = at
  at += SPACE_NEWLINE.exec(text.slice(at))[0].length
  const title = at === beforeTitle ? null : LINK_TITLE.exec(text.slice(at))
  at = title === null ? beforeTitle : at + title[0].length
  let end = LINE_END.exec(text.slice(at))
  if (end === null && title !== null) {
    at = beforeTitle
    end = LINE_END.exec(text.slice(at))
  }
  return end === null ? 0 : at + end[0].length
}
// Whether a paragraph has text left once the link reference definitions at its start are taken out, as they are when an underline
// comes: a paragraph of definitions only is not a setext heading. The definitions stay out of it.
const keepsText = (paragraph) => {
  let length
  while (paragraph.text[0] === '[' && (length = referenceLength(paragraph.text)) > 0) paragraph.text = paragraph.text.slice(length)
  return paragraph.text.length > 0
}

/**
 * Where the section that starts at line `from` stops: the first heading at the top level of the document after it, ATX or setext (PMK-273),
 * so a heading inside a list item or a quote is not a section (PMK-291). The walk follows CommonMark's block structure line by line:
 * a stack of open blocks from the document in, where each line first continues the open ones in order (a quote by its `>`, a list item
 * by the content column of its marker, a paragraph unless blank, indented code by 4 more columns, a fence until its closing fence, an
 * HTML block until its end), then starts new blocks in the deepest one it continued, and a line that continues no more than a paragraph
 * is a lazy continuation of it. A setext underline makes a heading only of a paragraph it continues and that holds more than link
 * reference definitions, so under a list item it is a break or a lazy line (PMK-280). Columns count a tab to the next stop of 4.
 * Not a Markdown parser: no inline content.
 */
function sectionEnd(lines, from) {
  const open = [{ type: 'document' }]
  for (let j = from + 1; j < lines.length; j++) {
    const line = lines[j]
    let offset = 0
    let column = 0
    let next, nextColumn, indent, blank
    const findNext = () => {
      next = offset
      nextColumn = column
      while (line[next] === ' ' || line[next] === '\t') nextColumn += line[next++] === '\t' ? 4 - (nextColumn % 4) : 1
      indent = nextColumn - column
      blank = next === line.length
    }
    const toNext = () => { offset = next; column = nextColumn }
    // Moves `count` characters, or `count` columns when `columns`, where a tab may be only partly consumed.
    const advance = (count, columns) => {
      while (count > 0 && offset < line.length) {
        const width = line[offset] === '\t' ? 4 - (column % 4) : 1
        const step = columns ? Math.min(width, count) : width
        column += step
        count -= columns ? step : 1
        if (step === width) offset++
      }
    }
    const spaceOrTab = () => line[offset] === ' ' || line[offset] === '\t'

    // Continue the open blocks; `matched` is the deepest one the line continues.
    let matched = 0
    let closedFence = false
    for (let k = 1; k < open.length; k++) {
      const block = open[k]
      findNext()
      if (block.type === 'quote') {
        if (indent >= 4 || line[next] !== '>') break
        toNext()
        advance(1, false)
        if (spaceOrTab()) advance(1, true)
      } else if (block.type === 'item') {
        if (blank && !block.filled) break
        if (blank) toNext()
        else if (indent >= block.width) advance(block.width, true)
        else break
      } else if (block.type === 'paragraph') {
        if (blank) break
      } else if (block.type === 'html') {
        if (blank && block.kind >= 6) break
      } else if (block.type === 'code') {
        if (indent >= 4) advance(4, true)
        else if (blank) toNext()
        else break
      } else if (block.type === 'fence') {
        const fence = indent <= 3 && line[next] === block.char ? CM_CLOSING_FENCE.exec(line.slice(next)) : null
        if (fence !== null && fence[0].length >= block.length) {
          open.length = k
          closedFence = true
          break
        }
      } else break
      matched = k
    }
    if (closedFence) continue

    // Start new blocks in the deepest continued one; starting one closes the open blocks the line did not continue.
    let container = matched
    let allClosed = container === open.length - 1
    const add = (block) => {
      open.length = container + 1
      allClosed = true
      // A paragraph, a heading or code holds no block: the new one goes beside it.
      while (LEAVES.has(open.at(-1).type)) open.pop()
      open.at(-1).filled = true
      open.push(block)
      container = open.length - 1
    }
    while (!LEAVES.has(open[container].type) || open[container].type === 'paragraph') {
      findNext()
      const rest = line.slice(next)
      const marker = indent < 4 ? CM_MARKER.exec(rest) : null
      const inParagraph = open[container].type === 'paragraph'
      let kind
      if (indent < 4 && rest[0] === '>') {
        toNext()
        advance(1, false)
        if (spaceOrTab()) advance(1, true)
        add({ type: 'quote' })
        continue
      } else if (indent < 4 && CM_ATX.test(rest)) {
        add({ type: 'heading' })
        if (container === 1) return j
      } else if (indent < 4 && CM_FENCE.test(rest)) {
        const fence = CM_FENCE.exec(rest)[0]
        add({ type: 'fence', char: fence[0], length: fence.length })
      } else if (indent < 4 && rest[0] === '<' && (kind = HTML_OPEN.findIndex((start, i) => start.test(rest) && (i < 6 || !(inParagraph || (!allClosed && !blank && open.at(-1).type === 'paragraph')))) + 1) > 0) {
        // The white space before it is part of the HTML block, so `offset` stays.
        add({ type: 'html', kind })
      } else if (indent < 4 && inParagraph && CM_SETEXT.test(rest) && keepsText(open[container])) {
        // The whole paragraph becomes the heading, so the section stops at its first line.
        if (container === 1) return open[1].start
        open[container] = { type: 'heading' }
      } else if (indent < 4 && CM_BREAK.test(rest)) {
        add({ type: 'break' })
      } else if (marker !== null && /^[ \t]?$/.test(rest[marker[0].length] ?? '') && !(inParagraph && (/^[ \t]*$/.test(rest.slice(marker[0].length)) || (marker[1] !== undefined && Number(marker[1]) !== 1)))) {
        // A list item: an empty one, or an ordered one not at 1, does not interrupt a paragraph. Its content starts after the marker
        // and 1 to 4 columns of white space; with 5 or more, or nothing after the marker, one column after the marker.
        const markerOffset = indent
        toNext()
        advance(marker[0].length, true)
        const spacesColumn = column
        const spacesOffset = offset
        do advance(1, true)
        while (column - spacesColumn < 5 && spaceOrTab())
        const spaces = column - spacesColumn
        let width = marker[0].length + spaces
        if (spaces >= 5 || spaces < 1 || offset >= line.length) {
          width = marker[0].length + 1
          column = spacesColumn
          offset = spacesOffset
          if (spaceOrTab()) advance(1, true)
        }
        add({ type: 'item', width: markerOffset + width, filled: false })
        continue
      } else if (indent >= 4 && !blank && open.at(-1).type !== 'paragraph') {
        advance(4, true)
        add({ type: 'code' })
      } else toNext()
      break
    }

    // What is left is text: a lazy line of the open paragraph, a line of the leaf it reached, or a new paragraph. A paragraph keeps its
    // text for the link reference definitions; an HTML block of kind 1 to 5 ends on the line that holds its end, its first line included.
    const rest = line.slice(offset)
    if (!allClosed && !blank && open.at(-1).type === 'paragraph') {
      open.at(-1).text += `${rest}\n`
      continue
    }
    open.length = container + 1
    const leaf = open[container]
    if (leaf.type === 'paragraph') leaf.text += `${rest}\n`
    else if (leaf.type === 'html' && leaf.kind <= 5 && HTML_CLOSE[leaf.kind].test(rest)) open.length = container
    else if (!blank && !LEAVES.has(leaf.type)) add({ type: 'paragraph', start: j, text: `${rest}\n` })
  }
  return lines.length
}

/**
 * The places of an ADR text that hold its title and status, found once for `adrInfo` and `setAdrStatus` so the two never disagree (PMK-263):
 * `yaml` (index of the `status:` line in the front matter, -1 when none), `line` (a `Status:` line above the first `## ` section),
 * `section` (a `## Status` heading: indented up to three spaces, a tab after the `##`, with or without a closing `#` sequence, PMK-282), `title` (the first `# ` heading) and `end(from)`, where the section that starts at `from` stops: at the next heading of any level, so a `### ` subsection is not part of it (PMK-269), in any CommonMark form: ATX (indented up to three spaces, a tab after the `#`, empty) or setext (PMK-273), and at the top level of the document (`sectionEnd`, PMK-291).
 * Lines inside a fenced code block never count.
 */
function locate(lines) {
  const close = lines[0] === '---' ? lines.indexOf('---', 1) : -1
  const start = close === -1 ? 0 : close + 1
  const code = fencedLines(lines)
  const at = (test, to = lines.length) => lines.findIndex((item, i) => i >= start && i < to && !code[i] && test(item))
  const head = at((item) => headingLevel(item) === 2)
  const yaml = close === -1 ? -1 : lines.slice(1, close).findIndex((item) => YAML_STATUS.test(item)) + 1 || -1
  const end = (from) => sectionEnd(lines, from)
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
  return { title: title === -1 ? key('title') : headingText(lines[title]), status: statuses[0] ?? null, statuses }
}

/**
 * The first line of the heading that ends an empty `## Status` section, null when there is none (PMK-294). `Accepted\n---` under `## Status`
 * is a setext heading (PMK-273), so the section holds no text and `adrInfo` reads no status. It is decided by `sectionEnd`, the same walk
 * that ends the section, so a list item, a quote or a thematic break over `---` is never named: the section stops at a setext heading when
 * its end is a line that is not an ATX heading.
 */
export function adrStatusHeading(text) {
  const lines = adrText(text).split('\n')
  const { section, end } = locate(lines)
  if (section === -1) return null
  const stop = end(section)
  if (stop >= lines.length || headingLevel(lines[stop]) > 0 || lines.slice(section + 1, stop).some((item) => item.trim() !== '')) return null
  return lines[stop].trim()
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
  const { start, yaml, line: found, section, title, end: endOf } = locate(lines)
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
      const end = endOf(section)
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
