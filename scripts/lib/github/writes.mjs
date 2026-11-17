// A pmkit patch as GitHub mutation inputs, and the issue a dry run shows. Every check runs here, before any request, so a
// dry run refuses what the real write would refuse.
// See docs/specs/2026-11-16-pmk-87-github-issues-relations-history-design.md, "Writes" and "moveToCategory (criterion 2)".

import { buildDescription, CRITERIA_HEADING, parseDescription } from '../body-criteria.mjs'
import { validBranch } from '../config.mjs'
import { PmkitError } from '../errors.mjs'
import { CREATE_KEYS, UPDATE_KEYS, checkKeys } from '../issue-fields.mjs'
import { validDate } from '../local/sprints.mjs'
import { CATEGORIES, TERMINAL } from '../model.mjs'
import { CLOSED, CLOSED_NOT_PLANNED, OPEN } from './discovery.mjs'
import { itemOf, optionForPriority, PRIORITIES, ROLES, statusOf, toIssue } from './issues.mjs'
import { parseFieldSource } from './mappings.mjs'
import { sprintsOf } from './cycles.mjs'

const invalid = (message, nextStep, details) => new PmkitError('INVALID_INPUT', message, nextStep, details)
const notSupported = (message, nextStep) => new PmkitError('NOT_SUPPORTED', message, nextStep)
// A name discovery may not know yet. The caller refreshes the discovery once and plans again.
const stale = (message, nextStep) => invalid(message, nextStep, { stale: true })
const LABEL_STEP = 'Create the label on GitHub, then run pmkit discover'
const SETUP = '/pmkit:setup'
// The state each category asks for: closed with a reason for the terminal ones, open for the rest.
const CLOSE_REASON = { done: 'COMPLETED', canceled: 'NOT_PLANNED' }
const STATE_CATEGORY = { [OPEN]: 'todo', [CLOSED]: 'done', [CLOSED_NOT_PLANNED]: 'canceled' }

const empty = () => ({ nodes: [], pageInfo: { hasNextPage: false } })
const sameText = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

/** The Project as owner/number, as messages name it. */
export const projectName = (context) => `${context.raw.project.owner}/${context.raw.project.number}`

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

/** The body a patch writes, or undefined when it touches neither the description nor the criteria. */
function bodyOf(patch, beforeBody) {
  if (patch.description === undefined && patch.acceptanceCriteria === undefined) return undefined
  const before = parseDescription(beforeBody ?? '')
  const description = patch.description === undefined ? before.description : patch.description === null ? '' : descriptionOf(patch.description)
  const criteria = patch.acceptanceCriteria === undefined ? before.acceptanceCriteria : patch.acceptanceCriteria === null ? [] : criteriaOf(patch.acceptanceCriteria)
  return buildDescription(description, criteria)
}

function issueTypeId(type, context) {
  if (type === null) return null
  const known = Object.keys(context.pmkit?.mappings?.types ?? {})
  const found = typeof type === 'string' && known.includes(type) ? context.issueTypeOf(type) : undefined
  if (!found) throw invalid(`type "${type}" has no issue type in mappings.types${known.length > 0 ? ` (${known.join(', ')})` : ''}`, SETUP)
  return found.id
}

/** The label of a name, the exact spelling first, then ignoring case, as GitHub keeps label names unique without case. */
function requireLabel(context, name) {
  if (typeof name !== 'string') throw invalid('labels must be a list of strings')
  const labels = context.raw.labels ?? []
  const found = labels.find((label) => label.name === name) ?? labels.find((label) => sameText(label.name, name))
  if (!found) throw stale(`label ${name} is not a label of ${context.repo}`, LABEL_STEP)
  return found
}

/** The users GitHub can assign: the assignable users, plus the viewer when GitHub left the viewer out. */
function assignable(context) {
  const users = context.raw.users ?? []
  const viewer = context.raw.viewer
  return viewer?.id && viewer.login && !users.some((user) => sameText(user.login, viewer.login)) ? [...users, viewer] : users
}

/** The { id, login } of an assignable login. An unknown login is stale, so the caller refreshes once. */
export function requireAssignable(context, login) {
  const found = typeof login === 'string' ? assignable(context).find((user) => sameText(user.login, login)) : undefined
  if (!found) throw stale(`assignee "${login}" is not an assignable user of ${context.repo}`, 'pmkit discover')
  return { id: found.id, login: found.login }
}

