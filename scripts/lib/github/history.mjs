// GitHub timeline items and issue comments as pmkit events and comments. Pure: no request is sent here.
// See docs/specs/2026-11-16-pmk-87-github-issues-relations-history-design.md, "History and comments".

import { issueIdOf } from './ids.mjs'
import { CLOSED, CLOSED_NOT_PLANNED, OPEN } from './discovery.mjs'
import { statusOf } from './issues.mjs'

const loginOf = (user) => user?.login ?? null

/** The pmkit comment of an IssueComment node. GitHub comments are flat, so no comment has `parent` or `resolved`. */
export function toComment(node, issueId) {
  return { id: node.id, issue: issueId, author: loginOf(node.author), body: (node.body ?? '').trim(), created: node.createdAt }
}

// The relation events: the pmkit field and the key of the other issue on the item.
const LINKS = {
  BlockedByAddedEvent: ['link', 'blockedBy', 'blockingIssue'],
  BlockedByRemovedEvent: ['unlink', 'blockedBy', 'blockingIssue'],
  BlockingAddedEvent: ['link', 'blocks', 'blockedIssue'],
  BlockingRemovedEvent: ['unlink', 'blocks', 'blockedIssue'],
  ParentIssueAddedEvent: ['link', 'parent', 'parent'],
  ParentIssueRemovedEvent: ['unlink', 'parent', 'parent'],
  SubIssueAddedEvent: ['link', 'children', 'subIssue'],
  SubIssueRemovedEvent: ['unlink', 'children', 'subIssue'],
  MarkedAsDuplicateEvent: ['link', 'duplicateOf', 'canonical'],
  UnmarkedAsDuplicateEvent: ['unlink', 'duplicateOf', 'canonical'],
}

const typeOf = (issueType, context) => (issueType ? (context.typeOf(issueType.name) ?? issueType.name) : null)

function closedTo(item) {
  const canceled = item.stateReason === 'NOT_PLANNED' || item.stateReason === 'DUPLICATE'
  return canceled ? CLOSED_NOT_PLANNED : CLOSED
}

// The update, assign and move events: [op, field, from, to] of an item, or null for an item pmkit does not map.
const CHANGES = {
  RenamedTitleEvent: (item) => ['update', 'title', item.previousTitle, item.currentTitle],
  LabeledEvent: (item) => ['update', 'labels', null, item.label?.name],
  UnlabeledEvent: (item) => ['update', 'labels', item.label?.name, null],
  IssueTypeAddedEvent: (item, node, context) => ['update', 'type', null, typeOf(item.issueType, context)],
  IssueTypeChangedEvent: (item, node, context) => ['update', 'type', typeOf(item.prevIssueType, context), typeOf(item.issueType, context)],
  IssueTypeRemovedEvent: (item, node, context) => ['update', 'type', typeOf(item.issueType, context), null],
  AssignedEvent: (item) => ['assign', 'assignee', null, loginOf(item.assignee)],
  UnassignedEvent: (item) => ['assign', 'assignee', loginOf(item.assignee), null],
  ClosedEvent: (item) => ['move', 'status', null, closedTo(item)],
  // GitHub does not say which option the reopened issue went back to: the move names the status the issue reads now when it is open.
  // Limit: an issue reopened and later moved to Done reads its current option here, not the one it had right after the reopen.
  ReopenedEvent: (item, node, context) => ['move', 'status', null, node.state === 'OPEN' ? statusOf(node, context).name : OPEN],
  ProjectV2ItemStatusChangedEvent: (item, node, context) => {
    if (!context.project || item.project?.id !== context.project.id) return null
    return ['move', 'status', item.previousStatus || null, item.status || null]
  },
}

/** The link or unlink event of a relation item, or null when the other issue is not readable. */
function linkEvent(item, meta, context) {
  const link = LINKS[item.__typename]
  const other = link && item[link[2]]
  if (!other?.repository) return null
  return { ...meta, op: link[0], field: link[1], to: issueIdOf(other, context.repo) }
}

/** The event of one timeline item, or null for an item pmkit does not map. */
function eventOf(item, node, context) {
  const meta = { at: item.createdAt, by: loginOf(item.__typename === 'IssueComment' ? item.author : item.actor) }
  if (item.__typename === 'IssueComment') return { ...meta, op: 'comment', to: item.id }
  const changeOf = CHANGES[item.__typename]
  if (!changeOf) return linkEvent(item, meta, context)
  const change = changeOf(item, node, context)
  if (!change) return null
  const [op, field, from, to] = change
  return { ...meta, op, field, from: from ?? null, to: to ?? null }
}

