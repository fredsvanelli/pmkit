import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { run } from './pmkit.mjs'
import { makeRepo, tempDir } from './test-helpers.mjs'

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', PMKIT_USER: 'fred' }

function write(root, file, content) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), content)
}

/** A git repository with the basic tracker and the given files. */
function repo(files = {}) {
  const root = makeRepo('basic')
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root, env: ENV }).status, 0)
  for (const [file, content] of Object.entries(files)) write(root, file, content)
  return root
}

const scan = async (root, args = []) => {
  const result = await run(['todos', 'scan', ...args, '--json'], { env: ENV, cwd: root })
  return { ...result, data: result.stdout.trim().startsWith('{') ? JSON.parse(result.stdout) : null }
}

test('todos scan finds TODO and FIXME comments and groups the repeats', async () => {
  const root = repo({
    'src/a.mjs': 'const a = 1\n// TODO(ana): fix the cache\n',
    'src/b.mjs': '/* FIXME fix the cache */\n# TODO: unique work item\n',
    'docs/n.md': 'TODO and FIXME are prose here\n',
  })
  const { code, data, stdout, stderr } = await scan(root)
  assert.equal(code, 0, stdout + stderr)
  assert.equal(data.candidates.length, 2)
  const cache = data.candidates.find((c) => c.text === 'fix the cache')
  assert.deepEqual(cache.locations, ['src/a.mjs:2', 'src/b.mjs:1'])
  assert.equal(cache.tag, 'FIXME')
  assert.deepEqual(data.matched, [])
})

test('todos scan honors .gitignore and skips node_modules, .issues, binaries and big files', async () => {
  const root = repo({
    '.gitignore': 'ignored.mjs\n',
    'ignored.mjs': '// TODO ignored work\n',
    'node_modules/x/index.js': '// TODO vendor work\n',
    '.issues/notes.md': '# TODO tracker work\n',
    'bin.dat': Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('// TODO binary work\n')]),
    'big.txt': `${'x'.repeat(2 * 1024 * 1024)}\n// TODO big work\n`,
    'ok.mjs': '// TODO real work\n',
  })
  const { data } = await scan(root)
  assert.deepEqual(data.candidates.map((c) => c.text), ['real work'])
})

test('todos scan --path keeps the files under a prefix', async () => {
  const root = repo({ 'src/a.mjs': '// TODO in src\n', 'lib/b.mjs': '// TODO in lib\n' })
  const { data } = await scan(root, ['--path', 'src/'])
  assert.deepEqual(data.candidates.map((c) => c.text), ['in src'])
})

test('todos scan drops a TODO that an existing issue matches and says why', async () => {
  const root = repo({ 'a.mjs': '// TODO handle the empty list\n// TODO refresh the documentation index\n// TODO new work item here\n' })
  write(root, 'd1.md', 'refresh the documentation index\n')
  const create = (title, extra = []) => run(['issues', 'create', '--title', title, ...extra, '--json'], { env: ENV, cwd: root })
  const first = await create('Empty list', ['--description-file', path.join(root, 'd1.md')]); assert.equal(first.code, 0, first.stdout + first.stderr)
  write(root, 'd2.md', 'see a.mjs:1 for details\n')
  assert.equal((await create('By source', ['--description-file', path.join(root, 'd2.md')])).code, 0)
  const { data } = await scan(root)
  assert.deepEqual(data.matched.map((m) => m.reason).sort(), ['source', 'text'])
  assert.deepEqual(data.candidates.map((c) => c.text), ['new work item here'])
})

test('a second scan after creating the issues from the candidates finds nothing to create', async () => {
  const root = repo({ 'a.mjs': '// TODO build the export\n// FIXME build the export\n' })
  const { data } = await scan(root)
  assert.equal(data.candidates.length, 1)
  const [candidate] = data.candidates
  write(root, 'body.md', candidate.description)
  const created = await run(['issues', 'create', '--title', candidate.title, '--description-file', path.join(root, 'body.md'), '--json'], { env: ENV, cwd: root })
  assert.equal(created.code, 0, created.stderr)
  const again = await scan(root)
  assert.deepEqual(again.data.candidates, [])
  assert.deepEqual(again.data.matched.map((m) => m.reason), ['key'])
})

test('todos scan still matches the issue after the line number moves', async () => {
  const root = repo({ 'a.mjs': '// TODO build the export\n' })
  const { data } = await scan(root)
  write(root, 'body.md', data.candidates[0].description)
  await run(['issues', 'create', '--title', 'x', '--description-file', path.join(root, 'body.md'), '--json'], { env: ENV, cwd: root })
  write(root, 'a.mjs', 'const a = 1\n\n\n// TODO build the export\n')
  assert.equal((await scan(root)).data.candidates.length, 0)
})

test('todos scan reads 20000 TODO lines', async () => {
  const lines = Array.from({ length: 20000 }, (_, i) => `// TODO item number ${i} with a long enough text`).join('\n')
  const root = repo({ 'many.mjs': lines })
  const { code, data } = await scan(root)
  assert.equal(code, 0)
  assert.equal(data.candidates.length, 20000)
})

test('todos scan prints tables in text mode and says when nothing is found', async () => {
  const root = repo({ 'a.mjs': '// TODO build the export\n' })
  const text = await run(['todos', 'scan'], { env: ENV, cwd: root })
  assert.match(text.stdout, /build the export/)
  assert.match(text.stdout, /a\.mjs:1/)
  const empty = await run(['todos', 'scan'], { env: ENV, cwd: repo({}) })
  assert.match(empty.stdout, /no TODO or FIXME found/)
})

test('todos scan refuses a directory that is not a git repository', async () => {
  const outer = tempDir('pmkit-nogit-')
  const root = path.join(outer, 'repo')
  fs.cpSync(path.join(makeRepo('basic')), root, { recursive: true })
  const result = await run(['todos', 'scan', '--json'], { env: { ...ENV, GIT_CEILING_DIRECTORIES: outer }, cwd: root })
  assert.equal(result.code, 2)
  assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
})
