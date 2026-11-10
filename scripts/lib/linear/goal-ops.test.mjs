// Linear initiatives as goals (PMK-213): the three reads over the fake API.
import assert from 'node:assert/strict'
import test from 'node:test'
import { ACME_STATES, ACME_TEAM, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeLinearProjects, fakeWorkspace, json, page } from '../../fake-linear-api.mjs'
import { createLinearClient, operationName } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { goalOperations } from './goal-ops.mjs'
import { projectOperations } from './project-ops.mjs'

const NOW = new Date('2026-10-28T12:00:00Z')
const code = (value) => (error) => error.code === value

/** A project node as the initiative query returns it. */
const projectNode = (project, type = 'started') => ({ id: project.id, slugId: project.slugId, identifier: project.identifier, name: project.name, status: { name: type, type } })

function initiative(extra) {
  return { id: 'a1b2c3d4-0000-4000-8000-000000000001', slugId: 'abcdef123456', identifier: null, name: 'Grow', description: 'Short', content: null, status: 'Active', targetDate: null, url: 'https://linear.app/acme/initiative/grow', projects: page([]), ...extra }
}

/** The fakes and the goal operations. `initiatives(projects)` builds the initiative nodes from the seeded project records. */
function kit(initiatives = () => [], { pages } = {}) {
  const issues = fakeLinearIssues({ teams: [ACME_TEAM], states: ACME_STATES })
  const fake = fakeLinearProjects({ issues, teams: [ACME_TEAM], states: ACME_STATES })
  const route = (body) => {
    const nodes = initiatives(fake.projects)
    if (pages) return json({ initiatives: page(nodes, { hasNextPage: true, endCursor: `c${body.variables.after ?? 0}1` }) })
    return json({ initiatives: page(nodes) })
  }
  const fetch = fakeLinearFetch({ ...fakeWorkspace({ teams: [ACME_TEAM], states: ACME_STATES }), ...issues.routes, ...fake.routes, PmkitInitiatives: route })
  const config = { pmkit: { tracker: { system: 'linear', scope: { workspace: 'acme', team: 'ACME' } } } }
  const client = createLinearClient({ env: { LINEAR_API_KEY: FAKE_KEY }, tracker: config.pmkit.tracker, fetch })
  let memo
  const discovery = () => (memo ??= fetchDiscovery(client, { now: () => NOW }).then((raw) => ({ raw })))
  const projects = projectOperations({ client, discovery, config, now: () => NOW, uuid: () => 'generated' })
  const ops = goalOperations({ client, config, projects })
  const sent = () => fetch.calls.filter((call) => operationName(call.body.query) === 'PmkitInitiatives')
  return { issues, fake, ops, sent }
}

test('listGoals maps initiatives to goals, sorted by target, with the team filter on their projects', async () => {
  const { fake, ops, sent } = kit((projects) => [
    initiative({ id: 'i-2', slugId: '222222222222', identifier: null, name: 'Later', status: 'Planned', projects: page([projectNode(projects[0])]) }),
    initiative({ id: 'i-1', slugId: '111111111111', identifier: 'ini-1', name: 'Sooner', status: 'Completed', targetDate: '2026-12-31', content: 'Long text', projects: page([]) }),
  ])
  fake.seed({ name: 'Launch', teamIds: ['team-acme'] })
  const { goals, problems } = await ops.listGoals()
  assert.deepEqual(problems, [])
  assert.deepEqual(goals, [
    { id: 'INI-1', title: 'Sooner', status: 'completed', target: '2026-12-31', description: 'Long text', url: 'https://linear.app/acme/initiative/grow', epics: [] },
    { id: '222222222222', title: 'Later', status: 'planned', description: 'Short', url: 'https://linear.app/acme/initiative/grow', epics: ['P-ACM-1'] },
  ])
  assert.deepEqual(sent()[0].body.variables.projectFilter, { accessibleTeams: { some: { key: { eq: 'ACME' } } } })
})

