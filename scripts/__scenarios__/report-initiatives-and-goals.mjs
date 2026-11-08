// /pmkit:report:initiatives-and-goals on the no-sprints fixture, which has one goal, GOAL-8K2W, linked to the epic EPC-4H7V.
// Both of its issues are done, so the goal is at 100% with 13 of 13 points. The command reads once and writes nothing.
import assert from 'node:assert/strict'

export default {
  command: 'report/initiatives-and-goals',
  fixture: 'no-sprints',
  prompt: '/pmkit:report:initiatives-and-goals',
  answers: [],
  steps: [
    { step: '1', read: ['goals', 'overview'], save: 'overview' },
  ],
  skip: {},
  notHit: {},
  expect(repo, saved) {
    assert.equal(saved.overview.source, 'goals')
    assert.equal(saved.overview.complete, true)
    const [goal] = saved.overview.items
    assert.deepEqual([goal.goal.id, goal.epics.map((e) => e.id), goal.progress, goal.pointsDone], ['GOAL-8K2W', ['EPC-4H7V'], 1, 13])
  },
}
