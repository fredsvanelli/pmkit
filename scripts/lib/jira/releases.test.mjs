// Tests of Jira versions as pmkit releases (PMK-79): the pure mapping, then the release operations over the stateful fake,
// through the tracker that wires them.
import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_ENV, TRACKER, fakeJiraFetch } from '../../fake-jira-api.mjs'
import { fakeJiraIssues } from '../../fake-jira-issues.mjs'
import { tempDir, userStoreEnv } from '../../test-helpers.mjs'
import { issueReleaseFields, liveVersions, toRelease } from './releases.mjs'
import { createJiraTracker } from './tracker.mjs'

globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

const NOW = () => new Date('2026-11-22T23:30:00Z')
const ME = 'acc-1'
const DONE = { id: '5', name: 'Done', statusCategory: { key: 'done' } }
const TODO = { id: '1', name: 'To Do', statusCategory: { key: 'new' } }

test('toRelease maps a planned dated version, a released one and a released one without a date', () => {
  assert.deepEqual(toRelease({ id: '10001', name: '1.0', releaseDate: '2026-12-01', released: false, archived: false, description: 'First' }), {
    id: '1.0', name: '1.0', target: '2026-12-01', state: 'planned', description: 'First',
  })
  assert.deepEqual(toRelease({ id: '10002', name: '0.9', releaseDate: '2026-12-01', released: true, archived: false }), {
    id: '0.9', name: '0.9', target: '2026-12-01', released: '2026-12-01T12:00:00Z', state: 'released', description: '',
  })
  assert.deepEqual(toRelease({ id: '10003', name: '0.8', released: true, archived: false }), { id: '0.8', name: '0.8', state: 'released', description: '' })
})

test('issueReleaseFields reads the live versions only: one is release, two are releases sorted', () => {
  const live = (name) => ({ id: name, name, released: false, archived: false })
  assert.deepEqual(issueReleaseFields([]), {})
  assert.deepEqual(issueReleaseFields([live('2.0'), { ...live('1.0'), archived: true }]), { release: '2.0' })
  assert.deepEqual(issueReleaseFields([live('2.0'), live('1.0')]), { releases: ['1.0', '2.0'] })
  assert.deepEqual(liveVersions([live('a'), { ...live('b'), archived: true }]).map((version) => version.name), ['a'])
})

const VERSIONS = [
  { id: '10100', name: '2.0', releaseDate: '2027-01-15' },
  { id: '10101', name: '1.10', released: true, releaseDate: '2026-10-01' },
  { id: '10102', name: '1.2' },
  { id: '10103', name: '0.1', archived: true },
]

function setup({ versions = VERSIONS } = {}) {
  const fake = fakeJiraIssues({ versions })
  const fetch = fakeJiraFetch(fake.routes)
  const config = { root: tempDir(), pmkit: { version: 1, tracker: TRACKER, mappings: { types: { story: 'Story' } } } }
  const tracker = createJiraTracker(config, { env: { ...FAKE_ENV, ...userStoreEnv().env }, now: NOW, fetch })
  return { fake, fetch, tracker }
}

function seedItem(state, fields) {
  const number = state.next.item++
  const key = `ENG-${number}`
  const time = '2026-11-01T00:00:00.000+0000'
  state.items[key] = {
    id: String(10000 + number), key,
    fields: {
      summary: `Item ${number}`, description: null, status: TODO, issuetype: { id: '10001', name: 'Story' }, priority: null, assignee: null,
      labels: [], parent: null, duedate: null, resolution: null, creator: { accountId: ME }, created: time, updated: time, fixVersions: [], ...fields,
    },
  }
  return key
}

test('listReleases sorts with compareReleaseIds, leaves archived versions out and filters by state', async () => {
  const { tracker } = setup()
  assert.deepEqual((await tracker.listReleases()).map((release) => release.id), ['1.2', '1.10', '2.0'])
  assert.deepEqual((await tracker.listReleases({ state: 'released' })).map((release) => release.id), ['1.10'])
  assert.deepEqual((await tracker.listReleases({ state: 'planned' })).map((release) => release.id), ['1.2', '2.0'])
  await assert.rejects(tracker.listReleases({ state: 'closed' }), { code: 'INVALID_INPUT' })
})

test('getRelease reads a version by name; an unknown or archived one is NOT_FOUND', async () => {
  const { tracker } = setup()
  assert.deepEqual(await tracker.getRelease('2.0'), { id: '2.0', name: '2.0', target: '2027-01-15', state: 'planned', description: '' })
  await assert.rejects(tracker.getRelease('nope'), { code: 'NOT_FOUND', message: 'release nope does not exist', nextStep: 'pmkit release list' })
  await assert.rejects(tracker.getRelease('0.1'), { code: 'NOT_FOUND' })
})

