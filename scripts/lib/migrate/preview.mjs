// The preview of a migration plan, as text and as JSON. Pure. See the PMK-41 spec, "The preview".

const STEP_LABELS = {
  export: {
    reads: 'reads before the first write',
    label: 'labels to create',
    epic: 'epics as projects',
    issue: 'issues',
    link: 'links',
    comment: 'comments',
    thread: 'resolved threads',
    update: 'status updates',
    archive: 'archived issues',
  },
  import: {
    reads: 'reads of the Linear team',
    member: 'new members',
    label: 'labels',
    sprint: 'cycles as sprints',
    epic: 'projects as epics',
    update: 'status updates',
    issue: 'issues',
    comment: 'comments',
  },
}

const SECTIONS = {
  export: { label: 'labels', epic: 'epics', issue: 'issues', link: 'links', comment: 'comments', thread: 'resolved threads', update: 'status updates', archive: 'archived issues' },
  import: { member: 'members', label: 'labels', sprint: 'sprints', epic: 'epics', update: 'status updates', issue: 'issues', comment: 'comments' },
}

const NOUNS = {
  export: { label: 'new label', epic: 'new project', issue: 'new issue', link: 'new link', comment: 'new comment', thread: 'resolve', update: 'new status update', archive: 'archive' },
  import: { member: 'new member', label: 'new label', sprint: 'new sprint', epic: 'new epic', update: 'new status update', issue: 'new issue', comment: 'new comment' },
}

const GAP = '   '

/** Rows of cells, each column padded to its widest cell, with three spaces between columns. */
function aligned(rows, indent = '  ') {
  const widths = []
  for (const row of rows) row.forEach((cell, i) => { widths[i] = Math.max(widths[i] ?? 0, String(cell).length) })
  return rows.map((row) => `${indent}${row.map((cell, i) => (i === row.length - 1 ? String(cell) : String(cell).padEnd(widths[i]))).join(GAP)}`.trimEnd())
}

const clock = (iso) => (iso ? `${String(iso).slice(11, 16)}Z` : 'the reset')

function stepLabel(plan, step) {
  const label = STEP_LABELS[plan.direction][step.kind] ?? step.kind
  if (plan.direction !== 'export' || step.kind !== 'link') return label
  const count = (kind) => plan.records.link.filter((record) => (record.source?.kind ?? record.fields?.type) === kind).length
  return `${label} (${count('blocks')} blocks, ${count('related')} related, ${count('duplicate')} duplicate)`
}

function stepTable(plan) {
  const resuming = Boolean(plan.resume?.map)
  const rows = plan.steps.map((step) => {
    const records = plan.records[step.kind] ?? []
    const row = [String(step.step), stepLabel(plan, step), step.records === null ? '-' : String(step.records), String(step.requests)]
    if (resuming) {
      if (step.kind === 'reads') row.push('')
      else {
        const done = records.filter((record) => record.action === 'skip').length
        const sent = records.filter((record) => record.action === 'create' && record.entryState).length
        row.push(`${done}/${sent}/${records.length - done}`)
      }
    }
    return row
  })
  const total = ['', 'total', '', String(plan.requests)]
  if (resuming) total.push('')
  const header = ['step', 'what', 'records', 'requests']
  if (resuming) header.push('done/sent/to send')
  const all = [header, ...rows, total]
  const widths = header.map((_, i) => Math.max(...all.map((row) => row[i].length)))
  widths[1] += 3
  const line = (row) => [
    row[0].padEnd(6),
    row[1].padEnd(widths[1]),
    row[2].padStart(widths[2]),
    `  ${row[3].padStart(widths[3])}`,
    ...(resuming ? [`  ${row[4]}`] : []),
  ].join('').trimEnd()
  return all.map(line)
}

function budgetLine(plan, budget) {
  if (plan.direction !== 'export' || !budget) return []
  if (budget.remaining === null) return [`budget: ${budget.requests} requests; Linear has not said how many are left this hour`]
  let line = `budget: ${budget.requests} requests of ${budget.remaining} left this hour (resets ${clock(budget.resetAt)}), ${budget.reserve} kept in reserve`
  if (budget.fits === false) line += `; the run stops after about ${budget.stopsAfter} writes; run it again after ${clock(budget.resetAt)} to finish`
  return [line]
}

function recordLine(plan, kind, record) {
  const source = record.source ?? {}
  const action = record.action === 'skip'
    ? `done ${record.target}`
    : [NOUNS[plan.direction][kind] ?? 'new record', source.summary].filter(Boolean).join(', ')
  return [source.id ?? record.key, source.title ?? '', action]
}

/** The full preview: header, problems, step table, budget, people, every record, the losses and the digest. */
export function previewText(plan, budget, { dryRun = false, header }) {
  const out = [
    `${plan.direction} ${header.source} ${plan.direction === 'export' ? 'to' : 'into'} ${header.target}`,
    `source: ${header.sourceCounts}`,
    `target: ${header.targetCounts}`,
  ]
  if (plan.problems.length > 0) {
    out.push('', 'problems: the run refuses until these are fixed', ...aligned(plan.problems.map((problem) => [problem.key, problem.message])))
  }
  out.push('', ...stepTable(plan), ...budgetLine(plan, budget))
  if (plan.resume?.map) out.push(`resume: ${plan.resume.map}, ${plan.resume.done} done, ${plan.resume.sent} sent, ${plan.resume.failed} failed`)
  if (plan.people.length > 0) {
    out.push('', 'people', ...aligned(plan.people.map((person) => [person.id, person.email ? `${person.name} <${person.email}>` : person.name, person.note ?? ''])))
  }
  for (const [kind, title] of Object.entries(SECTIONS[plan.direction])) {
    const records = plan.records[kind] ?? []
    if (records.length === 0) continue
    out.push('', title, ...aligned(records.map((record) => recordLine(plan, kind, record))))
  }
  if (plan.losses.length > 0) out.push('', 'will not carry over', ...aligned(plan.losses.map((loss) => [loss.what, loss.why])))
  out.push('', `digest: ${plan.digest}`)
  if (dryRun) out.push('dry run: nothing was written')
  return out.join('\n')
}

/** The JSON shape of the preview. Each record is `{ source, action, target, fields, dropped }`. */
export function previewJson(plan, budget) {
  const records = Object.fromEntries(Object.entries(plan.records).map(([kind, list]) => [kind, list.map((record) => ({
    source: record.key, action: record.action, target: record.target ?? null, fields: record.fields ?? {}, dropped: record.dropped ?? [],
  }))]))
  return {
    direction: plan.direction,
    source: plan.source,
    target: plan.target,
    steps: plan.steps,
    records,
    people: plan.people,
    losses: plan.losses,
    problems: plan.problems,
    budget: budget ? { requests: budget.requests, remaining: budget.remaining, reserve: budget.reserve, resetAt: budget.resetAt, fits: budget.fits } : null,
    resume: plan.resume,
    digest: plan.digest,
  }
}
