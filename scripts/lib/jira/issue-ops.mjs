// The issue operations of the Jira adapter: the reads (getIssue, searchIssues, readItem) and the writes (createIssue,
// updateIssue with the pmkit.branch property, moveToCategory with its screen fields, assign, delete).
// See docs/superpowers/specs/2026-11-22-pmk-77-jira-work-items-transitions-links-jql-design.md, "Writes",
// "`moveToCategory` and screen fields (criterion 2)", "`assign` and `delete`" and "Search: Native search (criterion 3)".

import { REFERENCE_KINDS, REPO_UNCHECKED, referencedError } from '../delete-refusal.mjs'
import { PmkitError } from '../errors.mjs'
import { compareIds } from '../ids.mjs'
import { checkFilter, issueComparator } from '../issue-filter.mjs'
import { CATEGORIES, compareTimes, PRIORITY_LABEL_LEVELS as PRIORITIES, TERMINAL } from '../model.mjs'
import { jqlString, translateFilter } from './filter.mjs'
import { API, isIssueKey, issuePath, lower, normalizeKey, PAGE_SIZE } from './ids.mjs'
import { ISSUE_FIELDS, toFields, toIssue } from './issues.mjs'
import { fieldValues, pickTarget, pickTransition, requiredFields } from './transitions.mjs'

const SEARCH = `${API}/search/jql`
const BRANCH = 'pmkit.branch'
const NOTHING = () => ({ issues: [], problems: [], hasMore: false })

const invalid = (message, nextStep, details) => new PmkitError('INVALID_INPUT', message, nextStep, details)
const notFound = (id) => new PmkitError('NOT_FOUND', `issue ${id} does not exist`, 'pmkit issues list')

/** True when the issue has a blocker whose category is not done or canceled. */
const openBlocker = (issue) => [...issue.blockerCategories.values()].some((category) => !TERMINAL.includes(category))

// The client steps translateFilter names, each a test of one issue against the filter. The sort runs on every search, after them.
const STEPS = {
  text: (issue, filter) => [issue.title, issue.description].some((value) => lower(value).includes(lower(filter.text))),
  blocked: (issue, filter) => openBlocker(issue) === filter.blocked,
  updated: (issue, filter) =>
    (filter.updatedAfter === undefined || compareTimes(issue.updated, filter.updatedAfter) > 0) &&
    (filter.updatedBefore === undefined || compareTimes(issue.updated, filter.updatedBefore) < 0),
}

/**
 * The issue operations over a Jira client. getContext({ refresh }) returns makeContext's context over the tracker's
 * discovery, with `fresh` true when that discovery was read from Jira in this run.
 */
