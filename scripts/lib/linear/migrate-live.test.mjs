// Offline tests of the live migration run: its allowlist, the writer's documents through the guard, and the gate.
// No test here touches the network or the real user store.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { COMMENT_CREATE, COMMENT_RESOLVE, ISSUE_ARCHIVE, ISSUE_CREATE, ISSUE_DELETE, LABEL_CREATE, LABEL_DELETE, RELATION_CREATE } from './documents.mjs'
import { PROJECT_CREATE, PROJECT_DELETE, PROJECT_UPDATE_CREATE } from './projects.mjs'
import { readMutation, TEAM_CREATE, TEST_TEAM } from './sandbox.mjs'
import { createLinearClient } from './client.mjs'
import { ACME_LABELS, ACME_STATES, ACME_TEAM, ACME_TEAM_ID, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeLinearProjects, fakeWorkspace, json } from '../../fake-linear-api.mjs'
import { childEnv } from '../../golden-helpers.mjs'
import { makeRepo, tempDir, userStoreEnv } from '../../test-helpers.mjs'
import { loadConfig } from '../config.mjs'
import { readLocalSnapshot } from '../local/migrate-reader.mjs'
import { readMap } from '../migrate/id-map.mjs'
import {
  EXPORT_MUTATIONS, FIXTURE_TITLES, MIGRATE_CAP, UNDO_MUTATIONS, adoptTeamIds, createLiveRun, buildLiveFixture, compareImport, compareReadBack, importRepository,
  interruptAfter, migrateAllowlist, migrateGuardedFetch, migrateSteps, readBack, trashCreated,
} from './migrate-live.mjs'

process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir())

/** Every mutation document the migration writer sends, by root field. */
const WRITER_DOCUMENTS = {
  issueLabelCreate: LABEL_CREATE, projectCreate: PROJECT_CREATE, issueCreate: ISSUE_CREATE, issueRelationCreate: RELATION_CREATE,
  commentCreate: COMMENT_CREATE, commentResolve: COMMENT_RESOLVE, projectUpdateCreate: PROJECT_UPDATE_CREATE, issueArchive: ISSUE_ARCHIVE,
  issueDelete: ISSUE_DELETE, projectDelete: PROJECT_DELETE, issueLabelDelete: LABEL_DELETE,
}

const TEAM = 'team-test'
const ok = () => ({ status: 200, ok: true, headers: new Headers(), text: async () => JSON.stringify({ data: {} }) })

/** A guard over a stub fetch, opened on TEAM, with one owned id of each kind. */
function openGuard() {
  const sent = []
  const { fetch, guard } = migrateGuardedFetch({ fetch: async (url, init) => { sent.push(JSON.parse(init.body)); return ok() }, workspace: 'acme' })
  guard.open({ teamExists: true, teamId: TEAM, viewerId: 'user-1', labelIds: ['label-bug'] })
  for (const kind of ['issue', 'project', 'comment', 'label', 'update', 'state', 'projectStatus']) guard.own(kind, `${kind}-1`)
  const send = (query, variables) => fetch('https://api.linear.app/graphql', { method: 'POST', body: JSON.stringify({ query, variables }) })
  return { send, sent, guard }
}

/** Variables for each writer document that name only the test team and owned ids. */
const FITTING = {
  issueLabelCreate: { input: { id: 'label-2', name: 'needs-criteria', teamId: TEAM } },
  projectCreate: { input: { id: 'project-2', name: 'Epic', teamIds: [TEAM], statusId: 'projectStatus-1', leadId: 'user-1' } },
  issueCreate: { input: { id: 'issue-2', title: 'T', teamId: TEAM, stateId: 'state-1', labelIds: ['label-bug', 'label-1'], parentId: 'issue-1', projectId: 'project-1', assigneeId: 'user-1' } },
  issueRelationCreate: { input: { id: 'relation-2', issueId: 'issue-1', relatedIssueId: 'issue-1', type: 'blocks' } },
  commentCreate: { input: { id: 'comment-2', issueId: 'issue-1', parentId: 'comment-1', body: 'B' } },
  commentResolve: { id: 'comment-1' },
  projectUpdateCreate: { input: { id: 'update-2', projectId: 'project-1', body: 'B', health: 'onTrack' } },
  issueArchive: { id: 'issue-1' },
  issueDelete: { id: 'issue-1' },
  projectDelete: { id: 'project-1' },
  issueLabelDelete: { id: 'label-1' },
}

