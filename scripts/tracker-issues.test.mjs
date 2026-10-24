import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { issuePaths, listIssueIds } from './lib/local/store.mjs'
import { hashTree, makeRepo, scriptedRandom } from './test-helpers.mjs'

const NOW = '2026-10-23T12:00:00Z'

function setup() {
  const root = makeRepo()
  const issuesDir = path.join(root, '.issues')
  let current = NOW
  const setNow = (iso) => { current = iso }
  const tracker = createLocalTracker(root, { now: () => new Date(current), random: scriptedRandom([1, 2, 3, 4, 2, 3, 4, 5]) })
  const paths = (id) => issuePaths(issuesDir, id)
  const rawEvents = (id) => fs.readFileSync(paths(id).events, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  return { root, issuesDir, tracker, paths, rawEvents, setNow }
}

test('create writes the issue file with defaults and one create event', () => {
  const { tracker, paths, rawEvents } = setup()
  const { before, after } = tracker.createIssue({ title: 'First' }, 'fred')
  assert.equal(before, null)
  assert.equal(after.id, 'ISS-1234')
  const text = fs.readFileSync(paths('ISS-1234').file, 'utf8')
  assert.match(text, /^id: ISS-1234$/m)
  assert.match(text, /^type: feature$/m)
  assert.match(text, /^status: backlog$/m)
  assert.match(text, /^created: 2026-10-23T12:00:00Z$/m)
  assert.deepEqual(after.status, { name: 'backlog', category: 'backlog' })
  const events = rawEvents('ISS-1234')
  assert.equal(events.length, 1)
  assert.equal(events[0].op, 'create')
  assert.equal(events[0].by, 'fred')
  assert.equal(events[0].at, NOW)
  assert.equal(events[0].to.status, 'backlog')
  assert.equal(events[0].to.title, 'First')
})

test('create rejects a type that is not in the config and names the allowed ones', () => {
  const { tracker } = setup()
  assert.throws(
    () => tracker.createIssue({ title: 'X', type: 'epic' }, 'fred'),
    (error) => error.code === 'INVALID_INPUT' && /feature, bug, task, chore/.test(error.message),
  )
})

test('create validates the other fields and the actor', () => {
  const { tracker } = setup()
  const bad = [
    [{}, 'fred'],
    [{ title: 'X', priority: 'asap' }, 'fred'],
    [{ title: 'X', estimate: 4 }, 'fred'],
    [{ title: 'X', assignee: 'nobody' }, 'fred'],
    [{ title: 'X', parent: 'ISS-9999' }, 'fred'],
    [{ title: 'X', sprint: 'sprint-1' }, 'fred'],
    [{ title: 'X', due: '2026-02-30' }, 'fred'],
    [{ title: 'X', color: 'red' }, 'fred'],
    [{ title: 'X' }, 'stranger'],
  ]
  for (const [input, actor] of bad) {
    assert.throws(() => tracker.createIssue(input, actor), { code: 'INVALID_INPUT' }, JSON.stringify(input))
  }
})

test('create accepts a parent issue, a sprint file and a due date', () => {
  const { tracker, issuesDir } = setup()
  tracker.createIssue({ title: 'Parent' }, 'fred')
  fs.writeFileSync(path.join(issuesDir, 'sprints', 'sprint-1.yaml'), 'id: sprint-1\n')
  const { after } = tracker.createIssue(
    { title: 'Child', parent: 'iss-1234', sprint: 'sprint-1', due: '2026-11-01', labels: ['a'], estimate: 5, description: 'Why.' },
    'fred',
  )
  assert.equal(after.parent, 'ISS-1234')
  assert.equal(after.sprint, 'sprint-1')
  assert.equal(after.due, '2026-11-01')
  assert.equal(after.estimate, 5)
  assert.equal(after.description, 'Why.')
  assert.deepEqual(tracker.getIssue(after.id).labels, ['a'])
})

test('update priority writes one update event with from and to', () => {
  const { tracker, rawEvents } = setup()
  tracker.createIssue({ title: 'First', priority: 'low' }, 'fred')
  const { before, after } = tracker.updateIssue('ISS-1234', { priority: 'high' }, 'fred')
  assert.equal(before.priority, 'low')
  assert.equal(after.priority, 'high')
  const events = rawEvents('ISS-1234')
  assert.equal(events.length, 2)
  assert.deepEqual(events[1], { at: NOW, by: 'fred', op: 'update', field: 'priority', from: 'low', to: 'high' })
})

test('update writes description changes as one event without from and to', () => {
  const { tracker, rawEvents } = setup()
  tracker.createIssue({ title: 'First' }, 'fred')
  const { after } = tracker.updateIssue(
    'ISS-1234',
    { description: 'New text', acceptanceCriteria: [{ text: 'Works', done: false }] },
    'fred',
  )
  assert.equal(after.description, 'New text')
  assert.deepEqual(after.acceptanceCriteria, [{ text: 'Works', done: false }])
  const events = rawEvents('ISS-1234').slice(1)
  assert.deepEqual(events.map((e) => e.field), ['description', 'acceptance_criteria'])
  assert.ok(events.every((e) => e.op === 'update' && !('from' in e) && !('to' in e)))
})

test('update refuses the fields other operations own', () => {
  const { tracker } = setup()
  tracker.createIssue({ title: 'First' }, 'fred')
  const owners = {
    id: undefined,
    created: undefined,
    status: 'pmkit issues move',
    assignee: 'pmkit issues assign',
    parent: 'pmkit issues parent',
    blockedBy: 'pmkit issues link',
    related: 'pmkit issues link',
    duplicateOf: 'pmkit issues link',
    archived: 'pmkit issues archive',
  }
  for (const [key, nextStep] of Object.entries(owners)) {
    assert.throws(
      () => tracker.updateIssue('ISS-1234', { [key]: 'x' }, 'fred'),
      (error) => error.code === 'INVALID_INPUT' && error.nextStep === nextStep,
      key,
    )
  }
})

test('an update that changes nothing writes nothing', () => {
  const { tracker, issuesDir } = setup()
  tracker.createIssue({ title: 'First', priority: 'low' }, 'fred')
  const hash = hashTree(issuesDir)
  const { before, after } = tracker.updateIssue('ISS-1234', { priority: 'low', title: 'First' }, 'fred')
  assert.deepEqual(before, after)
  assert.equal(hashTree(issuesDir), hash)
})

test('move to a category picks its first status and writes one move event', () => {
  const { tracker, rawEvents } = setup()
  tracker.createIssue({ title: 'First' }, 'fred')
  const { after } = tracker.moveToCategory('ISS-1234', 'in_review', 'fred')
  assert.deepEqual(after.status, { name: 'in_review', category: 'in_review' })
  assert.equal(after.updated, NOW)
  assert.deepEqual(rawEvents('ISS-1234')[1], {
    at: NOW, by: 'fred', op: 'move', field: 'status', from: 'backlog', to: 'in_review',
  })
})

test('move refuses a status that is not in the category', () => {
  const { tracker } = setup()
  tracker.createIssue({ title: 'First' }, 'fred')
  assert.throws(() => tracker.moveToCategory('ISS-1234', 'done', 'fred', { status: 'shipped' }), { code: 'INVALID_INPUT' })
  assert.throws(() => tracker.moveToCategory('ISS-1234', 'done', 'fred', { status: 'todo' }), { code: 'INVALID_INPUT' })
  assert.throws(() => tracker.moveToCategory('ISS-1234', 'finished', 'fred'), { code: 'INVALID_INPUT' })
})

test('assign and unassign write one assign event each', () => {
  const { tracker, rawEvents } = setup()
  tracker.createIssue({ title: 'First' }, 'fred')
  assert.equal(tracker.assign('ISS-1234', 'fred', 'fred').after.assignee, 'fred')
  assert.equal(tracker.assign('ISS-1234', null, 'fred').after.assignee, undefined)
  const events = rawEvents('ISS-1234').slice(1)
  assert.deepEqual(events.map((e) => [e.op, e.field, e.from ?? null, e.to]), [
    ['assign', 'assignee', null, 'fred'],
    ['assign', 'assignee', 'fred', null],
  ])
  assert.throws(() => tracker.assign('ISS-1234', 'nobody', 'fred'), { code: 'INVALID_INPUT' })
})

test('archive sets archived and writes one archive event', () => {
  const { tracker, rawEvents } = setup()
  tracker.createIssue({ title: 'First' }, 'fred')
  assert.equal(tracker.archive('ISS-1234', 'fred').after.archived, true)
  assert.equal(rawEvents('ISS-1234')[1].op, 'archive')
  assert.equal(rawEvents('ISS-1234').length, 2)
})

test('a hand-edited status becomes a synthetic move before the next write, once', () => {
  const { tracker, paths, rawEvents, setNow } = setup()
  setNow('2026-10-23T10:00:00Z')
  tracker.createIssue({ title: 'First' }, 'fred')
  const { file } = paths('ISS-1234')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('status: backlog', 'status: done'))
  const edited = new Date('2026-10-23T11:00:00Z')
  fs.utimesSync(file, edited, edited)
  setNow(NOW)

  tracker.assign('ISS-1234', 'fred', 'fred')
  const events = rawEvents('ISS-1234')
  assert.equal(events.length, 3)
  assert.deepEqual(events[1], {
    at: '2026-10-23T11:00:00Z', by: 'fred', op: 'move', field: 'status', from: 'backlog', to: 'done', synthetic: true,
  })
  assert.equal(events[2].op, 'assign')
  assert.equal(events[2].at, NOW)

  tracker.updateIssue('ISS-1234', { title: 'Second' }, 'fred')
  assert.equal(rawEvents('ISS-1234').filter((e) => e.synthetic).length, 1)
})

