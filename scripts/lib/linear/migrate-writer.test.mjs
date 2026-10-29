import test from 'node:test'
import assert from 'node:assert/strict'
import { ACME_LABELS, ACME_TEAM_ID, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeLinearProjects, fakeWorkspace } from '../../fake-linear-api.mjs'
import { createLinearClient } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { createLinearTracker } from './tracker.mjs'
import { createLinearWriter } from './migrate-writer.mjs'
import { userStoreEnv } from '../../test-helpers.mjs'

const TRACKER = { system: 'linear', scope: { workspace: 'acme', team: 'ACME' } }

function setup({ headers } = {}) {
  const labels = [...ACME_LABELS]
  const issues = fakeLinearIssues({ labels })
  const projects = fakeLinearProjects({ issues })
  const routes = { ...fakeWorkspace({ labels }), ...issues.routes, ...projects.routes }
  if (headers) {
    for (const [name, route] of Object.entries(routes)) {
      routes[name] = (body) => {
        const answer = typeof route === 'function' ? route(body) : route
        return { ...answer, headers: { ...answer.headers, ...headers } }
      }
    }
  }
  const fetch = fakeLinearFetch(routes)
  const client = createLinearClient({ env: { LINEAR_API_KEY: FAKE_KEY }, tracker: TRACKER, fetch })
  let n = 0
  const writer = createLinearWriter({ client, discovery: () => fetchDiscovery(client), uuid: () => `uuid-${++n}` })
  return { issues, projects, fetch, client, writer, labels }
}

const inputsOf = (fetch, name) => fetch.calls.filter((call) => call.body.query.includes(` ${name}(`)).map((call) => call.body.variables)
const record = (key) => ({ key })

test('each create sends the chosen id and every field', async () => {
  const { fetch, writer, issues, projects } = setup()
  const label = await writer.create('label', record('needs-criteria'), 'l-1', { name: 'needs-criteria', teamId: ACME_TEAM_ID })
  assert.deepEqual(label, { id: 'l-1', created: true })
  const epic = await writer.create('epic', record('EPC-1'), 'p-1', { name: 'Epic', teamIds: [ACME_TEAM_ID], statusId: 'project-status-started' })
  assert.equal(epic.id, 'P-ACM-1')
  const issueFields = { teamId: ACME_TEAM_ID, title: 'A', createdAt: '2026-10-01T00:00:00Z', projectId: 'p-1', labelIds: ['l-1'] }
  assert.equal((await writer.create('issue', record('ISS-1'), 'i-1', issueFields)).id, 'ACME-1')
  await writer.create('issue', record('ISS-2'), 'i-2', { teamId: ACME_TEAM_ID, title: 'B' })
  assert.deepEqual(await writer.create('link', record('blocks ISS-1 ISS-2'), 'r-1', { type: 'blocks', issueId: 'i-1', relatedIssueId: 'i-2' }), { id: 'r-1' })
  await writer.create('comment', record('ISS-1/a'), 'c-1', { body: 'Comment by Fred on 2026-10-01 in ISS-1\n\nHi', issueId: 'i-1', createdAt: '2026-10-01T00:00:00Z' })
  await writer.create('thread', record('ISS-1/a'), 'unused', { commentId: 'c-1' })
  await writer.create('update', record('EPC-1/u'), 'u-1', { body: 'Fine', health: 'onTrack', projectId: 'p-1' })
  await writer.create('archive', record('ISS-2'), 'unused', { issueId: 'i-2' })
  assert.deepEqual(inputsOf(fetch, 'issueLabelCreate'), [{ input: { id: 'l-1', name: 'needs-criteria', teamId: ACME_TEAM_ID } }])
  assert.deepEqual(inputsOf(fetch, 'projectCreate')[0].input, { id: 'p-1', name: 'Epic', teamIds: [ACME_TEAM_ID], statusId: 'project-status-started' })
  assert.deepEqual(inputsOf(fetch, 'issueCreate')[0].input, { id: 'i-1', ...issueFields })
  assert.deepEqual(inputsOf(fetch, 'issueRelationCreate')[0].input, { id: 'r-1', type: 'blocks', issueId: 'i-1', relatedIssueId: 'i-2' })
  assert.equal(inputsOf(fetch, 'commentCreate')[0].input.id, 'c-1')
  assert.deepEqual(inputsOf(fetch, 'commentResolve'), [{ id: 'c-1' }])
  assert.deepEqual(inputsOf(fetch, 'projectUpdateCreate')[0].input, { id: 'u-1', body: 'Fine', health: 'onTrack', projectId: 'p-1' })
  assert.deepEqual(inputsOf(fetch, 'issueArchive'), [{ id: 'i-2' }])
  assert.equal(issues.records[0].createdAt, '2026-10-01T00:00:00Z')
  assert.equal(projects.projects[0].statusId, 'project-status-started')
})

test('chooseId returns a new UUID', () => {
  const { writer } = setup()
  assert.equal(writer.chooseId('issue', record('ISS-1')), 'uuid-1')
  assert.equal(writer.system, 'linear')
})

test('exists finds issues by UUID, 100 per read', async () => {
  const { fetch, writer, issues } = setup()
  const entries = []
  for (let i = 0; i < 150; i++) {
    const id = `i-${i}`
    if (i % 2 === 0) issues.seed({ id, title: `t${i}` })
    entries.push({ key: `ISS-${i}`, uuid: id })
  }
  const found = await writer.exists('issue', entries, () => undefined)
  assert.equal(fetch.calls.filter((call) => call.body.query.includes('PmkitIssuesByIds')).length, 2)
  assert.equal(found.size, 75)
  assert.equal(found.get('ISS-0').id, 'ACME-1')
})

