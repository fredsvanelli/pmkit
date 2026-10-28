// Linear customers and customer requests: the queries, the views, the plans and createCustomers.
// See docs/superpowers/specs/2026-10-28-pmk-42-linear-customers-design.md.

import { PmkitError } from '../errors.mjs'
import { isIssueId } from './ids.mjs'
import { BUSINESS_PLANS } from './manifest.mjs'

const PLAN_HINT = 'Linear customers need the Business or Enterprise plan'
const CUSTOMERS_OFF_HINT = 'Turn on customers in the workspace settings in Linear'

/**
 * Whether the workspace has customers. raw is the cached discovery. The flag is the fact Linear enforces;
 * the plan only picks the reason and the hint.
 */
export function customersAvailability(raw) {
  if (raw.flags?.customersEnabled === true) return { available: true }
  const plan = raw.workspace.plan
  if (!BUSINESS_PLANS.includes(plan)) return { available: false, reason: 'plan', plan, enableHint: PLAN_HINT }
  return { available: false, reason: 'customers_off', plan, enableHint: CUSTOMERS_OFF_HINT }
}

const name = (item) => (item ? { id: item.id, name: item.name } : null)

/** The list shape of a Customer node. */
export function customerView(node) {
  return {
    id: node.id,
    name: node.name,
    status: name(node.status),
    tier: name(node.tier),
    revenue: node.revenue ?? null,
    size: node.size ?? null,
    owner: name(node.owner),
    requests: node.approximateNeedCount ?? 0,
    url: node.url ?? null,
  }
}

const BODY_LIMIT = 200

function targetOf(node) {
  if (node.issue) {
    const target = { type: 'issue', id: node.issue.identifier, title: node.issue.title }
    return node.issue.archivedAt ? { ...target, archived: true } : target
  }
  if (node.project) return { type: 'project', id: node.project.id, name: node.project.name }
  return null
}

/** The shape of a CustomerNeed node, the customer request. */
export function requestView(node) {
  const priority = node.priority === 1 ? 1 : 0
  return { id: node.id, body: (node.body ?? '').slice(0, BODY_LIMIT), priority, important: priority === 1, target: targetOf(node) }
}

/** The customers, highest revenue first, then by name. A missing revenue sorts last. Returns a new array. */
export function sortCustomers(list) {
  return [...list].sort((a, b) => {
    if ((a.revenue ?? null) !== (b.revenue ?? null)) {
      if (a.revenue == null) return 1
      if (b.revenue == null) return -1
      return b.revenue - a.revenue
    }
    return String(a.name).localeCompare(String(b.name))
  })
}

/** The plain text of a customer list, one aligned line per customer. */
export function customersText(list) {
  if (list.length === 0) return 'no customers yet'
  const columns = [
    (item) => item.name,
    (item) => `status ${item.status?.name ?? '-'}`,
    (item) => `tier ${item.tier?.name ?? '-'}`,
    (item) => `revenue ${item.revenue ?? '-'}`,
    (item) => `size ${item.size ?? '-'}`,
    (item) => `requests ${item.requests}`,
  ]
  const widths = columns.map((column) => Math.max(...list.map((item) => column(item).length)))
  return list.map((item) => columns.map((column, index) => (index === columns.length - 1 ? column(item) : column(item).padEnd(widths[index] + 3))).join('')).join('\n')
}

const bad = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

/** The customer a command names: the id first, then the exact name, case-insensitive. list holds customer views. */
export function resolveCustomer(list, idOrName) {
  if (typeof idOrName !== 'string' || idOrName === '') throw bad('--customer needs a customer id or name', 'Pass --customer with an id or the exact name; linear customers list shows them')
  const byId = list.find((item) => item.id === idOrName)
  if (byId) return byId
  const matches = list.filter((item) => sameName(item.name, idOrName))
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) throw bad(`${matches.length} customers are named "${idOrName}"`, `Pass --customer with one of these ids: ${matches.map((item) => item.id).join(', ')}`)
  throw new PmkitError('NOT_FOUND', `no customer is named or identified "${idOrName}"`, 'Run linear customers list to see the customers')
}

function pickByName(items, value, flag) {
  const found = items.find((item) => sameName(item.name, value))
  if (!found) throw bad(`--${flag} "${value}" is not one of the workspace's ${flag} values`, `Use one of: ${items.map((item) => item.name).join(', ') || '(none)'}`)
  return found
}

function wholeNumber(value, flag) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw bad(`--${flag} takes a whole number of at least 0, got "${value === true ? '' : value}"`, `Pass --${flag} 1000`)
  return Number(value)
}

