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

/** The lines of a duty view without the team line. */
function dutyLines(duty) {
  if (duty.source === 'none') return ['nobody is on triage duty']
  const lines = [`action: ${duty.action}`, `source: ${duty.source}`, `on duty: ${duty.current?.name ?? '(nobody)'}`]
  if (duty.source === 'schedule') lines.push(`schedule: ${duty.schedule.name} (${duty.schedule.provider})`)
  else lines.push(`rotation: ${duty.members.map((member) => (member.id === duty.current?.id ? `${member.name} (current)` : member.name)).join(', ')}`)
  return lines
}

/** The plain text of a duty view. */
export function dutyText(team, duty) {
  return [`team: ${team}`, ...dutyLines(duty)].join('\n')
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

const ACTIONS = ['assign', 'notify']
const bad = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)

/**
 * What `set` has to do, from the current TriageResponsibility node (or null), the flags and the ids of the team's members.
 * Returns { kind: 'create' | 'update' | 'delete' | 'none', id?, input? }. The create input has no teamId; set adds it.
 */
export function planChange(current, flags, memberIds) {
  const { members, action, off } = flags
  if (off === true) {
    if (members !== undefined || action !== undefined) throw bad('--off cannot be combined with --members or --action', 'Run set --off alone')
    return current ? { kind: 'delete', id: current.id } : { kind: 'none' }
  }
  if (members === undefined && action === undefined) throw bad('set needs --members, --action or --off', 'Pass at least one of them')
  if (action !== undefined && !ACTIONS.includes(action)) throw bad(`--action takes assign or notify, got "${action}"`, 'Pass --action assign or --action notify')
  if (members === undefined) {
    if (!current) throw bad('the team has no triage responsibility, so there is nobody to assign or notify', 'Pass --members with the ids from pmkit discover')
    return { kind: 'update', id: current.id, input: { action } }
  }
  if (typeof members !== 'string') throw bad('--members needs a comma-separated list of member ids', 'Pass --members with the ids from pmkit discover')
  const ids = [...new Set(members.split(',').map((id) => id.trim()).filter((id) => id !== ''))]
  if (ids.length === 0) throw bad('--members is empty', 'Pass --members with the ids from pmkit discover')
  const outside = ids.filter((id) => !memberIds.includes(id))
  if (outside.length > 0) throw bad(`not a member of the team: ${outside.join(', ')}`, 'Use the member ids from pmkit discover')
  if (current?.timeSchedule) {
    throw new PmkitError('CONFLICT', 'the rotation comes from a schedule, and pmkit does not edit schedules', `Change the schedule "${current.timeSchedule.name}" in Linear, or run set --off`)
  }
  const index = current?.currentUser ? ids.indexOf(current.currentUser.id) : -1
  const manualSelection = { userIds: ids, assignmentIndex: Math.max(index, 0) }
  if (!current) return { kind: 'create', input: { action: action ?? 'assign', manualSelection } }
  return { kind: 'update', id: current.id, input: { manualSelection, ...(action === undefined ? {} : { action }) } }
}

/** The node a plan would leave behind, for a dry run. names come from raw.users. */
function projected(current, plan, raw) {
  if (plan.kind === 'none' || plan.kind === 'delete') return null
  const selection = plan.input.manualSelection ?? current?.manualSelection ?? null
  const id = selection?.userIds[selection.assignmentIndex ?? 0]
  const named = raw.users.find((user) => user.id === id)
  return {
    id: plan.id ?? 'new',
    action: plan.input.action ?? current?.action ?? 'assign',
    manualSelection: plan.input.manualSelection ? selection : (current?.manualSelection ?? null),
    timeSchedule: plan.input.manualSelection ? null : (current?.timeSchedule ?? null),
    currentUser: plan.input.manualSelection ? (named ? { id: named.id, name: named.name } : null) : (current?.currentUser ?? null),
  }
}

const PAYLOAD = `success triageResponsibility { ${RESPONSIBILITY_FIELDS} }`
export const CREATE_MUTATION = `mutation PmkitTriageCreate($input: TriageResponsibilityCreateInput!) { triageResponsibilityCreate(input: $input) { ${PAYLOAD} } }`
export const UPDATE_MUTATION = `mutation PmkitTriageUpdate($id: String!, $input: TriageResponsibilityUpdateInput!) { triageResponsibilityUpdate(id: $id, input: $input) { ${PAYLOAD} } }`
export const DELETE_MUTATION = 'mutation PmkitTriageDelete($id: String!) { triageResponsibilityDelete(id: $id) { success } }'

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

  async function set({ team: flag, members, action, off, dryRun = false } = {}) {
    const { raw, team, warnings, availability } = await context(flag)
    if (!availability.available) {
      const why = availability.reason === 'plan' ? `plan ${availability.plan}` : `triage is off for team ${team.key}`
      throw new PmkitError('NOT_SUPPORTED', `triage rotation is unavailable on this workspace (${why})`, availability.enableHint)
    }
    const before = await readDuty(raw, team)
    const memberIds = raw.users.filter((user) => !user.app && user.teams.includes(team.id)).map((user) => user.id)
    const plan = planChange(before.node, { members, action, off }, memberIds)
    let after
    if (dryRun || plan.kind === 'none') {
      after = dutyView(projected(before.node, plan, raw), raw)
    } else {
      let payload
      if (plan.kind === 'create') {
        payload = (await client.request(CREATE_MUTATION, { input: { teamId: team.id, ...plan.input } })).triageResponsibilityCreate
      } else if (plan.kind === 'update') {
        payload = (await client.request(UPDATE_MUTATION, { id: plan.id, input: plan.input })).triageResponsibilityUpdate
      } else {
        payload = (await client.request(DELETE_MUTATION, { id: plan.id })).triageResponsibilityDelete
      }
      if (payload?.success !== true) throw new PmkitError('UPSTREAM', 'Linear did not apply the triage change', 'Run linear triage show to see the current rotation')
      after = dutyView(payload.triageResponsibility ?? null, raw)
    }
    const body = (duty) => dutyLines(duty).map((line) => `  ${line}`)
    const lines = [`team: ${team.key}`, 'before:', ...body(before.duty), 'after:', ...body(after.duty)]
    if (dryRun) lines.push('dry run: nothing was written')
    else if (plan.kind === 'none') lines.push('nothing to change')
    return {
      data: { before: before.duty, after: after.duty },
      text: lines.join('\n'),
      commit: team.key,
      warnings: [...warnings, ...before.warnings, ...after.warnings],
    }
  }

  return Object.freeze({ show, suggestions, set })
}
