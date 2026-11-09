// Pure team load functions: no file or tracker access. The CLI reads the tracker and passes the data in.
// `issues` are the open issues in scope (todo, in_progress, in_review) as searchIssues returns them.
// PMK-72 (team-capacity) reuses teamLoad and chooseUnit.

import { AGENT_ID } from './delegation.mjs'

/** A human member is over average above this multiple of the average load. */
export const OVER_AVERAGE = 1.5

const WORKING = new Set(['in_progress', 'in_review'])
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const round = (value) => Math.round(value * 100) / 100

/**
 * The unit of the load and, when it is `issues`, the reason to say in a note. `estimation` is the manifest entry of the
 * `estimation` capability. The unit is the estimate unit of the tracker (`points` or `hours`) when it adds up.
 */
export function chooseUnit(issues, estimation) {
  if (estimation?.path === 'absent') return { unit: 'issues', reason: 'estimates are off' }
  if (estimation?.detail?.unit === 'sizes') return { unit: 'issues', reason: 'estimates are sizes and do not add up' }
  // A size (t-shirt team) or a mix of sizes and numbers (teams that differ, on Linear) does not add up.
  const sized = issues.some((issue) => issue.estimate !== null && issue.estimate !== undefined && !isNumber(issue.estimate))
  if (sized) return { unit: 'issues', reason: 'estimates are sizes or mix scales and do not add up' }
  if (!issues.some((issue) => isNumber(issue.estimate))) return { unit: 'issues', reason: 'no issue in scope has an estimate' }
  return { unit: estimation?.detail?.unit === 'hours' ? 'hours' : 'points', reason: null }
}

function emptyRow(member, name, extra = {}) {
  return { member, name, agent: AGENT_ID.test(member), isMember: true, issues: 0, estimate: 0, unestimated: 0, wip: 0, oldestWipDays: null, load: 0, unknown: false, partial: false, ids: [], flags: [], ...extra }
}

/** The human members that count: not an agent, in the member list, and not at availability 0. */
const isEligible = (row) => !row.agent && row.isMember && row.availability !== 0

/** The mean load of the eligible members whose load is known, and how many they are. Unrounded. */
function averageOf(rows) {
  const known = rows.filter((row) => isEligible(row) && row.load !== null)
  const sum = known.reduce((total, row) => total + row.load, 0)
  return { known, sum, mean: known.length === 0 ? 0 : sum / known.length }
}

/**
 * The load per member. Rows come in member order, then members not in the list (a user that left), in order of appearance.
 * Agents and non-members have a row but stay out of the average, `noWork` and the flags. Unassigned issues form their own entry.
 * `unit` is `issues`, `points` or `hours`. With an estimate unit, a member whose open issues all lack an estimate has an
 * unknown load (`load: null`): out of the average and the flags, never a target, and not in `noWork`, which counts issues.
 * A member with some issues unestimated has a partial load (`partial: true`): the sum is a lower bound, so the member is never a target.
 * `aging` is aging() output, `capacity` and `daysOff` are maps by member for the sprint in scope.
 */
