// A Jira work item as a pmkit issue, and a pmkit patch as the Jira fields a write sends. Pure: no request here.
// See docs/superpowers/specs/2026-11-22-pmk-77-jira-work-items-transitions-links-jql-design.md, "The work-item model" and "Writes".

import { buildDescription, CRITERIA_HEADING, parseDescription } from '../body-criteria.mjs'
import { validBranch } from '../config.mjs'
import { PmkitError } from '../errors.mjs'
import { compareIds } from '../ids.mjs'
import { CREATE_KEYS, UPDATE_KEYS, checkKeys } from '../issue-fields.mjs'
import { validDate } from '../local/sprints.mjs'
import { isCategory, PRIORITY_LABEL_LEVELS as PRIORITIES } from '../model.mjs'
import { adfToText, textToAdf } from './adf.mjs'
import { categoryOfStatus, discoveryView } from './discovery.mjs'
import { isIssueKey, normalizeKey } from './ids.mjs'

const BRANCH_PROPERTY = 'pmkit.branch'
const HOURS = 'timeoriginalestimate'
const SETUP = '/pmkit:setup'
const BASE_FIELDS = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'labels', 'parent', 'subtasks', 'issuelinks', 'duedate', 'description', 'created', 'updated', 'creator']
const LINK_NAMES = { blocks: 'blocks', related: 'relates', duplicate: 'duplicate' }
const PRIORITY_READ = {
  highest: 'urgent', urgent: 'urgent', critical: 'urgent', blocker: 'urgent',
  high: 'high', major: 'high',
  medium: 'medium',
  low: 'low', lowest: 'low', minor: 'low', trivial: 'low',
}
// The issue that serves each field PMK-77 leaves unset.
const LATER = { sprint: 'PMK-78', milestone: 'PMK-79', release: 'PMK-79' }

const invalid = (message, nextStep, details) => new PmkitError('INVALID_INPUT', message, nextStep, details)
const notSupported = (message, nextStep) => new PmkitError('NOT_SUPPORTED', message, nextStep)
const lower = (value) => String(value ?? '').toLowerCase()

/** The pmkit priority a Jira priority name reads as, or undefined. */
const readPriority = (name) => (Object.hasOwn(PRIORITY_READ, lower(name)) ? PRIORITY_READ[lower(name)] : undefined)

// The context every work-item read and write takes: the discovery's view and the lookups over it.
export function makeContext(raw, pmkit, session) {
  const view = discoveryView(raw, pmkit, { session })
  const types = pmkit?.mappings?.types ?? {}
  const workTypeByName = (name) => raw.workTypes.find((type) => type.name === name)
  const typeOfName = (name) => Object.keys(types).find((type) => types[type] === name)
  return {
    raw, pmkit, view, viewer: view.viewer ?? null, space: raw.space.key,
    categoryOf: (name, key) => view.statuses.find((status) => status.name === name)?.category ?? categoryOfStatus(key) ?? 'in_progress',
    typeOfId: (id) => typeOfName(raw.workTypes.find((type) => type.id === String(id))?.name),
    typeOfName,
    workTypeOf: (type) => (Object.hasOwn(types, type) ? workTypeByName(types[type]) : undefined),
    priorityOf: readPriority,
    priorityIdOf: (level) => (raw.priorities ?? []).find((item) => readPriority(item.name) === level)?.id,
    linkType: (kind) => (raw.linkTypes ?? []).find((type) => lower(type.name) === LINK_NAMES[kind]) ?? null,
    fields: { estimate: view.fields.estimate?.id ?? null, criteria: view.fields.acceptance_criteria?.id ?? null },
  }
}

// The fields every work-item read asks for.
export const ISSUE_FIELDS = (context) => [...BASE_FIELDS, ...[context.fields.estimate, context.fields.criteria].filter(Boolean)]

// A Jira time such as 2026-11-22T10:00:00.000+0000 as ISO UTC with Z; undefined for none.
export function jiraTime(value) {
  if (!value) return undefined
  return new Date(String(value).replace(/([+-]\d\d)(\d\d)$/, '$1:$2')).toISOString()
}

