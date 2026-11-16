import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findMention, mentionText } from './lib/local/inbox.mjs'

test('findMention finds a mention and returns its line', () => {
  assert.equal(findMention('hi @fred', 'fred'), 'hi @fred')
  assert.equal(findMention('x\n  @FRED please  \ny', 'fred'), '@FRED please')
  assert.equal(findMention('thanks @fred.', 'fred'), 'thanks @fred.')
  assert.equal(findMention('ask (@fred) or @fred: now', 'fred'), 'ask (@fred) or @fred: now')
  assert.equal(findMention('cc @agent:claude', 'agent:claude'), 'cc @agent:claude')
  assert.equal(findMention(`@fred ${'x'.repeat(300)}`, 'fred').length, 200)
})

test('findMention skips emails, longer names, domains and escapes', () => {
  for (const text of ['a@fred.com', '@fredo', 'x @fred.com', '\\@fred', 'x@fred', '@fred-two', '@fred_x', 'no mention', '']) {
    assert.equal(findMention(text, 'fred'), null, text)
  }
  assert.equal(findMention('@agent hi', 'agent:claude'), null)
})

test('findMention skips fenced code, an unclosed fence and inline code', () => {
  assert.equal(findMention('```\n@fred\n```', 'fred'), null)
  assert.equal(findMention('~~~sh\n@fred\n~~~', 'fred'), null)
  assert.equal(findMention('text\n```\n@fred never closed', 'fred'), null)
  assert.equal(findMention('run `@fred` now', 'fred'), null)
  assert.equal(findMention('``a `@fred` b``', 'fred'), null)
  assert.equal(findMention('```\ncode\n```\nthen @fred', 'fred'), 'then @fred')
  assert.equal(findMention('`code` and @fred', 'fred'), '`code` and @fred')
})

test('findMention cuts the excerpt at 200 characters unless full is asked, and mentionText ignores markers and spacing', () => {
  const long = `@fred ${'x'.repeat(300)}`
  assert.equal(findMention(long, 'fred', { full: true }), long)
  assert.equal(mentionText('- [ ] @fred   to  verify'), '@fred to verify')
  assert.equal(mentionText('- [x] @fred to verify'), '@fred to verify')
  assert.equal(mentionText('  1. @fred to verify '), '@fred to verify')
  assert.notEqual(mentionText('@fred to verify'), mentionText('@fred to verify it'))
})

test('findMention handles CRLF', () => {
  assert.equal(findMention('a\r\nhi @fred\r\n', 'fred'), 'hi @fred')
})

test('findMention closes a fence only with the same character and at least the same length', () => {
  assert.equal(findMention('~~~\n```\n@fred\n```\n~~~\nafter', 'fred'), null)
  assert.equal(findMention('~~~\n```\n```\n~~~\nthen @fred', 'fred'), 'then @fred')
  assert.equal(findMention('````\n```\n@fred\n```\n````\nthen @fred again', 'fred'), 'then @fred again')
  assert.equal(findMention('````\n```\n@fred\n```\n', 'fred'), null)
  assert.equal(findMention('```\n@fred\n````\nthen @fred', 'fred'), 'then @fred')
  assert.equal(findMention('   ```js\n@fred\n   ```\n@fred ok', 'fred'), '@fred ok')
  assert.equal(findMention('``` not a `fence`\n@fred', 'fred'), '@fred')
  assert.equal(findMention('```\n@fred\n``` trailing\n@fred', 'fred'), null)
})
