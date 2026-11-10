import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { tempDir } from '../test-helpers.mjs'
import { rightLines, splitDiff } from './diff-files.mjs'

const MODIFY = 'diff --git a/a b.txt b/a b.txt\nindex 1..2 100644\n--- a/a b.txt\n+++ b/a b.txt\n@@ -1 +1 @@\n-x\n+y\n'
const DELETE = 'diff --git a/gone.txt b/gone.txt\ndeleted file mode 100644\n--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n'
const RENAME = 'diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n'
const BINARY = 'diff --git a/img.png b/img.png\nindex 1..2 100644\nBinary files a/img.png and b/img.png differ\n'

test('splitDiff names each section by its new path, in order, and keeps its text', () => {
  const sections = splitDiff(MODIFY + DELETE + RENAME + BINARY)
  assert.deepEqual(sections.map((s) => s.path), ['a b.txt', 'gone.txt', 'new.txt', 'img.png'])
  assert.equal(sections[0].text, MODIFY)
  assert.equal(sections.map((s) => s.text).join(''), MODIFY + DELETE + RENAME + BINARY)
})

test('splitDiff of an empty diff has no sections', () => {
  assert.deepEqual(splitDiff(''), [])
})

test('rightLines holds the new-file numbers of the added and context lines of every hunk', () => {
  const text = 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,3 @@\n a\n-b\n+c\n+d\n@@ -10 +11,2 @@\n k\n+l\n\\ No newline at end of file\n'
  assert.deepEqual([...rightLines(text)].sort((x, y) => x - y), [1, 2, 3, 11, 12])
})

test('splitDiff reads the paths of a real git diff: the TAB after a path with a space goes, a quoted path is unquoted', () => {
  const root = tempDir('pmkit-diff-')
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' } })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }
  git('init', '-q')
  fs.mkdirSync(path.join(root, 'docs'))
  for (const name of ['docs/my notes.md', 'café.txt', 'old name.txt', 'tab\there.txt']) fs.writeFileSync(path.join(root, name), 'one\n')
  git('add', '.')
  git('commit', '-q', '-m', 'base')
  for (const name of ['docs/my notes.md', 'café.txt', 'tab\there.txt']) fs.appendFileSync(path.join(root, name), 'two\n')
  git('mv', 'old name.txt', 'new ü.txt')
  fs.writeFileSync(path.join(root, 'ç.bin'), Buffer.from([0, 1, 2]))
  git('add', '.')
  const sections = splitDiff(git('diff', '--cached', '--no-color', '-M'))
  assert.deepEqual(sections.map((s) => s.path).sort(), ['café.txt', 'docs/my notes.md', 'new ü.txt', 'tab\there.txt', 'ç.bin'].sort())
  const notes = sections.find((s) => s.path === 'docs/my notes.md')
  assert.deepEqual([...rightLines(notes.text)], [1, 2])
})

test('splitDiff unquotes the C escapes git writes in a quoted header', () => {
  const quoted = 'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"\n--- "a/caf\\303\\251.txt"\n+++ "b/caf\\303\\251.txt"\n@@ -1 +1 @@\n-x\n+y\n'
  const binary = 'diff --git "a/\\"q\\" \\\\.png" "b/\\"q\\" \\\\.png"\nnew file mode 100644\nBinary files /dev/null and "b/\\"q\\" \\\\.png" differ\n'
  const copy = 'diff --git a/x.txt b/y z.txt\nsimilarity index 100%\ncopy from x.txt\ncopy to y z.txt\n'
  assert.deepEqual(splitDiff(quoted + binary + copy).map((s) => s.path), ['café.txt', '"q" \\.png', 'y z.txt'])
})

test('rightLines stops at the size each hunk declares, so a trailing empty line is not a line of the file', () => {
  const text = 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n\n'
  assert.deepEqual([...rightLines(text)], [1, 2])
  const normalized = 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n\n-b\n+c\n'
  assert.deepEqual([...rightLines(normalized)], [1, 2, 3])
})
