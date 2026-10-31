// The next ADR: its number, slug and path. `docs next-adr` reads, this file computes. See
// docs/superpowers/specs/2026-10-31-pmk-65-record-decision-design.md.

import fs from 'node:fs'
import path from 'node:path'
import { PmkitError } from './errors.mjs'

export const ADR_SLUG_MAX = 60
// A name counts when it starts with four or more digits and a non-digit follows, so 0007a-x.md counts as 7.
const NUMBERED = /^(\d{4,})(?=\D)[^/]*\.md$/
const QUOTES = /['"`‘’“”]/g

/**
 * The file-name part of an ADR title: lowercase `[a-z0-9-]`, accents transliterated, quotes dropped, every other
 * run of characters a single hyphen, at most ADR_SLUG_MAX characters and cut at a word boundary.
 * A title with nothing left is refused.
 */
export function adrSlug(title) {
  if (typeof title !== 'string') throw new PmkitError('INVALID_INPUT', 'the ADR title must be a string', 'Pass --title with the decision title')
  const slug = title.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(QUOTES, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (slug === '') throw new PmkitError('INVALID_INPUT', `the title "${title}" has no letter or digit to make a file name from`, 'Pass --title with words, for example "Use event files as the audit log"')
  if (slug.length <= ADR_SLUG_MAX) return slug
  const head = slug.slice(0, ADR_SLUG_MAX)
  const cut = slug[ADR_SLUG_MAX] === '-' || !head.includes('-') ? head : head.slice(0, head.lastIndexOf('-'))
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

  const trackerLabel = trackerDir ? (trackerFolder ?? trackerDir.split(path.sep).join('/')) : null
  const folders = [{ place: 'repo', label: 'docs/adr', dir: path.join(root, 'docs', 'adr'), repoFolder: 'docs/adr' }]
  if (trackerDir) folders.push({ place: 'tracker', label: trackerLabel, dir: trackerDir, repoFolder: trackerFolder })
  if (trackerDir && !trackerFolder) notes.push(`the tracker folder is outside the repository, so ${ref} was not read for it`)

  const sources = []
  for (const { place, label, dir, repoFolder } of folders) {
    const entries = readTree(dir)
    const direct = entries?.filter((name) => !name.endsWith('/')) ?? []
    const dirs = entries?.filter((name) => name.endsWith('/')) ?? []
    const tree = highestAdr(direct)
    sources.push({ place, folder: label, where: 'working tree', exists: entries !== null, highest: tree.highest, files: direct.length })
    ignored.push(...tree.ignored.map((name) => `${label}/${name}`), ...dirs.map((name) => `${label}/${name}`))
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
  if (other.length > 0) notes.push(`${[...new Set(other.map((source) => source.folder))].join(' and ')} also has ADRs, and the number counts them`)
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
