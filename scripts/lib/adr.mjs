// The next ADR: its number, slug and path. `docs next-adr` reads, this file computes. See
// docs/superpowers/specs/2026-10-31-pmk-65-record-decision-design.md.

import fs from 'node:fs'
import path from 'node:path'
import { PmkitError } from './errors.mjs'

export const ADR_SLUG_MAX = 60
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
 * The ADR folders: the repository's docs/adr and, for the Local tracker, its docs/adr unless tracker.path puts it on the same folder,
 * which is then read once. `label` is the folder relative to the repository, or docs/adr relative to a tracker folder outside it,
 * never an absolute path of this machine. `repoFolder` is null for a folder outside the repository, where no ref has it.
 */
export function adrFolders({ root, trackerDir, trackerFolder }) {
  const repoDir = path.join(root, 'docs', 'adr')
  const folders = [{ place: 'repo', label: 'docs/adr', shown: 'docs/adr', dir: repoDir, repoFolder: 'docs/adr' }]
  if (trackerDir && path.resolve(trackerDir) !== path.resolve(repoDir)) {
    folders.push({ place: 'tracker', label: trackerFolder ?? 'docs/adr', shown: trackerFolder ?? 'docs/adr in the tracker', dir: trackerDir, repoFolder: trackerFolder })
  }
  return folders
}

/** The numbered ADR files of the working tree in `folders`, as { number, name, path, place, file }, sorted by path. */
export function adrFiles(folders) {
  const found = []
  for (const { place, label, dir } of folders) {
    for (const name of readTree(dir) ?? []) {
      const match = NUMBERED.exec(name)
      if (match) found.push({ number: match[1], name, path: `${label}/${name}`, place, file: path.join(dir, name) })
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

/** The status line of an ADR. `byPath` is the path of the newer ADR, for superseded only. */
export const adrStatusLine = (status, byPath) => (status === 'superseded' ? `Status: superseded by ${byPath}` : `Status: ${status}`)

const STATUS = /^Status:/

// The lines of an ADR, the index of its first "## " section (or the end), and the index of its status line above it (or -1).
function statusPlace(text) {
  const lines = text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').split('\n')
  const end = lines.findIndex((item) => item.startsWith('## '))
  const head = end === -1 ? lines.length : end
  return { lines, head, current: lines.slice(0, head).findIndex((item) => STATUS.test(item)) }
}

/** The status line of an ADR text, or null when it has none above its first section. */
export function adrStatusOf(text) {
  const { lines, current } = statusPlace(text)
  return current === -1 ? null : lines[current]
}

/**
 * The ADR text with `line` as its status: it replaces the first line that starts with "Status:" above the first "## " section,
 * or goes under the first "# " title with a blank line on each side, or at the top when there is no title. CRLF becomes LF.
 */
export function setAdrStatus(text, line) {
  const { lines, head, current } = statusPlace(text)
  if (current !== -1) {
    lines[current] = line
    return lines.join('\n')
  }
  const title = lines.slice(0, head).findIndex((item) => item.startsWith('# '))
  const at = title + 1
  let rest = at
  while (rest < lines.length && lines[rest].trim() === '') rest++
  const before = title === -1 ? [] : [...lines.slice(0, at), '']
  return [...before, line, '', ...lines.slice(rest)].join('\n')
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

  const trackerLabel = trackerDir ? (trackerFolder ?? 'docs/adr') : null
  const folders = adrFolders({ root, trackerDir, trackerFolder })
  if (trackerDir && !trackerFolder) notes.push(`the tracker folder is outside the repository, so ${ref} was not read for it and its paths are relative to the tracker folder`)

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