export function teamLoad(issues, { members, aging = [], capacity = {}, daysOff = {}, unit }) {
  const estimated = unit !== 'issues'
  const rows = members.map((member) => emptyRow(member.id, member.name ?? member.id, { availability: member.availability }))
  const byMember = new Map(rows.map((row) => [row.member, row]))
  const unassigned = { issues: 0, estimate: 0, unestimated: 0, ids: [] }
  const days = new Map(aging.map((item) => [item.issue, item.days]))
  for (const issue of issues) {
    let target = unassigned
    if (issue.assignee) {
      if (!byMember.has(issue.assignee)) {
        const row = emptyRow(issue.assignee, issue.assignee, { isMember: false })
        rows.push(row)
        byMember.set(issue.assignee, row)
      }
      target = byMember.get(issue.assignee)
    }
    target.issues++
    target.ids.push(issue.id)
    if (isNumber(issue.estimate)) target.estimate += issue.estimate
    else target.unestimated++
    if (target !== unassigned && WORKING.has(issue.status.category)) {
      target.wip++
      const age = days.get(issue.id)
      if (age !== undefined && (target.oldestWipDays === null || age > target.oldestWipDays)) target.oldestWipDays = age
    }
  }
  for (const row of rows) {
    row.unknown = estimated && row.issues > 0 && row.unestimated === row.issues
    row.partial = estimated && !row.unknown && row.unestimated > 0
    row.load = !estimated ? row.issues : row.unknown ? null : row.estimate
    row.capacity = isNumber(capacity[row.member]) ? capacity[row.member] : null
    row.daysOff = [daysOff[row.member] ?? []].flat()
  }

  const { known, sum, mean } = averageOf(rows)
  const imbalances = []
  for (const row of rows.filter(isEligible)) {
    // load > 1.5 * mean, written with the sum so no rounded mean decides it.
    if (known.length >= 2 && sum > 0 && row.load !== null && row.load * known.length > OVER_AVERAGE * sum) {
      imbalances.push({ member: row.member, flag: 'over_average', load: row.load, limit: round(mean * OVER_AVERAGE) })
    }
    if (estimated && row.capacity !== null && row.estimate > row.capacity) imbalances.push({ member: row.member, flag: 'over_capacity', load: row.estimate, limit: row.capacity })
  }
  // A human member with availability 0 stays out of the average and the targets, but open work on them is flagged.
  for (const row of rows) {
    if (!row.agent && row.isMember && row.availability === 0 && row.issues > 0) imbalances.push({ member: row.member, flag: 'no_availability', load: row.load, limit: 0 })
  }
  for (const item of imbalances) byMember.get(item.member).flags.push(item.flag)
  const noWork = rows.filter((row) => isEligible(row) && row.issues === 0).map((row) => ({ member: row.member, name: row.name, daysOff: row.daysOff }))
  const unknownLoad = rows.filter((row) => !row.agent && row.isMember && row.unknown).map((row) => row.member)
  return { unit, average: round(mean), rows, unassigned, noWork, unknownLoad, imbalances }
}

/**
 * A proposal that moves the issues in `todo` of the flagged members to the human with the lowest known load, largest first.
 * A source stops giving at the average (over_average) or at its capacity (over_capacity). A move happens only when the
 * target stays at or below the source after it, does not pass the overload limit (1.5 times the average, the same sum as
 * over_average in teamLoad), and stays at or below its own capacity. A member the report flags, or whose load is unknown
 * or partial, is never a target. It writes nothing.
 * Returns the moves and, when a flagged member exists and no move is proposed, the reason: `no_candidates` (no issue in
 * `todo`), `unestimated` (the issues in `todo` have no estimate, so a move cannot be sized), `zero_estimate` (the estimates
 * are 0, so a move changes nothing), `would_not_improve` (a target passes the limits, but would end above the source) or `no_target`.
 * A member with availability 0 gives all its `todo` work away to a member with availability, with no overload or "ends at or below"
 * rule; an issue it holds with no estimate or an estimate of 0 moves too, marked `unsized: 'unestimated' | 'zero_estimate'`.
 */
