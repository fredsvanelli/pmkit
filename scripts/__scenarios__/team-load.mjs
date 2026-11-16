// /pmkit:team:load on the team fixture, on 2026-10-23. In the active sprint 2026-10-12 ana holds 13 points (ISS-2X6D 8 and
// ISS-8C4W 5) against a capacity of 10 and fred holds 4, so ana is over the average and over capacity. ana has no issue in
// todo, so there is no suggestion. The user names the move of ISS-8C4W to fred, sees the preview and approves. The
// second read shows ana at 8 and fred at 9, which is over the capacity of 8 that fred has.
import assert from 'node:assert/strict'

export default {
  command: 'team/load',
  fixture: 'team',
  prompt: '/pmkit:team:load',
  answers: ['Move ISS-8C4W to fred', 'Yes'],
  steps: [
    { step: '1', read: ['team', 'load'], save: 'before' },
    { step: '5', dryRun: ['issues', 'assign', 'ISS-8C4W', 'fred'] },
    { confirm: 'Step 5' },
    { step: '6', write: ['issues', 'assign', 'ISS-8C4W', 'fred'] },
    { step: '7', read: ['team', 'load'], save: 'after' },
  ],
  skip: {},
  notHit: {},
  expect(repo, saved) {
    const row = (report, member) => report.rows.find((item) => item.member === member)
    assert.deepEqual(saved.before.imbalances.map((item) => [item.member, item.flag]), [['ana', 'over_average'], ['ana', 'over_capacity']])
    assert.deepEqual(saved.before.suggestions, [], 'ana has no issue in todo, so nothing is proposed')
    assert.equal(repo.issue('ISS-8C4W').assignee, 'fred')
    assert.equal(repo.newEvents('ISS-8C4W').length, 1)
    assert.deepEqual([row(saved.after, 'ana').estimate, row(saved.after, 'fred').estimate], [8, 9])
    assert.deepEqual(saved.after.imbalances.map((item) => [item.member, item.flag]), [['fred', 'over_capacity']], 'fred has 9 points against a capacity of 8')
  },
}
