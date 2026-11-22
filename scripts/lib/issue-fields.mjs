// The issue fields a create or an update accepts, and the fields another operation owns.
// The Local tracker and the Linear adapter share them, so a refused key reads the same on both.

import { PmkitError } from './errors.mjs'

export const CREATE_KEYS = [
  'title', 'type', 'status', 'priority', 'estimate', 'assignee', 'labels', 'parent', 'sprint',
  'milestone', 'release', 'due', 'branch', 'description', 'acceptanceCriteria',
]
export const UPDATE_KEYS = [
  'title', 'type', 'priority', 'estimate', 'labels', 'sprint', 'milestone', 'release', 'due', 'branch', 'docs',
  'description', 'acceptanceCriteria',
]
// Fields another operation owns, with the command that writes them. An empty string means no next step.
export const OWNED = {
  id: '',
  created: '',
  status: 'pmkit issues move',
  assignee: 'pmkit issues assign',
  parent: 'pmkit issues parent',
  blockedBy: 'pmkit issues link',
  related: 'pmkit issues link',
  duplicateOf: 'pmkit issues link',
  archived: 'pmkit issues archive',
}

/** Throws INVALID_INPUT for the first key of `input` that `allowed` lacks, naming the command that owns it. */
export function checkKeys(input, allowed) {
  for (const key of Object.keys(input)) {
    if (allowed.includes(key)) continue
    if (Object.hasOwn(OWNED, key)) throw new PmkitError('INVALID_INPUT', `${key} cannot be set here`, (key === 'archived' && input[key] === false ? 'pmkit issues unarchive' : OWNED[key]) || undefined)
    throw new PmkitError('INVALID_INPUT', `unknown field "${key}"`, `Use one of: ${allowed.join(', ')}`)
  }
}

/** The value of a field that must stay on one line; a line break is refused. */
export function oneLine(field, value) {
  if (/[\r\n]/.test(value)) throw new PmkitError('INVALID_INPUT', `${field} must not contain a line break`)
  return value
}

/** The acceptance criteria of a patch as {text, done} items. */
export function criteriaOf(value) {
  if (!Array.isArray(value)) throw new PmkitError('INVALID_INPUT', 'acceptanceCriteria must be a list')
  return value.map((item) => {
    const text = typeof item === 'string' ? item : item?.text
    if (typeof text !== 'string' || text.trim() === '') throw new PmkitError('INVALID_INPUT', 'each acceptance criterion needs text')
    return { text: oneLine('acceptance criterion', text.trim()), done: item?.done === true }
  })
}
