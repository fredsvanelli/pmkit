// A GitHub issue node as a pmkit issue: ids, the settled status rule, mapped fields and the acceptance criteria section.
// See docs/specs/2026-11-16-pmk-87-github-issues-relations-history-design.md, "The issue model".

import { parseDescription } from '../body-criteria.mjs'
import { TERMINAL } from '../model.mjs'
import { statusFieldOf } from './discovery.mjs'
import { compareGithubIds, issueIdOf } from './ids.mjs'
import { fieldOf, NONE, parseFieldSource } from './mappings.mjs'

export const PRIORITIES = ['urgent', 'high', 'medium', 'low']

// Each role reads one key of mappings.fields, and one alias and variable on the Project item.
export const ROLES = {
  priority: { key: 'priority', flag: 'priority', alias: 'fPriority', variable: 'fPriority' },
  estimate: { key: 'estimate', flag: 'estimate', alias: 'fEstimate', variable: 'fEstimate' },
  due: { key: 'target_date', flag: 'due', alias: 'fDue', variable: 'fDue' },
}

const nodesOf = (connection) => connection?.nodes ?? []
const optionName = (option) => (typeof option === 'string' ? option : option.name)

/**
 * The context of the issue operations.
 * @returns {{ raw: object, pmkit: object, repo: string, project: { id: string, statusField: object | null, options: object[] } | null,
 *   features: object, categoryOfOption: (name: string) => string, optionOf: (category: string) => { id: string, name: string } | null,
 *   typeOf: (name: string) => string | undefined, issueTypeOf: (type: string) => { id: string, name: string } | undefined,
 *   field: (role: string) => { source: string, field: object } | null, projectFields: object, fieldVariables: object, priorities: string[] }}
 */
export function makeContext(raw, pmkit) {
  const mappings = pmkit?.mappings ?? {}
  const statusMap = mappings.status ?? {}
  const typeMap = mappings.types ?? {}
  const statusField = statusFieldOf(raw.project)
  const project = raw.project ? { id: raw.project.id, statusField, options: statusField?.options ?? [] } : null
  const categoryOf = new Map(
    Object.entries(statusMap).filter(([category, value]) => category !== 'blocked' && typeof value === 'string' && value !== NONE).map(([category, value]) => [value, category]),
  )

  const field = (role) => {
    const spec = ROLES[role]
    if (!spec) return null
    const value = mappings.fields?.[spec.key]
    const parsed = parseFieldSource(value)
    if (!parsed || parsed.source === NONE) return null
    const found = fieldOf(raw, value)
    return found ? { source: parsed.source, field: found } : null
  }

  const projectFields = {}
  const fieldVariables = {}
  if (project) {
    projectFields.status = true
    fieldVariables.fStatus = statusField?.name ?? 'Status'
    for (const [role, spec] of Object.entries(ROLES)) {
      const mapped = field(role)
      if (mapped?.source === 'project') {
        projectFields[spec.flag] = true
        fieldVariables[spec.variable] = mapped.field.name
      }
    }
  }

  return {
    raw, pmkit, repo: raw.repo, project, features: raw.features,
    categoryOfOption: (name) => categoryOf.get(name) ?? 'in_progress',
    optionOf: (category) => {
      const name = statusMap[category]
      if (!project || typeof name !== 'string' || name === NONE) return null
      const found = project.options.find((option) => option.name === name)
      return found ? { id: found.id, name: found.name } : null
    },
    typeOf: (name) => Object.entries(typeMap).find(([, value]) => value === name)?.[0],
    issueTypeOf: (type) => {
      const found = raw.issueTypes.find((item) => item.name === typeMap[type])
      return found ? { id: found.id, name: found.name } : undefined
    },
    field, projectFields, fieldVariables, priorities: PRIORITIES,
  }
}

/**
 * Which pmkit priority each option of the priority field stands for. When any option is named urgent, high, medium or low
 * (any case), options map by name. Otherwise they map by position, and a fifth option and later map to nothing.
 */
