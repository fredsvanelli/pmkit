// The History and Comments families of the Linear tracker: getHistory, listComments, comment, resolveThread and metricEvents.
// See docs/superpowers/specs/2026-10-28-pmk-36-linear-history-comments-design.md.

import { ISSUE_COMMENTS_QUERY, ISSUE_HISTORY_QUERY } from './documents.mjs'
import { toEvents } from './history.mjs'

const PAGE = 100

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

  return { getHistory }
}
