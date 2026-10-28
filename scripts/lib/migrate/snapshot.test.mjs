import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EXPORT_KINDS, IMPORT_KINDS, attributionLine, linkKey, localLinks, snapshotDigest, stableStringify, stripAttribution, validateSnapshot,
} from './snapshot.mjs'

const EMPTY = { system: 'local', people: [], labels: [], epics: [], sprints: [], issues: [], links: [], comments: [] }

test('localLinks turns blocked_by, related and duplicate_of into one link each', () => {
  const issues = [
    { id: 'ISS-2', blockedBy: ['ISS-1'], related: ['ISS-1'], duplicateOf: [] },
    { id: 'ISS-1', blockedBy: [], related: ['ISS-2'], duplicateOf: [] },
    { id: 'ISS-3', blockedBy: [], related: [], duplicateOf: ['ISS-1'] },
  ]
  assert.deepEqual(localLinks(issues), [
    { kind: 'blocks', from: 'ISS-1', to: 'ISS-2' },
    { kind: 'duplicate', from: 'ISS-3', to: 'ISS-1' },
    { kind: 'related', from: 'ISS-1', to: 'ISS-2' },
  ])
})

test('localLinks keeps the lower numbered id first in a related pair', () => {
  assert.deepEqual(localLinks([{ id: 'ISS-10', blockedBy: [], related: ['ISS-2'], duplicateOf: [] }]), [
    { kind: 'related', from: 'ISS-2', to: 'ISS-10' },
  ])
})

test('linkKey names the kind and both ends', () => assert.equal(linkKey({ kind: 'blocks', from: 'PMK-35', to: 'PMK-38' }), 'blocks PMK-35 PMK-38'))

test('stableStringify sorts keys at every depth', () => {
  assert.equal(stableStringify({ b: 1, a: [{ d: 1, c: 2 }] }), '{"a":[{"c":2,"d":1}],"b":1}')
})

test('snapshotDigest ignores read and key order', () => {
  const a = { system: 'local', read: '2026-10-28T20:00:00Z', issues: [{ id: 'X', title: 't' }] }
  const b = { issues: [{ title: 't', id: 'X' }], read: '2026-10-29T08:00:00Z', system: 'local' }
  assert.equal(snapshotDigest(a), snapshotDigest(b))
  assert.match(snapshotDigest(a), /^sha256:[0-9a-f]{64}$/)
  assert.notEqual(snapshotDigest(a), snapshotDigest({ ...a, issues: [{ id: 'X', title: 'u' }] }))
})

test('attributionLine and stripAttribution round-trip', () => {
  const line = attributionLine({ name: 'Ana Souza', created: '2026-10-28T18:11:19Z', issue: 'ISS-5N1R' })
  assert.equal(line, 'Comment by Ana Souza on 2026-10-28 in ISS-5N1R')
  assert.deepEqual(stripAttribution(`${line}\n\nLooks good.`), { body: 'Looks good.', name: 'Ana Souza', date: '2026-10-28', issue: 'ISS-5N1R' })
})

test('stripAttribution needs the exact shape and the blank line', () => {
  assert.equal(stripAttribution('Comment by Ana on 2026-10-28 in ISS-1\nno blank line'), null)
  assert.equal(stripAttribution('comment by Ana on 2026-10-28 in ISS-1\n\nbody'), null)
  assert.equal(stripAttribution('Looks good.'), null)
})

test('validateSnapshot names a record without an id', () => {
  assert.deepEqual(validateSnapshot({ ...EMPTY, issues: [{ title: 'x' }] }), ['issues[0] has no id'])
})

test('validateSnapshot names a missing array and a link end that is not a string', () => {
  const { comments, ...noComments } = EMPTY
  assert.deepEqual(validateSnapshot({ ...noComments, links: [{ kind: 'blocks', from: 'A', to: 3 }] }), [
    'comments is not a list',
    'links[0] has an end that is not an id',
  ])
  assert.deepEqual(validateSnapshot(EMPTY), [])
})

test('the kinds follow the order of writes', () => {
  assert.deepEqual(EXPORT_KINDS, ['label', 'epic', 'issue', 'link', 'comment', 'thread', 'update', 'archive'])
  assert.deepEqual(IMPORT_KINDS, ['member', 'label', 'sprint', 'epic', 'update', 'issue', 'comment'])
})
