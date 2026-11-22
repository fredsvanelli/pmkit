// Tests of the Jira Relations family (link, unlink, setParent) over
// the stateful fake Jira, through the tracker that gives them their context.
import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_ENV, TRACKER, fakeJiraFetch } from '../../fake-jira-api.mjs'
import { fakeJiraIssues } from '../../fake-jira-issues.mjs'
import { tempDir, userStoreEnv } from '../../test-helpers.mjs'
import { createJiraTracker } from './tracker.mjs'

globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

const NOW = () => new Date('2026-11-22T12:00:00Z')
const TYPES = { story: 'Story', bug: 'Bug', epic: 'Epic', subtask: 'Sub-task' }
const STATUS = {
  todo: { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
  doing: { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
  done: { id: '5', name: 'Done', statusCategory: { key: 'done' } },
}
const WORK_TYPE = { story: { id: '10001', name: 'Story' }, epic: { id: '10000', name: 'Epic' } }

/** A tracker over a fresh fake, its own user store and repository root. */
function setup({ requireResolution, pmkit = {}, routes = {}, context } = {}) {
  const fake = fakeJiraIssues({ requireResolution })
  const fetch = fakeJiraFetch({ ...fake.routes, ...routes })
  const at = context ?? { root: tempDir(), env: { ...FAKE_ENV, ...userStoreEnv().env } }
  const config = { root: at.root, pmkit: { version: 1, tracker: TRACKER, mappings: { types: TYPES }, ...pmkit } }
  const tracker = createJiraTracker(config, { env: at.env, now: NOW, fetch })
  return { fake, fetch, tracker, context: at }
}

/** Puts `count` Story items into the fake's state directly, one second apart, with `fields` over the defaults. */
function seed(state, count = 1, fields = {}) {
  const keys = []
  for (let index = 0; index < count; index += 1) {
    const number = state.next.item++
    const time = new Date(Date.parse('2026-11-01T00:00:00Z') + number * 1000).toISOString().replace('Z', '+0000')
    const key = `ENG-${number}`
    state.items[key] = {
      id: String(10000 + number), key,
      fields: {
        summary: `Item ${number}`, description: null, status: STATUS.todo, issuetype: WORK_TYPE.story, priority: null, assignee: null,
        labels: [], parent: null, duedate: null, resolution: null, creator: { accountId: 'acc-1' }, created: time, updated: time,
        ...(typeof fields === 'function' ? fields(number) : fields),
      },
    }
    keys.push(key)
  }
  return keys
}

const ME = 'acc-1'
const BLOCKS = { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }

test('link posts the link type with from as the inward issue and returns the issue read again', async () => {
  const { fake, tracker } = setup()
  seed(fake.state, 2)
  const result = await tracker.link('ENG-1', 'ENG-2', 'blocks', ME)
  assert.deepEqual(result.before.blocks, [])
  assert.deepEqual(result.after.blocks, ['ENG-2'])
  assert.deepEqual(fake.writes(), [{ method: 'POST', path: '/rest/api/3/issueLink', body: { type: { name: 'Blocks' }, inwardIssue: { key: 'ENG-1' }, outwardIssue: { key: 'ENG-2' } } }])
  assert.deepEqual((await tracker.getIssue('ENG-2')).blockedBy, ['ENG-1'])
})

test('link related and duplicate use their link types', async () => {
  const { fake, tracker } = setup()
  seed(fake.state, 2)
  assert.deepEqual((await tracker.link('ENG-1', 'ENG-2', 'related', ME)).after.related, ['ENG-2'])
  assert.deepEqual((await tracker.link('ENG-1', 'ENG-2', 'duplicate', ME)).after.duplicateOf, ['ENG-2'])
  assert.deepEqual(fake.writes().map((write) => write.body.type.name), ['Relates', 'Duplicate'])
})

test('an existing link and a dry run send nothing', async () => {
  const { fake, tracker } = setup()
  seed(fake.state, 2)
  const dry = await tracker.link('ENG-1', 'ENG-2', 'blocks', ME, { dryRun: true })
  assert.deepEqual(dry.after.blocks, ['ENG-2'])
  assert.deepEqual(fake.writes(), [])
  await tracker.link('ENG-1', 'ENG-2', 'blocks', ME)
  const again = await tracker.link('ENG-1', 'ENG-2', 'blocks', ME)
  assert.deepEqual(again.after, again.before)
  assert.equal(fake.writes().length, 1)
})

test('link refuses a self link, an unknown kind, a wrong actor and a blocks loop with the path', async () => {
  const { fake, tracker } = setup()
  seed(fake.state, 3)
  await assert.rejects(tracker.link('ENG-1', 'eng-1', 'blocks', ME), { code: 'INVALID_INPUT', message: 'ENG-1 cannot be linked to itself' })
  await assert.rejects(tracker.link('ENG-1', 'ENG-2', 'likes', ME), { code: 'INVALID_INPUT' })
  await assert.rejects(tracker.link('ENG-1', 'ENG-2', 'blocks', 'acc-9'), { code: 'INVALID_INPUT' })
  await assert.rejects(tracker.link('ENG-1', 'ENG-99', 'blocks', ME), { code: 'NOT_FOUND' })
  await tracker.link('ENG-1', 'ENG-2', 'blocks', ME)
  await tracker.link('ENG-2', 'ENG-3', 'blocks', ME)
  await assert.rejects(tracker.link('ENG-2', 'ENG-1', 'blocks', ME), { code: 'INVALID_INPUT', message: /ENG-2 → ENG-1 → ENG-2/ })
  await assert.rejects(tracker.link('ENG-3', 'ENG-1', 'blocks', ME), { code: 'INVALID_INPUT', message: /ENG-3 → ENG-1 → ENG-2 → ENG-3/ })
  assert.equal(fake.writes().length, 2)
})

test('a site without the link type is NOT_SUPPORTED, naming the site', async () => {
  const types = { json: { issueLinkTypes: [BLOCKS] } }
  const { fake, tracker } = setup({ routes: { 'GET /rest/api/3/issueLinkType': types } })
  seed(fake.state, 2)
  await assert.rejects(tracker.link('ENG-1', 'ENG-2', 'related', ME), { code: 'NOT_SUPPORTED', message: 'Jira at acme.atlassian.net has no Relates link type' })
  assert.deepEqual(fake.writes(), [])
})

test('unlink deletes the links from a to b; related works in either direction, blocks only from the inward side', async () => {
  const { fake, tracker } = setup()
  seed(fake.state, 2)
  await tracker.link('ENG-1', 'ENG-2', 'blocks', ME)
  await tracker.link('ENG-2', 'ENG-1', 'related', ME)
  const dry = await tracker.unlink('ENG-1', 'ENG-2', 'related', ME, { dryRun: true })
  assert.deepEqual(dry.after.related, [])
  assert.equal(fake.writes().length, 2)
  const none = await tracker.unlink('ENG-2', 'ENG-1', 'blocks', ME)
  assert.deepEqual(none.after, none.before)
  assert.equal(fake.writes().length, 2)
  assert.deepEqual((await tracker.unlink('ENG-1', 'ENG-2', 'related', ME)).after.related, [])
  assert.deepEqual((await tracker.unlink('ENG-1', 'ENG-2', 'blocks', ME)).after.blocks, [])
  assert.deepEqual(fake.writes().slice(2).map((write) => write.method), ['DELETE', 'DELETE'])
  assert.deepEqual(fake.state.links, [])
})

test('setParent sets and clears the parent; no-ops and dry runs send nothing', async () => {
  const { fake, tracker } = setup()
  seed(fake.state, 2)
  const cleared = await tracker.setParent('ENG-2', null, ME)
  assert.deepEqual(cleared.after, cleared.before)
  assert.deepEqual((await tracker.setParent('ENG-2', 'ENG-1', ME, { dryRun: true })).after.parent, 'ENG-1')
  assert.deepEqual(fake.writes(), [])
  assert.equal((await tracker.setParent('ENG-2', 'eng-1', ME)).after.parent, 'ENG-1')
  assert.deepEqual(fake.writes(), [{ method: 'PUT', path: '/rest/api/3/issue/ENG-2', body: { fields: { parent: { key: 'ENG-1' } } } }])
  const same = await tracker.setParent('ENG-2', 'ENG-1', ME)
  assert.deepEqual(same.after, same.before)
  assert.equal(fake.writes().length, 1)
  assert.equal((await tracker.setParent('ENG-2', null, ME, { dryRun: true })).after.parent, undefined)
  const removed = await tracker.setParent('ENG-2', null, ME)
  assert.equal(removed.after.parent, undefined)
  assert.deepEqual(fake.writes()[1].body, { fields: { parent: null } })
})

test('setParent refuses a self parent, a loop with the path, a bad key and a wrong actor', async () => {
  const { fake, tracker } = setup()
  seed(fake.state, 3)
  await tracker.setParent('ENG-2', 'ENG-1', ME)
  await tracker.setParent('ENG-3', 'ENG-2', ME)
  await assert.rejects(tracker.setParent('ENG-1', 'ENG-1', ME), { code: 'INVALID_INPUT', message: 'ENG-1 cannot be its own parent' })
  await assert.rejects(tracker.setParent('ENG-1', 'ENG-3', ME), { code: 'INVALID_INPUT', message: 'parent loop: ENG-1 → ENG-3 → ENG-2 → ENG-1' })
  await assert.rejects(tracker.setParent('ENG-1', 'nope', ME), { code: 'NOT_FOUND' })
  await assert.rejects(tracker.setParent('ENG-1', 'ENG-2', 'acc-9'), { code: 'INVALID_INPUT' })
  assert.equal(fake.writes().length, 2)
})
