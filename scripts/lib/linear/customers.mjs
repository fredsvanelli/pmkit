// Linear customers and customer requests: the queries, the views, the plans and createCustomers.
// See docs/superpowers/specs/2026-10-28-pmk-42-linear-customers-design.md.

import { PmkitError } from '../errors.mjs'
import { isIssueId } from './ids.mjs'

const CUSTOMERS_OFF_HINT = 'An admin can turn on customer requests in the workspace settings.'

/**
 * Whether the workspace has customers. raw is the cached discovery. The flag is the fact Linear enforces. Linear's
 * docs say Customer Requests exist on all plans and an admin turns them on, so the plan changes nothing.
 */
export function customersAvailability(raw) {
  if (raw.flags?.customersEnabled === true) return { available: true }
  return { available: false, reason: 'customers_off', plan: raw.workspace.plan, enableHint: CUSTOMERS_OFF_HINT }
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

/** A number of at least 0 with an optional decimal part, for the Float fields. */
function decimalNumber(value, flag) {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) throw bad(`--${flag} takes a number of at least 0, got "${value === true ? '' : value}"`, `Pass --${flag} 450`)
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
    const value = decimalNumber(size, 'size')
    if (value !== current.size) input.size = value
  }
  if (owner !== undefined) {
    if (typeof owner === 'string' && owner.toLowerCase() === 'none') {
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

const PAGE_INFO = 'pageInfo { hasNextPage endCursor }'
const CUSTOMER_FIELDS = 'id name status { id name } tier { id name } revenue size owner { id name } approximateNeedCount url'
export const LIST_QUERY = `query PmkitCustomersList($first: Int!, $after: String, $filter: CustomerFilter) { customers(first: $first, after: $after, filter: $filter) { nodes { ${CUSTOMER_FIELDS} } ${PAGE_INFO} } }`
export const STATUSES_QUERY = `query PmkitCustomerStatuses($first: Int!, $after: String) { customerStatuses(first: $first, after: $after) { nodes { id name } ${PAGE_INFO} } }`
export const TIERS_QUERY = `query PmkitCustomerTiers($first: Int!, $after: String) { customerTiers(first: $first, after: $after) { nodes { id name } ${PAGE_INFO} } }`

export const SHOW_QUERY = `query PmkitCustomerShow($id: String!) { customer(id: $id) { ${CUSTOMER_FIELDS} needs(first: 50) { nodes { id body priority createdAt issue { id identifier title archivedAt } project { id name } } ${PAGE_INFO} } } }`

export const UPDATE_MUTATION = `mutation PmkitCustomerUpdate($id: String!, $input: CustomerUpdateInput!) { customerUpdate(id: $id, input: $input) { success customer { ${CUSTOMER_FIELDS} } } }`

const NEED_FIELDS = 'id body priority issue { id identifier title archivedAt } project { id name }'
export const ISSUE_QUERY = 'query PmkitCustomerIssue($id: ID!) { issues(filter: { id: { eq: $id } }, includeArchived: true, first: 1) { nodes { id identifier title archivedAt trashed } } }'
export const PROJECTS_QUERY = `query PmkitCustomerProjects($name: String!, $first: Int!) { projects(first: $first, filter: { or: [{ name: { containsIgnoreCase: $name } }, { slugId: { eq: $name } }] }) { nodes { id name slugId } ${PAGE_INFO} } }`
export const NEED_CREATE_MUTATION = `mutation PmkitCustomerNeedCreate($input: CustomerNeedCreateInput!) { customerNeedCreate(input: $input) { success need { ${NEED_FIELDS} } } }`
export const NEED_UPDATE_MUTATION = `mutation PmkitCustomerNeedUpdate($id: String!, $input: CustomerNeedUpdateInput!) { customerNeedUpdate(id: $id, input: $input) { success need { ${NEED_FIELDS} } } }`

const PROJECT_PAGE = 25
const LOOKUP_LIMIT = 250

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const STALE_HINT = 'Linear says this workspace has no customers. Run pmkit discover to refresh the workspace flags'

/** The --limit value: 50 by default, at most 100. A larger value is clamped with a warning. */
function parseLimit(value, warnings) {
  if (value === undefined) return DEFAULT_LIMIT
  const number = Number(value)
  if (typeof value !== 'string' || !/^\d+$/.test(value) || number < 1) throw bad(`--limit takes a whole number of at least 1, got "${value === true ? '' : value}"`, 'Pass --limit 50')
  if (number > MAX_LIMIT) {
    warnings.push(`--limit ${number} is above ${MAX_LIMIT}; using ${MAX_LIMIT}`)
    return MAX_LIMIT
  }
  return number
}

/** True for the GraphQL error Linear gives a workspace without customers. */
const isNotAvailable = (error) => error instanceof PmkitError && error.code === 'UPSTREAM' && /not available/i.test(error.message)

const whyText = (reason) => (reason === 'stale' ? 'Linear reports none' : 'customers are off')

function unavailable({ reason, plan, enableHint }, warnings = []) {
  return {
    notes: [`customers are unavailable on this workspace (${whyText(reason)}); ${enableHint}`],
    data: { available: false, reason, plan, enableHint },
    text: `customers: unavailable\nreason: ${reason}\nplan: ${plan}\nenable: ${enableHint}`,
    warnings,
  }
}

function targetText(target) {
  if (!target) return 'no target'
  if (target.type === 'project') return `project "${target.name}"`
  return `issue ${target.id} "${target.title}"${target.archived ? ' (archived)' : ''}`
}

/** The plain text of one customer with its requests. */
export function customerText(customer, requests) {
  const lines = [customersText([customer]), customer.url ?? '']
  if (customer.owner) lines[1] = `owner ${customer.owner.name}  ${customer.url ?? ''}`.trim()
  if (requests.length === 0) return [...lines, 'no requests yet'].join('\n')
  const targets = requests.map((request) => targetText(request.target))
  const width = Math.max(...targets.map((text) => text.length))
  return [
    ...lines,
    'requests:',
    ...requests.map((request, index) => `  ${request.id}  ${request.important ? 'important' : 'normal   '}  ${targets[index].padEnd(width)}  ${request.body}`.trimEnd()),
  ].join('\n')
}

/** The view a customer would have after an update input, for a dry run. users are the workspace members. */
function projected(before, input, { statuses, tiers, users }) {
  const named = (list, id) => {
    const found = list.find((item) => item.id === id)
    return found ? { id: found.id, name: found.name } : null
  }
  const after = { ...before }
  if ('name' in input) after.name = input.name
  if ('statusId' in input) after.status = named(statuses, input.statusId)
  if ('tierId' in input) after.tier = input.tierId === null ? null : named(tiers, input.tierId)
  if ('revenue' in input) after.revenue = input.revenue
  if ('size' in input) after.size = input.size
  if ('ownerId' in input) after.owner = input.ownerId === null ? null : named(users, input.ownerId)
  return after
}

/** Throws NOT_SUPPORTED for a write on a workspace without customers. */
function refuseWrite({ reason, enableHint }) {
  throw new PmkitError('NOT_SUPPORTED', `customers are unavailable on this workspace (${whyText(reason)})`, enableHint)
}

const indent = (text) => text.split('\n').map((line) => `  ${line}`).join('\n')

/**
 * The customer operations of the Linear tracker. discovery is the tracker's cached discovery, client the Linear client.
 * Every method returns { data, text, warnings? }, the shape a command returns.
 */
export function createCustomers({ client, discovery }) {
  async function context() {
    const { raw, warnings } = await discovery()
    return { raw, warnings, availability: customersAvailability(raw) }
  }

  const readNames = async (document, field) => (await client.paginate(document, {}, { select: (data) => data[field], pageSize: 100, maxPages: 5 })).nodes

  /** Runs a read that needs customers. A "not available" answer means the cached flag is stale. */
  async function guarded(raw, warnings, read) {
    try {
      return await read()
    } catch (error) {
      if (!isNotAvailable(error)) throw error
      return unavailable({ reason: 'stale', plan: raw.workspace.plan, enableHint: STALE_HINT }, warnings)
    }
  }

  /** Every customer (up to LOOKUP_LIMIT) as views, for resolving a name. */
  async function lookup(warnings) {
    const found = await client.paginate(LIST_QUERY, {}, { select: (data) => data.customers, pageSize: 100, limit: LOOKUP_LIMIT })
    if (found.hasMore) warnings.push(`the workspace has more than ${LOOKUP_LIMIT} customers; only the first ${LOOKUP_LIMIT} can be matched by name. Use the id`)
    return found.nodes.map(customerView)
  }

  async function list({ status, tier, limit: limitFlag } = {}) {
    const { raw, warnings, availability } = await context()
    if (!availability.available) return unavailable(availability, warnings)
    const all = [...warnings]
    const limit = parseLimit(limitFlag, all)
    const filter = {}
    if (status !== undefined) filter.status = { id: { eq: pickByName(await readNames(STATUSES_QUERY, 'customerStatuses'), status, 'status').id } }
    if (tier !== undefined) filter.tier = { id: { eq: pickByName(await readNames(TIERS_QUERY, 'customerTiers'), tier, 'tier').id } }
    return guarded(raw, all, async () => {
      const found = await client.paginate(LIST_QUERY, Object.keys(filter).length === 0 ? {} : { filter }, { select: (data) => data.customers, pageSize: limit, limit })
      if (found.hasMore) all.push(`more customers exist than --limit ${limit} shows; the first ${limit} are listed`)
      const customers = sortCustomers(found.nodes.map(customerView))
      return { data: { available: true, customers, hasMore: found.hasMore }, text: customersText(customers), warnings: all }
    })
  }

  async function show({ customer: ref } = {}) {
    const { raw, warnings, availability } = await context()
    if (!availability.available) return unavailable(availability, warnings)
    const all = [...warnings]
    return guarded(raw, all, async () => {
      const chosen = resolveCustomer(await lookup(all), ref)
      const node = (await client.request(SHOW_QUERY, { id: chosen.id }))?.customer
      if (!node) throw new PmkitError('NOT_FOUND', `Linear no longer returns customer ${chosen.id}`, 'Run linear customers list')
      const needs = [...(node.needs?.nodes ?? [])].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
      if (node.needs?.pageInfo?.hasNextPage) all.push('the customer has more requests than the 50 shown; the newest are listed')
      const customer = customerView(node)
      const requests = needs.map(requestView)
      return { data: { available: true, customer, requests }, text: customerText(customer, requests), warnings: all }
    })
  }

  async function set({ customer: ref, dryRun = false, ...flags } = {}) {
    const { raw, warnings, availability } = await context()
    if (!availability.available) refuseWrite(availability)
    const all = [...warnings]
    try {
      const before = resolveCustomer(await lookup(all), ref)
      const statuses = await readNames(STATUSES_QUERY, 'customerStatuses')
      const tiers = await readNames(TIERS_QUERY, 'customerTiers')
      const users = raw.users.filter((user) => !user.app)
      const plan = planCustomerEdit(before, flags, statuses, tiers, users.map((user) => user.id))
      let after = before
      if (plan.changed && dryRun) {
        after = projected(before, plan.input, { statuses, tiers, users })
      } else if (plan.changed) {
        const payload = (await client.request(UPDATE_MUTATION, { id: before.id, input: plan.input })).customerUpdate
        if (payload?.success !== true || !payload.customer) throw new PmkitError('UPSTREAM', 'Linear did not apply the customer change', 'Run linear customers show to see the current values')
        after = customerView(payload.customer)
      }
      const lines = ['before:', indent(customersText([before])), 'after:', indent(customersText([after]))]
      if (dryRun) lines.push('dry run: nothing was written')
      else if (!plan.changed) lines.push('nothing to change')
      return { data: { before, after }, text: lines.join('\n'), commit: before.name, warnings: all }
    } catch (error) {
      if (isNotAvailable(error)) refuseWrite({ reason: 'stale', plan: raw.workspace.plan, enableHint: STALE_HINT })
      throw error
    }
  }

  /** The issue or project a link points at, resolved with reads. */
  async function resolveTarget(flags, warnings) {
    if (flags.issue !== undefined) {
      const key = flags.issue.toUpperCase()
      const node = (await client.request(ISSUE_QUERY, { id: key }))?.issues?.nodes?.[0]
      if (!node || node.trashed === true) throw new PmkitError('NOT_FOUND', `issue ${key} does not exist`, 'Check the key in Linear')
      return { type: 'issue', id: node.identifier, linearId: node.id, title: node.title }
    }
    const found = await client.request(PROJECTS_QUERY, { name: flags.project, first: PROJECT_PAGE })
    const nodes = found?.projects?.nodes ?? []
    if (found?.projects?.pageInfo?.hasNextPage) warnings.push(`more than ${PROJECT_PAGE} projects match "${flags.project}"; only the first ${PROJECT_PAGE} were checked`)
    const exact = nodes.filter((node) => sameName(node.name, flags.project) || node.slugId === flags.project)
    if (exact.length === 0) throw new PmkitError('NOT_FOUND', `no project is named "${flags.project}"`, 'Pass the exact project name, or its slug from the project URL')
    if (exact.length > 1) throw bad(`${exact.length} projects are named "${flags.project}"`, `Pass the slug of one of: ${exact.map((node) => `${node.name} (${node.slugId})`).join(', ')}`)
    return { type: 'project', id: exact[0].id, linearId: exact[0].id, name: exact[0].name }
  }

  async function link({ customer: ref, dryRun = false, ...flags } = {}) {
    const { raw, warnings, availability } = await context()
    if (!availability.available) refuseWrite(availability)
    checkLinkFlags(flags)
    const all = [...warnings]
    try {
      const chosen = resolveCustomer(await lookup(all), ref)
      const node = (await client.request(SHOW_QUERY, { id: chosen.id }))?.customer
      if (node?.needs?.pageInfo?.hasNextPage) all.push('the customer has more requests than the 50 read; a duplicate request beyond them is not detected')
      const requests = (node?.needs?.nodes ?? []).map(requestView)
      const target = await resolveTarget(flags, all)
      const plan = planLink({ customer: chosen, requests, flags, target })
      let id = plan.kind === 'move' ? plan.id : null
      if (!dryRun) {
        const payload =
          plan.kind === 'create'
            ? (await client.request(NEED_CREATE_MUTATION, { input: plan.input })).customerNeedCreate
            : (await client.request(NEED_UPDATE_MUTATION, { id: plan.id, input: plan.input })).customerNeedUpdate
        if (payload?.success !== true || !payload.need) throw new PmkitError('UPSTREAM', 'Linear did not apply the customer request', 'Run linear customers show to see the current requests')
        id = payload.need.id
      }
      const { linearId, ...shown } = target
      const request = { kind: plan.kind, id, from: plan.kind === 'move' ? plan.from : null }
      const lines = [`customer: ${chosen.name}`, `target: ${targetText(shown)}`, `request: ${plan.kind}${plan.kind === 'create' && flags.important ? ', important' : ''}`]
      if (plan.kind === 'move') lines.push(`from: ${targetText(plan.from)}`)
      if (dryRun) lines.push('dry run: nothing was written')
      return { data: { customer: { id: chosen.id, name: chosen.name }, target: shown, request }, text: lines.join('\n'), commit: chosen.name, warnings: all }
    } catch (error) {
      if (isNotAvailable(error)) refuseWrite({ reason: 'stale', plan: raw.workspace.plan, enableHint: STALE_HINT })
      throw error
    }
  }

  return Object.freeze({ list, show, set, link })
}
