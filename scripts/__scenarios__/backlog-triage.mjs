// /pmkit:backlog:triage on the team fixture. Setup files three more triage issues and one backlog issue, so the
// queue holds four. Each proposal follows from the rules of step 3 on this data:
//   DUP       ISS-1V9Z, Investigate slow login ("Some users wait ten seconds after submitting the login form"):
//             the search for "login" finds ORIGINAL, which reports the same symptom. ORIGINAL is outside triage,
//             so the keep-one rule keeps it and ISS-1V9Z is the duplicate.
//   ACCEPT    ISS-M0GZ, Invoice PDF shows the wrong currency (label billing): accept with priority high and labels
//             backend,billing. The search for "invoice" finds ISS-9T2M (rounding), ISS-2X6D and ISS-4M2S (the
//             CSV export), none about the currency, and "pdf" and "currency" find only the issue itself.
//   DECLINE   ISS-Y8KQ, Rewrite the CLI in Rust: its comment says the CLI stays in Node, so decline with that
//             reason. The searches for "rust" and "cli" find only the issue itself.
//   NEEDS     ISS-DZEF, It is broken: the text names no feature and no symptom, so no proposal; it stays in triage.
//             The search for "broken" finds only the issue itself.
//   ORIGINAL  ISS-4C74, Login form hangs for ten seconds: stays in backlog.
// The expect functions check the tracker, not `saved`, so the live suite runs them to the end.
import assert from 'node:assert/strict'

const DUP = 'ISS-1V9Z'
const ACCEPT = 'ISS-M0GZ'
const DECLINE = 'ISS-Y8KQ'
const NEEDS_INFO = 'ISS-DZEF'
const ORIGINAL = 'ISS-4C74'
const decision = 'We keep the CLI in Node so it runs with no install step. A rewrite in another language is out of scope.\n'
const reason = 'The team keeps the CLI in Node so it runs with no install step, so a Rust rewrite is out of scope.'

const update = ['issues', 'update', ACCEPT, '--priority', 'high', '--label', 'backend,billing']
const accept = ['issues', 'move', ACCEPT, 'backlog']
const link = ['issues', 'link', DUP, ORIGINAL, '--kind', 'duplicate']
const cancelDup = ['issues', 'move', DUP, 'canceled']
const cancelDecline = ['issues', 'move', DECLINE, 'canceled']
const comment = ['issues', 'comment', DECLINE, '--body-file', '-']
const queue = ['issues', 'list', '--category', 'triage']

async function setup({ pmkit }) {
  const create = async (title, type, text, label) => {
    const args = ['issues', 'create', '--title', title, '--type', type, '--description-file', '-']
    if (label) args.push('--label', label)
    return pmkit(args, { stdin: text })
  }
  // The first three go to triage. The fourth stays in backlog (the fixture's default_status) as the original.
  for (const [title, type, text, label] of [
    ['Invoice PDF shows the wrong currency', 'bug', 'Customers billed in euros get a PDF invoice that prints the amounts in dollars.\n', 'billing'],
    ['Rewrite the CLI in Rust', 'feature', 'Rewrite the whole CLI in Rust for speed.\n'],
    ['It is broken', 'bug', 'It is broken.\n'],
  ]) {
    const made = await create(title, type, text, label)
    await pmkit(['issues', 'move', made.after.id, 'triage'])
  }
  await create('Login form hangs for ten seconds', 'bug', 'The login form hangs for ten seconds after submit.\n')
  await pmkit(['issues', 'comment', DECLINE, '--body-file', '-'], { stdin: decision })
}

// Step 3 in queue order (oldest first, then by ID): one issues get per issue, then one search per key word of its title.
const proposals = [
  [DUP, ['slow', 'login']],
  [NEEDS_INFO, ['broken']],
  [ACCEPT, ['invoice', 'pdf', 'currency']],
  [DECLINE, ['rust', 'cli']],
].flatMap(([id, words]) => [
  { step: '3', read: ['issues', 'get', id, '--comments'] },
  ...words.map((word) => ({ step: '3', read: ['issues', 'list', '--text', word] })),
])

