// The Deliverables family of the Jira adapter (PMK-79): an epic is a work item of an epic-level work type of the space
// (ADR 0017), and a status update is a comment on it with the pmkit.statusUpdate property.
// See docs/superpowers/specs/2026-11-23-pmk-79-map-jira-epics-versions-status-updates-design.md, "Deliverables operations"
// and "Status updates".

import { PmkitError } from '../errors.mjs'
import { HEALTH, sortEpics } from '../local/epics.mjs'
import { compareTimes, countProgress, epicEditInput, pickMoveTarget, TERMINAL, validDate } from '../model.mjs'
import { textToAdf } from './adf.mjs'
import { EPIC_FIELDS, STATUS_UPDATE, statusUpdateBody, toEpic, toStatusUpdate } from './epics.mjs'
import { jqlString } from './filter.mjs'
import { API, isIssueKey, issuePath, normalizeKey, PAGE_SIZE } from './ids.mjs'
import { jiraTime } from './issues.mjs'
import { NO_GOALS } from './manifest.mjs'

export const NO_MILESTONES = 'Jira has no milestones'
const CREATE_KEYS = ['title', 'start', 'target', 'milestone', 'goal', 'description']

const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
const notFound = (id) => new PmkitError('NOT_FOUND', `epic ${id} does not exist`, 'pmkit epic list')
const blank = (value) => value === undefined || value === null || value === ''

/** The epic-level work types of the space, in discovery order. */
const epicTypes = (context) => context.raw.workTypes.filter((type) => type.level === 'epic')

/** The statuses of a work type as `{ name, category }`, in its workflow's order. */
function statusesOf(type, context) {
  return type.statuses
    .map((id) => context.raw.statuses.find((status) => status.id === id))
    .filter(Boolean)
    .map((status) => ({ name: status.name, category: context.categoryOf(status.name, status.categoryKey) }))
}

/** The create input after every check that needs no request. */
function epicInput(input, context) {
  for (const key of Object.keys(input)) if (!CREATE_KEYS.includes(key)) throw invalid(`unknown field "${key}"`, `Use one of: ${CREATE_KEYS.join(', ')}`)
  if (!blank(input.milestone)) throw new PmkitError('NOT_SUPPORTED', NO_MILESTONES, 'Use a release (version) or an epic')
  if (!blank(input.goal)) throw new PmkitError('NOT_SUPPORTED', NO_GOALS, 'Leave --goal out on Jira')
  if (typeof input.title !== 'string' || input.title.trim() === '') throw invalid('title is required')
  if (/[\r\n]/.test(input.title.trim())) throw invalid('title must not contain a line break')
  const fields = { title: input.title.trim() }
  for (const key of ['start', 'target']) {
    if (blank(input[key])) continue
    if (!validDate(input[key])) throw invalid(`${key} must be a date as YYYY-MM-DD`)
    fields[key] = input[key]
  }
  if (fields.start && !context.view.fields.start_date) throw new PmkitError('NOT_SUPPORTED', `No start date field in space ${context.space}`, '/pmkit:setup')
  if (!blank(input.description)) {
    if (typeof input.description !== 'string') throw invalid('description must be a string')
    fields.description = input.description.trim()
  }
  return fields
}

/**
 * The deliverable operations over one client. `ops` is issueOperations(...): the actor check, the issue search and the move.
 * getContext() is the tracker's; `now` is the clock of a dry-run status update.
 */
