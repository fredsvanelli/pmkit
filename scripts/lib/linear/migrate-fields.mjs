// The export field mapping: a Local snapshot as Linear creates, one record per write. Pure.
// See the PMK-41 spec, "Order of writes", "Field by field (export)" and "What does not round-trip".

import { compareIds } from '../ids.mjs'
import { attributionLine, linkKey } from '../migrate/snapshot.mjs'
import { estimateScale } from './discovery.mjs'
import { buildDescription, PRIORITY_TO_LINEAR } from './issues.mjs'
import { resolveMappings } from './mappings.mjs'
import { HEALTH_TO_LINEAR } from './projects.mjs'
import { toSprint } from './cycles.mjs'
import { teamStates } from './writes.mjs'

/** The Linear project status type of each Local category, PMK-38's map read the other way. */
export const PROJECT_TYPE_OF_CATEGORY = Object.freeze({
  triage: 'backlog', backlog: 'backlog', todo: 'planned', in_progress: 'started', in_review: 'started', done: 'completed', canceled: 'canceled',
})

export const EXPORT_LOSSES = [
  'sprints', 'sprint names', 'history', 'epic dates', 'comments', 'status updates', 'milestones', 'releases', 'time logs', 'documents',
  'branch names', 'ids', 'estimates', 'members', 'links', 'capacity',
]

export const EXPORT_READ_REQUESTS = 10

const lower = (value) => String(value ?? '').toLowerCase()
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)))

/** What the export writes into: the team, its states, labels, users, estimate scale, cycles, project statuses and mappings. */
export function exportTarget({ raw, view, pmkit, teamKey, projectStatuses = [], cycles = [] }) {
  const scoped = { ...pmkit, tracker: { ...pmkit.tracker, system: 'linear', scope: { ...pmkit.tracker?.scope, team: teamKey } } }
  const team = raw.teams.find((item) => item.key === teamKey)
  const mappings = resolveMappings(view, scoped, raw)
  const labels = new Map()
  for (const label of raw.labels.filter((item) => !item.isGroup && item.team === null)) labels.set(lower(label.name), label)
  for (const label of raw.labels.filter((item) => !item.isGroup && item.team === team.id)) labels.set(lower(label.name), label)
  const users = new Map(raw.users.filter((user) => !user.app && user.email).map((user) => [lower(user.email), user]))
  return {
    workspace: raw.workspace?.urlKey,
    team,
    states: teamStates({ raw }, team),
    labels,
    users,
    estimate: estimateScale(team.estimation),
    cycles: cycles.map((node) => ({ id: node.id, number: node.number, sprint: toSprint(node) })),
    projectStatuses: [...projectStatuses].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    mappings,
    typeLabels: pmkit.mappings?.types ?? {},
    estimateField: pmkit.mappings?.fields?.estimate ?? null,
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
    list: () => EXPORT_LOSSES.filter((what) => losses.has(what)).map((what) => losses.get(what)),
  }
}

