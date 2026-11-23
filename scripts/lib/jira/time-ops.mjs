// The Time tracking family of the Jira tracker (PMK-80): logTime adds a worklog, listTimeEntries reads them.
// See docs/superpowers/specs/2026-11-23-pmk-80-map-jira-time-tracking-design.md, "Operations".

import { isPositiveMinutes } from '../duration.mjs'
import { PmkitError } from '../errors.mjs'
import { summarizeTimeEntries } from '../time-entries.mjs'
import { issuePath } from './ids.mjs'
import { toSprint } from './sprints.mjs'
import { jiraStarted, toTimeEntry, worklogsOf } from './worklogs.mjs'

/**
 * `capability()` resolves the manifest's time_tracking entry, `sprints()` the board's raw Jira sprints; `ops` gives readItem and
 * requireActor.
 */
export function timeOperations({ client, ops, now = () => new Date(), capability, sprints }) {
  async function requireTimeTracking() {
    const entry = await capability()
    if (entry.path === 'absent') throw new PmkitError('NOT_SUPPORTED', entry.enableHint, entry.enableHint)
  }

  async function logTime(id, minutes, actor, { dryRun = false } = {}) {
    await requireTimeTracking()
    if (!isPositiveMinutes(minutes)) throw new PmkitError('INVALID_INPUT', 'minutes must be a positive integer')
    await ops.requireActor(actor)
    const { item, issue } = await ops.readItem(id)
    // A worklog changes no pmkit field of the issue, so before and after are the same, as on Local.
    if (!dryRun) await client.request('POST', issuePath(item.key, '/worklog'), { body: { timeSpentSeconds: minutes * 60, started: jiraStarted(now()) } })
    return { before: issue, after: issue }
  }

  async function listTimeEntries(id) {
    await requireTimeTracking()
    const { item, issue } = await ops.readItem(id)
    const worklogs = await worklogsOf(client, item.key)
    const entries = worklogs.map(toTimeEntry).filter(Boolean)
    return summarizeTimeEntries({ issue: issue.id, entries, sprints: (await sprints()).map((sprint) => toSprint(sprint)), ignored: worklogs.length - entries.length })
  }

  return { logTime, listTimeEntries }
}
