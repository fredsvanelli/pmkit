// The GitHub Issues tracker. discover reads the repository and its Project (PMK-86); capabilities builds the manifest from the
// discovery. The Issues, Relations, History and Comments families read and write issues (PMK-87). Every operation but
// discover and capabilities runs through guarded, the scope and mapping check; the operations of later issues stay stubs.
// See docs/specs/2026-11-16-pmk-87-github-issues-relations-history-design.md, "Discovery, cache and mapping check".

import { TRACKER_OPERATIONS } from '../contract.mjs'
import { PmkitError, unarchiveNotSupported } from '../errors.mjs'
import { cacheGet, cachePut, repoHash } from '../user-store.mjs'
import { createGithubClient } from './client.mjs'
import { discoveryView, fetchDiscovery, mappedLabelNames, parseProject } from './discovery.mjs'
import { discussionOperations } from './discussions.mjs'
import { draftIssueOperations } from './draft-issues.mjs'
import { historyOperations } from './history-ops.mjs'
import { cycleOperations } from './cycle-ops.mjs'
import { defaultExec } from './host.mjs'
import { issueOperations } from './issue-ops.mjs'
import { makeContext } from './issues.mjs'
import { buildGithubCapabilities, PROJECT_ONLY } from './manifest.mjs'
import { brokenGithubMappings } from './mappings.mjs'
import { epicProjects, projectOperations } from './project-ops.mjs'
import { relationOperations } from './relation-ops.mjs'

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
  // One client per tracker. Discovery and every operation read GitHub through it.
  const client = createGithubClient({ root: config.root, env, host: scope.host, exec: run })

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
    const raw = await fetchDiscovery(client, { host: scope.host, repo: scope.repo, project: scope.project, exec: run, users: true, labels: mappedLabelNames(config.pmkit) })
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
    // The epic read is not started here; when an operation already read it, its paging warning shows too.
    const epicWarnings = epicsMemo ? ((await epicsMemo).warnings ?? []) : []
    return {
      tracker: 'github',
      gitHost: config.pmkit?.git_host?.system ?? 'none',
      generatedAt: isoSeconds(now()),
      host: scope.host,
      repo: scope.repo,
      project: scope.project ?? null,
      capabilities: buildGithubCapabilities(raw, config.pmkit),
      warnings: [...warnings, ...epicWarnings, ...(raw.project === null ? [`tracker.scope.project is none, so ${PROJECT_ONLY.slice(0, -1).join(', ')} and ${PROJECT_ONLY.at(-1)} are absent`] : [])],
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

  // Operations GitHub has no capability for. The refusal carries the manifest's hint, as Linear's stubs do.
  const ABSENT_CAPABILITY = { delegate: 'agent_delegation', logTime: 'time_tracking', listTimeEntries: 'time_tracking' }
  const absent = (operation) =>
    guarded(async () => {
      const { raw } = await discovery()
      const entry = buildGithubCapabilities(raw, config.pmkit).find((candidate) => candidate.id === ABSENT_CAPABILITY[operation])
      throw new PmkitError('NOT_SUPPORTED', entry.enableHint, entry.enableHint)
    })

  // The epic Projects are read by epicProjects in project-ops.mjs, with the scope Project left out.
  // Read once per run, kept out of the discovery cache. A failed read leaves no memo, so the next call retries.
  let epicsMemo
  function epics({ refresh = false } = {}) {
    if (epicsMemo && !refresh) return epicsMemo
    const current = epicProjects(client, scope)
    epicsMemo = current
    current.catch(() => {
      if (epicsMemo === current) epicsMemo = undefined
    })
    return current
  }

  // The context of the operations: makeContext over the discovery, built once per raw discovery.
  const contexts = new WeakMap()
  async function getContext({ refresh = false } = {}) {
    const { raw } = await discovery({ refresh })
    if (!contexts.has(raw)) contexts.set(raw, makeContext(raw, config.pmkit, { epics: await epics({ refresh }) }))
    return contexts.get(raw)
  }

  const issues = issueOperations({ client, config, getContext, now })
  const relations = relationOperations({ client, ops: issues, getContext })
  const history = historyOperations({ client, ops: issues, getContext, now })
  const cycles = cycleOperations({ client, ops: issues, config, getContext, now })
  const projects = projectOperations({ client, ops: issues, config, getContext, now })
  const contract = {
    getIssue: issues.getIssue,
    searchIssues: issues.searchIssues,
    createIssue: issues.createIssue,
    updateIssue: issues.updateIssue,
    moveToCategory: issues.moveToCategory,
    assign: issues.assign,
    archive: issues.archive,
    delete: issues.delete,
    link: relations.link,
    unlink: relations.unlink,
    setParent: relations.setParent,
    getHistory: history.getHistory,
    listComments: history.listComments,
    comment: history.comment,
    resolveThread: history.resolveThread,
    metricEvents: history.metricEvents,
    listCycles: cycles.listCycles,
    currentCycle: cycles.currentCycle,
    cycleIssues: cycles.cycleIssues,
    openCycle: cycles.openCycle,
    closeCycle: cycles.closeCycle,
    moveToCycle: cycles.moveToCycle,
    getCapacity: cycles.getCapacity,
    setCapacity: cycles.setCapacity,
    getDaysOff: cycles.getDaysOff,
    updateCycleCapacity: cycles.updateCycleCapacity,
    listDeliverables: projects.listDeliverables,
    getDeliverable: projects.getDeliverable,
    deliverableProgress: projects.deliverableProgress,
    createDeliverable: projects.createDeliverable,
    moveDeliverable: projects.moveDeliverable,
    updateDeliverable: projects.updateDeliverable,
    publishStatusUpdate: projects.publishStatusUpdate,
    listStatusUpdates: projects.listStatusUpdates,
    listMilestones: projects.listMilestones,
    getMilestone: projects.getMilestone,
    createMilestone: projects.createMilestone,
  }
  const refused = {
    // Archive works on the Project item; unarchive is Local only, as on Linear (PMK-250).
    unarchive: guarded(async () => {
      throw unarchiveNotSupported()
    }),
    restore: guarded(async () => {
      throw new PmkitError('NOT_SUPPORTED', 'GitHub has no trash, so a deleted issue cannot come back', 'pmkit issues create')
    }),
    ...Object.fromEntries(Object.keys(ABSENT_CAPABILITY).map((operation) => [operation, absent(operation)])),
  }
  const implemented = { discover, capabilities, ...refused, ...Object.fromEntries(Object.entries(contract).map(([operation, body]) => [operation, guarded(body)])) }
  // GitHub-only features beside the contract, as the Linear tracker returns triage and customers. Discussions read no status,
  // type or field, so they run the scope check but skip the mapping check (PMK-90). Draft issues do the same (PMK-91).
  const scoped = (operations) => Object.fromEntries(Object.entries(operations).map(([name, body]) => [name, async (...args) => {
    requireScope()
    return body(...args)
  }]))
  const discussions = scoped(discussionOperations({ client, scope: { ...scope, repo: scope.repo ?? '' } }))
  const draftIssues = scoped(draftIssueOperations({ client, scope: { ...scope, repo: scope.repo ?? '' } }))
  return { ...Object.fromEntries(TRACKER_OPERATIONS.map((operation) => [operation, implemented[operation] ?? stub(operation)])), discussions, draftIssues }
}
