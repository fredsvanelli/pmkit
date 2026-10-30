import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupTodos, matchTodos, normalizeText, parseTodoLine, todoKey } from './lib/todos.mjs'

test('parseTodoLine reads the tag, the owner and the text of a comment', () => {
  assert.deepEqual(parseTodoLine('  // TODO(ana): fix the cache */'), { tag: 'TODO', owner: 'ana', text: 'fix the cache' })
  assert.deepEqual(parseTodoLine('# FIXME handle the empty list'), { tag: 'FIXME', owner: '', text: 'handle the empty list' })
  assert.deepEqual(parseTodoLine('<!-- TODO: add a link -->'), { tag: 'TODO', owner: '', text: 'add a link' })
  assert.equal(parseTodoLine(' * TODO: in a block comment').text, 'in a block comment')
})

test('parseTodoLine ignores prose, other words and lowercase tags', () => {
  assert.equal(parseTodoLine('TODO and FIXME become issues'), null)
  assert.equal(parseTodoLine('# TODOS later'), null)
  assert.equal(parseTodoLine('// todo: lowercase'), null)
  assert.equal(parseTodoLine('const x = 1'), null)
})

test('parseTodoLine returns an empty text for a bare tag', () => {
  assert.equal(parseTodoLine('// TODO').text, '')
})

test('todoKey ignores case, spacing and edge punctuation, and has 12 hex characters', () => {
  assert.equal(normalizeText('  Fix  the Cache. '), 'fix the cache')
  assert.equal(todoKey('Fix  the Cache.'), todoKey('fix the cache'))
  assert.match(todoKey('x'), /^[0-9a-f]{12}$/)
  assert.notEqual(todoKey('a'), todoKey('b'))
})

test('groupTodos merges a repeated text into one candidate with every location', () => {
  const found = [
    { file: 'src/b.mjs', line: 40, tag: 'FIXME', text: 'fix the cache' },
    { file: 'src/a.mjs', line: 12, tag: 'TODO', text: 'Fix the cache.' },
    { file: 'src/a.mjs', line: 3, tag: 'TODO', text: 'other work' },
  ]
  const candidates = groupTodos(found)
  assert.equal(candidates.length, 2)
  const cache = candidates.find((c) => c.key === todoKey('fix the cache'))
  assert.deepEqual(cache.locations, ['src/a.mjs:12', 'src/b.mjs:40'])
  assert.equal(cache.tag, 'FIXME')
  assert.equal(cache.text, 'Fix the cache.')
  assert.equal(cache.description, `Fix the cache.\n\nSource: \`src/a.mjs:12\`\nAlso at: \`src/b.mjs:40\`\n\ntodo-key: ${cache.key}\n`)
  assert.equal(candidates.find((c) => c.text === 'other work').description, `other work\n\nSource: \`src/a.mjs:3\`\n\ntodo-key: ${todoKey('other work')}\n`)
})

test('groupTodos cuts a long title at 80 characters', () => {
  const [candidate] = groupTodos([{ file: 'a', line: 1, tag: 'TODO', text: 'w'.repeat(100) }])
  assert.equal(candidate.title, `${'w'.repeat(77)}...`)
})

test('matchTodos matches by key, by source and by text, and keeps the rest', () => {
  const found = [
    { file: 'a.mjs', line: 1, tag: 'TODO', text: 'handle the empty list' },
    { file: 'b.mjs', line: 20, tag: 'TODO', text: 'rename the module before release' },
    { file: 'c.mjs', line: 5, tag: 'TODO', text: 'write the export code today' },
    { file: 'd.mjs', line: 9, tag: 'TODO', text: 'fix' },
    { file: 'e.mjs', line: 9, tag: 'TODO', text: 'untouched work item' },
  ]
  const candidates = groupTodos(found)
  const issues = [
    { id: 'ISS-1', title: 'one', description: `x\n\ntodo-key: ${todoKey('handle the empty list')}\n`, body: '', status: { name: 'done' }, archived: false },
    { id: 'ISS-2', title: 'two', description: 'see b.mjs:20 for details', body: '', status: { name: 'todo' }, archived: false },
    { id: 'ISS-3', title: 'three', description: '', body: 'We must Write the export code TODAY.', status: { name: 'backlog' }, archived: true },
    { id: 'ISS-4', title: 'four', description: 'we should fix everything', body: '', status: { name: 'todo' }, archived: false },
  ]
  const result = matchTodos(candidates, issues)
  assert.deepEqual(result.matched.map((m) => [m.issue, m.reason, m.status]).sort(), [['ISS-1', 'key', 'done'], ['ISS-2', 'source', 'todo'], ['ISS-3', 'text', 'backlog']])
  assert.deepEqual(result.candidates.map((c) => c.text).sort(), ['fix', 'untouched work item'])
})

test('matchTodos does not take b.mjs:200 for b.mjs:20', () => {
  const candidates = groupTodos([{ file: 'b.mjs', line: 20, tag: 'TODO', text: 'short one' }])
  const result = matchTodos(candidates, [{ id: 'ISS-1', title: 't', description: 'b.mjs:200', body: '', status: { name: 'todo' } }])
  assert.equal(result.matched.length, 0)
})
