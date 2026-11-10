// Pure helpers of `issues track-agents`: which delegation record an agent issue has, and what state its pull request is in.
// The CLI reads the tracker and the git host and passes the data in.

import { parseDelegation } from './delegation.mjs'
import { PmkitError } from './errors.mjs'

/** The name `--agent` asks for: `agent:<name>` or `<name>`, lowercased. An empty one is INVALID_INPUT. */
export function agentFilter(value) {
  const name = String(value).trim().replace(/^agent:/i, '').trim().toLowerCase()
  if (name === '') throw new PmkitError('INVALID_INPUT', '--agent needs an agent name', 'Use --agent agent:<name> or --agent <name>')
  return name
}

// Bots that keep dependencies or CI in order. They open many pull requests and none of them is an agent working an issue.
const NOT_AGENTS = new Set(['dependabot', 'renovate', 'github-actions', 'snyk-bot', 'pre-commit-ci', 'allcontributors', 'greenkeeper', 'imgbot', 'codecov', 'sonarcloud', 'mergify', 'whitesource-bolt-for-github'])

/** The agent behind a pull request: its author's login without `app/` and `[bot]`, lowercased. `null` when the author is not a bot or is a dependency or CI bot. */
export function authorAgent(pr) {
  if (pr.author?.is_bot !== true || !pr.author.login) return null
  const name = pr.author.login.replace(/^app\//i, '').replace(/\[bot\]$/i, '').toLowerCase()
  return NOT_AGENTS.has(name) ? null : name
}

/**
 * The delegation of an issue assigned to `assignee`, from its comments. The newest root comment (no `parent`) that
 * parseDelegation reads wins. `state` is `current` when it names the assignee, `stale` when it names another agent and
 * `none` when no comment holds a record. `incomplete` (the comment read was cut) turns a `none` into `unknown`. Without an
 * `assignee` to compare (a Linear issue with no delegate) a record is `unknown`: it cannot be told current from stale.
 */
export function delegationOf(comments, assignee, { incomplete = false } = {}) {
  const newest = comments
    .filter((comment) => comment.parent === undefined)
    .map((comment) => ({ comment, record: parseDelegation(comment.body) }))
    .filter((item) => item.record !== null)
    .sort((a, b) => (a.comment.created < b.comment.created ? 1 : a.comment.created > b.comment.created ? -1 : a.comment.id < b.comment.id ? 1 : -1))[0]
  if (!newest) return { state: incomplete ? 'unknown' : 'none', agent: null, by: null, comment: null, at: null }
  const { record, comment } = newest
  if (assignee === null || assignee === undefined) return { state: 'unknown', agent: record.agent, by: record.by, comment: comment.id, at: comment.created }
  return { state: record.agent === assignee ? 'current' : 'stale', agent: record.agent, by: record.by, comment: comment.id, at: comment.created }
}

/**
 * The pull request part of a row. `pr` is the host's pull request, `found` is collectBlockers output for it.
 * `state` is `draft`, `open`, `merged` or `closed`. `blocked` is true, false or null (unknown).
 */
export function prSummary(pr, found) {
  const state = pr.state === 'OPEN' ? (pr.isDraft === true ? 'draft' : 'open') : pr.state === 'MERGED' || pr.mergedAt ? 'merged' : 'closed'
  return {
    state, number: pr.number, url: pr.url, blocked: found.blocked,
    blocking: found.blocking.map((item) => item.message),
    unknown: found.unknown.map((item) => item.message),
    // Two refused reads of one area (protection and rules are both `policies`) name it once.
    unchecked: [...new Set(found.unchecked.map((item) => item.area))],
  }
}

/** The one-line text of a row's pull request. */
export function prText(row) {
  if (row.pr === null) return ''
  if (row.pr.state === 'no_branch') return 'no branch recorded'
  if (row.pr.state === 'no_pr') return `no pull request for ${row.branch}`
  if (row.pr.state === 'unknown') return `not verified: ${row.pr.message}`
  const live = row.pr.state === 'open' || row.pr.state === 'draft'
  return `#${row.pr.number} ${row.pr.state}${live ? `, ${blockedText(row.pr)}` : ''}`
}

/** The verdict of a prSummary as text. `null` is never "nothing blocks it", and what was not verified stays in the text. */
export function blockedText(summary) {
  const missing = [...(summary.unknown ?? []), ...(summary.unchecked ?? [])].join('; ')
  if (summary.blocked === true) return `blocked: ${summary.blocking.join('; ')}${missing ? `; not verified: ${missing}` : ''}`
  return summary.blocked === false ? 'nothing blocks it' : `blockers not verified${missing ? `: ${missing}` : ''}`
}
