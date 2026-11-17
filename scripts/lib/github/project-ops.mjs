// The Milestones family of the GitHub adapter: a milestone is a milestone of the scope repository, and its title is its id.
// The Deliverables operations join this object in the same file. See the spec, "Milestones".

import { PmkitError } from '../errors.mjs'
import { sortMilestones } from '../local/milestones.mjs'
import { validDate } from '../local/sprints.mjs'
import { readMilestoneNodes, toMilestone } from './projects.mjs'

const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
const taken = (title) => new PmkitError('CONFLICT', `GitHub already has a milestone titled ${title}`, 'pmkit milestone list')
const CREATE_KEYS = ['id', 'name', 'due']
const blank = (value) => value === undefined || value === null || value === ''

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

  /** The REST body of a create input, checked before any request. */
  function bodyOf(input) {
    for (const key of Object.keys(input)) {
      if (!CREATE_KEYS.includes(key)) throw invalid(`unknown field "${key}"`, `Use one of: ${CREATE_KEYS.join(', ')}`)
    }
    const { id } = input
    if (typeof id !== 'string' || id.trim() === '' || /[\r\n]/.test(id)) throw invalid('a milestone id is its title, a non-empty line of text', 'Use an id like v1.0')
    if (!blank(input.name) && input.name !== id) throw invalid('a GitHub milestone has one name, its title', 'Pass only the id, which becomes the title')
    if (!blank(input.due) && !validDate(input.due)) throw invalid('due must be a date as YYYY-MM-DD')
    return { title: id, ...(blank(input.due) ? {} : { due_on: `${input.due}T00:00:00Z` }) }
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

  return { listMilestones, getMilestone, createMilestone }
}
