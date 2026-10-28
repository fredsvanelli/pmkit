import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_KEY, ACME_TEAM_ID, fakeLinearFetch, fakeWorkspace } from '../../fake-linear-api.mjs'
import { fixedNow } from '../../test-helpers.mjs'
import { brokenMappings, proposeMappings } from '../mappings.mjs'
import { createLinearClient } from './client.mjs'
import { discoveryView, fetchDiscovery } from './discovery.mjs'
import { linearDescription, resolveMappings } from './mappings.mjs'

const TYPES = ['feature', 'bug', 'task', 'chore']

async function discover(options = {}) {
  const client = createLinearClient({
    env: { LINEAR_API_KEY: FAKE_KEY },
    tracker: { system: 'linear', scope: { workspace: 'acme' } },
    requireWorkspace: false,
    fetch: fakeLinearFetch(fakeWorkspace(options)),
    sleep: async () => {},
  })
  return fetchDiscovery(client, { now: fixedNow('2026-10-27T12:00:00Z') })
}

const pmkitWith = (mappings = {}, team = 'ACME') => ({ tracker: { system: 'linear', scope: { workspace: 'acme', team } }, mappings })
const describeRaw = (raw, types = TYPES, viewerId = 'user-1') => linearDescription(raw, discoveryView(raw, pmkitWith()), viewerId, types)
const stateNode = (id, name, type, position, team = ACME_TEAM_ID) => ({ id, name, type, position, team: { id: team } })
// The sandbox order: "Code Review" comes before "In Review".
const SANDBOX_STATES = [
  stateNode('s1', 'Backlog', 'backlog', 0), stateNode('s2', 'Todo', 'unstarted', 1), stateNode('s3', 'In Progress', 'started', 2),
  stateNode('s4', 'UAT', 'started', 3), stateNode('s5', 'Ready to ship', 'started', 4), stateNode('s6', 'Code Review', 'started', 5),
  stateNode('s7', 'In Review', 'started', 6), stateNode('s8', 'Done', 'completed', 7), stateNode('s9', 'Canceled', 'canceled', 8),
]

test('the in-review recommendation is In Review, not Code Review, and it comes first', async () => {
  const description = describeRaw(await discover({ states: SANDBOX_STATES }))
  const [team] = description.teams
  assert.equal(team.recommended['mappings.status.in_review'], 'In Review')
  assert.deepEqual(team.candidates['mappings.status.in_review'], ['In Review', 'In Progress', 'UAT', 'Ready to ship', 'Code Review'])
})

test('without an exact In Review, the first state with review in its name is recommended, else none', async () => {
  const states = SANDBOX_STATES.filter((state) => state.name !== 'In Review')
  assert.equal(describeRaw(await discover({ states })).teams[0].recommended['mappings.status.in_review'], 'Code Review')
  const plain = SANDBOX_STATES.filter((state) => !/Review/.test(state.name))
  assert.equal(describeRaw(await discover({ states: plain })).teams[0].recommended['mappings.status.in_review'], 'none')
})

test('a team with one started state offers no in-review candidate', async () => {
  const states = SANDBOX_STATES.filter((state) => state.type !== 'started' || state.name === 'In Progress')
  const team = describeRaw(await discover({ states })).teams[0]
  assert.deepEqual(team.candidates['mappings.status.in_review'], [])
  assert.equal(team.recommended['mappings.status.in_review'], 'none')
})

test('a status key for another category offers every state of the team, so setup can repair a hand-written one', async () => {
  const team = describeRaw(await discover({ states: SANDBOX_STATES })).teams[0]
  const names = SANDBOX_STATES.map((state) => state.name)
  for (const category of ['triage', 'backlog', 'todo', 'in_progress', 'done', 'canceled']) {
    assert.deepEqual(team.candidates[`mappings.status.${category}`], names, category)
  }
})

test('blocked offers the backlog, todo and in progress states and recommends one with block in its name', async () => {
  const team = describeRaw(await discover({ states: SANDBOX_STATES })).teams[0]
  assert.deepEqual(team.candidates['mappings.status.blocked'], ['Backlog', 'Todo', 'In Progress', 'UAT', 'Ready to ship', 'Code Review', 'In Review'])
  assert.equal(team.recommended['mappings.status.blocked'], 'none')
  const states = [...SANDBOX_STATES, stateNode('s10', 'Blocked', 'started', 9)]
  const withBlocked = describeRaw(await discover({ states })).teams[0]
  assert.equal(withBlocked.candidates['mappings.status.blocked'][0], 'Blocked')
  assert.equal(withBlocked.recommended['mappings.status.blocked'], 'Blocked')
})