test('the allowlist is exactly the mutations export and undo send', () => {
  const allowlist = migrateAllowlist(() => {})
  assert.deepEqual(Object.keys(allowlist).sort(), [...EXPORT_MUTATIONS, ...UNDO_MUTATIONS].sort())
  assert.deepEqual(Object.keys(WRITER_DOCUMENTS).sort(), Object.keys(allowlist).sort())
  assert.equal(MIGRATE_CAP, 250)
})

test('every writer document has the shape the guard accepts and the root it is listed under', () => {
  for (const [root, document] of Object.entries(WRITER_DOCUMENTS)) {
    const read = readMutation(document)
    assert.equal(read.reason, null, `${root}: ${read.reason}`)
    assert.equal(read.root, root)
  }
})

test('the guard sends every writer document with the test team and owned ids', async () => {
  const { send, sent, guard } = openGuard()
  for (const [root, document] of Object.entries(WRITER_DOCUMENTS)) await send(document, FITTING[root])
  assert.equal(sent.length, Object.keys(WRITER_DOCUMENTS).length)
  assert.deepEqual(guard.stats().refused, [])
})

test('the guard refuses another team, an id the run did not create and a mutation off the list', async () => {
  const cases = [
    [ISSUE_CREATE, { input: { ...FITTING.issueCreate.input, teamId: 'team-other' } }, /teamId is not the test team/],
    [ISSUE_CREATE, { input: { ...FITTING.issueCreate.input, parentId: 'issue-foreign' } }, /parentId issue-foreign/],
    [ISSUE_CREATE, { input: { ...FITTING.issueCreate.input, subscriberIds: ['user-2'] } }, /subscriberIds is not one the run checks/],
    [ISSUE_CREATE, { input: { ...FITTING.issueCreate.input, assigneeId: 'user-2' } }, /assigneeId user-2/],
    [PROJECT_CREATE, { input: { ...FITTING.projectCreate.input, teamIds: [TEAM, 'team-other'] } }, /teamIds is not exactly the test team/],
    [LABEL_CREATE, { input: { name: 'x', teamId: TEAM } }, /must choose its id/],
    [RELATION_CREATE, { input: { id: 'relation-3', issueId: 'issue-1', relatedIssueId: 'issue-foreign', type: 'blocks' } }, /relatedIssueId/],
    [ISSUE_DELETE, { id: 'issue-foreign' }, /not a issue the run created/],
    [PROJECT_DELETE, { id: 'issue-1' }, /not a project the run created/],
    [LABEL_DELETE, { id: 'label-bug' }, /not a label the run created/],
    [TEAM_CREATE, { input: { name: 'x' } }, /teamCreate|not on the allowlist|not one/i],
    ['mutation PmkitBad { issueDelete(id: "issue-1") { success } }', {}, /issueDelete|argument|\$id/],
  ]
  for (const [query, variables, reason] of cases) {
    const { send, sent } = openGuard()
    await assert.rejects(send(query, variables), reason)
    assert.deepEqual(sent, [])
  }
})

test('a create owns its chosen id only once its rule passes', async () => {
  const { send, guard } = openGuard()
  await assert.rejects(send(LABEL_CREATE, { input: { id: 'label-x', name: 'x', teamId: 'team-other' } }))
  await assert.rejects(send(LABEL_DELETE, { id: 'label-x' }), /not a label the run created/)
  await send(LABEL_CREATE, { input: { id: 'label-y', name: 'y', teamId: TEAM } })
  await send(LABEL_DELETE, { id: 'label-y' })
  assert.equal(guard.stats().refused.length, 2)
})

