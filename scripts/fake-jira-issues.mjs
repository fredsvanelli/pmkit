// A stateful fake Jira for work items: the routes of the spec's "Facts from Atlassian's OpenAPI documents" over
// jiraSiteRoutes (space ENG), answered from a plain-JSON state. It follows those documents, not Jira.
// See docs/superpowers/specs/2026-11-22-pmk-77-jira-work-items-transitions-links-jql-design.md, "The stateful fake".

import { jiraSiteRoutes } from './fake-jira-api.mjs'
import { adfToText } from './lib/jira/adf.mjs'
import { lower } from './lib/jira/ids.mjs'

const API = '/rest/api/3'
const AGILE = '/rest/agile/1.0'
const BOARD = 1
const SPRINT_FIELD = 'customfield_10020'
const SITE = jiraSiteRoutes()
const SPACE = SITE[`GET ${API}/project/ENG`].json
const WORK_TYPES = SPACE.issueTypes
const statusesByType = (site) => Object.fromEntries(site[`GET ${API}/project/ENG/statuses`].json.map((type) => [type.id, type.statuses]))
const PRIORITIES = SITE[`GET ${API}/priority`].json
const USERS = SITE[`GET ${API}/user/assignable/search`].json
const LINK_TYPES = SITE[`GET ${API}/issueLinkType`].json.issueLinkTypes
const FIELD_NAMES = Object.fromEntries(SITE[`GET ${API}/field`].json.map((field) => [field.id, field.name]))
const SETTABLE = new Set([...Object.keys(FIELD_NAMES), 'description', 'labels', 'issuetype', 'parent', 'fixVersions'])
const VIEWER = { accountId: 'acc-1' }
const START = Date.parse('2026-11-22T10:00:00.000Z')
const RESOLUTIONS = [{ id: '10000', name: 'Done' }, { id: '10001', name: "Won't Do" }]
const RESOLUTION_FIELD = { required: true, hasDefaultValue: false, name: 'Resolution', schema: { type: 'resolution', system: 'resolution' }, allowedValues: RESOLUTIONS }
const MISSING = 'Issue does not exist or you do not have permission to see it.'

const upper = (value) => String(value ?? '').toUpperCase()
const jiraFormat = (date) => new Date(date).toISOString().replace('Z', '+0000')
const instant = (time) => Date.parse(String(time).replace(/([+-]\d\d)(\d\d)$/, '$1:$2'))
const statusOf = (status) => ({ id: status.id, name: status.name, statusCategory: { key: status.statusCategory.key } })
const byIdOrName = (list, value) => list.find((entry) => (value?.id !== undefined ? entry.id === String(value.id) : entry.name === value?.name))

// A refusal thrown inside a handler and answered as is.
class Answer {
  constructor(response) {
    this.response = response
  }
}
const refuse = (status, errors = {}, errorMessages = []) => {
  throw new Answer({ status, json: { errorMessages, errors } })
}
const notFound = (message = MISSING) => refuse(404, {}, [message])
const badField = (id, message) => refuse(400, { [id]: message })
const cannotSet = (id) => badField(id, `Field '${id}' cannot be set. It is not on the appropriate screen, or unknown.`)

/** A fresh, empty state. */
function emptyState() {
  return { next: { item: 1, link: 10100, comment: 10000, history: 1, sprint: 1, version: 10100, worklog: 10000 }, clock: 0, items: {}, links: [], comments: {}, properties: {}, changelog: {}, sprints: [], versions: [], worklogs: {} }
}

// Field values: the stored form of a written value, and the [id, string] sides of a changelog item.

/** The stored form of one written field, or a 400 when Jira would refuse it. */
function convert(id, value, state) {
  if (id === SPRINT_FIELD || (!SETTABLE.has(id) && !id.startsWith('customfield_'))) cannotSet(id)
  if (id === 'summary') return typeof value === 'string' && value.trim() ? value : badField('summary', 'You must specify a summary of the issue.')
  if (value === null) return null
  switch (id) {
    case 'description':
      return value?.type === 'doc' ? value : badField(id, 'Operation value must be an Atlassian Document (see the Atlassian Document Format)')
    case 'labels':
      return Array.isArray(value) && value.every((label) => typeof label === 'string' && /^\S+$/.test(label)) ? [...value] : badField(id, 'The label must not contain spaces.')
    case 'issuetype': {
      const type = byIdOrName(WORK_TYPES, value)
      return type ? { id: type.id, name: type.name } : badField(id, 'Specify a valid issue type')
    }
    case 'priority': {
      const priority = byIdOrName(PRIORITIES, value)
      return priority ? { id: priority.id, name: priority.name } : badField(id, `Priority with id '${value?.id}' does not exist`)
    }
    case 'assignee': {
      const user = USERS.find((entry) => entry.accountId === value?.accountId)
      return user ? { accountId: user.accountId, displayName: user.displayName } : badField(id, `User '${value?.accountId}' cannot be assigned issues.`)
    }
    case 'fixVersions':
      return Array.isArray(value) ? value.map((entry) => versionField(state.versions.find((version) => version.id === String(entry?.id)) ?? badField(id, `Version with id '${entry?.id}' does not exist.`))) : badField(id, 'Specify a valid list of versions.')
    case 'parent': {
      const parent = state.items[upper(value?.key)]
      return parent ? { key: parent.key } : badField(id, 'Could not find the parent work item.')
    }
    case 'duedate':
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : badField(id, 'Error parsing date string: ' + value)
    default:
      return value
  }
}

