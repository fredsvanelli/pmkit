// The Cycles and Capacity families of the Linear tracker. A cycle is a pmkit sprint and its id is the cycle number as a string.
// See docs/superpowers/specs/2026-10-28-pmk-37-linear-cycles-to-sprints-design.md.

import { PmkitError } from '../errors.mjs'
import { entryFor, readCapacity } from './capacity-store.mjs'
import { cycleKey, cyclesOff, toSprint } from './cycles.mjs'
import { CYCLES_QUERY, CYCLE_BY_NUMBER_QUERY } from './documents.mjs'

const SPRINT_STATES = ['planned', 'active', 'closed']
const FLAG_OF_STATE = { planned: 'isFuture', active: 'isActive', closed: 'isPast' }

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

  /** The cycle nodes of the scope team, with the clauses added, sorted by number. */
  async function readCycles(team, clauses = []) {
    const { nodes } = await client.paginate(CYCLES_QUERY, { filter: { and: [teamClause(team), ...clauses] } }, { select: (data) => data.cycles, pageSize: 100 })
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
    const nodes = await readCycles(team, state === undefined ? [] : [{ [FLAG_OF_STATE[state]]: { eq: true } }])
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

  return { listCycles, currentCycle, cycleIssues }
}
