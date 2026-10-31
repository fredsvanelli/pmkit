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
  if (!issues.some((issue) => isNumber(issue.estimate))) return { unit: 'issues', reason: 'no issue in scope has an estimate' }
  return { unit: estimation?.detail?.unit === 'hours' ? 'hours' : 'points', reason: null }
}

function emptyRow(member, name, extra = {}) {
  return { member, name, agent: AGENT_ID.test(member), isMember: true, issues: 0, estimate: 0, unestimated: 0, wip: 0, oldestWipDays: null, load: 0, unknown: false, ids: [], flags: [], ...extra }
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
  for (const item of imbalances) byMember.get(item.member).flags.push(item.flag)
  const noWork = rows.filter((row) => isEligible(row) && row.issues === 0).map((row) => ({ member: row.member, name: row.name, daysOff: row.daysOff }))
  const unknownLoad = rows.filter((row) => !row.agent && row.isMember && row.unknown).map((row) => row.member)
  return { unit, average: round(mean), rows, unassigned, noWork, unknownLoad, imbalances }
}

/**
 * A proposal that moves the issues in `todo` of the flagged members to the human with the lowest known load, largest first.
 * A source stops giving when it is at its average (over_average) or its capacity (over_capacity). A move happens only when
 * the target stays at or below the source after it, and at or below the target's own capacity. It writes nothing.
 */
export function suggestMoves(report, issues) {
  const estimated = report.unit !== 'issues'
  const mean = averageOf(report.rows).mean
  const loads = new Map(report.rows.map((row) => [row.member, row.load]))
  const capacityOf = new Map(report.rows.map((row) => [row.member, row.capacity]))
  const targets = report.rows.filter((row) => isEligible(row) && row.load !== null)
  const weight = (issue) => (estimated ? (isNumber(issue.estimate) ? issue.estimate : 0) : 1)
  const moves = []
  for (const from of [...new Set(report.imbalances.map((item) => item.member))]) {
    const limits = report.imbalances.filter((item) => item.member === from).map((item) => (item.flag === 'over_capacity' ? capacityOf.get(from) : mean))
    const stopAt = Math.min(...limits)
    const candidates = issues
      .filter((issue) => issue.assignee === from && issue.status.category === 'todo' && weight(issue) > 0)
      .sort((a, b) => weight(b) - weight(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    for (const issue of candidates) {
      if (loads.get(from) <= stopAt) break
      const w = weight(issue)
      const to = targets
        .filter((row) => row.member !== from)
        .filter((row) => loads.get(row.member) + w <= loads.get(from) - w)
        .filter((row) => !estimated || capacityOf.get(row.member) === null || loads.get(row.member) + w <= capacityOf.get(row.member))
        .sort((a, b) => loads.get(a.member) - loads.get(b.member))[0]
      if (to === undefined) continue
      loads.set(from, loads.get(from) - w)
      loads.set(to.member, loads.get(to.member) + w)
      moves.push({ issue: issue.id, from, to: to.member })
    }
  }
  return moves
}
