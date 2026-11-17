// GitHub's side of the mappings: the field source format, the mapping check, and what setup applies and asks.
// See docs/specs/2026-11-16-pmk-86-github-discovery-and-setup-design.md, "Decisions from the user" and "Setup".
// A question has the shape of scripts/lib/mappings.mjs (path, flag, candidates, recommended, none, broken), so /pmkit:setup
// asks GitHub's questions as it asks Linear's. required: true marks a question that takes no none.

import { PmkitError } from '../errors.mjs'
import { NONE } from '../mappings.mjs'

export { NONE }

export const PROJECT_PATH = 'tracker.scope.project'
export const STATUS_KEYS = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'blocked']
export const REQUIRED_STATUS = ['todo', 'in_progress', 'done']
// Without a Project, setup asks a label for these categories. todo, done and canceled come from open and closed.
export const LABEL_STATUS_KEYS = ['triage', 'backlog', 'in_progress', 'in_review']
const STATE_KEYS = ['todo', 'done', 'canceled', 'blocked']
export const FIELD_ROLES = ['priority', 'estimate', 'start_date', 'target_date', 'sprint']

const FIELD_TYPES = { priority: ['SINGLE_SELECT'], estimate: ['NUMBER', 'SINGLE_SELECT'], start_date: ['DATE'], target_date: ['DATE'], sprint: ['ITERATION'] }

// Names that setup recommends, compared without case. The first match wins.
const MATCHES = {
  triage: ['triage', 'needs triage'],
  backlog: ['backlog'],
  todo: ['todo', 'to do', 'ready'],
  in_progress: ['in progress', 'doing'],
  in_review: ['in review', 'review'],
  done: ['done', 'closed'],
  canceled: ['canceled', 'cancelled', "won't do"],
  blocked: ['blocked'],
  priority: ['priority'],
  estimate: ['effort', 'estimate', 'story points', 'points', 'size'],
  start_date: ['start date', 'start'],
  target_date: ['target date', 'due date', 'end date'],
  sprint: ['iteration', 'sprint'],
}

const words = (key) => key.replace(/_/g, ' ')
const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
const isSet = (value) => typeof value === 'string' && value !== ''

export const LABEL_PREFIX = 'label:'

/** The label name of a label:<name> value, trimmed, or null for any other value. */
export function parseLabelValue(value) {
  if (typeof value !== 'string' || !value.startsWith(LABEL_PREFIX)) return null
  const name = value.slice(LABEL_PREFIX.length).trim()
  return name === '' ? null : name
}

/** The { id, name } of a repository label, compared without case as GitHub keeps label names unique without case, or null. */
export function labelOf(raw, name) {
  const wanted = String(name).toLowerCase()
  const found = (raw.labels ?? []).find((label) => label.name.toLowerCase() === wanted)
  return found ? { id: found.id, name: found.name } : null
}

/** { source: issue|project|none, name } of a mappings.fields value, or null when it has another shape. */
export function parseFieldSource(value) {
  if (value === NONE) return { source: NONE, name: null }
  if (typeof value !== 'string') return null
  const colon = value.indexOf(':')
  if (colon < 0) return null
  const source = value.slice(0, colon)
  const name = value.slice(colon + 1)
  if ((source !== 'issue' && source !== 'project') || name.trim() === '') return null
  return { source, name }
}

const projectId = (raw) => (raw.project ? `${raw.project.owner}/${raw.project.number}` : null)
const statusOptionsOf = (raw) => raw.project?.fields.find((item) => item.name === 'Status' && item.dataType === 'SINGLE_SELECT')?.options.map((item) => item.name) ?? []

/** The issue field or Project field a mappings.fields value names, or null. */
export function fieldOf(raw, value) {
  const parsed = parseFieldSource(value)
  if (!parsed || parsed.source === NONE) return null
  const list = parsed.source === 'issue' ? raw.issueFields : (raw.project?.fields ?? [])
  return list.find((item) => item.name === parsed.name) ?? null
}

/** The scope Project's iteration field that mappings.fields.sprint names as project:<name>, with its configuration, or null. */
export function iterationFieldOf(raw, pmkit) {
  const parsed = parseFieldSource(pmkit?.mappings?.fields?.sprint)
  if (parsed?.source !== 'project') return null
  return raw.project?.fields.find((item) => item.name === parsed.name && item.dataType === 'ITERATION') ?? null
}

