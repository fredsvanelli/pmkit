// /pmkit:issues:find "my bugs in progress and the bugs of the current sprint": discover, then two filters.
import assert from 'node:assert/strict'

export default {
  command: 'issues/find',
  fixture: 'team',
  git: true,
  prompt: '/pmkit:issues:find my issues in progress, and the bugs of the current sprint',
  answers: [],
  steps: [
    { step: '1', read: ['discover'] },
    { step: '5', read: ['issues', 'list', '--category', 'in_progress', '--assignee', 'me'] },
    { step: '5', read: ['issues', 'list', '--type', 'bug', '--sprint', 'current'] },
  ],
  skip: {},
  notHit: {},
  expect(repo) {
    assert.equal(repo.git('status', '--porcelain'), '', 'a read leaves the working tree clean')
  },
}