test('a state named none is never a candidate', async () => {
  const states = [...SANDBOX_STATES, stateNode('s10', 'none', 'started', 9)]
  const team = describeRaw(await discover({ states })).teams[0]
  assert.ok(!team.candidates['mappings.status.blocked'].includes('none'))
  assert.equal(team.exists('mappings.status.blocked', 'none'), false)
})

test('a label named like the type is recommended, a team label wins over a workspace one, and groups and retired labels are out', async () => {
  const raw = await discover()
  const team = describeRaw(raw).teams[0]
  assert.equal(team.recommended['mappings.types.bug'], 'Bug')
  assert.equal(team.recommended['mappings.types.task'], 'none')
  assert.deepEqual(team.candidates['mappings.types.task'], ['Bug', 'Feature', 'L', 'M', 'S', 'XL', 'XS', 'Docs'])
  assert.ok(!team.candidates['mappings.types.bug'].includes('Size'))
  assert.ok(!team.candidates['mappings.types.bug'].includes('Old'))
  assert.equal(team.candidates['mappings.types.bug'][0], 'Bug')
  // A workspace label named Bug as well: still one Bug, and the team's.
  const labels = [...fakeWorkspaceLabels(), { id: 'label-ws-bug', name: 'Bug', isGroup: false, retiredAt: null, team: null, parent: null }]
  const both = describeRaw(await discover({ labels })).teams[0]
  assert.equal(both.candidates['mappings.types.bug'].filter((name) => name === 'Bug').length, 1)
})

function fakeWorkspaceLabels() {
  return [
    { id: 'label-bug', name: 'Bug', isGroup: false, retiredAt: null, team: { id: ACME_TEAM_ID }, parent: null },
    { id: 'label-size', name: 'Size', isGroup: true, retiredAt: null, team: { id: ACME_TEAM_ID }, parent: null },
  ]
}

test('a workspace label named like a type is the recommended label when the team has none', async () => {
  const labels = [{ id: 'label-ws-bug', name: 'bug', isGroup: false, retiredAt: null, team: null, parent: null }]
  const team = describeRaw(await discover({ labels })).teams[0]
  assert.equal(team.recommended['mappings.types.bug'], 'bug')
})

test('the estimate is native only when the team uses estimates', async () => {
  assert.deepEqual(describeRaw(await discover()).teams[0].candidates['mappings.fields.estimate'], [])
  const raw = await discover()
  raw.teams[0].estimation.type = 'fibonacci'
  const team = describeRaw(raw).teams[0]
  assert.deepEqual(team.candidates['mappings.fields.estimate'], ['native'])
  assert.equal(team.recommended['mappings.fields.estimate'], 'native')
})

test('the viewer teams come from the viewer id, and exists follows the raw data', async () => {
  const raw = await discover()
  assert.deepEqual(describeRaw(raw).viewerTeams, ['ACME'])
  assert.deepEqual(describeRaw(raw, TYPES, 'user-9').viewerTeams, [])
  assert.deepEqual(describeRaw(raw, TYPES, null).viewerTeams, [])
  assert.equal(describeRaw(raw).teams[0].exists('mappings.status.in_review', 'In Review'), true)
  const without = { ...raw, states: raw.states.filter((state) => state.name !== 'In Review') }
  assert.equal(describeRaw(without).teams[0].exists('mappings.status.in_review', 'In Review'), false)
  assert.equal(describeRaw(raw).teams[0].exists('mappings.types.bug', 'Bug'), true)
  assert.equal(describeRaw(raw).teams[0].exists('mappings.types.bug', 'Size'), false)
  assert.equal(describeRaw(raw).teams[0].exists('mappings.fields.estimate', 'native'), false)
})

test('the Linear description feeds the generic rules', async () => {
  const raw = await discover({ states: SANDBOX_STATES })
  const description = describeRaw(raw)
  const first = proposeMappings(description, {}, {})
  assert.equal(first.team, 'ACME')
  assert.deepEqual(first.questions.map((q) => q.path), [
    'mappings.status.in_review', 'mappings.status.blocked',
    'mappings.types.feature', 'mappings.types.bug', 'mappings.types.task', 'mappings.types.chore',
  ])
  assert.match(first.notes[0], /^team ACME has estimates off; turn them on/)
  const broken = brokenMappings(description, pmkitWith({ status: { in_review: 'Gone' }, types: { bug: 'Lost' } }))
  assert.deepEqual(broken.map((item) => item.problem), [
    'mappings.status.in_review names Gone, which team ACME no longer has',
    'mappings.types.bug names Lost, which is neither a label of team ACME nor of the workspace',
  ])
})

// resolveMappings

async function resolve(mappings, options = {}) {
  const raw = await discover(options)
  const pmkit = pmkitWith(mappings)
  return resolveMappings(discoveryView(raw, pmkit), pmkit)
}

