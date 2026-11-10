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
  assert.deepEqual(findTodos('s = """\n# TODO: in a string\n"""', 'a.py'), [])
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
  assert.deepEqual(whole, { issues: [issue('ISS-1')], problems: [], incomplete: false, cut: false, unread: { count: 0, ids: [] } })
  const broken = await readExistingIssues(tracker({ issues: [issue('ISS-1')], problems: [{ id: 'ISS-9', code: 'INVALID_INPUT', message: 'conflict' }, { code: 'X', message: 'no id' }] }))
  assert.equal(broken.incomplete, true)
  assert.deepEqual(broken.unread, { count: 2, ids: ['ISS-9'] })
  assert.equal(calls[0].archived, true)
  assert.ok(calls[0].limit >= 10000)
  const more = await readExistingIssues(tracker({ issues: [], problems: [], hasMore: true }))
  assert.deepEqual([more.incomplete, more.cut, more.unread.count], [true, true, 0])
  const full = Array.from({ length: 5 }, (_, i) => issue(`ISS-${i}`))
  const atLimit = await readExistingIssues(tracker({ issues: full, problems: [] }), { limit: 5 })
  assert.deepEqual([atLimit.incomplete, atLimit.cut], [true, true])
  assert.equal(broken.cut, false)
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
    '.gitignore': ['# TODO: x'], 'issues.gitignore': ['# TODO: x'], '.gitattributes': ['# TODO: x'], '.dockerignore': ['# TODO: x'], 'tsconfig.json': ['// TODO: x'], 'a.jsonc': ['/* TODO: x */'],
  }
  for (const [file, lines] of Object.entries(cases)) for (const line of lines) assert.equal(findTodos(`code\n${line}\n`, file).length, 1, `${file}: ${line}`)
  assert.deepEqual(findTodos('SELECT 1; a--b TODO: x', 'a.sql'), [])
})

test('findTodos reads the block comments of sql, lua and hs', () => {
  assert.deepEqual(tags('SELECT 1;\n/* TODO: sql block */\n/*\n * FIXME: sql inner\n */\n', 'a.sql'), [[2, 'TODO', 'sql block'], [4, 'FIXME', 'sql inner']])
  assert.deepEqual(tags('x = 1\n--[[ TODO: lua block ]]\n--[[\nFIXME: lua inner\n]]\n', 'a.lua'), [[2, 'TODO', 'lua block'], [4, 'FIXME', 'lua inner']])
  assert.deepEqual(tags('x = 1\n{- TODO: hs block -}\n', 'a.hs'), [[2, 'TODO', 'hs block']])
  assert.deepEqual(tags('--[ not a block\nTODO: x\n-- TODO: after\n', 'a.lua'), [[3, 'TODO', 'after']])
  assert.deepEqual(tags("f' x = 1 -- TODO: after a prime\ng = 'a' -- TODO: after a char\n", 'a.hs'), [[1, 'TODO', 'after a prime'], [2, 'TODO', 'after a char']])
  assert.deepEqual(tags("SELECT '/* TODO: x */';\n", 'a.sql'), [])
})

test('matchTodos stays fast with 500 candidates and 5000 issues', () => {
  const candidates = groupTodos(Array.from({ length: 500 }, (_, i) => ({ file: 'f.mjs', line: i + 1, tag: 'TODO', text: `rework the module number ${i} before the release` })))
  const issues = Array.from({ length: 5000 }, (_, i) => issue(`ISS-${i}`, { title: `issue ${i}`, body: `a long body about the module and the release ${i} with the usual words` }))
  issues[10] = issue('ISS-KEY', { description: `todo-key: ${candidates[0].key}` })
  issues[20] = issue('ISS-TEXT', { body: 'Please rework the module number 7 before the release, thanks.' })
  // CPU time, not the clock: a loaded machine stalls the process and stretches wall time, but a slow matcher spends CPU.
  const started = process.cpuUsage()
  const result = matchTodos(candidates, issues)
  const used = process.cpuUsage(started)
  const ms = (used.user + used.system) / 1000
  assert.ok(ms < 5000, `took ${Math.round(ms)} ms of CPU`)
  assert.deepEqual(result.matched.map((m) => [m.issue, m.reason]).sort(), [['ISS-KEY', 'key'], ['ISS-TEXT', 'text']])
  assert.equal(result.candidates.length, 498)
})

test('matchTodos picks the first issue in list order when several match', () => {
  const candidates = groupTodos([{ file: 'a', line: 1, tag: 'TODO', text: 'refresh the documentation index' }])
  const result = matchTodos(candidates, [issue('ISS-1', { body: 'x' }), issue('ISS-2', { body: 'refresh the documentation index' }), issue('ISS-3', { title: 'refresh the documentation index' })])
  assert.equal(result.matched[0].issue, 'ISS-2')
})

