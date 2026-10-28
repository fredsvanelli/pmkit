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
