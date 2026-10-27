// A fake hosted tracker adapter for tests, registered under linear in a test registry. It reads no key and calls no network.
import fs from 'node:fs'
import path from 'node:path'
import { ADAPTERS } from './lib/adapters.mjs'
import { builtInDefaults } from './lib/config.mjs'

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
