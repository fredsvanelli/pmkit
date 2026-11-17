// The Milestones family of the GitHub adapter: a milestone is a milestone of the scope repository, and its title is its id.
// The Deliverables operations join this object in the same file. See the spec, "Milestones".

import { PmkitError } from '../errors.mjs'
import { HEALTH, sortEpics } from '../local/epics.mjs'
import { sortMilestones } from '../local/milestones.mjs'
import { validDate } from '../local/sprints.mjs'
import { CATEGORIES } from '../model.mjs'
import { parseProject } from './discovery.mjs'
import { toIssue } from './issues.mjs'
import { docsOf } from './requests.mjs'
import {
  CREATE_PROJECT, CREATE_STATUS_UPDATE, EPIC_QUERY, STATUS_UPDATES_QUERY, UPDATE_PROJECT_README, epicItemsQuery, issueNodesQuery, parseEpicId, readMilestoneNodes, toEpic, toMilestone, toStatusUpdate,
} from './projects.mjs'

const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
const taken = (title) => new PmkitError('CONFLICT', `GitHub already has a milestone titled ${title}`, 'pmkit milestone list')
const CREATE_KEYS = ['id', 'name', 'due']
const blank = (value) => value === undefined || value === null || value === ''
/** The PmkitIssueFields fragment of the issue document, which puts it after its operation. */
const fragmentOf = (document) => document.slice(document.indexOf('fragment PmkitIssueFields'))
const notFoundEpic = (id) => new PmkitError('NOT_FOUND', `epic ${id} does not exist`, 'pmkit epic list')
const EPIC_CREATE_KEYS = ['title', 'start', 'target', 'milestone', 'goal', 'description']
const ITEM_PAGE = 100
const ITEM_PAGES = 10
const SUB_ISSUE_LEVELS = 10
const EPIC_PAGE = 20
const EPIC_PAGES = 10
const LINKED_EPICS_QUERY =
  'query PmkitLinkedProjects($owner: String!, $name: String!, $first: Int!, $after: String) { repository(owner: $owner, name: $name) { projectsV2(first: $first, after: $after) { nodes { id number title closed url shortDescription readme owner { ... on Organization { login } ... on User { login } } } pageInfo { hasNextPage endCursor } } } }'

/**
 * The epic Projects: every Project linked to the repository but the scope one, as Map<project node id, owner/number> with the owner as
 * GitHub writes it. Epics need the Project scope, so with project: none there is no read and no epic. It reads 20 Projects a page up to
 * 10 pages. Past that the map has a `warnings` list that says so. A repository GitHub cannot resolve has no epics; other failures propagate.
 */
export async function epicProjects(client, scope) {
  const wanted = parseProject(scope.project)
  if (!wanted) return new Map()
  const [owner, name] = scope.repo.split('/')
  let read
  try {
    read = await client.paginate(LINKED_EPICS_QUERY, { owner, name }, { select: (data) => data.repository.projectsV2, pageSize: EPIC_PAGE, maxPages: EPIC_PAGES })
  } catch (error) {
    if (error instanceof PmkitError && error.code === 'NOT_FOUND') return new Map()
    throw error
  }
  const epicsById = new Map()
  for (const project of read.nodes) {
    if (project.number === wanted.number && String(project.owner?.login).toLowerCase() === wanted.owner.toLowerCase()) continue
    epicsById.set(project.id, `${project.owner.login}/${project.number}`)
  }
  if (read.hasMore) epicsById.warnings = [`${scope.repo} has more than ${EPIC_PAGE * EPIC_PAGES} linked Projects, so pmkit read the first ${EPIC_PAGE * EPIC_PAGES} as epics`]
  return epicsById
}

/**
 * The project operations over one client. `ops` is issueOperations(...), which supplies the actor check. getContext({ refresh }) is the
 * tracker's. `now` is the clock, kept for the Deliverables operations.
 */
