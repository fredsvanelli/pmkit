// /pmkit:backlog:triage on the team fixture, applying all proposals. Setup files three more triage issues, so the
// queue holds four with ISS-1V9Z (Investigate slow login), which stays in triage as the "needs info" case.
//   ACCEPT   ISS-M0GZ, Webhook deliveries are not retried (label webhooks): accept with priority high and labels backend,webhooks.
//   DUP      ISS-Y8KQ, Login is slow after I press submit: a duplicate of ORIGINAL.
//   DECLINE  ISS-DZEF, Rewrite the CLI in Rust: decline with a reason.
//   ORIGINAL ISS-4C74, Login form hangs for ten seconds: stays in backlog.
import assert from 'node:assert/strict'

const ACCEPT = 'ISS-M0GZ'
const DUP = 'ISS-Y8KQ'
const DECLINE = 'ISS-DZEF'
const ORIGINAL = 'ISS-4C74'
const reason = 'pmkit ships Node scripts with no dependencies (ADR 0003), so a Rust rewrite is out of scope.'

const update = ['issues', 'update', ACCEPT, '--priority', 'high', '--label', 'backend,webhooks']
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
    ['Webhook deliveries are not retried', 'bug', 'A failed webhook delivery is dropped and never sent again.\n', 'webhooks'],
    ['Login is slow after I press submit', 'bug', 'The login form takes about ten seconds after I press submit.\n'],
    ['Rewrite the CLI in Rust', 'feature', 'Rewrite the whole CLI in Rust for speed.\n'],
  ]) {
    const made = await create(title, type, text, label)
    await pmkit(['issues', 'move', made.after.id, 'triage'])
  }
  await create('Login form hangs for ten seconds', 'bug', 'The login form hangs for ten seconds after submit.\n')
}

const applyAll = {
  command: 'backlog/triage',
  fixture: 'team',
  setup,
  prompt: '/pmkit:backlog:triage',
  answers: ['Apply all proposals', 'Yes'],
  steps: [
    { step: '1', read: queue, save: 'queueBefore' },
    { step: '2', read: ['discover'] },
    { step: '3', read: ['issues', 'get', 'ISS-1V9Z', '--comments'] },
    { step: '3', read: ['issues', 'list', '--text', 'login'] },
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
    { step: '1', read: queue, save: 'queueAfter' },
  ],
  skip: {},
  notHit: {},
  expect(repo, saved) {
    const ids = (list) => list.issues.map((issue) => issue.id).sort()
    assert.deepEqual(ids(saved.queueBefore), [ACCEPT, DECLINE, DUP, 'ISS-1V9Z'].sort())
    assert.deepEqual(ids(saved.queueAfter), ['ISS-1V9Z'])
    const accepted = repo.issue(ACCEPT)
    assert.equal(accepted.status, 'backlog')
    assert.equal(accepted.priority, 'high')
    assert.deepEqual(accepted.labels, ['backend', 'webhooks'], 'the existing label stays and the accepted one joins it')
    assert.equal(repo.issue(DUP).status, 'canceled')
    assert.deepEqual(repo.issue(DUP).duplicate_of, [ORIGINAL])
    assert.equal(repo.issue(DECLINE).status, 'canceled')
    assert.equal(repo.newEvents(DECLINE).filter((event) => event.op === 'comment').length, 1)
    assert.equal(repo.issue('ISS-1V9Z').status, 'triage')
  },
}

// The user changes the priority of ACCEPT to medium and skips the other three, so they stay in triage.
const oneByOne = {
  command: 'backlog/triage',
  fixture: 'team',
  setup,
  prompt: '/pmkit:backlog:triage',
  answers: ['Go through them one by one', 'Accept with priority medium', 'Skip', 'Skip', 'Skip', 'Yes'],
  steps: [
    { step: '1', read: queue, save: 'queueBefore' },
    { step: '2', read: ['discover'] },
    { step: '3', read: ['issues', 'get', 'ISS-1V9Z', '--comments'] },
    { step: '3', read: ['issues', 'list', '--text', 'login'] },
    { confirm: 'Step 5' },
    { step: '6', dryRun: ['issues', 'update', ACCEPT, '--priority', 'medium', '--label', 'backend,webhooks'] },
    { step: '6', dryRun: accept },
    { confirm: 'Step 7' },
    { step: '6', write: ['issues', 'update', ACCEPT, '--priority', 'medium', '--label', 'backend,webhooks'] },
    { step: '6', write: accept },
    { step: '1', read: queue, save: 'queueAfter' },
  ],
  skip: {
    '6 issues link': 'this path accepts one issue and skips the rest',
    '6 issues comment': 'this path accepts one issue and skips the rest',
  },
  notHit: {},
  expect(repo, saved) {
    const ids = (list) => list.issues.map((issue) => issue.id).sort()
    const accepted = repo.issue(ACCEPT)
    assert.equal(accepted.status, 'backlog')
    assert.equal(accepted.priority, 'medium')
    for (const id of [DUP, DECLINE, 'ISS-1V9Z']) assert.equal(repo.issue(id).status, 'triage', `${id} stays in triage`)
    assert.deepEqual(ids(saved.queueAfter), [DECLINE, DUP, 'ISS-1V9Z'].sort())
    assert.deepEqual(repo.newEvents(DUP), [])
    assert.deepEqual(repo.newEvents(DECLINE), [])
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
