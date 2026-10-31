// The user inbox of the Local tracker: the rule that decides when text mentions a member.
// See docs/superpowers/specs/2026-10-31-pmk-47-user-inbox-design.md, "What counts".

export const MAX_EXCERPT = 200
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The lines of a Markdown body with fenced code blocks and inline code spans blanked, as CommonMark reads them: a fence opens with
 * three or more backticks or tildes and closes with the same character, at least as many, and nothing else on the line.
 * An unclosed fence runs to the end.
 */
function withoutCode(text) {
  let open = null
  return text.replace(/\r\n?/g, '\n').split('\n').map((line) => {
    if (open !== null) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
      if (close && close[1][0] === open.char && close[1].length >= open.length) open = null
      return ''
    }
    const start = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    // The info string of a backtick fence holds no backtick, so a line like "``` a `b`" is text.
    if (start && !(start[1][0] === '`' && start[2].includes('`'))) {
      open = { char: start[1][0], length: start[1].length }
      return ''
    }
    return line.replace(/(`+)[^`\n]*?\1/g, '')
  })
}

/**
 * Every line of text that mentions `member` as `@member`, trimmed and cut at 200 characters, in order.
 * The match ignores case. The `@` must not follow a letter, digit, `_`, `.`, `+`, `-`, `/` or `\`, so an email does not match.
 * The id must not continue with a letter, digit, `_` or `-`, or with a `.` and a letter or digit, so `@fredo` and `@fred.com`
 * do not match and `thanks @fred.` does. Text in code does not count. With `full`, the lines are not cut.
 */
export function findMentions(text, member, { full = false } = {}) {
  if (typeof text !== 'string' || text === '') return []
  const pattern = new RegExp(`(?<![A-Za-z0-9_.+\\\\/-])@${escapeRegExp(member)}(?![A-Za-z0-9_-])(?!\\.[A-Za-z0-9])`, 'i')
  const original = text.replace(/\r\n?/g, '\n').split('\n')
  return withoutCode(text)
    .map((line, index) => (pattern.test(line) ? original[index].trim() : null))
    .filter((line) => line !== null)
    .map((line) => (full ? line : line.slice(0, MAX_EXCERPT)))
}

/** The first line of text that mentions `member`, or null. See findMentions. */
export function findMention(text, member, options) {
  return findMentions(text, member, options)[0] ?? null
}

/** A mention line as the key of an item sees it: without the list marker or checkbox, with white space collapsed. Ticking a criterion keeps it. */
export function mentionText(line) {
  return line.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '').replace(/\s+/g, ' ').trim()
}
