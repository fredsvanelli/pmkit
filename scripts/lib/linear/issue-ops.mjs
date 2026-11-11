// The Issues family of the Linear tracker: reads, writes, moves, assignment and archive.
// See docs/superpowers/specs/2026-10-27-pmk-35-linear-issues-relations-search-design.md.

import { PmkitError } from '../errors.mjs'
import { resolveDefaultBranch } from '../config.mjs'
import { repoDocPath } from '../doc-path.mjs'
import { CATEGORIES } from '../model.mjs'
import { REFERENCE_KINDS, REPO_UNCHECKED, referencedError } from '../delete-refusal.mjs'
import { compareIds } from '../ids.mjs'
import { checkFilter } from '../issue-filter.mjs'
import { cycleKey } from './cycles.mjs'
import { CYCLES_QUERY, CYCLE_BY_NUMBER_QUERY, ISSUE_RELEASES_QUERY, ISSUES_QUERY, ISSUES_RELEASES_QUERY, ATTACHMENT_CREATE, ATTACHMENT_DELETE, ISSUE_ARCHIVE, ISSUE_ATTACHMENTS_QUERY, ISSUES_ATTACHMENTS_QUERY, ISSUE_BY_ID_QUERY, ISSUE_CREATE, ISSUE_DELETE, ISSUE_REFERENCES_QUERY, ISSUE_UNARCHIVE, ISSUE_UPDATE, NESTED_PAGES, NESTED_PAGE_SIZE, REFERENCE_PAGES } from './documents.mjs'
import { finishSearch, translateFilter } from './filter.mjs'
import { blockedOpen, docPaths, isIssueId, issueKey, makeContext, stateCategory, toIssue } from './issues.mjs'
import { allReleases, releasesOff } from './releases.mjs'
import { applyInput, createTeam, requireAssignee, skeletonNode, teamOf, teamStates, toInput } from './writes.mjs'

const SEARCH_PAGE = 100
const NOTHING = () => ({ issues: [], problems: [], hasMore: false })
/** True for the client's error on a mutation whose answer never came, so the change may or may not exist. */
export const isUnconfirmed = (error) =>
  error instanceof PmkitError && error.code === 'UPSTREAM' && error.message.startsWith('Linear did not confirm the change')

const nodesOf = (connection) => connection?.nodes ?? []
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const notFound = (id) => new PmkitError('NOT_FOUND', `issue ${id} does not exist`, 'pmkit issues list')

/**
 * The issue operations over one client. `discovery({ refresh })` is the tracker's memo of the raw discovery.
 * `resolveEpic(key)` returns the raw project node of an epic key, or null; without it a parent must be an issue.
 * `resolveMilestone(id)` returns the raw project milestone node, or throws NOT_FOUND; without it a milestone is NOT_SUPPORTED.
 * `resolveRelease(id)` returns the raw release node, or throws NOT_FOUND for an unknown or canceled one (PMK-246).
 * Besides the contract operations, the result holds the helpers the relation operations use.
 */
