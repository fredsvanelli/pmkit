import assert from 'node:assert/strict'
import test from 'node:test'
import { customersAvailability } from './customers.mjs'

const raw = (plan, customersEnabled) => ({ workspace: { plan }, flags: { customersEnabled } })
const PLAN_HINT = 'Linear customers need the Business or Enterprise plan'
const OFF_HINT = 'Turn on customers in the workspace settings in Linear'

test('the customers flag decides, whatever the plan says', () => {
  for (const plan of ['free', 'business', 'unknown']) assert.deepEqual(customersAvailability(raw(plan, true)), { available: true })
})

test('a plan outside the Business list with the flag off reports plan', () => {
  for (const plan of ['free', 'basic', 'unknown', 'plus']) {
    assert.deepEqual(customersAvailability(raw(plan, false)), { available: false, reason: 'plan', plan, enableHint: PLAN_HINT })
  }
})

test('a Business plan with the flag off reports customers_off', () => {
  for (const plan of ['business', 'enterprise', 'trial']) {
    assert.deepEqual(customersAvailability(raw(plan, false)), { available: false, reason: 'customers_off', plan, enableHint: OFF_HINT })
  }
})
