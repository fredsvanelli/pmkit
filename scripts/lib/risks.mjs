// Pure risk radar functions: no file or host access. The CLI reads the tracker and the git host and passes the data in.
// Issues and epics carry `status.category`. Stalled means more than `stuckBusinessDays` business days without activity.

import { businessDaysBetween } from './metrics.mjs'

const OPEN = (category) => category !== 'done' && category !== 'canceled'
const WORKING = new Set(['in_progress', 'in_review'])
const NEAR_TERM = new Set(['todo', 'in_progress', 'in_review'])

/** The row base shared by blocked and stalled issues. */
function issueRow(issue) {
  return { id: issue.id, title: issue.title, status: issue.status.name, assignee: issue.assignee ?? null, estimate: issue.estimate ?? null }
}

/** Open issues in todo, in_progress or in_review, or in the active sprint, with at least one open blocker. */
export function blockedIssues(issues, { byId, problemsById, activeSprintId }) {
  const rows = []
  for (const issue of issues) {
    if (issue.archived) continue
    const category = issue.status.category
    const inSprint = activeSprintId !== null && activeSprintId !== undefined && issue.sprint === activeSprintId
    if (!NEAR_TERM.has(category) && !(OPEN(category) && inSprint)) continue
    const blockers = []
    for (const id of issue.blockedBy ?? []) {
      const blocker = byId.get(id)
      if (blocker === undefined) blockers.push({ id, error: problemsById.get(id) ?? 'NOT_FOUND' })
      else if (OPEN(blocker.status.category)) blockers.push({ id, category: blocker.status.category })
    }
    if (blockers.length > 0) rows.push({ ...issueRow(issue), blockers })
  }
  return rows
}

/** Open pull requests keyed by head branch. Of two on one branch, the one updated last wins. */
export function prsByBranch(prs) {
  const map = {}
  for (const pr of prs) {
    const current = map[pr.headRefName]
    if (current === undefined || Date.parse(pr.updatedAt) > Date.parse(current.updatedAt)) map[pr.headRefName] = pr
  }
  return map
}

/** The newest of the event times and the open pull request's update, or `issue.updated` when there is neither. */
export function lastActivity(issue, events, openPr) {
  const times = (events ?? []).map((event) => event.at)
  if (openPr?.updatedAt) times.push(openPr.updatedAt)
  if (times.length === 0) return issue.updated
  return times.reduce((newest, at) => (Date.parse(at) > Date.parse(newest) ? at : newest))
}

/** Idle in_review issues with a branch and no open pull request: the CLI asks the host whether their PR merged or closed. */
export function needsPrLookup(issues, { eventsByIssue, openPrsByBranch, today, stuckBusinessDays }) {
  return issues.filter((issue) => (
    !issue.archived &&
    issue.status.category === 'in_review' &&
    issue.branch &&
    openPrsByBranch[issue.branch] === undefined &&
    businessDaysBetween(lastActivity(issue, eventsByIssue[issue.id], undefined), today) > stuckBusinessDays
  ))
}

/** Issues in in_progress or in_review that are idle, or in_review with a merged or closed pull request. */
export function stalledIssues(issues, { eventsByIssue, openPrsByBranch, closedPrsByBranch, today, stuckBusinessDays }) {
  const rows = []
  for (const issue of issues) {
    if (issue.archived || !WORKING.has(issue.status.category)) continue
    const openPr = issue.branch ? openPrsByBranch[issue.branch] : undefined
    const at = lastActivity(issue, eventsByIssue[issue.id], openPr)
    const idle = businessDaysBetween(at, today)
    const closedPr = issue.branch && issue.status.category === 'in_review' ? closedPrsByBranch[issue.branch] : undefined
    const base = { ...issueRow(issue), lastActivity: at, idleBusinessDays: idle }
    if (closedPr !== undefined) {
      rows.push({ ...base, reason: closedPr.mergedAt ? 'pr_merged' : 'pr_closed', pr: closedPr.number })
    } else if (idle > stuckBusinessDays) {
      rows.push({ ...base, reason: 'idle', pr: openPr?.number ?? null })
    }
  }
  return rows
}
