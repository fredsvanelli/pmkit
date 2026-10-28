// The Linear adapter descriptor that ADAPTERS holds. It loads the tracker code only in create.
// config.mjs imports adapters.mjs, which imports this file, which imports config.mjs. The cycle is safe because nothing here
// calls builtInDefaults while the modules load, and the functions are declarations, so either entry order works.

import { builtInDefaults } from '../config.mjs'
import { isIssueId } from './ids.mjs'
import { linearDescription } from './mappings.mjs'

function workspaceProblems(pmkit) {
  return pmkit?.tracker?.scope?.workspace === undefined ? ['tracker.scope.workspace is required for linear'] : []
}

function mappingProblems(pmkit) {
  const problems = []
  const estimate = pmkit?.mappings?.fields?.estimate
  if (estimate !== undefined && estimate !== 'native' && estimate !== 'none') {
    problems.push('mappings.fields.estimate must be native or none for linear')
  }
  for (const [type, label] of Object.entries(pmkit?.mappings?.types ?? {})) {
    if (label === 'none') problems.push(`mappings.types.${type} cannot be none; leave the type out instead`)
  }
  return problems
}

/** The Linear descriptor. Tests pass a fake fetch; ADAPTERS.linear uses the global fetch. */
export function linearDescriptor({ fetch = globalThis.fetch } = {}) {
  return {
    system: 'linear',
    hosted: true,
    // Lists no secret-like key: the client is the one place that refuses one.
    configProblems: (pmkit) => [...workspaceProblems(pmkit), ...mappingProblems(pmkit)],
    // The description that scripts/lib/mappings.mjs reads. view is the discover result, viewerId the key owner's id, types the repository's type list.
    describe: (raw, view, viewerId, types) => linearDescription(raw, view, viewerId, types),
    // Any id that is not a Linear identifier is an epic id, so getDeliverable answers it (PMK-38). Linear names each issue's branch.
    settings: () => ({ defaults: builtInDefaults(), epicPrefix: null, isEpicId: (id) => !isIssueId(id), trackerBranch: true }),
    create: async (config, { now, env }) => {
      const { createLinearTracker } = await import('./tracker.mjs')
      return createLinearTracker(config, { env, now, fetch })
    },
  }
}
