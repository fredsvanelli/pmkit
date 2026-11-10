// The user inbox of the Linear tracker (PMK-225): Linear `Notification` objects of the owner of LINEAR_API_KEY, read state kept by Linear.
// See docs/superpowers/specs/2026-11-09-pmk-225-improve-user-inbox-design.md, section 2.

import { PmkitError, isPmkitError } from '../errors.mjs'
import { MAX_EXCERPT } from '../local/inbox.mjs'
import { validTimestamp } from '../local/sprints.mjs'

const PAGE = 100
const MAX_PAGES = 10
const PAGE_INFO = 'pageInfo { hasNextPage endCursor }'

export const NOTIFICATIONS_QUERY = `query PmkitNotifications($first: Int!, $after: String) {
  notifications(first: $first, after: $after) {
    nodes { id type createdAt readAt actor { id } ... on IssueNotification { issue { identifier title } comment { id body } } }
    ${PAGE_INFO}
  }
}`

export const NOTIFICATION_READ = `mutation PmkitNotificationRead($id: String!, $readAt: DateTime!) {
  notificationUpdate(id: $id, input: { readAt: $readAt }) { success notification { id readAt } }
}`

// The notification types the inbox lists, as kind and place. Other types (reactions, subscriptions, due dates) are left out.
const TYPES = {
  issueAssignedToYou: { kind: 'assignment', in: 'assignment' },
  issueMention: { kind: 'mention', in: 'description' },
  issueCommentMention: { kind: 'mention', in: 'comment' },
  issueStatusChanged: { kind: 'status', in: 'status' },
}

const isoSeconds = (value) => new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z')
const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
const firstLine = (text) => (typeof text === 'string' ? (text.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '') ?? null) : null)

/** listNotifications and markRead over one client. `ops` is what issueOperations returns, for the viewer. */
export function notificationOperations({ client, ops, now }) {
  /** Throws INVALID_INPUT unless user is the owner of the key: Linear gives no other member's notifications. */
  async function requireOwner(user) {
    const { viewer } = await ops.context()
    if (user !== viewer.id) {
      throw invalid(`Linear gives only the notifications of the owner of LINEAR_API_KEY (${viewer.name})`, 'Drop --as, or use a key created by that member')
    }
  }

  /** Every listed notification as an inbox item, oldest first, and the problems of the read. */
  async function readItems() {
    const { nodes, hasMore } = await client.paginate(NOTIFICATIONS_QUERY, {}, { select: (data) => data.notifications, pageSize: PAGE, maxPages: MAX_PAGES })
    const items = nodes
      .filter((node) => Object.hasOwn(TYPES, node.type) && node.issue)
      .map((node) => ({
        key: `notification:${node.id}`,
        kind: TYPES[node.type].kind,
        issue: node.issue.identifier,
        title: node.issue.title ?? null,
        at: isoSeconds(node.createdAt),
        by: node.actor?.id ?? null,
        in: TYPES[node.type].in,
        comment: TYPES[node.type].in === 'comment' ? (node.comment?.id ?? null) : null,
        excerpt: TYPES[node.type].in === 'comment' ? (firstLine(node.comment?.body)?.slice(0, MAX_EXCERPT) ?? null) : null,
        from: null,
        to: null,
        synthetic: false,
        seen: node.readAt != null,
        id: node.id,
      }))
    items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    const problems = hasMore ? [{ id: null, code: 'UPSTREAM', message: `only the newest ${PAGE * MAX_PAGES} notifications were read` }] : []
    return { items, problems }
  }

  const strip = ({ id, ...item }) => item

  async function listNotifications({ user, since, all = false } = {}) {
    const blank = since === undefined || since === null || since === ''
    if (all && !blank) throw invalid('all and since cannot be used together', 'Use one of them')
    if (!blank && !validTimestamp(since)) throw invalid(`since "${since}" is not a timestamp with a zone`, 'Use a timestamp with a zone, such as 2026-10-31T10:00:00Z or 2026-10-31T12:00:00+02:00')
    await requireOwner(user)
    const cutoff = blank ? null : isoSeconds(since)
    const { items, problems } = await readItems()
    const pool = all ? items : items.filter((item) => !item.seen)
    const shown = cutoff === null ? pool : pool.filter((item) => item.at >= cutoff)
    return {
      user,
      checked: null,
      since: cutoff,
      hidden: pool.length - shown.length,
      items: shown.map(strip),
      counts: {
        assignments: shown.filter((item) => item.kind === 'assignment').length,
        mentions: shown.filter((item) => item.kind === 'mention').length,
        statusChanges: shown.filter((item) => item.kind === 'status').length,
      },
      complete: problems.length === 0,
      problems,
    }
  }

  /**
   * Marks the unread items read in Linear: every one with no `keys`, exactly the keys given otherwise. One write per notification,
   * in key order. A failed write stops the run and the error names the keys marked and the keys left.
   */
  async function markRead({ user, keys, dryRun = false } = {}) {
    if (keys !== undefined && (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string'))) throw invalid('keys must be a list of item keys')
    await requireOwner(user)
    const { items, problems } = await readItems()
    if (problems.length > 0) {
      throw new PmkitError('INVALID_INPUT', `the inbox is incomplete (${problems[0].message}), so nothing was marked read`, 'Mark the items read with --key, using the keys inbox list showed', { problems })
    }
    const known = new Set(items.map((item) => item.key))
    const unknown = [...new Set((keys ?? []).filter((key) => !known.has(key)))]
    const chosen = items.filter((item) => !item.seen && (keys === undefined || keys.includes(item.key))).sort((a, b) => (a.key < b.key ? -1 : 1))
    const recorded = isoSeconds(now())
    const marked = []
    if (!dryRun) {
      for (const [index, item] of chosen.entries()) {
        const left = chosen.slice(index).map((entry) => entry.key)
        let failure
        let code = 'UPSTREAM'
        try {
          const payload = (await client.request(NOTIFICATION_READ, { id: item.id, readAt: recorded }))?.notificationUpdate
          if (payload?.success !== true) failure = 'Linear did not confirm the write'
        } catch (error) {
          failure = isPmkitError(error) ? error.message : String(error?.message ?? error)
          if (isPmkitError(error)) code = error.code
        }
        if (failure !== undefined) {
          throw new PmkitError(
            code,
            `marked ${marked.length} of ${chosen.length} notifications read (${marked.join(', ') || 'none'}), then ${item.key} failed: ${failure}; still unread: ${left.join(', ')}`,
            `Run pmkit inbox mark-read --key ${left.join(' --key ')} to mark the rest`,
            { marked: [...marked], left },
          )
        }
        marked.push(item.key)
      }
    }
    const keysMarked = dryRun ? chosen.map((item) => item.key) : marked
    const changed = keysMarked.length > 0
    return { user, previous: null, recorded: changed ? recorded : null, marked: keysMarked, unknown, pruned: 0, changed, dryRun, note: null }
  }

  return { listNotifications, markRead }
}
