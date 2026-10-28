// Linear customers and customer requests: the queries, the views, the plans and createCustomers.
// See docs/superpowers/specs/2026-10-28-pmk-42-linear-customers-design.md.

import { BUSINESS_PLANS } from './manifest.mjs'

const PLAN_HINT = 'Linear customers need the Business or Enterprise plan'
const CUSTOMERS_OFF_HINT = 'Turn on customers in the workspace settings in Linear'

/**
 * Whether the workspace has customers. raw is the cached discovery. The flag is the fact Linear enforces;
 * the plan only picks the reason and the hint.
 */
export function customersAvailability(raw) {
  if (raw.flags?.customersEnabled === true) return { available: true }
  const plan = raw.workspace.plan
  if (!BUSINESS_PLANS.includes(plan)) return { available: false, reason: 'plan', plan, enableHint: PLAN_HINT }
  return { available: false, reason: 'customers_off', plan, enableHint: CUSTOMERS_OFF_HINT }
}
