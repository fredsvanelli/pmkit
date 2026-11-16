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

/**
 * Translates a filter that checkFilter accepted. Each client step is (issue, node) => boolean and keeps the issue when true.
 * `serverLimit` is set only when GitHub's order (created, oldest first) is the final order and no step drops issues.
 * `empty` says no issue can match, so no request is needed.
 */
export function translateFilter(filter, context, viewerLogin) {
  if (filter.sprint !== undefined && filter.sprint !== null) throw notSupported('sprint')
  if (filter.release !== undefined) throw notSupported('release')
  const filterBy = {}
  const clientSteps = []
  let empty = false

  if (filter.categories !== undefined) {
    if (filter.categories.length === 0) empty = true
    if (!filter.categories.some((category) => TERMINAL_CATEGORIES.includes(category))) filterBy.states = ['OPEN']
    clientSteps.push((issue) => filter.categories.includes(issue.status.category))
  }
  if (filter.assignee === 'none') clientSteps.push((issue) => issue.assignee === undefined)
  else if (filter.assignee !== undefined) {
    // GitHub matches any assignee; pmkit shows the first one, so search keeps only issues whose shown assignee matches.
    const login = filter.assignee === 'me' ? viewerLogin : filter.assignee
    filterBy.assignee = login
    clientSteps.push((issue) => issue.assignee !== undefined && issue.assignee.toLowerCase() === String(login).toLowerCase())
  }
  if (filter.types !== undefined) {
    if (filter.types.length === 1) filterBy.type = context.pmkit.mappings.types[filter.types[0]]
    else clientSteps.push((issue) => filter.types.includes(issue.type))
  }
  if (filter.labels !== undefined && filter.labels.length > 0) {
    // GitHub's labels filter matches any label; pmkit keeps the issues that have every one.
    filterBy.labels = [...filter.labels]
    if (filter.labels.length > 1) {
      clientSteps.push((issue) => {
        const names = new Set(issue.labels.map((label) => label.toLowerCase()))
        return filter.labels.every((label) => names.has(label.toLowerCase()))
      })
    }
  }
  if (filter.updatedAfter !== undefined) {
    // since includes the instant itself, and pmkit's updatedAfter does not.
    filterBy.since = filter.updatedAfter
    clientSteps.push((issue) => time(issue.updated) > time(filter.updatedAfter))
  }
  if (filter.updatedBefore !== undefined) clientSteps.push((issue) => time(issue.updated) < time(filter.updatedBefore))
  if (filter.text !== undefined) {
    const text = filter.text.toLowerCase()
    clientSteps.push((issue, node) => [node.title, node.body].some((value) => String(value ?? '').toLowerCase().includes(text)))
  }
  if (filter.parent !== undefined) clientSteps.push(parentStep(filter.parent, context))
  if (filter.blocked !== undefined) {
    clientSteps.push((issue, node) => (node.blockedBy?.nodes ?? []).some((blocker) => isBlockedNode(blocker, context)) === filter.blocked)
  }
  // Without a Project no item exists, so no issue reads archived.
  if (filter.archived !== true && context.project) clientSteps.push((issue) => issue.archived !== true)

  const sort = filter.sort ?? 'created'
  const serverLimit = sort === 'created' && clientSteps.length === 0 && Number.isInteger(filter.limit) && filter.limit >= 1 ? filter.limit : undefined
  return { variables: { filterBy }, clientSteps, sort, limit: filter.limit, serverLimit, empty }
}
