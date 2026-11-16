// A stateful fake of the GitHub GraphQL API for the issue operations of scripts/lib/github/documents.mjs.
// It keeps issues, Project items, comments, timelines, linked branches and branch heads in memory and answers each
// document by its operation name. Unit tests inject `exec`; the E2E fake gh reaches it through answerGh and fixture.issues.
// Its behavior follows the schema facts of docs/specs/2026-11-16-pmk-87-github-issues-relations-history-design.md.

import { answerGhWith, linkedReply, projectReply, repoReply } from './fake-github-api.mjs'
import { hostFeatures } from './lib/github/documents.mjs'

const STATE_VERSION = 1
const DEFAULT_USERS = [{ id: 'U_1', login: 'octocat', name: 'The Octocat' }, { id: 'U_2', login: 'hubot', name: 'Hubot' }]
const DEFAULT_OID = 'c0ffee0000000000000000000000000000000000'
// The page size of each nested connection of the issue fragment.
const NESTED = { assignees: 10, labels: 50, subIssues: 50, blockedBy: 50, blocking: 50, relatesTo: 50, linkedBranches: 5, projectItems: 20, issueFieldValues: 20 }
// Alias and variable of each Project field the fragment may select with fieldValueByName.
const ALIASES = [['status', 'fStatus'], ['fPriority', 'fPriority'], ['fEstimate', 'fEstimate'], ['fDue', 'fDue']]

/** A reply thrown inside a handler: GitHub's answer to a refused call. */
class Refusal extends Error {
  constructor(reply) {
    super(reply.errors?.[0]?.message ?? 'refused')
    this.reply = reply
  }
}
const refuse = (type, message) => {
  throw new Refusal({ errors: [{ type, message }] })
}
const unknownNode = (id) => refuse('NOT_FOUND', `Could not resolve to a node with the global id of '${id}'`)
const unprocessable = (message) => refuse('UNPROCESSABLE', message)

/** The typename of each timeline item type, named one by one so no case rule can get one wrong. */
export const TIMELINE_TYPENAMES = {
  ISSUE_COMMENT: 'IssueComment', RENAMED_TITLE_EVENT: 'RenamedTitleEvent', ASSIGNED_EVENT: 'AssignedEvent', UNASSIGNED_EVENT: 'UnassignedEvent',
  LABELED_EVENT: 'LabeledEvent', UNLABELED_EVENT: 'UnlabeledEvent', CLOSED_EVENT: 'ClosedEvent', REOPENED_EVENT: 'ReopenedEvent',
  ISSUE_TYPE_ADDED_EVENT: 'IssueTypeAddedEvent', ISSUE_TYPE_CHANGED_EVENT: 'IssueTypeChangedEvent', ISSUE_TYPE_REMOVED_EVENT: 'IssueTypeRemovedEvent',
  BLOCKED_BY_ADDED_EVENT: 'BlockedByAddedEvent', BLOCKED_BY_REMOVED_EVENT: 'BlockedByRemovedEvent', BLOCKING_ADDED_EVENT: 'BlockingAddedEvent',
  BLOCKING_REMOVED_EVENT: 'BlockingRemovedEvent', PARENT_ISSUE_ADDED_EVENT: 'ParentIssueAddedEvent', PARENT_ISSUE_REMOVED_EVENT: 'ParentIssueRemovedEvent',
  SUB_ISSUE_ADDED_EVENT: 'SubIssueAddedEvent', SUB_ISSUE_REMOVED_EVENT: 'SubIssueRemovedEvent', MARKED_AS_DUPLICATE_EVENT: 'MarkedAsDuplicateEvent',
  UNMARKED_AS_DUPLICATE_EVENT: 'UnmarkedAsDuplicateEvent', PROJECT_V2_ITEM_STATUS_CHANGED_EVENT: 'ProjectV2ItemStatusChangedEvent',
}
const typenamesOf = (itemTypes) => new Set(itemTypes.map((itemType) => TIMELINE_TYPENAMES[itemType]))

/** A Relay connection over list: the cursor is the index of a node, as a string. first undefined returns every node. */
function connection(list, first, after) {
  const start = after === undefined || after === null || Number.isNaN(Number(after)) ? 0 : Number(after) + 1
  const end = first === undefined || first === null ? list.length : start + first
  const nodes = list.slice(start, end)
  return { nodes, pageInfo: { hasNextPage: end < list.length, endCursor: nodes.length ? String(start + nodes.length - 1) : null } }
}

const page = (nodes) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: nodes.length ? String(nodes.length - 1) : null } })

/** The initial state of a fake from its options. */
function initialState({
  host = 'github.com',
  ghesVersion = null,
  repo = 'acme/widgets',
  repositoryId = 'R_1',
  project = {},
  issueFields,
  issueTypes,
  labels = ['bug', 'documentation'],
  users = DEFAULT_USERS,
  viewer = 'octocat',
  branches = { main: DEFAULT_OID },
  now = '2026-11-16T12:00:00.000Z',
} = {}) {
  const defaults = repoReply().data.repository
  return {
    version: STATE_VERSION,
    host,
    ghesVersion,
    repo,
    viewer,
    repositories: [{ nameWithOwner: repo, id: repositoryId, next: 1, branches: { ...branches } }],
    project: projectOf(project, repo),
    issueFields: structuredClone(issueFields ?? defaults.issueFields.nodes),
    issueTypes: structuredClone(issueTypes ?? defaults.issueTypes.nodes),
    labels: labels.map((label, index) => (typeof label === 'string' ? { id: `LA_${index + 1}`, name: label } : { ...label })),
    users: structuredClone(users),
    clock: new Date(now).toISOString(),
    counters: { comment: 0, item: 0, event: 0 },
    issues: [],
    items: [],
    failures: {},
  }
}

