import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseView, serializeView, validViewName } from './lib/local/views.mjs'

test('validViewName accepts letters, digits, dots, underscores and dashes, and refuses paths', () => {
  for (const name of ['mine', 'open-bugs', 'v1.0', 'a_b', 'A1']) assert.equal(validViewName(name), true, name)
  for (const name of ['a/b', '..', '', '-a', 'a b', undefined, 5]) assert.equal(validViewName(name), false, String(name))
})

test('a filter round trips through the file and keeps sprint current symbolic', () => {
  const filter = { categories: ['in_progress', 'in_review'], assignee: 'me', sprint: 'current', blocked: true, limit: 5, text: '123', sort: 'priority' }
  const text = serializeView(filter)
  assert.match(text, /sprint: current/)
  assert.deepEqual(parseView(text, 'mine'), { name: 'mine', filter })
})

test('parseView refuses a file whose filter is not a map', () => {
  for (const text of ['filter: 3\n', 'other: 1\n', '']) {
    assert.throws(() => parseView(text, 'x'), (error) => error.code === 'INVALID_INPUT' && error.nextStep === '/pmkit:local:doctor', text)
  }
}
)
