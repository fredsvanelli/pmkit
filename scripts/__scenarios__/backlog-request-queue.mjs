// /pmkit:backlog:request-queue on the team fixture. Five entries: three requests worked three ways (.0), the Linear path (.1),
// an incomplete read (.2), a create whose accept fails (.3) and a queue with no open request (.4).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const inputs = path.join(import.meta.dirname, '_inputs')
const AUTH = 'the command stops at step 1 with AUTH, before any request'
const NO_QUEUE = 'the tracker has no request queue, so the command suggests /pmkit:backlog:triage and stops'
const STOPPED = 'the command stops before it writes'
const OPEN = ['issues', 'list', '--category', 'backlog,todo,triage,in_progress,in_review']
const create = ['issues', 'create', '--title-file', path.join(inputs, 'request-queue-title.md'), '--description-file', path.join(inputs, 'request-queue-description.md')]
const customerCreate = ['issues', 'create', '--title-file', path.join(inputs, 'request-queue-title.md'), '--description-file', path.join(inputs, 'request-queue-customer-description.md')]
const emptyTitle = ['issues', 'create', '--title-file', path.join(inputs, 'request-queue-empty-title.md'), '--description-file', path.join(inputs, 'request-queue-description.md')]
const LINEAR_CONFIG = `version: 1
tracker:
  system: linear
  scope:
    workspace: acme
    team: ACME
git_host:
  system: none
write_policy:
  confirm: single_writes
  preview: [bulk, delete, publish_update, move_scope]
mappings:
  status:
    in_review: In Review
    blocked: none
  types:
    feature: Feature
    bug: Bug
    task: none
    chore: none
`
const writeRequest = (root, id, text) => {
  fs.mkdirSync(path.join(root, '.issues', 'requests'), { recursive: true })
  fs.writeFileSync(path.join(root, '.issues', 'requests', `${id}.md`), `---\n${text}\n---\n`)
}
const request = (pmkit, title, extra = []) => pmkit(['requests', 'create', '--title', title, ...extra])
const reads = [{ step: '1', read: ['capabilities'] }, { step: '2', read: ['requests', 'list'], save: 'queue' }, { step: '3', read: OPEN, save: 'open' }]