/** The Project of the options: null for none, else its id, owner, number, title and fields. */
function projectOf(project, repo) {
  if (project === null) return null
  const { id = 'PVT_1', owner = repo.split('/')[0], number = 7, title = 'Roadmap', statusOptions, fields } = project
  const nodes = fields ?? projectReply({ number, title, status: statusOptions }).data.repositoryOwner.projectV2.fields.nodes
  return { id, owner, number, title, fields: structuredClone(nodes) }
}

/**
 * A stateful fake GitHub. Options and defaults: host 'github.com', ghesVersion null, repo 'acme/widgets', repositoryId 'R_1',
 * project { id: 'PVT_1', owner, number: 7, title: 'Roadmap', statusOptions, fields } (null for none), issueFields and
 * issueTypes (repoReply's), labels ['bug', 'documentation'], users (octocat, hubot), viewer 'octocat',
 * branches { main: <oid> } (the scope repository's branch heads; seedBranch adds more, in any repository), now '2026-11-16T12:00:00.000Z' (the clock start).
 */
export function fakeGithubIssues(options = {}) {
  return build(initialState(options))
}

/** Rebuilds a fake from fake.toJSON(); its clock continues from the saved time. */
export function fakeGithubIssuesFrom(json) {
  if (json?.version !== STATE_VERSION) throw new Error('fakeGithubIssuesFrom needs the toJSON() of a fake GitHub')
  return build(structuredClone(json))
}