export function projectOperations({ client, ops, config, getContext, now = () => new Date() }) {
  /** Every milestone of the scope repository as pmkit milestones, sorted by due date then id. Read on every call. */
  async function listMilestones() {
    const context = await getContext()
    return sortMilestones((await readMilestoneNodes(client, context.repo)).map(toMilestone))
  }

  async function getMilestone(id) {
    const found = (await listMilestones()).find((milestone) => milestone.id === id)
    if (!found) throw new PmkitError('NOT_FOUND', `milestone ${id} does not exist`, 'pmkit milestone list')
    return found
  }

  /** The REST body of a create input, checked before any request. GitHub keeps a due date as a calendar date in US Pacific time, so noon UTC is the same date in every US zone. */
  function bodyOf(input) {
    for (const key of Object.keys(input)) {
      if (!CREATE_KEYS.includes(key)) throw invalid(`unknown field "${key}"`, `Use one of: ${CREATE_KEYS.join(', ')}`)
    }
    const { id } = input
    if (typeof id !== 'string' || id.trim() === '' || /[\r\n]/.test(id)) throw invalid('a milestone id is its title, a non-empty line of text', 'Use an id like v1.0')
    if (!blank(input.name) && input.name !== id) throw invalid('a GitHub milestone has one name, its title', 'Pass only the id, which becomes the title')
    if (!blank(input.due) && !validDate(input.due)) throw invalid('due must be a date as YYYY-MM-DD')
    return { title: id, ...(blank(input.due) ? {} : { due_on: `${input.due}T12:00:00Z` }) }
  }

  async function createMilestone(input, actor, { dryRun = false } = {}) {
    await ops.requireActor(actor)
    const body = bodyOf(input ?? {})
    const context = await getContext()
    if ((await listMilestones()).some((milestone) => milestone.id === body.title)) throw taken(body.title)
    if (dryRun) return { before: null, after: toMilestone({ ...body, state: 'open' }) }
    // The client words a taken title as CONFLICT. The answer of GitHub is the milestone, so no second read is needed.
    const created = await client.rest('POST', `repos/${context.repo}/milestones`, body)
    return { before: null, after: toMilestone(created) }
  }

  // The epics. See the design, "Epics".
  const scope = config.pmkit?.tracker?.scope ?? {}

  /** The Project node of an epic id as { project, latest } or null: the id must be a linked epic Project, and never the scope Project. */
  async function findEpic(id) {
    const parsed = parseEpicId(id)
    if (!parsed) return null
    const { epics } = await getContext()
    const written = [...epics.values()].find((value) => value.toLowerCase() === id.toLowerCase())
    if (!written) return null
    return readEpic(written)
  }

  /** The Project of owner/number with its latest status update. Null when GitHub has none. */
  async function readEpic(written) {
    const { owner, number } = parseEpicId(written)
    let data
    try {
      data = await client.request(EPIC_QUERY, { owner, number, statusFirst: 1 })
    } catch (error) {
      if (error instanceof PmkitError && error.code === 'NOT_FOUND') return null
      throw error
    }
    const project = data?.repositoryOwner?.projectV2
    if (!project) return null
    return { project, latest: project.statusUpdates?.nodes?.[0] ?? null }
  }

  async function listDeliverables() {
    const { epics } = await getContext()
    const found = []
    for (const written of epics.values()) {
      const epic = await readEpic(written)
      if (epic) found.push(toEpic(epic.project, epic.latest))
    }
    return sortEpics(found)
  }

  async function getDeliverable(id) {
    const found = await findEpic(id)
    if (!found) throw notFoundEpic(id)
    return toEpic(found.project, found.latest)
  }

  /**
   * The Local progress shape over the epic: the issue items of the Project that have no parent issue, then their sub-issues level by
   * level up to 10 levels. Archived items and issues are left out, a canceled issue is counted apart and an estimate adds to the points.
   * More than 10 pages of items sets hasMore.
   */
  async function deliverableProgress(id) {
    const found = await findEpic(id)
    if (!found) throw notFoundEpic(id)
    const context = await getContext()
    const query = epicItemsQuery(fragmentOf(docsOf(context).ISSUE), Object.keys(context.fieldVariables))
    const { nodes, hasMore } = await client.paginate(query, { project: found.project.id, ...context.fieldVariables }, { select: (data) => data.node.items, pageSize: ITEM_PAGE, maxPages: ITEM_PAGES })
    const names = Object.keys(context.fieldVariables)
    const nodesQuery = issueNodesQuery(fragmentOf(docsOf(context).ISSUE), names)
    const wanted = context.epics.get(found.project.id)
    const seen = new Map()
    const take = (node) => {
      if (seen.has(node.id)) return false
      seen.set(node.id, toIssue(node, context))
      return true
    }
    // The issue items whose shown parent is this epic: no parent issue, and no epic Project with a lower number.
    let level = []
    for (const item of nodes) {
      const node = item.content
      if (item.isArchived || node?.__typename !== 'Issue' || node.parent) continue
      if (toIssue(node, context).parent?.toLowerCase() !== wanted.toLowerCase()) continue
      if (take(node)) level.push(node)
    }
    // Each level of sub-issues is read in batches of 100 node ids. A list the fragment cut is paged first.
    for (let depth = 0; depth < SUB_ISSUE_LEVELS && level.length > 0; depth += 1) {
      const ids = []
      for (const node of level) {
        let children = node.subIssues?.nodes ?? []
        if (node.subIssues?.pageInfo?.hasNextPage === true) {
          children = (await client.paginate(docsOf(context).MORE('subIssues'), { id: node.id }, { select: (data) => data.node.subIssues, pageSize: 100 })).nodes
        }
        for (const child of children) if (!seen.has(child.id) && !ids.includes(child.id)) ids.push(child.id)
      }
      const next = []
      for (let at = 0; at < ids.length; at += ITEM_PAGE) {
        const read = await client.request(nodesQuery, { ids: ids.slice(at, at + ITEM_PAGE), ...context.fieldVariables })
        for (const node of read.nodes) if (node?.__typename === 'Issue' && take(node)) next.push(node)
      }
      level = next
    }
    const progress = { total: 0, done: 0, canceled: 0, points: 0, pointsDone: 0, byCategory: Object.fromEntries(CATEGORIES.map((category) => [category, 0])) }
    for (const issue of seen.values()) {
      if (issue.archived) continue
      const { category } = issue.status
      if (category in progress.byCategory) progress.byCategory[category] += 1
      if (category === 'canceled') {
        progress.canceled += 1
        continue
      }
      progress.total += 1
      if (category === 'done') progress.done += 1
      if (typeof issue.estimate === 'number') {
        progress.points += issue.estimate
        if (category === 'done') progress.pointsDone += issue.estimate
      }
    }
    if (hasMore) progress.hasMore = true
    return progress
  }

  /** The create input after every check that needs no request. */
  function epicInput(input) {
    for (const key of Object.keys(input ?? {})) {
      if (!EPIC_CREATE_KEYS.includes(key)) throw invalid(`unknown field "${key}"`, `Use one of: ${EPIC_CREATE_KEYS.join(', ')}`)
    }
    if (!blank(input.milestone)) throw new PmkitError('NOT_SUPPORTED', 'a GitHub Project has no parent milestone', 'Leave milestone out on GitHub')
    if (!blank(input.goal)) throw new PmkitError('NOT_SUPPORTED', 'the GitHub adapter has no goals', 'Leave --goal out on GitHub')
    if (typeof input.title !== 'string' || input.title.trim() === '') throw invalid('title is required')
    if (/[\r\n]/.test(input.title)) throw invalid('title must not contain a line break')
    const fields = { title: input.title.trim() }
    for (const key of ['start', 'target']) {
      if (blank(input[key])) continue
      if (!validDate(input[key])) throw invalid(`${key} must be a date as YYYY-MM-DD`)
      fields[key] = input[key]
    }
    if (!blank(input.description)) {
      if (typeof input.description !== 'string') throw invalid('description must be a string')
      fields.description = input.description.trim()
    }
    return fields
  }

  /** A write after the Project exists: a failure names the Project made and what is left to do by hand. */
  async function afterCreate(written, step, nextStep, run) {
    try {
      return await run()
    } catch (error) {
      if (!(error instanceof PmkitError)) throw error
      throw new PmkitError('UPSTREAM', `GitHub created the Project ${written} but ${step}: ${error.message}`, nextStep)
    }
  }

  async function createDeliverable(input, actor, { dryRun = false } = {}) {
    const fields = epicInput(input)
    await ops.requireActor(actor)
    const context = await getContext()
    const { ownerId, repositoryId } = context.raw
    if (!ownerId || !repositoryId) throw new PmkitError('NOT_CONFIGURED', 'the GitHub discovery has no owner id or repository id', '/pmkit:setup')
    const dated = fields.start !== undefined || fields.target !== undefined
    if (dryRun) {
      const preview = { id: null, title: fields.title, status: dated ? { name: 'Inactive', category: 'backlog' } : { name: 'No update', category: 'todo' } }
      if (fields.start) preview.start = fields.start
      if (fields.target) preview.target = fields.target
      preview.description = fields.description ?? ''
      return { before: null, after: preview }
    }
    const made = (await client.request(CREATE_PROJECT, { input: { ownerId, title: fields.title, repositoryId } })).createProjectV2.projectV2
    const written = `${context.repo.split('/')[0]}/${made.number}`
    // The run's epic map learns the new Project, so a later operation of this run finds it.
    context.epics.set(made.id, written)
    const README_STEP = 'Set the readme of the Project on GitHub'
    const STATUS_STEP = 'Publish a status update with the dates on GitHub'
    if (fields.description !== undefined) {
      // A failed readme leaves the dated update unsent too, so the next step names both.
      await afterCreate(written, 'could not set its readme', dated ? `${README_STEP}. ${STATUS_STEP}` : README_STEP, () => client.request(UPDATE_PROJECT_README, { input: { projectId: made.id, readme: fields.description } }))
    }
    if (dated) {
      const update = { projectId: made.id, status: 'INACTIVE', ...(fields.start ? { startDate: fields.start } : {}), ...(fields.target ? { targetDate: fields.target } : {}) }
      await afterCreate(written, 'could not publish its first status update', STATUS_STEP, () => client.request(CREATE_STATUS_UPDATE, { input: update }))
    }
    const read = await afterCreate(written, 'could not read it back', 'Run pmkit epic list to check it', () => readEpic(written))
    if (!read) throw new PmkitError('UPSTREAM', `GitHub created the Project ${written} but a read of it found nothing`, 'pmkit epic list')
    return { before: null, after: toEpic(read.project, read.latest) }
  }

  async function publishStatusUpdate(input, actor, { dryRun = false } = {}) {
    if (!HEALTH.includes(input?.health)) throw invalid(`health must be one of ${HEALTH.join(', ')}`)
    if (typeof input.body !== 'string' || input.body.trim() === '') throw invalid('status update body must be a non-empty string')
    await ops.requireActor(actor)
    const found = await findEpic(input.epic)
    if (!found) throw notFoundEpic(input.epic)
    const body = input.body.trim()
    const epic = toEpic(found.project, found.latest).id
    const after = { epic, at: now().toISOString(), author: actor, health: input.health, body }
    if (dryRun) return { before: null, after }
    const { startDate, targetDate } = found.latest ?? {}
    const update = { projectId: found.project.id, status: input.health.toUpperCase(), body, ...(startDate ? { startDate } : {}), ...(targetDate ? { targetDate } : {}) }
    await client.request(CREATE_STATUS_UPDATE, { input: update })
    return { before: null, after }
  }

  async function listStatusUpdates(id) {
    const found = await findEpic(id)
    if (!found) throw notFoundEpic(id)
    const epic = toEpic(found.project, found.latest).id
    const { nodes } = await client.paginate(STATUS_UPDATES_QUERY, { project: found.project.id }, { select: (data) => data.node.statusUpdates, pageSize: 100 })
    return nodes.map((node) => toStatusUpdate(node, epic))
  }

  return {
    listMilestones, getMilestone, createMilestone,
    epicProjects: () => epicProjects(client, scope),
    listDeliverables, getDeliverable, deliverableProgress, createDeliverable, publishStatusUpdate, listStatusUpdates,
  }
}
