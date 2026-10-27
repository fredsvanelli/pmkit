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

/**
 * Turns a --since or --until value into epoch milliseconds, or NaN when it is no date.
 * A date alone is UTC midnight, or 23:59:59 with `endOfDay`. A time without a zone is UTC.
 */
export function rangeInstant(text, { endOfDay = false } = {}) {
  const value = String(text)
  if (!value.includes('T')) return Date.parse(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}Z`)
  return Date.parse(value.endsWith('Z') ? value : `${value}Z`)
}

/** The issues whose last move into done falls in the range. Same keys order and event arrays as the input. */
export function doneInRange(eventsByIssue, { categoryOf, since, until }) {
  const from = since === undefined ? undefined : rangeInstant(since)
  const to = until === undefined ? undefined : rangeInstant(until, { endOfDay: true })
  const result = {}
  for (const [issue, events] of Object.entries(eventsByIssue)) {
    const doneAt = lastEntry(events, 'done', categoryOf)
    if (doneAt === undefined) continue
    const instant = Date.parse(doneAt)
    if ((from !== undefined && instant < from) || (to !== undefined && instant > to)) continue
    result[issue] = events
  }
  return result
}

export function velocity(sprints, issuesBySprint, { window, categoryOf }) {
  const closed = sprints.filter((sprint) => sprint.state === 'closed').sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0))
  const recent = window > 0 ? closed.slice(-window) : []
  const perSprint = recent.map((sprint) => {
    const done = (issuesBySprint[sprint.id] ?? []).filter((issue) => (
      categoryOf(issue.status) === 'done' && issue.doneAt !== undefined && (
        sprint.closed !== undefined ? Date.parse(issue.doneAt) <= Date.parse(sprint.closed) : issue.doneAt.slice(0, 10) <= sprint.end
      )
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

const daysBetween = (start, end) => Math.round(((Date.parse(end) - Date.parse(start)) / DAY_MS) * 10) / 10

/** The `at` of the first create event, or the earliest `at` when the log has none. */
function createdAt(events) {
  const created = events.find((event) => event.op === 'create')
  if (created !== undefined) return created.at
  let earliest
  for (const event of events) if (earliest === undefined || Date.parse(event.at) < Date.parse(earliest)) earliest = event.at
  return earliest
}

/** Days from creation to the last move into done, for each issue that has one. */
export function leadTimes(eventsByIssue, { categoryOf }) {
  const result = []
  for (const [issue, events] of Object.entries(eventsByIssue)) {
    const end = lastEntry(events, 'done', categoryOf)
    const start = createdAt(events)
    if (end === undefined || start === undefined) continue
    result.push({ issue, days: daysBetween(start, end) })
  }
  return result
}

/** The type an issue ends with after replaying its log, or null when it has none. */
function typeOf(events) {
  let type = null
  for (const event of events) {
    let value
    if (event.op === 'create') value = event.to?.type
    else if (event.op === 'update' && event.field === 'type') value = event.to
    else continue
    type = value === undefined || value === null || value === '' ? null : value
  }
  return type
}

/** Issues done, as a count, a count per type and the list ordered by done time then id. */
export function throughput(eventsByIssue, { categoryOf }) {
  const issues = []
  for (const [issue, events] of Object.entries(eventsByIssue)) {
    const doneAt = lastEntry(events, 'done', categoryOf)
    if (doneAt !== undefined) issues.push({ issue, type: typeOf(events), doneAt })
  }
  issues.sort((a, b) => (Date.parse(a.doneAt) - Date.parse(b.doneAt)) || (a.issue < b.issue ? -1 : a.issue > b.issue ? 1 : 0))
  const counts = {}
  for (const { type } of issues) counts[type ?? 'none'] = (counts[type ?? 'none'] ?? 0) + 1
  const byType = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  return { count: issues.length, byType, issues }
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
