// Pure risk radar functions: no file or host access. The CLI reads the tracker and the git host and passes the data in.
// Issues and epics carry `status.category`. Stalled means more than `stuckBusinessDays` business days without activity.

import { table } from './format.mjs'
import { businessDaysBetween, dayNumber } from './metrics.mjs'

const OPEN = (category) => category !== 'done' && category !== 'canceled'
const WORKING = new Set(['in_progress', 'in_review'])
const NEAR_TERM = new Set(['todo', 'in_progress', 'in_review'])

/** Whole UTC calendar days from the date part of `date` to `today`. */
const daysSince = (date, today) => dayNumber(today) - dayNumber(date)

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
  const map = Object.create(null)
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

/** Open pull requests, drafts included, with no update for more than N business days, by number. */
export function stalledPullRequests(prs, { issuesByBranch, today, stuckBusinessDays }) {
  return prs
    .map((pr) => ({
      number: pr.number, title: pr.title, url: pr.url, branch: pr.headRefName, isDraft: pr.isDraft, updatedAt: pr.updatedAt,
      idleBusinessDays: businessDaysBetween(pr.updatedAt, today), issue: issuesByBranch[pr.headRefName] ?? null,
    }))
    .filter((row) => row.idleBusinessDays > stuckBusinessDays)
    .sort((a, b) => a.number - b.number)
}

/** Open epics that are late, have an at_risk or off_track update, or are due a status update. `updatesByEpic` lists newest first. */
export function epicRisks(epics, { updatesByEpic, today, windowDays }) {
  const rows = []
  for (const epic of epics) {
    const category = epic.status.category
    if (!OPEN(category)) continue
    const latest = (updatesByEpic[epic.id] ?? [])[0]
    const startedWithinWindow = Boolean(epic.start) && daysSince(epic.start, today) <= windowDays
    const checked = category === 'in_progress' || (Boolean(epic.start) && !startedWithinWindow)
    const reasons = []
    if (epic.target && epic.target < today) reasons.push('late')
    if (latest?.health === 'at_risk' || latest?.health === 'off_track') reasons.push(latest.health)
    if (checked && (latest ? daysSince(latest.at, today) > windowDays : !startedWithinWindow)) reasons.push('no_recent_update')
    if (reasons.length === 0) continue
    rows.push({
      id: epic.id, title: epic.title, status: epic.status.name, target: epic.target ?? null,
      lastUpdate: latest ? { at: latest.at, health: latest.health } : null, reasons,
    })
  }
  return rows
}

const FAILED_RUN = new Set(['failure', 'timed_out', 'startup_failure'])
const FAILED_CHECK = new Set(['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED'])
const FAILED_STATUS = new Set(['FAILURE', 'ERROR'])

/** The newest completed run of each workflow, and those whose conclusion is a failure, by workflow name. */
export function failingWorkflows(runs) {
  const newest = new Map()
  for (const run of runs) {
    if (run.status !== 'completed') continue
    const current = newest.get(run.workflowName)
    if (current === undefined || Date.parse(run.createdAt) > Date.parse(current.createdAt)) newest.set(run.workflowName, run)
  }
  const failing = [...newest.values()]
    .filter((run) => FAILED_RUN.has(run.conclusion))
    .map((run) => ({ workflow: run.workflowName, conclusion: run.conclusion, url: run.url, createdAt: run.createdAt, headSha: run.headSha }))
    .sort((a, b) => (a.workflow < b.workflow ? -1 : a.workflow > b.workflow ? 1 : 0))
  return { workflows: newest.size, failing }
}

/** Open pull requests with at least one failing check run or status context, by number. */
export function failingPullRequests(prs) {
  const rows = []
  for (const pr of prs) {
    const failing = []
    for (const entry of pr.statusCheckRollup ?? []) {
      const isStatus = 'context' in entry
      const failed = isStatus ? FAILED_STATUS.has(entry.state) : FAILED_CHECK.has(entry.conclusion)
      const name = isStatus ? entry.context : entry.name
      if (failed && !failing.includes(name)) failing.push(name)
    }
    if (failing.length > 0) rows.push({ number: pr.number, title: pr.title, url: pr.url, failing })
  }
  return rows.sort((a, b) => a.number - b.number)
}

