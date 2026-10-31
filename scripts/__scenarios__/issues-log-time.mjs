// /pmkit:issues:log-time ISS-5N1R 1h30 on the Local tracker. The time_tracking capability is native, so the command
// previews and writes the entry, reads the total from time-entries, and the comment of step 6 does not run.
// The CLI reads "1h30" as 90 minutes, so the entry and the total are 90.
import assert from 'node:assert/strict'

const log = ['issues', 'log-time', 'ISS-5N1R', '1h30']

export default {
  command: 'issues/log-time',
  fixture: 'team',
  prompt: '/pmkit:issues:log-time ISS-5N1R 1h30',
  answers: ['Yes'],
  steps: [
    { step: '1', read: ['capabilities'] },
    { step: '2', read: ['issues', 'get', 'ISS-5N1R'] },
    { step: '4', dryRun: log },
    { confirm: 'Step 5' },
    { step: '5', write: log },
    { step: '5', read: ['issues', 'time-entries', 'ISS-5N1R'] },
  ],
  skip: {
    '6 issues comment': 'the Local tracker has time tracking, so the command logs the entry and does not comment it',
  },
  notHit: {
    'Step 6': 'the Local tracker has time tracking, so the command does not suggest a comment',
    'Step 3': 'the time is given in the prompt, so step 3 does not ask for it',
  },
  expect(repo) {
    const entries = repo.newEvents('ISS-5N1R').filter((event) => event.op === 'log_time')
    assert.equal(entries.length, 1)
    assert.equal(entries[0].minutes, 90)
  },
}
