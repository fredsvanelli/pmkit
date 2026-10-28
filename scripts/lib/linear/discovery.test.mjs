import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_KEY, fakeLinearFetch, fakeWorkspace } from '../../fake-linear-api.mjs'
import { fixedNow } from '../../test-helpers.mjs'
import { createLinearClient, isMutation, operationName } from './client.mjs'
import { categoryOfType, discoveryView, estimateScale, fetchDiscovery } from './discovery.mjs'

const NOW = fixedNow('2026-10-27T12:00:00Z')
const DISCOVERY_OPERATIONS = ['PmkitWorkspace', 'PmkitPlan', 'PmkitIntegrations', 'PmkitTeams', 'PmkitStates', 'PmkitLabels', 'PmkitUsers']

function setup(options = {}, routes = {}) {
  const fetch = fakeLinearFetch({ ...fakeWorkspace(options), ...routes })
  const client = createLinearClient({
    env: { LINEAR_API_KEY: FAKE_KEY },
    tracker: { system: 'linear', scope: { workspace: 'acme' } },
    requireWorkspace: false,
    fetch,
    sleep: async () => {},
  })
  return { fetch, client }
}

const discover = (options, routes) => {
  const { client } = setup(options, routes)
  return fetchDiscovery(client, { now: NOW })
}

const callsOf = (fetch, name) => fetch.calls.filter((call) => operationName(call.body.query) === name).length

test('fetchDiscovery returns the raw data of the default workspace', async () => {
  const raw = await discover()
  assert.equal(raw.version, 1)
  assert.equal(raw.discoveredAt, '2026-10-27T12:00:00.000Z')
  assert.deepEqual(raw.workspace, { urlKey: 'acme', name: 'Acme', plan: 'free', trialEndsAt: null })
  assert.deepEqual(raw.flags, { releasesEnabled: false, customersEnabled: false })
  assert.deepEqual(raw.integrations, ['githubCodeAccessPersonal'])
  assert.deepEqual(raw.teams, [
    {
      id: 'team-acme',
      key: 'ACME',
      name: 'Acme',
      parent: null,
      cyclesEnabled: false,
      triageEnabled: false,
      estimation: { type: 'notUsed', allowZero: false, extended: false },
    },
  ])
  assert.equal(raw.states.length, 10)
  assert.deepEqual(raw.states[0], { id: 'state-1', name: 'Backlog', type: 'backlog', position: 0, team: 'team-acme' })
  assert.ok(!raw.labels.some((label) => label.name === 'Old'))
  assert.deepEqual(
    raw.labels.find((label) => label.name === 'XS'),
    { id: 'label-xs', name: 'XS', group: 'Size', isGroup: false, team: 'team-acme' },
  )
  assert.equal(raw.labels.find((label) => label.name === 'Docs').team, null)
  assert.ok(!raw.users.some((user) => user.id === 'user-3'))
  assert.deepEqual(raw.users[1], {
    id: 'user-2',
    name: 'Ada Lovelace',
    displayName: 'ada',
    email: 'ada@example.com',
    guest: false,
    app: false,
    teams: ['team-acme'],
  })
  assert.deepEqual(raw.truncated, [])
})

test('a team parent becomes its key', async () => {
  const ops = { id: 'team-ops', key: 'OPS', name: 'Ops', parent: { key: 'ACME' }, cyclesEnabled: false, triageEnabled: false }
  const raw = await discover({ teams: [{ ...ops, issueEstimationType: 'notUsed' }], states: [], labels: [], users: [] })
  assert.equal(raw.teams[0].parent, 'ACME')
})

test('fetchDiscovery sends the session and seven queries, and no mutation', async () => {
  const { fetch, client } = setup()
  await fetchDiscovery(client, { now: NOW })
  assert.equal(callsOf(fetch, 'PmkitSession'), 1)
  for (const name of DISCOVERY_OPERATIONS) assert.equal(callsOf(fetch, name), 1, name)
  assert.equal(fetch.calls.length, 8)
  assert.ok(fetch.calls.every((call) => !isMutation(call.body.query)))
  assert.ok(fetch.calls.filter((call) => /^Pmkit(Teams|States|Labels|Users)$/.test(operationName(call.body.query))).every((call) => call.body.variables.first === 250))
})

