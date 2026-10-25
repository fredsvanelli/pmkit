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
  assert.match(text, /^created: 2026-10-23T12:00:00.000Z$/m)
  assert.match(text, /^updated: 2026-10-23T12:00:00Z$/m)
  assert.deepEqual(after.status, { name: 'backlog', category: 'backlog' })
  const events = rawEvents('ISS-1234')
  assert.equal(events.length, 1)
  assert.equal(events[0].op, 'create')
  assert.equal(events[0].by, 'fred')
  assert.equal(events[0].at, NOW)
  assert.equal(events[0].to.status, 'backlog')
  assert.equal(events[0].to.title, 'First')
})

test('with id_style numbered, issues and epics count up from 1 on their own', () => {
  const root = makeRepo()
  const configFile = path.join(root, '.issues', 'config.yaml')
  fs.writeFileSync(configFile, `${fs.readFileSync(configFile, 'utf8')}id_style: numbered\n`)
  const tracker = createLocalTracker(root, { now: () => new Date(NOW), random: scriptedRandom([]) })
  assert.equal(tracker.createIssue({ title: 'First' }, 'fred').after.id, 'ISS-1')
  assert.equal(tracker.createIssue({ title: 'Second' }, 'fred').after.id, 'ISS-2')
  assert.equal(tracker.createDeliverable({ title: 'Launch' }, 'fred').after.id, 'EPC-1')
  assert.equal(tracker.createIssue({ title: 'Dry' }, 'fred', { dryRun: true }).after.id, 'ISS-3')
  assert.equal(tracker.createIssue({ title: 'Third', parent: 'ISS-1' }, 'fred').after.id, 'ISS-3')
  assert.deepEqual(listIssueIds(path.join(root, '.issues'), 'ISS'), ['ISS-1', 'ISS-2', 'ISS-3'])
  assert.equal(tracker.getIssue('iss-l').title, 'First')
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

const FENCED_CONFLICT = 'Resolve it like this:\n\n```\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n```'

test('a write whose file would not read back throws and writes nothing', () => {
  const { tracker, issuesDir, paths } = setup()
  const before = hashTree(issuesDir)
  const conflicted = 'Before\n<<<<<<< HEAD\nours\n>>>>>>> other'
  assert.throws(() => tracker.createIssue({ title: 'X', description: conflicted }, 'fred'), (error) => error.code === 'INVALID_INPUT')
  assert.equal(hashTree(issuesDir), before)

  const { id } = tracker.createIssue({ title: 'First' }, 'fred').after
  const written = hashTree(issuesDir)
  assert.throws(() => tracker.updateIssue(id, { description: conflicted }, 'fred'), (error) => error.code === 'INVALID_INPUT')
  assert.equal(hashTree(issuesDir), written)
  assert.equal(tracker.getIssue(id).description, '')
  assert.ok(fs.existsSync(paths(id).file))

  const unclosed = { description: '```\nan unclosed fence', acceptanceCriteria: ['hidden by the fence'] }
  assert.throws(() => tracker.updateIssue(id, unclosed, 'fred'), (error) => error.code === 'INVALID_INPUT' && /acceptance criteria/.test(error.message))
  assert.equal(hashTree(issuesDir), written)
})

test('single-line fields refuse line breaks', () => {
  const { tracker } = setup()
  const lineBreak = (error) => error.code === 'INVALID_INPUT' && /line break/.test(error.message)
  for (const input of [
    { title: 'a\nb' },
    { title: 'a\rb' },
    { title: 'X', labels: ['ok', 'bad\nlabel'] },
    { title: 'X', acceptanceCriteria: ['one\ntwo'] },
    { title: 'X', acceptanceCriteria: [{ text: 'one\rtwo', done: false }] },
  ]) assert.throws(() => tracker.createIssue(input, 'fred'), lineBreak, JSON.stringify(input))
  const { id } = tracker.createIssue({ title: 'First' }, 'fred').after
  for (const patch of [{ title: 'a\nb' }, { milestone: 'v1\nv2' }, { branch: 'feature\r\nx' }]) {
    assert.throws(() => tracker.updateIssue(id, patch, 'fred'), lineBreak, JSON.stringify(patch))
  }
})

test('branch must be a git branch name, so it never reaches git as an option', () => {
  const { tracker } = setup()
  const { id } = tracker.createIssue({ title: 'First' }, 'fred').after
  const bad = ['--receive-pack=touch x', '-b', 'has space', 'tab\there', 'a..b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[b', 'a\\b',
    'trailing/', 'x.lock', 'a/x.lock/b', 'a@{1}', '@', '/lead', 'a//b', '.hidden', 'a/.hidden', 'dot.', 'del\x7f', '']
  for (const branch of bad) {
    assert.throws(() => tracker.updateIssue(id, { branch }, 'fred'), (e) => e.code === 'INVALID_INPUT', JSON.stringify(branch))
  }
  for (const branch of ['iss-7k3q-retry', 'feat/pmkit-step2', 'release/1.2', 'fix_a-b']) {
    assert.equal(tracker.updateIssue(id, { branch }, 'fred').after.branch, branch)
  }
})

test('conflict markers inside a fenced code block are text, not a conflict', () => {
  const { tracker } = setup()
  const { id } = tracker.createIssue({ title: 'Fenced', description: FENCED_CONFLICT }, 'fred').after
  assert.equal(tracker.getIssue(id).description, FENCED_CONFLICT)
  assert.deepEqual(tracker.searchIssues({}).problems, [])
})

test('a description or criterion with a ## heading outside a code fence is refused', () => {
  const { tracker } = setup()
  const heading = (error) => error.code === 'INVALID_INPUT' && error.nextStep === 'Use ### or deeper headings inside the description'
  assert.throws(() => tracker.createIssue({ title: 'X', description: 'Intro\n\n## Notes\n\nMore' }, 'fred'), heading)
  assert.throws(() => tracker.createIssue({ title: 'X', acceptanceCriteria: ['## Not a criterion'] }, 'fred'), heading)
  const description = 'Intro\n\n### Notes\n\n```md\n## Inside a fence\n```'
  const { id } = tracker.createIssue({ title: 'X', description }, 'fred').after
  assert.equal(tracker.getIssue(id).description, description)
  assert.throws(() => tracker.updateIssue(id, { description: '## Description\n\nAgain' }, 'fred'), heading)
  assert.equal(tracker.getIssue(id).description, description)
})

test('a hand-added frontmatter key survives the next write and causes no drift', () => {
  const { tracker, paths, rawEvents } = setup()
  const { id } = tracker.createIssue({ title: 'First' }, 'fred').after
  const { file } = paths(id)
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('type: feature\n', 'type: feature\nteam: payments\n'))
  assert.deepEqual(tracker.getIssue(id).extra, { team: 'payments' })
  tracker.updateIssue(id, { title: 'Second' }, 'fred')
  assert.match(fs.readFileSync(file, 'utf8'), /^team: payments$/m)
  assert.deepEqual(tracker.getIssue(id).extra, { team: 'payments' })
  assert.equal(rawEvents(id).filter((event) => event.synthetic).length, 0)
})

test('with a config that fails validation, reads work and every write refuses with the first problem', () => {
  const { root, issuesDir } = setup()
  let counter = 0
  const before = createLocalTracker(root, { now: () => new Date(NOW), random: (n) => counter++ % n })
  const { id } = before.createIssue({ title: 'First' }, 'fred').after
  const other = before.createIssue({ title: 'Second' }, 'fred').after.id
  before.openCycle({ start: '2026-10-19' }, 'fred')
  const epic = before.createDeliverable({ title: 'E' }, 'fred').after.id
  const configFile = path.join(issuesDir, 'config.yaml')
  fs.writeFileSync(configFile, fs.readFileSync(configFile, 'utf8').replace('canceled: { category: canceled }', 'canceled: { category: cancelled }'))
  const tracker = createLocalTracker(root, { now: () => new Date(NOW), random: scriptedRandom([7, 7, 7, 7]) })

  assert.equal(tracker.getIssue(id).title, 'First')
  assert.equal(tracker.searchIssues({}).issues.length, 2)
  assert.equal(tracker.listCycles().length, 1)

  const hash = hashTree(root)
  const refused = (error) => error.code === 'INVALID_INPUT' &&
    error.message.includes('status canceled: unknown category cancelled') && error.nextStep === 'pmkit validate'
  const writes = {
    createIssue: () => tracker.createIssue({ title: 'Third' }, 'fred'),
    updateIssue: () => tracker.updateIssue(id, { title: 'Renamed' }, 'fred'),
    moveToCategory: () => tracker.moveToCategory(id, 'done', 'fred'),
    assign: () => tracker.assign(id, 'fred', 'fred'),
    archive: () => tracker.archive(id, 'fred'),
    link: () => tracker.link(id, other, 'related', 'fred'),
    unlink: () => tracker.unlink(id, other, 'related', 'fred'),
    setParent: () => tracker.setParent(id, other, 'fred'),
    comment: () => tracker.comment(id, 'Hi', 'fred'),
    logTime: () => tracker.logTime(id, 5, 'fred'),
    openCycle: () => tracker.openCycle({ start: '2026-11-02' }, 'fred'),
    closeCycle: () => tracker.closeCycle('2026-10-19', 'fred'),
    moveToCycle: () => tracker.moveToCycle([id], '2026-10-19', 'fred'),
    setCapacity: () => tracker.setCapacity('2026-10-19', { fred: 1 }, 'fred'),
    createDeliverable: () => tracker.createDeliverable({ title: 'F' }, 'fred'),
    publishStatusUpdate: () => tracker.publishStatusUpdate({ epic, health: 'on_track', body: 'Fine' }, 'fred'),
    createDocument: () => tracker.createDocument('notes.md', 'Hello', 'fred'),
    dryRun: () => tracker.updateIssue(id, { title: 'Renamed' }, 'fred', { dryRun: true }),
  }
  for (const [name, write] of Object.entries(writes)) assert.throws(write, refused, name)
  assert.equal(hashTree(root), hash)
})

test('drift is dated no later than the write that finds it', () => {
  const { tracker, paths, rawEvents } = setup()
  tracker.createIssue({ title: 'First' }, 'fred')
  const { file } = paths('ISS-1234')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('status: backlog', 'status: done'))
  const future = new Date('2030-01-01T00:00:00Z')
  fs.utimesSync(file, future, future)

  tracker.assign('ISS-1234', 'fred', 'fred')
  const synthetic = rawEvents('ISS-1234').filter((e) => e.synthetic)
  assert.deepEqual(synthetic.map((e) => [e.field, e.at]), [['status', NOW]])
})

test('an hours estimate must be a finite positive number', () => {
  const { root, issuesDir } = setup()
  const configFile = path.join(issuesDir, 'config.yaml')
  fs.writeFileSync(configFile, fs.readFileSync(configFile, 'utf8').replace('unit: points', 'unit: hours'))
  const tracker = createLocalTracker(root, { now: () => new Date(NOW), random: scriptedRandom([1, 2, 3, 4]) })
  for (const estimate of [Infinity, NaN, 0, -1]) {
    assert.throws(() => tracker.createIssue({ title: 'X', estimate }, 'fred'), (error) => error.code === 'INVALID_INPUT', String(estimate))
  }
  assert.equal(tracker.createIssue({ title: 'X', estimate: 1.5 }, 'fred').after.estimate, 1.5)
})
