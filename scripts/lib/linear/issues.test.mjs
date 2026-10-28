import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDescription, isIssueId, issueKey, parseDescription, priorityOf } from './issues.mjs'

test('isIssueId accepts identifiers only', () => {
  for (const id of ['ACME-1', 'acme-12', 'A_B2-3']) assert.equal(isIssueId(id), true, id)
  for (const id of ['ACME', 'ACME-', '1-2', 'ACME-1a', '00000000-0000-0000-0000-000000000000', '', null]) assert.equal(isIssueId(id), false, String(id))
  assert.equal(issueKey('acme-1'), 'ACME-1')
  assert.equal(issueKey('ACMEOIL-1'), 'ACMEOIL-1')
})

test('priorities map both ways', () => {
  assert.deepEqual([1, 2, 3, 4].map(priorityOf), ['urgent', 'high', 'medium', 'low'])
  assert.equal(priorityOf(0), undefined)
  assert.equal(priorityOf(null), undefined)
})

test('the criteria section parses -, *, [x] and [X], and keeps other lines in place', () => {
  const text = 'Intro\n\n## Acceptance criteria\n\n- [ ] one\n* [x] two\nA note\n- [X] three\n\n## Notes\n\nTail'
  assert.deepEqual(parseDescription(text), {
    description: 'Intro\n\nA note\n\n## Notes\n\nTail',
    acceptanceCriteria: [{ text: 'one', done: false }, { text: 'two', done: true }, { text: 'three', done: true }],
  })
})

test('Windows line ends parse the same', () => {
  assert.deepEqual(parseDescription('Body\r\n\r\n## Acceptance criteria\r\n\r\n- [ ] one'), { description: 'Body', acceptanceCriteria: [{ text: 'one', done: false }] })
})

test('null and a description without the section', () => {
  assert.deepEqual(parseDescription(null), { description: '', acceptanceCriteria: [] })
  assert.deepEqual(parseDescription('  Body  '), { description: 'Body', acceptanceCriteria: [] })
})

test('buildDescription writes the section and parses back unchanged', () => {
  const criteria = [{ text: 'one', done: false }, { text: 'two', done: true }]
  assert.equal(buildDescription('Body', criteria), 'Body\n\n## Acceptance criteria\n\n- [ ] one\n- [x] two')
  assert.equal(buildDescription('Body', []), 'Body')
  assert.equal(buildDescription('', criteria), '## Acceptance criteria\n\n- [ ] one\n- [x] two')
  assert.deepEqual(parseDescription(buildDescription('Body', criteria)), { description: 'Body', acceptanceCriteria: criteria })
})
