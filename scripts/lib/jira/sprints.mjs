// A Jira sprint as a pmkit sprint, and an issue's sprint. Pure except readBoardSprints, which only reads.
// See docs/superpowers/specs/2026-11-22-pmk-78-jira-sprints-design.md, "The sprint model" and "An issue's sprint", and ADR 0016.

import { baseField } from '../local/sprints.mjs'
import { TERMINAL } from '../model.mjs'
import { jiraTime } from './issues.mjs'

const SPRINT_ID = /^[1-9][0-9]*$/
const STATES = { future: 'planned', active: 'active', closed: 'closed' }

/** The Jira sprint id of a pmkit sprint id, or null when the id is not a positive whole number in a string. */
export const sprintKey = (id) => (typeof id === 'string' && SPRINT_ID.test(id) ? Number(id) : null)

/** The Jira timestamp pmkit writes for a date: noon UTC, so the date reads back the same. */
export const jiraDate = (date) => `${date}T12:00:00.000Z`

const dateOf = (timestamp) => (timestamp ? jiraTime(timestamp).slice(0, 10) : null)

/** The pmkit sprint of a Jira sprint. `entry` holds the capacity and days off kept in .pmkit/capacity.yaml. */
export function toSprint(sprint, entry = {}) {
  const state = STATES[sprint.state] ?? 'closed'
  return {
    id: String(sprint.id),
    name: sprint.name,
    start: dateOf(sprint.startDate),
    end: dateOf(sprint.endDate),
    goal: sprint.goal ?? '',
    state,
    ...(state === 'closed' && sprint.completeDate ? { closed: jiraTime(sprint.completeDate) } : {}),
    capacity: entry.capacity ?? {},
    daysOff: entry.daysOff ?? {},
    ...baseField(entry.capacityBase ?? {}),
  }
}

/** The sprints of one board: those whose origin board is it, or that name none. */
export const ofBoard = (sprints, boardId) => sprints.filter((sprint) => sprint.originBoardId === undefined || sprint.originBoardId === boardId)

const latestClosed = (a, b) => (Date.parse(b.completeDate) || 0) - (Date.parse(a.completeDate) || 0)

/** The pmkit sprint id of an issue from its Sprint field values (ADR 0016), or undefined when it has none on this board. */
export function sprintOf(values, category, boardId) {
  const own = (values ?? []).filter((value) => value.boardId === undefined || value.boardId === boardId)
  const open = own.find((value) => value.state === 'active') ?? own.find((value) => value.state === 'future')
  if (open) return String(open.id)
  if (!TERMINAL.includes(category)) return undefined
  const last = own.filter((value) => value.state === 'closed').sort(latestClosed)[0]
  return last ? String(last.id) : undefined
}

/** Every sprint of a board that belongs to it, in every state. */
export async function readBoardSprints(client, boardId) {
  const { items } = await client.paginate(`/rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint`, { query: { state: 'future,active,closed' }, maxPages: 100 })
  return ofBoard(items, boardId)
}
