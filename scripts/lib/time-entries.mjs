// The time-entry result both trackers return from listTimeEntries: the entries, the total and the totals per person and per sprint.
// See docs/superpowers/specs/2026-11-23-pmk-80-map-jira-time-tracking-design.md, "The entry model".

import { formatMinutes } from './duration.mjs'
import { eventInstant } from './metrics.mjs'

/**
 * `entries` are valid `{ at, by, minutes }`. An entry counts for the sprint whose start..end holds the UTC date of its `at` (the first by
 * start, then id, when several do), else for `sprint: null`. A sprint without both dates holds nothing.
 */
export function summarizeTimeEntries({ issue, entries, sprints, ignored }) {
  const dated = sprints
    .filter((sprint) => sprint.start && sprint.end)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1))
  const sprintOf = (at) => {
    const instant = eventInstant(at)
    if (Number.isNaN(instant)) return null
    const day = new Date(instant).toISOString().slice(0, 10)
    return dated.find((sprint) => sprint.start <= day && day <= sprint.end)?.id ?? null
  }
  const rows = entries.map((entry) => ({ at: entry.at, by: entry.by, minutes: entry.minutes, time: formatMinutes(entry.minutes), sprint: sprintOf(entry.at) }))
  const sum = (key) => {
    const totals = new Map()
    for (const row of rows) totals.set(row[key], (totals.get(row[key]) ?? 0) + row.minutes)
    return [...totals].map(([value, minutes]) => ({ [key]: value, minutes, time: formatMinutes(minutes) }))
  }
  const total = rows.reduce((acc, row) => acc + row.minutes, 0)
  return {
    issue,
    entries: rows.map(({ sprint: _sprint, ...entry }) => entry),
    total,
    totalTime: formatMinutes(total),
    byPerson: sum('by'),
    bySprint: sum('sprint'),
    ignored,
  }
}
