// Linear triage rotation and Triage Intelligence suggestions: the queries, the views and createTriage.
// See docs/superpowers/specs/2026-10-27-pmk-43-linear-triage-rotation-design.md.

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