test('the plan comes from the subscription, a running trial or free', async () => {
  assert.equal((await discover({ subscription: { type: 'Business' } })).workspace.plan, 'business')
  assert.equal((await discover({ trialEndsAt: '2026-11-01T00:00:00Z' })).workspace.plan, 'trial')
  assert.equal((await discover({ trialEndsAt: '2026-10-01T00:00:00Z' })).workspace.plan, 'free')
})

test('a refused plan gives unknown and keeps the rest', async () => {
  const raw = await discover({ refuse: ['PmkitPlan'] })
  assert.equal(raw.workspace.plan, 'unknown')
  assert.equal(raw.teams.length, 1)
})

test('refused integrations give null and keep the rest', async () => {
  const raw = await discover({ refuse: ['PmkitIntegrations'] })
  assert.equal(raw.integrations, null)
  assert.equal(raw.states.length, 10)
})

test('a rate limit on the plan propagates', async () => {
  await assert.rejects(discover({}, { PmkitPlan: { status: 429, json: { errors: [{ message: 'slow down' }] } } }), { code: 'RATE_LIMITED' })
})

test('a rate limit on the integrations propagates', async () => {
  await assert.rejects(discover({}, { PmkitIntegrations: { status: 429, json: { errors: [{ message: 'slow down' }] } } }), {
    code: 'RATE_LIMITED',
  })
})

test('a refused teams read fails the discovery with AUTH', async () => {
  await assert.rejects(discover({ refuse: ['PmkitTeams'] }), { code: 'AUTH' })
})

test('an endless connection is truncated at the client cap', async () => {
  const { fetch, client } = setup({ endless: ['PmkitLabels'] })
  const raw = await fetchDiscovery(client, { now: NOW })
  assert.deepEqual(raw.truncated, ['labels'])
  assert.equal(callsOf(fetch, 'PmkitLabels'), 10)
})

test('categoryOfType maps every Linear state type', () => {
  const pairs = {
    triage: 'triage',
    backlog: 'backlog',
    unstarted: 'todo',
    started: 'in_progress',
    completed: 'done',
    canceled: 'canceled',
    duplicate: 'canceled',
  }
  for (const [type, category] of Object.entries(pairs)) assert.equal(categoryOfType(type), category, type)
  assert.equal(categoryOfType('paused'), null)
  assert.equal(categoryOfType(undefined), null)
})

test('estimateScale gives each scale', () => {
  const scale = (type, extended) => estimateScale({ type, allowZero: false, extended })
  assert.deepEqual(scale('notUsed', false), { unit: 'points', scale: [] })
  assert.deepEqual(scale('notUsed', true), { unit: 'points', scale: [] })
  assert.deepEqual(scale('exponential', false), { unit: 'points', scale: [1, 2, 4, 8, 16] })
  assert.deepEqual(scale('exponential', true), { unit: 'points', scale: [1, 2, 4, 8, 16, 32, 64] })
  assert.deepEqual(scale('fibonacci', false), { unit: 'points', scale: [1, 2, 3, 5, 8] })
  assert.deepEqual(scale('fibonacci', true), { unit: 'points', scale: [1, 2, 3, 5, 8, 13, 21] })
  assert.deepEqual(scale('linear', false), { unit: 'points', scale: [1, 2, 3, 4, 5] })
  assert.deepEqual(scale('linear', true), { unit: 'points', scale: [1, 2, 3, 4, 5, 6, 7] })
  assert.deepEqual(scale('tShirt', false), {
    unit: 'sizes',
    scale: ['XS', 'S', 'M', 'L', 'XL'],
    values: { XS: 1, S: 2, M: 3, L: 5, XL: 8 },
  })
  assert.deepEqual(scale('tShirt', true), {
    unit: 'sizes',
    scale: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
    values: { XS: 1, S: 2, M: 3, L: 5, XL: 8, XXL: 13, XXXL: 21 },
  })
})

test('allowZero puts 0 first', () => {
  assert.deepEqual(estimateScale({ type: 'fibonacci', allowZero: true, extended: false }).scale, [0, 1, 2, 3, 5, 8])
  assert.deepEqual(estimateScale({ type: 'tShirt', allowZero: true, extended: false }).scale, ['XS', 'S', 'M', 'L', 'XL'])
  assert.deepEqual(estimateScale({ type: 'notUsed', allowZero: true, extended: false }).scale, [])
})

test('an unknown estimation type gives no scale', () => {
  assert.deepEqual(estimateScale({ type: 'logarithmic' }), { unit: 'points', scale: [] })
})

