import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { isId } from './lib/ids.mjs'
import { hashTree, makeRepo } from './test-helpers.mjs'
import { GOAL_PREFIX, parseGoal, serializeGoal, sortGoals } from './lib/local/goals.mjs'
import { parseEpicFile, serializeEpic } from './lib/local/epics.mjs'

const code = (value) => (error) => error.code === value

test('the goal prefix is GOAL', () => {
  assert.equal(GOAL_PREFIX, 'GOAL')
})

test('a goal round trips through its file, and the stem is the id', () => {
  const text = serializeGoal({ title: 'Customers trust our webhooks', target: '2026-12-31', description: 'Why it matters.' })
  assert.equal(text, '---\ntitle: Customers trust our webhooks\ntarget: 2026-12-31\n---\n\nWhy it matters.\n')
  assert.deepEqual(parseGoal(text, 'GOAL-1'), { id: 'GOAL-1', title: 'Customers trust our webhooks', target: '2026-12-31', description: 'Why it matters.' })
  assert.equal(serializeGoal({ title: 'Bare', description: '' }), '---\ntitle: Bare\n---\n')
  assert.deepEqual(parseGoal('---\nid: GOAL-9\ntitle: Bare\n---\n', 'GOAL-2'), { id: 'GOAL-2', title: 'Bare', description: '' })
})

test('parseGoal refuses a missing title, a title with a line break and a target that is not a date', () => {
  for (const text of ['---\ntarget: 2026-12-31\n---\n', '---\ntitle: One\rTwo\n---\n', '---\ntitle: T\ntarget: soon\n---\n', 'no frontmatter\n']) {
    assert.throws(() => parseGoal(text, 'GOAL-1'), (error) => error.code === 'INVALID_INPUT' && error.nextStep === '/pmkit:local:doctor', text)
  }
  assert.throws(() => parseGoal('---\n<<<<<<< HEAD\ntitle: A\n=======\ntitle: B\n>>>>>>> other\n---\n', 'GOAL-1'), code('CONFLICT'))
})

test('sortGoals orders by target, then id by number, and a goal without a target goes last', () => {
  const goals = [{ id: 'GOAL-3', title: 'c' }, { id: 'GOAL-10', title: 'b', target: '2026-12-01' }, { id: 'GOAL-2', title: 'a', target: '2026-11-01' }, { id: 'GOAL-1', title: 'd' }]
  assert.deepEqual(sortGoals(goals).map((goal) => goal.id), ['GOAL-2', 'GOAL-10', 'GOAL-1', 'GOAL-3'])
})

test('an epic file reads and writes its goal after the milestone', () => {
  const epic = { id: 'EPC-1', title: 'E', status: { name: 'backlog', category: 'backlog' }, milestone: 'v1', goal: 'GOAL-1', description: '' }
  const text = serializeEpic(epic)
  assert.equal(text, '---\nid: EPC-1\ntitle: E\nstatus: backlog\nmilestone: v1\ngoal: GOAL-1\n---\n\n')
  assert.equal(parseEpicFile(text, { statuses: { backlog: { category: 'backlog' } } }).goal, 'GOAL-1')
})

function setup({ numbered = false } = {}) {
  const root = makeRepo('team')
  if (numbered) fs.appendFileSync(path.join(root, '.issues', 'config.yaml'), 'id_style: numbered\n')
  const goals = path.join(root, '.issues', 'goals')
  return { root, goals, tracker: createLocalTracker(root, { now: () => new Date('2026-10-23T12:00:00Z') }) }
}
const epicEvents = (root) => fs.readFileSync(path.join(root, '.issues', 'epics', 'EPC-2M9D', 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))

test('createGoal writes goals/<id>.md with a GOAL id, and a dry run writes nothing', () => {
  const { root, goals, tracker } = setup()
  const before = hashTree(root)
  const dry = tracker.createGoal({ title: 'Trust', target: '2026-12-31' }, 'fred', { dryRun: true })
  assert.equal(dry.before, null)
  assert.deepEqual(hashTree(root), before)
  const { after } = tracker.createGoal({ title: 'Trust', target: '2026-12-31' }, 'fred')
  assert.ok(isId(after.id, 'GOAL'), after.id)
  assert.deepEqual(after, { id: after.id, title: 'Trust', target: '2026-12-31', description: '', epics: [] })
  assert.equal(fs.readFileSync(path.join(goals, `${after.id}.md`), 'utf8'), '---\ntitle: Trust\ntarget: 2026-12-31\n---\n')
})

