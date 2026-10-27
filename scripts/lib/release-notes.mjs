import { compareIds } from './ids.mjs'
import { eventInstant } from './metrics.mjs'

// Pure release notes functions: no file access. The caller passes records it already read from the tracker.

const DAY_MS = 86400000

const dateMinusDays = (today, days) => new Date(Date.parse(`${today}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10)

// A value that is no date sorts before every date.
const instantOf = (value) => (value === undefined || value === null ? -Infinity : eventInstant(value) || -Infinity)

/** The last item with the greatest key as an instant, so a tie goes to the later one in list order. */
function latestBy(list, key, keep) {
  let found = null
  for (const item of list) {
    if (!keep(item)) continue
    if (found === null || instantOf(item[key]) >= instantOf(found[key])) found = item
  }
  return found
}

/**
 * @param {object} input
 * @param {null | {release: object} | {sprint: object} | {since: string, until?: string}} input.selector records already read from the tracker, or null
 * @param {object[] | null} input.releases listReleases() output, or null when the releases capability is absent
 * @param {object[] | null} input.sprints listCycles() output, or null when the cycles capability is absent
 * @param {string} input.today YYYY-MM-DD, UTC
 * @param {number} input.windowDays
 * @returns {{ basis, reason, draft, source, period, skipped }}
 */
export function chooseBasis({ selector, releases, sprints, today, windowDays }) {
  if (selector?.release) {
    return { basis: 'release', reason: 'requested', draft: selector.release.state === 'planned', source: selector.release, period: null, skipped: [] }
  }
  if (selector?.sprint) {
    return { basis: 'sprint', reason: 'requested', draft: selector.sprint.state !== 'closed', source: selector.sprint, period: null, skipped: [] }
  }
  if (selector?.since !== undefined) {
    return { basis: 'period', reason: 'requested', draft: false, source: null, period: { since: selector.since, until: selector.until ?? today, defaulted: false }, skipped: [] }
  }
  const skipped = []
  const release = releases === null ? null : latestBy(releases, 'released', (r) => r.state === 'released')
  if (release !== null) return { basis: 'release', reason: 'latest', draft: false, source: release, period: null, skipped }
  skipped.push({ basis: 'release', reason: releases === null ? 'releases_absent' : 'no_released_release' })
  const sprint = sprints === null ? null : latestBy(sprints, 'end', (s) => s.state === 'closed')
  if (sprint !== null) return { basis: 'sprint', reason: skipped[0].reason, draft: false, source: sprint, period: null, skipped }
  skipped.push({ basis: 'sprint', reason: 'no_closed_sprint' })
  return { basis: 'period', reason: 'no_closed_sprint', draft: false, source: null, period: { since: dateMinusDays(today, windowDays), until: today, defaulted: true }, skipped }
}

/**
 * True when a closed sprint's issue moved to done after the sprint closed, so it did not ship with the sprint.
 * Same cut as velocity: the `closed` time, or the `end` date when the sprint has no `closed`. An unknown doneAt stays in.
 */
function finishedAfterClose({ basis, source }, doneAt) {
  if (basis !== 'sprint' || source?.state !== 'closed' || doneAt === null || doneAt === undefined) return false
  if (source.closed !== undefined) return eventInstant(doneAt) > eventInstant(source.closed)
  return String(doneAt).slice(0, 10) > source.end
}

const byCreation = (a, b) => {
  const x = String(a.created ?? '')
  const y = String(b.created ?? '')
  return x < y ? -1 : x > y ? 1 : compareIds(a.id, b.id)
}

const entryOf = (issue, doneAt) => ({
  id: issue.id,
  title: issue.title,
  description: issue.description ?? null,
  type: issue.type ?? null,
  labels: issue.labels ?? [],
  parent: issue.parent ?? null,
  archived: issue.archived === true,
  doneAt: doneAt ?? null,
  release: issue.release ?? null,
})

/**
 * @param {object} input
 * @param {object} input.choice the return value of chooseBasis
 * @param {{issue: object, doneAt: string | null}[]} input.candidates
 * @param {string[]} input.types the tracker's types, in order
 * @param {object[]} [input.problems=[]]
 */
export function buildNotes({ choice, candidates, types, problems = [] }) {
  const excluded = { open: 0, canceled: 0, chore: 0 }
  const listed = []
  for (const candidate of [...candidates].sort((a, b) => byCreation(a.issue, b.issue))) {
    const { issue } = candidate
    const category = issue.status?.category
    if (category === 'canceled') excluded.canceled += 1
    else if (category !== 'done' || finishedAfterClose(choice, candidate.doneAt)) excluded.open += 1
    else if (issue.type === 'chore') excluded.chore += 1
    else listed.push(candidate)
  }
  const groups = []
  for (const type of [...types, null]) {
    const members = listed.filter(({ issue }) => (type === null ? !types.includes(issue.type) : issue.type === type))
    if (members.length > 0) groups.push({ type, issues: members.map(({ issue, doneAt }) => entryOf(issue, doneAt)) })
  }
  const { basis, reason, draft, source, period, skipped } = choice
  return { basis, reason, draft, source, period, groups, counts: { done: listed.length, excluded }, skipped, problems }
}
