import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { hashTree, makeRepo, tempDir } from './test-helpers.mjs'
import { marker } from './lib/render.mjs'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pmkit.mjs')

function baseEnv() {
  return {
    ...process.env,
    PMKIT_USER: 'fred',
    PMKIT_NOW: '2026-10-23T12:00:00Z',
    PMKIT_SEED: '1',
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
  }
}

function run(cwd, args, { env = {}, input } = {}) {
  const merged = { ...baseEnv(), ...env }
  for (const key of Object.keys(merged)) if (merged[key] === null) delete merged[key]
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, env: merged, input, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const json = (cwd, args, options) => {
  const result = run(cwd, [...args, '--json'], options)
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

/** Runs with --json, expects exit 2, and returns the error object. */
const failure = (cwd, args) => {
  const result = run(cwd, [...args, '--json'])
  assert.equal(result.status, 2, result.stdout)
  return JSON.parse(result.stdout).error
}

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' } })
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8')
const exists = (root, file) => fs.existsSync(path.join(root, file))

const WARNING = 'warning: 1 issue could not be read: ISS-3Q6T; run /pmkit:local:doctor\n'
const INDEX_FILES = ['.issues/.cache/index.json', '.issues/.cache/.gitignore']

describe('render to stdout', () => {
  test('render board prints the Markdown board and warns about the unreadable issue', () => {
    const root = makeRepo('team')
    const result = run(root, ['render', 'board'])
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.stdout.startsWith(`${marker('board')}\n`))
    assert.ok(result.stdout.includes('\n## In review (1)\n'))
    assert.equal(result.stderr, WARNING)
  })

  test('render roadmap --format html --json returns the document and its metadata', () => {
    const root = makeRepo('team')
    const data = json(root, ['render', 'roadmap', '--format', 'html'])
    assert.equal(data.view, 'roadmap')
    assert.equal(data.format, 'html')
    assert.equal(data.path, null)
    assert.ok(data.content.startsWith('<!doctype html>\n'))
    assert.equal(data.asOf, '2026-10-22T17:00:00Z')
    assert.equal(data.problems[0].id, 'ISS-3Q6T')
    assert.equal(data.dryRun, undefined)
  })

  test('a stdout render writes nothing', () => {
    const root = makeRepo('team')
    const before = hashTree(root, INDEX_FILES)
    for (const args of [['board'], ['roadmap', '--format', 'html'], ['sprint'], ['board', '--dry-run']]) {
      assert.equal(run(root, ['render', ...args]).status, 0)
    }
    assert.equal(hashTree(root, INDEX_FILES), before)
    assert.equal(fs.existsSync(path.join(root, '.issues/.cache/render')), false)
  })

  test('--dry-run to stdout adds dryRun to the JSON', () => {
    const root = makeRepo('team')
    assert.equal(json(root, ['render', 'board', '--dry-run']).dryRun, true)
  })

  test('render sprint shows the active sprint, or the one --sprint names', () => {
    const root = makeRepo('team')
    const active = run(root, ['render', 'sprint'])
    assert.equal(active.status, 0, active.stderr)
    assert.ok(active.stdout.includes('\n# Sprint 2026-10-12\n'))
    assert.ok(active.stdout.includes('2026-10-12, 2026-10-12 to 2026-10-25, active'))
    const closed = run(root, ['render', 'sprint', '--sprint', '2026-09-28'])
    assert.equal(closed.status, 0, closed.stderr)
    assert.ok(closed.stdout.includes('2026-09-28, 2026-09-28 to 2026-10-11, closed'))
  })

  test('render sprint with no active sprint fails', () => {
    const error = failure(makeRepo('basic'), ['render', 'sprint'])
    assert.equal(error.code, 'INVALID_INPUT')
    assert.equal(error.message, 'there is no active sprint')
    assert.equal(error.nextStep, 'pmkit cycle list')
  })

  test('refuses an unknown view, --sprint with another view, an unknown format and a missing view', () => {
    const root = makeRepo('team')
    const view = failure(root, ['render', 'list'])
    assert.equal(view.code, 'INVALID_INPUT')
    assert.equal(view.message, 'view must be board, roadmap or sprint, got "list"')
    assert.equal(view.nextStep, 'pmkit render board')
    const sprint = failure(root, ['render', 'board', '--sprint', 'current'])
    assert.equal(sprint.code, 'INVALID_INPUT')
    assert.equal(sprint.message, '--sprint works only with the sprint view')
    assert.equal(sprint.nextStep, 'pmkit render sprint --sprint <id>')
    const format = failure(root, ['render', 'board', '--format', 'pdf'])
    assert.equal(format.code, 'INVALID_INPUT')
    assert.equal(format.message, '--format must be md or html')
    assert.equal(failure(root, ['render']).code, 'INVALID_INPUT')
  })

  test('render is a read: --as is a usage error, and a bad .pmkit/config.yaml only warns', () => {
    const root = makeRepo('team')
    const as = failure(root, ['render', 'board', '--as', 'fred'])
    assert.equal(as.code, 'INVALID_INPUT')
    assert.match(as.message, /unknown option --as/)
    const file = path.join(root, '.pmkit/config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('system: none', 'system: gitlab'))
    const result = run(root, ['render', 'board'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stderr, /^warning: \.pmkit\/config\.yaml/m)
    assert.ok(result.stdout.startsWith(marker('board')))
  })

  test('the same tracker files give the same bytes', () => {
    const first = makeRepo('team')
    const second = makeRepo('team')
    for (const view of ['board', 'roadmap', 'sprint']) {
      for (const format of ['md', 'html']) {
        const a = run(first, ['render', view, '--format', format])
        const b = run(second, ['render', view, '--format', format], { env: { PMKIT_NOW: '2027-03-01T08:00:00Z' } })
        assert.equal(a.status, 0, a.stderr)
        assert.equal(a.stdout, b.stdout, `${view} ${format}`)
        assert.ok(a.stdout.endsWith('\n') && !a.stdout.endsWith('\n\n'), `${view} ${format} ends with one newline`)
        assert.ok(!a.stdout.includes('\r'))
      }
    }
  })

  test('the clock does not change the output', () => {
    const root = makeRepo('team')
    const a = run(root, ['render', 'sprint'], { env: { PMKIT_NOW: '2026-10-23T12:00:00Z' } })
    const b = run(root, ['render', 'sprint'], { env: { PMKIT_NOW: '2026-12-31T23:00:00Z' } })
    assert.equal(a.status, 0, a.stderr)
    assert.equal(a.stdout, b.stdout)
  })
})

describe('render to a file', () => {
  test('--save writes the view under the cache folder and keeps it ignored', () => {
    const root = makeRepo('team')
    const first = json(root, ['render', 'board', '--save'])
    assert.equal(first.path, '.issues/.cache/render/board.md')
    assert.equal(first.overwrote, false)
    assert.equal(first.content, undefined)
    assert.equal(first.asOf, '2026-10-22T17:00:00Z')
    assert.equal(first.problems[0].id, 'ISS-3Q6T')
    assert.ok(read(root, '.issues/.cache/render/board.md').startsWith(`${marker('board')}\n`))
    assert.equal(read(root, '.issues/.cache/.gitignore'), '*\n')
    assert.equal(json(root, ['render', 'board', '--save']).overwrote, true)
  })

  test('--save prints the path it wrote', () => {
    const root = makeRepo('team')
    const result = run(root, ['render', 'board', '--save'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, 'wrote .issues/.cache/render/board.md (board, md)\n')
    assert.equal(result.stderr, WARNING)
  })

  test('--save names the file by view and format', () => {
    const root = makeRepo('team')
    assert.equal(json(root, ['render', 'board', '--save', '--format', 'html']).path, '.issues/.cache/render/board.html')
    assert.ok(read(root, '.issues/.cache/render/board.html').startsWith('<!doctype html>\n'))
    assert.equal(json(root, ['render', 'roadmap', '--save']).path, '.issues/.cache/render/roadmap.md')
  })

  test('--save writes no file outside the cache folder', () => {
    const root = makeRepo('team')
    const before = hashTree(root, ['.issues/.cache'])
    json(root, ['render', 'sprint', '--save'])
    assert.equal(hashTree(root, ['.issues/.cache']), before)
  })

  test('--save in a git repository with auto_commit leaves git clean and commits nothing', () => {
    const root = makeRepo('team')
    const file = path.join(root, '.issues/config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^auto_commit: .*$/m, 'auto_commit: true'))
    git(root, 'init', '-q')
    git(root, 'config', 'user.name', 'Test')
    git(root, 'config', 'user.email', 'test@example.com')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'init')
    const count = () => git(root, 'rev-list', '--count', 'HEAD').stdout.trim()
    const commits = count()
    const result = run(root, ['render', 'board', '--save'])
    assert.equal(result.status, 0, result.stderr)
    assert.ok(exists(root, '.issues/.cache/render/board.md'))
    assert.equal(git(root, 'status', '--porcelain', '--untracked-files=all').stdout, '')
    assert.equal(count(), commits)
  })

  test('--out creates the parent folders and takes the format from the extension', () => {
    const root = makeRepo('team')
    const data = json(root, ['render', 'board', '--out', 'out/views/board.html'])
    assert.equal(data.path, 'out/views/board.html')
    assert.equal(data.format, 'html')
    assert.equal(data.overwrote, false)
    assert.ok(read(root, 'out/views/board.html').startsWith('<!doctype html>\n'))
    assert.equal(json(root, ['render', 'board', '--out', 'b.htm']).format, 'html')
    assert.equal(json(root, ['render', 'board', '--out', 'b.txt']).format, 'md')
  })

  test('--out resolves against the working directory', () => {
    const root = makeRepo('team')
    fs.mkdirSync(path.join(root, 'sub'))
    const data = json(path.join(root, 'sub'), ['render', 'board', '--out', 'b.md'])
    assert.equal(data.path, 'sub/b.md')
    assert.ok(exists(root, 'sub/b.md'))
  })

  test('--out with an absolute path outside the repository writes there', () => {
    const root = makeRepo('team')
    const outside = path.join(tempDir('pmkit-render-out-'), 'board.md')
    const data = json(root, ['render', 'board', '--out', outside])
    assert.equal(data.path, outside.split(path.sep).join('/'))
    assert.ok(fs.readFileSync(outside, 'utf8').startsWith(marker('board')))
  })

  test('--out refuses a file it did not render and replaces one it did', () => {
    const root = makeRepo('team')
    fs.writeFileSync(path.join(root, 'README.md'), '# Notes\n')
    const error = failure(root, ['render', 'board', '--out', 'README.md'])
    assert.equal(error.code, 'CONFLICT')
    assert.equal(error.message, 'README.md exists and was not written by pmkit render')
    assert.equal(error.nextStep, 'Pick another path, or delete the file first')
    assert.equal(read(root, 'README.md'), '# Notes\n')
    fs.writeFileSync(path.join(root, 'old.html'), `<!doctype html>\n${marker('board')}\nold\n`)
    const data = json(root, ['render', 'board', '--out', 'old.html'])
    assert.equal(data.overwrote, true)
    assert.ok(!read(root, 'old.html').includes('\nold\n'))
  })

  test('refuses bad destinations and writes nothing', () => {
    const root = makeRepo('team')
    fs.mkdirSync(path.join(root, 'folder'))
    const before = hashTree(root, INDEX_FILES)
    const inside = failure(root, ['render', 'board', '--out', '.issues/board.md'])
    assert.equal(inside.code, 'INVALID_INPUT')
    assert.equal(inside.nextStep, 'Use --save, or a path outside .issues/')
    const both = failure(root, ['render', 'board', '--out', 'x.md', '--save'])
    assert.equal(both.code, 'INVALID_INPUT')
    assert.equal(both.message, '--out and --save cannot go together')
    assert.equal(failure(root, ['render', 'board', '--format', 'md', '--out', 'board.html']).code, 'INVALID_INPUT')
    assert.equal(failure(root, ['render', 'board', '--format', 'html', '--out', 'board.md']).code, 'INVALID_INPUT')
    const folder = failure(root, ['render', 'board', '--out', 'folder'])
    assert.equal(folder.code, 'INVALID_INPUT')
    assert.equal(folder.message, 'folder is a folder')
    assert.equal(hashTree(root, INDEX_FILES), before)
  })

  test('--dry-run with a destination writes nothing and says what it would write', () => {
    const root = makeRepo('team')
    const before = hashTree(root)
    for (const args of [['--save'], ['--out', 'x.md']]) {
      const result = run(root, ['render', 'board', '--dry-run', ...args])
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /^would write (\.issues\/\.cache\/render\/board\.md|x\.md) \(board, md\)\ndry run: nothing was written\n$/)
    }
    const data = json(root, ['render', 'board', '--dry-run', '--save'])
    assert.equal(data.dryRun, true)
    assert.equal(data.path, '.issues/.cache/render/board.md')
    assert.equal(hashTree(root), before)
    fs.writeFileSync(path.join(root, 'README.md'), '# Notes\n')
    assert.equal(failure(root, ['render', 'board', '--dry-run', '--out', 'README.md']).code, 'CONFLICT')
  })

  test('--save on a tracker in an older format writes to the real tracker folder', () => {
    const root = makeRepo('team')
    const file = path.join(root, '.issues/config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^version: .*$/m, 'version: 1'))
    const result = run(root, ['render', 'board', '--save', '--json'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).path, '.issues/.cache/render/board.md')
    assert.ok(read(root, '.issues/.cache/render/board.md').startsWith(marker('board')))
    assert.equal(read(root, '.issues/.cache/.gitignore'), '*\n')
  })
})