/**
 * Why mappings.fields.sprint names no iteration field, or null: an issue field, or a Project field of another type. A Project field
 * GitHub no longer has is left to the general field rule. Any other path is null.
 */
function sprintProblem(raw, path, value) {
  if (path !== 'mappings.fields.sprint') return null
  const { source } = parseFieldSource(value)
  const issueField = source === 'issue'
  const projectFieldRead = source === 'project' && raw.project !== null
  const iterationField = projectFieldRead && iterationFieldOf(raw, { mappings: { fields: { sprint: value } } }) !== null
  const otherProjectField = projectFieldRead && !iterationField && fieldOf(raw, value) !== null
  return issueField || otherProjectField ? `${path} must name a Project iteration field` : null
}

/** Why a held value is broken, or null when GitHub still has what it names. */
function problemOf(raw, path, value) {
  const group = path.split('.')[1]
  const label = parseLabelValue(value)
  const missingLabel = () => (labelOf(raw, label) ? null : `${path} names label ${label}, which ${raw.repo} no longer has`)
  if (group === 'status') {
    if (raw.project === null) return label ? missingLabel() : `${path} names Status option ${value}, but tracker.scope.project is none`
    if (label) return `${path} names label ${label}, but statuses come from the Status field of ${projectId(raw)}`
    if (statusOptionsOf(raw).includes(value)) return null
    return `${path} names ${value}, which the Status field of ${projectId(raw)} no longer has`
  }
  if (group === 'fields') {
    const parsed = parseFieldSource(value)
    if (!parsed) return `${path} is ${value}, which is not issue:<name>, project:<name> or none`
    const sprint = sprintProblem(raw, path, value)
    if (sprint) return sprint
    if (parsed.source === NONE || fieldOf(raw, value)) return null
    if (parsed.source === 'issue') return `${path} names issue field ${parsed.name}, which ${raw.repo} no longer has`
    if (raw.project === null) return `${path} names Project field ${parsed.name}, but tracker.scope.project is none`
    return `${path} names Project field ${parsed.name}, which ${projectId(raw)} no longer has`
  }
  if (group === 'types') {
    if (label) return raw.issueTypes.length > 0 ? `${path} names label ${label}, but ${raw.repo} has issue types` : missingLabel()
    return raw.issueTypes.some((type) => type.name === value) ? null : `${path} names issue type ${value}, which ${raw.repo} does not have enabled`
  }
  return null
}

/** Each mapping in config.pmkit that names something GitHub no longer has, as [{ path, value, problem }]. none never breaks. */
export function brokenGithubMappings(raw, pmkit) {
  const items = []
  for (const group of ['status', 'fields', 'types']) {
    for (const [key, value] of Object.entries(pmkit?.mappings?.[group] ?? {})) {
      if (!isSet(value) || value === NONE) continue
      const path = `mappings.${group}.${key}`
      const problem = problemOf(raw, path, value)
      if (problem) items.push({ path, value, problem })
    }
  }
  return items
}

/** The value of `names` that matches one of the key's names, without case, or undefined. */
function matchOf(key, names, nameOf = (value) => value) {
  for (const wanted of MATCHES[key] ?? []) {
    const found = names.find((value) => nameOf(value).toLowerCase() === wanted)
    if (found !== undefined) return found
  }
  return undefined
}

const recommendedFirst = (names, recommended) => (recommended !== undefined && names.includes(recommended) ? [recommended, ...names.filter((name) => name !== recommended)] : [...names])

/**
 * The Project setup uses: the answer, else the held value, else a question.
 * linked is [{ id: owner/number, title }] from fetchLinkedProjects; linkedError the PmkitError that read threw (AUTH).
 * heldMissing says the held Project could not be read. Returns { value } or { question, broken }.
 */
