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

test('listTimeEntries returns the log_time events in order with the total', () => {
  const { tracker, id, setNow } = setup()
  assert.deepEqual(tracker.listTimeEntries(id), { issue: id, entries: [], total: 0, totalTime: '0m', byPerson: [], bySprint: [], ignored: 0 })
  setNow('2026-10-24T10:00:00Z')
  tracker.logTime(id, 30, 'fred')
  tracker.comment(id, 'between', 'fred')
  tracker.logTime(id, 15, 'fred')
  assert.deepEqual(tracker.listTimeEntries(id), {
    issue: id,
    entries: [
      { at: '2026-10-24T10:00:00Z', by: 'fred', minutes: 30, time: '30m' },
      { at: '2026-10-24T10:00:00Z', by: 'fred', minutes: 15, time: '15m' },
    ],
    total: 45,
    totalTime: '45m',
    byPerson: [{ by: 'fred', minutes: 45, time: '45m' }],
    bySprint: [{ sprint: null, minutes: 45, time: '45m' }],
    ignored: 0,
  })
  assert.throws(() => tracker.listTimeEntries('NOPE-1'), (error) => error.code === 'NOT_FOUND')
})

test('listTimeEntries leaves out log_time events whose minutes is not a positive integer, and counts them', () => {
  const { tracker, id, paths } = setup()
  tracker.logTime(id, 30, 'fred')
  const at = '2026-10-24T10:00:00Z'
  const bad = [{}, { minutes: '30' }, { minutes: 0 }, { minutes: -5 }, { minutes: 1.5 }]
  fs.appendFileSync(paths.events, bad.map((extra) => `${JSON.stringify({ at, by: 'fred', op: 'log_time', ...extra })}\n`).join(''))
  const got = tracker.listTimeEntries(id)
  assert.deepEqual(got.entries, [{ at: got.entries[0].at, by: 'fred', minutes: 30, time: '30m' }])
  assert.equal(got.total, 30)
  assert.equal(got.ignored, 5)
})

test('listTimeEntries totals the minutes per person and per sprint, by the date of each entry', () => {
  const { root, tracker, id, setNow } = setup()
  const sprints = path.join(root, '.issues', 'sprints')
  fs.mkdirSync(sprints, { recursive: true })
  const sprint = (name, start, end) => fs.writeFileSync(path.join(sprints, `${name}.yaml`), `name: ${name}\nstart: ${start}\nend: ${end}\nstate: active\ncapacity: { fred: 5 }\n`)
  sprint('s1', '2026-10-12', '2026-10-25')
  sprint('s2', '2026-10-26', '2026-11-08')
  const log = (at, minutes, by) => { setNow(at); tracker.logTime(id, minutes, by) }
  log('2026-10-11T23:00:00Z', 10, 'fred')
  log('2026-10-25T23:59:00Z', 90, 'fred')
  log('2026-10-26T00:00:00Z', 30, 'agent:claude')
  log('2026-10-27T09:00:00Z', 60, 'fred')
  const got = tracker.listTimeEntries(id)
  assert.deepEqual(got.byPerson, [{ by: 'fred', minutes: 160, time: '2h40' }, { by: 'agent:claude', minutes: 30, time: '30m' }])
  assert.deepEqual(got.bySprint, [{ sprint: null, minutes: 10, time: '10m' }, { sprint: 's1', minutes: 90, time: '1h30' }, { sprint: 's2', minutes: 90, time: '1h30' }])
  assert.equal(got.total, 190)
  assert.equal(got.totalTime, '3h10')
})

test('listTimeEntries skips only the sprint file that does not parse, and reads no sprints without entries', () => {
  const { root, tracker, id } = setup()
  const sprints = path.join(root, '.issues', 'sprints')
  fs.mkdirSync(sprints, { recursive: true })
  fs.writeFileSync(path.join(sprints, 'bad.yaml'), 'name: [unclosed\n')
  assert.equal(tracker.listTimeEntries(id).sprintsUnread, undefined, 'no entries, so no sprint is read')
  fs.writeFileSync(path.join(sprints, 'good.yaml'), 'name: good\nstart: 2026-10-01\nend: 2026-10-31\nstate: active\ncapacity: { fred: 5 }\n')
  tracker.logTime(id, 30, 'fred')
  const got = tracker.listTimeEntries(id)
  assert.equal(got.total, 30)
  assert.deepEqual(got.sprintsUnread, ['bad'])
  assert.deepEqual(got.bySprint.map((row) => row.sprint), ['good'])
})