export function epicOperations({ client, ops, getContext, now = () => new Date() }) {
  /** The context, or NOT_SUPPORTED for a space with no epic-level work type. */
  async function epicContext() {
    const context = await getContext()
    if (epicTypes(context).length === 0) throw new PmkitError('NOT_SUPPORTED', `Space ${context.space} has no epic work type`, '/pmkit:setup')
    return context
  }

  /** The raw epic work item of an id: any other key (malformed, another space, unknown, not an epic) is NOT_FOUND. */
  async function readEpicItem(id, context) {
    const key = isIssueKey(id) ? normalizeKey(id) : null
    if (key === null || !key.startsWith(`${context.space}-`)) throw notFound(id)
    let item
    try {
      item = await client.request('GET', issuePath(key), { query: { fields: EPIC_FIELDS(context).join(',') } })
    } catch (error) {
      if (error instanceof PmkitError && error.code === 'NOT_FOUND') throw notFound(id)
      throw error
    }
    if (!epicTypes(context).some((type) => type.id === String(item?.fields?.issuetype?.id))) throw notFound(id)
    return item
  }

  /** The status updates of an epic, newest first; same-time updates put the later comment (the higher id) first. */
  async function updatesOf(key) {
    const { items } = await client.paginate(issuePath(key, '/comment'), { query: { expand: 'properties' }, key: 'comments', pageSize: PAGE_SIZE, maxPages: 1000 })
    return items
      .map((comment) => ({ id: Number(comment.id), update: toStatusUpdate(comment, key) }))
      .filter((entry) => entry.update !== null)
      .sort((a, b) => compareTimes(b.update.at, a.update.at) || b.id - a.id)
      .map((entry) => entry.update)
  }

  const epicOf = async (item, context) => toEpic(item, context, (await updatesOf(item.key))[0] ?? null)
  const readEpic = async (id, context) => epicOf(await readEpicItem(id, context), context)

  async function listDeliverables() {
    const context = await epicContext()
    const types = epicTypes(context).map((type) => jqlString(type.id)).join(', ')
    const jql = `project = ${jqlString(context.space)} AND issuetype in (${types}) ORDER BY created ASC, key ASC`
    const { items } = await client.paginate(`${API}/search/jql`, { query: { jql, fields: EPIC_FIELDS(context).join(',') }, key: 'issues', pageSize: PAGE_SIZE, maxPages: 1000 })
    // ponytail: one comment read per epic for its health; batch with a JQL over the property if epic lists get slow.
    const epics = []
    for (const item of items) epics.push(await epicOf(item, context))
    return sortEpics(epics)
  }

  async function getDeliverable(id) {
    return readEpic(id, await epicContext())
  }

  /** The Local progress shape over the epic's children and their subtasks: Jira's hierarchy is epic, standard, subtask. */
  async function deliverableProgress(id) {
    const item = await readEpicItem(id, await epicContext())
    const top = await ops.searchIssues({ parent: item.key })
    const issues = [...top.issues]
    let hasMore = top.hasMore
    // ponytail: one search per child with subtasks; batch with parent in (...) if epics with many such children get slow.
    for (const child of top.issues.filter((issue) => issue.children.length > 0)) {
      const subtasks = await ops.searchIssues({ parent: child.id })
      issues.push(...subtasks.issues)
      hasMore ||= subtasks.hasMore
    }
    const progress = countProgress(issues)
    if (hasMore) progress.hasMore = true
    return progress
  }

  async function createDeliverable(input, actor, { dryRun = false } = {}) {
    const context = await epicContext()
    const fields = epicInput(input ?? {}, context)
    await ops.requireActor(actor)
    const type = epicTypes(context)[0]
    if (dryRun) {
      const after = { id: null, title: fields.title, status: statusesOf(type, context)[0] ?? null }
      if (fields.start) after.start = fields.start
      if (fields.target) after.target = fields.target
      after.description = fields.description ?? ''
      return { before: null, after }
    }
    const body = {
      fields: {
        project: { key: context.space }, issuetype: { id: type.id }, summary: fields.title,
        ...(fields.description ? { description: textToAdf(fields.description) } : {}),
        ...(fields.target ? { duedate: fields.target } : {}),
        ...(fields.start ? { [context.view.fields.start_date.id]: fields.start } : {}),
      },
    }
    const { key } = await client.request('POST', `${API}/issue`, { body })
    return { before: null, after: await readEpic(key, context) }
  }

  async function moveDeliverable(id, category, actor, { status, dryRun = false } = {}) {
    const context = await epicContext()
    await ops.requireActor(actor)
    const item = await readEpicItem(id, context)
    const before = await epicOf(item, context)
    const type = epicTypes(context).find((candidate) => candidate.id === String(item.fields.issuetype.id))
    const target = pickMoveTarget({ before, category, status, targets: statusesOf(type, context), tracker: 'Jira' })
    try {
      await ops.moveToCategory(before.id, category, actor, { status: target.name, dryRun })
    } catch (error) {
      // epic move has no --field, so a transition that needs fields is made in Jira.
      if (!(error instanceof PmkitError) || !error.details?.requiredFields) throw error
      throw new PmkitError(error.code, error.message, `Move epic ${before.id} in Jira, which asks for those fields`, error.details)
    }
    if (dryRun) {
      const { health, ...rest } = before
      return { before, after: { ...rest, status: { name: target.name, category }, ...(health && !TERMINAL.includes(category) ? { health } : {}) } }
    }
    return { before, after: await readEpic(before.id, context) }
  }

  /** Edits the summary and/or the description of an epic (PMK-348); an empty description clears it. */
  async function updateDeliverable(id, input, actor, { dryRun = false } = {}) {
    const context = await epicContext()
    const edit = epicEditInput(input)
    await ops.requireActor(actor)
    const before = await readEpic(id, context)
    const title = edit.title === undefined ? before.title : edit.title.trim()
    const description = edit.description === undefined ? before.description : (edit.description ?? '').trim()
    const fields = {}
    if (title !== before.title) fields.summary = title
    if (description !== before.description) fields.description = description === '' ? null : textToAdf(description)
    if (Object.keys(fields).length === 0) throw invalid(`epic ${before.id} already has this title and description`, `pmkit epic get ${before.id}`)
    if (dryRun) return { before, after: { ...before, title, description } }
    await client.request('PUT', issuePath(before.id), { body: { fields } })
    return { before, after: await readEpic(before.id, context) }
  }

  async function publishStatusUpdate(input, actor, { dryRun = false } = {}) {
    const context = await epicContext()
    if (!HEALTH.includes(input?.health)) throw invalid(`health must be one of ${HEALTH.join(', ')}`)
    if (typeof input.body !== 'string' || input.body.trim() === '') throw invalid('status update body must be a non-empty string')
    await ops.requireActor(actor)
    const { key } = await readEpicItem(input.epic, context)
    const { health } = input
    const body = input.body.trim()
    if (dryRun) return { before: null, after: { epic: key, at: now().toISOString(), author: actor, health, body } }
    const made = await client.request('POST', issuePath(key, '/comment'), { body: { body: statusUpdateBody(health, body), properties: [{ key: STATUS_UPDATE, value: { health } }] } })
    return { before: null, after: { epic: key, at: jiraTime(made.created), author: made.author?.accountId ?? actor, health, body } }
  }

  async function listStatusUpdates(id) {
    const { key } = await readEpicItem(id, await epicContext())
    return updatesOf(key)
  }

  return { listDeliverables, getDeliverable, deliverableProgress, createDeliverable, moveDeliverable, updateDeliverable, publishStatusUpdate, listStatusUpdates }
}
