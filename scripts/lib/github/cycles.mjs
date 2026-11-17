// Maps GitHub Project iterations to pmkit sprints. Pure: the caller passes today and the capacity entry.

import { addDays } from '../local/sprints.mjs'

const FIELDS = 'id title startDate duration'
const CONFIGURATION = `configuration { duration startDay iterations { ${FIELDS} } completedIterations { ${FIELDS} } }`

export const ITERATION_FIELD_QUERY = `query PmkitIterationField($project: ID!, $field: String!) { node(id: $project) { ... on ProjectV2 { field(name: $field) { ... on ProjectV2IterationField { id ${CONFIGURATION} } } } } }`

export const UPDATE_ITERATIONS = `mutation PmkitUpdateIterations($input: UpdateProjectV2FieldInput!) { updateProjectV2Field(input: $input) { projectV2Field { ... on ProjectV2IterationField { id ${CONFIGURATION} } } } }`

const byStart = (a, b) => a.startDate.localeCompare(b.startDate)

/** The last day of an iteration: GitHub counts the start day in the duration. */
export const iterationEnd = (iteration) => addDays(iteration.startDate, iteration.duration - 1)

/** A completed iteration is closed; otherwise the dates decide, comparing YYYY-MM-DD text. */
export function iterationState(iteration, { completed, today }) {
  if (completed) return 'closed'
  if (today < iteration.startDate) return 'planned'
  return today <= iterationEnd(iteration) ? 'active' : 'closed'
}

export const toSprint = (iteration, { completed, today, entry = { capacity: {}, daysOff: {} } }) => ({
  id: iteration.startDate,
  name: iteration.title,
  start: iteration.startDate,
  end: iterationEnd(iteration),
  goal: '',
  state: iterationState(iteration, { completed, today }),
  capacity: entry.capacity ?? {},
  daysOff: entry.daysOff ?? {},
})

/** Every iteration of a field as a sprint, in start order. A repeated start date keeps the first iteration and warns. */
export function sprintsOf(configuration, today) {
  const all = [
    ...(configuration?.completedIterations ?? []).map((iteration) => ({ iteration, completed: true })),
    ...(configuration?.iterations ?? []).map((iteration) => ({ iteration, completed: false })),
  ].sort((a, b) => byStart(a.iteration, b.iteration))
  const sprints = []
  const warnings = []
  const seen = new Set()
  for (const { iteration, completed } of all) {
    if (seen.has(iteration.startDate)) {
      warnings.push(`two iterations start on ${iteration.startDate}; pmkit shows the first`)
      continue
    }
    seen.add(iteration.startDate)
    sprints.push(toSprint(iteration, { completed, today }))
  }
  return { sprints, warnings }
}

/** The iterationConfiguration input that adds one iteration. GitHub replaces the whole configuration, so it keeps every completed and current one. */
export function appendIteration(configuration, { start, end, name }) {
  const keep = ({ id, title, startDate, duration }) => ({ id, title, startDate, duration })
  const added = { title: name, startDate: start, duration: Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1 }
  const iterations = [...(configuration.completedIterations ?? []).map(keep), ...(configuration.iterations ?? []).map(keep), added].sort(byStart)
  return { startDate: iterations[0].startDate, duration: configuration.duration, iterations }
}
