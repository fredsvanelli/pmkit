import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { issuePaths } from './lib/local/store.mjs'
import { inboxGet, userDir } from './lib/user-store.mjs'
import { hashTree, makeRepo, userStoreEnv } from './test-helpers.mjs'

const SINCE = '2026-10-30T00:00:00Z'
const code = (value) => (error) => error.code === value

function setup() {
  const root = makeRepo('no-sprints')
  const configFile = path.join(root, '.issues', 'config.yaml')
  fs.writeFileSync(configFile, fs.readFileSync(configFile, 'utf8').replace(
    /^(  fred: .*)$/m,
    '$1\n  agent:claude: { name: Claude, email: claude@example.com, availability: 1 }',
  ))
  const { env } = userStoreEnv()
  let seed = 1
  let current = '2026-10-31T10:00:00Z'
  const setNow = (iso) => { current = iso }
  const tracker = createLocalTracker(root, { now: () => new Date(current), random: (n) => (seed = (seed * 7919 + 13) % 100003) % n, env })
  const paths = (id) => issuePaths(path.join(root, '.issues'), id)
  const keys = (items) => items.map((item) => `${item.kind}:${item.issue}:${item.in}:${item.by}`)
  return { root, env, tracker, setNow, paths, keys }
}

test('an assignment by another member shows, a self-assignment and an older one do not', () => {
  const { tracker, setNow, keys } = setup()
  const { id } = tracker.createIssue({ title: 'One' }, 'ana').after
  const mine = tracker.createIssue({ title: 'Mine' }, 'fred').after.id
  setNow('2026-10-31T10:05:00Z')
  tracker.assign(id, 'fred', 'ana')
  tracker.assign(mine, 'fred', 'fred')
  const result = tracker.listNotifications({ user: 'fred', since: SINCE })
  assert.deepEqual(keys(result.items), [`assignment:${id}:assignment:ana`])
  assert.deepEqual(result.items[0], { kind: 'assignment', issue: id, title: 'One', at: '2026-10-31T10:05:00Z', by: 'ana', in: 'assignment', comment: null, excerpt: null, synthetic: false, future: false })
  assert.deepEqual(result.counts, { assignments: 1, mentions: 0 })
  assert.equal(result.complete, true)
  assert.deepEqual(result.problems, [])
  assert.equal(tracker.listNotifications({ user: 'fred', since: '2026-10-31T10:05:00Z' }).items.length, 0)
})

test('an issue created already assigned to the user counts', () => {
  const { tracker, keys } = setup()
  const { id } = tracker.createIssue({ title: 'New', assignee: 'fred' }, 'ana').after
  assert.deepEqual(keys(tracker.listNotifications({ user: 'fred', since: SINCE }).items), [`assignment:${id}:assignment:ana`])
})

test('a delegation reaches the agent and not the person who delegated', () => {
  const { tracker, setNow, keys } = setup()
  const { id } = tracker.createIssue({ title: 'Work' }, 'fred').after
  setNow('2026-10-31T10:05:00Z')
  tracker.delegate(id, 'agent:claude', 'Do it.', 'fred')
  assert.deepEqual(keys(tracker.listNotifications({ user: 'agent:claude', since: SINCE }).items), [`assignment:${id}:assignment:fred`])
  assert.deepEqual(tracker.listNotifications({ user: 'fred', since: SINCE }).items, [])
})

test('a comment mention shows with its excerpt, the author own mention does not', () => {
  const { tracker, setNow } = setup()
  const { id } = tracker.createIssue({ title: 'Talk' }, 'ana').after
  setNow('2026-10-31T10:05:00Z')
  const posted = tracker.comment(id, 'first line\nping @fred about this', 'ana')
  tracker.comment(id, 'note to self @fred', 'fred')
  tracker.comment(id, 'mail ana@fred.com and `@fred` in code', 'ana')
  const { items } = tracker.listNotifications({ user: 'fred', since: SINCE })
  assert.equal(items.length, 1)
  assert.deepEqual(items[0], { kind: 'mention', issue: id, title: 'Talk', at: '2026-10-31T10:05:00Z', by: 'ana', in: 'comment', comment: posted.id, excerpt: 'ping @fred about this', synthetic: false, future: false })
})

