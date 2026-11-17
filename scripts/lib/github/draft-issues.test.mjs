// The draft issues of a GitHub Project, listed and converted against the stateful fake GitHub through the real client.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeGithubIssues } from '../../fake-github-issues.mjs'
import { createGithubClient } from './client.mjs'
import { convertText, draftIssueOperations, listText, parseItemId } from './draft-issues.mjs'

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

/** Two drafts in the scope Project, the first with a Status and an assignee. */
function seeded(options) {
  const { fake, ops } = setup(options)
  const a = fake.seedDraft({ title: 'Offline mode', body: 'Work without a network.', assignees: ['hubot'], values: { Status: 'Todo' } }).item
  const b = fake.seedDraft({ title: 'Dark theme', body: 'A dark palette.' }).item
  return { fake, ops, a, b }
}

test('convert previews every draft and writes nothing', async () => {
  const { fake, ops, a, b } = seeded()
  const result = await ops.convert([a, b], { dryRun: true })
  assert.deepEqual(result, {
    dryRun: true, project: PROJECT, target: { repo: 'acme/widgets', tracked: true },
    drafts: [
      { item: a, title: 'Offline mode', body: 'Work without a network.', assignees: ['hubot'], fields: { Status: 'Todo' } },
      { item: b, title: 'Dark theme', body: 'A dark palette.', assignees: [], fields: {} },
    ],
    warnings: [],
  })
  assert.deepEqual(fake.mutations, [])
  assert.equal(convertText(result, true), 'would convert 2 drafts of Roadmap into issues in acme/widgets')
})

test('convert turns the drafts into issues in the scope repository', async () => {
  const { fake, ops, a, b } = seeded()
  const result = await ops.convert([a, b])
  assert.deepEqual(result, {
    project: PROJECT, target: { repo: 'acme/widgets', tracked: true },
    converted: [
      { item: a, title: 'Offline mode', number: 1, id: '1', url: 'https://github.com/acme/widgets/issues/1' },
      { item: b, title: 'Dark theme', number: 2, id: '2', url: 'https://github.com/acme/widgets/issues/2' },
    ],
    warnings: [],
  })
  const item = fake.state.items.find((candidate) => candidate.id === a)
  const issue = fake.state.issues.find((record) => record.id === item.issueId)
  assert.deepEqual([issue.title, issue.body, issue.assigneeIds, item.draft, Object.keys(item.values).length], ['Offline mode', 'Work without a network.', ['U_2'], undefined, 1])
  assert.equal(convertText(result, false), 'converted 2 drafts into issues in acme/widgets: #1, #2')
  assert.deepEqual((await ops.list()).drafts, [])
})

test('convert counts a repeated item once', async () => {
  const { fake, ops, a } = seeded()
  assert.equal((await ops.convert([a, a])).converted.length, 1)
  assert.equal(fake.mutations.length, 1)
})

test('convert refuses the whole batch when one id is wrong', async () => {
  const { fake, ops } = setup({ extraProjects: [{ id: 'PVT_9', owner: 'acme', number: 9, title: 'Epic: sync' }] })
  const draft = fake.seedDraft({ title: 'Offline mode' }).item
  fake.seed({ title: 'An issue', item: { status: 'Todo' } })
  const issueItem = fake.state.items.find((item) => item.issueId !== null).id
  const archived = fake.seedDraft({ title: 'Old', archived: true }).item
  const other = fake.seedDraft({ project: 'PVT_9', title: 'Elsewhere' }).item
  for (const [id, reason] of [[issueItem, 'is an issue, not a draft'], [archived, 'is archived'], [other, 'is not in acme/7'], ['PVTI_404', 'does not exist']]) {
    await rejectsWith(ops.convert([draft, id]), 'INVALID_INPUT', `item ${id} ${reason}`)
  }
  await rejectsWith(ops.convert([]), 'INVALID_INPUT', 'convert takes 1 to 50 item ids')
  await rejectsWith(ops.convert(Array.from({ length: 51 }, (_, index) => `PVTI_x${index}`)), 'INVALID_INPUT', 'convert takes 1 to 50 item ids')
  await rejectsWith(ops.convert(['$(rm)']), 'INVALID_INPUT')
  assert.deepEqual(fake.mutations, [])
})

