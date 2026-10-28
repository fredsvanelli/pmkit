// A fake `fetch` for the Linear GraphQL API. Routes are keyed by GraphQL operation name.
// A route is a response, a list of responses (the Nth call gets item N, the last repeats),
// or a function of the parsed body that returns a response.
// A response is { status, headers, json | text }, { throws: error }, { hang: true } or { textRejects: true }.
import { branchName } from './lib/ids.mjs'
import { operationName } from './lib/linear/client.mjs'

export const FAKE_KEY = 'lin_api_TESTKEYTESTKEYTESTKEY'

/** A Relay connection object. */
export function page(nodes, { hasNextPage = false, endCursor = null } = {}) {
  return { pageInfo: { hasNextPage, endCursor }, nodes }
}

/** A route response with `data` as the GraphQL data. */
export function json(data, { status = 200, headers = {} } = {}) {
  return { status, headers, json: { data } }
}

function sessionRoute(workspace, previousUrlKeys) {
  return json({
    viewer: { id: 'user-1', name: 'Test User' },
    organization: { urlKey: workspace, name: workspace === 'acme' ? 'Acme' : workspace, previousUrlKeys },
  })
}

function toResponse(answer) {
  const status = answer.status ?? 200
  const text = answer.text ?? (answer.json === undefined ? '' : JSON.stringify(answer.json))
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(answer.headers ?? {}),
    text: async () => {
      if (answer.textRejects) throw new TypeError('terminated')
      return text
    },
  }
}