const setDefined = (issue, key, value) => {
  if (value !== undefined && value !== null) issue[key] = value
}
const sortedKeys = (keys) => [...new Set(keys)].sort(compareIds)

/** The relation lists of issuelinks, and the category of each blocker from the link's inline status. */
function relationsOf(links, context) {
  const lists = { blockedBy: [], blocks: [], related: [], duplicateOf: [] }
  const blockerCategories = new Map()
  const named = (kind) => lower(context.linkType(kind)?.name ?? LINK_NAMES[kind])
  for (const entry of links ?? []) {
    const type = lower(entry.type?.name)
    const inward = entry.inwardIssue
    const outward = entry.outwardIssue
    if (type === named('blocks') && inward) {
      lists.blockedBy.push(inward.key)
      const status = inward.fields?.status
      blockerCategories.set(inward.key, context.categoryOf(status?.name, status?.statusCategory?.key))
    } else if (type === named('blocks') && outward) lists.blocks.push(outward.key)
    else if (type === named('related') && (inward || outward)) lists.related.push((inward ?? outward).key)
    else if (type === named('duplicate') && outward) lists.duplicateOf.push(outward.key)
  }
  return { lists: Object.fromEntries(Object.entries(lists).map(([key, ids]) => [key, sortedKeys(ids)])), blockerCategories }
}

/** The estimate field's value in pmkit units: hours for timeoriginalestimate, else the number. */
function estimateOf(fields, context) {
  const id = context.fields.estimate
  const value = id ? fields[id] : undefined
  if (typeof value !== 'number') return undefined
  return id === HOURS ? value / 3600 : value
}

/** The checklist items of a criteria field's text. */
const criteriaOfText = (text) => parseDescription(`${CRITERIA_HEADING}\n${text}`).acceptanceCriteria

function textsOf(fields, context) {
  const text = adfToText(fields.description)
  if (!context.fields.criteria) return parseDescription(text)
  return { description: text.trim(), acceptanceCriteria: criteriaOfText(adfToText(fields[context.fields.criteria])) }
}

// The pmkit issue of a Jira work item. Its blockers' categories ride along as the non-enumerable blockerCategories.
export function toIssue(item, context, { children = [] } = {}) {
  const fields = item.fields ?? {}
  const { lists, blockerCategories } = relationsOf(fields.issuelinks, context)
  const texts = textsOf(fields, context)
  const issue = { id: item.key, title: fields.summary }
  setDefined(issue, 'type', context.typeOfName(fields.issuetype?.name))
  issue.status = { name: fields.status?.name, category: context.categoryOf(fields.status?.name, fields.status?.statusCategory?.key) }
  setDefined(issue, 'priority', readPriority(fields.priority?.name))
  setDefined(issue, 'estimate', estimateOf(fields, context))
  setDefined(issue, 'assignee', fields.assignee?.accountId)
  issue.labels = [...(fields.labels ?? [])].sort()
  setDefined(issue, 'parent', fields.parent?.key)
  Object.assign(issue, lists)
  issue.children = sortedKeys([...(fields.subtasks ?? []).map((sub) => sub.key), ...children])
  issue.archived = false
  setDefined(issue, 'due', fields.duedate)
  setDefined(issue, 'branch', item.properties?.[BRANCH_PROPERTY])
  issue.description = texts.description
  issue.acceptanceCriteria = texts.acceptanceCriteria
  setDefined(issue, 'created', jiraTime(fields.created))
  setDefined(issue, 'updated', jiraTime(fields.updated))
  Object.defineProperty(issue, 'blockerCategories', { value: blockerCategories, enumerable: false })
  return issue
}

// Writes