export function proposeProject({ answer, held, heldMissing = false, linked = [], linkedError = null } = {}) {
  const valid = (value) => value === NONE || /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[1-9]\d*$/.test(value)
  if (answer !== undefined) {
    if (!valid(answer)) throw invalid(`--project ${answer} is not owner/number or none`, 'Pass --project <owner>/<number>, such as acme/7, or --project none')
    return { value: answer }
  }
  if (isSet(held) && valid(held) && !heldMissing) return { value: held }
  const question = {
    path: PROJECT_PATH,
    flag: '--project <owner/number>',
    candidates: linked.map((item) => item.id),
    titles: Object.fromEntries(linked.map((item) => [item.id, item.title])),
    recommended: linked.length === 1 ? linked[0].id : null,
    none: 'No Project',
  }
  if (linkedError) {
    question.recommended = NONE
    question.note = `Setup could not list the Projects of this repository: ${linkedError.message}. To use a Project, run ${linkedError.nextStep} and run setup again`
  }
  const broken = []
  if (isSet(held) && heldMissing) {
    const problem = `${PROJECT_PATH} names ${held}, which GitHub no longer has or the gh account cannot see`
    question.broken = { was: held, problem }
    broken.push({ path: PROJECT_PATH, value: held, problem })
  }
  return { question, broken }
}

function checkKeys(given, allowed, flag) {
  for (const key of Object.keys(given)) {
    if (!allowed.includes(key)) throw invalid(`${flag} ${key} is not something setup maps`, `Use ${flag} with one of: ${allowed.join(', ')}`)
  }
}

/** The held keys that setup does not ask, kept so a broken one is asked again. */
const keysOf = (asked, held) => [...asked, ...Object.keys(held ?? {}).filter((key) => !asked.includes(key) && isSet(held[key]))]

/**
 * What setup applies and asks for the Status categories, the field roles and the types, once the Project is known.
 * raw is fetchDiscovery's result. current is what the file holds: { status, fields, types }. answers is what the flags gave:
 * { status, fields, types }. types is the repository's pmkit type list. Returns { applied, questions, broken, notes, values }.
 * values.types is left out while a type is still a question.
 */
export function proposeGithubSetup(raw, current = {}, answers = {}, types = []) {
  const held = { status: current.status ?? {}, fields: current.fields ?? {}, types: current.types }
  const given = { status: answers.status ?? {}, fields: answers.fields ?? {}, types: answers.types ?? {} }
  const labels = raw.project === null
  const statusKeys = labels ? keysOf(LABEL_STATUS_KEYS, held.status) : keysOf(STATUS_KEYS, held.status)
  const fieldKeys = keysOf(FIELD_ROLES, held.fields)
  const typeKeys = keysOf(types, held.types)
  if (labels) {
    for (const key of Object.keys(given.status)) {
      if (STATE_KEYS.includes(key)) throw invalid(`--status ${key} needs no label without a Project`, `Remove --status ${key}; open and closed give ${words(key)}`)
    }
  }
  checkKeys(given.status, labels ? LABEL_STATUS_KEYS : statusKeys, '--status')
  checkKeys(given.fields, fieldKeys, '--field')
  checkKeys(given.types, typeKeys, '--type-label')

  const pmkit = { mappings: { status: held.status, fields: held.fields, ...(held.types === undefined ? {} : { types: held.types }) } }
  const state = {
    raw, held, given,
    applied: [], questions: [], broken: [], notes: [],
    brokenAt: new Map(brokenGithubMappings(raw, pmkit).map((item) => [item.path, item])),
  }
  const values = { status: {}, fields: {} }

  // Status: every category is asked on the first run (the issue's "Always asked: GitHub Status options"). Without a Project,
  // a label for each of LABEL_STATUS_KEYS, and a held value of the state categories becomes none.
  for (const key of statusKeys) {
    if (labels && STATE_KEYS.includes(key)) {
      if (isSet(held.status[key]) && held.status[key] !== NONE && !parseLabelValue(held.status[key])) {
        values.status[key] = NONE
        state.applied.push({ path: `mappings.status.${key}`, value: NONE, reason: `without a Project, ${key} needs no label` })
      }
      continue
    }
    const value = labels ? statusLabelValue(state, key) : statusValue(state, key)
    if (value !== undefined) values.status[key] = value
  }
  const usedBy = new Map()
  for (const [key, value] of Object.entries(values.status)) {
    if (value === NONE) continue
    const label = parseLabelValue(value)
    const seen = label ? label.toLowerCase() : value
    if (usedBy.has(seen)) throw invalid(label ? `label ${label} cannot answer both ${usedBy.get(seen)} and ${key}` : `option ${value} cannot answer both ${usedBy.get(seen)} and ${key}`, `Pick another ${label ? 'label' : 'option'} for ${key}`)
    usedBy.set(seen, key)
  }
  for (const key of fieldKeys) {
    // The sprint is a Project field: with no Project it is none, and setup asks nothing.
    const value = key === 'sprint' && raw.project === null ? NONE : fieldValue(state, key)
    if (value !== undefined) values.fields[key] = value
  }
  const result = () => ({ applied: state.applied, questions: state.questions, broken: state.broken, notes: state.notes, values })
  const typeValues = typesOf(state, typeKeys, values.status)
  if (typeValues !== undefined) values.types = typeValues
  return result()
}

