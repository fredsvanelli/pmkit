// Runs a migration plan through a writer, one record at a time: the map says `sent` before each create, `done` after
// it, and the first failure stops the run. See the PMK-41 spec, "Running and resuming" and "Pacing and the request budget".

import { PmkitError, isPmkitError } from '../errors.mjs'
import { RESERVE } from './plan.mjs'

/**
 * @typedef {object} Writer
 * @property {string} system 'linear' or 'local'
 * @property {(kind: string, record: object) => string} chooseId
 * @property {(kind: string, entries: { key: string, uuid: string, record?: object, entry?: object }[], lookup: (kind: string, key: string) => object | undefined) => Promise<Map<string, { id: string }>>} exists
 * @property {(kind: string, record: object, chosenId: string, fields: object) => Promise<{ id: string }>} create
 * @property {(kind: string, entry: object) => Promise<void>} remove
 * @property {() => object | null} budget
 * @property {(error: Error) => boolean} isUnconfirmed
 */

export function checkExpect(plan, expect) {
  if (expect && expect !== plan.digest) {
    throw new PmkitError('CONFLICT', 'the plan changed since the preview', 'Run the dry run again and confirm the new preview', { expected: expect, digest: plan.digest })
  }
}

const UNCONFIRMED = ['sent', 'failed']
const idOf = (entry) => entry?.uuid ?? entry?.id

/** Looks up every `sent` and `failed` entry before the first write. A found entry becomes `done`; a missing one keeps its id. */
export async function reconcile(store, writer, { now = () => new Date().toISOString() } = {}) {
  let found = 0
  let missing = 0
  const lookup = (kind, key) => store.entry(kind, key)
  for (const [kind, entries] of Object.entries(store.map.records)) {
    const open = Object.entries(entries).filter(([, entry]) => UNCONFIRMED.includes(entry.state))
    if (open.length === 0) continue
    const result = await writer.exists(kind, open.map(([key, entry]) => ({ key, uuid: idOf(entry), entry })), lookup)
    for (const [key, entry] of open) {
      const hit = result.get(key)
      if (!hit) {
        missing++
        continue
      }
      found++
      const { error, ...rest } = entry
      store.set(kind, key, { ...rest, state: 'done', id: hit.id ?? rest.id, at: now() })
    }
  }
  return { found, missing }
}

function resolveRef(ref, store, known) {
  const entry = store.entry(ref.kind, ref.key)
  if (entry?.state === 'done') return idOf(entry)
  const old = known?.[ref.kind]?.[ref.key]
  if (old) return old.uuid ?? old.id
  throw new PmkitError('CONFLICT', `${ref.kind} ${ref.key} is not written yet`, 'Run pmkit local-migrate status')
}

/** The record's fields with each ref replaced by the UUID (export) or the ID (import) from the map or a finished map. */
export function resolveFields(record, store, known) {
  const fields = { ...(record.fields ?? {}) }
  for (const [field, ref] of Object.entries(record.refs ?? {})) {
    if (Array.isArray(ref)) fields[field] = [...(fields[field] ?? []), ...ref.map((entry) => resolveRef(entry, store, known))]
    else fields[field] = resolveRef(ref, store, known)
  }
  return fields
}

const nextStepOf = (plan) => `Fix the cause and run pmkit local-migrate ${plan.direction} again to resume`

export function lowBudget(rate) {
  if (!rate) return false
  const requests = rate.requests?.remaining
  const complexity = rate.complexity?.remaining
  return (typeof requests === 'number' && requests <= RESERVE.requests) || (typeof complexity === 'number' && complexity <= RESERVE.complexity)
}

export async function runPlan({ plan, store, writer, known = {}, now = () => new Date().toISOString() }) {
  const kinds = plan.steps.filter((step) => step.kind !== 'reads').map((step) => step.kind)
  const all = kinds.flatMap((kind) => plan.records[kind].map((record) => ({ kind, record })))
  const total = all.length
  const isDone = ({ kind, record }) => record.action === 'skip' || store.entry(kind, record.key)?.state === 'done'
  const counts = () => ({ done: all.filter(isDone).length, total })
  const field = writer.system === 'local' ? 'id' : 'uuid'
  const lookup = (kind, key) => store.entry(kind, key)

  for (const { kind, record } of all) {
    if (isDone({ kind, record })) continue
    const rate = writer.budget()
    if (lowBudget(rate)) {
      const { done } = counts()
      const resetAt = rate.requests?.resetAt ?? rate.complexity?.resetAt ?? 'the reset'
      const error = new PmkitError('RATE_LIMITED', `stopped before Linear's request limit: ${done} of ${total} records are done`, `Run the same command again after ${resetAt} to resume`)
      error.written = counts()
      throw error
    }
    const entry = store.entry(kind, record.key)
    const chosenId = idOf(entry) ?? writer.chooseId(kind, record)
    const fields = resolveFields(record, store, known)
    // Every label in the plan is one the export creates: undo deletes only labels whose entry says `created`.
    const created = kind === 'label' && writer.system === 'linear' ? { created: true } : {}
    store.set(kind, record.key, { state: 'sent', [field]: chosenId, ...created })
    let result
    try {
      result = await writer.create(kind, record, chosenId, fields)
    } catch (caught) {
      if (writer.isUnconfirmed(caught)) {
        const found = await writer.exists(kind, [{ key: record.key, uuid: chosenId, record }], lookup)
        if (found.has(record.key)) {
          store.set(kind, record.key, { state: 'done', [field]: chosenId, id: found.get(record.key).id ?? chosenId, at: now(), ...created })
          continue
        }
      }
      const error = isPmkitError(caught) ? caught : new PmkitError('UPSTREAM', caught.message, nextStepOf(plan))
      store.set(kind, record.key, { state: 'failed', [field]: chosenId, ...created, error: { code: error.code, message: error.message } })
      error.written = counts()
      error.nextStep = nextStepOf(plan)
      throw error
    }
    const { id, ...extra } = result ?? {}
    store.set(kind, record.key, { state: 'done', [field]: chosenId, id: id ?? chosenId, at: now(), ...extra })
  }
  const result = counts()
  if (result.done === result.total) store.finish(now())
  return result
}
