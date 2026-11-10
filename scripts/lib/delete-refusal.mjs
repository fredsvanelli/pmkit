// The refusal of `issues delete` when other records reference the issue. Both trackers build it here, so the text and the
// next step are the same. See docs/superpowers/specs/2026-10-31-pmk-52-issues-delete-design.md.

import { PmkitError } from './errors.mjs'

/** The `unchecked` entry for the files of the repository. The CLI scans them and drops or explains the entry (PMK-222). */
export const REPO_UNCHECKED = 'code comments, documents and docs/'

/** The kinds of reference, in the order a refusal lists them for one issue. */
export const REFERENCE_KINDS = ['blockedBy', 'related', 'duplicateOf', 'parent']

const UNLINK = {
  blockedBy: (id, other) => `pmkit issues link ${id} ${other} --kind blocks --remove`,
  related: (id, other) => `pmkit issues link ${other} ${id} --kind related --remove`,
  duplicateOf: (id, other) => `pmkit issues link ${other} ${id} --kind duplicate --remove`,
  parent: (id, other) => `pmkit issues parent ${other} none`,
}

const MAX_STEPS = 5

/** The command that removes one reference: `kind` says how `other` points at `id`. */
export const unlinkStep = (id, { id: other, kind }) => UNLINK[kind](id, other)

// A blocks link and a related link both start from `id` in their unlink command, so one call removes them all (PMK-222).
const GROUPED = { blockedBy: 'blocks', related: 'related' }

/** The commands that remove the references: one per grouped kind, then one per other reference, in REFERENCE_KINDS order. */
function unlinkSteps(id, references) {
  return REFERENCE_KINDS.flatMap((kind) => {
    const others = references.filter((ref) => ref.kind === kind).map((ref) => ref.id)
    if (others.length === 0) return []
    if (GROUPED[kind]) return [`pmkit issues link ${id} ${others.join(' ')} --kind ${GROUPED[kind]} --remove`]
    return others.map((other) => unlinkStep(id, { id: other, kind }))
  })
}

/** The CONFLICT error for a non-empty `references` list of `{ id, kind }`. */
export function referencedError(id, references) {
  const all = unlinkSteps(id, references)
  const steps = all.slice(0, MAX_STEPS)
  const more = all.length > MAX_STEPS ? `; ${all.length - MAX_STEPS} more commands for the rest of the list` : ''
  return new PmkitError(
    'CONFLICT',
    `${id} is referenced by ${references.length === 1 ? 'one record' : `${references.length} records`}: ${references.map((ref) => `${ref.id} (${ref.kind})`).join(', ')}`,
    `Remove each reference, then delete again: ${steps.join('; ')}${more}. To keep the history instead, archive it: pmkit issues archive ${id}`,
    { references },
  )
}
