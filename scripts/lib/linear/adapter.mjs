// The Linear adapter descriptor that ADAPTERS holds. It loads the tracker code only in create.
// config.mjs imports adapters.mjs, which imports this file, which imports config.mjs. The cycle is safe because nothing here
// calls builtInDefaults while the modules load, and the functions are declarations, so either entry order works.

import { builtInDefaults } from '../config.mjs'

function workspaceProblems(pmkit) {
  return pmkit?.tracker?.scope?.workspace === undefined ? ['tracker.scope.workspace is required for linear'] : []
}

/** The Linear descriptor. Tests pass a fake fetch; ADAPTERS.linear uses the global fetch. */
export function linearDescriptor({ fetch = globalThis.fetch } = {}) {
  return {
    system: 'linear',
    hosted: true,
    // Lists no secret-like key: the client is the one place that refuses one.
    configProblems: (pmkit) => workspaceProblems(pmkit),
    settings: () => ({ defaults: builtInDefaults(), epicPrefix: null }),
    create: async (config, { now, env }) => {
      const { createLinearTracker } = await import('./tracker.mjs')
      return createLinearTracker(config, { env, now, fetch })
    },
  }
}