/** The consequence of having no usable git host, shared by the text head and the CLI warning. */
export const NO_HOST = 'so issues are stalled by tracker activity only and pull requests and CI are not checked'

function hostLine(gitHost) {
  if (gitHost.available) return `git host: ${gitHost.system}`
  if (gitHost.system === 'none') return `git host: none, ${NO_HOST}`
  return `git host: ${gitHost.system} is not available (${gitHost.reason.message}), ${NO_HOST}`
}

/** One section: the title, then a table with a count, `none`, or `not checked: <reason>` for a null value or an error. */
function section(title, value, { notChecked, header, row, empty = 'none', after = () => [] }) {
  if (value === null || value === undefined) return `${title}\nnot checked: ${notChecked}`
  if (!Array.isArray(value)) return `${title}\nnot checked: ${value.error.message}`
  if (value.length === 0) return `${title}\n${empty}`
  return [`${title} (${value.length})`, table(header, value.map(row)), ...after(value)].join('\n')
}

const prRef = (number) => (number === null || number === undefined ? '' : `#${number}`)
const issueCells = (row) => [row.id, row.title, row.status, row.assignee ?? '', row.estimate ?? '']
const ISSUE_HEADER = ['ID', 'Title', 'Status', 'Assignee', 'Estimate']

/** The text report of the risks command: a two-line head and six sections, joined by blank lines. */
export function risksText(report) {
  const { thresholds, gitHost, ci } = report
  const notChecked = gitHost.reason?.message ?? ''
  const head = [
    `risks on ${report.today}: stalled after ${thresholds.stuckBusinessDays} business days without activity, status updates due every ${thresholds.statusUpdateWindowDays} days`,
    hostLine(gitHost),
  ].join('\n')
  const defaultBranch = ci?.defaultBranch ?? null
  const branchName = defaultBranch?.branch ?? 'default branch'
  const blocks = [
    head,
    section('blocked issues', report.blocked, {
      header: [...ISSUE_HEADER, 'Blocked by'],
      row: (row) => [...issueCells(row), row.blockers.map((blocker) => `${blocker.id} (${blocker.category ?? blocker.error})`).join(', ')],
    }),
    section('stalled issues', report.stalledIssues, {
      header: [...ISSUE_HEADER, 'Idle days', 'Reason', 'PR'],
      row: (row) => [...issueCells(row), row.idleBusinessDays, row.reason, prRef(row.pr)],
      after: (rows) => (rows.some((row) => row.reason === 'pr_merged') ? ['pr_merged: the pull request is merged; pmkit pr sync moves the issue to done'] : []),
    }),
    section('stalled pull requests', report.stalledPullRequests, {
      notChecked,
      header: ['PR', 'Title', 'Branch', 'Draft', 'Idle days', 'Issue'],
      row: (row) => [prRef(row.number), row.title, row.branch, row.isDraft ? 'yes' : '', row.idleBusinessDays, row.issue ?? ''],
    }),
    section('epics at risk', report.epics, {
      header: ['ID', 'Title', 'Status', 'Target', 'Last update', 'Reasons'],
      row: (row) => [
        row.id, row.title, row.status, row.target ?? '',
        row.lastUpdate ? `${row.lastUpdate.at.slice(0, 10)} ${row.lastUpdate.health}` : 'none', row.reasons.join(', '),
      ],
    }),
    section(`failing CI on ${branchName}`, defaultBranch === null ? null : defaultBranch.error ? defaultBranch : defaultBranch.failing, {
      notChecked,
      empty: defaultBranch?.workflows === 0 ? `none, no workflow runs on ${branchName}` : 'none',
      header: ['Workflow', 'Conclusion', 'Created', 'URL'],
      row: (row) => [row.workflow, row.conclusion, row.createdAt, row.url],
    }),
    section('pull requests with failing checks', ci === null ? null : ci.pullRequests, {
      notChecked,
      header: ['PR', 'Title', 'Failing checks', 'URL'],
      row: (row) => [prRef(row.number), row.title, row.failing.join(', '), row.url],
    }),
  ]
  return blocks.join('\n\n')
}
