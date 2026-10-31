import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tempDir, userStoreEnv } from './test-helpers.mjs'
import { inboxGet, inboxSet, repoHash, userDir } from './lib/user-store.mjs'

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
