// Reads the tracker through contract operations and returns the plain data the views in render.mjs take.
// Every string stays raw tracker text; only the writers escape. Members show by name, never by email.

import { CATEGORIES, TERMINAL, compareTimes } from './model.mjs'

const OPEN = CATEGORIES.filter((category) => !TERMINAL.includes(category))

/**
 * One read of every issue, archived ones included, so an archived blocker is found and not counted missing.
 * `live` drops archived issues. `asOf` is the newest `updated` of `live`, or null when there is none.
 */
export function readTracker(tracker) {
  const found = tracker.searchIssues({ archived: true })
  const live = found.issues.filter((issue) => !issue.archived)
  const byId = new Map(found.issues.map((issue) => [issue.id, issue]))
  const asOf = live.reduce((newest, issue) => (newest === null || compareTimes(issue.updated, newest) > 0 ? issue.updated : newest), null)
  const problems = found.problems.map(({ id, code, message }) => ({ id, code, message }))
  return { live, byId, problems, asOf }
}

/** The row an issue table shows. `members` is `local.members`, in config order. */
export function issueRow(issue, byId, members) {
  const assignee = issue.assignee === undefined || issue.assignee === null ? '' : members[issue.assignee]?.name ?? issue.assignee
  const blockedBy = (issue.blockedBy ?? []).filter((id) => {
    const blocker = byId.get(id)
    return !blocker || !TERMINAL.includes(blocker.status.category)
  })
  return {
    id: issue.id,
    title: issue.title,
    type: issue.type ?? '',
    priority: issue.priority ?? '',
    assignee,
    estimate: issue.estimate ?? null,
    blockedBy,
    labels: issue.labels ?? [],
  }
}

const base = (read, local) => ({ asOf: read.asOf, problems: read.problems, unit: local.estimate.unit })

/** The open statuses in category order, then config order. */
function openStatuses(local) {
  const rank = (name) => CATEGORIES.indexOf(local.statuses[name].category)
  return Object.keys(local.statuses)
    .filter((name) => OPEN.includes(local.statuses[name].category))
    .map((name, index) => ({ name, index }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.index - b.index)
    .map((entry) => entry.name)
}

export function boardData(tracker, local) {
  const read = readTracker(tracker)
  const members = local.members ?? {}
  const count = (category) => read.live.filter((issue) => issue.status.category === category).length
  return {
    ...base(read, local),
    statuses: openStatuses(local).map((name) => ({
      name,
      issues: read.live.filter((issue) => issue.status.name === name).map((issue) => issueRow(issue, read.byId, members)),
    })),
    done: count('done'),
    canceled: count('canceled'),
  }
}
