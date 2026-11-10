import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tempDir, userStoreEnv } from './test-helpers.mjs'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { inboxGet, inboxKey, inboxSet, inboxUpdate, repoHash, userDir } from './lib/user-store.mjs'

const entry = (at, seen = {}) => ({ at, seen })

test('inbox check: null on a new store, round trip, one entry per member and per repository', () => {
  const { env } = userStoreEnv()
  const a = tempDir('pmkit-repo-a-')
  const b = tempDir('pmkit-repo-b-')
  assert.equal(inboxGet(a, 'fred', { env }), null)
  inboxSet(a, 'fred', entry('2026-10-31T10:00:00Z', { 'assign:ISS-1:aaaaaaaaaaaa': '2026-10-31T10:00:00Z' }), { env })
  inboxSet(a, 'agent:x', entry('2026-10-31T11:00:00Z'), { env })
  assert.deepEqual(inboxGet(a, 'fred', { env }), entry('2026-10-31T10:00:00Z', { 'assign:ISS-1:aaaaaaaaaaaa': '2026-10-31T10:00:00Z' }))
  assert.deepEqual(inboxGet(a, 'agent:x', { env }), entry('2026-10-31T11:00:00Z'))
  assert.equal(inboxGet(b, 'fred', { env }), null)
  const file = path.join(userDir({ env }), 'inbox', `${repoHash(a)}.json`)
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
    version: 2,
    checks: { fred: { at: '2026-10-31T10:00:00Z', seen: { 'assign:ISS-1:aaaaaaaaaaaa': '2026-10-31T10:00:00Z' } }, 'agent:x': { at: '2026-10-31T11:00:00Z', seen: {} } },
  })
})

test('inbox check: a time with a zone or a fraction is read as the same second in Z', () => {
  const { env } = userStoreEnv()
  const repo = tempDir('pmkit-repo-')
  const file = path.join(userDir({ env }), 'inbox', `${repoHash(repo)}.json`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ version: 2, checks: { fred: { at: '2026-10-31T12:00:00.500+02:00', seen: { k: '2026-10-31T12:00:00+02:00' } } } }))
  assert.deepEqual(inboxGet(repo, 'fred', { env }), entry('2026-10-31T10:00:00Z', { k: '2026-10-31T10:00:00Z' }))
})

test('inbox check: a file that does not parse is INVALID_INPUT for both calls and is not overwritten', () => {
  const { env } = userStoreEnv()
  const repo = tempDir('pmkit-repo-')
  const file = path.join(userDir({ env }), 'inbox', `${repoHash(repo)}.json`)
  for (const text of ['{nope', '[]', '{"version":1,"checks":{}}', '{"version":2,"checks":[]}', '{"version":2}']) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
    assert.throws(() => inboxGet(repo, 'fred', { env }), (e) => e.code === 'INVALID_INPUT' && e.message.startsWith('The inbox file') && e.message.includes(file), text)
    assert.throws(() => inboxSet(repo, 'fred', entry('2026-10-31T10:00:00Z'), { env }), (e) => e.code === 'INVALID_INPUT', text)
    assert.equal(fs.readFileSync(file, 'utf8'), text)
  }
})

test('inbox check: a bad entry blocks only its member and set keeps the other entries as they are', () => {
  const { env } = userStoreEnv()
  const repo = tempDir('pmkit-repo-')
  const file = path.join(userDir({ env }), 'inbox', `${repoHash(repo)}.json`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const bad = [{ at: 'yesterday', seen: {} }, { at: '2026-10-31', seen: {} }, { at: '2026-10-31T10:00:00Z' }, { at: '2026-10-31T10:00:00Z', seen: [] }, { at: '2026-10-31T10:00:00Z', seen: { k: 'soon' } }, 'x', null]
  for (const value of bad) {
    fs.writeFileSync(file, JSON.stringify({ version: 2, checks: { ana: value, fred: entry('2026-10-31T10:00:00Z') } }))
    assert.deepEqual(inboxGet(repo, 'fred', { env }), entry('2026-10-31T10:00:00Z'))
    assert.throws(() => inboxGet(repo, 'ana', { env }), (e) => e.code === 'INVALID_INPUT' && e.message.includes('ana') && e.message.includes(file), JSON.stringify(value))
    inboxSet(repo, 'fred', entry('2026-10-31T11:00:00Z'), { env })
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).checks.ana, value)
  }
})

test('inbox check: a user store inside a repository is refused', () => {
  const repo = tempDir('pmkit-repo-')
  fs.mkdirSync(path.join(repo, '.git'))
  assert.throws(() => inboxSet(repo, 'fred', entry('2026-10-31T10:00:00Z'), { env: { PMKIT_HOME: path.join(repo, 'store') } }), (e) => e.code === 'INVALID_INPUT')
})

