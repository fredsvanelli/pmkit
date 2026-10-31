// Pure helpers of `issues track-agents`: which delegation record an agent issue has, and what state its pull request is in.
// The CLI reads the tracker and the git host and passes the data in.

import { parseDelegation } from './delegation.mjs'

/**
 * The delegation of an issue assigned to `assignee`, from its comments. The newest root comment (no `parent`) that
 * parseDelegation reads wins. `state` is `current` when it names the assignee, `stale` when it names another agent and
 * `none` when no comment holds a record. `incomplete` (the comment read was cut) turns a `none` into `unknown`.
 */
export function delegationOf(comments, assignee, { incomplete = false } = {}) {
  const newest = comments
    .filter((comment) => comment.parent === undefined)
    .map((comment) => ({ comment, record: parseDelegation(comment.body) }))
    .filter((item) => item.record !== null)
    .sort((a, b) => (a.comment.created < b.comment.created ? 1 : a.comment.created > b.comment.created ? -1 : a.comment.id < b.comment.id ? 1 : -1))[0]
  if (!newest) return { state: incomplete ? 'unknown' : 'none', agent: null, by: null, comment: null, at: null }
  const { record, comment } = newest
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
    unchecked: found.unchecked.map((item) => item.area),
  }
}

/** The one-line text of a row's pull request. */
export function prText(row) {
  if (row.pr === null) return ''
  if (row.pr.state === 'no_branch') return 'no branch recorded'
  if (row.pr.state === 'no_pr') return `no pull request for ${row.branch}`
  if (row.pr.state === 'unknown') return `not verified: ${row.pr.message}`
  const live = row.pr.state === 'open' || row.pr.state === 'draft'
  const blocked = row.pr.blocked === true ? `blocked: ${row.pr.blocking.join('; ')}` : row.pr.blocked === false ? 'nothing blocks it' : 'blockers not verified'
  return `#${row.pr.number} ${row.pr.state}${live ? `, ${blocked}` : ''}`
}
