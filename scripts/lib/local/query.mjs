// Filtering and sorting for searchIssues. Pure: the tracker resolves `me` and `current` first.

import { isBlocked } from '../model.mjs'
import { normalizeId } from '../ids.mjs'
import { issueComparator } from '../issue-filter.mjs'

export { FILTER_KEYS, SORTS, checkFilter } from '../issue-filter.mjs'

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
    if (filter.release !== undefined && issue.release !== filter.release) return false
    if (parent !== undefined && issue.parent !== parent) return false
    if (filter.blocked !== undefined && isBlocked(issue, byId) !== filter.blocked) return false
    if (filter.updatedBefore !== undefined && !((issue.updated ?? '') < filter.updatedBefore)) return false
    if (filter.updatedAfter !== undefined && !((issue.updated ?? '') > filter.updatedAfter)) return false
    return true
  }
  const found = all.filter(keep).sort(issueComparator(filter.sort ?? 'created', priorities))
  return filter.limit === undefined ? found : found.slice(0, filter.limit)
}