test('a description mention is dated by the newest description event and the author is its by', () => {
  const { tracker, setNow, keys } = setup()
  const { id } = tracker.createIssue({ title: 'D', description: 'cc @fred' }, 'ana').after
  assert.deepEqual(keys(tracker.listNotifications({ user: 'fred', since: SINCE }).items), [`mention:${id}:description:ana`])
  setNow('2026-10-31T11:00:00Z')
  tracker.updateIssue(id, { description: 'cc @fred again' }, 'ana')
  const [item] = tracker.listNotifications({ user: 'fred', since: '2026-10-31T10:30:00Z' }).items
  assert.equal(item.at, '2026-10-31T11:00:00Z')
  assert.equal(item.excerpt, 'cc @fred again')
  tracker.updateIssue(id, { description: 'no mention now' }, 'ana')
  assert.deepEqual(tracker.listNotifications({ user: 'fred', since: SINCE }).items, [])
})

test('items sort by time first', () => {
  const { tracker, setNow } = setup()
  const a = tracker.createIssue({ title: 'A' }, 'ana').after.id
  const b = tracker.createIssue({ title: 'B' }, 'ana').after.id
  setNow('2026-10-31T10:10:00Z')
  tracker.comment(b, '@fred b', 'ana')
  setNow('2026-10-31T10:05:00Z')
  tracker.assign(a, 'fred', 'ana')
  const { items } = tracker.listNotifications({ user: 'fred', since: SINCE })
  assert.deepEqual(items.map((item) => item.at), ['2026-10-31T10:05:00Z', '2026-10-31T10:10:00Z'])
})

test('markRead records the check, hides what was read and shows what comes later', () => {
  const { root, env, tracker, setNow } = setup()
  const { id } = tracker.createIssue({ title: 'Talk' }, 'ana').after
  setNow('2026-10-31T10:05:00Z')
  tracker.assign(id, 'fred', 'ana')
  setNow('2026-10-31T10:10:00Z')
  assert.equal(tracker.listNotifications({ user: 'fred' }).items.length, 1)
  assert.equal(tracker.listNotifications({ user: 'fred' }).through, '2026-10-31T10:09:59Z')
  const dry = tracker.markRead({ user: 'fred', dryRun: true })
  assert.deepEqual(dry, { user: 'fred', previous: null, recorded: '2026-10-31T10:09:59Z', through: '2026-10-31T10:09:59Z', changed: true, dryRun: true })
  assert.equal(inboxGet(root, 'fred', { env }), null)
  const done = tracker.markRead({ user: 'fred' })
  assert.equal(done.changed, true)
  assert.equal(inboxGet(root, 'fred', { env }), '2026-10-31T10:09:59Z')
  assert.equal(fs.existsSync(path.join(root, '.issues', 'inbox')), false)
  assert.equal(tracker.listNotifications({ user: 'fred' }).items.length, 0)
  assert.equal(tracker.listNotifications({ user: 'agent:claude' }).since, null)
  setNow('2026-10-31T10:20:00Z')
  tracker.comment(id, '@fred look', 'ana')
  assert.equal(tracker.listNotifications({ user: 'fred' }).items.length, 1)
})

test('since and all override the stored check and write nothing', () => {
  const { root, env, tracker, setNow } = setup()
  const { id } = tracker.createIssue({ title: 'Talk' }, 'ana').after
  setNow('2026-10-31T10:05:00Z')
  tracker.assign(id, 'fred', 'ana')
  setNow('2026-10-31T10:10:00Z')
  tracker.markRead({ user: 'fred' })
  assert.equal(tracker.listNotifications({ user: 'fred', since: SINCE }).items.length, 1)
  assert.equal(tracker.listNotifications({ user: 'fred', all: true }).since, null)
  assert.ok(tracker.listNotifications({ user: 'fred', all: true }).items.length >= 1)
  assert.equal(inboxGet(root, 'fred', { env }), '2026-10-31T10:09:59Z')
  assert.throws(() => tracker.listNotifications({ user: 'fred', since: 'yesterday' }), code('INVALID_INPUT'))
  assert.throws(() => tracker.listNotifications({ user: 'nobody' }), code('INVALID_INPUT'))
})

