// Tests of the Jira Plans reader (PMK-82): plans, the default scenario, scheduling, teams and capacity, and the Premium refusal.
import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_ENV, TRACKER, fakeJiraFetch } from '../../fake-jira-api.mjs'
import { createJiraClient } from './client.mjs'
import { PLANS_HINT, planOperations } from './plans.mjs'

const LIST = 'GET /rest/api/3/plans/plan'
const PLAN = 'GET /rest/api/3/plans/plan/12'
const TEAMS = 'GET /rest/api/3/plans/plan/12/team'
const PLANONLY = 'GET /rest/api/3/plans/plan/12/team/planonly/5'
const ATLASSIAN = 'GET /rest/api/3/plans/plan/12/team/atlassian/ab-1'

const page = (values) => ({ json: { values, last: true, size: values.length } })
const LISTED = { id: '12', name: 'Q1 roadmap', status: 'Active', scenarioId: '34', issueSources: [{ type: 'Board', value: 7 }] }

function setup(routes) {
  const fetch = fakeJiraFetch(routes)
  const client = createJiraClient({ env: FAKE_ENV, tracker: TRACKER, fetch })
  return { fetch, plans: planOperations({ client, site: TRACKER.scope.site }) }
}
const plansCalls = (fetch) => fetch.calls.filter((call) => new URL(call.url).pathname.startsWith('/rest/api/3/plans'))

test('list maps plans with their default scenario and sources', async () => {
  const { plans } = setup({ [LIST]: page([LISTED]) })
  const result = await plans.list()
  assert.equal(result.available, true)
  assert.equal(result.site, 'acme.atlassian.net')
  assert.equal(result.hasMore, false)
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.plans[0], { id: '12', name: 'Q1 roadmap', status: 'active', scenario: { id: '34', default: true }, sources: [{ type: 'board', id: 7 }] })
})

test('list sends includeArchived and includeTrashed only when asked', async () => {
  const { fetch, plans } = setup({ [LIST]: page([]) })
  await plans.list()
  const plain = new URL(fetch.calls.at(-1).url).searchParams
  assert.equal(plain.has('includeArchived'), false)
  assert.equal(plain.has('includeTrashed'), false)
  await plans.list({ archived: true })
  const archived = new URL(fetch.calls.at(-1).url).searchParams
  assert.equal(archived.get('includeArchived'), 'true')
  assert.equal(archived.has('includeTrashed'), false)
  await plans.list({ trashed: true })
  assert.equal(new URL(fetch.calls.at(-1).url).searchParams.get('includeTrashed'), 'true')
})

test('list answers available false on a 403', async () => {
  const { plans } = setup({ [LIST]: { status: 403, json: { errorMessages: ['no premium'] } } })
  assert.deepEqual(await plans.list(), { available: false, reason: 'premium', enableHint: PLANS_HINT, site: 'acme.atlassian.net', plans: [], hasMore: false })
})

test('list keeps a 401 as AUTH', async () => {
  const { plans } = setup({ [LIST]: { status: 401, json: { errorMessages: ['bad token'] } } })
  await assert.rejects(plans.list(), { code: 'AUTH' })
})

const FULL_PLAN = {
  id: 12,
  name: 'Q1 roadmap',
  status: 'Active',
  leadAccountId: 'acc-1',
  lastSaved: '2026-11-20T10:00:00Z',
  issueSources: [{ type: 'Board', value: 7 }],
  scheduling: { dependencies: 'Sequential', estimation: 'StoryPoints', inferredDates: 'SprintDates', startDate: { type: 'DueDate' }, endDate: { type: 'TargetEndDate' } },
  crossProjectReleases: [{ name: 'Spring launch', releaseIds: [10001] }],
}

test('get maps scheduling, releases and both team kinds', async () => {
  const { plans } = setup({
    [LIST]: page([LISTED]),
    [PLAN]: { json: FULL_PLAN },
    [TEAMS]: page([{ id: '5', type: 'PlanOnly', name: 'Payments' }, { id: 'ab-1', type: 'Atlassian' }]),
    [PLANONLY]: { json: { id: 5, name: 'Payments', capacity: 30, issueSourceId: 7, memberAccountIds: ['acc-1'], planningStyle: 'Scrum', sprintLength: 14 } },
    [ATLASSIAN]: { json: { id: 'ab-1', capacity: 10, issueSourceId: 7, planningStyle: 'Kanban', sprintLength: null } },
  })
  const result = await plans.get('12')
  assert.equal(result.available, true)
  assert.equal(result.site, 'acme.atlassian.net')
  assert.deepEqual(result.warnings, [])
  const { plan } = result
  assert.equal(plan.id, '12')
  assert.equal(plan.status, 'active')
  assert.equal(plan.lead, 'acc-1')
  assert.equal(plan.lastSaved, '2026-11-20T10:00:00Z')
  assert.deepEqual(plan.sources, [{ type: 'board', id: 7 }])
  assert.equal(plan.scheduling.dependencies, 'sequential')
  assert.equal(plan.scheduling.estimation, 'story_points')
  assert.equal(plan.scheduling.inferredDates, 'sprint_dates')
  assert.deepEqual(plan.scheduling.startDate, { type: 'DueDate' })
  assert.deepEqual(plan.scheduling.endDate, { type: 'TargetEndDate' })
  assert.deepEqual(plan.releases, [{ name: 'Spring launch', versionIds: [10001] }])
  assert.deepEqual(plan.teams[0], { id: '5', type: 'plan_only', name: 'Payments', planningStyle: 'scrum', sprintLength: 14, capacity: 30, capacityUnit: 'story points per sprint', source: 7, members: ['acc-1'] })
  assert.deepEqual(plan.teams[1], { id: 'ab-1', type: 'atlassian', name: null, planningStyle: 'kanban', sprintLength: null, capacity: 10, capacityUnit: 'story points per week', source: 7, members: [] })
  assert.deepEqual(plan.scenario, { id: '34', default: true })
})

