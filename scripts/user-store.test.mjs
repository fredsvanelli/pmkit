import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tempDir, userStoreEnv } from './test-helpers.mjs'
import { assertOutsideRepo, repoHash, userDir } from './lib/user-store.mjs'

test('userStoreEnv returns a home folder and the four variables under it', () => {
  const { home, env } = userStoreEnv()
  assert.ok(fs.existsSync(home))
  for (const name of ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'PMKIT_HOME']) {
    assert.ok(env[name].startsWith(home), name)
  }
  assert.equal(env.PMKIT_HOME, path.join(home, '.config', 'pmkit'))
})

test('userDir: PMKIT_HOME wins over XDG_CONFIG_HOME and homedir', () => {
  const home = tempDir('pmkit-home-')
  const target = path.join(home, 'custom')
  const env = { PMKIT_HOME: target, XDG_CONFIG_HOME: path.join(home, 'xdg') }
  assert.equal(userDir({ env, homedir: () => home }), target)
})

test('userDir: an empty PMKIT_HOME is ignored', () => {
  const home = tempDir('pmkit-home-')
  const xdg = path.join(home, 'xdg')
  assert.equal(userDir({ env: { PMKIT_HOME: '', XDG_CONFIG_HOME: xdg }, homedir: () => home }), path.join(xdg, 'pmkit'))
})

test('userDir: an absolute XDG_CONFIG_HOME gives <xdg>/pmkit and a relative one is ignored', () => {
  const home = tempDir('pmkit-home-')
  const xdg = path.join(home, 'xdg')
  assert.equal(userDir({ env: { XDG_CONFIG_HOME: xdg }, homedir: () => home }), path.join(xdg, 'pmkit'))
  assert.equal(userDir({ env: { XDG_CONFIG_HOME: 'relative/dir' }, homedir: () => home }), path.join(home, '.config', 'pmkit'))
})

test('userDir: with neither variable it uses <homedir>/.config/pmkit and ignores the process environment', () => {
  const home = tempDir('pmkit-home-')
  assert.equal(userDir({ env: {}, homedir: () => home }), path.join(home, '.config', 'pmkit'))
})

test('userDir creates nothing', () => {
  const home = tempDir('pmkit-home-')
  userDir({ env: {}, homedir: () => home })
  assert.deepEqual(fs.readdirSync(home), [])
})

test('userDir: a relative PMKIT_HOME throws INVALID_INPUT', () => {
  assert.throws(() => userDir({ env: { PMKIT_HOME: 'relative' } }), (error) => error.code === 'INVALID_INPUT' && Boolean(error.nextStep))
})

test('repoHash returns 12 hex characters, follows symlinks and differs per folder', () => {
  const base = tempDir('pmkit-hash-')
  const a = path.join(base, 'a')
  const b = path.join(base, 'b')
  fs.mkdirSync(a)
  fs.mkdirSync(b)
  const link = path.join(base, 'link')
  fs.symlinkSync(a, link, 'dir')
  assert.match(repoHash(a), /^[0-9a-f]{12}$/)
  assert.equal(repoHash(link), repoHash(a))
  assert.notEqual(repoHash(a), repoHash(b))
})

test('assertOutsideRepo: a target under a .git directory or file throws and names PMKIT_HOME', () => {
  for (const kind of ['dir', 'file']) {
    const repo = tempDir('pmkit-repo-')
    if (kind === 'dir') fs.mkdirSync(path.join(repo, '.git'))
    else fs.writeFileSync(path.join(repo, '.git'), 'gitdir: elsewhere\n')
    const home = tempDir('pmkit-home-')
    assert.throws(
      () => assertOutsideRepo(path.join(repo, 'deep', 'not', 'yet'), { homedir: () => home }),
      (error) => error.code === 'INVALID_INPUT' && error.nextStep.includes('PMKIT_HOME'),
    )
  }
})

test('assertOutsideRepo: a target with no .git above it passes, even when its folders do not exist', () => {
  const home = tempDir('pmkit-home-')
  assertOutsideRepo(path.join(home, '.config', 'pmkit', 'cache', 'x'), { homedir: () => home })
})

test('assertOutsideRepo: a .git exactly at the home folder is ignored', () => {
  const home = tempDir('pmkit-home-')
  fs.mkdirSync(path.join(home, '.git'))
  assertOutsideRepo(path.join(home, '.config', 'pmkit'), { homedir: () => home })
})

test('assertOutsideRepo: a .git above the home folder still blocks', () => {
  const outer = tempDir('pmkit-outer-')
  fs.mkdirSync(path.join(outer, '.git'))
  const home = path.join(outer, 'home')
  fs.mkdirSync(home)
  assert.throws(() => assertOutsideRepo(path.join(home, '.config', 'pmkit'), { homedir: () => home }), (error) => error.code === 'INVALID_INPUT')
})
