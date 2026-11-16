// The GitHub Issues tracker. discover reads the repository and its Project (PMK-86); capabilities builds the manifest from the
// discovery. Every other contract operation runs through guarded, the scope and mapping check (PMK-87), and stays a stub
// until its task plugs the operation in.
// See docs/specs/2026-11-16-pmk-87-github-issues-relations-history-design.md, "Discovery, cache and mapping check".

import { TRACKER_OPERATIONS } from '../contract.mjs'
import { PmkitError } from '../errors.mjs'
import { cacheGet, cachePut, repoHash } from '../user-store.mjs'
import { createGithubClient } from './client.mjs'
import { discoveryView, fetchDiscovery, parseProject } from './discovery.mjs'
import { defaultExec } from './host.mjs'
import { buildGithubCapabilities } from './manifest.mjs'
import { brokenGithubMappings } from './mappings.mjs'

const CACHE_TTL_SECONDS = 3600
const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')

/** The cache key of a scope: github-<host>-<owner>.<name>, lowercased, with any character a store name refuses as _. */
const cacheKeyOf = (scope) => `github-${scope.host}-${scope.repo.replace('/', '.')}`.toLowerCase().replace(/[^a-z0-9._-]/g, '_')

/** The owner/number of the Project a raw discovery read, or null. */
const projectOf = (raw) => (raw.project ? `${raw.project.owner}/${raw.project.number}`.toLowerCase() : null)

export function createGithubTracker(config, { env, now = () => new Date(), exec } = {}) {
  const scope = config.pmkit?.tracker?.scope ?? {}
  const run = exec ?? defaultExec({ root: config.root, env })
  const store = { env, now }

  function requireScope() {
    for (const key of ['host', 'repo']) {
      if (typeof scope[key] !== 'string' || scope[key] === '') throw new PmkitError('NOT_CONFIGURED', `tracker.scope.${key} is not set in .pmkit/config.yaml`, '/pmkit:setup')
    }
  }

  /** True when a cached value has the raw discovery format this code reads, for the configured Project. */
  function isRawDiscovery(value) {
    if (value?.version !== 1 || !Array.isArray(value.users)) return false
    const wanted = parseProject(scope.project)
    return projectOf(value) === (wanted ? `${wanted.owner}/${wanted.number}`.toLowerCase() : null)
  }

  function readCache() {
    try {
      const hit = cacheGet(repoHash(config.root), cacheKeyOf(scope), store)
      return hit && isRawDiscovery(hit.value) ? hit.value : null
    } catch {
      return null
    }
  }

  async function fetchFresh() {
    const client = createGithubClient({ root: config.root, env, host: scope.host, exec: run })
    const raw = await fetchDiscovery(client, { host: scope.host, repo: scope.repo, project: scope.project, exec: run, users: true })
    const warnings = []
    try {
      cachePut(repoHash(config.root), cacheKeyOf(scope), raw, { ttlSeconds: CACHE_TTL_SECONDS }, store)
    } catch (error) {
      warnings.push(`could not write the GitHub discovery cache: ${error.message}`)
    }
    return { raw, fresh: true, warnings }
  }

  // One discovery per run: the memo, then the user store, then GitHub.
  let memo
  function discovery({ refresh = false } = {}) {
    if (memo && !refresh) return memo
    const current = refresh
      ? fetchFresh()
      : (async () => {
          const cached = readCache()
          return cached ? { raw: cached, fresh: false, warnings: [] } : fetchFresh()
        })()
    memo = current
    // A failed fetch leaves the memo, so the next call retries.
    current.catch(() => {
      if (memo === current) memo = undefined
    })
    return current
  }

  // discover reads through the memo and the cache, as Linear's does. pmkit discover and setup pass refresh: true, which reads
  // GitHub and rewrites the cache, so they show the live state.
  async function discover({ refresh = false } = {}) {
    requireScope()
    const { raw, warnings } = await discovery({ refresh })
    const view = discoveryView(raw, config.pmkit)
    view.warnings.push(...warnings)
    return view
  }

  async function capabilities() {
    requireScope()
    const { raw, warnings } = await discovery()
    return {
      tracker: 'github',
      gitHost: config.pmkit?.git_host?.system ?? 'none',
      generatedAt: isoSeconds(now()),
      host: scope.host,
      repo: scope.repo,
      project: scope.project ?? null,
      capabilities: buildGithubCapabilities(raw, config.pmkit),
      warnings: [...warnings],
    }
  }

  /**
   * Stops on a mapping that names something GitHub no longer has. A broken list from a cached discovery triggers one
   * refresh and a second check, because a cached miss is often only an old cache.
   */
  async function checkMappings() {
    let found = await discovery()
    let broken = brokenGithubMappings(found.raw, config.pmkit)
    if (broken.length > 0 && !found.fresh) {
      found = await discovery({ refresh: true })
      broken = brokenGithubMappings(found.raw, config.pmkit)
    }
    if (broken.length > 0) {
      throw new PmkitError(
        'NOT_CONFIGURED',
        `a mapping in .pmkit/config.yaml names something GitHub no longer has: ${broken.map((item) => item.problem).join('; ')}`,
        '/pmkit:setup',
        { mappings: broken },
      )
    }
  }

  // Every operation except discover and capabilities runs through here: the scope check, then the mapping check, then the body.
  // Later tasks replace a stub's body and keep this wrapper.
  const guarded = (body) => async (...args) => {
    requireScope()
    await checkMappings()
    return body(...args)
  }

  const stub = (operation) =>
    guarded(async () => {
      throw new PmkitError('NOT_SUPPORTED', `the GitHub adapter does not implement ${operation} yet`, 'Set tracker.system to local in .pmkit/config.yaml to use this command now')
    })
  const implemented = { discover, capabilities }
  return Object.fromEntries(TRACKER_OPERATIONS.map((operation) => [operation, implemented[operation] ?? stub(operation)]))
}
