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

const invalid = (message, nextStep, details) => new PmkitError('INVALID_INPUT', message, nextStep, details)
const notSupported = (message, nextStep) => new PmkitError('NOT_SUPPORTED', message, nextStep)
// A name discovery may not know yet. The caller refreshes the discovery once and plans again.
const stale = (message, nextStep) => invalid(message, nextStep, { stale: true })
const LABEL_STEP = 'Create the label on GitHub, then run pmkit discover'
const SETUP = '/pmkit:setup'
const NO_PROJECT = 'tracker.scope.project is none, so issues have no status but open and closed'
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

/**
 * The write of one field role: { role, value, source, fieldId, write, shown }. `write` is GitHub's value (null clears it for a
 * Project field), `shown` the value the issue fragment would read after it.
 */
function fieldWrite(role, value, context) {
  const key = ROLES[role].key
  const parsed = parseFieldSource(context.pmkit?.mappings?.fields?.[key])
  if (parsed?.source === 'issue' && !context.features?.issueFields) {
    throw notSupported(`this GitHub host has no issue fields, so pmkit does not write ${role} to issue:${parsed.name}`, SETUP)
  }
  const mapped = context.field(role)
  if (!mapped) throw notSupported(`mappings.fields.${key} names no GitHub field, so pmkit does not write ${role}`, SETUP)
  const { source, field } = mapped
  if (value === null) {
    return { role, value, source, fieldId: field.id, write: source === 'project' ? null : { fieldId: field.id, delete: true }, shown: null }
  }
  const project = source === 'project'
  if (field.dataType === 'SINGLE_SELECT') {
    const option = role === 'priority' ? optionForPriority(field.options, value) : field.options.find((item) => item.name === value)
    if (role === 'priority' && !PRIORITIES.includes(value)) throw invalid(`priority must be one of ${PRIORITIES.join(', ')}`)
    if (!option) throw invalid(`${role} ${value} has no option in the field ${field.name}`, `Use one of: ${field.options.map((item) => item.name).join(', ')}`)
    const write = project ? { singleSelectOptionId: option.id } : { fieldId: field.id, singleSelectOptionId: option.id }
    const shown = { __typename: project ? 'ProjectV2ItemFieldSingleSelectValue' : 'IssueFieldSingleSelectValue', name: option.name, optionId: option.id }
    return { role, value, source, fieldId: field.id, write, shown }
  }
  if (role === 'estimate' && field.dataType === 'NUMBER') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw invalid('estimate must be a number of 0 or more')
    const write = project ? { number: value } : { fieldId: field.id, numberValue: value }
    return { role, value, source, fieldId: field.id, write, shown: project ? { __typename: 'ProjectV2ItemFieldNumberValue', number: value } : { __typename: 'IssueFieldNumberValue', value } }
  }
  if (role === 'due' && field.dataType === 'DATE') {
    if (!validDate(value)) throw invalid('due must be a date as YYYY-MM-DD')
    const write = project ? { date: value } : { fieldId: field.id, dateValue: value }
    return { role, value, source, fieldId: field.id, write, shown: project ? { __typename: 'ProjectV2ItemFieldDateValue', date: value } : { __typename: 'IssueFieldDateValue', value } }
  }
  throw notSupported(`the field ${field.name} is a ${field.dataType} field, which pmkit cannot write as ${role}`, SETUP)
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

/**
 * The GitHub input of a patch. mode is create or update; before is the issue's fragment node (null on create); parentNode the
 * fragment node of patch.parent on create (the caller reads it). Returns { input, fields, branch, move, after }: input for
 * createIssue (repositoryId included) or updateIssue (id left to the caller, only the keys that change), one field write per changed
 * role, the branch name of an update, the move steps of a create's status, and the issue a dry run shows. Throws before any request;
 * a name the discovery may not know yet throws with details.stale.
 */
