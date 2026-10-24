// Sprint files: sprints/<start date>.yaml. Pure reading, validating and serializing; the tracker decides when to write.

import fs from 'node:fs'
import path from 'node:path'
import { PmkitError } from '../errors.mjs'
import { parseYaml, stringifyYaml } from '../yaml.mjs'

export const SPRINT_STATES = ['planned', 'active', 'closed']
const FILE_ORDER = ['name', 'start', 'end', 'goal', 'state', 'capacity', 'days_off']
const DOCTOR = '/pmkit:local:doctor'

export const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)

export function validDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text)
}

export function addDays(date, days) {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Parses the text of sprints/<id>.yaml. A text that does not parse or lacks a start, end or state throws INVALID_INPUT. */
export function parseSprint(text, id) {
  const bad = (why) => invalid(`sprint file ${id}.yaml ${why}`, DOCTOR)
  let data
  try {
    data = parseYaml(text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'))
  } catch (error) {
    throw bad(`does not parse: ${error.message}`)
  }
  if (!isMap(data)) throw bad('is not a map')
  if (!validDate(data.start)) throw bad('has no valid start date')
  if (!validDate(data.end)) throw bad('has no valid end date')
  if (!SPRINT_STATES.includes(data.state)) throw bad(`has state "${data.state}", expected one of ${SPRINT_STATES.join(', ')}`)
  const sprint = {
    id,
    name: typeof data.name === 'string' ? data.name : `Sprint ${id}`,
    start: data.start,
    end: data.end,
    goal: typeof data.goal === 'string' ? data.goal : '',
    state: data.state,
    capacity: isMap(data.capacity) ? data.capacity : {},
    daysOff: isMap(data.days_off) ? data.days_off : {},
  }
  // Keys pmkit does not know are kept so the next write does not drop them.
  const unknown = Object.keys(data).filter((key) => !FILE_ORDER.includes(key))
  if (unknown.length > 0) sprint.extra = Object.fromEntries(unknown.map((key) => [key, data[key]]))
  return sprint
}

export const readSprint = (dir, id) => parseSprint(fs.readFileSync(path.join(dir, `${id}.yaml`), 'utf8'), id)

export function readSprints(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.yaml'))
    .map((name) => readSprint(dir, path.basename(name, '.yaml')))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function serializeSprint(sprint) {
  const { id, daysOff, extra, ...rest } = sprint
  return stringifyYaml({ ...extra, ...rest, days_off: daysOff }, { order: FILE_ORDER })
}

export function requireCapacity(value, members) {
  if (!isMap(value)) throw invalid('capacity must be a map of member to number')
  for (const [member, amount] of Object.entries(value)) {
    if (!Object.hasOwn(members, member)) throw invalid(`capacity member "${member}" is not a member`, `Use one of: ${Object.keys(members).join(', ')}`)
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) throw invalid(`capacity for ${member} must be a non-negative number`)
  }
  return { ...value }
}

export const overlaps = (a, b) => a.start <= b.end && b.start <= a.end
