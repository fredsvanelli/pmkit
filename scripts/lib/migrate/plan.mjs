// The plan of a migration: the order of writes, the action per record, the request count and the digest.
// Pure. See the PMK-41 spec, "Order of writes", "The preview" and "Pacing and the request budget".

import { compareIds } from '../ids.mjs'
import { compareTimes } from '../model.mjs'
import { EXPORT_KINDS, IMPORT_KINDS, sha256, stableStringify } from './snapshot.mjs'

export const RESERVE = { requests: 100, complexity: 10000 }
export const CHECK_PAGE = 100

const byCreated = (a, b) => compareTimes(a.created, b.created) || compareIds(a.id, b.id)

/** Each parent issue before its children, otherwise by creation time, then by id. A parent outside the list is no parent. */
export function orderParentsFirst(issues) {
  const byId = new Map(issues.map((issue) => [issue.id, issue]))
  const out = []
  const placed = new Set()
  const visit = (issue, path) => {
    if (placed.has(issue.id) || path.has(issue.id)) return
    path.add(issue.id)
    const parent = byId.get(issue.parent)
    if (parent) visit(parent, path)
    placed.add(issue.id)
    out.push(issue)
  }
  for (const issue of [...issues].sort(byCreated)) visit(issue, new Set())
  return out
}

/** Each parent loop as its list of ids, starting at the smallest id and following the parents. */
export function parentLoops(issues) {
  const byId = new Map(issues.map((issue) => [issue.id, issue]))
  const loops = new Map()
  for (const start of issues) {
    const seen = []
    let current = start
    while (current && !seen.includes(current.id)) {
      seen.push(current.id)
      current = byId.get(current.parent)
    }
    if (!current) continue
    const cycle = seen.slice(seen.indexOf(current.id))
    const smallest = [...cycle].sort(compareIds)[0]
    const at = cycle.indexOf(smallest)
    const loop = [...cycle.slice(at), ...cycle.slice(0, at)]
    loops.set(loop.join(' '), loop)
  }
  return [...loops.values()].sort((a, b) => compareIds(a[0], b[0]))
}

// The order of each kind, from what the snapshot says about its records.
function orderRecords(kind, records, snapshot) {
  const index = (ordered) => {
    const at = new Map(ordered.map((entry, i) => [entry.id, i]))
    return [...records].sort((a, b) => (at.get(a.key) ?? Infinity) - (at.get(b.key) ?? Infinity))
  }
  if (kind === 'issue') return index(orderParentsFirst(snapshot.issues ?? []))
  if (kind === 'comment') {
    const comments = [...(snapshot.comments ?? [])].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0) || byCreated(a, b))
    return index(comments)
  }
  if (kind === 'update') {
    const updates = (snapshot.epics ?? []).flatMap((epic) => epic.updates ?? []).sort((a, b) => compareTimes(a.at, b.at) || compareIds(a.id, b.id))
    return index(updates)
  }
  return records
}

const refsOf = (record) => Object.entries(record.refs ?? {}).flatMap(([field, ref]) => (Array.isArray(ref) ? ref : [ref]).map((entry) => ({ field, ...entry })))

export function planMigration({ direction, source, target, snapshot, mapped, map = null, known = {} }) {
  const kinds = direction === 'export' ? EXPORT_KINDS : IMPORT_KINDS
  const entries = map?.map?.records ?? {}
  const resume = { map: map?.file ?? null, done: 0, sent: 0, failed: 0 }
  const records = {}
  let checks = 0
  for (const kind of kinds) {
    const ordered = orderRecords(kind, mapped.records[kind] ?? [], snapshot)
    let unconfirmed = 0
    records[kind] = ordered.map((record) => {
      const entry = entries[kind]?.[record.key]
      const old = known[kind]?.[record.key]
      if (entry?.state === 'done') {
        resume.done++
        return { ...record, action: 'skip', target: entry.id ?? entry.uuid ?? record.target }
      }
      if (entry?.state === 'sent' || entry?.state === 'failed') {
        resume[entry.state]++
        unconfirmed++
      }
      if (!entry && old) return { ...record, action: 'skip', target: old.id ?? old.uuid ?? record.target }
      return { ...record, action: 'create' }
    })
    checks += Math.ceil(unconfirmed / CHECK_PAGE)
  }

  const reachable = (ref) => records[ref.kind]?.some((record) => record.key === ref.key) || known[ref.kind]?.[ref.key] || entries[ref.kind]?.[ref.key]?.state === 'done'
  const problems = [...mapped.problems]
  for (const loop of parentLoops(snapshot.issues ?? [])) {
    problems.push({ kind: 'issue', key: loop[0], code: 'parent_loop', message: `parent loop ${[...loop, loop[0]].join(' > ')}` })
  }
  for (const kind of kinds) {
    for (const record of records[kind]) {
      if (record.action !== 'create') continue
      for (const ref of refsOf(record)) {
        if (!reachable(ref)) problems.push({ kind, key: record.key, code: 'missing_ref', message: `${record.key} names ${ref.kind} ${ref.key}, which the migration does not hold` })
      }
    }
  }

  const writes = direction === 'export'
  const steps = [{ step: 0, kind: 'reads', records: null, requests: mapped.readRequests + (writes ? checks : 0) }]
  kinds.forEach((kind, i) => {
    const creates = records[kind].filter((record) => record.action === 'create').length
    steps.push({ step: i + 1, kind, records: records[kind].length, requests: writes ? creates : 0 })
  })
  const plan = {
    direction,
    source,
    target,
    steps,
    records,
    people: mapped.people,
    losses: mapped.losses,
    problems,
    resume,
    requests: steps.reduce((sum, step) => sum + step.requests, 0),
  }
  plan.digest = planDigest(plan)
  return plan
}

/**
 * The budget of a plan against Linear's answer headers. The rate is read after the reads of step 0, so the writes
 * left before the reserve are `remaining - reserve`. Without headers the budget is unknown.
 */
export function planBudget(plan, rate) {
  const reads = plan.steps[0]?.requests ?? 0
  const remaining = rate?.requests?.remaining ?? null
  if (remaining === null || remaining === undefined) {
    return { requests: plan.requests, remaining: null, reserve: RESERVE.requests, resetAt: null, fits: null, stopsAfter: null }
  }
  const complexity = rate.complexity?.remaining
  const lowComplexity = typeof complexity === 'number' && complexity <= RESERVE.complexity
  const stopsAfter = lowComplexity ? 0 : Math.max(0, remaining - RESERVE.requests)
  return {
    requests: plan.requests,
    remaining,
    reserve: RESERVE.requests,
    resetAt: rate.requests.resetAt ?? null,
    fits: !lowComplexity && plan.requests - reads <= stopsAfter,
    stopsAfter,
  }
}

/** A SHA-256 over what the run would write: direction, sides, and per record its kind, key, action, fields and refs. */
export function planDigest(plan) {
  const records = Object.entries(plan.records).flatMap(([kind, list]) => list.map((record) => ({
    kind, key: record.key, action: record.action, fields: record.fields ?? {}, refs: record.refs ?? {},
  })))
  return `sha256:${sha256(stableStringify({ direction: plan.direction, source: plan.source, target: plan.target, records }))}`
}