test('rule 1: a mapped in_review state takes the category, blocked and none never change one', async () => {
  const mapped = await resolve({ status: { in_review: 'Code Review', blocked: 'In Progress' } })
  assert.equal(mapped.team, 'ACME')
  assert.equal(mapped.categoryOf('Code Review'), 'in_review')
  assert.equal(mapped.categoryOf('In Review'), 'in_progress')
  assert.equal(mapped.categoryOf('In Progress'), 'in_progress')
  assert.equal(mapped.categoryOf('Duplicate'), 'canceled')
  assert.equal(mapped.categoryOf('Nope'), null)
  const none = await resolve({ status: { in_review: 'none', blocked: 'none' } })
  assert.equal(none.categoryOf('In Review'), 'in_progress')
  assert.equal(none.categoryOf('none'), null)
})

test('rule 2: the move target is the mapped state, else the first by position, else null', async () => {
  const mapped = await resolve({ status: { in_review: 'Code Review' } })
  assert.deepEqual(mapped.targetState('in_review'), { id: 'state-5', name: 'Code Review' })
  assert.deepEqual(mapped.targetState('in_progress'), { id: 'state-3', name: 'In Progress' })
  const unmapped = await resolve({})
  assert.equal(unmapped.targetState('in_review'), null)
  assert.deepEqual(unmapped.targetState('todo'), { id: 'state-2', name: 'Todo' })
  assert.deepEqual((await resolve({ status: { in_review: 'none' } })).targetState('in_review'), null)
  assert.deepEqual(unmapped.targetState('done'), { id: 'state-8', name: 'Done' })
})

test('rule 3: the blocked state keeps its type category', async () => {
  const mapped = await resolve({ status: { blocked: 'UAT' } })
  assert.deepEqual(mapped.blockedState, { id: 'state-6', name: 'UAT' })
  assert.equal(mapped.categoryOf('UAT'), 'in_progress')
  assert.equal((await resolve({ status: { blocked: 'none' } })).blockedState, null)
  assert.equal((await resolve({})).blockedState, null)
})

test('rule 4: native gives native, none, absent or estimates off give null', async () => {
  const on = { teams: [{ id: ACME_TEAM_ID, key: 'ACME', name: 'Acme', issueEstimationType: 'fibonacci' }] }
  assert.equal((await resolve({ fields: { estimate: 'native' } }, on)).estimate, 'native')
  assert.equal((await resolve({ fields: { estimate: 'none' } }, on)).estimate, null)
  assert.equal((await resolve({}, on)).estimate, null)
  assert.equal((await resolve({ fields: { estimate: 'native' } })).estimate, null)
})

test('rule 5: types hold id and name, typeOf follows the file order and a team label wins', async () => {
  const mapped = await resolve({ types: { bug: 'Bug', feature: 'Feature', chore: 'Docs' } })
  assert.deepEqual(mapped.types, { bug: { id: 'label-bug', name: 'Bug' }, feature: { id: 'label-feature', name: 'Feature' }, chore: { id: 'label-docs', name: 'Docs' } })
  assert.equal(mapped.typeOf(['Bug', 'Docs']), 'bug')
  assert.equal(mapped.typeOf(['Docs', 'Feature']), 'feature')
  assert.equal(mapped.typeOf(['XS']), null)
  assert.equal(mapped.typeOf([]), null)
  const labels = [...fakeWorkspaceLabels(), { id: 'label-ws-bug', name: 'Bug', isGroup: false, retiredAt: null, team: null, parent: null }]
  assert.equal((await resolve({ types: { bug: 'Bug' } }, { labels })).types.bug.id, 'label-bug')
  const absent = await resolve({})
  assert.deepEqual(absent.types, {})
  assert.equal(absent.typeOf(['Bug']), null)
})

test('resolveMappings takes the raw discovery as a third argument and needs a team', async () => {
  const raw = await discover()
  const pmkit = pmkitWith({ types: { bug: 'Bug' } })
  assert.equal(resolveMappings({ ...discoveryView(raw, pmkit) }, pmkit, raw).types.bug.id, 'label-bug')
  assert.throws(() => resolveMappings({}, pmkit), TypeError)
  assert.throws(() => resolveMappings(discoveryView(raw, pmkit), { tracker: { scope: {} } }), (error) => error.code === 'NOT_CONFIGURED')
})

test('the view keeps its keys: the raw discovery is hidden', async () => {
  const raw = await discover()
  const view = discoveryView(raw, pmkitWith())
  assert.ok(!Object.keys(view).includes('raw'))
  assert.ok(!JSON.stringify(view).includes('state-1'))
})
