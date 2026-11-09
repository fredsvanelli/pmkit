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