export default [
  {
    // REQ-M0GZ becomes a new issue, REQ-Y8KQ is linked to ISS-3F7H and REQ-DZEF is declined with a reason.
    command: 'backlog/request-queue',
    fixture: 'team',
    async setup({ pmkit }) {
      await request(pmkit, 'Export the board to CSV', ['--from', 'support', '--important'])
      await request(pmkit, 'The dashboard is empty for new users', ['--from', 'sales'])
      await request(pmkit, 'Add a dark theme', ['--from', 'support'])
    },
    prompt: '/pmkit:backlog:request-queue',
    // The inbox lists REQ-DZEF, REQ-M0GZ and REQ-Y8KQ (the same timestamp, so by ID), and the answers follow that order.
    answers: ['Decline: already planned for next year', 'New issue', 'Link to ISS-3F7H', 'Yes'],
    steps: [
      ...reads,
      { confirm: 'Step 4' },
      { step: '5.3', dryRun: ['requests', 'decline', 'REQ-DZEF', '--reason', 'already planned for next year'] },
      { step: '5.1', dryRun: create },
      { step: '5.2', dryRun: ['requests', 'accept', 'REQ-Y8KQ', 'ISS-3F7H'] },
      { confirm: 'Step 6' },
      { step: '5.3', write: ['requests', 'decline', 'REQ-DZEF', '--reason', 'already planned for next year'] },
      { step: '5.1', write: create },
      { step: '7', dryRun: ['requests', 'accept', 'REQ-M0GZ', 'ISS-M0GZ'] },
      { step: '7', write: ['requests', 'accept', 'REQ-M0GZ', 'ISS-M0GZ'] },
      { step: '5.2', write: ['requests', 'accept', 'REQ-Y8KQ', 'ISS-3F7H'] },
      { step: '8', read: ['requests', 'list'] },
    ],
    skip: {},
    notHit: {},
    expect(repo, saved) {
      assert.deepEqual(saved.queue.requests.map((r) => r.id), ['REQ-DZEF', 'REQ-M0GZ', 'REQ-Y8KQ'])
      assert.equal(repo.issue('ISS-M0GZ').title, 'Export the board to CSV')
      const file = (id) => repo.file(`.issues/requests/${id}.md`)
      assert.match(file('REQ-M0GZ'), /state: accepted\nissue: ISS-M0GZ/)
      assert.match(file('REQ-Y8KQ'), /state: accepted\nissue: ISS-3F7H/)
      assert.match(file('REQ-DZEF'), /state: declined/)
      assert.match(file('REQ-DZEF'), /reason: already planned for next year/)
      assert.equal(repo.newEvents('ISS-3F7H').length, 0, 'linking a request does not touch the issue')
      // ISS-3Q6T has conflict markers, so the match list of step 3 is "not verified": the command warns before the new issue.
      assert.deepEqual(saved.open.problems.map((p) => p.id), ['ISS-3Q6T'])
      assert.ok(!repo.file('.issues/issues/ISS-M0GZ/issue.md').includes('Acme'), 'no customer is guessed')
      assert.match(repo.file('.issues/issues/ISS-M0GZ/issue.md'), /Asked by: support\./)
    },
  },
  {
    // The Linear path (request_queue absent) needs the Linear API, which a child process cannot fake: step 1 fails with AUTH and
    // the command stops before any request. scripts/lib/linear/manifest.test.mjs covers the absent capability.
    command: 'backlog/request-queue',
    fixture: 'team',
    git: true,
    async setup({ root }) {
      const file = path.join(root, '.pmkit', 'config.yaml')
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('  system: local\n  path: .issues', '  system: linear\n  scope:\n    workspace: acme'))
    },
    prompt: '/pmkit:backlog:request-queue',
    answers: [],
    steps: [{ step: '1', read: ['capabilities'], expectError: 'AUTH', save: 'capabilities' }],
    skip: {
      '2 requests list': AUTH, '3 issues list': AUTH, '5.1 issues create': AUTH, '5.2 requests accept': AUTH, '5.3 requests decline': AUTH,
      '7 requests accept': AUTH, '8 requests list': AUTH,
    },
    notHit: { 'Step 4': AUTH, 'Step 6': AUTH },
    expect(repo, saved) {
      assert.equal(saved.capabilities.error.code, 'AUTH')
    },
  },
  {
    // The Linear path with a workspace that answers: request_queue is absent, so the command suggests /pmkit:backlog:triage and
    // stops after step 1, before any request. The AUTH entry above covers the failed step 1.
    command: 'backlog/request-queue',
    fixture: 'team',
    git: true,
    linear: {},
    setup: ({ root }) => fs.writeFileSync(path.join(root, '.pmkit', 'config.yaml'), LINEAR_CONFIG),
    prompt: '/pmkit:backlog:request-queue',
    answers: [],
    steps: [{ step: '1', read: ['capabilities'], save: 'capabilities' }],
    skip: {
      '2 requests list': NO_QUEUE, '3 issues list': NO_QUEUE, '5.1 issues create': NO_QUEUE, '5.2 requests accept': NO_QUEUE, '5.3 requests decline': NO_QUEUE,
      '7 requests accept': NO_QUEUE, '8 requests list': NO_QUEUE,
    },
    notHit: { 'Step 4': NO_QUEUE, 'Step 6': NO_QUEUE },
    expect(repo, saved) {
      assert.equal(saved.capabilities.tracker, 'linear')
      assert.deepEqual(Object.keys(saved), ['capabilities'], 'requests list is not called')
      assert.equal(saved.capabilities.capabilities.find((capability) => capability.id === 'request_queue').path, 'absent')
    },
  },
  {
    // REQ-2X6D names customer CUS-ZZZZ, which has no file, and has no `from`: its new issue keeps the customer ID. REQ-5N1R
    // fails its create dry run (an empty title file): only that request is dropped, it stays open and the other one is worked.
    command: 'backlog/request-queue',
    fixture: 'team',
    setup({ root }) {
      writeRequest(root, 'REQ-2X6D', 'title: Export the board to CSV\ncustomer: CUS-ZZZZ\ncreated: 2026-11-01T10:00:00Z')
      writeRequest(root, 'REQ-5N1R', 'title: Dark theme\ncreated: 2026-11-01T10:00:00Z\nfrom: sales')
    },
    prompt: '/pmkit:backlog:request-queue',
    answers: ['New issue', 'New issue', 'Yes'],
    steps: [
      ...reads,
      { confirm: 'Step 4' },
      { step: '5.1', dryRun: customerCreate },
      { step: '5.1', dryRun: emptyTitle, expectError: 'INVALID_INPUT' },
      { confirm: 'Step 6' },
      { step: '5.1', write: customerCreate },
      { step: '7', dryRun: ['requests', 'accept', 'REQ-2X6D', 'ISS-M0GZ'] },
      { step: '7', write: ['requests', 'accept', 'REQ-2X6D', 'ISS-M0GZ'] },
      { step: '8', read: ['requests', 'list'], save: 'after' },
    ],
    skip: { '5.2 requests accept': 'no request is linked', '5.3 requests decline': 'no request is declined' },
    notHit: {},
    expect(repo, saved) {
      assert.deepEqual(saved.queue.problems.map((p) => [p.id, p.code]), [['REQ-2X6D', 'NOT_FOUND']], 'the customer has no file')
      assert.match(repo.file('.issues/issues/ISS-M0GZ/issue.md'), /Asked by: CUS-ZZZZ\./)
      assert.match(repo.file('.issues/requests/REQ-2X6D.md'), /state: accepted/)
      assert.deepEqual(saved.after.requests.map((r) => r.id), ['REQ-5N1R'], 'the failed request stays open')
    },
  },
  {
    // An incomplete read (step 2). A request file with git conflict markers is in `problems`: the readable request is still
    // shown, the warning is too, and the user leaves it open, so nothing is written.
    command: 'backlog/request-queue',
    fixture: 'team',
    async setup({ pmkit, root }) {
      await request(pmkit, 'Export the board to CSV', ['--from', 'support'])
      fs.writeFileSync(path.join(root, '.issues', 'requests', 'REQ-9X9X.md'), '<<<<<<< HEAD\ntitle: Broken\n=======\n>>>>>>> other\n')
    },
    prompt: '/pmkit:backlog:request-queue',
    answers: ['Leave it open'],
    steps: [...reads, { confirm: 'Step 4' }],
    skip: {
      '5.1 issues create': STOPPED, '5.2 requests accept': STOPPED, '5.3 requests decline': STOPPED, '7 requests accept': STOPPED,
      '8 requests list': STOPPED,
    },
    notHit: { 'Step 6': 'every request stays open, so there is no preview' },
    expect(repo, saved) {
      assert.equal(saved.queue.problems.length, 1)
      assert.deepEqual(saved.queue.requests.map((r) => r.id), ['REQ-M0GZ'])
      assert.equal(repo.newEvents('ISS-3F7H').length, 0)
    },
  },
  {
    // A create whose accept fails (step 7). After the new issue is written, its file is overwritten with a bad merge, so the
    // accept (which reads the issue) cannot run and the request file stays as it was.
    // The command stops with the issue created and the request still open, and reports both IDs.
    command: 'backlog/request-queue',
    fixture: 'team',
    async setup({ pmkit }) {
      await request(pmkit, 'Export the board to CSV', ['--from', 'support'])
    },
    prompt: '/pmkit:backlog:request-queue',
    answers: ['New issue', 'Yes'],
    steps: [
      ...reads,
      { confirm: 'Step 4' },
      { step: '5.1', dryRun: create },
      { confirm: 'Step 6' },
      { step: '5.1', write: create },
      { step: '7', edit: { file: '.issues/issues/ISS-M0GZ/issue.md', content: '<<<<<<< HEAD\nid: ISS-M0GZ\n=======\n>>>>>>> other\n' } },
      { step: '7', dryRun: ['requests', 'accept', 'REQ-M0GZ', 'ISS-M0GZ'], expectError: 'CONFLICT' },
    ],
    skip: { '5.2 requests accept': 'no request is linked', '5.3 requests decline': 'no request is declined', '8 requests list': 'the command stops at step 7' },
    notHit: {},
    expect(repo) {
      assert.ok(repo.newEvents('ISS-M0GZ').some((event) => event.to?.title === 'Export the board to CSV'), 'the issue was created')
      const requestFile = repo.file('.issues/requests/REQ-M0GZ.md')
      assert.match(requestFile, /state: open/, 'the request stays open and is not retried')
      assert.doesNotMatch(requestFile, /state: accepted|issue:/)
    },
  },
  {
    // No open request: the command says so after step 2 and stops.
    command: 'backlog/request-queue',
    fixture: 'team',
    prompt: '/pmkit:backlog:request-queue',
    answers: [],
    steps: [{ step: '1', read: ['capabilities'] }, { step: '2', read: ['requests', 'list'], save: 'queue' }],
    skip: {
      '3 issues list': 'the queue is empty', '5.1 issues create': 'the queue is empty', '5.2 requests accept': 'the queue is empty',
      '5.3 requests decline': 'the queue is empty', '7 requests accept': 'the queue is empty', '8 requests list': 'the queue is empty',
    },
    notHit: { 'Step 4': 'the queue is empty', 'Step 6': 'the queue is empty' },
    expect(repo, saved) {
      assert.deepEqual(saved.queue, { requests: [], problems: [] })
    },
  },
]
