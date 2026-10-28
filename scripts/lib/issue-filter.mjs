// The searchIssues filter every tracker accepts: its keys, its sorts, its checks and the result order.
// The Local tracker and the Linear adapter share it, so both order equal issues the same way.

import { PmkitError } from './errors.mjs'
import { CATEGORIES, compareTimes } from './model.mjs'
import { compareIds } from './ids.mjs'

export const FILTER_KEYS = [
  'text', 'categories', 'types', 'assignee', 'labels', 'sprint', 'release', 'parent', 'blocked',
  'updatedBefore', 'updatedAfter', 'archived', 'sort', 'limit',
]
export const SORTS = ['priority', 'updated', 'created', 'due']

const invalid = (message, nextStep = 'pmkit issues list --help') => new PmkitError('INVALID_INPUT', message, nextStep)
const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')

/**
 * Checks the shape of a filter and its values. `types` and `members` come from the config, and
 * `sprintExists(id)` tells whether a sprint file exists. Labels are free: an unknown one matches nothing.
 */
export function checkFilter(filter, { types = [], members = [], sprintExists = () => false } = {}) {
  if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) throw invalid('filter must be an object')
  for (const key of Object.keys(filter)) {
    if (!FILTER_KEYS.includes(key)) throw invalid(`unknown filter "${key}"`)
  }
  for (const key of ['text', 'assignee', 'release', 'parent', 'updatedBefore', 'updatedAfter']) {
    if (filter[key] !== undefined && typeof filter[key] !== 'string') throw invalid(`${key} must be a string`)
  }
  for (const key of ['categories', 'types', 'labels']) {
    if (filter[key] !== undefined && !isStringList(filter[key])) throw invalid(`${key} must be a list of strings`)
  }
  for (const key of ['blocked', 'archived']) {
    if (filter[key] !== undefined && typeof filter[key] !== 'boolean') throw invalid(`${key} must be true or false`)
  }
  if (filter.sort !== undefined && !SORTS.includes(filter.sort)) throw invalid(`sort must be one of ${SORTS.join(', ')}`)
  if (filter.limit !== undefined && !(Number.isInteger(filter.limit) && filter.limit >= 0)) throw invalid('limit must be a whole number, 0 or more')
  if (filter.sprint !== undefined && filter.sprint !== null && typeof filter.sprint !== 'string') throw invalid('sprint must be a string')

  const within = (field, values, allowed, nextStep) => {
    const unknown = values.find((value) => !allowed.includes(value))
    if (unknown !== undefined) throw invalid(`${field} "${unknown}" is not one of ${allowed.join(', ')}`, nextStep)
  }
  if (filter.categories) within('category', filter.categories, CATEGORIES)
  if (filter.types) within('type', filter.types, types, 'pmkit discover')
  if (filter.assignee !== undefined) within('assignee', [filter.assignee], ['me', 'none', ...members], 'pmkit discover')
  if (typeof filter.sprint === 'string' && !['current', 'none'].includes(filter.sprint) && !sprintExists(filter.sprint)) {
    throw invalid(`sprint "${filter.sprint}" is not current, none or an existing sprint id`, 'pmkit cycle list')
  }
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const newestFirst = (a, b) => compare(b.updated ?? '', a.updated ?? '')

// A missing value sorts after every present one.
const missingLast = (field) => (a, b) => {
  if (a[field] === undefined || b[field] === undefined) return (a[field] === undefined) - (b[field] === undefined)
  return compare(a[field], b[field])
}

/** The order of a search result for one of SORTS. Ties end on the id, so the order never depends on the read order. */
export function issueComparator(sort, priorities) {
  const rank = (issue) => {
    const index = priorities.indexOf(issue.priority)
    return index < 0 ? priorities.length : index
  }
  const by = {
    priority: (a, b) => rank(a) - rank(b) || newestFirst(a, b),
    updated: newestFirst,
    created: (a, b) => compareTimes(a.created, b.created),
    due: missingLast('due'),
  }[sort]
  return (a, b) => by(a, b) || compareIds(a.id, b.id)
}
