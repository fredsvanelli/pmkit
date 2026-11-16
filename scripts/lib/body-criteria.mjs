/** Acceptance criteria in an issue body, shared by the Linear and GitHub adapters. */
export const CRITERIA_HEADING = '## Acceptance criteria'
const CHECKLIST = /^[-*] \[( |x|X)\] (.*)$/
const isBlank = (line) => line.trim() === ''

/** The lines as text without blank lines at either end. */
const trimLines = (lines) => lines.join('\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd()

/** The kept lines of the section, where removing the checklist can leave two blank lines in a row: each run becomes one. */
const squeeze = (lines) => lines.filter((line, index) => !(isBlank(line) && index > 0 && isBlank(lines[index - 1])))

/**
 * Splits a Linear description into the pmkit description and the checklist of its acceptance criteria section.
 * The section starts at the line "## Acceptance criteria" and ends at the next "## " heading. A line in it that is
 * not a checklist item stays in the description, where it was, so a read never drops text.
 */
export function parseDescription(text) {
  const lines = (text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const start = lines.findIndex((line) => line.trimEnd() === CRITERIA_HEADING)
  if (start < 0) return { description: lines.join('\n').trim(), acceptanceCriteria: [] }
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  if (end < 0) end = lines.length
  const acceptanceCriteria = []
  const notes = []
  for (const line of lines.slice(start + 1, end)) {
    const match = CHECKLIST.exec(line.trimEnd())
    if (match) acceptanceCriteria.push({ text: match[2].trim(), done: match[1] !== ' ' })
    else notes.push(line)
  }
  const parts = [lines.slice(0, start), squeeze(notes), lines.slice(end)].map(trimLines).filter((part) => part !== '')
  return { description: parts.join('\n\n').trim(), acceptanceCriteria }
}

/** The Linear description for a pmkit description and its criteria. No criteria means no section. */
export function buildDescription(description, criteria) {
  const section = criteria.length === 0 ? '' : [CRITERIA_HEADING, '', ...criteria.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`)].join('\n')
  return [description.trim(), section].filter((part) => part !== '').join('\n\n')
}
