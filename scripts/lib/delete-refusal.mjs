// The refusal of `issues delete` when other records reference the issue. Both trackers build it here, so the text and the
// next step are the same. See docs/superpowers/specs/2026-10-31-pmk-52-issues-delete-design.md.

import { PmkitError } from './errors.mjs'

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

/** The CONFLICT error for a non-empty `references` list of `{ id, kind }`. */
export function referencedError(id, references) {
  const steps = references.slice(0, MAX_STEPS).map((ref) => unlinkStep(id, ref))
  const more = references.length > MAX_STEPS ? `; ${references.length - MAX_STEPS} more in the list` : ''
  return new PmkitError(
    'CONFLICT',
    `${id} is referenced by ${references.length === 1 ? 'one record' : `${references.length} records`}: ${references.map((ref) => `${ref.id} (${ref.kind})`).join(', ')}`,
    `Remove each reference, then delete again: ${steps.join('; ')}${more}. To keep the history instead, archive it: pmkit issues archive ${id}`,
    { references },
  )
}
