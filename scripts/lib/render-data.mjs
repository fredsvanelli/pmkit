// Reads the tracker through contract operations and returns the plain data the views in render.mjs take.
// Every string stays raw tracker text; only the writers escape. Members show by name, never by email.

import { PmkitError } from './errors.mjs'
import { CATEGORIES, TERMINAL, compareTimes } from './model.mjs'

const OPEN = CATEGORIES.filter((category) => !TERMINAL.includes(category))

/**
 * One read of every issue, archived ones included, so an archived blocker is found and not counted missing.
 * `live` drops archived issues. `asOf` is the newest `updated` of `live`, or null when there is none.
 */
export function readTracker(tracker) {
  const found = tracker.searchIssues({ archived: true })
  const live = found.issues.filter((issue) => !issue.archived)
  const byId = new Map(found.issues.map((issue) => [issue.id, issue]))
  const asOf = live.reduce((newest, issue) => (newest === null || compareTimes(issue.updated, newest) > 0 ? issue.updated : newest), null)
  const problems = found.problems.map(({ id, code, message }) => ({ id, code, message }))
  return { live, byId, problems, asOf }
}

/** The row an issue table shows. `members` is `local.members`, in config order. */
export function issueRow(issue, byId, members) {
  const assignee = issue.assignee === undefined || issue.assignee === null ? '' : members[issue.assignee]?.name ?? issue.assignee
  const blockedBy = (issue.blockedBy ?? []).filter((id) => {
    const blocker = byId.get(id)
    return !blocker || !TERMINAL.includes(blocker.status.category)
  })
  return {
    id: issue.id,
    title: issue.title,
    type: issue.type ?? '',
    priority: issue.priority ?? '',
    assignee,
    estimate: issue.estimate ?? null,
    blockedBy,
    labels: issue.labels ?? [],
  }
}

const base = (read, local) => ({ asOf: read.asOf, problems: read.problems, unit: local.estimate.unit })

/** The open statuses in category order, then config order. */
function openStatuses(local) {
  const rank = (name) => CATEGORIES.indexOf(local.statuses[name].category)
  return Object.keys(local.statuses)
    .filter((name) => OPEN.includes(local.statuses[name].category))
    .map((name, index) => ({ name, index }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.index - b.index)
    .map((entry) => entry.name)
}

export function boardData(tracker, local) {
  const read = readTracker(tracker)
  const members = local.members ?? {}
  const count = (category) => read.live.filter((issue) => issue.status.category === category).length
  return {
    ...base(read, local),
    statuses: openStatuses(local).map((name) => ({
      name,
      issues: read.live.filter((issue) => issue.status.name === name).map((issue) => issueRow(issue, read.byId, members)),
    })),
    done: count('done'),
    canceled: count('canceled'),
  }
}

/** The first paragraph of a description, on one line. */
const firstParagraph = (text) => (text ?? '').trim().split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, ' ').trim()

function epicRow(tracker, epic) {
  const progress = tracker.deliverableProgress(epic.id)
  const update = tracker.listStatusUpdates(epic.id)[0]
  return {
    id: epic.id,
    title: epic.title,
    status: epic.status?.name ?? '',
    start: epic.start ?? null,
    target: epic.target ?? null,
    done: progress.done,
    total: progress.total,
    points: progress.points,
    pointsDone: progress.pointsDone,
    health: update?.health ?? null,
    healthDate: update ? update.at.slice(0, 10) : null,
  }
}