/** The work-item form of a version. */
const versionField = ({ id, name, released, archived, releaseDate }) => ({ id, name, released, archived, ...(releaseDate ? { releaseDate } : {}) })

/** The [raw, string] sides of a field value in a changelog item. */
function sides(id, value, state) {
  if (value === null || value === undefined) return [null, null]
  const scalar = typeof value === 'object' ? JSON.stringify(value) : String(value)
  switch (id) {
    case 'summary':
      return [null, value]
    case 'description':
      return [null, adfToText(value).trim() || null]
    case 'labels':
      return [null, value.join(' ') || null]
    case 'assignee':
      return [value.accountId, value.displayName]
    case 'priority':
    case 'issuetype':
    case 'status':
      return [value.id, value.name]
    case 'fixVersions':
      return [null, value.map((version) => version.name).join(', ') || null]
    case 'parent':
      return [state.items[value.key]?.id ?? null, value.key]
    default:
      return [scalar, scalar]
  }
}

/** The changelog item of a field that went from `before` to `after`. */
function changeItem(id, before, after, state) {
  const [from, fromString] = sides(id, before, state)
  const [to, toString] = sides(id, after, state)
  const custom = id.startsWith('customfield_')
  const named = id === 'parent' ? { field: 'IssueParentAssociation' } : id === 'fixVersions' ? { field: 'Fix Version', fieldId: id } : { field: custom ? (FIELD_NAMES[id] ?? id) : id, fieldId: id }
  return { ...named, fieldtype: custom ? 'custom' : 'jira', from, fromString, to, toString }
}

/** A Link changelog item: `to` set on a new link, `from` on a removed one. */
function linkItem(otherKey, verb, added) {
  const text = `This issue ${verb} ${otherKey}`
  return added
    ? { field: 'Link', fieldtype: 'jira', from: null, fromString: null, to: otherKey, toString: text }
    : { field: 'Link', fieldtype: 'jira', from: otherKey, fromString: text, to: null, toString: null }
}

// JQL: exactly the subset translateFilter and metricEvents emit; anything else is a 400.

const TOKEN = /\s*(?:("(?:[^"\\]|\\.)*")|(>=|[=~<(),])|([A-Za-z_][\w.-]*))/y
const FORMS = { '=': ['project', 'assignee', 'labels', 'parent', 'sprint', 'fixVersion'], in: ['status', 'issuetype', 'parent', 'key'], is: ['assignee', 'sprint', 'fixVersion'], '>=': ['updated'], '<': ['updated'] }
const VALUE = {
  project: () => SPACE.key,
  status: (item) => item.fields.status.id,
  issuetype: (item) => item.fields.issuetype.id,
  assignee: (item) => item.fields.assignee?.accountId ?? null,
  parent: (item) => item.fields.parent?.key ?? null,
  key: (item) => item.key,
  sprint: (item) => (item.sprintIds ?? []).map(String),
  fixVersion: (item) => (item.fields.fixVersions ?? []).map((version) => version.id),
}
const KEYED = ['project', 'parent', 'key']
const ORDERS = { 'created ASC , key ASC': 'created', 'updated DESC': 'updated' }

function tokenize(jql, fail) {
  const tokens = []
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < jql.length && jql.slice(TOKEN.lastIndex).trim()) {
    const match = TOKEN.exec(jql)
    if (!match) fail()
    if (match[1]) tokens.push({ kind: 'str', value: match[1].slice(1, -1).replace(/\\(.)/g, '$1') })
    else tokens.push({ kind: match[2] ? 'op' : 'word', value: match[2] ?? match[3] })
  }
  return tokens
}

