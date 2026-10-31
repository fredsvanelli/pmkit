// The bulk change of `issues bulk`: one change applied to every issue a filter returns, previewed first.
// Each change calls the contract operation the one-by-one command calls, so bulk has no write path of its own.
// The preview is frozen with a digest: the real run rebuilds it and writes only when the digest equals the one the user saw.

import { PmkitError } from './errors.mjs'
import { stableStringify, sha256 } from './migrate/snapshot.mjs'
import { table } from './format.mjs'

export const DEFAULT_MAX = 50
export const HARD_MAX = 200

const invalid = (message, nextStep = 'pmkit issues bulk --help') => new PmkitError('INVALID_INPUT', message, nextStep)
const orNull = (value) => (value === 'none' ? null : value)
const patchOf = (patch) => (tracker, issue, actor, options) => tracker.updateIssue(issue.id, patch, actor, options)

// Per change: how to read the value into `text` and an `apply(tracker, issue, actor, { dryRun })` that returns { before, after }.
const BUILDERS = {
  move: (value, { status }) => ({
    text: `move to ${value}${status ? ` (status ${status})` : ''}`,
    apply: (tracker, issue, actor, { dryRun }) => tracker.moveToCategory(issue.id, value, actor, { status, dryRun }),
  }),
  assign: (value) => ({
    text: `assign to ${value}`,
    apply: (tracker, issue, actor, options) => tracker.assign(issue.id, orNull(value), actor, options),
  }),
  priority: (value) => ({ text: `set priority to ${value}`, apply: patchOf({ priority: orNull(value) }) }),
  estimate: (value, { scale = [] }) => {
    const estimate = value === 'none' ? null : (scale.find((item) => String(item) === value) ?? Number(value))
    if (estimate !== null && !Number.isFinite(estimate)) throw invalid(`estimate "${value}" is not a number or none`)
    return { text: `set estimate to ${value}`, apply: patchOf({ estimate }) }
  },
  'label-add': (value) => ({
    text: `add label ${value}`,
    apply: (tracker, issue, actor, options) => tracker.updateIssue(issue.id, { labels: [...new Set([...(issue.labels ?? []), value])] }, actor, options),
  }),
  'label-remove': (value) => ({
    text: `remove label ${value}`,
    apply: (tracker, issue, actor, options) => tracker.updateIssue(issue.id, { labels: (issue.labels ?? []).filter((label) => label !== value) }, actor, options),
  }),
  milestone: (value) => ({ text: `set milestone to ${value}`, apply: patchOf({ milestone: orNull(value) }) }),
  release: (value) => ({ text: `set release to ${value}`, apply: patchOf({ release: orNull(value) }) }),
  sprint: (value) => ({
    text: `move to sprint ${value}`,
    apply: async (tracker, issue, actor, options) => (await tracker.moveToCycle([issue.id], orNull(value), actor, options))[0],
  }),
  parent: (value) => ({
    text: `set parent to ${value}`,
    apply: (tracker, issue, actor, options) => tracker.setParent(issue.id, orNull(value), actor, options),
  }),
  link: (value, { linkKind, remove }) => {
    if (linkKind === undefined) throw invalid('bulk link needs --kind', 'Use --kind blocks, related or duplicate')
    return {
      text: `${remove ? 'remove the' : 'add a'} ${linkKind} link to ${value}`,
      apply: (tracker, issue, actor, options) => tracker[remove ? 'unlink' : 'link'](issue.id, value, linkKind, actor, options),
    }
  },
}

export const CHANGES = Object.keys(BUILDERS)

/** The change `kind value` as { kind, value, text, apply }. `flags` carries status, linkKind, remove and the estimate scale. */
export function parseChange(kind, value, flags = {}) {
  if (!Object.hasOwn(BUILDERS, kind)) throw invalid(`unknown change "${kind}"; use one of ${CHANGES.join(', ')}`)
  if (typeof value !== 'string' || value === '') throw invalid(`bulk ${kind} needs a value`)
  return { kind, value, ...BUILDERS[kind](value, flags) }
}

const SKIPPED = new Set(['updated', 'body'])
const flat = (record) => Object.fromEntries(Object.entries(record).filter(([key]) => !SKIPPED.has(key)).map(([key, value]) => [key, key === 'status' ? value?.name : value]))

/** The fields that differ between two issue records, ignoring `updated`. */
export function fieldChanges(before, after) {
  const a = flat(before)
  const b = flat(after)
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((field) => JSON.stringify(a[field]) !== JSON.stringify(b[field]))
    .map((field) => ({ field, from: a[field], to: b[field] }))
}

/**
 * The preview of a bulk change. `found` is the search result and `results[i]` is the dry run of `found.issues[i]`:
 * `{ before, after }` or `{ error: { code, message } }`. A blocker means the real run must not write.
 */
export function buildPreview({ change, found, results }) {
  const items = found.issues.map((issue, i) => {
    const result = results[i]
    const base = { id: issue.id, title: issue.title, status: issue.status?.name, assignee: issue.assignee, estimate: issue.estimate, updated: issue.updated }
    if (result.error) return { ...base, state: 'rejected', changes: [], error: result.error }
    const changes = fieldChanges(result.before, result.after)
    return { ...base, state: changes.length > 0 ? 'change' : 'unchanged', changes }
  })
  const writes = items.filter((item) => item.state === 'change').length
  const blockers = [
    ...found.problems.map((problem) => `${problem.id}: ${problem.code} ${problem.message}; the file may match the filter, so nothing can be written until pmkit validate is clean`),
    ...(found.hasMore ? ['the tracker has more matching issues than pmkit read, so the set is cut; narrow the filter'] : []),
    ...items.filter((item) => item.state === 'rejected').map((item) => `${item.id} was rejected: ${item.error.code} ${item.error.message}`),
  ]
  const digest = blockers.length === 0 && writes > 0
    ? `sha256:${sha256(stableStringify({ change: { kind: change.kind, value: change.value }, items: items.map(({ id, updated, state, changes }) => ({ id, updated, state, changes })) }))}`
    : null
  return { change: { kind: change.kind, value: change.value, text: change.text }, matched: items.length, writes, items, blockers, writable: blockers.length === 0 && writes > 0, digest }
}

const show = (value) => (value === undefined || value === null ? '(none)' : Array.isArray(value) ? value.join(', ') || '(none)' : String(value))

/** The preview as text: the table with one row per matched issue, the blockers and the digest. */
export function bulkText(preview, { dryRun }) {
  const rows = preview.items.map((item) => [
    item.id, item.title, item.status, item.assignee ?? '', item.estimate ?? '', item.state === 'change' ? item.changes.map((c) => `${c.field}: ${show(c.from)} → ${show(c.to)}`).join('; ')
      : item.state === 'unchanged' ? 'no change' : `rejected: ${item.error.message}`,
  ])
  const lines = [`${preview.change.text}: ${preview.matched} matched, ${preview.writes} to write`]
  if (rows.length > 0) lines.push('', table(['ID', 'Title', 'Status', 'Assignee', 'Estimate', 'Change'], rows))
  if (preview.blockers.length > 0) lines.push('', 'nothing can be written:', ...preview.blockers.map((blocker) => `  ${blocker}`))
  if (preview.digest) lines.push('', `digest: ${preview.digest}`)
  if (dryRun) lines.push('dry run: nothing was written')
  return lines.join('\n')
}
