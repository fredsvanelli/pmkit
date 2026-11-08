// Pure release-readiness functions: no file or host access. The CLI reads the tracker and the git host and passes the data in.

import { failingPullRequests } from './risks.mjs'

const OPEN = (category) => category !== 'done' && category !== 'canceled'

/**
 * Which release, milestone or sprint to check, and why. A selector wins. Otherwise the first rung that has something:
 * the first planned release, the milestone due first that has an open issue (undated last), the active sprint.
 * Every rung passed over is in `skipped`, so the report says why it fell back. `basis` is null when nothing is left.
 * @param {object} input
 * @param {null | {release: object} | {milestone: object} | {sprint: object}} input.selector
 * @param {object[] | null} input.releases null when the releases capability is absent, in version order
 * @param {object[]} input.milestones
 * @param {Set<string>} input.openMilestones ids of the milestones with an open issue
 * @param {object | null} input.activeSprint null when there is none or cycles are absent
 * @param {boolean} input.cyclesAbsent the tracker has no cycles, so there can be no sprint
 */
export function chooseReadinessBasis({ selector, releases, milestones, openMilestones, activeSprint, cyclesAbsent }) {
  for (const basis of ['release', 'milestone', 'sprint']) {
    if (selector?.[basis]) return { basis, reason: 'requested', source: selector[basis], skipped: [] }
  }
  const skipped = []
  const release = releases === null ? null : releases.find((r) => r.state === 'planned')
  if (release) return { basis: 'release', reason: 'next_planned', source: release, skipped }
  skipped.push({ basis: 'release', reason: releases === null ? 'releases_absent' : 'no_planned_release' })
  const due = (m) => m.due ?? '9999-12-31'
  const milestone = milestones.filter((m) => openMilestones.has(m.id)).sort((a, b) => (due(a) < due(b) ? -1 : due(a) > due(b) ? 1 : a.id < b.id ? -1 : 1))[0]
  if (milestone) return { basis: 'milestone', reason: 'earliest_due_milestone', source: milestone, skipped }
  skipped.push({ basis: 'milestone', reason: 'no_open_milestone' })
  if (activeSprint) return { basis: 'sprint', reason: 'active_sprint', source: activeSprint, skipped }
  skipped.push({ basis: 'sprint', reason: cyclesAbsent ? 'cycles_absent' : 'no_active_sprint' })
  return { basis: null, reason: null, source: null, skipped }
}

const issueRow = (issue) => ({ id: issue.id, title: issue.title, status: issue.status.name, assignee: issue.assignee ?? null, estimate: issue.estimate ?? null })

/**
 * @param {object} input
 * @param {object} input.choice from chooseReadinessBasis
 * @param {object[]} input.issues the non-archived issues of the basis
 * @param {object[] | null | {error: object}} input.prs open pull requests of the repository; null when no host, {error} when the call failed
 * @param {boolean} input.prsIncomplete the pull request list hit its limit
 * @param {object[] | null | {error: object}} input.deploys repository deployments, same convention
 * @param {object} input.gitHost
 * @param {object[]} input.problems
 * @param {boolean} [input.truncated=false] a tracker read was cut, so the basis or the open work may be incomplete
 */
export function buildReadiness({ choice, issues, prs, prsIncomplete, deploys, gitHost, problems, truncated = false }) {
  const { basis, reason, source, skipped } = choice
  const counts = { open: 0, done: 0, canceled: 0, total: issues.length }
  for (const issue of issues) {
    const category = issue.status.category
    if (OPEN(category)) counts.open += 1
    else counts[category] += 1
  }
  const byBranch = new Map(issues.filter((issue) => issue.branch).map((issue) => [issue.branch, issue.id]))
  const pullRequests = Array.isArray(prs)
    ? prs.filter((pr) => byBranch.has(pr.headRefName)).map((pr) => ({ number: pr.number, title: pr.title, url: pr.url, isDraft: pr.isDraft === true, issue: byBranch.get(pr.headRefName), checks: { total: (pr.statusCheckRollup ?? []).length, failing: failingPullRequests([pr])[0]?.failing ?? [] } })).sort((a, b) => a.number - b.number)
    : prs
  const matches = (deploy) => basis === 'release' && Boolean(source.tag) && deploy.ref === source.tag
  const deployRows = Array.isArray(deploys) ? deploys.map((deploy) => ({ ...deploy, matchesRelease: matches(deploy) })) : deploys
  const complete = problems.length === 0 && !truncated
  const openWork = counts.open + (Array.isArray(pullRequests) ? pullRequests.length : 0)
  // Open work is a fact whatever else is unread. Nothing open is only "ready" when every read finished.
  const ready = truncated ? null : openWork > 0 ? false : complete && Array.isArray(pullRequests) && !prsIncomplete ? true : null
  return { basis, reason, source, skipped, issues: { open: issues.filter((i) => OPEN(i.status.category)).map(issueRow), counts }, pullRequests, pullRequestsIncomplete: prsIncomplete, deploys: deployRows, gitHost, truncated, complete, ready, problems }
}
