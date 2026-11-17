// The capability manifest of the GitHub tracker: one entry per capability, from the raw discovery and the config.
// See docs/specs/2026-11-16-pmk-87-github-issues-relations-history-design.md, "Capabilities".

import { CAPABILITIES } from '../capabilities.mjs'
import { estimateOf } from './discovery.mjs'
import { fieldOf, labelOf, parseLabelValue } from './mappings.mjs'

const ENABLE_GIT_HINT = 'Set git_host in .pmkit/config.yaml'
const unservedHint = (id) => `The GitHub adapter does not serve ${id} yet (EPC-8)`

/** estimation: native with the unit and scale of the mapped estimate field, absent when no field GitHub has is mapped. */
function estimation(raw, pmkit) {
  if (!fieldOf(raw, pmkit?.mappings?.fields?.estimate)) return { path: 'absent', enableHint: 'Map an estimate field with /pmkit:setup' }
  const { unit, scale } = estimateOf(raw, pmkit)
  return { path: 'native', detail: { unit, scale } }
}

/**
 * The 20 capability entries in spec order. pmkit is config.pmkit: mappings.fields.estimate decides estimation, and
 * git_host.system words linked_code. GHES has no related links (raw.features.relatesTo), so dependencies says so.
 */
export function buildGithubCapabilities(raw, pmkit = {}) {
  const gitHost = pmkit?.git_host?.system ?? 'none'
  const answers = {
    estimation: estimation(raw, pmkit),
    multilevel_hierarchy: { path: 'native' },
    dependencies: raw.features?.relatesTo === false ? { path: 'native', detail: { unsupported: ['related'] } } : { path: 'native' },
    native_metrics: { path: 'derived', detail: { source: 'history' } },
    linked_code: { path: 'derived', detail: { source: 'git' }, ...(gitHost === 'none' ? { enableHint: ENABLE_GIT_HINT } : {}) },
    native_triage: { path: 'absent', enableHint: 'GitHub has no triage; map a Status option to triage in .pmkit/config.yaml' },
    agent_delegation: { path: 'absent', enableHint: 'The GitHub adapter does not delegate to agents yet' },
    time_tracking: { path: 'absent', enableHint: 'GitHub has no time tracking' },
  }
  if (raw.project === null) Object.assign(answers, withoutProject(raw, pmkit))
  return CAPABILITIES.map((id) => ({ id, ...(answers[id] ?? { path: 'absent', enableHint: unservedHint(id) }) }))
}

// The capabilities only a Project gives on GitHub: iterations for sprints and capacity, linked Projects for epics and updates.
export const PROJECT_ONLY = ['cycles', 'capacity', 'deliverables', 'status_update']
const NEEDS_PROJECT = 'Needs a GitHub Project: set tracker.scope.project with /pmkit:setup'

/** The entries a repository without a Project answers differently: the Project-only ones, and triage through a label. */
function withoutProject(raw, pmkit) {
  const triage = parseLabelValue(pmkit?.mappings?.status?.triage)
  return {
    ...Object.fromEntries(PROJECT_ONLY.map((id) => [id, { path: 'absent', enableHint: NEEDS_PROJECT }])),
    native_triage: triage && labelOf(raw, triage) ? { path: 'derived', detail: { source: 'label' } } : { path: 'absent', enableHint: 'Map a triage label with /pmkit:setup' },
  }
}
