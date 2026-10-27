// Pure release notes functions: no file access. The caller passes records it already read from the tracker.

const DAY_MS = 86400000

const dateMinusDays = (today, days) => new Date(Date.parse(`${today}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10)

/** The last item with the greatest key, so a tie goes to the later one in list order. */
function latestBy(list, key, keep) {
  let found = null
  for (const item of list) {
    if (!keep(item)) continue
    if (found === null || String(item[key] ?? '') >= String(found[key] ?? '')) found = item
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
