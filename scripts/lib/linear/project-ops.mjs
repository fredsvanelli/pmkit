// The Deliverables, Milestones and Documents families of the Linear tracker: projects as epics, project updates, and project
// milestones and documents (read only).
// See docs/superpowers/specs/2026-10-28-pmk-38-linear-projects-as-epics-design.md, "Operations".

import { PmkitError } from '../errors.mjs'
import { HEALTH, sortEpics } from '../local/epics.mjs'
import { sortMilestones } from '../local/milestones.mjs'
import { validDate } from '../local/sprints.mjs'
import { CATEGORIES } from '../model.mjs'
import { PARENT_CHAIN_DEPTH } from './documents.mjs'
import { isUnconfirmed } from './issue-ops.mjs'
import { estimateOf, makeContext, stateCategory } from './issues.mjs'
import {
  DOCUMENT_QUERY, EPIC_ISSUES_QUERY, HEALTH_TO_LINEAR, PROJECTS_QUERY, PROJECT_CREATE, PROJECT_MILESTONES_QUERY, PROJECT_MILESTONE_QUERY, PROJECT_UPDATES_QUERY,
  PROJECT_UPDATE_CREATE, epicId, epicKey, toDocument, toEpic, toMilestone, toStatusUpdate,
} from './projects.mjs'

const LIST_PAGE = 100
const PROGRESS_PAGE = 100
const PROGRESS_PAGES = 10
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DOCUMENT_SLUG = /^[0-9a-z]{12}$/i
const DOCUMENT_URL_SLUG = /([0-9a-z]{12})\/?$/i
const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
const notFound = (id) => new PmkitError('NOT_FOUND', `epic ${id} does not exist`, 'pmkit epic list')

/** The filter that finds a project by one key. The identifier and the UUID go through `id`, and the slug through `slugId`. */
const filterOf = ({ kind, value }) => (kind === 'slug' ? { slugId: { eq: value } } : { id: { eq: value } })

/**
 * The project operations over one client. `discovery()` is the tracker's memo of the raw discovery.
 * Besides the contract operations, the result holds `resolveEpic`, which the issue operations use.
 */
