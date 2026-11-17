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
  MilestonedEvent: (item) => ['update', 'milestone', null, item.milestoneTitle],
  DemilestonedEvent: (item) => ['update', 'milestone', item.milestoneTitle, null],
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

/** The items in timeline order, grouped by instant: items with the same createdAt form one group. */
function instantsOf(items) {
  const ordered = items.map((item, index) => ({ item, index })).sort((a, b) => byTime(a.item, b.item) || a.index - b.index).map(({ item }) => item)
  const groups = []
  for (const item of ordered) {
    const last = groups.at(-1)
    if (last && last[0].createdAt === item.createdAt) last.push(item)
    else groups.push([item])
  }
  return groups
}

const holdsLabel = (labels, name) => [...labels.values()].some((label) => sameName(label.name, name))
const metaOf = (item) => ({ at: item.createdAt, by: loginOf(item.actor) })

/** Applies one instant to the replay: the open or closed state, and the labels the issue holds. */
function applyInstant(replay, instant, labelItems) {
  for (const item of instant) {
    if (item.__typename === 'ClosedEvent') replay.closed = true
    if (item.__typename === 'ReopenedEvent') replay.closed = false
    if (!labelItems.includes(item)) continue
    const where = replay.held.findIndex((name) => sameName(name, item.label.name))
    if (item.__typename === 'LabeledEvent' && where < 0) replay.held.push(item.label.name)
    if (item.__typename === 'UnlabeledEvent' && where >= 0) replay.held.splice(where, 1)
  }
}

/** An instant with no mapped label item: a close sets the status, and a reopen moves to the status the labels give. */
function stateInstant(replay, instant, context, result) {
  const closedItem = instant.find((item) => item.__typename === 'ClosedEvent')
  if (closedItem) replay.status = closedTo(closedItem)
  const reopened = instant.find((item) => item.__typename === 'ReopenedEvent')
  if (!reopened || context.statusLabels.size === 0) return
  replay.status = context.readLabels(replay.held, '').status?.name ?? OPEN
  result.set(reopened, { ...metaOf(reopened), op: 'move', field: 'status', from: null, to: replay.status })
}

/** An instant with mapped label items: one move when the status read changes, one update when the type does. */
function labelInstant(replay, labelItems, context, result) {
  const read = context.readLabels(replay.held, '')
  const status = replay.closed ? replay.status : (read.status?.name ?? OPEN)
  const type = read.type ?? null
  for (const item of labelItems) result.set(item, null)
  const statusItem = labelItems.find((item) => holdsLabel(context.statusLabels, item.label.name))
  const typeItem = labelItems.find((item) => holdsLabel(context.typeLabels, item.label.name))
  if (statusItem && status !== replay.status) result.set(statusItem, { ...metaOf(statusItem), op: 'move', field: 'status', from: replay.status, to: status })
  if (typeItem && type !== replay.type) result.set(typeItem, { ...metaOf(typeItem), op: 'update', field: 'type', from: replay.type, to: type })
  replay.status = status
  replay.type = type
}

/**
 * The events of the label items that hold a status or a type, from a replay of the issue's labels in timeline order. Items
 * at the same instant count as one change. A status move is emitted when the status the issue reads changes, and never while
 * it is closed; a type update when its type changes. Returns a Map from each such item to its event, or to null.
 */
function labelEvents(items, context) {
  const result = new Map()
  const statusLabels = context.statusLabels ?? new Map()
  const typeLabels = context.typeLabels ?? new Map()
  if (statusLabels.size + typeLabels.size === 0) return result
  const mapped = (item) => LABEL_ITEMS.includes(item.__typename) && (holdsLabel(statusLabels, item.label?.name) || holdsLabel(typeLabels, item.label?.name))
  const replay = { held: [], closed: false, status: OPEN, type: null }
  for (const instant of instantsOf(items)) {
    const labelItems = instant.filter(mapped)
    applyInstant(replay, instant, labelItems)
    if (labelItems.length === 0) stateInstant(replay, instant, context, result)
    else labelInstant(replay, labelItems, context, result)
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
