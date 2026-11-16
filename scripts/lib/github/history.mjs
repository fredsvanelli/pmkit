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

/** The event of one timeline item, or null for an item pmkit does not map. */
function eventOf(item, node, context) {
  const meta = { at: item.createdAt, by: loginOf(item.__typename === 'IssueComment' ? item.author : item.actor) }
  const change = (op, field, from, to) => ({ ...meta, op, field, from: from ?? null, to: to ?? null })
  const typeOf = (issueType) => (issueType ? (context.typeOf(issueType.name) ?? issueType.name) : null)
  switch (item.__typename) {
    case 'IssueComment': return { ...meta, op: 'comment', to: item.id }
    case 'RenamedTitleEvent': return change('update', 'title', item.previousTitle, item.currentTitle)
    case 'LabeledEvent': return change('update', 'labels', null, item.label?.name)
    case 'UnlabeledEvent': return change('update', 'labels', item.label?.name, null)
    case 'IssueTypeAddedEvent': return change('update', 'type', null, typeOf(item.issueType))
    case 'IssueTypeChangedEvent': return change('update', 'type', typeOf(item.prevIssueType), typeOf(item.issueType))
    case 'IssueTypeRemovedEvent': return change('update', 'type', typeOf(item.issueType), null)
    case 'AssignedEvent': return change('assign', 'assignee', null, loginOf(item.assignee))
    case 'UnassignedEvent': return change('assign', 'assignee', loginOf(item.assignee), null)
    case 'ClosedEvent': {
      const canceled = item.stateReason === 'NOT_PLANNED' || item.stateReason === 'DUPLICATE'
      return change('move', 'status', null, canceled ? CLOSED_NOT_PLANNED : CLOSED)
    }
    // GitHub does not say which option the reopened issue went back to: the move names the status the issue reads now when it is open.
    case 'ReopenedEvent': return change('move', 'status', null, node.state === 'OPEN' ? statusOf(node, context).name : OPEN)
    case 'ProjectV2ItemStatusChangedEvent':
      if (!context.project || item.project?.id !== context.project.id) return null
      return change('move', 'status', item.previousStatus || null, item.status || null)
    default: {
      const link = LINKS[item.__typename]
      const other = link && item[link[2]]
      if (!other?.repository) return null
      return { ...meta, op: link[0], field: link[1], to: issueIdOf(other, context.repo) }
    }
  }
}

/**
 * The events of one issue: a `create` event for the issue itself, then one event per mapped timeline item, sorted by `at`
 * (equal times keep the timeline order). The create event's `to` holds the id and the title before the first rename.
 */
export function toEvents(node, items, context) {
  const firstRename = items.filter((item) => item.__typename === 'RenamedTitleEvent').sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))[0]
  const create = { at: node.createdAt, by: loginOf(node.author), op: 'create', to: { id: issueIdOf(node, context.repo), title: firstRename?.previousTitle ?? node.title } }
  const all = [create, ...items.map((item) => eventOf(item, node, context)).filter((event) => event !== null)]
  return all.map((event, index) => ({ event, index })).sort((a, b) => (a.event.at < b.event.at ? -1 : a.event.at > b.event.at ? 1 : a.index - b.index)).map(({ event }) => event)
}