function linearFake() {
  const teams = [{ ...ACME_TEAM, cyclesEnabled: true, issueEstimationType: 'fibonacci' }]
  const issues = fakeLinearIssues({ teams, labels: ACME_LABELS })
  const projects = fakeLinearProjects({ issues, teams })
  const routes = {
    ...fakeWorkspace({ teams, labels: ACME_LABELS }), ...issues.routes, ...projects.routes,
    PmkitSandboxStates: json({ team: { states: { nodes: ACME_STATES } } }),
  }
  return { fetch: fakeLinearFetch(routes), mutations: () => [...issues.mutations, ...(projects.mutations ?? [])] }
}

test('the live steps export and undo the fixture through the guard with nothing refused', async () => {
  const root = makeRepo('basic')
  buildLiveFixture(root)
  const env = { ...childEnv(), ...userStoreEnv().env, LINEAR_API_KEY: FAKE_KEY }
  const fake = linearFake()
  const { fetch, guard } = migrateGuardedFetch({ fetch: fake.fetch, workspace: 'acme' })
  guard.open({ teamExists: true, teamId: ACME_TEAM_ID, viewerId: 'user-1', labelIds: ['label-bug', 'label-feature'] })
  const client = createLinearClient({ env, tracker: { system: 'linear', scope: { workspace: 'acme' } }, fetch })
  await adoptTeamIds({ client, team: { id: ACME_TEAM_ID }, guard })
  const steps = migrateSteps({ root, env, fetch, workspace: 'acme', team: { id: ACME_TEAM_ID, key: ACME_TEAM.key } })

  const dry = await steps.exportDry()
  assert.equal(dry.code, 0, JSON.stringify(dry.error))
  const real = await steps.exportReal(dry.data.digest)
  assert.equal(real.code, 0, JSON.stringify(real.error))
  assert.equal(real.data.done, real.data.total)
  const undoDry = await steps.undoDry(real.data.map)
  assert.equal(undoDry.code, 0, JSON.stringify(undoDry.error))
  assert.equal(undoDry.data.removals.filter((removal) => removal.kind === 'issue').length, FIXTURE_TITLES.length)
  const undo = await steps.undoReal(real.data.map, undoDry.data.digest)
  assert.equal(undo.code, 0, JSON.stringify(undo.error))
  assert.equal(undo.data.removed, undoDry.data.removals.length)

  const stats = guard.stats()
  assert.deepEqual(stats.refused, [])
  assert.ok(stats.requests < MIGRATE_CAP, `${stats.requests} requests`)
  const roots = new Set(fake.fetch.calls.map((call) => readMutation(call.body.query)).filter((read) => read.root).map((read) => read.root))
  for (const root of roots) assert.ok([...EXPORT_MUTATIONS, ...UNDO_MUTATIONS].includes(root), root)
})

/** The fixture exported over the fake through the guard, with a client on the same guarded fetch. */
function fakeRun() {
  const root = makeRepo('basic')
  buildLiveFixture(root)
  const env = { ...childEnv(), ...userStoreEnv().env, LINEAR_API_KEY: FAKE_KEY }
  const fake = linearFake()
  const { fetch, guard, created } = migrateGuardedFetch({ fetch: fake.fetch, workspace: 'acme' })
  guard.open({ teamExists: true, teamId: ACME_TEAM_ID, viewerId: 'user-1', labelIds: ['label-bug', 'label-feature'] })
  const client = createLinearClient({ env, tracker: { system: 'linear', scope: { workspace: 'acme' } }, fetch })
  const team = { id: ACME_TEAM_ID, key: ACME_TEAM.key }
  return { root, env, fake, fetch, guard, created, client, team }
}

const localSnapshot = (root) => readLocalSnapshot({ root, config: loadConfig(root) })

