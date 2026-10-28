// Mapping rules over an adapter-neutral description of a hosted tracker. No tracker's own names live here:
// an adapter builds the description (for Linear, scripts/lib/linear/mappings.mjs) and this module decides what
// setup applies, what it asks and what a config names that the tracker no longer has.
// See docs/superpowers/specs/2026-10-27-pmk-34-ask-for-mappings-design.md, "The generic description" and "The inference rule".
//
// The description:
//   { workspace: { urlKey, name, plan }, viewerTeams: [teamKey], types: [pmkitType],
//     teams: [{ key, name, candidates: { [path]: [value] }, recommended: { [path]: value },
//               notes: { [path]: text }, exists(path, value): boolean, problem?(path, value): string }] }

import { PmkitError } from './errors.mjs'

/** The reserved value for "answered, nothing": this team has no such status or field. */
export const NONE = 'none'

export const SCOPE_WORKSPACE = 'tracker.scope.workspace'
export const SCOPE_TEAM = 'tracker.scope.team'
const STATUS_KEYS = ['in_review', 'blocked']
const FIELD_KEYS = ['estimate']

const NONE_LABELS = {
  'mappings.status.in_review': 'No status means in review',
  'mappings.status.blocked': 'No status means blocked',
  'mappings.fields.estimate': 'No field holds the estimate',
}

const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
const isSet = (value) => typeof value === 'string' && value !== ''
const pass = (candidates) => `Pass one of: ${[...candidates, NONE].join(', ')}`

/** Broken items that name a team, status, field or label the tracker lacks. The team must exist. */
function brokenItems(description, pmkit) {
  void description
  void pmkit
  return []
}

/** The team of the description whose key is `key`, or undefined. */
const teamOf = (description, key) => description.teams.find((team) => team.key === key)

const flagOf = {
  status: (key) => `--status ${key}=<value>`,
  fields: (key) => `--field ${key}=<value>`,
  types: (key) => `--type-label ${key}=<value>`,
}

function checkKeys(group, answers, allowed, flag) {
  for (const key of Object.keys(answers ?? {})) {
    if (!allowed.includes(key)) throw invalid(`${flag} ${key} is not something setup maps`, `Use ${flag} with one of: ${allowed.join(', ')}`)
  }
}

/**
 * Walks the keys of a first run or an update and says what setup applies, what it asks and what is broken.
 * current is what the file holds: { scope, status, fields, types }. answers is what the flags gave:
 * { workspace, team, status, fields, types }. Returns { workspace, team, applied, questions, broken, notes, values }.
 * values holds the final scope and mappings; values.types is left out while a type is still a question.
 */
