// The Jira tracker. discover and capabilities read one site and one space (PMK-76); the Issues family reads and writes work
// items (PMK-77). Every operation but discover and capabilities runs through guarded, the mapping check; the operations of
// later issues stay stubs. See docs/superpowers/specs/2026-11-22-pmk-77-jira-work-items-transitions-links-jql-design.md,
// "Discovery additions, cache and mapping check".

import { TRACKER_OPERATIONS } from '../contract.mjs'
import { PmkitError } from '../errors.mjs'
import { cacheGet, cachePut, repoHash } from '../user-store.mjs'
import { createJiraClient } from './client.mjs'
import { discoveryView, fetchDiscovery } from './discovery.mjs'
import { issueOperations } from './issue-ops.mjs'
import { makeContext } from './issues.mjs'
import { relationOperations } from './relation-ops.mjs'
import { buildJiraCapabilities } from './manifest.mjs'
import { brokenJiraMappings } from './mappings.mjs'

const CACHE_TTL_SECONDS = 3600
const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')

/** The cache key of a scope: jira-<site>-<space>, lowercased, with any character a store name refuses as _. */
const cacheKeyOf = (scope) => `jira-${scope.site}-${scope.space}`.toLowerCase().replace(/[^a-z0-9._-]/g, '_')

/** True when a cached value has the raw discovery format this code reads; PMK-76's had no members. */
const isRawDiscovery = (value) => value?.version === 1 && Array.isArray(value.members)

const ARCHIVE_REFUSAL = "Jira archives work items only on Premium; archive it in Jira, and it leaves pmkit's searches"

export function createJiraTracker(config, { env, now = () => new Date(), fetch } = {}) {
  const tracker = config.pmkit?.tracker ?? {}
  // Created now, so a missing variable (AUTH) or a secret-like config key (INVALID_INPUT) fails before any request.
  const client = createJiraClient({ env, tracker, fetch })
  const scope = tracker.scope ?? {}
  const space = scope.space
  const store = { env, now }

  function requireSpace() {
    if (typeof space !== 'string' || space === '') throw new PmkitError('NOT_CONFIGURED', 'tracker.scope.space is not set', '/pmkit:setup')
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
    const raw = await fetchDiscovery(client, { space, now })
    const warnings = []
    try {
      cachePut(repoHash(config.root), cacheKeyOf(scope), raw, { ttlSeconds: CACHE_TTL_SECONDS }, store)
    } catch (error) {
      warnings.push(`could not write the Jira discovery cache: ${error.message}`)
    }
    return { raw, fresh: true, warnings }
  }

  // One discovery per run: the memo, then the user store, then Jira. A failed read leaves no memo, so the next call reads again.
  let memo
  function discovery({ refresh = false } = {}) {
    if (memo && !refresh) return memo
    const current = (async () => {
      requireSpace()
      if (refresh) return fetchFresh()
      const cached = readCache()
      return cached ? { raw: cached, fresh: false, warnings: [] } : fetchFresh()
    })()
    memo = current
    current.catch(() => {
      if (memo === current) memo = undefined
    })
    return current
  }

  // pmkit discover and setup pass refresh: true, which reads Jira and rewrites the cache.
  async function discover({ refresh = false } = {}) {
    const { raw, warnings } = await discovery({ refresh })
    const view = discoveryView(raw, config.pmkit, { session: await client.session() })
    view.warnings.push(...warnings)
    return view
  }

  async function capabilities() {
    const view = await discover()
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

  /** Stops on a mapping that names something Jira no longer has, after one refresh when the broken list came from the cache. */
  async function checkMappings() {
    let found = await discovery()
    let broken = brokenJiraMappings(found.raw, config.pmkit)
    if (broken.length > 0 && !found.fresh) {
      found = await discovery({ refresh: true })
      broken = brokenJiraMappings(found.raw, config.pmkit)
    }
    if (broken.length > 0) {
      throw new PmkitError(
        'NOT_CONFIGURED',
        `a mapping in .pmkit/config.yaml names something Jira no longer has: ${broken.map((item) => item.problem).join('; ')}`,
        '/pmkit:setup',
        { mappings: broken },
      )
    }
  }

  // Every operation except discover and capabilities runs through here.
  const guarded = (body) => async (...args) => {
    await checkMappings()
    return body(...args)
  }
  const refusal = (message, nextStep) =>
    guarded(async () => {
      throw new PmkitError('NOT_SUPPORTED', message, nextStep)
    })
  const stub = (operation) => refusal(`the Jira adapter does not implement ${operation} yet`, 'Set tracker.system to local in .pmkit/config.yaml to use this command now')

  // The context of the operations: makeContext over the discovery, built once per raw discovery, with `fresh`.
  const contexts = new WeakMap()
  async function getContext({ refresh = false } = {}) {
    const { raw, fresh } = await discovery({ refresh })
    if (!contexts.has(raw)) contexts.set(raw, { ...makeContext(raw, config.pmkit, await client.session()), fresh })
    return contexts.get(raw)
  }

  const issues = issueOperations({ client, getContext, now })
  const relations = relationOperations({ client, ops: issues, getContext })
  const contract = {
    getIssue: issues.getIssue,
    searchIssues: issues.searchIssues,
    createIssue: issues.createIssue,
    updateIssue: issues.updateIssue,
    moveToCategory: issues.moveToCategory,
    assign: issues.assign,
    delete: issues.delete,
    link: relations.link,
    unlink: relations.unlink,
    setParent: relations.setParent,
  }
  // delegate carries the manifest's hint, as GitHub's absent operations do.
  const delegate = guarded(async () => {
    const { raw } = await discovery()
    const entry = buildJiraCapabilities(raw, config.pmkit).find((candidate) => candidate.id === 'agent_delegation')
    throw new PmkitError('NOT_SUPPORTED', entry.enableHint, entry.enableHint)
  })
  const refused = {
    archive: refusal(ARCHIVE_REFUSAL, 'Archive the work item in Jira'),
    unarchive: refusal(ARCHIVE_REFUSAL, 'Restore the work item from the archive in Jira'),
    restore: refusal('Jira has no trash, so a deleted work item cannot come back', 'pmkit issues create'),
    delegate,
  }
  const implemented = { discover, capabilities, ...refused, ...Object.fromEntries(Object.entries(contract).map(([operation, body]) => [operation, guarded(body)])) }
  return Object.fromEntries(TRACKER_OPERATIONS.map((operation) => [operation, implemented[operation] ?? stub(operation)]))
}
