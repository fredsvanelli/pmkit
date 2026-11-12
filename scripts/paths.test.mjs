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

test("hideAbsolutePaths starts a path after '[', ',', ';', '<' and '@' (PMK-277)", () => {
  assert.equal(hideAbsolutePaths('[/Users/x/repo]'), '[<path>')
  assert.equal(hideAbsolutePaths('a,/Users/x'), 'a,<path>')
  assert.equal(hideAbsolutePaths('a;/Users/x'), 'a;<path>')
  assert.equal(hideAbsolutePaths('</Users/x>'), '<<path>')
  assert.equal(hideAbsolutePaths('user@/Users/x'), 'user@<path>')
})

test("hideAbsolutePaths leaves no piece of a path with a space or a closing ']' or '>' after the new starts (PMK-277)", () => {
  for (const text of ["['/Users/x y']", "<'/Users/x y'>", '[/Users/x y]', '</Users/x y>', 'a,/Users/x y/z', 'a;"/Users/x y"', 'user@/Users/x y/z']) {
    const shown = hideAbsolutePaths(text)
    for (const part of ['Users', 'x y', '/z']) assert.ok(!shown.includes(part), `${part} in ${shown} (from ${text})`)
  }
  assert.equal(hideAbsolutePaths("['/Users/x y'] and '/b c/d'"), "['<path>'] and '<path>'") // PMK-284: a quote before ']' closes, so the text after it shows
})

test("hideAbsolutePaths keeps the other starts and leaves ordinary text with the new characters alone (PMK-277)", () => {
  assert.equal(hideAbsolutePaths('key=/x'), 'key=<path>')
  for (const text of ['see [docs/a], b;c, <tag> and me@host', 'a,b/c', '[a/b]']) assert.equal(hideAbsolutePaths(text), text)
})

test('hideAbsolutePaths keeps a scheme://host URL whole and still hides file:///x, UNC and a path after the URL (PMK-278)', () => {
  for (const text of [
    "fatal: unable to access 'https://github.com/o/r.git/': The requested URL returned error: 403",
    "fatal: unable to access 'http://example.com:8080/o/r.git/': Could not resolve host",
    'ssh: connect to ssh://git@github.com/o/r.git failed',
    'fatal: repository git://example.com/o/r.git/ not found',
    'see https://example.com/a',
  ]) assert.equal(hideAbsolutePaths(text), text)
  assert.equal(hideAbsolutePaths('url file:///Users/x y/z'), 'url file:<path>')
  assert.equal(hideAbsolutePaths("'https://h.com/r.git' is not /Users/John Doe/r"), "'https://h.com/r.git' is not <path>")
  assert.equal(hideAbsolutePaths('error: \\\\host\\share\\a b'), 'error: <path>')
  assert.equal(hideAbsolutePaths('error: //host/share/a'), 'error: <path>')
  assert.equal(hideAbsolutePaths('error: C://Users/a b'), 'error: <path>')
})

test('hideAbsolutePaths hides the path of every file:// URL, with or without a host, and keeps the other schemes whole (PMK-278 cycle 2)', () => {
  assert.equal(hideAbsolutePaths("fatal: '/x' and file://localhost/Users/John Doe/r.git"), "fatal: '<path>' and file:<path>")
  assert.equal(hideAbsolutePaths('remote file://host/abs/r.git'), 'remote file:<path>')
  assert.equal(hideAbsolutePaths('remote FILE://host/abs/r.git'), 'remote FILE:<path>')
  assert.equal(hideAbsolutePaths('see https://example.com/a'), 'see https://example.com/a')
})

test('hideAbsolutePaths replaces the credentials of a URL it keeps whole, with a password or a bare token (PMK-278 cycle 2)', () => {
  assert.equal(hideAbsolutePaths("fatal: unable to access 'https://user:pw@github.com/o/r.git/': 403"), "fatal: unable to access 'https://[redacted]@github.com/o/r.git/': 403")
  assert.equal(hideAbsolutePaths('ssh://:pw@host/r.git failed'), 'ssh://[redacted]@host/r.git failed')
  const token = `ghp_${'a1B2'.repeat(6)}`
  const shown = hideAbsolutePaths(`fatal: unable to access 'https://${token}@github.com/o/r.git/': 403`)
  assert.ok(!shown.includes(token) && shown.includes('github.com/o/r.git'), shown)
})

