import test from 'node:test'
import assert from 'node:assert/strict'
import { hashTree, makeRepo } from '../../test-helpers.mjs'
import { buildMigrationFixture } from '../../migrate-fixture.mjs'
import { loadConfig } from '../config.mjs'
import { validateSnapshot } from '../migrate/snapshot.mjs'
import { readLocalSnapshot } from './migrate-reader.mjs'

function fixture() {
  const root = makeRepo('basic')
  const { ids } = buildMigrationFixture(root)
  const read = () => readLocalSnapshot({ root, config: loadConfig(root), commit: 'abc1234', now: () => new Date('2026-10-28T20:00:00Z') })
  return { root, ids, read }
}

test('the snapshot holds every record of the fixture', () => {
  const { ids, read } = fixture()
  const snapshot = read()
  assert.deepEqual(validateSnapshot(snapshot), [])
  assert.equal(snapshot.system, 'local')
  assert.deepEqual(snapshot.scope, { path: '.issues' })
  assert.equal(snapshot.commit, 'abc1234')
  assert.equal(snapshot.read, '2026-10-28T20:00:00Z')
  assert.equal(snapshot.issues.length, 13)
  assert.ok(snapshot.issues.find((issue) => issue.id === ids.archived).archived)
  assert.equal(snapshot.epics.length, 1)
  assert.equal(snapshot.epics[0].updates.length, 1)
  assert.match(snapshot.epics[0].updates[0].id, new RegExp(`^${ids.epic}/\\d{4}-\\d{2}-\\d{2}-fred$`))
  assert.match(snapshot.epics[0].created, /^2026-10-20T/)
  assert.equal(snapshot.sprints.length, 1)
  assert.equal(snapshot.sprints[0].state, 'planned')
  assert.equal(snapshot.links.length, 3)
  assert.equal(snapshot.comments.length, 3)
  assert.deepEqual(snapshot.labels, ['needs-criteria'])
  assert.deepEqual(snapshot.people.map((person) => person.id), ['ada', 'fred'])
  assert.deepEqual(snapshot.people[0], { id: 'ada', name: 'Ada Lovelace', email: 'ada@example.com', app: false })
})

test('links come from the frontmatter, once each', () => {
  const { ids, read } = fixture()
  const { links } = read()
  assert.ok(links.some((link) => link.kind === 'blocks' && link.from === ids.blocker && link.to === ids.blocked))
  assert.ok(links.some((link) => link.kind === 'duplicate' && link.from === ids.duplicate && link.to === ids.original))
  assert.equal(links.filter((link) => link.kind === 'related').length, 1)
})

test('comments keep their thread and resolution', () => {
  const { ids, read } = fixture()
  const { comments } = read()
  const thread = comments.filter((comment) => comment.issue === ids.threaded)
  const root = thread.find((comment) => comment.parent === null)
  const reply = thread.find((comment) => comment.parent !== null)
  assert.equal(reply.parent, root.id)
  assert.ok(root.id.startsWith(`${ids.threaded}/`))
  assert.equal(reply.author, 'ada')
  assert.equal(comments.find((comment) => comment.issue === ids.resolved).resolved, true)
  assert.equal(root.resolved, false)
})

test('completed is the time of the move to done', () => {
  const { ids, read } = fixture()
  const issues = read().issues
  const done = issues.find((issue) => issue.id === ids.done)
  assert.match(done.completed, /^2026-10-20T/)
  assert.ok(done.completed > done.created)
  assert.equal(done.estimate, 3)
  assert.equal(issues.find((issue) => issue.id === ids.blocker).completed, null)
})

test('the reader writes nothing', () => {
  const { root, read } = fixture()
  const before = hashTree(root, ['.git'])
  read()
  assert.equal(hashTree(root, ['.git']), before)
})

test('outOfScope counts time logs', () => {
  const { read } = fixture()
  assert.deepEqual(read().outOfScope, { releases: 0, timeLogs: 1, documents: 0, milestones: 0 })
})

test('two reads of an unchanged tracker give the same records', () => {
  const { read } = fixture()
  const { read: _a, ...a } = read()
  const { read: _b, ...b } = read()
  assert.deepEqual(a, b)
})
