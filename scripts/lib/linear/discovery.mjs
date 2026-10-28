// Linear workspace discovery: the read queries, the raw data the cache keeps, and the discover result.
// See docs/superpowers/specs/2026-10-27-pmk-33-linear-discovery-design.md.

import { PmkitError } from '../errors.mjs'

const PAGE_INFO = 'pageInfo { hasNextPage endCursor }'
const CONNECTION_VARIABLES = '($first: Int!, $after: String)'

export const WORKSPACE_QUERY = 'query PmkitWorkspace { organization { urlKey name releasesEnabled customersEnabled trialEndsAt } }'
export const PLAN_QUERY = 'query PmkitPlan { organization { subscription { type } } }'
export const INTEGRATIONS_QUERY = 'query PmkitIntegrations { organization { integrations(first: 100) { nodes { service } } } }'
export const TEAMS_QUERY = `query PmkitTeams${CONNECTION_VARIABLES} { teams(first: $first, after: $after) { nodes { id key name parent { key } cyclesEnabled triageEnabled issueEstimationType issueEstimationAllowZero issueEstimationExtended } ${PAGE_INFO} } }`
export const STATES_QUERY = `query PmkitStates${CONNECTION_VARIABLES} { workflowStates(first: $first, after: $after) { nodes { id name type position team { id } } ${PAGE_INFO} } }`
export const LABELS_QUERY = `query PmkitLabels${CONNECTION_VARIABLES} { issueLabels(first: $first, after: $after) { nodes { id name isGroup retiredAt team { id } parent { id name } } ${PAGE_INFO} } }`
export const USERS_QUERY = `query PmkitUsers${CONNECTION_VARIABLES} { users(first: $first, after: $after) { nodes { id name displayName email active guest app teams(first: 50) { nodes { id } } } ${PAGE_INFO} } }`

const PAGE_SIZE = 250

/** Runs a read whose refusal costs only one field. AUTH and UPSTREAM give the fallback; any other error, RATE_LIMITED included, propagates. */
async function tolerant(promise, fallback) {
  try {
    return await promise
  } catch (error) {
    if (error instanceof PmkitError && (error.code === 'AUTH' || error.code === 'UPSTREAM')) return fallback
    throw error
  }
}

const NO_PLAN = Symbol('no plan')

/** The plan name: the subscription type in lowercase, else 'trial' while a trial runs, else 'free'. */
function planOf(subscription, trialEndsAt, now) {
  if (subscription === NO_PLAN) return 'unknown'
  if (typeof subscription?.type === 'string' && subscription.type !== '') return subscription.type.toLowerCase()
  const trialEnd = trialEndsAt ? new Date(trialEndsAt) : null
  if (trialEnd && !Number.isNaN(trialEnd.getTime()) && trialEnd > now) return 'trial'
  return 'free'
}

const team = (node) => ({
  id: node.id,
  key: node.key,
  name: node.name,
  parent: node.parent?.key ?? null,
  cyclesEnabled: node.cyclesEnabled === true,
  triageEnabled: node.triageEnabled === true,
  estimation: {
    type: node.issueEstimationType ?? 'notUsed',
    allowZero: node.issueEstimationAllowZero === true,
    extended: node.issueEstimationExtended === true,
  },
})

const state = (node) => ({ id: node.id, name: node.name, type: node.type, position: node.position, team: node.team?.id ?? null })

const label = (node) => ({
  id: node.id,
  name: node.name,
  group: node.parent?.name ?? null,
  isGroup: node.isGroup === true,
  team: node.team?.id ?? null,
})

const user = (node) => ({
  id: node.id,
  name: node.name,
  displayName: node.displayName ?? null,
  email: node.email ?? null,
  guest: node.guest === true,
  app: node.app === true,
  teams: (node.teams?.nodes ?? []).map((item) => item.id),
})

/**
 * Reads the workspace with queries only and returns the raw data the cache keeps: Linear's ids, no team scope, no mapping.
 * Retired labels and inactive users are dropped here.
 */