export function mapExport(snapshot, target) {
  const { team, mappings } = target
  const problems = []
  const losses = lossTable()
  const records = { label: [], epic: [], issue: [], link: [], comment: [], thread: [], update: [], archive: [] }
  const members = new Map(snapshot.people.map((person) => [person.id, person]))
  const issues = new Map(snapshot.issues.map((issue) => [issue.id, issue]))
  const epics = new Map(snapshot.epics.map((epic) => [epic.id, epic]))

  // People: a member matches the Linear user with the same email, ignoring case. An app user never matches.
  const userOf = (memberId) => {
    const email = members.get(memberId)?.email
    return email ? target.users.get(lower(email)) ?? null : null
  }
  const people = [...snapshot.people].sort((a, b) => byText(a.id, b.id)).map((person) => {
    const user = userOf(person.id)
    return { id: person.id, name: person.name, email: person.email, note: user ? `matches Linear user ${user.name}` : 'no Linear user', user: user?.id ?? null }
  })

  // Labels: every Local label and every type label that neither the team nor the workspace has.
  const toCreate = new Map()
  const wantLabel = (name, why) => {
    if (typeof name !== 'string' || name === '' || name === 'none' || target.labels.has(lower(name))) return
    if (![...toCreate.keys()].some((key) => lower(key) === lower(name))) toCreate.set(name, why)
  }
  for (const name of snapshot.labels) wantLabel(name, 'Local label')
  for (const issue of snapshot.issues) for (const name of issue.labels ?? []) wantLabel(name, 'Local label')
  for (const [type, name] of Object.entries(target.typeLabels)) wantLabel(name, `type label for ${type}`)
  for (const [name, why] of [...toCreate.entries()].sort(([a], [b]) => byText(a, b))) {
    records.label.push({ key: name, source: { id: name, title: '', summary: why }, target: null, fields: { name, teamId: team.id }, refs: {}, dropped: [] })
  }
  const labelRef = (name) => {
    const existing = target.labels.get(lower(name))
    if (existing) return { id: existing.id }
    const created = [...toCreate.keys()].find((key) => lower(key) === lower(name))
    return created ? { ref: { kind: 'label', key: created } } : null
  }

  // Epics as projects.
  const statusIdOf = (category) => {
    const type = PROJECT_TYPE_OF_CATEGORY[category] ?? 'backlog'
    return target.projectStatuses.find((status) => status.type === type)?.id ?? target.projectStatuses[0]?.id
  }
  for (const epic of snapshot.epics) {
    const dropped = []
    if (/[\r\n]/.test(epic.title)) problems.push({ kind: 'epic', key: epic.id, code: 'line_break', message: `the title of ${epic.id} has a line break, which Linear refuses` })
    if (epic.milestone) {
      dropped.push('milestone')
      losses.add('milestones', epic.id, '')
    }
    records.epic.push({
      key: epic.id,
      source: { id: epic.id, title: epic.title, summary: epic.status?.name ?? '' },
      target: null,
      fields: compact({ name: epic.title, teamIds: [team.id], content: epic.description, startDate: epic.start, targetDate: epic.target, statusId: statusIdOf(epic.status?.category) }),
      refs: {},
      dropped,
    })
  }

  // Issues.
  const sprints = new Map(snapshot.sprints.map((sprint) => [sprint.id, sprint]))
  const cycleOf = (sprint) => target.cycles.find((cycle) => cycle.sprint.start === sprint.start && cycle.sprint.end === sprint.end) ?? null
  const noCycleSprints = new Set()
  let noCycleIssues = 0
  const stateFor = (status) => {
    const category = status?.category
    if (!category) return null
    const same = target.states.find((state) => lower(state.name) === lower(status.name) && mappings.categoryOf(state.name) === category)
    if (same) return { id: same.id, name: same.name }
    return mappings.targetState(category)
  }
  const epicOf = (issue) => {
    const seen = new Set()
    let current = issue
    while (current?.parent && !seen.has(current.id)) {
      seen.add(current.id)
      if (epics.has(current.parent)) return current.parent
      current = issues.get(current.parent)
    }
    return null
  }
  const scale = target.estimate
  const nativeEstimate = target.estimateField === 'native' && mappings.estimate === 'native'
  const estimateFits = (value) => {
    if (!nativeEstimate || value === null || value === undefined) return undefined
    if (scale.unit === 'sizes') {
      if (typeof value === 'string' && Object.hasOwn(scale.values, value)) return scale.values[value]
      return typeof value === 'number' && Object.values(scale.values).includes(value) ? value : undefined
    }
    return scale.scale.includes(value) ? value : undefined
  }
  for (const issue of snapshot.issues) {
    const dropped = []
    const refs = {}
    const summary = []
    if (/[\r\n]/.test(issue.title)) problems.push({ kind: 'issue', key: issue.id, code: 'line_break', message: `the title of ${issue.id} has a line break, which Linear refuses` })
    const state = stateFor(issue.status)
    if (!state) {
      const category = issue.status?.category ?? 'unknown'
      problems.push({ kind: 'issue', key: issue.id, code: 'no_state', message: `team ${team.key} has no state in the ${category} category for ${issue.id} (status ${issue.status?.name}); set mappings.status.${category}` })
    } else summary.push(state.name)
    const labelIds = []
    const labelRefs = []
    const addLabel = (name) => {
      const found = labelRef(name)
      if (found?.id && !labelIds.includes(found.id)) labelIds.push(found.id)
      if (found?.ref && !labelRefs.some((ref) => ref.key === found.ref.key)) labelRefs.push(found.ref)
    }
    if (issue.type) {
      const name = target.typeLabels[issue.type]
      if (name === undefined) problems.push({ kind: 'issue', key: issue.id, code: 'no_type_label', message: `type ${issue.type} of ${issue.id} has no label in mappings.types; pass --type-label ${issue.type}=<label>` })
      else if (name !== 'none') addLabel(name)
    }
    for (const name of issue.labels ?? []) addLabel(name)
    if (labelRefs.length > 0) refs.labelIds = labelRefs

    if (issue.parent && issues.has(issue.parent)) {
      refs.parentId = { kind: 'issue', key: issue.parent }
      summary.push(`parent ${issue.parent}`)
    } else if (issue.parent && epics.has(issue.parent)) summary.push(`parent ${issue.parent}`)
    else if (issue.parent) dropped.push('parent')
    const epic = epicOf(issue)
    if (epic) refs.projectId = { kind: 'epic', key: epic }

    const estimate = estimateFits(issue.estimate)
    if (issue.estimate !== null && issue.estimate !== undefined && estimate === undefined) {
      dropped.push('estimate')
      losses.add('estimates', issue.id, '')
    }
    let assigneeId
    if (issue.assignee) {
      const user = userOf(issue.assignee)
      if (user) assigneeId = user.id
      else {
        dropped.push('assignee')
        losses.add('members', issue.id, '')
      }
    }
    let cycleId
    if (issue.sprint) {
      const sprint = sprints.get(issue.sprint)
      const cycle = sprint ? cycleOf(sprint) : null
      if (cycle) {
        cycleId = cycle.id
        summary.push(`cycle ${cycle.number}`)
      } else {
        dropped.push('sprint')
        noCycleSprints.add(issue.sprint)
        noCycleIssues++
        summary.push(`sprint ${issue.sprint} has no cycle`)
      }
    }
    if (issue.milestone) {
      dropped.push('milestone')
      losses.add('milestones', issue.id, '')
    }
    if (issue.release) {
      dropped.push('release')
      losses.add('releases', issue.id, '')
    }
    if (issue.branch) {
      dropped.push('branch')
      losses.add('branch names', issue.id, '')
    }
    const description = buildDescription(issue.description ?? '', issue.acceptanceCriteria ?? [])
    records.issue.push({
      key: issue.id,
      source: { id: issue.id, title: issue.title, summary: summary.join(', ') },
      target: null,
      fields: compact({
        teamId: team.id,
        title: issue.title,
        description,
        stateId: state?.id,
        labelIds,
        priority: issue.priority ? PRIORITY_TO_LINEAR[issue.priority] : undefined,
        estimate,
        assigneeId,
        dueDate: issue.due,
        createdAt: issue.created,
        completedAt: issue.status?.category === 'done' ? issue.completed : undefined,
        cycleId,
      }),
      refs,
      dropped,
    })
    if (issue.archived) {
      records.archive.push({ key: issue.id, source: { id: issue.id, title: issue.title }, target: null, fields: {}, refs: { issueId: { kind: 'issue', key: issue.id } }, dropped: [] })
    }
  }
  for (const sprint of snapshot.sprints) if (!cycleOf(sprint)) noCycleSprints.add(sprint.id)
  if (noCycleSprints.size > 0) {
    losses.set('sprints', noCycleSprints.size, [...noCycleSprints].sort(), `${plural(noCycleSprints.size, 'sprint')} ${noCycleSprints.size === 1 ? 'has' : 'have'} no Linear cycle with the same dates; ${plural(noCycleIssues, 'issue')} will have no cycle`)
  }

  // Links whose two ends are in the migration.
  for (const link of snapshot.links) {
    if (!issues.has(link.from) || !issues.has(link.to)) {
      losses.add('links', linkKey(link), '')
      continue
    }
    records.link.push({
      key: linkKey(link),
      source: { id: `${link.from} ${link.kind} ${link.to}`, title: '', kind: link.kind },
      target: null,
      fields: { type: link.kind },
      refs: { issueId: { kind: 'issue', key: link.from }, relatedIssueId: { kind: 'issue', key: link.to } },
      dropped: [],
    })
  }

  // Comments, with the attribution line, then the resolved threads.
  for (const comment of snapshot.comments) {
    if (!issues.has(comment.issue)) continue
    const name = members.get(comment.author)?.name ?? comment.author
    const refs = { issueId: { kind: 'issue', key: comment.issue } }
    if (comment.parent) refs.parentId = { kind: 'comment', key: comment.parent }
    records.comment.push({
      key: comment.id,
      source: { id: comment.id, title: `by ${comment.author} on ${String(comment.created).slice(0, 10)}`, summary: comment.parent ? 'reply' : '' },
      target: null,
      fields: { body: `${attributionLine({ name, created: comment.created, issue: comment.issue })}\n\n${comment.body}`, createdAt: comment.created },
      refs,
      dropped: ['author'],
    })
    if (comment.resolved && !comment.parent) {
      records.thread.push({ key: comment.id, source: { id: comment.id, title: '' }, target: null, fields: {}, refs: { commentId: { kind: 'comment', key: comment.id } }, dropped: [] })
    }
  }

  // Status updates, oldest first (the plan orders them).
  for (const epic of snapshot.epics) {
    for (const update of epic.updates ?? []) {
      records.update.push({
        key: update.id,
        source: { id: update.id, title: `${update.health} by ${update.author}`, summary: '' },
        target: null,
        fields: compact({ body: update.body, health: HEALTH_TO_LINEAR[update.health] }),
        refs: { projectId: { kind: 'epic', key: epic.id } },
        dropped: ['date', 'author'],
      })
    }
  }

  // The losses that hold for the whole tracker.
  const out = snapshot.outOfScope ?? {}
  const issueIds = snapshot.issues.map((issue) => issue.id).sort(compareIds)
  losses.set('history', snapshot.issues.length, issueIds, 'events.jsonl is not replayed; creation and completion dates are kept')
  const sprintIds = snapshot.sprints.map((sprint) => sprint.id).sort()
  losses.set('sprint names', sprintIds.length, sprintIds, `${plural(sprintIds.length, 'sprint')} lose their name and goal; the Linear cycle of the same dates keeps its own`)
  const epicIds = snapshot.epics.map((epic) => epic.id).sort(compareIds)
  losses.set('epic dates', epicIds.length, epicIds, `${plural(epicIds.length, 'epic')} get the migration time as their creation time; the export sends no creation time for a project`)
  const commentCount = records.comment.length
  losses.set('comments', commentCount, [], `${plural(commentCount, 'comment')} will show the key owner as author; each starts with a line naming the original author`)
  losses.set('status updates', records.update.length, records.update.map((record) => record.key), `${plural(records.update.length, 'status update')} will be dated at the migration and authored by the key owner`)
  if (out.milestones > 0 && !losses.get('milestones')) losses.set('milestones', out.milestones, [], `${plural(out.milestones, 'milestone')} stay in .issues/milestones/`)
  const milestones = losses.get('milestones')
  if (milestones) milestones.why = `${plural(milestones.count, 'record')} lose their milestone; pmkit cannot create Linear milestones`
  const releases = losses.get('releases')
  if (releases) releases.why = `${plural(releases.count, 'issue')} lose their release; pmkit has no Linear release mapping`
  else if (out.releases > 0) losses.set('releases', out.releases, [], `${plural(out.releases, 'release')} stay in .issues/releases/; pmkit has no Linear release mapping`)
  losses.set('time logs', out.timeLogs ?? 0, [], `${plural(out.timeLogs ?? 0, 'time log')} stay in events.jsonl; Linear has no time tracking`)
  losses.set('documents', out.documents ?? 0, [], `${plural(out.documents ?? 0, 'document')} stay in .issues/docs/`)
  const branches = losses.get('branch names')
  if (branches) branches.why = `${plural(branches.count, 'issue')} get the branch name Linear gives them; the map keeps the old id`
  const ids = snapshot.issues.length + snapshot.epics.length
  losses.set('ids', ids, [], `${plural(ids, 'record')} get new Linear identifiers; the map keeps the old ones`)
  const estimates = losses.get('estimates')
  if (estimates) estimates.why = `${plural(estimates.count, 'estimate')} ${nativeEstimate ? `outside the team's scale (${scale.unit === 'sizes' ? scale.scale.join(', ') : scale.scale.join(', ')})` : 'with estimates off'} will be dropped`
  const unassigned = losses.get('members')
  if (unassigned) unassigned.why = `${plural(unassigned.count, 'issue')} assigned to a member with no Linear user of the same email will be unassigned`
  const links = losses.get('links')
  if (links) links.why = `${plural(links.count, 'link')} to an issue that does not exist will be dropped`
  losses.set('capacity', snapshot.sprints.length, [], 'capacity and days off stay in the Local sprint files')

  return { records, losses: losses.list(), problems, people, readRequests: EXPORT_READ_REQUESTS }
}