test('hideAbsolutePaths starts a path after a backtick, a brace, a pipe and a redirect (PMK-284)', () => {
  assert.equal(hideAbsolutePaths('a `/Users/x'), 'a `<path>')
  assert.equal(hideAbsolutePaths('{/Users/x}'), '{<path>')
  assert.equal(hideAbsolutePaths('a|/Users/x'), 'a|<path>')
  assert.equal(hideAbsolutePaths('cmd 2>/Users/x y/log'), 'cmd 2><path>')
})

test('hideAbsolutePaths closes a backtick-quoted path at its closing backtick, with or without a space in it (PMK-284)', () => {
  assert.equal(hideAbsolutePaths('x `/Users/a/r` y'), 'x `<path>` y')
  assert.equal(hideAbsolutePaths('x `/Users/John Doe/r` y'), 'x `<path>` y')
  assert.equal(hideAbsolutePaths('x `/Users/a/r'), 'x `<path>')
})

test("hideAbsolutePaths closes a quote before ']' and '>' so the text after it shows, and keeps O'Brien inside (PMK-284)", () => {
  assert.equal(hideAbsolutePaths("'/Users/a/r'] gone"), "'<path>'] gone")
  assert.equal(hideAbsolutePaths('"/Users/a b"> ok'), '"<path>"> ok')
  assert.equal(hideAbsolutePaths("<'/Users/x y'> ok"), "<'<path>'> ok")
  assert.equal(hideAbsolutePaths('`/Users/a b`] ok'), '`<path>`] ok')
  assert.equal(hideAbsolutePaths("'/Users/O'Brien/x'] ok"), "'<path>'] ok")
})

test('hideAbsolutePaths leaves ordinary text with a backtick, a brace, a pipe or a redirect alone (PMK-284)', () => {
  for (const text of ['a|b', '{a/b}', 'a > b/c', 'run `git status` now', 'x {a} | y', 'docs/a`b/c']) assert.equal(hideAbsolutePaths(text), text)
})

test("hideAbsolutePaths starts a path after '>' only when it is a redirect, never after a letter such as <remote>/<branch> (PMK-284 cycle 2)", () => {
  for (const text of ['usage: git push <remote>/<branch> and more', '<name>/<id>', 'see <a>/b c', 'x <remote>/<branch>']) assert.equal(hideAbsolutePaths(text), text)
  assert.equal(hideAbsolutePaths('cmd 2>/Users/x y/log'), 'cmd 2><path>')
  assert.equal(hideAbsolutePaths('cmd &>/Users/x'), 'cmd &><path>')
  assert.equal(hideAbsolutePaths('cmd >/Users/x'), 'cmd ><path>')
  assert.equal(hideAbsolutePaths('cmd >>/Users/x'), 'cmd >><path>')
  assert.equal(hideAbsolutePaths('>/Users/x'), '><path>')
})

test("hideAbsolutePaths closes a quote before ']' or '>' only when that character ends the text, a space, ':' ')' or another ']' / '>' (PMK-284 cycle 2)", () => {
  assert.equal(hideAbsolutePaths("'/Users/x/a'>b/secret dir/y' tail"), "'<path>' tail")
  assert.equal(hideAbsolutePaths("'/Users/a/r'] gone"), "'<path>'] gone")
  assert.equal(hideAbsolutePaths("'/Users/a/r']"), "'<path>']")
  assert.equal(hideAbsolutePaths("['/Users/a/r']] gone"), "['<path>']] gone")
  assert.equal(hideAbsolutePaths("'/Users/a/r'>: gone"), "'<path>'>: gone")
  assert.equal(hideAbsolutePaths("('/Users/a/r'>) gone"), "('<path>'>) gone")
})