/** The { source, field } a role writes to. Throws when the mapping names no field pmkit can write. */
function mappedField(role, context) {
  const key = ROLES[role].key
  const parsed = parseFieldSource(context.pmkit?.mappings?.fields?.[key])
  if (parsed?.source === 'issue' && !context.features?.issueFields) {
    throw notSupported(`this GitHub host has no issue fields, so pmkit does not write ${role} to issue:${parsed.name}`, SETUP)
  }
  const mapped = context.field(role)
  if (!mapped) throw notSupported(`mappings.fields.${key} names no GitHub field, so pmkit does not write ${role}`, SETUP)
  return mapped
}

function selectWrite(role, value, field, project) {
  const option = role === 'priority' ? optionForPriority(field.options, value) : field.options.find((item) => item.name === value)
  if (role === 'priority' && !PRIORITIES.includes(value)) throw invalid(`priority must be one of ${PRIORITIES.join(', ')}`)
  if (!option) throw invalid(`${role} ${value} has no option in the field ${field.name}`, `Use one of: ${field.options.map((item) => item.name).join(', ')}`)
  const write = project ? { singleSelectOptionId: option.id } : { fieldId: field.id, singleSelectOptionId: option.id }
  const shown = { __typename: project ? 'ProjectV2ItemFieldSingleSelectValue' : 'IssueFieldSingleSelectValue', name: option.name, optionId: option.id }
  return { write, shown }
}

function numberWrite(value, field, project) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw invalid('estimate must be a number of 0 or more')
  if (project) return { write: { number: value }, shown: { __typename: 'ProjectV2ItemFieldNumberValue', number: value } }
  return { write: { fieldId: field.id, numberValue: value }, shown: { __typename: 'IssueFieldNumberValue', value } }
}

function dateWrite(value, field, project) {
  if (!validDate(value)) throw invalid('due must be a date as YYYY-MM-DD')
  if (project) return { write: { date: value }, shown: { __typename: 'ProjectV2ItemFieldDateValue', date: value } }
  return { write: { fieldId: field.id, dateValue: value }, shown: { __typename: 'IssueFieldDateValue', value } }
}

/** The iteration of a sprint value in a field's configuration: 'current' is the active one, else a start date. Null when the date has none. */
function iterationOf(value, field, today) {
  if (value !== 'current' && !validDate(value)) throw invalid('sprint must be current or a start date as YYYY-MM-DD')
  const { sprints } = sprintsOf(field.configuration, today)
  const target = value === 'current' ? sprints.find((sprint) => sprint.state === 'active') : sprints.find((sprint) => sprint.id === value)
  if (value === 'current' && !target) throw invalid('there is no active sprint', 'pmkit cycle list')
  if (!target) return null
  // sprintsOf keeps the first iteration of a start date, and so does this lookup.
  const all = [...(field.configuration?.completedIterations ?? []), ...(field.configuration?.iterations ?? [])]
  return all.find((iteration) => iteration.startDate === target.id)
}

/** The iteration a sprint value stands for. An unknown date is stale, so the caller refreshes once. */
function requireIteration(value, field, today) {
  const iteration = iterationOf(value, field, today)
  if (!iteration) throw stale(`sprint ${value} is not an iteration of the field ${field.name}`, 'pmkit cycle list')
  return iteration
}

function iterationWrite(value, field, today) {
  const iteration = requireIteration(value, field, today)
  return {
    write: { iterationId: iteration.id },
    shown: { __typename: 'ProjectV2ItemFieldIterationValue', iterationId: iteration.id, title: iteration.title, startDate: iteration.startDate, duration: iteration.duration },
  }
}

/** The { write, shown } of a value that is not null, by the field's data type. */
function valueWrite(role, value, field, project, today) {
  if (role === 'sprint' && field.dataType === 'ITERATION' && project) return iterationWrite(value, field, today)
  if (field.dataType === 'SINGLE_SELECT') return selectWrite(role, value, field, project)
  if (role === 'estimate' && field.dataType === 'NUMBER') return numberWrite(value, field, project)
  if (role === 'due' && field.dataType === 'DATE') return dateWrite(value, field, project)
  throw notSupported(`the field ${field.name} is a ${field.dataType} field, which pmkit cannot write as ${role}`, SETUP)
}

