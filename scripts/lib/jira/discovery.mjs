// Jira site discovery: the reads of one site and one space, the raw data they give, and the discover result.
// See docs/superpowers/specs/2026-11-22-pmk-76-jira-discovery-and-manifest-design.md, "Discovery".

import { PmkitError } from '../errors.mjs'
import { FIELD_ROLES } from '../model.mjs'

const PRIORITIES = ['urgent', 'high', 'medium', 'low']
const CATEGORY_OF_KEY = { new: 'todo', indeterminate: 'in_progress', done: 'done' }
const LEVELS = { '-1': 'subtask', 0: 'standard', 1: 'epic' }
const STORY_POINTS_TYPE = 'com.pyxis.greenhopper.jira:jsw-story-points'
const SPRINT_TYPE = 'com.pyxis.greenhopper.jira:gh-sprint'

// What each optional read leaves out when Jira refuses it.
const UNREAD = {
  labels: 'discover lists no labels',
  license: 'sprints are judged from the boards alone',
  'global settings': 'issue linking and time tracking are assumed on',
  boards: 'sprints and the board estimate field are unknown',
  'assignable users': 'discover lists the viewer as the only member',
  priorities: 'the Jira priorities are unknown',
  'link types': 'the Jira link types are unknown',
}

/** The pmkit category of a Jira status category key, or null for a key pmkit does not know. */
export const categoryOfStatus = (key) => (typeof key === 'string' && Object.hasOwn(CATEGORY_OF_KEY, key) ? CATEGORY_OF_KEY[key] : null)

const ASSIGNABLE_LIMIT = 1000

const styleOf = (project) => (project.style === 'next-gen' || project.simplified === true ? 'team-managed' : 'company-managed')
const spaceOf = (project) => ({ id: String(project.id), key: project.key, name: project.name, style: styleOf(project), type: project.projectTypeKey ?? null })
const levelOf = (type) => (typeof type.hierarchyLevel === 'number' ? (LEVELS[type.hierarchyLevel] ?? String(type.hierarchyLevel)) : type.subtask ? 'subtask' : 'standard')

/** A team-managed space's own work types and fields carry its id in scope; another space's are not this space's. */
const ownedBy = (spaceId) => (item) => !item?.scope?.project?.id || String(item.scope.project.id) === spaceId

/**
 * Runs an optional read. A refusal (AUTH, NOT_FOUND) or a failed answer (UPSTREAM) gives null and records what was not read;
 * any other error, RATE_LIMITED included, propagates.
 */
async function optional(read, what, unread) {
  try {
    return await read()
  } catch (error) {
    if (error instanceof PmkitError && ['AUTH', 'NOT_FOUND', 'UPSTREAM'].includes(error.code)) {
      unread.push({ what, code: error.code })
      return null
    }
    throw error
  }
}

/** The space's first Scrum board, else its first board, with the board's estimate field. */
async function readBoard(client, space) {
  const { items } = await client.paginate('/rest/agile/1.0/board', { query: { projectKeyOrId: space } })
  const board = items.find((item) => item.type === 'scrum') ?? items[0]
  if (!board) return null
  const config = await client.request('GET', `/rest/agile/1.0/board/${encodeURIComponent(board.id)}/configuration`)
  return { id: board.id, type: board.type ?? null, estimationField: config?.estimation?.field?.fieldId ?? null }
}

function licenseOf(license) {
  if (license === null) return { software: null }
  const app = (license?.applications ?? []).find((item) => item.id === 'jira-software')
  return { software: typeof app?.plan === 'string' ? app.plan.toLowerCase() : 'unlicensed' }
}

function settingsOf(config) {
  if (config === null) return null
  return {
    issueLinking: config.issueLinkingEnabled !== false,
    timeTracking: config.timeTrackingConfiguration !== undefined || config.timeTrackingEnabled === true,
  }
}