test('markRead never moves back, refuses a time in the future and takes through', () => {
  const { tracker, setNow } = setup()
  setNow('2026-10-31T10:10:00Z')
  assert.equal(tracker.markRead({ user: 'fred', through: '2026-10-31T10:00:00Z' }).recorded, '2026-10-31T10:00:00Z')
  const back = tracker.markRead({ user: 'fred', through: '2026-10-31T09:00:00Z' })
  assert.deepEqual([back.recorded, back.changed], ['2026-10-31T10:00:00Z', false])
  assert.throws(() => tracker.markRead({ user: 'fred', through: '2026-10-31T10:10:01Z' }), code('INVALID_INPUT'))
  assert.throws(() => tracker.markRead({ user: 'fred', through: 'soon' }), code('INVALID_INPUT'))
})

test('an item dated after now is flagged future and stays unread after markRead', () => {
  const { tracker, setNow } = setup()
  const { id } = tracker.createIssue({ title: 'Talk' }, 'ana').after
  setNow('2026-11-01T10:00:00Z')
  tracker.assign(id, 'fred', 'ana')
  setNow('2026-10-31T12:00:00Z')
  const [item] = tracker.listNotifications({ user: 'fred', since: SINCE }).items
  assert.equal(item.future, true)
  tracker.markRead({ user: 'fred' })
  assert.equal(tracker.listNotifications({ user: 'fred' }).items.length, 1)
})

test('a broken comment, issue file or events line makes the inbox incomplete and blocks markRead', () => {
  const { env, tracker, setNow, paths } = setup()
  const good = tracker.createIssue({ title: 'Good' }, 'ana').after.id
  const noisy = tracker.createIssue({ title: 'Noisy' }, 'ana').after.id
  const broken = tracker.createIssue({ title: 'Broken' }, 'ana').after.id
  const logged = tracker.createIssue({ title: 'Logged' }, 'ana').after.id
  setNow('2026-10-31T10:05:00Z')
  tracker.assign(good, 'fred', 'ana')
  tracker.comment(noisy, '@fred ok', 'ana')
  setNow('2026-10-31T10:06:00Z')
  tracker.comment(noisy, '@fred lost', 'ana')
  const bad = fs.readdirSync(paths(noisy).comments).sort().pop()
  fs.writeFileSync(path.join(paths(noisy).comments, bad), '---\nauthor: [\n---\n@fred\n')
  fs.writeFileSync(paths(broken).file, '<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> other\n')
  fs.appendFileSync(paths(logged).events, 'not json\n')
  const result = tracker.listNotifications({ user: 'fred', since: SINCE })
  assert.equal(result.complete, false)
  assert.deepEqual([...new Set(result.problems.map((problem) => problem.id))].sort(), [broken, logged, noisy].sort())
  for (const problem of result.problems) assert.ok(problem.code && problem.message, problem.id)
  assert.equal(result.items.length, 2)
  assert.throws(() => tracker.markRead({ user: 'fred' }), (error) => error.code === 'INVALID_INPUT' && error.details?.problems?.length === result.problems.length)
  assert.equal(fs.existsSync(path.join(userDir({ env }), 'inbox')), false)
})

test('listNotifications and markRead change no file under the repository', () => {
  const { root, tracker, setNow } = setup()
  setNow('2026-10-31T10:10:00Z')
  const before = hashTree(root)
  tracker.listNotifications({ user: 'fred', all: true })
  tracker.markRead({ user: 'fred' })
  assert.equal(hashTree(root), before)
})

test('an item that arrives in the second of the list stays unread after mark-read of that second', () => {
  const { tracker, setNow } = setup()
  const { id } = tracker.createIssue({ title: 'Talk' }, 'ana').after
  setNow('2026-10-31T10:05:00.200Z')
  const listed = tracker.listNotifications({ user: 'fred', since: SINCE })
  assert.deepEqual(listed.items, [])
  setNow('2026-10-31T10:05:00.700Z')
  tracker.assign(id, 'fred', 'ana')
  setNow('2026-10-31T10:05:00.800Z')
  const marked = tracker.markRead({ user: 'fred', through: '2026-10-31T10:05:00Z' })
  assert.equal(marked.recorded, '2026-10-31T10:04:59Z')
  assert.deepEqual(tracker.listNotifications({ user: 'fred' }).items.map((item) => item.issue), [id])
  // The same with the through the list returned and with no through at all.
  tracker.markRead({ user: 'fred', through: listed.through })
  assert.equal(tracker.listNotifications({ user: 'fred' }).items.length, 1)
  tracker.markRead({ user: 'fred' })
  assert.equal(tracker.listNotifications({ user: 'fred' }).items.length, 1)
  // Once the second is over, marking it read hides the item.
  setNow('2026-10-31T10:05:01.100Z')
  assert.equal(tracker.markRead({ user: 'fred' }).recorded, '2026-10-31T10:05:00Z')
  assert.deepEqual(tracker.listNotifications({ user: 'fred' }).items, [])
})

