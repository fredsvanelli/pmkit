import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_KEY, fakeLinearFetch, fakeWorkspace } from '../../fake-linear-api.mjs'
import { fixedNow } from '../../test-helpers.mjs'
import { createLinearClient, isMutation, operationName } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'

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