test('convert sends drafts to another repository with a warning', async () => {
  const { fake, ops, a } = seeded()
  fake.seedRepository('acme/docs')
  const dry = await ops.convert([a], { repo: 'acme/docs', dryRun: true })
  assert.deepEqual(dry.target, { repo: 'acme/docs', tracked: false })
  assert.deepEqual(dry.warnings, ['acme/docs is not tracker.scope.repo (acme/widgets), so pmkit will not track the new issues'])
  const done = await ops.convert([a], { repo: 'acme/docs' })
  assert.deepEqual(done.converted, [{ item: a, title: 'Offline mode', number: 1, id: null, url: 'https://github.com/acme/docs/issues/1' }])
  await rejectsWith(ops.convert([a], { repo: 'acme/nope', dryRun: true }), 'NOT_FOUND', 'GitHub has no repository acme/nope')
  await rejectsWith(ops.convert([a], { repo: 'nope', dryRun: true }), 'INVALID_INPUT', '--repo must be owner/name, such as acme/widgets')
  fake.seedRepository('acme/closed', { hasIssuesEnabled: false })
  await rejectsWith(ops.convert([a], { repo: 'acme/closed', dryRun: true }), 'INVALID_INPUT', 'acme/closed has issues turned off')
})

test('convert stops on a failure partway and names what converted', async () => {
  const { fake, a, b } = seeded()
  const c = fake.seedDraft({ title: 'Third' }).item
  // The second conversion fails: the exec queues the failure once the first conversion went through.
  let conversions = 0
  const exec = (cmd, args, options) => {
    if (String(options?.input ?? '').includes('mutation PmkitConvertDraftItem') && (conversions += 1) === 2) fake.failNext('PmkitConvertDraftItem')
    return fake.exec(cmd, args, options)
  }
  const ops = draftIssueOperations({ client: createGithubClient({ exec, retries: 0, sleep: async () => {} }), scope: SCOPE })
  await assert.rejects(ops.convert([a, b, c]), (error) => {
    assert.equal(error.code, 'UPSTREAM')
    assert.match(error.message, new RegExp(`^GitHub converted 1 of 3 drafts, but ${b} failed: `))
    assert.deepEqual(error.details.converted.map((item) => item.item), [a])
    assert.deepEqual(error.details.notConverted, [b, c])
    return true
  })

  const first = seeded()
  first.fake.failNext('PmkitConvertDraftItem')
  await assert.rejects(first.ops.convert([first.a]), (error) => error.code === 'UPSTREAM' && !/^GitHub converted/.test(error.message))
})

test('convert without a Project is refused, and the list text covers the empty and unavailable cases', async () => {
  const none = setup({ scope: { ...SCOPE, project: 'none' } })
  await rejectsWith(none.ops.convert(['PVTI_1'], { dryRun: true }), 'NOT_SUPPORTED', 'no Project to read drafts from for acme/widgets')
  assert.equal(listText(await none.ops.list()), 'no Project to read for acme/widgets; Pass --project owner/number, or set tracker.scope.project with /pmkit:setup')
  const empty = setup()
  assert.equal(listText(await empty.ops.list()), 'no draft issues in Roadmap')
})

test('convert names a pull request or a redacted item as not a draft', async () => {
  const { fake, ops } = setup()
  fake.seedDraft({ title: 'Offline mode' })
  const pull = fake.seedDraft({ title: 'A pull request' }).item
  const hidden = fake.seedDraft({ title: 'Hidden' }).item
  fake.state.items.find((item) => item.id === pull).type = 'PULL_REQUEST'
  fake.state.items.find((item) => item.id === hidden).type = 'REDACTED'
  await rejectsWith(ops.convert([pull], { dryRun: true }), 'INVALID_INPUT', `item ${pull} is a pull request, not a draft`)
  await rejectsWith(ops.convert([hidden], { dryRun: true }), 'INVALID_INPUT', `item ${hidden} is an item the gh account cannot see, not a draft`)
})
