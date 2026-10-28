import assert from 'node:assert/strict'
import test from 'node:test'
import { actorOf, toComment } from './history.mjs'

test('the actor is the user id, else bot:<type>, else external:<id>, else linear', () => {
  assert.equal(actorOf({ user: { id: 'user-1' } }), 'user-1')
  assert.equal(actorOf({ actor: { id: 'user-2' } }), 'user-2')
  assert.equal(actorOf({ user: null, botActor: { type: 'github', name: 'GitHub' } }), 'bot:github')
  assert.equal(actorOf({ externalUser: { id: 'ext-1' } }), 'external:ext-1')
  assert.equal(actorOf({}), 'linear')
  assert.equal(actorOf({ actor: null, autoClosed: true }), 'linear')
  assert.equal(actorOf({ user: { id: 'user-1' }, botActor: { type: 'x' } }), 'user-1')
})

const node = { id: 'c-1', createdAt: '2026-10-01T00:00:00.000Z', body: '  Hello\n', user: { id: 'user-1' }, botActor: null, externalUser: null, parentId: null, resolvedAt: null, resolvingUser: null }

test('a plain comment has the common keys only, with the body trimmed', () => {
  const comment = toComment(node, 'ACME-1')
  assert.deepEqual(comment, { id: 'c-1', issue: 'ACME-1', author: 'user-1', body: 'Hello', created: '2026-10-01T00:00:00.000Z' })
  assert.deepEqual(Object.keys(comment), ['id', 'issue', 'author', 'body', 'created'])
})

test('a reply holds parent, and a resolved root holds resolved, in that key order', () => {
  assert.equal(toComment({ ...node, parentId: 'c-0' }, 'ACME-1').parent, 'c-0')
  const resolved = toComment({ ...node, parentId: 'c-0', resolvedAt: '2026-10-02T00:00:00.000Z', resolvingUser: { id: 'user-2' } }, 'ACME-1')
  assert.deepEqual(Object.keys(resolved), ['id', 'issue', 'author', 'body', 'created', 'parent', 'resolved'])
  assert.deepEqual(resolved.resolved, { at: '2026-10-02T00:00:00.000Z', by: 'user-2' })
  assert.equal(toComment({ ...node, resolvedAt: '2026-10-02T00:00:00.000Z' }, 'ACME-1').resolved.by, 'linear')
})

test('a bot, an external and a Linear comment get their author', () => {
  assert.equal(toComment({ ...node, user: null, botActor: { type: 'slack', name: 'Slack' } }, 'ACME-1').author, 'bot:slack')
  assert.equal(toComment({ ...node, user: null, externalUser: { id: 'e1' } }, 'ACME-1').author, 'external:e1')
  assert.equal(toComment({ ...node, user: null }, 'ACME-1').author, 'linear')
})