test("hideAbsolutePaths takes a digit before '>' for a redirect only when it is not the end of a word or a revision (PMK-284 cycle 3)", () => {
  for (const text of ['diff <rev1>/<rev2> failed', 'fatal: <sha1>/<sha2>', 'HEAD~1>/x', 'HEAD^2>/x']) assert.equal(hideAbsolutePaths(text), text)
  assert.equal(hideAbsolutePaths('2>/x/y'), '2><path>')
  assert.equal(hideAbsolutePaths('cmd 2>/x/y'), 'cmd 2><path>')
  assert.equal(hideAbsolutePaths('cmd;2>/x/y'), 'cmd;2><path>')
})

test("hideAbsolutePaths opens a path after a backtick only when the backtick itself is at a start, so a closing backtick does not (PMK-284 cycle 3)", () => {
  assert.equal(hideAbsolutePaths('use `git`/`gh` here'), 'use `git`/`gh` here')
  assert.equal(hideAbsolutePaths('run `/Users/x y/z'), 'run `<path>')
  assert.equal(hideAbsolutePaths('x `/Users/a/r` y'), 'x `<path>` y')
  assert.equal(hideAbsolutePaths("a'/Users/x"), "a'<path>")
})

test('hideAbsolutePaths leaves ordinary git and gh text, revisions, arrows and markdown alone (PMK-284 cycle 3)', () => {
  for (const text of [
    'usage: git push <remote>/<branch>', 'diff <rev1>/<rev2> failed', 'HEAD~1>/x', 'origin/main -> origin/main', 'a => b/c',
    'use `git`/`gh` here', 'run `git status` or `gh pr view` now', 'see `docs/a` and `b/c`', '- `x`/`y`: both', 'refs/heads/main..origin/main',
    'fatal: ambiguous argument \'HEAD~1..HEAD\'', 'a | b/c', 'a >= b/c', '1>2/3', 'x{a}/y', 'error: src refspec foo/bar does not match any',
  ]) assert.equal(hideAbsolutePaths(text), text)
  assert.equal(hideAbsolutePaths('git log > /Users/x y/out'), 'git log > <path>')
})

test('hideAbsolutePaths ends a quoted file:// URL at its closing quote, as a quoted path does (PMK-285)', () => {
  assert.equal(hideAbsolutePaths("fatal: 'file:///Users/a/r': does not appear to be a git repository"), "fatal: 'file:<path>': does not appear to be a git repository")
  assert.equal(hideAbsolutePaths('fatal: "FILE://localhost/Users/a b/r": not a repo'), 'fatal: "FILE:<path>": not a repo')
  assert.equal(hideAbsolutePaths("fatal: 'file://host/Users/a/r' (cause)"), "fatal: 'file:<path>' (cause)")
  assert.equal(hideAbsolutePaths("['file:///Users/a b']: cause"), "['file:<path>']: cause")
  assert.equal(hideAbsolutePaths("fatal: 'file:///Users/O'Brien/r': cause"), "fatal: 'file:<path>': cause") // an apostrophe inside the name stays inside
  assert.equal(hideAbsolutePaths("fatal: 'file:///Users/a/r"), "fatal: 'file:<path>") // never closes: to the end of the line
  assert.equal(hideAbsolutePaths('url file:///Users/a/r: cause'), 'url file:<path>') // unquoted: to the end of the line
})

