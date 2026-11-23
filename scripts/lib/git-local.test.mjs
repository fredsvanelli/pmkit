import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { createGitLocal, defaultExec, refArg } from './git-local.mjs'
import { makeRepo } from '../test-helpers.mjs'

const git = (root, ...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })

function repo() {
  const root = makeRepo('basic')
  git(root, 'init', '-q', '-b', 'main')
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
  return root
}

test('createBranch then currentBranch returns the new name', () => {
  const root = repo()
  const local = createGitLocal({ root, env: process.env })
  local.createBranch('feature-x', { from: 'main' })
  assert.equal(local.currentBranch(), 'feature-x')
  assert.equal(local.workingTree('feature-x').uncommitted, false)
  assert.equal(local.workingTree('other'), null)
  assert.equal(local.unpushedCommits('feature-x'), null)
})

test('refArg refuses a ref that starts with a dash', () => {
  assert.throws(() => refArg('branch', '-x'), (error) => error.code === 'INVALID_INPUT')
})

test('a missing git binary is NOT_CONFIGURED', () => {
  const exec = () => { throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }) }
  const local = createGitLocal({ root: '/repo', env: {}, exec })
  assert.throws(() => local.currentBranch(), (error) => error.code === 'NOT_CONFIGURED' && error.message === 'git is not installed' && error.nextStep === 'Install git')
})

test('a failing git command is UPSTREAM with the first stderr line', () => {
  const exec = () => ({ status: 128, stdout: '', stderr: 'fatal: not a git repository\nmore\n' })
  const local = createGitLocal({ root: '/repo', env: {}, exec })
  assert.throws(() => local.currentBranch(), (error) => error.code === 'UPSTREAM' && /fatal: not a git repository/.test(error.message) && !/more/.test(error.message))
})

test('defaultExec is exported', () => {
  assert.equal(typeof defaultExec({ root: '/', env: {} }), 'function')
})
