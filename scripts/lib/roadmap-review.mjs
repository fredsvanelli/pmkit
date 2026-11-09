// The roadmap review (PMK-66): pure functions, no tracker access. The CLI reads the tracker and passes the data in.
// A null input means the read failed or the tracker lacks it: it stays unknown and never becomes zero or "no update".

import { table } from './format.mjs'
import { dayNumber } from './metrics.mjs'
import { epicRisks, needsUpdate } from './risks.mjs'

const OPEN = (category) => category !== 'done' && category !== 'canceled'
const daysLate = (date, today) => (date && date < today ? dayNumber(today) - dayNumber(date) : 0)

function epicRows(epics, { today, windowDays, milestones, progressByEpic, updatesByEpic }) {
  const read = Object.fromEntries(epics.map((epic) => [epic.id, updatesByEpic[epic.id] ?? null]))
  const risks = new Map(epicRisks(epics, { updatesByEpic: read, today, windowDays }).map((row) => [row.id, row.reasons]))
  const nameOf = new Map((milestones ?? []).map((m) => [m.id, m.name ?? m.id]))
  // A Local epic names its milestone; a Linear milestone names its epic (project), and a project has several.
  // With the milestone list unread, only the epic's own milestone is known: the rest is unknown (null), not none.
  const milestonesOf = (epic) => {
    const ids = new Set([epic.milestone, ...(milestones ?? []).filter((m) => m.epic === epic.id).map((m) => m.id)])
    ids.delete(undefined)
    ids.delete(null)
    if (milestones === null && ids.size === 0) return null
    return [...ids].map((id) => ({ id, name: nameOf.get(id) ?? id }))
  }
  return epics.map((epic) => {
    const updates = updatesByEpic[epic.id] ?? null
    const latest = updates?.[0]
    const reasons = risks.get(epic.id) ?? []
    const owned = milestonesOf(epic)
    const p = progressByEpic[epic.id] ?? null
    return {
      id: epic.id, title: epic.title, status: epic.status.name, category: epic.status.category,
      start: epic.start ?? null, target: epic.target ?? null,
      milestone: owned?.[0]?.id ?? null, milestones: owned,
      progress: p === null ? null : { done: p.done, total: p.total, canceled: p.canceled, ...(p.hasMore === true ? { partial: true } : {}) },
      // A Local update file without health reads as '', which is unknown, not a health.
      // false: the update read failed, so a null lastUpdate is unknown, not "no update".
      updatesRead: updates !== null,
      lastUpdate: latest ? { at: latest.at, health: latest.health || null } : null,
      health: latest?.health || epic.health || null,
      delayDays: !epic.target ? null : OPEN(epic.status.category) ? daysLate(epic.target, today) : 0,
      reasons,
    }
  })
}

function milestoneRows(milestones, { today, issues, issuesComplete, epics, epicsFailed }) {
  const live = issues.filter((issue) => !issue.archived)
  const filed = milestones.map((m) => ({ id: m.id, name: m.name ?? m.id, due: m.due ?? null, filed: true, ...(m.unreadable ? { unreadable: true } : {}), owner: m.epic }))
  const known = new Set(filed.map((m) => m.id))
  const unfiled = []
  for (const id of [...(epics ?? []).map((epic) => epic.milestone), ...live.map((issue) => issue.milestone)]) {
    if (!id || known.has(id)) continue
    known.add(id)
    unfiled.push({ id, name: id, due: null, filed: false })
  }
  return [...filed, ...unfiled].map(({ owner, ...m }) => {
    const mine = live.filter((issue) => issue.milestone === m.id)
    const counts = { open: 0, done: 0, canceled: 0 }
    for (const issue of mine) counts[OPEN(issue.status.category) ? 'open' : issue.status.category]++
    const epicIds = (epics ?? []).filter((epic) => epic.milestone === m.id || owner === epic.id).map((epic) => epic.id)
    // Only an epic placed in the milestone (Local) is open work of it. A Linear milestone is a phase of its project
    // (owner), so the running project says nothing about the phase: its own issues decide.
    const openEpic = (epics ?? []).some((epic) => epic.milestone === m.id && OPEN(epic.status.category))
    let delayDays
    if (!m.due) delayDays = null
    else if (m.due >= today) delayDays = 0
    else if (openEpic || (issuesComplete && counts.open > 0)) delayDays = daysLate(m.due, today)
    // An unread epic list may hold the open epic that makes it late: unknown, unless an open issue already does.
    else delayDays = issuesComplete && !epicsFailed ? 0 : null
    return { ...m, issues: issuesComplete ? counts : null, epics: epicsFailed ? null : epicIds, delayDays }
  })
}

/** The open, non-archived issues past their due date, most late first: the review when the tracker has no epics. */
function lateIssueRows(issues, today) {
  return issues
    .filter((issue) => !issue.archived && OPEN(issue.status.category) && issue.due && issue.due < today)
    .map((issue) => ({ id: issue.id, title: issue.title, status: issue.status.name, due: issue.due, milestone: issue.milestone ?? null, delayDays: daysLate(issue.due, today) }))
    .sort((a, b) => b.delayDays - a.delayDays)
}

/**
 * The review. `epics` and `milestones` are null when unreadable; `progressByEpic[id]` and `updatesByEpic[id]` are null
 * when that read failed (updates newest first). `issuesComplete` is false when the issue read was cut.
 */
