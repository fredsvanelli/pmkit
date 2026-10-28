// Linear comments and history entries as pmkit comments and events. Pure: no request is sent here.
// See docs/superpowers/specs/2026-10-28-pmk-36-linear-history-comments-design.md, "The event normalizer".

import { estimateOf, mappingsOfTeam, priorityOf, toIssue } from './issues.mjs'
import { epicId } from './projects.mjs'

/**
 * Who did it: the user's id, else `bot:<type>` for a bot, else `external:<id>` for a user synced from outside Linear,
 * else `linear` for what Linear did itself, such as an auto-close. `user` is a comment's author and `actor` a history entry's.
 */
export function actorOf({ user, actor, botActor, externalUser } = {}) {
  const id = user?.id ?? actor?.id
  if (id) return id
  if (botActor?.type) return `bot:${botActor.type}`
  if (externalUser?.id) return `external:${externalUser.id}`
  return 'linear'
}

/** The pmkit comment of a Linear comment node. `parent` and `resolved` are present only on a reply and on a resolved root. */
export function toComment(node, issueIdentifier) {
  const comment = {
    id: node.id,
    issue: issueIdentifier,
    author: actorOf(node),
    body: (node.body ?? '').trim(),
    created: node.createdAt,
  }
  if (node.parentId) comment.parent = node.parentId
  if (node.resolvedAt) comment.resolved = { at: node.resolvedAt, by: actorOf({ user: node.resolvingUser }) }
  return comment
}

/**
 * Relation codes of `relationChanges` that pmkit understands. Only `ar` (a related relation added) has been seen live.
 * PMK-39 extends this table when its live writes show the codes for removal, blocks and duplicates.
 */
export const RELATION_CODES = { ar: { op: 'link', field: 'related' } }

const has = (value) => value !== null && value !== undefined
const changed = (from, to) => has(from) || has(to)
/** Label names of an entry side: the label objects Linear returns, plus the names of ids it returns without an object (a deleted label has no object). An id the discovery does not know adds nothing. */
function namesOfLabels(labels, ids, context) {
  const named = labels ?? []
  const known = new Set(named.map((label) => label.id))
  const extra = (ids ?? []).filter((id) => !known.has(id)).map((id) => context.raw.labels.find((label) => label.id === id)?.name).filter(has)
  return [...named.map((label) => label.name), ...extra]
}
const sortedNames = (names) => [...names].sort()

/** The create event's `to`: the Local frontmatter keys, in Local order, without the keys that have no value. */
function frontmatterOf(state, issue, node, type) {
  const typeNames = state.typeLabels
  const pairs = [
    ['id', issue.id], ['title', state.title], ['type', type], ['status', state.status], ['priority', state.priority], ['estimate', state.estimate],
    ['assignee', state.assignee], ['labels', sortedNames(state.labelNames.filter((name) => !typeNames.has(name)))], ['parent', state.parent],
    ['blocked_by', issue.blockedBy], ['related', state.related], ['duplicate_of', issue.duplicateOf], ['sprint', state.sprint],
    ['milestone', state.milestone], ['due', state.due], ['created', node.createdAt],
  ]
  return Object.fromEntries(pairs.filter(([, value]) => has(value) && !(Array.isArray(value) && value.length === 0)))
}

/**
 * The events of one issue: a `create` event, one event per mappable change of each history entry, and the comment events,
 * sorted by `at` (equal times keep the order they were built in). Linear records changes, not states, so the walk starts at the
 * current issue and undoes the entries from the newest to the oldest. `from` is the value an entry says came before and `to`
 * is the running value. What is left after the oldest entry is the state at creation.
 * @param {{ node: object, origin?: { creator?: object, botActor?: object }, entries?: object[], comments?: object[] }} input
 */
