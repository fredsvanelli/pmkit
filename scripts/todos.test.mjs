import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findTodos, groupTodos, matchTodos, normalizeText, readExistingIssues, todoKey } from './lib/todos.mjs'

const tags = (source, file) => findTodos(source, file).map((t) => [t.line, t.tag, t.text])

test('findTodos reads the tag, the owner and the text of a comment after code', () => {
  assert.deepEqual(findTodos('const a = 1 // TODO(ana): fix the cache', 'a.mjs'), [{ line: 1, tag: 'TODO', owner: 'ana', text: 'fix the cache' }])
  assert.deepEqual(tags('x = 1  # FIXME handle the empty list', 'a.py'), [[1, 'FIXME', 'handle the empty list']])
})

test('findTodos keeps the first tag of a comment', () => {
  assert.deepEqual(tags('// FIXME: TODO items are not sorted', 'a.mjs'), [[1, 'FIXME', 'TODO items are not sorted']])
})

test('findTodos accepts a text right after the colon', () => {
  assert.deepEqual(tags('// TODO:fix', 'a.mjs'), [[1, 'TODO', 'fix']])
})

test('findTodos ignores other words, lowercase tags and a tag that is not the first word of the comment', () => {
  for (const line of ['// TODO-123 later', '// TODOS later', '// todo: lowercase', '// see the TODO below', 'const x = 1']) assert.deepEqual(findTodos(line, 'a.mjs'), [], line)
})

test('findTodos ignores a comment mark inside a string or a URL', () => {
  assert.deepEqual(findTodos('const s = "// TODO: not a comment"', 'a.mjs'), [])
  assert.deepEqual(findTodos("const u = 'http://x.dev/ // TODO: no'", 'a.mjs'), [])
  assert.deepEqual(tags('fetch("http://x.dev") // TODO: retry', 'a.mjs'), [[1, 'TODO', 'retry']])
  assert.deepEqual(findTodos('const t = `\n// TODO: inside a template\n`', 'a.mjs'), [])
})

test('findTodos reads each line of a block comment', () => {
  assert.deepEqual(tags('/*\n * TODO: first\n * FIXME: second\n */\nconst a = 1', 'a.ts'), [[2, 'TODO', 'first'], [3, 'FIXME', 'second']])
  assert.deepEqual(tags('/* TODO: one line */', 'a.css'), [[1, 'TODO', 'one line']])
})

test('findTodos reads Markdown only inside an HTML comment, not in prose, inline code or fences', () => {
  assert.deepEqual(findTodos('Prose TODO: x\n# TODO: heading\n', 'README.md'), [])
  assert.deepEqual(tags('text\n<!-- TODO: add a link -->\n', 'README.md'), [[2, 'TODO', 'add a link']])
  assert.deepEqual(findTodos('use `<!-- TODO: x -->` here', 'README.md'), [])
  assert.deepEqual(findTodos('```html\n<!-- TODO: x -->\n```\n', 'README.md'), [])
})

test('findTodos knows the comment marks of each language', () => {
  assert.deepEqual(tags('x = 1 # TODO: a', 'a.py'), [[1, 'TODO', 'a']])
  assert.deepEqual(findTodos('s = "# TODO: no"', 'a.py'), [])
  assert.deepEqual(findTodos('"""\n# TODO: docstring\n"""', 'a.py'), [])
  assert.deepEqual(tags('echo "$#"; # TODO: real', 'a.sh'), [[1, 'TODO', 'real']])
  assert.deepEqual(findTodos('echo $# TODO: no', 'a.sh'), [])
  assert.deepEqual(tags('x = 1 # FIXME: rb', 'a.rb'), [[1, 'FIXME', 'rb']])
  assert.deepEqual(tags('x := 1 // TODO: go', 'a.go'), [[1, 'TODO', 'go']])
  assert.deepEqual(tags("let c = 'a'; // TODO: rs", 'a.rs'), [[1, 'TODO', 'rs']])
  assert.deepEqual(tags("fn f<'a>() {} // TODO: lifetime", 'a.rs'), [[1, 'TODO', 'lifetime']])
  assert.deepEqual(tags('key: v # TODO: y', 'a.yaml'), [[1, 'TODO', 'y']])
  assert.deepEqual(findTodos('url: http://x.dev/#TODO: y', 'a.yml'), [])
  assert.deepEqual(tags('<!-- FIXME x -->', 'a.html'), [[1, 'FIXME', 'x']])
  assert.deepEqual(findTodos('// TODO not a css comment', 'a.css'), [])
})