/**
 * The write of one field role: { role, value, source, fieldId, write, shown }. `write` is GitHub's value (null clears it for a
 * Project field), `shown` the value the issue fragment would read after it.
 */
function fieldWrite(role, value, context, today) {
  const { source, field } = mappedField(role, context)
  const project = source === 'project'
  if (value === null) return { role, value, source, fieldId: field.id, write: project ? null : { fieldId: field.id, delete: true }, shown: null }
  const { write, shown } = valueWrite(role, value, field, project, today)
  return { role, value, source, fieldId: field.id, write, shown }
}

/** The item of the configured Project on a preview node, added with no id when the node has none. */
function previewItem(node, context) {
  node.projectItems ??= { nodes: [] }
  let item = itemOf(node, context)
  if (!item) {
    item = { id: null, isArchived: false, project: { id: context.project.id } }
    node.projectItems.nodes.push(item)
  }
  return item
}

function applyField(node, write, context) {
  if (write.source === 'project') {
    previewItem(node, context)[ROLES[write.role].alias] = write.shown
    return
  }
  const name = context.field(write.role).field.name
  const kept = (node.issueFieldValues?.nodes ?? []).filter((value) => value.field?.name !== name)
  node.issueFieldValues = { nodes: write.shown ? [...kept, { ...write.shown, field: { id: write.fieldId, name } }] : kept, pageInfo: { hasNextPage: false } }
}

/** The node of an issue that does not exist yet. With a Project it has an item, because createIssue always adds one. */
export function skeletonNode(context, at) {
  return {
    id: null, number: null, title: '', body: '', state: 'OPEN', stateReason: null, createdAt: at, updatedAt: at, url: null,
    repository: { nameWithOwner: context.repo }, author: { login: context.raw.viewer?.login ?? null }, issueType: null,
    assignees: { nodes: [] }, labels: empty(), parent: null, subIssues: empty(), blockedBy: empty(), blocking: empty(), duplicateOf: null,
    relatesTo: empty(), linkedBranches: { nodes: [] }, issueFieldValues: empty(),
    projectItems: { nodes: context.project ? [{ id: null, isArchived: false, project: { id: context.project.id } }] : [] },
  }
}

/** The node with a plan applied, so toIssue of it is the after of a dry run. */
function applyPlan(node, plan, context, parentNode) {
  const next = structuredClone(node)
  const { input } = plan
  if (input.title !== undefined) next.title = input.title
  if (input.body !== undefined) next.body = input.body
  if (input.issueTypeId !== undefined) {
    const type = context.raw.issueTypes.find((item) => item.id === input.issueTypeId)
    next.issueType = type ? { id: type.id, name: type.name } : null
  }
  if (input.labelIds !== undefined) next.labels = { nodes: input.labelIds.map((id) => context.raw.labels.find((label) => label.id === id)), pageInfo: { hasNextPage: false } }
  if (input.assigneeIds !== undefined) next.assignees = { nodes: input.assigneeIds.map((id) => ({ id, login: assignable(context).find((user) => user.id === id).login })) }
  if (input.parentIssueId !== undefined) next.parent = parentNode
  for (const write of plan.fields) applyField(next, write, context)
  return next
}

const given = (value) => value !== undefined && value !== null

function checkPatch(patch, create) {
  checkKeys(patch, create ? CREATE_KEYS : UPDATE_KEYS)
  if (patch.docs !== undefined) throw notSupported('the GitHub adapter does not link docs to issues yet')
  for (const key of ['milestone', 'release']) {
    if (given(patch[key])) throw notSupported(`the GitHub adapter does not set ${key} yet`)
  }
}

function planTitle(patch, node, create) {
  if (!create && patch.title === undefined) return {}
  if (typeof patch.title !== 'string' || patch.title.trim() === '') throw invalid('title is required')
  const title = oneLine('title', patch.title.trim())
  return create || title !== node.title ? { title } : {}
}

function planBody(patch, node, create) {
  const body = bodyOf(patch, node.body)
  if (body === undefined) return {}
  const changed = create ? body !== '' : body !== node.body
  return changed ? { body } : {}
}

