import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_KEY, fakeLinearFetch, fakeWorkspace } from '../../fake-linear-api.mjs'
import { fixedNow } from '../../test-helpers.mjs'
import { CAPABILITIES, SERVED_BY, unservedCapabilities } from '../capabilities.mjs'
import { createLinearClient } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { buildLinearCapabilities, LINEAR_CAPABILITIES } from './manifest.mjs'

const NOW = fixedNow('2026-10-27T12:00:00Z')

async function raw(options = {}) {
  const client = createLinearClient({
    env: { LINEAR_API_KEY: FAKE_KEY },
    tracker: { system: 'linear', scope: { workspace: 'acme' } },
    requireWorkspace: false,
    fetch: fakeLinearFetch(fakeWorkspace(options)),
  })
  return fetchDiscovery(client, { now: NOW })
}

const pmkitWith = ({ team, gitHost = 'github' } = {}) => ({
  tracker: { system: 'linear', scope: { workspace: 'acme', ...(team ? { team } : {}) } },
  git_host: { system: gitHost },
})
const byId = (entries) => Object.fromEntries(entries.map((entry) => [entry.id, entry]))
const paths = (entries) => Object.fromEntries(entries.map((entry) => [entry.id, entry.path]))
const TEAM_DEFAULTS = { parent: null, cyclesEnabled: false, triageEnabled: false, issueEstimationType: 'notUsed', issueEstimationAllowZero: false, issueEstimationExtended: false }
const team = (id, key, extra = {}) => ({ ...TEAM_DEFAULTS, id, key, name: key, ...extra })
const BUSINESS = { subscription: { type: 'business' }, releasesEnabled: true, customersEnabled: true }

test('LINEAR_CAPABILITIES names only known capabilities', () => {
  assert.ok(Object.keys(LINEAR_CAPABILITIES).every((id) => CAPABILITIES.includes(id)))
})

test('the manifest has 20 entries in spec order, each with a path', async () => {
  const entries = buildLinearCapabilities(await raw(), pmkitWith())
  assert.deepEqual(entries.map((entry) => entry.id), CAPABILITIES)
  for (const entry of entries) assert.ok(['native', 'derived', 'conditional', 'absent'].includes(entry.path), entry.id)
})

test('the default workspace gives the sandbox column', async () => {
  const entries = buildLinearCapabilities(await raw(), pmkitWith())
  assert.deepEqual(paths(entries), {
    cycles: 'absent',
    estimation: 'absent',
    multilevel_hierarchy: 'native',
    dependencies: 'native',
    native_triage: 'absent',
    deliverables: 'native',
    strategic_goals: 'absent',
    status_update: 'native',
    releases: 'absent',
    capacity: 'absent',
    native_metrics: 'derived',
    saved_views: 'absent',
    documents: 'native',
    demand_signals: 'absent',
    request_queue: 'absent',
    time_tracking: 'absent',
    linked_code: 'derived',
    agent_delegation: 'absent',
    security_alerts: 'absent',
    user_inbox: 'absent',
  })
  const entry = byId(entries)
  assert.deepEqual(entry.agent_delegation.detail, { workspace: 'conditional', agents: ['Linear'] })
  assert.equal(entry.agent_delegation.enableHint, 'No pmkit command serves agent_delegation yet; Linear offers it on this workspace')
  assert.equal(entry.cycles.enableHint, "Turn on cycles in the team's settings in Linear")
  assert.equal(entry.estimation.enableHint, "Turn on estimates in the team's settings in Linear")
  assert.equal(entry.native_triage.enableHint, "Turn on triage in the team's settings in Linear")
  assert.equal(entry.capacity.enableHint, 'Capacity needs cycles')
  assert.equal(entry.releases.enableHint, 'Linear releases need the Business or Enterprise plan and releases turned on in the workspace settings')
  assert.equal(entry.strategic_goals.enableHint, 'Linear initiatives need the Business or Enterprise plan')
  assert.equal('detail' in entry.strategic_goals, false)
  assert.equal(entry.demand_signals.enableHint, 'Linear customer requests need the Business or Enterprise plan and customers turned on in the workspace settings')
  assert.equal(entry.request_queue.enableHint, 'Linear Asks need the Business or Enterprise plan')
  assert.equal(entry.time_tracking.enableHint, 'Linear has no time tracking')
  assert.equal(entry.security_alerts.enableHint, 'Linear has no security alerts')
  assert.deepEqual(entry.saved_views.detail, { workspace: 'native' })
  assert.deepEqual(entry.user_inbox.detail, { workspace: 'native' })
  assert.deepEqual(entry.deliverables.detail, { entity: 'project' })
  assert.deepEqual(entry.native_metrics.detail, { source: 'history' })
  assert.deepEqual(entry.linked_code, { id: 'linked_code', path: 'derived', detail: { source: 'git' } })
})

test('a Business workspace with releases and customers on', async () => {
  const entry = byId(buildLinearCapabilities(await raw(BUSINESS), pmkitWith()))
  assert.deepEqual(entry.releases, { id: 'releases', path: 'native' })
  assert.equal(entry.demand_signals.path, 'absent')
  assert.equal(entry.demand_signals.detail.workspace, 'native')
  assert.equal(entry.strategic_goals.detail.workspace, 'native')
  assert.equal(entry.request_queue.detail.workspace, 'conditional')
  assert.equal(entry.strategic_goals.enableHint, 'No pmkit command serves strategic_goals yet; Linear offers it on this workspace')
})

