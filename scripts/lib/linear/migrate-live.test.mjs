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
import { readMutation, TEAM_CREATE } from './sandbox.mjs'
import { createLinearClient } from './client.mjs'
import { ACME_LABELS, ACME_STATES, ACME_TEAM, ACME_TEAM_ID, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeLinearProjects, fakeWorkspace, json } from '../../fake-linear-api.mjs'
import { childEnv } from '../../golden-helpers.mjs'
import { makeRepo, userStoreEnv } from '../../test-helpers.mjs'
import { EXPORT_MUTATIONS, FIXTURE_TITLES, MIGRATE_CAP, UNDO_MUTATIONS, adoptTeamIds, buildLiveFixture, migrateAllowlist, migrateGuardedFetch, migrateSteps } from './migrate-live.mjs'

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
