// The pmkit searchIssues filter as GitHub's repository.issues filterBy, plus the steps the adapter runs on each issue after
// GitHub answers. Pure: it makes no request. See the spec's "Search: Native search (criterion 1)" and its table.

import { PmkitError } from '../errors.mjs'
import { parseIssueId } from './ids.mjs'
import { isBlockedNode } from './issues.mjs'

const TERMINAL_CATEGORIES = ['done', 'canceled']
const sameRepo = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const time = (value) => Date.parse(value)

const notSupported = (key) => new PmkitError('NOT_SUPPORTED', `the GitHub adapter does not filter by ${key} yet`, `Run the search without --${key}`)

/** The client step of a parent filter: keep the sub-issues of that issue id. */
function parentStep(parent, context) {
  const target = parseIssueId(parent, context.repo)
  if (!target) throw new PmkitError('INVALID_INPUT', `parent ${parent} is not an existing issue or epic`, 'pmkit issues list')
  return (issue, node) => node.parent?.number === target.number && sameRepo(node.parent.repository?.nameWithOwner, target.repo)
}

// One handler per filter key, in the order the client steps run. Each reads its key of the filter and adds to
// out.filterBy (GitHub's filter) and out.clientSteps; out.empty says no issue can match.
const KEY_HANDLERS = [
  function categories(filter, out) {
    if (filter.categories === undefined) return
    if (filter.categories.length === 0) out.empty = true
    if (!filter.categories.some((category) => TERMINAL_CATEGORIES.includes(category))) out.filterBy.states = ['OPEN']
    out.clientSteps.push((issue) => filter.categories.includes(issue.status.category))
  },
  function assignee(filter, out, context, viewerLogin) {
    if (filter.assignee === undefined) return
    if (filter.assignee === 'none') {
      out.clientSteps.push((issue) => issue.assignee === undefined)
      return
    }
    // GitHub matches any assignee; pmkit shows the first one, so search keeps only issues whose shown assignee matches.
    const login = filter.assignee === 'me' ? viewerLogin : filter.assignee
    out.filterBy.assignee = login
    out.clientSteps.push((issue) => issue.assignee !== undefined && issue.assignee.toLowerCase() === String(login).toLowerCase())
  },
  function types(filter, out, context) {
    if (filter.types === undefined) return
    if (context.typeLabels?.size > 0) {
      // Types are labels. GitHub's labels filter takes the one type label, unless the labels filter needs it.
      const label = filter.types.length === 1 ? context.typeLabels.get(filter.types[0]) : undefined
      if (label && !(filter.labels?.length > 0)) out.filterBy.labels = [label.name]
      else out.clientSteps.push((issue) => filter.types.includes(issue.type))
      return
    }
    if (filter.types.length === 1) out.filterBy.type = context.pmkit.mappings.types[filter.types[0]]
    else out.clientSteps.push((issue) => filter.types.includes(issue.type))
  },
  function labels(filter, out) {
    if (filter.labels === undefined || filter.labels.length === 0) return
    // GitHub's labels filter matches any label; pmkit keeps the issues that have every one.
    out.filterBy.labels = [...filter.labels]
    if (filter.labels.length === 1) return
    out.clientSteps.push((issue) => {
      const names = new Set(issue.labels.map((label) => label.toLowerCase()))
      return filter.labels.every((label) => names.has(label.toLowerCase()))
    })
  },
  function updatedAfter(filter, out) {
    if (filter.updatedAfter === undefined) return
    // since includes the instant itself, and pmkit's updatedAfter does not.
    out.filterBy.since = filter.updatedAfter
    out.clientSteps.push((issue) => time(issue.updated) > time(filter.updatedAfter))
  },
  function updatedBefore(filter, out) {
    if (filter.updatedBefore !== undefined) out.clientSteps.push((issue) => time(issue.updated) < time(filter.updatedBefore))
  },
  function text(filter, out) {
    if (filter.text === undefined) return
    const text = filter.text.toLowerCase()
    out.clientSteps.push((issue, node) => [node.title, node.body].some((value) => String(value ?? '').toLowerCase().includes(text)))
  },
  function parent(filter, out, context) {
    if (filter.parent !== undefined) out.clientSteps.push(parentStep(filter.parent, context))
  },
  function blocked(filter, out, context) {
    if (filter.blocked === undefined) return
    out.clientSteps.push((issue, node) => (node.blockedBy?.nodes ?? []).some((blocker) => isBlockedNode(blocker, context)) === filter.blocked)
  },
  function archived(filter, out, context) {
    // Without a Project no item exists, so no issue reads archived.
    if (filter.archived !== true && context.project) out.clientSteps.push((issue) => issue.archived !== true)
  },
]

/** The limit GitHub can apply: only when its order (created, oldest first) is final and no client step drops issues. */
function serverLimitOf(sort, clientSteps, limit) {
  return sort === 'created' && clientSteps.length === 0 && Number.isInteger(limit) && limit >= 1 ? limit : undefined
}

/**
 * Translates a filter that checkFilter accepted. Each client step is (issue, node) => boolean and keeps the issue when true.
 * `serverLimit` is set only when GitHub's order (created, oldest first) is the final order and no step drops issues.
 * `empty` says no issue can match, so no request is needed.
 */
export function translateFilter(filter, context, viewerLogin) {
  if (filter.sprint !== undefined && filter.sprint !== null) throw notSupported('sprint')
  if (filter.release !== undefined) throw notSupported('release')
  const out = { filterBy: {}, clientSteps: [], empty: false }
  for (const handle of KEY_HANDLERS) handle(filter, out, context, viewerLogin)
  const { filterBy, clientSteps, empty } = out
  const sort = filter.sort ?? 'created'
  return { variables: { filterBy }, clientSteps, sort, limit: filter.limit, serverLimit: serverLimitOf(sort, clientSteps, filter.limit), empty }
}
