// A GitHub issue node as a pmkit issue: ids, the settled status rule, mapped fields and the acceptance criteria section.
// See docs/specs/2026-11-16-pmk-87-github-issues-relations-history-design.md, "The issue model".

import { parseDescription } from '../body-criteria.mjs'
import { TERMINAL } from '../model.mjs'
import { CLOSED, CLOSED_NOT_PLANNED, OPEN, statusFieldOf } from './discovery.mjs'
import { compareGithubIds, issueIdOf } from './ids.mjs'
import { fieldOf, iterationFieldOf, labelOf, NONE, parseFieldSource, parseLabelValue } from './mappings.mjs'

export const PRIORITIES = ['urgent', 'high', 'medium', 'low']

// The open categories a status label stands for, earliest first. With several status labels, the last one here wins.
export const READ_ORDER = ['triage', 'backlog', 'todo', 'in_progress', 'in_review']

// Each role reads one key of mappings.fields, and one alias and variable on the Project item.
export const ROLES = {
  priority: { key: 'priority', flag: 'priority', alias: 'fPriority', variable: 'fPriority' },
  estimate: { key: 'estimate', flag: 'estimate', alias: 'fEstimate', variable: 'fEstimate' },
  due: { key: 'target_date', flag: 'due', alias: 'fDue', variable: 'fDue' },
  sprint: { key: 'sprint', flag: 'sprint', alias: 'fSprint', variable: 'fSprint' },
}

const nodesOf = (connection) => connection?.nodes ?? []
const optionName = (option) => (typeof option === 'string' ? option : option.name)

/**
 * The context of the issue operations.
 * @returns {{ raw: object, pmkit: object, repo: string, project: { id: string, statusField: object | null, options: object[] } | null,
 *   features: object, categoryOfOption: (name: string) => string, optionOf: (category: string) => { id: string, name: string } | null,
 *   typeOf: (name: string) => string | undefined, issueTypeOf: (type: string) => { id: string, name: string } | undefined,
 *   field: (role: string) => { source: string, field: object } | null, projectFields: object, fieldVariables: object, priorities: string[],
 *   epics: Map<string, string> }}
 * epics maps the node id of each linked epic Project to its epic id, owner/number, with the owner as GitHub writes it.
 */
