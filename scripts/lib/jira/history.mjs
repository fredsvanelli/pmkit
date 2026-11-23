// Jira changelog entries and comments as pmkit events and comments. Pure: no request is sent here.
// See docs/superpowers/specs/2026-11-22-pmk-77-jira-work-items-transitions-links-jql-design.md, "History and comments".

import { adfToText } from './adf.mjs'
import { compareTimes } from '../model.mjs'
import { jiraTime } from './issues.mjs'

const HOURS = 'timeoriginalestimate'
const PLAIN = { summary: 'title', description: 'description', duedate: 'due' }
const PARENT = ['IssueParentAssociation', 'Parent']
const accountOf = (user) => user?.accountId ?? null

/** The pmkit comment of a Jira comment node on the issue `key`, with the body from ADF. */
export function toComment(node, key) {
  return { id: String(node.id), issue: key, author: accountOf(node.author), body: adfToText(node.body).trim(), created: jiraTime(node.created) }
}

const labelsOf = (text) => String(text ?? '').split(/\s+/).filter(Boolean)

// One update event per label added or removed.
function labelChanges(change) {
  const before = labelsOf(change.fromString)
  const after = labelsOf(change.toString)
  return [
    ...after.filter((label) => !before.includes(label)).map((label) => ['update', 'labels', null, label]),
    ...before.filter((label) => !after.includes(label)).map((label) => ['update', 'labels', label, null]),
  ]
}

const idsOf = (text) => String(text ?? '').split(',').map((id) => id.trim()).filter(Boolean)

// One sprint event: the last sprint left (else the last one held when another is joined) to the last sprint joined; none when the list is unchanged.
function sprintChange(change) {
  const before = idsOf(change.from)
  const after = idsOf(change.to)
  const added = after.filter((id) => !before.includes(id))
  const removed = before.filter((id) => !after.includes(id))
  if (!added.length && !removed.length) return []
  return [['update', 'sprint', removed.at(-1) ?? (added.length ? (before.at(-1) ?? null) : null), added.at(-1) ?? null]]
}

const numberOf = (value, id) => {
  const number = value === null || value === undefined || value === '' ? NaN : Number(value)
  if (Number.isNaN(number)) return null
  return id === HOURS ? number / 3600 : number
}

/** The [op, field, from, to] changes of one changelog item. */
function changesOf(change, context) {
  const { field, fieldId } = change
  const id = fieldId ?? field
  const names = [change.fromString ?? null, change.toString ?? null]
  if (id === 'status') return [['move', 'status', ...names]]
  if (id === 'labels') return labelChanges(change)
  if (id === 'assignee') return [['assign', 'assignee', change.from ?? null, change.to ?? null]]
  if (id === 'priority') return [['update', 'priority', ...names.map((name) => (name === null ? null : (context.priorityOf(name) ?? name)))]]
  if (id === 'issuetype') return [['update', 'type', ...names.map((name) => (name === null ? null : (context.typeOfName(name) ?? name)))]]
  if (Object.hasOwn(PLAIN, id)) return [['update', PLAIN[id], ...names]]
  if (context.fields.estimate && id === context.fields.estimate) {
    return [['update', 'estimate', numberOf(change.from ?? change.fromString, id), numberOf(change.to ?? change.toString, id)]]
  }
  if (context.fields.sprint && id === context.fields.sprint) return sprintChange(change)
  if (field === 'Link') return [change.to ? ['link', 'links', null, change.to] : ['unlink', 'links', change.from ?? null, null]]
  if (PARENT.includes(field) || PARENT.includes(fieldId)) return [['update', 'parent', ...names]]
  return [['update', `jira:${fieldId ?? field}`, ...names]]
}

const eventsOf = (history, context) => {
  const meta = { at: jiraTime(history.created), by: accountOf(history.author) }
  return (history.items ?? []).flatMap((change) => changesOf(change, context)).map(([op, field, from, to]) => ({ ...meta, op, field, from, to }))
}

/** The `fromString` of the earliest change of the field `id`, or `current` when the changelog never changes it. */
function startOf(histories, id, current) {
  const ordered = [...histories].sort((a, b) => compareTimes(jiraTime(a.created), jiraTime(b.created)))
  for (const history of ordered) {
    const change = (history.items ?? []).find((item) => (item.fieldId ?? item.field) === id)
    if (change) return change.fromString ?? null
  }
  return current ?? null
}

/** The item as it was created: its key, and its title, pmkit type (else the Jira name) and status before any change. */
function createdAs(item, histories, context) {
  const type = startOf(histories, 'issuetype', item.fields.issuetype?.name)
  return {
    id: item.key,
    title: startOf(histories, 'summary', item.fields.summary),
    type: type === null ? null : (context.typeOfName(type) ?? type),
    status: startOf(histories, 'status', item.fields.status?.name),
  }
}

/**
 * The events of one work item: a `create` event (its `to` is the item as created), one event per changelog item (one per label added or removed), and a
 * `comment` event per raw comment node, sorted by `at` (equal times keep the changelog order, then the comments).
 */
export function toEvents(item, histories, context, comments = []) {
  const create = { at: jiraTime(item.fields.created), by: accountOf(item.fields.creator), op: 'create', to: createdAs(item, histories, context) }
  const noted = comments.map((node) => ({ at: jiraTime(node.created), by: accountOf(node.author), op: 'comment' }))
  const all = [create, ...histories.flatMap((history) => eventsOf(history, context)), ...noted]
  return all.sort((a, b) => compareTimes(a.at, b.at))
}
