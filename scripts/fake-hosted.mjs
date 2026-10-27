// A fake hosted tracker adapter for tests, registered under linear in a test registry. It reads no key and calls no network.
import fs from 'node:fs'
import path from 'node:path'
import { ADAPTERS } from './lib/adapters.mjs'
import { builtInDefaults, loadLocalConfig } from './lib/config.mjs'
import { TRACKER_OPERATIONS } from './lib/contract.mjs'
import { createLocalTracker } from './lib/local/tracker.mjs'

/** A linear descriptor whose rule asks for tracker.scope.workspace, and whose create rejects. */
export function fakeLinear(overrides = {}) {
  return {
    system: 'linear',
    hosted: true,
    configProblems: (pmkit) => (pmkit.tracker.scope?.workspace === undefined ? ['tracker.scope.workspace is required for linear'] : []),
    settings: () => ({ defaults: builtInDefaults(), epicPrefix: null }),
    create: async () => {
      throw new Error('fakeLinear has no tracker')
    },
    ...overrides,
  }
}

/** The product registry plus a linear descriptor. */
export const withLinear = (descriptor = fakeLinear()) => ({ ...ADAPTERS, linear: descriptor })

/** Sets tracker.system to linear with a workspace in the copy's .pmkit/config.yaml, appends `extra`, and returns root. */
export function useLinear(root, extra = '') {
  const file = path.join(root, '.pmkit', 'config.yaml')
  const text = fs.readFileSync(file, 'utf8').replace(/^ {2}system: local$/m, '  system: linear\n  scope:\n    workspace: acme')
  fs.writeFileSync(file, text + extra)
  return root
}

// The Local tracker config of a repository whose .pmkit/config.yaml names linear: the same files, read as local.
const mirroredConfig = (config) => loadLocalConfig(config.root, { ...config.pmkit, tracker: { system: 'local', path: config.pmkit.tracker.path ?? '.issues' } }, [])

/**
 * A linear descriptor over the repository's own Local tracker files. Its tracker holds only the contract operations, and each
 * returns a promise, as a hosted adapter's would. `override` replaces operations by name.
 */
export function mirrorLinear({ override = {} } = {}) {
  return {
    system: 'linear',
    hosted: true,
    configProblems: () => [],
    settings: (config) => {
      const { local } = mirroredConfig(config)
      return { defaults: local.defaults, epicPrefix: local.epic_prefix }
    },
    create: async (config, { now, random, env, dryRun }) => {
      const local = mirroredConfig(config)
      const tracker = createLocalTracker(local.root, { config: local, now, random, env, index: dryRun ? 'read' : true })
      return Object.fromEntries(TRACKER_OPERATIONS.map((name) => [name, override[name] ?? (async (...args) => tracker[name](...args))]))
    },
  }
}
