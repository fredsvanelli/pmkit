import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { makeRepo, fixedNow } from './test-helpers.mjs'

const setup = () => {
  const root = makeRepo('team')
  const tracker = createLocalTracker(root, { now: fixedNow(), gitEmail: 'ana@example.com', env: {} })
  const ids = (filter) => tracker.searchIssues(filter).issues.map((issue) => issue.id.slice(4))
  return { root, tracker, ids }
}
const sorted = (list) => [...list].sort()

test('search returns every readable issue except archived ones, and reports the conflicted issue', () => {
  const { tracker } = setup()
  const { issues, problems } = tracker.searchIssues({})
  assert.equal(issues.length, 11)
  assert.ok(!issues.some((issue) => issue.archived))
  assert.equal(problems.length, 1)
  assert.deepEqual(Object.keys(problems[0]).sort(), ['code', 'id', 'message'])
  assert.deepEqual([problems[0].id, problems[0].code], ['ISS-3Q6T', 'CONFLICT'])
})

test('archived: true includes archived issues', () => {
  const { tracker } = setup()
  const { issues } = tracker.searchIssues({ archived: true })
  assert.equal(issues.length, 12)
  assert.ok(issues.some((issue) => issue.id === 'ISS-7D8K'))
})

test('text matches the title and the description, ignoring case', () => {
  const { ids } = setup()
  assert.deepEqual(sorted(ids({ text: 'WEBHOOK' })), ['4P8A', '7K3Q', '8C4W'])
  assert.deepEqual(ids({ text: 'hmac' }), ['4P8A'])
  assert.deepEqual(ids({ text: 'no such words' }), [])
})

test('categories keeps issues in any listed category', () => {
  const { ids } = setup()
  assert.deepEqual(sorted(ids({ categories: ['done'] })), ['4P8A', '7K3Q', '9T2M'])
  assert.deepEqual(sorted(ids({ categories: ['triage', 'in_review'] })), ['1V9Z', '8C4W'])
})

test('types keeps issues of any listed type', () => {
  const { ids } = setup()
  assert.deepEqual(sorted(ids({ types: ['chore'] })), ['0G5E', '6J0B'])
})

test('assignee takes a member id, none, or me', () => {
  const { ids } = setup()
  assert.deepEqual(sorted(ids({ assignee: 'fred' })), ['4M2S', '5N1R', '7K3Q', '9T2M'])
  assert.deepEqual(sorted(ids({ assignee: 'none' })), ['1V9Z', '3F7H', '6J0B'])
  assert.deepEqual(sorted(ids({ assignee: 'me' })), ['0G5E', '2X6D', '4P8A', '8C4W'])
})

test('assignee me throws NOT_CONFIGURED when no member matches', () => {
  const root = makeRepo('team')
  const tracker = createLocalTracker(root, { now: fixedNow(), gitEmail: 'nobody@example.com', env: {} })
  assert.throws(() => tracker.searchIssues({ assignee: 'me' }), (error) => error.code === 'NOT_CONFIGURED')
})

test('assignee me falls back to PMKIT_USER', () => {
  const root = makeRepo('team')
  const tracker = createLocalTracker(root, { now: fixedNow(), gitEmail: '', env: { PMKIT_USER: 'fred' } })
  assert.deepEqual(tracker.searchIssues({ assignee: 'me' }).issues.map((issue) => issue.assignee), ['fred', 'fred', 'fred', 'fred'])
})

test('labels keeps issues that have all the listed labels', () => {
  const { ids } = setup()
  assert.deepEqual(sorted(ids({ labels: ['webhooks', 'backend'] })), ['4P8A', '7K3Q', '8C4W'])
  assert.deepEqual(sorted(ids({ labels: ['billing'] })), ['2X6D', '4M2S', '9T2M'])
})

test('sprint takes an id or none', () => {
  const { ids } = setup()
  assert.deepEqual(sorted(ids({ sprint: '2026-10-12' })), ['2X6D', '4M2S', '5N1R', '8C4W'])
  assert.deepEqual(sorted(ids({ sprint: '2026-09-28' })), ['4P8A', '7K3Q', '9T2M'])
  assert.deepEqual(sorted(ids({ sprint: 'none' })), ['0G5E', '1V9Z', '3F7H', '6J0B'])
})

test('parent keeps the children of an epic or of an issue', () => {
  const { ids } = setup()
  assert.deepEqual(sorted(ids({ parent: 'EPC-2M9D' })), ['2X6D', '4P8A', '7K3Q', '8C4W'])
  assert.deepEqual(ids({ parent: 'iss-2x6d' }), ['4M2S'])
})

