// The capability manifest of the Local tracker. See the pmkit design spec, "Capability manifest".

export const CAPABILITIES = [
  'cycles', 'estimation', 'multilevel_hierarchy', 'dependencies', 'native_triage', 'deliverables', 'strategic_goals',
  'status_update', 'releases', 'capacity', 'native_metrics', 'saved_views', 'documents', 'demand_signals', 'request_queue',
  'time_tracking', 'linked_code', 'agent_delegation', 'security_alerts', 'user_inbox',
]

const ENABLE_GIT_HINT = 'Set git_host in .pmkit/config.yaml'

/** One entry per capability, in spec order. Every entry has a path, so a consumer never checks for a missing key. */
export function buildCapabilities({ estimate, gitHost }) {
  const derived = {
    native_metrics: { detail: { source: 'events' } },
    linked_code: { detail: { source: 'git' }, ...(gitHost === 'none' ? { enableHint: ENABLE_GIT_HINT } : {}) },
    agent_delegation: { detail: { assignee: 'agent:<name>' } },
    security_alerts: { detail: { source: 'local scanners' } },
    user_inbox: { detail: { source: 'mentions and assignments since the last check' } },
  }
  return CAPABILITIES.map((id) => {
    if (id === 'estimation') return { id, path: 'native', detail: { unit: estimate.unit, scale: estimate.scale } }
    if (derived[id]) return { id, path: 'derived', ...derived[id] }
    return { id, path: 'native' }
  })
}