test('listGoals reports a cut read of initiatives and of a goal\'s projects as INCOMPLETE goal problems', async () => {
  const cut = kit(() => [initiative()], { pages: true })
  const { problems } = await cut.ops.listGoals()
  assert.deepEqual(problems.map((problem) => [problem.id, problem.kind, problem.code]), [[null, 'goal', 'INCOMPLETE']])
  const many = kit(() => [initiative({ projects: page([], { hasNextPage: true, endCursor: 'x' }) })])
  const listed = await many.ops.listGoals()
  assert.deepEqual(listed.problems.map((problem) => [problem.id, problem.code]), [['abcdef123456', 'INCOMPLETE']])
  assert.equal('epicsMore' in listed.goals[0], false)
  assert.equal('epicsMore' in (await many.ops.getGoal('abcdef123456')), false)
})

test('getGoal finds a goal by identifier in any case, by slug and by UUID, and a missing key is NOT_FOUND', async () => {
  const { ops } = kit(() => [initiative({ identifier: 'INI-7' })])
  for (const key of ['ini-7', 'INI-7', 'abcdef123456', 'A1B2C3D4-0000-4000-8000-000000000001']) assert.equal((await ops.getGoal(key)).id, 'INI-7', key)
  await assert.rejects(ops.getGoal('INI-9'), code('NOT_FOUND'))
})

test('goalProgress sums the epics as Local does, a canceled project is not counted, and a cut epic read warns', async () => {
  const { fake, issues, ops } = kit((projects) => [initiative({ projects: page([projectNode(projects[0]), projectNode(projects[1], 'canceled')]) })])
  const live = fake.seed({ name: 'Live', teamIds: ['team-acme'] })
  const dead = fake.seed({ name: 'Dead', teamIds: ['team-acme'] })
  issues.seed({ title: 'A', projectId: live.id, stateId: 'state-8' })
  issues.seed({ title: 'B', projectId: live.id, stateId: 'state-2' })
  issues.seed({ title: 'C', projectId: dead.id, stateId: 'state-2' })
  const progress = await ops.goalProgress('abcdef123456')
  assert.equal(progress.goal.id, 'abcdef123456')
  assert.deepEqual(progress.epics.map((epic) => [epic.id, epic.status.category, epic.counted, epic.progress.total]), [['P-ACM-1', 'in_progress', true, 2], ['P-ACM-2', 'canceled', false, 1]])
  assert.equal(progress.total, 2)
  assert.deepEqual(progress.warnings, [])
  const cut = kit(() => [initiative({ projects: page([], { hasNextPage: true, endCursor: 'x' }) })])
  assert.match((await cut.ops.goalProgress('abcdef123456')).warnings[0], /more than 50 projects/)
})

test('goalProgress warns when an epic read was cut at the issue cap', async () => {
  const node = initiative({ projects: page([{ id: 'p1', slugId: '0123456789ab', identifier: 'P-ACM-1', name: 'Big', status: { name: 'Started', type: 'started' } }]) })
  const fetch = fakeLinearFetch({ ...fakeWorkspace(), PmkitInitiatives: json({ initiatives: page([node]) }) })
  const config = { pmkit: { tracker: { system: 'linear', scope: { workspace: 'acme', team: 'ACME' } } } }
  const client = createLinearClient({ env: { LINEAR_API_KEY: FAKE_KEY }, tracker: config.pmkit.tracker, fetch })
  const zero = { total: 0, done: 0, canceled: 0, points: 0, pointsDone: 0, byCategory: Object.fromEntries(['triage', 'backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'].map((category) => [category, 0])) }
  const ops = goalOperations({ client, config, projects: { deliverableProgress: async () => ({ ...zero, hasMore: true }) } })
  assert.deepEqual((await ops.goalProgress('abcdef123456')).warnings, ['P-ACM-1: Linear has more issues in this epic than the 1000 pmkit read; goal progress may be low'])
})