test('every write with dryRun leaves the issues folder byte-identical', () => {
  const { tracker, issuesDir, paths } = setup()
  tracker.createIssue({ title: 'First' }, 'fred')
  const { file } = paths('ISS-1234')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('status: backlog', 'status: todo'))
  const edited = new Date('2026-10-23T11:00:00Z')
  fs.utimesSync(file, edited, edited)

  const hash = hashTree(issuesDir)
  const dry = { dryRun: true }
  const results = [
    tracker.createIssue({ title: 'Second' }, 'fred', dry),
    tracker.updateIssue('ISS-1234', { title: 'Renamed' }, 'fred', dry),
    tracker.moveToCategory('ISS-1234', 'done', 'fred', dry),
    tracker.assign('ISS-1234', 'fred', 'fred', dry),
    tracker.archive('ISS-1234', 'fred', dry),
  ]
  assert.equal(hashTree(issuesDir), hash)
  assert.equal(results[0].before, null)
  assert.equal(results[0].after.title, 'Second')
  assert.equal(results[1].after.title, 'Renamed')
  assert.equal(results[2].after.status.name, 'done')
  assert.equal(results[3].after.assignee, 'fred')
  assert.equal(results[4].after.archived, true)
  assert.equal(results[1].before.status.name, 'todo')
})

