// The Cycles and Capacity families of the Linear tracker. A cycle is a pmkit sprint and its id is the cycle number as a string.
// See docs/superpowers/specs/2026-10-28-pmk-37-linear-cycles-to-sprints-design.md.

import { PmkitError } from '../errors.mjs'
import { entryFor, readCapacity, writeEntry } from './capacity-store.mjs'
import { cycleKey, cycleState, cyclesOff, toSprint } from './cycles.mjs'
import { CYCLES_QUERY, CYCLE_BY_NUMBER_QUERY } from './documents.mjs'

const SPRINT_STATES = ['planned', 'active', 'closed']

const notFound = (id) => new PmkitError('NOT_FOUND', `sprint ${id} does not exist`, 'pmkit cycle list')

/**
 * The cycle operations over one client. `issues` is issueOperations(...), which supplies the context, the viewer check and
 * the issue reads and writes. `config.root` holds .pmkit/capacity.yaml.
 */
export function cycleOperations({ client, issues, config }) {
  /** The context and the scope team, which must have cycles on: every cycle read and capacity operation starts here. */
  async function scope() {
    issues.requireWorkspace()
    const context = await issues.context()
    const team = context.scopeTeam
    if (!team) throw new PmkitError('NOT_CONFIGURED', 'tracker.scope.team is not set', '/pmkit:setup')
    if (team.cyclesEnabled !== true) throw cyclesOff(team.key)
    return { context, team }
  }

  const teamClause = (team) => ({ team: { key: { eq: team.key } } })

  /** The cycle nodes of the scope team, sorted by number. */
  async function readCycles(team) {
    const { nodes } = await client.paginate(CYCLES_QUERY, { filter: { and: [teamClause(team)] } }, { select: (data) => data.cycles, pageSize: 100 })
    return nodes.sort((a, b) => a.number - b.number)
  }

  /** The node of a cycle number in the scope team, or null. */
  async function readCycle(team, number) {
    const data = await client.request(CYCLE_BY_NUMBER_QUERY, { filter: { and: [teamClause(team), { number: { eq: number } }] } })
    return data?.cycles?.nodes?.[0] ?? null
  }

  /** The node of a pmkit sprint id, NOT_FOUND for a malformed id (before any request) or an unknown cycle. */
  async function requireCycle(team, id) {
    const number = cycleKey(id)
    if (number === null) throw notFound(id)
    const node = await readCycle(team, number)
    if (!node) throw notFound(id)
    return node
  }

  const entries = (team) => readCapacity(config.root, team.key)

  async function listCycles({ state } = {}) {
    if (state !== undefined && !SPRINT_STATES.includes(state)) throw new PmkitError('INVALID_INPUT', `state must be one of ${SPRINT_STATES.join(', ')}`)
    const { team } = await scope()
    const local = entries(team)
    // The state filter runs here, with cycleState, so a cycle with no flag (cooldown) is closed in both the full list and the
    // closed filter. An isPast clause would leave it out of the second.
    const nodes = (await readCycles(team)).filter((node) => state === undefined || cycleState(node) === state)
    return nodes.map((node) => toSprint(node, entryFor(local, String(node.number))))
  }

  async function currentCycle() {
    const { team } = await scope()
    const local = entries(team)
    const data = await client.request(CYCLES_QUERY, { filter: { and: [teamClause(team), { isActive: { eq: true } }] }, first: 1 })
    const node = data?.cycles?.nodes?.[0]
    return node ? toSprint(node, entryFor(local, String(node.number))) : null
  }

  async function cycleIssues(id) {
    issues.requireWorkspace()
    if (cycleKey(id) === null) throw notFound(id)
    const { team } = await scope()
    await requireCycle(team, id)
    return (await issues.searchIssues({ sprint: id })).issues
  }

  const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
  const listOf = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0])

  /** The error of a move that failed after others succeeded: the same code, the ids already moved in details and the next step. */
  function stoppedHalfway(error, moved) {
    if (moved.length === 0 || !(error instanceof PmkitError)) return error
    const nextStep = `${listOf(moved)} ${moved.length === 1 ? 'was' : 'were'} moved; check Linear before you retry`
    return new PmkitError(error.code, error.message, nextStep, { ...error.details, moved })
  }

  /**
   * `to` is a cycle id, 'current' for the active cycle, or null to take the issues out of their cycle. The Local order of checks
   * runs first (spec, "Moving issues"), so a bad id writes nothing. One issueUpdate per issue, in the given order.
   */
  async function moveToCycle(ids, to, actor, { dryRun = false } = {}) {
    await issues.requireViewer(actor)
    if (!Array.isArray(ids) || ids.length === 0) throw invalid('ids must be a non-empty list')
    if (to !== null && typeof to !== 'string') throw invalid('to must be a cycle id, current or null')
    const { scopeTeam: team } = await issues.context()
    if (!team) throw new PmkitError('NOT_CONFIGURED', 'tracker.scope.team is not set', '/pmkit:setup')
    let target = null
    if (to !== null) {
      if (team.cyclesEnabled !== true) throw cyclesOff(team.key)
      target = await issues.cycleNodeFor(to, team)
    }
    const nodes = []
    for (const id of ids) nodes.push(await issues.readNode(id))
    for (const node of target ? nodes : []) {
      if (node.team.id !== team.id) throw invalid(`issue ${node.identifier} belongs to team ${node.team.key}, and cycle ${target.number} belongs to ${team.key}`, 'pmkit issues list')
    }
    const sprint = target ? String(target.number) : null
    const results = []
    const moved = []
    for (const id of ids) {
      try {
        results.push(await issues.updateIssue(id, { sprint }, actor, { dryRun }))
      } catch (error) {
        throw stoppedHalfway(error, moved)
      }
      const { before, after } = results.at(-1)
      if (before.sprint !== after.sprint) moved.push(after.id)
    }
    return results
  }

  // Linear has no call that creates or ends a cycle, so these two answer the same way whatever the input (spec, "Opening and closing").
  async function openCycle() {
    throw new PmkitError(
      'NOT_SUPPORTED',
      "Linear creates cycles from the team's schedule, so pmkit cannot open one",
      "Set the schedule in the team's cycle settings in Linear (duration, start day, upcoming cycles)",
    )
  }

  async function closeCycle() {
    throw new PmkitError(
      'NOT_SUPPORTED',
      'Linear ends a cycle on its end date, so pmkit cannot close one',
      'Move the unfinished issues with pmkit cycle add --to <cycle|none>; Linear closes the cycle on its end date',
    )
  }

  async function readEntry(id) {
    const { team } = await scope()
    await requireCycle(team, id)
    return entryFor(entries(team), id)
  }

  const getCapacity = async (id) => (await readEntry(id)).capacity
  const getDaysOff = async (id) => (await readEntry(id)).daysOff

  /** Capacity and days off live in .pmkit/capacity.yaml, so Linear is not written and the viewer check only keeps --as honest. */
  async function updateCycleCapacity(id, { capacity, daysOff } = {}, actor, { dryRun = false } = {}) {
    await issues.requireViewer(actor)
    const { context, team } = await scope()
    const node = await requireCycle(team, id)
    const sprint = toSprint(node)
    const members = context.raw.users.filter((user) => !user.app).map((user) => user.id)
    const { before, after } = writeEntry(config.root, team.key, String(node.number), { capacity, daysOff }, { sprint, members, dryRun })
    return { before: toSprint(node, before), after: toSprint(node, after) }
  }

  const setCapacity = (id, map, actor, options) => updateCycleCapacity(id, { capacity: map }, actor, options)

  return { listCycles, currentCycle, cycleIssues, moveToCycle, openCycle, closeCycle, getCapacity, getDaysOff, setCapacity, updateCycleCapacity }
}
