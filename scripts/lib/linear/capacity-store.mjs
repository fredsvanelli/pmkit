// Capacity and days off of Linear cycles, kept in the committed file .pmkit/capacity.yaml (Unified model, Q5: local context).
// Linear has no such field. The validators are the Local tracker's, so a sprint file and this file accept the same data.
// See docs/superpowers/specs/2026-10-28-pmk-37-linear-cycles-to-sprints-design.md, "Capacity in local context".

import fs from 'node:fs'
import path from 'node:path'
import { PmkitError } from '../errors.mjs'
import { requireCapacity, requireDaysOff, validDate } from '../local/sprints.mjs'
import { writeFileAtomic } from '../local/store.mjs'
import { parseYaml, stringifyYaml } from '../yaml.mjs'

export const CAPACITY_FILE = '.pmkit/capacity.yaml'
const VERSION = 1
const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const notValid = (why) => new PmkitError('INVALID_INPUT', `${CAPACITY_FILE} is not valid: ${why}`, 'Fix or delete the file')
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const byNumber = (a, b) => Number(a) - Number(b)

/** The entry of one cycle as { capacity, daysOff }, checking the shape of what the file holds. */
function checkEntry(entry, where) {
  if (!isMap(entry)) throw notValid(`${where} is not a map`)
  const capacity = entry.capacity ?? {}
  const daysOff = entry.days_off ?? {}
  if (!isMap(capacity)) throw notValid(`${where} capacity is not a map`)
  if (!isMap(daysOff)) throw notValid(`${where} days_off is not a map`)
  for (const [member, amount] of Object.entries(capacity)) {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) throw notValid(`${where} capacity for ${member} is not a non-negative number`)
  }
  for (const [member, dates] of Object.entries(daysOff)) {
    if (!Array.isArray(dates) || !dates.every(validDate)) throw notValid(`${where} days_off for ${member} is not a list of dates`)
  }
  return { capacity: { ...capacity }, daysOff: Object.fromEntries(Object.entries(daysOff).map(([member, dates]) => [member, [...dates]])) }
}

/** The whole file as { team: { cycleId: { capacity, daysOff } } }. A missing file is an empty map. */
function readFile(root) {
  let content
  try {
    content = fs.readFileSync(path.join(root, CAPACITY_FILE), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
  return parseFile(content)
}

/** The text of the file as { team: { cycleId: { capacity, daysOff } } }, with every check of a read. */
function parseFile(content) {
  let data
  try {
    data = parseYaml(content.replace(/^\uFEFF/, ''))
  } catch (error) {
    throw notValid(`it does not parse: ${error.message}`)
  }
  if (!isMap(data)) throw notValid('it is not a map')
  if (data.version !== VERSION) throw notValid(`version is ${JSON.stringify(data.version)}, expected ${VERSION}`)
  const cycles = data.cycles ?? {}
  if (!isMap(cycles)) throw notValid('cycles is not a map')
  const teams = {}
  for (const [team, entries] of Object.entries(cycles)) {
    if (!isMap(entries)) throw notValid(`cycles.${team} is not a map`)
    teams[team] = Object.fromEntries(Object.entries(entries).map(([id, entry]) => [id, checkEntry(entry, `cycles.${team}.${id}`)]))
  }
  return teams
}

const isEmptyEntry = (entry) => Object.keys(entry.capacity).length === 0 && Object.keys(entry.daysOff).length === 0
const sortedMap = (map) => Object.fromEntries(Object.entries(map).sort(([a], [b]) => byText(a, b)))

/** The text of the file for { team: { cycleId: entry } }: fixed key order, cycle ids in numeric order, empty entries left out. */
function serialize(teams) {
  const cycles = {}
  for (const team of Object.keys(teams).sort(byText)) {
    const entries = {}
    for (const id of Object.keys(teams[team]).sort(byNumber)) {
      const entry = teams[team][id]
      if (isEmptyEntry(entry)) continue
      entries[id] = {
        capacity: sortedMap(entry.capacity),
        days_off: Object.fromEntries(Object.entries(sortedMap(entry.daysOff)).map(([member, dates]) => [member, [...dates].sort()])),
      }
    }
    if (Object.keys(entries).length > 0) cycles[team] = entries
  }
  return stringifyYaml({ version: VERSION, cycles }, { order: ['version', 'cycles'] })
}

/** The entries of one team: { cycleId: { capacity, daysOff } }. Throws INVALID_INPUT for a file that is not valid. */
export const readCapacity = (root, team) => readFile(root)[team] ?? {}

/** The entry of a cycle, empty when the file has none. */
export const entryFor = (entries, id) => entries[id] ?? { capacity: {}, daysOff: {} }

/**
 * Changes the entry of one cycle and returns { before, after }. `capacity` replaces the whole map; `daysOff` merges per member,
 * and a member set to null loses their days off. `sprint` is { start, end } for the date check, `members` the member ids.
 * A file that is not valid is never overwritten. A dry run builds `after` and writes nothing.
 */
export function writeEntry(root, team, id, { capacity, daysOff }, { sprint, members, dryRun = false }) {
  const teams = readFile(root)
  const before = entryFor(teams[team] ?? {}, id)
  const known = Object.fromEntries(members.map((member) => [member, true]))
  const after = { capacity: { ...before.capacity }, daysOff: { ...before.daysOff } }
  if (capacity !== undefined) after.capacity = requireCapacity(capacity, known)
  if (daysOff !== undefined) {
    for (const [member, dates] of Object.entries(requireDaysOff(daysOff, known, sprint))) {
      if (dates === null) delete after.daysOff[member]
      else after.daysOff[member] = dates
    }
  }
  const content = serialize({ ...teams, [team]: { ...teams[team], [id]: after } })
  // The text must pass the full read, as the Local tracker parses its sprint files before it writes them.
  try {
    parseFile(content)
  } catch (error) {
    if (!(error instanceof PmkitError)) throw error
    throw new PmkitError('INVALID_INPUT', `the capacity file would not read back after this write: ${error.message}`)
  }
  if (!dryRun) {
    const target = path.join(root, CAPACITY_FILE)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    // Writes a temporary file and renames it, and removes the temporary file when either step fails.
    writeFileAtomic(target, content)
  }
  return { before, after }
}
