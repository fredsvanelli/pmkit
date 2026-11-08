// /pmkit:backlog:prioritize-by-demand on the team fixture, where demand_signals is native. Setup accepts four requests:
// three into ISS-6J0B (one important, so its score is 4) and one into ISS-3F7H (score 1). Two issues are ranked and the
// tracker has four priorities, so each band holds one issue: ISS-6J0B gets the first priority and ISS-3F7H the second.
// The comments-and-mentions path (step 4) needs no demand signal and is not run here, because the Local tracker serves one.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const SKIPPED = 'the command stops at step 1 with AUTH, before any request'

const CANDIDATES = ['--category', 'backlog,todo,triage']
const top = ['issues', 'update', 'ISS-6J0B', '--priority', 'urgent']
const next = ['issues', 'update', 'ISS-3F7H', '--priority', 'high']
const only = ['issues', 'update', 'ISS-3F7H', '--priority', 'high']

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
    { step: '1', read: ['discover'] },
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
    // One real mention, and one of ISS-3F7HX, which a substring search for ISS-3F7H finds but is not a mention.
    await pmkit(['issues', 'update', 'ISS-6J0B', '--description-file', '-'], { stdin: 'Needed by ISS-3F7H.\n' })
    await pmkit(['issues', 'update', 'ISS-4M2S', '--description-file', '-'], { stdin: 'Unrelated to ISS-3F7HX.\n' })
    },
    prompt: '/pmkit:backlog:prioritize-by-demand',
    answers: ['All', 'Yes'],
    steps: [
      { step: '1', read: ['capabilities'] },
    { step: '1', read: ['discover'] },
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
      assert.equal(repo.issue('ISS-3F7H').priority, 'high')
      assert.equal(repo.newEvents('ISS-6J0B').length, 0)
    },
  },
  {
    command: 'backlog/prioritize-by-demand',
    fixture: 'team',
    // A failed batch (step 8): after the dry runs, ISS-3F7H is overwritten with a file that does not parse (a bad merge), so its
    // write fails and the command stops, lists ISS-6J0B as applied and nothing as retried.
    async setup({ pmkit }) {
      for (const [title, issue] of [['Upgrade on CI', 'ISS-6J0B'], ['Empty dashboard confuses new users', 'ISS-3F7H']]) await pmkit(['requests', 'create', '--title', title, '--issue', issue])
    },
    prompt: '/pmkit:backlog:prioritize-by-demand',
    answers: ['All', 'Yes'],
    steps: [
      { step: '1', read: ['capabilities'] },
      { step: '1', read: ['discover'] },
      { step: '2', read: ['issues', 'list', ...CANDIDATES] },
      { step: '3', read: ['demand', 'list'], save: 'demand' },
      { confirm: 'Step 5' },
      { step: '6', dryRun: ['issues', 'update', 'ISS-6J0B', '--priority', 'urgent'] },
      { step: '6', dryRun: ['issues', 'update', 'ISS-3F7H', '--priority', 'high'] },
      { confirm: 'Step 7' },
      { step: '6', write: ['issues', 'update', 'ISS-6J0B', '--priority', 'urgent'] },
      { step: '6', edit: { file: '.issues/issues/ISS-3F7H/issue.md', content: '<<<<<<< HEAD\nid: ISS-3F7H\n=======\n>>>>>>> other\n' } },
      { step: '6', write: ['issues', 'update', 'ISS-3F7H', '--priority', 'high'], expectError: 'CONFLICT' },
    ],
    skip: {
      '4 issues get': 'the Local tracker has demand signals, so the comments and mentions path does not run',
      '4 issues list': 'the Local tracker has demand signals, so the comments and mentions path does not run',
      '9 issues list': 'the command stops at step 8 after the failed write',
    },
    notHit: {},
    expect(repo) {
      assert.equal(repo.issue('ISS-6J0B').priority, 'urgent')
    },
  },
  {
    command: 'backlog/prioritize-by-demand',
    fixture: 'team',
    git: true,
    // The Linear path (demand_signals absent) needs the Linear API, which a child process cannot fake: step 1 fails with AUTH and
    // the command stops before any request. scripts/lib/linear/manifest.test.mjs covers the absent capability.
    async setup({ root }) {
      const file = path.join(root, '.pmkit', 'config.yaml')
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('  system: local\n  path: .issues', '  system: linear\n  scope:\n    workspace: acme'))
    },
    prompt: '/pmkit:backlog:prioritize-by-demand',
    answers: [],
    steps: [{ step: '1', read: ['capabilities'], expectError: 'AUTH', save: 'capabilities' }],
    skip: {
      '1 discover': SKIPPED, '2 issues list': SKIPPED, '3 demand list': SKIPPED, '4 issues get': SKIPPED, '4 issues list': SKIPPED,
      '6 issues update': SKIPPED, '9 issues list': SKIPPED,
    },
    notHit: { 'Step 5': SKIPPED, 'Step 7': SKIPPED },
    expect(repo, saved) {
      assert.equal(saved.capabilities.error.code, 'AUTH')
    },
  },
]
