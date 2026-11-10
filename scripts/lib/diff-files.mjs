// The files of a unified diff (git diff, gh pr diff), for reading a cut diff file by file and placing inline review comments.

const ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 }

/**
 * A path as git writes it after `--- `, `+++ `, `rename to ` or in the header. git ends a path that holds a space with a TAB, and
 * quotes a path with a control or non-ASCII character in C style (`"caf\303\251.txt"`, octal escapes of the UTF-8 bytes).
 * Returns { path, rest }: the path read, and the text after it.
 */
function readPath(text) {
  if (!text.startsWith('"')) return { path: text.replace(/\t$/, ''), rest: '' }
  const bytes = []
  let i = 1
  for (; i < text.length && text[i] !== '"'; i++) {
    if (text[i] !== '\\') {
      bytes.push(...Buffer.from(text[i]))
    } else if (/[0-7]/.test(text[i + 1] ?? '')) {
      bytes.push(parseInt(text.slice(i + 1, i + 4), 8))
      i += 3
    } else {
      bytes.push(ESCAPES[text[i + 1]] ?? text.charCodeAt(i + 1))
      i += 1
    }
  }
  return { path: Buffer.from(bytes).toString('utf8'), rest: text.slice(i + 1) }
}

const withoutPrefix = (file, prefix) => (file.startsWith(prefix) ? file.slice(prefix.length) : file)

/** The path of one `diff --git` section: the new path, or the old one for a deleted file. */
function sectionPath(lines) {
  const after = (start) => lines.find((line) => line.startsWith(start))?.slice(start.length)
  const plus = after('+++ ')
  if (plus !== undefined && plus !== '/dev/null') return withoutPrefix(readPath(plus).path, 'b/')
  const minus = after('--- ')
  if (minus !== undefined && minus !== '/dev/null') return withoutPrefix(readPath(minus).path, 'a/')
  const moved = after('rename to ') ?? after('copy to ')
  if (moved !== undefined) return readPath(moved).path
  // A binary or mode-only change has no ---/+++ lines. Its header is `a/<p> b/<p>`, the same <p> twice (spaces included), or two quoted paths.
  const header = lines[0].slice('diff --git '.length)
  if (header.startsWith('"')) {
    const second = readPath(header).rest.trimStart()
    return withoutPrefix(second.startsWith('"') ? readPath(second).path : second, 'b/')
  }
  return header.startsWith('a/') && (header.length - 5) % 2 === 0 ? header.slice(2, 2 + (header.length - 5) / 2) : header
}

/** The sections of a diff, in order: { path, text }. The texts joined give the diff back. */
export function splitDiff(diff) {
  const sections = []
  for (const line of diff.split(/(?<=\n)/)) {
    if (line.startsWith('diff --git ') || sections.length === 0) sections.push({ lines: [] })
    sections[sections.length - 1].lines.push(line)
  }
  return sections.filter((s) => s.lines.join('') !== '').map((s) => ({ path: sectionPath(s.lines.map((l) => l.replace(/\r?\n$/, ''))), text: s.lines.join('') }))
}

/**
 * The new-file line numbers that a review comment can point at: the added and context lines of each hunk of one section.
 * A hunk holds as many new lines as its header declares, so a line after them is not counted. An empty line in a hunk is a
 * context line whose leading space was stripped.
 */
export function rightLines(section) {
  const found = new Set()
  let next = 0
  let left = 0
  for (const line of section.replace(/\n$/, '').split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (hunk) {
      next = Number(hunk[1])
      left = hunk[2] === undefined ? 1 : Number(hunk[2])
    } else if (left > 0 && (line.startsWith('+') || line.startsWith(' ') || line === '')) {
      found.add(next++)
      left--
    }
  }
  return found
}