export function proposeMoves(report, issues) {
  const estimated = report.unit !== 'issues'
  const { known, sum, mean } = averageOf(report.rows)
  const loads = new Map(report.rows.map((row) => [row.member, row.load]))
  const capacityOf = new Map(report.rows.map((row) => [row.member, row.capacity]))
  const targets = report.rows.filter((row) => isEligible(row) && row.load !== null && !row.partial && row.flags.length === 0)
  const weight = (issue) => (estimated ? (isNumber(issue.estimate) ? issue.estimate : 0) : 1)
  const flagged = [...new Set(report.imbalances.map((item) => item.member))]
  const moves = []
  let anyTodo = false
  let anyWeighted = false
  let anyUnestimated = false
  let anyBalanceOnly = false
  let anyStuck = false
  for (const from of flagged) {
    const own = report.imbalances.filter((item) => item.member === from)
    // A member with no availability gives all its todo work to anyone who has availability: the overload and "ends above the source" rules do not apply.
    const idle = own.some((item) => item.flag === 'no_availability')
    const stopAt = Math.min(...own.map((item) => (item.flag === 'over_capacity' ? capacityOf.get(from) : item.flag === 'no_availability' ? 0 : mean)))
    const todo = issues.filter((issue) => issue.assignee === from && issue.status.category === 'todo')
    anyTodo ||= todo.length > 0
    anyUnestimated ||= estimated && todo.some((issue) => !isNumber(issue.estimate))
    // Work of an idle member always moves, even when its weight is unknown (no estimate) or 0: the move says why it cannot be sized.
    const candidates = todo
      .filter((issue) => idle || weight(issue) > 0)
      .sort((a, b) => weight(b) - weight(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    anyWeighted ||= candidates.length > 0
    for (const issue of candidates) {
      if (!idle && loads.get(from) <= stopAt) break
      const w = weight(issue)
      const allowed = targets
        .filter((row) => row.member !== from)
        // The same comparison as over_average: load * count > 1.5 * sum, so a target never ends up flagged.
        .filter((row) => idle || (loads.get(row.member) + w) * known.length <= OVER_AVERAGE * sum)
        .filter((row) => !estimated || capacityOf.get(row.member) === null || loads.get(row.member) + w <= capacityOf.get(row.member))
      const to = allowed
        .filter((row) => idle || loads.get(row.member) + w <= loads.get(from) - w)
        .sort((a, b) => loads.get(a.member) - loads.get(b.member))[0]
      if (to === undefined) {
        if (idle) anyStuck = true
        else anyBalanceOnly ||= allowed.length > 0
        continue
      }
      if (loads.get(from) !== null) loads.set(from, loads.get(from) - w)
      loads.set(to.member, loads.get(to.member) + w)
      const unsized = estimated && w === 0 ? (isNumber(issue.estimate) ? 'zero_estimate' : 'unestimated') : undefined
      moves.push({ issue: issue.id, from, to: to.member, ...(unsized ? { unsized } : {}) })
    }
  }
  if (moves.length > 0 || flagged.length === 0) return { moves, reason: null }
  if (!anyTodo) return { moves, reason: 'no_candidates' }
  if (!anyWeighted) return { moves, reason: anyUnestimated ? 'unestimated' : 'zero_estimate' }
  return { moves, reason: anyBalanceOnly && !anyStuck ? 'would_not_improve' : 'no_target' }
}

/** The moves of proposeMoves. */
export const suggestMoves = (report, issues) => proposeMoves(report, issues).moves

/** The sentence for each reason proposeMoves gives when it proposes nothing. */
export const NO_MOVE_MESSAGES = {
  no_candidates: 'the overloaded members have no issue in todo to move',
  unestimated: 'the issues in todo that could move have no estimate, so a move cannot be sized',
  zero_estimate: 'the issues in todo that could move have an estimate of 0, so moving them would not change the load',
  would_not_improve: 'every possible move would leave the receiving member above the giving one, so none would even the load',
  no_target: 'there is nobody to move an issue to without overloading someone',
}

/** The sentence for a no-move reason. A flagged member with no availability is not overloaded, so its messages leave overload out. */
export function noMoveMessage(reason, imbalances) {
  if (!imbalances.some((item) => item.flag === 'no_availability')) return NO_MOVE_MESSAGES[reason]
  if (reason === 'no_candidates') return 'the flagged members have no issue in todo to move'
  if (reason === 'no_target') return 'there is nobody to move an issue to: the others are flagged, have an unknown or partial load, or would pass their capacity or the load limit'
  return NO_MOVE_MESSAGES[reason]
}
