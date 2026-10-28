// The History and Comments families of the Linear tracker: getHistory, listComments, comment, resolveThread and metricEvents.
// See docs/superpowers/specs/2026-10-28-pmk-36-linear-history-comments-design.md.

import { PmkitError } from '../errors.mjs'
import { COMMENT_BY_ID_QUERY, COMMENT_CREATE, COMMENT_RESOLVE, ISSUE_COMMENTS_QUERY, ISSUE_HISTORY_QUERY } from './documents.mjs'
import { toComment, toEvents } from './history.mjs'
import { isUnconfirmed } from './issue-ops.mjs'

const PAGE = 100
const COMMENT_ID = /^[A-Za-z0-9-]+$/
const notOnIssue = (commentId, id) => new PmkitError('NOT_FOUND', `comment ${commentId} is not on ${id}`, `pmkit issues get ${id} --comments`)
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
export function historyOperations({ client, ops, config }) {
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
    return flagTruncated(since === undefined ? events : events.filter((event) => event.at >= since), moreHistory || moreComments)
  }

  async function listComments(id) {
    const node = await ops.readNode(id)
    const { nodes, hasMore } = await readCommentNodes(node)
    return flagTruncated(nodes.map((item) => toComment(item, node.identifier)).sort(byCreated), hasMore)
  }

  /** The comment node of an id, with its issue's identifier, or undefined. An id with characters no Linear id has sends no request. */
  async function commentNodeById(commentId) {
    if (typeof commentId !== 'string' || !COMMENT_ID.test(commentId)) return undefined
    return (await client.request(COMMENT_BY_ID_QUERY, { id: commentId }))?.comments?.nodes?.[0]
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

  return { getHistory, listComments, comment, resolveThread }
}
