import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { hashTree, makeRepo } from './test-helpers.mjs'

function setup() {
  const root = makeRepo()
  const milestonesDir = path.join(root, '.issues', 'milestones')
  // Ids for issues and epics come from a counter, so each create gets a new one.
  let counter = 0
  const tracker = createLocalTracker(root, { now: () => new Date('2026-10-23T12:00:00Z'), random: (n) => counter++ % n })
  const write = (name, text) => {
    fs.mkdirSync(milestonesDir, { recursive: true })
    fs.writeFileSync(path.join(milestonesDir, name), text)
  }
  return { root, milestonesDir, tracker, write }
}

const code = (expected, pattern, nextStep) => (error) => {
  assert.equal(error.code, expected)
  if (pattern) assert.match(error.message, pattern)
  if (nextStep !== undefined) assert.equal(error.nextStep, nextStep)
  return true
}

test('createMilestone writes milestones/<id>.md, then list and get return it', () => {
  const { tracker, milestonesDir } = setup()
  const { before, after } = tracker.createMilestone({ id: 'local-gaps', name: 'Local tracker gaps', due: '2026-11-30' }, 'fred')
  assert.equal(before, null)
  assert.deepEqual(after, { id: 'local-gaps', name: 'Local tracker gaps', due: '2026-11-30', description: '' })
  assert.equal(fs.readFileSync(path.join(milestonesDir, 'local-gaps.md'), 'utf8'), '---\nname: Local tracker gaps\ndue: 2026-11-30\n---\n')
  assert.deepEqual(tracker.listMilestones(), [after])
  assert.deepEqual(tracker.getMilestone('local-gaps'), after)
})

test('createMilestone writes no event log', () => {
  const { tracker, milestonesDir } = setup()
  tracker.createMilestone({ id: 'M1' }, 'fred')
  assert.deepEqual(fs.readdirSync(milestonesDir), ['M1.md'])
})

test('listMilestones sorts by due, then id, with no due last', () => {
  const { tracker } = setup()
  tracker.createMilestone({ id: 'later' }, 'fred')
  tracker.createMilestone({ id: 'b', due: '2026-12-01' }, 'fred')
  tracker.createMilestone({ id: 'a', due: '2026-12-01' }, 'fred')
  tracker.createMilestone({ id: 'first', due: '2026-11-01' }, 'fred')
  assert.deepEqual(tracker.listMilestones().map((m) => m.id), ['first', 'a', 'b', 'later'])
})

test('createMilestone dry run writes nothing and makes no milestones folder', () => {
  const { tracker, root, milestonesDir } = setup()
  const hash = hashTree(root)
  const { before, after } = tracker.createMilestone({ id: 'M1', name: 'One' }, 'fred', { dryRun: true })
  assert.equal(before, null)
  assert.deepEqual(after, { id: 'M1', name: 'One', description: '' })
  assert.equal(hashTree(root), hash)
  assert.equal(fs.existsSync(milestonesDir), false)
})

test('createMilestone refuses an id that matches an existing one ignoring case', () => {
  const { tracker } = setup()
  tracker.createMilestone({ id: 'm1' }, 'fred')
  assert.throws(() => tracker.createMilestone({ id: 'M1' }, 'fred'), code('CONFLICT', /m1/, 'pmkit milestone list'))
  assert.throws(() => tracker.createMilestone({ id: 'm1' }, 'fred'), code('CONFLICT'))
})

