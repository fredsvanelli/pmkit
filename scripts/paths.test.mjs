// climbsOut (PMK-268): a relative path that leaves its base, whatever the separator.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { climbsOut, relativeTo } from './lib/paths.mjs'

test('climbsOut sees a path outside the base with / or \\ and absolute paths of either flavour', () => {
  for (const rel of ['..', '../a', '..\\a', '../../a/b', '/a', 'C:\\a', 'C:/a', '\\\\host\\share\\a']) assert.equal(climbsOut(rel), true, rel)
})

test('climbsOut keeps a name that only starts with two dots, and paths that stay inside', () => {
  for (const rel of ['', 'a', 'a/b', 'a\\b', '..board.md', '.../a', 'a/../b']) assert.equal(climbsOut(rel), false, rel)
})

test('relativeTo removes the folder only where its name ends, so a longer name that starts the same is left alone (PMK-268 review)', () => {
  const text = "fatal: Unable to create '/tmp/t/.git/index.lock': File exists. see /tmp/tracker/x and /tmp/t: and /tmp/t"
  assert.equal(relativeTo(text, ['/tmp/t']), "fatal: Unable to create '.git/index.lock': File exists. see /tmp/tracker/x and .: and .")
  assert.equal(relativeTo("'C:\\repo\\a' 'C:\\repo2\\a'", ['C:\\repo']), "'a' 'C:\\repo2\\a'")
})