test('hideAbsolutePaths hides the path of a <scheme>+file:// URL as file:// is, and keeps git+ssh and git+https whole (PMK-286)', () => {
  assert.equal(hideAbsolutePaths('remote git+file://host/Users/a/r.git'), 'remote git+file:<path>') // with a host
  assert.equal(hideAbsolutePaths('remote git+file:///Users/a/r.git'), 'remote git+file:<path>') // without a host
  assert.equal(hideAbsolutePaths('remote GIT+FILE://host/abs/r.git'), 'remote GIT+FILE:<path>')
  assert.equal(hideAbsolutePaths("fatal: 'git+file:///Users/a/r': does not appear to be a git repository"), "fatal: 'git+file:<path>': does not appear to be a git repository")
  assert.equal(hideAbsolutePaths("fatal: 'git+file://host/Users/a/r' (cause)"), "fatal: 'git+file:<path>' (cause)")
  assert.equal(hideAbsolutePaths('fatal: "git+file://localhost/Users/a b/r": not a repo'), 'fatal: "git+file:<path>": not a repo')
  assert.equal(hideAbsolutePaths('fatal: `git+file:///Users/a/r` gone'), 'fatal: `git+file:<path>` gone')
  assert.equal(hideAbsolutePaths("fatal: 'git+file:///Users/O'Brien/r': cause"), "fatal: 'git+file:<path>': cause")
  assert.equal(hideAbsolutePaths("fatal: 'git+file:///Users/a/r"), "fatal: 'git+file:<path>") // never closes: to the end of the line
  assert.equal(hideAbsolutePaths('url git+file:///Users/a/r: cause'), 'url git+file:<path>') // unquoted: to the end of the line
  assert.equal(hideAbsolutePaths('url a+b+file://host/Users/a'), 'url a+b+file:<path>')
  for (const text of ['x-file://host/abs', 'a.file://host/abs', 'git+filesystem://host/abs']) assert.equal(hideAbsolutePaths(text), text) // only a scheme that ends in +file
  assert.equal(hideAbsolutePaths('fatal: unable to connect to git+ssh://user:pw@host/o/r.git'), 'fatal: unable to connect to git+ssh://[redacted]@host/o/r.git')
  assert.equal(hideAbsolutePaths("fatal: unable to access 'git+https://tok:x@host/o/r.git/': 403"), "fatal: unable to access 'git+https://[redacted]@host/o/r.git/': 403")
  assert.equal(hideAbsolutePaths("error: cannot fetch 'git+ssh://git@github.com/o/r.git': failed"), "error: cannot fetch 'git+ssh://git@github.com/o/r.git': failed")
})

test('hideAbsolutePaths redacts the user name of an http(s) URL, and leaves ssh alone (PMK-287)', () => {
  assert.equal(hideAbsolutePaths('https://bob@host/r.git'), 'https://[redacted]@host/r.git')
  assert.equal(hideAbsolutePaths("fatal: unable to access 'https://bob@host/r.git/': 403"), "fatal: unable to access 'https://[redacted]@host/r.git/': 403")
  assert.equal(hideAbsolutePaths('see http://bob@host:8080/r.git and HTTPS://Bob@host/x'), 'see http://[redacted]@host:8080/r.git and HTTPS://[redacted]@host/x')
  assert.equal(hideAbsolutePaths("'git+https://bob@host/r.git'"), "'git+https://[redacted]@host/r.git'")
  assert.equal(hideAbsolutePaths('https://bob@x.com@host/r.git'), 'https://[redacted]@host/r.git') // the user runs to the last @ before the path
  assert.equal(hideAbsolutePaths('https://bob:pw@host/r.git'), 'https://[redacted]@host/r.git') // with a password: as before
  assert.equal(hideAbsolutePaths('https://[redacted]@host/r.git'), 'https://[redacted]@host/r.git') // a second pass changes nothing
  for (const text of ['ssh://git@host/r.git', 'git+ssh://git@host/r.git', 'git@github.com:o/r.git', 'https://host/r.git', 'https://host/p?e=a@b', 'https://host?e=a@b', 'usage: git push <remote>/<branch>']) {
    assert.equal(hideAbsolutePaths(text), text)
  }
})

test("hideAbsolutePaths hides a path after '!', after a letter and '>' that is not <placeholder>, and after a '|' that ends a URL (PMK-295)", () => {
  assert.equal(hideAbsolutePaths('!/Users/x'), '!<path>')
  assert.equal(hideAbsolutePaths('from>/Users/x'), 'from><path>')
  assert.equal(hideAbsolutePaths('https://h.com/x|/Users/y'), 'https://h.com/x|<path>')
  assert.equal(hideAbsolutePaths('see https://h.com/a|b and https://h.com/c'), 'see https://h.com/a|b and https://h.com/c')
})

test('hideAbsolutePaths keeps <remote>/<branch>, <rev1>/<rev2>, HEAD~1>/x and a closing backtick (PMK-295)', () => {
  for (const text of ['<remote>/<branch>', '<rev1>/<rev2>', 'push <remote>/<branch> now', 'HEAD~1>/x', 'use `git`/`gh` here']) assert.equal(hideAbsolutePaths(text), text)
})
