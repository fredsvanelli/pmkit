// The pmkit searchIssues filter as JQL, plus the names of the steps the adapter finishes on the client.
// Pure: it makes no request. See the spec's "Search: Native search (criterion 3)" and its table.

import { PmkitError } from '../errors.mjs'

const DAY = 86400000

// A JQL string literal: every value is quoted, and \ and " are escaped, so no user text becomes JQL syntax.
export function jqlString(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

const list = (values) => `(${values.map(jqlString).join(', ')})`
export const dayOf = (instant, offset) => new Date(Date.parse(instant) + offset * DAY).toISOString().slice(0, 10)

const notSupported = (key, issue) => new PmkitError('NOT_SUPPORTED', `the Jira adapter does not filter by ${key} yet (${issue})`, `Run the search without --${key}`)

/** The NOT_SUPPORTED error of a sprint filter on a space with no Scrum board or no Sprint field, else null. */
export function sprintUnsupported(context) {
  const space = context.space
  if (context.boardId === null) return new PmkitError('NOT_SUPPORTED', `Sprints need a Scrum board in space ${space}`, '/pmkit:setup')
  if (!context.fields.sprint) return new PmkitError('NOT_SUPPORTED', `No sprint field in space ${space}`, '/pmkit:setup')
  return null
}

// One handler per filter key, in FILTER_KEYS order. Each adds to out.clauses and out.steps; out.empty says nothing can match.
const HANDLERS = {
  text(filter, out) {
    const quoted = jqlString(filter.text)
    out.clauses.push(`(summary ~ ${quoted} OR description ~ ${quoted})`)
    out.steps.add('text')
  },
  categories(filter, out, context) {
    const ids = context.raw.statuses.filter((status) => filter.categories.includes(context.categoryOf(status.name, status.categoryKey))).map((status) => status.id)
    if (ids.length === 0) out.empty = true
    else out.clauses.push(`status in ${list(ids)}`)
  },
  types(filter, out, context) {
    const ids = filter.types.map((type) => context.workTypeOf(type)?.id).filter((id) => id !== undefined)
    if (ids.length === 0) out.empty = true
    else out.clauses.push(`issuetype in ${list(ids)}`)
  },
  assignee(filter, out, context) {
    if (filter.assignee === 'none') return out.clauses.push('assignee is EMPTY')
    const account = filter.assignee === 'me' ? context.viewer?.id : filter.assignee
    if (!account) throw new PmkitError('INVALID_INPUT', 'the signed-in Jira user is unknown, so "me" cannot be resolved', 'pmkit issues list')
    out.clauses.push(`assignee = ${jqlString(account)}`)
  },
  labels(filter, out) {
    for (const label of filter.labels) out.clauses.push(`labels = ${jqlString(label)}`)
  },
  sprint(filter, out, context, { activeId }) {
    const unsupported = sprintUnsupported(context)
    if (unsupported) throw unsupported
    if (filter.sprint === 'none') out.clauses.push('(sprint is EMPTY OR sprint not in openSprints())')
    else if (filter.sprint !== 'current') out.clauses.push(`sprint = ${jqlString(filter.sprint)}`)
    else if (activeId) out.clauses.push(`sprint = ${jqlString(activeId)}`)
    else out.empty = true
    out.steps.add('sprint')
  },
  release() {
    throw notSupported('release', 'PMK-79')
  },
  parent(filter, out) {
    out.clauses.push(`parent = ${jqlString(filter.parent)}`)
  },
  blocked(filter, out) {
    out.steps.add('blocked')
  },
  // JQL dates are minutes in the user's time zone (UTC-12 to UTC+14), so the clause is widened past any zone (two days
  // ahead for the upper bound, one behind for the lower) and the exact compare runs on the client.
  updatedBefore(filter, out) {
    out.clauses.push(`updated < ${jqlString(dayOf(filter.updatedBefore, 2))}`)
    out.steps.add('updated')
  },
  updatedAfter(filter, out) {
    out.clauses.push(`updated >= ${jqlString(dayOf(filter.updatedAfter, -1))}`)
    out.steps.add('updated')
  },
}

// The step names in the order the adapter runs them.
const STEP_ORDER = ['text', 'blocked', 'sprint', 'updated']

/**
 * Translates a filter that checkFilter accepted (the caller checks) into { empty: true } when nothing can match, else
 * { jql, clientSteps, serverLimit }. `activeId` is the id of the board's active sprint, which `current` means. `serverLimit` is set only when no client step runs and the order is created.
 */
export function translateFilter(filter, context, { activeId } = {}) {
  const out = { clauses: [`project = ${jqlString(context.space)}`], steps: new Set(), empty: false }
  for (const [key, handle] of Object.entries(HANDLERS)) {
    if (filter[key] !== undefined) handle(filter, out, context, { activeId })
  }
  if (out.empty) return { empty: true }
  const clientSteps = STEP_ORDER.filter((step) => out.steps.has(step))
  const { limit } = filter
  const serverLimit = clientSteps.length === 0 && (filter.sort ?? 'created') === 'created' && Number.isInteger(limit) && limit >= 1 ? limit : undefined
  return { jql: `${out.clauses.join(' AND ')} ORDER BY created ASC, key ASC`, clientSteps, serverLimit }
}
