// The Cycles and Capacity families of the GitHub adapter. A sprint is an iteration of the scope Project's iteration field, and its id
// is the start date. Capacity lives in .pmkit/capacity.yaml, as on Linear, under the key github:<owner>/<number> of the Project.
// See docs/specs/2026-11-17-pmk-88-github-iterations-milestones-epics-design.md, "Sprints".

import { stoppedHalfway } from '../cycle-moves.mjs'
import { PmkitError } from '../errors.mjs'
import { addDays, baseField, overlaps, SPRINT_STATES, validDate } from '../local/sprints.mjs'
import { entryFor, readCapacity, writeEntry } from '../linear/capacity-store.mjs'
import { appendIteration, ITERATION_FIELD_QUERY, sprintsOf, toSprint, UPDATE_ITERATIONS } from './cycles.mjs'
import { projectName } from './writes.mjs'

const SETUP = '/pmkit:setup'
const OPEN_KEYS = ['start', 'end', 'goal', 'name']

const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
const notFound = (id) => new PmkitError('NOT_FOUND', `sprint ${id} does not exist`, 'pmkit cycle list')

/** The sprint with its capacity entry, in the shape Local and Linear return. */
const withEntry = (sprint, entry) => ({ ...sprint, capacity: entry.capacity ?? {}, daysOff: entry.daysOff ?? {}, ...baseField(entry.capacityBase ?? {}) })

/**
 * The cycle operations over one client. `ops` is issueOperations(...), which supplies the actor check and the issue reads and writes.
 * getContext({ refresh }) is the tracker's. `now` is the clock; its UTC date decides which sprint is active. config.root holds .pmkit/capacity.yaml.
 */
