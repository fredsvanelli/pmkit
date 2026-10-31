// Pure team capacity functions: no file or tracker access. `team capacity` in pmkit.mjs reads the tracker and passes the data in.
// Names and units follow team-load.mjs: capacity is a number in the estimate unit, days off are YYYY-MM-DD dates.

import { PmkitError } from './errors.mjs'
import { AGENT_ID } from './delegation.mjs'

const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
const dayMs = 24 * 60 * 60 * 1000

/** The capacity pairs of `--set` as { member: number | null }. `none` gives null, which removes the member's capacity. */
export function parseCapacityPairs(pairs) {
  const map = {}
  for (const pair of pairs) {
    const match = /^([^=]+)=(none|\d+(?:\.\d+)?)$/.exec(pair)
    if (!match) throw invalid(`--set takes member=number pairs, got "${pair}"`, 'Use --set fred=8,ana=10, or member=none to remove a capacity')
    if (Object.hasOwn(map, match[1])) throw invalid(`--set names ${match[1]} twice`, 'Name each member once')
    map[match[1]] = match[2] === 'none' ? null : Number(match[2])
  }
  return map
}

/** The weekdays from `sprint.start` to `sprint.end`, both included, minus the days off. */
export function workingDays(sprint, daysOff = []) {
  let days = 0
  for (let at = Date.parse(`${sprint.start}T00:00:00Z`); at <= Date.parse(`${sprint.end}T00:00:00Z`); at += dayMs) {
    const weekday = new Date(at).getUTCDay()
    if (weekday !== 0 && weekday !== 6) days++
  }
  return days - daysOff.length
}

/** The capacity map after the pairs: a number sets the member, null removes it. */
export function mergeCapacity(current, set) {
  const merged = { ...current }
  for (const [member, amount] of Object.entries(set)) {
    if (amount === null) delete merged[member]
    else merged[member] = amount
  }
  return merged
}

/** Refuses a name that is an agent or not one of the human members of the scope. `humans` are the member ids. */
export function checkMembers(names, humans) {
  for (const name of names) {
    if (AGENT_ID.test(name)) throw invalid(`${name} is an agent, and agents have no capacity`, '/pmkit:issues:delegate hands an issue to an agent')
    if (!humans.includes(name)) throw invalid(`${name} is not a member of this team`, `Use one of: ${humans.join(', ')}`)
  }
}

/** One entry per member whose capacity or days off differ between `before` and `after`. Unset capacity is null. */
export function changeList(before, after, members) {
  const entries = members.map((member) => ({
    member,
    capacity: { before: before.capacity[member] ?? null, after: after.capacity[member] ?? null },
    daysOff: { before: before.daysOff[member] ?? [], after: after.daysOff[member] ?? [] },
  }))
  return entries.filter((entry) => entry.capacity.before !== entry.capacity.after || entry.daysOff.before.join() !== entry.daysOff.after.join())
}
