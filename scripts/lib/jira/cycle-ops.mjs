// The Cycles and Capacity families of the Jira adapter. A sprint is a Jira sprint of the space's Scrum board, and its id is the
// Jira sprint id. Capacity lives in .pmkit/capacity.yaml, as on Linear and GitHub, under the key jira:<site>/<board id>.
// See docs/superpowers/specs/2026-11-22-pmk-78-jira-sprints-design.md, "Operations (`cycle-ops.mjs`)".

import { entryFor, readCapacity, writeEntry } from '../capacity-store.mjs'
import { builtInDefaults } from '../config.mjs'
import { checkMoveInput, moveTargetIn, stoppedHalfway } from '../cycle-moves.mjs'
import { PmkitError } from '../errors.mjs'
import { addDays, baseField, overlaps, SPRINT_STATES, validDate } from '../local/sprints.mjs'
import { TERMINAL } from '../model.mjs'
import { buildJiraCapabilities } from './manifest.mjs'
import { jiraDate, readBoardSprints, sprintKey, toSprint } from './sprints.mjs'

const AGILE = '/rest/agile/1.0'
const OPEN_KEYS = ['start', 'end', 'goal', 'name']

const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
const notFound = (id) => new PmkitError('NOT_FOUND', `sprint ${id} does not exist`, 'pmkit cycle list')
/** The sprint with another capacity entry, in the shape listCycles returns. */
const withEntry = ({ capacityBase: _base, ...sprint }, entry) => ({ ...sprint, capacity: entry.capacity ?? {}, daysOff: entry.daysOff ?? {}, ...baseField(entry.capacityBase ?? {}) })
const sprintPath = (id) => `${AGILE}/sprint/${encodeURIComponent(id)}`

/**
 * The cycle operations over one client. `ops` is issueOperations(...), which supplies the actor check and the issue reads and writes.
 * getContext() is the tracker's. `now` is the clock; its UTC date decides whether a new sprint starts. config.root holds .pmkit/capacity.yaml.
 */