const LABEL_ITEMS = ['LabeledEvent', 'UnlabeledEvent']
const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const byTime = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)

/**
 * The events of the label items that hold a status or a type, from a replay of the issue's labels in timeline order. Items
 * at the same instant count as one change. A status move is emitted when the status the issue reads changes, and never while
 * it is closed; a type update when its type changes. Returns a Map from each such item to its event, or to null.
 */
function labelEvents(items, context) {
  const mapped = (name) => [...(context.statusLabels?.values() ?? []), ...(context.typeLabels?.values() ?? [])].some((label) => sameName(label.name, name))
  const result = new Map()
  if ((context.statusLabels?.size ?? 0) + (context.typeLabels?.size ?? 0) === 0) return result
  const held = []
  let closed = false
  let status = OPEN
  let type = null
  const ordered = items.map((item, index) => ({ item, index })).sort((a, b) => byTime(a.item, b.item) || a.index - b.index)
  for (let at = 0; at < ordered.length; ) {
    const instant = ordered.filter(({ item }) => item.createdAt === ordered[at].item.createdAt).map(({ item }) => item)
    at += instant.length
    const labelItems = instant.filter((item) => LABEL_ITEMS.includes(item.__typename) && mapped(item.label?.name))
    for (const item of instant) {
      if (item.__typename === 'ClosedEvent') closed = true
      if (item.__typename === 'ReopenedEvent') closed = false
      if (!labelItems.includes(item)) continue
      const name = item.label.name
      const where = held.findIndex((label) => sameName(label, name))
      if (item.__typename === 'LabeledEvent' && where < 0) held.push(name)
      if (item.__typename === 'UnlabeledEvent' && where >= 0) held.splice(where, 1)
    }
    if (labelItems.length === 0) {
      if (instant.some((item) => item.__typename === 'ClosedEvent')) status = closedTo(instant.find((item) => item.__typename === 'ClosedEvent'))
      const reopened = instant.find((item) => item.__typename === 'ReopenedEvent')
      if (reopened && context.statusLabels.size > 0) {
        status = context.readLabels(held, '').status?.name ?? OPEN
        result.set(reopened, { at: reopened.createdAt, by: loginOf(reopened.actor), op: 'move', field: 'status', from: null, to: status })
      }
      continue
    }
    const read = context.readLabels(held, '')
    const nextStatus = closed ? status : (read.status?.name ?? OPEN)
    const nextType = read.type ?? null
    const meta = (item) => ({ at: item.createdAt, by: loginOf(item.actor) })
    const statusItem = labelItems.find((item) => [...(context.statusLabels?.values() ?? [])].some((label) => sameName(label.name, item.label.name)))
    const typeItem = labelItems.find((item) => [...(context.typeLabels?.values() ?? [])].some((label) => sameName(label.name, item.label.name)))
    for (const item of labelItems) result.set(item, null)
    if (statusItem && nextStatus !== status) result.set(statusItem, { ...meta(statusItem), op: 'move', field: 'status', from: status, to: nextStatus })
    if (typeItem && nextType !== type) result.set(typeItem, { ...meta(typeItem), op: 'update', field: 'type', from: type, to: nextType })
    status = nextStatus
    type = nextType
  }
  return result
}

/**
 * The events of one issue: a `create` event for the issue itself, then one event per mapped timeline item, sorted by `at`
 * (equal times keep the timeline order). The create event's `to` holds the id and the title before the first rename.
 * Without a Project, status labels give moves; without issue types, type labels give type updates (labelEvents).
 */
export function toEvents(node, items, context) {
  const firstRename = items.filter((item) => item.__typename === 'RenamedTitleEvent').sort(byTime)[0]
  const create = { at: node.createdAt, by: loginOf(node.author), op: 'create', to: { id: issueIdOf(node, context.repo), title: firstRename?.previousTitle ?? node.title } }
  const replayed = labelEvents(items, context)
  const all = [create, ...items.map((item) => (replayed.has(item) ? replayed.get(item) : eventOf(item, node, context))).filter((event) => event !== null && event !== undefined)]
  return all.map((event, index) => ({ event, index })).sort((a, b) => (a.event.at < b.event.at ? -1 : a.event.at > b.event.at ? 1 : a.index - b.index)).map(({ event }) => event)
}
