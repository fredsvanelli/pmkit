// /pmkit:backlog:prioritize-by-demand on the team fixture, where demand_signals is native. Setup accepts four requests:
// three into ISS-6J0B (one important, so its score is 4) and one into ISS-3F7H (score 1). Two issues are ranked and the
// tracker has four priorities, so each band holds one issue: ISS-6J0B gets the first priority and ISS-3F7H the second.
// The comments-and-mentions path (step 4) needs no demand signal and is not run here, because the Local tracker serves one.
import assert from 'node:assert/strict'

const CANDIDATES = ['--category', 'backlog,todo,triage']
const top = ['issues', 'update', 'ISS-6J0B', '--priority', 'urgent']
const next = ['issues', 'update', 'ISS-3F7H', '--priority', 'high']
const only = ['issues', 'update', 'ISS-3F7H', '--priority', 'urgent']

export default [
  {
    command: 'backlog/prioritize-by-demand',
    fixture: 'team',
    async setup({ pmkit }) {
      for (const [title, issue, extra] of [['Upgrade on CI', 'ISS-6J0B', []], ['Build is slow', 'ISS-6J0B', []], ['Blocked on the old toolchain', 'ISS-6J0B', ['--important']], ['Empty dashboard confuses new users', 'ISS-3F7H', []]]) {
        await pmkit(['requests', 'create', '--title', title, '--issue', issue, ...extra])
      }
    },
    prompt: '/pmkit:backlog:prioritize-by-demand',
    answers: ['All', 'Yes'],
    steps: [
      { step: '1', read: ['capabilities'] },
      { step: '2', read: ['issues', 'list', ...CANDIDATES] },
      { step: '3', read: ['demand', 'list'], save: 'demand' },
      { confirm: 'Step 5' },
      { step: '6', dryRun: top },
      { step: '6', dryRun: next },
      { confirm: 'Step 7' },
      { step: '6', write: top },
      { step: '6', write: next },
      { step: '9', read: ['issues', 'list', ...CANDIDATES] },
    ],
    skip: {
      '4 issues get': 'the Local tracker has demand signals, so the comments and mentions path does not run',
      '4 issues list': 'the Local tracker has demand signals, so the comments and mentions path does not run',
    },
    notHit: {},
    expect(repo, saved) {
      assert.deepEqual(saved.demand.signals.map((s) => [s.issue.id, s.count, s.important]), [['ISS-6J0B', 3, 1], ['ISS-3F7H', 1, 0]])
      assert.equal(repo.issue('ISS-6J0B').priority, 'urgent')
      assert.equal(repo.issue('ISS-3F7H').priority, 'high')
      assert.equal(repo.newEvents('ISS-4M2S').length, 0)
    },
  },
  {
    command: 'backlog/prioritize-by-demand',
    fixture: 'team',
    // No request exists, so demand list is empty and the command falls back to comments and mentions (step 4). ISS-3F7H has two
    // comments and is mentioned only by itself, which does not count, so it scores 2 and is the only ranked issue.
    async setup({ pmkit }) {
      for (const text of ['Users keep asking for this.\n', 'Two more customers asked.\n']) await pmkit(['issues', 'comment', 'ISS-3F7H', '--body-file', '-'], { stdin: text })
    },
    prompt: '/pmkit:backlog:prioritize-by-demand',
    answers: ['All', 'Yes'],
    steps: [
      { step: '1', read: ['capabilities'] },
      { step: '2', read: ['issues', 'list', ...CANDIDATES] },
      { step: '3', read: ['demand', 'list'], save: 'demand' },
      ...['ISS-3F7H', 'ISS-6J0B', 'ISS-4M2S', 'ISS-1V9Z'].flatMap((id) => [
        { step: '4', read: ['issues', 'get', id, '--comments'] },
        { step: '4', read: ['issues', 'list', '--text', id] },
      ]),
      { confirm: 'Step 5' },
      { step: '6', dryRun: only },
      { confirm: 'Step 7' },
      { step: '6', write: only },
      { step: '9', read: ['issues', 'list', ...CANDIDATES] },
    ],
    skip: {},
    notHit: {},
    expect(repo, saved) {
      assert.deepEqual(saved.demand.signals, [])
      assert.equal(repo.issue('ISS-3F7H').priority, 'urgent')
      assert.equal(repo.newEvents('ISS-6J0B').length, 0)
    },
  },
]