function build(state) {
  const features = hostFeatures({ host: state.host, ghesVersion: state.ghesVersion })
  const mutations = []
  const reads = []

  const stamp = () => {
    state.clock = new Date(Date.parse(state.clock) + 1000).toISOString()
    return state.clock
  }

  // Lookups.
  const sameName = (a, b) => a.toLowerCase() === b.toLowerCase()
  const repositoryOf = (owner, name) => state.repositories.find((entry) => sameName(entry.nameWithOwner, `${owner}/${name}`)) ?? null
  const repositoryById = (id) => state.repositories.find((entry) => entry.id === id) ?? unknownNode(id)
  const findIssue = (id) => state.issues.find((record) => record.id === id) ?? null
  const issueById = (id) => findIssue(id) ?? unknownNode(id)
  const issueByNumber = (repo, number) => state.issues.find((record) => sameName(record.repo, repo) && record.number === number) ?? null
  const userById = (id) => state.users.find((user) => user.id === id) ?? unknownNode(id)
  const labelById = (id) => state.labels.find((label) => label.id === id) ?? unknownNode(id)
  const typeById = (id) => state.issueTypes.find((type) => type.id === id) ?? unknownNode(id)
  const viewerUser = () => state.users.find((user) => user.login === state.viewer) ?? { id: 'U_0', login: state.viewer, name: null }
  const projectById = (id) => (state.project?.id === id ? state.project : unknownNode(id))
  const itemById = (id) => state.items.find((item) => item.id === id) ?? unknownNode(id)
  const itemsOf = (issueId) => state.items.filter((item) => item.issueId === issueId)
  const projectField = (id) => state.project.fields.find((field) => field.id === id) ?? unknownNode(id)
  const issueField = (id) => state.issueFields.find((field) => field.id === id) ?? unknownNode(id)

  // Nodes.
  const linkOf = (record) => ({ number: record.number, repository: { nameWithOwner: record.repo } })
  const refOf = (record) => ({ id: record.id, number: record.number, state: record.state, stateReason: record.stateReason, repository: { nameWithOwner: record.repo } })
  const refById = (id) => (id && findIssue(id) ? refOf(findIssue(id)) : null)
  const blockingOf = (record) => state.issues.filter((other) => other.blockedByIds.includes(record.id))

  function projectValue(item, fieldName) {
    if (!state.project || item.projectId !== state.project.id) return null
    const field = state.project.fields.find((candidate) => candidate.name === fieldName)
    const value = field && item.values[field.id]
    if (!value) return null
    if (field.dataType === 'SINGLE_SELECT') {
      const option = field.options.find((candidate) => candidate.id === value.optionId)
      return { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: option?.name ?? null, optionId: value.optionId }
    }
    if (field.dataType === 'NUMBER') return { __typename: 'ProjectV2ItemFieldNumberValue', number: value.number }
    if (field.dataType === 'DATE') return { __typename: 'ProjectV2ItemFieldDateValue', date: value.date }
    return null
  }

  function itemNode(item, vars) {
    const node = { id: item.id, isArchived: item.isArchived, project: { id: item.projectId } }
    for (const [alias, variable] of ALIASES) if (typeof vars[variable] === 'string') node[alias] = projectValue(item, vars[variable])
    return node
  }

  function issueFieldNodes(record) {
    return state.issueFields.flatMap((field) => {
      const value = record.fieldValues[field.id]
      if (!value) return []
      const ref = { id: field.id, name: field.name }
      if (field.dataType === 'SINGLE_SELECT') {
        const option = field.options.find((candidate) => candidate.id === value.optionId)
        return [{ __typename: 'IssueFieldSingleSelectValue', optionId: value.optionId, name: option?.name ?? null, field: ref }]
      }
      const typename = field.dataType === 'NUMBER' ? 'IssueFieldNumberValue' : 'IssueFieldDateValue'
      return [{ __typename: typename, value: value.value, field: ref }]
    })
  }

  /** The full list behind each paged connection of an issue. */
  function listsOf(record, vars) {
    const ids = (list) => list.map(findIssue).filter(Boolean)
    return {
      assignees: record.assigneeIds.map(userById).map(({ id, login }) => ({ id, login })),
      labels: record.labelIds.map(labelById),
      subIssues: ids(record.subIssueIds).map(refOf),
      blockedBy: ids(record.blockedByIds).map((other) => ({ ...refOf(other), projectItems: { nodes: itemsOf(other.id).map((item) => itemNode(item, vars)) } })),
      blocking: blockingOf(record).map(refOf),
      relatesTo: ids(record.relatesToIds).map(refOf),
      projectItems: itemsOf(record.id).map((item) => itemNode(item, vars)),
    }
  }

  function issueNode(record, vars = {}) {
    const lists = listsOf(record, vars)
    const nested = (name) => connection(lists[name], NESTED[name])
    const type = record.issueTypeId ? state.issueTypes.find((candidate) => candidate.id === record.issueTypeId) : null
    const node = {
      __typename: 'Issue',
      id: record.id, number: record.number, title: record.title, body: record.body, state: record.state, stateReason: record.stateReason,
      createdAt: record.createdAt, updatedAt: record.updatedAt, url: `https://${state.host}/${record.repo}/issues/${record.number}`,
      repository: { nameWithOwner: record.repo },
      author: record.author ? { login: record.author } : null,
      issueType: type ? { id: type.id, name: type.name } : null,
      assignees: nested('assignees'),
      labels: nested('labels'),
      parent: refById(record.parentId),
      subIssues: nested('subIssues'),
      blockedBy: nested('blockedBy'),
      blocking: nested('blocking'),
      duplicateOf: refById(record.duplicateOfId),
      linkedBranches: { nodes: record.linkedBranches.slice(0, NESTED.linkedBranches).map((name) => ({ ref: { name } })) },
      projectItems: nested('projectItems'),
    }
    if (features.relatesTo) node.relatesTo = nested('relatesTo')
    if (features.issueFields) node.issueFieldValues = connection(issueFieldNodes(record), NESTED.issueFieldValues)
    return node
  }

  function timelineOf(record, { since, itemTypes }) {
    const kept = Array.isArray(itemTypes) ? typenamesOf(itemTypes) : null
    return record.timeline.filter((item) => (!since || item.createdAt >= since) && (!kept || kept.has(item.__typename)))
  }

  // Timeline events and writes.
  const event = (record, typename, fields, at) => {
    state.counters.event += 1
    record.timeline.push({ __typename: typename, id: `E_${state.counters.event}`, actor: { login: state.viewer }, createdAt: at, ...fields })
  }
  const touch = (at, ...records) => records.forEach((record) => { record.updatedAt = at })

  function newIssue(entry, { number, title, body = '', author = state.viewer, createdAt, updatedAt }) {
    const chosen = number ?? entry.next
    if (issueByNumber(entry.nameWithOwner, chosen)) throw new Error(`fake GitHub: ${entry.nameWithOwner}#${chosen} exists already`)
    entry.next = Math.max(entry.next, chosen + 1)
    const id = entry.nameWithOwner === state.repo ? `I_${chosen}` : `I_${entry.nameWithOwner.replace(/[^A-Za-z0-9]/g, '_')}_${chosen}`
    const at = createdAt ?? stamp()
    const record = {
      id, repo: entry.nameWithOwner, number: chosen, title, body, state: 'OPEN', stateReason: null, createdAt: at, updatedAt: updatedAt ?? at, author,
      issueTypeId: null, assigneeIds: [], labelIds: [], parentId: null, subIssueIds: [], blockedByIds: [], duplicateOfId: null, relatesToIds: [],
      linkedBranches: [], fieldValues: {}, timeline: [],
    }
    state.issues.push(record)
    return record
  }

  function setLabels(record, labelIds, at) {
    labelIds.forEach(labelById)
    for (const id of labelIds.filter((id) => !record.labelIds.includes(id))) event(record, 'LabeledEvent', { label: { name: labelById(id).name } }, at)
    for (const id of record.labelIds.filter((id) => !labelIds.includes(id))) event(record, 'UnlabeledEvent', { label: { name: labelById(id).name } }, at)
    record.labelIds = [...labelIds]
  }

  function setAssignees(record, assigneeIds, at) {
    assigneeIds.forEach(userById)
    for (const id of assigneeIds.filter((id) => !record.assigneeIds.includes(id))) event(record, 'AssignedEvent', { assignee: { login: userById(id).login } }, at)
    for (const id of record.assigneeIds.filter((id) => !assigneeIds.includes(id))) event(record, 'UnassignedEvent', { assignee: { login: userById(id).login } }, at)
    record.assigneeIds = [...assigneeIds]
  }

  function setType(record, issueTypeId, at) {
    const before = record.issueTypeId ? typeById(record.issueTypeId) : null
    const after = issueTypeId ? typeById(issueTypeId) : null
    if (before?.id === after?.id) return
    if (!before) event(record, 'IssueTypeAddedEvent', { issueType: { name: after.name } }, at)
    else if (!after) event(record, 'IssueTypeRemovedEvent', { issueType: { name: before.name } }, at)
    else event(record, 'IssueTypeChangedEvent', { prevIssueType: { name: before.name }, issueType: { name: after.name } }, at)
    record.issueTypeId = after?.id ?? null
  }

  function attach(parent, child, at) {
    if (parent.id === child.id) unprocessable('An issue cannot be its own sub-issue')
    parent.subIssueIds.push(child.id)
    child.parentId = parent.id
    event(child, 'ParentIssueAddedEvent', { parent: linkOf(parent) }, at)
    event(parent, 'SubIssueAddedEvent', { subIssue: linkOf(child) }, at)
    touch(at, parent, child)
  }

  function detach(parent, child, at) {
    parent.subIssueIds = parent.subIssueIds.filter((id) => id !== child.id)
    child.parentId = null
    event(child, 'ParentIssueRemovedEvent', { parent: linkOf(parent) }, at)
    event(parent, 'SubIssueRemovedEvent', { subIssue: linkOf(child) }, at)
    touch(at, parent, child)
  }

  function close(record, reason, duplicateIssueId, at) {
    if (reason === 'DUPLICATE') {
      if (!duplicateIssueId) unprocessable('A duplicate close needs duplicateIssueId')
      const canonical = issueById(duplicateIssueId)
      if (canonical.id === record.id) unprocessable('An issue cannot be a duplicate of itself')
      if (record.state === 'CLOSED' && record.stateReason === reason && record.duplicateOfId === canonical.id) return
      record.duplicateOfId = canonical.id
      event(record, 'MarkedAsDuplicateEvent', { canonical: { __typename: 'Issue', ...linkOf(canonical) } }, at)
    }
    if (record.state === 'CLOSED' && record.stateReason === reason) return
    record.state = 'CLOSED'
    record.stateReason = reason
    event(record, 'ClosedEvent', { stateReason: reason }, at)
    touch(at, record)
  }

  function reopen(record, at) {
    if (record.state === 'OPEN') return
    record.state = 'OPEN'
    record.stateReason = 'REOPENED'
    event(record, 'ReopenedEvent', {}, at)
    touch(at, record)
  }

  const statusName = (item) => projectValue(item, 'Status')?.name ?? null

  /** Writes one Project field value, with the Status change event where the host has it. */
  function writeProjectValue(item, field, value, at) {
    const before = statusName(item)
    if (value === null) delete item.values[field.id]
    else item.values[field.id] = value
    const record = issueById(item.issueId)
    if (field.name === 'Status' && features.statusEvents && before !== statusName(item)) {
      event(record, 'ProjectV2ItemStatusChangedEvent', { previousStatus: before, status: statusName(item), project: { id: item.projectId } }, at)
    }
    touch(at, record)
  }

  function projectValueOf(field, value) {
    if (field.dataType === 'SINGLE_SELECT') {
      const optionId = value?.singleSelectOptionId
      if (!field.options.some((option) => option.id === optionId)) unprocessable(`The single select option Id does not belong to the field ${field.name}`)
      return { optionId }
    }
    if (field.dataType === 'NUMBER' && typeof value?.number === 'number') return { number: value.number }
    if (field.dataType === 'DATE' && typeof value?.date === 'string') return { date: value.date }
    return unprocessable(`The value does not fit the field ${field.name}`)
  }

  function addItem(projectId, contentId) {
    const project = projectById(projectId)
    const record = issueById(contentId)
    const found = state.items.find((item) => item.projectId === project.id && item.issueId === record.id)
    if (found) return found
    state.counters.item += 1
    const item = { id: `PVTI_${state.counters.item}`, projectId: project.id, issueId: record.id, isArchived: false, values: {} }
    state.items.push(item)
    return item
  }

  const ids = (record) => ({ id: record.id, number: record.number })

  // Queries. Each takes the variables and returns the data, or throws a Refusal.
  const queries = {
    PmkitRepo({ owner, name }) {
      const viewer = viewerUser()
      const entry = repositoryOf(owner, name)
      if (!entry) refuseWithData({ viewer: { id: viewer.id, login: viewer.login, name: viewer.name }, repository: null }, ['repository'], `Could not resolve to a Repository with the name '${owner}/${name}'.`)
      const [login, repoName] = entry.nameWithOwner.split('/')
      const reply = repoReply({ owner: login, name: repoName, types: state.issueTypes, fields: features.issueFields ? state.issueFields : null, labels: [] }).data
      reply.viewer = { id: viewer.id, login: viewer.login, name: viewer.name }
      Object.assign(reply.repository, { id: entry.id, labels: page(state.labels), assignableUsers: page(state.users) })
      return reply
    },
    PmkitProject({ owner, number }) {
      const project = state.project
      if (!project || !sameName(project.owner, owner ?? '') || project.number !== number) {
        refuseWithData({ repositoryOwner: { projectV2: null } }, ['repositoryOwner', 'projectV2'], `Could not resolve to a ProjectV2 with the number ${number}.`)
      }
      const reply = projectReply({ number: project.number, title: project.title, extra: project.fields }).data
      Object.assign(reply.repositoryOwner.projectV2, { id: project.id, url: `https://${state.host}/orgs/${project.owner}/projects/${project.number}` })
      return reply
    },
    PmkitLinkedProjects: () => linkedReply(state.project ? [{ number: state.project.number, title: state.project.title, owner: state.project.owner }] : []).data,
    PmkitIssue(vars) {
      const entry = requireRepository(vars)
      const record = issueByNumber(entry.nameWithOwner, vars.number)
      if (!record) refuseWithData({ repository: { issue: null } }, ['repository', 'issue'], `Could not resolve to an issue or pull request with the number of ${vars.number}.`)
      return { repository: { issue: issueNode(record, vars) } }
    },
    PmkitIssues(vars) {
      const entry = requireRepository(vars)
      const { states, assignee, labels, type, since } = vars.filterBy ?? {}
      const labelNames = (record) => record.labelIds.map((id) => labelById(id).name)
      const listed = state.issues
        .filter((record) => sameName(record.repo, entry.nameWithOwner))
        .filter((record) => !states?.length || states.includes(record.state))
        .filter((record) => !assignee || record.assigneeIds.some((id) => userById(id).login === assignee))
        .filter((record) => !labels?.length || labelNames(record).some((label) => labels.includes(label)))
        .filter((record) => !type || (record.issueTypeId && typeById(record.issueTypeId).name === type))
        .filter((record) => !since || record.updatedAt >= since)
        .sort(vars.orderBy?.field === 'UPDATED_AT' && vars.orderBy.direction === 'DESC'
          ? (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.number - a.number
          : (a, b) => a.createdAt.localeCompare(b.createdAt) || a.number - b.number)
      return { repository: { issues: connection(listed.map((record) => issueNode(record, vars)), vars.first, vars.after) } }
    },
    PmkitIssueMore(vars, name) {
      const field = name.slice('PmkitIssueMore_'.length)
      const lists = listsOf(issueById(vars.id), vars)
      if (!Object.hasOwn(lists, field)) throw new Refusal({ errors: [{ message: `Field '${field}' doesn't exist on type 'Issue'` }] })
      return { node: { __typename: 'Issue', [field]: connection(lists[field], vars.first, vars.after) } }
    },
    PmkitTimeline(vars) {
      return { node: { __typename: 'Issue', timelineItems: connection(timelineOf(issueById(vars.id), vars), vars.first, vars.after) } }
    },
    PmkitTimelines(vars) {
      const missing = (vars.ids ?? []).map((id, index) => [id, index]).filter(([id]) => !findIssue(id))
      const nodes = (vars.ids ?? []).map((id) => {
        const record = findIssue(id)
        return record && { __typename: 'Issue', id, number: record.number, repository: { nameWithOwner: record.repo }, timelineItems: connection(timelineOf(record, vars), 100) }
      })
      if (missing.length) {
        throw new Refusal({ data: { nodes }, errors: missing.map(([id, index]) => ({ type: 'NOT_FOUND', path: ['nodes', index], message: `Could not resolve to a node with the global id of '${id}'` })) })
      }
      return { nodes }
    },
    PmkitComments(vars) {
      const comments = issueById(vars.id).timeline.filter((item) => item.__typename === 'IssueComment')
      return { node: { __typename: 'Issue', comments: connection(comments, vars.first, vars.after) } }
    },
    PmkitBranchHead(vars) {
      const entry = requireRepository(vars)
      const name = String(vars.qualifiedName ?? '').replace(/^refs\/heads\//, '')
      const oid = entry.branches[name]
      return { repository: { id: entry.id, ref: oid ? { name, target: { oid } } : null } }
    },
    PmkitAssignableUsers(vars) {
      requireRepository(vars)
      return { repository: { assignableUsers: connection(state.users, vars.first, vars.after) } }
    },
  }

  function refuseWithData(data, path, message) {
    throw new Refusal({ data, errors: [{ type: 'NOT_FOUND', path, message }] })
  }

  function requireRepository({ owner, name }) {
    return repositoryOf(owner ?? '', name ?? '') ?? refuseWithData({ repository: null }, ['repository'], `Could not resolve to a Repository with the name '${owner}/${name}'.`)
  }

  // Mutations. Each takes the input and the time of the call, and returns the data.
  const withFragment = (field, run) => (input, at, vars) => ({ [field]: { issue: issueNode(run(input, at), vars) } })
  const mutationRoutes = {
    PmkitCreateIssue: withFragment('createIssue', (input, at) => {
      const entry = repositoryById(input.repositoryId)
      if (typeof input.title !== 'string' || input.title.trim() === '') unprocessable("Title can't be blank")
      const parent = input.parentIssueId ? issueById(input.parentIssueId) : null
      ;(input.assigneeIds ?? []).forEach(userById)
      ;(input.labelIds ?? []).forEach(labelById)
      if (input.issueTypeId) typeById(input.issueTypeId)
      const record = newIssue(entry, { title: input.title, body: input.body ?? '', createdAt: at })
      setLabels(record, input.labelIds ?? [], at)
      setAssignees(record, input.assigneeIds ?? [], at)
      setType(record, input.issueTypeId ?? null, at)
      if (parent) attach(parent, record, at)
      return record
    }),
    PmkitUpdateIssue: withFragment('updateIssue', (input, at) => {
      const record = issueById(input.id)
      ;(input.assigneeIds ?? []).forEach(userById)
      ;(input.labelIds ?? []).forEach(labelById)
      if (input.issueTypeId) typeById(input.issueTypeId)
      if (typeof input.title === 'string' && input.title !== record.title) {
        event(record, 'RenamedTitleEvent', { previousTitle: record.title, currentTitle: input.title }, at)
        record.title = input.title
      }
      if (typeof input.body === 'string') record.body = input.body
      if (Array.isArray(input.labelIds)) setLabels(record, input.labelIds, at)
      if (Array.isArray(input.assigneeIds)) setAssignees(record, input.assigneeIds, at)
      if (Object.hasOwn(input, 'issueTypeId')) setType(record, input.issueTypeId, at)
      if (input.state === 'CLOSED') close(record, 'COMPLETED', null, at)
      if (input.state === 'OPEN') reopen(record, at)
      touch(at, record)
      return record
    }),
    PmkitCloseIssue: withFragment('closeIssue', (input, at) => {
      const record = issueById(input.issueId)
      close(record, input.stateReason ?? 'COMPLETED', input.duplicateIssueId, at)
      return record
    }),
    PmkitReopenIssue: withFragment('reopenIssue', (input, at) => {
      const record = issueById(input.issueId)
      reopen(record, at)
      return record
    }),
    PmkitAddProjectItem: (input) => ({ addProjectV2ItemById: { item: { id: addItem(input.projectId, input.contentId).id } } }),
    PmkitSetProjectField: (input, at) => {
      projectById(input.projectId)
      const item = itemById(input.itemId)
      const field = projectField(input.fieldId)
      writeProjectValue(item, field, projectValueOf(field, input.value), at)
      return { updateProjectV2ItemFieldValue: { projectV2Item: { id: item.id } } }
    },
    PmkitClearProjectField: (input, at) => {
      projectById(input.projectId)
      const item = itemById(input.itemId)
      writeProjectValue(item, projectField(input.fieldId), null, at)
      return { clearProjectV2ItemFieldValue: { projectV2Item: { id: item.id } } }
    },
    PmkitArchiveItem: (input) => {
      projectById(input.projectId)
      const item = itemById(input.itemId)
      item.isArchived = true
      return { archiveProjectV2Item: { item: { id: item.id } } }
    },
    PmkitDeleteIssue: (input) => {
      const record = issueById(input.issueId)
      state.issues = state.issues.filter((other) => other.id !== record.id)
      state.items = state.items.filter((item) => item.issueId !== record.id)
      for (const other of state.issues) {
        for (const key of ['subIssueIds', 'blockedByIds', 'relatesToIds']) other[key] = other[key].filter((id) => id !== record.id)
        if (other.parentId === record.id) other.parentId = null
        if (other.duplicateOfId === record.id) other.duplicateOfId = null
      }
      return { deleteIssue: { repository: { id: state.repositories.find((entry) => entry.nameWithOwner === record.repo).id } } }
    },
    PmkitAddBlockedBy: (input, at) => {
      const [record, blocker] = [issueById(input.issueId), issueById(input.blockingIssueId)]
      if (record.id === blocker.id) unprocessable('An issue cannot block itself')
      if (!record.blockedByIds.includes(blocker.id)) {
        record.blockedByIds.push(blocker.id)
        event(record, 'BlockedByAddedEvent', { blockingIssue: linkOf(blocker) }, at)
        event(blocker, 'BlockingAddedEvent', { blockedIssue: linkOf(record) }, at)
        touch(at, record, blocker)
      }
      return { addBlockedBy: { issue: ids(record), blockingIssue: ids(blocker) } }
    },
    PmkitRemoveBlockedBy: (input, at) => {
      const [record, blocker] = [issueById(input.issueId), issueById(input.blockingIssueId)]
      if (record.blockedByIds.includes(blocker.id)) {
        record.blockedByIds = record.blockedByIds.filter((id) => id !== blocker.id)
        event(record, 'BlockedByRemovedEvent', { blockingIssue: linkOf(blocker) }, at)
        event(blocker, 'BlockingRemovedEvent', { blockedIssue: linkOf(record) }, at)
        touch(at, record, blocker)
      }
      return { removeBlockedBy: { issue: ids(record), blockingIssue: ids(blocker) } }
    },
    PmkitAddSubIssue: (input, at) => {
      const [parent, child] = [issueById(input.issueId), issueById(input.subIssueId)]
      if (child.parentId === parent.id) unprocessable('Issue may not contain duplicate sub-issues')
      if (child.parentId && !input.replaceParent) unprocessable('Sub issue may only have one parent')
      if (child.parentId) detach(issueById(child.parentId), child, at)
      attach(parent, child, at)
      return { addSubIssue: { issue: ids(parent), subIssue: ids(child) } }
    },
    PmkitRemoveSubIssue: (input, at) => {
      const [parent, child] = [issueById(input.issueId), issueById(input.subIssueId)]
      if (child.parentId !== parent.id) unprocessable(`Issue #${child.number} is not a sub-issue of #${parent.number}`)
      detach(parent, child, at)
      return { removeSubIssue: { issue: ids(parent), subIssue: ids(child) } }
    },
    PmkitUnmarkDuplicate: (input, at) => {
      const [record, canonical] = [issueById(input.duplicateId), issueById(input.canonicalId)]
      if (record.duplicateOfId === canonical.id) {
        record.duplicateOfId = null
        event(record, 'UnmarkedAsDuplicateEvent', { canonical: { __typename: 'Issue', ...linkOf(canonical) } }, at)
        touch(at, record)
      }
      return { unmarkIssueAsDuplicate: { duplicate: { __typename: 'Issue', ...ids(record) } } }
    },
    PmkitAddComment: (input, at) => {
      const record = issueById(input.subjectId)
      if (typeof input.body !== 'string' || input.body.trim() === '') unprocessable("Body can't be blank")
      state.counters.comment += 1
      const comment = { __typename: 'IssueComment', id: `IC_${state.counters.comment}`, author: { login: state.viewer }, body: input.body, createdAt: at, isMinimized: false, minimizedReason: null }
      record.timeline.push(comment)
      touch(at, record)
      return { addComment: { commentEdge: { node: { id: comment.id, author: comment.author, body: comment.body, createdAt: at } } } }
    },
    PmkitCreateLinkedBranch: (input) => {
      const record = issueById(input.issueId)
      const entry = repositoryById(input.repositoryId)
      if (typeof input.name !== 'string' || input.name === '') unprocessable("Name can't be blank")
      if (typeof input.oid !== 'string' || !/^[0-9a-f]{40}$/.test(input.oid)) unprocessable('The oid is not a commit')
      if (entry.branches[input.name]) unprocessable(`Reference refs/heads/${input.name} already exists`)
      entry.branches[input.name] = input.oid
      record.linkedBranches.push(input.name)
      return { createLinkedBranch: { issue: ids(record), linkedBranch: { ref: { name: input.name } } } }
    },
    PmkitSetIssueField: (input, at) => {
      const record = issueById(input.issueId)
      for (const value of input.issueFields ?? []) {
        const field = issueField(value.fieldId)
        if (value.delete) delete record.fieldValues[field.id]
        else if (field.dataType === 'SINGLE_SELECT') {
          if (!field.options.some((option) => option.id === value.singleSelectOptionId)) unprocessable(`The option does not belong to the field ${field.name}`)
          record.fieldValues[field.id] = { optionId: value.singleSelectOptionId }
        } else if (field.dataType === 'NUMBER' && typeof value.numberValue === 'number') record.fieldValues[field.id] = { value: value.numberValue }
        else if (field.dataType === 'DATE' && typeof value.dateValue === 'string') record.fieldValues[field.id] = { value: value.dateValue }
        else unprocessable(`The value does not fit the field ${field.name}`)
      }
      touch(at, record)
      return { setIssueFieldValue: { issue: ids(record) } }
    },
    PmkitAddRelatesTo: (input, at) => {
      const [record, other] = [issueById(input.issueId), issueById(input.relatedIssueId)]
      if (record.id === other.id) unprocessable('An issue cannot relate to itself')
      if (!record.relatesToIds.includes(other.id)) record.relatesToIds.push(other.id)
      if (!other.relatesToIds.includes(record.id)) other.relatesToIds.push(record.id)
      touch(at, record, other)
      return { addRelatesTo: { issue: ids(record), relatedIssue: ids(other) } }
    },
    PmkitRemoveRelatesTo: (input, at) => {
      const [record, other] = [issueById(input.issueId), issueById(input.relatedIssueId)]
      record.relatesToIds = record.relatesToIds.filter((id) => id !== other.id)
      other.relatesToIds = other.relatesToIds.filter((id) => id !== record.id)
      touch(at, record, other)
      return { removeRelatesTo: { issue: ids(record), relatedIssue: ids(other) } }
    },
  }

  /** The validation error GitHub gives a document that names a part of the schema the host lacks, or null. */
  function schemaError(query, variables) {
    const checks = [
      [features.relatesTo, /\brelatesTo\s*\(/, "Field 'relatesTo' doesn't exist on type 'Issue'"],
      [features.relatesTo, /\baddRelatesTo\s*\(/, "Field 'addRelatesTo' doesn't exist on type 'Mutation'"],
      [features.relatesTo, /\bremoveRelatesTo\s*\(/, "Field 'removeRelatesTo' doesn't exist on type 'Mutation'"],
      [features.issueFields, /\bissueFieldValues\s*\(/, "Field 'issueFieldValues' doesn't exist on type 'Issue'"],
      [features.issueFields, /\bsetIssueFieldValue\s*\(/, "Field 'setIssueFieldValue' doesn't exist on type 'Mutation'"],
      [features.issueFields, /\bissueFields\s*\(/, "Field 'issueFields' doesn't exist on type 'Repository'"],
      [features.issueFields, /\bisIssueField\b/, "Field 'isIssueField' doesn't exist on type 'ProjectV2Field'"],
      [features.statusEvents, /\bProjectV2ItemStatusChangedEvent\b/, "No such type ProjectV2ItemStatusChangedEvent, so it can't be a fragment condition"],
    ]
    const found = checks.find(([present, pattern]) => !present && pattern.test(query ?? ''))
    if (found) return found[2]
    if (!features.statusEvents && variables.itemTypes?.includes?.('PROJECT_V2_ITEM_STATUS_CHANGED_EVENT')) {
      return 'Variable $itemTypes of type [IssueTimelineItemsItemType!] was provided invalid value'
    }
    return null
  }

  /** Answers one operation: { data } or { errors }, as GitHub's JSON body. query may be omitted to skip the schema check. */
  function handle(name, variables = {}, query) {
    const vars = variables ?? {}
    const queryRoute = name?.startsWith('PmkitIssueMore_') ? queries.PmkitIssueMore : queries[name]
    const mutationRoute = mutationRoutes[name]
    if (!queryRoute && !mutationRoute) return { errors: [{ message: `fake GitHub has no operation ${name}` }] }
    const invalid = query === undefined ? null : schemaError(query, vars)
    if (invalid) return { errors: [{ message: invalid }] }
    ;(mutationRoute ? mutations : reads).push(mutationRoute ? { name, input: structuredClone(vars.input), variables: structuredClone(vars) } : { name, variables: structuredClone(vars) })
    const failure = state.failures[name]?.shift()
    if (state.failures[name]?.length === 0) delete state.failures[name]
    if (failure) return structuredClone(failure)
    try {
      const data = mutationRoute ? mutationRoute(vars.input ?? {}, stamp(), vars) : queryRoute(vars, name)
      return structuredClone({ data })
    } catch (error) {
      if (error instanceof Refusal) return structuredClone(error.reply)
      throw error
    }
  }

  /** gh's answer to `gh api ... graphql --input -` (and `gh api meta` on GHES) from this fake. */
  function exec(cmd, args, { input } = {}) {
    const fixture = { meta: state.ghesVersion ? { installed_version: state.ghesVersion } : null }
    return answerGhWith(args, input, fixture, (name, body) => handle(name, body.variables ?? {}, body.query))
  }

  /** Makes the next call of the operation answer reply, as a failure GitHub returned. */
  function failNext(name, reply = { errors: [{ type: 'INTERNAL', message: `fake GitHub failed ${name}` }] }) {
    ;(state.failures[name] ??= []).push(structuredClone(reply))
  }

  /** Resolves a seed reference: a number in repo, owner/name#number, or a node id. */
  function seedRef(ref, repo) {
    const match = typeof ref === 'string' ? /^([^#\s]+\/[^#\s]+)#(\d+)$/.exec(ref) : null
    const found = typeof ref === 'number' ? issueByNumber(repo, ref) : match ? issueByNumber(match[1], Number(match[2])) : findIssue(ref)
    if (!found) throw new Error(`fake GitHub: seed names an unknown issue ${ref}`)
    return found
  }

  const byName = (list, name, what) => list.find((entry) => entry.name === name || entry.login === name) ?? (() => { throw new Error(`fake GitHub: seed names an unknown ${what} ${name}`) })()

  /**
   * Adds an issue with no timeline events. Fields: repo (another repository is registered on first use), number, title,
   * body, state, stateReason, author, type (issue type name), assignees (logins), labels (names), createdAt, updatedAt,
   * branches (linked branch names), parent, blockedBy, duplicateOf (a number, owner/name#number or node id),
   * item ({ status, archived, values: { <Project field name>: option name, number or date } }), fields ({ <issue field name>: value }).
   * Returns { id, number }.
   */
  /** The repository entry of repo, registered with the next id R_<n> on first use. */
  function register(repo) {
    let entry = state.repositories.find((candidate) => sameName(candidate.nameWithOwner, repo))
    if (!entry) {
      entry = { nameWithOwner: repo, id: `R_${state.repositories.length + 1}`, next: 1, branches: {} }
      state.repositories.push(entry)
    }
    return entry
  }

  /** Sets the head of a branch on GitHub, in the scope repository or another one. */
  function seedBranch(name, oid, repo = state.repo) {
    register(repo).branches[name] = oid
  }

  function seed({ repo = state.repo, number, title = 'Seeded issue', body = '', state: issueState = 'OPEN', stateReason = null, author = state.viewer, type, assignees = [], labels = [], createdAt, updatedAt, branches = [], parent, blockedBy = [], duplicateOf, item, fields = {} } = {}) {
    const entry = register(repo)
    const record = newIssue(entry, { number, title, body, author, createdAt, updatedAt })
    Object.assign(record, { state: issueState, stateReason })
    record.issueTypeId = type ? byName(state.issueTypes, type, 'issue type').id : null
    record.assigneeIds = assignees.map((login) => byName(state.users, login, 'user').id)
    record.labelIds = labels.map((name) => byName(state.labels, name, 'label').id)
    record.linkedBranches = [...branches]
    if (parent !== undefined) {
      const found = seedRef(parent, entry.nameWithOwner)
      found.subIssueIds.push(record.id)
      record.parentId = found.id
    }
    record.blockedByIds = blockedBy.map((ref) => seedRef(ref, entry.nameWithOwner).id)
    if (duplicateOf !== undefined) record.duplicateOfId = seedRef(duplicateOf, entry.nameWithOwner).id
    for (const [name, value] of Object.entries(fields)) {
      const field = byName(state.issueFields, name, 'issue field')
      record.fieldValues[field.id] = field.dataType === 'SINGLE_SELECT' ? { optionId: byName(field.options, value, 'option').id } : { value }
    }
    if (item) seedItem(record, item)
    return { id: record.id, number: record.number }
  }

  function seedItem(record, { status, archived = false, values = {} }) {
    if (!state.project) throw new Error('fake GitHub: seed has an item but the fake has no Project')
    const item = addItem(state.project.id, record.id)
    item.isArchived = archived
    for (const [name, value] of Object.entries({ ...values, ...(status === undefined ? {} : { Status: status }) })) {
      const field = byName(state.project.fields, name, 'Project field')
      if (field.dataType === 'SINGLE_SELECT') item.values[field.id] = { optionId: byName(field.options, value, 'option').id }
      else item.values[field.id] = field.dataType === 'NUMBER' ? { number: value } : { date: value }
    }
  }

  return { state, exec, handle, mutations, reads, seed, seedBranch, failNext, features, toJSON: () => structuredClone(state) }
}
