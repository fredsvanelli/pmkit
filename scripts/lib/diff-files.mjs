// The files of a unified diff (git diff, gh pr diff), for reading a cut diff file by file and placing inline review comments.

/** The path of one `diff --git` section: the new path, or the old one for a deleted file. A quoted path stays as git quotes it. */
function sectionPath(lines) {
  const plus = lines.find((line) => line.startsWith('+++ '))
  if (plus && plus !== '+++ /dev/null') return plus.slice(4).replace(/^b\//, '')
  const minus = lines.find((line) => line.startsWith('--- '))
  if (minus && minus !== '--- /dev/null') return minus.slice(4).replace(/^a\//, '')
  const renamed = lines.find((line) => line.startsWith('rename to '))
  if (renamed) return renamed.slice('rename to '.length)
  // A binary or mode-only change has no ---/+++ lines. Its header is `a/<p> b/<p>` with the same <p> twice, spaces included.
  const header = lines[0].slice('diff --git '.length)
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

/** The new-file line numbers that a review comment can point at: the added and context lines of each hunk of one section. */
export function rightLines(section) {
  const found = new Set()
  let next = null
  for (const line of section.replace(/\n$/, '').split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) next = Number(hunk[1])
    else if (next === null || line.startsWith('-') || line.startsWith('\\')) continue
    else if (line.startsWith('+') || line.startsWith(' ') || line === '') found.add(next++)
  }
  return found
}