test('the live steps cut the export, resume it, read it back, import it and undo it over the fake', async (t) => {
  const { root, env, fake, fetch, guard, client, team } = await fakeRun()
  await adoptTeamIds({ client, team, guard })
  const cut = interruptAfter(fetch, 2)
  const steps = migrateSteps({ root, env, fetch: cut.fetch, workspace: 'acme', team })

  const dry = await steps.exportDry()
  assert.equal(dry.code, 0, JSON.stringify(dry.error))
  const failed = await steps.exportReal(dry.data.digest)
  assert.notEqual(failed.code, 0, JSON.stringify(failed.data))
  const lost = cut.cut()
  assert.ok(lost?.uuid, 'the second mutation was sent and its answer lost')
  assert.equal(fake.mutations().length, 2)
  const cutMap = readMap(root, '.pmkit/migrations/2026-10-23-export-linear.yaml')
  const sent = Object.values(cutMap.records).flatMap((records) => Object.values(records)).filter((entry) => entry.state === 'sent')
  assert.deepEqual(sent.map((entry) => entry.uuid), [lost.uuid], 'the map holds the lost create as sent')
  cut.heal()

  const again = await steps.exportDry()
  assert.equal(again.code, 0, JSON.stringify(again.error))
  const resumed = await steps.exportReal(again.data.digest)
  assert.equal(resumed.code, 0, JSON.stringify(resumed.error))
  assert.equal(resumed.data.done, resumed.data.total)
  const map = readMap(root, resumed.data.map)
  const entries = Object.values(map.records).flatMap((records) => Object.values(records))
  assert.ok(entries.every((entry) => entry.state === 'done'))
  assert.equal(entries.filter((entry) => entry.uuid === lost.uuid).length, 1, 'the resume kept the lost create by its UUID')

  const linear = await readBack({ client, team })
  assert.deepEqual(linear.issues.map((node) => node.title).sort(), [...FIXTURE_TITLES].sort(), 'no issue was created twice')
  assert.equal(linear.projects.length, 1)
  assert.deepEqual(compareReadBack({ source: localSnapshot(root), map, linear }), [])

  const target = importRepository({ source: root, map: resumed.data.map, root: tempDir('pmkit-live-import-') })
  const importDry = await steps.importDry(target)
  assert.equal(importDry.code, 0, JSON.stringify(importDry.error))
  const imported = await steps.importReal(target, importDry.data.digest)
  assert.equal(imported.code, 0, JSON.stringify(imported.error))
  assert.deepEqual(compareImport({ before: localSnapshot(root), after: localSnapshot(target) }), [])

  const undoDry = await steps.undoDry(resumed.data.map)
  assert.equal(undoDry.code, 0, JSON.stringify(undoDry.error))
  const undo = await steps.undoReal(resumed.data.map, undoDry.data.digest)
  assert.equal(undo.code, 0, JSON.stringify(undo.error))
  assert.equal(undo.data.removed, undoDry.data.removals.length)

  const stats = guard.stats()
  assert.deepEqual(stats.refused, [])
  assert.ok(stats.requests < MIGRATE_CAP, `${stats.requests} requests`)
  t.diagnostic(`requests ${stats.requests}, writes ${stats.writes}`)
})

test('compareReadBack names a changed title, a lost parent, a lost link and a comment without its attribution line', async () => {
  const { root, env, fetch, guard, client, team } = await fakeRun()
  await adoptTeamIds({ client, team, guard })
  const steps = migrateSteps({ root, env, fetch, workspace: 'acme', team })
  const real = await steps.exportReal((await steps.exportDry()).data.digest)
  assert.equal(real.code, 0, JSON.stringify(real.error))
  const linear = await readBack({ client, team })
  const map = readMap(root, real.data.map)
  const byTitle = (title) => linear.issues.find((node) => node.title === title)
  byTitle('Migrate the related issue').title = 'Renamed'
  byTitle('Migrate the child').parent = null
  for (const node of linear.issues) node.relations.nodes = node.relations.nodes.filter((relation) => relation.type !== 'blocks')
  for (const comment of byTitle('Migrate the child').comments.nodes) comment.body = 'A comment the export attributes.'
  const found = compareReadBack({ source: localSnapshot(root), map, linear }).join('\n')
  assert.match(found, /title/)
  assert.match(found, /parent/)
  assert.match(found, /blocks/)
  assert.match(found, /attribution/)
})