// AbortSignal.timeout uses an unref'd timer, so a pending promise alone would let the test process exit.
// A ref'd timer keeps the event loop alive until the signal aborts.
function hang(signal) {
  return new Promise((resolve, reject) => {
    if (!signal) return
    if (signal.aborted) return reject(signal.reason)
    const keepAlive = setInterval(() => {}, 1000)
    signal.addEventListener(
      'abort',
      () => {
        clearInterval(keepAlive)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

export function fakeLinearFetch(routes = {}, { workspace = 'acme', previousUrlKeys = [] } = {}) {
  const table = { PmkitSession: sessionRoute(workspace, previousUrlKeys), ...routes }
  const counts = new Map()
  async function fetch(url, init = {}) {
    const body = JSON.parse(init.body)
    fetch.calls.push({ url, method: init.method, headers: { ...init.headers }, body })
    const name = operationName(body.query) ?? '(anonymous)'
    const route = table[name]
    if (route === undefined) {
      fetch.unrouted.push(name)
      throw new Error(`fake linear: no route for ${name}`)
    }
    const seen = counts.get(name) ?? 0
    counts.set(name, seen + 1)
    const answer = typeof route === 'function' ? route(body) : Array.isArray(route) ? route[Math.min(seen, route.length - 1)] : route
    if (answer.throws) throw answer.throws
    if (answer.hang) return hang(init.signal)
    return toResponse(answer)
  }
  fetch.calls = []
  fetch.unrouted = []
  return fetch
}

export const ACME_TEAM_ID = 'team-acme'

export const ACME_TEAM = {
  id: ACME_TEAM_ID,
  key: 'ACME',
  name: 'Acme',
  parent: null,
  cyclesEnabled: false,
  triageEnabled: false,
  issueEstimationType: 'notUsed',
  issueEstimationAllowZero: false,
  issueEstimationExtended: false,
}

export const ACME_STATES = [
  ['Backlog', 'backlog'],
  ['Todo', 'unstarted'],
  ['In Progress', 'started'],
  ['In Review', 'started'],
  ['Code Review', 'started'],
  ['UAT', 'started'],
  ['Ready to ship', 'started'],
  ['Done', 'completed'],
  ['Canceled', 'canceled'],
  ['Duplicate', 'duplicate'],
].map(([name, type], index) => ({ id: `state-${index + 1}`, name, type, position: index, team: { id: ACME_TEAM_ID } }))

const label = (id, name, { team = ACME_TEAM_ID, parent = null, isGroup = false, retiredAt = null } = {}) => ({
  id,
  name,
  isGroup,
  retiredAt,
  team: team === null ? null : { id: team },
  parent,
})

const SIZE = { id: 'label-size', name: 'Size' }
export const ACME_LABELS = [
  label('label-bug', 'Bug'),
  label('label-feature', 'Feature'),
  label(SIZE.id, SIZE.name, { isGroup: true }),
  ...['XS', 'S', 'M', 'L', 'XL'].map((name) => label(`label-${name.toLowerCase()}`, name, { parent: SIZE })),
  label('label-docs', 'Docs', { team: null }),
  label('label-old', 'Old', { retiredAt: '2026-01-01T00:00:00.000Z' }),
]

const user = (id, name, extra = {}) => ({
  id,
  name,
  displayName: name.toLowerCase().replace(/\s+/g, '.'),
  email: `${id}@example.com`,
  active: true,
  guest: false,
  app: false,
  teams: { nodes: [{ id: ACME_TEAM_ID }] },
  ...extra,
})

export const ACME_USERS = [
  user('user-1', 'Test User'),
  user('user-2', 'Ada Lovelace', { displayName: 'ada', email: 'ada@example.com' }),
  user('user-3', 'Gone', { active: false }),
  user('user-4', 'Linear', { app: true }),
]

const refused = { status: 200, json: { data: null, errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] } }

/**
 * Routes for the discovery operations over a small workspace, shaped like the sandbox workspace with acme names.
 * Pass them as fakeLinearFetch(fakeWorkspace(options)). Connection routes page by variables.first and variables.after;
 * the cursor is the index of the next node as a string.
 */
export function fakeWorkspace({
  urlKey = 'acme',
  name = 'Acme',
  subscription = null,
  trialEndsAt = null,
  releasesEnabled = false,
  customersEnabled = false,
  integrations = ['githubCodeAccessPersonal'],
  teams = [ACME_TEAM],
  states = ACME_STATES,
  labels = ACME_LABELS,
  users = ACME_USERS,
  refuse = [],
  endless = [],
} = {}) {
  const connection = (operation, field, nodes) => (body) => {
    const first = body.variables?.first ?? 50
    const start = Number(body.variables?.after ?? 0)
    if (endless.includes(operation)) {
      return json({ [field]: page(nodes.slice(start, start + first), { hasNextPage: true, endCursor: String(start + first) }) })
    }
    const end = start + first
    const hasNextPage = end < nodes.length
    return json({ [field]: page(nodes.slice(start, end), { hasNextPage, endCursor: hasNextPage ? String(end) : null }) })
  }
  const routes = {
    PmkitWorkspace: json({ organization: { urlKey, name, releasesEnabled, customersEnabled, trialEndsAt } }),
    PmkitPlan: json({ organization: { subscription } }),
    PmkitIntegrations: json({ organization: { integrations: { nodes: integrations.map((service) => ({ service })) } } }),
    PmkitTeams: connection('PmkitTeams', 'teams', teams),
    PmkitStates: connection('PmkitStates', 'workflowStates', states),
    PmkitLabels: connection('PmkitLabels', 'issueLabels', labels),
    PmkitUsers: connection('PmkitUsers', 'users', users),
  }
  for (const operation of refuse) routes[operation] = refused
  return routes
}

/**
 * Routes for the triage operations. `responsibility` is the TriageResponsibility node the team has (null for none),
 * `issues` the nodes of the triage inbox query. The mutation routes echo a responsibility built from their variables.
 * Names come from `users`, so the new current person has the name discovery shows.
 */
export function fakeTriage({ responsibility = null, issues = [], users = ACME_USERS } = {}) {
  const person = (id) => {
    const found = users.find((item) => item.id === id)
    return found ? { id: found.id, name: found.name } : null
  }
  const built = (id, input, base = {}) => {
    const selection = input.manualSelection ?? base.manualSelection ?? null
    return {
      id,
      action: input.action ?? base.action ?? 'assign',
      manualSelection: selection,
      timeSchedule: input.timeScheduleId ? { id: input.timeScheduleId, name: 'Schedule', externalUrl: null, integration: null } : (selection ? null : (base.timeSchedule ?? null)),
      currentUser: selection ? person(selection.userIds[selection.assignmentIndex ?? 0]) : (base.currentUser ?? null),
    }
  }
  const mutation = (field, payload) => (body) => json({ [field]: payload(body.variables ?? {}) })
  return {
    PmkitTriageShow: json({ team: { triageResponsibility: responsibility } }),
    PmkitTriageSuggestions: (body) => {
      const first = body.variables?.first ?? 50
      return json({ issues: page(issues.slice(0, first), { hasNextPage: issues.length > first, endCursor: issues.length > first ? String(first) : null }) })
    },
    PmkitTriageCreate: mutation('triageResponsibilityCreate', (v) => ({ success: true, triageResponsibility: built('tr-new', v.input ?? {}) })),
    PmkitTriageUpdate: mutation('triageResponsibilityUpdate', (v) => ({ success: true, triageResponsibility: built(v.id, v.input ?? {}, responsibility ?? {}) })),
    PmkitTriageDelete: mutation('triageResponsibilityDelete', () => ({ success: true })),
  }
}

const graphqlError = (message, code) => ({ status: 200, json: { data: null, errors: [{ message, extensions: { code } }] } })
const validation = (message) => graphqlError(message, 'GRAPHQL_VALIDATION_FAILED')
const NOT_FOUND = 'Could not find referenced Issue.'
const CREATE_FIELDS = ['id', 'title', 'description', 'assigneeId', 'parentId', 'priority', 'estimate', 'labelIds', 'teamId', 'stateId', 'dueDate', 'cycleId', 'projectId', 'projectMilestoneId']
const UPDATE_FIELDS = CREATE_FIELDS.filter((field) => field !== 'id')

class FakeInputError extends Error {}
class FakeValidationError extends Error {}

/**
 * A stateful in-memory Linear issue store that answers pmkit's issue documents by operation name.
 * Use it as fakeLinearFetch({ ...fakeWorkspace(options), ...fake.routes }) with the same teams, states, labels and users.
 * Identifiers count from 1 per team. Every write moves the clock one second from `start`. An unknown filter key or input field
 * answers GRAPHQL_VALIDATION_FAILED, so a translator that emits a clause the fake does not know fails instead of matching everything.
 * `mutations` lists each mutation the fake received. `seed(input)` creates an issue and `relate(type, from, to)` a relation, without recording a mutation.
 * `unconfirm(operation, { applied })` makes the next call of that operation answer HTTP 502, after applying it when `applied` is true.
 */
export function fakeLinearIssues({
  teams = [ACME_TEAM],
  states = ACME_STATES,
  labels = ACME_LABELS,
  users = ACME_USERS,
  nestedPage = 50,
  start = '2026-10-27T12:00:00.000Z',
} = {}) {
  const records = []
  const relations = []
  const numbers = new Map()
  const mutations = []
  const pending = new Map()
  let tick = 0
  let issueCount = 0
  let relationCount = 0
  const stamp = () => new Date(Date.parse(start) + ++tick * 1000).toISOString()

  const teamById = (id) => teams.find((team) => team.id === id)
  const stateById = (id) => states.find((state) => state.id === id)
  const find = (ref) => {
    if (typeof ref !== 'string') return undefined
    return records.find((record) => record.id === ref || record.identifier === ref.toUpperCase())
  }
  const requireIssue = (ref) => {
    const record = find(ref)
    if (!record) throw new FakeInputError(NOT_FOUND)
    return record
  }

  const connection = (nodes, first = nestedPage, after = null) => {
    const from = Number(after ?? 0)
    const end = from + first
    const hasNextPage = end < nodes.length
    return page(nodes.slice(from, end), { hasNextPage, endCursor: hasNextPage ? String(end) : null })
  }
  const stateRef = (record) => {
    const state = stateById(record.stateId)
    return state ? { id: state.id, type: state.type } : null
  }
  const nested = {
    labels: (record) =>
      record.labelIds.map((id) => {
        const label = labels.find((item) => item.id === id)
        return { id, name: label.name, parent: label.parent ? { name: label.parent.name } : null }
      }),
    children: (record) => records.filter((other) => other.parentId === record.id).map((other) => ({ identifier: other.identifier })),
    relations: (record) =>
      relations
        .filter((relation) => relation.issueId === record.id)
        .map((relation) => {
          const other = find(relation.relatedIssueId)
          return { id: relation.id, type: relation.type, relatedIssue: { identifier: other.identifier, state: stateRef(other) } }
        }),
    inverseRelations: (record) =>
      relations
        .filter((relation) => relation.relatedIssueId === record.id)
        .map((relation) => {
          const other = find(relation.issueId)
          return { id: relation.id, type: relation.type, issue: { identifier: other.identifier, state: stateRef(other) } }
        }),
  }

  function toNode(record) {
    const team = teamById(record.teamId)
    const state = stateById(record.stateId)
    const parent = record.parentId ? find(record.parentId) : null
    return {
      id: record.id,
      identifier: record.identifier,
      title: record.title,
      description: record.description,
      priority: record.priority,
      estimate: record.estimate,
      dueDate: record.dueDate,
      branchName: record.branchName,
      archivedAt: record.archivedAt,
      trashed: record.trashed,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      team: { id: team.id, key: team.key },
      state: { id: state.id, name: state.name, type: state.type },
      assignee: record.assigneeId ? { id: record.assigneeId } : null,
      parent: parent ? { identifier: parent.identifier } : null,
      ...Object.fromEntries(Object.entries(nested).map(([field, build]) => [field, connection(build(record))])),
    }
  }

  const checkFields = (input, allowed) => {
    for (const key of Object.keys(input ?? {})) if (!allowed.includes(key)) throw new FakeValidationError(`Unknown input field ${key}`)
  }

  function applyFields(record, input) {
    for (const key of ['title', 'description', 'priority', 'estimate', 'dueDate']) if (input[key] !== undefined) record[key] = input[key]
    if (input.stateId !== undefined) {
      if (!stateById(input.stateId)) throw new FakeInputError('Could not find referenced WorkflowState.')
      record.stateId = input.stateId
    }
    if (input.assigneeId !== undefined) record.assigneeId = input.assigneeId
    if (input.labelIds !== undefined) record.labelIds = [...input.labelIds]
    if (input.parentId !== undefined) record.parentId = input.parentId === null ? null : requireIssue(input.parentId).id
  }

  function create(input) {
    checkFields(input, CREATE_FIELDS)
    const team = teamById(input.teamId)
    if (!team) throw new FakeInputError('Could not find referenced Team.')
    const number = (numbers.get(team.id) ?? 0) + 1
    numbers.set(team.id, number)
    issueCount += 1
    const identifier = `${team.key}-${number}`
    const backlog = states.filter((state) => state.team.id === team.id).sort((a, b) => a.position - b.position)
    const at = stamp()
    const record = {
      id: input.id ?? `issue-${issueCount}`,
      identifier,
      teamId: team.id,
      title: input.title,
      description: null,
      priority: 0,
      estimate: null,
      dueDate: null,
      branchName: branchName(identifier.toLowerCase(), input.title ?? ''),
      archivedAt: null,
      trashed: false,
      createdAt: at,
      updatedAt: at,
      stateId: (backlog.find((state) => state.type === 'backlog') ?? backlog[0]).id,
      assigneeId: null,
      parentId: null,
      labelIds: [],
    }
    const { id, teamId, title, ...rest } = input
    applyFields(record, rest)
    records.push(record)
    return record
  }

  // Each filter key as a test of one record. A key missing here answers GRAPHQL_VALIDATION_FAILED.
  const idMatches = (record, value) => record.id === value || record.identifier === String(value).toUpperCase()
  const comparators = {
    id: (record, c) => (c.eq === undefined || idMatches(record, c.eq)) && (c.in === undefined || c.in.some((value) => idMatches(record, value))),
    team: (record, c) => teamById(record.teamId).key === c.key.eq,
    title: (record, c) => (record.title ?? '').toLowerCase().includes(c.containsIgnoreCase.toLowerCase()),
    description: (record, c) => (record.description ?? '').toLowerCase().includes(c.containsIgnoreCase.toLowerCase()),
    state: (record, c) => c.id.in.includes(record.stateId),
    labels: (record, c) => {
      const names = record.labelIds.map((id) => labels.find((label) => label.id === id).name)
      const { eq, in: list } = c.some.name
      return names.some((name) => (eq === undefined || name === eq) && (list === undefined || list.includes(name)))
    },
    assignee: (record, c) => (c.null === true ? record.assigneeId === null : record.assigneeId === c.id.eq),
    parent: (record, c) => {
      const parent = record.parentId ? find(record.parentId) : null
      return parent !== null && idMatches(parent, c.id.eq)
    },
    hasBlockedByRelations: (record, c) => relations.some((relation) => relation.type === 'blocks' && relation.relatedIssueId === record.id) === c.eq,
    updatedAt: (record, c) =>
      (c.lt === undefined || Date.parse(record.updatedAt) < Date.parse(c.lt)) && (c.gt === undefined || Date.parse(record.updatedAt) > Date.parse(c.gt)),
  }
  function matches(record, filter) {
    return Object.entries(filter ?? {}).every(([key, value]) => {
      if (key === 'and') return value.every((part) => matches(record, part))
      if (key === 'or') return value.some((part) => matches(record, part))
      if (!Object.hasOwn(comparators, key)) throw new FakeValidationError(`Unknown filter ${key}`)
      return comparators[key](record, value)
    })
  }

  // Walks the filter before any record is read, so an unknown key fails on an empty store too.
  function checkFilter(filter) {
    for (const [key, value] of Object.entries(filter ?? {})) {
      if (key === 'and' || key === 'or') value.forEach(checkFilter)
      else if (!Object.hasOwn(comparators, key)) throw new FakeValidationError(`Unknown filter ${key}`)
    }
  }

  function search({ filter, first = 50, after = null, includeArchived = false, sort }) {
    checkFilter(filter)
    const order = sort?.[0]?.createdAt?.order ?? 'Descending'
    const found = records
      .filter((record) => (includeArchived || record.archivedAt === null) && matches(record, filter))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) * (order === 'Ascending' ? 1 : -1))
    return connection(found.map(toNode), first, after)
  }

  const answerOf = (operation, body, run) => {
    try {
      const plan = pending.get(operation)
      if (plan) {
        pending.delete(operation)
        if (plan.applied) run(body.variables ?? {})
        return { status: 502, text: '' }
      }
      return json(run(body.variables ?? {}))
    } catch (error) {
      if (error instanceof FakeValidationError) return validation(error.message)
      if (error instanceof FakeInputError) return graphqlError(error.message, 'INPUT_ERROR')
      throw error
    }
  }
  const query = (operation, run) => (body) => answerOf(operation, body, run)
  const mutation = (operation, run) => (body) => {
    mutations.push(operation)
    return answerOf(operation, body, run)
  }

  const routes = {
    PmkitIssues: query('PmkitIssues', (variables) => ({ issues: search(variables) })),
    PmkitIssueById: query('PmkitIssueById', ({ id }) => ({ issues: search({ filter: { id: { eq: id } }, includeArchived: true, first: 1 }) })),
    PmkitIssueCreate: mutation('PmkitIssueCreate', ({ input }) => ({ issueCreate: { success: true, issue: toNode(create(input)) } })),
    PmkitIssueUpdate: mutation('PmkitIssueUpdate', ({ id, input }) => {
      checkFields(input, UPDATE_FIELDS)
      const record = requireIssue(id)
      applyFields(record, input)
      record.updatedAt = stamp()
      return { issueUpdate: { success: true, issue: toNode(record) } }
    }),
    PmkitIssueArchive: mutation('PmkitIssueArchive', ({ id }) => {
      const record = requireIssue(id)
      const at = stamp()
      record.archivedAt = at
      record.updatedAt = at
      return { issueArchive: { success: true } }
    }),
  }
  const RELATION_FIELDS = ['id', 'type', 'issueId', 'relatedIssueId']
  const RELATION_TYPES = ['blocks', 'duplicate', 'related', 'similar']
  function relate(input) {
    checkFields(input, RELATION_FIELDS)
    if (!RELATION_TYPES.includes(input.type)) throw new FakeValidationError(`Unknown relation type ${input.type}`)
    const relation = { id: input.id ?? `relation-${++relationCount}`, type: input.type, issueId: requireIssue(input.issueId).id, relatedIssueId: requireIssue(input.relatedIssueId).id }
    relations.push(relation)
    return relation
  }
  const chainOf = (record, depth) => {
    const parent = record.parentId ? find(record.parentId) : null
    if (depth === 0) return { identifier: record.identifier }
    return { identifier: record.identifier, parent: parent ? chainOf(parent, depth - 1) : null }
  }
  routes.PmkitRelationCreate = mutation('PmkitRelationCreate', ({ input }) => ({ issueRelationCreate: { success: true, issueRelation: { id: relate(input).id } } }))
  routes.PmkitRelationDelete = mutation('PmkitRelationDelete', ({ id }) => {
    const index = relations.findIndex((relation) => relation.id === id)
    if (index < 0) throw new FakeInputError('Could not find referenced IssueRelation.')
    relations.splice(index, 1)
    return { issueRelationDelete: { success: true } }
  })
  routes.PmkitBlockGraph = query('PmkitBlockGraph', ({ ids }) => ({ issues: search({ filter: { id: { in: ids } }, includeArchived: true, first: 250, sort: [{ createdAt: { order: 'Ascending' } }] }) }))
  routes.PmkitParentChain = query('PmkitParentChain', ({ id }) => {
    const record = records.find((item) => idMatches(item, id))
    return { issues: { nodes: record ? [chainOf(record, 10)] : [] } }
  })
  for (const field of Object.keys(nested)) {
    const name = `PmkitIssue${field[0].toUpperCase()}${field.slice(1)}Page`
    routes[name] = query(name, ({ id, first, after }) => ({ issue: { [field]: connection(nested[field](requireIssue(id)), first, after) } }))
  }

  return {
    routes,
    mutations,
    nodes: () => records.map(toNode),
    seed: (input) => toNode(create({ teamId: teams[0].id, ...input })),
    unconfirm: (operation, { applied }) => pending.set(operation, { applied }),
    relate: (type, from, to) => relate({ type, issueId: from, relatedIssueId: to }),
    records,
    relations,
  }
}
