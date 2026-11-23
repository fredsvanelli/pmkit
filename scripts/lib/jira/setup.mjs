// Jira's side of setup: what init --tracker jira applies, asks and finds broken for one site and one space.
// See docs/superpowers/specs/2026-11-22-pmk-365-setup-pmkit-on-jira-design.md, "The proposal rules".
// A question has the shape of scripts/lib/mappings.mjs (path, flag, candidates, recommended, none, broken), plus titles
// for the space and field questions, so /pmkit:setup asks Jira's questions as it asks Linear's and GitHub's.

import { PmkitError } from '../errors.mjs'
import { NONE, checkKeys, keysOf, mapsOf } from '../mappings.mjs'
import { fieldRoles } from './discovery.mjs'
import { brokenJiraMappings } from './mappings.mjs'

export const SPACE_PATH = 'tracker.scope.space'
// todo, in_progress and done come from the Jira status categories; blocked comes from Blocks links (Interview Q1).
const STATUS_KEYS = ['backlog', 'in_review', 'canceled']
// The roles the Jira code reads through mappings.fields (Interview Q2).
const FIELD_KEYS = ['estimate', 'acceptance_criteria']
const CATEGORY_ORDER = ['new', 'indeterminate', 'done']

// Names that setup recommends, compared without case. The first match wins.
const STATUS_MATCHES = {
  backlog: ['backlog'],
  in_review: ['in review', 'review', 'code review'],
  canceled: ['canceled', 'cancelled', "won't do", 'declined'],
}
const TYPE_MATCHES = { feature: ['story', 'feature'], bug: ['bug'], task: ['task'], chore: ['chore', 'task'] }

// The fields that can hold each asked role. A held role outside these may name any field.
const FIELD_FITS = {
  estimate: (field) => (field.type === 'number' && field.customType !== null) || field.id === 'timeoriginalestimate',
  acceptance_criteria: (field) => field.type === 'string' && field.customType !== null,
}

const words = (key) => key.replace(/_/g, ' ')
const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
const isSet = (value) => typeof value === 'string' && value !== ''
const pass = (candidates) => `Pass one of: ${[...candidates, NONE].join(', ')}`

/** The first of `names` that matches one of `wanted`, without case, or undefined. */
const matchOf = (wanted = [], names) => wanted.map((name) => names.find((value) => value.toLowerCase() === name)).find((found) => found !== undefined)

const recommendedFirst = (names, recommended) => (recommended !== undefined ? [recommended, ...names.filter((name) => name !== recommended)] : [...names])

/**
 * The space setup uses: the answer, else the held value, else a question. spaces is [{ key, name }] from the discovery;
 * heldMissing says the held space could not be read. Returns { value } or { question, broken }.
 */
export function proposeSpace({ answer, held, heldMissing = false, spaces = [], site = 'the site' } = {}) {
  const keys = spaces.map((space) => space.key)
  if (answer !== undefined) {
    if (keys.length > 0 && !keys.includes(answer)) throw invalid(`--space ${answer} is not a space of this site`, `Pass one of: ${keys.join(', ')}`)
    return { value: answer }
  }
  if (isSet(held) && !heldMissing) return { value: held }
  const question = {
    path: SPACE_PATH,
    flag: '--space <KEY>',
    candidates: keys,
    titles: Object.fromEntries(spaces.map((space) => [space.key, space.name])),
    recommended: keys.length === 1 ? keys[0] : null,
    none: null,
    required: true,
  }
  const broken = []
  if (isSet(held) && heldMissing) {
    const problem = `${SPACE_PATH} names ${held}, which ${site} does not have or the token's owner cannot browse`
    question.broken = { was: held, problem }
    broken.push({ path: SPACE_PATH, value: held, problem })
  }
  return { question, broken }
}

/** The held value when it is set and not broken; otherwise it records the question, with the broken item when there is one. */
function heldOr(state, path, value, question) {
  const item = state.brokenAt.get(path)
  if (isSet(value) && !item) return value
  if (item) question.broken = { was: item.value, problem: item.problem }
  state.questions.push(question)
  return undefined
}

/** Refuses one value that answers two keys of a group; the next step lists the candidates no key took. */
function refuseShared(values, what, candidates) {
  const usedBy = new Map()
  const taken = new Set(Object.values(values))
  for (const [key, value] of Object.entries(values)) {
    if (value === NONE) continue
    if (usedBy.has(value)) throw invalid(`${what} ${value} cannot answer both ${usedBy.get(value)} and ${key}`, pass(candidates.filter((name) => !taken.has(name))))
    usedBy.set(value, key)
  }
}

/**
 * What setup applies and asks for the statuses, the field roles and the types, once the space is known.
 * raw is fetchDiscovery's result. current is what the file holds: { status, fields, types }. answers is what the flags gave:
 * { status, fields, types }. types is the repository's pmkit type list. Returns { applied, questions, broken, notes, values }.
 * values.types is left out while a type is still a question.
 */