export function priorityRule(options) {
  const names = options.map(optionName)
  const byName = names.some((name) => PRIORITIES.includes(name.toLowerCase()))
  const rule = new Map()
  names.forEach((name, index) => {
    const priority = byName ? PRIORITIES.find((item) => item === name.toLowerCase()) : PRIORITIES[index]
    if (priority) rule.set(name, priority)
  })
  return rule
}

/** The option that stands for a priority, or undefined. */
export function optionForPriority(options, priority) {
  const rule = priorityRule(options)
  return options.find((option) => rule.get(optionName(option)) === priority)
}

/** The item of the configured Project on a node, or null. */
export function itemOf(node, context) {
  if (!context.project) return null
  return nodesOf(node.projectItems).find((item) => item.project?.id === context.project.id) ?? null
}

/** The settled status rule: a closed issue is done or canceled whatever its option, an open one takes its option's category. */
export function statusOf(node, context) {
  const option = itemOf(node, context)?.status?.name
  if (node.state === 'CLOSED') {
    const canceled = node.stateReason === 'NOT_PLANNED' || node.stateReason === 'DUPLICATE'
    return { name: option ?? 'Closed', category: canceled ? 'canceled' : 'done' }
  }
  if (!option) return { name: 'Open', category: 'todo' }
  return { name: option, category: context.categoryOfOption(option) }
}

/** True when a blockedBy node is not in a terminal category by the same rule. */
export const isBlockedNode = (node, context) => !TERMINAL.includes(statusOf(node, context).category)

const idsOf = (nodes, context) => nodes.map((item) => issueIdOf(item, context.repo))
const sortedIds = (nodes, context) => [...new Set(idsOf(nodes, context))].sort(compareGithubIds)

// The raw value of a mapped field: an issue field's value by field name, or the Project item's alias.
function rawValue(role, node, context) {
  const mapped = context.field(role)
  if (!mapped) return undefined
  if (mapped.source === 'issue') return nodesOf(node.issueFieldValues).find((item) => item.field?.name === mapped.field.name) ?? undefined
  const item = itemOf(node, context)
  return item?.[ROLES[role].alias] ?? undefined
}

function priorityOf(node, context) {
  const value = rawValue('priority', node, context)
  if (!value?.name) return undefined
  return priorityRule(context.field('priority').field.options).get(value.name)
}

function estimateOf(node, context) {
  const value = rawValue('estimate', node, context)
  if (!value) return undefined
  const found = value.number ?? value.value ?? value.name
  return found ?? undefined
}

function dueOf(node, context) {
  const value = rawValue('due', node, context)
  return value?.date ?? value?.value ?? undefined
}

/** The pmkit issue of a fragment-shaped node. Unset fields are absent keys. */
export function toIssue(node, context) {
  const { description, acceptanceCriteria } = parseDescription(node.body)
  const issue = { id: issueIdOf(node, context.repo), title: node.title }
  const type = node.issueType ? context.typeOf(node.issueType.name) : undefined
  if (type !== undefined) issue.type = type
  issue.status = statusOf(node, context)
  const priority = priorityOf(node, context)
  if (priority !== undefined) issue.priority = priority
  const estimate = estimateOf(node, context)
  if (estimate !== undefined) issue.estimate = estimate
  const assignee = nodesOf(node.assignees)[0]?.login
  if (assignee) issue.assignee = assignee
  issue.labels = nodesOf(node.labels).map((label) => label.name).sort()
  if (node.parent) issue.parent = issueIdOf(node.parent, context.repo)
  issue.blockedBy = sortedIds(nodesOf(node.blockedBy), context)
  issue.blocks = sortedIds(nodesOf(node.blocking), context)
  issue.related = sortedIds(nodesOf(node.relatesTo), context)
  issue.duplicateOf = node.duplicateOf ? [issueIdOf(node.duplicateOf, context.repo)] : []
  issue.children = idsOf(nodesOf(node.subIssues), context)
  issue.archived = itemOf(node, context)?.isArchived === true
  const due = dueOf(node, context)
  if (due !== undefined) issue.due = due
  const branch = nodesOf(node.linkedBranches)[0]?.ref?.name
  if (branch) issue.branch = branch
  issue.description = description
  issue.acceptanceCriteria = acceptanceCriteria
  issue.created = node.createdAt
  issue.updated = node.updatedAt
  return issue
}