export function buildRoadmapReview({ today, windowDays, issues, issuesComplete, epics, milestones, progressByEpic, updatesByEpic, sectionErrors = {} }) {
  const rows = epics === null ? null : epicRows(epics, { today, windowDays, milestones, progressByEpic, updatesByEpic })
  const openRows = (rows ?? []).filter((row) => OPEN(row.category))
  // Only an epic that owes updates (the epicRisks rule) is unknown when its updates could not be read.
  const notChecked = openRows.filter((row) => updatesByEpic[row.id] == null && needsUpdate({ status: { category: row.category }, start: row.start }, { today, windowDays })).map((row) => row.id)
  const unread = (epics ?? []).some((epic) => progressByEpic[epic.id] == null || progressByEpic[epic.id].hasMore === true || updatesByEpic[epic.id] == null)
  return {
    today,
    statusUpdateWindowDays: windowDays,
    // null when the read worked; otherwise why the section is missing: NOT_SUPPORTED, or the code of the failed read.
    unavailable: { epics: epics === null ? sectionErrors.epics ?? 'NOT_SUPPORTED' : null, milestones: milestones === null ? sectionErrors.milestones ?? 'NOT_SUPPORTED' : null },
    epics: rows,
    milestones: milestones === null ? null : milestoneRows(milestones, { today, issues, issuesComplete, epics, epicsFailed: epics === null && (sectionErrors.epics ?? 'NOT_SUPPORTED') !== 'NOT_SUPPORTED' }),
    noRecentUpdates: (rows ?? []).filter((row) => row.reasons.includes('no_recent_update')).map((row) => row.id),
    updatesNotChecked: notChecked,
    // The fallback is for a tracker with no epics; a failed read says nothing about them.
    lateIssues: epics === null && (sectionErrors.epics ?? 'NOT_SUPPORTED') === 'NOT_SUPPORTED' ? lateIssueRows(issues, today) : null,
    incomplete: !issuesComplete || epics === null || milestones === null || unread,
    problems: [],
  }
}

function section(title, rows, { notChecked, header, row, after = [] }) {
  if (rows === null) return `${title}\nnot checked: ${notChecked}`
  const body = rows.length === 0 ? `${title}\nnone` : `${title} (${rows.length})\n${table(header, rows.map(row))}`
  return [body, ...after].join('\n')
}

const days = (value, missing) => (value === null ? missing : value === 0 ? '' : `${value}d late`)

/** The text report: a head, an optional incomplete line, and the epic, milestone and no-update sections. */
export function roadmapReviewText(report) {
  const cannot = (what) => {
    const code = report.unavailable?.[what]
    return code && code !== 'NOT_SUPPORTED' ? `the tracker failed to list ${what} (${code}), see the warnings` : `the tracker cannot list ${what}`
  }
  const head = [`roadmap review on ${report.today}: status updates due every ${report.statusUpdateWindowDays} days`]
  if (report.incomplete) head.push('incomplete: some reads failed or were cut; unknown values are shown as unknown, see the warnings')
  const blocks = [
    head.join('\n'),
    section('epics', report.epics, {
      notChecked: cannot('epics'),
      header: ['ID', 'Title', 'Status', 'Start', 'Target', 'Milestone', 'Done', 'Health', 'Last update', 'Delay', 'Reasons'],
      row: (r) => [
        r.id, r.title, r.status, r.start ?? '', r.target ?? '', r.milestones === null ? 'unknown' : r.milestones.map((m) => m.name).join(', '),
        r.progress ? `${r.progress.done}/${r.progress.total}${r.progress.partial ? '+' : ''}` : 'unknown', r.health ?? 'unknown',
        r.lastUpdate ? r.lastUpdate.at.slice(0, 10) : r.updatesRead === false ? 'not checked' : '', days(r.delayDays, 'no target'), r.reasons.join(', '),
      ],
    }),
    section('milestones', report.milestones, {
      notChecked: cannot('milestones'),
      header: ['ID', 'Name', 'Due', 'Open', 'Done', 'Canceled', 'Epics', 'Delay'],
      row: (m) => [
        m.id, m.name, m.due ?? (m.unreadable ? 'unknown, file does not parse' : m.filed ? 'none' : 'unknown, no record'),
        ...(m.issues ? [m.issues.open, m.issues.done, m.issues.canceled] : ['unknown', 'unknown', 'unknown']),
        m.epics === null ? 'unknown' : m.epics.join(', '), days(m.delayDays, m.due || m.unreadable || !m.filed ? 'unknown' : 'no due date'),
      ],
    }),
    section('epics with no recent status update', report.epics === null ? null : report.epics.filter((r) => report.noRecentUpdates.includes(r.id)), {
      notChecked: cannot('epics'),
      header: ['ID', 'Title', 'Status', 'Last update'],
      row: (r) => [r.id, r.title, r.status, r.lastUpdate ? r.lastUpdate.at.slice(0, 10) : 'none'],
      after: report.updatesNotChecked.length ? [`not checked: ${report.updatesNotChecked.join(', ')}`] : [],
    }),
  ]
  if (report.lateIssues !== null) {
    blocks.push(section('late issues', report.lateIssues, {
      header: ['ID', 'Title', 'Status', 'Due', 'Milestone', 'Delay'],
      row: (r) => [r.id, r.title, r.status, r.due, r.milestone ?? '', days(r.delayDays, '')],
    }))
  }
  return blocks.join('\n\n')
}