export function proposeJiraSetup(raw, current = {}, answers = {}, types = []) {
  const held = { ...mapsOf(current, ['status', 'fields']), types: current.types }
  const given = mapsOf(answers, ['status', 'fields', 'types'])
  // A held blocked is left as it is: setup neither asks nor checks it.
  const statusKeys = keysOf(STATUS_KEYS, held.status).filter((key) => key !== 'blocked')
  const fieldKeys = keysOf(FIELD_KEYS, held.fields)
  const typeKeys = keysOf(types, held.types)
  checkKeys(given.status, statusKeys, '--status')
  checkKeys(given.fields, fieldKeys, '--field')
  checkKeys(given.types, typeKeys, '--type-label')

  const pmkit = { mappings: { status: held.status, fields: held.fields, ...(held.types === undefined ? {} : { types: held.types }) } }
  const broken = brokenJiraMappings(raw, pmkit).map(({ key, value, problem }) => ({ path: key, value, problem }))
  const state = { raw, held, given, applied: [], questions: [], broken, notes: [], brokenAt: new Map(broken.map((item) => [item.path, item])), rules: fieldRoles(raw, {}).fields, statusNames: statusNames(raw) }
  const values = { status: {}, fields: {} }

  // A recommendation skips a value an earlier key already got as its answer, held value or recommendation.
  const taken = new Set()
  for (const key of statusKeys) {
    const value = statusValue(state, key, taken)
    if (value !== undefined) values.status[key] = value
  }
  refuseShared(values.status, 'status', state.statusNames)
  for (const key of fieldKeys) {
    const value = fieldValue(state, key)
    if (value !== undefined) values.fields[key] = value
  }
  const typeValues = typesOf(state, typeKeys)
  if (typeValues !== undefined) values.types = typeValues
  return { applied: state.applied, questions: state.questions, broken: state.broken, notes: state.notes, values }
}

/** The space's status names, in Jira category order (to do, in progress, done), each category in discovery order. */
function statusNames(raw) {
  const rank = (status) => (CATEGORY_ORDER.includes(status.categoryKey) ? CATEGORY_ORDER.indexOf(status.categoryKey) : CATEGORY_ORDER.length)
  return [...raw.statuses].sort((a, b) => rank(a) - rank(b)).map((status) => status.name)
}

/** The status of one key: the answer, the held value, or undefined with a question recorded. taken gathers the values so far. */
function statusValue(state, key, taken) {
  const names = state.statusNames
  const answer = state.given.status[key]
  if (answer !== undefined) {
    if (answer !== NONE && !names.includes(answer)) throw invalid(`--status ${key}=${answer} is not a status of space ${state.raw.space.key}`, pass(names))
    taken.add(answer)
    return answer
  }
  const match = matchOf(STATUS_MATCHES[key], names.filter((name) => !taken.has(name)))
  taken.add(match ?? state.held.status[key])
  const question = {
    path: `mappings.status.${key}`,
    flag: `--status ${key}=<value>`,
    candidates: recommendedFirst(names, match),
    recommended: match ?? NONE,
    none: `No status means ${words(key)}`,
  }
  return heldOr(state, question.path, state.held.status[key], question)
}

/** The field id of one role: the answer, the held value, the only fitting field, or undefined with a question or a note recorded. */
function fieldValue(state, key) {
  const path = `mappings.fields.${key}`
  const fields = state.raw.fields.filter(FIELD_FITS[key] ?? (() => true))
  const ids = fields.map((field) => field.id)
  const answer = state.given.fields[key]
  if (answer !== undefined) {
    if (answer !== NONE && !ids.includes(answer)) throw invalid(`--field ${key}=${answer} is not a field that can hold the ${words(key)}`, pass(ids))
    return answer
  }
  const rule = state.rules[key]?.id
  const match = ids.includes(rule) ? rule : undefined
  const question = {
    path,
    flag: `--field ${key}=<value>`,
    candidates: recommendedFirst(ids, match),
    titles: Object.fromEntries(fields.map((field) => [field.id, field.name])),
    recommended: match ?? NONE,
    none: `No field holds the ${words(key)}`,
  }
  const held = state.held.fields[key]
  if (isSet(held) || state.brokenAt.has(path)) return heldOr(state, path, held, question)
  if (ids.length === 1 && match !== undefined) {
    state.applied.push({ path, value: match, reason: 'the site offers only this field' })
    return match
  }
  if (ids.length === 0) {
    state.notes.push(`the site has no field for the ${words(key)}`)
    return undefined
  }
  state.questions.push(question)
  return undefined
}

/** The work type of one pmkit type: the answer, the held value, none, or undefined when asked. taken gathers the values so far. */
function typeValue(state, type, names, taken) {
  const path = `mappings.types.${type}`
  const answer = state.given.types[type]
  if (answer !== undefined) {
    if (answer !== NONE && !names.includes(answer)) throw invalid(`--type-label ${type}=${answer} is not a work type of space ${state.raw.space.key}`, pass(names))
    taken.add(answer)
    return answer
  }
  const held = state.held.types?.[type]
  // A types object without this type means it was answered none.
  if (state.held.types !== undefined && !isSet(held) && !state.brokenAt.has(path)) return NONE
  const match = matchOf(TYPE_MATCHES[type] ?? [type.toLowerCase()], names.filter((name) => !taken.has(name)))
  taken.add(match ?? held)
  const question = {
    path,
    flag: `--type-label ${type}=<work type>`,
    candidates: recommendedFirst(names, match),
    recommended: match ?? NONE,
    none: 'No work type stands for this type',
  }
  return heldOr(state, path, held, question)
}

/**
 * The types object, or undefined while a type is still a question. Candidates are the space's standard work types: an epic is
 * no pmkit type and a sub-task needs a parent. One work type answers at most one pmkit type.
 */
function typesOf(state, typeKeys) {
  const names = state.raw.workTypes.filter((type) => type.level === 'standard').map((type) => type.name)
  const values = {}
  const taken = new Set()
  let pending = false
  for (const type of typeKeys) {
    const value = typeValue(state, type, names, taken)
    if (value === undefined) pending = true
    else values[type] = value
  }
  refuseShared(values, 'work type', names)
  if (pending) return undefined
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== NONE))
}