test('findTodos reads HACK, XXX and @todo tags', () => {
  assert.deepEqual(tags('// HACK: skip the cache', 'a.mjs'), [[1, 'HACK', 'skip the cache']])
  assert.deepEqual(tags('# XXX broken on windows', 'a.py'), [[1, 'XXX', 'broken on windows']])
  assert.deepEqual(tags('/**\n * @todo add paging\n * @TODO(ana): x\n */', 'a.ts'), [[2, 'TODO', 'add paging'], [3, 'TODO', 'x']])
  assert.equal(findTodos('/** @fixme(bo) y */', 'a.ts')[0].owner, 'bo')
  for (const line of ['// XXXL size', '// @todos later', '// hack: lower', '// HACKS later']) assert.deepEqual(findTodos(line, 'a.mjs'), [], line)
})

test('groupTodos keeps the strongest tag: FIXME, then XXX, then HACK, then TODO', () => {
  const tagOf = (...list) => groupTodos(list.map((tag, i) => ({ file: 'a', line: i + 1, tag, text: 'same work' })))[0].tag
  assert.equal(tagOf('TODO', 'HACK'), 'HACK')
  assert.equal(tagOf('HACK', 'TODO'), 'HACK')
  assert.equal(tagOf('XXX', 'HACK'), 'XXX')
  assert.equal(tagOf('FIXME', 'XXX'), 'FIXME')
  assert.equal(tagOf('TODO'), 'TODO')
})

test('a lone quote does not hide the comment after it', () => {
  assert.deepEqual(tags("title: it's done # TODO: x", 'a.yaml'), [[1, 'TODO', 'x']])
  assert.deepEqual(tags("const re = /'/ // TODO: after a regex", 'a.mjs'), [[1, 'TODO', 'after a regex']])
  assert.deepEqual(tags("echo don't\n# TODO: next line", 'a.sh'), [[2, 'TODO', 'next line']])
  assert.deepEqual(findTodos("s = 'a # TODO: no'", 'a.py'), [])
  assert.deepEqual(findTodos("x = 'it\\'s # TODO: no'", 'a.py'), [])
  assert.deepEqual(findTodos('const s = "a \\\n// TODO: continued string"', 'a.mjs'), [])
})

test('a Python docstring reads like a block comment', () => {
  assert.deepEqual(tags('def f():\n    """TODO: docstring"""\n', 'a.py'), [[2, 'TODO', 'docstring']])
  assert.deepEqual(tags('"""Module.\n\nFIXME: second line\n"""\n', 'a.py'), [[3, 'FIXME', 'second line']])
  assert.deepEqual(tags("def g():\n    \'\'\'\n    HACK: single quotes\n    \'\'\'\n", 'a.py'), [[3, 'HACK', 'single quotes']])
  assert.deepEqual(findTodos('s = """\nTODO: in a string\n"""', 'a.py'), [])
  assert.deepEqual(findTodos('f("""TODO: an argument""")', 'a.py'), [])
})

test('the script and style elements of a markup file are read with their own syntax', () => {
  const html = '<p>x</p>\n<script>\nconst a = 1 // TODO: js\n</script>\n<style>\n/* FIXME: css */\na { background: url(//cdn.x/y.png) }\n</style>\n<!-- HACK: markup -->\n'
  assert.deepEqual(tags(html, 'a.html'), [[3, 'TODO', 'js'], [6, 'FIXME', 'css'], [9, 'HACK', 'markup']])
  assert.deepEqual(tags('<template><p/></template>\n<script setup lang="ts">\n/** @todo vue */\n</script>\n<style lang="scss">\n// TODO: scss\n</style>', 'a.vue'), [[3, 'TODO', 'vue'], [6, 'TODO', 'scss']])
  assert.deepEqual(tags('<script>// XXX: one line</script>', 'a.svelte'), [[1, 'XXX', 'one line']])
  assert.deepEqual(findTodos('<script>const s = "<!-- TODO: no -->"</script>', 'a.html'), [])
  assert.deepEqual(findTodos('<style>\n// TODO: not css\n</style>', 'a.html'), [])
  assert.deepEqual(findTodos('<script>\n// TODO: no\n</script>', 'README.md'), [])
})

/** CPU milliseconds of one findTodos call. */
const cpu = (source, file) => {
  const started = process.cpuUsage()
  findTodos(source, file)
  const used = process.cpuUsage(started)
  return (used.user + used.system) / 1000
}

