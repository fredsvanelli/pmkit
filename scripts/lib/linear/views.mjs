// Saved views on Linear (PMK-212): the workspace's custom views, read and run through the API. Linear keeps the filter,
// so a view here has `filter: null` and its Linear filter in `linear.filterData`. Creating, renaming and deleting stay in Linear.

import { PmkitError } from '../errors.mjs'
import { viewOverrides } from '../issue-filter.mjs'
import { CUSTOM_VIEWS_QUERY, CUSTOM_VIEW_ISSUES_QUERY } from './documents.mjs'
import { finishSearch } from './filter.mjs'
import { blockedOpen, toIssue } from './issues.mjs'

export const LINEAR_VIEW_WRITES = 'Linear views are created, renamed and deleted in Linear; pmkit reads and runs them'
export const VIEWS_CUT = 'Linear has more views than pmkit read, so the list is not complete'
const SEARCH_PAGE = 100
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1)

/** `issues` is the issue family: its completeNested and contextFor map the nodes as searchIssues does. */
export function viewOperations({ client, config, issues }) {
  const scopeTeam = config.pmkit?.tracker?.scope?.team

  /** The issue views of the scope team and the views with no team. hasMore says the client's page cap cut the read. */
  async function listViews() {
    const { nodes, hasMore } = await client.paginate(CUSTOM_VIEWS_QUERY, {}, { select: (data) => data.customViews })
    const views = nodes
      .filter((node) => node.modelName === 'Issue' && (node.team === null || node.team?.key === scopeTeam))
      .map((node) => ({ name: node.name, id: node.id, filter: null, linear: { team: node.team?.key ?? null, shared: node.shared, filterData: node.filterData } }))
      .sort(byName)
    return { views, problems: [], hasMore }
  }

  /** By id, then by exact name. Two views with the name are ambiguous; in a cut list a name is never sure, so it asks for the id. */
  async function findView(name) {
    const { views, hasMore } = await listViews()
    const named = views.filter((view) => view.name === name)
    if (named.length > 1) {
      throw new PmkitError('INVALID_INPUT', `${named.length} views are named ${name}: ${named.map((view) => view.id).join(', ')}`, 'Run the view by its id', { reason: 'ambiguous_view_name' })
    }
    const byId = views.find((view) => view.id === name)
    if (byId) return byId
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
    const { nodes, hasMore } = await client.paginate(CUSTOM_VIEW_ISSUES_QUERY, { id: view.id, sort: [{ createdAt: { order: 'Ascending' } }] }, { select: (data) => data.customView.issues, pageSize: SEARCH_PAGE })
    for (const node of nodes) await issues.completeNested(node)
    const mapping = await issues.contextFor(nodes)
    const rows = nodes.map((node) => ({ issue: toIssue(node, mapping), blocked: blockedOpen(node, mapping) })).filter((row) => row.issue !== null)
    return { issues: finishSearch(rows, given, mapping), problems: [], hasMore, view, overrides: given }
  }

  const refuse = async () => {
    throw new PmkitError('NOT_SUPPORTED', LINEAR_VIEW_WRITES, 'Change the view in Linear')
  }
  return { listViews, runView, saveView: refuse, deleteView: refuse, renameView: refuse }
}