export function cycleOperations({ client, ops, config, getContext, now = () => new Date() }) {
  const today = () => now().toISOString().slice(0, 10)

  /** The context, the board and the capacity key: every cycle operation starts here. A space the manifest gives no sprints is NOT_SUPPORTED with its hint. */
  async function scope() {
    const context = await getContext()
    const entry = buildJiraCapabilities(context.raw, config.pmkit).find((candidate) => candidate.id === 'cycles')
    if (entry.path === 'absent') throw new PmkitError('NOT_SUPPORTED', entry.enableHint, entry.enableHint)
    return { context, boardId: context.boardId, key: `jira:${context.raw.site}/${context.boardId}` }
  }

  /** Every sprint of the board with its capacity entry, in id order, which is Jira's creation order. */
  async function readSprints({ boardId, key }) {
    const raw = await readBoardSprints(client, boardId)
    const entries = readCapacity(config.root, key)
    return raw.sort((a, b) => a.id - b.id).map((sprint) => toSprint(sprint, entryFor(entries, String(sprint.id))))
  }

  const requireSprint = (sprints, id) => sprints.find((sprint) => sprint.id === id) ?? (() => { throw notFound(id) })()

  async function listCycles({ state } = {}) {
    if (state !== undefined && !SPRINT_STATES.includes(state)) throw invalid(`state must be one of ${SPRINT_STATES.join(', ')}`)
    const sprints = await readSprints(await scope())
    return sprints.filter((sprint) => state === undefined || sprint.state === state)
  }

  async function currentCycle() {
    return (await listCycles({ state: 'active' }))[0] ?? null
  }

  async function cycleIssues(id) {
    const found = await scope()
    if (sprintKey(id) === null) throw notFound(id)
    requireSprint(await readSprints(found), id)
    return (await ops.searchIssues({ sprint: id })).issues
  }

  /** The checked { start, end, name, goal } of an openCycle input, with Local's checks and messages. */
  function checkedOpen(given) {
    const input = given ?? {}
    for (const key of Object.keys(input)) {
      if (!OPEN_KEYS.includes(key)) throw invalid(`unknown field "${key}"`, `Use one of: ${OPEN_KEYS.join(', ')}`)
    }
    const { start } = input
    if (!validDate(start)) throw invalid('start must be a date as YYYY-MM-DD')
    const end = input.end ?? addDays(start, builtInDefaults().sprint_length_days - 1)
    if (!validDate(end)) throw invalid('end must be a date as YYYY-MM-DD')
    if (start > end) throw invalid(`start ${start} is after end ${end}`)
    const name = input.name ?? `Sprint ${start}`
    if (typeof name !== 'string' || name.trim() === '') throw invalid('name must be a non-empty string')
    if (/[\r\n]/.test(name)) throw invalid('name must not contain a line break')
    const goal = input.goal ?? ''
    if (typeof goal !== 'string') throw invalid('goal must be a string')
    if (/[\r\n]/.test(goal)) throw invalid('goal must not contain a line break')
    return { start, end, name: name.trim(), goal }
  }

  /**
   * Creates a future sprint on the board, then starts it when it starts today or earlier and no sprint is active, as Local opens it.
   * Only dated sprints that are not closed can overlap: Jira holds sprints without dates.
   */
  async function openCycle(input, actor, { dryRun = false } = {}) {
    await ops.requireActor(actor)
    const found = await scope()
    const { start, end, name, goal } = checkedOpen(input)
    const sprints = await readSprints(found)
    const clash = sprints.find((sprint) => sprint.state !== 'closed' && sprint.start !== null && sprint.end !== null && overlaps(sprint, { start, end }))
    if (clash) throw invalid(`sprint ${start} to ${end} overlaps ${clash.id} (${clash.start} to ${clash.end})`, 'pmkit cycle list')
    const state = start <= today() && !sprints.some((sprint) => sprint.state === 'active') ? 'active' : 'planned'
    if (dryRun) return { before: null, after: { id: null, name, start, end, goal, state, capacity: {}, daysOff: {} } }
    const created = await client.request('POST', `${AGILE}/sprint`, { body: { name, originBoardId: found.boardId, startDate: jiraDate(start), endDate: jiraDate(end), goal } })
    const id = String(created.id)
    if (state === 'active') {
      try {
        await client.request('POST', sprintPath(id), { body: { state: 'active' } })
      } catch (error) {
        throw new PmkitError('UPSTREAM', `Jira created sprint ${id}, but starting it failed: ${error.message}`, 'Start the sprint on the board in Jira', { created: id })
      }
    }
    return { before: null, after: toSprint(await client.request('GET', sprintPath(id))) }
  }

  /** Closes the active sprint. Its unfinished issues are read before the close, which moves them out of the sprint on the board. */
  async function closeCycle(id, actor, { dryRun = false } = {}) {
    await ops.requireActor(actor)
    const found = await scope()
    const before = requireSprint(await readSprints(found), id)
    if (before.state !== 'active') throw invalid(`sprint ${id} is not active (it is ${before.state})`, 'pmkit cycle list')
    const unfinished = (await ops.searchIssues({ sprint: id })).issues.filter((issue) => !TERMINAL.includes(issue.status.category))
    if (dryRun) return { sprint: { ...before, state: 'closed', closed: now().toISOString() }, unfinished, problems: [] }
    await client.request('POST', sprintPath(id), { body: { state: 'closed' } })
    const entry = entryFor(readCapacity(config.root, found.key), id)
    return { sprint: toSprint(await client.request('GET', sprintPath(id)), entry), unfinished, problems: [] }
  }

  /**
   * `to` is a sprint id, 'current' for the active sprint, or null to take the issues out of their sprint. The actor, the input, the
   * target and every issue are checked before the first write, so a bad id writes nothing; each issue then gets one updateIssue.
   */
  async function moveToCycle(ids, to, actor, { dryRun = false } = {}) {
    await ops.requireActor(actor)
    checkMoveInput(ids, to)
    const found = await scope()
    // The board's sprints are read once here and handed to every updateIssue, so N issues read them once.
    const raw = to === null ? [] : await readBoardSprints(client, found.boardId)
    const target = to === null ? null : moveTargetIn(raw.map((sprint) => toSprint(sprint)), to)
    for (const id of ids) await ops.readItem(id)
    const results = []
    const moved = []
    // ponytail: one Agile move per issue; batch 50 keys per call if large scopes get slow
    for (const id of ids) {
      try {
        results.push(await ops.updateIssue(id, { sprint: target?.id ?? null }, actor, { dryRun, sprints: raw }))
      } catch (error) {
        throw stoppedHalfway(error, moved, 'Jira')
      }
      const { before, after } = results.at(-1)
      if (before.sprint !== after.sprint) moved.push(after.id)
    }
    return results
  }

  async function readEntry(id) {
    const found = await scope()
    return { found, sprint: requireSprint(await readSprints(found), id) }
  }

  const getCapacity = async (id) => (await readEntry(id)).sprint.capacity
  const getDaysOff = async (id) => (await readEntry(id)).sprint.daysOff

  /** Capacity and days off live in .pmkit/capacity.yaml, so Jira is not written and the actor check only keeps --as honest. */
  async function updateCycleCapacity(id, { capacity, capacityPatch, capacityBasePatch, daysOff } = {}, actor, { dryRun = false } = {}) {
    await ops.requireActor(actor)
    const { found, sprint } = await readEntry(id)
    // Days off are checked against the sprint's dates, which a Jira sprint may lack; its capacity needs none.
    if (daysOff !== undefined && sprint.start === null) throw invalid(`sprint ${id} has no dates in Jira`, "Set the sprint's dates in Jira")
    const members = found.context.view.members.map((member) => member.id)
    const { before, after } = writeEntry(config.root, found.key, id, { capacity, capacityPatch, capacityBasePatch, daysOff }, { sprint, members, dryRun })
    return { before: withEntry(sprint, before), after: withEntry(sprint, after) }
  }

  const setCapacity = (id, map, actor, options) => updateCycleCapacity(id, { capacity: map }, actor, options)

  return { listCycles, currentCycle, cycleIssues, openCycle, closeCycle, moveToCycle, getCapacity, getDaysOff, setCapacity, updateCycleCapacity }
}
