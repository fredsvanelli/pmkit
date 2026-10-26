// /pmkit:issues:comment ISS-5N1R with a text that arrives on standard input.
import assert from 'node:assert/strict'

const text = 'The cursor works on the staging data. I will open the PR tomorrow.'

export default {
  command: 'issues/comment',
  fixture: 'team',
  prompt: `/pmkit:issues:comment ISS-5N1R ${text}`,
  answers: ['Yes'],
  steps: [
    { step: '2', dryRun: ['issues', 'comment', 'ISS-5N1R', '--body-file', '-'], stdin: text },
    { confirm: 'Step 3' },
    { step: '2', write: ['issues', 'comment', 'ISS-5N1R', '--body-file', '-'], stdin: text },
  ],
  skip: {},
  notHit: {},
  expect(repo) {
    const comment = repo.file('.issues/issues/ISS-5N1R/comments/2026-10-23T12-00-00Z-fred.md')
    assert.ok(comment?.includes(text), 'the comment file holds the text')
    assert.equal(repo.newEvents('ISS-5N1R').filter((event) => event.op === 'comment').length, 1)
  },
}
