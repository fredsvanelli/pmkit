import path from 'node:path'

/**
 * True when `rel`, a relative path, climbs out of its base. A name that only starts with two dots, such as `..board.md`, stays inside.
 * The separator does not matter (a list of written files uses `/`, `path.relative` uses `path.sep`), and an absolute path of either
 * flavour counts, so a Windows path is seen on any system (PMK-268).
 */
export const climbsOut = (rel) => rel === '..' || /^\.\.[\\/]/.test(rel) || path.isAbsolute(rel) || path.win32.isAbsolute(rel)

/** `text` with each folder of `dirs` removed from the paths that start with it, which leaves them relative; a folder alone becomes `.`. A longer name that only starts with the folder, such as /tmp/tracker for /tmp/t, is left as it is. */
export const relativeTo = (text, dirs) => {
  let result = text
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
    result = result.replace(new RegExp(`${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:([\\\\/])|(?=['"\\s:]|$))`, 'g'), (_, separator) => (separator ? '' : '.'))
  }
  return result
}
