import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { hashTree, makeRepo, scriptedRandom } from './test-helpers.mjs'

const NOW = '2026-10-23T12:00:00Z'

function setup(fixture = 'basic', random = scriptedRandom([1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6, 4, 5, 6, 7, 5, 6, 7, 8])) {
  const root = makeRepo(fixture)
  const tracker = createLocalTracker(root, { now: () => new Date(NOW), random })
  return { root, tracker, issuesDir: path.join(root, '.issues') }
}

const epicDir = (issuesDir, id) => path.join(issuesDir, 'epics', id)

test('createDeliverable writes epic.md with the default status and a create event', () => {
  const { tracker, issuesDir } = setup()
  const { before, after } = tracker.createDeliverable(
    { title: ' Launch ', start: '2026-11-01', target: '2026-12-01', milestone: 'v1', description: 'Ship it.' }, 'fred',
  )
  assert.equal(before, null)
  assert.match(after.id, /^EPC-[0-9A-Z]{4}$/)
  assert.deepEqual(after, {
    id: after.id, title: 'Launch', status: { name: 'backlog', category: 'backlog' },
    start: '2026-11-01', target: '2026-12-01', milestone: 'v1', description: 'Ship it.',
  })
  const dir = epicDir(issuesDir, after.id)
  const text = fs.readFileSync(path.join(dir, 'epic.md'), 'utf8')
  assert.match(text, new RegExp(`^---\\nid: ${after.id}\\ntitle: Launch\\nstatus: backlog\\nstart: 2026-11-01\\ntarget: 2026-12-01\\nmilestone: v1\\n---\\n\\nShip it\\.\\n$`))
  const events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(events.length, 1)
  assert.deepEqual([events[0].at, events[0].by, events[0].op], ['2026-10-23T12:00:00.000Z', 'fred', 'create'])
  assert.deepEqual(events[0].to, { id: after.id, title: 'Launch', status: 'backlog', start: '2026-11-01', target: '2026-12-01', milestone: 'v1' })
  assert.deepEqual(tracker.getDeliverable(after.id), after)
})

