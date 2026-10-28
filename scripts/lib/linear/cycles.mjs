// A Linear cycle as a pmkit sprint. Pure: no request and no file.
// See docs/superpowers/specs/2026-10-28-pmk-37-linear-cycles-to-sprints-design.md, "Which operations are native".

import { PmkitError } from '../errors.mjs'

const CYCLE_NUMBER = /^[1-9][0-9]*$/

/** The cycle number of a pmkit sprint id, or null when the id is not a positive whole number in a string. */
export const cycleKey = (id) => (typeof id === 'string' && CYCLE_NUMBER.test(id) ? Number(id) : null)

/** The sprint state of a cycle node: active, planned (future), else closed. */
export function cycleState(node) {
  if (node.isActive === true) return 'active'
  if (node.isFuture === true) return 'planned'
  return 'closed'
}

/** The UTC date part of a Linear timestamp. Whether Linear stores midnight UTC is unverified (spec, "Risks"). */
const dateOf = (timestamp) => String(timestamp).slice(0, 10)

/**
 * The last day of a cycle. `endsAt` is an exclusive boundary (one cycle's `endsAt` is the next one's `startsAt`) and a
 * Local `end` is inclusive. `start` is the UTC date of `startsAt`, so `end` is the UTC date of `endsAt` minus one calendar
 * day, which is the day before the next cycle's `start` whatever the time of day.
 */
const lastDayOf = (endsAt) => new Date(Date.parse(dateOf(endsAt)) - 86400000).toISOString().slice(0, 10)

/** The pmkit sprint of a cycle node. `local` holds the capacity and days off kept in .pmkit/capacity.yaml. */
export function toSprint(node, local = {}) {
  const state = cycleState(node)
  return {
    id: String(node.number),
    name: node.name ?? `Cycle ${node.number}`,
    start: dateOf(node.startsAt),
    end: lastDayOf(node.endsAt),
    goal: node.description ?? '',
    state,
    ...(state === 'closed' && node.completedAt ? { closed: node.completedAt } : {}),
    capacity: local.capacity ?? {},
    daysOff: local.daysOff ?? {},
  }
}

/** The NOT_SUPPORTED answer of an operation that needs cycles, for a team that has them turned off. */
export const cyclesOff = (teamKey) =>
  new PmkitError('NOT_SUPPORTED', `team ${teamKey} has cycles turned off`, "Turn on cycles in the team's settings in Linear")