test('a change to the acceptance criteria neither hides nor revives a description mention', () => {
  const { tracker, setNow } = setup()
  const { id } = tracker.createIssue({ title: 'D', description: '@fred review this', acceptanceCriteria: [{ text: 'a', done: false }] }, 'ana').after
  setNow('2026-10-31T10:30:00Z')
  tracker.updateIssue(id, { acceptanceCriteria: [{ text: 'a', done: true }] }, 'fred')
  const [shown] = tracker.listNotifications({ user: 'fred', since: SINCE }).items
  assert.deepEqual([shown.in, shown.by, shown.at], ['description', 'ana', '2026-10-31T10:00:00Z'])
  setNow('2026-10-31T11:00:00Z')
  tracker.markRead({ user: 'fred' })
  setNow('2026-10-31T11:30:00Z')
  tracker.updateIssue(id, { acceptanceCriteria: [{ text: 'a', done: false }] }, 'ana')
  assert.deepEqual(tracker.listNotifications({ user: 'fred' }).items, [])
})

test('a description mention on an issue with no events is dated by the created time and is not a problem', () => {
  const { tracker, paths, root, env } = setup()
  const { id } = tracker.createIssue({ title: 'D', description: 'cc @fred' }, 'ana').after
  fs.rmSync(paths(id).events)
  const result = tracker.listNotifications({ user: 'fred', since: SINCE })
  assert.equal(result.complete, true)
  assert.deepEqual(result.problems, [])
  assert.deepEqual([result.items[0].issue, result.items[0].at, result.items[0].by, result.items[0].in], [id, '2026-10-31T10:00:00Z', null, 'description'])
  assert.equal(tracker.markRead({ user: 'fred', through: '2026-10-31T09:59:59Z' }).changed, true)
  assert.ok(inboxGet(root, 'fred', { env }))
})

test('since and through take only a strict timestamp with a zone', () => {
  const { tracker, setNow } = setup()
  setNow('2026-10-31T12:00:00Z')
  for (const bad of ['1', 'Oct 1', '2026-10-31T10:00:00', '2026-10-31', '31/10/2026', 'soon', '2026-02-30T10:00:00Z']) {
    assert.throws(() => tracker.listNotifications({ user: 'fred', since: bad }), code('INVALID_INPUT'), bad)
    assert.throws(() => tracker.markRead({ user: 'fred', through: bad }), code('INVALID_INPUT'), bad)
  }
  assert.equal(tracker.listNotifications({ user: 'fred', since: '2026-10-31T12:00:00+02:00' }).since, '2026-10-31T10:00:00Z')
  assert.equal(tracker.markRead({ user: 'fred', through: '2026-10-31T09:00:00.500Z', dryRun: true }).through, '2026-10-31T09:00:00Z')
})

test('an assignment undone later stays in the inbox until it is marked read', () => {
  const { tracker, setNow } = setup()
  const { id } = tracker.createIssue({ title: 'Talk' }, 'ana').after
  setNow('2026-10-31T10:05:00Z')
  tracker.assign(id, 'fred', 'ana')
  setNow('2026-10-31T10:06:00Z')
  tracker.assign(id, null, 'ana')
  assert.deepEqual(tracker.listNotifications({ user: 'fred', since: SINCE }).items.map((item) => item.kind), ['assignment'])
  setNow('2026-10-31T10:07:00Z')
  tracker.markRead({ user: 'fred' })
  assert.deepEqual(tracker.listNotifications({ user: 'fred' }).items, [])
})
