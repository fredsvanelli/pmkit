// Epic files (epics/<ID>/epic.md) and status updates (epics/<ID>/updates/<date>-<author>.md).
// Pure reading, validating and serializing; the tracker decides when to write.

import { PmkitError } from '../errors.mjs'
import { compareIds } from '../ids.mjs'
import { compareTimes } from '../model.mjs'
import { FrontmatterError, joinFrontmatter, parseYaml, splitFrontmatter } from '../yaml.mjs'
import { hasConflictMarkers } from './issue-file.mjs'

export const HEALTH = ['on_track', 'at_risk', 'off_track']
export const EPIC_KEYS = ['id', 'title', 'status', 'start', 'target', 'milestone', 'goal']
const UPDATE_ORDER = ['author', 'created', 'health']
const DOCTOR = '/pmkit:local:doctor'

const normalize = (text) => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')

/** Splits a Markdown file with frontmatter into its data map and trimmed body. Throws CONFLICT or INVALID_INPUT with the doctor as next step. */
export function parseFile(text, label) {
  const normalized = normalize(text)
  if (hasConflictMarkers(normalized)) {
    throw new PmkitError('CONFLICT', `The ${label} file contains git conflict markers.`, DOCTOR)
  }
  const split = splitFrontmatter(normalized)
  if (!split) throw new PmkitError('INVALID_INPUT', `The ${label} file has no frontmatter.`, DOCTOR)
  let data
  try {
    data = parseYaml(split.yaml)
  } catch (error) {
    if (!(error instanceof FrontmatterError)) throw error
    throw new PmkitError('INVALID_INPUT', `The ${label} frontmatter does not parse: ${error.message}`, DOCTOR)
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new PmkitError('INVALID_INPUT', `The ${label} frontmatter is not a map.`, DOCTOR)
  }
  return { data, body: split.body.trim() }
}

export function parseEpicFile(text, { statuses = {} } = {}) {
  const { data, body } = parseFile(text, 'epic')
  const name = data.status == null ? '' : String(data.status)
  const epic = {
    id: String(data.id ?? ''),
    title: String(data.title ?? ''),
    status: { name, category: statuses[name]?.category ?? null },
  }
  for (const key of ['start', 'target', 'milestone', 'goal']) if (data[key] != null) epic[key] = String(data[key])
  epic.description = body
  return epic
}

/** The frontmatter values of an epic, keyed as written to the file. */
export const epicFrontmatter = (epic) => ({
  id: epic.id, title: epic.title, status: epic.status.name, start: epic.start, target: epic.target, milestone: epic.milestone, goal: epic.goal,
})

export const serializeEpic = (epic) =>
  joinFrontmatter(epicFrontmatter(epic), epic.description ? `${epic.description}\n` : '', { order: EPIC_KEYS })

export function parseUpdateFile(text, epic) {
  const { data, body } = parseFile(text, 'status update')
  return { epic, at: String(data.created ?? ''), author: String(data.author ?? ''), health: String(data.health ?? ''), body }
}

export const serializeUpdate = (update) =>
  joinFrontmatter({ author: update.author, created: update.at, health: update.health }, `${update.body}\n`, { order: UPDATE_ORDER })

/**
 * Epics by start date, then creation time, then id. An epic without a start goes last.
 * `created` maps an epic id to the time of its `create` event.
 */
export function sortEpics(epics, created = {}) {
  const key = (epic) => epic.start ?? '￿'
  return [...epics].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)
    || compareTimes(created[a.id], created[b.id])
    || compareIds(a.id, b.id))
}

/** Entries are `{ name, update }`, newest update first. Same-second updates fall back to the file name, where `-2` comes after the plain name. */
export function sortUpdates(entries) {
  return [...entries].sort((a, b) => {
    if (a.update.at !== b.update.at) return a.update.at > b.update.at ? -1 : 1
    return b.name.length - a.name.length || (b.name < a.name ? -1 : b.name > a.name ? 1 : 0)
  })
}

/**
 * Follows `parentOf` upward from `from`. `chain` starts with `from` and ends at the top, or at
 * the first node seen twice (`loop` is true). `parentOf` returns undefined where the chain ends.
 */
export function walkParents(from, parentOf) {
  const chain = [from]
  const seen = new Set(chain)
  for (let current = from; ;) {
    const up = parentOf(current)
    if (up === undefined || up === null) return { chain, loop: false }
    chain.push(up)
    if (seen.has(up)) return { chain, loop: true }
    seen.add(up)
    current = up
  }
}
