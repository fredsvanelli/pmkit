// PMK-57: `issues delegate` hands an issue to an agent member and comments the instructions for local execution.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { parseDelegation } from './lib/delegation.mjs'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { hashTree, makeRepo, tempDir } from './test-helpers.mjs'

const ISSUE = 'ISS-5N1R'

function setup({ agent = true } = {}) {
  const root = makeRepo('team')
  // The team fixture has agent:claude; a run without agents removes it.
  if (!agent) {
    const file = path.join(root, '.issues', 'config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^ {2}agent:claude: .*\n/m, ''))
  }
  const env = { ...process.env, PMKIT_USER: 'fred', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }
  const delegate = (...args) => run(['issues', 'delegate', ...args], { env, cwd: root })
  const comments = () => {
    const dir = path.join(root, '.issues', 'issues', ISSUE, 'comments')
    return fs.existsSync(dir) ? fs.readdirSync(dir).map((name) => fs.readFileSync(path.join(dir, name), 'utf8')) : []
  }
  return { root, delegate, comments }
}

function instructionsFile(text) {
  const file = path.join(tempDir('pmkit-delegate-'), 'instructions.md')
  fs.writeFileSync(file, text)
  return file
}

test('issues delegate --dry-run shows the assignment and the comment and writes nothing', async () => {
  const { root, delegate } = setup()
  const before = hashTree(root)
  const result = await delegate(ISSUE, 'agent:claude', '--dry-run', '--json')
  assert.equal(result.code, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.before.assignee, 'fred')
  assert.equal(data.after.assignee, 'agent:claude')
  assert.equal(data.run, 'local')
  assert.deepEqual(parseDelegation(data.comment.body), { agent: 'agent:claude', by: 'fred', run: 'local' })
  assert.equal(hashTree(root), before)
})

test('issues delegate assigns the agent and posts the instructions from the file', async () => {
  const { root, delegate, comments } = setup()
  const result = await delegate(ISSUE, 'agent:claude', '--instructions-file', instructionsFile('Only touch the events API.\n'))
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /^ISS-5N1R {2}Paginate the events API$/m)
  assert.match(result.stdout, /assignee: fred → agent:claude/)
  assert.match(result.stdout, /^commented 2026-\S+-fred$/m)
  assert.match(result.stdout, /the agent runs locally: \/pmkit:issues:work ISS-5N1R --as agent:claude$/m)
  assert.match(fs.readFileSync(path.join(root, '.issues', 'issues', ISSUE, 'issue.md'), 'utf8'), /^assignee: agent:claude$/m)
  const posted = comments()
  assert.equal(posted.length, 1)
  assert.match(posted[0], /Delegated to agent:claude by fred, to run locally\./)
  assert.match(posted[0], /## Instructions\n\nOnly touch the events API\.\n/)
  const events = fs.readFileSync(path.join(root, '.issues', 'issues', ISSUE, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(events.slice(-2).map((event) => [event.op, event.by, event.to?.startsWith?.('2026') ? 'comment file' : event.to]), [['assign', 'fred', 'agent:claude'], ['comment', 'fred', 'comment file']])
  assert.equal(events.at(-2).at, events.at(-1).at)
})

test('issues delegate is atomic: a comment that cannot be written leaves the issue unassigned', async () => {
  const { root, delegate } = setup()
  const dir = path.join(root, '.issues', 'issues', ISSUE)
  // A plain file where the comments directory goes makes the comment write fail.
  fs.writeFileSync(path.join(dir, 'comments'), '')
  const before = { issue: fs.readFileSync(path.join(dir, 'issue.md'), 'utf8'), events: fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8') }
  const result = await delegate(ISSUE, 'agent:claude', '--json')
  assert.notEqual(result.code, 0)
  assert.equal(fs.readFileSync(path.join(dir, 'issue.md'), 'utf8'), before.issue)
  assert.equal(fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'), before.events)
})

test('issues delegate puts issue.md back when the events append fails, and says nothing was changed', async () => {
  const { root, delegate, comments } = setup()
  const dir = path.join(root, '.issues', 'issues', ISSUE)
  const events = path.join(dir, 'events.jsonl')
  const before = { issue: fs.readFileSync(path.join(dir, 'issue.md'), 'utf8'), events: fs.readFileSync(events, 'utf8') }
  // issue.md is written before the append, so a read-only events.jsonl fails after issue.md changed.
  fs.chmodSync(events, 0o444)
  try {
    const result = await delegate(ISSUE, 'agent:claude', '--json')
    assert.equal(result.code, 2)
    const error = JSON.parse(result.stdout).error
    assert.equal(error.code, 'CONFLICT', result.stdout)
    assert.match(error.message, /^could not write the delegation of ISS-5N1R: .*EACCES.*; nothing was changed/)
    assert.match(error.nextStep, /writable/)
  } finally {
    fs.chmodSync(events, 0o644)
  }
  assert.equal(fs.readFileSync(path.join(dir, 'issue.md'), 'utf8'), before.issue)
  assert.equal(fs.readFileSync(events, 'utf8'), before.events)
  assert.deepEqual(comments(), [])
})

test('a failed delegation also takes back the drift events it logged, so nothing changed is true', async () => {
  const { root, delegate } = setup()
  const dir = path.join(root, '.issues', 'issues', ISSUE)
  // A hand edit of issue.md makes the write log a drift event first; the blocked comments directory then fails the delegation.
  const file = path.join(dir, 'issue.md')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^priority: medium$/m, 'priority: high'))
  fs.writeFileSync(path.join(dir, 'comments'), '')
  const before = { issue: fs.readFileSync(file, 'utf8'), events: fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8') }
  const result = await delegate(ISSUE, 'agent:claude', '--json')
  assert.equal(result.code, 2)
  assert.match(JSON.parse(result.stdout).error.message, /nothing was changed/)
  assert.equal(fs.readFileSync(file, 'utf8'), before.issue)
  assert.equal(fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'), before.events)
})

test('a comment that cannot be removed during the rollback keeps the original error and is named', () => {
  const root = makeRepo('team')
  const dir = path.join(root, '.issues', 'issues', ISSUE)
  const events = path.join(dir, 'events.jsonl')
  const original = fs.readFileSync(path.join(dir, 'issue.md'), 'utf8')
  const tracker = createLocalTracker(root, { now: () => new Date('2026-10-23T12:00:00Z') })
  const rmSync = fs.rmSync
  fs.chmodSync(events, 0o444)
  fs.rmSync = (target, ...rest) => {
    if (String(target).includes(`${path.sep}comments${path.sep}`)) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
    return rmSync(target, ...rest)
  }
  try {
    assert.throws(() => tracker.delegate(ISSUE, 'agent:claude', 'Do it.', 'fred'), (error) => {
      assert.equal(error.code, 'CONFLICT')
      assert.match(error.message, /EACCES/)
      assert.match(error.message, /could not be put back: the delegation comment/)
      assert.ok(error.details.written.includes('comment'), JSON.stringify(error.details))
      return true
    })
  } finally {
    fs.rmSync = rmSync
    fs.chmodSync(events, 0o644)
  }
  assert.equal(fs.readFileSync(path.join(dir, 'issue.md'), 'utf8'), original)
})

test('issues delegate refuses a person and an unknown agent and writes nothing', async () => {
  const { root, delegate } = setup()
  const before = hashTree(root)
  for (const who of ['ana', 'agent:nobody']) {
    const result = await delegate(ISSUE, who, '--json')
    assert.equal(result.code, 2, result.stdout)
    assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT', who)
  }
  const person = JSON.parse((await delegate(ISSUE, 'ana', '--json')).stdout).error
  assert.equal(person.nextStep, 'Use one of: agent:claude')
  const unknown = JSON.parse((await delegate(ISSUE, 'agent:nobody', '--json')).stdout).error
  assert.equal(unknown.message, 'agent "agent:nobody" is not a member')
  assert.equal(unknown.nextStep, 'Use one of: agent:claude')
  assert.equal(hashTree(root), before)
})

test('without an agent member the refusal points to /pmkit:setup', async () => {
  const { delegate } = setup({ agent: false })
  const error = JSON.parse((await delegate(ISSUE, 'claude', '--json')).stdout).error
  assert.equal(error.code, 'INVALID_INPUT')
  assert.equal(error.nextStep, 'Add an agent member such as agent:claude with /pmkit:setup')
})

test('issues delegate needs an issue and an agent', async () => {
  const { delegate } = setup()
  const result = await delegate(ISSUE, '--json')
  assert.equal(result.code, 2)
  assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
})
