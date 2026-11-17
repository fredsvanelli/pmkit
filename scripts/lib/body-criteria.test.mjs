import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDescription, parseDescription } from './body-criteria.mjs'

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