/** Milestone files in listMilestones order, then the names issues or epics use without a file, by name, then the epics with no milestone. */
export function roadmapData(tracker, local) {
  const read = readTracker(tracker)
  const epics = tracker.listDeliverables().map((epic) => ({ epic, row: epicRow(tracker, epic) }))
  const milestones = tracker.listMilestones()
  const filed = new Set(milestones.map((m) => m.id))
  const unfiled = [...new Set([...read.live.map((issue) => issue.milestone), ...epics.map(({ epic }) => epic.milestone)])]
    .filter((name) => typeof name === 'string' && name !== '' && !filed.has(name))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const group = (key, fields) => {
    const issues = read.live.filter((issue) => issue.milestone === key && issue.status.category !== 'canceled')
    return {
      ...fields,
      issuesDone: issues.filter((issue) => issue.status.category === 'done').length,
      issuesTotal: issues.length,
      epics: epics.filter(({ epic }) => epic.milestone === key).map(({ row }) => row),
    }
  }
  return {
    ...base(read, local),
    groups: [
      ...milestones.map((m) => group(m.id, { id: m.id, name: m.name, due: m.due ?? null, filed: true, summary: firstParagraph(m.description) })),
      ...unfiled.map((name) => group(name, { id: null, name, due: null, filed: false, summary: '' })),
    ],
    noMilestone: epics.filter(({ epic }) => !epic.milestone).map(({ row }) => row),
  }
}

function findSprint(tracker, sprint) {
  if (sprint === 'current') {
    const active = tracker.currentCycle()
    if (active === null) throw new PmkitError('INVALID_INPUT', 'there is no active sprint', 'pmkit cycle list')
    return active
  }
  const found = tracker.listCycles().find((s) => s.id === String(sprint))
  if (found === undefined) throw new PmkitError('NOT_FOUND', `sprint ${sprint} does not exist`, 'pmkit cycle list')
  return found
}

const numeric = (value) => (typeof value === 'number' ? value : 0)
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The sprint view of `sprint`, which is `current` or an id. The sprint issues come from the one readTracker read
 * (`issue.sprint === id`, what cycleIssues returns), so the totals, the as-of line and the problems agree.
 * Canceled issues count as issues but add no points. Days off do not show.
 */
export function sprintData(tracker, local, sprint) {
  const found = findSprint(tracker, sprint)
  const read = readTracker(tracker)
  const members = local.members ?? {}
  const issues = read.live.filter((issue) => issue.sprint === found.id)
  const counted = issues.filter((issue) => issue.status.category !== 'canceled')
  const isDone = (issue) => issue.status.category === 'done'
  const sum = (list) => list.reduce((total, issue) => total + numeric(issue.estimate), 0)
  const byCategory = {}
  for (const category of CATEGORIES) {
    const n = issues.filter((issue) => issue.status.category === category).length
    if (n > 0) byCategory[category] = n
  }
  const capacityMap = found.capacity ?? {}
  const assignees = new Set(counted.map((issue) => issue.assignee).filter((id) => id !== undefined && id !== null))
  const ids = [
    ...Object.keys(members).filter((id) => id in capacityMap || assignees.has(id)),
    ...[...new Set([...Object.keys(capacityMap), ...assignees])].filter((id) => !(id in members)).sort(byId),
  ]
  const capacityRow = (member, capacity, list) => ({ member, capacity, assigned: sum(list), done: sum(list.filter(isDone)) })
  const capacity = ids.map((id) => capacityRow(members[id]?.name ?? id, capacityMap[id] ?? null, counted.filter((issue) => issue.assignee === id)))
  const unassigned = counted.filter((issue) => issue.assignee === undefined || issue.assignee === null)
  if (unassigned.length > 0) capacity.push(capacityRow('Unassigned', null, unassigned))
  return {
    ...base(read, local),
    sprint: { id: found.id, name: found.name, start: found.start, end: found.end, state: found.state, goal: found.goal ?? null },
    totals: { issues: issues.length, points: sum(counted), pointsDone: sum(counted.filter(isDone)), byCategory },
    capacity,
    sections: CATEGORIES
      .map((category) => ({ category, issues: issues.filter((issue) => issue.status.category === category).map((issue) => issueRow(issue, read.byId, members)) }))
      .filter((section) => section.issues.length > 0),
  }
}