test('exists finds a link through the relations of its from issue, and a thread and an archive by their state', async () => {
  const { writer, issues } = setup()
  issues.seed({ id: 'i-1', title: 'a' })
  issues.seed({ id: 'i-2', title: 'b' })
  await writer.create('link', record('blocks ISS-1 ISS-2'), 'r-1', { type: 'blocks', issueId: 'i-1', relatedIssueId: 'i-2' })
  const lookup = (kind, key) => ({ 'issue ISS-1': { uuid: 'i-1' }, 'issue ISS-2': { uuid: 'i-2' }, 'comment ISS-1/a': { uuid: 'c-1' } })[`${kind} ${key}`]
  assert.deepEqual([...await writer.exists('link', [{ key: 'blocks ISS-1 ISS-2', uuid: 'r-1' }, { key: 'related ISS-1 ISS-2', uuid: 'r-2' }], lookup)].map(([key]) => key), ['blocks ISS-1 ISS-2'])
  assert.equal((await writer.exists('archive', [{ key: 'ISS-2', uuid: 'x' }], lookup)).size, 0)
  await writer.create('archive', record('ISS-2'), 'x', { issueId: 'i-2' })
  assert.equal((await writer.exists('archive', [{ key: 'ISS-2', uuid: 'x' }], lookup)).size, 1)
  issues.comment('i-1', { id: 'c-1', body: 'q' })
  assert.equal((await writer.exists('thread', [{ key: 'ISS-1/a', uuid: 'x' }], lookup)).size, 0)
  assert.equal((await writer.exists('comment', [{ key: 'ISS-1/a', uuid: 'c-1' }], lookup)).size, 1)
})

test('exists finds labels, projects and updates', async () => {
  const { writer } = setup()
  await writer.create('label', record('x'), 'l-1', { name: 'x', teamId: ACME_TEAM_ID })
  await writer.create('epic', record('EPC-1'), 'p-1', { name: 'Epic', teamIds: [ACME_TEAM_ID] })
  await writer.create('update', record('EPC-1/u'), 'u-1', { body: 'Fine', health: 'onTrack', projectId: 'p-1' })
  const lookup = (kind, key) => (kind === 'epic' && key === 'EPC-1' ? { uuid: 'p-1' } : undefined)
  assert.equal((await writer.exists('label', [{ key: 'x', uuid: 'l-1' }, { key: 'y', uuid: 'l-2' }], lookup)).size, 1)
  assert.equal((await writer.exists('epic', [{ key: 'EPC-1', uuid: 'p-1' }], lookup)).get('EPC-1').id, 'P-ACM-1')
  assert.equal((await writer.exists('update', [{ key: 'EPC-1/u', uuid: 'u-1' }, { key: 'EPC-1/v', uuid: 'u-2' }], lookup)).size, 1)
})

test('isUnconfirmed is true for an HTTP 502 on a create', async () => {
  const { writer, issues } = setup()
  issues.unconfirm('PmkitIssueCreate', { applied: true })
  const error = await writer.create('issue', record('ISS-1'), 'i-1', { teamId: ACME_TEAM_ID, title: 'A' }).then(() => null, (caught) => caught)
  assert.equal(writer.isUnconfirmed(error), true)
  assert.equal((await writer.exists('issue', [{ key: 'ISS-1', uuid: 'i-1' }], () => undefined)).size, 1)
})

test('remove sends issueDelete without permanentlyDelete, projectDelete and labelDelete', async () => {
  const { fetch, writer, issues, labels } = setup()
  issues.seed({ id: 'i-1', title: 'a' })
  await writer.create('label', record('x'), 'l-1', { name: 'x', teamId: ACME_TEAM_ID })
  await writer.create('epic', record('EPC-1'), 'p-1', { name: 'Epic', teamIds: [ACME_TEAM_ID] })
  await writer.remove('issue', { uuid: 'i-1' })
  await writer.remove('epic', { uuid: 'p-1' })
  await writer.remove('label', { uuid: 'l-1' })
  assert.deepEqual(inputsOf(fetch, 'issueDelete'), [{ id: 'i-1' }])
  assert.equal(issues.records[0].trashed, true)
  assert.equal(labels.some((label) => label.id === 'l-1'), false)
  assert.ok(!fetch.calls.some((call) => /permanentlyDelete/.test(call.body.query)))
})

test('budget returns the client rate after a response with headers', async () => {
  const { writer } = setup({ headers: { 'x-ratelimit-requests-remaining': '1500', 'x-ratelimit-requests-limit': '2500', 'x-ratelimit-requests-reset': String(Date.parse('2026-10-28T21:06:00Z')) } })
  assert.equal(writer.budget(), null)
  await writer.create('issue', record('ISS-1'), 'i-1', { teamId: ACME_TEAM_ID, title: 'A' })
  assert.equal(writer.budget().requests.remaining, 1500)
})

test('the tracker exposes its client for a migration, and the contract view has no migration key', async () => {
  const issues = fakeLinearIssues()
  const fetch = fakeLinearFetch({ ...fakeWorkspace(), ...issues.routes })
  const tracker = createLinearTracker({ root: '/nowhere', pmkit: { tracker: TRACKER } }, { env: { ...userStoreEnv().env, LINEAR_API_KEY: FAKE_KEY }, fetch })
  assert.ok(tracker.migration.client)
  assert.equal(typeof tracker.migration.discovery, 'function')
  await tracker.migration.client.request('query PmkitIssuesByIds($ids: [ID!]) { x }', { ids: [] })
  assert.equal(fetch.calls.at(-1).body.variables.ids.length, 0)
  const { TRACKER_OPERATIONS } = await import('../contract.mjs')
  assert.ok(!TRACKER_OPERATIONS.includes('migration'))
})
