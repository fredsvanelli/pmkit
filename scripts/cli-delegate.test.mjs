// PMK-57: `issues delegate` hands an issue to an agent member and comments the instructions for local execution.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { parseDelegation } from './lib/delegation.mjs'
import { hashTree, makeRepo, tempDir } from './test-helpers.mjs'

const ISSUE = 'ISS-5N1R'

function setup({ agent = true } = {}) {
  const root = makeRepo('team')
  if (agent) {
    const file = path.join(root, '.issues', 'config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^members:\n/m, 'members:\n  agent:claude: { name: Claude, availability: 1 }\n'))
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
  assert.match(result.stdout, /the agent runs locally: \/pmkit:issues:work ISS-5N1R with --as agent:claude on every pmkit write/)
  assert.match(fs.readFileSync(path.join(root, '.issues', 'issues', ISSUE, 'issue.md'), 'utf8'), /^assignee: agent:claude$/m)
  const posted = comments()
  assert.equal(posted.length, 1)
  assert.match(posted[0], /Delegated to agent:claude by fred, to run locally\./)
  assert.match(posted[0], /## Instructions\n\nOnly touch the events API\.\n/)
  const events = fs.readFileSync(path.join(root, '.issues', 'issues', ISSUE, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(events.slice(-2).map((event) => [event.op, event.by, event.to?.startsWith?.('2026') ? 'comment file' : event.to]), [['assign', 'fred', 'agent:claude'], ['comment', 'fred', 'comment file']])
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
