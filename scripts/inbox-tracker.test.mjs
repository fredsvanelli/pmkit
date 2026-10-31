import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { issuePaths } from './lib/local/store.mjs'
import { inboxGet, userDir, repoHash } from './lib/user-store.mjs'
import { hashTree, makeRepo, userStoreEnv } from './test-helpers.mjs'

const SINCE = '2026-10-30T00:00:00Z'
const code = (value) => (error) => error.code === value
const ITEM_KEYS = ['key', 'kind', 'issue', 'title', 'at', 'by', 'in', 'comment', 'excerpt', 'synthetic', 'seen']

function configure(root) {
  const configFile = path.join(root, '.issues', 'config.yaml')
  if (fs.readFileSync(configFile, 'utf8').includes('agent:claude')) return
  fs.writeFileSync(configFile, fs.readFileSync(configFile, 'utf8').replace(
    /^(  fred: .*)$/m,
    '$1\n  agent:claude: { name: Claude, email: claude@example.com, availability: 1 }',
  ))
}

function setup(root = makeRepo('no-sprints'), { env = userStoreEnv().env } = {}) {
  configure(root)
  let current = '2026-10-31T10:00:00Z'
  let seed = 1
  const setNow = (iso) => { current = iso }
  const tracker = createLocalTracker(root, { now: () => new Date(current), random: (n) => (seed = (seed * 7919 + 13) % 100003) % n, env })
  const paths = (id) => issuePaths(path.join(root, '.issues'), id)
  const keys = (items) => items.map((item) => `${item.kind}:${item.issue}:${item.in}:${item.by}`)
  return { root, env, tracker, setNow, paths, keys }
}

