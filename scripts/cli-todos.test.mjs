import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { scanRepo } from './lib/todos.mjs'
import { makeRepo, tempDir } from './test-helpers.mjs'

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', PMKIT_USER: 'fred' }
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

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

const scan = async (root, args = [], options = {}) => {
  const result = await run(['todos', 'scan', ...args, '--json'], { env: ENV, cwd: root, ...options })
  return { ...result, data: result.stdout.trim().startsWith('{') ? JSON.parse(result.stdout) : null }
}

const create = (root, title, file) => run(['issues', 'create', '--title', title, '--description-file', path.join(root, file), '--json'], { env: ENV, cwd: root })

test('todos scan finds TODO and FIXME comments and groups the repeats', async () => {
  const root = repo({
    'src/a.mjs': 'const a = 1\n// TODO(ana): fix the cache\n',
    'src/b.mjs': '/* FIXME fix the cache */\n// TODO: unique work item\n',
    'docs/n.md': 'TODO and FIXME are prose here\n',
  })
  const { code, data, stdout, stderr } = await scan(root)
  assert.equal(code, 0, stdout + stderr)
  assert.equal(data.incomplete, false)
  assert.equal(data.candidates.length, 2)
  const cache = data.candidates.find((c) => c.text === 'fix the cache')
  assert.deepEqual(cache.locations, ['src/a.mjs:2', 'src/b.mjs:1'])
  assert.equal(cache.tag, 'FIXME')
  assert.deepEqual(data.matched, [])
})

test('todos scan honors .gitignore and skips node_modules, the tracker folder, binaries, big files and symbolic links', async () => {
  const root = repo({
    '.gitignore': 'ignored.mjs\n',
    'ignored.mjs': '// TODO ignored work\n',
    'node_modules/x/index.js': '// TODO vendor work\n',
    '.issues/notes.mjs': '// TODO tracker work\n',
    'bin.mjs': Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('\n// TODO binary work\n')]),
    'big.mjs': `// ${'x'.repeat(2 * 1024 * 1024)}\n// TODO big work\n`,
    'ok.mjs': '// TODO real work\n',
  })
  const outside = tempDir('pmkit-outside-')
  write(outside, 'out.mjs', '// TODO outside work\n')
  fs.symlinkSync(path.join(outside, 'out.mjs'), path.join(root, 'link-out.mjs'))
  fs.symlinkSync(path.join(root, 'ok.mjs'), path.join(root, 'link-in.mjs'))
  const { data } = await scan(root)
  assert.deepEqual(data.candidates.map((c) => c.text), ['real work'])
})

test('todos scan skips the tracker folder named by tracker.path, not a fixed .issues', async () => {
  const root = repo({ 'src/a.mjs': '// TODO app work\n' })
  fs.renameSync(path.join(root, '.issues'), path.join(root, 'trk'))
  const config = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace('path: .issues', 'path: trk'))
  write(root, 'trk/x.mjs', '// TODO tracker work\n')
  write(root, '.issues/y.mjs', '// TODO old folder work\n')
  const { code, data, stdout } = await scan(root)
  assert.equal(code, 0, stdout)
  assert.deepEqual(data.candidates.map((c) => c.text).sort(), ['app work', 'old folder work'])
})

test('todos scan --path keeps the files at or under a folder, and not a folder with the same prefix', async () => {
  const root = repo({ 'src/a.mjs': '// TODO in src\n', 'src2/b.mjs': '// TODO in src2\n', 'lib/c.mjs': '// TODO in lib\n' })
  for (const arg of ['src', 'src/', './src']) assert.deepEqual((await scan(root, ['--path', arg])).data.candidates.map((c) => c.text), ['in src'], arg)
  assert.deepEqual((await scan(root, ['--path', 'src/a.mjs'])).data.candidates.map((c) => c.text), ['in src'])
})

test('todos scan --path outside the repository answers INVALID_INPUT', async () => {
  const root = repo({ 'a.mjs': '// TODO x work item\n' })
  for (const arg of ['../', '../other', 'src/../../x', path.resolve('/tmp'), '']) {
    const result = await scan(root, ['--path', arg])
    assert.equal(result.code, 2, arg)
    assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT', arg)
  }
})

