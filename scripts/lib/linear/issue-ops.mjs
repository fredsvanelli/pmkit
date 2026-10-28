// The Issues family of the Linear tracker: reads, writes, moves, assignment and archive.
// See docs/superpowers/specs/2026-10-27-pmk-35-linear-issues-relations-search-design.md.

import { PmkitError } from '../errors.mjs'
import { CATEGORIES } from '../model.mjs'
import { checkFilter } from '../issue-filter.mjs'
import { cycleKey } from './cycles.mjs'
import { CYCLES_QUERY, CYCLE_BY_NUMBER_QUERY, ISSUES_QUERY, ISSUE_ARCHIVE, ISSUE_BY_ID_QUERY, ISSUE_CREATE, ISSUE_UPDATE, NESTED_PAGES, NESTED_PAGE_SIZE } from './documents.mjs'
import { finishSearch, translateFilter } from './filter.mjs'
import { blockedOpen, isIssueId, issueKey, makeContext, stateCategory, toIssue } from './issues.mjs'
import { applyInput, createTeam, requireAssignee, skeletonNode, teamOf, teamStates, toInput } from './writes.mjs'

const SEARCH_PAGE = 100
const NOTHING = () => ({ issues: [], problems: [], hasMore: false })
/** True for the client's error on a mutation whose answer never came, so the change may or may not exist. */
export const isUnconfirmed = (error) =>
  error instanceof PmkitError && error.code === 'UPSTREAM' && error.message.startsWith('Linear did not confirm the change')

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
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
    checkFilter(filter, { types: Object.keys(current.mappings?.types ?? {}), members, sprintExists: (id) => cycleKey(id) !== null })
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
    // With a caller limit sent to Linear, paginate's hasMore says the limit cut the read. hasMore means the page cap cut it.
    return { issues: finishSearch(rows, filter, mapping), problems: [], hasMore: translated.serverLimit === undefined && hasMore }
  }

  /** ADR-0005: Linear records every write as the key's owner, so any other actor would make pmkit's output disagree with Linear. */
  async function requireViewer(actor) {
    requireWorkspace()
    const { viewer } = await context()
    if (actor !== viewer.id) {
      throw new PmkitError('INVALID_INPUT', `Linear records every write as the owner of LINEAR_API_KEY (${viewer.name})`, 'Drop --as, or use a key created by that member')
    }
  }

  /** The node and the issue a write returns, with every nested list complete. */
  async function mapped(node) {
    await completeNested(node)
    return toIssue(node, await contextFor([node]))
  }

  async function parentNodeOf(parent) {
    if (parent === undefined || parent === null || !isIssueId(parent)) return undefined
    try {
      return await readNode(parent)
    } catch (error) {
      if (error instanceof PmkitError && error.code === 'NOT_FOUND') {
        throw new PmkitError('INVALID_INPUT', `parent ${parent} is not an existing issue`, 'pmkit issues list')
      }
      throw error
    }
  }

  /**
   * The { id, number } node of the cycle a sprint value names in `team`: 'current' is the active cycle, else a cycle number.
   * Returns undefined for no value, for null and for a team with cycles off, where toInput decides. Reads the cycle, so a
   * bad value fails before the write: NOT_FOUND for an unknown cycle, INVALID_INPUT for no active one.
   */
  async function cycleNodeFor(sprint, team) {
    if (sprint === undefined || sprint === null || team.cyclesEnabled !== true) return undefined
    if (typeof sprint !== 'string') throw new PmkitError('INVALID_INPUT', 'sprint must be a string')
    const teamClause = { team: { key: { eq: team.key } } }
    if (sprint === 'current') {
      const data = await client.request(CYCLES_QUERY, { filter: { and: [teamClause, { isActive: { eq: true } }] }, first: 1 })
      const active = data?.cycles?.nodes?.[0]
      if (!active) throw new PmkitError('INVALID_INPUT', 'there is no active sprint', 'pmkit cycle list')
      return { id: active.id, number: active.number }
    }
    const number = cycleKey(sprint)
    const missing = new PmkitError('NOT_FOUND', `sprint ${sprint} does not exist`, 'pmkit cycle list')
    if (number === null) throw missing
    const data = await client.request(CYCLE_BY_NUMBER_QUERY, { filter: { and: [teamClause, { number: { eq: number } }] } })
    const found = data?.cycles?.nodes?.[0]
    if (!found) throw missing
    return { id: found.id, number: found.number }
  }

  async function createIssue(input, actor, { dryRun = false } = {}) {
    await requireViewer(actor)
    const parentNode = await parentNodeOf(input?.parent)
    const { team, linearInput, current, cycleNode } = await withRefresh(async (ctx) => {
      const target = createTeam(ctx)
      const cycle = await cycleNodeFor(input?.sprint, target)
      return { team: target, linearInput: toInput(input, { mode: 'create', team: target, context: ctx, parentNode, cycleNode: cycle }), current: ctx, cycleNode: cycle }
    })
    if (dryRun) {
      const preview = applyInput(skeletonNode(team, now().toISOString(), current), linearInput, current, { parent: parentNode?.identifier, cycle: cycleNode })
      return { before: null, after: { ...toIssue(preview, current), id: null } }
    }
    const id = uuid()
    let node
    try {
      node = (await client.request(ISSUE_CREATE, { input: { id, ...linearInput } })).issueCreate.issue
    } catch (error) {
      if (!isUnconfirmed(error)) throw error
      // The UUID pmkit chose tells whether the create happened. One read, then the original error.
      node = (await client.request(ISSUE_BY_ID_QUERY, { id }))?.issues?.nodes?.[0]
      if (!node) throw error
    }
    return { before: null, after: await mapped(node) }
  }

  async function updateIssue(id, patch, actor, { dryRun = false } = {}) {
    await requireViewer(actor)
    const beforeNode = await readNode(id)
    const before = toIssue(beforeNode, await contextFor([beforeNode]))
    const { linearInput, current, cycleNode } = await withRefresh(async (ctx) => {
      const cycle = await cycleNodeFor(patch.sprint, teamOf(ctx, beforeNode.team.id))
      return { linearInput: toInput(patch, { mode: 'update', beforeNode, context: ctx, cycleNode: cycle }), current: ctx, cycleNode: cycle }
    })
    if (patch.branch !== undefined && patch.branch !== beforeNode.branchName) {
      throw new PmkitError('INVALID_INPUT', `Linear names this issue's branch ${beforeNode.branchName}`, `Use the branch name ${beforeNode.branchName}`)
    }
    if (Object.keys(linearInput).length === 0) return { before, after: before }
    return writeUpdate(beforeNode, before, linearInput, current, dryRun, before.parent, cycleNode)
  }

  /** Sends one issueUpdate unless the preview equals the issue; a dry run returns the preview. */
  async function writeUpdate(beforeNode, before, linearInput, current, dryRun, parent = before.parent, cycle) {
    const preview = toIssue(applyInput(beforeNode, linearInput, current, { parent, cycle }), current)
    if (same(preview, before)) return { before, after: before }
    if (dryRun) return { before, after: preview }
    const node = (await client.request(ISSUE_UPDATE, { id: beforeNode.id, input: linearInput })).issueUpdate.issue
    return { before, after: await mapped(node) }
  }

  /**
   * The state of the issue's team a move without --status goes to: resolveMappings' targetState (PMK-34 rule 2), or NOT_SUPPORTED.
   * For the scope team, the tracker's mapping check already stopped on a mapped state the team lacks, so no refresh happens here.
   */
  function moveTarget(team, category, current) {
    const target = current.mappingsOf(team).targetState(category)
    if (target) return teamStates(current, team).find((item) => item.id === target.id)
    if (current.mappingsOf(team).duplicateOnly(category)) {
      throw new PmkitError(
        'NOT_SUPPORTED',
        `team ${team.key} has no status in the ${category} category except Duplicate`,
        `Set mappings.status.${category} explicitly, for example mappings.status.${category}: Duplicate, to allow it`,
      )
    }
    const nextStep = category === 'triage' && !team.triageEnabled ? "Turn on triage in the team's settings in Linear" : '/pmkit:setup'
    throw new PmkitError('NOT_SUPPORTED', `team ${team.key} has no status in the ${category} category`, nextStep)
  }

  async function moveToCategory(id, category, actor, { status, dryRun = false } = {}) {
    requireWorkspace()
    if (!CATEGORIES.includes(category)) throw new PmkitError('INVALID_INPUT', `category must be one of ${CATEGORIES.join(', ')}`)
    await requireViewer(actor)
    const beforeNode = await readNode(id)
    const current = await contextFor([beforeNode])
    const before = toIssue(beforeNode, current)
    const team = teamOf(current, beforeNode.team.id)
    let target
    if (status !== undefined) {
      const inCategory = teamStates(current, team).filter((item) => stateCategory(item, current) === category)
      if (inCategory.length === 0) moveTarget(team, category, current)
      target = inCategory.find((item) => item.name === status)
      if (!target) throw new PmkitError('INVALID_INPUT', `status ${status} is not in category ${category}`, `Use one of: ${inCategory.map((item) => item.name).join(', ')}`)
    } else {
      target = moveTarget(team, category, current)
    }
    if (beforeNode.state.id === target.id) return { before, after: before }
    return writeUpdate(beforeNode, before, { stateId: target.id }, await context(), dryRun)
  }

  /** `who` is a member id, 'me' for the actor, or null to unassign. */
  async function assign(id, who, actor, { dryRun = false } = {}) {
    await requireViewer(actor)
    const member = who === 'me' ? actor : who
    if (member !== null) await withRefresh((ctx) => requireAssignee(ctx, member))
    const beforeNode = await readNode(id)
    const current = await contextFor([beforeNode])
    const before = toIssue(beforeNode, current)
    if ((before.assignee ?? null) === member) return { before, after: before }
    return writeUpdate(beforeNode, before, { assigneeId: member }, current, dryRun)
  }

  async function archive(id, actor, { dryRun = false } = {}) {
    await requireViewer(actor)
    const beforeNode = await readNode(id)
    const before = toIssue(beforeNode, await contextFor([beforeNode]))
    if (before.archived) return { before, after: before }
    if (dryRun) return { before, after: { ...before, archived: true } }
    await client.request(ISSUE_ARCHIVE, { id: beforeNode.id })
    // The archive payload has no issue fields, so the issue is read again; readNode includes archived issues.
    return { before, after: await mapped(await readNode(id)) }
  }

  return { getIssue, searchIssues, cycleNodeFor, createIssue, updateIssue, moveToCategory, assign, archive, requireViewer, mapped, writeUpdate, parentNodeOf, context, readNode, contextFor, completeNested, withRefresh, requireWorkspace, now, uuid }
}