export function proposeMappings(description, current = {}, answers = {}) {
  const scope = current.scope ?? {}
  const status = current.status ?? {}
  const fields = current.fields ?? {}
  const types = current.types
  const given = { status: answers.status ?? {}, fields: answers.fields ?? {}, types: answers.types ?? {} }
  checkKeys('status', given.status, STATUS_KEYS, '--status')
  checkKeys('fields', given.fields, FIELD_KEYS, '--field')
  checkKeys('types', given.types, description.types ?? [], '--type-label')

  const pmkit = { tracker: { scope }, mappings: { status, fields, ...(types === undefined ? {} : { types }) } }
  const brokenAll = brokenItems(description, pmkit)
  const brokenAt = (path) => brokenAll.find((item) => item.path === path)

  const applied = []
  const questions = []
  const notes = []
  const result = { workspace: description.workspace, team: null, applied, questions, broken: [], notes, values: { scope: {}, status: {}, fields: {} } }

  // Workspace: the key's own organization.
  const urlKey = description.workspace.urlKey
  if (answers.workspace !== undefined && answers.workspace !== urlKey) {
    throw invalid(`--workspace ${answers.workspace} is not the workspace of this key, which is ${urlKey}`, `Pass --workspace ${urlKey}`)
  }
  if (scope.workspace !== urlKey) applied.push({ path: SCOPE_WORKSPACE, value: urlKey, reason: 'the key belongs to this workspace' })
  result.values.scope.workspace = urlKey

  // Team.
  const teamKeys = description.teams.map((team) => team.key)
  let teamKey = null
  if (answers.team !== undefined) {
    if (!teamKeys.includes(answers.team)) throw invalid(`--team ${answers.team} is not a team of workspace ${urlKey}`, `Pass one of: ${teamKeys.join(', ')}`)
    teamKey = answers.team
  } else if (isSet(scope.team) && teamKeys.includes(scope.team)) {
    teamKey = scope.team
  } else {
    const viewer = (description.viewerTeams ?? []).filter((key) => teamKeys.includes(key))
    if (!isSet(scope.team) && viewer.length === 1) {
      teamKey = viewer[0]
      applied.push({ path: SCOPE_TEAM, value: teamKey, reason: 'you are a member of one team' })
    } else {
      const item = { path: SCOPE_TEAM, flag: '--team <KEY>', candidates: viewer.length > 0 ? viewer : teamKeys, recommended: null, none: null }
      if (isSet(scope.team)) {
        const problem = `${SCOPE_TEAM} names ${scope.team}, which this workspace no longer has`
        item.broken = { was: scope.team, problem }
        result.broken.push({ path: SCOPE_TEAM, value: scope.team, problem })
      }
      questions.push(item)
      return result
    }
  }
  result.team = teamKey
  result.values.scope.team = teamKey
  const team = teamOf(description, teamKey)
  for (const item of brokenAll) result.broken.push(item)

  // Statuses and fields: an answer, kept, broken, always asked, applied, asked, nothing.
  const decide = (path, flagGroup, key, { always, none }) => {
    const group = flagGroup === 'status' ? status : fields
    const candidates = team.candidates[path] ?? []
    const answer = given[flagGroup][key]
    if (answer !== undefined) {
      if (answer !== NONE && !candidates.includes(answer)) {
        const flag = flagGroup === 'status' ? '--status' : '--field'
        throw invalid(`${flag} ${key}=${answer} is not a ${flagGroup === 'status' ? 'status' : 'field'} of team ${teamKey}`, pass(candidates))
      }
      return answer
    }
    const held = group[key]
    const broken = brokenAt(path)
    if (isSet(held) && !broken) return held
    const question = { path, flag: flagOf[flagGroup](key), candidates, recommended: team.recommended?.[path] ?? NONE, none }
    if (broken) {
      question.broken = { was: broken.value, problem: broken.problem }
      questions.push(question)
      return undefined
    }
    if (always) {
      questions.push(question)
      return undefined
    }
    if (candidates.length === 1) {
      applied.push({ path, value: candidates[0], reason: 'the tracker offers only this field' })
      return candidates[0]
    }
    if (candidates.length > 1) {
      questions.push(question)
      return undefined
    }
    if (team.notes?.[path]) notes.push(team.notes[path])
    return undefined
  }

  const inReview = decide('mappings.status.in_review', 'status', 'in_review', { always: true, none: NONE_LABELS['mappings.status.in_review'] })
  if (inReview !== undefined) result.values.status.in_review = inReview
  const blocked = decide('mappings.status.blocked', 'status', 'blocked', { always: true, none: NONE_LABELS['mappings.status.blocked'] })
  if (blocked !== undefined) {
    if (blocked !== NONE && blocked === inReview) throw invalid(`status ${blocked} cannot mean both in review and blocked`, 'Pass a different status for one of them')
    result.values.status.blocked = blocked
  }
  for (const [key, value] of Object.entries(status)) if (!(key in result.values.status) && !STATUS_KEYS.includes(key) && isSet(value)) result.values.status[key] = value
  const estimate = decide('mappings.fields.estimate', 'fields', 'estimate', { always: false, none: NONE_LABELS['mappings.fields.estimate'] })
  if (estimate !== undefined) result.values.fields.estimate = estimate
  for (const [key, value] of Object.entries(fields)) if (!(key in result.values.fields) && !FIELD_KEYS.includes(key) && isSet(value)) result.values.fields[key] = value

  // Types: asked while the object is absent from the file; a label that broke is asked again.
  const typeValues = {}
  let pending = false
  const taken = new Set()
  for (const type of description.types ?? []) {
    const path = `mappings.types.${type}`
    const options = (team.candidates[path] ?? []).filter((label) => !taken.has(label))
    const answer = given.types[type]
    let value
    if (answer !== undefined) {
      if (answer !== NONE && !options.includes(answer)) {
        throw invalid(`--type-label ${type}=${answer} is not a label for ${type} in team ${teamKey}`, pass(options))
      }
      value = answer
    } else {
      const held = types?.[type]
      const broken = brokenAt(path)
      if (isSet(held) && !broken) value = held
      else if (types !== undefined && !broken) value = NONE
      else {
        const recommended = team.recommended?.[path]
        const question = {
          path, flag: flagOf.types(type), candidates: options,
          recommended: recommended !== undefined && (recommended === NONE || options.includes(recommended)) ? recommended : NONE,
          none: 'No label stands for this type',
        }
        if (broken) question.broken = { was: broken.value, problem: broken.problem }
        questions.push(question)
        pending = true
        continue
      }
    }
    if (value !== NONE) {
      typeValues[type] = value
      taken.add(value)
    }
  }
  for (const [type, value] of Object.entries(types ?? {})) {
    if (!(description.types ?? []).includes(type) && isSet(value)) typeValues[type] = value
  }
  if (!pending) result.values.types = typeValues
  return result
}
