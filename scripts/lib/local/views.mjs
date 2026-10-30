// View files: views/<name>.yaml, one `filter` key with a searchIssues filter. Parsing, serializing and listing; the tracker decides when to write.

import fs from 'node:fs'
import { PmkitError } from '../errors.mjs'
import { parseYaml, stringifyYaml } from '../yaml.mjs'
import { validMilestoneId } from './milestones.mjs'

const DOCTOR = '/pmkit:local:doctor'

/** A name follows the rule of a milestone id, so it is a safe file stem. */
export const validViewName = validMilestoneId

/** The stems of the `.yaml` files in a views folder, as stored. A missing folder gives an empty set. */
export function viewStems(dir) {
  if (!fs.existsSync(dir)) return new Set()
  return new Set(fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
    .map((entry) => entry.name.slice(0, -'.yaml'.length)))
}

/** Parses the text of views/<name>.yaml into { name, filter }. */
export function parseView(text, name) {
  const bad = (why) => new PmkitError('INVALID_INPUT', `view file ${name}.yaml ${why}`, DOCTOR)
  let data
  try {
    data = parseYaml(text)
  } catch (error) {
    throw bad(`does not parse: ${error.message}`)
  }
  const filter = data?.filter
  if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) throw bad('needs a "filter" map')
  return { name, filter }
}

export const serializeView = (filter) => stringifyYaml({ filter })
