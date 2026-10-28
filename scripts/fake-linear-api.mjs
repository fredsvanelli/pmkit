// A fake `fetch` for the Linear GraphQL API. Routes are keyed by GraphQL operation name.
// A route is a response, a list of responses (the Nth call gets item N, the last repeats),
// or a function of the parsed body that returns a response.
// A response is { status, headers, json | text }, { throws: error }, { hang: true } or { textRejects: true }.
import { createHash } from 'node:crypto'

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
const failProject = () => {
  throw new FakeInputError('Could not find referenced Project.')
}
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
 * `history(ref, entry)` seeds a history entry the same way (a bot, an auto-close, a team move, an unknown relation code).
 * `comment(ref, input)` seeds a comment (a bot, an external author, a resolved thread) without recording a mutation, and `comments` lists the records.
 * `unconfirm(operation, { applied })` makes the next call of that operation answer HTTP 502, after applying it when `applied` is true.
 * `cycles` seeds cycles ({ number, team, name, description, startsAt, endsAt, completedAt }; `team` is a team id, default the first team).
 * `fake.cycles` adds more, lists them and moves the cycle clock (`setClock`), which starts at the `clock` option (default `start`) and decides isActive, isFuture and isPast.
 * `endsAt` is an exclusive boundary, as on Linear: at the instant `endsAt` a cycle is past, so a cycle that starts there is the active one.
 * A team with `cyclesEnabled: false` returns no cycles and takes no `cycleId`.
 */
