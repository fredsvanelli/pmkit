// E2E test of docs/runbooks/issues-github.md: the real CLI, run as a subprocess, with a fake gh first on PATH.
// The fake (scripts/fake-gh-path.mjs) answers from a fixture file through answerGh (scripts/fake-github-api.mjs). Its `issues` key holds the state of the
// stateful fake GitHub (scripts/fake-github-issues.mjs), and the wrapper writes the fixture back after each call, so the state persists
// between CLI runs. Every call is logged, and no logged call may hold the token.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fakeGithubIssues } from './fake-github-issues.mjs'
import { addBareOrigin } from './fake-gh.mjs'
import { statefulGhOnPath } from './fake-gh-path.mjs'
import { childEnv } from './golden-helpers.mjs'
import { tempDir, userStoreEnv } from './test-helpers.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(SCRIPTS, 'pmkit.mjs')
const TOKEN = `ghp_${'Zx9Q'.repeat(9)}`
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'issues-github.md')
const BRANCH = '1-login-fails-on-safari'

const fakeGhOnPath = statefulGhOnPath

const baseEnv = () => ({ ...childEnv(), ...userStoreEnv().env })

function git(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x.dev', ...args], { cwd, encoding: 'utf8', env: childEnv() })
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

/** Every GitHub issue of the fake, by number, from the saved fixture. */
const githubState = (fake) => JSON.parse(fs.readFileSync(fake.fixtureFile, 'utf8')).issues
const githubIssue = (fake, number) => githubState(fake).issues.find((issue) => issue.number === number)

const SETUP = [
  'init', '--tracker', 'github', '--git-host', 'github', '--host', 'github.com', '--repo', 'acme/widgets', '--project', 'acme/7',
  ...['backlog=Backlog', 'todo=Todo', 'in_progress=In Progress', 'in_review=In Review', 'done=Done', 'canceled=none', 'blocked=none'].flatMap((item) => ['--status', item]),
  ...['priority=issue:Priority', 'estimate=issue:Effort', 'start_date=issue:Start date', 'target_date=issue:Target date'].flatMap((item) => ['--field', item]),
  ...['feature=Feature', 'bug=Bug', 'task=Task', 'chore=none'].flatMap((item) => ['--type-label', item]),
  '--json',
]

/**
 * The state the runbook's "Before you start" describes: a git repository with `main` pushed to a bare origin, a fake GitHub whose head
 * of main is origin/main's, and the config that setup writes. `behind` commits are on origin/main only. The origin is a local folder,
 * so setup takes the host and repository from flags. Returns { root, fake, pmkit }.
 */
const SETUP_NO_PROJECT = [
  'init', '--tracker', 'github', '--git-host', 'github', '--host', 'github.com', '--repo', 'acme/widgets', '--project', 'none',
  ...['triage=none', 'backlog=Backlog', 'in_progress=In progress', 'in_review=In review'].flatMap((item) => ['--status', item]),
  ...['priority=issue:Priority', 'estimate=issue:Effort', 'start_date=issue:Start date', 'target_date=issue:Target date'].flatMap((item) => ['--field', item]),
  ...['feature=none', 'bug=bug', 'task=none', 'chore=none'].flatMap((item) => ['--type-label', item]),
  '--json',
]

// The repository of steps 24 to 26: no Project and no issue field, so the priority and the estimate are labels (PMK-339, ADR 0012).
const SETUP_LABELS = [
  'init', '--tracker', 'github', '--git-host', 'github', '--host', 'github.com', '--repo', 'acme/widgets', '--project', 'none',
  ...['triage=none', 'backlog=none', 'in_progress=none', 'in_review=none'].flatMap((item) => ['--status', item]),
  ...['priority=none', 'estimate=none', 'start_date=none', 'target_date=none'].flatMap((item) => ['--field', item]),
  ...['feature=none', 'bug=bug', 'task=none', 'chore=none'].flatMap((item) => ['--type-label', item]),
  ...['urgent=P0', 'high=P1', 'medium=P2', 'low=none'].flatMap((item) => ['--priority-label', item]),
  ...['1=size: 1', '3=size: 3', '5=size: 5'].flatMap((item) => ['--estimate-label', item]),
  '--json',
]

function runbookRepo({ behind = 0, project = true, valueLabels = false } = {}) {
  const root = tempDir('pmkit-runbook-issues-github-')
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'commit', '--allow-empty', '-qm', 'init')
  addBareOrigin(root, tempDir('pmkit-runbook-origin-'))
  for (let index = 0; index < behind; index += 1) git(root, 'commit', '--allow-empty', '-qm', `c${index}`)
  git(root, 'push', '-q', 'origin', 'main')
  if (behind > 0) git(root, 'reset', '-q', '--hard', `HEAD~${behind}`)
  const github = project ? {} : { project: null, issueTypes: [], labels: ['bug', 'documentation', 'Backlog', 'In progress', 'In review'] }
  if (valueLabels) Object.assign(github, { issueFields: [], labels: ['bug', 'P0', 'P1', 'P2', 'size: 1', 'size: 3', 'size: 5'] })
  const fake = fakeGhOnPath({ meta: null, issues: fakeGithubIssues({ branches: { main: git(root, 'rev-parse', 'refs/remotes/origin/main') }, ...github }).toJSON() })
  const env = { ...baseEnv(), GH_TOKEN: TOKEN, PATH: `${fake.bin}${path.delimiter}${process.env.PATH}` }
  const pmkit = (...args) => {
    const result = spawnSync(process.execPath, [CLI, ...args], { cwd: root, env, encoding: 'utf8' })
    return { code: result.status, stdout: result.stdout, stderr: result.stderr }
  }
  json(pmkit(...(project ? SETUP : valueLabels ? SETUP_LABELS : SETUP_NO_PROJECT)))
  fs.mkdirSync(path.join(root, 'tmp'))
  const files = {
    'title-1.txt': 'Login fails on Safari\n',
    'criteria-1.txt': '- Login works on Safari 17\n- A test covers the Safari login\n',
    'title-2.txt': 'Upgrade the session library\n',
    'title-3.txt': 'Safari users cannot log in\n',
    'comment-1.txt': 'Reproduced on Safari 17.2.\n',
  }
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, 'tmp', name), text)
  return { root, fake, pmkit }
}