export function makeContext(raw, pmkit, { epics = new Map() } = {}) {
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
    // The sprint role reads a Project iteration field only, whatever else the mapping names.
    if (role === 'sprint') {
      const iteration = iterationFieldOf(raw, pmkit)
      return iteration ? { source: 'project', field: iteration } : null
    }
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

  // Labels stand in for statuses without a Project, and for types without issue types. Each map holds the labels GitHub has.
  const labelMap = (map, keys, on) => new Map(on ? keys.flatMap((key) => {
    const name = parseLabelValue(map[key])
    const label = name ? labelOf(raw, name) : null
    return label ? [[key, label]] : []
  }) : [])
  const statusLabels = labelMap(statusMap, READ_ORDER, !project)
  const typeLabels = labelMap(typeMap, Object.keys(typeMap), raw.issueTypes.length === 0)
  // Priority and estimate labels hold without a Project and while no field holds the role (ADR 0012). Priorities read highest first.
  const valueLabels = (role, keys) => labelMap(mappings[role] ?? {}, keys, !project && [undefined, null, '', NONE].includes(mappings.fields?.[role]))
  const priorityLabels = valueLabels('priority', PRIORITIES)
  const estimateLabels = valueLabels('estimate', Object.keys(mappings.estimate ?? {}))
  const pointKeys = [...estimateLabels.keys()].every((key) => /^\d+(?:\.\d+)?$/.test(key))
  const estimateValue = (key) => (pointKeys ? Number(key) : key)
  const mappedLabelIds = new Set([...statusLabels.values(), ...typeLabels.values(), ...priorityLabels.values(), ...estimateLabels.values()].map((label) => label.id))

  /** The status and the type that an issue's label names give, with a warning for each one several labels claim. */
  function readLabels(names, id) {
    const has = (label) => names.some((name) => name.toLowerCase() === label.name.toLowerCase())
    const warnings = []
    const statuses = [...statusLabels].filter(([, label]) => has(label))
    const status = statuses.at(-1)
    if (statuses.length > 1) warnings.push(`${id} has several status labels (${statuses.map(([, label]) => label.name).sort().join(', ')}); pmkit reads ${status[1].name}`)
    // A type, a priority and an estimate read the first label of their map, with a warning when several apply.
    const first = (map, what, show = (key) => key) => {
      const found = [...map].filter(([, label]) => has(label))
      if (found.length > 1) warnings.push(`${id} has several ${what} labels (${found.map(([, label]) => label.name).sort().join(', ')}); pmkit reads ${show(found[0][0])}`)
      return found[0]?.[0]
    }
    const type = first(typeLabels, 'type')
    const priority = first(priorityLabels, 'priority')
    const estimate = first(estimateLabels, 'estimate', estimateValue)
    return { status: status ? { name: status[1].name, category: status[0] } : null, type, priority, estimate: estimate === undefined ? undefined : estimateValue(estimate), warnings }
  }

  return {
    raw, pmkit, repo: raw.repo, project, features: raw.features, statusLabels, typeLabels, priorityLabels, estimateLabels, mappedLabelIds, readLabels,
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
    field, projectFields, fieldVariables, priorities: PRIORITIES, epics,
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
  // Without a Project, a closed issue reads its state's name whatever its labels.
  const option = context.project ? itemOf(node, context)?.status?.name : undefined
  if (node.state === 'CLOSED') {
    const canceled = node.stateReason === 'NOT_PLANNED' || node.stateReason === 'DUPLICATE'
    return { name: option ?? (canceled ? CLOSED_NOT_PLANNED : CLOSED), category: canceled ? 'canceled' : 'done' }
  }
  if (!context.project) return context.readLabels?.(labelNames(node), '').status ?? { name: OPEN, category: 'todo' }
  if (!option) return { name: OPEN, category: 'todo' }
  return { name: option, category: context.categoryOfOption(option) }
}

const labelNames = (node) => (node.labels?.nodes ?? []).filter(Boolean).map((label) => label.name)

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

function priorityOf(node, context, read) {
  if (context.priorityLabels?.size > 0) return read.priority
  const value = rawValue('priority', node, context)
  if (!value?.name) return undefined
  return priorityRule(context.field('priority').field.options).get(value.name)
}

function estimateOf(node, context, read) {
  if (context.estimateLabels?.size > 0) return read.estimate
  const value = rawValue('estimate', node, context)
  if (!value) return undefined
  const found = value.number ?? value.numberValue ?? value.name
  return found ?? undefined
}

// The start date of the iteration an item holds in the scope Project.
function sprintOf(node, context) {
  const value = rawValue('sprint', node, context)
  return value?.startDate ?? undefined
}

// The parent issue, else the epic of the lowest-numbered linked epic Project the issue is an item of. An archived item is no
// longer in the epic, as the epic progress counts it, so it gives no parent.
export function parentOf(node, context) {
  if (node.parent) return issueIdOf(node.parent, context.repo)
  const found = nodesOf(node.projectItems)
    .filter((item) => !item.isArchived && context.epics.has(item.project?.id))
    .sort((a, b) => (a.project.number ?? Infinity) - (b.project.number ?? Infinity))[0]
  return found ? context.epics.get(found.project.id) : undefined
}

function dueOf(node, context) {
  const value = rawValue('due', node, context)
  return value?.date ?? value?.dateValue ?? undefined
}

/** The pmkit issue of a fragment-shaped node. Unset fields are absent keys. */
export function toIssue(node, context) {
  return toIssueWithWarnings(node, context).issue
}

/** Sets issue[key] to value unless value is undefined, so an unset field is an absent key. */
const setDefined = (issue, key, value) => {
  if (value !== undefined) issue[key] = value
}

/** The type of a node: its type label when types are labels, else its issue type's pmkit type. */
function typeOfNode(node, context, read) {
  if (context.typeLabels?.size > 0) return read.type
  return node.issueType ? context.typeOf(node.issueType.name) : undefined
}

/** What the labels of a node give (readLabels), or no type and no warning without label mappings. */
const labelRead = (node, context, id) => (context.readLabels ? context.readLabels(labelNames(node), id) : { type: undefined, warnings: [] })

/** The warnings of a node's labels. A closed issue reads no status label, so only an open one warns about several. */
const labelWarnings = (node, read) => (node.state === 'CLOSED' ? read.warnings.filter((warning) => !warning.includes('status labels')) : read.warnings)

/** The pmkit issue of a node, and the warnings of its labels: several status labels or several type labels. */
export function toIssueWithWarnings(node, context) {
  const { description, acceptanceCriteria } = parseDescription(node.body)
  const issue = { id: issueIdOf(node, context.repo), title: node.title }
  const read = labelRead(node, context, issue.id)
  setDefined(issue, 'type', typeOfNode(node, context, read))
  issue.status = statusOf(node, context)
  setDefined(issue, 'priority', priorityOf(node, context, read))
  setDefined(issue, 'estimate', estimateOf(node, context, read))
  setDefined(issue, 'assignee', nodesOf(node.assignees)[0]?.login || undefined)
  issue.labels = nodesOf(node.labels).map((label) => label.name).sort()
  setDefined(issue, 'parent', parentOf(node, context))
  issue.blockedBy = sortedIds(nodesOf(node.blockedBy), context)
  issue.blocks = sortedIds(nodesOf(node.blocking), context)
  issue.related = sortedIds(nodesOf(node.relatesTo), context)
  issue.duplicateOf = idsOf([node.duplicateOf].filter(Boolean), context)
  issue.children = idsOf(nodesOf(node.subIssues), context)
  issue.archived = itemOf(node, context)?.isArchived === true
  setDefined(issue, 'due', dueOf(node, context))
  setDefined(issue, 'sprint', sprintOf(node, context))
  setDefined(issue, 'milestone', node.milestone?.title || undefined)
  setDefined(issue, 'branch', nodesOf(node.linkedBranches)[0]?.ref?.name || undefined)
  issue.description = description
  issue.acceptanceCriteria = acceptanceCriteria
  issue.created = node.createdAt
  issue.updated = node.updatedAt
  return { issue, warnings: labelWarnings(node, read) }
}