test('compareImport names a field that changed and ignores the listed losses', () => {
  const issue = { id: 'ISS-1', title: 'A', parent: null, branch: 'x', created: '2026-10-01T00:00:00.000Z' }
  const epic = { id: 'EPC-1', title: 'E', created: '2026-10-01T00:00:00.000Z', updates: [{ id: 'u', at: 'a', author: 'fred', health: 'on_track', body: 'B' }] }
  const before = { issues: [issue], epics: [epic], links: [], comments: [] }
  const same = { issues: [{ ...issue, branch: 'y' }], epics: [{ ...epic, created: 'other', updates: [{ id: 'v', at: 'b', author: 'ada', health: 'on_track', body: 'B' }] }], links: [], comments: [] }
  assert.deepEqual(compareImport({ before, after: same }), [])
  const changed = { ...same, issues: [{ ...issue, title: 'B' }], links: [{ kind: 'blocks', from: 'ISS-1', to: 'ISS-2' }] }
  const found = compareImport({ before, after: changed }).join('\n')
  assert.match(found, /ISS-1 title/)
  assert.match(found, /links/)
})

test('interruptAfter sends the nth mutation, loses its answer, and sends nothing more until heal', async () => {
  const sent = []
  const fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return ok() }
  const cut = interruptAfter(fetch, 2)
  const send = (query, variables) => cut.fetch('https://api.linear.app/graphql', { method: 'POST', body: JSON.stringify({ query, variables }) })
  await send('query PmkitRead { viewer { id } }', {})
  await send(ISSUE_ARCHIVE, { id: 'issue-1' })
  assert.equal(cut.cut(), null)
  await assert.rejects(send(ISSUE_CREATE, { input: { id: 'issue-2', title: 'T' } }), /cut the connection after mutation 2/)
  assert.equal(sent.length, 3, 'the cut mutation reached the server')
  assert.deepEqual(cut.cut(), { root: 'issueCreate', uuid: 'issue-2' })
  await assert.rejects(send('query PmkitRead { viewer { id } }', {}), (error) => error.guardRefusal === true)
  assert.equal(sent.length, 3, 'nothing is sent while the connection is cut')
  cut.heal()
  await send(ISSUE_CREATE, { input: { id: 'issue-3', title: 'T' } })
  assert.equal(sent.length, 4)
})

test('migrateGuardedFetch lists the labels and updates the run created', async () => {
  const sent = []
  const { fetch, guard, created } = migrateGuardedFetch({ fetch: async (url, init) => { sent.push(init); return ok() }, workspace: 'acme' })
  guard.open({ teamExists: true, teamId: TEAM, viewerId: 'user-1', labelIds: [] })
  guard.own('project', 'project-1')
  const send = (query, variables) => fetch('https://api.linear.app/graphql', { method: 'POST', body: JSON.stringify({ query, variables }) })
  await send(LABEL_CREATE, { input: { id: 'label-9', name: 'x', teamId: TEAM } })
  await send(PROJECT_UPDATE_CREATE, { input: { id: 'update-9', projectId: 'project-1', body: 'B', health: 'onTrack' } })
  assert.deepEqual(created('label'), ['label-9'])
  assert.deepEqual(created('update'), ['update-9'])
})

