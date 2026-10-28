// Linear triage rotation and Triage Intelligence suggestions: the queries, the views and createTriage.
// See docs/superpowers/specs/2026-10-27-pmk-43-linear-triage-rotation-design.md.

import { PmkitError } from '../errors.mjs'
import { BUSINESS_PLANS } from './manifest.mjs'

const PLAN_HINT = 'Triage responsibility needs the Business or Enterprise plan'
const TRIAGE_OFF_HINT = "Turn on triage in the team's settings in Linear"

/**
 * Whether triage rotation and Triage Intelligence can work for a team. raw is the cached discovery, team one of its teams.
 * The plan is checked first: a live read passes on Free and proves nothing.
 */
export function triageAvailability(raw, team) {
  const plan = raw.workspace.plan
  if (!BUSINESS_PLANS.includes(plan)) return { available: false, reason: 'plan', plan, enableHint: PLAN_HINT }
  if (team.triageEnabled !== true) return { available: false, reason: 'triage_off', plan, enableHint: TRIAGE_OFF_HINT }
  return { available: true }
}

const UNKNOWN_USER = '(unknown user)'

/** The duty shape of a TriageResponsibility node (or null) and the warnings found while building it. raw.users gives the names. */
export function dutyView(node, raw) {
  const warnings = []
  if (!node) return { duty: { action: null, source: 'none', current: null, members: [], schedule: null }, warnings }
  const names = new Map((raw.users ?? []).map((user) => [user.id, user.name]))
  const person = (user) => (user ? { id: user.id, name: user.name } : null)
  let source = 'none'
  let members = []
  let schedule = null
  if (node.timeSchedule) {
    source = 'schedule'
    const service = node.timeSchedule.integration?.service
    const provider = typeof service === 'string' && service !== '' ? service.toLowerCase() : 'linear'
    schedule = { id: node.timeSchedule.id, name: node.timeSchedule.name, provider, url: node.timeSchedule.externalUrl ?? null }
  } else if (node.manualSelection) {
    source = 'manual'
    members = (node.manualSelection.userIds ?? []).map((id) => {
      if (names.has(id)) return { id, name: names.get(id) }
      warnings.push(`user ${id} is in the rotation but Linear no longer returns it`)
      return { id, name: UNKNOWN_USER }
    })
  }
  return { duty: { action: node.action ?? null, source, current: person(node.currentUser), members, schedule }, warnings }
}

/** The plain text of a duty view. */
export function dutyText(team, duty) {
  if (duty.source === 'none') return `team: ${team}\nnobody is on triage duty`
  const lines = [`team: ${team}`, `action: ${duty.action}`, `source: ${duty.source}`, `on duty: ${duty.current?.name ?? '(nobody)'}`]
  if (duty.source === 'schedule') lines.push(`schedule: ${duty.schedule.name} (${duty.schedule.provider})`)
  else lines.push(`rotation: ${duty.members.map((member) => (member.id === duty.current?.id ? `${member.name} (current)` : member.name)).join(', ')}`)
  return lines.join('\n')
}

const TARGETS = {
  team: (node) => node.suggestedTeam && { id: node.suggestedTeam.id, name: node.suggestedTeam.key ?? node.suggestedTeam.name },
  project: (node) => node.suggestedProject && { id: node.suggestedProject.id, name: node.suggestedProject.name },
  assignee: (node) => node.suggestedUser && { id: node.suggestedUser.id, name: node.suggestedUser.name },
  label: (node) => node.suggestedLabel && { id: node.suggestedLabel.id, name: node.suggestedLabel.name },
  similarIssue: (node) => node.suggestedIssue && { id: node.suggestedIssue.identifier, name: node.suggestedIssue.title },
}
TARGETS.relatedIssue = TARGETS.similarIssue

function suggestionOf(node) {
  const reasons = node.presentedReasons ?? node.metadata?.reasons ?? []
  return { type: node.type, target: TARGETS[node.type]?.(node) ?? null, score: node.metadata?.score ?? null, reasons }
}

/** The active suggestions per issue, in input order, and how many issues have none. nodes are the issues of the inbox query. */
export function suggestionsView(nodes) {
  const issues = []
  let withoutSuggestions = 0
  for (const node of nodes) {
    const active = (node.suggestions?.nodes ?? []).filter((item) => item.state === undefined || item.state === 'active')
    if (active.length === 0) withoutSuggestions += 1
    else issues.push({ id: node.identifier, title: node.title, suggestions: active.map(suggestionOf) })
  }
  return { issues, withoutSuggestions }
}

const TYPE_LABEL = { similarIssue: 'similar issue', relatedIssue: 'related issue' }

/** The plain text of a suggestions view. */
export function suggestionsText(view) {
  if (view.issues.length === 0) {
    if (view.withoutSuggestions === 0) return 'no issue is waiting in triage'
    return `no active suggestions for ${view.withoutSuggestions} ${view.withoutSuggestions === 1 ? 'issue' : 'issues'} in triage`
  }
  const lines = []
  for (const issue of view.issues) {
    lines.push(`${issue.id}  ${issue.title}`)
    for (const item of issue.suggestions) {
      const score = item.score === null ? '' : ` (score ${item.score})`
      const name = item.type in TYPE_LABEL ? item.target?.id : item.target?.name
      lines.push(`  ${TYPE_LABEL[item.type] ?? item.type} ${name ?? '(unknown)'}${score}`)
    }
  }
  lines.push('These are suggestions from Linear. Apply one with a normal issue edit.')
  return lines.join('\n')
}

