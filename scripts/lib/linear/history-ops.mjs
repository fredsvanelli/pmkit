// The History and Comments families of the Linear tracker: getHistory, listComments, comment, resolveThread and metricEvents.
// See docs/superpowers/specs/2026-10-28-pmk-36-linear-history-comments-design.md.

import { AGENT_ID, delegationComment } from '../delegation.mjs'
import { PmkitError, isPmkitError } from '../errors.mjs'
import { compareIds } from '../ids.mjs'
import { COMMENT_BY_ID_QUERY, COMMENT_CREATE, COMMENT_RESOLVE, ISSUE_COMMENTS_QUERY, ISSUE_EVENTS_QUERY, ISSUE_HISTORY_QUERY, ISSUE_UPDATE } from './documents.mjs'
import { translateFilter } from './filter.mjs'
import { toComment, toEvents } from './history.mjs'
import { isUnconfirmed } from './issue-ops.mjs'
import { toIssue } from './issues.mjs'
import { NO_AGENT_HINT } from './manifest.mjs'

const PAGE = 100
const COMMENT_ID = /^[A-Za-z0-9-]+$/
const notOnIssue = (commentId, id) => new PmkitError('NOT_FOUND', `comment ${commentId} is not on ${id}`, `pmkit issues get ${id} --comments`)
const ISSUE_CAP_PAGE = 100

/** Compares an event time with a range bound by instant, so `2026-10-05T10:00:00Z` equals `2026-10-05T10:00:00.000Z`. */
function compareAt(at, bound) {
  const a = Date.parse(at)
  const b = Date.parse(bound)
  if (Number.isNaN(a) || Number.isNaN(b)) return at < bound ? -1 : at > bound ? 1 : 0
  return Math.sign(a - b)
}

