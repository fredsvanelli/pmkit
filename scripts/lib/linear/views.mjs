// Saved views on Linear (PMK-212): the workspace's custom views, read and run through the API. Linear keeps the filter,
// so a view here has `filter: null` and its Linear filter in `linear.filterData`. Creating, renaming and deleting stay in Linear.

import { PmkitError } from '../errors.mjs'
import { viewOverrides } from '../issue-filter.mjs'
import { CUSTOM_VIEWS_QUERY, CUSTOM_VIEW_ISSUES_QUERY, CUSTOM_VIEW_QUERY } from './documents.mjs'
import { finishSearch } from './filter.mjs'
import { blockedOpen, toIssue } from './issues.mjs'

export const LINEAR_VIEW_WRITES = 'Linear views are created, renamed and deleted in Linear; pmkit reads and runs them'
export const VIEWS_CUT = 'Linear has more views than pmkit read, so the list is not complete'
const SEARCH_PAGE = 100
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1)

/** `issues` is the issue family: its completeNested and contextFor map the nodes as searchIssues does. */
export function viewOperations({ client, config, issues }) {
  const scopeTeam = config.pmkit?.tracker?.scope?.team

  const inScope = (node) => node.team === null || node.team?.key === scopeTeam
  const toView = (node) => ({ name: node.name, id: node.id, filter: null, linear: { team: node.team?.key ?? null, shared: node.shared, filterData: node.filterData } })

  /** A view by its id, read directly, so a view past the cut of the list still runs. */
  async function viewById(id) {
    let node
    try {
      node = (await client.request(CUSTOM_VIEW_QUERY, { id })).customView
    } catch (error) {
      // Linear answers an unknown id with an "Entity not found" error.
      if (!(error instanceof PmkitError) || !/not found/i.test(error.message)) throw error
    }
    if (!node) throw new PmkitError('NOT_FOUND', `view ${id} does not exist`, 'pmkit views list')
    if (node.modelName !== 'Issue') throw new PmkitError('INVALID_INPUT', `view ${id} (${node.name}) lists ${String(node.modelName).toLowerCase()}s, so it is not an issue view`, 'pmkit views list')
    if (!inScope(node)) throw new PmkitError('INVALID_INPUT', `view ${id} (${node.name}) belongs to team ${node.team.key}, not to ${scopeTeam}`, 'pmkit views list')
    return toView(node)
  }

  /** The issue views of the scope team and the views with no team. hasMore says the client's page cap cut the read. */
  async function listViews() {
    const { nodes, hasMore } = await client.paginate(CUSTOM_VIEWS_QUERY, {}, { select: (data) => data.customViews })
    const views = nodes.filter((node) => node.modelName === 'Issue' && inScope(node)).map(toView).sort(byName)
    return { views, problems: [], hasMore }
  }

  /** An id is read directly; a name is matched exactly in the list. Two views with the name are ambiguous; in a cut list a name is never sure, so it asks for the id. */
  async function findView(name) {
    if (UUID.test(name)) return viewById(name)
    const { views, hasMore } = await listViews()
    const named = views.filter((view) => view.name === name)
    if (named.length > 1) {
      throw new PmkitError('INVALID_INPUT', `${named.length} views are named ${name}: ${named.map((view) => view.id).join(', ')}`, 'Run the view by its id', { reason: 'ambiguous_view_name' })
    }
    // In a cut list a name found once may have a twin past the cut, so only the id is a sure match.
    if (named.length === 1 && hasMore) {
      throw new PmkitError('INVALID_INPUT', `view ${name} is ${named[0].id} among the views pmkit read, but ${VIEWS_CUT}, so another view may have the name`, `Run it by its id: pmkit views run ${named[0].id}`, { reason: 'view_list_incomplete' })
    }
    if (named.length === 1) return named[0]
    if (hasMore) throw new PmkitError('NOT_FOUND', `view ${name} is not among the views pmkit read: ${VIEWS_CUT}`, 'Run the view by its id', { reason: 'view_list_incomplete' })
    throw new PmkitError('NOT_FOUND', `view ${name} does not exist`, 'pmkit views list')
  }

  /** Linear runs the view's filter; pmkit then applies its order and the limit, so --sort and --limit work as on Local. */
  async function runView(name, overrides = {}) {
    const given = viewOverrides(overrides)
    const view = await findView(name)
    if (given.limit === 0) return { issues: [], problems: [], hasMore: false, view, overrides: given }
    // The created order, as searchIssues asks: a read cut at the page cap then keeps the oldest issues, which the created order shows first.
    // With the created order Linear's order is the final one, so the limit goes to the read, as searchIssues does.
    const serverLimit = (given.sort ?? 'created') === 'created' ? given.limit : undefined
    const { nodes, hasMore } = await client.paginate(CUSTOM_VIEW_ISSUES_QUERY, { id: view.id, sort: [{ createdAt: { order: 'Ascending' } }] }, { select: (data) => data.customView.issues, pageSize: SEARCH_PAGE, limit: serverLimit })
    for (const node of nodes) await issues.completeNested(node)
    await issues.attachReleasesTo(nodes)
    const mapping = await issues.contextFor(nodes)
    const rows = nodes.map((node) => ({ issue: toIssue(node, mapping), blocked: blockedOpen(node, mapping) })).filter((row) => row.issue !== null)
    // With a limit sent to Linear, hasMore only says the limit cut the read, which is not an incomplete list.
    return { issues: finishSearch(rows, given, mapping), problems: [], hasMore: serverLimit === undefined && hasMore, view, overrides: given }
  }

  const refuse = async () => {
    throw new PmkitError('NOT_SUPPORTED', LINEAR_VIEW_WRITES, 'Change the view in Linear')
  }
  return { listViews, runView, saveView: refuse, deleteView: refuse, renameView: refuse }
}