const RESPONSIBILITY_FIELDS = 'id action manualSelection { userIds assignmentIndex } timeSchedule { id name externalUrl integration { service } } currentUser { id name }'
export const SHOW_QUERY = `query PmkitTriageShow($teamId: String!) { team(id: $teamId) { triageResponsibility { ${RESPONSIBILITY_FIELDS} } } }`

const SUGGESTION_FIELDS =
  'type state metadata { score reasons } presentedReasons suggestedTeam { id key name } suggestedProject { id name } suggestedUser { id name } suggestedLabel { id name } suggestedIssue { id identifier title }'
export const SUGGESTIONS_QUERY = `query PmkitTriageSuggestions($first: Int!, $after: String, $teamKey: String!) { issues(first: $first, after: $after, orderBy: createdAt, filter: { team: { key: { eq: $teamKey } }, state: { type: { eq: "triage" } } }) { nodes { identifier title createdAt suggestions(filter: { state: { eq: active } }) { nodes { ${SUGGESTION_FIELDS} } } } pageInfo { hasNextPage endCursor } } }`

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

/** The --limit value: 25 by default, at most 100. A larger value is clamped with a warning. */
function parseLimit(value, warnings) {
  if (value === undefined) return DEFAULT_LIMIT
  const number = Number(value)
  if (typeof value !== 'string' || !/^\d+$/.test(value) || number < 1) {
    throw new PmkitError('INVALID_INPUT', `--limit takes a whole number of at least 1, got "${value}"`, 'Pass --limit 25')
  }
  if (number > MAX_LIMIT) {
    warnings.push(`--limit ${number} is above ${MAX_LIMIT}; using ${MAX_LIMIT}`)
    return MAX_LIMIT
  }
  return number
}

/** The team a command works on: --team, then tracker.scope.team, then the only team of the workspace. */
export function chooseTeam(raw, flag, config) {
  const keys = raw.teams.map((team) => team.key)
  const wanted = flag ?? config.pmkit?.tracker?.scope?.team
  if (wanted !== undefined) {
    const found = raw.teams.find((team) => team.key === wanted)
    if (!found) throw new PmkitError('INVALID_INPUT', `no team has the key ${wanted}`, `Use one of: ${keys.join(', ')}`)
    return found
  }
  if (raw.teams.length === 1) return raw.teams[0]
  throw new PmkitError('INVALID_INPUT', raw.teams.length === 0 ? 'the workspace has no team' : 'several teams exist and none is chosen', `Pass --team with one of: ${keys.join(', ')}`)
}

function unavailable(team, availability) {
  const { reason, plan, enableHint } = availability
  return {
    data: { available: false, reason, plan, team: team.key, enableHint },
    text: `triage rotation: unavailable\nreason: ${reason}\nplan: ${plan}\nenable: ${enableHint}`,
  }
}

/**
 * The triage operations of the Linear tracker. discovery is the tracker's cached discovery, client the Linear client.
 * Every method returns { data, text, warnings? }, the shape a command returns.
 */
export function createTriage({ client, discovery, config }) {
  async function context(flag) {
    const { raw, warnings } = await discovery()
    const team = chooseTeam(raw, flag, config)
    return { raw, team, warnings, availability: triageAvailability(raw, team) }
  }

  async function readDuty(raw, team) {
    const data = await client.request(SHOW_QUERY, { teamId: team.id })
    return { node: data?.team?.triageResponsibility ?? null, ...dutyView(data?.team?.triageResponsibility ?? null, raw) }
  }

  async function show({ team: flag } = {}) {
    const { raw, team, warnings, availability } = await context(flag)
    if (!availability.available) return { ...unavailable(team, availability), warnings }
    const view = await readDuty(raw, team)
    return {
      data: { available: true, team: team.key, duty: view.duty },
      text: dutyText(team.key, view.duty),
      warnings: [...warnings, ...view.warnings],
    }
  }

  async function suggestions({ team: flag, limit: limitFlag } = {}) {
    const { team, warnings, availability } = await context(flag)
    if (!availability.available) return { ...unavailable(team, availability), warnings }
    const all = [...warnings]
    const limit = parseLimit(limitFlag, all)
    const found = await client.paginate(SUGGESTIONS_QUERY, { teamKey: team.key }, { select: (data) => data.issues, pageSize: limit, limit })
    // Linear returns the newest first; the list reads oldest first.
    const nodes = [...found.nodes].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
    if (found.hasMore) all.push(`more issues are waiting in triage than --limit ${limit} shows; the newest ${limit} are listed`)
    const view = suggestionsView(nodes)
    return { data: { available: true, team: team.key, ...view }, text: suggestionsText(view), warnings: all }
  }

  return Object.freeze({ show, suggestions })
}
