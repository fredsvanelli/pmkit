// Static views of the tracker for people outside the agent (PMK-25). A view function turns plain view data
// into a format-neutral document, and toMarkdown or toHtml writes it. Nothing here reads the tracker or the clock.
//
// Doc     { title, lead: string[], sections: Section[], closing: string[], columns: boolean }
// Section { heading, lines: string[], table: { header: string[], rows: Cell[][] } | null, empty: string | null }
// Cell    string | { text: string, tone: string }

const MARKER_PREFIX = '<!-- pmkit render '

/** The comment that marks a file as rendered: line 1 of Markdown, line 2 of HTML. */
export const marker = (view) => `${MARKER_PREFIX}${view}: generated from the tracker files; the next render replaces this file -->`

/** True when line 1 or line 2 of `text` starts with the render marker. */
export function hasMarker(text) {
  return text.replace(/^\uFEFF/, '').split('\n').slice(0, 2).some((line) => line.startsWith(MARKER_PREFIX))
}

const oneLine = (text) => String(text).replace(/\r\n|\r|\n/g, ' ')

/** Escapes the characters that would start Markdown syntax or HTML, and turns line breaks into spaces. */
export const escapeMarkdown = (text) => oneLine(text).replace(/[\\`*_[\]<>|]/g, (char) => `\\${char}`)

const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Replaces &, <, >, " and ' with their entities. Every tracker string in an HTML view goes through it. */
export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => HTML_ENTITIES[char])

const cellText = (cell) => (typeof cell === 'object' && cell !== null ? cell.text : cell ?? '')
const cellTone = (cell) => (typeof cell === 'object' && cell !== null ? cell.tone : null)

/** A document ends with exactly one newline. */
const finish = (lines) => `${lines.join('\n').replace(/\n+$/, '')}\n`

export function toMarkdown(doc, view) {
  const out = [marker(view), '', `# ${escapeMarkdown(doc.title)}`]
  const paragraph = (line) => out.push('', escapeMarkdown(line))
  doc.lead.forEach(paragraph)
  for (const section of doc.sections) {
    out.push('', `## ${escapeMarkdown(section.heading)}`)
    section.lines.forEach(paragraph)
    if (section.table !== null && section.table.rows.length > 0) {
      const row = (cells) => `| ${cells.map((cell) => escapeMarkdown(cellText(cell))).join(' | ')} |`
      out.push('', row(section.table.header), `| ${section.table.header.map(() => '---').join(' | ')} |`, ...section.table.rows.map(row))
    } else if (section.empty !== null) {
      paragraph(section.empty)
    }
  }
  doc.closing.forEach(paragraph)
  return finish(out)
}

const STYLE = `:root {
  color-scheme: light dark;
  --bg: #ffffff; --fg: #1f2328; --muted: #59636e; --line: #d1d9e0; --card: #f6f8fa;
  --on-track: #1a7f37; --at-risk: #9a6700; --off-track: #d1242f;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --line: #3d444d; --card: #151b23;
    --on-track: #3fb950; --at-risk: #d29922; --off-track: #f85149;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1200px; margin: 0 auto; padding: 24px 16px; }
h1 { margin: 0 0 8px; font-size: 1.6em; }
h2 { margin: 24px 0 8px; font-size: 1.2em; }
p { margin: 4px 0; }
.lead, .closing { color: var(--muted); }
.empty { color: var(--muted); font-style: italic; }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid var(--line); padding: 4px 8px; text-align: left; vertical-align: top; }
th { background: var(--card); }
.columns { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
.column { flex: 1 1 220px; min-width: 220px; }
.column h2 { margin-top: 8px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; }
.card-id { color: var(--muted); font-size: 0.85em; }
.card-title { font-weight: 600; }
.card dl { display: grid; grid-template-columns: auto 1fr; gap: 0 8px; margin: 4px 0 0; font-size: 0.85em; }
.card dt { color: var(--muted); }
.card dd { margin: 0; }
.tone-on_track { color: var(--on-track); font-weight: 600; }
.tone-at_risk { color: var(--at-risk); font-weight: 600; }
.tone-off_track { color: var(--off-track); font-weight: 600; }`

const toneClass = (cell) => (cellTone(cell) ? ` class="tone-${escapeHtml(cellTone(cell))}"` : '')

function htmlTable(table) {
  const head = table.header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')
  const rows = table.rows.map((row) => `<tr>${row.map((cell) => `<td${toneClass(cell)}>${escapeHtml(cellText(cell))}</td>`).join('')}</tr>`)
  return ['<div class="table-wrap"><table>', `<thead><tr>${head}</tr></thead>`, '<tbody>', ...rows, '</tbody>', '</table></div>']
}

// A card holds the first two cells as its head and every other non-empty cell under its header.
function htmlCard(header, row) {
  const [id, title, ...rest] = row
  const details = rest
    .map((cell, index) => [header[index + 2], cell])
    .filter(([, cell]) => cellText(cell) !== '')
    .map(([name, cell]) => `<dt>${escapeHtml(name)}</dt><dd${toneClass(cell)}>${escapeHtml(cellText(cell))}</dd>`)
  return [
    '<div class="card">',
    `<div class="card-id">${escapeHtml(cellText(id))}</div>`,
    `<div class="card-title">${escapeHtml(cellText(title))}</div>`,
    ...(details.length > 0 ? [`<dl>${details.join('')}</dl>`] : []),
    '</div>',
  ]
}

function htmlSection(section, columns) {
  const out = [columns ? '<section class="column">' : '<section>', `<h2>${escapeHtml(section.heading)}</h2>`]
  for (const line of section.lines) out.push(`<p>${escapeHtml(line)}</p>`)
  if (section.table !== null && section.table.rows.length > 0) {
    if (columns) out.push(...section.table.rows.flatMap((row) => htmlCard(section.table.header, row)))
    else out.push(...htmlTable(section.table))
  } else if (section.empty !== null) {
    out.push(`<p class="empty">${escapeHtml(section.empty)}</p>`)
  }
  out.push('</section>')
  return out
}

export function toHtml(doc, view) {
  const sections = doc.sections.flatMap((section) => htmlSection(section, doc.columns))
  return finish([
    '<!doctype html>',
    marker(view),
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(doc.title)}</title>`,
    '<style>',
    STYLE,
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    `<h1>${escapeHtml(doc.title)}</h1>`,
    ...doc.lead.map((line) => `<p class="lead">${escapeHtml(line)}</p>`),
    ...(doc.columns ? ['<div class="columns">', ...sections, '</div>'] : sections),
    ...doc.closing.map((line) => `<p class="closing">${escapeHtml(line)}</p>`),
    '</main>',
    '</body>',
    '</html>',
  ])
}

/** Writes `doc` as Markdown (`md`) or HTML (`html`). */
export const renderDocument = (doc, view, format) => (format === 'html' ? toHtml(doc, view) : toMarkdown(doc, view))

// View documents. Each takes the plain data of render-data.mjs; every string in it is raw tracker text.

/** `1 issue`, `2 issues`. */
export const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`

/** A status or category name as a heading: `in_review` becomes `In review`. */
export const statusLabel = (name) => {
  const spaced = String(name).replaceAll('_', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** The closing line for issues that could not be read, or null when there are none. */
export function problemsLine(problems) {
  if (problems.length === 0) return null
  return `${plural(problems.length, 'issue')} could not be read: ${problems.map((p) => p.id).join(', ')}; run /pmkit:local:doctor`
}

const asOfLines = (data) => (data.asOf === null ? [] : [`Tracker state as of ${data.asOf}`])
const closingLines = (data) => [problemsLine(data.problems)].filter((line) => line !== null)

/** Sizes do not add up, so a total in sizes is left out. */
export const addsUp = (unit) => unit !== 'sizes'
const numeric = (value) => (typeof value === 'number' ? value : 0)
/** `19 points`, `1 hour`. */
export const amount = (n, unit) => `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}`

const ISSUE_HEADER = ['ID', 'Title', 'Type', 'Priority', 'Assignee', 'Estimate', 'Notes']

function issueNotes(issue) {
  const notes = []
  if (issue.blockedBy.length > 0) notes.push(`blocked by ${issue.blockedBy.join(', ')}`)
  if (issue.labels.length > 0) notes.push(`labels: ${issue.labels.join(', ')}`)
  return notes.join('; ')
}

/** The issue table of the board and the sprint view. */
export function issueTable(issues) {
  return {
    header: ISSUE_HEADER,
    rows: issues.map((issue) => [
      issue.id, issue.title, issue.type ?? '', issue.priority ?? '', issue.assignee, issue.estimate === null ? '' : String(issue.estimate), issueNotes(issue),
    ]),
  }
}

export function boardDoc(data) {
  const open = data.statuses.flatMap((status) => status.issues)
  const points = open.reduce((sum, issue) => sum + numeric(issue.estimate), 0)
  const summary = [plural(open.length, 'open issue'), ...(addsUp(data.unit) ? [`${amount(points, data.unit)} open`] : []), `done: ${data.done}`, `canceled: ${data.canceled}`]
  return {
    title: 'Board',
    lead: [...asOfLines(data), summary.join(', ')],
    sections: data.statuses.map((status) => ({
      heading: `${statusLabel(status.name)} (${status.issues.length})`,
      lines: [],
      table: status.issues.length > 0 ? issueTable(status.issues) : null,
      empty: status.issues.length > 0 ? null : 'No issues',
    })),
    closing: closingLines(data),
    columns: true,
  }
}
