// The path of a document linked to a Linear issue (PMK-252): a file in the repository, relative to its root.
import { PmkitError } from './errors.mjs'

/**
 * The path as it is stored and linked: `./` and doubled slashes dropped, so the same file is one doc. A path that is absolute,
 * a `tracker:` label, has a `..` part or names no file is INVALID_INPUT, because the link built from it would be broken.
 */
export function repoDocPath(path) {
  const bad = (why) => new PmkitError('INVALID_INPUT', `the doc path ${JSON.stringify(path)} ${why}`, 'Pass the path of a file in the repository, relative to its root, such as docs/adr/0001-use-points.md')
  if (typeof path !== 'string' || /^(?:[A-Za-z]:|[/\\]|tracker:)/.test(path)) throw bad('is not a path relative to the repository root')
  const parts = path.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.includes('..')) throw bad('leaves the repository')
  if (parts.length === 0) throw bad('names no file')
  return parts.join('/')
}
