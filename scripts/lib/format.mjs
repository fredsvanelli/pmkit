// Plain-text output for the CLI: tables, key: value records and before → after changes.

const show = (value) => {
  if (value === undefined || value === null || value === '') return '(none)'
  if (Array.isArray(value)) return value.length === 0 ? '(none)' : value.map(show).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function table(header, rows) {
  const cells = [header, ...rows].map((row) => row.map((cell) => String(cell ?? '').replace(/\s+/g, ' ')))
  const widths = header.map((_, column) => Math.max(...cells.map((row) => row[column].length)))
  const line = (row) => row.map((cell, column) => cell.padEnd(widths[column])).join(' | ').trimEnd()
  return [line(cells[0]), widths.map((width) => '-'.repeat(width)).join('-|-'), ...cells.slice(1).map(line)].join('\n')
}

/** `key: value` lines for the pairs whose value is present. */
export const fields = (pairs) => pairs
  .filter(([, value]) => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0))
  .map(([key, value]) => `${key}: ${show(value)}`)

export function issueTable(issues, { sprint = true } = {}) {
  if (issues.length === 0) return 'no issues'
  const header = ['ID', 'Title', 'Status', 'Assignee', 'Estimate', ...(sprint ? ['Sprint'] : [])]
  return table(header, issues.map((issue) => [
    issue.id, issue.title, issue.status.name, issue.assignee ?? '', issue.estimate ?? '', ...(sprint ? [issue.sprint ?? ''] : []),
  ]))
}

const criteriaLines = (criteria) => criteria.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`)

export function issueRecord(issue) {
  const lines = fields([
    ['id', issue.id], ['title', issue.title], ['type', issue.type],
    ['status', `${issue.status.name} (${issue.status.category})`],
    ['priority', issue.priority], ['estimate', issue.estimate], ['assignee', issue.assignee], ['labels', issue.labels],
    ['parent', issue.parent], ['sprint', issue.sprint], ['milestone', issue.milestone], ['release', issue.release], ['due', issue.due], ['branch', issue.branch],
    ['blocked_by', issue.blockedBy], ['blocks', issue.blocks], ['related', issue.related], ['duplicate_of', issue.duplicateOf],
    ['children', issue.children], ['archived', issue.archived ? true : undefined],
    ['created', issue.created], ['updated', issue.updated],
  ])
  if (issue.acceptanceCriteria.length > 0) lines.push('acceptance criteria:', ...criteriaLines(issue.acceptanceCriteria))
  if (issue.description) lines.push('', issue.description)
  return lines.join('\n')
}

export function epicRecord(epic) {
  const lines = fields([
    ['id', epic.id], ['title', epic.title], ['status', `${epic.status.name} (${epic.status.category})`],
    ['start', epic.start], ['target', epic.target], ['milestone', epic.milestone],
  ])
  if (epic.description) lines.push('', epic.description)
  return lines.join('\n')
}

export function milestoneRecord(milestone) {
  const lines = fields([['id', milestone.id], ['name', milestone.name], ['due', milestone.due]])
  if (milestone.description) lines.push('', milestone.description)
  return lines.join('\n')
}

export const sprintRecord = (sprint) => fields([
  ['id', sprint.id], ['name', sprint.name], ['state', sprint.state], ['start', sprint.start], ['end', sprint.end],
  ['goal', sprint.goal], ['capacity', sprint.capacity], ['days off', sprint.daysOff],
]).join('\n')

const SKIPPED = new Set(['body', 'updated'])

// The value a change line shows. Long bodies and criteria lists are summarized.
function flatten(record) {
  const flat = {}
  for (const [key, value] of Object.entries(record)) {
    if (SKIPPED.has(key)) continue
    if (key === 'status' && value?.name) flat.status = value.name
    else if (key === 'acceptanceCriteria') flat['acceptance criteria'] = value.length === 0 ? undefined : criteriaLines(value).join('; ')
    else if (key === 'description') flat.description = value === '' ? undefined : 'text'
    else flat[key] = value
  }
  return flat
}

/** One `field: before → after` line per changed field. */
export function changeLines(before, after) {
  const a = flatten(before)
  const b = flatten(after)
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
  return keys
    .filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    .map((key) => (key === 'description' ? 'description: changed' : `${key}: ${show(a[key])} → ${show(b[key])}`))
}

function describeEvent(event) {
  if (event.op === 'create') return event.to?.title ?? ''
  if (event.field) return `${event.field}: ${show(event.from)} → ${show(event.to)}`
  return [event.minutes && `${event.minutes} min`, typeof event.to === 'string' ? event.to : ''].filter(Boolean).join(' ')
}

export const eventTable = (events) => (events.length === 0
  ? 'no events'
  : table(['At', 'Issue', 'By', 'Op', 'Change'], events.map((event) => [
    event.at, event.issue ?? '', event.by, event.op,
    describeEvent(event),
  ])))
