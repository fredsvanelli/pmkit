// The Relations family of the GitHub adapter against the stateful fake GitHub, through the real client.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeGithubIssues } from '../../fake-github-issues.mjs'
import { createGithubClient } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { issueOperations } from './issue-ops.mjs'
import { makeContext } from './issues.mjs'
import { epicProjects } from './project-ops.mjs'
import { relationOperations } from './relation-ops.mjs'

const PMKIT = {
  tracker: { system: 'github', scope: { host: 'github.com', repo: 'acme/widgets', project: 'acme/7' } },
  mappings: { status: { backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress', done: 'Done', canceled: 'none' }, types: { bug: 'Bug', task: 'Task' } },
}
const ME = 'octocat'

async function setup({ host = 'github.com', ghesVersion = null, epics = [] } = {}) {
  const fake = fakeGithubIssues({ host, ghesVersion, epics })
  const client = createGithubClient({ exec: fake.exec, retries: 0, sleep: async () => {} })
  const raw = await fetchDiscovery(client, { host, repo: 'acme/widgets', project: 'acme/7', exec: fake.exec, users: true })
  const context = makeContext(raw, PMKIT, { epics: await epicProjects(client, PMKIT.tracker.scope) })
  const getContext = async () => context
  const ops = issueOperations({ client, config: { pmkit: PMKIT }, getContext })
  const relations = relationOperations({ client, ops, getContext })
  const seedTwo = () => {
    fake.seed({ number: 1 })
    fake.seed({ number: 2 })
  }
  return { fake, relations, seedTwo, clear: () => { fake.reads.splice(0); fake.mutations.splice(0) } }
}
const sent = (fake) => fake.mutations.map((call) => call.name)

test('blocks sends addBlockedBy with the blocked issue as issueId and reads the blocker back', async () => {
  const { fake, relations, seedTwo, clear } = await setup()
  seedTwo()
  clear()
  const dry = await relations.link('1', '2', 'blocks', ME, { dryRun: true })
  assert.deepEqual(fake.mutations, [])
  assert.deepEqual(dry.after.blocks, ['2'])
  const result = await relations.link('1', '2', 'blocks', ME)
  assert.deepEqual(fake.mutations.map((call) => [call.name, call.input]), [['PmkitAddBlockedBy', { issueId: 'I_2', blockingIssueId: 'I_1' }]])
  assert.deepEqual(result.before.blocks, [])
  assert.deepEqual(result.after.blocks, ['2'])
  const again = await relations.link('1', '2', 'blocks', ME)
  assert.equal(fake.mutations.length, 1)
  assert.deepEqual(again.after, again.before)
})

test('unlink blocks sends removeBlockedBy, and a missing link sends nothing', async () => {
  const { fake, relations, seedTwo, clear } = await setup()
  seedTwo()
  await relations.link('1', '2', 'blocks', ME)
  clear()
  const dry = await relations.unlink('1', '2', 'blocks', ME, { dryRun: true })
  assert.deepEqual(dry.after.blocks, [])
  assert.deepEqual(fake.mutations, [])
  const result = await relations.unlink('1', '2', 'blocks', ME)
  assert.deepEqual(fake.mutations.map((call) => [call.name, call.input]), [['PmkitRemoveBlockedBy', { issueId: 'I_2', blockingIssueId: 'I_1' }]])
  assert.deepEqual(result.after.blocks, [])
  clear()
  const none = await relations.unlink('1', '2', 'blocks', ME)
  assert.deepEqual(fake.mutations, [])
  assert.deepEqual(none.after, none.before)
})

test('related sends addRelatesTo and removeRelatesTo on github.com', async () => {
  const { fake, relations, seedTwo, clear } = await setup()
  seedTwo()
  clear()
  const result = await relations.link('1', '2', 'related', ME)
  assert.deepEqual(fake.mutations.map((call) => [call.name, call.input]), [['PmkitAddRelatesTo', { issueId: 'I_1', relatedIssueId: 'I_2' }]])
  assert.deepEqual(result.after.related, ['2'])
  await relations.link('1', '2', 'related', ME)
  assert.equal(fake.mutations.length, 1)
  const removed = await relations.unlink('1', '2', 'related', ME)
  assert.equal(fake.mutations[1].name, 'PmkitRemoveRelatesTo')
  assert.deepEqual(removed.after.related, [])
})

test('related on GHES gives NOT_SUPPORTED before any request', async () => {
  const { fake, relations, seedTwo, clear } = await setup({ host: 'git.acme.dev', ghesVersion: '3.19.2' })
  seedTwo()
  clear()
  for (const op of ['link', 'unlink']) {
    await assert.rejects(relations[op]('1', '2', 'related', ME), { code: 'NOT_SUPPORTED', message: 'GitHub Enterprise Server has no related issues' })
  }
  assert.deepEqual([fake.reads, fake.mutations], [[], []])
})

test('duplicate closes the issue as a duplicate with a note, and unlink unmarks it', async () => {
  const { fake, relations, seedTwo, clear } = await setup()
  seedTwo()
  clear()
  const dry = await relations.link('1', '2', 'duplicate', ME, { dryRun: true })
  assert.deepEqual(fake.mutations, [])
  assert.deepEqual(dry.notes, ['GitHub closed 1 as a duplicate of 2'])
  const result = await relations.link('1', '2', 'duplicate', ME)
  assert.equal(fake.mutations[0].name, 'PmkitCloseIssue')
  assert.deepEqual(fake.mutations[0].input, { issueId: 'I_1', stateReason: 'DUPLICATE', duplicateIssueId: 'I_2' })
  assert.deepEqual(result.after.duplicateOf, ['2'])
  assert.equal(result.after.status.category, 'canceled')
  assert.deepEqual(result.notes, ['GitHub closed 1 as a duplicate of 2'])
  await relations.link('1', '2', 'duplicate', ME)
  assert.equal(fake.mutations.length, 1)
  const removed = await relations.unlink('1', '2', 'duplicate', ME)
  assert.deepEqual(fake.mutations[1], { name: 'PmkitUnmarkDuplicate', input: { duplicateId: 'I_1', canonicalId: 'I_2' }, variables: fake.mutations[1].variables })
  assert.deepEqual(removed.after.duplicateOf, [])
  clear()
  await relations.unlink('1', '2', 'duplicate', ME)
  assert.deepEqual(fake.mutations, [])
})

test('a self link and an unknown kind give INVALID_INPUT, and a wrong actor sends nothing', async () => {
  const { fake, relations, seedTwo, clear } = await setup()
  seedTwo()
  clear()
  await assert.rejects(relations.link('1', '#1', 'blocks', ME), { code: 'INVALID_INPUT', message: '1 cannot be linked to itself' })
  await assert.rejects(relations.link('1', '2', 'sibling', ME), { code: 'INVALID_INPUT', message: 'kind must be one of blocks, related, duplicate' })
  clear()
  await assert.rejects(relations.link('1', '2', 'blocks', 'hubot'), { code: 'INVALID_INPUT' })
  await assert.rejects(relations.setParent('1', '2', 'hubot'), { code: 'INVALID_INPUT' })
  assert.deepEqual([fake.reads, fake.mutations], [[], []])
})

test('a blocks loop gives INVALID_INPUT with the loop', async () => {
  const { fake, relations, seedTwo, clear } = await setup()
  seedTwo()
  await relations.link('2', '1', 'blocks', ME)
  clear()
  await assert.rejects(relations.link('1', '2', 'blocks', ME), { code: 'INVALID_INPUT', message: '1 blocks 2 would close a cycle: 1 → 2 → 1' })
  assert.deepEqual(fake.mutations, [])
})

test('a blocker in another repository links and reads back with its full id', async () => {
  const { fake, relations, clear } = await setup()
  fake.seed({ number: 1 })
  fake.seed({ repo: 'acme/other', number: 5 })
  clear()
  const result = await relations.link('1', 'acme/other#5', 'blocks', ME)
  assert.deepEqual(result.after.blocks, ['acme/other#5'])
  const back = await relations.link('acme/other#5', '1', 'blocks', ME).catch((error) => error)
  assert.equal(back.code, 'INVALID_INPUT')
  assert.match(back.message, /acme\/other#5 → 1 → acme\/other#5|cycle/)
})

test('setParent adds a sub-issue with replaceParent, and null removes the current parent', async () => {
  const { fake, relations, seedTwo, clear } = await setup()
  seedTwo()
  clear()
  const dry = await relations.setParent('2', '1', ME, { dryRun: true })
  assert.deepEqual(fake.mutations, [])
  assert.equal(dry.after.parent, '1')
  const result = await relations.setParent('2', '1', ME)
  assert.deepEqual(fake.mutations.map((call) => [call.name, call.input]), [['PmkitAddSubIssue', { issueId: 'I_1', subIssueId: 'I_2', replaceParent: true }]])
  assert.equal(result.after.parent, '1')
  await relations.setParent('2', '1', ME)
  assert.equal(fake.mutations.length, 1)
  const removed = await relations.setParent('2', null, ME)
  assert.deepEqual([fake.mutations[1].name, fake.mutations[1].input], ['PmkitRemoveSubIssue', { issueId: 'I_1', subIssueId: 'I_2' }])
  assert.equal(removed.after.parent, undefined)
  clear()
  const none = await relations.setParent('2', null, ME)
  assert.deepEqual(fake.mutations, [])
  assert.deepEqual(none.after, none.before)
})

test('setParent rejects itself, a loop and a missing parent', async () => {
  const { fake, relations, seedTwo, clear } = await setup()
  seedTwo()
  fake.seed({ number: 3 })
  await relations.setParent('2', '1', ME)
  await relations.setParent('3', '2', ME)
  clear()
  await assert.rejects(relations.setParent('1', '1', ME), { code: 'INVALID_INPUT', message: '1 cannot be its own parent' })
  await assert.rejects(relations.setParent('1', '3', ME), { code: 'INVALID_INPUT', message: 'parent loop: 1 → 3 → 2 → 1' })
  await assert.rejects(relations.setParent('1', '99', ME), { code: 'INVALID_INPUT', message: 'parent 99 is not an existing issue' })
  assert.deepEqual(fake.mutations, [])
})

// The parent rule: an epic is a linked Project, and an issue is in it through its item.
const EPICS = [
  { id: 'PVT_E12', owner: 'acme', number: 12, title: 'Epic twelve', linked: true },
  { id: 'PVT_E9', owner: 'acme', number: 9, title: 'Epic nine', linked: true },
  { id: 'PVT_E30', owner: 'acme', number: 30, title: 'Not linked', linked: false },
]
const epicSetup = () => setup({ epics: EPICS })
const calls = (fake) => fake.mutations.map((call) => [call.name, call.input])

test('setParent to an epic adds the item to the epic Project, and the issue reads it as its parent', async () => {
  const { fake, relations, clear } = await epicSetup()
  fake.seed({ number: 1 })
  clear()
  const dry = await relations.setParent('1', 'acme/12', ME, { dryRun: true })
  assert.deepEqual(fake.mutations, [])
  assert.equal(dry.after.parent, 'acme/12')
  const result = await relations.setParent('1', 'ACME/12', ME)
  assert.deepEqual(calls(fake), [['PmkitAddProjectItem', { projectId: 'PVT_E12', contentId: 'I_1' }]])
  assert.equal(result.before.parent, undefined)
  assert.equal(result.after.parent, 'acme/12')
  const again = await relations.setParent('1', 'acme/12', ME)
  assert.equal(fake.mutations.length, 1)
  assert.deepEqual(again.after, again.before)
})

test('setParent to an epic removes the sub-issue link first, and the issue then reads the epic (a sub-issue in an epic reads its parent issue)', async () => {
  const { fake, relations, clear } = await epicSetup()
  fake.seed({ number: 1 })
  fake.seed({ number: 2, parent: 1, epics: ['acme/12'] })
  clear()
  const before = await relations.setParent('2', '1', ME)
  assert.equal(before.after.parent, '1')
  assert.equal(fake.mutations.length, 0)
  const result = await relations.setParent('2', 'acme/12', ME)
  assert.equal(result.before.parent, '1')
  assert.deepEqual(calls(fake), [['PmkitRemoveSubIssue', { issueId: 'I_1', subIssueId: 'I_2' }]])
  assert.equal(result.after.parent, 'acme/12')
})

test('setParent to an epic deletes the items in the other epics and never the scope Project item', async () => {
  const { fake, relations, clear } = await epicSetup()
  fake.seed({ number: 1, epics: ['acme/9'], item: { status: 'Todo' } })
  clear()
  const result = await relations.setParent('1', 'acme/12', ME)
  assert.deepEqual(fake.mutations.map((call) => call.name), ['PmkitAddProjectItem', 'PmkitDeleteProjectItem'])
  assert.equal(fake.mutations[1].input.projectId, 'PVT_E9')
  assert.equal(result.after.parent, 'acme/12')
  assert.equal(result.after.status.name, 'Todo')
})

test('setParent to an epic keeps a one-epic issue with no change, and drops a second epic', async () => {
  const { fake, relations, clear } = await epicSetup()
  fake.seed({ number: 1, epics: ['acme/12'] })
  fake.seed({ number: 2, epics: ['acme/9', 'acme/12'] })
  clear()
  const same = await relations.setParent('1', 'acme/12', ME)
  assert.deepEqual(fake.mutations, [])
  assert.deepEqual(same.after, same.before)
  const result = await relations.setParent('2', 'acme/12', ME)
  assert.deepEqual(calls(fake).map(([name]) => name), ['PmkitDeleteProjectItem'])
  assert.equal(fake.mutations[0].input.projectId, 'PVT_E9')
  assert.equal(result.after.parent, 'acme/12')
})

test('setParent to an unknown epic is INVALID_INPUT and sends nothing', async () => {
  const { fake, relations, clear } = await epicSetup()
  fake.seed({ number: 1 })
  clear()
  for (const id of ['acme/99', 'acme/30']) {
    await assert.rejects(relations.setParent('1', id, ME), { code: 'INVALID_INPUT', message: `parent ${id} is not an existing issue or epic` })
  }
  assert.deepEqual(fake.mutations, [])
})

test('setParent null removes the parent issue when there is one, else the epic items, and never the scope item', async () => {
  const { fake, relations, clear } = await epicSetup()
  fake.seed({ number: 1 })
  fake.seed({ number: 2, parent: 1, epics: ['acme/12'], item: { status: 'Todo' } })
  fake.seed({ number: 3, epics: ['acme/12', 'acme/9'], item: { status: 'Todo' } })
  clear()
  const dry = await relations.setParent('3', null, ME, { dryRun: true })
  assert.deepEqual(fake.mutations, [])
  assert.equal(dry.after.parent, undefined)
  const first = await relations.setParent('2', null, ME)
  assert.deepEqual(calls(fake), [['PmkitRemoveSubIssue', { issueId: 'I_1', subIssueId: 'I_2' }]])
  assert.equal(first.after.parent, 'acme/12')
  clear()
  const second = await relations.setParent('3', null, ME)
  assert.deepEqual(fake.mutations.map((call) => [call.name, call.input.projectId]), [['PmkitDeleteProjectItem', 'PVT_E12'], ['PmkitDeleteProjectItem', 'PVT_E9']])
  assert.equal(second.after.parent, undefined)
  assert.equal(second.after.status.name, 'Todo')
  clear()
  const none = await relations.setParent('3', null, ME)
  assert.deepEqual(fake.mutations, [])
  assert.deepEqual(none.after, none.before)
})

test('setParent null on an issue whose only epic item is archived has no parent to remove and writes nothing', async () => {
  const { fake, relations, clear } = await epicSetup()
  fake.seed({ number: 1, epics: [{ project: 'acme/12', archived: true }] })
  clear()
  const result = await relations.setParent('1', null, ME)
  assert.deepEqual(fake.mutations, [])
  assert.equal(result.before.parent, undefined)
  assert.deepEqual(result.after, result.before)
})

test('setParent to an epic where the issue item is archived is INVALID_INPUT and sends nothing, dry run or not', async () => {
  const { fake, relations, clear } = await epicSetup()
  fake.seed({ number: 1, epics: [{ project: 'acme/12', archived: true }, 'acme/9'] })
  clear()
  const refusal = { code: 'INVALID_INPUT', message: '1 is archived in epic acme/12', nextStep: 'Restore the item from the archived items of the Project on GitHub' }
  await assert.rejects(relations.setParent('1', 'acme/12', ME, { dryRun: true }), refusal)
  await assert.rejects(relations.setParent('1', 'acme/12', ME), refusal)
  assert.deepEqual(fake.mutations, [])
})

test('setParent null previews the epic that remains after the parent issue goes, as the real run reads it', async () => {
  const { fake, relations, clear } = await epicSetup()
  fake.seed({ number: 1 })
  fake.seed({ number: 2, parent: 1, epics: ['acme/12', 'acme/9'], item: { status: 'Todo' } })
  clear()
  const dry = await relations.setParent('2', null, ME, { dryRun: true })
  assert.deepEqual(fake.mutations, [])
  const real = await relations.setParent('2', null, ME)
  assert.equal(real.after.parent, 'acme/9')
  assert.equal(dry.after.parent, real.after.parent)
})

test('setParent to an epic names the add that was done when the delete of the other epic item fails', async () => {
  const { fake, relations, clear } = await epicSetup()
  fake.seed({ number: 1, epics: ['acme/9'] })
  clear()
  fake.failNext('PmkitDeleteProjectItem')
  await assert.rejects(relations.setParent('1', 'acme/12', ME), (error) => {
    assert.equal(error.code, 'UPSTREAM')
    assert.match(error.message, /^GitHub added 1 to epic acme\/12, but removing it from epic acme\/9 failed/)
    return true
  })
  assert.deepEqual(fake.mutations.map((call) => call.name), ['PmkitAddProjectItem', 'PmkitDeleteProjectItem'])
})
