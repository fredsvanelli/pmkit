// /pmkit:issues:summary for an issue (ISS-9B2X, posts the summary as a comment) and for an epic (EPC-4H7V, only reads).
import assert from 'node:assert/strict'

const summary = 'Decisions: none recorded.\nOpen points: the replay endpoint is not built.\nBlockers: none.\nNext steps: review the PR.'
const post = ['issues', 'comment', 'ISS-9B2X', '--body-file', '-']

export default [
  {
    command: 'issues/summary',
    fixture: 'no-sprints',
    prompt: '/pmkit:issues:summary ISS-9B2X',
    answers: ['Yes'],
    steps: [
      { step: '1', read: ['issues', 'get', 'ISS-9B2X', '--comments', '--history'] },
      { step: '5', dryRun: post, stdin: summary },
      { confirm: 'Step 5' },
      { step: '5', write: post, stdin: summary },
    ],
    skip: {
      '1 epic get': 'ISS-9B2X is an issue, so step 1 takes the issues get path',
      '1 epic updates': 'ISS-9B2X is an issue, so step 1 takes the issues get path',
      '2 issues list': 'ISS-9B2X has no children, so step 2 does not list them',
    },
    notHit: {},
    expect(repo) {
      const comments = repo.newEvents('ISS-9B2X').filter((event) => event.op === 'comment')
      assert.equal(comments.length, 1)
      assert.ok(repo.file(`.issues/issues/ISS-9B2X/comments/${comments[0].to}`).includes('the replay endpoint is not built'))
    },
  },
  {
    command: 'issues/summary',
    fixture: 'no-sprints',
    git: true,
    prompt: '/pmkit:issues:summary EPC-4H7V',
    answers: [],
    steps: [
      { step: '1', read: ['epic', 'get', 'EPC-4H7V'] },
      { step: '1', read: ['epic', 'updates', 'EPC-4H7V'] },
      { step: '2', read: ['issues', 'list', '--parent', 'EPC-4H7V'] },
    ],
    skip: {
      '1 issues get': 'EPC-4H7V is an epic, so step 1 takes the epic get path',
      '5 issues comment': 'step 5 is skipped for an epic, because issues comment only takes an issue ID',
    },
    notHit: { 'Step 5': 'an epic skips the offer to post the summary' },
    expect(repo) {
      assert.deepEqual(repo.newEvents('EPC-4H7V'), [])
      assert.equal(repo.git('status', '--porcelain'), '')
    },
  },
]
