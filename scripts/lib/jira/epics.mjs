// A Jira epic work item as a pmkit epic, and an epic comment with the pmkit.statusUpdate property as a status update (PMK-79).
// Pure: no request here. See docs/superpowers/specs/2026-11-23-pmk-79-map-jira-epics-versions-status-updates-design.md,
// "The epic model" and "Status updates".

import { HEALTH } from '../local/epics.mjs'
import { TERMINAL } from '../model.mjs'
import { adfToText, textToAdf } from './adf.mjs'
import { jiraTime } from './issues.mjs'

/** The comment property that marks a status update; its value is `{ health }`. */
export const STATUS_UPDATE = 'pmkit.statusUpdate'

const LABELS = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' }
const HEADING = /^Status update:[^\n]*/

/** The fields an epic read asks for: the start date role's field joins them when the space has one. */
export const EPIC_FIELDS = (context) => ['summary', 'status', 'issuetype', 'description', 'duedate', ...(context.view.fields.start_date ? [context.view.fields.start_date.id] : [])]

/** The pmkit epic of an epic work item. `latest` is its latest status update or null; a done or canceled epic has no health. */
export function toEpic(item, context, latest) {
  const fields = item.fields ?? {}
  const start = context.view.fields.start_date ? fields[context.view.fields.start_date.id] : undefined
  const epic = { id: item.key, title: fields.summary, status: { name: fields.status?.name, category: context.categoryOf(fields.status?.name, fields.status?.statusCategory?.key) } }
  if (start) epic.start = start
  if (fields.duedate) epic.target = fields.duedate
  epic.description = adfToText(fields.description).trim()
  if (latest?.health && !TERMINAL.includes(epic.status.category)) epic.health = latest.health
  epic.url = `https://${context.raw.site}/browse/${item.key}`
  return epic
}

/** The ADF of a status update comment: `Status update: <Label>` as the first paragraph, then the body. */
export const statusUpdateBody = (health, body) => textToAdf(`Status update: ${LABELS[health]}\n\n${body}`)

/** The status update of a comment, or null for a comment without the property: text that only looks like an update is not one. */
export function toStatusUpdate(comment, epicId) {
  const health = (comment.properties ?? []).find((property) => property.key === STATUS_UPDATE)?.value?.health
  if (!HEALTH.includes(health)) return null
  return { epic: epicId, at: jiraTime(comment.created), author: comment.author?.accountId ?? '', health, body: adfToText(comment.body).replace(HEADING, '').trim() }
}