/** True when types are labels: the repository has no enabled issue type. */
const typesAreLabels = (context) => context.raw.issueTypes.length === 0

/** The type label of a pmkit type, or null for type null. An unmapped type fails before any request. */
function typeLabelOf(type, context) {
  if (type === null) return null
  const found = typeof type === 'string' ? context.typeLabels.get(type) : undefined
  const known = [...context.typeLabels.keys()]
  if (!found) throw invalid(`type "${type}" has no label in mappings.types${known.length > 0 ? ` (${known.join(', ')})` : ''}`, SETUP)
  return found
}

function planType(patch, node, create, context) {
  if (patch.type === undefined || typesAreLabels(context)) return {}
  const id = issueTypeId(patch.type, context)
  const changed = create ? id !== null : id !== (node.issueType?.id ?? null)
  return changed ? { issueTypeId: id } : {}
}

/** The label a labels patch may not name: one that holds a status or a type, with the command that sets it. */
function refuseMapped(label, given, context) {
  if (!context.mappedLabelIds.has(label.id)) return
  const status = [...context.statusLabels.values()].some((held) => held.id === label.id)
  throw invalid(status ? `label ${given} holds a status; use pmkit issues move` : `label ${given} holds a type; use --type`)
}

/**
 * The labels of a write. A labels patch sets the labels that hold no status and no type, and the mapped labels the issue has
 * stay. Without issue types, a type patch swaps the type labels.
 */
function planLabels(patch, node, create, context) {
  const typeLabel = patch.type !== undefined && typesAreLabels(context)
  if (patch.labels === undefined && !typeLabel) return {}
  if (patch.labels !== undefined && patch.labels !== null && !Array.isArray(patch.labels)) throw invalid('labels must be a list of strings')
  const current = (node.labels?.nodes ?? []).map((label) => label.id)
  let ids = patch.labels === undefined
    ? [...current]
    : [
        ...current.filter((id) => context.mappedLabelIds.has(id)),
        ...(patch.labels ?? []).map((name) => {
          const label = requireLabel(context, oneLine('label', name))
          refuseMapped(label, name, context)
          return label.id
        }),
      ]
  if (typeLabel) {
    const target = typeLabelOf(patch.type, context)
    const typeIds = new Set([...context.typeLabels.values()].map((label) => label.id))
    ids = [...ids.filter((id) => !typeIds.has(id)), ...(target ? [target.id] : [])]
  }
  ids = [...new Set(ids)]
  const same = ids.length === current.length && ids.every((id) => current.includes(id))
  const changed = create ? ids.length > 0 : !same
  return changed ? { labelIds: ids } : {}
}

/** The assignee and parent of a create. An update sets them through assign and setParent. */
function planCreateOnly(patch, create, context, parentNode) {
  const slice = {}
  if (!create) return slice
  if (given(patch.assignee)) {
    const login = patch.assignee === 'me' ? context.raw.viewer?.login : patch.assignee
    slice.assigneeIds = [requireAssignable(context, login).id]
  }
  if (given(patch.parent)) {
    if (!parentNode) throw invalid(`parent ${patch.parent} is not an existing issue or epic`, 'pmkit issues list')
    slice.parentIssueId = parentNode.id
  }
  return slice
}

/** One field write per role the patch changes. A create skips the null roles, an update the roles that keep their value. */
function planFields(patch, create, beforeIssue, context, today) {
  // A sprint value is current or a start date. It compares as the start date it stands for, so 'current' on the sprint the issue holds changes nothing.
  const valueOf = (role) => {
    const value = patch[role]
    if (role !== 'sprint' || value === undefined || value === null) return value
    const mapped = context.field('sprint')
    return mapped ? requireIteration(value, mapped.field, today).startDate : value
  }
  const changes = (role) => {
    if (patch[role] === undefined) return false
    return create ? patch[role] !== null : (beforeIssue[role] ?? null) !== valueOf(role)
  }
  return Object.keys(ROLES).filter(changes).map((role) => fieldWrite(role, valueOf(role), context, today))
}

