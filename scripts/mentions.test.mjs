import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mentionedIn } from './lib/mentions.mjs'

test('mentionedIn finds an ID as a whole token', () => {
  const has = mentionedIn('ISS-1')
  assert.equal(has('See ISS-1.'), true)
  assert.equal(has('see iss-1'), false, 'the match is case sensitive, as deleteIssue is')
  assert.equal(has('ISS-10'), false)
  assert.equal(has('XISS-1'), false)
  assert.equal(has('ISS-1_x'), false)
  assert.equal(has('ISS-1/ISS-2'), true)
})

test('mentionedIn ignores URLs, link targets and paths', () => {
  const has = mentionedIn('ISS-1')
  assert.equal(has('https://example.com/ISS-1'), false)
  assert.equal(has('[the issue](docs/ISS-1.md)'), false)
  assert.equal(has('[ISS-1](docs/other.md)'), true)
  assert.equal(has('see src/ISS-1/notes.txt'), false)
})