/** findTodos takes about 4 times as long on 4 times the input, not 16 times. CPU time, with a floor for noise on a loaded machine. */
const assertLinear = (unit, file, size = 32 * 1024) => {
  const small = unit.repeat(Math.ceil(size / unit.length))
  const large = small.repeat(4)
  cpu(small, file) // warm up
  const t1 = cpu(small, file)
  const t4 = cpu(large, file)
  assert.ok(t4 < 8 * t1 + 100, `${file} ${JSON.stringify(unit)}: ${Math.round(t1)} ms, then ${Math.round(t4)} ms on 4 times the input`)
}

test('findTodos stays linear on a markup file with many script elements', () => {
  const html = Array.from({ length: 20000 }, (_, i) => `<p>row ${i}</p><script>// TODO: item ${i}</script>`).join('\n')
  const found = findTodos(html, 'a.html')
  assert.equal(found.length, 20000)
  assert.deepEqual(found[19999], { line: 20000, tag: 'TODO', owner: '', text: 'item 19999' })
  assertLinear('<p>row</p><script>// TODO: item</script>\n', 'a.html')
})

test('findTodos stays linear on lines full of lone quotes and triple quotes', () => {
  assertLinear("\\'", 'a.mjs')
  assertLinear('/\\"/;', 'a.mjs')
  assertLinear('x="""a""";', 'a.py')
  assertLinear("'", 'a.yaml')
})

test('findTodos stays linear on markup elements that never close', () => {
  assertLinear('<script href="a.js"/>', 'a.svg')
  assertLinear('<p><style x</p>', 'a.html')
  assertLinear('<script>', 'a.html')
  assertLinear('<style>', 'a.html')
  assertLinear('<!--', 'a.html')
  assertLinear('<script', 'a.html')
})

test('a self-closing element, an element quoted in a comment and an element with no close leave the markup readable', () => {
  assert.deepEqual(tags('<svg><script href="a.js"/>\n<!-- TODO: x -->\n<script>b()</script></svg>', 'a.svg'), [[2, 'TODO', 'x']])
  assert.deepEqual(tags('<style name="X" parent="Y"/>\n<!-- TODO: y -->\n<style name="Z">\n</style>', 'a.xml'), [[2, 'TODO', 'y']])
  assert.deepEqual(tags('<!-- TODO: move the <script> below -->\n<p>x</p>\n<!-- FIXME: lost? -->\n<script>a()</script>', 'a.html'), [[1, 'TODO', 'move the <script> below'], [3, 'FIXME', 'lost?']])
  assert.deepEqual(tags('<script>a()\n<!-- TODO: z -->\n', 'a.html'), [[2, 'TODO', 'z']])
  assert.deepEqual(findTodos('<script>\n// TODO: no close, so markup\n', 'a.html'), [])
  assert.deepEqual(tags('<SCRIPT>\n// TODO: upper\n</SCRIPT >\n<!-- HACK: after -->', 'a.htm'), [[2, 'TODO', 'upper'], [4, 'HACK', 'after']])
})

test('a script element that is not JavaScript stays markup', () => {
  assert.deepEqual(tags('<script type="text/x-template">\n<!-- TODO: tpl -->\n</script>', 'a.html'), [[2, 'TODO', 'tpl']])
  assert.deepEqual(tags('<script type="module">\n// TODO: mod\n</script>', 'a.html'), [[2, 'TODO', 'mod']])
  assert.deepEqual(tags("<script type='text/typescript'>\n// TODO: ts\n</script>", 'a.html'), [[2, 'TODO', 'ts']])
})

test('a CSS string is not a comment', () => {
  assert.deepEqual(findTodos('<style>.a{content:"/* TODO: no */"}</style>', 'a.html'), [])
  assert.deepEqual(findTodos("a { content: '/* TODO: no */' }", 'a.css'), [])
  assert.deepEqual(tags('a { content: "x" } /* TODO: yes */', 'a.css'), [[1, 'TODO', 'yes']])
})

test('a Python docstring may have a string prefix', () => {
  assert.deepEqual(tags('def f():\n    r"""TODO: raw"""\n', 'a.py'), [[2, 'TODO', 'raw']])
  assert.deepEqual(tags("def g():\n    u'''FIXME: unicode'''\n", 'a.py'), [[2, 'FIXME', 'unicode']])
  assert.deepEqual(findTodos('x = r"""TODO: no"""', 'a.py'), [])
})

test('an ignore file reads # as a comment only at the start of a line', () => {
  assert.deepEqual(tags('build/ # TODO: a pattern\n# TODO: a comment\n"quoted\n# FIXME: after a quote\n', '.gitignore'), [[2, 'TODO', 'a comment'], [4, 'FIXME', 'after a quote']])
  assert.deepEqual(tags('*.png binary # TODO: no\n# HACK: yes\n', 'templates/issues.gitattributes'), [[2, 'HACK', 'yes']])
})
