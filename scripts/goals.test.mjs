import { test } from 'node:test'
import assert from 'node:assert/strict'
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