/** The held value when it is set and not broken; otherwise it records the question, with the broken item when there is one. */
function heldOr(state, path, value, question) {
  const item = state.brokenAt.get(path)
  if (isSet(value) && !item) return value
  if (item) {
    question.broken = { was: item.value, problem: item.problem }
    state.broken.push(item)
  }
  state.questions.push(question)
  return undefined
}

/** The value of one Status category: the answer, the held value, or undefined with a question recorded. */
function statusValue(state, key) {
  const options = statusOptionsOf(state.raw)
  const required = REQUIRED_STATUS.includes(key)
  const answer = state.given.status[key]
  if (answer !== undefined) {
    if (answer === NONE && required) throw invalid(`--status ${key} cannot be none: pmkit must be able to move an issue to ${words(key)}`, `Pass --status ${key}=<option> with one of: ${options.join(', ')}`)
    if (answer !== NONE && !options.includes(answer)) throw invalid(`--status ${key}=${answer} is not an option of the Status field of ${projectId(state.raw)}`, `Pass one of: ${[...options, ...(required ? [] : [NONE])].join(', ')}`)
    return answer
  }
  const match = matchOf(key, options)
  const question = {
    path: `mappings.status.${key}`,
    flag: `--status ${key}=<option>`,
    candidates: recommendedFirst(options, match),
    recommended: match ?? (required ? null : NONE),
    none: required ? null : `No Status option means ${words(key)}`,
    ...(required ? { required: true } : {}),
  }
  return heldOr(state, question.path, state.held.status[key], question)
}

/** The label of an answer, bare or label:<name>, or undefined when the repository has no such label. */
const answeredLabel = (raw, answer) => labelOf(raw, parseLabelValue(answer) ?? answer) ?? undefined

/** Without a Project: the label of one status category, as label:<name>, none, or undefined with a question recorded. */
function statusLabelValue(state, key) {
  const names = (state.raw.labels ?? []).map((label) => label.name)
  const answer = state.given.status[key]
  if (answer !== undefined) {
    if (answer === NONE) return NONE
    const label = answeredLabel(state.raw, answer)
    if (!label) throw invalid(`--status ${key}=${answer} is not a label of ${state.raw.repo}`, `Pass one of: ${[...names, NONE].join(', ')}`)
    return `${LABEL_PREFIX}${label.name}`
  }
  const match = matchOf(key, names)
  const question = {
    path: `mappings.status.${key}`,
    flag: `--status ${key}=<label>`,
    candidates: recommendedFirst(names, match),
    recommended: match ?? NONE,
    none: `No label means ${words(key)}`,
  }
  return heldOr(state, question.path, state.held.status[key], question)
}

/** The fields that can hold a role: issue fields first, then the Project's own fields of the matching type, and the name match. */
function fieldCandidates(raw, key) {
  const kinds = FIELD_TYPES[key]
  const fits = (item) => !kinds || kinds.includes(item.dataType)
  const issue = raw.issueFields.filter(fits).map((item) => `issue:${item.name}`)
  const project = (raw.project?.fields ?? []).filter((item) => !item.issueField && item.name !== 'Status' && fits(item)).map((item) => `project:${item.name}`)
  const nameOf = (value) => parseFieldSource(value).name
  const match = matchOf(key, issue, nameOf) ?? matchOf(key, project, nameOf)
  return { match, candidates: [...recommendedFirst(issue, match), ...recommendedFirst(project, match)] }
}

