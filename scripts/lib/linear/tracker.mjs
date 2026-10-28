// The Linear tracker. discover and capabilities read the workspace (PMK-33). The Issues and Relations families read and
// write issues (PMK-35), the History and Comments families read history and comments (PMK-36), the Cycles and Capacity
// families map cycles to sprints (PMK-37), and projects are epics with status updates, milestones and documents (PMK-38).
// Every other contract operation is a stub.
// See docs/superpowers/specs/2026-10-27-pmk-33-linear-discovery-design.md, "The tracker".

import { randomUUID } from 'node:crypto'

import { TRACKER_OPERATIONS } from '../contract.mjs'
import { PmkitError } from '../errors.mjs'
import { brokenMappings } from '../mappings.mjs'
import { cacheGet, cachePut, repoHash } from '../user-store.mjs'
import { createLinearClient } from './client.mjs'
import { cycleOperations } from './cycle-ops.mjs'
import { discoveryView, fetchDiscovery } from './discovery.mjs'
import { historyOperations } from './history-ops.mjs'
import { issueOperations } from './issue-ops.mjs'
import { linearDescription } from './mappings.mjs'
import { projectOperations } from './project-ops.mjs'
import { relationOperations } from './relation-ops.mjs'
import { buildLinearCapabilities } from './manifest.mjs'
import { createTriage } from './triage.mjs'

const CACHE_TTL_SECONDS = 3600
const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')

/** True when a cached value has the raw discovery format this code reads. */
const isRawDiscovery = (value) =>
  value?.version === 1 && ['teams', 'states', 'labels', 'users'].every((kind) => Array.isArray(value[kind])) && value.workspace !== undefined

export function createLinearTracker(config, { env, now = () => new Date(), fetch, uuid = randomUUID } = {}) {
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
        warnings.push(`could not write the Linear discovery cache: ${error.message}`)
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

  // The viewer comes from the session on a cached read too, so the actor and `me` never come from the cache.
  async function discover({ refresh = false } = {}) {
    const { result } = await view({ refresh })
    const { viewer } = await client.session()
    const found = { ...result, viewer: { id: viewer.id, name: viewer.name } }
    // The spread drops the hidden raw discovery that resolveMappings and setup read, so it goes back on.
    Object.defineProperty(found, 'raw', { value: result.raw, enumerable: false })
    return found
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

  const TEAM_UNSET = { path: 'tracker.scope.team', value: null, problem: 'tracker.scope.team is not set' }

  /**
   * Stops on a mapping that names something the workspace no longer has (criterion 4). A broken list from a cached discovery
   * triggers one refresh and a second check, because a cached miss is often only an old cache.
   */
  async function checkMappings() {
    if (!tracker.scope?.team) throw new PmkitError('NOT_CONFIGURED', TEAM_UNSET.problem, '/pmkit:setup', { mappings: [TEAM_UNSET] })
    const check = ({ raw }) => brokenMappings(linearDescription(raw, { workspace: raw.workspace }, null, []), config.pmkit)
    let found = await discovery()
    let broken = check(found)
    // A fresh fetch carries the session; a cached one does not.
    if (broken.length > 0 && found.session === undefined) {
      found = await discovery({ refresh: true })
      broken = check(found)
    }
    if (broken.length > 0) {
      throw new PmkitError(
        'NOT_CONFIGURED',
        `a mapping in .pmkit/config.yaml names something the workspace no longer has: ${broken.map((item) => item.problem).join('; ')}`,
        '/pmkit:setup',
        { mappings: broken },
      )
    }
  }

  // Every operation except discover and capabilities runs through here: the workspace check, then the mapping check, then the body.
  // PMK-38 replaces a stub's body and keeps this wrapper.
  const guarded = (body) => async (...args) => {
    if (!workspace) throw new PmkitError('NOT_CONFIGURED', 'tracker.scope.workspace is not set', '/pmkit:setup')
    await checkMappings()
    return body(...args)
  }

  const stub = (operation) =>
    guarded(async () => {
      throw new PmkitError(
        'NOT_SUPPORTED',
        `the Linear adapter does not implement ${operation} yet`,
        'Set tracker.system to local in .pmkit/config.yaml to use this command now',
      )
    })

  const projects = projectOperations({ client, discovery, config, now, uuid })
  const issues = issueOperations({ client, discovery, config, now, uuid, resolveEpic: projects.resolveEpic })
  const relations = relationOperations({ client, ops: issues, uuid })
  const history = historyOperations({ client, ops: issues })
  const cycles = cycleOperations({ client, discovery, issues, config })
  const contract = {
    getIssue: issues.getIssue,
    searchIssues: issues.searchIssues,
    createIssue: issues.createIssue,
    updateIssue: issues.updateIssue,
    moveToCategory: issues.moveToCategory,
    assign: issues.assign,
    archive: issues.archive,
    link: relations.link,
    unlink: relations.unlink,
    setParent: relations.setParent,
    getHistory: history.getHistory,
    listComments: history.listComments,
    comment: history.comment,
    resolveThread: history.resolveThread,
    metricEvents: history.metricEvents,
    ...Object.fromEntries(
      ['listCycles', 'currentCycle', 'cycleIssues', 'moveToCycle', 'openCycle', 'closeCycle', 'getCapacity', 'setCapacity', 'getDaysOff', 'updateCycleCapacity'].map((name) => [name, cycles[name]]),
    ),
    listDeliverables: projects.listDeliverables,
    getDeliverable: projects.getDeliverable,
    deliverableProgress: projects.deliverableProgress,
    createDeliverable: projects.createDeliverable,
    publishStatusUpdate: projects.publishStatusUpdate,
    listStatusUpdates: projects.listStatusUpdates,
    listMilestones: projects.listMilestones,
    getMilestone: projects.getMilestone,
    createMilestone: projects.createMilestone,
    readDocument: projects.readDocument,
    createDocument: projects.createDocument,
  }
  const implemented = { discover, capabilities, ...Object.fromEntries(Object.entries(contract).map(([operation, body]) => [operation, guarded(body)])) }
  // Linear-only features sit beside the contract operations. contractView ignores them.
  const triage = createTriage({ client, discovery, config })
  return { ...Object.fromEntries(TRACKER_OPERATIONS.map((operation) => [operation, implemented[operation] ?? stub(operation)])), triage }
}
