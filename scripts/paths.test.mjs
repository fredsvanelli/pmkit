// climbsOut (PMK-268): a relative path that leaves its base, whatever the separator.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { climbsOut, hideAbsolutePaths, relativeTo } from './lib/paths.mjs'

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

test('hideAbsolutePaths hides a path with spaces whole, quoted up to its closing quote and unquoted to the end of the line (PMK-271)', () => {
  assert.equal(hideAbsolutePaths('fatal: bad config line 1 in file /Users/John Doe/.gitconfig'), 'fatal: bad config line 1 in file <path>')
  assert.equal(hideAbsolutePaths("'/Users/John Doe/x' and '/b c/d' failed"), "'<path>' and '<path>' failed")
  assert.equal(hideAbsolutePaths('cannot open "/a b/c'), 'cannot open "<path>')
  assert.equal(hideAbsolutePaths('line one /a b\nline two'), 'line one <path>\nline two')
})

test('hideAbsolutePaths hides UNC paths and drive paths with spaces (PMK-271)', () => {
  for (const text of ['error: \\\\host\\share\\a b\\c.md', 'error: //host/share/a b/c.md', 'error: C:\\Users\\A B\\x', 'error: C:/Users/A B/x']) assert.equal(hideAbsolutePaths(text), 'error: <path>', text)
  assert.equal(hideAbsolutePaths("'\\\\host\\share\\a b' is locked"), "'<path>' is locked")
})

test('hideAbsolutePaths leaves text without an absolute path alone (PMK-271)', () => {
  for (const text of ["can't open file", 'see docs/a b/c and a/b', 'fatal: .git/index.lock exists']) assert.equal(hideAbsolutePaths(text), text)
})

test("hideAbsolutePaths closes a quote only before the end of the line, a space, ':' or ')', so an apostrophe in a name stays inside the path (PMK-271 review)", () => {
  assert.equal(hideAbsolutePaths("fatal: bad config in '/Users/O'Brien/x y'"), "fatal: bad config in '<path>'")
  assert.equal(hideAbsolutePaths("'/Users/O'Brien/x' and '/b c/d': no"), "'<path>' and '<path>': no")
  assert.equal(hideAbsolutePaths("(\"/Users/O'Brien/x\")"), '("<path>")')
})

test("hideAbsolutePaths also starts a path after '=' and ':' (PMK-271 review)", () => {
  assert.equal(hideAbsolutePaths('key=/Users/x y/z'), 'key=<path>')
  assert.equal(hideAbsolutePaths('in:/Users/x y/z'), 'in:<path>')
  assert.equal(hideAbsolutePaths('url file:///Users/x y/z'), 'url file:<path>')
  assert.equal(hideAbsolutePaths("key='/Users/x y/z' ok"), "key='<path>' ok")
})
