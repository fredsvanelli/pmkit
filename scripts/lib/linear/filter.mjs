// The pmkit searchIssues filter as a Linear IssueFilter, plus the steps the adapter runs after Linear answers.
// Pure: it makes no request. See the spec's "Search (criterion 3)" and its translation table.

import { PmkitError } from '../errors.mjs'
import { issueComparator } from '../issue-filter.mjs'
import { cycleKey, cyclesOff } from './cycles.mjs'
import { isIssueId, issueKey, stateCategory } from './issues.mjs'

const notSupported = (message) => new PmkitError('NOT_SUPPORTED', message, 'Leave this filter out on Linear')

/**
 * The issue clause of a sprint value. With cycles off no issue is in a cycle, so none matches every issue (no clause)
 * and any other value is NOT_SUPPORTED. An unknown cycle number is not checked here: it matches nothing.
 */
function cycleClause(sprint, context) {
  const off = context.cyclesEnabled === false
  if (sprint === 'none') return off ? null : { cycle: { null: true } }
  const number = sprint === 'current' ? null : cycleKey(sprint)
  if (sprint !== 'current' && number === null) {
    throw new PmkitError('INVALID_INPUT', `sprint "${sprint}" is not current, none or a cycle number`, 'pmkit cycle list')
  }
  if (off) throw cyclesOff(context.scopeTeam.key)
  return { cycle: sprint === 'current' ? { isActive: { eq: true } } : { number: { eq: number } } }
}

/**
 * Translates a filter that checkFilter accepted. `clientSteps` holds 'blocked' and 'sort' when the adapter must finish them.
 * `serverLimit` is set only when Linear's order is the final order. `empty` says no state matches `categories`, so no request is needed.
 */
export function translateFilter(filter, context) {
  if (filter.release !== undefined) throw notSupported('Linear releases are not mapped yet, so --release does not work on Linear')
  const and = []
  const clientSteps = []
  let empty = false
  if (context.scopeTeam) and.push({ team: { key: { eq: context.scopeTeam.key } } })
  if (filter.text !== undefined) and.push({ or: [{ title: { containsIgnoreCase: filter.text } }, { description: { containsIgnoreCase: filter.text } }] })
  if (filter.categories !== undefined) {
    const scoped = context.raw.states
      .filter((state) => !context.scopeTeam || state.team === context.scopeTeam.id)
      .sort((a, b) => a.position - b.position)
    const ids = scoped.filter((state) => filter.categories.includes(stateCategory(state, context))).map((state) => state.id)
    if (ids.length === 0) empty = true
    and.push({ state: { id: { in: ids } } })
  }
  if (filter.types !== undefined) and.push({ labels: { some: { name: { in: filter.types.map((type) => context.mappings.types[type].name) } } } })
  if (filter.assignee !== undefined) {
    if (filter.assignee === 'none') and.push({ assignee: { null: true } })
    else and.push({ assignee: { id: { eq: filter.assignee === 'me' ? context.viewer.id : filter.assignee } } })
  }
  for (const name of filter.labels ?? []) and.push({ labels: { some: { name: { eq: name } } } })
  if (filter.parent !== undefined) {
    if (!isIssueId(filter.parent)) throw new PmkitError('NOT_SUPPORTED', 'Linear projects are not epics in pmkit yet', 'Use an issue id as the parent')
    and.push({ parent: { id: { eq: issueKey(filter.parent) } } })
  }
  if (filter.sprint !== undefined && filter.sprint !== null) {
    const clause = cycleClause(filter.sprint, context)
    if (clause !== null) and.push(clause)
  }
  if (filter.blocked === true) and.push({ hasBlockedByRelations: { eq: true } })
  if (filter.blocked !== undefined) clientSteps.push('blocked')
  if (filter.updatedBefore !== undefined) and.push({ updatedAt: { lt: filter.updatedBefore } })
  if (filter.updatedAfter !== undefined) and.push({ updatedAt: { gt: filter.updatedAfter } })
  if (filter.sort !== undefined && filter.sort !== 'created') clientSteps.push('sort')
  const serverLimit = clientSteps.length === 0 && Number.isInteger(filter.limit) && filter.limit >= 1 ? filter.limit : undefined
  return {
    variables: { filter: { and }, includeArchived: filter.archived === true, sort: [{ createdAt: { order: 'Ascending' } }] },
    clientSteps,
    serverLimit,
    empty,
  }
}

/** The steps Linear cannot run: the blocked check, pmkit's order with its tie-breaks, and the limit. rows are { issue, blocked }. */
export function finishSearch(rows, filter, { priorities }) {
  const kept = filter.blocked === undefined ? rows : rows.filter((row) => row.blocked === filter.blocked)
  const sorted = kept.map((row) => row.issue).sort(issueComparator(filter.sort ?? 'created', priorities))
  return filter.limit === undefined ? sorted : sorted.slice(0, filter.limit)
}