export async function fetchDiscovery(client, { now = () => new Date() } = {}) {
  await client.session()
  const connection = (document, field) => client.paginate(document, {}, { select: (data) => data[field], pageSize: PAGE_SIZE })
  const [workspace, plan, integrations, teams, states, labels, users] = await Promise.all([
    client.request(WORKSPACE_QUERY),
    tolerant(client.request(PLAN_QUERY), NO_PLAN),
    tolerant(client.request(INTEGRATIONS_QUERY), null),
    connection(TEAMS_QUERY, 'teams'),
    connection(STATES_QUERY, 'workflowStates'),
    connection(LABELS_QUERY, 'issueLabels'),
    connection(USERS_QUERY, 'users'),
  ])
  const organization = workspace?.organization ?? {}
  const at = now()
  const subscription = plan === NO_PLAN ? NO_PLAN : plan?.organization?.subscription
  const services = integrations === null ? null : (integrations?.organization?.integrations?.nodes ?? []).map((node) => node.service)
  const kinds = { teams, states, labels, users }
  return {
    version: 1,
    discoveredAt: at.toISOString(),
    workspace: {
      urlKey: organization.urlKey,
      name: organization.name,
      plan: planOf(subscription, organization.trialEndsAt, at),
      trialEndsAt: organization.trialEndsAt ?? null,
    },
    flags: { releasesEnabled: organization.releasesEnabled === true, customersEnabled: organization.customersEnabled === true },
    integrations: services,
    teams: teams.nodes.map(team),
    states: states.nodes.map(state),
    labels: labels.nodes.filter((node) => !node.retiredAt).map(label),
    users: users.nodes.filter((node) => node.active !== false).map(user),
    truncated: Object.keys(kinds).filter((kind) => kinds[kind].hasMore),
  }
}

const CATEGORY_OF_TYPE = {
  triage: 'triage',
  backlog: 'backlog',
  unstarted: 'todo',
  started: 'in_progress',
  completed: 'done',
  canceled: 'canceled',
  duplicate: 'canceled',
}

/** The pmkit category of a Linear state type, or null for a type pmkit does not know. */
export const categoryOfType = (type) => (typeof type === 'string' && Object.hasOwn(CATEGORY_OF_TYPE, type) ? CATEGORY_OF_TYPE[type] : null)

// Linear's estimate scales. Checked on 2026-10-27: linear.app/docs/estimates answered 404, and
// linear.app/docs/creating-issues gives the t-shirt points XS 1, S 2, M 3, L 5, XL 8, XXL 13, XXXL 21.
// The point scales and the two values "extended" adds come from a search of Linear's docs the same day.
const SCALES = {
  exponential: { base: [1, 2, 4, 8, 16], extended: [32, 64] },
  fibonacci: { base: [1, 2, 3, 5, 8], extended: [13, 21] },
  linear: { base: [1, 2, 3, 4, 5], extended: [6, 7] },
}
const SIZES = { base: ['XS', 'S', 'M', 'L', 'XL'], extended: ['XXL', 'XXXL'] }
const SIZE_POINTS = { XS: 1, S: 2, M: 3, L: 5, XL: 8, XXL: 13, XXXL: 21 }

/**
 * The estimate scale of a team's settings. allowZero puts 0 first in a points scale; t-shirt sizes gain no size,
 * because Linear stores 0 as no estimate. notUsed and an unknown type give an empty points scale.
 */
export function estimateScale({ type, allowZero = false, extended = false } = {}) {
  if (type === 'tShirt') {
    const scale = [...SIZES.base, ...(extended ? SIZES.extended : [])]
    return { unit: 'sizes', scale, values: Object.fromEntries(scale.map((size) => [size, SIZE_POINTS[size]])) }
  }
  const points = Object.hasOwn(SCALES, type) ? SCALES[type] : null
  if (!points) return { unit: 'points', scale: [] }
  return { unit: 'points', scale: [...(allowZero ? [0] : []), ...points.base, ...(extended ? points.extended : [])] }
}

const PRIORITIES = ['urgent', 'high', 'medium', 'low']
const KEPT_PER_KIND = PAGE_SIZE * 10
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const sameScale = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const NO_SCALE = { unit: 'points', scale: [] }

/** The category each mapped state name takes, from mappings.status. blocked is not a category, and none means the team has no such state. */
function mappedCategories(pmkit) {
  const status = pmkit?.mappings?.status ?? {}
  return Object.entries(status).filter(([category, name]) => category !== 'blocked' && typeof name === 'string' && name !== 'none')
}

/**
 * The discover result: the common keys every command reads, plus the workspace and each team.
 * pmkit is config.pmkit (tracker.scope.team and mappings.status). session is the client's session on a fresh fetch.
 */