export function toEvents({ node, origin = {}, entries = [], comments = [] }, context) {
  const issue = toIssue(node, context)
  if (issue === null) return []
  const mappings = mappingsOfTeam(node.team?.id, context)
  const native = mappings?.estimate === 'native'
  const typeLabels = new Set(Object.values(mappings?.types ?? {}).map((label) => label.name))
  const labelNames = (node.labels?.nodes ?? []).map((label) => label.name)
  const typeOf = (names) => mappings?.typeOf(names) ?? null
  const stateName = (state) => state?.name ?? context.raw.states.find((item) => item.id === state?.id)?.name ?? null
  const state = {
    title: issue.title,
    status: issue.status.name,
    priority: issue.priority ?? null,
    estimate: issue.estimate ?? null,
    assignee: issue.assignee ?? null,
    labelNames,
    typeLabels,
    parent: issue.parent ?? null,
    related: [...issue.related],
    due: issue.due ?? null,
    sprint: has(node.cycle?.number) ? String(node.cycle.number) : null,
    milestone: node.projectMilestone?.id ?? null,
  }
  const newestFirst = entries.map((entry, index) => ({ entry, index })).sort((a, b) => (a.entry.createdAt < b.entry.createdAt ? 1 : a.entry.createdAt > b.entry.createdAt ? -1 : a.index - b.index)).map(({ entry }) => entry)

  const perEntry = newestFirst.map((entry) => {
    const meta = { at: entry.createdAt, by: actorOf({ actor: entry.actor, botActor: entry.botActor }) }
    const events = []
    const add = (op, field, from, to) => events.push({ ...meta, op, field, from, to })
    if (entry.fromState || entry.toState) {
      add('move', 'status', stateName(entry.fromState), state.status)
      if (entry.fromState) state.status = stateName(entry.fromState)
    }
    if (changed(entry.fromAssigneeId, entry.toAssigneeId)) {
      add('assign', 'assignee', entry.fromAssigneeId ?? null, state.assignee)
      state.assignee = entry.fromAssigneeId ?? null
    }
    if (changed(entry.fromTitle, entry.toTitle)) {
      add('update', 'title', entry.fromTitle ?? null, state.title)
      state.title = entry.fromTitle ?? state.title
    }
    if (changed(entry.fromPriority, entry.toPriority)) {
      const from = priorityOf(entry.fromPriority) ?? null
      add('update', 'priority', from, state.priority)
      state.priority = from
    }
    if (changed(entry.fromEstimate, entry.toEstimate) && native) {
      const from = has(entry.fromEstimate) ? (estimateOf({ team: node.team, estimate: entry.fromEstimate }, context) ?? null) : null
      add('update', 'estimate', from, state.estimate)
      state.estimate = from
    }
    if (changed(entry.fromDueDate, entry.toDueDate)) {
      add('update', 'due', entry.fromDueDate ?? null, state.due)
      state.due = entry.fromDueDate ?? null
    }
    const added = namesOfLabels(entry.addedLabels, entry.addedLabelIds, context)
    const removed = namesOfLabels(entry.removedLabels, entry.removedLabelIds, context)
    if (added.length > 0 || removed.length > 0) {
      const before = [...new Set([...state.labelNames.filter((name) => !added.includes(name)), ...removed])]
      const plain = (names) => sortedNames(names.filter((name) => !typeLabels.has(name)))
      if (typeOf(before) !== typeOf(state.labelNames)) add('update', 'type', typeOf(before), typeOf(state.labelNames))
      if (JSON.stringify(plain(before)) !== JSON.stringify(plain(state.labelNames))) add('update', 'labels', plain(before), plain(state.labelNames))
      state.labelNames = before
    }
    if (entry.fromParent || entry.toParent) {
      const from = entry.fromParent?.identifier ?? null
      add('update', 'parent', from, state.parent)
      state.parent = from
    }
    for (const change of entry.relationChanges ?? []) {
      const known = RELATION_CODES[change.type]
      if (!known) continue
      events.push({ ...meta, op: known.op, field: known.field, to: change.identifier })
      state.related = state.related.filter((other) => other !== change.identifier)
    }
    if (entry.fromCycle || entry.toCycle) {
      const from = entry.fromCycle ? String(entry.fromCycle.number) : null
      add('update', 'sprint', from, entry.toCycle ? String(entry.toCycle.number) : null)
      state.sprint = from
    }
    if (entry.fromProject || entry.toProject) {
      const epic = (project) => (project ? epicId(project) : null)
      add('update', 'project', epic(entry.fromProject), epic(entry.toProject))
    }
    if (entry.fromProjectMilestone || entry.toProjectMilestone) {
      const from = entry.fromProjectMilestone?.id ?? null
      add('update', 'milestone', from, entry.toProjectMilestone?.id ?? null)
      state.milestone = from
    }
    if (entry.updatedDescription === true) events.push({ at: meta.at, by: meta.by, op: 'update', field: 'description' })
    if (entry.archived === true || entry.autoArchived === true) events.push({ ...meta, op: 'archive' })
    return events
  })

  const create = { at: node.createdAt, by: actorOf({ user: origin.creator, botActor: origin.botActor }), op: 'create', to: frontmatterOf(state, issue, node, typeOf(state.labelNames)) }
  const commentEvents = comments.flatMap((comment) => {
    const found = toComment(comment, issue.id)
    const events = [{ at: found.created, by: found.author, op: 'comment', to: found.id }]
    if (found.resolved) events.push({ at: found.resolved.at, by: found.resolved.by, op: 'comment', field: 'resolved', to: found.id })
    return events
  })
  const all = [create, ...perEntry.reverse().flat(), ...commentEvents]
  return all.map((event, index) => ({ event, index })).sort((a, b) => (a.event.at < b.event.at ? -1 : a.event.at > b.event.at ? 1 : a.index - b.index)).map(({ event }) => event)
}
