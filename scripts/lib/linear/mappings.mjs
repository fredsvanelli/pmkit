// Linear's side of the mappings: the description that scripts/lib/mappings.mjs reads, and resolveMappings, the reader that issue operations use.
// See docs/superpowers/specs/2026-10-27-pmk-34-ask-for-mappings-design.md, "The mappings contract" and "The generic description".

import { PmkitError } from '../errors.mjs'
import { NONE } from '../mappings.mjs'
import { CATEGORIES } from '../model.mjs'
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
    // Setup asks for no other category, but a hand-written one that broke is asked again, and any state can take it (rule 1).
    const all = stateNames(states, states.map((state) => state.type))
    for (const category of CATEGORIES) if (category !== 'in_review') candidates[`mappings.status.${category}`] = all
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

const pick = ({ id, name }) => ({ id, name })

/**
 * How issue operations read .pmkit/config.yaml for Linear. Call this instead of reading `mappings` yourself.
 * Call it after the tracker's mapping check, so every name the config holds exists in the workspace.
 *
 * `view` is the result of discoveryView (the tracker's discover()). It carries the raw discovery, which holds the Linear ids,
 * as a hidden property; pass the raw discovery as the third argument when the view was copied. `pmkit` is config.pmkit.
 *
 * Returns, for the configured team:
 *   team            the team key
 *   categoryOf(stateName)   the category of a state of the team, or null for a name the team lacks.
 *                   Rule 1: a state named by mappings.status.<category> takes that category; every other state takes
 *                   the category of its Linear type. blocked and none never change a category.
 *   targetState(category)   { id, name } of the state a move to `category` sets. Rule 2: the state mappings.status.<category>
 *                   names, else the first state of the team by position in that category, else null. A null target is a
 *                   NOT_SUPPORTED error for the caller: `team ACME has no status in the in_review category`, next step /pmkit:setup.
 *   blockedState    { id, name } of the state mappings.status.blocked names, or null. Rule 3: an issue in this state is blocked,
 *                   and the state keeps the category of its type.
 *   estimate        'native' when mappings.fields.estimate is native and the team uses estimates, else null. Rule 4: null gives
 *                   estimate: null on every issue. An absent key and none both mean "no estimate".
 *   types           { [pmkitType]: { id, name } } for each type in mappings.types that has a label. Empty without mappings.types.
 *   typeOf(labelNames)      the pmkit type of an issue that carries these label names, or null. Rule 5: when labels of two
 *                   types are present, the type that comes first in mappings.types wins; setup writes that object in the
 *                   repository's type order. A team label wins over a workspace label with the same name.
 */
export function resolveMappings(view, pmkit, raw = view?.raw) {
  if (!raw) throw new TypeError('resolveMappings needs the discovery view or the raw discovery')
  const key = pmkit?.tracker?.scope?.team
  const team = raw.teams.find((item) => item.key === key)
  if (!team) throw new PmkitError('NOT_CONFIGURED', 'tracker.scope.team is not set in .pmkit/config.yaml', '/pmkit:setup')
  const mappings = pmkit?.mappings ?? {}
  const states = raw.states.filter((state) => state.team === team.id).sort(byPosition)
  const mapped = new Map(
    Object.entries(mappings.status ?? {}).filter(([category, name]) => category !== 'blocked' && typeof name === 'string' && name !== NONE).map(([category, name]) => [name, category]),
  )
  const categoryOfState = (state) => mapped.get(state.name) ?? categoryOfType(state.type) ?? 'in_progress'
  const stateNamed = (name) => (typeof name === 'string' && name !== NONE ? states.find((state) => state.name === name) : undefined)

  const blocked = stateNamed(mappings.status?.blocked)
  const label = (name) =>
    raw.labels.find((item) => !item.isGroup && item.name === name && item.team === team.id) ?? raw.labels.find((item) => !item.isGroup && item.name === name && item.team === null)
  const types = {}
  for (const [type, name] of Object.entries(mappings.types ?? {})) {
    const found = typeof name === 'string' ? label(name) : undefined
    if (found) types[type] = pick(found)
  }
  return {
    team: team.key,
    categoryOf: (name) => {
      const state = states.find((item) => item.name === name)
      return state ? categoryOfState(state) : null
    },
    targetState: (category) => {
      const named = stateNamed(mappings.status?.[category])
      // States of type duplicate come last, so a plain move to canceled never marks an issue Duplicate without a duplicate link.
      const candidates = states.filter((state) => categoryOfState(state) === category)
      const found = named ?? candidates.find((state) => state.type !== 'duplicate') ?? candidates[0]
      return found ? pick(found) : null
    },
    blockedState: blocked ? pick(blocked) : null,
    estimate: mappings.fields?.estimate === 'native' && team.estimation.type !== 'notUsed' ? 'native' : null,
    types,
    typeOf: (labelNames) => {
      const names = new Set(labelNames)
      return Object.keys(types).find((type) => names.has(types[type].name)) ?? null
    },
  }
}
