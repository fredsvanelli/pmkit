// The user inbox of the Local tracker: the rule that decides when text mentions a member.
// See docs/superpowers/specs/2026-10-31-pmk-47-user-inbox-design.md, "What counts".

const MAX_EXCERPT = 200
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The text of a Markdown body with fenced code blocks and inline code spans blanked. An unclosed fence runs to the end. */
function withoutCode(text) {
  let fenced = false
  return text.replace(/\r\n?/g, '\n').split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      return ''
    }
    return fenced ? '' : line.replace(/(`+)[^`\n]*?\1/g, '')
  })
}

/**
 * The first line of text that mentions `member` as `@member`, trimmed and cut at 200 characters, or null.
 * The match ignores case. The `@` must not follow a letter, digit, `_`, `.`, `+`, `-`, `/` or `\`, so an email does not match.
 * The id must not continue with a letter, digit, `_` or `-`, or with a `.` and a letter or digit, so `@fredo` and `@fred.com`
 * do not match and `thanks @fred.` does. Text in code does not count.
 */
export function findMention(text, member) {
  if (typeof text !== 'string' || text === '') return null
  const pattern = new RegExp(`(?<![A-Za-z0-9_.+\\\\/-])@${escapeRegExp(member)}(?![A-Za-z0-9_-])(?!\\.[A-Za-z0-9])`, 'i')
  const original = text.replace(/\r\n?/g, '\n').split('\n')
  const lines = withoutCode(text)
  const index = lines.findIndex((line) => pattern.test(line))
  return index === -1 ? null : original[index].trim().slice(0, MAX_EXCERPT)
}
