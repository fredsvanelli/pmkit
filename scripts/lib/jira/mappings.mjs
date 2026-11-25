// Jira's side of the mapping check: what config.pmkit names that the site or the space no longer has.
// See docs/superpowers/specs/2026-11-22-pmk-77-jira-work-items-transitions-links-jql-design.md, "Discovery additions, cache and mapping check".

import { NONE } from '../mappings.mjs'

const isSet = (value) => typeof value === 'string' && value !== '' && value !== NONE

// Each checked group: the names (or ids) the raw discovery holds, and the sentence for a missing one. blocked is no Jira status.
const GROUPS = {
  status: { has: (raw, value) => raw.statuses.some((status) => status.name === value), what: (raw, value) => `${value}, which space ${raw.space.key} does not have` },
  types: { has: (raw, value) => raw.workTypes.some((type) => type.name === value), what: (raw, value) => `work type ${value}, which space ${raw.space.key} does not have` },
  fields: { has: (raw, value) => raw.fields.some((field) => field.id === value), what: (raw, value) => `field ${value}, which ${raw.site} does not have` },
}

/** Each mapping in config.pmkit that names something Jira no longer has, as [{ key, value, problem }]. none, and status blocked, never break. */
export function brokenJiraMappings(raw, pmkit) {
  const items = []
  for (const [group, { has, what }] of Object.entries(GROUPS)) {
    for (const [name, value] of Object.entries(pmkit?.mappings?.[group] ?? {})) {
      if (!isSet(value) || (group === 'status' && name === 'blocked')) continue
      const key = `mappings.${group}.${name}`
      if (!has(raw, value)) items.push({ key, value, problem: `${key} names ${what(raw, value)}` })
    }
  }
  return items
}
