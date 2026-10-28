// A pmkit patch as a Linear IssueCreateInput or IssueUpdateInput, and the node a dry run shows.
// Every check runs here, before any request, so a dry run refuses what the real write would refuse.
// See docs/superpowers/specs/2026-10-27-pmk-35-linear-issues-relations-search-design.md, "Writes".

import { PmkitError } from '../errors.mjs'
import { CREATE_KEYS, UPDATE_KEYS, checkKeys } from '../issue-fields.mjs'
import { validDate } from '../local/sprints.mjs'
import { estimateScale } from './discovery.mjs'
import { CRITERIA_HEADING, PRIORITY_TO_LINEAR, buildDescription, isIssueId, parseDescription } from './issues.mjs'

const invalid = (message, nextStep, details) => new PmkitError('INVALID_INPUT', message, nextStep, details)
// A name discovery may not know yet. The caller refreshes the discovery once and builds the input again.
const stale = (message, nextStep) => invalid(message, nextStep, { stale: true })
const LABEL_STEP = 'Create the label in Linear, then run pmkit discover'
const LATER = {
  sprint: 'Linear cycles are not mapped yet (PMK-37)',
  milestone: 'Linear project milestones are not mapped yet (PMK-38)',
  release: 'Linear releases are not mapped yet',
}
export const NOT_EPICS = 'Linear projects are not epics in pmkit yet'

/** The raw team a new issue goes to: the scope team, else the only team of the workspace. */
export function createTeam(context) {
  if (context.scopeTeam) return context.scopeTeam
  const { teams } = context.raw
  if (teams.length === 1) return teams[0]
  throw new PmkitError('NOT_CONFIGURED', `tracker.scope.team is not set and the workspace has ${teams.length} teams`, '/pmkit:setup')
}

export const teamOf = (context, id) => context.raw.teams.find((team) => team.id === id)
export const teamStates = (context, team) => context.raw.states.filter((state) => state.team === team.id).sort((a, b) => a.position - b.position)

function oneLine(field, value) {
  if (/[\r\n]/.test(value)) throw invalid(`${field} must not contain a line break`)
  return value
}

/** The label of a name: the team's label first, then the workspace's. Group labels are never applied. */
function findLabel(context, team, name) {
  const usable = context.raw.labels.filter((label) => !label.isGroup && label.name === name)
  return usable.find((label) => label.team === team.id) ?? usable.find((label) => label.team === null) ?? null
}

function requireLabel(context, team, name) {
  const found = findLabel(context, team, name)
  if (!found) throw stale(`label ${name} is not a label of team ${team.key} or of the workspace`, LABEL_STEP)
  return found
}

function typeLabel(context, team, type) {
  const name = context.mappings.types[type]
  if (name === undefined) {
    const known = Object.keys(context.mappings.types)
    throw invalid(`type "${type}" has no label in mappings.types${known.length > 0 ? ` (${known.join(', ')})` : ''}`, '/pmkit:setup')
  }
  return requireLabel(context, team, name)
}

/** The labelIds of a write: the explicit or kept labels without type labels, plus the new or kept type label. Two labels of one group are refused. */
function labelIds(patch, { beforeNode, team, context }) {
  const typeNames = new Set(Object.values(context.mappings.types))
  const beforeLabels = beforeNode?.labels?.nodes ?? []
  let plain
  if (patch.labels !== undefined && patch.labels !== null) {
    if (!Array.isArray(patch.labels) || !patch.labels.every((name) => typeof name === 'string')) throw invalid('labels must be a list of strings')
    plain = patch.labels.map((name) => requireLabel(context, team, oneLine('label', name)))
  } else if (patch.labels === null) {
    plain = []
  } else {
    plain = beforeLabels.filter((label) => !typeNames.has(label.name)).map((label) => ({ id: label.id, name: label.name, group: label.parent?.name ?? null }))
  }
  plain = plain.filter((label) => !typeNames.has(label.name))
  let typed = []
  if (patch.type !== undefined) {
    if (patch.type !== null) typed = [typeLabel(context, team, patch.type)]
  } else {
    typed = beforeLabels.filter((label) => typeNames.has(label.name)).map((label) => ({ id: label.id, name: label.name, group: label.parent?.name ?? null }))
  }
  const chosen = [...plain, ...typed]
  const byGroup = new Map()
  for (const label of chosen) {
    if (label.group === null) continue
    const other = byGroup.get(label.group)
    if (other && other.name !== label.name) throw invalid(`labels ${other.name} and ${label.name} are in the same Linear label group ${label.group}`)
    byGroup.set(label.group, label)
  }
  return [...new Set(chosen.map((label) => label.id))]
}