/** The test and order of a JQL query, or a 400 naming the query when the fake does not understand it. */
function parseJql(jql, sprintOf) {
  const fail = () => refuse(400, {}, [`fake Jira does not understand: ${jql}`])
  const tokens = tokenize(jql, fail)
  let at = 0
  const accept = (value) => (tokens[at]?.kind !== 'str' && tokens[at]?.value === value ? (at += 1) : false)
  const expect = (value) => accept(value) || fail()
  const string = () => (tokens[at]?.kind === 'str' ? tokens[at++].value : fail())
  const same = (field, a, b) => (KEYED.includes(field) ? upper(a) === upper(b) : a === b)
  const textMatch = (text) => (item) => [item.fields.summary, adfToText(item.fields.description)].some((value) => lower(value).includes(lower(text)))
  function clause() {
    if (accept('(')) {
      if (tokens[at]?.value === 'sprint') {
        const [first, second] = [clause(), expect('OR') && clause()]
        expect(')')
        return (item) => first(item) || second(item)
      }
      ;['summary', '~'].forEach(expect)
      const text = string()
      ;['OR', 'description', '~'].forEach(expect)
      if (string() !== text) fail()
      expect(')')
      return textMatch(text)
    }
    const field = tokens[at++]?.value
    const op = tokens[at++]?.value
    if (field === 'sprint' && op === 'not') {
      ;['in', 'openSprints', '(', ')'].forEach(expect)
      return (item) => !(item.sprintIds ?? []).some((id) => sprintOf(id).state !== 'closed')
    }
    if (field === 'issuetype' && op === 'not') {
      expect('in')
      expect('(')
      const values = [string()]
      while (accept(',')) values.push(string())
      expect(')')
      return (item) => !values.includes(VALUE.issuetype(item))
    }
    if (!FORMS[op]?.includes(field)) fail()
    if (op === 'is') return expect('EMPTY') && ((item) => (field === 'sprint' || field === 'fixVersion' ? VALUE[field](item).length === 0 : VALUE.assignee(item) === null))
    if (op === 'in') {
      expect('(')
      const values = [string()]
      while (accept(',')) values.push(string())
      expect(')')
      return (item) => values.some((value) => same(field, VALUE[field](item), value))
    }
    const value = string()
    if (field === 'sprint' || field === 'fixVersion') return (item) => VALUE[field](item).includes(value)
    if (field === 'labels') return (item) => item.fields.labels.includes(value)
    if (field !== 'updated') return (item) => same(field, VALUE[field](item), value)
    const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : fail()
    return op === '>=' ? (item) => instant(item.fields.updated) >= day : (item) => instant(item.fields.updated) < day
  }
  const tests = [clause()]
  while (accept('AND')) tests.push(clause())
  let order = 'created'
  if (accept('ORDER')) {
    expect('BY')
    order = ORDERS[tokens.slice(at).map((token) => token.value).join(' ')] ?? fail()
    at = tokens.length
  }
  if (at !== tokens.length) fail()
  return { test: (item) => tests.every((check) => check(item)), order }
}

const keyNumber = (key) => Number(key.split('-')[1])
const SORTS = {
  created: (a, b) => a.fields.created.localeCompare(b.fields.created) || keyNumber(a.key) - keyNumber(b.key),
  updated: (a, b) => b.fields.updated.localeCompare(a.fields.updated) || keyNumber(a.key) - keyNumber(b.key),
}

/** An offset page of `list` from the startAt and maxResults query parameters. */
function offsetPage(list, query, max = 100) {
  const startAt = Number(query.get('startAt') ?? 0)
  const maxResults = Number(query.get('maxResults') ?? max)
  return { startAt, maxResults, total: list.length, isLast: startAt + maxResults >= list.length, values: list.slice(startAt, startAt + maxResults) }
}

const PLAN_LISTED = { id: '12', name: 'Q1 roadmap', status: 'Active', scenarioId: '34', issueSources: [{ type: 'Board', value: 7 }] }
const PLAN_FULL = {
  id: 12,
  name: 'Q1 roadmap',
  status: 'Active',
  leadAccountId: 'acc-1',
  lastSaved: '2026-11-20T10:00:00Z',
  issueSources: [{ type: 'Board', value: 7 }],
  scheduling: { dependencies: 'Sequential', estimation: 'StoryPoints', inferredDates: 'SprintDates', startDate: { type: 'DueDate' }, endDate: { type: 'TargetEndDate' } },
  crossProjectReleases: [{ name: 'Spring launch', releaseIds: [10001] }],
}

const queryList = (query, name) => (query.get(name) ?? '').split(',').map((value) => value.trim()).filter(Boolean)

