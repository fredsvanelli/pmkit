import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { isId } from './lib/ids.mjs'
import { hashTree, makeRepo } from './test-helpers.mjs'
import { GOAL_STATUSES, parseGoal, serializeGoal, sortGoals } from './lib/local/goals.mjs'
import { parseEpicFile, serializeEpic } from './lib/local/epics.mjs'

const code = (value) => (error) => error.code === value

test('the goal statuses are Linear initiative statuses in lower case (PMK-213)', () => {
  assert.deepEqual(GOAL_STATUSES, ['proposed', 'planned', 'active', 'completed', 'canceled'])
})

test('a goal file without status reads as active, and a status outside the list is refused (PMK-213)', () => {
  assert.equal(parseGoal('---\ntitle: T\n---\n', 'GOAL-1').status, 'active')
  assert.equal(parseGoal('---\ntitle: T\nstatus: planned\n---\n', 'GOAL-1').status, 'planned')
  for (const value of ['Active', 'done', '1']) {
    assert.throws(() => parseGoal(`---\ntitle: T\nstatus: ${value}\n---\n`, 'GOAL-1'), (error) => error.code === 'INVALID_INPUT' && error.nextStep === '/pmkit:local:doctor' && error.message.includes('proposed, planned, active, completed, canceled'), value)
  }
})

test('a goal round trips through its file, and the stem is the id', () => {
  const text = serializeGoal({ title: 'Customers trust our webhooks', status: 'planned', target: '2026-12-31', description: 'Why it matters.' })
  assert.equal(text, '---\ntitle: Customers trust our webhooks\nstatus: planned\ntarget: 2026-12-31\n---\n\nWhy it matters.\n')
  assert.deepEqual(parseGoal(text, 'GOAL-1'), { id: 'GOAL-1', title: 'Customers trust our webhooks', status: 'planned', target: '2026-12-31', description: 'Why it matters.' })
  assert.equal(serializeGoal({ title: 'Bare', status: 'active', description: '' }), '---\ntitle: Bare\nstatus: active\n---\n')
  assert.deepEqual(parseGoal('---\nid: GOAL-9\ntitle: Bare\n---\n', 'GOAL-2'), { id: 'GOAL-2', title: 'Bare', status: 'active', description: '' })
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
  assert.deepEqual(after, { id: after.id, title: 'Trust', status: 'active', target: '2026-12-31', description: '', epics: [] })
  assert.equal(fs.readFileSync(path.join(goals, `${after.id}.md`), 'utf8'), '---\ntitle: Trust\nstatus: active\ntarget: 2026-12-31\n---\n')
  assert.equal(tracker.createGoal({ title: 'Later', status: 'planned' }, 'fred').after.status, 'planned')
  assert.throws(() => tracker.createGoal({ title: 'T', status: 'nope' }, 'fred'), code('INVALID_INPUT'))
})