function estimateValue(value, team, context) {
  if (value === null) return null
  if (team.estimation.type === 'notUsed') throw invalid(`team ${team.key} has estimates off`, "Turn on estimates in the team's settings in Linear")
  if (context.mappings.estimate !== 'native') {
    throw new PmkitError('NOT_SUPPORTED', 'mappings.fields.estimate is not native in .pmkit/config.yaml, so pmkit does not write estimates', '/pmkit:setup')
  }
  const scale = estimateScale(team.estimation)
  if (!scale.scale.includes(value)) throw invalid(`estimate must be one of ${scale.scale.join(', ')}`)
  return scale.unit === 'sizes' ? scale.values[value] : value
}

/** A member id that may be assigned: a discovered user that is not an app. An unknown id is stale. */
export function requireAssignee(context, id) {
  const user = context.raw.users.find((item) => item.id === id)
  if (!user) throw stale(`assignee "${id}" is not a member of this workspace`, 'pmkit discover')
  if (user.app) throw invalid(`assignee "${id}" is an app user, not a member`, 'pmkit discover')
  return id
}

function criteriaOf(value) {
  if (!Array.isArray(value)) throw invalid('acceptanceCriteria must be a list')
  return value.map((item) => {
    const text = typeof item === 'string' ? item : item?.text
    if (typeof text !== 'string' || text.trim() === '') throw invalid('each acceptance criterion needs text')
    return { text: oneLine('acceptance criterion', text.trim()), done: item?.done === true }
  })
}

function descriptionOf(value) {
  if (typeof value !== 'string') throw invalid('description must be a string')
  const text = value.replace(/\r\n?/g, '\n').trim()
  if (text.split('\n').some((line) => line.trimEnd() === CRITERIA_HEADING)) {
    throw invalid(`description has the line "${CRITERIA_HEADING}", which pmkit keeps for the criteria`, 'Pass the criteria with --criteria-file instead')
  }
  return text
}

/**
 * The Linear input of a patch. mode is create or update. beforeNode is the issue's node (update), team the raw team (create),
 * parentNode the node of patch.parent (create). Throws before any request; a name discovery may not know yet throws with details.stale.
 */
