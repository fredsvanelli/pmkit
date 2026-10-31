// Request files: requests/<ID>.md, the inbox of requests that are accepted into issues or declined.
// Reading, validating, ordering, serializing and grouping into demand signals; the tracker decides when to write.
// See docs/superpowers/specs/2026-10-31-pmk-46-customers-and-requests-design.md.

import { PmkitError } from '../errors.mjs'
import { compareIds, isId } from '../ids.mjs'
import { joinFrontmatter } from '../yaml.mjs'
import { CUSTOMER_PREFIX, lineValue } from './customers.mjs'
import { parseFile } from './epics.mjs'
import { validTimestamp } from './sprints.mjs'

/** Request ids are REQ- and a code that follows id_style, as in REQ-7K3Q or REQ-1. */
export const REQUEST_PREFIX = 'REQ'
export const REQUEST_STATES = ['open', 'accepted', 'declined']
export const REQUEST_KEYS = ['title', 'customer', 'from', 'important', 'created', 'state', 'issue', 'reason', 'triaged', 'triaged_by']
const DOCTOR = '/pmkit:local:doctor'
// The shape of an issue id of any prefix. The tracker checks the prefix and that the issue exists.
const ISSUE_SHAPE = /^[A-Z][A-Z0-9]*-[0-9A-Z]+$/

/** Parses the text of requests/<id>.md. A missing state is open. The file stem is the id, so an `id` key is ignored. */
export function parseRequest(text, id) {
  const { data, body } = parseFile(text, `request ${id}`)
  const bad = (why) => new PmkitError('INVALID_INPUT', `request file ${id}.md ${why}`, DOCTOR)
  const title = data.title == null ? undefined : lineValue(data, 'title', bad)
  if (title === undefined) throw bad('needs a title')
  const request = { id, title, body }
  const customer = lineValue(data, 'customer', bad)
  if (customer !== undefined) {
    if (!isId(customer, CUSTOMER_PREFIX)) throw bad(`has customer "${customer}", expected a customer id such as ${CUSTOMER_PREFIX}-1`)
    request.customer = customer
  }
  const from = lineValue(data, 'from', bad)
  if (from !== undefined) request.from = from
  if (data.important != null && typeof data.important !== 'boolean') throw bad(`has important "${data.important}", expected true or false`)
  request.important = data.important === true
  for (const key of ['created', 'triaged']) {
    if (data[key] == null) continue
    if (!validTimestamp(data[key])) throw bad(`has ${key} "${data[key]}", expected a timestamp such as 2026-10-31T12:00:00Z`)
    request[key] = data[key]
  }
  const triagedBy = lineValue(data, 'triaged_by', bad)
  if (triagedBy !== undefined) request.triagedBy = triagedBy
  const state = data.state == null ? 'open' : String(data.state)
  if (!REQUEST_STATES.includes(state)) throw bad(`has state "${state}", expected one of ${REQUEST_STATES.join(', ')}`)
  request.state = state
  const issue = lineValue(data, 'issue', bad)
  if (state === 'accepted' && issue === undefined) throw bad('is accepted but names no issue')
  if (state !== 'accepted' && issue !== undefined) throw bad(`names issue ${issue} but is ${state}; only an accepted request has an issue`)
  if (issue !== undefined) {
    if (!ISSUE_SHAPE.test(issue)) throw bad(`has issue "${issue}", expected an issue id`)
    request.issue = issue
  }
  const reason = lineValue(data, 'reason', bad)
  if (reason !== undefined && state !== 'declined') throw bad(`has a reason but is ${state}; only a declined request has one`)
  if (reason !== undefined) request.reason = reason
  return request
}

/** The frontmatter values of a request, keyed as written to the file. */
export const requestFrontmatter = (request) => ({
  title: request.title, customer: request.customer, from: request.from, important: request.important || undefined, created: request.created,
  state: request.state, issue: request.issue, reason: request.reason, triaged: request.triaged, triaged_by: request.triagedBy,
})

/** The text of a request file. The body is the request text, left out when it is empty. */
export const serializeRequest = (request) => {
  const text = joinFrontmatter(requestFrontmatter(request), request.body ? `${request.body}\n` : '', { order: REQUEST_KEYS })
  return request.body ? text : text.replace(/\n\n$/, '\n')
}

/** Requests in creation order: `created`, then id. A request without `created` goes last. */
export function sortRequests(list) {
  const key = (request) => request.created ?? '￿'
  return [...list].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) || compareIds(a.id, b.id))
}

/**
 * The accepted requests grouped by issue: one entry per issue with the request count, the important count, the request ids,
 * the distinct customer ids and the distinct `from` of the requests without a customer. Most requests first, then most
 * important, then issue id. Requests keep the order they come in.
 */
export function groupDemand(requests) {
  const byIssue = new Map()
  for (const request of requests) {
    if (request.state !== 'accepted') continue
    const entry = byIssue.get(request.issue) ?? { issue: request.issue, count: 0, important: 0, requests: [], customers: [], from: [] }
    entry.count += 1
    if (request.important) entry.important += 1
    entry.requests.push(request.id)
    if (request.customer !== undefined) {
      if (!entry.customers.includes(request.customer)) entry.customers.push(request.customer)
    } else if (request.from !== undefined && !entry.from.includes(request.from)) {
      entry.from.push(request.from)
    }
    byIssue.set(request.issue, entry)
  }
  return [...byIssue.values()].sort((a, b) => b.count - a.count || b.important - a.important || compareIds(a.issue, b.issue))
}
