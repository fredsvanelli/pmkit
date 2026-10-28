// The Issues family of the Linear tracker: reads, writes, moves, assignment and archive.
// See docs/superpowers/specs/2026-10-27-pmk-35-linear-issues-relations-search-design.md.

import { PmkitError } from '../errors.mjs'
import { checkFilter } from '../issue-filter.mjs'
import { ISSUES_QUERY, ISSUE_BY_ID_QUERY, NESTED_PAGES, NESTED_PAGE_SIZE } from './documents.mjs'
import { finishSearch, translateFilter } from './filter.mjs'
import { blockedOpen, isIssueId, issueKey, makeContext, toIssue } from './issues.mjs'

const SEARCH_PAGE = 100
const NOTHING = () => ({ issues: [], problems: [], hasMore: false })
const notFound = (id) => new PmkitError('NOT_FOUND', `issue ${id} does not exist`, 'pmkit issues list')

/**
 * The issue operations over one client. `discovery({ refresh })` is the tracker's memo of the raw discovery.
 * Besides the contract operations, the result holds the helpers the relation operations use.
 */
export function issueOperations({ client, discovery, config, now = () => new Date(), uuid }) {
  const workspace = config.pmkit?.tracker?.scope?.workspace

  function requireWorkspace() {
    if (!workspace) throw new PmkitError('NOT_CONFIGURED', 'tracker.scope.workspace is not set', '/pmkit:setup')
  }

  /** The mapping context of this run. The viewer always comes from the session, never from the cache. */
  async function context({ refresh = false } = {}) {
    const { raw } = await discovery({ refresh })
    const session = await client.session()
    return makeContext(raw, config.pmkit, session.viewer)
  }

  /** Builds with the current context; when the build names something discovery may not know yet, refreshes once and builds again. */
  async function withRefresh(build) {
    try {
      return await build(await context())
    } catch (error) {
      if (!(error instanceof PmkitError) || error.details?.stale !== true) throw error
      return build(await context({ refresh: true }))
    }
  }

  /** Reads the pages after the first of each nested connection that has more, so every list is complete. */
  async function completeNested(node) {
    for (const field of Object.keys(NESTED_PAGES)) {
      if (node[field]?.pageInfo?.hasNextPage !== true) continue
      const { nodes } = await client.paginate(NESTED_PAGES[field], { id: node.id }, { select: (data) => data.issue[field], pageSize: NESTED_PAGE_SIZE })
      node[field] = { nodes, pageInfo: { hasNextPage: false, endCursor: null } }
    }
    return node
  }

  /** The node of an issue id, archived ones included. A malformed id or a trashed issue is NOT_FOUND, and a malformed one sends no request. */
  async function readNode(id) {
    requireWorkspace()
    if (!isIssueId(id)) throw notFound(id)
    const data = await client.request(ISSUE_BY_ID_QUERY, { id: issueKey(id) })
    const node = data?.issues?.nodes?.[0]
    if (!node || node.trashed === true) throw notFound(id)
    return completeNested(node)
  }

  /** A context that knows every state the nodes name: a state missing from a cached discovery refreshes it once. */
  async function contextFor(nodes) {
    const current = await context()
    const known = new Set(current.raw.states.map((state) => state.id))
    if (nodes.every((node) => !node.state || known.has(node.state.id))) return current
    return context({ refresh: true })
  }

  async function getIssue(id) {
    const node = await readNode(id)
    return toIssue(node, await contextFor([node]))
  }

  /** Narrows on the server with every key Linear has, then runs the blocked check, pmkit's order and the limit (spec, approach 2). */
  async function searchIssues(filter = {}) {
    requireWorkspace()
    const current = await context()
    const members = current.raw.users.filter((user) => !user.app).map((user) => user.id)
    checkFilter(filter, { types: Object.keys(current.mappings.types), members, sprintExists: () => true })
    const translated = translateFilter(filter, current)
    if (filter.limit === 0 || translated.empty) return NOTHING()
    const { nodes, hasMore } = await client.paginate(ISSUES_QUERY, translated.variables, {
      select: (data) => data.issues,
      pageSize: SEARCH_PAGE,
      limit: translated.serverLimit,
    })
    for (const node of nodes) await completeNested(node)
    const mapping = await contextFor(nodes)
    const rows = nodes
      .map((node) => ({ issue: toIssue(node, mapping), blocked: blockedOpen(node, mapping) }))
      .filter((row) => row.issue !== null)
    return { issues: finishSearch(rows, filter, mapping), problems: [], hasMore }
  }

  return { getIssue, searchIssues, context, readNode, contextFor, completeNested, withRefresh, requireWorkspace, now, uuid }
}
