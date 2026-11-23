// Jira worklogs as pmkit time entries and log_time events (PMK-80). Pure except worklogsOf, which only reads.
// See docs/superpowers/specs/2026-11-23-pmk-80-map-jira-time-tracking-design.md, "The entry model".

import { issuePath } from './ids.mjs'
import { jiraTime } from './issues.mjs'

/** The entry of a worklog: dated by its start, in minutes rounded to the nearest one; null when it rounds to 0 or has no seconds. */
export function toTimeEntry(worklog) {
  const minutes = Math.round(Number(worklog.timeSpentSeconds) / 60)
  if (!(minutes > 0)) return null
  return { at: jiraTime(worklog.started), by: worklog.author?.accountId ?? null, minutes }
}

/** The log_time events of the worklogs that are entries. */
export const worklogEvents = (worklogs) =>
  worklogs.map(toTimeEntry).filter(Boolean).map(({ at, by, minutes }) => ({ at, by, op: 'log_time', minutes }))

/** A time in the format the worklog `started` takes: 2026-11-22T12:00:00.000+0000. */
export const jiraStarted = (date) => date.toISOString().replace('Z', '+0000')

/** Every worklog of the work item `key`. */
export async function worklogsOf(client, key) {
  return (await client.paginate(issuePath(key, '/worklog'), { key: 'worklogs', pageSize: 5000, maxPages: 1000 })).items
}