function oneLine(field, value) {
  if (/[\r\n]/.test(value)) throw invalid(`${field} must not contain a line break`)
  return value
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

const checklist = (criteria) => criteria.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`).join('\n')
const adfOrNull = (text) => (text === '' ? null : textToAdf(text))

/** The skeleton issue a create starts from: the default work type's first status, nothing else set. */
function skeleton(context, workType, now) {
  const first = context.raw.statuses.find((status) => status.id === workType?.statuses?.[0])
  const issue = { id: null, title: '' }
  setDefined(issue, 'type', context.typeOfName(workType?.name))
  issue.status = first ? { name: first.name, category: context.categoryOf(first.name, first.categoryKey) } : { name: null, category: 'todo' }
  Object.assign(issue, { labels: [], blockedBy: [], blocks: [], related: [], duplicateOf: [], children: [], archived: false, description: '', acceptanceCriteria: [], created: now, updated: now })
  return issue
}

/** Without a type: the first standard work type named Task, else the first standard one. */
function defaultWorkType(context) {
  const standard = context.raw.workTypes.filter((type) => type.level === 'standard')
  return standard.find((type) => type.name === 'Task') ?? standard[0]
}

function workTypeOf(type, context) {
  if (type === null) throw invalid('type cannot be cleared: Jira needs a work type')
  const found = typeof type === 'string' ? context.workTypeOf(type) : undefined
  const known = Object.keys(context.pmkit?.mappings?.types ?? {})
  if (!found) throw invalid(`type "${type}" has no work type in mappings.types${known.length > 0 ? ` (${known.join(', ')})` : ''}`, SETUP)
  return found
}

function checkPatch(patch, create) {
  checkKeys(patch, create ? CREATE_KEYS : UPDATE_KEYS)
  if (patch.docs !== undefined) throw notSupported('the Jira adapter does not link docs to work items yet')
  for (const [key, issue] of Object.entries(LATER)) {
    if (patch[key] !== undefined && patch[key] !== null) throw notSupported(`the Jira adapter does not set ${key} yet (${issue})`)
  }
}

/** A write's state: the fields to send, the after issue, and the property to set. */
function plan(before) {
  const after = structuredClone(before)
  const result = { fields: {}, after }
  const set = (key, value) => {
    if (value === null || value === undefined) delete after[key]
    else after[key] = value
  }
  return { result, after, set }
}

function planTitle(patch, state, create) {
  if (!create && patch.title === undefined) return
  if (typeof patch.title !== 'string' || patch.title.trim() === '') throw invalid('title is required')
  const title = oneLine('title', patch.title.trim())
  if (create || title !== state.after.title) state.result.fields.summary = title
  state.after.title = title
}

function planType(patch, state, create, context) {
  if (patch.type === undefined && !create) return
  const workType = patch.type === undefined ? defaultWorkType(context) : workTypeOf(patch.type, context)
  if (!workType) throw notSupported(`space ${context.space} has no standard work type`, SETUP)
  const type = context.typeOfName(workType.name)
  if (create || type !== state.after.type) state.result.fields.issuetype = { id: workType.id }
  state.set('type', type)
}

function planTexts(patch, state, create, context) {
  if (patch.description === undefined && patch.acceptanceCriteria === undefined) return
  const { after } = state
  const description = patch.description === undefined ? after.description : patch.description === null ? '' : descriptionOf(patch.description)
  const criteria = patch.acceptanceCriteria === undefined ? after.acceptanceCriteria : patch.acceptanceCriteria === null ? [] : criteriaOf(patch.acceptanceCriteria)
  const field = context.fields.criteria
  const send = (key, text, old) => {
    if (create ? text !== '' : text !== old) state.result.fields[key] = adfOrNull(text)
  }
  if (field) {
    send('description', description, after.description)
    send(field, checklist(criteria), checklist(after.acceptanceCriteria))
  } else {
    send('description', buildDescription(description, criteria), buildDescription(after.description, after.acceptanceCriteria))
  }
  after.description = description
  after.acceptanceCriteria = criteria
}

function planPriority(patch, state, create, context) {
  const value = patch.priority
  if (value === undefined || (create && value === null)) return
  let id = null
  if (value !== null) {
    if (!PRIORITIES.includes(value)) throw invalid(`priority must be one of ${PRIORITIES.join(', ')}`)
    id = context.priorityIdOf(value)
    if (!id) throw invalid(`no priority of Jira at ${context.raw.site} reads as ${value}; it has ${(context.raw.priorities ?? []).map((item) => item.name).join(', ') || 'none'}`, SETUP)
  }
  if (create || value !== (state.after.priority ?? null)) state.result.fields.priority = id === null ? null : { id }
  state.set('priority', value)
}

function planEstimate(patch, state, create, context) {
  const value = patch.estimate
  if (value === undefined || (create && value === null)) return
  const field = context.fields.estimate
  if (!field) throw notSupported(`No estimate field in space ${context.space}`, SETUP)
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw invalid('estimate must be a number of 0 or more')
  const sent = value === null ? null : field === HOURS ? Math.round(value * 3600) : value
  if (create || value !== (state.after.estimate ?? null)) state.result.fields[field] = sent
  state.set('estimate', value)
}

function planLabels(patch, state, create) {
  if (patch.labels === undefined) return
  const labels = patch.labels ?? []
  if (!Array.isArray(labels) || labels.some((label) => typeof label !== 'string' || label === '')) throw invalid('labels must be a list of strings')
  const spaced = labels.find((label) => /\s/.test(label))
  if (spaced !== undefined) throw invalid(`label "${spaced}" holds a space, which Jira refuses`)
  const sorted = [...new Set(labels)].sort()
  if (create ? sorted.length > 0 : sorted.join('\n') !== state.after.labels.join('\n')) state.result.fields.labels = sorted
  state.after.labels = sorted
}

function planDue(patch, state, create) {
  const value = patch.due
  if (value === undefined || (create && value === null)) return
  if (value !== null && !validDate(value)) throw invalid('due must be a date as YYYY-MM-DD')
  if (create || value !== (state.after.due ?? null)) state.result.fields.duedate = value
  state.set('due', value)
}

/** The create-only keys: assignee, parent and status (moved after the create by the caller). */
function planCreateOnly(patch, state, context) {
  if (patch.assignee !== undefined && patch.assignee !== null) {
    const id = patch.assignee === 'me' ? context.viewer?.id : patch.assignee
    if (!context.view.members.some((member) => member.id === id)) {
      throw invalid(`assignee "${patch.assignee}" is not an assignable user of space ${context.space}`, 'pmkit discover', { stale: true })
    }
    state.result.fields.assignee = { accountId: id }
    state.after.assignee = id
  }
  if (patch.parent !== undefined && patch.parent !== null) {
    if (!isIssueKey(patch.parent)) throw invalid(`parent ${patch.parent} is not a Jira work item key`)
    state.result.fields.parent = { key: normalizeKey(patch.parent) }
    state.after.parent = normalizeKey(patch.parent)
  }
  if (patch.status !== undefined && patch.status !== null && !isCategory(patch.status)) throw invalid(`status ${patch.status} is not a pmkit category`)
}

function planBranch(patch, state, create) {
  if (patch.branch === undefined) return
  if (create) throw invalid('Jira keeps the branch on an existing work item only', 'Create the work item, then run pmkit issues update <key> --branch <name>')
  if (patch.branch !== null && !validBranch(patch.branch)) throw invalid(`branch ${patch.branch} is not a valid branch name`)
  if (patch.branch !== (state.after.branch ?? null)) state.result.property = { [BRANCH_PROPERTY]: patch.branch }
  state.set('branch', patch.branch)
}

// The Jira fields a patch sends (only the changed ones on update) and the issue it leaves; a changed branch is `property`.
export function toFields(patch, before, context, { create = false, now = new Date().toISOString() } = {}) {
  checkPatch(patch, create)
  const start = create ? skeleton(context, (typeof patch.type === 'string' ? context.workTypeOf(patch.type) : undefined) ?? defaultWorkType(context), now) : before
  const state = plan(start)
  if (create) state.result.fields.project = { key: context.space }
  planTitle(patch, state, create)
  planType(patch, state, create, context)
  planTexts(patch, state, create, context)
  planPriority(patch, state, create, context)
  planEstimate(patch, state, create, context)
  planLabels(patch, state, create)
  planDue(patch, state, create)
  if (create) planCreateOnly(patch, state, context)
  planBranch(patch, state, create)
  return state.result
}
