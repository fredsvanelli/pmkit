// The History and Comments families of the GitHub tracker: getHistory, listComments, comment, resolveThread and metricEvents.
// See docs/specs/2026-11-16-pmk-87-github-issues-relations-history-design.md, "History and comments" and "Decisions from the user" 4.

import { PmkitError } from '../errors.mjs'
import { ITEM_TYPES } from './documents.mjs'
import { compareGithubIds, issueIdOf } from './ids.mjs'
import { toComment, toEvents } from './history.mjs'
import { completeProjectItems, docsOf } from './requests.mjs'

const PAGE = 100
const BATCH = 20
const STATUS_WARNING = 'on GitHub Enterprise Server before 3.21, Status option changes have no events, so moves show only as opens and closes'
const noThreads = () => new PmkitError('NOT_SUPPORTED', 'GitHub issue comments have no threads', 'Post a new comment with pmkit issues comment')

/** Compares an event time with a range bound by instant, so `2026-10-05T10:00:00Z` equals `2026-10-05T10:00:00.000Z`. */
function compareAt(at, bound) {
  const a = Date.parse(at)
  const b = Date.parse(bound)
  if (Number.isNaN(a) || Number.isNaN(b)) return at < bound ? -1 : at > bound ? 1 : 0
  return Math.sign(a - b)
}

const byCreated = (a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Adds non-enumerable keys to a list, so JSON output and deepEqual never see them. */
function withHidden(list, keys) {
  for (const [key, value] of Object.entries(keys)) Object.defineProperty(list, key, { value, enumerable: false })
  return list
}

/** The history and comment operations over a GitHub client and the issue operations `ops` (readNode, requireActor). */
export function historyOperations({ client, ops, getContext, now = () => new Date() }) {

  /** Every timeline item of the issue with node id `id` since `since`, with the cap flag. */
  async function readTimeline(context, id, since) {
    const variables = { id, itemTypes: ITEM_TYPES(context.features), ...(since === undefined ? {} : { since }) }
    return client.paginate(docsOf(context).TIMELINE, variables, { pageSize: PAGE, select: (data) => data.node.timelineItems })
  }

  const fromSince = (since) => (event) => since === undefined || compareAt(event.at, since) >= 0

  async function getHistory(id, { since } = {}) {
    const context = await getContext()
    const { node } = await ops.readNode(id)
    const { nodes, hasMore } = await readTimeline(context, node.id, since)
    const events = toEvents(node, nodes, context).filter(fromSince(since))
    const hidden = {}
    if (hasMore) hidden.truncated = true
    if (!context.features.statusEvents) hidden.warnings = [STATUS_WARNING]
    return withHidden(events, hidden)
  }

  async function listComments(id) {
    const context = await getContext()
    const { node, issue } = await ops.readNode(id)
    const { nodes, hasMore } = await client.paginate(docsOf(context).COMMENTS, { id: node.id }, { pageSize: PAGE, select: (data) => data.node.comments })
    return withHidden(nodes.map((item) => toComment(item, issue.id)).sort(byCreated), hasMore ? { truncated: true } : {})
  }

  async function comment(id, body, actor, { dryRun = false, replyTo } = {}) {
    await ops.requireActor(actor)
    const text = typeof body === 'string' ? body.trim() : ''
    if (text === '') throw new PmkitError('INVALID_INPUT', 'comment body must be a non-empty string')
    if (replyTo !== undefined) throw noThreads()
    const context = await getContext()
    const { node, issue } = await ops.readNode(id)
    if (dryRun) return { id: null, issue: issue.id, author: actor, body: text, created: now().toISOString() }
    const data = await client.request(docsOf(context).ADD_COMMENT, { input: { subjectId: node.id, body: text } })
    return toComment(data.addComment.commentEdge.node, issue.id)
  }

  async function resolveThread() {
    throw noThreads()
  }

  /** The issue nodes updated since `since`, most recently updated first, so a cut at 1000 issues keeps the ones the metrics need most. */
  async function readIssues(context, since) {
    const [owner, name] = context.repo.split('/')
    const status = context.projectFields.status ? { fStatus: context.fieldVariables.fStatus } : {}
    const variables = { owner, name, filterBy: since === undefined ? {} : { since }, orderBy: { field: 'UPDATED_AT', direction: 'DESC' }, ...status }
    return client.paginate(docsOf(context).METRIC_ISSUES, variables, { pageSize: PAGE, select: (data) => data.repository.issues })
  }

  /** Every timeline of the nodes since `since`, by node id: 20 issues per read, and the rest of a long timeline one issue at a time. */
  async function readTimelines(context, nodes, since) {
    const timelines = new Map()
    const variables = { itemTypes: ITEM_TYPES(context.features), ...(since === undefined ? {} : { since }) }
    for (let start = 0; start < nodes.length; start += BATCH) {
      const ids = nodes.slice(start, start + BATCH).map((node) => node.id)
      const data = await client.request(docsOf(context).TIMELINES, { ids, ...variables })
      for (const found of data.nodes ?? []) {
        if (!found) continue
        const items = found.timelineItems
        timelines.set(found.id, items.pageInfo?.hasNextPage === true ? (await readTimeline(context, found.id, since)).nodes : items.nodes)
      }
    }
    return timelines
  }

  /**
   * The events of every issue of the scope repository updated since `since`, each tagged with its issue, cut at `until`
   * (a date alone covers that whole day) and sorted by `at`. The issue read stops at the 1000 most recently updated issues; the
   * result then carries a non-enumerable `truncated`, from which the CLI writes the cut warning. On GHES before 3.21 its
   * non-enumerable `warnings` names the missing Status events.
   */
  async function metricEvents({ since, until } = {}) {
    const context = await getContext()
    const { nodes, hasMore } = await readIssues(context, since)
    for (const node of nodes) await completeProjectItems(client, context, node, { archived: true })
    const timelines = await readTimelines(context, nodes, since)
    const last = until !== undefined && !until.includes('T') ? `${until}T23:59:59.999Z` : until
    const events = nodes
      .flatMap((node) => {
        const issue = issueIdOf(node, context.repo)
        return toEvents(node, timelines.get(node.id) ?? [], context).map((event, index) => ({ event: { ...event, issue }, index }))
      })
      .filter(({ event }) => fromSince(since)(event) && (last === undefined || compareAt(event.at, last) <= 0))
      .sort((a, b) => compareAt(a.event.at, b.event.at) || compareGithubIds(a.event.issue, b.event.issue) || a.index - b.index)
      .map(({ event }) => event)
    return withHidden(events, { ...(hasMore ? { truncated: true } : {}), ...(context.features.statusEvents ? {} : { warnings: [STATUS_WARNING] }) })
  }

  return { getHistory, listComments, comment, resolveThread, metricEvents }
}
