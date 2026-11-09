// /pmkit:backlog:prioritize-by-demand on the team fixture. The four candidates (backlog, todo, triage) are ISS-3F7H (medium),
// ISS-6J0B (low), ISS-4M2S (medium) and ISS-1V9Z (no priority). Seven entries: requests (.0), comments and mentions with a
// whole-token decoy and the assignee's own comments (.1), a failed batch write (.2), the Linear path (.3), an incomplete read (.4) and a
// demand problem that concerns no candidate (.5) and the cap on an issue with no demand (.6).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { mentionedIn } from '../lib/mentions.mjs'

const AUTH = 'the command stops at step 1 with AUTH, before any request'
const LOCAL = 'the Local tracker has demand signals, so the comments and mentions path does not run'
const STOPPED = 'the command stops before it writes, so step 9 does not run'
const CANDIDATES = ['--category', 'backlog,todo,triage']
const update = (id, priority) => ['issues', 'update', id, '--priority', priority]
const request = (pmkit, issue, title, extra = []) => pmkit(['requests', 'create', '--title', title, '--issue', issue, ...extra])
const reads = [
  { step: '1', read: ['capabilities'] },
  { step: '1', read: ['discover'] },
  { step: '2', read: ['issues', 'list', ...CANDIDATES] },
  { step: '3', read: ['demand', 'list'], save: 'demand' },
]
// The mentions of an ID by the rule of step 4 (the rule of `issues delete`, lib/mentions.mjs), read from the issue files of the copy so a live run checks it too.
const CANDIDATE_IDS = ['ISS-3F7H', 'ISS-6J0B', 'ISS-4M2S', 'ISS-1V9Z']
const mentions = (repo, id) => CANDIDATE_IDS.filter((other) => other !== id && mentionedIn(id)(repo.file(`.issues/issues/${other}/issue.md`))).sort()