export function fakeLinearIssues({
  teams = [ACME_TEAM],
  states = ACME_STATES,
  labels = ACME_LABELS,
  users = ACME_USERS,
  nestedPage = 50,
  start = '2026-10-27T12:00:00.000Z',
  cycles: seededCycles = [],
  clock: startClock = start,
} = {}) {
  const records = []
  const relations = []
  const numbers = new Map()
  const mutations = []
  const pending = new Map()
  let tick = 0
  let issueCount = 0
  let relationCount = 0
  let projectLookup = () => undefined
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

  // The cycle store. Flags come from the cycle clock, as Linear computes them from the current time.
  let cycleCount = 0
  let clock = startClock
  const cycleRecords = []
  function addCycle({ number, team, name = null, description = null, startsAt, endsAt, completedAt = null }) {
    cycleCount += 1
    const record = { id: `cycle-${cycleCount}`, teamId: team ?? teams[0].id, number, name, description, startsAt, endsAt, completedAt }
    cycleRecords.push(record)
    return record
  }
  const cycleNode = (record) => {
    const now = Date.parse(clock)
    const isFuture = Date.parse(record.startsAt) > now
    const isPast = Date.parse(record.endsAt) <= now
    const { teamId, ...fields } = record
    return { ...fields, isActive: !isFuture && !isPast, isFuture, isPast }
  }
  const cyclesOn = (record) => teamById(record.teamId)?.cyclesEnabled === true
  const cycleComparators = {
    team: (record, c) => teamById(record.teamId).key === c.key.eq,
    number: (record, c) => record.number === c.eq,
    isActive: (record, c) => cycleNode(record).isActive === c.eq,
    isFuture: (record, c) => cycleNode(record).isFuture === c.eq,
    isPast: (record, c) => cycleNode(record).isPast === c.eq,
  }
  function cycleMatches(record, filter) {
    return Object.entries(filter ?? {}).every(([key, value]) => {
      if (key === 'and') return value.every((part) => cycleMatches(record, part))
      if (key === 'or') return value.some((part) => cycleMatches(record, part))
      if (key === 'null') return value === (record === null)
      if (record === null) return false
      if (!Object.hasOwn(cycleComparators, key)) throw new FakeValidationError(`Unknown cycle filter ${key}`)
      return cycleComparators[key](record, value)
    })
  }
  // Walks the filter before any record is read, so an unknown key fails on an empty store too.
  function checkCycleFilter(filter) {
    for (const [key, value] of Object.entries(filter ?? {})) {
      if (key === 'and' || key === 'or') value.forEach(checkCycleFilter)
      else if (key !== 'null' && !Object.hasOwn(cycleComparators, key)) throw new FakeValidationError(`Unknown cycle filter ${key}`)
    }
  }
  function searchCycles({ filter, first = 50, after = null }) {
    checkCycleFilter(filter)
    const found = cycleRecords.filter((record) => cyclesOn(record) && cycleMatches(record, filter)).sort((a, b) => a.number - b.number)
    return connection(found.map(cycleNode), first, after)
  }
  const cycleOf = (record) => (record.cycleId ? cycleRecords.find((cycle) => cycle.id === record.cycleId) : null)

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
      cycle: cycleOf(record) ? { id: cycleOf(record).id, number: cycleOf(record).number } : null,
      project: record.projectId ? projectLookup(record.projectId) : null,
      projectMilestone: record.projectMilestoneId ? { id: record.projectMilestoneId } : null,
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
    if (input.cycleId !== undefined) {
      if (input.cycleId === null) {
        record.cycleId = null
      } else {
        const cycle = cycleRecords.find((item) => item.id === input.cycleId)
        if (!cycle) throw new FakeInputError('Could not find referenced Cycle.')
        if (cycle.teamId !== record.teamId) throw new FakeInputError("Cycle does not belong to the issue's team.")
        if (!cyclesOn(cycle)) throw new FakeInputError('Cycles are not enabled for this team.')
        record.cycleId = cycle.id
      }
    }
    if (input.projectId !== undefined) record.projectId = input.projectId === null ? null : (projectLookup(input.projectId)?.id ?? failProject())
    if (input.projectMilestoneId !== undefined) record.projectMilestoneId = input.projectMilestoneId
  }

  // PMK-36: history. recordHistory is the one place that turns a change of an issue into an entry, so a later issue can add a field row here.
  const historyRecords = []
  const snapshot = (record) => ({ ...record, labelIds: [...record.labelIds] })
  const labelRef = (id) => {
    const label = labels.find((item) => item.id === id)
    return { id, name: label.name, parent: label.parent ? { name: label.parent.name } : null }
  }
  const cycleRef = (id) => (id ? { number: cycleRecords.find((cycle) => cycle.id === id).number } : null)
  function recordHistory(record, before, at, extra = {}) {
    const entry = {}
    const changed = (key) => before[key] !== record[key]
    if (changed('stateId')) {
      const ref = (id) => { const state = stateById(id); return state ? { id: state.id, name: state.name, type: state.type } : null }
      Object.assign(entry, { fromState: ref(before.stateId), toState: ref(record.stateId) })
    }
    if (changed('assigneeId')) Object.assign(entry, { fromAssigneeId: before.assigneeId, toAssigneeId: record.assigneeId })
    if (changed('title')) Object.assign(entry, { fromTitle: before.title, toTitle: record.title })
    if (changed('priority')) Object.assign(entry, { fromPriority: before.priority, toPriority: record.priority })
    if (changed('estimate')) Object.assign(entry, { fromEstimate: before.estimate, toEstimate: record.estimate })
    if (changed('dueDate')) Object.assign(entry, { fromDueDate: before.dueDate, toDueDate: record.dueDate })
    if (changed('parentId')) {
      const ref = (id) => (id ? { identifier: find(id).identifier } : null)
      Object.assign(entry, { fromParent: ref(before.parentId), toParent: ref(record.parentId) })
    }
    const added = record.labelIds.filter((id) => !before.labelIds.includes(id))
    const removed = before.labelIds.filter((id) => !record.labelIds.includes(id))
    if (added.length > 0) entry.addedLabels = added.map(labelRef)
    if (removed.length > 0) entry.removedLabels = removed.map(labelRef)
    if (changed('cycleId')) Object.assign(entry, { fromCycle: cycleRef(before.cycleId), toCycle: cycleRef(record.cycleId) })
    if (changed('projectId')) Object.assign(entry, { fromProject: before.projectId ? { id: before.projectId } : null, toProject: record.projectId ? { id: record.projectId } : null })
    if (changed('projectMilestoneId')) Object.assign(entry, { fromProjectMilestone: before.projectMilestoneId ? { id: before.projectMilestoneId } : null, toProjectMilestone: record.projectMilestoneId ? { id: record.projectMilestoneId } : null })
    if (changed('description')) entry.updatedDescription = true
    Object.assign(entry, extra)
    if (Object.keys(entry).length === 0) return
    historyRecords.push({ issueId: record.id, createdAt: at, actorId: users[0].id, botActor: null, ...entry })
  }
  const HISTORY_DEFAULTS = {
    autoClosed: false, autoArchived: false, archived: false, updatedDescription: false,
    fromState: null, toState: null, fromAssigneeId: null, toAssigneeId: null, fromTitle: null, toTitle: null, fromPriority: null, toPriority: null,
    fromEstimate: null, toEstimate: null, fromDueDate: null, toDueDate: null, addedLabels: null, removedLabels: null, addedLabelIds: null, removedLabelIds: null,
    fromParent: null, toParent: null, relationChanges: null, fromCycle: null, toCycle: null, fromProject: null, toProject: null,
    fromProjectMilestone: null, toProjectMilestone: null,
  }
  const historyNode = ({ issueId, actorId, ...entry }) => ({ ...HISTORY_DEFAULTS, ...entry, actor: actorId ? { id: actorId } : null })

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
      cycleId: null,
      creatorId: users[0].id,
      botActor: null,
      projectId: null,
      projectMilestoneId: null,
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
    cycle: (record, c) => cycleMatches(cycleOf(record), c),
    parent: (record, c) => {
      const parent = record.parentId ? find(record.parentId) : null
      if (c.null === true) return parent === null
      return parent !== null && (c.id.eq === undefined || idMatches(parent, c.id.eq)) && (c.id.in === undefined || c.id.in.some((value) => idMatches(parent, value)))
    },
    project: (record, c) => record.projectId !== null && record.projectId === (projectLookup(c.id.eq)?.id ?? c.id.eq),
    hasBlockedByRelations: (record, c) => relations.some((relation) => relation.type === 'blocks' && relation.relatedIssueId === record.id) === c.eq,
    updatedAt: (record, c) =>
      (c.lt === undefined || Date.parse(record.updatedAt) < Date.parse(c.lt))
      && (c.gt === undefined || Date.parse(record.updatedAt) > Date.parse(c.gt))
      && (c.gte === undefined || Date.parse(record.updatedAt) >= Date.parse(c.gte)),
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
      else if (key === 'cycle') checkCycleFilter(value)
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
      const before = snapshot(record)
      applyFields(record, input)
      record.updatedAt = stamp()
      recordHistory(record, before, record.updatedAt)
      return { issueUpdate: { success: true, issue: toNode(record) } }
    }),
    PmkitIssueArchive: mutation('PmkitIssueArchive', ({ id }) => {
      const record = requireIssue(id)
      const at = stamp()
      record.archivedAt = at
      record.updatedAt = at
      recordHistory(record, snapshot(record), at, { archived: true })
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
    if (relation.type === 'related') {
      const at = stamp()
      const [from, to] = [find(relation.issueId), find(relation.relatedIssueId)]
      recordHistory(from, snapshot(from), at, { relationChanges: [{ identifier: to.identifier, type: 'ar' }] })
      recordHistory(to, snapshot(to), at, { relationChanges: [{ identifier: from.identifier, type: 'ar' }] })
    }
    return relation
  }
  const chainOf = (record, depth) => {
    const parent = record.parentId ? find(record.parentId) : null
    if (depth === 0) return { identifier: record.identifier }
    return { identifier: record.identifier, parent: parent ? chainOf(parent, depth - 1) : null }
  }
  routes.PmkitCycles = query('PmkitCycles', (variables) => ({ cycles: searchCycles(variables) }))
  routes.PmkitCycleByNumber = query('PmkitCycleByNumber', ({ filter }) => ({ cycles: searchCycles({ filter, first: 1 }) }))
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

  // PMK-36: comments.
  const commentRecords = []
  let commentCount = 0
  const COMMENT_FIELDS = ['id', 'body', 'issueId', 'parentId']
  const COMMENT_MISSING = 'Could not find referenced Comment.'
  const findComment = (id) => commentRecords.find((item) => item.id === id)
  const commentNode = (item) => ({
    id: item.id,
    createdAt: item.createdAt,
    body: item.body,
    user: item.userId ? { id: item.userId } : null,
    botActor: item.botActor ?? null,
    externalUser: item.externalUser ?? null,
    parentId: item.parentId ?? null,
    resolvedAt: item.resolvedAt ?? null,
    resolvingUser: item.resolvingUserId ? { id: item.resolvingUserId } : null,
  })
  const withIssue = (item) => ({ ...commentNode(item), issue: { identifier: find(item.issueId).identifier } })
  function addComment(input, { author }) {
    const issue = requireIssue(input.issueId)
    const parent = input.parentId ? findComment(input.parentId) : undefined
    if (input.parentId && (!parent || parent.issueId !== issue.id)) throw new FakeInputError(COMMENT_MISSING)
    if (parent?.parentId) throw new FakeInputError('A reply cannot have a reply.')
    commentCount += 1
    const item = {
      id: input.id ?? `comment-${commentCount}`,
      issueId: issue.id,
      body: input.body ?? '',
      userId: author ? users[0].id : (input.userId ?? null),
      botActor: input.botActor ?? null,
      externalUser: input.externalUser ?? null,
      parentId: parent?.id ?? null,
      createdAt: input.createdAt ?? stamp(),
      resolvedAt: input.resolvedAt ?? null,
      resolvingUserId: input.resolvingUserId ?? null,
    }
    commentRecords.push(item)
    return item
  }
  // Newest first, as Linear answers; a tie keeps the later insert first.
  const newestFirst = (items) => items.map((item, index) => ({ item, index })).sort((a, b) => (a.item.createdAt < b.item.createdAt ? 1 : a.item.createdAt > b.item.createdAt ? -1 : b.index - a.index)).map(({ item }) => item)
  const commentsOf = (record) => newestFirst(commentRecords.filter((item) => item.issueId === record.id))
  const eventNode = (record) => ({
    ...toNode(record),
    creator: record.creatorId ? { id: record.creatorId } : null,
    botActor: record.botActor,
    history: connection(newestFirst(historyRecords.filter((item) => item.issueId === record.id)).map(historyNode)),
    comments: connection(commentsOf(record).map(commentNode)),
  })
  routes.PmkitIssueEvents = query('PmkitIssueEvents', ({ filter, first = 50, after = null, includeArchived = false, sort }) => {
    checkFilter(filter)
    const byUpdate = sort?.[0]?.updatedAt?.order
    const found = records
      .filter((record) => (includeArchived || record.archivedAt === null) && matches(record, filter))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    if (byUpdate) found.sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0) * (byUpdate === 'Ascending' ? 1 : -1))
    return { issues: connection(found.map(eventNode), first, after) }
  })
  routes.PmkitIssueHistory = query('PmkitIssueHistory', ({ id, first, after }) => {
    const record = requireIssue(id)
    return {
      issue: {
        creator: record.creatorId ? { id: record.creatorId } : null,
        botActor: record.botActor,
        history: connection(newestFirst(historyRecords.filter((item) => item.issueId === record.id)).map(historyNode), first, after),
      },
    }
  })
  routes.PmkitIssueComments = query('PmkitIssueComments', ({ id, first, after }) => ({
    issue: { comments: connection(commentsOf(requireIssue(id)).map(commentNode), first, after) },
  }))
  routes.PmkitCommentById = query('PmkitCommentById', ({ id }) => ({ comments: { nodes: commentRecords.filter((item) => item.id === id).map(withIssue) } }))
  routes.PmkitCommentCreate = mutation('PmkitCommentCreate', ({ input }) => {
    checkFields(input, COMMENT_FIELDS)
    return { commentCreate: { success: true, comment: withIssue(addComment(input, { author: true })) } }
  })
  routes.PmkitCommentResolve = mutation('PmkitCommentResolve', ({ id }) => {
    const item = findComment(id)
    if (!item) throw new FakeInputError(COMMENT_MISSING)
    if (item.parentId) throw new FakeInputError('Only a top-level comment can be resolved.')
    item.resolvedAt = stamp()
    item.resolvingUserId = users[0].id
    return { commentResolve: { success: true, comment: withIssue(item) } }
  })

  seededCycles.forEach(addCycle)

  return {
    routes,
    mutations,
    cycles: {
      add: addCycle,
      list: () => cycleRecords.map((record) => ({ ...record })),
      setClock: (iso) => {
        clock = iso
      },
    },
    nodes: () => records.map(toNode),
    // `extra` sets what no input can: createdAt, creatorId and botActor.
    seed: (input, extra = {}) => toNode(Object.assign(create({ teamId: teams[0].id, ...input }), extra)),
    history: (ref, entry) => {
      const record = requireIssue(ref)
      const { actor, ...rest } = entry
      historyRecords.push({ issueId: record.id, createdAt: stamp(), actorId: actor === null ? null : (actor?.id ?? users[0].id), botActor: null, ...rest })
    },
    historyRecords,
    unconfirm: (operation, { applied }) => pending.set(operation, { applied }),
    useProjects: ({ byRef }) => {
      projectLookup = byRef
    },
    relate: (type, from, to) => relate({ type, issueId: from, relatedIssueId: to }),
    comment: (ref, input) => commentNode(addComment({ ...input, issueId: ref }, { author: input.userId === undefined && input.botActor === undefined && input.externalUser === undefined })),
    comments: commentRecords,
    records,
    relations,
  }
}

