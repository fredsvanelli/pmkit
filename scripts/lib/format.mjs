import { tooDeep } from './dependencies.mjs'

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

/** A share from 0 to 1 as a whole percent. */
export const percent = (share) => `${Math.round(share * 100)}%`

/** The milestones or documents of an epic as an indented list under a heading, or nothing when it has none. */
function listLines(heading, items, line, more) {
  if (!Array.isArray(items) || items.length === 0) return []
  return ['', `${heading}:`, ...items.map((item) => `  ${line(item)}`), ...(more ? ['  (more in Linear)'] : [])]
}

export function epicRecord(epic) {
  const lines = fields([
    ['id', epic.id], ['title', epic.title], ['status', `${epic.status.name} (${epic.status.category})`],
    ['start', epic.start], ['target', epic.target], ['milestone', epic.milestone],
    ['health', epic.health], ['progress', epic.progress === undefined ? undefined : percent(epic.progress)], ['url', epic.url],
  ])
  lines.push(
    ...listLines('milestones', epic.milestones, (m) => [m.id, m.name, ...(m.due ? [`due ${m.due}`] : []), ...(m.status ? [m.status] : [])].join('  '), epic.milestonesMore),
    ...listLines('documents', epic.documents, (d) => `${d.path}  ${d.title}`, epic.documentsMore),
  )
  if (epic.description) lines.push('', epic.description)
  return lines.join('\n')
}

export function milestoneRecord(milestone) {
  const lines = fields([['id', milestone.id], ['name', milestone.name], ['due', milestone.due]])
  if (milestone.description) lines.push('', milestone.description)
  return lines.join('\n')
}