test('a trial counts as a Business plan and releases follow the setting', async () => {
  const entry = byId(buildLinearCapabilities(await raw({ trialEndsAt: '2026-11-01T00:00:00Z' }), pmkitWith()))
  assert.equal(entry.strategic_goals.detail.workspace, 'native')
  assert.equal(entry.releases.path, 'absent')
})

test('team settings are conditional across teams and decided by the configured team', async () => {
  const teams = [team('t-acme', 'ACME', { cyclesEnabled: true }), team('t-ops', 'OPS')]
  const data = await raw({ teams })
  const none = byId(buildLinearCapabilities(data, pmkitWith()))
  assert.deepEqual(none.cycles, { id: 'cycles', path: 'conditional', detail: { teams: ['ACME'] } })
  assert.deepEqual(none.capacity, { id: 'capacity', path: 'derived', detail: { source: 'local' } })
  const ops = byId(buildLinearCapabilities(data, pmkitWith({ team: 'OPS' })))
  assert.equal(ops.cycles.path, 'absent')
  assert.equal(ops.capacity.path, 'absent')
  const acme = byId(buildLinearCapabilities(data, pmkitWith({ team: 'ACME' })))
  assert.deepEqual(acme.cycles, { id: 'cycles', path: 'native' })
  const missing = byId(buildLinearCapabilities(data, pmkitWith({ team: 'NOPE' })))
  assert.equal(missing.cycles.path, 'conditional')
})

test('estimation on a team gives its scale', async () => {
  const data = await raw({ teams: [team('t-acme', 'ACME', { issueEstimationType: 'fibonacci' }), team('t-ops', 'OPS', { issueEstimationType: 'exponential' })] })
  const acme = byId(buildLinearCapabilities(data, pmkitWith({ team: 'ACME' })))
  assert.deepEqual(acme.estimation, { id: 'estimation', path: 'native', detail: { unit: 'points', scale: [1, 2, 3, 5, 8] } })
  const mixed = byId(buildLinearCapabilities(data, pmkitWith()))
  assert.deepEqual(mixed.estimation, { id: 'estimation', path: 'native', detail: { unit: 'points', scale: [] } })
  const sized = byId(buildLinearCapabilities(await raw({ teams: [team('t-acme', 'ACME', { issueEstimationType: 'tShirt' })] }), pmkitWith()))
  assert.deepEqual(sized.estimation.detail, { unit: 'sizes', scale: ['XS', 'S', 'M', 'L', 'XL'] })
})

test('linked_code follows the integration and git_host', async () => {
  const integrated = byId(buildLinearCapabilities(await raw({ integrations: ['github'] }), pmkitWith()))
  assert.deepEqual(integrated.linked_code, { id: 'linked_code', path: 'native', detail: { source: 'integration' } })
  const gitlab = byId(buildLinearCapabilities(await raw({ integrations: ['gitlab'] }), pmkitWith()))
  assert.equal(gitlab.linked_code.path, 'native')
  const noHost = byId(buildLinearCapabilities(await raw(), pmkitWith({ gitHost: 'none' })))
  assert.deepEqual(noHost.linked_code, { id: 'linked_code', path: 'derived', detail: { source: 'git' }, enableHint: 'Set git_host in .pmkit/config.yaml' })
  const absentHost = byId(buildLinearCapabilities(await raw(), { tracker: { system: 'linear' } }))
  assert.equal(absentHost.linked_code.enableHint, 'Set git_host in .pmkit/config.yaml')
  const personal = byId(buildLinearCapabilities(await raw({ integrations: ['githubCodeAccessPersonal'] }), pmkitWith()))
  assert.equal(personal.linked_code.path, 'derived')
})

test('refused integrations give a derived linked_code', async () => {
  const entry = byId(buildLinearCapabilities(await raw({ refuse: ['PmkitIntegrations'] }), pmkitWith()))
  assert.equal(entry.linked_code.path, 'derived')
})

test('an unknown plan words the hints as the Free plan', async () => {
  const entry = byId(buildLinearCapabilities(await raw({ refuse: ['PmkitPlan'] }), pmkitWith()))
  assert.equal(entry.strategic_goals.enableHint, 'Linear initiatives need the Business or Enterprise plan')
})

const WORKSPACES = { default: {}, business: BUSINESS, empty: { teams: [], states: [], labels: [] } }

test('no entry claims a path no command serves', async () => {
  for (const [name, options] of Object.entries(WORKSPACES)) {
    assert.deepEqual(unservedCapabilities(buildLinearCapabilities(await raw(options), pmkitWith()), SERVED_BY), [], name)
  }
})

test('every absent entry has a hint and every detail is flat', async () => {
  const flat = (value) => ['string', 'number'].includes(typeof value) || (Array.isArray(value) && value.every((item) => ['string', 'number'].includes(typeof item)))
  for (const [name, options] of Object.entries(WORKSPACES)) {
    for (const entry of buildLinearCapabilities(await raw(options), pmkitWith())) {
      if (entry.path === 'absent') assert.equal(typeof entry.enableHint, 'string', `${name} ${entry.id}`)
      for (const value of Object.values(entry.detail ?? {})) assert.ok(flat(value), `${name} ${entry.id}`)
    }
  }
})

test('a workspace with no teams gives absent team capabilities', async () => {
  const entry = byId(buildLinearCapabilities(await raw(WORKSPACES.empty), pmkitWith()))
  for (const id of ['cycles', 'estimation', 'native_triage', 'capacity']) assert.equal(entry[id].path, 'absent', id)
})
