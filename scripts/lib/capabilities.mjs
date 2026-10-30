// The capability manifest of the Local tracker. See the pmkit design spec, "Capability manifest",
// and docs/superpowers/specs/2026-10-25-pmk-2-capability-manifest-design.md.

export const CAPABILITIES = [
  'cycles', 'estimation', 'multilevel_hierarchy', 'dependencies', 'native_triage', 'deliverables', 'strategic_goals',
  'status_update', 'releases', 'capacity', 'native_metrics', 'saved_views', 'documents', 'demand_signals', 'request_queue',
  'time_tracking', 'linked_code', 'agent_delegation', 'security_alerts', 'user_inbox',
]

/**
 * The CLI commands that serve each capability, named exactly as COMMANDS[].name in scripts/pmkit.mjs.
 * An empty list means no command serves it, so the manifest reports it absent. A test checks every name.
 */
export const SERVED_BY = {
  cycles: ['cycle list', 'cycle current', 'cycle issues', 'cycle open', 'cycle close', 'cycle add', 'release-notes'],
  estimation: ['issues create', 'issues update'],
  multilevel_hierarchy: ['issues parent', 'epic list', 'issues dependencies'],
  dependencies: ['issues link', 'issues dependencies'],
  native_triage: ['issues move'],
  deliverables: ['epic list', 'epic get', 'epic create', 'epic progress'],
  strategic_goals: ['goal list', 'goal get', 'goal create', 'goal progress', 'epic goal'],
  status_update: ['epic update-status', 'epic updates'],
  releases: ['release list', 'release get', 'release issues', 'release create', 'release mark-released', 'release-notes'],
  capacity: ['cycle capacity'],
  native_metrics: ['metrics velocity', 'metrics cycle-time', 'metrics lead-time', 'metrics throughput', 'metrics aging', 'events'],
  saved_views: ['views list', 'views save', 'views run'],
  documents: ['docs list', 'docs read', 'docs create'],
  demand_signals: [],
  request_queue: [],
  time_tracking: ['issues log-time', 'issues time-entries'],
  linked_code: ['issues branch', 'pr open', 'pr ready', 'pr status', 'pr sync', 'deploys list', 'ci logs', 'pr diff', 'pr blockers'],
  agent_delegation: ['issues delegate'],
  security_alerts: ['alerts list'],
  user_inbox: [],
}

const ENABLE_GIT_HINT = 'Set git_host in .pmkit/config.yaml'
const absentHint = (id) => `No pmkit command serves ${id} in the Local tracker yet`

/** The ids of manifest entries that claim a path other than absent while no command in servedBy serves them. */
export function unservedCapabilities(entries, servedBy) {
  return entries.filter((entry) => entry.path !== 'absent' && !servedBy[entry.id]?.length).map((entry) => entry.id)
}

/** One entry per capability, in spec order. Every entry has a path, so a consumer never checks for a missing key. */
export function buildCapabilities({ estimate, gitHost }) {
  const derived = {
    native_metrics: { detail: { source: 'events' } },
    security_alerts: { detail: { source: 'scanners' } },
    agent_delegation: { detail: { source: 'assignee', run: 'local' } },
    linked_code: { detail: { source: 'git' }, ...(gitHost === 'none' ? { enableHint: ENABLE_GIT_HINT } : {}) },
  }
  return CAPABILITIES.map((id) => {
    if (!SERVED_BY[id].length) return { id, path: 'absent', enableHint: absentHint(id) }
    if (id === 'estimation') return { id, path: 'native', detail: { unit: estimate.unit, scale: estimate.scale } }
    if (derived[id]) return { id, path: 'derived', ...derived[id] }
    return { id, path: 'native' }
  })
}
