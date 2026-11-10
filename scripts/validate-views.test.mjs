import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { caseClashes } from './lib/local/views.mjs'
import { validateRepo } from './lib/validate.mjs'
import { makeRepo } from './test-helpers.mjs'

const brief = (result) => result.problems.map(({ path: file, code }) => `${code} ${file}`).filter((line) => line.includes('/views/')).sort()

function writeView(root, name, text) {
  const dir = path.join(root, '.issues', 'views')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), text)
}

test('a view file that does not parse, has a bad value or breaks the name rule is a view problem', () => {
  const root = makeRepo('team')
  writeView(root, 'good.yaml', 'filter:\n  categories: [done]\n')
  writeView(root, 'scalar.yaml', 'filter: 3\n')
  writeView(root, 'stale.yaml', 'filter:\n  types: [gone]\n')
  writeView(root, 'unknown.yaml', 'filter:\n  bogus: 1\n')
  writeView(root, 'bad+name.yaml', 'filter:\n  blocked: true\n')
  writeView(root, 'notes.md', 'not a view\n')
  const result = validateRepo(root)
  assert.deepEqual(brief(result), [
    'view .issues/views/bad+name.yaml', 'view .issues/views/scalar.yaml', 'view .issues/views/stale.yaml', 'view .issues/views/unknown.yaml',
  ])
  assert.match(result.problems.find((p) => p.path.endsWith('bad+name.yaml')).message, /^view name "bad\+name" must start/)
  assert.match(result.problems.find((p) => p.path.endsWith('scalar.yaml')).message, /needs a "filter" map/)
  assert.match(result.problems.find((p) => p.path.endsWith('stale.yaml')).message, /gone/)
})

test('a view file with conflict markers is one conflict problem and no view problem', () => {
  const root = makeRepo('team')
  writeView(root, 'mine.yaml', 'filter:\n<<<<<<< HEAD\n  blocked: true\n=======\n  archived: true\n>>>>>>> other\n')
  assert.deepEqual(brief(validateRepo(root)), ['conflict .issues/views/mine.yaml'])
})

test('a view whose sprint is not a valid sprint id is a view problem, as it is for the tracker', () => {
  const root = makeRepo('team')
  writeView(root, 'escape.yaml', 'filter:\n  sprint: ../config\n')
  writeView(root, 'missing.yaml', 'filter:\n  sprint: 2099-01-01\n')
  writeView(root, 'current.yaml', 'filter:\n  sprint: current\n')
  assert.deepEqual(brief(validateRepo(root)), ['view .issues/views/escape.yaml', 'view .issues/views/missing.yaml'])
})

// PMK-212
test('a view whose filter is empty is a view problem, and checked counts the views', () => {
  const root = makeRepo('team')
  writeView(root, 'good.yaml', 'filter:\n  categories: [done]\n')
  writeView(root, 'empty.yaml', 'filter: {}\n')
  const result = validateRepo(root)
  assert.deepEqual(brief(result), ['view .issues/views/empty.yaml'])
  assert.equal(result.problems.find((p) => p.path.endsWith('empty.yaml')).message, 'view filter is empty, so the view matches every issue')
  assert.equal(result.checked.views, 2)
  assert.equal(validateRepo(makeRepo('team')).checked.views, 0)
})

test('caseClashes names each later name that differs from an earlier one only in case', () => {
  assert.deepEqual(caseClashes(['Mine', 'mine', 'other', 'MINE', 'b']), [['mine', 'Mine'], ['MINE', 'Mine']])
  assert.deepEqual(caseClashes(['a', 'b']), [])
})

const caseSensitive = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-case-'))
  fs.writeFileSync(path.join(dir, 'a'), '')
  const sensitive = !fs.existsSync(path.join(dir, 'A'))
  fs.rmSync(dir, { recursive: true, force: true })
  return sensitive
})()

test('two view files whose names differ only in case are a view problem on the later one', { skip: !caseSensitive && 'the file system ignores case' }, () => {
  const root = makeRepo('team')
  writeView(root, 'Mine.yaml', 'filter:\n  blocked: true\n')
  writeView(root, 'mine.yaml', 'filter:\n  blocked: true\n')
  const result = validateRepo(root)
  assert.deepEqual(brief(result), ['view .issues/views/mine.yaml'])
  assert.equal(result.problems[0].message, 'view name "mine" differs from "Mine" only in case')
})
