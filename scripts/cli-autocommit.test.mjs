import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeRepo } from './test-helpers.mjs'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pmkit.mjs')

function baseEnv() {
  return {
    ...process.env,
    PMKIT_USER: 'fred',
    PMKIT_NOW: '2026-10-23T12:00:00Z',
    PMKIT_SEED: '1',
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
  }
}

function run(cwd, args, { env = {}, input } = {}) {
  const merged = { ...baseEnv(), ...env }
  for (const key of Object.keys(merged)) if (merged[key] === null) delete merged[key]
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, env: merged, input, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' } })

/** A git repo with the fixture committed and auto_commit set; the folder is removed afterwards. */
function withRepo(fixture, { autoCommit }, fn) {
  const root = makeRepo(fixture)
  try {
    const file = path.join(root, '.issues/config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^auto_commit: .*$/m, `auto_commit: ${autoCommit}`))
    git(root, 'init', '-q')
    git(root, 'config', 'user.name', 'Test')
    git(root, 'config', 'user.email', 'test@example.com')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'init')
    fn(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

const commits = (root) => Number(git(root, 'rev-list', '--count', 'HEAD').stdout.trim())
const committedFiles = (root) => git(root, 'show', '--name-only', '--format=', 'HEAD').stdout.trim().split('\n').filter(Boolean).sort()
const status = (root, ...paths) => git(root, 'status', '--porcelain', '--untracked-files=all', '--', ...paths).stdout.split('\n').filter(Boolean).sort()

test('commits only the files the write changed', () => {
  withRepo('team', { autoCommit: true }, (root) => {
    const other = path.join(root, '.issues/issues/ISS-1V9Z/issue.md')
    fs.writeFileSync(other, fs.readFileSync(other, 'utf8').replace('Investigate slow login', 'Investigate slow login (hand edit)'))
    fs.writeFileSync(path.join(root, '.issues/docs/draft.md'), 'draft\n')
    fs.writeFileSync(path.join(root, '.issues/docs/staged.md'), 'staged\n')
    fs.writeFileSync(path.join(root, 'outside.txt'), 'outside\n')
    git(root, 'add', '.issues/docs/staged.md', 'outside.txt')
    const before = commits(root)
    // ISS-0G5E is assigned to ana in the fixture, so fred is a real change.
    const result = run(root, ['issues', 'assign', 'ISS-0G5E', 'fred'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(commits(root), before + 1)
    assert.equal(git(root, 'log', '-1', '--format=%s').stdout.trim(), 'pmkit: issues assign ISS-0G5E')
    assert.deepEqual(committedFiles(root), ['.issues/issues/ISS-0G5E/events.jsonl', '.issues/issues/ISS-0G5E/issue.md'])
    assert.deepEqual(status(root), [
      ' M .issues/issues/ISS-1V9Z/issue.md',
      '?? .issues/docs/draft.md',
      'A  .issues/docs/staged.md',
      'A  outside.txt',
    ].sort())
  })
})

test('one commit for a write that touches several files', () => {
  withRepo('team', { autoCommit: true }, (root) => {
    const before = commits(root)
    const linked = run(root, ['issues', 'link', 'ISS-0G5E', 'ISS-1V9Z', '--kind', 'related'])
    assert.equal(linked.status, 0, linked.stderr)
    assert.equal(commits(root), before + 1)
    assert.deepEqual(committedFiles(root), [
      '.issues/issues/ISS-0G5E/events.jsonl', '.issues/issues/ISS-0G5E/issue.md',
      '.issues/issues/ISS-1V9Z/events.jsonl', '.issues/issues/ISS-1V9Z/issue.md',
    ])
    assert.deepEqual(status(root, '.issues'), [])

    const added = run(root, ['cycle', 'add', 'ISS-1V9Z', 'ISS-3F7H', '--to', '2026-10-12'])
    assert.equal(added.status, 0, added.stderr)
    assert.equal(commits(root), before + 2)
    assert.deepEqual(committedFiles(root), [
      '.issues/issues/ISS-1V9Z/events.jsonl', '.issues/issues/ISS-1V9Z/issue.md',
      '.issues/issues/ISS-3F7H/events.jsonl', '.issues/issues/ISS-3F7H/issue.md',
    ])
    assert.deepEqual(status(root, '.issues'), [])
  })
})

test('a write that changes nothing does not commit', () => {
  withRepo('team', { autoCommit: true }, (root) => {
    const head = git(root, 'rev-parse', 'HEAD').stdout.trim()
    const result = run(root, ['issues', 'assign', 'ISS-0G5E', 'ana'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(git(root, 'rev-parse', 'HEAD').stdout.trim(), head)
    assert.deepEqual(status(root), [])
  })
})

test('docs create with brackets commits that file only', () => {
  withRepo('team', { autoCommit: true }, (root) => {
    fs.mkdirSync(path.join(root, '.issues/docs/notes'), { recursive: true })
    fs.writeFileSync(path.join(root, '.issues/docs/notes/a.md'), 'other\n')
    const before = commits(root)
    const result = run(root, ['docs', 'create', 'notes/[x].md', '--body-file', '-'], { input: 'hello\n' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(commits(root), before + 1)
    assert.deepEqual(committedFiles(root), ['.issues/docs/notes/[x].md'])
    assert.deepEqual(status(root), ['?? .issues/docs/notes/a.md'])
  })
})

// Every write command that returns `commit`, except `pr *` (cli-pr.test.mjs), `migrate` (migrations.test.mjs) and `issues branch` (own tests below).
// `expectedMessage` is a string, or a RegExp when the id comes from the random generator.
const WRITES = [
  { args: ['issues', 'create', '--title', 'New'], expectedMessage: /^pmkit: issues create ISS-[0-9A-Z]{4}$/ },
  { args: ['issues', 'update', 'ISS-3F7H', '--priority', 'urgent'], expectedMessage: 'pmkit: issues update ISS-3F7H' },
  { args: ['issues', 'move', 'ISS-3F7H', 'done'], expectedMessage: 'pmkit: issues move ISS-3F7H' },
  { args: ['issues', 'assign', 'ISS-0G5E', 'fred'], expectedMessage: 'pmkit: issues assign ISS-0G5E' },
  { args: ['issues', 'parent', 'ISS-3F7H', 'EPC-2M9D'], expectedMessage: 'pmkit: issues parent ISS-3F7H' },
  { args: ['issues', 'archive', 'ISS-3F7H'], expectedMessage: 'pmkit: issues archive ISS-3F7H' },
  { args: ['issues', 'link', 'ISS-3F7H', 'ISS-4M2S', '--kind', 'related'], expectedMessage: 'pmkit: issues link ISS-3F7H' },
  { args: ['issues', 'comment', 'ISS-3F7H', '--body-file', '-'], input: 'A comment.\n', expectedMessage: 'pmkit: issues comment ISS-3F7H' },
  { args: ['issues', 'log-time', 'ISS-3F7H', '30'], expectedMessage: 'pmkit: issues log-time ISS-3F7H' },
  { args: ['cycle', 'open', '--start', '2026-11-02'], expectedMessage: 'pmkit: cycle open 2026-11-02' },
  { args: ['cycle', 'capacity', '2026-10-12', '--set', 'fred=3'], expectedMessage: 'pmkit: cycle capacity 2026-10-12' },
  { args: ['cycle', 'close', '2026-10-12'], expectedMessage: 'pmkit: cycle close 2026-10-12' },
  { args: ['cycle', 'add', 'ISS-3F7H', '--to', '2026-10-12'], expectedMessage: 'pmkit: cycle add 2026-10-12' },
  { args: ['epic', 'create', '--title', 'E'], expectedMessage: /^pmkit: epic create EPC-[0-9A-Z]{4}$/ },
  { args: ['epic', 'update-status', 'EPC-2M9D', '--health', 'at_risk', '--body-file', '-'], input: 'Late on retries.\n', expectedMessage: 'pmkit: epic update-status EPC-2M9D' },
  { args: ['docs', 'create', 'notes.md', '--body-file', '-'], input: 'hello\n', expectedMessage: 'pmkit: docs create notes.md' },
  { args: ['views', 'save', 'mine', '--category', 'done'], expectedMessage: 'pmkit: views save mine' },
  { args: ['goal', 'create', '--title', 'G'], expectedMessage: /^pmkit: goal create GOAL-[0-9A-Z]{4}$/ },
  { args: ['customers', 'create', '--name', 'Acme'], expectedMessage: /^pmkit: customers create CUS-[0-9A-Z]{4}$/ },
  { args: ['requests', 'create', '--title', 'R'], expectedMessage: /^pmkit: requests create REQ-[0-9A-Z]{4}$/ },
]

const head = (root) => git(root, 'rev-parse', 'HEAD').stdout.trim()
const subject = (root) => git(root, 'log', '-1', '--format=%s').stdout.trim()
const label = ({ args }) => args.slice(0, 2).join(' ')

for (const write of WRITES) {
  test(`auto_commit true: ${label(write)} makes one commit, tracker clean afterwards`, () => {
    withRepo('team', { autoCommit: true }, (root) => {
      const before = commits(root)
      const result = run(root, write.args, { input: write.input })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(commits(root), before + 1)
      if (write.expectedMessage instanceof RegExp) assert.match(subject(root), write.expectedMessage)
      else assert.equal(subject(root), write.expectedMessage)
      assert.deepEqual(status(root, '.issues'), [])
    })
  })

  test(`auto_commit false: ${label(write)} does not commit and leaves files uncommitted`, () => {
    withRepo('team', { autoCommit: false }, (root) => {
      const before = head(root)
      const result = run(root, write.args, { input: write.input })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(head(root), before)
      assert.notDeepEqual(status(root, '.issues'), [])
    })
  })

  test(`--dry-run with auto_commit true: ${label(write)} does not commit and writes nothing`, () => {
    withRepo('team', { autoCommit: true }, (root) => {
      const before = head(root)
      const result = run(root, [...write.args, '--dry-run'], { input: write.input })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(head(root), before)
      assert.deepEqual(status(root), [])
    })
  })
}

test('auto_commit defaults to false: a config without the key does not commit', () => {
  withRepo('team', { autoCommit: true }, (root) => {
    const file = path.join(root, '.issues/config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^auto_commit: .*\n/m, ''))
    git(root, 'commit', '-qam', 'drop auto_commit')
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /auto_commit/)
    const before = head(root)
    const result = run(root, ['issues', 'assign', 'ISS-0G5E', 'fred'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(head(root), before)
    assert.notDeepEqual(status(root, '.issues'), [])
  })
})

// `issues branch` needs a git host in the project config; it switches to the new branch before it writes.
function withBranchRepo(autoCommit, fn) {
  withRepo('team', { autoCommit }, (root) => {
    const file = path.join(root, '.pmkit/config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('system: none', 'system: github\n  default_branch: main'))
    git(root, 'commit', '-qam', 'enable github')
    fn(root, git(root, 'branch', '--show-current').stdout.trim())
  })
}

test('auto_commit true: issues branch makes one commit on the new branch', () => {
  withBranchRepo(true, (root, start) => {
    const before = commits(root)
    const result = run(root, ['issues', 'branch', 'ISS-2X6D', '--from', start, '--json'])
    assert.equal(result.status, 0, result.stderr)
    const { branch } = JSON.parse(result.stdout)
    assert.equal(git(root, 'branch', '--show-current').stdout.trim(), branch)
    assert.equal(commits(root), before + 1)
    assert.equal(subject(root), 'pmkit: issues branch ISS-2X6D')
    assert.deepEqual(status(root, '.issues'), [])
  })
})

test('auto_commit false: issues branch does not commit', () => {
  withBranchRepo(false, (root, start) => {
    const before = head(root)
    const result = run(root, ['issues', 'branch', 'ISS-2X6D', '--from', start])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(head(root), before)
    assert.notDeepEqual(status(root, '.issues'), [])
  })
})

test('--dry-run with auto_commit true: issues branch creates no branch and does not commit', () => {
  withBranchRepo(true, (root, start) => {
    const before = head(root)
    const result = run(root, ['issues', 'branch', 'ISS-2X6D', '--from', start, '--dry-run', '--json'])
    assert.equal(result.status, 0, result.stderr)
    const { branch } = JSON.parse(result.stdout)
    assert.equal(head(root), before)
    assert.equal(git(root, 'branch', '--list', branch).stdout.trim(), '')
    assert.equal(git(root, 'branch', '--show-current').stdout.trim(), start)
    assert.deepEqual(status(root), [])
  })
})

/** Sets priority by hand in ISS-0G5E/issue.md, as an editor would, without an event. */
function handEdit(root) {
  const file = path.join(root, '.issues/issues/ISS-0G5E/issue.md')
  const text = fs.readFileSync(file, 'utf8')
  assert.match(text, /^priority: medium$/m)
  fs.writeFileSync(file, text.replace(/^priority: medium$/m, 'priority: urgent'))
}

const driftFiles = ['.issues/issues/ISS-0G5E/events.jsonl', '.issues/issues/ISS-0G5E/issue.md']

for (const { name, args, input } of [
  { name: 'issues comment', args: ['issues', 'comment', 'ISS-0G5E', '--body-file', '-'], input: 'A comment.\n' },
  { name: 'issues log-time', args: ['issues', 'log-time', 'ISS-0G5E', '30'] },
]) {
  test(`${name} after a hand edit commits issue.md with its drift events`, () => {
    withRepo('team', { autoCommit: true }, (root) => {
      handEdit(root)
      const result = run(root, args, { input })
      assert.equal(result.status, 0, result.stderr)
      const files = committedFiles(root)
      for (const file of driftFiles) assert.ok(files.includes(file), `${file} missing from ${files}`)
      assert.deepEqual(status(root, '.issues/issues/ISS-0G5E'), [])
      assert.match(git(root, 'show', 'HEAD:.issues/issues/ISS-0G5E/issue.md').stdout, /^priority: urgent$/m)
    })
  })
}

test('a no-op write after a hand edit commits issue.md with its drift events', () => {
  withRepo('team', { autoCommit: true }, (root) => {
    handEdit(root)
    const result = run(root, ['issues', 'assign', 'ISS-0G5E', 'ana'])
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(committedFiles(root), driftFiles)
    assert.deepEqual(status(root, '.issues/issues/ISS-0G5E'), [])
  })
})
