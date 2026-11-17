// The draft issues of a GitHub Project, listed and converted against the stateful fake GitHub through the real client.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeGithubIssues } from '../../fake-github-issues.mjs'
import { createGithubClient } from './client.mjs'
import { draftIssueOperations, listText, parseItemId } from './draft-issues.mjs'

const SCOPE = { host: 'github.com', repo: 'acme/widgets', project: 'acme/7' }
const PROJECT = { id: 'PVT_1', title: 'Roadmap', url: 'https://github.com/orgs/acme/projects/7' }

function setup({ scope = SCOPE, ...options } = {}) {
  const fake = fakeGithubIssues(options)
  const client = createGithubClient({ exec: fake.exec, retries: 0, sleep: async () => {} })
  return { fake, ops: draftIssueOperations({ client, scope }) }
}

const rejectsWith = (promise, code, message) =>
  assert.rejects(promise, (error) => {
    assert.equal(error.code, code)
    if (message instanceof RegExp) assert.match(error.message, message)
    else if (message !== undefined) assert.equal(error.message, message)
    return true
  })

test('list returns the unarchived drafts in board order across pages', async () => {
  const { fake, ops } = setup()
  for (let index = 0; index < 100; index += 1) fake.seed({ title: `Issue ${index}`, item: { status: 'Todo' } })
  const { item } = fake.seedDraft({ title: 'Offline mode', body: 'Work without a network.', assignees: ['hubot'], values: { Status: 'Todo' }, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z' })
  fake.seedDraft({ title: 'Old idea', archived: true })
  fake.seedDraft({ title: 'Dark theme' })
  const result = await ops.list()
  assert.equal(result.available, true)
  assert.deepEqual(result.project, PROJECT)
  assert.equal(result.repo, 'acme/widgets')
  assert.deepEqual(result.drafts.map((draft) => draft.title), ['Offline mode', 'Dark theme'])
  assert.equal(result.hasMore, false)
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.drafts[0], {
    item, title: 'Offline mode', body: 'Work without a network.', assignees: ['hubot'], creator: 'octocat',
    created: '2026-11-01T00:00:00Z', updated: '2026-11-02T00:00:00Z', fields: { Status: 'Todo' },
  })
  assert.match(listText(result), /^PVTI_\d+ {2}Offline mode {2}Todo/)
})

test('list caps the items read and the drafts returned', async () => {
  const big = setup()
  for (let index = 0; index < 1001; index += 1) big.fake.seedDraft({ title: `Draft ${index}` })
  const capped = await big.ops.list({ limit: '200' })
  assert.deepEqual(capped.warnings, ['acme/7 has more than 1000 items and pmkit read the first 1000'])
  assert.equal(capped.drafts.length, 200)
  assert.equal(capped.hasMore, true)

  const { fake, ops } = setup()
  for (const title of ['A', 'B', 'C']) fake.seedDraft({ title })
  const two = await ops.list({ limit: '2' })
  assert.deepEqual([two.drafts.map((draft) => draft.title), two.hasMore], [['A', 'B'], true])
  assert.equal((await ops.list()).drafts.length, 3)
  for (const limit of ['0', '201', 'x']) await rejectsWith(ops.list({ limit }), 'INVALID_INPUT', '--limit must be a whole number from 1 to 200')
})

test('list reads a linked --project and refuses one the repository does not link', async () => {
  const { fake, ops } = setup({ extraProjects: [{ id: 'PVT_9', owner: 'acme', number: 9, title: 'Epic: sync' }, { id: 'PVT_11', owner: 'acme', number: 11, title: 'Elsewhere', linked: false }] })
  fake.seedDraft({ project: 'PVT_9', title: 'Sync queue' })
  fake.seedDraft({ title: 'Offline mode' })
  const nine = await ops.list({ project: 'acme/9' })
  assert.deepEqual(nine.project, { id: 'PVT_9', title: 'Epic: sync', url: 'https://github.com/orgs/acme/projects/9' })
  assert.deepEqual(nine.drafts.map((draft) => draft.title), ['Sync queue'])
  const reads = fake.reads.length
  assert.deepEqual((await ops.list({ project: 'ACME/7' })).drafts.map((draft) => draft.title), ['Offline mode'])
  assert.ok(!fake.reads.slice(reads).some((call) => call.name === 'PmkitLinkedProjects'), 'the scope Project needs no linked check')
  await rejectsWith(ops.list({ project: 'acme/11' }), 'INVALID_INPUT', 'acme/11 is not linked to acme/widgets; its linked Projects are acme/7, acme/9')
  await rejectsWith(ops.list({ project: 'acme' }), 'INVALID_INPUT', '--project must be owner/number, such as acme/7')
})

test('list without a Project is unavailable', async () => {
  const { ops } = setup({ scope: { ...SCOPE, project: 'none' } })
  assert.deepEqual(await ops.list(), {
    available: false, reason: 'no_project', enableHint: 'Pass --project owner/number, or set tracker.scope.project with /pmkit:setup', repo: 'acme/widgets', drafts: [], hasMore: false, warnings: [],
  })
})

test('parseItemId accepts node ids and refuses the rest', () => {
  assert.equal(parseItemId('PVTI_lADOAB'), 'PVTI_lADOAB')
  assert.equal(parseItemId('MDExOlByb2plY3RWMkl0ZW0x=='), 'MDExOlByb2plY3RWMkl0ZW0x==')
  for (const value of ['a b', '$(x)', '', 'x'.repeat(201), undefined]) {
    assert.throws(() => parseItemId(value), (error) => error.code === 'INVALID_INPUT')
  }
})
