// The Relations family of the Jira tracker: link, unlink and setParent.
// See docs/superpowers/specs/2026-11-22-pmk-77-jira-work-items-transitions-links-jql-design.md, "Relations".

import { PmkitError } from '../errors.mjs'
import { compareIds } from '../ids.mjs'
import { LINK_KINDS } from '../model.mjs'

const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
const DEPTH = 10
const PROP = { blocks: 'blocks', related: 'related', duplicate: 'duplicateOf' }
const lower = (value) => String(value ?? '').toLowerCase()

/** The issue with `other` added to or removed from the list of `kind`, as a dry run shows it. */
function withLink(issue, other, kind, add) {
  const prop = PROP[kind]
  const list = add ? [...new Set([...issue[prop], other])].sort(compareIds) : issue[prop].filter((id) => id !== other)
  return { ...issue, [prop]: list }
}

/** The relation operations over a Jira client and the issue operations `ops` (readItem, requireActor). */
export function relationOperations({ client, ops, getContext }) {
  /** The checks before any read, then both items. */
  async function pair(from, to, kind, actor) {
    await ops.requireActor(actor)
    if (!LINK_KINDS.includes(kind)) throw invalid(`kind must be one of ${LINK_KINDS.join(', ')}`)
    const context = await getContext()
    const a = await ops.readItem(from)
    const b = await ops.readItem(to)
    if (a.issue.id === b.issue.id) throw invalid(`${a.issue.id} cannot be linked to itself`)
    return { a, b, context }
  }

  /** The shortest path from `start` to `goal` along blocks relations, read one item at a time, or null within DEPTH levels. */
  async function blockPath(start, goal) {
    const previous = new Map([[start, null]])
    let frontier = [start]
    for (let level = 0; level < DEPTH && frontier.length > 0; level += 1) {
      const next = []
      for (const id of frontier) {
        for (const target of (await ops.readItem(id)).issue.blocks) {
          if (previous.has(target)) continue
          previous.set(target, id)
          if (target === goal) {
            const path = [target]
            while (previous.get(path[0]) !== null) path.unshift(previous.get(path[0]))
            return path
          }
          next.push(target)
        }
      }
      frontier = next
    }
    return null
  }

  const afterOf = async (id) => (await ops.readItem(id)).issue

  async function link(from, to, kind, actor, { dryRun = false } = {}) {
    const { a, b, context } = await pair(from, to, kind, actor)
    const before = a.issue
    const type = context.linkType(kind)
    if (!type) {
      const name = kind === 'blocks' ? 'Blocks' : kind === 'related' ? 'Relates' : 'Duplicate'
      throw new PmkitError('NOT_SUPPORTED', `Jira at ${context.raw.site} has no ${name} link type`, 'Add the link type in Jira (Settings, Issues, Issue linking)')
    }
    if (before[PROP[kind]].includes(b.issue.id)) return { before, after: before }
    if (kind === 'blocks') {
      const closing = await blockPath(b.issue.id, before.id)
      if (closing) throw invalid(`${before.id} blocks ${b.issue.id} would close a cycle: ${[before.id, ...closing].join(' → ')}`)
    }
    if (dryRun) return { before, after: withLink(before, b.issue.id, kind, true) }
    await client.request('POST', '/rest/api/3/issueLink', {
      body: { type: { name: type.name }, inwardIssue: { key: before.id }, outwardIssue: { key: b.issue.id } },
    })
    return { before, after: await afterOf(before.id) }
  }

  /** The ids of the links of `a` of `kind` to `other`: either direction for related, else a as the inward side. */
  function linkIds(item, other, kind, context) {
    const name = lower(context.linkType(kind)?.name)
    return (item.fields?.issuelinks ?? [])
      .filter((entry) => lower(entry.type?.name) === name)
      .filter((entry) => entry.outwardIssue?.key === other || (kind === 'related' && entry.inwardIssue?.key === other))
      .map((entry) => entry.id)
  }

  async function unlink(from, to, kind, actor, { dryRun = false } = {}) {
    const { a, b, context } = await pair(from, to, kind, actor)
    const before = a.issue
    const ids = linkIds(a.item, b.issue.id, kind, context)
    if (ids.length === 0 || !before[PROP[kind]].includes(b.issue.id)) return { before, after: before }
    if (dryRun) return { before, after: withLink(before, b.issue.id, kind, false) }
    for (const id of ids) await client.request('DELETE', `/rest/api/3/issueLink/${encodeURIComponent(id)}`)
    return { before, after: await afterOf(before.id) }
  }

  /** The id followed by its ancestors', read up to DEPTH levels. */
  async function ancestry(id) {
    const chain = []
    let current = id
    while (current !== undefined && chain.length < DEPTH) {
      chain.push(current)
      current = (await ops.readItem(current)).issue.parent
    }
    return chain
  }

  /** `parent` is a work item key or null. */
  async function setParent(id, parent, actor, { dryRun = false } = {}) {
    await ops.requireActor(actor)
    const { issue: before } = await ops.readItem(id)
    let target = null
    if (parent === null) {
      if (before.parent === undefined) return { before, after: before }
    } else {
      target = (await ops.readItem(parent)).issue
      if (target.id === before.id) throw invalid(`${before.id} cannot be its own parent`)
      const chain = await ancestry(target.id)
      const at = chain.indexOf(before.id)
      if (at >= 0) throw invalid(`parent loop: ${[before.id, ...chain.slice(0, at + 1)].join(' → ')}`)
      if (before.parent === target.id) return { before, after: before }
    }
    if (dryRun) {
      const { parent: _gone, ...rest } = before
      return { before, after: target ? { ...rest, parent: target.id } : rest }
    }
    await client.request('PUT', `/rest/api/3/issue/${before.id}`, { body: { fields: { parent: target ? { key: target.id } : null } } })
    return { before, after: await afterOf(before.id) }
  }

  return { link, unlink, setParent }
}