export function issueOperations({ client, getContext, now = () => new Date() }) {
  function keyOf(id) {
    if (!isIssueKey(id)) throw notFound(id)
    return normalizeKey(id)
  }

  const isEpic = (item, context) => context.raw.workTypes.find((type) => type.id === String(item.fields?.issuetype?.id))?.level === 'epic'
  const knowsStatus = (item, context) => context.view.statuses.some((status) => status.name === item.fields?.status?.name)

  /** The context to map items with: a status a cached discovery lacks refreshes it once, as a renamed status often explains. */
  async function contextFor(items) {
    const context = await getContext()
    if (context.fresh || items.every((item) => knowsStatus(item, context))) return context
    return getContext({ refresh: true })
  }

  /** The child keys of the epics among items, from one parent in (...) search per 100 epics: parent key -> keys. */
  async function epicChildren(items, context) {
    const epics = items.filter((item) => isEpic(item, context)).map((item) => item.key)
    const children = new Map()
    for (let start = 0; start < epics.length; start += PAGE_SIZE) {
      const jql = `parent in (${epics.slice(start, start + PAGE_SIZE).map(jqlString).join(', ')})`
      const { items: found } = await client.paginate(SEARCH, { query: { jql, fields: 'parent' }, key: 'issues', pageSize: PAGE_SIZE })
      for (const child of found) {
        const parent = child.fields?.parent?.key
        if (parent) children.set(parent, [...(children.get(parent) ?? []), child.key])
      }
    }
    return children
  }

  async function toIssues(items, context) {
    const children = await epicChildren(items, context)
    return items.map((item) => toIssue(item, context, { children: children.get(item.key) ?? [] }))
  }

  /** The raw item, its issue and the context it was mapped with. A malformed or unknown key is NOT_FOUND. */
  async function readItem(id) {
    const key = keyOf(id)
    let item
    try {
      item = await client.request('GET', issuePath(key), { query: { fields: ISSUE_FIELDS(await getContext()).join(','), properties: BRANCH } })
    } catch (error) {
      if (error instanceof PmkitError && error.code === 'NOT_FOUND') throw notFound(key)
      throw error
    }
    const context = await contextFor([item])
    const [issue] = await toIssues([item], context)
    return { item, issue, context }
  }

  async function getIssue(id) {
    return (await readItem(id)).issue
  }

  function checkSearch(filter, context) {
    checkFilter(filter, { types: context.view.types, members: context.view.members.map((member) => member.id) })
    for (const key of ['updatedAfter', 'updatedBefore']) {
      if (filter[key] !== undefined && Number.isNaN(Date.parse(filter[key]))) throw invalid(`${key} must be a date or a time such as 2026-11-22T10:00:00Z`, 'pmkit issues list --help')
    }
  }

  /** Narrows with JQL, then runs the client steps, pmkit's order and the limit. */
  async function searchIssues(filter = {}) {
    const held = await getContext()
    checkSearch(filter, held)
    if (filter.limit === 0) return NOTHING()
    const translated = translateFilter(filter, held)
    if (translated.empty) return NOTHING()
    const query = { jql: translated.jql, fields: ISSUE_FIELDS(held).join(','), properties: BRANCH }
    const { items, hasMore } = await client.paginate(SEARCH, { query, key: 'issues', pageSize: PAGE_SIZE, limit: translated.serverLimit })
    const issues = await toIssues(items, await contextFor(items))
    const sort = filter.sort ?? 'created'
    const kept = issues.filter((issue) => translated.clientSteps.every((step) => STEPS[step](issue, filter))).sort(issueComparator(sort, PRIORITIES))
    // Jira's order is created, so a created read that kept limit issues needed no more: hasMore is then false.
    const enough = sort === 'created' && filter.limit !== undefined && kept.length >= filter.limit
    return { issues: filter.limit === undefined ? kept : kept.slice(0, filter.limit), problems: [], hasMore: hasMore && !enough }
  }

  // Writes.

  /** The viewer check: Jira records every write as the token's owner (ADR 0013). */
  async function requireActor(actor) {
    const viewer = (await getContext()).viewer
    if (typeof actor !== 'string' || actor !== viewer?.id) {
      throw invalid(`Jira records every write as the owner of JIRA_API_TOKEN (${viewer?.name ?? viewer?.id})`, 'Drop --as, or use a token created by that member')
    }
  }

  /** Builds with the current context; an error marked stale refreshes the discovery once and builds again. */
  async function withRefresh(build) {
    const context = await getContext()
    try {
      return { value: await build(context), context }
    } catch (error) {
      if (!(error instanceof PmkitError) || error.details?.stale !== true) throw error
      const fresh = await getContext({ refresh: true })
      try {
        return { value: await build(fresh), context: fresh }
      } catch (again) {
        if (!(again instanceof PmkitError) || again.details?.stale !== true) throw again
        const { stale: _stale, ...rest } = again.details
        throw new PmkitError(again.code, again.message, again.nextStep, Object.keys(rest).length > 0 ? rest : undefined)
      }
    }
  }

  const afterOf = async (key) => (await readItem(key)).issue
  const statusAt = (target, context) => ({ name: target.name, category: context.categoryOf(target.name) })

  async function createIssue(request, actor, { dryRun = false } = {}) {
    await requireActor(actor)
    const input = request ?? {}
    const { value: plan, context } = await withRefresh((current) => toFields(input, null, current, { create: true, now: now().toISOString() }))
    const category = input.status ?? undefined
    // The target is checked before the create, so a work type with no status in the category sends nothing.
    const target = category === undefined ? null : pickTarget({ item: { fields: { issuetype: plan.fields.issuetype } }, category, context })
    if (dryRun) return { before: null, after: target ? { ...plan.after, status: statusAt(target, context) } : plan.after }
    const { key } = await client.request('POST', `${API}/issue`, { body: { fields: plan.fields } })
    if (target) {
      try {
        await move(key, category, {})
      } catch (error) {
        // A transition that needs fields keeps its list and its --field next step, so the follow-up move can pass them.
        const required = error.details?.requiredFields
        const nextStep = required ? error.nextStep : `pmkit issues move ${key} ${category}`
        throw new PmkitError('UPSTREAM', `Jira created ${key}, but the move to ${category} failed: ${error.message}`, nextStep, { created: key, cause: error.code ?? error.name, ...(required ? { requiredFields: required } : {}) })
      }
    }
    return { before: null, after: await afterOf(key) }
  }

  /** Writes the pmkit.branch property: the name, or a DELETE for null. */
  function writeBranch(key, name) {
    const path = issuePath(key, `/properties/${BRANCH}`)
    return name === null ? client.request('DELETE', path) : client.request('PUT', path, { body: name })
  }

  async function updateIssue(id, patch, actor, { dryRun = false } = {}) {
    await requireActor(actor)
    const { issue: before, context } = await readItem(id)
    const plan = toFields(patch ?? {}, before, context, { now: now().toISOString() })
    const changed = Object.keys(plan.fields).length > 0
    if (!changed && !plan.property) return { before, after: before }
    if (dryRun) return { before, after: plan.after }
    if (changed) await client.request('PUT', issuePath(before.id), { body: { fields: plan.fields } })
    if (plan.property) {
      try {
        await writeBranch(before.id, plan.property[BRANCH])
      } catch (error) {
        if (!changed) throw error
        throw new PmkitError('UPSTREAM', `Jira updated ${before.id}, but writing its branch failed: ${error.message}`, `pmkit issues update ${before.id} --branch <name>`, { cause: error.code ?? error.name })
      }
    }
    return { before, after: await afterOf(before.id) }
  }

  /** The move after the actor check: target, transition, screen fields, then one POST. */
  async function move(id, category, { status, fields = {}, dryRun = false }) {
    const { item, issue: before, context } = await readItem(id)
    const target = pickTarget({ item, category, status, context })
    // A dry run always carries requiredFields, so the confirmation reads one shape.
    if (String(item.fields.status?.id) === target.id) return dryRun ? { before, after: before, requiredFields: [] } : { before, after: before }
    const { transitions } = await client.request('GET', issuePath(before.id, '/transitions'), { query: { expand: 'transitions.fields' } })
    const transition = pickTransition(transitions ?? [], target, item)
    const required = requiredFields(transition)
    const where = { key: before.id, category, target: target.name }
    if (dryRun) {
      // The given values are checked; the missing ones are listed, so the confirmation can ask for them.
      fieldValues([], transition, fields, where)
      return { before, after: { ...before, status: statusAt(target, context) }, requiredFields: required }
    }
    const values = fieldValues(required, transition, fields, where)
    const body = { transition: { id: transition.id }, ...(Object.keys(values).length > 0 ? { fields: values } : {}) }
    await client.request('POST', issuePath(before.id, '/transitions'), { body })
    return { before, after: await afterOf(before.id) }
  }

  async function moveToCategory(id, category, actor, { status, fields = {}, dryRun = false } = {}) {
    if (!CATEGORIES.includes(category)) throw invalid(`category must be one of ${CATEGORIES.join(', ')}`)
    await requireActor(actor)
    return move(id, category, { status, fields, dryRun })
  }

  /** `who` is an account id, 'me' for the viewer, or null to unassign. */
  async function assign(id, who, actor, { dryRun = false } = {}) {
    await requireActor(actor)
    if (who !== null && typeof who !== 'string') throw invalid('assignee must be an account id, me or none')
    const account = who === 'me' ? (await getContext()).viewer?.id : who
    if (account !== null) {
      await withRefresh((current) => {
        if (!current.view.members.some((member) => member.id === account)) throw invalid(`assignee "${who}" is not an assignable user of space ${current.space}`, 'pmkit discover', { stale: true })
      })
    }
    const { issue: before } = await readItem(id)
    if ((before.assignee ?? null) === account) return { before, after: before }
    if (dryRun) {
      const { assignee: _gone, ...rest } = before
      return { before, after: account === null ? rest : { ...before, assignee: account } }
    }
    await client.request('PUT', issuePath(before.id, '/assignee'), { body: { accountId: account } })
    return { before, after: await afterOf(before.id) }
  }

  /** The items that point at the issue: those it blocks, those related to it, its duplicates and its children. */
  function referencesTo(item, issue, context) {
    const duplicate = lower(context.linkType('duplicate')?.name ?? 'duplicate')
    const duplicates = (item.fields?.issuelinks ?? []).filter((link) => lower(link.type?.name) === duplicate && link.inwardIssue).map((link) => link.inwardIssue.key)
    const found = [
      ...issue.blocks.map((id) => ({ id, kind: 'blockedBy' })),
      ...issue.related.map((id) => ({ id, kind: 'related' })),
      ...duplicates.map((id) => ({ id, kind: 'duplicateOf' })),
      ...issue.children.map((id) => ({ id, kind: 'parent' })),
    ]
    const unique = [...new Map(found.map((ref) => [`${ref.id} ${ref.kind}`, ref])).values()]
    return unique.sort((a, b) => compareIds(a.id, b.id) || REFERENCE_KINDS.indexOf(a.kind) - REFERENCE_KINDS.indexOf(b.kind))
  }

  /** Deletes a work item. Jira has no trash. It refuses, sending nothing, while another item references it. */
  async function deleteIssue(id, actor, { dryRun = false } = {}) {
    await requireActor(actor)
    const { item, issue: before, context } = await readItem(id)
    const references = referencesTo(item, before, context)
    if (references.length > 0) throw referencedError(before.id, references)
    const result = {
      before, after: null, removes: { issue: true }, references: [], mentions: [],
      warnings: before.branch === undefined ? [] : [`branch ${before.branch} stays as it is`],
      unchecked: ['the descriptions and comments of other work items', REPO_UNCHECKED],
    }
    if (dryRun) return result
    await client.request('DELETE', issuePath(before.id))
    return result
  }

  return { getIssue, searchIssues, readItem, requireActor, afterOf, createIssue, updateIssue, moveToCategory, assign, delete: deleteIssue }
}