const gitInit = (dir, ...remote) => {
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' } })
  assert.equal(git('init', '-q').status, 0)
  if (remote.length > 0) assert.equal(git('remote', 'add', ...remote).status, 0)
  return dir
}

test('inbox key: https and ssh clones of one repository share the key, and a repository with no remote falls back to its path', () => {
  const a = gitInit(tempDir('pmkit-repo-a-'), 'origin', 'https://github.com/Acme/Repo.git')
  const b = gitInit(tempDir('pmkit-repo-b-'), 'origin', 'git@github.com:acme/repo')
  const other = gitInit(tempDir('pmkit-repo-c-'), 'origin', 'git@github.com:acme/other.git')
  const bare = gitInit(tempDir('pmkit-repo-d-'))
  assert.match(inboxKey(a), /^[0-9a-f]{12}$/)
  assert.equal(inboxKey(a), inboxKey(b))
  assert.notEqual(inboxKey(a), inboxKey(other))
  assert.notEqual(inboxKey(a), repoHash(a))
  assert.equal(inboxKey(bare), repoHash(bare))
  const plain = tempDir('pmkit-nogit-')
  assert.equal(inboxKey(plain), repoHash(plain))
})

test('inbox key: two worktrees with one remote share the check', () => {
  const { env } = userStoreEnv()
  const a = gitInit(tempDir('pmkit-repo-a-'), 'origin', 'https://github.com/acme/repo.git')
  const b = gitInit(tempDir('pmkit-repo-b-'), 'origin', 'https://github.com/acme/repo.git')
  inboxSet(a, 'fred', entry('2026-10-31T10:00:00Z', { k: '2026-10-31T10:00:00Z' }), { env })
  assert.deepEqual(inboxGet(b, 'fred', { env }), entry('2026-10-31T10:00:00Z', { k: '2026-10-31T10:00:00Z' }))
})

test('inbox key: the path file is read until the first write, which goes to the remote file and leaves the path file', () => {
  const { env } = userStoreEnv()
  const repo = gitInit(tempDir('pmkit-repo-'), 'origin', 'https://github.com/acme/repo.git')
  const old = path.join(userDir({ env }), 'inbox', `${repoHash(repo)}.json`)
  const now = path.join(userDir({ env }), 'inbox', `${inboxKey(repo)}.json`)
  fs.mkdirSync(path.dirname(old), { recursive: true })
  const text = JSON.stringify({ version: 2, checks: { fred: { at: '2026-10-31T10:00:00Z', seen: { k: '2026-10-31T10:00:00Z' } } } })
  fs.writeFileSync(old, text)
  assert.deepEqual(inboxGet(repo, 'fred', { env }), entry('2026-10-31T10:00:00Z', { k: '2026-10-31T10:00:00Z' }))
  inboxUpdate(repo, 'fred', (current) => ({ ...current, seen: { ...current.seen, j: '2026-10-31T11:00:00Z' } }), { env })
  assert.equal(fs.readFileSync(old, 'utf8'), text)
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(now, 'utf8')).checks.fred.seen), ['k', 'j'])
})

test('inbox lock: a fresh lock makes the write wait and fail with CONFLICT naming it, and a stale lock is removed', () => {
  const { env } = userStoreEnv()
  const repo = tempDir('pmkit-repo-')
  const file = path.join(userDir({ env }), 'inbox', `${repoHash(repo)}.json`)
  const lock = `${file}.lock`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(lock, '')
  assert.throws(() => inboxSet(repo, 'fred', entry('2026-10-31T10:00:00Z'), { env, lockWaitMs: 200 }), (error) => error.code === 'CONFLICT' && error.message.includes(lock))
  assert.equal(fs.existsSync(file), false)
  const old = new Date(Date.now() - 60000)
  fs.utimesSync(lock, old, old)
  inboxSet(repo, 'fred', entry('2026-10-31T10:00:00Z'), { env, lockWaitMs: 200 })
  assert.equal(fs.existsSync(lock), false)
  assert.deepEqual(inboxGet(repo, 'fred', { env }), entry('2026-10-31T10:00:00Z'))
})

test('inbox update: the updater gets the entry on disk at write time, so two updates keep both keys', () => {
  const { env } = userStoreEnv()
  const repo = tempDir('pmkit-repo-')
  const add = (key) => (current) => ({ at: '2026-10-31T10:00:00Z', seen: { ...(current?.seen ?? {}), [key]: '2026-10-31T10:00:00Z' } })
  inboxUpdate(repo, 'fred', add('a'), { env })
  inboxUpdate(repo, 'fred', add('b'), { env })
  assert.deepEqual(Object.keys(inboxGet(repo, 'fred', { env }).seen), ['a', 'b'])
})
