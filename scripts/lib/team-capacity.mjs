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

/** The weekdays from `sprint.start` to `sprint.end`, both included, minus the distinct days off that are weekdays inside the sprint. Other dates (a hand edit of the file) do not count. */
export function workingDays(sprint, daysOff = []) {
  const off = new Set(daysOff)
  let days = 0
  for (let at = Date.parse(`${sprint.start}T00:00:00Z`); at <= Date.parse(`${sprint.end}T00:00:00Z`); at += dayMs) {
    const date = new Date(at)
    const weekday = date.getUTCDay()
    if (weekday !== 0 && weekday !== 6 && !off.has(date.toISOString().slice(0, 10))) days++
  }
  return days
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

/** The days-off map after the pairs of `--days-off`: a list sets the member, null clears it. */
export function mergeDaysOff(current, off) {
  const merged = { ...current }
  for (const [member, dates] of Object.entries(off)) {
    if (dates === null) delete merged[member]
    else merged[member] = dates
  }
  return merged
}

const MICRO = 1e6
const isBase = (entry) => entry !== null && typeof entry === 'object' && Number.isFinite(entry.capacity) && entry.capacity >= 0 && Number.isInteger(entry.workingDays) && entry.workingDays > 0

/** The capacity a base gives for `days` working days. At the base's own working days it is the base itself, so it goes back exactly. */
const scaleTo = (base, days) => (days === base.workingDays ? base.capacity : Math.round((base.capacity * days * MICRO) / base.workingDays) / MICRO)

/**
 * The capacity changes a days-off change gives. The formula of `/pmkit:cycle:plan` is linear in the working days: capacity x new working
 * days / old working days. Every value is derived from a base, `{ capacity, workingDays }`, the capacity the user gave and the working days
 * it was for, never from the previous scaled value, so errors do not add up and the same days off and back give the number the user wrote.
 * A member with a base that still gives the stored capacity keeps that base. Any other member gets one from the stored capacity and the old
 * working days. When the days return to the base's working days the base is dropped (`null` in `basePatch`).
 * `patch` and `basePatch` hold only the members that change, for `capacityPatch` and `capacityBasePatch`. A member with no capacity stays
 * unset, and one with no working days and no base to scale from is kept and listed in `skipped`. `beforeOff` and `afterOff` are full maps.
 */
export function recomputeCapacity(sprint, capacity, base, beforeOff, afterOff, set) {
  const patch = {}
  const basePatch = {}
  const recomputed = []
  const skipped = []
  for (const member of new Set([...Object.keys(beforeOff), ...Object.keys(afterOff)])) {
    if (Object.hasOwn(set, member) || typeof capacity[member] !== 'number') continue
    const [before, after] = [workingDays(sprint, beforeOff[member] ?? []), workingDays(sprint, afterOff[member] ?? [])]
    if (before === after) continue
    const kept = isBase(base[member]) && scaleTo(base[member], before) === capacity[member] ? base[member] : null
    const ref = kept ?? (before > 0 ? { capacity: capacity[member], workingDays: before } : null)
    if (ref === null) {
      skipped.push(member)
      continue
    }
    patch[member] = scaleTo(ref, after)
    if (kept === null) basePatch[member] = ref
    else if (after === ref.workingDays) basePatch[member] = null
    recomputed.push({ member, workingDays: { before, after }, capacity: { before: capacity[member], after: patch[member] } })
  }
  return { patch, basePatch, recomputed, skipped }
}

/** The members of the scope team. With no team configured, or a member with no team list (Local), every member counts. */
export const teamMembers = (members, teamKey) => (teamKey === undefined || teamKey === null ? members : members.filter((member) => member.teams === undefined || member.teams.includes(teamKey)))