export function toInput(patch, { mode, beforeNode, team: givenTeam, context, parentNode }) {
  checkKeys(patch, mode === 'create' ? CREATE_KEYS : UPDATE_KEYS)
  const team = givenTeam ?? teamOf(context, beforeNode?.team?.id)
  const input = mode === 'create' ? { teamId: team.id } : {}
  if (mode === 'create' || patch.title !== undefined) {
    if (typeof patch.title !== 'string' || patch.title.trim() === '') throw invalid('title is required')
    input.title = oneLine('title', patch.title.trim())
  }
  if (patch.status !== undefined && patch.status !== null) {
    const state = teamStates(context, team).find((item) => item.name === patch.status)
    if (!state) throw invalid(`status ${patch.status} is not a status of team ${team.key}`, `Use one of: ${teamStates(context, team).map((item) => item.name).join(', ')}`)
    input.stateId = state.id
  }
  if (patch.type !== undefined || patch.labels !== undefined) {
    const ids = labelIds(patch, { beforeNode, team, context })
    if (mode === 'update' || ids.length > 0) input.labelIds = ids
  }
  if (patch.priority !== undefined) {
    if (patch.priority !== null && !Object.hasOwn(PRIORITY_TO_LINEAR, patch.priority)) {
      throw invalid(`priority must be one of ${Object.keys(PRIORITY_TO_LINEAR).join(', ')}`)
    }
    input.priority = patch.priority === null ? 0 : PRIORITY_TO_LINEAR[patch.priority]
  }
  if (patch.estimate !== undefined) input.estimate = estimateValue(patch.estimate, team, context)
  if (patch.assignee !== undefined && patch.assignee !== null) input.assigneeId = requireAssignee(context, patch.assignee)
  if (patch.parent !== undefined && patch.parent !== null) {
    if (!isIssueId(patch.parent)) throw new PmkitError('NOT_SUPPORTED', NOT_EPICS, 'Use an issue id as the parent')
    input.parentId = parentNode.id
  }
  if (patch.due !== undefined) {
    if (patch.due !== null && !validDate(patch.due)) throw invalid('due must be a date as YYYY-MM-DD')
    input.dueDate = patch.due
  }
  if (patch.description !== undefined || patch.acceptanceCriteria !== undefined) {
    const before = parseDescription(beforeNode?.description ?? '')
    const description = patch.description === undefined ? before.description : patch.description === null ? '' : descriptionOf(patch.description)
    const criteria = patch.acceptanceCriteria === undefined ? before.acceptanceCriteria : patch.acceptanceCriteria === null ? [] : criteriaOf(patch.acceptanceCriteria)
    input.description = buildDescription(description, criteria)
  }
  if (mode === 'create' && patch.branch !== undefined && patch.branch !== null) {
    throw invalid('Linear names the branch of a new issue itself', 'Drop branch; pmkit issues branch uses the name Linear picks')
  }
  for (const key of Object.keys(LATER)) {
    if (patch[key] !== undefined && patch[key] !== null) throw new PmkitError('NOT_SUPPORTED', LATER[key], `Leave ${key} out on Linear`)
  }
  return input
}

/** The node with a Linear input applied, so toIssue of it is the after of a dry run. `parent` is the parent's identifier for a parentId. */
export function applyInput(node, input, context, { parent } = {}) {
  const next = structuredClone(node)
  if (input.title !== undefined) next.title = input.title
  if (input.description !== undefined) next.description = input.description
  if (input.priority !== undefined) next.priority = input.priority
  if (input.estimate !== undefined) next.estimate = input.estimate
  if (input.dueDate !== undefined) next.dueDate = input.dueDate
  if (input.stateId !== undefined) {
    const state = context.raw.states.find((item) => item.id === input.stateId)
    next.state = { id: state.id, name: state.name, type: state.type }
  }
  if (input.assigneeId !== undefined) next.assignee = input.assigneeId === null ? null : { id: input.assigneeId }
  if (input.labelIds !== undefined) {
    const nodes = input.labelIds.map((id) => {
      const label = context.raw.labels.find((item) => item.id === id)
      return { id, name: label.name, parent: label.group === null ? null : { name: label.group } }
    })
    next.labels = { nodes, pageInfo: { hasNextPage: false, endCursor: null } }
  }
  if (input.parentId !== undefined) next.parent = input.parentId === null ? null : { identifier: parent }
  return next
}

/** The node of an issue that does not exist yet: no identifier, the team's first backlog state, and `at` as both times. */
export function skeletonNode(team, at, context) {
  const states = context ? teamStates(context, team) : []
  const state = states.find((item) => item.type === 'backlog') ?? states[0] ?? null
  const empty = () => ({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } })
  return {
    id: null, identifier: null, title: '', description: '', priority: 0, estimate: null, dueDate: null, branchName: null,
    archivedAt: null, trashed: false, createdAt: at, updatedAt: at,
    team: { id: team.id, key: team.key },
    state: state === null ? { id: null, name: null, type: null } : { id: state.id, name: state.name, type: state.type },
    assignee: null, parent: null, labels: empty(), children: empty(), relations: empty(), inverseRelations: empty(),
  }
}
