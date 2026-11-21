// The capability manifest of the GitHub tracker: one entry per capability, from the raw discovery and the config.
// See docs/specs/2026-11-16-pmk-87-github-issues-relations-history-design.md, "Capabilities".

import { CAPABILITIES } from '../capabilities.mjs'
import { estimateLabelScale, estimateOf } from './discovery.mjs'
import { CAPACITY_FILE } from '../capacity-store.mjs'
import { fieldOf, iterationFieldOf, labelOf, parseLabelValue } from './mappings.mjs'

const ENABLE_GIT_HINT = 'Set git_host in .pmkit/config.yaml'
const unservedHint = (id) => `The GitHub adapter does not serve ${id} yet (EPC-8)`

/** estimation: native with the unit and scale of the mapped estimate field or estimate labels, absent when GitHub has neither. */
function estimation(raw, pmkit) {
  if (!fieldOf(raw, pmkit?.mappings?.fields?.estimate) && estimateLabelScale(raw, pmkit).length === 0) return { path: 'absent', enableHint: 'Map an estimate field with /pmkit:setup' }
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
  else Object.assign(answers, withProject(raw, pmkit))
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

/**
 * The four Project-only entries of a repository with a Project. Cycles are the mapped iteration field: open is true where
 * GitHub gives iterations an id (github.com, GHE.com), close is false because an iteration ends on its end date.
 * Capacity is the local file of the cycles. Epics are linked Projects, so deliverables and status updates are native.
 */
function withProject(raw, pmkit) {
  const field = iterationFieldOf(raw, pmkit)
  const cycles = field
    ? { path: 'native', detail: { field: field.name, open: raw.features?.iterationIds === true, close: false, schedule: 'project', history: false } }
    : { path: 'absent', enableHint: 'Map an iteration field of the Project with /pmkit:setup' }
  return {
    cycles,
    capacity: field ? { path: 'derived', detail: { source: 'local', file: CAPACITY_FILE } } : { path: 'absent', enableHint: 'Capacity needs cycles' },
    deliverables: { path: 'native', detail: { entity: 'project', derived: ['deliverableProgress'], milestones: 'repository' } },
    status_update: { path: 'native', detail: { entity: 'project status update' } },
  }
}