const raw = (options, routes) => discover(options, routes)
const pmkitWith = ({ team, status } = {}) => ({
  tracker: { system: 'linear', scope: { workspace: 'acme', ...(team ? { team } : {}) } },
  ...(status ? { mappings: { status } } : {}),
})
const statusOf = (list, name) => list.find((status) => status.name === name)
const TEAM_DEFAULTS = { parent: null, cyclesEnabled: false, triageEnabled: false, issueEstimationAllowZero: false, issueEstimationExtended: false }

test('the default workspace gives the no-team view', async () => {
  const view = discoveryView(await raw(), pmkitWith())
  assert.deepEqual(Object.keys(view), [
    'workspace', 'team', 'teams', 'statuses', 'types', 'priorities', 'labels', 'members', 'agents', 'estimate', 'discoveredAt', 'warnings',
  ])
  assert.deepEqual(view.workspace, { urlKey: 'acme', name: 'Acme', plan: 'free' })
  assert.equal(view.team, null)
  assert.equal(view.statuses.length, 10)
  assert.deepEqual(statusOf(view.statuses, 'Duplicate'), { name: 'Duplicate', category: 'canceled' })
  assert.equal(statusOf(view.statuses, 'In Review').category, 'in_progress')
  assert.deepEqual(view.labels, ['Bug', 'Docs', 'Feature', 'L', 'M', 'S', 'XL', 'XS'])
  assert.deepEqual(view.members.map((member) => member.id), ['user-1', 'user-2'])
  assert.deepEqual(view.members[1], { id: 'user-2', name: 'Ada Lovelace', email: 'ada@example.com', handle: 'ada', guest: false, teams: ['ACME'] })
  assert.deepEqual(view.agents, [{ id: 'user-4', name: 'Linear' }])
  assert.deepEqual(view.estimate, { unit: 'points', scale: [] })
  assert.deepEqual(view.priorities, ['urgent', 'high', 'medium', 'low'])
  assert.deepEqual(view.types, [])
  assert.equal(view.discoveredAt, '2026-10-27T12:00:00.000Z')
  assert.deepEqual(view.warnings, [])
  const [acme] = view.teams
  assert.deepEqual(Object.keys(acme), ['key', 'name', 'parent', 'cycles', 'triage', 'statuses', 'labels', 'estimate'])
  assert.deepEqual(acme.estimate, { unit: 'points', scale: [], type: 'notUsed' })
  assert.deepEqual(acme.statuses[0], { name: 'Backlog', category: 'backlog', type: 'backlog' })
  assert.ok(!acme.labels.some((label) => label.name === 'Size'))
})

test('team states follow their position', async () => {
  const states = fakeWorkspace().PmkitStates({ variables: { first: 250 } }).json.data.workflowStates.nodes
  const view = discoveryView(await raw({ states: [...states].reverse() }), pmkitWith({ team: 'ACME' }))
  assert.deepEqual(view.teams[0].statuses.map((status) => status.name).slice(0, 2), ['Backlog', 'Todo'])
  assert.deepEqual(view.statuses.map((status) => status.name).slice(0, 2), ['Backlog', 'Todo'])
})

test('the team view uses the configured team', async () => {
  const view = discoveryView(await raw(), pmkitWith({ team: 'ACME' }))
  assert.equal(view.team, 'ACME')
  assert.ok(view.teams[0].labels.some((label) => label.name === 'XS' && label.group === 'Size'))
  assert.ok(view.teams[0].labels.some((label) => label.name === 'Docs' && label.group === null))
  assert.deepEqual(view.labels, ['Bug', 'Docs', 'Feature', 'L', 'M', 'S', 'XL', 'XS'])
  assert.deepEqual(view.warnings, [])
})

test('a missing team warns and gives the no-team view', async () => {
  const view = discoveryView(await raw(), pmkitWith({ team: 'NOPE' }))
  assert.equal(view.team, null)
  assert.deepEqual(view.warnings, ['tracker.scope.team names NOPE, which this workspace does not have'])
})

test('mappings.status.in_review turns a started state into in_review', async () => {
  const view = discoveryView(await raw(), pmkitWith({ status: { in_review: 'Code Review', blocked: 'UAT' } }))
  assert.equal(statusOf(view.statuses, 'Code Review').category, 'in_review')
  assert.equal(statusOf(view.teams[0].statuses, 'Code Review').category, 'in_review')
  assert.equal(statusOf(view.statuses, 'UAT').category, 'in_progress')
  assert.deepEqual(view.warnings, [])
})

