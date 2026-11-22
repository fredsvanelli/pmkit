// The Jira tracker. discover and capabilities read one site and one space (PMK-76); every other contract operation is a stub
// until PMK-77 to PMK-80. See docs/superpowers/specs/2026-11-22-pmk-76-jira-discovery-and-manifest-design.md, "The tracker".

import { TRACKER_OPERATIONS } from '../contract.mjs'
import { PmkitError } from '../errors.mjs'
import { createJiraClient } from './client.mjs'
import { discoveryView, fetchDiscovery } from './discovery.mjs'
import { buildJiraCapabilities } from './manifest.mjs'

const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')

export function createJiraTracker(config, { env, now = () => new Date(), fetch } = {}) {
  const tracker = config.pmkit?.tracker ?? {}
  // Created now, so a missing variable (AUTH) or a secret-like config key (INVALID_INPUT) fails before any request.
  const client = createJiraClient({ env, tracker, fetch })
  const space = tracker.scope?.space

  // One discovery per run. A failed read leaves no memo, so the next call reads again.
  let memo
  function discovery({ refresh = false } = {}) {
    if (memo && !refresh) return memo
    const current = (async () => {
      if (typeof space !== 'string' || space === '') throw new PmkitError('NOT_CONFIGURED', 'tracker.scope.space is not set', '/pmkit:setup')
      const raw = await fetchDiscovery(client, { space, now })
      return discoveryView(raw, config.pmkit, { session: await client.session() })
    })()
    memo = current
    current.catch(() => {
      if (memo === current) memo = undefined
    })
    return current
  }

  async function capabilities() {
    const view = await discovery()
    return {
      tracker: 'jira',
      gitHost: config.pmkit?.git_host?.system ?? 'none',
      generatedAt: isoSeconds(now()),
      discoveredAt: view.discoveredAt,
      site: view.site,
      space: view.space,
      plan: view.plan,
      capabilities: buildJiraCapabilities(view.raw, config.pmkit),
      warnings: view.warnings,
    }
  }

  const stub = (operation) => async () => {
    throw new PmkitError('NOT_SUPPORTED', `the Jira adapter does not implement ${operation} yet`, 'Set tracker.system to local in .pmkit/config.yaml to use this command now')
  }
  const implemented = { discover: discovery, capabilities }
  return Object.fromEntries(TRACKER_OPERATIONS.map((operation) => [operation, implemented[operation] ?? stub(operation)]))
}