/** The branch name an update links, or undefined. */
function planBranch(patch, create) {
  if (patch.branch === undefined) return undefined
  if (patch.branch === null) {
    if (create) return undefined
    throw notSupported('the GitHub adapter does not unlink a branch from an issue', 'Unlink it in the Development section of the issue on GitHub')
  }
  if (create) throw invalid('GitHub links a branch to an existing issue only', 'Create the issue, then run pmkit issues branch <id>')
  if (!validBranch(patch.branch)) throw invalid(`branch ${patch.branch} is not a valid branch name`)
  return patch.branch
}

/** The move of a create's status, from the preview of the new issue. */
function planCreateStatus(status, preview, context) {
  if (!context.project) throw notSupported('tracker.scope.project is none, so a new issue takes no status', 'Create the issue, then run pmkit issues move <id> done')
  const option = context.project.options.find((item) => item.name === status)
  if (!option) throw invalid(`status ${status} is not a Status option of ${projectName(context)}`, `Use one of: ${context.project.options.map((item) => item.name).join(', ')}`)
  return planMove(preview, context.categoryOfOption(option.name), { status: option.name }, context)
}

/**
 * The GitHub input of a patch. mode is create or update; before is the issue's fragment node (null on create); parentNode the
 * fragment node of patch.parent on create (the caller reads it). Returns { input, fields, branch, move, after }: input for
 * createIssue (repositoryId included) or updateIssue (id left to the caller, only the keys that change), one field write per changed
 * role, the branch name of an update, the move steps of a create's status, and the issue a dry run shows. Throws before any request;
 * a name the discovery may not know yet throws with details.stale.
 */
export function planWrite(patch, { mode, before = null, context, parentNode = null, now = new Date().toISOString() }) {
  const create = mode === 'create'
  checkPatch(patch, create)
  const node = before ?? skeletonNode(context, now)
  const beforeIssue = before ? toIssue(before, context) : null
  const input = create ? { repositoryId: context.raw.repositoryId } : {}
  Object.assign(input, planTitle(patch, node, create))
  Object.assign(input, planBody(patch, node, create))
  Object.assign(input, planType(patch, node, create, context))
  Object.assign(input, planLabels(patch, node, create, context))
  Object.assign(input, planCreateOnly(patch, create, context, parentNode))
  const fields = planFields(patch, create, beforeIssue, context, now.slice(0, 10))
  const branch = planBranch(patch, create)

  const plan = { input, fields, branch, move: [] }
  const preview = previewOf(plan, { node, patch, create, context, parentNode })
  const after = toIssue(preview, context)
  plan.after = create ? { ...after, id: null } : after
  return plan
}

/** The node a dry run shows: the plan applied, then a create's status move and an update's branch. Sets plan.move. */
function previewOf(plan, { node, patch, create, context, parentNode }) {
  let preview = applyPlan(node, plan, context, parentNode)
  if (create && given(patch.status)) {
    const move = planCreateStatus(patch.status, preview, context)
    plan.move = move.steps
    preview = move.node
  }
  if (plan.branch !== undefined) preview.linkedBranches = { nodes: [{ ref: { name: plan.branch } }] }
  return preview
}

/** The option a move to a named status sets, or null when the status is a state status of discover. */
function namedOption(category, status, context) {
  const inCategory = context.project.options.filter((item) => context.categoryOfOption(item.name) === category)
  const option = inCategory.find((item) => item.name === status) ?? null
  const named = context.project.options.some((item) => item.name === status)
  // A state status of discover (Open, Closed, Closed as not planned) moves without an option, unless an option has that name.
  // Open stands for todo only when no option does.
  const stateMove = STATE_CATEGORY[status] === category && !named && (category !== 'todo' || inCategory.length === 0)
  if (!option && !stateMove) throw invalid(`status ${status} is not in category ${category}`, inCategory.length > 0 ? `Use one of: ${inCategory.map((item) => item.name).join(', ')}` : SETUP)
  return option
}

/**
 * Without a Project: the label steps of a move. The issue loses every status label but the target's, and gains the target's.
 * A category with no label moves only when the issue's state alone reaches it (todo, done, canceled).
 */