/** Reads one site and one space and returns the raw data the view and the manifest read. */
export async function fetchDiscovery(client, { space, now = () => new Date() }) {
  const session = await client.session()
  const unread = []
  const path = `/rest/api/3/project/${encodeURIComponent(space)}`
  const project = client.request('GET', path).catch((error) => {
    if (error instanceof PmkitError && error.code === 'NOT_FOUND') {
      throw new PmkitError('NOT_CONFIGURED', `tracker.scope.space names ${space}, which ${session.site} does not have or the token's owner cannot browse`, '/pmkit:setup')
    }
    throw error
  })
  const [spaces, found, statusLists, fields, labels, license, config, users, priorityList, linkTypeList] = await Promise.all([
    client.paginate('/rest/api/3/project/search'),
    project,
    client.request('GET', `${path}/statuses`),
    client.request('GET', '/rest/api/3/field'),
    optional(() => client.paginate('/rest/api/3/label', { pageSize: 100 }), 'labels', unread),
    optional(() => client.request('GET', '/rest/api/3/instance/license'), 'license', unread),
    optional(() => client.request('GET', '/rest/api/3/configuration'), 'global settings', unread),
    optional(() => client.request('GET', '/rest/api/3/user/assignable/search', { query: { project: space, maxResults: ASSIGNABLE_LIMIT } }), 'assignable users', unread),
    optional(() => client.request('GET', '/rest/api/3/priority'), 'priorities', unread),
    optional(() => client.request('GET', '/rest/api/3/issueLinkType'), 'link types', unread),
  ])
  const own = ownedBy(String(found.id))
  const board = found.projectTypeKey === 'software' ? await optional(() => readBoard(client, space), 'boards', unread) : null

  const statusesOf = new Map((Array.isArray(statusLists) ? statusLists : []).map((item) => [String(item.id), item.statuses ?? []]))
  const statuses = new Map()
  const workTypes = (found.issueTypes ?? []).filter(own).map((type) => {
    const list = statusesOf.get(String(type.id)) ?? []
    for (const status of list) {
      if (!statuses.has(String(status.id))) statuses.set(String(status.id), { id: String(status.id), name: status.name, categoryKey: status.statusCategory?.key ?? null })
    }
    return { id: String(type.id), name: type.name, level: levelOf(type), statuses: list.map((status) => String(status.id)) }
  })

  return {
    version: 1,
    discoveredAt: now().toISOString(),
    site: session.site,
    spaces: spaces.items.map(spaceOf),
    space: spaceOf(found),
    workTypes,
    statuses: [...statuses.values()],
    fields: (Array.isArray(fields) ? fields : []).filter(own).map((field) => ({
      id: field.id,
      name: field.name,
      system: field.schema?.system ?? null,
      customType: field.schema?.custom ?? null,
      type: field.schema?.type ?? null,
    })),
    labels: labels === null ? null : labels.items.filter((label) => typeof label === 'string'),
    license: licenseOf(license),
    settings: settingsOf(config),
    board,
    members: users === null ? null : (Array.isArray(users) ? users : []).filter((user) => user.accountType === 'atlassian').map((user) => ({ id: user.accountId, name: user.displayName })),
    priorities: priorityList === null ? null : (Array.isArray(priorityList) ? priorityList : []).map((item) => ({ id: String(item.id), name: item.name })),
    linkTypes: linkTypeList === null ? null : (linkTypeList?.issueLinkTypes ?? []).map((item) => ({ id: String(item.id), name: item.name, inward: item.inward, outward: item.outward })),
    unread,
    truncated: [
      ...(spaces.hasMore ? ['spaces'] : []),
      ...(labels?.hasMore ? ['labels'] : []),
      ...(Array.isArray(users) && users.length >= ASSIGNABLE_LIMIT ? ['assignable users'] : []),
    ],
  }
}

const named = (fields, ...names) => fields.find((field) => names.includes(field.name.toLowerCase()))
const bySystem = (fields, id) => fields.find((field) => field.system === id || field.id === id)

// The inference rule of each field role, in FIELD_ROLES order. Unverified on a live site (see the spec's Risks).
const ROLE_RULES = {
  estimate: (fields, raw) =>
    (raw.board?.estimationField && fields.find((field) => field.id === raw.board.estimationField)) ??
    fields.find((field) => field.customType === STORY_POINTS_TYPE) ??
    named(fields, 'story point estimate', 'story points'),
  priority: (fields) => bySystem(fields, 'priority'),
  target_date: (fields) => bySystem(fields, 'duedate'),
  start_date: (fields) => named(fields, 'start date'),
  assignee: (fields) => bySystem(fields, 'assignee'),
  acceptance_criteria: (fields) => named(fields, 'acceptance criteria'),
  time_spent: (fields) => bySystem(fields, 'timespent'),
  sprint: (fields) => fields.find((field) => field.customType === SPRINT_TYPE),
}

