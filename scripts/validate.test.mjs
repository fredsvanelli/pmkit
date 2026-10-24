import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { validateRepo } from './lib/validate.mjs'
import { hashTree, makeRepo } from './test-helpers.mjs'

const brief = (result) => result.problems.map(({ path: file, code }) => `${code} ${file}`).sort()

test('broken fixture returns exactly one problem of each kind, at the right path', () => {
  const root = makeRepo('broken')
  const result = validateRepo(root)
  assert.deepEqual(brief(result), [
    'config .issues/config.yaml',
    'conflict .issues/issues/ISS-1CNF/issue.md',
    'cycle .issues/issues/ISS-5CYA/issue.md',
    'drift .issues/issues/ISS-7DFT/issue.md',
    'events .issues/issues/ISS-6EVT/events.jsonl',
    'frontmatter .issues/issues/ISS-2FMT/issue.md',
    'id .issues/issues/ISS-8DDM/issue.md',
    'reference .issues/issues/ISS-4REF/issue.md',
    'sprint .issues/sprints/2026-10-12.yaml',
    'value .issues/issues/ISS-3VAZ/issue.md',
  ])
  assert.deepEqual(result.checked, { issues: 9, epics: 0, sprints: 1, comments: 0 })
  const cycle = result.problems.find((problem) => problem.code === 'cycle')
  assert.match(cycle.message, /ISS-5CYA.*ISS-5CYB.*ISS-5CYA/)
})

test('team fixture minus its conflicted issue has no problems', () => {
  const root = makeRepo('team')
  fs.rmSync(path.join(root, '.issues', 'issues', 'ISS-3Q6T'), { recursive: true })
  const result = validateRepo(root)
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.checked, { issues: 12, epics: 1, sprints: 2, comments: 0 })
})

test('team fixture reports only its conflicted issue', () => {
  const result = validateRepo(makeRepo('team'))
  assert.deepEqual(brief(result), ['conflict .issues/issues/ISS-3Q6T/issue.md'])
})

test('validateRepo writes nothing', () => {
  for (const name of ['broken', 'team']) {
    const root = makeRepo(name)
    const before = hashTree(root)
    validateRepo(root)
    assert.equal(hashTree(root), before)
  }
})

function writeIssue(root, id, extra = '') {
  const dir = path.join(root, '.issues', 'issues', id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'issue.md'), `---\nid: ${id}\ntitle: T\ntype: task\nstatus: todo\npriority: medium\n${extra}---\n`)
}

test('a parent loop is reported once', () => {
  const root = makeRepo('basic')
  writeIssue(root, 'ISS-1AAA', 'parent: ISS-1BBB\n')
  writeIssue(root, 'ISS-1BBB', 'parent: ISS-1CCC\n')
  writeIssue(root, 'ISS-1CCC', 'parent: ISS-1AAA\n')
  writeIssue(root, 'ISS-1DDD', 'parent: ISS-1AAA\n')
  const cycles = validateRepo(root).problems.filter((problem) => problem.code === 'cycle')
  assert.equal(cycles.length, 1)
  assert.match(cycles[0].message, /parent/)
})

test('a milestone is checked only when a milestones folder exists', () => {
  const root = makeRepo('basic')
  writeIssue(root, 'ISS-1AAA', 'milestone: v1\n')
  assert.deepEqual(validateRepo(root).problems, [])
  fs.mkdirSync(path.join(root, '.issues', 'milestones', 'v2'), { recursive: true })
  assert.deepEqual(brief(validateRepo(root)), ['reference .issues/issues/ISS-1AAA/issue.md'])
})

test('two folders with the same normalized id are one id problem', () => {
  const root = makeRepo('basic')
  writeIssue(root, 'ISS-1AAA')
  writeIssue(root, 'iss-1aaa')
  const ids = validateRepo(root).problems.filter((problem) => problem.code === 'id')
  assert.ok(ids.some((problem) => /same id/.test(problem.message)))
})

test('a config.yaml with conflict markers is one conflict problem and does not throw', () => {
  const root = makeRepo('broken')
  fs.writeFileSync(path.join(root, '.issues', 'config.yaml'), 'version: 1\n<<<<<<< HEAD\ndefault_status: todo\n=======\ndefault_status: backlog\n>>>>>>> feature/x\n')
  assert.deepEqual(brief(validateRepo(root)), ['conflict .issues/config.yaml'])
})

test('an unparseable config.yaml is one config problem and does not throw', () => {
  const root = makeRepo('team')
  fs.writeFileSync(path.join(root, '.issues', 'config.yaml'), 'version: 1\nthis line has no colon\n')
  assert.deepEqual(brief(validateRepo(root)), ['config .issues/config.yaml'])
})

test('conflict markers inside a fenced code block are not a conflict problem', () => {
  const root = makeRepo('team')
  fs.rmSync(path.join(root, '.issues', 'issues', 'ISS-3Q6T'), { recursive: true })
  writeIssue(root, 'ISS-9FEN', '')
  const file = path.join(root, '.issues', 'issues', 'ISS-9FEN', 'issue.md')
  fs.appendFileSync(file, '\n## Description\n\n```\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n```\n')
  assert.deepEqual(brief(validateRepo(root)).filter((line) => line.startsWith('conflict')), [])
})
