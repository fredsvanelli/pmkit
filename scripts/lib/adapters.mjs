// The tracker adapters pmkit can load, by tracker.system. A system missing here fails with NOT_SUPPORTED.
// This module imports descriptors only. Each tracker's code loads in its descriptor's create, so a hosted adapter's code
// loads only when a repository uses it. linear/adapter.mjs imports config.mjs, which imports this module; that cycle is safe
// because no descriptor calls into config.mjs while the modules load.

import { linearDescriptor } from './linear/adapter.mjs'

/**
 * @typedef {object} AdapterDescriptor
 * @property {string} system a name in TRACKERS
 * @property {boolean} hosted false only for local
 * @property {(pmkit: object) => string[]} configProblems the adapter's rules on a .pmkit/config.yaml whose shape is valid
 * @property {(config: object) => { defaults: object, epicPrefix: string | null }} settings the behavior defaults commands read
 * @property {(config: object, deps: { now: Function, random: Function, env: object, dryRun: boolean }) => Promise<object>} create the tracker
 */

/** @type {Object<string, AdapterDescriptor>} */
export const ADAPTERS = {
  local: {
    system: 'local',
    hosted: false,
    configProblems: () => [],
    settings: (config) => ({ defaults: config.local.defaults, epicPrefix: config.local.epic_prefix }),
    create: async (config, { now, random, env, dryRun }) => {
      const { createLocalTracker } = await import('./local/tracker.mjs')
      return createLocalTracker(config.root, { config, now, random, env, index: dryRun ? 'read' : true })
    },
  },
  linear: linearDescriptor(),
}

/** The descriptor of a system, or null when the registry has none. */
export const adapterFor = (system, adapters = ADAPTERS) => (typeof system === 'string' && Object.hasOwn(adapters, system) ? adapters[system] : null)
