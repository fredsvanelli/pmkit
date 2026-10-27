import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { hashTree, makeRepo } from './test-helpers.mjs'
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
