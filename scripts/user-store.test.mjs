import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tempDir, userStoreEnv } from './test-helpers.mjs'
import { assertOutsideRepo, cacheClear, cacheDelete, cacheGet, cachePut, repoHash, userDir } from './lib/user-store.mjs'

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

const T0 = '2026-10-27T12:00:00.000Z'
const at = (iso) => () => new Date(iso)
const plus = (seconds) => new Date(Date.parse(T0) + seconds * 1000).toISOString()

function store() {
  const home = tempDir('pmkit-home-')
  const dir = path.join(home, '.config', 'pmkit')
  return { home, dir, options: (now = T0) => ({ env: { PMKIT_HOME: dir }, homedir: () => home, now: at(now) }) }
}

test('cachePut then cacheGet returns value, storedAt and expiresAt', () => {
  const { options } = store()
  cachePut('linear-acme', 'teams', { a: [1, 2] }, { ttlSeconds: 60 }, options())
  assert.deepEqual(cacheGet('linear-acme', 'teams', options()), { value: { a: [1, 2] }, storedAt: T0, expiresAt: plus(60) })
})

test('cacheGet honors the TTL against the injected now and keeps the expired file', () => {
  const { dir, options } = store()
  cachePut('s', 'k', 'v', { ttlSeconds: 60 }, options())
  assert.equal(cacheGet('s', 'k', options(plus(59))).value, 'v')
  assert.equal(cacheGet('s', 'k', options(plus(60))), null)
  assert.equal(cacheGet('s', 'k', options(plus(61))), null)
  assert.ok(fs.existsSync(path.join(dir, 'cache', 's', 'k.json')))
})

test('cacheGet returns null for a missing, empty, corrupt or other-version file', () => {
  const { dir, options } = store()
  assert.equal(cacheGet('s', 'k', options()), null)
  const file = path.join(dir, 'cache', 's', 'k.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  for (const text of ['', '{not json', JSON.stringify({ version: 2, storedAt: T0, ttlSeconds: 60, value: 1 }), 'null', JSON.stringify({ version: 1, storedAt: 'nope', ttlSeconds: 60, value: 1 })]) {
    fs.writeFileSync(file, text)
    assert.equal(cacheGet('s', 'k', options()), null, text)
  }
})

test('cachePut rejects a bad ttlSeconds', () => {
  const { options } = store()
  for (const ttlSeconds of [undefined, 0, -1, 1.5, '60', NaN]) {
    assert.throws(() => cachePut('s', 'k', 1, { ttlSeconds }, options()), (error) => error.code === 'INVALID_INPUT', String(ttlSeconds))
  }
  assert.throws(() => cachePut('s', 'k', 1, undefined, options()), (error) => error.code === 'INVALID_INPUT')
})

test('cachePut rejects undefined and circular values', () => {
  const { options } = store()
  const circular = {}
  circular.self = circular
  for (const value of [undefined, circular]) {
    assert.throws(() => cachePut('s', 'k', value, { ttlSeconds: 1 }, options()), (error) => error.code === 'INVALID_INPUT')
  }
})

test('cache functions reject bad scopes and keys', () => {
  const { options } = store()
  for (const bad of ['a/b', '..', 'Upper', '', '.hidden']) {
    assert.throws(() => cachePut(bad, 'k', 1, { ttlSeconds: 1 }, options()), (error) => error.code === 'INVALID_INPUT', bad)
    assert.throws(() => cachePut('s', bad, 1, { ttlSeconds: 1 }, options()), (error) => error.code === 'INVALID_INPUT', bad)
    assert.throws(() => cacheGet(bad, 'k', options()), (error) => error.code === 'INVALID_INPUT', bad)
  }
})

test('cachePut writes folders 0700 and the file 0600 with the documented layout, and leaves no .tmp', { skip: process.platform === 'win32' }, () => {
  const { dir, options } = store()
  cachePut('s', 'k', { x: 1 }, { ttlSeconds: 5 }, options())
  const folder = path.join(dir, 'cache', 's')
  const file = path.join(folder, 'k.json')
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700)
  assert.equal(fs.statSync(path.join(dir, 'cache')).mode & 0o777, 0o700)
  assert.equal(fs.statSync(folder).mode & 0o777, 0o700)
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { version: 1, storedAt: T0, ttlSeconds: 5, value: { x: 1 } })
  assert.deepEqual(fs.readdirSync(folder), ['k.json'])
})

test('a second cachePut replaces the entry whole', () => {
  const { options } = store()
  cachePut('s', 'k', { a: 1, b: 2 }, { ttlSeconds: 5 }, options())
  cachePut('s', 'k', { c: 3 }, { ttlSeconds: 10 }, options(plus(1)))
  assert.deepEqual(cacheGet('s', 'k', options(plus(1))), { value: { c: 3 }, storedAt: plus(1), expiresAt: plus(11) })
})

test('cachePut refuses to write inside a repository', () => {
  const repo = tempDir('pmkit-repo-')
  fs.mkdirSync(path.join(repo, '.git'))
  const home = tempDir('pmkit-home-')
  const options = { env: { PMKIT_HOME: path.join(repo, 'store') }, homedir: () => home, now: at(T0) }
  assert.throws(() => cachePut('s', 'k', 1, { ttlSeconds: 1 }, options), (error) => error.code === 'INVALID_INPUT')
  assert.equal(fs.existsSync(path.join(repo, 'store')), false)
})

test('cacheDelete removes one entry and ignores a missing one', () => {
  const { options } = store()
  cachePut('s', 'a', 1, { ttlSeconds: 60 }, options())
  cachePut('s', 'b', 2, { ttlSeconds: 60 }, options())
  cacheDelete('s', 'a', options())
  cacheDelete('s', 'a', options())
  assert.equal(cacheGet('s', 'a', options()), null)
  assert.equal(cacheGet('s', 'b', options()).value, 2)
})

test('cacheClear(scope) removes that scope only', () => {
  const { options } = store()
  cachePut('a', 'k', 1, { ttlSeconds: 60 }, options())
  cachePut('b', 'k', 2, { ttlSeconds: 60 }, options())
  cacheClear('a', options())
  assert.equal(cacheGet('a', 'k', options()), null)
  assert.equal(cacheGet('b', 'k', options()).value, 2)
})

test('cacheClear() removes cache/ and leaves defaults.yaml', () => {
  const { dir, options } = store()
  cachePut('a', 'k', 1, { ttlSeconds: 60 }, options())
  fs.writeFileSync(path.join(dir, 'defaults.yaml'), 'output: json\n')
  cacheClear(undefined, options())
  assert.equal(fs.existsSync(path.join(dir, 'cache')), false)
  assert.ok(fs.existsSync(path.join(dir, 'defaults.yaml')))
})

test('clearing when nothing exists does not throw or create folders', () => {
  const { home, options } = store()
  cacheClear('a', options())
  cacheClear(undefined, options())
  cacheDelete('a', 'k', options())
  assert.deepEqual(fs.readdirSync(home), [])
})

test('cacheDelete and cacheClear reject a bad scope or key', () => {
  const { options } = store()
  assert.throws(() => cacheClear('../x', options()), (error) => error.code === 'INVALID_INPUT')
  assert.throws(() => cacheDelete('..', 'k', options()), (error) => error.code === 'INVALID_INPUT')
  assert.throws(() => cacheDelete('s', 'A', options()), (error) => error.code === 'INVALID_INPUT')
})
