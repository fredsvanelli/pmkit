// The "top-level issues" rollup of the initiatives-and-goals command, used when a tracker has no goals.
// See docs/superpowers/specs/2026-11-07-pmk-67-initiatives-and-goals-design.md.

/** `done / total`, or null when nothing counts: an unknown progress is never 0%. */
export const shareDone = (done, total) => (total === 0 ? null : done / total)

/**
 * Top-level issues (no parent, or a parent that is not an issue of the read, such as an epic) that have sub-issues, with the progress of
 * all their descendants. Canceled issues leave `total`. Archived issues are skipped. `points` counts only estimated issues.
 */
export function topLevelRollup(issues) {
  const live = issues.filter((issue) => !issue.archived)
  const ids = new Set(issues.map((issue) => issue.id))
  const kids = new Map()
  for (const issue of live) kids.set(issue.parent, [...(kids.get(issue.parent) ?? []), issue])
  const items = []
  let withoutChildren = 0
  for (const top of live.filter((issue) => issue.parent === undefined || !ids.has(issue.parent))) {
    const sum = { total: 0, done: 0, canceled: 0, points: 0, pointsDone: 0 }
    const seen = new Set([top.id])
    const stack = [...(kids.get(top.id) ?? [])]
    let count = 0
    while (stack.length > 0) {
      const issue = stack.pop()
      if (seen.has(issue.id)) continue
      seen.add(issue.id)
      count++
      stack.push(...(kids.get(issue.id) ?? []))
      const { category } = issue.status
      if (category === 'canceled') {
        sum.canceled++
        continue
      }
      sum.total++
      if (category === 'done') sum.done++
      if (typeof issue.estimate === 'number') {
        sum.points += issue.estimate
        if (category === 'done') sum.pointsDone += issue.estimate
      }
    }
    if (count === 0) withoutChildren++
    else items.push({ issue: { id: top.id, title: top.title, status: top.status }, ...sum, progress: shareDone(sum.done, sum.total) })
  }
  return { items, withoutChildren }
}
