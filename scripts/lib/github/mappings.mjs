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
export const FIELD_ROLES = ['priority', 'estimate', 'start_date', 'target_date']

const FIELD_TYPES = { priority: ['SINGLE_SELECT'], estimate: ['NUMBER', 'SINGLE_SELECT'], start_date: ['DATE'], target_date: ['DATE'] }

// Names that setup recommends, compared without case. The first match wins.
const MATCHES = {
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
}

const words = (key) => key.replace(/_/g, ' ')
const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
const isSet = (value) => typeof value === 'string' && value !== ''

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

/** Why a held value is broken, or null when GitHub still has what it names. */
function problemOf(raw, path, value) {
  const group = path.split('.')[1]
  if (group === 'status') {
    if (raw.project === null || statusOptionsOf(raw).includes(value)) return null
    return `${path} names ${value}, which the Status field of ${projectId(raw)} no longer has`
  }
  if (group === 'fields') {
    const parsed = parseFieldSource(value)
    if (!parsed) return `${path} is ${value}, which is not issue:<name>, project:<name> or none`
    if (parsed.source === NONE || fieldOf(raw, value)) return null
    if (parsed.source === 'issue') return `${path} names issue field ${parsed.name}, which ${raw.repo} no longer has`
    if (raw.project === null) return `${path} names Project field ${parsed.name}, but tracker.scope.project is none`
    return `${path} names Project field ${parsed.name}, which ${projectId(raw)} no longer has`
  }
  if (group === 'types') {
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
    question.note = `pmkit could not list the Projects of this repository: ${linkedError.message}. To use a Project, run ${linkedError.nextStep} and run setup again`
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
  const hasProject = raw.project !== null
  const statusKeys = hasProject ? keysOf(STATUS_KEYS, held.status) : []
  const fieldKeys = keysOf(FIELD_ROLES, held.fields)
  const typeKeys = raw.issueTypes.length > 0 ? keysOf(types, held.types) : []
  checkKeys(given.status, statusKeys.length > 0 ? statusKeys : STATUS_KEYS, '--status')
  if (!hasProject && Object.keys(given.status).length > 0) throw invalid('--status needs a Project, and tracker.scope.project is none', 'Remove --status, or pass --project <owner>/<number>')
  checkKeys(given.fields, fieldKeys, '--field')
  if (raw.issueTypes.length > 0) checkKeys(given.types, typeKeys, '--type-label')

  const applied = []
  const questions = []
  const broken = []
  const notes = []
  const values = { status: {}, fields: {} }
  const pmkit = { mappings: { status: held.status, fields: held.fields, ...(held.types === undefined ? {} : { types: held.types }) } }
  const brokenAt = new Map(brokenGithubMappings(raw, pmkit).map((item) => [item.path, item]))

  /** The held value when it is set and not broken; otherwise it asks, with the broken item when there is one. */
  const heldOr = (path, value, question) => {
    const item = brokenAt.get(path)
    if (isSet(value) && !item) return { value }
    if (item) {
      question.broken = { was: item.value, problem: item.problem }
      broken.push(item)
    }
    questions.push(question)
    return {}
  }

  // Status: every category is asked on the first run (the issue's "Always asked: GitHub Status options").
  const options = statusOptionsOf(raw)
  for (const key of statusKeys) {
    const path = `mappings.status.${key}`
    const required = REQUIRED_STATUS.includes(key)
    const answer = given.status[key]
    if (answer !== undefined) {
      if (answer === NONE && required) throw invalid(`--status ${key} cannot be none: pmkit must be able to move an issue to ${words(key)}`, `Pass --status ${key}=<option> with one of: ${options.join(', ')}`)
      if (answer !== NONE && !options.includes(answer)) throw invalid(`--status ${key}=${answer} is not an option of the Status field of ${projectId(raw)}`, `Pass one of: ${[...options, ...(required ? [] : [NONE])].join(', ')}`)
      values.status[key] = answer
      continue
    }
    const match = matchOf(key, options)
    const question = {
      path,
      flag: `--status ${key}=<option>`,
      candidates: recommendedFirst(options, match),
      recommended: match ?? (required ? null : NONE),
      none: required ? null : `No Status option means ${words(key)}`,
      ...(required ? { required: true } : {}),
    }
    const found = heldOr(path, held.status[key], question)
    if (found.value !== undefined) values.status[key] = found.value
  }
  const usedBy = new Map()
  for (const [key, value] of Object.entries(values.status)) {
    if (value === NONE) continue
    if (usedBy.has(value)) throw invalid(`option ${value} cannot answer both ${usedBy.get(value)} and ${key}`, `Pick another option for ${key}`)
    usedBy.set(value, key)
  }

  // Field roles: issue fields first, then the Project's own fields of the matching type.
  for (const key of fieldKeys) {
    const path = `mappings.fields.${key}`
    const kinds = FIELD_TYPES[key]
    const issue = raw.issueFields.filter((item) => !kinds || kinds.includes(item.dataType)).map((item) => `issue:${item.name}`)
    const project = (raw.project?.fields ?? []).filter((item) => !item.issueField && item.name !== 'Status' && (!kinds || kinds.includes(item.dataType))).map((item) => `project:${item.name}`)
    const nameOf = (value) => parseFieldSource(value).name
    const match = matchOf(key, issue, nameOf) ?? matchOf(key, project, nameOf)
    const candidates = [...recommendedFirst(issue, match), ...recommendedFirst(project, match)]
    const answer = given.fields[key]
    if (answer !== undefined) {
      if (!parseFieldSource(answer)) throw invalid(`--field ${key}=${answer} is not issue:<name>, project:<name> or none`, `Pass one of: ${[...candidates, NONE].join(', ')}`)
      if (answer !== NONE && !candidates.includes(answer)) throw invalid(`--field ${key}=${answer} is not a field that can hold the ${words(key)}`, `Pass one of: ${[...candidates, NONE].join(', ')}`)
      values.fields[key] = answer
      continue
    }
    const question = { path, flag: `--field ${key}=<value>`, candidates, recommended: match ?? NONE, none: `No field holds the ${words(key)}` }
    if (!brokenAt.has(path) && !isSet(held.fields[key]) && FIELD_ROLES.includes(key)) {
      if (candidates.length === 0) {
        applied.push({ path, value: NONE, reason: `GitHub has no field that can hold the ${words(key)}` })
        values.fields[key] = NONE
        continue
      }
      if (candidates.length === 1 && match !== undefined) {
        applied.push({ path, value: match, reason: 'the only field of its type, and its name matches' })
        values.fields[key] = match
        continue
      }
    }
    const found = heldOr(path, held.fields[key], question)
    if (found.value !== undefined) values.fields[key] = found.value
  }

  // Types: asked while the object is absent from the file; an issue type that broke is asked again.
  if (raw.issueTypes.length === 0) {
    notes.push(`${raw.repo} has no enabled issue type, so setup maps no pmkit type; PMK-89 adds labels as a fallback`)
    return { applied, questions, broken, notes, values }
  }
  const typeValues = {}
  const taken = new Set()
  let pending = false
  const names = raw.issueTypes.map((type) => type.name)
  for (const type of typeKeys) {
    const path = `mappings.types.${type}`
    const free = names.filter((name) => !taken.has(name))
    const answer = given.types[type]
    let value
    if (answer !== undefined) {
      if (answer !== NONE && !free.includes(answer)) throw invalid(`--type-label ${type}=${answer} is not a free issue type of ${raw.repo}`, `Pass one of: ${[...free, NONE].join(', ')}`)
      value = answer
    } else {
      const same = free.find((name) => name.toLowerCase() === type.toLowerCase())
      const question = { path, flag: `--type-label ${type}=<issue type>`, candidates: recommendedFirst(free, same), recommended: same ?? NONE, none: 'No issue type stands for this type' }
      const heldValue = held.types?.[type]
      if (held.types !== undefined && !isSet(heldValue) && !brokenAt.has(path)) value = NONE
      else {
        const found = heldOr(path, heldValue, question)
        if (found.value === undefined) {
          pending = true
          continue
        }
        value = found.value
      }
    }
    if (value !== NONE) {
      typeValues[type] = value
      taken.add(value)
    }
  }
  if (!pending) values.types = typeValues
  return { applied, questions, broken, notes, values }
}
