// E2E test of docs/runbooks/epic-move.md: the real CLI, run as a subprocess, on a Local tracker.
// The approval of /pmkit:issues:move cannot run in a test, so the test runs the CLI calls the command makes: the dry run, then the
// real run, on an epic with one open issue and one done issue. The warning goes to the standard error, so the test reads it there.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { childEnv } from './golden-helpers.mjs'
import { hashTree, makeRepo, tempDir } from './test-helpers.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(SCRIPTS, 'pmkit.mjs')
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'epic-move.md')

function pmkit(root, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: root, env: childEnv(), encoding: 'utf8' })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

const json = (result) => {
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout)
}

const failure = (result) => {
  assert.equal(result.code, 2, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout).error
}

/** Writes `text` to a new file outside the repository, as the command writes its temporary files, and returns the path. */
function tempFile(name, text) {
  const file = path.join(tempDir('pmkit-epic-move-tmp-'), name)
  fs.writeFileSync(file, text)
  return file
}

/** The state the runbook's "Before you start" describes: an epic with one open issue and one done issue. */
function runbookRepo() {
  const root = makeRepo('basic')
  const epic = json(pmkit(root, ['epic', 'create', '--title-file', tempFile('epic-title.txt', 'Release 2'), '--json'])).after.id
  const issue = (name, title) => json(pmkit(root, ['issues', 'create', '--title-file', tempFile(name, title), '--parent', epic, '--json'])).after.id
  const open = issue('title-open.txt', 'Write the notes')
  const done = issue('title-done.txt', 'Tag the build')
  json(pmkit(root, ['issues', 'move', done, 'done', '--json']))
  return { root, epic, open, done, tracker: path.join(root, '.issues') }
}

const warning = (epic, ...issues) => `warning: ${epic} still has open issues: ${issues.join(', ')}\n`

test('the runbook names every call the test runs', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8')
  for (const call of [
    'epic create --title-file tmp/epic-title.txt --json',
    'issues create --title-file tmp/title-open.txt --parent <epic-id> --json',
    'issues create --title-file tmp/title-done.txt --parent <epic-id> --json',
    'issues move <done-issue-id> done --json',
    'epic move <epic-id> done --dry-run --json',
    'epic move <epic-id> done --json',
    'epic get <epic-id> --json',
    'epic list --json',
    'epic move <epic-id> done --status done --json',
    'epic move <epic-id> canceled --json',
    'epic move EPC-ZZZZ done --json',
    'epic move <epic-id> later --json',
    'epic move <epic-id> todo --status nope --json',
    'issues get <epic-id> --json',
    'warning: <epic-id> still has open issues: <open-issue-id>',
    '.issues/epics/<epic-id>/events.jsonl',
    'epic <epic-id> is already in done',
    'epic <epic-id> is already in status done',
    'epic EPC-ZZZZ does not exist',
    'category must be one of triage, backlog, todo, in_progress, in_review, done, canceled',
    'status nope is not in category todo',
    'issue <epic-id> does not exist',
  ]) {
    assert.ok(text.includes(call), call)
  }
})

test('runbook: move an epic on a Local tracker, steps 1 to 9', () => {
  const { root, epic, open, done, tracker } = runbookRepo()
  const events = path.join(tracker, 'epics', epic, 'events.jsonl')
  const lastEvent = () => JSON.parse(fs.readFileSync(events, 'utf8').trim().split('\n').at(-1))

  // Step 1: the dry run shows the move and the warning, and writes nothing. The done issue is not in the warning.
  const hash = hashTree(tracker, ['.cache'])
  const dry = pmkit(root, ['epic', 'move', epic, 'done', '--dry-run', '--json'])
  const preview = json(dry)
  assert.deepEqual(preview.before.status, { name: 'backlog', category: 'backlog' })
  assert.deepEqual(preview.after.status, { name: 'done', category: 'done' })
  assert.equal(dry.stderr, warning(epic, open))
  assert.ok(!dry.stderr.includes(done))
  assert.equal(hashTree(tracker, ['.cache']), hash, 'the dry run wrote nothing')

  // Step 2: the real run moves the epic, and the warning does not block it. epic get, epic list and the event log show the move.
  const moved = pmkit(root, ['epic', 'move', epic, 'done', '--json'])
  const result = json(moved)
  assert.deepEqual([result.before, result.after], [preview.before, preview.after])
  assert.equal(moved.stderr, warning(epic, open))
  assert.deepEqual(json(pmkit(root, ['epic', 'get', epic, '--json'])).status, { name: 'done', category: 'done' })
  assert.deepEqual(json(pmkit(root, ['epic', 'list', '--json'])).find((entry) => entry.id === epic).status, { name: 'done', category: 'done' })
  const event = lastEvent()
  assert.deepEqual({ ...event, at: undefined }, { at: undefined, by: 'fred', op: 'move', field: 'status', from: 'backlog', to: 'done' })
  assert.match(event.at, /^\d{4}-\d{2}-\d{2}T/)

  // Steps 3 and 4: the category and the status the epic already has are refused, with no warning and no write.
  const settled = hashTree(tracker, ['.cache'])
  const again = pmkit(root, ['epic', 'move', epic, 'done', '--json'])
  assert.deepEqual([failure(again).code, failure(again).message], ['INVALID_INPUT', `epic ${epic} is already in done`])
  assert.equal(again.stderr, '')
  const sameStatus = pmkit(root, ['epic', 'move', epic, 'done', '--status', 'done', '--json'])
  assert.deepEqual([failure(sameStatus).code, failure(sameStatus).message], ['INVALID_INPUT', `epic ${epic} is already in status done`])
  assert.equal(hashTree(tracker, ['.cache']), settled)

  // Step 5: a move to canceled warns too.
  const canceled = pmkit(root, ['epic', 'move', epic, 'canceled', '--json'])
  assert.deepEqual(json(canceled).after.status, { name: 'canceled', category: 'canceled' })
  assert.equal(canceled.stderr, warning(epic, open))
  assert.deepEqual([lastEvent().from, lastEvent().to], ['done', 'canceled'])

  // Steps 6 to 8: the refusals write nothing.
  const refused = hashTree(tracker, ['.cache'])
  const unknown = failure(pmkit(root, ['epic', 'move', 'EPC-ZZZZ', 'done', '--json']))
  assert.deepEqual([unknown.code, unknown.message, unknown.nextStep], ['NOT_FOUND', 'epic EPC-ZZZZ does not exist', 'pmkit epic list'])
  const category = failure(pmkit(root, ['epic', 'move', epic, 'later', '--json']))
  assert.deepEqual([category.code, category.message], ['INVALID_INPUT', 'category must be one of triage, backlog, todo, in_progress, in_review, done, canceled'])
  const status = failure(pmkit(root, ['epic', 'move', epic, 'todo', '--status', 'nope', '--json']))
  assert.deepEqual([status.code, status.message, status.nextStep], ['INVALID_INPUT', 'status nope is not in category todo', 'Use one of: todo'])

  // Step 9: the calls of commands/issues/move.md for an epic ID. issues get does not find it, which is the fallback condition, and epic get does.
  const asIssue = failure(pmkit(root, ['issues', 'get', epic, '--json']))
  assert.deepEqual([asIssue.code, asIssue.message], ['NOT_FOUND', `issue ${epic} does not exist`])
  assert.equal(hashTree(tracker, ['.cache']), refused)
  assert.equal(json(pmkit(root, ['epic', 'get', epic, '--json'])).id, epic)
})
