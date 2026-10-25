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
    assert.ok(committedFiles(root).includes('.issues/issues/ISS-0G5E/issue.md'))
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
