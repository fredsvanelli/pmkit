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