test('createRelease refuses a tag, a second name and a taken name before any write', async () => {
  const { fake, tracker } = setup()
  await assert.rejects(tracker.createRelease({ id: '3.0', tag: 'v3.0' }, ME), { code: 'INVALID_INPUT', message: 'Jira versions have no git tag', nextStep: 'Drop --tag on Jira' })
  await assert.rejects(tracker.createRelease({ id: '3.0', name: 'Three' }, ME), { code: 'INVALID_INPUT', message: /one name/ })
  await assert.rejects(tracker.createRelease({ id: '2.0' }, ME), { code: 'CONFLICT' })
  await assert.rejects(tracker.createRelease({ id: '3.0', target: '2027-13-01' }, ME), { code: 'INVALID_INPUT' })
  await assert.rejects(tracker.createRelease({ id: '3.0' }, 'someone-else'), { code: 'INVALID_INPUT' })
  assert.deepEqual(fake.writes(), [])
})

test('createRelease posts the version in the space; a dry run sends no write', async () => {
  const { fake, fetch, tracker } = setup()
  const dry = await tracker.createRelease({ id: '3.0', name: '3.0', target: '2027-03-01', description: 'Third' }, ME, { dryRun: true })
  assert.deepEqual(dry, { before: null, after: { id: '3.0', name: '3.0', target: '2027-03-01', state: 'planned', description: 'Third' } })
  assert.deepEqual(fake.writes(), [])
  const made = await tracker.createRelease({ id: '3.0', target: '2027-03-01', description: 'Third' }, ME)
  assert.deepEqual(made, dry)
  const post = fetch.calls.find((call) => call.method === 'POST' && new URL(call.url).pathname === '/rest/api/3/version')
  assert.deepEqual(JSON.parse(post.body), { name: '3.0', projectId: '10001', description: 'Third', releaseDate: '2027-03-01' })
  const created = fake.state.versions.find((version) => version.name === '3.0')
  assert.ok(!VERSIONS.some((version) => version.id === created.id), 'a new version id clashes with no seeded one')
  assert.deepEqual((await tracker.getRelease('3.0')).target, '2027-03-01')
})

test('releaseIssues lists the issues of a live version', async () => {
  const { fake, tracker } = setup()
  const [a, b] = [seedItem(fake.state, { fixVersions: [{ id: '10100' }] }), seedItem(fake.state, { fixVersions: [{ id: '10100' }, { id: '10103' }] })]
  seedItem(fake.state, { fixVersions: [{ id: '10102' }] })
  assert.deepEqual((await tracker.releaseIssues('2.0', { archived: true })).map((issue) => issue.id), [a, b])
  assert.equal((await tracker.getIssue(b)).release, '2.0', 'the archived version is not its release')
  await assert.rejects(tracker.releaseIssues('nope'), { code: 'NOT_FOUND' })
})

test('markReleased puts released and today (UTC) and returns the unfinished issues; already released is CONFLICT', async () => {
  const { fake, fetch, tracker } = setup()
  seedItem(fake.state, { fixVersions: [{ id: '10100' }], status: DONE })
  const open = seedItem(fake.state, { fixVersions: [{ id: '10100' }] })
  await assert.rejects(tracker.markReleased('2.0', ME, { tag: 'v2.0' }), { code: 'INVALID_INPUT', message: 'Jira versions have no git tag' })
  const dry = await tracker.markReleased('2.0', ME, { dryRun: true })
  assert.equal(dry.after.state, 'released')
  assert.deepEqual(fake.writes(), [])
  const marked = await tracker.markReleased('2.0', ME)
  const put = fetch.calls.find((call) => call.method === 'PUT' && new URL(call.url).pathname === '/rest/api/3/version/10100')
  assert.deepEqual(JSON.parse(put.body), { released: true, releaseDate: '2026-11-22' })
  assert.deepEqual(marked.before.state, 'planned')
  assert.deepEqual(marked.after, { id: '2.0', name: '2.0', target: '2026-11-22', released: '2026-11-22T12:00:00Z', state: 'released', description: '' })
  assert.deepEqual(marked.unfinished.map((issue) => issue.id), [open])
  assert.deepEqual(marked.problems, [])
  assert.deepEqual(dry.after, marked.after)
  await assert.rejects(tracker.markReleased('2.0', ME), { code: 'CONFLICT' })
  await assert.rejects(tracker.markReleased('1.10', ME), { code: 'CONFLICT' })
})
