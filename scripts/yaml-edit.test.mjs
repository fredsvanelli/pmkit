import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addMapEntry, setScalar } from './lib/yaml-edit.mjs'
import { parseYaml } from './lib/yaml.mjs'

test('setScalar changes one value and keeps the comment on that line', () => {
  const text = 'version: 1\ngit_host:\n  system: none          # github | none\n  default_branch: main\n'
  assert.equal(setScalar(text, ['git_host', 'system'], 'github'),
    'version: 1\ngit_host:\n  system: github          # github | none\n  default_branch: main\n')
})
test('setScalar adds a missing key at the end of its parent block', () => {
  const text = 'git_host:\n  system: github\nwrite_policy:\n  confirm: none\n'
  assert.equal(setScalar(text, ['git_host', 'repo'], 'fred/app'),
    'git_host:\n  system: github\n  repo: fred/app\nwrite_policy:\n  confirm: none\n')
})
test('setScalar quotes a value the YAML subset would misread', () => {
  assert.equal(setScalar('a: 1\n', ['a'], '# x'), "a: '# x'\n")
})
test('setScalar writes an array as a flow list', () => {
  assert.equal(setScalar('estimate:\n  scale: [1, 2]\n', ['estimate', 'scale'], ['XS', 'S']), 'estimate:\n  scale: [XS, S]\n')
})
test('setScalar adds a top-level key and rejects a missing parent or a flow map crossing', () => {
  assert.equal(setScalar('a: 1\n# end\n', ['b'], 2), 'a: 1\nb: 2\n# end\n')
  assert.throws(() => setScalar('a: 1\n', ['x', 'y'], 1), /x/)
  assert.throws(() => setScalar('m: { a: 1 }\n', ['m', 'a'], 2), /m\.a/)
})
test('addMapEntry turns an empty flow map into a block map', () => {
  assert.equal(addMapEntry('members: {}\nauto_commit: false\n', ['members'], 'ana', { name: 'Ana', email: 'ana@x.io' }),
    'members:\n  ana: { name: Ana, email: ana@x.io }\nauto_commit: false\n')
})
test('addMapEntry appends after the last entry and refuses an existing key', () => {
  const text = 'members:\n  fred: { name: Fred }\n'
  assert.equal(addMapEntry(text, ['members'], 'ana', { name: 'Ana' }), 'members:\n  fred: { name: Fred }\n  ana: { name: Ana }\n')
  assert.throws(() => addMapEntry(text, ['members'], 'fred', { name: 'F' }), /already/)
})
test('every result parses with parseYaml', () => {
  assert.deepEqual(
    parseYaml(setScalar('version: 1\ngit_host:\n  system: none          # github | none\n  default_branch: main\n', ['git_host', 'system'], 'github')),
    { version: 1, git_host: { system: 'github', default_branch: 'main' } })
  assert.deepEqual(
    parseYaml(setScalar('git_host:\n  system: github\nwrite_policy:\n  confirm: none\n', ['git_host', 'repo'], 'fred/app')),
    { git_host: { system: 'github', repo: 'fred/app' }, write_policy: { confirm: 'none' } })
  assert.deepEqual(parseYaml(setScalar('a: 1\n', ['a'], '# x')), { a: '# x' })
  assert.deepEqual(parseYaml(setScalar('estimate:\n  scale: [1, 2]\n', ['estimate', 'scale'], ['XS', 'S'])), { estimate: { scale: ['XS', 'S'] } })
  assert.deepEqual(
    parseYaml(addMapEntry('members: {}\nauto_commit: false\n', ['members'], 'ana', { name: 'Ana', email: 'ana@x.io' })),
    { members: { ana: { name: 'Ana', email: 'ana@x.io' } }, auto_commit: false })
  assert.deepEqual(
    parseYaml(addMapEntry('members:\n  fred: { name: Fred }\n', ['members'], 'ana', { name: 'Ana' })),
    { members: { fred: { name: 'Fred' }, ana: { name: 'Ana' } } })
})
