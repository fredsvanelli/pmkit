import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { appendEvents, driftEvents, readEvents, replay } from './lib/local/events.mjs'
import { tempDir } from './test-helpers.mjs'

const tmp = () => tempDir('pmkit-')
const write = (dir, name, text) => {
  const file = path.join(dir, name)
  fs.writeFileSync(file, text)
  return file
}

const clean = [
  { at: '2026-10-01T10:00:00Z', by: 'fred', op: 'create', to: { title: 'A', status: 'todo' } },
  { at: '2026-10-02T10:00:00Z', by: 'fred', op: 'move', field: 'status', from: 'todo', to: 'in_progress' },
  { at: '2026-10-03T10:00:00Z', by: 'ana', op: 'assign', field: 'assignee', to: 'ana' },
]
const stamp = { at: '2026-10-09T09:00:00Z', by: 'fred' }

test('a union-merged log replays like the clean one', () => {
  const merged = [clean[2], clean[0], clean[1], clean[1]].map((e) => JSON.stringify(e)).join('\n') + '\n{"at":"2026-10-04'
  const file = write(tmp(), 'events.jsonl', merged)
  const { events, problems } = readEvents(file)
  assert.deepEqual(events, clean)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /^line 5: /)
  assert.deepEqual(replay(events), { title: 'A', status: 'in_progress', assignee: 'ana' })
})

test('readEvents handles a missing file, a BOM, CRLF and events missing keys', () => {
  const dir = tmp()
  assert.deepEqual(readEvents(path.join(dir, 'none.jsonl')), { events: [], problems: [] })
  const text = '\uFEFF' + JSON.stringify(clean[0]) + '\r\n\r\n{"at":"x","by":"y"}\r\n'
  const { events, problems } = readEvents(write(dir, 'events.jsonl', text))
  assert.deepEqual(events, [clean[0]])
  assert.equal(problems.length, 1)
  assert.match(problems[0], /^line 3: /)
})

test('an archive, unarchive, archive in one second keeps all three, and a merge duplicate of one still collapses', () => {
  const at = '2026-10-01T10:00:00Z'
  const line = (op) => JSON.stringify({ at, by: 'f', op })
  const { events } = readEvents(write(tmp(), 'events.jsonl', [line('archive'), line('unarchive'), line('archive')].join('\n')))
  assert.deepEqual(events.map((event) => event.op), ['archive', 'unarchive', 'archive'])
  assert.equal(replay(events).archived, true)
  const merged = readEvents(write(tmp(), 'events2.jsonl', [line('archive'), line('archive')].join('\n')))
  assert.equal(merged.events.length, 1)
})

test('a merge that repeats a whole archive, unarchive, archive, unarchive run shows each event once (PMK-256)', () => {
  const ev = (op, n) => JSON.stringify({ at: `2026-10-01T10:00:0${n}Z`, by: 'f', op })
  const run = [ev('archive', 1), ev('unarchive', 2), ev('archive', 3), ev('unarchive', 4)]
  const { events } = readEvents(write(tmp(), 'events3.jsonl', [...run, ...run].join('\n')))
  assert.deepEqual(events.map((event) => event.op), ['archive', 'unarchive', 'archive', 'unarchive'])
  assert.equal(replay(events).archived, undefined)
})

test('duplicates ignore key order and ties keep file order', () => {
  const a = { at: '2026-10-01T10:00:00Z', by: 'f', op: 'comment', to: 'one' }
  const b = { at: '2026-10-01T10:00:00Z', by: 'f', op: 'comment', to: 'two' }
  const text = [JSON.stringify(b), JSON.stringify(a), JSON.stringify({ to: 'two', op: 'comment', by: 'f', at: a.at })].join('\n')
  const { events } = readEvents(write(tmp(), 'events.jsonl', text))
  assert.deepEqual(events, [b, a])
})

