import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compareReleaseIds, parseRelease, serializeRelease, sortReleases, validReleaseId, validTag,
} from './lib/local/releases.mjs'
import { validTimestamp } from './lib/local/sprints.mjs'

const doctor = (expected, message) => (error) => {
  assert.equal(error.code, expected)
  assert.equal(error.nextStep, '/pmkit:local:doctor')
  if (message) assert.equal(error.message, message)
  return true
}

test('validReleaseId accepts versions and rejects build metadata and edge characters', () => {
  for (const id of ['1.2.0', 'v1.2.0', '2026.10', '1.0.0-rc.1', 'mobile-3.4']) assert.equal(validReleaseId(id), true, id)
  for (const id of ['1.0.0+build.5', 'v1.', '-1', '', '1 0']) assert.equal(validReleaseId(id), false, id)
})

test('validTag follows the git ref name rules', () => {
  for (const tag of ['v1.2.0', 'release/1.2.0', '1.0.0-rc.1']) assert.equal(validTag(tag), true, tag)
  for (const tag of ['', 'v1..2', 'v1 2', 'v1\nv2', '-v1', '/v1', 'v1/', 'v1.', 'v1.lock', 'v1~1', 'v1^', 'a:b', 'a?', 'a*', 'a[b', 'a\\b']) {
    assert.equal(validTag(tag), false, JSON.stringify(tag))
  }
})

test('validTimestamp needs a real date, a time and a zone', () => {
  assert.equal(validTimestamp('2026-11-28T14:05:00Z'), true)
  assert.equal(validTimestamp('2026-11-28T14:05:00+02:00'), true)
  assert.equal(validTimestamp('2026-11-28'), false)
  assert.equal(validTimestamp('2026-13-28T14:05:00Z'), false)
  assert.equal(validTimestamp(5), false)
})

test('parseRelease reads every key and the body as description', () => {
  const text = '---\nname: Webhooks\ntag: v1.2.0\ntarget: 2026-11-30\nreleased: 2026-11-28T14:05:00Z\n---\n\nWebhook retries.\n'
  assert.deepEqual(parseRelease(text, '1.2.0'), {
    id: '1.2.0', name: 'Webhooks', tag: 'v1.2.0', target: '2026-11-30', released: '2026-11-28T14:05:00Z', state: 'released', description: 'Webhook retries.',
  })
})

test('parseRelease without name and released uses the id and is planned', () => {
  const release = parseRelease('---\nowner: ana\n---\n', '1.2.0')
  assert.equal(release.name, '1.2.0')
  assert.equal(release.state, 'planned')
  for (const key of ['tag', 'target', 'released']) assert.equal(Object.hasOwn(release, key), false, key)
})

test('parseRelease rejects a bad target, released, tag and a name with a line break', () => {
  assert.throws(() => parseRelease('---\ntarget: 2026-13-40\n---\n', '1.0'),
    doctor('INVALID_INPUT', 'release file 1.0.md has target "2026-13-40", expected a date as YYYY-MM-DD'))
  assert.throws(() => parseRelease('---\nreleased: 2026-11-28\n---\n', '1.0'),
    doctor('INVALID_INPUT', 'release file 1.0.md has released "2026-11-28", expected a timestamp with a date, a time and a zone'))
  assert.throws(() => parseRelease('---\ntag: v1..2\n---\n', '1.0'),
    doctor('INVALID_INPUT', 'release file 1.0.md has tag "v1..2", expected a git tag name'))
  // The YAML reader yields no line break inside a value, so a lone carriage return fails to parse instead.
  assert.throws(() => parseRelease('---\nname: One\rTwo\n---\n', '1.0'), doctor('INVALID_INPUT'))
})

test('parseRelease rejects a tag that YAML reads as a number and asks to quote it', () => {
  assert.throws(() => parseRelease('---\ntag: 2.10\n---\n', '2.10'),
    doctor('INVALID_INPUT', 'release file 2.10.md has tag 2.1, which is not text. Put the tag in quotes'))
  assert.equal(parseRelease('---\ntag: "2.10"\n---\n', '2.10').tag, '2.10')
})

test('parseRelease throws CONFLICT on conflict markers', () => {
  assert.throws(() => parseRelease('---\n<<<<<<< HEAD\nname: A\n=======\nname: B\n>>>>>>> x\n---\n', '1.0'), doctor('CONFLICT'))
})

test('parseRelease keeps unknown keys in extra and serializeRelease writes them back', () => {
  const text = '---\nname: Webhooks\nowner: ana\n---\n'
  const release = parseRelease(text, '1.2.0')
  assert.deepEqual(release.extra, { owner: 'ana' })
  assert.equal(serializeRelease(release), text)
})

test('serializeRelease writes keys in order and the description after a blank line', () => {
  assert.equal(serializeRelease({ name: '1.2.0', tag: 'v1.2.0', target: '2026-11-30' }), '---\nname: 1.2.0\ntag: v1.2.0\ntarget: 2026-11-30\n---\n')
  assert.ok(serializeRelease({ name: 'A', description: 'Notes.' }).endsWith('---\n\nNotes.\n'))
})

test('a numeric-looking name round-trips as a string', () => {
  const release = parseRelease(serializeRelease({ name: '2026.10' }), '2026.10')
  assert.equal(release.name, '2026.10')
})

test('compareReleaseIds and sortReleases order versions naturally', () => {
  const sorted = (ids) => sortReleases(ids.map((id) => ({ id }))).map((r) => r.id)
  assert.deepEqual(sorted(['1.10.0', '1.9.0', '1.2.0']), ['1.2.0', '1.9.0', '1.10.0'])
  assert.deepEqual(sorted(['1.0.0', '1.0.0-rc.1']), ['1.0.0-rc.1', '1.0.0'])
  assert.deepEqual(sorted(['1.0.0-rc.10', '1.0.0-rc.2']), ['1.0.0-rc.2', '1.0.0-rc.10'])
  assert.deepEqual(sorted(['1.3.0', 'v1.2.0', '1.1.0']), ['1.1.0', 'v1.2.0', '1.3.0'])
  assert.deepEqual(sorted(['v1.2.0', '1.2.0']), ['1.2.0', 'v1.2.0'])
  assert.deepEqual(sorted(['2026.10', '2026.9']), ['2026.9', '2026.10'])
  assert.equal(compareReleaseIds('1.0', '1.0'), 0)
})
