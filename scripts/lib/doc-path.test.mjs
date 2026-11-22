import assert from 'node:assert/strict'
import test from 'node:test'
import { repoDocPath, storedDocPath } from './doc-path.mjs'

// PMK-258: a backslash `..` part leaves the repository as a slash one does.
test('a doc path with a backslash .. part is refused', () => {
  assert.throws(() => repoDocPath('docs\\..\\..\\x.md'), { code: 'INVALID_INPUT', message: /leaves the repository/ })
  assert.throws(() => repoDocPath('docs/..\\x.md'), { code: 'INVALID_INPUT', message: /leaves the repository/ })
  assert.equal(repoDocPath('docs/a..b.md'), 'docs/a..b.md')
})

test('storedDocPath is the normal form of a stored path, or the path itself when it is not valid', () => {
  assert.equal(storedDocPath('./docs//a.md'), 'docs/a.md')
  assert.equal(storedDocPath('../x.md'), '../x.md')
})