export function releaseRecord(release) {
  const lines = fields([
    ['id', release.id], ['name', release.name], ['state', release.state], ['tag', release.tag], ['target', release.target], ['released', release.released],
  ])
  if (release.description) lines.push('', release.description)
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

const REASON_LINES = {
  none: (id) => `no open issue in the scope of ${id} has a blocker`,
  resolved: (id) => `every blocker of ${id} is done or canceled`,
  absent: () => 'this tracker has no dependencies capability',
}

/** The text of `issues dependencies`: the target, the critical path, the blocker chain and the hierarchy. */
export function dependencyText(map) {
  try {
    return renderDependencies(map)
  } catch (error) {
    throw tooDeep(error)
  }
}

function renderDependencies(map) {
  const { target } = map
  const byId = new Map(map.nodes.map((node) => [node.id, node]))
  const body = (node) => {
    if (node.missing) return `${node.id}  (missing)`
    if (node.unreadable) return `${node.id}  (unreadable)`
    const marks = [...(node.outside ? [`outside ${target.id}`] : []), ...(node.archived ? ['archived'] : [])]
    const text = `${node.id}  ${node.title}  ${node.status.name}  ${node.assignee ?? '-'}  ${node.estimate ?? '-'}`
    return marks.length > 0 ? `${text}  (${marks.join(', ')})` : text
  }
  const row = (node, depth) => `${'  '.repeat(depth)}${node.critical ? '* ' : '  '}${body(node)}`

  const lines = [`${target.id}  ${target.title}  ${target.status.name}`]
  if (target.ancestors.length > 0) lines.push(`parents: ${[...target.ancestors].reverse().join(' > ')}`)

  if (map.basis === 'blockers') {
    const { ids, length, unestimated } = map.criticalPath
    const unit = length === 1 ? map.weight.unit.replace(/s$/, '') : map.weight.unit
    lines.push(`critical path: ${ids.join(' → ')} (${length} ${unit})`)
    if (unestimated.length > 0) lines.push(`no estimate, counted as 0: ${unestimated.join(', ')}`)
    lines.push('', 'blocker chain:', ...chainRows(map, byId, row), '')
  } else {
    lines.push(`${REASON_LINES[map.reason](target.id)}, so this shows the hierarchy only`, '')
  }

  lines.push('hierarchy:')
  if (map.tree.length === 0) lines.push('  no issues')
  else lines.push(...treeRows(map, byId, row))

  if (map.basis === 'hierarchy' && map.related.length > 0) lines.push('', 'related links:', ...map.related.map(([a, b]) => `  ${a} and ${b}`))
  if (map.resolved > 0) lines.push(`${map.resolved} resolved blocker${map.resolved === 1 ? '' : 's'} not shown`)
  return lines.join('\n')
}

/** The blocker chain: each open scope issue with blockers that no open scope issue waits on, then its blockers, indented. */
function chainRows(map, byId, row) {
  const open = map.nodes.filter((node) => node.scope && node.open)
  const waitedOn = new Set(open.flatMap((node) => node.blockedBy))
  const end = map.criticalPath.ids.at(-1)
  // The end of the critical path is a root even with no blocker, so a lone heavy issue shows in the chain.
  const roots = open.filter((node) => !waitedOn.has(node.id) && (node.blockedBy.length > 0 || node.id === end))
  roots.sort((a, b) => (a.id === end ? -1 : b.id === end ? 1 : 0))
  const lines = []
  const printed = new Set()
  const print = (node, depth) => {
    if (printed.has(node.id)) {
      lines.push(`${row(node, depth)}  (shown above)`)
      return
    }
    printed.add(node.id)
    lines.push(row(node, depth))
    for (const id of node.blockedBy) print(byId.get(id), depth + 1)
  }
  for (const root of roots) print(root, 0)
  return lines
}

/** The hierarchy: open issues as rows, and the done or canceled ones with no open issue under them folded into a count per level. */
function treeRows(map, byId, row) {
  const hasOpen = (entry) => byId.get(entry.id).open || entry.children.some(hasOpen)
  const lines = []
  const print = (entries, depth, root = false) => {
    let folded = 0
    for (const entry of entries) {
      const node = byId.get(entry.id)
      if (!root && !hasOpen(entry)) {
        folded++
        continue
      }
      const blockers = node.blockedBy.length > 0 ? `  blocked by ${node.blockedBy.join(', ')}` : ''
      lines.push(`${row(node, depth)}${blockers}`)
      print(entry.children, depth + 1)
    }
    if (folded > 0) lines.push(`${'  '.repeat(depth)}  ${folded} done or canceled`)
  }
  print(map.tree, 0, map.target.kind === 'issue')
  return lines
}

const SKIP_PHRASES = { releases_absent: 'this tracker has no releases', no_released_release: 'no released release', no_closed_sprint: 'no closed sprint' }

function releaseNotesBasis(result) {
  const { basis, source, period } = result
  if (basis === 'release') {
    if (source.state === 'planned') return `release ${source.id} (planned${source.target ? `, target ${source.target}` : ''})`
    return `release ${source.id} (${source.tag ? `tag ${source.tag}, ` : ''}released ${String(source.released).slice(0, 10)})`
  }
  if (basis === 'sprint') return `sprint ${source.id} (${source.start} to ${source.end})`
  return `period ${period.since} to ${period.until}${period.defaulted ? ' (default window)' : ''}`
}

/** The text of `release-notes`: the basis, why, the draft flag, one table per type and the counts left out. */
export function releaseNotesText(result) {
  const lines = [releaseNotesBasis(result)]
  if (result.skipped.length > 0) {
    const phrases = result.skipped.map((step) => SKIP_PHRASES[step.reason]).join(', ')
    const used = result.basis === 'sprint'
      ? `sprint ${result.source.id}`
      : `the last ${Math.round((Date.parse(`${result.period.until}T00:00:00Z`) - Date.parse(`${result.period.since}T00:00:00Z`)) / 86400000)} days`
    lines.push(`${phrases}, so the notes use ${used}`)
  }
  if (result.draft) lines.push(result.basis === 'release' ? `draft: release ${result.source.id} is not released yet` : `draft: sprint ${result.source.id} is not closed`)
  lines.push('')
  if (result.groups.length === 0) lines.push('no done issues')
  const withDone = result.basis !== 'release'
  result.groups.forEach((group, index) => {
    if (index > 0) lines.push('')
    lines.push(`${group.type ?? 'no type'} (${group.issues.length})`)
    const header = ['ID', 'Title', ...(withDone ? ['Done'] : [])]
    lines.push(table(header, group.issues.map((i) => [i.id, i.title, ...(withDone ? [String(i.doneAt ?? '').slice(0, 10)] : [])])))
  })
  const { open, canceled, chore, after_close: afterClose } = result.counts.excluded
  const parts = [[open, 'not done'], [afterClose, 'done after the sprint closed'], [canceled, 'canceled'], [chore, 'chore']].filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`)
  if (parts.length > 0) lines.push('', `left out: ${parts.join(', ')}`)
  return lines.join('\n')
}
