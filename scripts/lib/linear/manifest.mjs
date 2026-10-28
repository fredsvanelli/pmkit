// The capability manifest of the Linear tracker: one entry per capability, from the raw discovery and the config.
// See "The capability manifest" in docs/superpowers/specs/2026-10-27-pmk-33-linear-discovery-design.md.

import { CAPABILITIES, SERVED_BY } from '../capabilities.mjs'
import { estimateScale } from './discovery.mjs'

/**
 * What the Linear API has, whatever the workspace: PMK-29's API check and the introspection the spec records.
 * Capabilities missing here depend on a setting, the plan or pmkit, and buildLinearCapabilities decides them.
 */
export const LINEAR_CAPABILITIES = Object.freeze({
  multilevel_hierarchy: { path: 'native' },
  dependencies: { path: 'native' },
  deliverables: { path: 'native', detail: { entity: 'project' } },
  status_update: { path: 'native' },
  native_metrics: { path: 'derived', detail: { source: 'history' } },
  saved_views: { path: 'native' },
  documents: { path: 'native' },
  time_tracking: { path: 'absent', enableHint: 'Linear has no time tracking' },
  security_alerts: { path: 'absent', enableHint: 'Linear has no security alerts' },
  user_inbox: { path: 'native' },
})

export const BUSINESS_PLANS = ['business', 'enterprise', 'trial']
const GIT_INTEGRATIONS = ['github', 'gitlab']
const ENABLE_GIT_HINT = 'Set git_host in .pmkit/config.yaml'
const unservedHint = (id) => `No pmkit command serves ${id} yet; Linear offers it on this workspace`

const TEAM_SETTINGS = {
  cycles: { on: (team) => team.cyclesEnabled, hint: "Turn on cycles in the team's settings in Linear" },
  estimation: { on: (team) => team.estimation.type !== 'notUsed', hint: "Turn on estimates in the team's settings in Linear" },
  native_triage: { on: (team) => team.triageEnabled, hint: "Turn on triage in the team's settings in Linear" },
}

/** native when every team in scope has the setting on, conditional with the keys when some do, absent when none do or no team exists. */
function teamSetting(teams, { on, hint }) {
  const enabled = teams.filter(on)
  if (enabled.length === 0) return { path: 'absent', enableHint: hint }
  if (enabled.length === teams.length) return { path: 'native' }
  return { path: 'conditional', detail: { teams: enabled.map((team) => team.key) } }
}

/** The estimate scale for the detail: the one team's, or the scale every team shares, else an empty points scale. */
function sharedScale(teams) {
  const scales = teams.filter(TEAM_SETTINGS.estimation.on).map((team) => estimateScale(team.estimation))
  const same = scales.length > 0 && scales.every((scale) => JSON.stringify(scale) === JSON.stringify(scales[0]))
  const { unit, scale } = same ? scales[0] : { unit: 'points', scale: [] }
  return { unit, scale }
}

/**
 * Linear's own answer for the capabilities that depend on a setting or the plan, before the served-by rule.
 * An absent answer carries the hint that names the plan or the setting.
 */
function workspaceAnswers(raw) {
  const business = BUSINESS_PLANS.includes(raw.workspace.plan)
  const { releasesEnabled, customersEnabled } = raw.flags
  return {
    strategic_goals: business ? { path: 'native' } : { path: 'absent', enableHint: 'Linear initiatives need the Business or Enterprise plan' },
    releases: releasesEnabled
      ? { path: 'native' }
      : { path: 'absent', enableHint: 'Linear releases need the Business or Enterprise plan and releases turned on in the workspace settings' },
    demand_signals: customersEnabled
      ? { path: 'native' }
      : { path: 'absent', enableHint: 'Linear customer requests need the Business or Enterprise plan and customers turned on in the workspace settings' },
    request_queue: business ? { path: 'conditional' } : { path: 'absent', enableHint: 'Linear Asks need the Business or Enterprise plan' },
    agent_delegation: { path: 'conditional', detail: { agents: raw.users.filter((user) => user.app).map((user) => user.name) } },
  }
}

/**
 * The 20 capability entries in spec order. pmkit is config.pmkit: tracker.scope.team picks the team whose settings decide,
 * and git_host.system words linked_code. A capability that no command in SERVED_BY serves is absent, with Linear's path in
 * detail.workspace when Linear offers it.
 */
export function buildLinearCapabilities(raw, pmkit = {}) {
  const configured = pmkit?.tracker?.scope?.team
  const chosen = configured ? raw.teams.find((team) => team.key === configured) : undefined
  const teams = chosen ? [chosen] : raw.teams
  const gitHost = pmkit?.git_host?.system ?? 'none'

  const answers = { ...LINEAR_CAPABILITIES, ...workspaceAnswers(raw) }
  for (const [id, setting] of Object.entries(TEAM_SETTINGS)) answers[id] = teamSetting(teams, setting)
  if (answers.estimation.path === 'native') answers.estimation = { path: 'native', detail: sharedScale(teams) }
  // An absent key means none for every reader (resolveMappings gives estimate: null). Without a configured team the
  // manifest describes the workspace, so only the configured team's file decides.
  const estimate = pmkit?.mappings?.fields?.estimate
  if (estimate === 'none') {
    answers.estimation = { path: 'absent', enableHint: 'mappings.fields.estimate is none in .pmkit/config.yaml' }
  } else if (estimate === undefined && chosen && answers.estimation.path !== 'absent') {
    answers.estimation = { path: 'absent', enableHint: 'Run /pmkit:setup to set mappings.fields.estimate in .pmkit/config.yaml' }
  }
  answers.capacity = answers.cycles.path === 'absent' ? { path: 'absent', enableHint: 'Capacity needs cycles' } : { path: 'derived', detail: { source: 'local' } }
  answers.linked_code = (raw.integrations ?? []).some((service) => GIT_INTEGRATIONS.includes(service))
    ? { path: 'native', detail: { source: 'integration' } }
    : { path: 'derived', detail: { source: 'git' }, ...(gitHost === 'none' ? { enableHint: ENABLE_GIT_HINT } : {}) }

  return CAPABILITIES.map((id) => {
    const answer = answers[id]
    if (SERVED_BY[id].length > 0 || answer.path === 'absent') return { id, ...answer, ...(answer.detail ? { detail: { ...answer.detail } } : {}) }
    return { id, path: 'absent', detail: { workspace: answer.path, ...answer.detail }, enableHint: unservedHint(id) }
  })
}
