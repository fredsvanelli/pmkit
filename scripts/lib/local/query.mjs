// Filtering and sorting for searchIssues. Pure: the tracker resolves `me` and `current` first.

import { PmkitError } from '../errors.mjs'
import { CATEGORIES, compareTimes, isBlocked } from '../model.mjs'
import { compareIds, normalizeId } from '../ids.mjs'

export const FILTER_KEYS = [
  'text', 'categories', 'types', 'assignee', 'labels', 'sprint', 'parent', 'blocked',
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
  for (const key of ['text', 'assignee', 'parent', 'updatedBefore', 'updatedAfter']) {
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

function comparator(sort, priorities) {
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

/**
 * Filters and sorts issues, oldest created first when the filter names no sort. `all` holds every issue, archived ones included, for the blocked check.
 * `assignee` and `sprint` arrive resolved: an id or 'none'. A null `sprint` matches nothing.
 */
export function runQuery(all, filter, { priorities }) {
  const byId = new Map(all.map((issue) => [issue.id, issue]))
  const text = filter.text?.toLowerCase()
  const parent = filter.parent === undefined ? undefined : normalizeId(filter.parent)
  const keep = (issue) => {
    if (!filter.archived && issue.archived) return false
    if (text !== undefined && !`${issue.title}\n${issue.description}`.toLowerCase().includes(text)) return false
    if (filter.categories && !filter.categories.includes(issue.status.category)) return false
    if (filter.types && !filter.types.includes(issue.type)) return false
    if (filter.assignee !== undefined && (filter.assignee === 'none' ? issue.assignee !== undefined : issue.assignee !== filter.assignee)) return false
    if (filter.labels && !filter.labels.every((label) => issue.labels.includes(label))) return false
    if (filter.sprint !== undefined && (filter.sprint === 'none' ? issue.sprint !== undefined : issue.sprint !== filter.sprint)) return false
    if (parent !== undefined && issue.parent !== parent) return false
    if (filter.blocked !== undefined && isBlocked(issue, byId) !== filter.blocked) return false
    if (filter.updatedBefore !== undefined && !((issue.updated ?? '') < filter.updatedBefore)) return false
    if (filter.updatedAfter !== undefined && !((issue.updated ?? '') > filter.updatedAfter)) return false
    return true
  }
  const found = all.filter(keep).sort(comparator(filter.sort ?? 'created', priorities))
  return filter.limit === undefined ? found : found.slice(0, filter.limit)
}
