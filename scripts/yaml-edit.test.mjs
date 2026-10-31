import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addMapEntry, removeKey, setMap, setScalar, setSchemaLine } from './lib/yaml-edit.mjs'
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
  assert.equal(setScalar('a: 1\n', ['a'], '# x'), 'a: "# x"\n')
})
test('setScalar writes an array as a flow list', () => {
  assert.equal(setScalar('estimate:\n  scale: [1, 2]\n', ['estimate', 'scale'], ['XS', 'S']), 'estimate:\n  scale: [XS, S]\n')
})
test('setScalar adds a top-level key and rejects a missing parent or a flow map crossing', () => {
  assert.equal(setScalar('a: 1\n# end\n', ['b'], 2), 'a: 1\nb: 2\n# end\n')
  assert.throws(() => setScalar('a: 1\n', ['a', 'y'], 1), /a/)
  assert.throws(() => setScalar('m: { a: 1 }\n', ['m', 'a'], 2), /m\.a/)
})
test('setScalar adds mappings.status.blocked to a file with no mappings block and keeps the comments', () => {
  const text = '# top\nversion: 1\nwrite_policy:\n  confirm: none   # none | all_writes\n# end\n'
  const out = setScalar(text, ['mappings', 'status', 'blocked'], 'none')
  assert.equal(out, '# top\nversion: 1\nwrite_policy:\n  confirm: none   # none | all_writes\nmappings:\n  status:\n    blocked: none\n# end\n')
  assert.deepEqual(parseYaml(out).mappings, { status: { blocked: 'none' } })
})
test('setScalar adds a key under an existing mappings.status and a status block under existing mappings', () => {
  assert.equal(setScalar('mappings:\n  status:\n    in_review: In Review\nother: 1\n', ['mappings', 'status', 'blocked'], 'none'),
    'mappings:\n  status:\n    in_review: In Review\n    blocked: none\nother: 1\n')
  assert.equal(setScalar('mappings:\n  fields:\n    estimate: native\n', ['mappings', 'status', 'blocked'], 'none'),
    'mappings:\n  fields:\n    estimate: native\n  status:\n    blocked: none\n')
})
test('setMap writes mappings.types with two entries in the given order', () => {
  const out = setMap('version: 1\nmappings:\n  status:\n    in_review: In Review\n', ['mappings', 'types'], { feature: 'Feature', bug: 'Bug' })
  assert.equal(out, 'version: 1\nmappings:\n  status:\n    in_review: In Review\n  types:\n    feature: Feature\n    bug: Bug\n')
  assert.deepEqual(Object.keys(parseYaml(out).mappings.types), ['feature', 'bug'])
})
test('setMap writes an empty object as "types: {}"', () => {
  const out = setMap('version: 1\n', ['mappings', 'types'], {})
  assert.equal(out, 'version: 1\nmappings:\n  types: {}\n')
  assert.deepEqual(parseYaml(out).mappings.types, {})
})
test('setMap quotes a label the YAML subset would misread', () => {
  const out = setMap('a: 1\n', ['types'], { bug: 'Bug: severe' })
  assert.deepEqual(parseYaml(out).types, { bug: 'Bug: severe' })
})
test('setMap replaces an existing types block and leaves the lines around it', () => {
  const text = 'mappings:\n  status:\n    blocked: none\n  types:\n    bug: Bug\n    task: Task\n  # kept\nafter: 1\n'
  assert.equal(setMap(text, ['mappings', 'types'], { chore: 'Chore' }),
    'mappings:\n  status:\n    blocked: none\n  types:\n    chore: Chore\n  # kept\nafter: 1\n')
  assert.equal(setMap('mappings:\n  types: {}\nz: 1\n', ['mappings', 'types'], { bug: 'Bug' }), 'mappings:\n  types:\n    bug: Bug\nz: 1\n')
  assert.equal(setMap('mappings:\n  types:\n    bug: Bug\nz: 1\n', ['mappings', 'types'], {}), 'mappings:\n  types: {}\nz: 1\n')
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

const URL_NOW = 'https://raw.githubusercontent.com/fredsvanelli/pmkit/main/schemas/pmkit.config.schema.json'
const LINE = `# yaml-language-server: $schema=${URL_NOW}`

test('setSchemaLine inserts the line first and keeps the rest byte-equal', () => {
  assert.equal(setSchemaLine('a: 1\n\n# note\nb: 2\n', URL_NOW), `${LINE}\na: 1\n\n# note\nb: 2\n`)
})
test('setSchemaLine replaces an old pmkit line with another ref in place', () => {
  const old = '# yaml-language-server: $schema=https://raw.githubusercontent.com/fredsvanelli/pmkit/v0.1.0/schemas/issues.config.schema.json'
  assert.equal(setSchemaLine(`${old}\na: 1\n`, URL_NOW), `${LINE}\na: 1\n`)
  assert.equal(setSchemaLine(`# top\n${old}\na: 1\n`, URL_NOW), `# top\n${LINE}\na: 1\n`)
})
test('setSchemaLine leaves a line for another host unchanged', () => {
  const other = '# yaml-language-server: $schema=https://example.com/my.schema.json\r\na: 1\r\n'
  assert.equal(setSchemaLine(other, URL_NOW), other)
  const fork = '# yaml-language-server: $schema=https://raw.githubusercontent.com/someone/else/main/schemas/pmkit.config.schema.json\na: 1\n'
  assert.equal(setSchemaLine(fork, URL_NOW), fork)
})
test('setSchemaLine gives an empty text the line and a newline', () => {
  assert.equal(setSchemaLine('', URL_NOW), `${LINE}\n`)
})
test('setSchemaLine puts the line before another comment', () => {
  assert.equal(setSchemaLine('# hello\na: 1\n', URL_NOW), `${LINE}\n# hello\na: 1\n`)
})
test('setSchemaLine normalizes CRLF and a BOM', () => {
  const out = setSchemaLine('\uFEFFa: 1\r\nb: 2\r\n', URL_NOW)
  assert.equal(out, `${LINE}\na: 1\nb: 2\n`)
  assert.ok(!out.includes('\r') && !out.includes('\uFEFF'))
})
test('setSchemaLine twice gives the same text', () => {
  const once = setSchemaLine('a: 1\n', URL_NOW)
  assert.equal(setSchemaLine(once, URL_NOW), once)
})

test('removeKey drops one scalar line and keeps the neighbors and the comments', () => {
  const text = '# top\ngit_host:\n  system: github # host\n  repo: o/r\n  default_branch: main\nwrite_policy:\n  confirm: none\n'
  assert.equal(removeKey(text, ['git_host', 'repo']), '# top\ngit_host:\n  system: github # host\n  default_branch: main\nwrite_policy:\n  confirm: none\n')
})

test('removeKey removes the block under a key and leaves the next sibling', () => {
  const text = 'tracker:\n  system: linear\n  scope:\n    workspace: acme\n    team: ACME\ngit_host:\n  system: none\n'
  assert.equal(removeKey(text, ['tracker', 'scope']), 'tracker:\n  system: linear\ngit_host:\n  system: none\n')
})

test('removeKey returns the text unchanged when the key or its parent is missing', () => {
  const text = 'git_host:\n  system: none\n'
  assert.equal(removeKey(text, ['git_host', 'repo']), text)
  assert.equal(removeKey(text, ['tracker', 'scope', 'team']), text)
})

test('removeKey reads CRLF and writes LF', () => {
  assert.equal(removeKey('git_host:\r\n  system: none\r\n  repo: o/r\r\n', ['git_host', 'repo']), 'git_host:\n  system: none\n')
})
