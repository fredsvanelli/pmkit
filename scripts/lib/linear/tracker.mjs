// The Linear tracker. discover and capabilities read the workspace; every other contract operation is a stub
// until PMK-35 to PMK-38. See docs/superpowers/specs/2026-10-27-pmk-33-linear-discovery-design.md, "The tracker".

import { TRACKER_OPERATIONS } from '../contract.mjs'
import { PmkitError } from '../errors.mjs'
import { cacheGet, cachePut, repoHash } from '../user-store.mjs'
import { createLinearClient } from './client.mjs'
import { discoveryView, fetchDiscovery } from './discovery.mjs'
import { buildLinearCapabilities } from './manifest.mjs'

const CACHE_TTL_SECONDS = 3600
const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')

/** True when a cached value has the raw discovery format this code reads. */
const isRawDiscovery = (value) =>
  value?.version === 1 && ['teams', 'states', 'labels', 'users'].every((kind) => Array.isArray(value[kind])) && value.workspace !== undefined

export function createLinearTracker(config, { env, now = () => new Date(), fetch } = {}) {
  const tracker = config.pmkit?.tracker ?? {}
  // Created now, so a missing key (AUTH) or a secret-like config key (INVALID_INPUT) fails before any request or cache read.
  const client = createLinearClient({ env, tracker, requireWorkspace: false, fetch })
  const workspace = tracker.scope?.workspace
  const store = { env, now }
  const cacheKey = workspace ? `linear-${workspace}` : null

  function readCache() {
    if (!cacheKey) return null
    try {
      const hit = cacheGet(repoHash(config.root), cacheKey, store)
      return hit && isRawDiscovery(hit.value) ? hit.value : null
    } catch {
      return null
    }
  }

  async function fetchFresh() {
    const raw = await fetchDiscovery(client, { now })
    const session = await client.session()
    const warnings = []
    if (cacheKey) {
      try {
        cachePut(repoHash(config.root), cacheKey, raw, { ttlSeconds: CACHE_TTL_SECONDS }, store)
      } catch (error) {
        warnings.push(`pmkit could not write the Linear discovery cache: ${error.message}`)
      }
    }
    return { raw, session, warnings }
  }

  // One discovery per run: the memo, then the user store, then the API.
  let memo
  function discovery({ refresh = false } = {}) {
    if (memo && !refresh) return memo
    const current = refresh
      ? fetchFresh()
      : (async () => {
          const cached = readCache()
          return cached ? { raw: cached, session: undefined, warnings: [] } : fetchFresh()
        })()
    memo = current
    // A failed fetch leaves the memo, so the next call retries.
    current.catch(() => {
      if (memo === current) memo = undefined
    })
    return current
  }

  async function view(options) {
    const { raw, session, warnings } = await discovery(options)
    const result = discoveryView(raw, config.pmkit, { session })
    result.warnings.push(...warnings)
    return { raw, result }
  }

  async function discover({ refresh = false } = {}) {
    return (await view({ refresh })).result
  }

  async function capabilities() {
    const { raw, result } = await view()
    return {
      tracker: 'linear',
      gitHost: config.pmkit?.git_host?.system ?? 'none',
      generatedAt: isoSeconds(now()),
      discoveredAt: raw.discoveredAt,
      workspace: { urlKey: raw.workspace.urlKey, plan: raw.workspace.plan },
      team: result.team,
      capabilities: buildLinearCapabilities(raw, config.pmkit),
      warnings: result.warnings,
    }
  }

  const stub = (operation) => async () => {
    if (!workspace) throw new PmkitError('NOT_CONFIGURED', 'tracker.scope.workspace is not set', '/pmkit:setup')
    throw new PmkitError(
      'NOT_SUPPORTED',
      `the Linear adapter does not implement ${operation} yet`,
      'Set tracker.system to local in .pmkit/config.yaml to use this command now',
    )
  }

  const implemented = { discover, capabilities }
  return Object.fromEntries(TRACKER_OPERATIONS.map((operation) => [operation, implemented[operation] ?? stub(operation)]))
}