function json(result) {
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout)
}
const calls = (fake) => (fs.existsSync(fake.log) ? fs.readFileSync(fake.log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [])
const linkedBranchCalls = (fake) => calls(fake).filter((call) => /mutation PmkitCreateLinkedBranch\(/.test(JSON.parse(call.input).query))

function assertNoToken(fake) {
  const made = calls(fake)
  assert.ok(made.length > 0)
  for (const call of made) {
    assert.deepEqual(call.args.slice(0, 3), ['api', '--hostname', 'github.com'])
    assert.ok(!JSON.stringify(call).includes(TOKEN), 'a gh call holds the token')
  }
}

const pushNote = (from, base, dryRun) => `GitHub creates ${BRANCH} on origin at the head of ${base} there, and ${from} lacks commits of origin/${base} (as of the last fetch), so the push of pr open would be refused. ${dryRun ? `Pass --from origin/${base}` : `Run git fetch origin, then git rebase --onto origin/${base} ${from} ${BRANCH}`}`

test('the runbook names the commands this test runs', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8')
  for (const command of [
    'issues create --title-file tmp/title-1.txt --type bug --criteria-file tmp/criteria-1.txt --json',
    'issues create --title-file tmp/title-2.txt --json',
    'issues create --title-file tmp/title-3.txt --json',
    'issues list --json',
    'issues move 1 todo --json',
    'issues move 1 in_progress --json',
    'issues update 2 --priority high --label bug --json',
    'issues assign 2 me --json',
    'issues assign 2 none --json',
    'issues link 2 1 --kind blocks --json',
    'issues link 2 1 --kind blocks --remove --json',
    'issues get 1 --json',
    'issues list --blocked --json',
    'issues parent 2 1 --json',
    'issues link 3 1 --kind duplicate --json',
    'issues comment 1 --body-file tmp/comment-1.txt --json',
    'issues branch 1 --dry-run --json',
    'issues branch 1 --json',
    'issues branch 1 --from origin/main --json',
    'issues move 1 done --json',
    'issues move 1 in_review --json',
    'issues update 1 --label documentation --json',
    'capabilities --json',
    'issues archive 1 --json',
    'issues get 1 --history --json',
    'issues archive 1 --json',
    'issues list --archived --json',
    'issues unarchive 1 --json',
    pushNote('main', 'main', true),
    `Run git fetch origin, then git rebase --onto origin/main main ${BRANCH}`,
    'Restore the item from the archived items of the Project on GitHub',
    'issues create --title-file tmp/title-1.txt --type bug --priority high --estimate 3 --json',
    'issues update 1 --priority urgent --estimate none --json',
    'label P1 holds a priority; use --priority',
    'priority low has no label in mappings.priority (urgent, high, medium)',
  ]) {
    assert.ok(text.includes(command), command)
  }
})

test('runbook: the issue flows on GitHub Issues, steps 1 to 11 and 13 to 16', () => {
  const { root, fake, pmkit } = runbookRepo()

  // Step 1: three issues, the first a bug with criteria.
  const first = json(pmkit('issues', 'create', '--title-file', 'tmp/title-1.txt', '--type', 'bug', '--criteria-file', 'tmp/criteria-1.txt', '--json'))
  assert.equal(first.before, null)
  assert.equal(first.after.id, '1')
  assert.equal(first.after.title, 'Login fails on Safari')
  assert.equal(first.after.type, 'bug')
  assert.deepEqual(first.after.acceptanceCriteria, [{ text: 'Login works on Safari 17', done: false }, { text: 'A test covers the Safari login', done: false }])
  assert.deepEqual(first.after.status, { name: 'Open', category: 'todo' })
  assert.equal(json(pmkit('issues', 'create', '--title-file', 'tmp/title-2.txt', '--json')).after.id, '2')
  assert.equal(json(pmkit('issues', 'create', '--title-file', 'tmp/title-3.txt', '--json')).after.id, '3')
  assert.equal(githubIssue(fake, 1).title, 'Login fails on Safari')

  // Step 2: the list.
  const listed = json(pmkit('issues', 'list', '--json'))
  assert.deepEqual(listed.issues.map((issue) => issue.id), ['1', '2', '3'])
  assert.ok(listed.issues.every((issue) => issue.status.category === 'todo'))
  assert.equal(listed.hasMore, false)

  // Step 3: todo, then in progress; the issue stays open.
  assert.deepEqual(json(pmkit('issues', 'move', '1', 'todo', '--json')).after.status, { name: 'Todo', category: 'todo' })
  assert.deepEqual(json(pmkit('issues', 'move', '1', 'in_progress', '--json')).after.status, { name: 'In Progress', category: 'in_progress' })
  assert.equal(githubIssue(fake, 1).state, 'OPEN')

  // Step 4: the priority writes P1 to the issue field Priority, and the label bug.
  const updated = json(pmkit('issues', 'update', '2', '--priority', 'high', '--label', 'bug', '--json'))
  assert.equal(updated.after.priority, 'high')
  assert.deepEqual(updated.after.labels, ['bug'])
  assert.deepEqual(githubIssue(fake, 2).fieldValues.IF_1, { optionId: 'O2' })
  assert.deepEqual(githubIssue(fake, 2).labelIds, ['LA_1'])

  // Step 5: me assigns the gh login, none removes every assignee.
  assert.equal(json(pmkit('issues', 'assign', '2', 'me', '--json')).after.assignee, 'octocat')
  assert.deepEqual(githubIssue(fake, 2).assigneeIds, ['U_1'])
  assert.equal(json(pmkit('issues', 'assign', '2', 'none', '--json')).after.assignee, undefined)
  assert.deepEqual(githubIssue(fake, 2).assigneeIds, [])

  // Step 6: a blocker, and the blocked list.
  assert.deepEqual(json(pmkit('issues', 'link', '2', '1', '--kind', 'blocks', '--json')).after.blocks, ['1'])
  const blocked = json(pmkit('issues', 'list', '--blocked', '--json'))
  assert.deepEqual(blocked.issues.map((issue) => [issue.id, issue.blockedBy]), [['1', ['2']]])

  // Step 7: the blocker removed.
  assert.deepEqual(json(pmkit('issues', 'link', '2', '1', '--kind', 'blocks', '--remove', '--json')).after.blocks, [])
  assert.deepEqual(json(pmkit('issues', 'get', '1', '--json')).blockedBy, [])
  assert.deepEqual(githubIssue(fake, 1).blockedByIds, [])

  // Step 8: the parent.
  assert.equal(json(pmkit('issues', 'parent', '2', '1', '--json')).after.parent, '1')

  // Step 9: the duplicate closes as canceled, with the note.
  const duplicate = json(pmkit('issues', 'link', '3', '1', '--kind', 'duplicate', '--json'))
  assert.deepEqual(duplicate.after.duplicateOf, ['1'])
  assert.deepEqual(duplicate.after.status, { name: 'Closed as not planned', category: 'canceled' })
  assert.deepEqual(duplicate.notes, ['GitHub closed 3 as a duplicate of 1'])
  assert.equal(githubIssue(fake, 3).state, 'CLOSED')

  // Step 10: the comment, and the refused reply.
  const comment = json(pmkit('issues', 'comment', '1', '--body-file', 'tmp/comment-1.txt', '--json'))
  assert.equal(comment.issue, '1')
  assert.equal(comment.author, 'octocat')
  assert.equal(comment.body, 'Reproduced on Safari 17.2.')
  const reply = pmkit('issues', 'comment', '1', '--body-file', 'tmp/comment-1.txt', '--reply-to', comment.id, '--json')
  assert.equal(reply.code, 2, reply.stdout + reply.stderr)
  assert.equal(JSON.parse(reply.stdout).error.code, 'NOT_SUPPORTED')

  // Step 11: the dry run writes nothing; the real run links the branch at main's head on GitHub, with no push note.
  const dry = json(pmkit('issues', 'branch', '1', '--dry-run', '--json'))
  assert.equal(dry.branch, BRANCH)
  assert.equal(dry.from, 'main')
  assert.equal(dry.notes, undefined)
  assert.equal(linkedBranchCalls(fake).length, 0)
  assert.deepEqual(githubIssue(fake, 1).linkedBranches, [])
  const head = git(root, 'rev-parse', 'refs/remotes/origin/main')
  const real = json(pmkit('issues', 'branch', '1', '--json'))
  assert.equal(real.after.branch, BRANCH)
  assert.deepEqual(real.linked, { branch: BRANCH, base: 'main' })
  assert.equal(real.notes, undefined)
  assert.equal(linkedBranchCalls(fake).length, 1)
  assert.deepEqual(githubIssue(fake, 1).linkedBranches, [BRANCH])
  assert.equal(githubState(fake).repositories[0].branches[BRANCH], head)
  assert.equal(git(root, 'branch', '--show-current'), BRANCH)
  assert.equal(json(pmkit('issues', 'get', '1', '--json')).branch, BRANCH)

  // Step 13: done closes the issue as completed.
  assert.deepEqual(json(pmkit('issues', 'move', '1', 'done', '--json')).after.status, { name: 'Done', category: 'done' })
  assert.deepEqual([githubIssue(fake, 1).state, githubIssue(fake, 1).stateReason], ['CLOSED', 'COMPLETED'])

  // Step 14: the history, in time order.
  const { history } = json(pmkit('issues', 'get', '1', '--history', '--json'))
  const entries = history.map((entry) => [entry.op, entry.field ?? null, entry.to?.id ?? entry.to])
  for (const expected of [['create', null, '1'], ['update', 'type', 'bug'], ['move', 'status', 'Todo'], ['move', 'status', 'In Progress'], ['move', 'status', 'Done'], ['link', 'blockedBy', '2'], ['unlink', 'blockedBy', '2'], ['link', 'children', '2'], ['comment', null, comment.id]]) {
    assert.ok(entries.some((entry) => JSON.stringify(entry) === JSON.stringify(expected)), `${JSON.stringify(expected)} in ${JSON.stringify(entries)}`)
  }
  assert.deepEqual(history.map((entry) => entry.at), [...history.map((entry) => entry.at)].sort())

  // Step 15: archive hides the issue from the list; --archived lists it with the others.
  const archived = json(pmkit('issues', 'archive', '1', '--json'))
  assert.equal(archived.after.archived, true)
  assert.equal(githubIssue(fake, 1).state, 'CLOSED')
  assert.deepEqual(json(pmkit('issues', 'list', '--json')).issues.map((issue) => issue.id), ['2', '3'])
  assert.deepEqual(json(pmkit('issues', 'list', '--archived', '--json')).issues.map((issue) => [issue.id, issue.archived]), [['1', true], ['2', false], ['3', false]])

  // Step 16: unarchive is not supported and points at the Project.
  const unarchive = pmkit('issues', 'unarchive', '1', '--json')
  assert.equal(unarchive.code, 2)
  assert.deepEqual(JSON.parse(unarchive.stdout).error, {
    code: 'NOT_SUPPORTED',
    message: 'unarchive works on the Local tracker and Linear, not on GitHub',
    nextStep: 'Restore the item from the archived items of the Project on GitHub',
  })

  assertNoToken(fake)
})

test('runbook: a main behind origin/main gets the push note, and --from origin/main avoids it (step 12)', () => {
  const { root, fake, pmkit } = runbookRepo({ behind: 1 })
  json(pmkit('issues', 'create', '--title-file', 'tmp/title-1.txt', '--type', 'bug', '--criteria-file', 'tmp/criteria-1.txt', '--json'))
  const head = git(root, 'rev-parse', 'refs/remotes/origin/main')
  assert.notEqual(git(root, 'rev-parse', 'main'), head)

  const dry = json(pmkit('issues', 'branch', '1', '--dry-run', '--json'))
  assert.ok(dry.notes.includes(pushNote('main', 'main', true)), JSON.stringify(dry.notes))

  const fixed = json(pmkit('issues', 'branch', '1', '--from', 'origin/main', '--json'))
  assert.equal(fixed.from, 'origin/main')
  assert.ok(!(fixed.notes ?? []).some((note) => note.startsWith('GitHub creates')), JSON.stringify(fixed.notes))
  assert.equal(githubState(fake).repositories[0].branches[BRANCH], head)
  assert.deepEqual(githubIssue(fake, 1).linkedBranches, [BRANCH])
  assertNoToken(fake)
})

test('runbook: the real run from a main behind origin/main names the rebase (step 12)', () => {
  const { fake, pmkit } = runbookRepo({ behind: 1 })
  json(pmkit('issues', 'create', '--title-file', 'tmp/title-1.txt', '--json'))
  const real = json(pmkit('issues', 'branch', '1', '--json'))
  assert.ok(real.notes.includes(pushNote('main', 'main', false)), JSON.stringify(real.notes))
  assert.deepEqual(githubIssue(fake, 1).linkedBranches, [BRANCH])
  assertNoToken(fake)
})

test('runbook: the issue flows without a Project, steps 17 to 23', () => {
  const { fake, pmkit } = runbookRepo({ project: false })
  const labels = (number) => githubIssue(fake, number).labelIds.map((id) => githubState(fake).labels.find((label) => label.id === id).name).sort()

  // Step 17: the type is a label.
  const created = json(pmkit('issues', 'create', '--title-file', 'tmp/title-1.txt', '--type', 'bug', '--json')).after
  assert.deepEqual([created.id, created.type, created.labels, created.status], ['1', 'bug', ['bug'], { name: 'Open', category: 'todo' }])
  assert.deepEqual(labels(1), ['bug'])

  // Step 18: moves add the target label, then remove the other status labels.
  assert.deepEqual(json(pmkit('issues', 'move', '1', 'in_progress', '--json')).after.status, { name: 'In progress', category: 'in_progress' })
  const review = json(pmkit('issues', 'move', '1', 'in_review', '--json')).after
  assert.deepEqual([review.status, review.labels], [{ name: 'In review', category: 'in_review' }, ['In review', 'bug']])

  // Step 19: a labels patch keeps the status and type labels, and refuses them.
  const updated = json(pmkit('issues', 'update', '1', '--label', 'documentation', '--json')).after
  assert.deepEqual([updated.labels, updated.status.category], [['In review', 'bug', 'documentation'], 'in_review'])
  const refused = pmkit('issues', 'update', '1', '--label', 'In review', '--json')
  assert.equal(JSON.parse(refused.stdout).error.message, 'label In review holds a status; use pmkit issues move')

  // Step 20: done closes the issue and drops the status label.
  const done = json(pmkit('issues', 'move', '1', 'done', '--json')).after
  assert.deepEqual([done.status, done.labels], [{ name: 'Closed', category: 'done' }, ['bug', 'documentation']])
  assert.deepEqual([githubIssue(fake, 1).state, githubIssue(fake, 1).stateReason], ['CLOSED', 'COMPLETED'])

  // Step 21: the history shows moves, not label updates, for the status labels.
  const { history } = json(pmkit('issues', 'get', '1', '--history', '--json'))
  const changes = history.filter((entry) => entry.op !== 'create').map((entry) => [entry.op, entry.field, entry.from ?? null, entry.to])
  assert.deepEqual(changes.filter(([op, field]) => op === 'move' || field === 'type'), [
    ['update', 'type', null, 'bug'],
    ['move', 'status', 'Open', 'In progress'],
    ['move', 'status', 'In progress', 'In review'],
    ['move', 'status', null, 'Closed'],
  ])
  assert.ok(!changes.some(([, field, from, to]) => field === 'labels' && /In (progress|review)|bug/.test(`${from} ${to}`)))

  // Step 22: the capabilities a Project gives are absent.
  const manifest = json(pmkit('capabilities', '--json'))
  for (const id of ['cycles', 'capacity', 'deliverables', 'status_update']) {
    const entry = manifest.capabilities.find((item) => item.id === id)
    assert.deepEqual([entry.path, entry.enableHint], ['absent', 'Needs a GitHub Project: set tracker.scope.project with /pmkit:setup'])
  }
  assert.equal(manifest.capabilities.find((item) => item.id === 'native_triage').enableHint, 'Map a triage label with /pmkit:setup')
  assert.ok(manifest.warnings.includes('tracker.scope.project is none, so cycles, capacity, deliverables and status_update are absent'))

  // Step 23: archive needs a Project.
  const archive = pmkit('issues', 'archive', '1', '--json')
  assert.equal(archive.code, 2)
  assert.deepEqual(JSON.parse(archive.stdout).error, {
    code: 'NOT_SUPPORTED',
    message: 'acme/widgets has no Project, and GitHub has no archive for an issue outside one',
    nextStep: 'Close it with pmkit issues move 1 canceled, or set tracker.scope.project with /pmkit:setup',
  })
  assertNoToken(fake)
})

test('runbook: priority and estimate as labels without a Project or issue fields, steps 24 to 26', () => {
  const { fake, pmkit } = runbookRepo({ project: false, valueLabels: true })
  const labels = (number) => githubIssue(fake, number).labelIds.map((id) => githubState(fake).labels.find((label) => label.id === id).name).sort()

  // Step 24: create with a priority and an estimate; both are labels.
  const created = json(pmkit('issues', 'create', '--title-file', 'tmp/title-1.txt', '--type', 'bug', '--priority', 'high', '--estimate', '3', '--json')).after
  assert.deepEqual([created.priority, created.estimate, created.labels], ['high', 3, ['P1', 'bug', 'size: 3']])
  assert.deepEqual(labels(1), ['P1', 'bug', 'size: 3'])
  assert.deepEqual(json(pmkit('discover', '--json')).estimate, { unit: 'points', scale: [1, 3, 5] })

  // Step 25: a new priority swaps the label, and --estimate none removes it.
  const updated = json(pmkit('issues', 'update', '1', '--priority', 'urgent', '--estimate', 'none', '--json')).after
  assert.deepEqual([updated.priority, updated.estimate, updated.labels], ['urgent', undefined, ['P0', 'bug']])
  assert.deepEqual(labels(1), ['P0', 'bug'])

  // Step 26: a priority label is not a plain label, and a value with no label is refused.
  assert.equal(JSON.parse(pmkit('issues', 'update', '1', '--label', 'P1', '--json').stdout).error.message, 'label P1 holds a priority; use --priority')
  assert.equal(JSON.parse(pmkit('issues', 'update', '1', '--priority', 'low', '--json').stdout).error.message, 'priority low has no label in mappings.priority (urgent, high, medium)')
})