test('a mapping to a missing state warns', async () => {
  const teamView = discoveryView(await raw(), pmkitWith({ team: 'ACME', status: { in_review: 'Peer Review' } }))
  assert.deepEqual(teamView.warnings, ['mappings.status.in_review names Peer Review, which team ACME does not have'])
  const noTeam = discoveryView(await raw(), pmkitWith({ status: { in_review: 'Peer Review' } }))
  assert.deepEqual(noTeam.warnings, ['mappings.status.in_review names Peer Review, which no team has'])
})

test('an unknown state type counts as in_progress and warns', async () => {
  const states = [{ id: 'state-p', name: 'Parked', type: 'paused', position: 0, team: { id: 'team-acme' } }]
  const view = discoveryView(await raw({ states }), pmkitWith())
  assert.deepEqual(view.statuses, [{ name: 'Parked', category: 'in_progress' }])
  assert.deepEqual(view.warnings, ['Linear state Parked on team ACME has type paused, which pmkit does not know; it counts as in_progress'])
})

test('a fresh view starts with auth and the session warnings', async () => {
  const session = { source: 'LINEAR_API_KEY', viewer: { id: 'user-1', name: 'Test User' }, workspace: { urlKey: 'acme', name: 'Acme' }, pinned: true, warnings: ['renamed'] }
  const view = discoveryView(await raw({ refuse: ['PmkitPlan'] }), pmkitWith(), { session })
  assert.equal(Object.keys(view)[0], 'auth')
  assert.deepEqual(view.auth, { source: 'LINEAR_API_KEY', viewer: { id: 'user-1', name: 'Test User' }, workspace: { urlKey: 'acme', name: 'Acme' } })
  assert.equal(view.warnings[0], 'renamed')
  assert.equal(view.warnings.length, 2)
  assert.equal('auth' in discoveryView(await raw(), pmkitWith()), false)
})

test('truncation, an unknown plan and refused integrations warn', async () => {
  const view = discoveryView(await raw({ endless: ['PmkitUsers'], refuse: ['PmkitPlan', 'PmkitIntegrations'] }), pmkitWith())
  assert.deepEqual(view.warnings, [
    'Linear has more than 2500 users; discovery kept the first 2500',
    'Linear did not say which plan this workspace has; capability hints assume the Free plan',
    "Linear refused to list this workspace's integrations for this key; linked_code assumes git only",
  ])
})

test('estimates shared by every team give the common scale, mixed ones give none', async () => {
  const team = (id, key, issueEstimationType) => ({ ...TEAM_DEFAULTS, id, key, name: key, issueEstimationType })
  const same = discoveryView(await raw({ teams: [team('t1', 'ONE', 'fibonacci'), team('t2', 'TWO', 'fibonacci'), team('t3', 'OFF', 'notUsed')] }), pmkitWith())
  assert.deepEqual(same.estimate, { unit: 'points', scale: [1, 2, 3, 5, 8] })
  const mixed = discoveryView(await raw({ teams: [team('t1', 'ONE', 'fibonacci'), team('t2', 'TWO', 'exponential')] }), pmkitWith())
  assert.deepEqual(mixed.estimate, { unit: 'points', scale: [] })
  assert.deepEqual(mixed.teams[1].estimate, { unit: 'points', scale: [1, 2, 4, 8, 16], type: 'exponential' })
  const sized = discoveryView(await raw({ teams: [team('t1', 'ONE', 'tShirt')] }), pmkitWith({ team: 'ONE' }))
  assert.deepEqual(sized.estimate, { unit: 'sizes', scale: ['XS', 'S', 'M', 'L', 'XL'], values: { XS: 1, S: 2, M: 3, L: 5, XL: 8 } })
})

test('a workspace with no teams gives empty lists', async () => {
  const view = discoveryView(await raw({ teams: [], states: [], labels: [] }), pmkitWith())
  assert.deepEqual(view.teams, [])
  assert.deepEqual(view.statuses, [])
  assert.deepEqual(view.labels, [])
  assert.deepEqual(view.estimate, { unit: 'points', scale: [] })
  assert.deepEqual(view.members[0].teams, [])
})