test('createDeliverable validates input and the actor', () => {
  const { tracker } = setup()
  const code = (expected) => (error) => error.code === expected
  assert.throws(() => tracker.createDeliverable({}, 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.createDeliverable({ title: 'x', start: '2026-02-30' }, 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.createDeliverable({ title: 'x', target: 'soon' }, 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.createDeliverable({ title: 'x', status: 'done' }, 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.createDeliverable({ title: 'x' }, 'nobody'), code('INVALID_INPUT'))
})

test('createDeliverable dry run writes nothing and returns before and after', () => {
  const { tracker, root } = setup()
  const hash = hashTree(root)
  const { before, after } = tracker.createDeliverable({ title: 'Launch' }, 'fred', { dryRun: true })
  assert.equal(before, null)
  assert.equal(after.title, 'Launch')
  assert.equal(hashTree(root), hash)
})

test('listDeliverables reads the team epic and sorts by start, then creation, missing start last', () => {
  const { tracker } = setup('team')
  const [seed] = tracker.listDeliverables()
  assert.deepEqual(seed, {
    id: 'EPC-2M9D', title: 'Reliable webhooks and billing export', status: { name: 'in_progress', category: 'in_progress' },
    start: '2026-09-28', target: '2026-11-13',
    description: 'Customers lose events when a delivery fails, and finance cannot export invoices.\nThis epic covers retries, signing and the CSV export.',
  })
  const late = tracker.createDeliverable({ title: 'Late', start: '2026-12-01' }, 'fred').after.id
  const none = tracker.createDeliverable({ title: 'No start' }, 'fred').after.id
  const early = tracker.createDeliverable({ title: 'Early', start: '2026-01-01' }, 'fred').after.id
  assert.deepEqual(tracker.listDeliverables().map((epic) => epic.id), [early, 'EPC-2M9D', late, none])
})

test('listDeliverables keeps the creation order of epics created in the same second', () => {
  const { tracker } = setup('basic', scriptedRandom([9, 9, 9, 9, 5, 5, 5, 5, 1, 1, 1, 1, 7, 7, 7, 7]))
  const titles = ['First', 'Second', 'Third']
  const ids = titles.map((title) => tracker.createDeliverable({ title }, 'fred').after.id)
  assert.deepEqual(ids, ['EPC-9999', 'EPC-5555', 'EPC-1111'])
  const dated = tracker.createDeliverable({ title: 'Dated', start: '2026-11-01' }, 'fred').after.id
  assert.deepEqual(tracker.listDeliverables().map((epic) => epic.id), [dated, ...ids])
})

test('getDeliverable throws NOT_FOUND for a missing epic', () => {
  const { tracker } = setup()
  assert.throws(() => tracker.getDeliverable('EPC-ZZZZ'), (error) => error.code === 'NOT_FOUND')
  assert.throws(() => tracker.getDeliverable('nonsense'), (error) => error.code === 'NOT_FOUND')
})

test('deliverableProgress counts the team epic through a two-level chain', () => {
  const { tracker } = setup('team')
  assert.deepEqual(tracker.deliverableProgress('EPC-2M9D'), {
    total: 5, done: 2, canceled: 0, points: 22, pointsDone: 8,
    byCategory: { triage: 0, backlog: 0, todo: 1, in_progress: 1, in_review: 1, done: 2, canceled: 0 },
  })
})

test('deliverableProgress excludes canceled from total and points, skips archived, ignores non-numeric estimates', () => {
  const { tracker } = setup('team')
  const epic = 'EPC-2M9D'
  const issue = (title, extra = {}) => tracker.createIssue({ title, parent: epic, ...extra }, 'fred').after.id
  const dropped = issue('Dropped', { estimate: 13 })
  tracker.moveToCategory(dropped, 'canceled', 'fred')
  const gone = issue('Archived', { estimate: 8 })
  tracker.archive(gone, 'fred')
  issue('No estimate')
  const progress = tracker.deliverableProgress(epic)
  assert.equal(progress.total, 6)
  assert.equal(progress.canceled, 1)
  assert.equal(progress.byCategory.canceled, 1)
  assert.equal(progress.points, 22)
  assert.equal(progress.pointsDone, 8)
  assert.equal(progress.byCategory.backlog, 1)
})

test('deliverableProgress sums only numeric estimates', () => {
  const { tracker, issuesDir } = setup('team')
  const id = tracker.createIssue({ title: 'Odd', parent: 'EPC-2M9D' }, 'fred').after.id
  const file = path.join(issuesDir, 'issues', id, 'issue.md')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('\ncreated:', '\nestimate: L\ncreated:'))
  assert.equal(tracker.deliverableProgress('EPC-2M9D').points, 22)
  assert.equal(tracker.deliverableProgress('EPC-2M9D').total, 6)
})

test('deliverableProgress ends on a hand-edited parent loop and does not count it', () => {
  const { tracker, issuesDir } = setup('team')
  const [b, c] = ['5N1R', '3F7H'].map((code) => `ISS-${code}`)
  const setRaw = (id, parent) => {
    const file = path.join(issuesDir, 'issues', id, 'issue.md')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('\ncreated:', `\nparent: ${parent}\ncreated:`))
  }
  setRaw(b, c)
  setRaw(c, b)
  assert.equal(tracker.deliverableProgress('EPC-2M9D').total, 5)
})

test('deliverableProgress on a missing epic throws NOT_FOUND', () => {
  const { tracker } = setup()
  assert.throws(() => tracker.deliverableProgress('EPC-ZZZZ'), (error) => error.code === 'NOT_FOUND')
})

test('two status updates the same day get -2 and list newest first', () => {
  const { tracker, issuesDir } = setup('team')
  let clock = '2026-10-23T09:00:00Z'
  const timed = createLocalTracker(path.dirname(issuesDir), { now: () => new Date(clock) })
  const first = timed.publishStatusUpdate({ epic: 'EPC-2M9D', health: 'on_track', body: '  Going well.\n' }, 'fred')
  assert.equal(first.before, null)
  assert.deepEqual(first.after, { epic: 'EPC-2M9D', at: '2026-10-23T09:00:00Z', author: 'fred', health: 'on_track', body: 'Going well.' })
  clock = '2026-10-23T15:00:00Z'
  timed.publishStatusUpdate({ epic: 'EPC-2M9D', health: 'at_risk', body: 'Slipping.' }, 'fred')
  clock = '2026-10-24T08:00:00Z'
  timed.publishStatusUpdate({ epic: 'EPC-2M9D', health: 'off_track', body: 'Late.' }, 'ana')
  const dir = path.join(epicDir(issuesDir, 'EPC-2M9D'), 'updates')
  assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-10-23-fred-2.md', '2026-10-23-fred.md', '2026-10-24-ana.md'])
  assert.equal(fs.readFileSync(path.join(dir, '2026-10-23-fred.md'), 'utf8'),
    '---\nauthor: fred\ncreated: 2026-10-23T09:00:00Z\nhealth: on_track\n---\n\nGoing well.\n')
  assert.deepEqual(tracker.listStatusUpdates('EPC-2M9D').map((update) => [update.author, update.health, update.body]), [
    ['ana', 'off_track', 'Late.'], ['fred', 'at_risk', 'Slipping.'], ['fred', 'on_track', 'Going well.'],
  ])
  assert.equal(fs.existsSync(path.join(epicDir(issuesDir, 'EPC-2M9D'), 'events.jsonl')), true)
  assert.equal(fs.readFileSync(path.join(epicDir(issuesDir, 'EPC-2M9D'), 'events.jsonl'), 'utf8').trim().split('\n').length, 1)
})

test('publishStatusUpdate rejects a bad health, an empty body, a missing epic and a non-member', () => {
  const { tracker, root } = setup('team')
  const hash = hashTree(root)
  const code = (expected) => (error) => error.code === expected
  assert.throws(() => tracker.publishStatusUpdate({ epic: 'EPC-2M9D', health: 'fine', body: 'x' }, 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.publishStatusUpdate({ epic: 'EPC-2M9D', health: 'on_track', body: '  \n' }, 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.publishStatusUpdate({ epic: 'EPC-ZZZZ', health: 'on_track', body: 'x' }, 'fred'), code('NOT_FOUND'))
  assert.throws(() => tracker.publishStatusUpdate({ epic: 'EPC-2M9D', health: 'on_track', body: 'x' }, 'nobody'), code('INVALID_INPUT'))
  assert.equal(hashTree(root), hash)
})

test('publishStatusUpdate dry run writes nothing', () => {
  const { tracker, root } = setup('team')
  const hash = hashTree(root)
  const result = tracker.publishStatusUpdate({ epic: 'EPC-2M9D', health: 'on_track', body: 'x' }, 'fred', { dryRun: true })
  assert.equal(result.before, null)
  assert.equal(result.after.body, 'x')
  assert.equal(hashTree(root), hash)
})

test('listStatusUpdates is empty without updates and throws NOT_FOUND for a missing epic', () => {
  const { tracker } = setup('team')
  assert.deepEqual(tracker.listStatusUpdates('EPC-2M9D'), [])
  assert.throws(() => tracker.listStatusUpdates('EPC-ZZZZ'), (error) => error.code === 'NOT_FOUND')
})

test('createDeliverable refuses a line break in the title or milestone and a body that would not read back', () => {
  const { tracker, root } = setup()
  const hash = hashTree(root)
  const code = (expected) => (error) => error.code === expected
  assert.throws(() => tracker.createDeliverable({ title: 'Launch\nnow' }, 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.createDeliverable({ title: 'Launch', milestone: 'v1\nv2' }, 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.createDeliverable({ title: 'Launch', description: '<<<<<<< HEAD\nx\n>>>>>>> b' }, 'fred'), code('INVALID_INPUT'))
  assert.equal(hashTree(root), hash)
  const fenced = '```\n<<<<<<< HEAD\nx\n>>>>>>> b\n```'
  const { after } = tracker.createDeliverable({ title: 'Launch', description: fenced }, 'fred')
  assert.equal(tracker.getDeliverable(after.id).description, fenced)
})

test('publishStatusUpdate refuses a body that would not read back and writes nothing', () => {
  const { tracker, root } = setup('team')
  const hash = hashTree(root)
  assert.throws(
    () => tracker.publishStatusUpdate({ epic: 'EPC-2M9D', health: 'at_risk', body: 'Late.\n<<<<<<< HEAD\nx' }, 'fred'),
    (error) => error.code === 'INVALID_INPUT',
  )
  assert.equal(hashTree(root), hash)
})

test('listDeliverables skips an epic whose file does not parse', () => {
  const { tracker, issuesDir } = setup()
  const kept = tracker.createDeliverable({ title: 'Kept' }, 'fred').after.id
  const broken = tracker.createDeliverable({ title: 'Broken' }, 'fred').after.id
  fs.writeFileSync(path.join(epicDir(issuesDir, broken), 'epic.md'), 'no frontmatter here\n')
  assert.deepEqual(tracker.listDeliverables().map((epic) => epic.id), [kept])
})
