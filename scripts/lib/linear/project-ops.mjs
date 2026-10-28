// The Deliverables, Milestones and Documents families of the Linear tracker: projects as epics, project updates, and project
// milestones and documents (read only).
// See docs/superpowers/specs/2026-10-28-pmk-38-linear-projects-as-epics-design.md, "Operations".

import { PmkitError } from '../errors.mjs'
import { sortEpics } from '../local/epics.mjs'
import { PROJECTS_QUERY, epicKey, toEpic } from './projects.mjs'

const LIST_PAGE = 100
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

  return { listDeliverables, getDeliverable, resolveEpic, requireWorkspace, now, uuid, discovery }
}