/** The value of one field role: the answer, the held value, an inferred one, or undefined with a question recorded. */
function fieldValue(state, key) {
  const path = `mappings.fields.${key}`
  const { match, candidates } = fieldCandidates(state.raw, key)
  const answer = state.given.fields[key]
  if (answer !== undefined) {
    if (!parseFieldSource(answer)) throw invalid(`--field ${key}=${answer} is not issue:<name>, project:<name> or none`, `Pass one of: ${[...candidates, NONE].join(', ')}`)
    if (answer !== NONE && !candidates.includes(answer)) throw invalid(`--field ${key}=${answer} is not a field that can hold the ${words(key)}`, `Pass one of: ${[...candidates, NONE].join(', ')}`)
    return answer
  }
  const asked = state.brokenAt.has(path) || isSet(state.held.fields[key]) || !FIELD_ROLES.includes(key)
  if (!asked && candidates.length === 0) {
    state.applied.push({ path, value: NONE, reason: `GitHub has no field that can hold the ${words(key)}` })
    return NONE
  }
  if (!asked && candidates.length === 1 && match !== undefined) {
    state.applied.push({ path, value: match, reason: 'the only field of its type, and its name matches' })
    return match
  }
  const question = { path, flag: `--field ${key}=<value>`, candidates, recommended: match ?? NONE, none: `No field holds the ${words(key)}` }
  return heldOr(state, path, state.held.fields[key], question)
}

/**
 * The value of one pmkit type, from the issue types still free (or, without issue types, the labels still free): the answer,
 * the held value, none, or undefined when asked. A label value is label:<name>.
 */
function typeValue(state, type, free) {
  const path = `mappings.types.${type}`
  const labels = state.raw.issueTypes.length === 0
  const answer = state.given.types[type]
  if (answer !== undefined) {
    if (answer === NONE) return NONE
    if (labels) {
      const label = answeredLabel(state.raw, answer)
      if (!label || !free.includes(label.name)) throw invalid(`--type-label ${type}=${answer} is not a free label of ${state.raw.repo}`, `Pass one of: ${[...free, NONE].join(', ')}`)
      return `${LABEL_PREFIX}${label.name}`
    }
    if (!free.includes(answer)) throw invalid(`--type-label ${type}=${answer} is not a free issue type of ${state.raw.repo}`, `Pass one of: ${[...free, NONE].join(', ')}`)
    return answer
  }
  const heldValue = state.held.types?.[type]
  // A types object without this type means it was answered none.
  if (state.held.types !== undefined && !isSet(heldValue) && !state.brokenAt.has(path)) return NONE
  const same = free.find((name) => name.toLowerCase() === type.toLowerCase())
  const question = labels
    ? { path, flag: `--type-label ${type}=<label>`, candidates: recommendedFirst(free, same), recommended: same ?? NONE, none: 'No label stands for this type' }
    : { path, flag: `--type-label ${type}=<issue type>`, candidates: recommendedFirst(free, same), recommended: same ?? NONE, none: 'No issue type stands for this type' }
  return heldOr(state, path, heldValue, question)
}

/**
 * The types object, or undefined while a type is still a question. One issue type, or one label, answers at most one pmkit
 * type. Without issue types the candidates are the labels no status took.
 */
function typesOf(state, typeKeys, status) {
  const labels = state.raw.issueTypes.length === 0
  const statusLabels = new Set(Object.values(status).map(parseLabelValue).filter(Boolean).map((name) => name.toLowerCase()))
  const names = labels
    ? (state.raw.labels ?? []).map((label) => label.name).filter((name) => !statusLabels.has(name.toLowerCase()))
    : state.raw.issueTypes.map((type) => type.name)
  const values = {}
  const taken = new Set()
  let pending = false
  for (const type of typeKeys) {
    const value = typeValue(state, type, names.filter((name) => !taken.has(name)))
    if (value === undefined) pending = true
    else if (value !== NONE) {
      values[type] = value
      taken.add(parseLabelValue(value) ?? value)
    }
  }
  return pending ? undefined : values
}
