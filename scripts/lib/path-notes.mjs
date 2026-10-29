// One line that says which path a command took when it was not the native one. See the PMK-40 design spec, "The note phrases".

function conditionalNote(entry, facts) {
  const base = `${entry.id} is on for teams ${(entry.detail?.teams ?? []).join(', ')} only`
  return facts.issue ? `${base}; ${facts.issue} is in team ${facts.team}` : base
}

function derivedNote(entry, facts) {
  const source = entry.detail?.source
  if (entry.id === 'native_metrics') {
    if (facts.metric === 'velocity') {
      const base = `velocity computed from the last ${facts.sprints} closed sprints`
      const off = facts.estimation?.path === 'absent'
      return off ? `${base}; counted issues: estimates are off (${facts.estimation.enableHint})` : base
    }
    if (source === 'history') return `${facts.metric} computed from Linear issue history`
    if (source === 'events') return `${facts.metric} computed from .issues/events.jsonl`
  }
  if (entry.id === 'capacity' && source === 'local') return 'capacity read from .pmkit/capacity.yaml; Linear has no capacity field'
  if (entry.id === 'deliverables' && entry.detail?.derived?.includes('deliverableProgress')) return "progress computed from the project's issues"
  if (entry.id === 'linked_code' && source === 'git') return 'branch and PR state read from git, not from the tracker'
  return null
}

// A derived entry that has no phrase of its own, such as a new source, still says it took the derived path.
function genericDerivedNote(entry) {
  const source = entry.detail?.source
  return source ? `${entry.id} is derived from ${source}, not read natively` : `${entry.id} is derived, not read natively`
}

/**
 * The note for a manifest entry, or null when the entry is native.
 * facts: metric, sprints and estimation (velocity), issue and team (conditional), releaseNotesFrom (release-notes).
 */
export function pathNote(entry, facts = {}) {
  // deliverables is native on Linear, but its progress counts are derived from the project's issues.
  if (entry.path === 'native') return entry.id === 'deliverables' ? derivedNote(entry, facts) : null
  if (entry.path === 'conditional') return conditionalNote(entry, facts)
  if (entry.path === 'derived') return derivedNote(entry, facts) ?? genericDerivedNote(entry)
  if (entry.path === 'absent') {
    if (facts.releaseNotesFrom) return `release notes built from sprint ${facts.releaseNotesFrom}: ${entry.enableHint}`
    return `${entry.id} is absent: ${entry.enableHint}`
  }
  return null
}