/**
 * What `set` has to do, from the current customer view, the flags, the workspace statuses and tiers and the ids of the members.
 * Returns { changed: false } or { changed: true, input } with a customerUpdate input.
 */
export function planCustomerEdit(current, flags, statuses, tiers, memberIds) {
  const { status, tier, revenue, size, owner, name: newName } = flags
  if ([status, tier, revenue, size, owner, newName].every((value) => value === undefined)) {
    throw bad('set needs --status, --tier, --revenue, --size, --owner or --name', 'Pass at least one of them')
  }
  const input = {}
  if (status !== undefined) {
    const found = pickByName(statuses, status, 'status')
    if (found.id !== current.status?.id) input.statusId = found.id
  }
  if (tier !== undefined) {
    if (typeof tier === 'string' && tier.toLowerCase() === 'none') {
      if (current.tier) input.tierId = null
    } else {
      const found = pickByName(tiers, tier, 'tier')
      if (found.id !== current.tier?.id) input.tierId = found.id
    }
  }
  if (revenue !== undefined) {
    const value = wholeNumber(revenue, 'revenue')
    if (value !== current.revenue) input.revenue = value
  }
  if (size !== undefined) {
    const value = wholeNumber(size, 'size')
    if (value !== current.size) input.size = value
  }
  if (owner !== undefined) {
    if (owner === 'none') {
      if (current.owner) input.ownerId = null
    } else {
      if (!memberIds.includes(owner)) throw bad(`not a member of the workspace: ${owner}`, 'Use a member id from pmkit discover, or none')
      if (owner !== current.owner?.id) input.ownerId = owner
    }
  }
  if (newName !== undefined) {
    if (typeof newName !== 'string' || newName.trim() === '') throw bad('--name needs a non-empty name', 'Pass --name "Customer name"')
    if (newName !== current.name) input.name = newName
  }
  return Object.keys(input).length === 0 ? { changed: false } : { changed: true, input }
}

/** Checks the link flags that need no read. Returns 'create' or 'move'. */
export function checkLinkFlags(flags) {
  const { issue, project, request, body, important } = flags
  if (issue !== undefined && project !== undefined) throw bad('--issue and --project cannot be combined', 'Pass one of them')
  if (issue === undefined && project === undefined) {
    throw bad(request === undefined ? 'link needs --issue or --project' : '--request moves a request, so it needs the new --issue or --project', 'Pass --issue KEY or --project NAME')
  }
  if (issue !== undefined && !isIssueId(issue)) throw bad(`"${issue === true ? '' : issue}" is not an issue key`, 'Pass --issue with a key such as ACME-12')
  if (project !== undefined && (typeof project !== 'string' || project === '')) throw bad('--project needs a project name or slug', 'Pass --project NAME')
  if (request !== undefined) {
    if (typeof request !== 'string' || request === '') throw bad('--request needs a request id', 'Run linear customers show to see the request ids')
    if (body !== undefined || important) throw bad('--body and --important cannot be combined with --request', 'A move changes the target only; run link without --request to add a request')
    return 'move'
  }
  return 'create'
}

const sameTarget = (request, target) => request.target?.type === target.type && request.target.id === target.id

/**
 * What `link` has to do. customer is a customer view, requests the customer's request views, target the resolved
 * { type, id, linearId, title | name } (id is the issue key or the project id), flags the link flags.
 * Returns { kind: 'create', input } or { kind: 'move', id, from, input }.
 */
export function planLink({ customer, requests, flags, target }) {
  const kind = checkLinkFlags(flags)
  const targetInput = target.type === 'issue' ? { issueId: target.linearId } : { projectId: target.linearId }
  const label = target.type === 'issue' ? target.id : `"${target.name}"`
  const twin = requests.find((request) => request.id !== flags.request && sameTarget(request, target))
  if (twin) {
    throw new PmkitError('CONFLICT', `${customer.name} already has request ${twin.id} on ${label}`, 'Pass --request with another request id to move it here, or edit that request in Linear')
  }
  if (kind === 'create') {
    return { kind, input: { customerId: customer.id, ...targetInput, priority: flags.important ? 1 : 0, ...(flags.body === undefined ? {} : { body: flags.body }) } }
  }
  const owned = requests.find((request) => request.id === flags.request)
  if (!owned) throw bad(`request ${flags.request} does not belong to ${customer.name}`, 'Run linear customers show to see the customer\'s request ids')
  if (sameTarget(owned, target)) throw bad(`request ${owned.id} is already on ${label}`, 'Pass another target')
  return { kind, id: owned.id, from: owned.target, input: { issueId: target.type === 'issue' ? target.linearId : null, projectId: target.type === 'project' ? target.linearId : null } }
}
