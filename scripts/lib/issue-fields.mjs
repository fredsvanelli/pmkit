// The issue fields a create or an update accepts, and the fields another operation owns.
// The Local tracker and the Linear adapter share them, so a refused key reads the same on both.

import { PmkitError } from './errors.mjs'

export const CREATE_KEYS = [
  'title', 'type', 'status', 'priority', 'estimate', 'assignee', 'labels', 'parent', 'sprint',
  'milestone', 'release', 'due', 'branch', 'description', 'acceptanceCriteria',
]
export const UPDATE_KEYS = [
  'title', 'type', 'priority', 'estimate', 'labels', 'sprint', 'milestone', 'release', 'due', 'branch',
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
    if (Object.hasOwn(OWNED, key)) throw new PmkitError('INVALID_INPUT', `${key} cannot be set here`, OWNED[key] || undefined)
    throw new PmkitError('INVALID_INPUT', `unknown field "${key}"`, `Use one of: ${allowed.join(', ')}`)
  }
}
