// Pure team load functions: no file or tracker access. The CLI reads the tracker and passes the data in.
// `issues` are the open issues in scope (todo, in_progress, in_review) as searchIssues returns them.
// PMK-72 (team-capacity) reuses teamLoad and chooseUnit.

import { AGENT_ID } from './delegation.mjs'

/** A human member is over average above this multiple of the average load. */
export const OVER_AVERAGE = 1.5

const WORKING = new Set(['in_progress', 'in_review'])
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const round = (value) => Math.round(value * 10) / 10

/** The unit of the load and, when it is `issues`, the reason to say in a note. `estimationPath` is the path of the `estimation` capability. */
export function chooseUnit(issues, estimationPath) {
  if (estimationPath === 'absent') return { unit: 'issues', reason: 'estimates are off' }
  if (!issues.some((issue) => isNumber(issue.estimate))) return { unit: 'issues', reason: 'no issue in scope has an estimate' }
  return { unit: 'points', reason: null }
}

function emptyRow(member, name, extra = {}) {
  return { member, name, agent: AGENT_ID.test(member), isMember: true, issues: 0, points: 0, unestimated: 0, wip: 0, oldestWipDays: null, load: 0, ids: [], flags: [], ...extra }
}

/**
 * The load per member. Rows come in member order, then members not in the list (a user that left), in order of appearance.
 * Agents and non-members have a row but stay out of the average, `noWork` and the flags. Unassigned issues form their own entry.
 * `aging` is aging() output, `capacity` and `daysOff` are maps by member for the sprint in scope.
 */
export function teamLoad(issues, { members, aging = [], capacity = {}, daysOff = {}, unit }) {
  const rows = members.map((member) => emptyRow(member.id, member.name ?? member.id, { availability: member.availability }))
  const byMember = new Map(rows.map((row) => [row.member, row]))
  const unassigned = { issues: 0, points: 0, unestimated: 0, ids: [] }
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
    if (isNumber(issue.estimate)) target.points += issue.estimate
    else target.unestimated++
    if (target !== unassigned && WORKING.has(issue.status.category)) {
      target.wip++
      const age = days.get(issue.id)
      if (age !== undefined && (target.oldestWipDays === null || age > target.oldestWipDays)) target.oldestWipDays = age
    }
  }
  for (const row of rows) {
    row.load = unit === 'points' ? row.points : row.issues
    row.capacity = isNumber(capacity[row.member]) ? capacity[row.member] : null
    row.daysOff = [daysOff[row.member] ?? []].flat()
  }

  const eligible = rows.filter((row) => !row.agent && row.isMember && row.availability !== 0)
  const average = eligible.length === 0 ? 0 : round(eligible.reduce((sum, row) => sum + row.load, 0) / eligible.length)
  const imbalances = []
  for (const row of eligible) {
    if (eligible.length >= 2 && average > 0 && row.load > average * OVER_AVERAGE) imbalances.push({ member: row.member, flag: 'over_average', load: row.load, limit: average * OVER_AVERAGE })
    if (unit === 'points' && row.capacity !== null && row.points > row.capacity) imbalances.push({ member: row.member, flag: 'over_capacity', load: row.points, limit: row.capacity })
  }
  for (const item of imbalances) byMember.get(item.member).flags.push(item.flag)
  const noWork = eligible.filter((row) => row.load === 0).map((row) => ({ member: row.member, name: row.name, daysOff: row.daysOff }))
  return { unit, average, rows, unassigned, noWork, imbalances }
}

/**
 * A proposal that moves the issues in `todo` of the flagged members to the human with the lowest load, largest first.
 * A move happens only when the target stays at or below the source after it. It writes nothing.
 */
export function suggestMoves(report, issues) {
  const loads = new Map(report.rows.map((row) => [row.member, row.load]))
  const targets = report.rows.filter((row) => !row.agent && row.isMember && row.availability !== 0)
  const weight = (issue) => (report.unit === 'points' ? (isNumber(issue.estimate) ? issue.estimate : 0) : 1)
  const flagged = [...new Set(report.imbalances.map((item) => item.member))]
  const moves = []
  for (const from of flagged) {
    const candidates = issues
      .filter((issue) => issue.assignee === from && issue.status.category === 'todo' && weight(issue) > 0)
      .sort((a, b) => weight(b) - weight(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    for (const issue of candidates) {
      if (loads.get(from) <= report.average) break
      const to = targets.filter((row) => row.member !== from).sort((a, b) => loads.get(a.member) - loads.get(b.member))[0]
      if (to === undefined) break
      const w = weight(issue)
      if (loads.get(to.member) + w > loads.get(from) - w) continue
      loads.set(from, loads.get(from) - w)
      loads.set(to.member, loads.get(to.member) + w)
      moves.push({ issue: issue.id, from, to: to.member })
    }
  }
  return moves
}