/** The field each role reads: the mapped field id first (ADR 0014), none for no field, else the role's rule. */
export function fieldRoles(raw, pmkit = {}) {
  const warnings = []
  const fields = {}
  for (const role of FIELD_ROLES) {
    const mapped = pmkit?.mappings?.fields?.[role]
    if (mapped === 'none') {
      fields[role] = null
      continue
    }
    let field = typeof mapped === 'string' ? raw.fields.find((item) => item.id === mapped) : undefined
    if (typeof mapped === 'string' && !field) warnings.push(`mappings.fields.${role} names ${mapped}, which ${raw.site} does not have`)
    field ??= ROLE_RULES[role]?.(raw.fields, raw)
    fields[role] = field ? { id: field.id, name: field.name } : null
  }
  return { fields, warnings }
}

/** The category each mapped status name takes, from mappings.status. blocked is not a category, and none means no such status. */
const mappedStatuses = (pmkit) =>
  Object.entries(pmkit?.mappings?.status ?? {}).filter(([category, name]) => category !== 'blocked' && typeof name === 'string' && name !== 'none')

/** The assignable users, the viewer first and added when Jira leaves it out; the viewer alone when the read was refused. */
const membersOf = (raw, viewer) => [...(viewer ? [viewer] : []), ...(raw.members ?? []).filter((member) => member.id !== viewer?.id)]

/** The discover result: auth first (ADR 0013), the site and space, then the common keys every command reads. */
export function discoveryView(raw, pmkit = {}, { session } = {}) {
  const key = raw.space.key
  const mapped = mappedStatuses(pmkit)
  const categoryOfName = new Map(mapped.map(([category, name]) => [name, category]))
  const warnings = []
  const nameOf = new Map(raw.statuses.map((status) => [status.id, status.name]))

  const statuses = raw.statuses.map((status) => {
    let category = categoryOfName.get(status.name) ?? categoryOfStatus(status.categoryKey)
    if (category === null) {
      category = 'in_progress'
      warnings.push(`Jira status ${status.name} in space ${key} has no status category pmkit knows; it counts as in_progress`)
    }
    return { name: status.name, category }
  })
  for (const [category, name] of mapped) {
    if (!raw.statuses.some((status) => status.name === name)) warnings.push(`mappings.status.${category} names ${name}, which space ${key} does not have`)
  }

  const { fields, warnings: fieldWarnings } = fieldRoles(raw, pmkit)
  const viewer = session ? { id: session.viewer.accountId, name: session.viewer.displayName } : null
  const space = ({ key: k, name, style, type }) => ({ key: k, name, style, type })

  const view = {
    ...(session ? { auth: { source: session.source, viewer: { ...session.viewer }, site: session.site } } : {}),
    site: raw.site,
    plan: { ...raw.license },
    space: space(raw.space),
    spaces: raw.spaces.map(space),
    workTypes: raw.workTypes.map((type) => ({ name: type.name, level: type.level, statuses: type.statuses.map((id) => nameOf.get(id)) })),
    statuses,
    fields,
    types: Object.keys(pmkit?.mappings?.types ?? {}),
    priorities: [...PRIORITIES],
    labels: [...new Set(raw.labels ?? [])].sort(),
    members: membersOf(raw, viewer),
    ...(viewer ? { viewer } : {}),
    estimate: { unit: fields.estimate?.id === 'timeoriginalestimate' ? 'hours' : 'points', scale: [] },
    discoveredAt: raw.discoveredAt,
    warnings: [
      ...raw.unread.map(({ what, code }) => `Jira refused to read the ${what} (${code}); ${UNREAD[what]}`),
      ...raw.truncated.map((kind) => `Jira has more ${kind} than pmkit read; discovery kept the first page${kind === 'spaces' ? 's' : ''}`),
      ...warnings,
      ...fieldWarnings,
    ],
  }
  Object.defineProperty(view, 'raw', { value: raw, enumerable: false })
  return view
}