export default [
  {
    // Requests: ISS-6J0B scores 3 + 1 (an important request counts twice) and ISS-3F7H 1. Four candidates and four priorities
    // make one issue a band, so ISS-6J0B gets urgent and ISS-3F7H high, and the two issues with no signal stay as they are.
    command: 'backlog/prioritize-by-demand',
    fixture: 'team',
    async setup({ pmkit }) {
      await request(pmkit, 'ISS-6J0B', 'Upgrade on CI')
      await request(pmkit, 'ISS-6J0B', 'Build is slow')
      await request(pmkit, 'ISS-6J0B', 'Blocked on the old toolchain', ['--important'])
      await request(pmkit, 'ISS-3F7H', 'Empty dashboard confuses new users')
    },
    prompt: '/pmkit:backlog:prioritize-by-demand',
    answers: ['All', 'Yes'],
    steps: [
      ...reads,
      { confirm: 'Step 5' },
      { step: '6', dryRun: update('ISS-6J0B', 'urgent') },
      { step: '6', dryRun: update('ISS-3F7H', 'high') },
      { confirm: 'Step 7' },
      { step: '6', write: update('ISS-6J0B', 'urgent') },
      { step: '6', write: update('ISS-3F7H', 'high') },
      { step: '9', read: ['issues', 'list', ...CANDIDATES] },
    ],
    skip: { '4 issues get': LOCAL, '4 issues list': LOCAL },
    notHit: {},
    expect(repo, saved) {
      assert.equal(repo.issue('ISS-6J0B').priority, 'urgent')
      assert.equal(repo.issue('ISS-3F7H').priority, 'high')
      assert.equal(repo.newEvents('ISS-4M2S').length, 0)
      assert.deepEqual(saved.demand.signals.map((s) => [s.issue.id, s.count, s.important]), [['ISS-6J0B', 3, 1], ['ISS-3F7H', 1, 0]])
    },
  },
  {
    // No request exists, so the command falls back to comments and mentions (step 4). ISS-3F7H has two comments and one mention
    // (ISS-1V9Z), so it scores 3. ISS-4M2S names ISS-6J0BX, which a substring search for ISS-6J0B finds: by substring ISS-6J0B would
    // score 1, share the top band with ISS-3F7H and be raised too. By whole token it scores 0 and keeps its priority. Three
    // priorities can be proposed for four candidates, so the top band holds two issues and ISS-3F7H gets high, the second priority.
    command: 'backlog/prioritize-by-demand',
    fixture: 'team',
    async setup({ pmkit }) {
      for (const text of ['Users keep asking for this.\n', 'Two more customers asked.\n']) await pmkit(['issues', 'comment', 'ISS-3F7H', '--body-file', '-'], { stdin: text })
      await pmkit(['issues', 'update', 'ISS-1V9Z', '--description-file', '-'], { stdin: 'Same cause as ISS-3F7H.\n' })
      await pmkit(['issues', 'update', 'ISS-4M2S', '--description-file', '-'], { stdin: 'Unrelated to ISS-6J0BX.\n' })
      // pmkit's own comments: ISS-4M2S is assigned to fred, so these four are its assignee's plan and progress comments, not demand.
      for (let n = 1; n <= 4; n += 1) await pmkit(['issues', 'comment', 'ISS-4M2S', '--body-file', '-'], { stdin: `Progress ${n}.\n` })
    },
    prompt: '/pmkit:backlog:prioritize-by-demand',
    answers: ['All', 'Yes'],
    steps: [
      ...reads,
      ...CANDIDATE_IDS.map((id) => ({ step: '4', read: ['issues', 'list', '--text', id] })),
      ...['ISS-3F7H', 'ISS-6J0B', 'ISS-4M2S', 'ISS-1V9Z'].map((id) => ({ step: '4', read: ['issues', 'get', id, '--comments'] })),
      { confirm: 'Step 5' },
      { step: '6', dryRun: update('ISS-3F7H', 'high') },
      { confirm: 'Step 7' },
      { step: '6', write: update('ISS-3F7H', 'high') },
      { step: '9', read: ['issues', 'list', ...CANDIDATES] },
    ],
    skip: {},
    notHit: {},
    expect(repo, saved) {
      assert.deepEqual(mentions(repo, 'ISS-3F7H'), ['ISS-1V9Z'])
      assert.deepEqual(mentions(repo, 'ISS-6J0B'), [], 'ISS-6J0BX is not a mention of ISS-6J0B')
      assert.equal(repo.issue('ISS-3F7H').priority, 'high')
      assert.equal(repo.newEvents('ISS-6J0B').length, 0)
      assert.equal(repo.newEvents('ISS-4M2S').length, 0, 'the assignee\'s own comments are not demand')
      assert.deepEqual(saved.demand.signals, [])
    },
  },
  {
    // A failed batch (step 8). ISS-6J0B has two requests and ISS-3F7H one, so they get urgent and high. After the dry runs
    // ISS-3F7H is overwritten with a file that does not parse (a bad merge), so its write fails and the command stops with
    // ISS-6J0B applied, ISS-3F7H failed and nothing retried.
    command: 'backlog/prioritize-by-demand',
    fixture: 'team',
    async setup({ pmkit }) {
      await request(pmkit, 'ISS-6J0B', 'Upgrade on CI')
      await request(pmkit, 'ISS-6J0B', 'Build is slow')
      await request(pmkit, 'ISS-3F7H', 'Empty dashboard confuses new users')
    },
    prompt: '/pmkit:backlog:prioritize-by-demand',
    answers: ['All', 'Yes'],
    steps: [
      ...reads,
      { confirm: 'Step 5' },
      { step: '6', dryRun: update('ISS-6J0B', 'urgent') },
      { step: '6', dryRun: update('ISS-3F7H', 'high') },
      { confirm: 'Step 7' },
      { step: '6', write: update('ISS-6J0B', 'urgent') },
      { step: '6', edit: { file: '.issues/issues/ISS-3F7H/issue.md', content: '<<<<<<< HEAD\nid: ISS-3F7H\n=======\n>>>>>>> other\n' } },
      { step: '6', write: update('ISS-3F7H', 'high'), expectError: 'CONFLICT' },
    ],
    skip: { '4 issues get': LOCAL, '4 issues list': LOCAL, '9 issues list': 'the command stops at step 8 after the failed write' },
    notHit: {},
    expect(repo) {
      assert.equal(repo.issue('ISS-6J0B').priority, 'urgent')
    },
  },
  {
    // The Linear path (demand_signals absent) needs the Linear API, which a child process cannot fake: step 1 fails with AUTH and
    // the command stops before any request. scripts/lib/linear/manifest.test.mjs covers the absent capability.
    command: 'backlog/prioritize-by-demand',
    fixture: 'team',
    git: true,
    async setup({ root }) {
      const file = path.join(root, '.pmkit', 'config.yaml')
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('  system: local\n  path: .issues', '  system: linear\n  scope:\n    workspace: acme'))
    },
    prompt: '/pmkit:backlog:prioritize-by-demand',
    answers: [],
    steps: [{ step: '1', read: ['capabilities'], expectError: 'AUTH', save: 'capabilities' }],
    skip: {
      '1 discover': AUTH, '2 issues list': AUTH, '3 demand list': AUTH, '4 issues get': AUTH, '4 issues list': AUTH,
      '6 issues update': AUTH, '9 issues list': AUTH,
    },
    notHit: { 'Step 5': AUTH, 'Step 7': AUTH },
    expect(repo, saved) {
      assert.equal(saved.capabilities.error.code, 'AUTH')
    },
  },
  {
    // An incomplete read (step 3). A request file with git conflict markers does not parse, so demand list returns it in
    // `problems`. It may belong to a candidate, so the command shows the ranking, asks nothing and writes nothing.
    command: 'backlog/prioritize-by-demand',
    fixture: 'team',
    async setup({ pmkit, root }) {
      await request(pmkit, 'ISS-6J0B', 'Upgrade on CI')
      fs.writeFileSync(path.join(root, '.issues', 'requests', 'REQ-9X9X.md'), '<<<<<<< HEAD\ntitle: Broken\n=======\n>>>>>>> other\n')
    },
    prompt: '/pmkit:backlog:prioritize-by-demand',
    answers: [],
    steps: reads,
    skip: {
      '4 issues get': LOCAL, '4 issues list': LOCAL, '6 issues update': STOPPED, '9 issues list': STOPPED,
    },
    notHit: { 'Step 5': 'an incomplete read asks nothing', 'Step 7': 'an incomplete read writes nothing, so there is no preview to confirm' },
    expect(repo, saved) {
      assert.equal(repo.newEvents('ISS-6J0B').length, 0)
      assert.equal(saved.demand.problems.length, 1)
      assert.equal(saved.demand.signals.length, 1)
    },
  },
  {
    // A demand problem that concerns no candidate (step 3). A request names ISS-ZZZZ, which does not exist, and a customer with no
    // file. Both are `about` problems of an issue that is no candidate and of a customer, so they are warnings: the ranking is
    // complete and ISS-6J0B, the only issue with a request, is written.
    command: 'backlog/prioritize-by-demand',
    fixture: 'team',
    async setup({ pmkit, root }) {
      await request(pmkit, 'ISS-6J0B', 'Upgrade on CI')
      fs.writeFileSync(path.join(root, '.issues', 'requests', 'REQ-8X8X.md'), '---\ntitle: Gone\ncustomer: CUS-4\nstate: accepted\nissue: ISS-ZZZZ\n---\n')
    },
    prompt: '/pmkit:backlog:prioritize-by-demand',
    answers: ['All', 'Yes'],
    steps: [
      ...reads,
      { confirm: 'Step 5' },
      { step: '6', dryRun: update('ISS-6J0B', 'urgent') },
      { confirm: 'Step 7' },
      { step: '6', write: update('ISS-6J0B', 'urgent') },
      { step: '9', read: ['issues', 'list', ...CANDIDATES] },
    ],
    skip: { '4 issues get': LOCAL, '4 issues list': LOCAL },
    notHit: {},
    expect(repo, saved) {
      assert.equal(repo.issue('ISS-6J0B').priority, 'urgent')
      assert.equal(repo.newEvents('ISS-3F7H').length, 0)
      assert.deepEqual(saved.demand.problems.map((problem) => [problem.id, problem.about]).sort(), [['CUS-4', 'customer'], ['ISS-ZZZZ', 'issue']])
      assert.deepEqual(saved.demand.signals.map((signal) => signal.issue.id).sort(), ['ISS-6J0B', 'ISS-ZZZZ'], 'the request on the deleted issue is a signal for no candidate')
    },
  },
  {
    // The cap on issues with no demand (step 5, customer requests). ISS-4M2S has no request and priority urgent; ISS-6J0B has two
    // requests and ISS-3F7H one, so they get urgent and high. The lowest priority proposed to an issue with demand is high, so
    // ISS-4M2S, which would rank above ISS-3F7H, is capped to high. Without the cap ISS-4M2S would keep urgent. ISS-1V9Z has no
    // priority and no demand and stays as it is.
    command: 'backlog/prioritize-by-demand',
    fixture: 'team',
    async setup({ pmkit }) {
      await pmkit(['issues', 'update', 'ISS-4M2S', '--priority', 'urgent'])
      await request(pmkit, 'ISS-6J0B', 'Upgrade on CI')
      await request(pmkit, 'ISS-6J0B', 'Build is slow')
      await request(pmkit, 'ISS-3F7H', 'Empty dashboard confuses new users')
    },
    prompt: '/pmkit:backlog:prioritize-by-demand',
    answers: ['All', 'Yes'],
    steps: [
      ...reads,
      { confirm: 'Step 5' },
      { step: '6', dryRun: update('ISS-6J0B', 'urgent') },
      { step: '6', dryRun: update('ISS-3F7H', 'high') },
      { step: '6', dryRun: update('ISS-4M2S', 'high') },
      { confirm: 'Step 7' },
      { step: '6', write: update('ISS-6J0B', 'urgent') },
      { step: '6', write: update('ISS-3F7H', 'high') },
      { step: '6', write: update('ISS-4M2S', 'high') },
      { step: '9', read: ['issues', 'list', ...CANDIDATES] },
    ],
    skip: { '4 issues get': LOCAL, '4 issues list': LOCAL },
    notHit: {},
    expect(repo) {
      assert.equal(repo.issue('ISS-6J0B').priority, 'urgent')
      assert.equal(repo.issue('ISS-3F7H').priority, 'high')
      assert.equal(repo.issue('ISS-4M2S').priority, 'high', 'an issue with no demand never ranks above one with demand')
      assert.equal(repo.newEvents('ISS-1V9Z').length, 0)
    },
  },
]
