// What the remote adapters share when they move issues between sprints: the error of a move that stopped partway.

import { PmkitError } from './errors.mjs'

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