test('listTimeEntries places an entry by its UTC date, whatever the zone or type of its at', () => {
  const { root, tracker, id, paths } = setup()
  const sprints = path.join(root, '.issues', 'sprints')
  fs.mkdirSync(sprints, { recursive: true })
  const sprint = (name, start, end) => fs.writeFileSync(path.join(sprints, `${name}.yaml`), `name: ${name}\nstart: ${start}\nend: ${end}\nstate: active\ncapacity: { fred: 5 }\n`)
  sprint('s1', '2026-10-12', '2026-10-25')
  sprint('s2', '2026-10-26', '2026-11-08')
  const line = (at) => `${JSON.stringify({ at, by: 'fred', op: 'log_time', minutes: 10 })}\n`
  // A time without a zone is UTC: '2026-10-11 23:00' is before s1, not 2026-10-12 in a zone behind UTC.
  // 2026-10-26T02:00+05:00 is 2026-10-25T21:00Z: sprint s1. 2026-10-25T23:00-05:00 is 2026-10-26T04:00Z: sprint s2.
  fs.appendFileSync(paths.events, line('2026-10-26T02:00:00+05:00') + line('2026-10-25T23:00:00-05:00') + line(1761000000000) + line('not a date') + line('2026-10-11 23:00'))
  const got = tracker.listTimeEntries(id)
  assert.deepEqual(Object.fromEntries(got.bySprint.map((row) => [row.sprint, row.minutes])), { s1: 10, s2: 10, null: 30 })
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

test('a reply writes reply_to and reads back as parent', () => {
  const { tracker, id, paths, setNow } = setup()
  const root = tracker.comment(id, 'question', 'fred')
  setNow('2026-10-23T12:00:05Z')
  const reply = tracker.comment(id, 'answer', 'fred', { replyTo: root.id })
  assert.equal(reply.parent, root.id)
  assert.equal(root.parent, undefined)
  assert.match(fs.readFileSync(path.join(paths.comments, `${reply.id}.md`), 'utf8'), new RegExp(`reply_to: ${root.id}`))
  assert.deepEqual(tracker.listComments(id).map((c) => c.parent), [undefined, root.id])
})

test('a reply to a reply attaches to the root', () => {
  const { tracker, id, setNow } = setup()
  const root = tracker.comment(id, 'question', 'fred')
  setNow('2026-10-23T12:00:05Z')
  const reply = tracker.comment(id, 'answer', 'fred', { replyTo: root.id })
  setNow('2026-10-23T12:00:09Z')
  assert.equal(tracker.comment(id, 'more', 'fred', { replyTo: reply.id }).parent, root.id)
})

test('a reply to an unknown comment is NOT_FOUND and writes nothing', () => {
  const { tracker, id, root } = setup()
  const before = hashTree(root)
  assert.throws(() => tracker.comment(id, 'x', 'fred', { replyTo: 'nope' }), (e) => e.code === 'NOT_FOUND' && e.message === `comment nope is not on ${id}`)
  assert.deepEqual(hashTree(root), before)
})

test('a dry-run reply returns the comment and writes nothing', () => {
  const { tracker, id, root } = setup()
  const parent = tracker.comment(id, 'question', 'fred')
  const before = hashTree(root)
  assert.equal(tracker.comment(id, 'answer', 'fred', { dryRun: true, replyTo: parent.id }).parent, parent.id)
  assert.deepEqual(hashTree(root), before)
})

test('resolveThread marks the root, logs one event and reads back', () => {
  const { tracker, id, paths, rawEvents, setNow } = setup()
  const root = tracker.comment(id, 'question', 'fred')
  setNow('2026-10-23T12:00:05Z')
  const reply = tracker.comment(id, 'answer', 'fred', { replyTo: root.id })
  setNow('2026-10-23T12:00:09Z')
  const { before, after } = tracker.resolveThread(id, reply.id, 'fred')
  assert.equal(before.resolved, undefined)
  assert.deepEqual(after, { ...root, resolved: { at: '2026-10-23T12:00:09Z', by: 'fred' } })
  assert.deepEqual(tracker.listComments(id).map((c) => c.resolved?.by), ['fred', undefined])
  const last = rawEvents().at(-1)
  assert.deepEqual([last.op, last.field, last.to], ['comment', 'resolved', `${root.id}.md`])
  assert.match(fs.readFileSync(path.join(paths.comments, `${root.id}.md`), 'utf8'), /resolved_by: fred/)
})

test('resolving a resolved thread writes nothing', () => {
  const { tracker, id, root: repo } = setup()
  const c = tracker.comment(id, 'q', 'fred')
  tracker.resolveThread(id, c.id, 'fred')
  const before = hashTree(repo)
  const again = tracker.resolveThread(id, c.id, 'fred')
  assert.deepEqual(again.after, again.before)
  assert.deepEqual(hashTree(repo), before)
})

test('a dry-run resolve returns the result and writes nothing', () => {
  const { tracker, id, root: repo } = setup()
  const c = tracker.comment(id, 'q', 'fred')
  const before = hashTree(repo)
  assert.equal(tracker.resolveThread(id, c.id, 'fred', { dryRun: true }).after.resolved.by, 'fred')
  assert.deepEqual(hashTree(repo), before)
})

test('resolveThread on an unknown comment is NOT_FOUND, and an unknown actor is refused', () => {
  const { tracker, id } = setup()
  assert.throws(() => tracker.resolveThread(id, 'nope', 'fred'), { code: 'NOT_FOUND' })
  const c = tracker.comment(id, 'q', 'fred')
  assert.throws(() => tracker.resolveThread(id, c.id, 'stranger'), { code: 'INVALID_INPUT' })
})
