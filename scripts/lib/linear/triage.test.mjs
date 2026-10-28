import assert from 'node:assert/strict'
import test from 'node:test'
import { triageAvailability } from './triage.mjs'

const raw = (plan) => ({ workspace: { plan } })
const team = (triageEnabled) => ({ key: 'ACME', triageEnabled })
const PLAN_HINT = 'Triage responsibility needs the Business or Enterprise plan'

test('a Free or unknown plan makes triage rotation unavailable', () => {
  for (const plan of ['free', 'basic', 'unknown']) {
    assert.deepEqual(triageAvailability(raw(plan), team(true)), { available: false, reason: 'plan', plan, enableHint: PLAN_HINT })
  }
})

test('a paid plan with triage on is available', () => {
  for (const plan of ['business', 'enterprise', 'trial']) assert.deepEqual(triageAvailability(raw(plan), team(true)), { available: true })
})

test('a paid plan with triage off reports triage_off', () => {
  assert.deepEqual(triageAvailability(raw('business'), team(false)), {
    available: false,
    reason: 'triage_off',
    plan: 'business',
    enableHint: "Turn on triage in the team's settings in Linear",
  })
})

test('the plan is checked before the team setting', () => {
  assert.equal(triageAvailability(raw('free'), team(false)).reason, 'plan')
})
