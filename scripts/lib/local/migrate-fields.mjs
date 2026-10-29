// The import field mapping: a Linear snapshot as Local files, one record per file or config entry. Pure.
// See the PMK-41 spec, "People", "History on import", "What does not round-trip", and Decisions 5 and 6 of the plan.

import { MEMBER_ID } from '../config.mjs'
import { compareIds, isId, newId, nextNumberedId } from '../ids.mjs'
import { sha256, snapshotDigest, stripAttribution } from '../migrate/snapshot.mjs'

export const IMPORT_LOSSES = [
  'milestones', 'documents', 'outside links', 'label groups', 'labels renamed', 'estimates', 'statuses', 'cycle schedule', 'ids',
]

const LABEL = /^[a-z0-9][a-z0-9_-]*$/
const ID_FIELDS = ['parent']
const LIST_FIELDS = ['blocked_by', 'related', 'duplicate_of']
const lower = (value) => String(value ?? '').toLowerCase()
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const fileSafe = (text) => String(text).replaceAll(':', '-')
const slug = (text) => lower(text).replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')

/** The Local member id of a Linear user, by the rule in "People". `taken` holds the ids already in use. */
export function memberIdFor(user, taken) {
  let base
  if (user.app) base = slug(user.name) === '' ? 'user' : `agent:${slug(user.name)}`
  else base = slug(String(user.email ?? '').split('@')[0]) || 'user'
  if (!MEMBER_ID.test(base)) base = 'user'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

/** A Linear label name under the Local label rule, or null when nothing valid is left. */
export function localLabelName(name) {
  const result = lower(name).replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return LABEL.test(result) ? result : null
}

/** A deterministic integer source: draw i is the first 8 hex digits of sha256(`<digest>:<i>`) modulo n. */
export function seededRandom(digest) {
  let i = 0
  return (n) => parseInt(sha256(`${digest}:${i++}`).slice(0, 8), 16) % n
}

/** What the import writes into: the Local config, the type labels and the round-trip ids of finished export maps. */
export function importTarget({ local, mappings = {}, exportMaps = [] }) {
  const statusNames = Object.keys(local.statuses ?? {})
  const byCategory = new Map()
  for (const name of statusNames) {
    const category = local.statuses[name]?.category
    if (category && !byCategory.has(category)) byCategory.set(category, name)
  }
  const typeOfLabel = new Map(Object.entries(mappings.types ?? {}).map(([type, label]) => [lower(label), type]))
  const members = Object.entries(local.members ?? {}).map(([id, member]) => ({ id, name: member?.name ?? '', email: member?.email ?? null }))
  const idPrefix = local.id_prefix
  const epicPrefix = local.epic_prefix
  const roundTrip = {}
  for (const map of exportMaps) {
    if (map?.direction !== 'export' || !map.finished) continue
    for (const [kind, prefix] of [['issue', idPrefix], ['epic', epicPrefix]]) {
      for (const [key, entry] of Object.entries(map.records?.[kind] ?? {})) {
        if (entry?.state === 'done' && entry.id && isId(key, prefix)) roundTrip[entry.id] = key
      }
    }
  }
  return {
    statusNames,
    byCategory,
    typeOfLabel,
    types: local.types ?? [],
    priorities: local.priorities ?? [],
    labels: local.labels ?? [],
    estimate: local.estimate ?? null,
    membersByEmail: new Map(members.filter((member) => member.email).map((member) => [lower(member.email), member])),
    membersByName: members,
    memberIds: members.map((member) => member.id),
    idPrefix,
    epicPrefix,
    idStyle: local.id_style ?? 'random',
    roundTrip,
  }
}

function lossTable() {
  const losses = new Map()
  return {
    add(what, id, why) {
      const loss = losses.get(what) ?? { what, count: 0, ids: [], why }
      loss.count++
      if (id !== undefined && id !== null && !loss.ids.includes(id)) loss.ids.push(id)
      losses.set(what, loss)
    },
    set(what, count, ids, why) {
      if (count > 0) losses.set(what, { what, count, ids, why })
    },
    get: (what) => losses.get(what),
    list: () => IMPORT_LOSSES.filter((what) => losses.has(what)).map((what) => losses.get(what)),
  }
}

const byCreated = (a, b) => byText(a.created ?? '', b.created ?? '') || compareIds(a.id, b.id)

export function mapImport(snapshot, target, { readRequests = 0 } = {}) {
  const problems = []
  const losses = lossTable()
  const records = { member: [], label: [], sprint: [], epic: [], update: [], issue: [], comment: [] }

  // People: a user matches the member with the same email; each other user a record names becomes a member.
  const users = new Map(snapshot.people.map((person) => [person.id, person]))
  const taken = new Set(target.memberIds)
  const memberOf = new Map()
  const people = []
  const named = (userId) => {
    if (userId === null || userId === undefined) return null
    if (memberOf.has(userId)) return memberOf.get(userId)
    const user = users.get(userId) ?? { id: userId, name: String(userId), email: null, app: true }
    const match = !user.app && user.email ? target.membersByEmail.get(lower(user.email)) : null
    let id
    if (match) {
      id = match.id
      people.push({ id: user.id, name: user.name, email: user.email ?? null, note: `matches member ${id}` })
    } else {
      id = memberIdFor(user, taken)
      taken.add(id)
      const fields = user.app || id.startsWith('agent:') ? { name: user.name } : { name: user.name, email: user.email }
      records.member.push({ key: user.id, source: { id: user.id, title: user.name, summary: user.email ?? '' }, target: id, fields, refs: {}, dropped: [] })
      people.push({ id: user.id, name: user.name, email: user.email ?? null, note: `new member ${id}` })
    }
    memberOf.set(userId, id)
    return id
  }

  // Labels: a type label becomes the issue's type; every other label follows the Local label rule.
  const labelOf = new Map()
  const local = (name) => {
    if (labelOf.has(name)) return labelOf.get(name)
    const result = localLabelName(name)
    labelOf.set(name, result)
    if (result === null) {
      problems.push({ kind: 'label', key: name, code: 'bad_label', message: `the label "${name}" has no valid Local name` })
      return null
    }
    if (result !== name) losses.add('labels renamed', name, '')
    if (!target.labels.includes(result) && !records.label.some((record) => record.target === result)) {
      records.label.push({ key: name, source: { id: name, title: result === name ? '' : `as ${result}`, summary: '' }, target: result, fields: { name: result }, refs: {}, dropped: [] })
    }
    return result
  }
  const splitLabels = (names) => {
    let type = null
    const labels = []
    for (const name of names ?? []) {
      const mapped = target.typeOfLabel.get(lower(name))
      if (mapped) {
        type ??= mapped
        continue
      }
      const result = local(name)
      if (result !== null && !labels.includes(result)) labels.push(result)
    }
    return { type, labels }
  }

  // Statuses: the Local status of the same name, else the first of the same category.
  const statusOf = (status, key) => {
    if (!status) return null
    const name = status.name ?? status
    const wanted = lower(name).replace(/\s+/g, '_')
    const same = target.statusNames.find((item) => lower(item) === wanted)
    if (same) return same
    const category = status.category
    const fallback = category ? target.byCategory.get(category) : null
    if (fallback) {
      if (key) losses.add('statuses', name, '')
      return fallback
    }
    if (key) problems.push({ kind: 'issue', key, code: 'no_status', message: `${key} has the status "${name}" and the Local tracker has no ${category ?? 'such'} status` })
    return null
  }
  const statusByName = new Map()
  const eventStatus = (name) => {
    if (!statusByName.has(name)) statusByName.set(name, statusOf({ name }, null) ?? name)
    return statusByName.get(name)
  }

  const scale = target.estimate?.scale ?? []
  const estimateOf = (value) => (value === null || value === undefined ? null : scale.includes(value) ? value : undefined)

  // Sprints: one file per cycle, named by its start date.
  const sprintOf = new Map()
  for (const sprint of [...snapshot.sprints].sort((a, b) => byText(a.start, b.start) || byText(String(a.id), String(b.id)))) {
    if ([...sprintOf.values()].includes(sprint.start)) {
      problems.push({ kind: 'sprint', key: String(sprint.id), code: 'sprint_clash', message: `cycle ${sprint.id} starts on ${sprint.start}, like another cycle; Local sprints are named by their start date` })
      continue
    }
    sprintOf.set(String(sprint.id), sprint.start)
    records.sprint.push({
      key: String(sprint.id),
      source: { id: String(sprint.id), title: sprint.name, summary: `${sprint.start} to ${sprint.end}` },
      target: sprint.start,
      fields: { name: sprint.name, start: sprint.start, end: sprint.end, goal: sprint.goal ?? '', state: sprint.state, ...(sprint.closed ? { closed: sprint.closed } : {}) },
      refs: {},
      dropped: [],
    })
  }

  // Ids: round-trip ids first, then new ids in creation order from a source seeded by the snapshot digest.
  const random = seededRandom(snapshotDigest(snapshot))
  const used = new Set(Object.values(target.roundTrip))
  const idOf = new Map()
  let fresh = 0
  const assign = (items, prefix) => {
    for (const item of [...items].sort(byCreated)) {
      let id = target.roundTrip[item.id]
      if (!id) {
        id = target.idStyle === 'numbered' ? nextNumberedId(prefix, used) : newId(prefix, { random, exists: (candidate) => used.has(candidate) })
        fresh++
      }
      used.add(id)
      idOf.set(item.id, id)
    }
  }
  assign(snapshot.epics, target.epicPrefix)
  assign(snapshot.issues, target.idPrefix)
  const localId = (id) => (id === null || id === undefined ? null : idOf.get(id) ?? null)

  // Epics and their status updates.
  for (const epic of snapshot.epics) {
    if (epic.milestones > 0) losses.add('milestones', epic.id, '')
    if (epic.documents > 0) losses.add('documents', epic.id, '')
    records.epic.push({
      key: epic.id,
      source: { id: epic.id, title: epic.title, summary: epic.status?.name ?? '' },
      target: idOf.get(epic.id),
      fields: { id: idOf.get(epic.id), title: epic.title, status: statusOf(epic.status, epic.id), start: epic.start ?? null, target: epic.target ?? null, description: epic.description ?? '', created: epic.created ?? null },
      refs: {},
      dropped: epic.milestones > 0 ? ['milestones'] : [],
    })
    const stems = new Set()
    for (const update of epic.updates ?? []) {
      const author = named(update.author) ?? 'user'
      const base = `${String(update.at).slice(0, 10)}-${fileSafe(author)}`
      let stem = base
      for (let n = 2; stems.has(stem); n++) stem = `${base}-${n}`
      stems.add(stem)
      records.update.push({
        key: update.id,
        source: { id: update.id, title: `${update.health} by ${author}`, summary: String(update.at).slice(0, 10) },
        target: stem,
        fields: { epic: idOf.get(epic.id), at: update.at, author, health: update.health, body: update.body },
        refs: {},
        dropped: [],
      })
    }
  }

  // Links live in the frontmatter of both issues.
  const linksOf = new Map(snapshot.issues.map((item) => [item.id, { blocked_by: [], related: [], duplicate_of: [] }]))
  const push = (id, field, other) => {
    const list = linksOf.get(id)?.[field]
    if (list && other && !list.includes(other)) list.push(other)
  }
  for (const link of snapshot.links) {
    const [from, to] = [localId(link.from), localId(link.to)]
    if (!from || !to) continue
    if (link.kind === 'blocks') push(link.to, 'blocked_by', from)
    else if (link.kind === 'duplicate') push(link.from, 'duplicate_of', to)
    else if (link.kind === 'related') {
      push(link.from, 'related', to)
      push(link.to, 'related', from)
    }
  }

  // Comments: the attribution line gives the author back when its name is one member's name.
  const comments = new Map()
  const commentStems = new Map()
  for (const comment of [...snapshot.comments].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0) || byText(a.created, b.created) || byText(a.id, b.id))) {
    const stripped = stripAttribution(comment.body)
    const owners = stripped ? target.membersByName.filter((member) => member.name === stripped.name) : []
    const author = owners.length === 1 ? owners[0].id : named(comment.author) ?? 'user'
    const issueId = localId(comment.issue)
    const taken = commentStems.get(issueId) ?? new Set()
    const base = `${fileSafe(comment.created)}-${fileSafe(author)}`
    let stem = base
    for (let n = 2; taken.has(stem); n++) stem = `${base}-${n}`
    taken.add(stem)
    commentStems.set(issueId, taken)
    comments.set(comment.id, stem)
    const replyTo = comment.parent ? comments.get(comment.parent) ?? null : null
    records.comment.push({
      key: comment.id,
      source: { id: comment.id, title: `by ${author} on ${String(comment.created).slice(0, 10)}`, summary: comment.parent ? 'reply' : '' },
      target: stem,
      fields: { issue: issueId, author, created: comment.created, body: stripped ? stripped.body : comment.body, ...(replyTo ? { reply_to: replyTo } : {}), ...(comment.resolved && !comment.parent ? { resolved: true } : {}) },
      refs: {},
      dropped: [],
    })
  }

  // Issues, with their history in Local ids and members.
  const mapValue = (field, value) => {
    if (value === null || value === undefined) return value
    if (field === 'id' || ID_FIELDS.includes(field)) return localId(value)
    if (LIST_FIELDS.includes(field)) return Array.isArray(value) ? value.map(localId).filter(Boolean) : localId(value)
    if (field === 'sprint') return sprintOf.get(String(value)) ?? null
    if (field === 'assignee') return named(value)
    if (field === 'status') return eventStatus(value)
    if (field === 'labels') return Array.isArray(value) ? splitLabels(value).labels : value
    if (field === 'estimate') return estimateOf(value) ?? null
    return value
  }
  const mapEvent = (event) => {
    const out = { ...event, by: named(event.by) ?? 'user' }
    if (event.op === 'create' && event.to && typeof event.to === 'object') {
      const to = {}
      for (const [key, value] of Object.entries(event.to)) {
        if (key === 'milestone' || key === 'release') continue
        const mapped = mapValue(key, value)
        if (mapped !== undefined && mapped !== null) to[key] = mapped
      }
      out.to = to
    } else if (event.op === 'comment') {
      out.to = comments.has(event.to) ? `${comments.get(event.to)}.md` : event.to
    } else if (event.field) {
      if (event.field === 'milestone' || event.field === 'release') return null
      if ('from' in event) out.from = mapValue(event.field, event.from)
      if ('to' in event) out.to = mapValue(event.field, event.to)
    }
    return out
  }
  for (const item of snapshot.issues) {
    const dropped = []
    const id = idOf.get(item.id)
    if (/[\r\n]/.test(item.title)) problems.push({ kind: 'issue', key: item.id, code: 'line_break', message: `the title of ${item.id} has a line break` })
    const { type: labelType, labels } = splitLabels(item.labels)
    const type = item.type ?? labelType
    if (type && !target.types.includes(type)) problems.push({ kind: 'issue', key: item.id, code: 'no_type', message: `${item.id} has the type "${type}", which the Local tracker does not list` })
    if (item.milestone) {
      dropped.push('milestone')
      losses.add('milestones', item.id, '')
    }
    if ((item.labelGroups ?? []).length > 0) losses.add('label groups', item.id, '')
    const estimate = estimateOf(item.estimate)
    if (estimate === undefined) {
      dropped.push('estimate')
      losses.add('estimates', item.id, '')
    }
    const links = linksOf.get(item.id)
    const priority = target.priorities.includes(item.priority) ? item.priority : undefined
    const fields = {
      id,
      title: item.title,
      ...(type ? { type } : {}),
      status: statusOf(item.status, item.id),
      ...(priority ? { priority } : {}),
      ...(estimate !== undefined && estimate !== null ? { estimate } : {}),
      ...(item.assignee ? { assignee: named(item.assignee) } : {}),
      labels,
      ...(item.parent && localId(item.parent) ? { parent: localId(item.parent) } : {}),
      ...(links.blocked_by.length ? { blocked_by: links.blocked_by } : {}),
      ...(links.related.length ? { related: links.related } : {}),
      ...(links.duplicate_of.length ? { duplicate_of: links.duplicate_of } : {}),
      ...(item.sprint && sprintOf.has(String(item.sprint)) ? { sprint: sprintOf.get(String(item.sprint)) } : {}),
      ...(item.due ? { due: item.due } : {}),
      ...(item.archived ? { archived: true } : {}),
      created: item.created,
      description: item.description ?? '',
      acceptanceCriteria: item.acceptanceCriteria ?? [],
      events: (item.events ?? []).map(mapEvent).filter(Boolean),
    }
    records.issue.push({ key: item.id, source: { id: item.id, title: item.title, summary: fields.status ?? '' }, target: id, fields, refs: {}, dropped })
  }
  records.issue.sort((a, b) => byText(a.fields.created ?? '', b.fields.created ?? '') || compareIds(a.key, b.key))

  // The losses that hold for the whole import.
  const milestones = losses.get('milestones')
  if (milestones) milestones.why = `${plural(milestones.count, 'record')} lose their project milestone; Local milestones belong to no epic`
  const documents = losses.get('documents')
  if (documents) documents.why = `${plural(documents.count, 'project')} have documents that stay in Linear`
  const outside = (snapshot.outside?.parents ?? 0) + (snapshot.outside?.links ?? 0)
  losses.set('outside links', outside, [], `${plural(outside, 'parent or link', 'parents and links')} to issues of other teams will be dropped`)
  const groups = losses.get('label groups')
  if (groups) groups.why = `${plural(groups.count, 'issue')} have labels from a Linear label group, imported as plain labels`
  const renamed = losses.get('labels renamed')
  if (renamed) renamed.why = `${plural(renamed.count, 'label')} get a Local name in lower case with hyphens`
  const estimates = losses.get('estimates')
  if (estimates) estimates.why = `${plural(estimates.count, 'estimate')} outside the Local scale (${scale.join(', ')}) will be dropped`
  const statuses = losses.get('statuses')
  if (statuses) statuses.why = `${plural(statuses.count, 'Linear status', 'Linear statuses')} with no Local status of the same name take the Local status of their category`
  losses.set('cycle schedule', records.sprint.length, [], 'each cycle becomes one sprint file with its dates; the schedule stays in Linear')
  losses.set('ids', fresh, [], `${plural(fresh, 'record')} get new Local ids; the map keeps the Linear ones`)

  people.sort((a, b) => byText(a.id, b.id))
  return { records, losses: losses.list(), problems, people, readRequests }
}