export function discoveryView(raw, pmkit = {}, { session } = {}) {
  const mappings = mappedCategories(pmkit)
  const mappedName = new Map(mappings.map(([category, name]) => [name, category]))
  const unknownTypes = []
  const teamKeys = new Map(raw.teams.map((team) => [team.id, team.key]))
  const workspaceLabels = raw.labels.filter((label) => label.team === null && !label.isGroup)

  const teams = raw.teams.map((team) => {
    const states = raw.states.filter((item) => item.team === team.id).sort((a, b) => a.position - b.position)
    const statuses = states.map((item) => {
      let category = mappedName.get(item.name) ?? categoryOfType(item.type)
      if (category === null) {
        category = 'in_progress'
        unknownTypes.push(`Linear state ${item.name} on team ${team.key} has type ${item.type}, which pmkit does not know; it counts as in_progress`)
      }
      return { name: item.name, category, type: item.type }
    })
    // A team label wins over a workspace label with the same name.
    const own = raw.labels.filter((label) => label.team === team.id && !label.isGroup)
    const ownNames = new Set(own.map((label) => label.name))
    const labels = [...own, ...workspaceLabels.filter((label) => !ownNames.has(label.name))]
      .sort(byName)
      .map((label) => ({ name: label.name, group: label.group }))
    return {
      key: team.key,
      name: team.name,
      parent: team.parent,
      cycles: team.cyclesEnabled,
      triage: team.triageEnabled,
      statuses,
      labels,
      estimate: { ...estimateScale(team.estimation), type: team.estimation.type },
    }
  })

  const configured = pmkit?.tracker?.scope?.team
  const chosen = configured ? (teams.find((team) => team.key === configured) ?? null) : null
  const scoped = chosen ? [chosen] : teams

  const statuses = []
  const seenStatus = new Set()
  for (const team of scoped) {
    for (const { name, category } of team.statuses) {
      const id = JSON.stringify([name, category])
      if (seenStatus.has(id)) continue
      seenStatus.add(id)
      statuses.push({ name, category })
    }
  }

  const labelNames = chosen
    ? chosen.labels.map((label) => label.name)
    : raw.labels.filter((label) => !label.isGroup).map((label) => label.name)
  const typeLabels = new Set(Object.values(pmkit?.mappings?.types ?? {}))
  const labels = [...new Set(labelNames)].filter((name) => !typeLabels.has(name)).sort()

  let estimate
  const withoutType = ({ type, ...scale }) => scale
  if (chosen) estimate = withoutType(chosen.estimate)
  else {
    const used = raw.teams.filter((team) => team.estimation.type !== 'notUsed').map((team) => estimateScale(team.estimation))
    estimate = used.length > 0 && used.every((scale) => sameScale(scale, used[0])) ? used[0] : NO_SCALE
  }

  const members = raw.users
    .filter((user) => !user.app)
    .sort(byId)
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      handle: user.displayName,
      guest: user.guest,
      teams: user.teams.filter((id) => teamKeys.has(id)).map((id) => teamKeys.get(id)),
    }))
  const agents = raw.users.filter((user) => user.app).sort(byId).map((user) => ({ id: user.id, name: user.name }))

  const mappingWarnings = mappings
    .filter(([, name]) => !scoped.some((team) => team.statuses.some((status) => status.name === name)))
    .map(([category, name]) =>
      chosen
        ? `mappings.status.${category} names ${name}, which team ${chosen.key} does not have`
        : `mappings.status.${category} names ${name}, which no team has`,
    )

  const warnings = [
    ...(session?.warnings ?? []),
    ...raw.truncated.map((kind) => `Linear has more than ${KEPT_PER_KIND} ${kind}; discovery kept the first ${KEPT_PER_KIND}`),
    ...unknownTypes,
    ...mappingWarnings,
    ...(configured && !chosen ? [`tracker.scope.team names ${configured}, which this workspace does not have`] : []),
    ...(raw.workspace.plan === 'unknown' ? ['Linear did not say which plan this workspace has; capability hints assume the Free plan'] : []),
    ...(raw.integrations === null ? ["Linear refused to list this workspace's integrations for this key; linked_code assumes git only"] : []),
  ]

  const view = {
    ...(session
      ? { auth: { source: session.source, viewer: { id: session.viewer.id, name: session.viewer.name }, workspace: { urlKey: session.workspace.urlKey, name: session.workspace.name } } }
      : {}),
    workspace: { urlKey: raw.workspace.urlKey, name: raw.workspace.name, plan: raw.workspace.plan },
    team: chosen ? chosen.key : null,
    teams,
    statuses,
    types: Object.keys(pmkit?.mappings?.types ?? {}),
    priorities: [...PRIORITIES],
    labels,
    members,
    agents,
    estimate,
    discoveredAt: raw.discoveredAt,
    warnings,
  }
  // The view keeps the raw discovery as a hidden property, so resolveMappings can read Linear's ids from the view alone.
  Object.defineProperty(view, 'raw', { value: raw, enumerable: false })
  return view
}
