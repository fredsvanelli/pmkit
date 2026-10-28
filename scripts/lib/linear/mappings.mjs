// Linear's side of the mappings: the description that scripts/lib/mappings.mjs reads, and resolveMappings, the reader that issue operations use.
// See docs/superpowers/specs/2026-10-27-pmk-34-ask-for-mappings-design.md, "The mappings contract" and "The generic description".

import { NONE } from '../mappings.mjs'
import { categoryOfType } from './discovery.mjs'

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
const byPosition = (a, b) => a.position - b.position

const IN_REVIEW = 'mappings.status.in_review'
const BLOCKED = 'mappings.status.blocked'
const ESTIMATE = 'mappings.fields.estimate'

/** The recommended value first, then the others in their order. */
const recommendedFirst = (names, recommended) => (names.includes(recommended) ? [recommended, ...names.filter((name) => name !== recommended)] : names)

/** The state names of a team in position order, for the states whose Linear type is in `types`. A state named like the reserved value is left out. */
const stateNames = (states, types) => states.filter((state) => types.includes(state.type) && state.name !== NONE).map((state) => state.name)

/**
 * The label names a team can use: its own labels first, then the workspace's, each part by name. Group labels,
 * labels named like the reserved value and a workspace label with a team label's name are left out.
 */
function labelsOf(raw, team) {
  const usable = raw.labels.filter((label) => !label.isGroup && label.name !== NONE)
  const own = usable.filter((label) => label.team === team.id).sort(byName).map((label) => label.name)
  const shared = usable.filter((label) => label.team === null).sort(byName).map((label) => label.name)
  return [...new Set([...own, ...shared])]
}

const inReviewPick = (names) => names.find((name) => name.toLowerCase() === 'in review') ?? names.find((name) => name.toLowerCase().includes('review')) ?? NONE
const blockedPick = (names) => names.find((name) => name.toLowerCase().includes('block')) ?? NONE

/**
 * The adapter-neutral description of the workspace, from the raw discovery.
 * view is the discover result, viewerId the id of the user who owns the key (or null), types the repository's pmkit type list.
 */
export function linearDescription(raw, view, viewerId, types = []) {
  const viewer = raw.users.find((user) => user.id === viewerId)
  const viewerTeams = viewer ? raw.teams.filter((team) => viewer.teams.includes(team.id)).map((team) => team.key) : []
  const teams = raw.teams.map((team) => {
    const states = raw.states.filter((state) => state.team === team.id).sort(byPosition)
    const started = stateNames(states, ['started'])
    const inReview = started.length > 1 ? started : []
    const blocked = stateNames(states, ['backlog', 'unstarted', 'started'])
    const labels = labelsOf(raw, team)
    const estimates = team.estimation.type !== 'notUsed'

    const candidates = {
      [IN_REVIEW]: recommendedFirst(inReview, inReviewPick(inReview)),
      [BLOCKED]: recommendedFirst(blocked, blockedPick(blocked)),
      [ESTIMATE]: estimates ? ['native'] : [],
    }
    const recommended = { [IN_REVIEW]: inReviewPick(inReview), [BLOCKED]: blockedPick(blocked), [ESTIMATE]: estimates ? 'native' : NONE }
    for (const type of types) {
      const same = labels.find((name) => name.toLowerCase() === type.toLowerCase())
      candidates[`mappings.types.${type}`] = recommendedFirst(labels, same)
      recommended[`mappings.types.${type}`] = same ?? NONE
    }

    const stateExists = (name) => name !== NONE && states.some((state) => state.name === name)
    return {
      key: team.key,
      name: team.name,
      statuses: states.map((state) => ({ name: state.name, category: categoryOfType(state.type), type: state.type, position: state.position })),
      candidates,
      recommended,
      notes: { [ESTIMATE]: `team ${team.key} has estimates off; turn them on in the team's settings in Linear and run setup again` },
      exists(path, value) {
        if (path.startsWith('mappings.status.')) return stateExists(value)
        if (path === ESTIMATE) return value === 'native' && estimates
        if (path.startsWith('mappings.types.')) return labels.includes(value)
        return true
      },
      problem(path, value) {
        if (path === ESTIMATE) return `${path} is ${value}, but team ${team.key} has estimates off`
        if (path.startsWith('mappings.types.')) return `${path} names ${value}, which is neither a label of team ${team.key} nor of the workspace`
        return undefined
      },
    }
  })
  return { workspace: { ...view.workspace }, viewerTeams, types: [...types], teams }
}