const applyAll = {
  command: 'backlog/triage',
  fixture: 'team',
  setup,
  prompt: '/pmkit:backlog:triage',
  answers: ['Apply all proposals', 'Yes'],
  steps: [
    { step: '1', read: queue },
    { step: '2', read: ['discover'] },
    ...proposals,
    { confirm: 'Step 5' },
    { step: '6', dryRun: update },
    { step: '6', dryRun: accept },
    { step: '6', dryRun: link },
    { step: '6', dryRun: cancelDup },
    { step: '6', dryRun: cancelDecline },
    { step: '6', dryRun: comment, stdin: reason },
    { confirm: 'Step 7' },
    { step: '6', write: update },
    { step: '6', write: accept },
    { step: '6', write: link },
    { step: '6', write: cancelDup },
    { step: '6', write: cancelDecline },
    { step: '6', write: comment, stdin: reason },
    { step: '1', read: queue },
  ],
  skip: {},
  notHit: {},
  expect(repo) {
    const accepted = repo.issue(ACCEPT)
    assert.equal(accepted.status, 'backlog')
    assert.equal(accepted.priority, 'high')
    assert.deepEqual(accepted.labels, ['backend', 'billing'], 'the existing label stays and the accepted one joins it')
    assert.equal(repo.issue(DUP).status, 'canceled')
    assert.deepEqual(repo.issue(DUP).duplicate_of, [ORIGINAL])
    assert.equal(repo.issue(ORIGINAL).status, 'backlog', 'the kept original is not canceled')
    assert.equal(repo.issue(DECLINE).status, 'canceled')
    assert.equal(repo.newEvents(DECLINE).filter((event) => event.op === 'comment').length, 1)
    assert.equal(repo.issue(NEEDS_INFO).status, 'triage')
    assert.deepEqual(repo.newEvents(NEEDS_INFO), [])
  },
}

// In queue order the user skips DUP and NEEDS_INFO, accepts ACCEPT with priority medium and skips DECLINE, so three
// stay in triage.
const oneByOne = {
  command: 'backlog/triage',
  fixture: 'team',
  setup,
  prompt: '/pmkit:backlog:triage',
  answers: ['Go through them one by one', 'Skip', 'Skip', 'Accept with priority medium', 'Skip', 'Yes'],
  steps: [
    { step: '1', read: queue },
    { step: '2', read: ['discover'] },
    ...proposals,
    { confirm: 'Step 5' },
    { step: '6', dryRun: ['issues', 'update', ACCEPT, '--priority', 'medium', '--label', 'backend,billing'] },
    { step: '6', dryRun: accept },
    { confirm: 'Step 7' },
    { step: '6', write: ['issues', 'update', ACCEPT, '--priority', 'medium', '--label', 'backend,billing'] },
    { step: '6', write: accept },
    { step: '1', read: queue },
  ],
  skip: {
    '6 issues link': 'this path accepts one issue and skips the rest',
    '6 issues comment': 'this path accepts one issue and skips the rest',
  },
  notHit: {},
  expect(repo) {
    const accepted = repo.issue(ACCEPT)
    assert.equal(accepted.status, 'backlog')
    assert.equal(accepted.priority, 'medium')
    for (const id of [DUP, DECLINE, NEEDS_INFO]) {
      assert.equal(repo.issue(id).status, 'triage', `${id} stays in triage`)
      assert.deepEqual(repo.newEvents(id), [], `${id} is not changed`)
    }
  },
}

// The basic fixture has no issue in triage, so the command stops after step 1. Rule 8 fails any write on this entry.
const emptyQueue = {
  command: 'backlog/triage',
  fixture: 'basic',
  prompt: '/pmkit:backlog:triage',
  answers: [],
  steps: [{ step: '1', read: queue }],
  skip: Object.fromEntries(
    ['2 discover', '3 issues get', '3 issues list', '6 issues update', '6 issues move', '6 issues link', '6 issues comment']
      .map((key) => [key, 'the queue is empty, so the command stops after step 1']),
  ),
  notHit: {
    'Step 5': 'the queue is empty, so the command stops after step 1',
    'Step 7': 'the queue is empty, so the command stops after step 1',
  },
}

export default [applyAll, oneByOne, emptyQueue]
