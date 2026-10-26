import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  childEnv, compareNames, expandCase, findCollisions, formatRun, goldenName, makeNormalizer, mapLimit, staleGoldens,
} from './golden-helpers.mjs'

test('goldenName turns spaces into hyphens', () => {
  assert.equal(goldenName('issues get'), 'issues-get')
  assert.equal(goldenName('metrics cycle-time'), 'metrics-cycle-time')
  assert.equal(goldenName('validate'), 'validate')
})

test('findCollisions finds two names that map to one file', () => {
  assert.deepEqual(findCollisions(['a b', 'a-b']), [['a b', 'a-b']])
  assert.deepEqual(findCollisions(['issues get', 'issues list', 'validate']), [])
})

test('compareNames names missing and extra', () => {
  assert.deepEqual(compareNames(['y', 'z'], ['x', 'y']), { missing: ['x'], extra: ['z'] })
  assert.deepEqual(compareNames(['x', 'y'], ['y', 'x']), { missing: [], extra: [] })
})

test('expandCase gives two runs for a read and four for a write, dry-run before json', () => {
  assert.deepEqual(expandCase(false, ['ISS-1']), [['ISS-1'], ['ISS-1', '--json']])
  assert.deepEqual(expandCase(true, ['ISS-1', 'done']), [
    ['ISS-1', 'done'],
    ['ISS-1', 'done', '--json'],
    ['ISS-1', 'done', '--dry-run'],
    ['ISS-1', 'done', '--dry-run', '--json'],
  ])
})

test("childEnv has no key from the caller's env", () => {
  const saved = { PMKIT_USER: process.env.PMKIT_USER, GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME }
  process.env.PMKIT_USER = 'other'
  process.env.GIT_AUTHOR_NAME = 'Someone Else'
  try {
    const env = childEnv()
    assert.equal(env.PMKIT_USER, 'fred')
    assert.equal(env.GIT_AUTHOR_NAME, undefined)
    assert.equal(env.PATH, process.env.PATH)
    assert.equal(env.TZ, 'UTC')
    assert.equal(env.PMKIT_NOW, '2026-10-23T12:00:00Z')
    assert.equal(env.PMKIT_SEED, '1')
    assert.equal(env.GIT_CONFIG_GLOBAL, os.devNull)
    assert.equal(env.GIT_CONFIG_NOSYSTEM, '1')
    const expected = ['PATH', 'TZ', 'PMKIT_USER', 'PMKIT_NOW', 'PMKIT_SEED', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']
    if (process.platform === 'win32') expected.push('SYSTEMROOT')
    assert.deepEqual(Object.keys(env).sort(), expected.sort())
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('makeNormalizer replaces plain, realpath and JSON-escaped roots', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-golden-'))
  try {
    const real = path.join(base, 'real')
    fs.mkdirSync(real)
    const link = path.join(base, 'link')
    fs.symlinkSync(real, link, 'dir')
    const inputs = path.join(base, 'inputs')
    const normalize = makeNormalizer({ root: link, inputs })
    const realRoot = fs.realpathSync(link)
    assert.equal(normalize(`no .pmkit/config.yaml in ${link}`), 'no .pmkit/config.yaml in <root>')
    assert.equal(normalize(`wrote ${realRoot}/.issues/x.md`), 'wrote <root>/.issues/x.md')
    assert.equal(normalize(`read ${inputs}/doc.md`), 'read <inputs>/doc.md')
    assert.equal(normalize(JSON.stringify({ path: `${realRoot}/a` })), '{"path":"<root>/a"}')

    const windows = makeNormalizer({ root: 'C:\\Users\\me\\AppData\\Local\\Temp\\pmkit-ab12', inputs: 'C:\\repo\\inputs' })
    assert.equal(windows('in C:\\Users\\me\\AppData\\Local\\Temp\\pmkit-ab12\\.issues'), 'in <root>\\.issues')
    assert.equal(windows(JSON.stringify({ file: 'C:\\repo\\inputs\\doc.md' })), '{"file":"<inputs>\\\\doc.md"}')
    assert.equal(windows(JSON.stringify('C:\\Users\\me\\AppData\\Local\\Temp\\pmkit-ab12')), '"<root>"')
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('makeNormalizer replaces a longer path before its prefix', () => {
  const normalize = makeNormalizer({ root: '/tmp/x', inputs: '/tmp/x/inputs' })
  assert.equal(normalize('/tmp/x/inputs/a.md and /tmp/x/b'), '<inputs>/a.md and <root>/b')
})

test('formatRun shows (empty) for an empty stream and marks a missing final newline', () => {
  assert.equal(
    formatRun({ args: ['issues', 'get', 'ISS-1'], code: 0, stdout: 'id: ISS-1\n', stderr: '' }),
    ['$ pmkit issues get ISS-1', 'exit 0', '--- stdout', 'id: ISS-1', '--- stderr', '(empty)'].join('\n'),
  )
  assert.equal(
    formatRun({ args: ['validate'], code: 2, stdout: '', stderr: 'error: boom' }),
    ['$ pmkit validate', 'exit 2', '--- stdout', '(empty)', '--- stderr', 'error: boom', '\\ no newline at end'].join('\n'),
  )
})

test('formatRun quotes an argument with a space', () => {
  const text = formatRun({ args: ['epic', 'create', '--title', 'Golden epic'], code: 0, stdout: 'x\n', stderr: '' })
  assert.equal(text.split('\n')[0], "$ pmkit epic create --title 'Golden epic'")
})

test('mapLimit keeps order and never runs more than the limit at once', async () => {
  let running = 0
  let peak = 0
  const items = [30, 5, 20, 1, 15, 10, 2, 25]
  const result = await mapLimit(items, 3, async (ms) => {
    running++
    peak = Math.max(peak, running)
    await new Promise((resolve) => setTimeout(resolve, ms))
    running--
    return ms * 2
  })
  assert.deepEqual(result, items.map((ms) => ms * 2))
  assert.equal(peak, 3)
  assert.deepEqual(await mapLimit([], 3, async () => 1), [])
})

test('staleGoldens lists a file that matches no command and ignores _inputs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-golden-'))
  try {
    fs.writeFileSync(path.join(dir, 'issues-get.txt'), '')
    fs.writeFileSync(path.join(dir, 'ghost.txt'), '')
    fs.writeFileSync(path.join(dir, 'validate.md'), '')
    fs.mkdirSync(path.join(dir, '_inputs'))
    assert.deepEqual(staleGoldens(dir, ['issues get', 'validate']), ['ghost.txt', 'validate.md'])
    assert.deepEqual(staleGoldens(path.join(dir, 'absent'), ['issues get']), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