function labelSteps(node, category, status, context) {
  const target = context.statusLabels.get(category) ?? null
  if (status !== undefined) {
    const named = target !== null && sameText(target.name, status)
    const stateMove = STATE_CATEGORY[status] === category && (category !== 'todo' || target === null)
    if (!named && !stateMove) throw invalid(`status ${status} is not in category ${category}`, target ? `Use one of: ${target.name}` : SETUP)
  }
  if (!target && !['todo', ...TERMINAL].includes(category)) throw notSupported(`no label of ${context.repo} stands for ${category}`, SETUP)
  const statusIds = new Set([...context.statusLabels.values()].map((label) => label.id))
  const held = (node.labels?.nodes ?? []).filter(Boolean)
  const remove = held.filter((label) => statusIds.has(label.id) && label.id !== target?.id)
  const add = target && !held.some((label) => label.id === target.id) ? [target] : []
  const step = (op, labels) => ({ op, labelIds: labels.map((label) => label.id), names: labels.map((label) => label.name) })
  // The target first: the issue then reads the target as soon as it holds it, so history records one move, not a pass through todo.
  return [...(add.length > 0 ? [step('addLabels', add)] : []), ...(remove.length > 0 ? [step('removeLabels', remove)] : [])]
}

/** The Status option a move sets, or null when the move changes only the issue's state. */
function pickOption(category, status, context) {
  if (status !== undefined) return namedOption(category, status, context)
  const option = context.optionOf(category)
  // A closed issue reads done or canceled whatever its option, so those two still move without one.
  if (!option && !TERMINAL.includes(category)) throw notSupported(`no Status option of ${projectName(context)} stands for ${category}`, SETUP)
  return option
}

function optionSteps(node, option, context) {
  if (!option) return []
  const item = itemOf(node, context)
  const steps = item ? [] : [{ op: 'addItem' }]
  if (item?.status?.name !== option.name) steps.push({ op: 'setStatus', option })
  return steps
}

/** The reopen and close steps that bring the issue's state to the category's. */
function stateSteps(node, category, context) {
  const reason = CLOSE_REASON[category]
  const closed = node.state === 'CLOSED'
  if (!reason) return closed ? [{ op: 'reopen' }] : []
  if (!closed) return [{ op: 'close', reason }]
  // A closed DUPLICATE issue already reads as canceled, so a move to canceled keeps it closed as a duplicate.
  return statusOf(node, context).category !== category ? [{ op: 'reopen' }, { op: 'close', reason }] : []
}

const PREVIEW_STEP = {
  addItem: (next, step, context) => previewItem(next, context),
  setStatus: (next, step, context) => {
    previewItem(next, context).status = { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: step.option.name, optionId: step.option.id }
  },
  removeLabels: (next, step) => {
    next.labels = { nodes: (next.labels?.nodes ?? []).filter((label) => !step.labelIds.includes(label.id)), pageInfo: { hasNextPage: false } }
  },
  addLabels: (next, step, context) => {
    next.labels = { nodes: [...(next.labels?.nodes ?? []), ...step.labelIds.map((id) => context.raw.labels.find((label) => label.id === id))], pageInfo: { hasNextPage: false } }
  },
  reopen: (next) => Object.assign(next, { state: 'OPEN', stateReason: 'REOPENED' }),
  close: (next, step) => Object.assign(next, { state: 'CLOSED', stateReason: step.reason }),
}

/**
 * The steps of moveToCategory: { op: 'addItem' }, { op: 'setStatus', option }, without a Project { op: 'addLabels' } and
 * { op: 'removeLabels' } with labelIds and names, then { op: 'reopen' } and { op: 'close', reason }, in the
 * order GitHub gets them, only those that change something. Returns { steps, node, after }: the preview node and its issue.
 */
export function planMove(node, category, { status } = {}, context) {
  if (!CATEGORIES.includes(category)) throw invalid(`category must be one of ${CATEGORIES.join(', ')}`)
  // Without a Project, a move to done or canceled closes first: label changes on a closed issue change no status, so history
  // records one move.
  const labels = context.project ? null : labelSteps(node, category, status, context)
  const state = stateSteps(node, category, context)
  const steps = labels === null
    ? [...optionSteps(node, pickOption(category, status, context), context), ...state]
    : TERMINAL.includes(category) ? [...state, ...labels] : [...labels, ...state]
  const next = structuredClone(node)
  for (const step of steps) PREVIEW_STEP[step.op](next, step, context)
  return { steps, node: next, after: toIssue(next, context) }
}
