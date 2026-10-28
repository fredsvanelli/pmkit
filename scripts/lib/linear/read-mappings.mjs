// Reads mappings for the Linear adapter. When PMK-34 merges, switch to its resolveMappings where the names or shapes differ.
// The return keys follow resolveMappings where they overlap: `types` maps a pmkit type to its label, `typeOf` reads an issue's type,
// and `estimate` is 'native' or null. `none` counts as unset in every key, and an absent estimate means no estimate (PMK-34 rule 4).

import { STATUS_MAPPING_KEYS } from '../model.mjs'

export const NONE = 'none'
const TYPES_PROBLEM = 'mappings.types must be a map from a pmkit type to a Linear label name'

const isName = (value) => typeof value === 'string' && /\S/.test(value)
const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * @param {object} pmkit config.pmkit
 * @returns {{ status: Object<string, string>, statusNone: string[], blockedStatus: string | null, types: Object<string, string>,
 *   typeOf: (labelNames: string[]) => string | null, estimate: 'native' | null, problems: string[] }}
 */
export function readMappings(pmkit) {
  const mappings = isMap(pmkit?.mappings) ? pmkit.mappings : {}
  const problems = []

  const status = {}
  const statusNone = []
  let blockedStatus = null
  for (const [key, name] of Object.entries(isMap(mappings.status) ? mappings.status : {})) {
    if (!STATUS_MAPPING_KEYS.includes(key) || !isName(name)) continue
    if (key === 'blocked') blockedStatus = name === NONE ? null : name
    else if (name === NONE) statusNone.push(key)
    else status[key] = name
  }

  let types = {}
  if (mappings.types !== undefined) {
    const entries = isMap(mappings.types) ? Object.entries(mappings.types) : null
    if (entries === null || !entries.every(([, name]) => isName(name))) problems.push(TYPES_PROBLEM)
    else types = Object.fromEntries(entries.filter(([, name]) => name !== NONE))
  }
  const typeOf = (labelNames) => Object.keys(types).find((type) => labelNames.includes(types[type])) ?? null

  const estimate = isMap(mappings.fields) && mappings.fields.estimate === 'native' ? 'native' : null
  return { status, statusNone, blockedStatus, types, typeOf, estimate, problems }
}