test('createGoal refuses a missing title, a bad target and an unknown field', () => {
  const { tracker } = setup()
  assert.throws(() => tracker.createGoal({}, 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.createGoal({ title: 'T', target: 'soon' }, 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.createGoal({ title: 'T', owner: 'fred' }, 'fred'), code('INVALID_INPUT'))
})

test('with numbered ids the next goal reads the file stems', () => {
  const { goals, tracker } = setup({ numbered: true })
  fs.mkdirSync(goals, { recursive: true })
  fs.writeFileSync(path.join(goals, 'GOAL-1.md'), '---\ntitle: One\n---\n')
  assert.equal(tracker.createGoal({ title: 'Two' }, 'fred').after.id, 'GOAL-2')
})

test('setEpicGoal links an epic, normalizes the id, logs an update event and getGoal lists the epic', () => {
  const { root, tracker } = setup({ numbered: true })
  const { id } = tracker.createGoal({ title: 'Trust' }, 'fred').after
  const result = tracker.setEpicGoal('epc-2m9d', id.toLowerCase(), 'fred')
  assert.equal(result.before.goal, undefined)
  assert.equal(result.after.goal, id)
  assert.deepEqual(epicEvents(root).at(-1), { at: '2026-10-23T12:00:00Z', by: 'fred', op: 'update', field: 'goal', from: null, to: id })
  assert.equal(tracker.getDeliverable('EPC-2M9D').goal, id)
  assert.deepEqual(tracker.getGoal(id).epics, ['EPC-2M9D'])
  assert.equal(tracker.setEpicGoal('EPC-2M9D', null, 'fred').after.goal, undefined)
  assert.deepEqual(tracker.getGoal(id).epics, [])
  const unchanged = hashTree(root)
  const again = tracker.setEpicGoal('EPC-2M9D', null, 'fred')
  assert.deepEqual(again.before, again.after)
  assert.deepEqual(hashTree(root), unchanged)
})

test('setEpicGoal keeps the frontmatter keys pmkit does not know and the body', () => {
  const { root, tracker } = setup()
  const file = path.join(root, '.issues', 'epics', 'EPC-2M9D', 'epic.md')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('target: 2026-11-13\n', 'target: 2026-11-13\nowner: ana\n'))
  const body = fs.readFileSync(file, 'utf8').split('---\n').slice(2).join('---\n')
  const { id } = tracker.createGoal({ title: 'Trust' }, 'fred').after
  tracker.setEpicGoal('EPC-2M9D', id, 'fred')
  const text = fs.readFileSync(file, 'utf8')
  assert.match(text, /^owner: ana$/m)
  assert.match(text, new RegExp(`^goal: ${id}$`, 'm'))
  assert.equal(text.split('---\n').slice(2).join('---\n'), body)
  tracker.setEpicGoal('EPC-2M9D', null, 'fred')
  assert.match(fs.readFileSync(file, 'utf8'), /^owner: ana$/m)
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /^goal:/m)
})

test('setEpicGoal and createDeliverable refuse a goal that does not exist, and a dry run writes nothing', () => {
  const { root, tracker } = setup()
  assert.throws(() => tracker.setEpicGoal('EPC-2M9D', 'GOAL-ZZZZ', 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.createDeliverable({ title: 'E', goal: 'GOAL-ZZZZ' }, 'fred'), code('INVALID_INPUT'))
  const { id } = tracker.createGoal({ title: 'Trust' }, 'fred').after
  const before = hashTree(root)
  assert.equal(tracker.setEpicGoal('EPC-2M9D', id, 'fred', { dryRun: true }).after.goal, id)
  assert.deepEqual(hashTree(root), before)
  const epic = tracker.createDeliverable({ title: 'E', goal: id }, 'fred').after
  assert.equal(epic.goal, id)
  assert.deepEqual(tracker.getGoal(id).epics, [epic.id])
})

test('goalProgress gives each epic its deliverableProgress and the sums', () => {
  const { tracker } = setup()
  const { id } = tracker.createGoal({ title: 'Trust' }, 'fred').after
  const empty = tracker.goalProgress(id)
  assert.deepEqual(empty.epics, [])
  assert.equal(empty.total, 0)
  assert.equal(empty.pointsDone, 0)
  tracker.setEpicGoal('EPC-2M9D', id, 'fred')
  tracker.createDeliverable({ title: 'Second', goal: id }, 'fred')
  const progress = tracker.goalProgress(id)
  const epic = tracker.deliverableProgress('EPC-2M9D')
  assert.ok(epic.total > 0)
  assert.deepEqual(progress.goal, tracker.getGoal(id))
  assert.deepEqual(progress.epics.map((e) => e.id), tracker.getGoal(id).epics)
  const first = progress.epics.find((e) => e.id === 'EPC-2M9D')
  assert.deepEqual(first, { id: 'EPC-2M9D', title: 'Reliable webhooks and billing export', status: { name: 'in_progress', category: 'in_progress' }, progress: epic })
  for (const key of ['total', 'done', 'canceled', 'points', 'pointsDone']) assert.equal(progress[key], epic[key], key)
  assert.deepEqual(progress.byCategory, epic.byCategory)
})

test('listGoals skips a file that does not parse and a stem that is not a goal id, and reports both', () => {
  const { goals, tracker } = setup()
  const { id } = tracker.createGoal({ title: 'Trust' }, 'fred').after
  fs.writeFileSync(path.join(goals, 'GOAL-ZZZZ.md'), '---\ntitle: [\n---\n')
  fs.writeFileSync(path.join(goals, 'notes.md'), 'notes\n')
  const { goals: listed, problems } = tracker.listGoals()
  assert.deepEqual(listed.map((goal) => goal.id), [id])
  assert.deepEqual(problems.map((problem) => problem.id).sort(), ['GOAL-ZZZZ', 'notes'])
  assert.throws(() => tracker.getGoal('GOAL-ZZZZ'), code('INVALID_INPUT'))
  assert.throws(() => tracker.getGoal('GOAL-9'), code('NOT_FOUND'))
  assert.throws(() => tracker.getGoal('notes'), code('NOT_FOUND'))
})

test('listGoals is empty without a goals folder', () => {
  assert.deepEqual(setup().tracker.listGoals(), { goals: [], problems: [] })
})