test('blocked true keeps issues with an unfinished blocker, false keeps the rest', () => {
  const { ids } = setup()
  assert.deepEqual(ids({ blocked: true }), ['2X6D'])
  const free = ids({ blocked: false })
  assert.equal(free.length, 10)
  assert.ok(free.includes('8C4W'), 'its only blocker is done')
})

test('updatedBefore and updatedAfter compare against updated, as a date or a timestamp', () => {
  const { ids } = setup()
  assert.deepEqual(ids({ updatedBefore: '2026-10-06' }), ['9T2M'])
  assert.deepEqual(sorted(ids({ updatedAfter: '2026-10-21' })), ['3F7H', '5N1R', '8C4W'])
  assert.deepEqual(sorted(ids({ updatedAfter: '2026-10-21T14:00:00Z' })), ['3F7H', '5N1R'])
  assert.deepEqual(sorted(ids({ updatedAfter: '2026-10-08', updatedBefore: '2026-10-14' })), ['4M2S', '4P8A', '6J0B'])
})

test('filters combine', () => {
  const { ids } = setup()
  assert.deepEqual(sorted(ids({ assignee: 'fred', categories: ['todo', 'in_progress'], sprint: '2026-10-12' })), ['4M2S', '5N1R'])
})

test('sort priority follows the configured order, then updated descending, with no priority last', () => {
  const { ids } = setup()
  const expected = ['9T2M', '8C4W', '2X6D', '7K3Q', '3F7H', '5N1R', '0G5E', '4M2S', '4P8A', '6J0B', '1V9Z']
  assert.deepEqual(ids({}), expected)
  assert.deepEqual(ids({ sort: 'priority' }), expected)
})

test('sort updated puts the newest first', () => {
  const { ids } = setup()
  assert.deepEqual(ids({ sort: 'updated' }), ['3F7H', '5N1R', '8C4W', '1V9Z', '0G5E', '2X6D', '4M2S', '4P8A', '6J0B', '7K3Q', '9T2M'])
})

test('sort created puts the oldest first', () => {
  const { ids } = setup()
  assert.deepEqual(ids({ sort: 'created' }), ['7K3Q', '4P8A', '9T2M', '2X6D', '5N1R', '8C4W', '3F7H', '6J0B', '0G5E', '4M2S', '1V9Z'])
})

test('sort due puts the earliest first and issues without a due date last', () => {
  const { tracker } = setup()
  const { issues } = tracker.searchIssues({ sort: 'due' })
  assert.deepEqual(issues.slice(0, 4).map((issue) => issue.due), ['2026-10-09', '2026-10-20', '2026-10-23', '2026-11-30'])
  assert.ok(issues.slice(4).every((issue) => issue.due === undefined))
})

test('limit keeps the first n results after sorting', () => {
  const { ids } = setup()
  assert.deepEqual(ids({ limit: 3 }), ['9T2M', '8C4W', '2X6D'])
  assert.deepEqual(ids({ limit: 0 }), [])
})

test('results carry blocks and children like getIssue', () => {
  const { tracker } = setup()
  const byId = new Map(tracker.searchIssues({}).issues.map((issue) => [issue.id, issue]))
  assert.deepEqual(byId.get('ISS-5N1R').blocks, ['ISS-2X6D'])
  assert.deepEqual(byId.get('ISS-2X6D').children, ['ISS-4M2S'])
  assert.deepEqual(byId.get('ISS-7K3Q').blocks, ['ISS-8C4W'])
  assert.deepEqual(byId.get('ISS-7K3Q'), tracker.getIssue('ISS-7K3Q'))
})

test('an unknown filter key, sort or value type is INVALID_INPUT', () => {
  const { tracker } = setup()
  for (const filter of [{ colour: 'red' }, { sort: 'size' }, { limit: -1 }, { categories: 'done' }, { blocked: 'yes' }]) {
    assert.throws(() => tracker.searchIssues(filter), (error) => error.code === 'INVALID_INPUT', JSON.stringify(filter))
  }
})

test('getIssue on the conflicted issue throws CONFLICT with the doctor as next step; its siblings still read', () => {
  const { tracker } = setup()
  assert.throws(() => tracker.getIssue('ISS-3Q6T'), (error) => error.code === 'CONFLICT' && error.nextStep === '/pmkit:local:doctor')
  assert.equal(tracker.getIssue('ISS-2X6D').children.length, 1)
})
