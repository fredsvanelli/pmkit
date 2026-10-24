// Pure metric functions: no file access. The caller passes `categoryOf(statusName)` from the config.

const DAY_MS = 86400000

const dayNumber = (value) => Math.floor(Date.parse(`${String(value).slice(0, 10)}T00:00:00Z`) / DAY_MS)
const mean = (values) => (values.length === 0 ? 0 : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10)

/** The status an event moved the issue into, or undefined for other events. */
function movedTo(event) {
  if (event.op === 'move' && event.field === 'status') return event.to
  if (event.op === 'create') return event.to?.status
  return undefined
}

/** The `at` of the last move into a status of `category`, or undefined. */
export function lastEntry(events, category, categoryOf) {
  let found
  for (const event of events) {
    const status = movedTo(event)
    if (status !== undefined && categoryOf(status) === category) found = event.at
  }
  return found
}

export function velocity(sprints, issuesBySprint, { window, categoryOf }) {
  const closed = sprints.filter((sprint) => sprint.state === 'closed').sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0))
  const recent = window > 0 ? closed.slice(-window) : []
  const perSprint = recent.map((sprint) => {
    const done = (issuesBySprint[sprint.id] ?? []).filter((issue) => (
      categoryOf(issue.status) === 'done' && issue.doneAt !== undefined && issue.doneAt.slice(0, 10) <= sprint.end
    ))
    const points = done.reduce((sum, issue) => sum + (typeof issue.estimate === 'number' ? issue.estimate : 0), 0)
    return { id: sprint.id, points, count: done.length, estimated: done.some((issue) => typeof issue.estimate === 'number') }
  })
  const useCounts = !perSprint.some((sprint) => sprint.estimated)
  const key = useCounts ? 'count' : 'points'
  return {
    perSprint: perSprint.map(({ id, points, count }) => ({ id, points, count })),
    average: mean(perSprint.map((sprint) => sprint[key])),
    unit: useCounts ? 'issues' : 'points',
  }
}

export function cycleTimes(eventsByIssue, { categoryOf }) {
  const result = []
  for (const [issue, events] of Object.entries(eventsByIssue)) {
    let start
    for (const event of events) {
      const status = movedTo(event)
      if (status !== undefined && categoryOf(status) === 'in_progress') {
        start = event.at
        break
      }
    }
    const end = lastEntry(events, 'done', categoryOf)
    if (start === undefined || end === undefined) continue
    result.push({ issue, days: Math.round(((Date.parse(end) - Date.parse(start)) / DAY_MS) * 10) / 10 })
  }
  return result
}

export function summary(values) {
  if (values.length === 0) return { count: 0, median: null, p85: null }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p) => {
    const index = p * (sorted.length - 1)
    const low = Math.floor(index)
    const high = Math.ceil(index)
    return Math.round((sorted[low] + (sorted[high] - sorted[low]) * (index - low)) * 1e9) / 1e9
  }
  return { count: sorted.length, median: at(0.5), p85: at(0.85) }
}

/** Monday-to-Friday days after `a`, up to and including `b`. */
export function businessDaysBetween(a, b) {
  let count = 0
  for (let day = dayNumber(a) + 1; day <= dayNumber(b); day++) {
    const weekday = new Date(day * DAY_MS).getUTCDay()
    if (weekday !== 0 && weekday !== 6) count++
  }
  return count
}
