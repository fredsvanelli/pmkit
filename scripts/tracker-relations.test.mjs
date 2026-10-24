import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { issuePaths } from './lib/local/store.mjs'
import { hashTree, makeRepo, scriptedRandom } from './test-helpers.mjs'

function setup(count = 3) {
  const root = makeRepo()
  const issuesDir = path.join(root, '.issues')
  const tracker = createLocalTracker(root, {
    now: () => new Date('2026-10-23T12:00:00Z'),
    random: scriptedRandom(Array.from({ length: count }, (_, i) => [1, 2, 3, 4 + i]).flat()),
  })
  const ids = Array.from({ length: count }, (_, i) => tracker.createIssue({ title: `Issue ${i}` }, 'fred').after.id)
  const rawEvents = (id) => fs.readFileSync(issuePaths(issuesDir, id).events, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  return { root, issuesDir, tracker, ids, rawEvents }
}

test('blocks adds the blocker to the blocked issue and writes the event there', () => {
  const { tracker, ids: [a, b], rawEvents } = setup()
  const result = tracker.link(a, b, 'blocks', 'fred')
  assert.deepEqual(tracker.getIssue(b).blockedBy, [a])
  assert.deepEqual(tracker.getIssue(a).blocks, [b])
  assert.deepEqual(result.before.blocks, [])
  assert.deepEqual(result.after.blocks, [b])
  const last = rawEvents(b).at(-1)
  assert.deepEqual([last.op, last.field, last.to], ['link', 'blocked_by', a])
  assert.equal(rawEvents(a).length, 1)
})

test('related writes one event on each issue and returns the other side', () => {
  const { tracker, ids: [a, b], rawEvents } = setup()
  const result = tracker.link(a, b, 'related', 'fred')
  assert.deepEqual(tracker.getIssue(a).related, [b])
  assert.deepEqual(tracker.getIssue(b).related, [a])
  assert.deepEqual(result.after.related, [b])
  assert.deepEqual(result.other.after.related, [a])
  assert.equal(rawEvents(a).at(-1).to, b)
  assert.equal(rawEvents(b).at(-1).to, a)
})

test('duplicate puts the target in duplicate_of of the first issue', () => {
  const { tracker, ids: [a, b], rawEvents } = setup()
  tracker.link(a, b, 'duplicate', 'fred')
  assert.deepEqual(tracker.getIssue(a).duplicateOf, [b])
  assert.deepEqual(tracker.getIssue(b).duplicateOf, [])
  assert.equal(rawEvents(a).at(-1).field, 'duplicate_of')
})

test('a blocks cycle throws INVALID_INPUT naming the path', () => {
  const { tracker, ids: [a, b, c] } = setup()
  tracker.link(a, b, 'blocks', 'fred')
  tracker.link(b, c, 'blocks', 'fred')
  assert.throws(
    () => tracker.link(c, a, 'blocks', 'fred'),
    (error) => error.code === 'INVALID_INPUT' && error.message.includes(`${c} → ${a} → ${b} → ${c}`),
  )
})

test('linking an issue to itself or with an unknown kind throws INVALID_INPUT', () => {
  const { tracker, ids: [a] } = setup()
  assert.throws(() => tracker.link(a, a, 'related', 'fred'), (error) => error.code === 'INVALID_INPUT')
  assert.throws(() => tracker.link(a, a.toLowerCase(), 'blocks', 'fred'), (error) => error.code === 'INVALID_INPUT')
  assert.throws(() => tracker.link(a, a, 'friends', 'fred'), (error) => error.code === 'INVALID_INPUT')
})

test('linking twice is a no-op that writes no event', () => {
  const { tracker, ids: [a, b], rawEvents } = setup()
  tracker.link(a, b, 'related', 'fred')
  const count = [rawEvents(a).length, rawEvents(b).length]
  tracker.link(a, b, 'related', 'fred')
  tracker.link(b, a, 'related', 'fred')
  assert.deepEqual([rawEvents(a).length, rawEvents(b).length], count)
})

test('unlink restores the previous lists', () => {
  const { tracker, ids: [a, b] } = setup()
  const start = [tracker.getIssue(a), tracker.getIssue(b)]
  for (const kind of ['blocks', 'related', 'duplicate']) {
    tracker.link(a, b, kind, 'fred')
    tracker.unlink(a, b, kind, 'fred')
  }
  for (const [index, id] of [a, b].entries()) {
    const now = tracker.getIssue(id)
    for (const key of ['blockedBy', 'blocks', 'related', 'duplicateOf']) assert.deepEqual(now[key], start[index][key], key)
  }
})

test('dry run writes nothing for any link kind', () => {
  const { root, tracker, ids: [a, b] } = setup()
  const hash = hashTree(root)
  for (const kind of ['blocks', 'related', 'duplicate']) {
    const result = tracker.link(a, b, kind, 'fred', { dryRun: true })
    assert.notDeepEqual(result.after, result.before)
  }
  assert.equal(hashTree(root), hash)
})

test('links need existing issues and a known actor', () => {
  const { tracker, ids: [a] } = setup()
  assert.throws(() => tracker.link(a, 'ISS-ZZZZ', 'blocks', 'fred'), (error) => error.code === 'NOT_FOUND')
  assert.throws(() => tracker.link(a, a, 'blocks', 'nobody'), (error) => error.code === 'INVALID_INPUT')
})

test('setParent sets and clears the parent with one update event, and children shows on read', () => {
  const { tracker, ids: [a, b], rawEvents } = setup()
  const { after } = tracker.setParent(b, a, 'fred')
  assert.equal(after.parent, a)
  assert.deepEqual(tracker.getIssue(a).children, [b])
  const last = rawEvents(b).at(-1)
  assert.deepEqual([last.op, last.field, last.from, last.to], ['update', 'parent', null, a])
  tracker.setParent(b, null, 'fred')
  assert.equal(tracker.getIssue(b).parent, undefined)
  assert.deepEqual(tracker.getIssue(a).children, [])
  assert.deepEqual(rawEvents(b).at(-1).from, a)
})

test('setParent accepts an epic and rejects loops, self and missing parents', () => {
  const { issuesDir, tracker, ids: [a, b, c] } = setup()
  fs.mkdirSync(path.join(issuesDir, 'epics', 'EPC-AAAA'), { recursive: true })
  fs.writeFileSync(path.join(issuesDir, 'epics', 'EPC-AAAA', 'epic.md'), '---\nid: EPC-AAAA\n---\n')
  assert.equal(tracker.setParent(a, 'EPC-AAAA', 'fred').after.parent, 'EPC-AAAA')
  tracker.setParent(b, a, 'fred')
  tracker.setParent(c, b, 'fred')
  assert.throws(() => tracker.setParent(a, c, 'fred'), (error) => error.code === 'INVALID_INPUT' && /loop/.test(error.message))
  assert.throws(() => tracker.setParent(a, a, 'fred'), (error) => error.code === 'INVALID_INPUT')
  assert.throws(() => tracker.setParent(a, 'ISS-ZZZZ', 'fred'), (error) => error.code === 'INVALID_INPUT')
})

test('setParent twice to the same parent is a no-op, and dry run writes nothing', () => {
  const { root, tracker, ids: [a, b], rawEvents } = setup()
  tracker.setParent(b, a, 'fred')
  const count = rawEvents(b).length
  tracker.setParent(b, a, 'fred')
  assert.equal(rawEvents(b).length, count)
  const hash = hashTree(root)
  tracker.setParent(b, null, 'fred', { dryRun: true })
  assert.equal(hashTree(root), hash)
})

test('getIssue skips a sibling that does not parse when it fills blocks and children', () => {
  const { issuesDir, tracker, ids: [a, b, c] } = setup()
  tracker.link(a, b, 'blocks', 'fred')
  fs.writeFileSync(issuePaths(issuesDir, c).file, '<<<<<<< HEAD\nx\n>>>>>>> other\n')
  assert.deepEqual(tracker.getIssue(a).blocks, [b])
})

test('setParent stops at a hand-edited loop that does not include the issue', () => {
  const { tracker, issuesDir, ids: [a, b, c] } = setup()
  const setRaw = (id, parent) => {
    const { file } = issuePaths(issuesDir, id)
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('\ncreated:', `\nparent: ${parent}\ncreated:`))
  }
  setRaw(b, c)
  setRaw(c, b)
  assert.throws(
    () => tracker.setParent(a, b, 'fred'),
    (error) => error.code === 'INVALID_INPUT' && error.message.includes(`${b} → ${c} → ${b}`),
  )
})