test('getIssue normalizes the id and fails with NOT_FOUND for a missing one', () => {
  const { tracker } = setup()
  tracker.createIssue({ title: 'First' }, 'fred')
  assert.equal(tracker.getIssue('iss-1234').id, 'ISS-1234')
  assert.deepEqual(tracker.getIssue('ISS-1234').blocks, [])
  assert.throws(
    () => tracker.getIssue('ISS-9999'),
    (error) => error.code === 'NOT_FOUND' && error.nextStep === 'pmkit issues list',
  )
})

test('listIssueIds returns only folders that are issue ids', () => {
  const { tracker, issuesDir } = setup()
  tracker.createIssue({ title: 'First' }, 'fred')
  fs.mkdirSync(path.join(issuesDir, 'issues', 'notes'))
  assert.deepEqual(listIssueIds(issuesDir, 'ISS'), ['ISS-1234'])
})

test('drift is dated no earlier than the newest logged event, so a second write adds none', () => {
  const { tracker, paths, rawEvents } = setup()
  tracker.createIssue({ title: 'First' }, 'fred')
  const { file } = paths('ISS-1234')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('status: backlog', 'status: done'))
  const restored = new Date('2026-10-23T09:00:00Z')
  fs.utimesSync(file, restored, restored)

  tracker.assign('ISS-1234', 'fred', 'fred')
  const synthetic = rawEvents('ISS-1234').filter((e) => e.synthetic)
  assert.equal(synthetic.length, 1)
  assert.equal(synthetic[0].at, NOW)

  const edited = new Date('2026-10-23T09:00:00Z')
  fs.utimesSync(file, edited, edited)
  tracker.updateIssue('ISS-1234', { title: 'Second' }, 'fred')
  assert.equal(rawEvents('ISS-1234').filter((e) => e.synthetic).length, 1)
})
