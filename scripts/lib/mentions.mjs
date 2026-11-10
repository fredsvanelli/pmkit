// The mention rule of `issues delete` and of /pmkit:backlog:prioritize-by-demand: text names an issue ID as a whole token.

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// A path or a URL is not a mention. The target of a markdown link and bare URLs go first, so a link keeps its text; then a token with a separator that starts with . ~ or /,
// has two separators or ends in a file extension is a path. "ISS-1/", "ISS-1/2" and "ISS-1/ISS-2" stay.
const idLike = /^\(?[A-Za-z]+-[A-Za-z0-9]+[.,;:)]*$/
const pathLike = (token) => /[/\\]/.test(token) && !token.split(/[/\\]/).every((part) => idLike.test(part))
  && (/^[.~/\\]/.test(token) || token.match(/[/\\]/g).length >= 2 || /[/\\][^/\\\s]*\.[A-Za-z0-9]+[.,;:)]*$/.test(token))

/** A predicate: does a text mention `id`? The ID is not directly preceded by a letter or digit, nor followed by a letter, digit or underscore. */
export function mentionedIn(id) {
  const mention = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(id)}(?![A-Za-z0-9_])`)
  return (text) => mention.test(text.replace(/\]\([^)\s]*\)/g, ']').replace(/https?:\/\/\S+/g, ' ').replace(/\S+/g, (token) => (pathLike(token) ? ' ' : token)))
}

/**
 * The files that mention `id`, from the output of `git grep -z -n` (`path\0line\0text` per line): the lines the mention rule accepts,
 * grouped by file and sorted by path. PMK-222.
 */
export function fileMentions(id, output) {
  const mentioned = mentionedIn(id)
  const byPath = new Map()
  for (const row of output.split('\n')) {
    const [file, line, ...text] = row.split('\0')
    if (text.length === 0 || !mentioned(text.join('\0').replace(/\r$/, ''))) continue
    if (!byPath.has(file)) byPath.set(file, [])
    byPath.get(file).push(Number(line))
  }
  return [...byPath].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([file, lines]) => ({ path: file, lines }))
}
