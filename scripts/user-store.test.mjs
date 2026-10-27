import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tempDir, userStoreEnv } from './test-helpers.mjs'
import { userDir } from './lib/user-store.mjs'

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