test('createMilestone refuses an id that breaks the rule and writes nothing', () => {
  const { tracker, root, milestonesDir } = setup()
  const hash = hashTree(root)
  assert.throws(() => tracker.createMilestone({ id: 'Q4 2026' }, 'fred'), code('INVALID_INPUT', /Q4 2026/))
  assert.throws(() => tracker.createMilestone({ id: 'v1.' }, 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.createMilestone({}, 'fred'), code('INVALID_INPUT'))
  assert.equal(hashTree(root), hash)
  assert.equal(fs.existsSync(milestonesDir), false)
})

test('createMilestone refuses an unknown key', () => {
  const { tracker } = setup()
  assert.throws(() => tracker.createMilestone({ id: 'a', color: 'red' }, 'fred'), code('INVALID_INPUT', /unknown field "color"/, 'Use one of: id, name, due'))
})

test('createMilestone refuses a bad due date and a bad name', () => {
  const { tracker } = setup()
  assert.throws(() => tracker.createMilestone({ id: 'a', due: '2026-13-40' }, 'fred'), code('INVALID_INPUT', /due/))
  assert.throws(() => tracker.createMilestone({ id: 'a', due: 'soon' }, 'fred'), code('INVALID_INPUT', /due/))
  assert.throws(() => tracker.createMilestone({ id: 'a', name: 'One\nTwo' }, 'fred'), code('INVALID_INPUT', /line break/))
  assert.throws(() => tracker.createMilestone({ id: 'a', name: '   ' }, 'fred'), code('INVALID_INPUT', /name/))
  assert.throws(() => tracker.createMilestone({ id: 'a', name: 7 }, 'fred'), code('INVALID_INPUT', /name/))
})

test('createMilestone defaults name to the id and trims a given name', () => {
  const { tracker } = setup()
  assert.equal(tracker.createMilestone({ id: 'v1.0' }, 'fred').after.name, 'v1.0')
  assert.equal(tracker.createMilestone({ id: 'v2.0', name: '  Second  ' }, 'fred').after.name, 'Second')
  assert.equal(tracker.getMilestone('v2.0').name, 'Second')
})

test('createMilestone checks the actor before anything else', () => {
  const { tracker } = setup()
  assert.throws(() => tracker.createMilestone({ id: 'Q4 2026', color: 'red' }, 'nobody'), code('INVALID_INPUT', /actor "nobody"/))
})

test('listMilestones leaves out a file that does not parse, an id that breaks the rule and anything not .md', () => {
  const { tracker, write, milestonesDir } = setup()
  tracker.createMilestone({ id: 'good' }, 'fred')
  write('conflict.md', '---\n<<<<<<< HEAD\nname: A\n=======\nname: B\n>>>>>>> other\n---\n')
  write('bad-due.md', '---\ndue: 2026-13-40\n---\n')
  write('Q4 2026.md', '---\nname: Q4\n---\n')
  write('notes.yaml', 'name: x\n')
  fs.mkdirSync(path.join(milestonesDir, 'folder.md'))
  assert.deepEqual(tracker.listMilestones().map((m) => m.id), ['good'])
})

test('a milestone written by hand reads its description and ignores extra keys', () => {
  const { tracker, write } = setup()
  write('M1.md', '---\nname: First\ncolor: red\n---\n\nWhat ships first.\n')
  assert.deepEqual(tracker.getMilestone('M1'), { id: 'M1', name: 'First', description: 'What ships first.' })
})

test('listMilestones returns [] without a milestones folder', () => {
  const { tracker } = setup()
  assert.deepEqual(tracker.listMilestones(), [])
})

test('getMilestone of an unknown id is NOT_FOUND, and the match is exact and case-sensitive', () => {
  const { tracker } = setup()
  assert.throws(() => tracker.getMilestone('nope'), code('NOT_FOUND', /nope/, 'pmkit milestone list'))
  tracker.createMilestone({ id: 'M1' }, 'fred')
  assert.throws(() => tracker.getMilestone('m1'), code('NOT_FOUND'))
  assert.throws(() => tracker.getMilestone('../M1'), code('NOT_FOUND'))
})

test('getMilestone of a file that does not parse throws its parse error', () => {
  const { tracker, write } = setup()
  write('M1.md', '---\ndue: soon\n---\n')
  assert.throws(() => tracker.getMilestone('M1'), code('INVALID_INPUT', /due/, '/pmkit:local:doctor'))
})

test('a milestone is free text while milestones/ holds no .md file', () => {
  const { tracker, milestonesDir, write } = setup()
  assert.equal(tracker.createIssue({ title: 'T', milestone: 'free text' }, 'fred').after.milestone, 'free text')
  fs.mkdirSync(milestonesDir, { recursive: true })
  assert.equal(tracker.createIssue({ title: 'T', milestone: 'v2' }, 'fred').after.milestone, 'v2')
  fs.mkdirSync(path.join(milestonesDir, 'v2'))
  assert.equal(tracker.createIssue({ title: 'T', milestone: 'v3' }, 'fred').after.milestone, 'v3')
  write('v2.yaml', 'name: v2\n')
  assert.equal(tracker.createIssue({ title: 'T', milestone: 'v3' }, 'fred').after.milestone, 'v3')
  assert.equal(tracker.createDeliverable({ title: 'E', milestone: 'v3' }, 'fred').after.milestone, 'v3')
})

test('once a milestone file exists, writes refuse a milestone without a file', () => {
  const { tracker } = setup()
  const { id } = tracker.createIssue({ title: 'T' }, 'fred').after
  tracker.createMilestone({ id: 'v2' }, 'fred')
  const missing = code('INVALID_INPUT', /^milestone v3 does not exist$/, 'pmkit milestone create v3')
  assert.throws(() => tracker.createIssue({ title: 'T', milestone: 'v3' }, 'fred'), missing)
  assert.throws(() => tracker.updateIssue(id, { milestone: 'v3' }, 'fred'), missing)
  assert.throws(() => tracker.createDeliverable({ title: 'E', milestone: 'v3' }, 'fred'), missing)
  assert.throws(() => tracker.createIssue({ title: 'T', milestone: 'V2' }, 'fred'), code('INVALID_INPUT', /^milestone V2 does not exist$/, 'pmkit milestone create V2'))
  assert.throws(() => tracker.createIssue({ title: 'T', milestone: 'v2\nv3' }, 'fred'), code('INVALID_INPUT', /line break/))
  assert.equal(tracker.createIssue({ title: 'T', milestone: 'v2' }, 'fred').after.milestone, 'v2')
  assert.equal(tracker.updateIssue(id, { milestone: 'v2' }, 'fred').after.milestone, 'v2')
  assert.equal(tracker.createDeliverable({ title: 'E', milestone: 'v2' }, 'fred').after.milestone, 'v2')
})

test('clearing a milestone, or updating another field of an issue whose milestone has no file, is not checked', () => {
  const { tracker } = setup()
  const { id } = tracker.createIssue({ title: 'T', milestone: 'jira' }, 'fred').after
  tracker.createMilestone({ id: 'v2' }, 'fred')
  const { after } = tracker.updateIssue(id, { priority: 'high' }, 'fred')
  assert.equal(after.priority, 'high')
  assert.equal(after.milestone, 'jira')
  // The CLI turns --milestone none into null.
  assert.equal(tracker.updateIssue(id, { milestone: null }, 'fred').after.milestone, undefined)
})
