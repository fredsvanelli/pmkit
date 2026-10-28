import assert from 'node:assert/strict'
import test from 'node:test'
import { dutyText, dutyView, suggestionsText, suggestionsView, triageAvailability } from './triage.mjs'

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

const USERS = { users: [{ id: 'user-2', name: 'Ana Souza' }, { id: 'user-3', name: 'Bruno Lima' }] }
const ana = { id: 'user-2', name: 'Ana Souza' }
const bruno = { id: 'user-3', name: 'Bruno Lima' }
const manual = (userIds, extra = {}) => ({
  id: 'tr-1',
  action: 'assign',
  manualSelection: { userIds, assignmentIndex: 0 },
  timeSchedule: null,
  currentUser: ana,
  ...extra,
})
const scheduled = (integration) => ({
  id: 'tr-2',
  action: 'notify',
  manualSelection: null,
  timeSchedule: { id: 'ts-1', name: 'On call', externalUrl: 'https://example.com/s', integration },
  currentUser: bruno,
})

test('dutyView of a manual rotation keeps the rotation order', () => {
  const { duty, warnings } = dutyView(manual(['user-3', 'user-2']), USERS)
  assert.deepEqual(duty, { action: 'assign', source: 'manual', current: ana, members: [bruno, ana], schedule: null })
  assert.deepEqual(warnings, [])
})

test('dutyView of a schedule names the provider', () => {
  const pager = dutyView(scheduled({ service: 'pagerDuty' }), USERS).duty
  assert.equal(pager.source, 'schedule')
  assert.deepEqual(pager.members, [])
  assert.deepEqual(pager.schedule, { id: 'ts-1', name: 'On call', provider: 'pagerduty', url: 'https://example.com/s' })
  assert.equal(dutyView(scheduled({ service: 'opsgenie' }), USERS).duty.schedule.provider, 'opsgenie')
  assert.equal(dutyView(scheduled(null), USERS).duty.schedule.provider, 'linear')
})

test('dutyView of no responsibility', () => {
  assert.deepEqual(dutyView(null, USERS), { duty: { action: null, source: 'none', current: null, members: [], schedule: null }, warnings: [] })
})

test('dutyView marks a user Linear no longer returns', () => {
  const { duty, warnings } = dutyView(manual(['user-2', 'user-9']), USERS)
  assert.deepEqual(duty.members, [ana, { id: 'user-9', name: '(unknown user)' }])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /user-9/)
})

test('dutyText prints the lines for each source', () => {
  const text = (node) => dutyText('ACME', dutyView(node, USERS).duty)
  assert.equal(text(manual(['user-2', 'user-3'])), 'team: ACME\naction: assign\nsource: manual\non duty: Ana Souza\nrotation: Ana Souza (current), Bruno Lima')
  assert.equal(text(scheduled({ service: 'pagerDuty' })), 'team: ACME\naction: notify\nsource: schedule\non duty: Bruno Lima\nschedule: On call (pagerduty)')
  assert.equal(text(null), 'team: ACME\nnobody is on triage duty')
})

const suggestion = (type, extra = {}) => ({ type, state: 'active', metadata: { score: 0.8, reasons: ['meta reason'] }, presentedReasons: null, ...extra })
const issueNode = (identifier, suggestions) => ({ identifier, title: `Title of ${identifier}`, suggestions: { nodes: suggestions } })

test('suggestionsView gives each suggestion type its target', () => {
  const { issues } = suggestionsView([
    issueNode('ACME-1', [
      suggestion('team', { suggestedTeam: { id: 't1', key: 'ACME', name: 'Acme' } }),
      suggestion('project', { suggestedProject: { id: 'p1', name: 'Launch' } }),
      suggestion('assignee', { suggestedUser: { id: 'user-2', name: 'Ana Souza' } }),
      suggestion('label', { suggestedLabel: { id: 'l1', name: 'bug' } }),
      suggestion('similarIssue', { suggestedIssue: { id: 'i3', identifier: 'ACME-3', title: 'Old' } }),
    ]),
  ])
  assert.deepEqual(
    issues[0].suggestions.map((item) => [item.type, item.target]),
    [
      ['team', { id: 't1', name: 'ACME' }],
      ['project', { id: 'p1', name: 'Launch' }],
      ['assignee', { id: 'user-2', name: 'Ana Souza' }],
      ['label', { id: 'l1', name: 'bug' }],
      ['similarIssue', { id: 'ACME-3', name: 'Old' }],
    ],
  )
  assert.equal(issues[0].suggestions[0].score, 0.8)
})

test('suggestionsView prefers presentedReasons and falls back to metadata reasons', () => {
  const { issues } = suggestionsView([
    issueNode('ACME-1', [
      suggestion('label', { suggestedLabel: { id: 'l1', name: 'bug' }, presentedReasons: ['shown'] }),
      suggestion('label', { suggestedLabel: { id: 'l2', name: 'ux' } }),
    ]),
  ])
  assert.deepEqual(issues[0].suggestions.map((item) => item.reasons), [['shown'], ['meta reason']])
})

test('suggestionsView drops inactive suggestions and counts issues left with none', () => {
  const label = { suggestedLabel: { id: 'l1', name: 'bug' } }
  const view = suggestionsView([
    issueNode('ACME-1', [suggestion('label', { ...label, state: 'stale' }), suggestion('label', { ...label, state: 'accepted' }), suggestion('label', { ...label, state: 'dismissed' })]),
    issueNode('ACME-2', [suggestion('label', label)]),
    issueNode('ACME-4', []),
  ])
  assert.deepEqual(view.issues.map((item) => item.id), ['ACME-2'])
  assert.equal(view.withoutSuggestions, 2)
})

test('suggestionsText prints one block per issue and the empty inbox', () => {
  const view = suggestionsView([issueNode('ACME-12', [suggestion('assignee', { suggestedUser: { id: 'u', name: 'Ana Souza' }, metadata: { score: 0.74, reasons: [] } }), suggestion('similarIssue', { suggestedIssue: { identifier: 'ACME-3', title: 'x' }, metadata: { score: 0.67, reasons: [] } })])])
  assert.equal(
    suggestionsText(view),
    'ACME-12  Title of ACME-12\n  assignee Ana Souza (score 0.74)\n  similar issue ACME-3 (score 0.67)\nThese are suggestions from Linear. Apply one with a normal issue edit.',
  )
  assert.equal(suggestionsText(suggestionsView([])), 'no issue is waiting in triage')
  assert.equal(suggestionsText(suggestionsView([issueNode('ACME-4', [])])), 'no active suggestions for 1 issue in triage')
})
