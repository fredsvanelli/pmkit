import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tempDir, userStoreEnv } from './test-helpers.mjs'
import { inboxGet, inboxSet, repoHash, userDir } from './lib/user-store.mjs'

test('inbox check: null on a new store, round trip, one entry per member and per repository', () => {
  const { env } = userStoreEnv()
  const a = tempDir('pmkit-repo-a-')
  const b = tempDir('pmkit-repo-b-')
  assert.equal(inboxGet(a, 'fred', { env }), null)
  inboxSet(a, 'fred', '2026-10-31T10:00:00Z', { env })
  inboxSet(a, 'agent:x', '2026-10-31T11:00:00Z', { env })
  assert.equal(inboxGet(a, 'fred', { env }), '2026-10-31T10:00:00Z')
  assert.equal(inboxGet(a, 'agent:x', { env }), '2026-10-31T11:00:00Z')
  assert.equal(inboxGet(b, 'fred', { env }), null)
  const file = path.join(userDir({ env }), 'inbox', `${repoHash(a)}.json`)
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { version: 1, checks: { fred: '2026-10-31T10:00:00Z', 'agent:x': '2026-10-31T11:00:00Z' } })
})

test('inbox check: a file that does not parse is INVALID_INPUT for both calls and is not overwritten', () => {
  const { env } = userStoreEnv()
  const repo = tempDir('pmkit-repo-')
  const file = path.join(userDir({ env }), 'inbox', `${repoHash(repo)}.json`)
  for (const text of ['{nope', '[]', '{"version":2,"checks":{}}', '{"version":1,"checks":{"fred":5}}', '{"version":1,"checks":{"fred":"yesterday"}}', '{"version":1,"checks":{"fred":"2026-10-31"}}']) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
    assert.throws(() => inboxGet(repo, 'fred', { env }), (e) => e.code === 'INVALID_INPUT' && e.message.includes(file), text)
    assert.throws(() => inboxSet(repo, 'fred', '2026-10-31T10:00:00Z', { env }), (e) => e.code === 'INVALID_INPUT', text)
    assert.equal(fs.readFileSync(file, 'utf8'), text)
  }
})

test('inbox check: a user store inside a repository is refused', () => {
  const repo = tempDir('pmkit-repo-')
  fs.mkdirSync(path.join(repo, '.git'))
  assert.throws(() => inboxSet(repo, 'fred', '2026-10-31T10:00:00Z', { env: { PMKIT_HOME: path.join(repo, 'store') } }), (e) => e.code === 'INVALID_INPUT')
})