/**
 * The fake work-item routes, spread over jiraSiteRoutes(), the state they read and mutate in place, and writes() the
 * non-GET calls. `now` returns the time of each write; the default clock starts at 2026-11-22T10:00:00.000Z and
 * advances one second per write, and lives in the state so a restored state keeps counting. `extraStatuses` passes on to
 * jiraSiteRoutes, for a status in every category. `sprints` seeds the board's Jira sprints (PMK-78), `versions` the space's versions (PMK-79),
 * `worklogs` the raw worklogs per work item key; `timeTracking: false` serves a site with time tracking off, which refuses every worklog call (PMK-80).
 * `plans` serves a Premium site's Plans routes (plan 12 "Q1 roadmap", default scenario 34, team 5 "Payments" capacity 30 Scrum, story points); `plans: false` answers 403 on every Plans route (PMK-82).
 */
export function fakeJiraIssues({ state = emptyState(), requireResolution = true, now, extraStatuses = false, sprints = [], versions = [], worklogs = {}, timeTracking = true, plans = true } = {}) {
  state.worklogs ??= {}
  state.next.worklog ??= 10000
  for (const [key, list] of Object.entries(worklogs)) (state.worklogs[key] ??= []).push(...structuredClone(list))
  state.sprints ??= []
  state.versions ??= []
  state.next.version ??= 10100
  for (const version of versions) state.versions.push({ released: false, archived: false, projectId: SPACE.id, ...structuredClone(version) })
  state.next.version = Math.max(state.next.version, ...state.versions.map((version) => Number(version.id) + 1))
  state.next.sprint ??= 1
  for (const sprint of sprints) state.sprints.push({ originBoardId: BOARD, goal: '', ...structuredClone(sprint) })
  state.next.sprint = Math.max(state.next.sprint, ...state.sprints.map((sprint) => sprint.id + 1))
  const site = jiraSiteRoutes({ extraStatuses })
  if (!timeTracking) site['GET /rest/api/3/configuration'] = { json: { issueLinkingEnabled: true, timeTrackingEnabled: false } }
  const timeTrackingOn = () => timeTracking || refuse(400, {}, ['Time Tracking is not enabled.'])
  const plansOn = () => plans || refuse(403, {}, ['Plans are not available.'])
  const typeStatuses = statusesByType(site)
  const writes = []
  const stamp = () => jiraFormat(now ? now() : START + 1000 * state.clock++)

  const itemOf = (key) => state.items[upper(key)] ?? notFound()
  const sprintOf = (id) => state.sprints.find((sprint) => String(sprint.id) === String(id)) ?? notFound(`Sprint with id '${id}' does not exist.`)
  const sprintField = (sprint) => ({ id: sprint.id, name: sprint.name, state: sprint.state, boardId: sprint.originBoardId, goal: sprint.goal, ...pickDates(sprint) })
  const pickDates = ({ startDate, endDate, completeDate }) => Object.fromEntries(Object.entries({ startDate, endDate, completeDate }).filter(([, value]) => value))
  const versionOf = (id) => state.versions.find((version) => version.id === String(id)) ?? notFound(`The version with id '${id}' does not exist.`)
  const omitProperties = ({ properties, ...comment }) => comment
  const names = (ids) => (ids.length > 0 ? ids.map((id) => sprintOf(id).name).join(', ') : null)

  function record(item, items, at) {
    if (items.length === 0) return
    ;(state.changelog[item.key] ??= []).push({ id: String(state.next.history++), author: { ...VIEWER }, created: at, items })
    item.fields.updated = at
  }

  /** Converts every written field (all or none), then applies them and records one changelog entry. */
  function applyFields(item, fields, at, { log = true } = {}) {
    const converted = Object.entries(fields).map(([id, value]) => [id, convert(id, value, state)])
    if (converted.some(([id, value]) => id === 'parent' && value?.key === item.key)) badField('parent', 'A work item cannot be its own parent.')
    const changes = []
    for (const [id, value] of converted) {
      const before = item.fields[id] ?? null
      if (JSON.stringify(before) === JSON.stringify(value)) continue
      item.fields[id] = value
      changes.push(changeItem(id, before, value, state))
    }
    if (log) record(item, changes, at)
  }

  const brief = (key) => ({ id: state.items[key].id, key, fields: { summary: state.items[key].fields.summary, status: state.items[key].fields.status } })
  const isSubtaskType = (item) => WORK_TYPES.find((type) => type.id === item.fields.issuetype.id)?.subtask === true
  const subtasksOf = (key) => Object.values(state.items).filter((item) => item.fields.parent?.key === key && isSubtaskType(item))

  function linksOf(key) {
    return state.links.flatMap((link) => {
      const type = LINK_TYPES.find((entry) => entry.id === link.typeId)
      if (link.inward === key) return [{ id: link.id, type, outwardIssue: brief(link.outward) }]
      if (link.outward === key) return [{ id: link.id, type, inwardIssue: brief(link.inward) }]
      return []
    })
  }

  /** The item as a read returns it; `propertyKeys` limits the properties (all when undefined). */
  function render(item, propertyKeys) {
    const logged = state.worklogs[item.key] ?? []
    const fields = { ...item.fields, worklog: { startAt: 0, maxResults: 20, total: logged.length, worklogs: structuredClone(logged.slice(0, 20)) }, fixVersions: (item.fields.fixVersions ?? []).map((entry) => versionField(versionOf(entry.id))), subtasks: subtasksOf(item.key).map((sub) => brief(sub.key)), issuelinks: linksOf(item.key) }
    if (item.sprintIds?.length) fields[SPRINT_FIELD] = item.sprintIds.map((id) => sprintField(sprintOf(id)))
    else fields[SPRINT_FIELD] = null
    const read = structuredClone({ id: item.id, key: item.key, fields })
    const stored = Object.entries(state.properties[item.key] ?? {}).filter(([name]) => !propertyKeys || propertyKeys.includes(name))
    if (stored.length > 0 || propertyKeys?.length) read.properties = Object.fromEntries(stored)
    return read
  }

  function transitionsOf(item) {
    const statuses = typeStatuses[item.fields.issuetype.id].filter((status) => status.id !== item.fields.status.id)
    return statuses.map((status) => {
      const screen = requireResolution && status.statusCategory.key === 'done'
      return { id: `t${status.id}`, name: status.name, hasScreen: screen, to: statusOf(status), fields: screen ? { resolution: structuredClone(RESOLUTION_FIELD) } : {} }
    })
  }

  function removeItem(key) {
    delete state.items[key]
    state.links = state.links.filter((link) => link.inward !== key && link.outward !== key)
    for (const store of [state.comments, state.properties, state.changelog, state.worklogs]) delete store[key]
    for (const other of Object.values(state.items)) if (other.fields.parent?.key === key) other.fields.parent = null
  }

  /** Sets the sprints of the issues named in `body`, recording one Sprint changelog item each. */
  function moveIssues(body, at, target) {
    const issues = (Array.isArray(body?.issues) ? body.issues : []).map(itemOf)
    if (issues.length === 0) refuse(400, {}, ['issues must name at least one work item.'])
    if (target?.state === 'closed') refuse(400, {}, ['Cannot add issues to a closed sprint.'])
    for (const item of issues) {
      const before = item.sprintIds ?? []
      const after = [...before.filter((id) => sprintOf(id).state === 'closed'), ...(target ? [target.id] : [])]
      if (after.join() === before.join()) continue
      item.sprintIds = after
      const join = (ids) => (ids.length > 0 ? ids.join(', ') : null)
      record(item, [{ field: 'Sprint', fieldtype: 'custom', fieldId: SPRINT_FIELD, from: join(before), fromString: names(before), to: join(after), toString: names(after) }], at())
    }
    return { status: 204 }
  }

  const handlers = {
    [`GET ${AGILE}/board/{boardId}/sprint`]({ params, query }) {
      if (params.boardId !== String(BOARD)) notFound('Board does not exist or you do not have permission to see it.')
      const states = queryList(query, 'state')
      const matched = state.sprints.filter((sprint) => states.length === 0 || states.includes(sprint.state))
      return { json: offsetPage(structuredClone(matched), query, 50) }
    },
    [`GET ${AGILE}/sprint/{sprintId}`]: ({ params }) => ({ json: structuredClone(sprintOf(params.sprintId)) }),
    [`POST ${AGILE}/sprint`]({ body }) {
      if (body?.originBoardId !== BOARD) refuse(400, {}, ['The board does not exist or is not a Scrum board.'])
      if (typeof body.name !== 'string' || !body.name.trim()) refuse(400, {}, ['The sprint name is required.'])
      const { startDate, endDate, goal = '' } = body
      const sprint = { id: state.next.sprint++, state: 'future', name: body.name, originBoardId: BOARD, goal, ...pickDates({ startDate, endDate }) }
      state.sprints.push(sprint)
      return { status: 201, json: structuredClone(sprint) }
    },
    [`POST ${AGILE}/sprint/{sprintId}`]({ params, body, at }) {
      const sprint = sprintOf(params.sprintId)
      const next = { ...sprint, ...Object.fromEntries(['name', 'goal', 'startDate', 'endDate'].filter((name) => name in (body ?? {})).map((name) => [name, body[name]])) }
      if (typeof next.name !== 'string' || !next.name.trim()) refuse(400, {}, ['The sprint name is required.'])
      if (body?.state !== undefined && body.state !== sprint.state) {
        if (body.state === 'active') {
          if (sprint.state !== 'future' || !next.startDate || !next.endDate) refuse(400, {}, ['Only a future sprint with start and end dates can be started.'])
          if (state.sprints.some((other) => other.state === 'active')) refuse(400, {}, ['Another sprint is already active.'])
        } else if (body.state === 'closed' && sprint.state === 'active') next.completeDate = at()
        else refuse(400, {}, [`A ${sprint.state} sprint cannot become ${body.state}.`])
        next.state = body.state
      }
      Object.assign(sprint, next)
      return { json: structuredClone(sprint) }
    },
    [`POST ${AGILE}/sprint/{sprintId}/issue`]: ({ params, body, at }) => moveIssues(body, at, sprintOf(params.sprintId)),
    [`POST ${AGILE}/backlog/issue`]: ({ body, at }) => moveIssues(body, at, null),
    [`GET ${API}/project/{key}/version`]({ params, query }) {
      if (upper(params.key) !== SPACE.key) notFound('No project could be found with key \'' + params.key + '\'.')
      return { json: offsetPage(structuredClone(state.versions), query, 50) }
    },
    [`GET ${API}/version/{id}`]: ({ params }) => ({ json: structuredClone(versionOf(params.id)) }),
    [`POST ${API}/version`]({ body }) {
      if (typeof body?.name !== 'string' || !body.name.trim()) refuse(400, { name: 'The version name is required.' })
      if (String(body.projectId) !== SPACE.id) refuse(400, { projectId: 'Specify a valid project ID.' })
      if (state.versions.some((version) => version.name === body.name)) refuse(400, { name: 'A version with this name already exists in this project.' })
      const { description, releaseDate } = body
      const version = { id: String(state.next.version++), name: body.name, ...(description ? { description } : {}), released: body.released === true, archived: body.archived === true, ...(releaseDate ? { releaseDate } : {}), projectId: SPACE.id }
      state.versions.push(version)
      return { status: 201, json: structuredClone(version) }
    },
    [`PUT ${API}/version/{id}`]({ params, body }) {
      const version = versionOf(params.id)
      const next = { ...version, ...Object.fromEntries(['released', 'releaseDate', 'description', 'name', 'archived'].filter((name) => name in (body ?? {})).map((name) => [name, body[name]])) }
      if (typeof next.name !== 'string' || !next.name.trim()) refuse(400, { name: 'The version name is required.' })
      if (state.versions.some((other) => other !== version && other.name === next.name)) refuse(400, { name: 'A version with this name already exists in this project.' })
      Object.assign(version, next)
      return { json: structuredClone(version) }
    },
    [`GET ${API}/search/jql`]({ query }) {
      const { test, order } = parseJql(query.get('jql') ?? '', sprintOf)
      const startAt = Number(query.get('nextPageToken') ?? 0)
      const maxResults = Math.min(Number(query.get('maxResults') ?? 50), 100)
      const matched = Object.values(state.items).filter(test).sort(SORTS[order])
      const changelog = queryList(query, 'expand').includes('changelog')
      const issues = matched.slice(startAt, startAt + maxResults).map((item) => {
        const read = render(item, queryList(query, 'properties'))
        if (!changelog) return read
        const histories = structuredClone(state.changelog[item.key] ?? [])
        return { ...read, changelog: { startAt: 0, maxResults: histories.length, total: histories.length, histories } }
      })
      const isLast = startAt + maxResults >= matched.length
      return { json: { issues, ...(isLast ? {} : { nextPageToken: String(startAt + maxResults) }), isLast } }
    },
    [`POST ${API}/issue`]({ body, at }) {
      const { project, issuetype, ...fields } = body?.fields ?? {}
      const errors = {}
      if (upper(project?.key) !== SPACE.key && String(project?.id) !== SPACE.id) errors.project = 'Specify a valid project ID or key'
      if (!issuetype) errors.issuetype = 'Specify an issue type'
      if (fields.summary === undefined) errors.summary = 'You must specify a summary of the issue.'
      if (Object.keys(errors).length > 0) refuse(400, errors)
      const number = state.next.item
      const key = `${SPACE.key}-${number}`
      const todo = statusOf(typeStatuses[convert('issuetype', issuetype, state).id][0])
      const item = { id: String(10000 + number), key, fields: { summary: null, description: null, status: todo, fixVersions: [], priority: null, assignee: null, labels: [], parent: null, duedate: null, resolution: null, creator: { ...VIEWER } } }
      applyFields(item, { issuetype, ...fields }, at, { log: false })
      if (isSubtaskType(item) && !item.fields.parent) badField('parent', 'A sub-task needs a parent.')
      item.fields.created = item.fields.updated = at()
      state.items[key] = item
      state.next.item += 1
      return { status: 201, json: { id: item.id, key, self: `https://acme.atlassian.net${API}/issue/${item.id}` } }
    },
    [`GET ${API}/issue/{key}`]: ({ params }) => ({ json: render(itemOf(params.key)) }),
    [`PUT ${API}/issue/{key}`]({ params, body, at }) {
      applyFields(itemOf(params.key), body?.fields ?? {}, at())
      return { status: 204 }
    },
    [`DELETE ${API}/issue/{key}`]({ params, query }) {
      const item = itemOf(params.key)
      const subtasks = subtasksOf(item.key)
      if (subtasks.length > 0 && query.get('deleteSubtasks') !== 'true') refuse(400, {}, [`The issue ${item.key} has subtasks; set deleteSubtasks to delete them.`])
      for (const sub of subtasks) removeItem(sub.key)
      removeItem(item.key)
      return { status: 204 }
    },
    [`PUT ${API}/issue/{key}/assignee`]({ params, body, at }) {
      const item = itemOf(params.key)
      if (!body || !('accountId' in body)) badField('assignee', 'accountId is required.')
      applyFields(item, { assignee: body.accountId === null ? null : { accountId: body.accountId } }, at())
      return { status: 204 }
    },
    [`GET ${API}/issue/{key}/transitions`]: ({ params }) => ({ json: { transitions: transitionsOf(itemOf(params.key)) } }),
    [`POST ${API}/issue/{key}/transitions`]({ params, body, at }) {
      const item = itemOf(params.key)
      const transition = transitionsOf(item).find((entry) => entry.id === String(body?.transition?.id))
      if (!transition) refuse(400, {}, [`Transition id '${body?.transition?.id}' is not valid for this issue.`])
      const given = body.fields ?? {}
      for (const id of Object.keys(given)) if (!transition.fields[id]) cannotSet(id)
      if (transition.fields.resolution && !given.resolution) badField('resolution', 'Resolution is required.')
      const resolution = given.resolution ? (byIdOrName(RESOLUTIONS, given.resolution) ?? badField('resolution', 'Specify a valid resolution')) : null
      const before = item.fields.status
      item.fields.status = transition.to
      item.fields.resolution = resolution && { ...resolution }
      record(item, [changeItem('status', before, transition.to, state)], at())
      return { status: 204 }
    },
    [`GET ${API}/issue/{key}/changelog`]: ({ params, query }) => ({ json: offsetPage(structuredClone(state.changelog[itemOf(params.key).key] ?? []), query) }),
    [`GET ${API}/issue/{key}/comment`]({ params, query }) {
      const { values, isLast, ...page } = offsetPage(structuredClone(state.comments[itemOf(params.key).key] ?? []), query, 5000)
      const expanded = queryList(query, 'expand').includes('properties')
      return { json: { ...page, comments: values.map((comment) => (expanded ? { ...comment, properties: comment.properties ?? [] } : omitProperties(comment))) } }
    },
    [`POST ${API}/issue/{key}/comment`]({ params, body, at }) {
      const item = itemOf(params.key)
      if (body?.body?.type !== 'doc') badField('comment', 'Comment body can not be empty!')
      const created = at()
      const comment = { id: String(state.next.comment++), author: { ...VIEWER }, body: body.body, created, updated: created, ...(Array.isArray(body.properties) ? { properties: structuredClone(body.properties) } : {}) }
      ;(state.comments[item.key] ??= []).push(comment)
      item.fields.updated = created
      return { status: 201, json: omitProperties(structuredClone(comment)) }
    },
    [`GET ${API}/plans/plan`]() {
      plansOn()
      return { json: { values: [PLAN_LISTED], last: true, size: 1 } }
    },
    [`GET ${API}/plans/plan/{id}`]({ params }) {
      plansOn()
      return params.id === '12' ? { json: PLAN_FULL } : notFound()
    },
    [`GET ${API}/plans/plan/{id}/team`]() {
      plansOn()
      return { json: { values: [{ id: '5', type: 'PlanOnly', name: 'Payments' }], last: true, size: 1 } }
    },
    [`GET ${API}/plans/plan/{id}/team/planonly/{team}`]() {
      plansOn()
      return { json: { id: 5, name: 'Payments', capacity: 30, issueSourceId: 7, memberAccountIds: [], planningStyle: 'Scrum', sprintLength: 14 } }
    },
    [`GET ${API}/issue/{key}/worklog`]({ params, query }) {
      timeTrackingOn()
      const { values, isLast, ...page } = offsetPage(structuredClone(state.worklogs[itemOf(params.key).key] ?? []), query, 5000)
      return { json: { ...page, worklogs: values } }
    },
    [`POST ${API}/issue/{key}/worklog`]({ params, body, at }) {
      timeTrackingOn()
      const item = itemOf(params.key)
      if (!Number.isInteger(body?.timeSpentSeconds) || body.timeSpentSeconds <= 0) badField('timeLogged', 'You must indicate the time spent working.')
      const created = at()
      const worklog = { id: String(state.next.worklog++), author: { ...VIEWER }, started: body.started ?? created, created, updated: created, timeSpentSeconds: body.timeSpentSeconds }
      const list = (state.worklogs[item.key] ??= [])
      const before = list.reduce((sum, entry) => sum + entry.timeSpentSeconds, 0)
      list.push(worklog)
      const spent = (value) => (value === 0 ? null : String(value))
      record(item, [
        { field: 'timespent', fieldId: 'timespent', fieldtype: 'jira', from: spent(before), fromString: spent(before), to: spent(before + worklog.timeSpentSeconds), toString: spent(before + worklog.timeSpentSeconds) },
        { field: 'WorklogId', fieldtype: 'jira', from: null, fromString: null, to: worklog.id, toString: worklog.id },
      ], created)
      return { status: 201, json: structuredClone(worklog) }
    },
    [`POST ${API}/issueLink`]({ body, at }) {
      const type = LINK_TYPES.find((entry) => lower(entry.name) === lower(body?.type?.name) || entry.id === String(body?.type?.id))
      if (!type) notFound(`No issue link type with name '${body?.type?.name}' found.`)
      const inward = itemOf(body.inwardIssue?.key)
      const outward = itemOf(body.outwardIssue?.key)
      if (inward === outward) refuse(400, {}, ['You cannot link an issue to itself.'])
      const exists = state.links.some((link) => link.typeId === type.id && link.inward === inward.key && link.outward === outward.key)
      if (!exists) {
        state.links.push({ id: String(state.next.link++), typeId: type.id, inward: inward.key, outward: outward.key })
        const time = at()
        record(inward, [linkItem(outward.key, type.outward, true)], time)
        record(outward, [linkItem(inward.key, type.inward, true)], time)
      }
      return { status: 201 }
    },
    [`DELETE ${API}/issueLink/{id}`]({ params, at }) {
      const link = state.links.find((entry) => entry.id === params.id) ?? notFound(`No issue link with id '${params.id}' exists.`)
      const type = LINK_TYPES.find((entry) => entry.id === link.typeId)
      state.links = state.links.filter((entry) => entry !== link)
      const time = at()
      record(state.items[link.inward], [linkItem(link.outward, type.outward, false)], time)
      record(state.items[link.outward], [linkItem(link.inward, type.inward, false)], time)
      return { status: 204 }
    },
    [`PUT ${API}/issue/{key}/properties/{property}`]({ params, body }) {
      const properties = (state.properties[itemOf(params.key).key] ??= {})
      const existed = Object.hasOwn(properties, params.property)
      properties[params.property] = body
      return { status: existed ? 200 : 201 }
    },
    [`DELETE ${API}/issue/{key}/properties/{property}`]({ params }) {
      const key = itemOf(params.key).key
      if (!Object.hasOwn(state.properties[key] ?? {}, params.property)) notFound(`The property '${params.property}' does not exist.`)
      delete state.properties[key][params.property]
      if (Object.keys(state.properties[key]).length === 0) delete state.properties[key]
      return { status: 204 }
    },
  }

  /** A fakeJiraFetch function route around a handler: parses the body, records a write, answers refusals. */
  function route(handle) {
    return (call) => {
      const url = new URL(call.url)
      const body = call.body ? JSON.parse(call.body) : undefined
      if (call.method !== 'GET') writes.push({ method: call.method, path: url.pathname, body })
      let time
      const at = () => (time ??= stamp())
      try {
        return handle({ params: call.params ?? {}, query: url.searchParams, body, at })
      } catch (error) {
        if (error instanceof Answer) return error.response
        throw error
      }
    }
  }

  const routes = { ...site, ...Object.fromEntries(Object.entries(handlers).map(([key, handle]) => [key, route(handle)])) }
  return { routes, state, writes: () => structuredClone(writes) }
}
