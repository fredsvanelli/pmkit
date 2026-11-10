import { test } from 'node:test'
import assert from 'node:assert/strict'
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
