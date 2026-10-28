// The Deliverables, Milestones and Documents families of the Linear tracker: projects as epics, project updates, and project
// milestones and documents (read only).
// See docs/superpowers/specs/2026-10-28-pmk-38-linear-projects-as-epics-design.md, "Operations".

import { PmkitError } from '../errors.mjs'
import { sortEpics } from '../local/epics.mjs'
import { CATEGORIES } from '../model.mjs'
import { PARENT_CHAIN_DEPTH } from './documents.mjs'
import { estimateOf, makeContext, stateCategory } from './issues.mjs'
import { EPIC_ISSUES_QUERY, PROJECTS_QUERY, epicKey, toEpic } from './projects.mjs'

const LIST_PAGE = 100
const PROGRESS_PAGE = 100
const PROGRESS_PAGES = 10
const notFound = (id) => new PmkitError('NOT_FOUND', `epic ${id} does not exist`, 'pmkit epic list')

/** The filter that finds a project by one key. The identifier and the UUID go through `id`, and the slug through `slugId`. */
const filterOf = ({ kind, value }) => (kind === 'slug' ? { slugId: { eq: value } } : { id: { eq: value } })

/**
 * The project operations over one client. `discovery()` is the tracker's memo of the raw discovery.
 * Besides the contract operations, the result holds `resolveEpic`, which the issue operations use.
 */
export function projectOperations({ client, discovery, config, now = () => new Date(), uuid }) {
  const scope = config.pmkit?.tracker?.scope ?? {}

  function requireWorkspace() {
    if (!scope.workspace) throw new PmkitError('NOT_CONFIGURED', 'tracker.scope.workspace is not set', '/pmkit:setup')
  }

  /** The raw project node of an epic key, or null. A string that is no project key sends no request. */
  async function findProject(key, { withLists = false } = {}) {
    requireWorkspace()
    const parsed = epicKey(key)
    if (parsed.kind === 'other') return null
    const data = await client.request(PROJECTS_QUERY, { filter: filterOf(parsed), first: 1, withLists })
    return data?.projects?.nodes?.[0] ?? null
  }

  const resolveEpic = (key) => findProject(key)

  async function listDeliverables() {
    requireWorkspace()
    const filter = { accessibleTeams: { some: { key: { eq: scope.team } } } }
    const { nodes } = await client.paginate(PROJECTS_QUERY, { filter, withLists: false }, { select: (data) => data.projects, pageSize: LIST_PAGE, maxPages: 100 })
    const epics = nodes.map(toEpic)
    const created = Object.fromEntries(nodes.map((node, index) => [epics[index].id, node.createdAt]))
    return sortEpics(epics, created)
  }

  async function getDeliverable(id) {
    const node = await findProject(id, { withLists: true })
    if (!node) throw notFound(id)
    return toEpic(node)
  }

  /** The mapping context of this run. The viewer always comes from the session, never from the cache. */
  async function context() {
    const { raw } = await discovery()
    return makeContext(raw, config.pmkit, (await client.session()).viewer)
  }

  /** The issues of a filter, up to PROGRESS_PAGES pages. */
  const readIssues = (filter) =>
    client.paginate(EPIC_ISSUES_QUERY, { filter }, { select: (data) => data.issues, pageSize: PROGRESS_PAGE, maxPages: PROGRESS_PAGES })

  /**
   * The Local progress shape over the issues of the epic: the ones in the project, then their sub-issues level by level up to
   * PARENT_CHAIN_DEPTH levels (spec, "Progress"). `native` holds Linear's own number and scope. hasMore is true when the first
   * step stopped at its page cap.
   */
  async function deliverableProgress(id) {
    const project = await findProject(id)
    if (!project) throw notFound(id)
    const first = await readIssues({ project: { id: { eq: project.id } } })
    const seen = new Map(first.nodes.map((node) => [node.identifier, node]))
    let level = first.nodes
    for (let depth = 0; depth < PARENT_CHAIN_DEPTH && level.length > 0; depth += 1) {
      const parents = level.map((node) => node.identifier)
      const next = []
      for (let at = 0; at < parents.length; at += PROGRESS_PAGE) {
        const { nodes } = await readIssues({ parent: { id: { in: parents.slice(at, at + PROGRESS_PAGE) } } })
        for (const node of nodes) {
          if (seen.has(node.identifier)) continue
          seen.set(node.identifier, node)
          next.push(node)
        }
      }
      level = next
    }
    const mapping = await context()
    const progress = { total: 0, done: 0, canceled: 0, points: 0, pointsDone: 0, byCategory: Object.fromEntries(CATEGORIES.map((category) => [category, 0])) }
    for (const node of seen.values()) {
      if (node.archivedAt) continue
      const category = stateCategory(node.state, mapping)
      if (category in progress.byCategory) progress.byCategory[category] += 1
      if (category === 'canceled') {
        progress.canceled += 1
        continue
      }
      progress.total += 1
      if (category === 'done') progress.done += 1
      const estimate = estimateOf(node, mapping)
      if (typeof estimate === 'number') {
        progress.points += estimate
        if (category === 'done') progress.pointsDone += estimate
      }
    }
    progress.native = { progress: project.progress, scope: project.scope }
    if (first.hasMore) progress.hasMore = true
    return progress
  }

  return { listDeliverables, getDeliverable, deliverableProgress, resolveEpic, requireWorkspace, now, uuid, discovery }
}
