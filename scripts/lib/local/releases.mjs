// Release files: releases/<id>.md. Reading, validating, ordering and serializing; the tracker decides when to write.

import { PmkitError } from '../errors.mjs'
import { stringifyYaml } from '../yaml.mjs'
import { parseFile } from './epics.mjs'
import { validDate, validTimestamp } from './sprints.mjs'

export { validMilestoneId as validReleaseId, milestoneStems as releaseStems } from './milestones.mjs'

const FILE_ORDER = ['name', 'tag', 'target', 'released']
const DOCTOR = '/pmkit:local:doctor'

/** Whether a string is a valid git tag name: the ref name rules of git check-ref-format, plus control characters. */
export const validTag = (tag) => typeof tag === 'string' && tag !== ''
  && !/[\s~^:?*[\\\x00-\x1f\x7f]/.test(tag) && !tag.includes('..') && !/^[-/]/.test(tag) && !/(\/|\.|\.lock)$/.test(tag)

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** Compares two strings run by run: digit runs as numbers, other runs as text. Fewer runs first on a shared start. */
function naturalCompare(a, b) {
  const runs = (text) => text.match(/\d+|\D+/g) ?? []
  const left = runs(a)
  const right = runs(b)
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const digits = /^\d/.test(left[i]) && /^\d/.test(right[i])
    const order = digits ? compareText(BigInt(left[i]), BigInt(right[i])) : compareText(left[i], right[i])
    if (order !== 0) return order
  }
  return left.length - right.length
}

/** Orders release ids by version: a leading v is dropped, a suffix after the first dash sorts before the plain version. */
export function compareReleaseIds(a, b) {
  const split = (id) => {
    const bare = id.replace(/^[vV]/, '')
    const dash = bare.indexOf('-')
    return dash === -1 ? { core: bare, suffix: null } : { core: bare.slice(0, dash), suffix: bare.slice(dash + 1) }
  }
  const left = split(a)
  const right = split(b)
  const cores = naturalCompare(left.core, right.core)
  if (cores !== 0) return cores
  if (left.suffix !== right.suffix) {
    if (left.suffix === null) return 1
    if (right.suffix === null) return -1
    const suffixes = naturalCompare(left.suffix, right.suffix)
    if (suffixes !== 0) return suffixes
  }
  return compareText(a, b)
}

/** Releases by version, oldest first. Returns a sorted copy. */
export const sortReleases = (list) => [...list].sort((a, b) => compareReleaseIds(a.id, b.id))

/**
 * Parses the text of releases/<id>.md. The file stem is the id. The state is computed: released
 * when the file has `released`, otherwise planned. Keys pmkit does not know go to `extra`.
 */
export function parseRelease(text, id) {
  const { data, body } = parseFile(text, `release ${id}`)
  const bad = (why) => new PmkitError('INVALID_INPUT', `release file ${id}.md ${why}`, DOCTOR)
  const name = data.name == null ? '' : String(data.name).trim()
  if (/[\r\n]/.test(name)) throw bad('has a name with a line break')
  const release = { id, name: name || id }
  if (data.tag != null) {
    if (typeof data.tag !== 'string') throw bad(`has tag ${data.tag}, which is not text. Put the tag in quotes`)
    const tag = data.tag
    if (!validTag(tag)) throw bad(`has tag "${tag}", expected a git tag name`)
    release.tag = tag
  }
  if (data.target != null) {
    const target = String(data.target)
    if (!validDate(target)) throw bad(`has target "${target}", expected a date as YYYY-MM-DD`)
    release.target = target
  }
  if (data.released != null) {
    if (!validTimestamp(data.released)) throw bad(`has released "${data.released}", expected a timestamp with a date, a time and a zone`)
    release.released = data.released
  }
  release.state = release.released ? 'released' : 'planned'
  release.description = body
  const extra = Object.fromEntries(Object.keys(data).filter((key) => key !== 'id' && !FILE_ORDER.includes(key)).map((key) => [key, data[key]]))
  if (Object.keys(extra).length > 0) release.extra = extra
  return release
}

/** The text of a release file: frontmatter, then the description after a blank line when there is one. */
export function serializeRelease({ name, tag, target, released, description, extra }) {
  const yaml = stringifyYaml({ ...extra, name, tag, target, released }, { order: FILE_ORDER })
  return `---\n${yaml}---\n${description ? `\n${description}\n` : ''}`
}