test('trashCreated deletes only the issues, projects and labels the run created', async () => {
  const page = (nodes) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } })
  const answers = {
    PmkitSession: { viewer: { id: 'user-1', name: 'Ada' }, organization: { urlKey: 'acme', name: 'Acme', previousUrlKeys: [] } },
    PmkitSandboxIssues: { issues: page([{ id: 'issue-1' }, { id: 'issue-foreign' }]) },
    PmkitSandboxProjects: { projects: page([{ id: 'project-1', teams: { nodes: [{ id: TEAM }] } }, { id: 'project-foreign', teams: { nodes: [{ id: TEAM }] } }]) },
  }
  const sent = []
  const stub = async (url, init) => {
    const body = JSON.parse(init.body)
    sent.push(body)
    const name = /(?:query|mutation)\s+(\w+)/.exec(body.query)[1]
    const data = answers[name] ?? { [readMutation(body.query).root]: { success: true } }
    return { status: 200, ok: true, headers: new Headers(), text: async () => JSON.stringify({ data }) }
  }
  const { fetch, guard, created } = migrateGuardedFetch({ fetch: stub, workspace: 'acme' })
  guard.open({ teamExists: true, teamId: TEAM, viewerId: 'user-1', labelIds: [] })
  const env = { ...childEnv(), LINEAR_API_KEY: FAKE_KEY }
  const client = createLinearClient({ env, tracker: { system: 'linear', scope: { workspace: 'acme' } }, fetch })
  const send = (query, variables) => fetch('https://api.linear.app/graphql', { method: 'POST', body: JSON.stringify({ query, variables }) })
  guard.own('projectStatus', 'status-1')
  await send(PROJECT_CREATE, { input: { id: 'project-1', name: 'E', teamIds: [TEAM], statusId: 'status-1' } })
  await send(ISSUE_CREATE, { input: { id: 'issue-1', title: 'T', teamId: TEAM } })
  await send(LABEL_CREATE, { input: { id: 'label-1', name: 'x', teamId: TEAM } })
  sent.length = 0

  const result = await trashCreated({ client, team: { id: TEAM, key: 'PKT' }, created, labels: true })
  assert.deepEqual(result, { removed: { issues: 1, projects: 1, labels: 1 }, failed: [], foreign: 2 })
  const writes = sent.filter((body) => /^\s*mutation/.test(body.query)).map((body) => [readMutation(body.query).root, body.variables.id])
  assert.deepEqual(writes, [['issueDelete', 'issue-1'], ['projectDelete', 'project-1'], ['issueLabelDelete', 'label-1']])
  assert.deepEqual(guard.stats().refused, [])
})

const RATE_HEADERS = {
  'x-ratelimit-requests-limit': '2500', 'x-ratelimit-requests-remaining': '2400', 'x-ratelimit-requests-reset': '1798000000000',
  'x-ratelimit-complexity-limit': '3000000', 'x-ratelimit-complexity-remaining': '2900000', 'x-ratelimit-complexity-reset': '1798000000000',
}

/** The sandbox workspace over the fake: the test team PKT with its marker, triage and cycles, the reads of preflight, and rate-limit headers. */
function sandboxFake() {
  const team = { ...ACME_TEAM, key: TEST_TEAM.key, name: TEST_TEAM.name, description: `marker ${TEST_TEAM.marker}`, archivedAt: null, cyclesEnabled: true, triageEnabled: true, issueEstimationType: 'fibonacci' }
  const teams = [team]
  const issues = fakeLinearIssues({ teams, labels: ACME_LABELS })
  const projects = fakeLinearProjects({ issues, teams })
  const page = (nodes) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } })
  const routes = {
    ...fakeWorkspace({ teams, labels: ACME_LABELS }), ...issues.routes, ...projects.routes,
    PmkitSandboxTeams: json({ organization: { subscription: null }, teams: { nodes: [team] } }),
    PmkitSandboxTeam: json({ teams: { nodes: [team] } }),
    PmkitSandboxStates: json({ team: { states: { nodes: [...ACME_STATES, { id: 'state-triage', name: 'Triage', type: 'triage' }] } } }),
    PmkitSandboxLabels: json({ issueLabels: page(ACME_LABELS.map((label) => ({ id: label.id, name: label.name, isGroup: Boolean(label.isGroup), retiredAt: null, team: null }))) }),
    PmkitSandboxIssues: () => json({ issues: page(issues.nodes().map(({ id, identifier, trashed, archivedAt }) => ({ id, identifier, trashed, archivedAt }))) }),
    PmkitSandboxIssueDelete: issues.routes.PmkitIssueDelete,
    PmkitSandboxProjectDelete: projects.routes.PmkitProjectDelete,
    PmkitSandboxProjects: () => json({ projects: page(projects.projects.map((project) => ({ id: project.id, name: project.name, trashed: false, archivedAt: null, teams: { nodes: project.teamIds.map((id) => ({ id })) } }))) }),
  }
  for (const [name, route] of Object.entries(routes)) {
    routes[name] = (body) => {
      const answer = typeof route === 'function' ? route(body) : route
      return { ...answer, headers: { ...answer.headers, ...RATE_HEADERS } }
    }
  }
  const held = () => ({ issues: issues.nodes().filter((node) => !node.trashed).length, projects: projects.projects.length })
  return { fetch: fakeLinearFetch(routes), held }
}