const PROJECT_CREATE_FIELDS = ['id', 'name', 'teamIds', 'content', 'description', 'startDate', 'targetDate', 'statusId', 'leadId']
const HEALTH_VALUES = ['onTrack', 'atRisk', 'offTrack']
const projectNotFound = (what) => new FakeInputError(`Entity not found: ${what}`)

/**
 * A stateful in-memory Linear project store that answers pmkit's project documents by operation name. Build it over a
 * fakeLinearIssues store and merge both: fakeLinearFetch({ ...fakeWorkspace(), ...issues.routes, ...fake.routes }).
 * A project starts in the Backlog status with no health. Its identifier is P-<first three letters of the team key>-<n>, or null
 * when `identifiers` is false, and its slug is 12 hexadecimal characters. The project `progress` is the share of its issues in a
 * completed state. `seedMilestone`, `seedDocument` and `seedUpdate` add data without recording a mutation, because the
 * adapter only reads milestones and documents. `mutations` and `unconfirm` work as in fakeLinearIssues.
 */
export function fakeLinearProjects({
  issues,
  teams = [ACME_TEAM],
  states = ACME_STATES,
  viewer = 'user-1',
  identifiers = true,
  listPage = 50,
  start = '2026-10-28T09:00:00.000Z',
} = {}) {
  const projects = []
  const updates = []
  const milestones = []
  const documents = []
  const counts = new Map()
  const mutations = []
  const pending = new Map()
  let tick = 0
  const stamp = () => new Date(Date.parse(start) + ++tick * 1000).toISOString()

  const refOf = (project) => ({ id: project.id, slugId: project.slugId, identifier: project.identifier })
  const byRef = (ref) => {
    if (typeof ref !== 'string') return undefined
    return projects.find((project) => project.id === ref || project.slugId === ref || (project.identifier !== null && project.identifier === ref.toUpperCase()))
  }
  issues.useProjects({ byRef: (ref) => {
    const found = byRef(ref)
    return found ? refOf(found) : undefined
  } })
  const requireProject = (ref) => byRef(ref) ?? failProject()
  const connection = (nodes, first = listPage, after = null) => {
    const from = Number(after ?? 0)
    const end = from + first
    const hasNextPage = end < nodes.length
    return page(nodes.slice(from, end), { hasNextPage, endCursor: hasNextPage ? String(end) : null })
  }

  const progressOf = (project) => {
    const own = issues.records.filter((record) => record.projectId === project.id && record.archivedAt === null)
    const done = own.filter((record) => states.find((state) => state.id === record.stateId)?.type === 'completed').length
    return { progress: own.length === 0 ? 0 : done / own.length, scope: own.length }
  }
  const milestoneNode = (milestone) => ({
    id: milestone.id,
    name: milestone.name,
    description: milestone.description ?? null,
    targetDate: milestone.targetDate ?? null,
    status: milestone.status ?? 'unstarted',
    progress: milestone.progress ?? 0,
    project: refOf(milestone.project),
  })
  const projectNode = (project, withLists) => ({
    ...refOf(project),
    name: project.name,
    description: project.description,
    content: project.content,
    health: project.health,
    ...progressOf(project),
    url: `https://linear.app/acme/project/${project.slugId}`,
    startDate: project.startDate,
    targetDate: project.targetDate,
    createdAt: project.createdAt,
    status: { id: 'project-status-backlog', name: 'Backlog', type: 'backlog' },
    ...(withLists
      ? {
          projectMilestones: connection(milestones.filter((item) => item.project === project).map((item) => ({ id: item.id, name: item.name, targetDate: item.targetDate ?? null, status: item.status ?? 'unstarted' }))),
          documents: connection(documents.filter((item) => item.project === project).map((item) => ({ slugId: item.slugId, title: item.title }))),
        }
      : {}),
  })
  const updateNode = (update) => ({
    id: update.id,
    body: update.body,
    health: update.health,
    createdAt: update.createdAt,
    user: { id: update.userId },
    project: refOf(update.project),
  })

  const comparators = {
    id: (project, c) => project.id === c.eq || (project.identifier !== null && project.identifier === String(c.eq).toUpperCase()),
    slugId: (project, c) => project.slugId === c.eq,
    accessibleTeams: (project, c) => project.teamIds.some((id) => teams.find((team) => team.id === id)?.key === c.some.key.eq),
  }
  function checkFilter(filter) {
    for (const key of Object.keys(filter ?? {})) if (!Object.hasOwn(comparators, key)) throw new FakeValidationError(`Unknown filter ${key}`)
  }
  function search({ filter, first = 50, after = null, withLists = false }) {
    checkFilter(filter)
    const found = projects.filter((project) => Object.entries(filter ?? {}).every(([key, value]) => comparators[key](project, value)))
    return connection(found.map((project) => projectNode(project, withLists)), first, after)
  }

  function create(input) {
    for (const key of Object.keys(input ?? {})) if (!PROJECT_CREATE_FIELDS.includes(key)) throw new FakeValidationError(`Unknown input field ${key}`)
    if (typeof input.name !== 'string' || input.name === '') throw new FakeInputError('name is required')
    const team = teams.find((item) => item.id === input.teamIds?.[0])
    if (!team || !input.teamIds.every((id) => teams.some((item) => item.id === id))) throw new FakeInputError('Could not find referenced Team.')
    const number = (counts.get(team.id) ?? 0) + 1
    counts.set(team.id, number)
    const id = input.id ?? `project-${projects.length + 1}`
    const project = {
      id,
      slugId: createHash('sha1').update(id).digest('hex').slice(0, 12),
      identifier: identifiers ? `P-${team.key.slice(0, 3).toUpperCase()}-${number}` : null,
      name: input.name,
      description: input.description ?? '',
      content: input.content ?? null,
      health: null,
      startDate: input.startDate ?? null,
      targetDate: input.targetDate ?? null,
      createdAt: stamp(),
      teamIds: [...input.teamIds],
    }
    projects.push(project)
    return project
  }

  function addUpdate(input, { checkHealth = true } = {}) {
    const project = requireProject(input.projectId)
    if (checkHealth && !HEALTH_VALUES.includes(input.health)) throw new FakeValidationError(`Unknown health ${input.health}`)
    const update = { id: input.id ?? `update-${updates.length + 1}`, project, body: input.body, health: input.health, createdAt: input.createdAt ?? stamp(), userId: viewer }
    updates.push(update)
    project.health = input.health
    return update
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
  const newestFirst = (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

  const routes = {
    PmkitProjects: query('PmkitProjects', (variables) => ({ projects: search(variables) })),
    PmkitProjectCreate: mutation('PmkitProjectCreate', ({ input }) => ({ projectCreate: { success: true, project: projectNode(create(input), false) } })),
    PmkitProjectUpdateCreate: mutation('PmkitProjectUpdateCreate', ({ input }) => ({ projectUpdateCreate: { success: true, projectUpdate: updateNode(addUpdate(input)) } })),
    PmkitProjectUpdates: query('PmkitProjectUpdates', ({ id, first, after }) => {
      const project = byRef(id)
      if (!project) throw projectNotFound('Project')
      const own = updates.filter((update) => update.project === project).sort(newestFirst).map(updateNode)
      return { project: { projectUpdates: connection(own, first, after) } }
    }),
    PmkitProjectMilestones: query('PmkitProjectMilestones', ({ first, after }) => ({ projectMilestones: connection(milestones.map(milestoneNode), first, after) })),
    PmkitProjectMilestone: query('PmkitProjectMilestone', ({ id }) => {
      const found = milestones.find((item) => item.id === id)
      if (!found) throw projectNotFound('ProjectMilestone')
      return { projectMilestone: milestoneNode(found) }
    }),
    PmkitDocument: query('PmkitDocument', ({ filter }) => {
      for (const key of Object.keys(filter ?? {})) if (key !== 'slugId') throw new FakeValidationError(`Unknown filter ${key}`)
      const found = documents.filter((item) => item.slugId === filter?.slugId?.eq).slice(0, 1)
      return { documents: { nodes: found.map((item) => ({ id: item.id, slugId: item.slugId, title: item.title, content: item.content ?? null, project: refOf(item.project) })) } }
    }),
    PmkitEpicIssues: (body) => issues.routes.PmkitIssues(body),
  }

  return {
    routes,
    mutations,
    unconfirm: (operation, { applied }) => pending.set(operation, { applied }),
    seed: (input) => projectNode(create(input), false),
    seedMilestone: (ref, input) => {
      milestones.push({ ...input, project: requireProject(ref) })
    },
    seedDocument: (ref, input) => {
      documents.push({ id: input.id ?? `document-${documents.length + 1}`, ...input, project: requireProject(ref) })
    },
    seedUpdate: (ref, input) => addUpdate({ ...input, projectId: requireProject(ref).id }, { checkHealth: false }),
    projects,
    updates,
  }
}