test('todos scan drops a TODO that an existing issue matches and says why', async () => {
  const root = repo({ 'a.mjs': '// TODO handle the empty list\n// TODO refresh the documentation index\n// TODO new work item here\n' })
  write(root, 'd1.md', 'refresh the documentation index\n')
  const first = await create(root, 'Docs index', 'd1.md')
  assert.equal(first.code, 0, first.stdout + first.stderr)
  const { data } = await scan(root)
  assert.deepEqual(data.matched.map((m) => [m.reason, m.text]), [['text', 'refresh the documentation index']])
  assert.deepEqual(data.candidates.map((c) => c.text), ['handle the empty list', 'new work item here'])
})

test('an issue that lists the old line of a comment does not cover a new comment on that line', async () => {
  const root = repo({ 'a.mjs': '// TODO build the export\n' })
  write(root, 'd1.md', 'The old comment at a.mjs:1 and `a.mjs:1` was about the cache.\n')
  assert.equal((await create(root, 'Old cache', 'd1.md')).code, 0)
  const { data } = await scan(root)
  assert.equal(data.matched.length, 0)
  assert.equal(data.candidates.length, 1)
})

test('a second scan after creating the issues from the candidates finds nothing to create', async () => {
  const root = repo({ 'a.mjs': '// TODO build the export\n// FIXME build the export\n' })
  const { data } = await scan(root)
  assert.equal(data.candidates.length, 1)
  const [candidate] = data.candidates
  write(root, 'body.md', candidate.description)
  const created = await create(root, candidate.title, 'body.md')
  assert.equal(created.code, 0, created.stderr)
  const again = await scan(root)
  assert.deepEqual(again.data.candidates, [])
  assert.deepEqual(again.data.matched.map((m) => m.reason), ['key'])
})

test('todos scan still matches the issue after the line number moves', async () => {
  const root = repo({ 'a.mjs': '// TODO build the export\n' })
  const { data } = await scan(root)
  write(root, 'body.md', data.candidates[0].description)
  await create(root, 'x', 'body.md')
  write(root, 'a.mjs', 'const a = 1\n\n\n// TODO build the export\n')
  assert.equal((await scan(root)).data.candidates.length, 0)
})

test('todos scan says it is incomplete when the tracker cut its issue list', async () => {
  const root = repo({ 'a.mjs': '// TODO build the export\n' })
  const adapters = {
    ...ADAPTERS,
    local: {
      ...ADAPTERS.local,
      create: async (...args) => {
        const tracker = await ADAPTERS.local.create(...args)
        return { ...tracker, searchIssues: async (filter) => ({ ...(await tracker.searchIssues(filter)), hasMore: true }) }
      },
    },
  }
  const { code, data } = await scan(root, [], { adapters })
  assert.equal(code, 0)
  assert.equal(data.incomplete, true)
  const text = await run(['todos', 'scan'], { env: ENV, cwd: root, adapters })
  assert.match(text.stderr, /incomplete/)
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
  fs.cpSync(makeRepo('basic'), root, { recursive: true })
  const result = await run(['todos', 'scan', '--json'], { env: { ...ENV, GIT_CEILING_DIRECTORIES: outer }, cwd: root })
  assert.equal(result.code, 2)
  assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
})

test('todos scan says git was not found when git is not installed', async () => {
  const root = repo({ 'a.mjs': '// TODO build the export\n' })
  const empty = tempDir('pmkit-nopath-')
  const result = await run(['todos', 'scan', '--json'], { env: { ...ENV, PATH: empty }, cwd: root })
  assert.equal(result.code, 2)
  const { error } = JSON.parse(result.stdout)
  assert.match(error.message, /git was not found/)
  assert.doesNotMatch(error.message, /repository/)
})

test('the pmkit repository has no false TODO or FIXME candidates', () => {
  const git = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: REPO_ROOT, env: ENV })
  if (git.status !== 0) return
  // scripts/__fixtures__ and the goldens hold sample comments on purpose, and the tracker folder is not code.
  const { found, files } = scanRepo(REPO_ROOT, { skip: ['.issues'], env: ENV })
  assert.ok(files > 50, `the scan read ${files} files`)
  assert.deepEqual(found, [])
})