function liveOverFake() {
  const fake = sandboxFake()
  const lines = []
  const env = { ...childEnv(), ...userStoreEnv().env, LINEAR_API_KEY: FAKE_KEY, PMKIT_LIVE: '1', PMKIT_LIVE_WORKSPACE: 'acme' }
  const run = createLiveRun({ env, fetch: fake.fetch, workspace: 'acme', write: (line) => lines.push(line) })
  return { fake, lines, run }
}

test('the live run passes over a fake sandbox and leaves the test team empty', async (t) => {
  const { fake, lines, run } = liveOverFake()
  await run.setUp()
  try {
    for (const [name, fn] of run.cases) await t.test(name, fn)
  } finally {
    await run.tearDown()
  }
  assert.deepEqual(fake.held(), { issues: 0, projects: 0 })
  const stats = lines.find((line) => line.startsWith('requests '))
  assert.match(stats, /refused 0$/)
  assert.ok(!lines.some((line) => /did not finish|cleanup failed|trashed/.test(line)), lines.join('\n'))
  t.diagnostic(stats)
})

test('the after hook undoes and trashes an export that stopped at the cut', async () => {
  const { fake, lines, run } = liveOverFake()
  await run.setUp()
  try {
    const dry = await run.state.steps.exportDry()
    run.state.exported = true
    const failed = await run.state.steps.exportReal(dry.data.digest)
    assert.notEqual(failed.code, 0)
    assert.ok(fake.held().issues + fake.held().projects > 0, 'the cut export wrote')
  } finally {
    await run.tearDown()
  }
  assert.deepEqual(fake.held(), { issues: 0, projects: 0 })
  assert.ok(lines.some((line) => /the undo did not finish/.test(line)), lines.join('\n'))
  assert.ok(!lines.some((line) => /cleanup failed/.test(line)), lines.join('\n'))
})

test('the after hook trashes what the run created when the undo cannot run', async () => {
  const { fake, lines, run } = liveOverFake()
  await run.setUp()
  try {
    const dry = await run.state.steps.exportDry()
    run.state.exported = true
    await run.state.steps.exportReal(dry.data.digest)
    // A map the undo cannot read stands for an undo that fails; the cleanup still removes the run's records.
    run.state.map = '.pmkit/migrations/missing.yaml'
  } finally {
    await run.tearDown()
  }
  assert.deepEqual(fake.held(), { issues: 0, projects: 0 }, lines.join('\n'))
  assert.ok(lines.some((line) => /the undo failed again/.test(line)), lines.join('\n'))
  assert.ok(lines.some((line) => /trashed what the undo left/.test(line)), lines.join('\n'))
})

test('node --test of the live file skips without the gate variables', () => {
  const env = { ...process.env }
  for (const name of ['PMKIT_LIVE', 'PMKIT_LIVE_WORKSPACE', 'LINEAR_API_KEY', 'NODE_TEST_CONTEXT']) delete env[name]
  const file = path.join(import.meta.dirname, 'migrate-live.mjs')
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /^# skipped 1$/m)
  assert.match(result.stdout, /^# pass 0$/m)
  assert.match(result.stdout, /set PMKIT_LIVE=1/)
})