test('link and unlink edit the named list', () => {
  const events = [
    clean[0],
    { at: '2026-10-02T10:00:00Z', by: 'f', op: 'link', field: 'blocked_by', to: 'ISS-1' },
    { at: '2026-10-02T11:00:00Z', by: 'f', op: 'link', field: 'blocked_by', to: 'ISS-2' },
    { at: '2026-10-02T11:30:00Z', by: 'f', op: 'link', field: 'blocked_by', to: 'ISS-2' },
    { at: '2026-10-02T12:00:00Z', by: 'f', op: 'unlink', field: 'blocked_by', to: 'ISS-1' },
    { at: '2026-10-02T13:00:00Z', by: 'f', op: 'comment', to: 'hi' },
    { at: '2026-10-02T14:00:00Z', by: 'f', op: 'log_time', minutes: 5 },
    { at: '2026-10-02T15:00:00Z', by: 'f', op: 'archive' },
  ]
  assert.deepEqual(replay(events), { title: 'A', status: 'todo', blocked_by: ['ISS-2'], archived: true })
})

test('an unarchive event drops archived again, so the replay equals the file and drift finds nothing', () => {
  const events = [clean[0], { at: '2026-10-02T15:00:00Z', by: 'f', op: 'archive' }, { at: '2026-10-02T16:00:00Z', by: 'f', op: 'unarchive' }]
  assert.deepEqual(replay(events), { title: 'A', status: 'todo' })
})

test('appendEvents writes LF lines with keys in order and skips undefined', () => {
  const file = path.join(tmp(), 'events.jsonl')
  appendEvents(file, [{ synthetic: true, to: 'done', op: 'move', by: 'f', at: 'T', from: undefined, field: 'status' }])
  appendEvents(file, [{ op: 'log_time', by: 'f', at: 'U', minutes: 3 }])
  assert.equal(
    fs.readFileSync(file, 'utf8'),
    '{"at":"T","by":"f","op":"move","field":"status","to":"done","synthetic":true}\n{"at":"U","by":"f","op":"log_time","minutes":3}\n',
  )
})

test('appendEvents starts a new line after a half-written one', () => {
  const file = write(tmp(), 'events.jsonl', JSON.stringify(clean[0]) + '\n{"at":"2026-10')
  appendEvents(file, [clean[1]])
  const { events, problems } = readEvents(file)
  assert.deepEqual(events, [clean[0], clean[1]])
  assert.equal(problems.length, 1)
})

test('a hand edit of status gives one synthetic move, and applying it ends the drift', () => {
  const frontmatter = { id: 'ISS-1', title: 'A', status: 'done', labels: [], created: 'c', updated: 'u' }
  const fixed = { ...frontmatter, assignee: 'ana' }
  const one = driftEvents(fixed, clean, stamp)
  assert.equal(one.length, 1)
  assert.equal(one[0].op, 'move')
  assert.deepEqual(driftEvents(fixed, [...clean, ...one], stamp), [])
})

test('empty values and arrays compare by content', () => {
  const events = [{ ...clean[0], to: { title: 'A', status: 'todo', labels: ['a', 'b'], related: [], priority: '' } }]
  const same = { title: 'A', status: 'todo', labels: ['a', 'b'] }
  assert.deepEqual(driftEvents(same, events, stamp), [])
  const reordered = driftEvents({ ...same, labels: ['b', 'a'] }, events, stamp)
  assert.equal(reordered.length, 1)
  assert.deepEqual(reordered[0], { ...stamp, op: 'update', field: 'labels', from: ['a', 'b'], to: ['b', 'a'], synthetic: true })
})

test('a frontmatter with no events gives one synthetic create', () => {
  const frontmatter = { id: 'ISS-1', title: 'A', status: 'todo' }
  assert.deepEqual(driftEvents(frontmatter, [], stamp), [{ ...stamp, op: 'create', to: frontmatter, synthetic: true }])
})
