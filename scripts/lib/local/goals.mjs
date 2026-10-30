// Goal files: goals/<ID>.md, a strategic goal that epics link to through their `goal` key.
// Reading, validating, ordering and serializing; the tracker decides when to write.

import fs from 'node:fs'
import { PmkitError } from '../errors.mjs'
import { compareIds } from '../ids.mjs'
import { stringifyYaml } from '../yaml.mjs'
import { parseFile } from './epics.mjs'
import { validDate } from './sprints.mjs'

/** Goal ids are GOAL- and a code that follows id_style, as in GOAL-7K3Q or GOAL-1. */
export const GOAL_PREFIX = 'GOAL'
const FILE_ORDER = ['title', 'target']
const DOCTOR = '/pmkit:local:doctor'

/** The stems of the `.md` files in a goals folder, as stored. A missing folder gives an empty set. */
export function goalStems(dir) {
  if (!fs.existsSync(dir)) return new Set()
  return new Set(fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name.slice(0, -'.md'.length)))
}

/** Parses the text of goals/<id>.md. The file stem is the id, so an `id` key in the frontmatter is ignored. */
export function parseGoal(text, id) {
  const { data, body } = parseFile(text, `goal ${id}`)
  const bad = (why) => new PmkitError('INVALID_INPUT', `goal file ${id}.md ${why}`, DOCTOR)
  const title = data.title == null ? '' : String(data.title).trim()
  if (title === '') throw bad('needs a title')
  if (/[\r\n]/.test(title)) throw bad('has a title with a line break')
  const goal = { id, title }
  if (data.target != null) {
    const target = String(data.target)
    if (!validDate(target)) throw bad(`has target "${target}", expected a date as YYYY-MM-DD`)
    goal.target = target
  }
  goal.description = body
  return goal
}

/** The text of a goal file. The body is the description, left out when it is empty. */
export function serializeGoal({ title, target, description }) {
  const head = `---\n${stringifyYaml({ title, target }, { order: FILE_ORDER })}---\n`
  return description ? `${head}\n${description}\n` : head
}

/** Goals by target date, then id. A goal without a target goes last. */
export function sortGoals(list) {
  const key = (goal) => goal.target ?? '￿'
  return [...list].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) || compareIds(a.id, b.id))
}
