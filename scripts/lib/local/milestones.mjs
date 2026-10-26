// Milestone files: milestones/<id>.md. Reading, validating and serializing; the tracker decides when to write.

import fs from 'node:fs'
import { PmkitError } from '../errors.mjs'
import { stringifyYaml } from '../yaml.mjs'
import { parseFile } from './epics.mjs'
import { validDate } from './sprints.mjs'

const FILE_ORDER = ['name', 'due']
const DOCTOR = '/pmkit:local:doctor'

/** An id starts and ends with a letter or digit and holds only letters, digits, `.`, `_` and `-`. */
export const validMilestoneId = (id) => typeof id === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(id)

/**
 * The stems of the `.md` files in a milestones folder, as stored. Folders and other files do not
 * count. Matching against these, rather than fs.existsSync, keeps ids case-sensitive on file
 * systems that are not. A missing folder gives an empty set.
 */
export function milestoneStems(dir) {
  if (!fs.existsSync(dir)) return new Set()
  return new Set(fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name.slice(0, -'.md'.length)))
}

/** Whether a milestones folder holds a `.md` file. Milestone references are checked only then. */
export const hasMilestoneFiles = (dir) => milestoneStems(dir).size > 0

/**
 * Parses the text of milestones/<id>.md. The file stem is the id, so an `id` key in the
 * frontmatter is ignored, as is every other key pmkit does not know.
 */
export function parseMilestone(text, id) {
  const { data, body } = parseFile(text, `milestone ${id}`)
  const bad = (why) => new PmkitError('INVALID_INPUT', `milestone file ${id}.md ${why}`, DOCTOR)
  const name = data.name == null ? '' : String(data.name).trim()
  if (/[\r\n]/.test(name)) throw bad('has a name with a line break')
  const milestone = { id, name: name || id }
  if (data.due != null) {
    const due = String(data.due)
    if (!validDate(due)) throw bad(`has due "${due}", expected a date as YYYY-MM-DD`)
    milestone.due = due
  }
  milestone.description = body
  return milestone
}

/** The text of a milestone file: frontmatter only, as `milestone create` writes no body. */
export const serializeMilestone = ({ name, due }) => `---\n${stringifyYaml({ name, due }, { order: FILE_ORDER })}---\n`

/** Milestones by due date, then id. A milestone without a due date goes last. */
export function sortMilestones(list) {
  const key = (milestone) => milestone.due ?? '￿'
  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  return [...list].sort((a, b) => compare(key(a), key(b)) || compare(a.id, b.id))
}
