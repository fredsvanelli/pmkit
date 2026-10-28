// A Linear issue as a pmkit issue: ids, priorities and the acceptance criteria section of the description.
// See docs/superpowers/specs/2026-10-27-pmk-35-linear-issues-relations-search-design.md, "The issue model".

import { compareIds } from '../ids.mjs'
import { TERMINAL } from '../model.mjs'
import { categoryOfType, estimateScale } from './discovery.mjs'
import { resolveMappings } from './mappings.mjs'

export { isIssueId, issueKey } from './ids.mjs'

export const PRIORITY_TO_LINEAR = { urgent: 1, high: 2, medium: 3, low: 4 }
const PRIORITY_OF_LINEAR = Object.fromEntries(Object.entries(PRIORITY_TO_LINEAR).map(([name, value]) => [value, name]))

/** The pmkit priority of Linear's number. 0, which Linear uses for no priority, and unknown values give undefined. */
export const priorityOf = (value) => PRIORITY_OF_LINEAR[value]

export const CRITERIA_HEADING = '## Acceptance criteria'
const CHECKLIST = /^[-*] \[( |x|X)\] (.*)$/
const isBlank = (line) => line.trim() === ''

/** The lines as text without blank lines at either end. */
const trimLines = (lines) => lines.join('\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd()

/** The kept lines of the section, where removing the checklist can leave two blank lines in a row: each run becomes one. */
const squeeze = (lines) => lines.filter((line, index) => !(isBlank(line) && index > 0 && isBlank(lines[index - 1])))

/**
 * Splits a Linear description into the pmkit description and the checklist of its acceptance criteria section.
 * The section starts at the line "## Acceptance criteria" and ends at the next "## " heading. A line in it that is
 * not a checklist item stays in the description, where it was, so a read never drops text.
 */
export function parseDescription(text) {
  const lines = (text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const start = lines.findIndex((line) => line.trimEnd() === CRITERIA_HEADING)
  if (start < 0) return { description: lines.join('\n').trim(), acceptanceCriteria: [] }
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  if (end < 0) end = lines.length
  const acceptanceCriteria = []
  const notes = []
  for (const line of lines.slice(start + 1, end)) {
    const match = CHECKLIST.exec(line.trimEnd())
    if (match) acceptanceCriteria.push({ text: match[2].trim(), done: match[1] !== ' ' })
    else notes.push(line)
  }
  const parts = [lines.slice(0, start), squeeze(notes), lines.slice(end)].map(trimLines).filter((part) => part !== '')
  return { description: parts.join('\n\n').trim(), acceptanceCriteria }
}

/** The Linear description for a pmkit description and its criteria. No criteria means no section. */
export function buildDescription(description, criteria) {
  const section = criteria.length === 0 ? '' : [CRITERIA_HEADING, '', ...criteria.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`)].join('\n')
  return [description.trim(), section].filter((part) => part !== '').join('\n\n')
}

/**
 * @typedef {object} LinearContext
 * @property {object} raw the raw discovery: teams, states, labels, users
 * @property {ReturnType<typeof resolveMappings> | null} mappings resolveMappings for the scope team, else for the only team, else null
 * @property {(team: object) => ReturnType<typeof resolveMappings>} mappingsOf resolveMappings for a raw team, so an issue of
 *   another team reads its own states and labels under the same mapping names
 * @property {{ id: string, name: string }} viewer the owner of LINEAR_API_KEY
 * @property {object | null} scopeTeam the raw team that tracker.scope.team names, or null
 * @property {string[]} priorities
 */

/** @returns {LinearContext} */
export function makeContext(raw, pmkit, viewer) {
  const key = pmkit?.tracker?.scope?.team
  const scopeTeam = key ? (raw.teams.find((team) => team.key === key) ?? null) : null
  const resolved = new Map()
  const mappingsOf = (team) => {
    if (!resolved.has(team.id)) {
      const tracker = pmkit?.tracker ?? {}
      resolved.set(team.id, resolveMappings(null, { ...pmkit, tracker: { ...tracker, scope: { ...tracker.scope, team: team.key } } }, raw))
    }
    return resolved.get(team.id)
  }
  const mappingTeam = scopeTeam ?? (raw.teams.length === 1 ? raw.teams[0] : null)
  return { raw, mappings: mappingTeam ? mappingsOf(mappingTeam) : null, mappingsOf, viewer, scopeTeam, priorities: ['urgent', 'high', 'medium', 'low'] }
}

/** The mappings of the team a node or state belongs to, or of the scope team when the team is unknown. */
export const mappingsOfTeam = (teamId, context) => {
  const team = context.raw.teams.find((item) => item.id === teamId)
  return team ? context.mappingsOf(team) : context.mappings
}

/**
 * The pmkit category of a Linear state: resolveMappings' categoryOf on the state's team (PMK-34 rule 1), else the state type,
 * else in_progress. A relation node's state has no name, so the name and team come from the discovered state with the same id.
 */
export function stateCategory(state, context) {
  const known = state.id ? context.raw.states.find((item) => item.id === state.id) : undefined
  const name = state.name ?? known?.name
  const mapped = name === undefined ? null : (mappingsOfTeam(known?.team, context)?.categoryOf(name) ?? null)
  return mapped ?? categoryOfType(state.type) ?? 'in_progress'
}

const identifiers = (nodes) => [...new Set(nodes)].sort(compareIds)
const nodesOf = (connection) => connection?.nodes ?? []

/** The pmkit estimate of a node: a number on a points team, a size on a t-shirt team, undefined when the estimate is not native. */
export function estimateOf(node, context) {
  if (mappingsOfTeam(node.team?.id, context)?.estimate !== 'native' || typeof node.estimate !== 'number') return undefined
  const team = context.raw.teams.find((item) => item.id === node.team?.id)
  const scale = estimateScale(team?.estimation)
  if (scale.unit !== 'sizes') return node.estimate
  return Object.keys(scale.values).find((size) => scale.values[size] === node.estimate) ?? node.estimate
}

/** The pmkit issue of a fragment-shaped node, or null for an issue in Linear's trash. Unset fields are absent keys. */
export function toIssue(node, context) {
  if (node.trashed === true) return null
  const labelNames = nodesOf(node.labels).map((label) => label.name)
  const mappings = mappingsOfTeam(node.team?.id, context)
  const typeLabels = new Set(Object.values(mappings?.types ?? {}).map((label) => label.name))
  const out = nodesOf(node.relations)
  const inverse = nodesOf(node.inverseRelations)
  const { description, acceptanceCriteria } = parseDescription(node.description)
  const issue = { id: node.identifier, title: node.title }
  const type = mappings?.typeOf(labelNames) ?? null
  if (type !== null) issue.type = type
  issue.status = { name: node.state.name, category: stateCategory(node.state, context) }
  const priority = priorityOf(node.priority)
  if (priority !== undefined) issue.priority = priority
  const estimate = estimateOf(node, context)
  if (estimate !== undefined) issue.estimate = estimate
  if (node.assignee?.id) issue.assignee = node.assignee.id
  issue.labels = [...new Set(labelNames.filter((name) => !typeLabels.has(name)))].sort()
  if (node.parent?.identifier) issue.parent = node.parent.identifier
  if (node.cycle) issue.sprint = String(node.cycle.number)
  issue.blockedBy = identifiers(inverse.filter((item) => item.type === 'blocks').map((item) => item.issue.identifier))
  issue.blocks = identifiers(out.filter((item) => item.type === 'blocks').map((item) => item.relatedIssue.identifier))
  issue.related = identifiers([
    ...out.filter((item) => item.type === 'related').map((item) => item.relatedIssue.identifier),
    ...inverse.filter((item) => item.type === 'related').map((item) => item.issue.identifier),
  ])
  issue.duplicateOf = identifiers(out.filter((item) => item.type === 'duplicate').map((item) => item.relatedIssue.identifier))
  issue.children = identifiers(nodesOf(node.children).map((child) => child.identifier))
  issue.archived = node.archivedAt !== null && node.archivedAt !== undefined
  if (node.dueDate) issue.due = node.dueDate
  if (node.branchName) issue.branch = node.branchName
  issue.description = description
  issue.acceptanceCriteria = acceptanceCriteria
  issue.created = node.createdAt
  issue.updated = node.updatedAt
  return issue
}

/** True when a blocks relation into the node comes from an issue that is open, or whose state Linear did not return. */
export function blockedOpen(node, context) {
  return nodesOf(node.inverseRelations).some(
    (item) => item.type === 'blocks' && (!item.issue?.state || !TERMINAL.includes(stateCategory(item.issue.state, context))),
  )
}
