// The History and Comments families of the Jira tracker: getHistory, listComments, comment, resolveThread and metricEvents.
// See docs/superpowers/specs/2026-11-22-pmk-77-jira-work-items-transitions-links-jql-design.md, "History and comments".

import { PmkitError } from '../errors.mjs'
import { compareIds } from '../ids.mjs'
import { compareTimes } from '../model.mjs'
import { textToAdf } from './adf.mjs'
import { dayOf, epicTypeIds, jqlString } from './filter.mjs'
import { API, issuePath, PAGE_SIZE } from './ids.mjs'
import { ISSUE_FIELDS } from './issues.mjs'
import { toComment, toEvents } from './history.mjs'
import { worklogsOf } from './worklogs.mjs'

const METRIC_FIELDS = 'created,creator,status,summary,labels,assignee,priority,issuetype,duedate,worklog'
const CAP_WARNING = 'Jira has more updated work items than the 1000 pmkit read; metrics cover the most recently updated'
const noThreads = () => new PmkitError('NOT_SUPPORTED', 'Jira comments have no threads', 'Post a new comment with pmkit issues comment')

/**
 * The history and comment operations over a Jira client and the issue operations `ops` (readItem, requireActor). `timeTracking()` says
 * whether the site has time tracking on, so getHistory reads the worklogs (PMK-80).
 */
export function historyOperations({ client, ops, getContext, now = () => new Date(), timeTracking = async () => true }) {
  const fromSince = (since) => (event) => since === undefined || compareTimes(event.at, since) >= 0

  const changelogOf = async (key) => (await client.paginate(issuePath(key, '/changelog'), { key: 'values', pageSize: PAGE_SIZE, maxPages: 1000 })).items

  /** Every comment node and changelog history of the work item `key`. */
  const readAll = async (key) => ({
    histories: await changelogOf(key),
    comments: (await client.paginate(issuePath(key, '/comment'), { query: { orderBy: 'created' }, key: 'comments', pageSize: PAGE_SIZE, maxPages: 1000 })).items,
  })

  async function getHistory(id, { since } = {}) {
    const { item, context } = await ops.readItem(id)
    const [{ histories, comments }, worklogs] = await Promise.all([readAll(item.key), (await timeTracking()) ? worklogsOf(client, item.key) : []])
    return toEvents(item, histories, context, comments, worklogs).filter(fromSince(since))
  }

  async function listComments(id) {
    const { item, issue } = await ops.readItem(id)
    const { comments } = await readAll(item.key)
    return comments.map((node) => toComment(node, issue.id)).sort((a, b) => compareTimes(a.created, b.created))
  }

  async function comment(id, body, actor, { dryRun = false, replyTo } = {}) {
    if (replyTo !== undefined) throw noThreads()
    await ops.requireActor(actor)
    const text = typeof body === 'string' ? body.trim() : ''
    if (text === '') throw new PmkitError('INVALID_INPUT', 'comment body must be a non-empty string')
    const { item, issue } = await ops.readItem(id)
    if (dryRun) return { id: null, issue: issue.id, author: actor, body: text, created: now().toISOString() }
    const made = await client.request('POST', issuePath(item.key, '/comment'), { body: { body: textToAdf(text) } })
    return toComment(made, issue.id)
  }

  async function resolveThread() {
    throw noThreads()
  }

  /** The changelog histories of an item from a search: those it carries, or all of them when Jira cut the list. */
  async function historiesOf(item) {
    const carried = item.changelog?.histories ?? []
    if (item.changelog && item.changelog.total > carried.length) {
      return changelogOf(item.key)
    }
    return carried
  }

  /** The worklogs of an item from a search: those it carries, or all of them when Jira cut the list at 20. */
  async function worklogsIn(item) {
    const carried = item.fields.worklog?.worklogs ?? []
    return item.fields.worklog && item.fields.worklog.total > carried.length ? worklogsOf(client, item.key) : carried
  }

  /**
   * The events of every work item of the space updated since `since` (comments left out), each tagged with its issue, cut at
   * `until` (a date alone covers that whole day) and sorted by `at`. When Jira has more updated items than the search read,
   * the result carries a non-enumerable `warnings`.
   */
  async function metricEvents({ since, until } = {}) {
    const context = await getContext()
    const day = since === undefined || Number.isNaN(Date.parse(since)) ? null : dayOf(since, -1)
    const epics = epicTypeIds(context)
    const jql = `project = ${jqlString(context.space)}${epics.length > 0 ? ` AND issuetype not in (${epics.map(jqlString).join(', ')})` : ''}${day ? ` AND updated >= ${jqlString(day)}` : ''} ORDER BY updated DESC`
    const fields = [METRIC_FIELDS, ...ISSUE_FIELDS(context).filter((field) => context.fields.estimate === field)].join(',')
    const { items, hasMore } = await client.paginate(`${API}/search/jql`, { query: { jql, fields, expand: 'changelog' }, key: 'issues', pageSize: PAGE_SIZE, limit: 1000 })
    const last = until !== undefined && !until.includes('T') ? `${until}T23:59:59.999Z` : until
    const tagged = []
    for (const item of items) {
      for (const event of toEvents(item, await historiesOf(item), context, [], await worklogsIn(item))) tagged.push({ ...event, issue: item.key })
    }
    const events = tagged
      .filter((event) => fromSince(since)(event) && (last === undefined || compareTimes(event.at, last) <= 0))
      .sort((a, b) => compareTimes(a.at, b.at) || compareIds(a.issue, b.issue))
    if (hasMore) Object.defineProperty(events, 'warnings', { value: [CAP_WARNING], enumerable: false })
    return events
  }

  return { getHistory, listComments, comment, resolveThread, metricEvents }
}