export function planWrite(patch, { mode, before = null, context, parentNode = null, now = new Date().toISOString() }) {
  const create = mode === 'create'
  checkKeys(patch, create ? CREATE_KEYS : UPDATE_KEYS)
  if (patch.docs !== undefined) throw notSupported('the GitHub adapter does not link docs to issues yet')
  for (const key of ['sprint', 'milestone', 'release']) {
    if (patch[key] !== undefined && patch[key] !== null) throw notSupported(`the GitHub adapter does not set ${key} yet`)
  }
  const node = before ?? skeletonNode(context, now)
  const beforeIssue = before ? toIssue(before, context) : null
  const input = create ? { repositoryId: context.raw.repositoryId } : {}

  if (create || patch.title !== undefined) {
    if (typeof patch.title !== 'string' || patch.title.trim() === '') throw invalid('title is required')
    const title = oneLine('title', patch.title.trim())
    if (create || title !== node.title) input.title = title
  }
  const body = bodyOf(patch, node.body)
  if (body !== undefined && (create ? body !== '' : body !== node.body)) input.body = body
  if (patch.type !== undefined) {
    const id = issueTypeId(patch.type, context)
    if (create ? id !== null : id !== (node.issueType?.id ?? null)) input.issueTypeId = id
  }
  if (patch.labels !== undefined) {
    if (patch.labels !== null && !Array.isArray(patch.labels)) throw invalid('labels must be a list of strings')
    const ids = [...new Set((patch.labels ?? []).map((name) => requireLabel(context, oneLine('label', name)).id))]
    const current = (node.labels?.nodes ?? []).map((label) => label.id)
    const same = ids.length === current.length && ids.every((id) => current.includes(id))
    if (create ? ids.length > 0 : !same) input.labelIds = ids
  }
  if (create && patch.assignee !== undefined && patch.assignee !== null) {
    const login = patch.assignee === 'me' ? context.raw.viewer?.login : patch.assignee
    input.assigneeIds = [requireAssignable(context, login).id]
  }
  if (create && patch.parent !== undefined && patch.parent !== null) {
    if (!parentNode) throw invalid(`parent ${patch.parent} is not an existing issue or epic`, 'pmkit issues list')
    input.parentIssueId = parentNode.id
  }

  const fields = []
  for (const role of Object.keys(ROLES)) {
    if (patch[role] === undefined || (create && patch[role] === null)) continue
    if (!create && (beforeIssue[role] ?? null) === patch[role]) continue
    fields.push(fieldWrite(role, patch[role], context))
  }

  let branch
  if (patch.branch !== undefined && patch.branch !== null) {
    if (create) throw invalid('GitHub links a branch to an existing issue only', 'Create the issue, then run pmkit issues branch <id>')
    if (!validBranch(patch.branch)) throw invalid(`branch ${patch.branch} is not a valid branch name`)
    branch = patch.branch
  } else if (patch.branch === null && !create) {
    throw notSupported('the GitHub adapter does not unlink a branch from an issue', 'Unlink it in the Development section of the issue on GitHub')
  }

  const plan = { input, fields, branch, move: [] }
  let preview = applyPlan(node, plan, context, parentNode)
  if (create && patch.status !== undefined && patch.status !== null) {
    if (!context.project) throw notSupported('tracker.scope.project is none, so a new issue takes no status', 'Create the issue, then run pmkit issues move <id> done')
    const option = context.project.options.find((item) => item.name === patch.status)
    if (!option) throw invalid(`status ${patch.status} is not a Status option of ${projectName(context)}`, `Use one of: ${context.project.options.map((item) => item.name).join(', ')}`)
    const move = planMove(preview, context.categoryOfOption(option.name), { status: option.name }, context)
    plan.move = move.steps
    preview = move.node
  }
  if (branch !== undefined) preview.linkedBranches = { nodes: [{ ref: { name: branch } }] }
  const after = toIssue(preview, context)
  plan.after = create ? { ...after, id: null } : after
  return plan
}

/**
 * The steps of moveToCategory: { op: 'addItem' }, { op: 'setStatus', option }, { op: 'reopen' } and { op: 'close', reason }, in the
 * order GitHub gets them, only those that change something. Returns { steps, node, after }: the preview node and its issue.
 */
export function planMove(node, category, { status } = {}, context) {
  if (!CATEGORIES.includes(category)) throw invalid(`category must be one of ${CATEGORIES.join(', ')}`)
  let option = null
  // A state status of discover (Open, Closed, Closed as not planned) moves without an option, unless an option has that name.
  const stateTarget = status !== undefined && STATE_CATEGORY[status] === category
  if (!context.project) {
    if ((status !== undefined && !stateTarget) || !['todo', ...TERMINAL].includes(category)) throw notSupported(NO_PROJECT, SETUP)
  } else if (status !== undefined) {
    const inCategory = context.project.options.filter((item) => context.categoryOfOption(item.name) === category)
    option = inCategory.find((item) => item.name === status) ?? null
    const named = context.project.options.some((item) => item.name === status)
    // Open stands for todo only when no option does.
    const stateMove = stateTarget && !named && (category !== 'todo' || inCategory.length === 0)
    if (!option && !stateMove) throw invalid(`status ${status} is not in category ${category}`, inCategory.length > 0 ? `Use one of: ${inCategory.map((item) => item.name).join(', ')}` : SETUP)
  } else {
    option = context.optionOf(category)
    // A closed issue reads done or canceled whatever its option, so those two still move without one.
    if (!option && !TERMINAL.includes(category)) throw notSupported(`no Status option of ${projectName(context)} stands for ${category}`, SETUP)
  }

  const steps = []
  const item = itemOf(node, context)
  if (option) {
    if (!item) steps.push({ op: 'addItem' })
    if (item?.status?.name !== option.name) steps.push({ op: 'setStatus', option })
  }
  const reason = CLOSE_REASON[category]
  if (!reason) {
    if (node.state === 'CLOSED') steps.push({ op: 'reopen' })
  } else if (node.state !== 'CLOSED') {
    steps.push({ op: 'close', reason })
  } else if (statusOf(node, context).category !== category) {
    // A closed DUPLICATE issue already reads as canceled, so a move to canceled keeps it closed as a duplicate.
    steps.push({ op: 'reopen' }, { op: 'close', reason })
  }

  const next = structuredClone(node)
  for (const step of steps) {
    if (step.op === 'addItem') previewItem(next, context)
    if (step.op === 'setStatus') previewItem(next, context).status = { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: step.option.name, optionId: step.option.id }
    if (step.op === 'reopen') Object.assign(next, { state: 'OPEN', stateReason: 'REOPENED' })
    if (step.op === 'close') Object.assign(next, { state: 'CLOSED', stateReason: step.reason })
  }
  return { steps, node: next, after: toIssue(next, context) }
}
