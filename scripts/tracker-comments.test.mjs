import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { issuePaths } from './lib/local/store.mjs'
import { hashTree, makeRepo, scriptedRandom } from './test-helpers.mjs'

function setup() {
  const root = makeRepo()
  const issuesDir = path.join(root, '.issues')
  const configFile = path.join(issuesDir, 'config.yaml')
  fs.writeFileSync(configFile, fs.readFileSync(configFile, 'utf8').replace(
    /^(  fred: .*)$/m,
    '$1\n  agent:claude: { name: Claude, email: claude@example.com, availability: 1 }',
  ))
  let current = '2026-10-23T12:00:00Z'
  const setNow = (iso) => { current = iso }
  const tracker = createLocalTracker(root, { now: () => new Date(current), random: scriptedRandom([1, 2, 3, 4]) })
  const { id } = tracker.createIssue({ title: 'Talk' }, 'fred').after
  const paths = issuePaths(issuesDir, id)
  const rawEvents = () => fs.readFileSync(paths.events, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  return { root, tracker, id, paths, rawEvents, setNow }
}

test('a comment file name has no colon and the event names the file', () => {
  const { tracker, id, paths, rawEvents } = setup()
  const comment = tracker.comment(id, 'Looks good.\n', 'agent:claude')
  assert.equal(comment.id, '2026-10-23T12-00-00Z-agent-claude')
  assert.deepEqual(fs.readdirSync(paths.comments), [`${comment.id}.md`])
  assert.deepEqual(comment, { id: comment.id, issue: id, author: 'agent:claude', body: 'Looks good.', created: '2026-10-23T12:00:00Z' })
  const last = rawEvents().at(-1)
  assert.deepEqual([last.op, last.by, last.to], ['comment', 'agent:claude', `${comment.id}.md`])
})

test('two comments in the same second get -2 and -3', () => {
  const { tracker, id } = setup()
  const names = ['a', 'b', 'c'].map((body) => tracker.comment(id, body, 'fred').id)
  assert.deepEqual(names, ['2026-10-23T12-00-00Z-fred', '2026-10-23T12-00-00Z-fred-2', '2026-10-23T12-00-00Z-fred-3'])
})

test('listComments sorts by created, then by file name', () => {
  const { tracker, id, setNow } = setup()
  setNow('2026-10-23T12:00:05Z')
  tracker.comment(id, 'late', 'fred')
  setNow('2026-10-23T12:00:01Z')
  tracker.comment(id, 'early one', 'fred')
  tracker.comment(id, 'early two', 'agent:claude')
  assert.deepEqual(tracker.listComments(id).map((comment) => comment.body), ['early two', 'early one', 'late'])
  assert.equal(tracker.listComments(id)[0].author, 'agent:claude')
})

test('listComments is empty for an issue without comments', () => {
  const { tracker, id } = setup()
  assert.deepEqual(tracker.listComments(id), [])
})

test('comment rejects an empty or blank body and a non-string', () => {
  const { tracker, id } = setup()
  for (const body of ['', '  \n', undefined, 5]) {
    assert.throws(() => tracker.comment(id, body, 'fred'), (error) => error.code === 'INVALID_INPUT')
  }
})

test('history returns every event, or those at or after since (a date or a timestamp)', () => {
  const { tracker, id, setNow } = setup()
  setNow('2026-10-24T09:00:00Z')
  tracker.comment(id, 'next day', 'fred')
  setNow('2026-10-24T10:00:00Z')
  tracker.logTime(id, 30, 'fred')
  assert.deepEqual(tracker.getHistory(id).map((event) => event.op), ['create', 'comment', 'log_time'])
  assert.deepEqual(tracker.getHistory(id, { since: '2026-10-24' }).map((event) => event.op), ['comment', 'log_time'])
  assert.deepEqual(tracker.getHistory(id, { since: '2026-10-24T10:00:00Z' }).map((event) => event.op), ['log_time'])
})

test('logTime writes one log_time event with the minutes', () => {
  const { tracker, id, rawEvents } = setup()
  tracker.logTime(id, 45, 'fred')
  const last = rawEvents().at(-1)
  assert.deepEqual([last.op, last.minutes, last.by], ['log_time', 45, 'fred'])
})

test('logTime rejects 0, 1.5, negatives and strings', () => {
  const { tracker, id, rawEvents } = setup()
  const count = rawEvents().length
  for (const minutes of [0, 1.5, -3, '10', NaN]) {
    assert.throws(() => tracker.logTime(id, minutes, 'fred'), (error) => error.code === 'INVALID_INPUT')
  }
  assert.equal(rawEvents().length, count)
})

test('comment and logTime leave issue.md alone and settle drift first', () => {
  const { tracker, id, paths, rawEvents } = setup()
  const edited = fs.readFileSync(paths.file, 'utf8').replace('status: backlog', 'status: done')
  fs.writeFileSync(paths.file, edited)
  tracker.comment(id, 'hello', 'fred')
  assert.equal(fs.readFileSync(paths.file, 'utf8'), edited)
  const events = rawEvents()
  assert.deepEqual(events.slice(-2).map((event) => [event.op, event.synthetic ?? false]), [['move', true], ['comment', false]])
})

test('dry run writes nothing for comment and logTime, and they validate the actor and the issue', () => {
  const { root, tracker, id } = setup()
  const hash = hashTree(root)
  assert.equal(tracker.comment(id, 'x', 'fred', { dryRun: true }).body, 'x')
  tracker.logTime(id, 5, 'fred', { dryRun: true })
  assert.equal(hashTree(root), hash)
  assert.throws(() => tracker.comment(id, 'x', 'nobody'), (error) => error.code === 'INVALID_INPUT')
  assert.throws(() => tracker.logTime('ISS-ZZZZ', 5, 'fred'), (error) => error.code === 'NOT_FOUND')
})