test('findTodos skips a file type it does not know', () => {
  assert.deepEqual(findTodos('// TODO: x\n# TODO: y', 'notes.txt'), [])
  assert.deepEqual(findTodos('// TODO: x', 'noextension'), [])
})

test('findTodos returns an empty text for a bare tag', () => {
  assert.equal(findTodos('// TODO', 'a.mjs')[0].text, '')
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

const issue = (id, fields) => ({ id, title: 't', description: '', body: '', status: { name: 'todo' }, archived: false, ...fields })

test('matchTodos matches by key and by text, and keeps the rest', () => {
  const candidates = groupTodos([
    { file: 'a.mjs', line: 1, tag: 'TODO', text: 'handle the empty list' },
    { file: 'c.mjs', line: 5, tag: 'TODO', text: 'write the export code today' },
    { file: 'd.mjs', line: 9, tag: 'TODO', text: 'fix' },
    { file: 'e.mjs', line: 9, tag: 'TODO', text: 'untouched work item' },
  ])
  const issues = [
    issue('ISS-1', { description: `x\n\ntodo-key: ${todoKey('handle the empty list')}\n`, status: { name: 'done' } }),
    issue('ISS-3', { body: 'We must Write the export code TODAY.', status: { name: 'backlog' }, archived: true }),
    issue('ISS-4', { description: 'we should fix everything' }),
  ]
  const result = matchTodos(candidates, issues)
  assert.deepEqual(result.matched.map((m) => [m.issue, m.reason, m.status]).sort(), [['ISS-1', 'key', 'done'], ['ISS-3', 'text', 'backlog']])
  assert.deepEqual(result.candidates.map((c) => c.text).sort(), ['fix', 'untouched work item'])
})

test('matchTodos keeps the title and description of a matched comment, so the user can move it back', () => {
  const candidates = groupTodos([{ file: 'a.mjs', line: 1, tag: 'TODO', text: 'handle the empty list' }])
  const [match] = matchTodos(candidates, [issue('ISS-1', { description: `todo-key: ${candidates[0].key}` })]).matched
  assert.equal(match.title, 'handle the empty list')
  assert.match(match.description, /^handle the empty list\n\nSource: `a\.mjs:1`/)
})

test('an issue that lists an old line does not cover a new TODO on that line', () => {
  const candidates = groupTodos([{ file: 'src/a.mjs', line: 12, tag: 'TODO', text: 'a brand new piece of work' }])
  const result = matchTodos(candidates, [issue('ISS-1', { description: 'The old TODO at `src/a.mjs:12` was about the cache.' })])
  assert.equal(result.matched.length, 0)
  assert.equal(result.candidates.length, 1)
})

test('matchTodos matches the text on word boundaries only', () => {
  const candidates = groupTodos([{ file: 'a', line: 1, tag: 'TODO', text: 'refresh the index' }])
  assert.equal(matchTodos(candidates, [issue('ISS-1', { body: 'prefresh the indexes' })]).matched.length, 0)
  assert.equal(matchTodos(candidates, [issue('ISS-1', { body: 'Please refresh the index, then stop.' })]).matched.length, 1)
})

test('readExistingIssues reads with a large limit and flags a read the tracker cut', async () => {
  const calls = []
  const tracker = (answer) => ({ searchIssues: async (filter) => { calls.push(filter); return answer } })
  const whole = await readExistingIssues(tracker({ issues: [issue('ISS-1')], problems: [] }))
  assert.deepEqual(whole, { issues: [issue('ISS-1')], problems: [], incomplete: false })
  assert.equal(calls[0].archived, true)
  assert.ok(calls[0].limit >= 10000)
  assert.equal((await readExistingIssues(tracker({ issues: [], problems: [], hasMore: true }))).incomplete, true)
  const full = Array.from({ length: 5 }, (_, i) => issue(`ISS-${i}`))
  assert.equal((await readExistingIssues(tracker({ issues: full, problems: [] }), { limit: 5 })).incomplete, true)
})

test('findTodos reads a file with CRLF line endings', () => {
  assert.deepEqual(tags('// TODO: fix the cache\r\n', 'a.mjs'), [[1, 'TODO', 'fix the cache']])
  assert.equal(findTodos('// TODO\r\n', 'a.mjs')[0].text, '')
  assert.deepEqual(tags('/*\r\n * FIXME: second\r\n */\r\nx # TODO: no\r\n', 'a.ts'), [[2, 'FIXME', 'second']])
  assert.deepEqual(tags('a = 1\r\n# TODO: py line two\r\n', 'a.py'), [[2, 'TODO', 'py line two']])
})

test('findTodos knows more languages', () => {
  const cases = {
    'a.php': ['// TODO: php slash', '# TODO: php hash'], 'a.scala': ['// TODO: x'], 'a.dart': ['// TODO: x'], 'a.gradle': ['// TODO: x'], 'a.kts': ['// TODO: x'],
    'a.scss': ['// TODO: x'], 'a.less': ['// TODO: x'], 'a.svelte': ['<!-- TODO: x -->'], 'a.tf': ['# TODO: x', '// TODO: y'], 'a.r': ['# TODO: x'], 'a.pl': ['# TODO: x'],
    'a.ex': ['# TODO: x'], 'a.exs': ['# TODO: x'], 'a.ps1': ['# TODO: x'], 'a.mk': ['# TODO: x'], Containerfile: ['# TODO: x'], Gemfile: ['# TODO: x'], Rakefile: ['# TODO: x'],
    'a.sql': ['-- TODO: x'], 'a.lua': ['-- TODO: x'], 'a.hs': ['-- TODO: x'],
  }
  for (const [file, lines] of Object.entries(cases)) for (const line of lines) assert.equal(findTodos(`code\n${line}\n`, file).length, 1, `${file}: ${line}`)
  assert.deepEqual(findTodos('SELECT 1; a--b TODO: x', 'a.sql'), [])
})

test('matchTodos stays fast with 500 candidates and 5000 issues', () => {
  const candidates = groupTodos(Array.from({ length: 500 }, (_, i) => ({ file: 'f.mjs', line: i + 1, tag: 'TODO', text: `rework the module number ${i} before the release` })))
  const issues = Array.from({ length: 5000 }, (_, i) => issue(`ISS-${i}`, { title: `issue ${i}`, body: `a long body about the module and the release ${i} with the usual words` }))
  issues[10] = issue('ISS-KEY', { description: `todo-key: ${candidates[0].key}` })
  issues[20] = issue('ISS-TEXT', { body: 'Please rework the module number 7 before the release, thanks.' })
  const started = Date.now()
  const result = matchTodos(candidates, issues)
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started} ms`)
  assert.deepEqual(result.matched.map((m) => [m.issue, m.reason]).sort(), [['ISS-KEY', 'key'], ['ISS-TEXT', 'text']])
  assert.equal(result.candidates.length, 498)
})

test('matchTodos picks the first issue in list order when several match', () => {
  const candidates = groupTodos([{ file: 'a', line: 1, tag: 'TODO', text: 'refresh the documentation index' }])
  const result = matchTodos(candidates, [issue('ISS-1', { body: 'x' }), issue('ISS-2', { body: 'refresh the documentation index' }), issue('ISS-3', { title: 'refresh the documentation index' })])
  assert.equal(result.matched[0].issue, 'ISS-2')
})
