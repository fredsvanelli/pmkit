// What the remote adapters share when they move issues between sprints: the input check, the target of a move and the error
// of a move that stopped partway.

import { PmkitError } from './errors.mjs'
import { closedSprint } from './issue-filter.mjs'

const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)

/** The items as an English list: "a", "a and b", "a, b and c". */
export const listOf = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0])

/**
 * The error of a move that failed after others succeeded: the same code, the ids already moved in details and a next step that tells
 * the user to check the tracker (trackerName, such as Linear or GitHub) before a retry. Any other error is returned as is.
 */
export function stoppedHalfway(error, moved, trackerName) {
  if (moved.length === 0 || !(error instanceof PmkitError)) return error
  const nextStep = `${listOf(moved)} ${moved.length === 1 ? 'was' : 'were'} moved; check ${trackerName} before you retry`
  return new PmkitError(error.code, error.message, nextStep, { ...error.details, moved })
}

/** Checks the ids and the target of a move before any read. */
export function checkMoveInput(ids, to) {
  if (!Array.isArray(ids) || ids.length === 0) throw invalid('ids must be a non-empty list')
  if (to !== null && typeof to !== 'string') throw invalid('to must be a sprint id, current or null')
}

/** The sprint of `sprints` a move goes to: null for none, the active one for current, or the one with the id `to`. */
export function moveTargetIn(sprints, to) {
  if (to === null) return null
  const target = to === 'current' ? sprints.find((sprint) => sprint.state === 'active') : sprints.find((sprint) => sprint.id === to)
  if (to === 'current' && !target) throw invalid('there is no active sprint', 'pmkit cycle list')
  // The sprint is where the issues go, a value of the move: INVALID_INPUT, as in createIssue and updateIssue.
  if (!target) throw invalid(`sprint ${to} does not exist`, 'pmkit cycle list')
  // A closed sprint's velocity is fixed, so it takes no issue (PMK-166).
  if (target.state === 'closed') throw closedSprint(to)
  return target
}