export function projectOperations({ client, discovery, config, now = () => new Date(), uuid }) {
  const scope = config.pmkit?.tracker?.scope ?? {}

  function requireWorkspace() {
    if (!scope.workspace) throw new PmkitError('NOT_CONFIGURED', 'tracker.scope.workspace is not set', '/pmkit:setup')
  }

  /** The raw project node of an epic key, or null. A string that is no project key sends no request. */
  async function findProject(key, { withLists = false } = {}) {
    requireWorkspace()
    const parsed = epicKey(key)
    if (parsed.kind === 'other') return null
    const data = await client.request(PROJECTS_QUERY, { filter: filterOf(parsed), first: 1, withLists })
    return data?.projects?.nodes?.[0] ?? null
  }

  const resolveEpic = (key) => findProject(key)

  async function listDeliverables() {
    requireWorkspace()
    const filter = { accessibleTeams: { some: { key: { eq: scope.team } } } }
    const { nodes } = await client.paginate(PROJECTS_QUERY, { filter, withLists: false }, { select: (data) => data.projects, pageSize: LIST_PAGE, maxPages: 100 })
    const epics = nodes.map(toEpic)
    const created = Object.fromEntries(nodes.map((node, index) => [epics[index].id, node.createdAt]))
    return sortEpics(epics, created)
  }

  async function getDeliverable(id) {
    const node = await findProject(id, { withLists: true })
    if (!node) throw notFound(id)
    return toEpic(node)
  }

  /** The mapping context of this run. The viewer always comes from the session, never from the cache. */
  async function context() {
    const { raw } = await discovery()
    return makeContext(raw, config.pmkit, (await client.session()).viewer)
  }

  /** The issues of a filter, up to PROGRESS_PAGES pages. */
  const readIssues = (filter) =>
    client.paginate(EPIC_ISSUES_QUERY, { filter }, { select: (data) => data.issues, pageSize: PROGRESS_PAGE, maxPages: PROGRESS_PAGES })

  /**
   * The Local progress shape over the issues of the epic: the ones in the project without a parent issue, then their sub-issues level by level up to
   * PARENT_CHAIN_DEPTH levels (spec, "Progress"). `native` holds Linear's own number and scope. hasMore is true when the first
   * step stopped at its page cap.
   */
  async function deliverableProgress(id) {
    const project = await findProject(id)
    if (!project) throw notFound(id)
    const first = await readIssues({ project: { id: { eq: project.id } }, parent: { null: true } })
    const seen = new Map(first.nodes.map((node) => [node.identifier, node]))
    let level = first.nodes
    for (let depth = 0; depth < PARENT_CHAIN_DEPTH && level.length > 0; depth += 1) {
      const parents = level.map((node) => node.identifier)
      const next = []
      for (let at = 0; at < parents.length; at += PROGRESS_PAGE) {
        const { nodes } = await readIssues({ parent: { id: { in: parents.slice(at, at + PROGRESS_PAGE) } } })
        for (const node of nodes) {
          if (seen.has(node.identifier)) continue
          seen.set(node.identifier, node)
          next.push(node)
        }
      }
      level = next
    }
    const mapping = await context()
    const progress = { total: 0, done: 0, canceled: 0, points: 0, pointsDone: 0, byCategory: Object.fromEntries(CATEGORIES.map((category) => [category, 0])) }
    for (const node of seen.values()) {
      if (node.archivedAt) continue
      const category = stateCategory(node.state, mapping)
      if (category in progress.byCategory) progress.byCategory[category] += 1
      if (category === 'canceled') {
        progress.canceled += 1
        continue
      }
      progress.total += 1
      if (category === 'done') progress.done += 1
      const estimate = estimateOf(node, mapping)
      if (typeof estimate === 'number') {
        progress.points += estimate
        if (category === 'done') progress.pointsDone += estimate
      }
    }
    progress.native = { progress: project.progress, scope: project.scope }
    if (first.hasMore) progress.hasMore = true
    return progress
  }

  /** ADR-0005: Linear records every write as the owner of the key, so any other actor would make pmkit's output disagree with Linear. */
  async function requireViewer(actor) {
    requireWorkspace()
    const { viewer } = await context()
    if (actor !== viewer.id) {
      throw invalid(`Linear records every write as the owner of LINEAR_API_KEY (${viewer.name})`, 'Drop --as, or use a key created by that member')
    }
  }

  const CREATE_KEYS = ['title', 'start', 'target', 'milestone', 'goal', 'description']

  /** The Linear input of a new epic, after every check that needs no request. */
  function projectInput(input) {
    for (const key of Object.keys(input ?? {})) {
      if (!CREATE_KEYS.includes(key)) throw invalid(`unknown field "${key}"`, `Use one of: ${CREATE_KEYS.join(', ')}`)
    }
    if (input.milestone !== undefined && input.milestone !== null && input.milestone !== '') {
      throw new PmkitError('NOT_SUPPORTED', 'a Linear project has no parent milestone', 'Leave milestone out on Linear')
    }
    if (input.goal !== undefined && input.goal !== null && input.goal !== '') {
      throw new PmkitError('NOT_SUPPORTED', 'the Linear adapter does not link projects to initiatives yet', 'Leave --goal out on Linear')
    }
    if (typeof input.title !== 'string' || input.title.trim() === '') throw invalid('title is required')
    if (/[\r\n]/.test(input.title)) throw invalid('title must not contain a line break')
    const result = { name: input.title.trim() }
    for (const [key, field] of [['start', 'startDate'], ['target', 'targetDate']]) {
      if (input[key] === undefined || input[key] === null || input[key] === '') continue
      if (!validDate(input[key])) throw invalid(`${key} must be a date as YYYY-MM-DD`)
      result[field] = input[key]
    }
    if (input.description !== undefined && input.description !== null && input.description !== '') {
      if (typeof input.description !== 'string') throw invalid('description must be a string')
      result.content = input.description.trim()
    }
    return result
  }

  /** The project node with this UUID, read back after a create. */
  async function readById(id) {
    const data = await client.request(PROJECTS_QUERY, { filter: { id: { eq: id } }, first: 1, withLists: false })
    return data?.projects?.nodes?.[0] ?? null
  }

  async function createDeliverable(input, actor, { dryRun = false } = {}) {
    await requireViewer(actor)
    const fields = projectInput(input)
    const { raw } = await discovery()
    const team = raw.teams.find((item) => item.key === scope.team)
    if (!team) throw new PmkitError('NOT_CONFIGURED', `tracker.scope.team names ${scope.team}, which this workspace does not have`, '/pmkit:setup')
    if (dryRun) {
      const preview = { id: null, title: fields.name, status: { name: 'Backlog', category: 'backlog' } }
      if (fields.startDate) preview.start = fields.startDate
      if (fields.targetDate) preview.target = fields.targetDate
      if (fields.content) preview.description = fields.content
      return { before: null, after: preview }
    }
    const id = uuid()
    let node = null
    try {
      await client.request(PROJECT_CREATE, { input: { id, ...fields, teamIds: [team.id] } })
    } catch (error) {
      if (!isUnconfirmed(error)) throw error
      // The UUID pmkit chose tells whether the create happened. One read, then the original error.
      node = await readById(id)
      if (!node) throw error
    }
    // The payload can lack the identifier Linear assigns after the request, so the project is read again.
    node ??= await readById(id)
    if (!node) throw new PmkitError('UPSTREAM', `Linear created project ${id} but a read of it found nothing`, 'pmkit epic list')
    return { before: null, after: toEpic(node) }
  }

  async function publishStatusUpdate(input, actor, { dryRun = false } = {}) {
    if (!HEALTH.includes(input?.health)) throw invalid(`health must be one of ${HEALTH.join(', ')}`)
    if (typeof input.body !== 'string' || input.body.trim() === '') throw invalid('status update body must be a non-empty string')
    await requireViewer(actor)
    const project = await findProject(input.epic)
    if (!project) throw notFound(input.epic)
    const body = input.body.trim()
    if (dryRun) return { before: null, after: { epic: epicId(project), at: now().toISOString(), author: actor, health: input.health, body } }
    const id = uuid()
    let node
    try {
      node = (await client.request(PROJECT_UPDATE_CREATE, { input: { id, projectId: project.id, body, health: HEALTH_TO_LINEAR[input.health] } })).projectUpdateCreate.projectUpdate
    } catch (error) {
      if (!isUnconfirmed(error)) throw error
      node = (await readUpdates(project)).find((item) => item.id === id)
      if (!node) throw error
    }
    return { before: null, after: toStatusUpdate(node) }
  }

  /** The update nodes of a project, newest first with the id as the tie-break. */
  async function readUpdates(project) {
    const { nodes } = await client.paginate(PROJECT_UPDATES_QUERY, { id: project.id }, { select: (data) => data.project.projectUpdates, pageSize: LIST_PAGE })
    return nodes.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  async function listStatusUpdates(id) {
    const project = await findProject(id)
    if (!project) throw notFound(id)
    return (await readUpdates(project)).map((node) => toStatusUpdate(node))
  }

  async function listMilestones() {
    requireWorkspace()
    const filter = { accessibleTeams: { some: { key: { eq: scope.team } } } }
    const projects = await client.paginate(PROJECTS_QUERY, { filter, withLists: false }, { select: (data) => data.projects, pageSize: LIST_PAGE, maxPages: 100 })
    const ids = new Set(projects.nodes.map((node) => node.id))
    // Linear rejects a project filter on milestones when the value is not a real id, so the team is applied here.
    const { nodes } = await client.paginate(PROJECT_MILESTONES_QUERY, {}, { select: (data) => data.projectMilestones, pageSize: LIST_PAGE, maxPages: 100 })
    return sortMilestones(nodes.filter((node) => ids.has(node.project?.id)).map(toMilestone))
  }

  async function getMilestone(id) {
    requireWorkspace()
    const missing = () => new PmkitError('NOT_FOUND', `milestone ${id} does not exist`, 'pmkit milestone list')
    if (typeof id !== 'string' || !UUID.test(id)) throw missing()
    let node
    try {
      node = (await client.request(PROJECT_MILESTONE_QUERY, { id })).projectMilestone
    } catch (error) {
      // Linear answers an unknown id with an "Entity not found" error.
      if (error instanceof PmkitError && /not found/i.test(error.message)) throw missing()
      throw error
    }
    if (!node) throw missing()
    return toMilestone(node)
  }

  /** `docPath` is a document slug or the URL of a document, which ends in the slug. */
  async function readDocument(docPath) {
    requireWorkspace()
    const slug = typeof docPath !== 'string' ? null : /^https?:\/\//i.test(docPath) ? DOCUMENT_URL_SLUG.exec(docPath)?.[1] : DOCUMENT_SLUG.test(docPath) ? docPath : null
    const missing = () => new PmkitError('NOT_FOUND', `document ${docPath} does not exist`, 'pmkit epic get shows the documents of an epic')
    if (!slug) throw missing()
    const data = await client.request(DOCUMENT_QUERY, { filter: { slugId: { eq: slug } } })
    const node = data?.documents?.nodes?.[0]
    if (!node) throw missing()
    return toDocument(node)
  }

  const notWritable = (what) => async () => {
    throw new PmkitError('NOT_SUPPORTED', `the Linear adapter reads project ${what}s but does not create them`, `Create the ${what} in Linear`)
  }

  return { listDeliverables, getDeliverable, deliverableProgress, createDeliverable, listMilestones, getMilestone, readDocument, createMilestone: notWritable('milestone'), createDocument: notWritable('document'), publishStatusUpdate, listStatusUpdates, resolveEpic, requireWorkspace, now, uuid, discovery }
}
