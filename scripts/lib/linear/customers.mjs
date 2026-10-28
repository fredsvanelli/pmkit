// Linear customers and customer requests: the queries, the views, the plans and createCustomers.
// See docs/superpowers/specs/2026-10-28-pmk-42-linear-customers-design.md.

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
