// The next ADR: its number, slug and path. `docs next-adr` reads, this file computes. See
// docs/superpowers/specs/2026-10-31-pmk-65-record-decision-design.md.

import fs from 'node:fs'
import path from 'node:path'
import { PmkitError } from './errors.mjs'

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
  const outside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
  return { trackerDir, trackerFolder: outside ? null : relative.split(path.sep).join('/') }
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
const STATUS_SECTION = /^##\s+Status\s*$/i
const YAML_STATUS = /^status:/i
const capitalized = (text) => text.charAt(0).toUpperCase() + text.slice(1)
// The lines after `from` up to the next "# " or "## " heading (or the end), as [start, end).
const sectionEnd = (lines, from) => {
  const next = lines.findIndex((item, i) => i > from && /^#{1,2} /.test(item))
  return next === -1 ? lines.length : next
}
const withoutBlanks = (lines, from) => {
  let at = from
  while (at < lines.length && lines[at].trim() === '') at++
  return lines.slice(at)
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
  const close = lines[0] === '---' ? lines.indexOf('---', 1) : -1
  const start = close === -1 ? 0 : close + 1
  const same = (current) => current.trim().replace(/^(["'])(.*)\1$/, '$2').toLowerCase() === value.toLowerCase()
  // A status that is already the requested one leaves the text as it came, so the file is not rewritten (PMK-248).
  const done = (before, after, unchanged) => ({ text: unchanged ? adrText(text) : lines.join('\n'), before, after })

  // The front matter key and a `## Status` section can both hold a status (PMK-248): change every one and report both (PMK-257).
  const yaml = close === -1 ? -1 : lines.slice(1, close).findIndex((item) => YAML_STATUS.test(item)) + 1
  const section = lines.findIndex((item, i) => i >= start && STATUS_SECTION.test(item))
  if (yaml > 0 || section !== -1) {
    let unchanged = true
    const befores = []
    const afters = []
    // A `Status:` line above the first section is a third place that holds the status (PMK-263).
    const head = lines.findIndex((item, i) => i >= start && item.startsWith('## '))
    const found = lines.findIndex((item, i) => i >= start && (head === -1 || i < head) && STATUS_LINE.test(item))
    if (yaml > 0) {
      // A YAML comment after the value is not part of the status, and the rewrite keeps it.
      const [, current, comment = ''] = /^status:(.*?)(\s+#.*)?$/i.exec(lines[yaml])
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
      const end = sectionEnd(lines, section)
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

  const first = lines.findIndex((item, i) => i >= start && item.startsWith('## '))
  const head = first === -1 ? lines.length : first
  const found = lines.findIndex((item, i) => i >= start && i < head && STATUS_LINE.test(item))
  if (found !== -1) {
    const [, bullet = '', label] = STATUS_LINE.exec(lines[found])
    const before = lines[found]
    const unchanged = same(STATUS_LINE.exec(before)[3])
    lines[found] = `${bullet}${label.startsWith('**') ? '**Status:**' : 'Status:'} ${value}`
    return done(before, unchanged ? before : lines[found], unchanged)
  }

  const line = `Status: ${value}`
  const title = lines.findIndex((item, i) => i >= start && i < head && item.startsWith('# '))
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
