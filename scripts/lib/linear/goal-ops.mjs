// Linear initiatives as pmkit goals (PMK-213), reads only: listGoals, getGoal and goalProgress. The writes stay stubs.
// See docs/superpowers/specs/2026-11-10-pmk-213-improve-goals-design.md, decision 8.

import { PmkitError } from '../errors.mjs'
import { sortGoals } from '../local/goals.mjs'
import { CATEGORIES } from '../model.mjs'
import { STATUS_CATEGORY, epicId } from './projects.mjs'

const PAGE = 50
const PAGES = 20
const EPIC_PAGE = 50

// A goal's epics are the initiative's projects that the scope team can see, as `epic list` lists them.
export const INITIATIVES_QUERY = `query PmkitInitiatives($first: Int, $after: String, $projectFilter: ProjectFilter) {
  initiatives(first: $first, after: $after) {
    nodes {
      id slugId identifier name description content status targetDate url
      projects(first: ${EPIC_PAGE}, filter: $projectFilter) { nodes { id slugId identifier name status { name type } } pageInfo { hasNextPage } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`

/** The goal id of an initiative: the identifier in upper case when it has one, else the slug. */
const goalId = (node) => (node.identifier ? node.identifier.toUpperCase() : node.slugId.toLowerCase())

/** The pmkit goal of an initiative node. `epicsMore` is set when the initiative has more team projects than were read. */
export function toGoal(node) {
  const goal = { id: goalId(node), title: node.name, status: String(node.status).toLowerCase() }
  if (node.targetDate) goal.target = node.targetDate
  goal.description = node.content || node.description || ''
  if (node.url) goal.url = node.url
  goal.epics = node.projects.nodes.map(epicId)
  if (node.projects.pageInfo?.hasNextPage === true) goal.epicsMore = true
  return goal
}

const epicsCut = (goal) => `the initiative ${goal.id} has more than ${EPIC_PAGE} projects of the team; its epics are the first ${EPIC_PAGE}`

export function goalOperations({ client, config, projects }) {
  const scope = config.pmkit?.tracker?.scope ?? {}

  async function readInitiatives() {
    const projectFilter = { accessibleTeams: { some: { key: { eq: scope.team } } } }
    return client.paginate(INITIATIVES_QUERY, { projectFilter }, { select: (data) => data.initiatives, pageSize: PAGE, maxPages: PAGES })
  }

  /** Every goal, by target then id. A cut read is a `goal` problem with code INCOMPLETE, so no command concludes from it. */
  async function listGoals() {
    const { nodes, hasMore } = await readInitiatives()
    const goals = sortGoals(nodes.map(toGoal))
    const problems = [
      ...(hasMore ? [{ id: null, kind: 'goal', code: 'INCOMPLETE', message: `Linear has more initiatives than the ${PAGE * PAGES} pmkit read; the goals cover the first ${PAGE * PAGES}` }] : []),
      ...goals.filter((goal) => goal.epicsMore).map((goal) => ({ id: goal.id, kind: 'goal', code: 'INCOMPLETE', message: epicsCut(goal) })),
    ]
    return { goals, problems }
  }

  /** The initiative node of a goal key: the identifier (any case), the slug or the UUID. */
  async function findInitiative(key) {
    const { nodes, hasMore } = await readInitiatives()
    const wanted = String(key).toLowerCase()
    const node = nodes.find((item) => [item.id, item.slugId, item.identifier].some((value) => typeof value === 'string' && value.toLowerCase() === wanted))
    if (node) return node
    if (hasMore) throw new PmkitError('UPSTREAM', `goal ${key} is not in the first ${PAGE * PAGES} initiatives pmkit read, and Linear has more`, 'Open the initiative in Linear')
    throw new PmkitError('NOT_FOUND', `goal ${key} does not exist`, 'pmkit goal list')
  }

  const getGoal = async (key) => toGoal(await findInitiative(key))

  /** The progress of each epic, as deliverableProgress counts it, and the sums of the epics that are not canceled. */
  async function goalProgress(key) {
    const node = await findInitiative(key)
    const goal = toGoal(node)
    const warnings = goal.epicsMore ? [`${epicsCut(goal)}; goal progress may be low`] : []
    const sum = { total: 0, done: 0, canceled: 0, points: 0, pointsDone: 0, byCategory: Object.fromEntries(CATEGORIES.map((category) => [category, 0])) }
    const epics = []
    for (const project of node.projects.nodes) {
      const id = epicId(project)
      const status = { name: project.status.name, category: STATUS_CATEGORY[project.status.type] ?? 'backlog' }
      const progress = await projects.deliverableProgress(id)
      if (progress.hasMore) warnings.push(`${id}: Linear has more issues in this epic than the 1000 pmkit read; goal progress may be low`)
      const counted = status.category !== 'canceled'
      if (counted) {
        for (const field of ['total', 'done', 'canceled', 'points', 'pointsDone']) sum[field] += progress[field]
        for (const category of CATEGORIES) sum.byCategory[category] += progress.byCategory[category]
      }
      epics.push({ id, title: project.name, status, counted, progress })
    }
    return { goal, epics, ...sum, warnings }
  }

  return { listGoals, getGoal, goalProgress }
}
