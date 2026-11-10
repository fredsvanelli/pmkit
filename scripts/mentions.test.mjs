import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileMentions, mentionedIn } from './lib/mentions.mjs'

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

test('fileMentions groups the git grep lines that mention the ID by file, with the mention rule', () => {
  const line = (file, n, text) => `${file}\0${n}\0${text}\n`
  const output = line('a.md', 3, 'see PMK-5') + line('a.md', 9, 'PMK-52 only') + line('b/c.mjs', 1, '// PMK-5.') + line('a.md', 12, 'and PMK-5 again') + line('d.md', 2, 'docs/PMK-5/x.md')
  assert.deepEqual(fileMentions('PMK-5', output), [{ path: 'a.md', lines: [3, 12] }, { path: 'b/c.mjs', lines: [1] }])
  assert.deepEqual(fileMentions('PMK-5', ''), [])
})

test('fileMentions keeps a path that holds a colon and a line that ends in CRLF', () => {
  assert.deepEqual(fileMentions('PMK-5', 'odd:name.md\x004\0PMK-5\r\n'), [{ path: 'odd:name.md', lines: [4] }])
})

test('fileMentions refuses output it cannot read, so a changed format is never an empty answer', () => {
  // git grep with color on wraps the fields in ANSI codes.
  assert.throws(() => fileMentions('PMK-5', 'a.md\0\x1b[32m3\x1b[m\0see PMK-5\n'), /git grep output/)
  assert.throws(() => fileMentions('PMK-5', 'a.md:3:see PMK-5\n'), /git grep output/)
})