export function cycleOperations({ client, ops, config, getContext, now = () => new Date() }) {
  const today = () => now().toISOString().slice(0, 10)

  /** The context and the mapped iteration field of the scope Project: every cycle operation starts here. */
  async function scope() {
    const context = await getContext()
    if (!context.project) throw new PmkitError('NOT_SUPPORTED', 'tracker.scope.project is none, so GitHub has no sprints', SETUP)
    const mapped = context.field('sprint')
    if (!mapped) throw new PmkitError('NOT_SUPPORTED', `no iteration field of ${projectName(context)} is mapped to sprints`, SETUP)
    return { context, field: mapped.field, key: `github:${projectName(context)}` }
  }

  /** The configuration of the iteration field, read from GitHub now and not from the discovery cache. */
  async function readConfiguration(context, field) {
    const data = await client.request(ITERATION_FIELD_QUERY, { project: context.project.id, field: field.name })
    const found = data?.node?.field
    if (!found?.configuration) throw new PmkitError('NOT_CONFIGURED', `the iteration field ${field.name} no longer exists in ${projectName(context)}`, SETUP)
    return found
  }

  /** Every sprint of the field with its capacity entry, in start order, and the id and configuration of the field. */
  async function readSprints(context, field, key) {
    const found = await readConfiguration(context, field)
    const { sprints, warnings } = sprintsOf(found.configuration, today())
    const entries = readCapacity(config.root, key)
    return { sprints: sprints.map((sprint) => withEntry(sprint, entryFor(entries, sprint.id))), warnings, found }
  }

  const requireSprint = (sprints, id) => sprints.find((sprint) => sprint.id === id) ?? (() => { throw notFound(id) })()

  async function listCycles({ state } = {}) {
    if (state !== undefined && !SPRINT_STATES.includes(state)) throw invalid(`state must be one of ${SPRINT_STATES.join(', ')}`)
    const { context, field, key } = await scope()
    const { sprints, warnings } = await readSprints(context, field, key)
    const listed = sprints.filter((sprint) => state === undefined || sprint.state === state)
    // The warnings of two iterations on one start date ride on the list without entering its JSON.
    if (warnings.length > 0) Object.defineProperty(listed, 'warnings', { value: warnings, enumerable: false })
    return listed
  }

  async function currentCycle() {
    return (await listCycles({ state: 'active' }))[0] ?? null
  }

  async function cycleIssues(id) {
    const { context, field } = await scope()
    // An id that is not a date names no iteration, so it holds no issue, as an unknown sprint on Linear.
    if (!validDate(id)) return []
    // github.com and GHE.com filter the Project's items on GitHub (PMK-344). A sprint the cached discovery lacks, a title or field
    // name the filter cannot quote, and GHES read the repository through searchIssues, which refreshes the cache when it must.
    const sprint = sprintsOf(field.configuration, today()).sprints.find((item) => item.id === id)
    const quotable = sprint && !sprint.name.includes('"') && !/[\s"]/.test(field.name)
    if (context.features?.itemQuery === true && quotable) return ops.sprintIssues(sprint, field.name)
    return (await ops.searchIssues({ sprint: id })).issues
  }

  /** The checked { start, end, name } of an openCycle input. The default end needs the field's duration, so openCycle sets it after the read. */
  async function checkedOpen(input) {
    for (const key of Object.keys(input ?? {})) {
      if (!OPEN_KEYS.includes(key)) throw invalid(`unknown field "${key}"`, `Use one of: ${OPEN_KEYS.join(', ')}`)
    }
    const { start } = input
    if (!validDate(start)) throw invalid('start must be a date as YYYY-MM-DD')
    if (input.end !== undefined && !validDate(input.end)) throw invalid('end must be a date as YYYY-MM-DD')
    const name = input.name ?? `Sprint ${start}`
    if (typeof name !== 'string' || name.trim() === '') throw invalid('name must be a non-empty string')
    if (/[\r\n]/.test(name)) throw invalid('name must not contain a line break')
    return { start, end: input.end, name: name.trim() }
  }

  /**
   * Adds one iteration. GitHub replaces the whole configuration, so the update sends every completed and current iteration with its id,
   * and the Project's items keep their sprint. The memo of the discovery is reread afterwards, so a write of the new sprint resolves.
   */
  async function openCycle(input, actor, { dryRun = false } = {}) {
    await ops.requireActor(actor)
    if (typeof input?.goal === 'string' && input.goal.trim() !== '') throw new PmkitError('NOT_SUPPORTED', 'a GitHub iteration has no goal', 'Leave the goal out')
    const { context, field, key } = await scope()
    if (context.features?.iterationIds !== true) {
      throw new PmkitError('NOT_SUPPORTED', 'this GitHub host cannot keep the ids of the iterations when pmkit adds one', 'Add the iteration in the Project settings on GitHub')
    }
    const given = await checkedOpen(input)
    const { sprints, found } = await readSprints(context, field, key)
    const { configuration } = found
    const { start, name } = given
    const end = given.end ?? addDays(start, configuration.duration - 1)
    if (start > end) throw invalid(`start ${start} is after end ${end}`)
    if (sprints.some((sprint) => sprint.id === start)) throw invalid(`sprint ${start} already exists`, 'pmkit cycle list')
    const clash = sprints.find((sprint) => sprint.state !== 'closed' && overlaps(sprint, { start, end }))
    if (clash) throw invalid(`sprint ${start} to ${end} overlaps ${clash.id} (${clash.start} to ${clash.end})`, 'pmkit cycle list')
    const iterationConfiguration = appendIteration(configuration, { start, end, name })
    const added = iterationConfiguration.iterations.find((iteration) => iteration.startDate === start && iteration.id === undefined)
    if (dryRun) return { before: null, after: toSprint(added, { completed: false, today: today() }) }
    await client.request(UPDATE_ITERATIONS, { input: { fieldId: found.id, iterationConfiguration } })
    // The write is done. A failed reread leaves the old memo, and the next write of a new sprint refreshes it once on its own.
    await getContext({ refresh: true }).catch(() => {})
    const { sprints: after } = await readSprints(context, field, key)
    const created = after.find((sprint) => sprint.id === start)
    if (!created) throw new PmkitError('UPSTREAM', `GitHub accepted the iteration ${start} but the field does not list it`, 'pmkit cycle list')
    return { before: null, after: created }
  }

  async function closeCycle() {
    throw new PmkitError('NOT_SUPPORTED', 'GitHub ends an iteration on its end date', 'pmkit cycle add <ids> --to <next sprint>')
  }

  /**
   * `to` is a start date, 'current' for the active sprint, or null to take the issues out of their sprint. Every issue and the target
   * are checked first, so a bad id writes nothing, and a closed sprint is a target as on Local. Each issue then gets one item write, after an item add when it has no item.
   */
  async function moveToCycle(ids, to, actor, { dryRun = false } = {}) {
    await ops.requireActor(actor)
    if (!Array.isArray(ids) || ids.length === 0) throw invalid('ids must be a non-empty list')
    if (to !== null && typeof to !== 'string') throw invalid('to must be a sprint id, current or null')
    const { context, field, key } = await scope()
    let target = null
    if (to !== null) {
      const { sprints } = await readSprints(context, field, key)
      target = to === 'current' ? sprints.find((sprint) => sprint.state === 'active') : sprints.find((sprint) => sprint.id === to)
      if (to === 'current' && !target) throw invalid('there is no active sprint', 'pmkit cycle list')
      if (!target) throw notFound(to)
    }
    // Every issue is checked before the first write: the actor, the repository (the adapter writes the scope repository only) and the read.
    // Each read is used once, by the write of its issue; a repeated id reads again, after its first write.
    const reads = new Map()
    for (const id of ids) {
      await ops.writable(id, actor)
      reads.set(id, await ops.readNode(id))
    }
    const results = []
    const moved = []
    for (const id of ids) {
      const read = reads.get(id)
      reads.delete(id)
      try {
        results.push(await ops.updateIssue(id, { sprint: target?.id ?? null }, actor, { dryRun, read }))
      } catch (error) {
        throw stoppedHalfway(error, moved, 'GitHub')
      }
      const { before, after } = results.at(-1)
      if (before.sprint !== after.sprint) moved.push(after.id)
    }
    return results
  }

  async function readEntry(id) {
    const { context, field, key } = await scope()
    const { sprints } = await readSprints(context, field, key)
    return { sprint: requireSprint(sprints, id), key }
  }

  const getCapacity = async (id) => (await readEntry(id)).sprint.capacity
  const getDaysOff = async (id) => (await readEntry(id)).sprint.daysOff

  /** Capacity and days off live in .pmkit/capacity.yaml, so GitHub is not written and the actor check only keeps --as honest. */
  async function updateCycleCapacity(id, { capacity, capacityPatch, capacityBasePatch, daysOff } = {}, actor, { dryRun = false } = {}) {
    await ops.requireActor(actor)
    const { context, field, key } = await scope()
    const { sprints } = await readSprints(context, field, key)
    const sprint = requireSprint(sprints, id)
    // The members are the users GitHub can assign, and the viewer, who may be missing from that list.
    const members = [...new Set([context.raw.viewer?.login, ...(context.raw.users ?? []).map((user) => user.login)].filter(Boolean))]
    const { before, after } = writeEntry(config.root, key, id, { capacity, capacityPatch, capacityBasePatch, daysOff }, { sprint, members, dryRun })
    return { before: withEntry(sprint, before), after: withEntry(sprint, after) }
  }

  const setCapacity = (id, map, actor, options) => updateCycleCapacity(id, { capacity: map }, actor, options)

  return { listCycles, currentCycle, cycleIssues, openCycle, closeCycle, moveToCycle, getCapacity, getDaysOff, setCapacity, updateCycleCapacity }
}
