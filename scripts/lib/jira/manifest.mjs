// The capability manifest of the Jira tracker: one entry per capability, from the raw discovery and the config.
// See "The manifest" in docs/superpowers/specs/2026-11-22-pmk-76-jira-discovery-and-manifest-design.md.

import { CAPABILITIES } from '../capabilities.mjs'
import { CAPACITY_FILE } from '../capacity-store.mjs'
import { fieldRoles } from './discovery.mjs'

/** The capabilities the Jira adapter serves. PMK-77 to PMK-80 add theirs as they implement the operations behind them. */
export const SERVED = Object.freeze({ cycles: true, capacity: true, linked_code: true, estimation: true, multilevel_hierarchy: true, dependencies: true, native_metrics: true })

/** The issue that serves each capability, for the hint of an unserved one. */
const SERVED_IN = {
  deliverables: 'PMK-79', status_update: 'PMK-79', releases: 'PMK-79',
  time_tracking: 'PMK-80',
}
const unservedHint = (id) => `The Jira adapter does not serve ${id} yet${SERVED_IN[id] ? ` (${SERVED_IN[id]})` : ''}`
const ENABLE_GIT_HINT = 'Set git_host in .pmkit/config.yaml'
const absent = (enableHint) => ({ path: 'absent', enableHint })

/** Sprints need Jira Software (any plan), a Scrum board and the Sprint field; an unread license defers to the board. */
function cycles(raw, pmkit) {
  if (raw.license?.software === 'unlicensed') return absent('Sprints need Jira Software')
  if (raw.board?.type !== 'scrum') return absent(`Sprints need a Scrum board in space ${raw.space.key}`)
  if (!fieldRoles(raw, pmkit).fields.sprint) return absent(`No sprint field in space ${raw.space.key}`)
  return { path: 'native' }
}

/** What the site's license, space and global settings allow, before the served rule. null: Jira offers it, nothing to say. */
function siteAnswers(raw, pmkit) {
  const key = raw.space.key
  const levels = [...new Set(raw.workTypes.map((type) => type.level))]
  const estimate = fieldRoles(raw, pmkit).fields.estimate
  // Unread settings: issue linking and time tracking are on by default in Jira, and discover warns.
  const setting = (name) => raw.settings === null || raw.settings?.[name] === true
  const sprints = cycles(raw, pmkit)
  return {
    cycles: sprints,
    estimation: estimate
      ? { path: 'native', detail: { unit: estimate.id === 'timeoriginalestimate' ? 'hours' : 'points', field: estimate.id } }
      : absent(`No estimate field in space ${key}`),
    multilevel_hierarchy: levels.some((level) => level !== 'standard') ? { path: 'native', detail: { levels } } : absent(`Space ${key} has no epic or subtask work type`),
    dependencies: setting('issueLinking') ? { path: 'native' } : absent("Turn on issue linking in Jira's global settings"),
    native_triage: absent('Jira has no triage; map a status to triage in .pmkit/config.yaml'),
    deliverables: levels.includes('epic') ? { path: 'native', detail: { entity: 'epic' } } : absent(`Space ${key} has no epic work type`),
    strategic_goals: absent('Jira goals live in Atlassian Home, which pmkit does not read'),
    status_update: null,
    releases: { path: 'native', detail: { entity: 'version' } },
    capacity: sprints.path === 'absent' ? absent('Capacity needs cycles') : { path: 'derived', detail: { source: 'local', file: CAPACITY_FILE } },
    native_metrics: { path: 'derived', detail: { source: 'history' } },
    saved_views: { path: 'native', detail: { source: 'filters' } },
    documents: absent('Jira has no documents'),
    demand_signals: null,
    request_queue: null,
    time_tracking: setting('timeTracking') ? { path: 'native' } : absent("Turn on time tracking in Jira's global settings"),
    linked_code: { path: 'derived', detail: { source: 'git' }, ...((pmkit?.git_host?.system ?? 'none') === 'none' ? { enableHint: ENABLE_GIT_HINT } : {}) },
    agent_delegation: null,
    security_alerts: null,
    user_inbox: null,
  }
}

/**
 * The 20 entries in spec order. A served capability takes the site's answer. An unserved one is absent: with the site's
 * hint when the site lacks it, else with the unserved hint and the site's path in detail.site.
 */
export function buildJiraCapabilities(raw, pmkit = {}, served = SERVED) {
  const answers = siteAnswers(raw, pmkit)
  return CAPABILITIES.map((id) => {
    const answer = answers[id]
    if (answer === null) return { id, ...absent(unservedHint(id)) }
    if (served[id] || answer.path === 'absent') return { id, ...answer }
    return { id, path: 'absent', detail: { site: answer.path, ...answer.detail }, enableHint: unservedHint(id) }
  })
}