test('an assignment by another member shows, a self-assignment does not, and an item has the stable keys', () => {
  const { tracker, setNow, keys } = setup()
  const { id } = tracker.createIssue({ title: 'One' }, 'ana').after
  const mine = tracker.createIssue({ title: 'Mine' }, 'fred').after.id
  setNow('2026-10-31T10:05:00Z')
  tracker.assign(id, 'fred', 'ana')
  tracker.assign(mine, 'fred', 'fred')
  const result = tracker.listNotifications({ user: 'fred', since: SINCE })
  assert.deepEqual(keys(result.items), [`assignment:${id}:assignment:ana`])
  const [item] = result.items
  assert.deepEqual(Object.keys(item), ITEM_KEYS)
  assert.match(item.key, new RegExp(`^assign:${id}:[0-9a-f]{12}$`))
  assert.deepEqual({ ...item, key: 'k' }, { key: 'k', kind: 'assignment', issue: id, title: 'One', at: '2026-10-31T10:05:00Z', by: 'ana', in: 'assignment', comment: null, excerpt: null, synthetic: false, seen: false })
  assert.deepEqual(result.counts, { assignments: 1, mentions: 0 })
  assert.deepEqual(Object.keys(result), ['user', 'checked', 'since', 'hidden', 'items', 'counts', 'complete', 'problems'])
  assert.deepEqual([result.checked, result.hidden, result.complete, result.problems], [null, 0, true, []])
  assert.equal(tracker.listNotifications({ user: 'fred', since: '2026-10-31T10:05:01Z' }).items.length, 0)
  assert.equal(tracker.listNotifications({ user: 'fred', since: '2026-10-31T10:05:00Z' }).items.length, 1)
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

test('a comment mention shows with its key and excerpt, the author own mention does not', () => {
  const { tracker, setNow } = setup()
  const { id } = tracker.createIssue({ title: 'Talk' }, 'ana').after
  setNow('2026-10-31T10:05:00Z')
  const posted = tracker.comment(id, 'first line\nping @fred about this', 'ana')
  tracker.comment(id, 'note to self @fred', 'fred')
  tracker.comment(id, 'mail ana@fred.com and `@fred` in code', 'ana')
  const { items } = tracker.listNotifications({ user: 'fred', since: SINCE })
  assert.equal(items.length, 1)
  assert.deepEqual(items[0], { key: `comment:${id}:${posted.id}`, kind: 'mention', issue: id, title: 'Talk', at: '2026-10-31T10:05:00Z', by: 'ana', in: 'comment', comment: posted.id, excerpt: 'ping @fred about this', synthetic: false, seen: false })
})

test('a description mention is keyed by its text: editing it is a new item, editing elsewhere is not', () => {
  const { tracker, setNow, keys } = setup()
  const { id } = tracker.createIssue({ title: 'D', description: 'Intro.\n\ncc @fred please' }, 'ana').after
  const [first] = tracker.listNotifications({ user: 'fred', since: SINCE }).items
  assert.deepEqual(keys([first]), [`mention:${id}:description:ana`])
  assert.match(first.key, new RegExp(`^description:${id}:[0-9a-f]{12}$`))
  setNow('2026-10-31T10:30:00Z')
  tracker.markRead({ user: 'fred' })
  setNow('2026-10-31T11:00:00Z')
  tracker.updateIssue(id, { description: 'A longer intro.\n\ncc   @fred   please', title: 'Renamed' }, 'ana')
  assert.deepEqual(tracker.listNotifications({ user: 'fred' }).items, [])
  setNow('2026-10-31T11:30:00Z')
  tracker.updateIssue(id, { description: 'A longer intro.\n\ncc @fred please look today' }, 'ana')
  const [second] = tracker.listNotifications({ user: 'fred' }).items
  assert.notEqual(second.key, first.key)
  assert.equal(second.at, '2026-10-31T11:30:00Z')
  tracker.markRead({ user: 'fred' })
  tracker.updateIssue(id, { description: 'no mention now' }, 'ana')
  assert.deepEqual(tracker.listNotifications({ user: 'fred', since: SINCE }).items, [])
})

test('a mention written in an acceptance criterion shows, and ticking the criterion does not change it', () => {
  const { tracker, setNow } = setup()
  const { id } = tracker.createIssue({ title: 'C', description: 'Plain.', acceptanceCriteria: [{ text: 'a', done: false }] }, 'ana').after
  setNow('2026-10-31T10:00:00Z')
  tracker.markRead({ user: 'fred' })
  setNow('2026-10-31T10:30:00Z')
  tracker.updateIssue(id, { acceptanceCriteria: [{ text: 'a', done: false }, { text: '@fred to verify the signature', done: false }] }, 'ana')
  const [item] = tracker.listNotifications({ user: 'fred' }).items
  assert.deepEqual([item.kind, item.in, item.at, item.excerpt], ['mention', 'acceptance_criteria', '2026-10-31T10:30:00Z', '- [ ] @fred to verify the signature'])
  assert.match(item.key, new RegExp(`^description:${id}:[0-9a-f]{12}$`))
  tracker.markRead({ user: 'fred' })
  setNow('2026-10-31T11:00:00Z')
  tracker.updateIssue(id, { acceptanceCriteria: [{ text: 'a', done: true }, { text: '@fred to verify the signature', done: true }] }, 'fred')
  assert.deepEqual(tracker.listNotifications({ user: 'fred' }).items, [])
})

test('a description mention written by hand has no event, is dated by created and keeps its key after the next write', () => {
  const { tracker, setNow, paths, root, env } = setup()
  const { id } = tracker.createIssue({ title: 'D', description: 'cc @fred' }, 'ana').after
  fs.rmSync(paths(id).events)
  const first = tracker.listNotifications({ user: 'fred', since: SINCE })
  assert.equal(first.complete, true)
  assert.deepEqual([first.items[0].at, first.items[0].by, first.items[0].in], ['2026-10-31T10:00:00Z', null, 'description'])
  tracker.markRead({ user: 'fred' })
  assert.ok(inboxGet(root, 'fred', { env }))
  setNow('2026-10-31T10:30:00Z')
  tracker.updateIssue(id, { priority: 'high' }, 'ana')
  assert.deepEqual(tracker.listNotifications({ user: 'fred' }).items, [])
})

test('a hand edit of a description that drift does not record still shows as a new item', () => {
  const { tracker, setNow, paths } = setup()
  const { id } = tracker.createIssue({ title: 'D', description: 'Plain.' }, 'ana').after
  setNow('2026-10-31T10:00:00Z')
  tracker.markRead({ user: 'fred' })
  const file = paths(id).file
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Plain.', '@fred can you take this?'))
  setNow('2026-10-31T10:30:00Z')
  tracker.updateIssue(id, { priority: 'high' }, 'ana')
  const [item] = tracker.listNotifications({ user: 'fred' }).items
  assert.deepEqual([item.kind, item.in, item.excerpt], ['mention', 'description', '@fred can you take this?'])
})

test('items sort by time, then issue, kind and key', () => {
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

test('markRead records the seen keys, the list hides them and shows what comes later', () => {
  const { root, env, tracker, setNow } = setup()
  const { id } = tracker.createIssue({ title: 'Talk' }, 'ana').after
  setNow('2026-10-31T10:05:00Z')
  tracker.assign(id, 'fred', 'ana')
  setNow('2026-10-31T10:10:00Z')
  const [item] = tracker.listNotifications({ user: 'fred' }).items
  const dry = tracker.markRead({ user: 'fred', dryRun: true })
  assert.deepEqual(dry, { user: 'fred', previous: null, recorded: '2026-10-31T10:10:00Z', marked: [item.key], pruned: 0, changed: true, dryRun: true })
  assert.equal(inboxGet(root, 'fred', { env }), null)
  const done = tracker.markRead({ user: 'fred' })
  assert.deepEqual([done.changed, done.marked], [true, [item.key]])
  assert.deepEqual(inboxGet(root, 'fred', { env }), { at: '2026-10-31T10:10:00Z', seen: { [item.key]: '2026-10-31T10:10:00Z' } })
  assert.equal(fs.existsSync(path.join(root, '.issues', 'inbox')), false)
  const after = tracker.listNotifications({ user: 'fred' })
  assert.deepEqual([after.items, after.checked], [[], '2026-10-31T10:10:00Z'])
  assert.equal(tracker.listNotifications({ user: 'agent:claude' }).checked, null)
  setNow('2026-10-31T10:20:00Z')
  tracker.comment(id, '@fred look', 'ana')
  assert.equal(tracker.listNotifications({ user: 'fred' }).items.length, 1)
  const again = tracker.markRead({ user: 'fred' })
  assert.equal(again.marked.length, 1)
  assert.deepEqual(tracker.markRead({ user: 'fred' }), { user: 'fred', previous: '2026-10-31T10:20:00Z', recorded: '2026-10-31T10:20:00Z', marked: [], pruned: 0, changed: false, dryRun: false })
})

test('an item that arrives in the second of the list, or after it, stays unread when the member marks the keys the list showed', () => {
  const { tracker, setNow } = setup()
  const first = tracker.createIssue({ title: 'First' }, 'ana').after.id
  const second = tracker.createIssue({ title: 'Second' }, 'ana').after.id
  setNow('2026-10-31T10:05:00.100Z')
  tracker.assign(first, 'fred', 'ana')
  setNow('2026-10-31T10:05:00.200Z')
  const listed = tracker.listNotifications({ user: 'fred', since: SINCE })
  assert.deepEqual(listed.items.map((item) => item.issue), [first])
  setNow('2026-10-31T10:05:00.700Z')
  tracker.assign(second, 'fred', 'ana')
  setNow('2026-10-31T10:05:02Z')
  const marked = tracker.markRead({ user: 'fred', keys: listed.items.map((item) => item.key) })
  assert.equal(marked.marked.length, 1)
  assert.deepEqual(tracker.listNotifications({ user: 'fred' }).items.map((item) => item.issue), [second])
})

test('an item made in another clone before the check and pulled after it still shows', () => {
  const git = (cwd, ...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x.dev', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x.dev' } })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }
  const origin = makeRepo('no-sprints')
  configure(origin)
  git(origin, 'init', '-q', '-b', 'main')
  git(origin, 'add', '-A')
  git(origin, 'commit', '-q', '-m', 'start')
  const cloneRoot = path.join(path.dirname(origin), `${path.basename(origin)}-clone`)
  git(path.dirname(origin), 'clone', '-q', origin, cloneRoot)
  const { env } = userStoreEnv()
  const ana = setup(origin, { env: userStoreEnv().env })
  const fred = setup(cloneRoot, { env })
  const { id } = ana.tracker.createIssue({ title: 'From ana' }, 'ana').after
  ana.setNow('2026-10-31T09:50:00Z')
  ana.tracker.assign(id, 'fred', 'ana')
  ana.tracker.comment(id, '@fred see this', 'ana')
  git(origin, 'add', '-A')
  git(origin, 'commit', '-q', '-m', 'ana works')
  fred.setNow('2026-10-31T10:00:00Z')
  assert.deepEqual(fred.tracker.listNotifications({ user: 'fred', since: SINCE }).items, [])
  fred.tracker.markRead({ user: 'fred' })
  git(cloneRoot, 'pull', '-q', 'origin', 'main')
  fred.setNow('2026-10-31T10:31:00Z')
  const { items } = fred.tracker.listNotifications({ user: 'fred' })
  assert.deepEqual(items.map((item) => item.kind).sort(), ['assignment', 'mention'])
  assert.ok(items.every((item) => item.at === '2026-10-31T09:50:00Z' || item.at === '2026-10-31T10:00:00Z'))
})

test('the first list shows the last 14 days and counts the older items, and the first mark-read marks the backlog too', () => {
  const { tracker, setNow, root, env } = setup()
  const old = tracker.createIssue({ title: 'Old' }, 'ana').after.id
  setNow('2026-10-01T10:00:00Z')
  tracker.assign(old, 'fred', 'ana')
  const recent = tracker.createIssue({ title: 'Recent' }, 'ana').after.id
  setNow('2026-10-25T10:00:00Z')
  tracker.assign(recent, 'fred', 'ana')
  setNow('2026-10-31T10:00:00Z')
  const first = tracker.listNotifications({ user: 'fred' })
  assert.deepEqual(first.items.map((item) => item.issue), [recent])
  assert.deepEqual([first.since, first.hidden, first.checked], ['2026-10-17T10:00:00Z', 1, null])
  assert.equal(tracker.listNotifications({ user: 'fred', all: true }).items.length, 2)
  const marked = tracker.markRead({ user: 'fred', keys: first.items.map((item) => item.key) })
  assert.equal(marked.marked.length, 2)
  const after = tracker.listNotifications({ user: 'fred' })
  assert.deepEqual([after.items, after.hidden, after.since], [[], 0, null])
  assert.equal(Object.keys(inboxGet(root, 'fred', { env }).seen).length, 2)
})

test('all lists the seen items too, and since limits the unseen ones', () => {
  const { root, env, tracker, setNow } = setup()
  const { id } = tracker.createIssue({ title: 'Talk' }, 'ana').after
  setNow('2026-10-31T10:05:00Z')
  tracker.assign(id, 'fred', 'ana')
  setNow('2026-10-31T10:10:00Z')
  tracker.markRead({ user: 'fred' })
  setNow('2026-10-31T10:20:00Z')
  tracker.comment(id, '@fred new', 'ana')
  const before = inboxGet(root, 'fred', { env })
  assert.equal(tracker.listNotifications({ user: 'fred', since: SINCE }).items.length, 1)
  assert.equal(tracker.listNotifications({ user: 'fred', since: '2026-10-31T10:30:00Z' }).items.length, 0)
  const all = tracker.listNotifications({ user: 'fred', all: true })
  assert.deepEqual(all.items.map((item) => item.seen), [true, false])
  assert.deepEqual(inboxGet(root, 'fred', { env }), before)
  assert.throws(() => tracker.listNotifications({ user: 'fred', all: true, since: SINCE }), code('INVALID_INPUT'))
  assert.throws(() => tracker.listNotifications({ user: 'nobody' }), code('INVALID_INPUT'))
})

test('since takes only a strict timestamp with a zone', () => {
  const { tracker, setNow } = setup()
  setNow('2026-10-31T12:00:00Z')
  for (const bad of ['1', 'Oct 1', '2026-10-31T10:00:00', '2026-10-31', '31/10/2026', 'soon', '2026-02-30T10:00:00Z']) {
    assert.throws(() => tracker.listNotifications({ user: 'fred', since: bad }), code('INVALID_INPUT'), bad)
  }
  assert.equal(tracker.listNotifications({ user: 'fred', since: '2026-10-31T12:00:00+02:00' }).since, '2026-10-31T10:00:00Z')
})

test('markRead with keys marks only those, refuses an unknown key and takes none of the others', () => {
  const { tracker, setNow, root, env } = setup()
  const a = tracker.createIssue({ title: 'A' }, 'ana').after.id
  const b = tracker.createIssue({ title: 'B' }, 'ana').after.id
  setNow('2026-10-31T10:05:00Z')
  tracker.assign(a, 'fred', 'ana')
  tracker.assign(b, 'fred', 'ana')
  const items = tracker.listNotifications({ user: 'fred', since: SINCE }).items
  assert.throws(() => tracker.markRead({ user: 'fred', keys: [items[0].key, 'assign:ISS-0:000000000000'] }), (e) => e.code === 'INVALID_INPUT' && e.message.includes('assign:ISS-0:000000000000'))
  assert.equal(inboxGet(root, 'fred', { env }), null)
  assert.deepEqual(tracker.markRead({ user: 'fred', keys: [items[0].key] }).marked, [items[0].key])
  assert.deepEqual(tracker.listNotifications({ user: 'fred' }).items.map((item) => item.key), [items[1].key])
  assert.deepEqual(tracker.markRead({ user: 'fred', keys: [] }).marked, [])
})

test('the seen keys of items that no longer exist are dropped after 30 days, and kept before that', () => {
  const { tracker, setNow, root, env, paths } = setup()
  const a = tracker.createIssue({ title: 'A' }, 'ana').after.id
  const b = tracker.createIssue({ title: 'B' }, 'ana').after.id
  setNow('2026-10-31T10:00:00Z')
  tracker.assign(a, 'fred', 'ana')
  tracker.assign(b, 'fred', 'ana')
  tracker.markRead({ user: 'fred' })
  assert.equal(Object.keys(inboxGet(root, 'fred', { env }).seen).length, 2)
  fs.rmSync(paths(a).dir, { recursive: true })
  setNow('2026-11-15T10:00:00Z')
  const young = tracker.markRead({ user: 'fred' })
  assert.equal(young.pruned, 0)
  assert.equal(Object.keys(inboxGet(root, 'fred', { env }).seen).length, 2)
  setNow('2026-12-05T10:00:00Z')
  const old = tracker.markRead({ user: 'fred' })
  assert.deepEqual([old.pruned, old.changed], [1, true])
  assert.equal(Object.keys(inboxGet(root, 'fred', { env }).seen).length, 1)
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

test('a comment without frontmatter and an event with a bad time are read, dated by their file, and are no problem', () => {
  const { tracker, setNow, paths } = setup()
  const { id } = tracker.createIssue({ title: 'Hand' }, 'ana').after
  setNow('2026-10-31T10:05:00Z')
  fs.mkdirSync(paths(id).comments, { recursive: true })
  fs.writeFileSync(path.join(paths(id).comments, 'by-hand.md'), '@fred please look\n')
  fs.appendFileSync(paths(id).events, `${JSON.stringify({ at: 'yesterday', by: 'ana', op: 'assign', field: 'assignee', from: null, to: 'fred' })}\n`)
  const result = tracker.listNotifications({ user: 'fred', since: '2000-01-01T00:00:00Z' })
  assert.equal(result.complete, true, JSON.stringify(result.problems))
  assert.deepEqual(result.items.map((item) => item.kind).sort(), ['assignment', 'mention'])
  assert.ok(result.items.every((item) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(item.at)))
  assert.equal(tracker.markRead({ user: 'fred' }).marked.length, 2)
})

test('a bad check of one member does not block another member', () => {
  const { tracker, root, env } = setup()
  const { id } = tracker.createIssue({ title: 'Talk' }, 'ana').after
  tracker.assign(id, 'fred', 'ana')
  tracker.markRead({ user: 'fred' })
  const file = path.join(userDir({ env }), 'inbox', `${repoHash(root)}.json`)
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  data.checks.ana = { at: 'yesterday', seen: {} }
  fs.writeFileSync(file, JSON.stringify(data))
  assert.equal(tracker.listNotifications({ user: 'fred' }).checked, '2026-10-31T10:00:00Z')
  assert.equal(tracker.markRead({ user: 'fred' }).changed, false)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).checks.ana.at, 'yesterday')
  assert.throws(() => tracker.listNotifications({ user: 'ana' }), (e) => e.code === 'INVALID_INPUT' && e.message.startsWith('The inbox file') && e.message.includes('ana'))
  assert.throws(() => tracker.markRead({ user: 'ana' }), code('INVALID_INPUT'))
})

test('a check written with a zone is read as the same moment', () => {
  const { tracker, root, env } = setup()
  tracker.markRead({ user: 'fred' })
  const file = path.join(userDir({ env }), 'inbox', `${repoHash(root)}.json`)
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  data.checks.fred.at = '2026-10-31T12:00:00.500+02:00'
  fs.writeFileSync(file, JSON.stringify(data))
  assert.equal(tracker.listNotifications({ user: 'fred' }).checked, '2026-10-31T10:00:00Z')
})

test('an assignment undone later stays in the inbox until it is seen', () => {
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

test('listNotifications changes no file under the repository', () => {
  const { root, tracker, setNow } = setup()
  setNow('2026-10-31T10:10:00Z')
  const before = hashTree(root)
  tracker.listNotifications({ user: 'fred', all: true })
  tracker.markRead({ user: 'fred' })
  assert.equal(hashTree(root), before)
})
