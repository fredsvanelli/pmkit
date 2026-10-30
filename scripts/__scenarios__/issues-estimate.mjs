// /pmkit:issues:estimate ISS-4M2S on the Local tracker. The estimation capability is native, so step 7 saves the
// estimate and step 8, the comment of a tracker with no estimate field, does not run. ISS-4M2S is in todo with an
// estimate of 1. The completed issue ISS-9T2M ("Fix rounding in invoice totals", 2) matches the keyword "Fix", and the
// scenario proposes 2. The issue is not done or canceled, so step 2 does not ask.
import assert from 'node:assert/strict'

const update = ['issues', 'update', 'ISS-4M2S', '--estimate', '2']

export default {
  command: 'issues/estimate',
  fixture: 'team',
  prompt: '/pmkit:issues:estimate ISS-4M2S',
  answers: ['Yes'],
  steps: [
    { step: '1', read: ['capabilities'] },
    { step: '2', read: ['issues', 'get', 'ISS-4M2S'] },
    { step: '3', read: ['discover'] },
    { step: '5', read: ['issues', 'list', '--category', 'done', '--text', 'Fix'] },
    { step: '7.1', dryRun: update },
    { confirm: 'Step 7' },
    { step: '7.3', write: update },
  ],
  skip: {
    '5 issues get': 'the list already shows the estimate of every similar issue, so no issue needs a second read',
    '8 issues comment': 'the Local tracker has an estimate field, so the command saves the estimate and does not comment it',
  },
  notHit: {
    'Step 8': 'the Local tracker has an estimate field, so the command does not comment the estimate',
    'Step 2': 'ISS-4M2S is in todo, so step 2 does not ask whether to estimate a finished issue',
  },
  expect(repo) {
    assert.equal(repo.issue('ISS-4M2S').estimate, 2)
    assert.equal(repo.newEvents('ISS-4M2S').filter((event) => event.op === 'update' && event.field === 'estimate').length, 1)
  },
}