export function issueOperations({ client, discovery, config, now = () => new Date(), uuid, resolveEpic, resolveMilestone, resolveRelease }) {
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
  async function completeNested(node, pages = NESTED_PAGES) {
    for (const field of Object.keys(pages)) {
      if (node[field]?.pageInfo?.hasNextPage !== true) continue
      const { nodes } = await client.paginate(pages[field], { id: node.id }, { select: (data) => data.issue[field], pageSize: NESTED_PAGE_SIZE })
      node[field] = { nodes, pageInfo: { hasNextPage: false, endCursor: null } }
    }
    return node
  }

  // A failed release read leaves the release unknown rather than failing the issue read or the write that returned it.
  const unreadable = (error) => error instanceof PmkitError && ['UPSTREAM', 'RATE_LIMITED', 'AUTH'].includes(error.code)
  const notes = []
  /** The notes this run collected (an unknown release), once: the CLI prints them after the result. */
  const takeNotes = () => notes.splice(0)

  /** True when the workspace has releases on, from the cached discovery: no request. */
  const releasesOn = async () => (await discovery()).raw.flags?.releasesEnabled === true

  /** Puts one issue's releases on its node, every page, as `releases: { nodes }`, which toIssue reads. */
  async function attachReleases(node) {
    node.releases = { nodes: await allReleases(client, ISSUE_RELEASES_QUERY, { id: node.id }, (data) => data.issue.releases) }
    return node
  }

  /**
   * Puts the releases on every node when releases are on (review of PMK-246): one request per 100 issues, and one more for an issue
   * whose list has a next page. With releases off it sends nothing and toIssue shows no release.
   */
  async function attachReleasesTo(all) {
    const nodes = all.filter((node) => node.releases === undefined && !node.releasesUnread)
    if (nodes.length === 0 || !(await releasesOn())) return all
    for (let at = 0; at < nodes.length; at += 100) {
      const chunk = nodes.slice(at, at + 100)
      try {
        const data = await client.request(ISSUES_RELEASES_QUERY, { ids: chunk.map((node) => node.id), first: chunk.length })
        const byId = new Map((data?.issues?.nodes ?? []).map((item) => [item.id, item.releases]))
        for (const node of chunk) {
          const connection = byId.get(node.id)
          if (connection && connection.pageInfo?.hasNextPage !== true) node.releases = { nodes: connection.nodes }
          else await attachReleases(node)
        }
      } catch (error) {
        if (!unreadable(error)) throw error
        // An incomplete read (lessons): the issue still comes back, its release is unknown, and a note says why.
        const unread = chunk.filter((node) => node.releases === undefined)
        for (const node of unread) node.releasesUnread = error
        const ids = unread.map((node) => node.identifier).filter(Boolean)
        notes.push(`the release of ${ids.length > 3 ? `${ids.slice(0, 3).join(', ')} and ${ids.length - 3} more issues` : ids.join(', ')} ${ids.length === 1 ? 'is' : 'are'} unknown, because pmkit could not read it: ${error.message}`)
      }
    }
    return all
  }

  const idList = (ids) => (ids.length > 3 ? `${ids.slice(0, 3).join(', ')} and ${ids.length - 3} more issues` : ids.join(', '))

  /** Puts one issue's attachments on its node, every page. A list the page cap cut is UPSTREAM, so part of it never reads as the whole. */
  async function attachDocs(node) {
    const { nodes, hasMore } = await client.paginate(ISSUE_ATTACHMENTS_QUERY, { id: node.id }, { select: (data) => data.issue.attachments, pageSize: 50, maxPages: 100 })
    if (hasMore) throw new PmkitError('UPSTREAM', `${node.identifier} has more than 5000 attachments, and pmkit does not answer with part of them`, 'Remove attachments in Linear')
    node.attachments = { nodes }
    return node
  }

  /**
   * Puts the attachments (the docs, PMK-252) on every node: one request per 100 issues, and one more for an issue whose list has a
   * next page. A refused or failed read leaves them unknown on the node (attachmentsUnread) with a note, never an empty list.
   */
  async function attachDocsTo(all) {
    const nodes = all.filter((node) => node.attachments === undefined && !node.attachmentsUnread)
    for (let at = 0; at < nodes.length; at += 100) {
      const chunk = nodes.slice(at, at + 100)
      try {
        const data = await client.request(ISSUES_ATTACHMENTS_QUERY, { ids: chunk.map((node) => node.id), first: chunk.length })
        const byId = new Map((data?.issues?.nodes ?? []).map((item) => [item.id, item.attachments]))
        for (const node of chunk) {
          const connection = byId.get(node.id)
          if (connection && connection.pageInfo?.hasNextPage !== true) node.attachments = { nodes: connection.nodes }
          else await readDocsAlone(node)
        }
      } catch (error) {
        if (!unreadable(error)) throw error
        unknownDocs(chunk.filter((node) => node.attachments === undefined && !node.attachmentsUnread), error)
      }
    }
    return all
  }

  /** The note and the mark of issues whose docs are unknown: never an empty list. */
  function unknownDocs(nodes, error) {
    if (nodes.length === 0) return
    for (const node of nodes) node.attachmentsUnread = error
    const ids = nodes.map((node) => node.identifier).filter(Boolean)
    notes.push(`the docs of ${idList(ids)} are unknown, because pmkit could not read them: ${error.message}`)
  }

  /** The one-issue read of a list the batch cut. Its failure marks only that issue, the rest of the batch keeps what it read. */
  async function readDocsAlone(node) {
    try {
      await attachDocs(node)
    } catch (error) {
      if (!unreadable(error)) throw error
      unknownDocs([node], error)
    }
  }

  /** The node of an issue id, archived ones included. A malformed id or a trashed issue is NOT_FOUND, and a malformed one sends no request. */
  async function readNode(id) {
    requireWorkspace()
    if (!isIssueId(id)) throw notFound(id)
    const data = await client.request(ISSUE_BY_ID_QUERY, { id: issueKey(id) })
    const node = data?.issues?.nodes?.[0]
    if (!node || node.trashed === true) throw notFound(id)
    await completeNested(node)
    return (await attachDocsTo(await attachReleasesTo([node])))[0]
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
    let epicProject
    if (filter.parent !== undefined && !isIssueId(filter.parent) && resolveEpic) {
      epicProject = await resolveEpic(filter.parent)
      if (!epicProject) return NOTHING()
    }
    const translated = translateFilter(filter, { ...current, epicProject })
    if (filter.limit === 0 || translated.empty) return NOTHING()
    const { nodes, hasMore } = await client.paginate(ISSUES_QUERY, translated.variables, {
      select: (data) => data.issues,
      pageSize: SEARCH_PAGE,
      limit: translated.serverLimit,
    })
    for (const node of nodes) await completeNested(node)
    await attachReleasesTo(nodes)
    await attachDocsTo(nodes)
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
    await attachReleasesTo([node])
    await attachDocsTo([node])
    return toIssue(node, await contextFor([node]))
  }

  /**
   * The node a parent id names: { kind: 'issue', node } or { kind: 'epic', node }, or undefined when no parent is given.
   * An id that is neither an existing issue nor an existing epic is INVALID_INPUT.
   */
  async function parentNodeOf(parent) {
    if (parent === undefined || parent === null) return undefined
    const missing = () => new PmkitError('INVALID_INPUT', `parent ${parent} is not an existing issue or epic`, 'pmkit issues list')
    if (!isIssueId(parent)) {
      if (!resolveEpic) throw new PmkitError('NOT_SUPPORTED', 'Linear projects are not epics in pmkit yet', 'Use an issue id as the parent')
      const node = await resolveEpic(parent)
      if (!node) throw missing()
      return { kind: 'epic', node }
    }
    try {
      return { kind: 'issue', node: await readNode(parent) }
    } catch (error) {
      if (error instanceof PmkitError && error.code === 'NOT_FOUND') throw missing()
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
    const target = await parentNodeOf(input?.parent)
    const parentNode = target?.kind === 'issue' ? target.node : undefined
    const epicNode = target?.kind === 'epic' ? target.node : undefined
    if (input?.milestone !== undefined && input.milestone !== null && !epicNode) {
      const message = parentNode ? 'a milestone on a new Linear issue needs an epic as its parent, and a sub-issue takes none' : 'a milestone on a new Linear issue needs an epic parent'
      throw new PmkitError('INVALID_INPUT', message, 'Add --parent <epic>')
    }
    const milestoneNode = await milestoneNodeFor(input?.milestone, { project: epicNode })
    const { team, linearInput, current, cycleNode } = await withRefresh(async (ctx) => {
      const teamNode = createTeam(ctx)
      const cycle = await cycleNodeFor(input?.sprint, teamNode)
      const linear = toInput(input, { mode: 'create', team: teamNode, context: ctx, parentNode, epicNode, cycleNode: cycle, milestoneNode })
      return { team: teamNode, linearInput: linear, current: ctx, cycleNode: cycle }
    })
    if (dryRun) {
      const preview = applyInput(skeletonNode(team, now().toISOString(), current), linearInput, current, { parent: parentNode?.identifier, project: epicNode, cycle: cycleNode })
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
    // A new issue is in no release (create sets none), so its releases are not read.
    node.releases ??= { nodes: [] }
    node.attachments ??= { nodes: [] }
    return { before: null, after: await mapped(node) }
  }

  const milestoneReads = new Map()
  const releaseReads = new Map()

  /**
   * The raw release a release value names (PMK-246, decision PMK-246-1): refuses with releases off, then a target that is unknown,
   * canceled or of another team, then an issue in two or more releases, with words that do not name the issue, so a bulk change shows
   * the same message on each. readNode put the issue's releases on beforeNode. The target is read once per run.
   */
  async function releaseNodeFor(release, beforeNode) {
    if (release === undefined) return undefined
    if (!(await releasesOn())) throw releasesOff()
    if (release !== null && !releaseReads.has(release)) releaseReads.set(release, resolveRelease(release).catch((error) => { releaseReads.delete(release); throw error }))
    const target = release === null ? null : await releaseReads.get(release)
    // The one-release rule needs the real count: an unknown list refuses the write, and a node without one reads it.
    if (beforeNode.releasesUnread) throw beforeNode.releasesUnread
    if (beforeNode.releases === undefined) await attachReleases(beforeNode)
    const count = beforeNode.releases.nodes.filter((item) => item.stage?.type !== 'canceled').length
    if (count > 1) throw new PmkitError('INVALID_INPUT', `the issue is in ${count} Linear releases, and pmkit sets one release per issue`, 'Change the releases of the issue in Linear')
    return target
  }

  /** The raw milestone a milestone value names, checked against the project of the issue: Linear takes only a milestone of the issue's own project. */
  async function milestoneNodeFor(milestone, beforeNode) {
    if (milestone === undefined || milestone === null) return undefined
    if (!resolveMilestone) throw new PmkitError('NOT_SUPPORTED', 'set the milestone in Linear', 'Leave milestone out on Linear')
    // One read per milestone for a whole bulk run, not one per issue. A failed read is not kept.
    if (!milestoneReads.has(milestone)) milestoneReads.set(milestone, resolveMilestone(milestone).catch((error) => { milestoneReads.delete(milestone); throw error }))
    const node = await milestoneReads.get(milestone)
    if (node.project?.id !== beforeNode.project?.id) {
      // The same words for every issue, so a bulk change with a wrong milestone fails once (valueError).
      throw new PmkitError('INVALID_INPUT', `milestone ${milestone} is not in the project of the issue`, 'Put the issue in the project of the milestone first, or pick a milestone of its project')
    }
    return node
  }

  async function updateIssue(id, patch, actor, { dryRun = false, docsBranch } = {}) {
    await requireViewer(actor)
    const beforeNode = await readNode(id)
    const releaseNode = await releaseNodeFor(patch.release, beforeNode)
    const before = toIssue(beforeNode, await contextFor([beforeNode]))
    const milestoneNode = await milestoneNodeFor(patch.milestone, beforeNode)
    const { linearInput, current, cycleNode } = await withRefresh(async (ctx) => {
      const cycle = await cycleNodeFor(patch.sprint, teamOf(ctx, beforeNode.team.id))
      return { linearInput: toInput(patch, { mode: 'update', beforeNode, context: ctx, cycleNode: cycle, milestoneNode, releaseNode }), current: ctx, cycleNode: cycle }
    })
    if (patch.branch !== undefined && patch.branch !== beforeNode.branchName) {
      throw new PmkitError('INVALID_INPUT', `Linear names this issue's branch ${beforeNode.branchName}`, `Use the branch name ${beforeNode.branchName}`)
    }
    const change = patch.docs === undefined ? null : docChange(beforeNode, patch.docs, docsBranch)
    let result = { before, after: before }
    if (Object.keys(linearInput).length > 0) result = await writeUpdate(beforeNode, before, linearInput, current, dryRun, { cycle: cycleNode, release: releaseNode })
    if (change === null) return result
    if (dryRun) {
      const { docs, ...rest } = result.after
      return { before, after: patch.docs.length > 0 ? { ...rest, docs: patch.docs } : rest }
    }
    await writeDocs(before.id, change, { fieldsWritten: Object.keys(linearInput) })
    // The issue is read again, so `after` is what Linear holds: its attachments changed after the update's own answer.
    return { before, after: await mapped(await readNode(before.id)) }
  }

  /** The docs a write adds (paths) and removes (attachment nodes), or null when the list is the one the issue has. An unread list refuses. */
  function docChange(beforeNode, docList, branch) {
    if (beforeNode.attachmentsUnread) throw beforeNode.attachmentsUnread
    const docs = [...new Set(docList.map(repoDocPath))]
    const nodes = beforeNode.attachments?.nodes ?? []
    const isDoc = (item) => typeof item.metadata?.pmkitDoc === 'string'
    const current = docPaths(nodes)
    const add = docs.filter((path) => !current.includes(path)).map((path) => ({ path, url: docUrl(path, branch) }))
    // attachmentCreate upserts by url, so an attachment a person made with this link would be rewritten, and removed later as a doc.
    const taken = add.map((item) => nodes.find((node) => node.url === item.url && !isDoc(node))).filter(Boolean)
    if (taken.length > 0) {
      throw new PmkitError('CONFLICT', `${beforeNode.identifier} already has an attachment with the link ${taken[0].url} that pmkit did not create, so pmkit leaves it alone and does not link ${add.find((item) => item.url === taken[0].url).path}`, 'Remove that attachment in Linear, then run the command again')
    }
    const remove = nodes.filter((item) => isDoc(item) && !docs.includes(item.metadata.pmkitDoc))
    if (add.length === 0 && remove.length === 0) return null
    return { add, remove }
  }

  /** The link of a docs path: the file on GitHub, on the default branch. The path stays in the attachment's metadata. */
  function docUrl(path, branch) {
    const host = config.pmkit?.git_host
    if (host?.system !== 'github' || !host.repo) {
      throw new PmkitError('NOT_CONFIGURED', 'a Linear doc is a link to the file on GitHub, and git_host has no GitHub repo', '/pmkit:link-repo')
    }
    const encode = (value) => value.split('/').map(encodeURIComponent).join('/')
    return `https://github.com/${host.repo}/blob/${encode(branch ?? resolveDefaultBranch(config.pmkit).branch)}/${encode(path)}`
  }

  /** attachmentCreate for each added path, then attachmentDelete for each removed one. A failure names what was done and what was not. */
  async function writeDocs(id, { add, remove }, { fieldsWritten = [] } = {}) {
    const linked = []
    const unlinked = []
    try {
      for (const item of add) {
        const answer = await client.request(ATTACHMENT_CREATE, { input: { issueId: id, url: item.url, title: item.path, metadata: { pmkitDoc: item.path } } })
        if (answer?.attachmentCreate?.success !== true) throw new PmkitError('UPSTREAM', `Linear did not link ${item.path}`)
        linked.push(item.path)
      }
      for (const item of remove) {
        const answer = await client.request(ATTACHMENT_DELETE, { id: item.id })
        if (answer?.attachmentDelete?.success !== true) throw new PmkitError('UPSTREAM', `Linear did not unlink ${item.metadata.pmkitDoc}`)
        unlinked.push(item.metadata.pmkitDoc)
      }
    } catch (error) {
      if (!(error instanceof PmkitError)) throw error
      const left = [...add.map((item) => item.path), ...remove.map((item) => item.metadata.pmkitDoc)].filter((path) => !linked.includes(path) && !unlinked.includes(path))
      const say = (paths) => (paths.length > 0 ? paths.join(', ') : 'none')
      throw new PmkitError(error.code, `${error.message}. Docs of ${id}: linked: ${say(linked)}; unlinked: ${say(unlinked)}; not done: ${say(left)}${fieldsWritten.length > 0 ? `. The other fields of this change were already written (${fieldsWritten.join(', ')})` : ''}`, `pmkit issues get ${id}`, error.details)
    }
  }

  /**
   * Sends one issueUpdate unless the preview equals the issue; a dry run returns the preview. `refs` names what ids in the input point
   * to: `parent` the parent's identifier for a parentId, `project` the project node for a projectId, `cycle` the { id, number } for a cycleId,
   * `release` the release node for addedReleaseIds. `mapped` reads the releases of the written issue again, so `after` is what Linear holds.
   */
  async function writeUpdate(beforeNode, before, linearInput, current, dryRun, { parent = before.parent, project, cycle, release } = {}) {
    const preview = toIssue(applyInput(beforeNode, linearInput, current, { parent, project, cycle, release }), current)
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

  /** The records that point at the issue, from its node: others it blocks, related in either direction, duplicates of it and its children. */
  function referencesTo(node) {
    const out = nodesOf(node.relations)
    const inverse = nodesOf(node.inverseRelations)
    const found = [
      ...out.filter((item) => item.type === 'blocks').map((item) => ({ id: item.relatedIssue.identifier, kind: 'blockedBy' })),
      ...out.filter((item) => item.type === 'related').map((item) => ({ id: item.relatedIssue.identifier, kind: 'related' })),
      ...inverse.filter((item) => item.type === 'related').map((item) => ({ id: item.issue.identifier, kind: 'related' })),
      ...inverse.filter((item) => item.type === 'duplicate').map((item) => ({ id: item.issue.identifier, kind: 'duplicateOf' })),
      ...nodesOf(node.children).map((child) => ({ id: child.identifier, kind: 'parent' })),
    ]
    const unique = [...new Map(found.map((ref) => [`${ref.id} ${ref.kind}`, ref])).values()]
    return unique.sort((a, b) => compareIds(a.id, b.id) || REFERENCE_KINDS.indexOf(a.kind) - REFERENCE_KINDS.indexOf(b.kind))
  }

  /**
   * Deletes an issue with issueDelete, which moves it to Linear's trash. It refuses, sending nothing, while another issue references it.
   * Linear's API shows relations and children only, so the text of other issues, views and local code are listed as not checked.
   */
  async function deleteIssue(id, actor, { dryRun = false } = {}) {
    await requireViewer(actor)
    const node = await readNode(id)
    const before = toIssue(node, await contextFor([node]))
    // The shared read leaves archived children and relations out. A failed read here fails the delete: it never means "no references".
    const archivedNode = (await client.request(ISSUE_REFERENCES_QUERY, { id: node.id }))?.issues?.nodes?.[0]
    if (!archivedNode) throw new PmkitError('UPSTREAM', `Linear did not return the references of ${before.id}, so they cannot be checked`, 'Run pmkit issues delete again')
    const references = referencesTo(await completeNested(archivedNode, REFERENCE_PAGES))
    if (references.length > 0) throw referencedError(before.id, references)
    const warnings = []
    if (before.branch !== undefined) warnings.push(`branch ${before.branch} and its pull request stay as they are`)
    if (before.assignee !== undefined && /^agent:/.test(before.assignee)) warnings.push(`it is assigned to ${before.assignee}, which may still be working on it`)
    if (before.delegate !== undefined) warnings.push(`it is delegated to ${before.delegate}, which may still be working on it`)
    const result = {
      before, after: null, removes: { trash: true }, references: [], mentions: [], warnings,
      unchecked: ['the descriptions and comments of other issues', 'saved views', 'Linear documents', REPO_UNCHECKED],
    }
    if (dryRun) return result
    const answer = await client.request(ISSUE_DELETE, { id: node.id })
    if (answer?.issueDelete?.success !== true) throw new PmkitError('UPSTREAM', `Linear did not delete ${before.id}`, 'Run pmkit issues get to see whether it still exists')
    return result
  }

  /** Brings an issue back from Linear's trash with issueUnarchive (PMK-222). Only a trashed issue qualifies; a dry run sends no mutation. */
  async function restore(id, actor, { dryRun = false } = {}) {
    await requireViewer(actor)
    requireWorkspace()
    if (!isIssueId(id)) throw notFound(id)
    const node = (await client.request(ISSUE_BY_ID_QUERY, { id: issueKey(id) }))?.issues?.nodes?.[0]
    if (!node) throw notFound(id)
    if (node.trashed !== true) throw new PmkitError('INVALID_INPUT', `${node.identifier} is not in Linear's trash`, `pmkit issues get ${node.identifier}`)
    const restored = await mapped({ ...node, trashed: false, archivedAt: null })
    if (dryRun) return { before: null, after: restored }
    const answer = await client.request(ISSUE_UNARCHIVE, { id: node.id })
    if (answer?.issueUnarchive?.success !== true) throw new PmkitError('UPSTREAM', `Linear did not restore ${node.identifier}`, `Run pmkit issues restore ${node.identifier} again`)
    // The write worked: a read-back that fails is a warning, never an error that would send the caller to restore again.
    try {
      return { before: null, after: await mapped(await readNode(node.identifier)), warnings: [] }
    } catch (error) {
      return { before: null, after: restored, warnings: [`${node.identifier} is restored, but reading it back failed (${error.message}), so this record is the one read before the restore: pmkit issues get ${node.identifier} shows it as it is now`] }
    }
  }

  return { attachReleasesTo, attachDocsTo, takeNotes, getIssue, searchIssues, cycleNodeFor, createIssue, updateIssue, moveToCategory, assign, archive, delete: deleteIssue, restore, requireViewer, mapped, writeUpdate, parentNodeOf, context, readNode, contextFor, completeNested, withRefresh, requireWorkspace, now, uuid }
}
