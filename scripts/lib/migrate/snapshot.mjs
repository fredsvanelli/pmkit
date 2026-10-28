// The snapshot a migration reader returns, and the pure helpers around it. See the PMK-41 spec, "The snapshot".

import { createHash } from 'node:crypto'
import { compareIds } from '../ids.mjs'

export const EXPORT_KINDS = ['label', 'epic', 'issue', 'link', 'comment', 'thread', 'update', 'archive']
export const IMPORT_KINDS = ['member', 'label', 'sprint', 'epic', 'update', 'issue', 'comment']

const LISTS = ['people', 'labels', 'epics', 'sprints', 'issues', 'links', 'comments']
const RECORD_LISTS = ['people', 'epics', 'sprints', 'issues', 'comments']

/** JSON with object keys sorted at every depth, so two equal values give the same text. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item === undefined ? null : item)).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export const sha256 = (text) => createHash('sha256').update(text).digest('hex')

/** The digest of a snapshot without its `read` time, so two reads of an unchanged source match. */
export function snapshotDigest(snapshot) {
  const { read, ...rest } = snapshot
  return `sha256:${sha256(stableStringify(rest))}`
}

export const linkKey = (link) => `${link.kind} ${link.from} ${link.to}`

/** One link per Local relation: `blocked_by: [A]` on B is A blocks B, `duplicate_of: [A]` on B is B duplicate A. */
export function localLinks(issues) {
  const links = new Map()
  const add = (link) => links.set(linkKey(link), link)
  for (const issue of issues) {
    for (const blocker of issue.blockedBy ?? []) add({ kind: 'blocks', from: blocker, to: issue.id })
    for (const original of issue.duplicateOf ?? []) add({ kind: 'duplicate', from: issue.id, to: original })
    for (const other of issue.related ?? []) {
      const [from, to] = [issue.id, other].sort(compareIds)
      add({ kind: 'related', from, to })
    }
  }
  return [...links.values()].sort((a, b) => (linkKey(a) < linkKey(b) ? -1 : linkKey(a) > linkKey(b) ? 1 : 0))
}

/** The first line of an exported comment body, naming its original author. */
export const attributionLine = ({ name, created, issue }) => `Comment by ${name} on ${String(created).slice(0, 10)} in ${issue}`

const ATTRIBUTION = /^Comment by (.+) on (\d{4}-\d{2}-\d{2}) in (\S+)\n\n/

/** Takes the attribution line and its blank line off a body. Null when the body does not start with them. */
export function stripAttribution(body) {
  const match = ATTRIBUTION.exec(body ?? '')
  if (!match) return null
  return { body: body.slice(match[0].length), name: match[1], date: match[2], issue: match[3] }
}

/** The problems in the shape of a snapshot, as readable lines. Empty when the shape is right. */
export function validateSnapshot(snapshot) {
  const problems = []
  for (const list of LISTS) {
    if (!Array.isArray(snapshot?.[list])) problems.push(`${list} is not a list`)
  }
  for (const list of RECORD_LISTS) {
    if (!Array.isArray(snapshot?.[list])) continue
    snapshot[list].forEach((record, index) => {
      if (!record || typeof record.id !== 'string' || record.id === '') problems.push(`${list}[${index}] has no id`)
    })
  }
  if (Array.isArray(snapshot?.links)) {
    snapshot.links.forEach((link, index) => {
      if (typeof link?.from !== 'string' || typeof link?.to !== 'string') problems.push(`links[${index}] has an end that is not an id`)
    })
  }
  return problems
}