test('goal_prefix names the goal ids, and a file with another prefix is no goal (PMK-213)', () => {
  const { root, goals } = setup()
  fs.appendFileSync(path.join(root, '.issues', 'config.yaml'), 'goal_prefix: OKR\n')
  const tracker = createLocalTracker(root, { now: () => new Date('2026-10-23T12:00:00Z') })
  const { id } = tracker.createGoal({ title: 'Trust' }, 'fred').after
  assert.ok(isId(id, 'OKR'), id)
  fs.writeFileSync(path.join(goals, 'GOAL-1.md'), '---\ntitle: Old\n---\n')
  const { goals: listed, problems } = tracker.listGoals()
  assert.deepEqual(listed.map((goal) => goal.id), [id])
  assert.deepEqual(problems.map((problem) => [problem.id, problem.kind]), [['GOAL-1', 'file']])
  assert.match(problems[0].message, /such as OKR-1/)
  assert.equal(tracker.setEpicGoal('EPC-2M9D', id, 'fred').after.goal, id)
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
  assert.deepEqual(first, { id: 'EPC-2M9D', title: 'Reliable webhooks and billing export', status: { name: 'in_progress', category: 'in_progress' }, counted: true, progress: epic })
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

test('setEpicGoal refuses an empty, blank or non-string goal and only null removes the link (PMK-179)', () => {
  const { root, tracker } = setup()
  const { id } = tracker.createGoal({ title: 'Trust' }, 'fred').after
  tracker.setEpicGoal('EPC-2M9D', id, 'fred')
  const before = hashTree(root)
  for (const value of ['', '   ', 5, undefined]) {
    assert.throws(() => tracker.setEpicGoal('EPC-2M9D', value, 'fred'), code('INVALID_INPUT'), String(value))
  }
  assert.deepEqual(hashTree(root), before)
  assert.equal(tracker.getDeliverable('EPC-2M9D').goal, id)
  assert.equal(tracker.setEpicGoal('EPC-2M9D', null, 'fred').after.goal, undefined)
})

const epicFile = (root) => path.join(root, '.issues', 'epics', 'EPC-2M9D', 'epic.md')
const RICH = '---\nid: EPC-2M9D\n# keep this comment\ntitle: Reliable webhooks and billing export\nstatus: in_progress\nstart: 2026-09-28\ntarget: 2026-11-13\nextra:\n  - a: 1\n  - b: 2\n"": odd\nowner: ana # trailing\n---\n\nBody line one.\n\nBody line two.\n'

test('setEpicGoal keeps every frontmatter key, comment and the body, including lists of maps and "" keys (PMK-179)', () => {
  const { root, tracker } = setup()
  fs.writeFileSync(epicFile(root), RICH)
  const { id } = tracker.createGoal({ title: 'Trust' }, 'fred').after
  tracker.setEpicGoal('EPC-2M9D', id, 'fred')
  assert.equal(fs.readFileSync(epicFile(root), 'utf8'), RICH.replace('\n---\n\nBody line one', `\ngoal: ${id}\n---\n\nBody line one`))
  const second = tracker.createGoal({ title: 'Other' }, 'fred').after.id
  tracker.setEpicGoal('EPC-2M9D', second, 'fred')
  assert.equal(fs.readFileSync(epicFile(root), 'utf8'), RICH.replace('\n---\n\nBody line one', `\ngoal: ${second}\n---\n\nBody line one`))
  tracker.setEpicGoal('EPC-2M9D', null, 'fred')
  assert.equal(fs.readFileSync(epicFile(root), 'utf8'), RICH)
})

test('setEpicGoal on a CRLF epic file keeps its keys and writes LF (PMK-179)', () => {
  const { root, tracker } = setup()
  fs.writeFileSync(epicFile(root), RICH.replace(/\n/g, '\r\n'))
  const { id } = tracker.createGoal({ title: 'Trust' }, 'fred').after
  tracker.setEpicGoal('EPC-2M9D', id, 'fred')
  const text = fs.readFileSync(epicFile(root), 'utf8')
  assert.ok(!text.includes('\r'))
  assert.match(text, /^# keep this comment$/m)
  assert.match(text, new RegExp(`^goal: ${id}$`, 'm'))
})

test('setEpicGoal fails and writes nothing when the goal key holds a block (PMK-179)', () => {
  const { root, tracker } = setup()
  fs.writeFileSync(epicFile(root), RICH.replace('owner: ana # trailing\n', 'goal:\n  nested: x\n'))
  const { id } = tracker.createGoal({ title: 'Trust' }, 'fred').after
  const before = hashTree(root)
  assert.throws(() => tracker.setEpicGoal('EPC-2M9D', id, 'fred'), code('INVALID_INPUT'))
  assert.deepEqual(hashTree(root), before)
})

function epicWithIssues(root, tracker, goalId, title, statuses, epicStatus) {
  const epic = tracker.createDeliverable({ title, goal: goalId }, 'fred').after
  for (const [category, estimate] of statuses) {
    const issue = tracker.createIssue({ title: `${title} ${category}`, parent: epic.id, estimate }, 'fred').after
    if (category !== 'backlog') tracker.moveToCategory(issue.id, category, 'fred')
  }
  if (epicStatus) {
    const file = path.join(root, '.issues', 'epics', epic.id, 'epic.md')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^status: .*$/m, `status: ${epicStatus}`))
  }
  return epic
}

test('a canceled epic counts as nothing in the goal progress, and is listed with counted false (PMK-179)', () => {
  const { root, tracker } = setup()
  const { id } = tracker.createGoal({ title: 'Trust' }, 'fred').after
  const live = epicWithIssues(root, tracker, id, 'Live', [['done', 3], ['backlog', 2]])
  const dead = epicWithIssues(root, tracker, id, 'Dead', [['done', 5], ['backlog', 8], ['backlog', 1]], 'canceled')
  const progress = tracker.goalProgress(id)
  const entry = (epicId) => progress.epics.find((e) => e.id === epicId)
  assert.equal(entry(live.id).counted, true)
  assert.equal(entry(dead.id).counted, false)
  assert.deepEqual(entry(dead.id).progress, tracker.deliverableProgress(dead.id))
  assert.deepEqual([progress.total, progress.done, progress.points, progress.pointsDone], [2, 1, 5, 3])
  assert.equal(progress.byCategory.backlog, 1)
})

test('an epic with an unmapped status is still counted, and a goal of canceled epics has total 0 (PMK-179)', () => {
  const { root, tracker } = setup()
  const { id } = tracker.createGoal({ title: 'Trust' }, 'fred').after
  const odd = epicWithIssues(root, tracker, id, 'Odd', [['backlog', 2]], 'mystery')
  assert.equal(tracker.goalProgress(id).epics.find((e) => e.id === odd.id).counted, true)
  assert.equal(tracker.goalProgress(id).total, 1)
  const only = tracker.createGoal({ title: 'Dead goal' }, 'fred').after.id
  epicWithIssues(root, tracker, only, 'Gone', [['done', 3]], 'canceled')
  const none = tracker.goalProgress(only)
  assert.deepEqual([none.total, none.done, none.points, none.epics.length], [0, 0, 0, 1])
})
