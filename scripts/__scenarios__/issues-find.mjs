// /pmkit:issues:find "my issues in progress and the features of the current sprint": discover, then two filters.
import assert from 'node:assert/strict'

export default {
  command: 'issues/find',
  fixture: 'team',
  git: true,
  prompt: '/pmkit:issues:find my issues in progress, and the features of the current sprint',
  answers: [],
  steps: [
    { step: '1', read: ['discover'] },
    { step: '5', read: ['issues', 'list', '--category', 'in_progress', '--assignee', 'me'], save: 'mine' },
    { step: '5', read: ['issues', 'list', '--type', 'feature', '--sprint', 'current'], save: 'features' },
  ],
  skip: { '7 views save': 'the prompt asks each question once, so the offer to save a repeated query does not come up' },
  notHit: { 'Step 7': 'the prompt asks each question once, so no query repeats' },
  expect(repo, saved) {
    const ids = (list) => list.issues.map((issue) => issue.id).sort()
    assert.deepEqual(ids(saved.mine), ['ISS-5N1R'], 'fred has one issue in progress')
    assert.deepEqual(ids(saved.features), ['ISS-2X6D', 'ISS-8C4W'], 'the features of the sprint 2026-10-12')
  },
}