const byCreated = (a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** The array with a non-enumerable `truncated: true` when a page cap cut the read, so JSON output and deepEqual never see it. */
function flagTruncated(list, truncated) {
  if (truncated) Object.defineProperty(list, 'truncated', { value: true, enumerable: false })
  return list
}

/**
 * The history and comment operations over one client. `ops` is what issueOperations returns: readNode, contextFor,
 * requireViewer, completeNested and the helpers they share.
 */
export function historyOperations({ client, ops }) {
  /** Every history entry of the issue, newest first, with the issue's origin from the first page. */
  async function readHistory(node) {
    let origin = {}
    const { nodes, hasMore } = await client.paginate(ISSUE_HISTORY_QUERY, { id: node.id }, {
      pageSize: PAGE,
      select: (data) => {
        origin = { creator: data.issue.creator, botActor: data.issue.botActor }
        return data.issue.history
      },
    })
    return { entries: nodes, origin, hasMore }
  }

  /** Every comment node of the issue, newest first. */
  async function readCommentNodes(node) {
    return client.paginate(ISSUE_COMMENTS_QUERY, { id: node.id }, { pageSize: PAGE, select: (data) => data.issue.comments })
  }

  async function getHistory(id, { since } = {}) {
    const node = await ops.readNode(id)
    const { entries, origin, hasMore: moreHistory } = await readHistory(node)
    const { nodes: comments, hasMore: moreComments } = await readCommentNodes(node)
    const events = toEvents({ node, origin, entries, comments }, await ops.contextFor([node]))
    return flagTruncated(since === undefined ? events : events.filter((event) => compareAt(event.at, since) >= 0), moreHistory || moreComments)
  }

  async function listComments(id) {
    const node = await ops.readNode(id)
    const { nodes, hasMore } = await readCommentNodes(node)
    return flagTruncated(nodes.map((item) => toComment(item, node.identifier)).sort(byCreated), hasMore)
  }

  /** The comment node of an id, with its issue's identifier, or undefined. An id with characters no Linear id has sends no request. */
  async function commentNodeById(commentId) {
    if (typeof commentId !== 'string' || !COMMENT_ID.test(commentId)) return undefined
    try {
      return (await client.request(COMMENT_BY_ID_QUERY, { id: commentId }))?.comments?.nodes?.[0]
    } catch (error) {
      // Linear answers an id it cannot read as a UUID with an error on the `comments` field, which is a comment that does not exist.
      // The live run (PMK-39) recorded the code INVALID_INPUT, type 'invalid input', message 'Argument Validation Error'.
      const first = error instanceof PmkitError ? error.details?.linear?.errors?.[0] : undefined
      if ((first?.code === 'INPUT_ERROR' || first?.code === 'INVALID_INPUT') && first.path?.[0] === 'comments') return undefined
      throw error
    }
  }

  /** The comment `commentId` on the issue of `node`, or NOT_FOUND. */
  async function commentOnIssue(node, commentId) {
    const found = await commentNodeById(commentId)
    if (!found || found.issue?.identifier !== node.identifier) throw notOnIssue(commentId, node.identifier)
    return found
  }

  async function comment(id, body, actor, { dryRun = false, replyTo } = {}) {
    await ops.requireViewer(actor)
    const text = typeof body === 'string' ? body.trim() : ''
    if (text === '') throw new PmkitError('INVALID_INPUT', 'comment body must be a non-empty string')
    const node = await ops.readNode(id)
    let parent
    if (replyTo !== undefined) {
      const target = await commentOnIssue(node, replyTo)
      parent = target.parentId ?? target.id
    }
    const withParent = (value) => (parent === undefined ? value : { ...value, parent })
    if (dryRun) return withParent({ id: null, issue: node.identifier, author: actor, body: text, created: ops.now().toISOString() })
    const commentId = ops.uuid()
    let created
    try {
      const input = { id: commentId, issueId: node.id, body: text, ...(parent === undefined ? {} : { parentId: parent }) }
      created = (await client.request(COMMENT_CREATE, { input })).commentCreate.comment
    } catch (error) {
      if (!isUnconfirmed(error)) throw error
      // The UUID pmkit chose tells whether the create happened. One read, then the original error.
      created = await commentNodeById(commentId)
      if (!created) throw error
    }
    return toComment(created, node.identifier)
  }

  /** Resolves the thread that holds `commentId`: the root gets the resolution. A resolved root sends nothing. */
  async function resolveThread(id, commentId, actor, { dryRun = false } = {}) {
    await ops.requireViewer(actor)
    const node = await ops.readNode(id)
    const found = await commentOnIssue(node, commentId)
    const root = found.parentId ? await commentOnIssue(node, found.parentId) : found
    const before = toComment(root, node.identifier)
    if (before.resolved) return { before, after: before }
    if (dryRun) return { before, after: { ...before, resolved: { at: ops.now().toISOString(), by: actor } } }
    const payload = (await client.request(COMMENT_RESOLVE, { id: root.id })).commentResolve.comment
    return { before, after: toComment(payload, node.identifier) }
  }

  /**
   * Every issue of the scope team with its history and comments, as one tagged list of events. Linear's updatedAt filter narrows
   * the read, and the sort puts the most recently updated issues first, so a cut keeps the ones the metrics need most.
   */
  async function metricEvents({ since, until } = {}) {
    const current = await ops.context()
    const { variables } = translateFilter({}, current)
    const and = since === undefined ? variables.filter.and : [...variables.filter.and, { updatedAt: { gte: since } }]
    const { nodes, hasMore } = await client.paginate(
      ISSUE_EVENTS_QUERY,
      { filter: { and }, includeArchived: true, sort: [{ updatedAt: { order: 'Descending' } }] },
      { pageSize: ISSUE_CAP_PAGE, select: (data) => data.issues },
    )
    const live = nodes.filter((node) => node.trashed !== true)
    for (const node of live) {
      await ops.completeNested(node)
      if (node.history?.pageInfo?.hasNextPage === true) node.history = { nodes: (await readHistory(node)).entries }
      if (node.comments?.pageInfo?.hasNextPage === true) node.comments = { nodes: (await readCommentNodes(node)).nodes }
    }
    const context = await ops.contextFor(live)
    const last = until !== undefined && !until.includes('T') ? `${until}T23:59:59.999Z` : until
    const events = live
      .flatMap((node) => toEvents({ node, origin: { creator: node.creator, botActor: node.botActor }, entries: node.history?.nodes ?? [], comments: node.comments?.nodes ?? [] }, context)
        .map((event, index) => ({ event: { ...event, issue: node.identifier }, index })))
      .filter(({ event }) => (since === undefined || compareAt(event.at, since) >= 0) && (last === undefined || compareAt(event.at, last) <= 0))
      .sort((a, b) => compareAt(a.event.at, b.event.at) || compareIds(a.event.issue, b.event.issue) || a.index - b.index)
      .map(({ event }) => event)
    return flagTruncated(events, hasMore)
  }

  /**
   * Native delegation (PMK-214): the delegation comment, then the issue's delegate. Linear keeps the person as assignee and starts the
   * agent's session when the delegate is set, so the comment goes first and the agent reads the instructions. Every check runs before the
   * first mutation. Linear has no transaction: when the delegate update fails after the comment, an unconfirmed update is read back,
   * and the error lists what was written, what is missing or unknown, and says not to delegate again.
   */
  async function delegate(id, agent, instructions, actor, { dryRun = false } = {}) {
    await ops.requireViewer(actor)
    const agentsOf = (ctx) => ctx.raw.users.filter((user) => user.app).map((user) => `agent:${user.id}`)
    let agents = agentsOf(await ops.context())
    const shaped = typeof agent === 'string' && AGENT_ID.test(agent)
    // Only a well-formed id that discovery does not know yet is worth a refresh.
    if (shaped && !agents.includes(agent)) agents = agentsOf(await ops.context({ refresh: true }))
    if (agents.length === 0) throw new PmkitError('NOT_SUPPORTED', NO_AGENT_HINT, NO_AGENT_HINT)
    const nextStep = `Use one of: ${agents.join(', ')}`
    if (!shaped) throw new PmkitError('INVALID_INPUT', `"${agent}" is not an agent: an agent id starts with agent:`, nextStep)
    if (!agents.includes(agent)) throw new PmkitError('INVALID_INPUT', `agent "${agent}" is not an app user of this workspace`, nextStep)
    const beforeNode = await ops.readNode(id)
    const current = await ops.contextFor([beforeNode])
    const before = toIssue(beforeNode, current)
    const body = delegationComment({ issue: before.id, agent, by: actor, instructions, run: 'native' })
    const input = { delegateId: agent.slice('agent:'.length) }
    const changes = before.delegate !== agent
    // The issue with the delegate set, computed without a request: the dry run's answer, and the fallback when a read after the update fails.
    const preview = changes ? (await ops.writeUpdate(beforeNode, before, input, current, true)).after : before
    if (dryRun) return { before, after: preview, comment: await comment(before.id, body, actor, { dryRun: true }), run: 'native' }
    const posted = await comment(before.id, body, actor)
    if (!changes) return { before, after: before, comment: posted, run: 'native' }
    // Once Linear has the delegate, the delegation succeeded: a read that fails while mapping the answer does not change that.
    const done = async (node) => {
      try {
        return { before, after: await ops.mapped(node), comment: posted, run: 'native' }
      } catch (error) {
        if (!isPmkitError(error)) throw error
        return { before, after: preview, comment: posted, run: 'native' }
      }
    }
    let updated
    try {
      updated = (await client.request(ISSUE_UPDATE, { id: beforeNode.id, input })).issueUpdate.issue
    } catch (error) {
      if (!isPmkitError(error)) throw error
      // The comment is posted either way: a retry would only post it again, so the next step never says to delegate again.
      const record = { comment: posted.id, written: [`comment ${posted.id}`] }
      const once = `do not delegate again: the delegation comment ${posted.id} is already posted`
      if (isUnconfirmed(error)) {
        // The answer was lost, so the delegate may be set. One read tells.
        let node
        try {
          node = await ops.readNode(before.id)
        } catch (readError) {
          if (!isPmkitError(readError)) throw readError
          throw new PmkitError(
            error.code,
            `Linear posted the delegation comment ${posted.id}, but Linear did not confirm the delegate of ${before.id} and it could not be read back: ${readError.message}`,
            `Check the delegate of ${before.id} in Linear; ${once}`,
            { ...error.details, ...record, unknown: ['delegate'] },
          )
        }
        if (node.delegate?.id === input.delegateId) return done(node)
      }
      throw new PmkitError(
        error.code,
        `Linear posted the delegation comment ${posted.id} on ${before.id}, but the delegate is not ${agent}: ${error.message}`,
        `Set the delegate of ${before.id} to ${agent} in Linear; ${once}`,
        { ...error.details, ...record, missing: ['delegate'] },
      )
    }
    return done(updated)
  }

  return { getHistory, listComments, comment, resolveThread, metricEvents, delegate }
}