test('get reads the scenario from the list with archived and trashed plans', async () => {
  const { fetch, plans } = setup({ [LIST]: page([LISTED]), [PLAN]: { json: FULL_PLAN }, [TEAMS]: page([]) })
  await plans.get('12')
  const listCall = fetch.calls.find((call) => new URL(call.url).pathname === '/rest/api/3/plans/plan')
  const query = new URL(listCall.url).searchParams
  assert.equal(query.get('includeArchived'), 'true')
  assert.equal(query.get('includeTrashed'), 'true')
})

test('get tolerates a bare plan', async () => {
  const { plans } = setup({ [LIST]: page([]), [PLAN]: { json: { id: 12, name: 'x', status: 'Active' } }, [TEAMS]: page([]) })
  const { plan } = await plans.get('12')
  assert.equal(plan.scheduling, null)
  assert.deepEqual(plan.releases, [])
  assert.deepEqual(plan.teams, [])
  assert.deepEqual(plan.sources, [])
  assert.equal(plan.scenario, null)
  assert.equal(plan.lead, null)
  assert.equal(plan.lastSaved, null)
})

test('a team without scheduling has no capacity unit', async () => {
  const { plans } = setup({
    [LIST]: page([]),
    [PLAN]: { json: { id: 12, name: 'x', status: 'Active' } },
    [TEAMS]: page([{ id: '5', type: 'PlanOnly', name: 'Payments' }]),
    [PLANONLY]: { json: { id: 5, name: 'Payments', capacity: 30, planningStyle: 'Scrum', sprintLength: 14 } },
  })
  const { plan } = await plans.get('12')
  assert.equal(plan.teams[0].capacityUnit, null)
  assert.equal(plan.teams[0].source, null)
  assert.deepEqual(plan.teams[0].members, [])
})

test('get leaves out a team that is gone, with a warning', async () => {
  const { plans } = setup({
    [LIST]: page([LISTED]),
    [PLAN]: { json: FULL_PLAN },
    [TEAMS]: page([{ id: '5', type: 'PlanOnly', name: 'Payments' }]),
    [PLANONLY]: { status: 404, json: { errorMessages: ['gone'] } },
  })
  const result = await plans.get('12')
  assert.deepEqual(result.plan.teams, [])
  assert.match(result.warnings[0], /team 5/)
})

test('get fails on a team read that fails another way', async () => {
  const { plans } = setup({
    [LIST]: page([LISTED]),
    [PLAN]: { json: FULL_PLAN },
    [TEAMS]: page([{ id: '5', type: 'PlanOnly', name: 'Payments' }]),
    [PLANONLY]: { status: 400, json: { errorMessages: ['bad'] } },
  })
  await assert.rejects(plans.get('12'), { code: 'INVALID_INPUT' })
})

test('get answers available false on a 403 and NOT_FOUND on a 404', async () => {
  const off = setup({ [LIST]: page([LISTED]), [PLAN]: { status: 403, json: { errorMessages: ['no premium'] } }, [TEAMS]: page([]) })
  assert.deepEqual(await off.plans.get('12'), { available: false, reason: 'premium', enableHint: PLANS_HINT, site: 'acme.atlassian.net' })
  const listOff = setup({ [LIST]: { status: 403, json: { errorMessages: ['no premium'] } }, [PLAN]: { json: FULL_PLAN }, [TEAMS]: page([]) })
  assert.deepEqual(await listOff.plans.get('12'), { available: false, reason: 'premium', enableHint: PLANS_HINT, site: 'acme.atlassian.net' })
  const missing = setup({ [LIST]: page([]), [PLAN]: { status: 404, json: { errorMessages: ['no plan'] } }, [TEAMS]: page([]) })
  await assert.rejects(missing.plans.get('12'), { code: 'NOT_FOUND' })
})

test('get refuses a plan id that is not a number before any request', async () => {
  const { fetch, plans } = setup({})
  await assert.rejects(plans.get('../x'), { code: 'INVALID_INPUT', nextStep: 'Pass the plan id that jira plans list shows' })
  await assert.rejects(plans.get(12), { code: 'INVALID_INPUT' })
  assert.deepEqual(plansCalls(fetch), [])
})

test('an Atlassian team id is encoded in the path', async () => {
  const { fetch, plans } = setup({
    [LIST]: page([]),
    [PLAN]: { json: { id: 12, name: 'x', status: 'Active' } },
    [TEAMS]: page([{ id: 'a b', type: 'Atlassian' }]),
    'GET /rest/api/3/plans/plan/12/team/atlassian/{team}': { json: { id: 'a b', capacity: 1, planningStyle: 'Scrum' } },
  })
  await plans.get('12')
  assert.ok(fetch.calls.some((call) => call.url.includes('/team/atlassian/a%20b')))
})
