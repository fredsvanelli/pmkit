// The Relations family of the Linear tracker: link, unlink and setParent.
// See docs/superpowers/specs/2026-10-27-pmk-35-linear-issues-relations-search-design.md, "Relations (criterion 1)".

import { PmkitError } from '../errors.mjs'
import { compareIds } from '../ids.mjs'
import { LINK_KINDS } from '../model.mjs'
import { BLOCK_GRAPH_QUERY, PARENT_CHAIN_QUERY, RELATION_CREATE, RELATION_DELETE } from './documents.mjs'
import { isUnconfirmed } from './issue-ops.mjs'
import { isIssueId, issueKey, toIssue } from './issues.mjs'
import { NOT_EPICS } from './writes.mjs'

const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
const BLOCK_DEPTH = 10
const PROP = { blocks: 'blocks', related: 'related', duplicate: 'duplicateOf' }

/** The relation nodes of `node` of one kind that tie it to `other`. A related relation counts in either direction. */
function relationsBetween(node, other, kind) {
  const out = node.relations.nodes.filter((item) => item.type === kind && item.relatedIssue.identifier === other)
  const back = kind === 'related' ? node.inverseRelations.nodes.filter((item) => item.type === kind && item.issue.identifier === other) : []
  return [...out, ...back]
}

/** The issue with `other` added to or removed from the list of `kind`, as a dry run shows it. */
function withLink(issue, other, kind, add) {
  const prop = PROP[kind]
  const list = add ? [...new Set([...issue[prop], other])].sort(compareIds) : issue[prop].filter((id) => id !== other)
  return { ...issue, [prop]: list }
}

export function relationOperations({ client, ops, uuid }) {
  /** Both issues of a link, read and checked. */
  async function pair(from, to, kind, actor) {
    ops.requireWorkspace()
    if (!LINK_KINDS.includes(kind)) throw invalid(`kind must be one of ${LINK_KINDS.join(', ')}`)
    await ops.requireViewer(actor)
    const a = await ops.readNode(from)
    const b = await ops.readNode(to)
    if (a.identifier === b.identifier) throw invalid(`${a.identifier} cannot be linked to itself`)
    const context = await ops.contextFor([a, b])
    return { a, b, context, before: toIssue(a, context) }
  }

  /** The shortest path from `start` to `goal` along blocks relations, read one level per request, or null within BLOCK_DEPTH levels. */
  async function blockPath(start, goal) {
    const previous = new Map([[start, null]])
    let frontier = [start]
    for (let level = 0; level < BLOCK_DEPTH && frontier.length > 0; level += 1) {
      const data = await client.request(BLOCK_GRAPH_QUERY, { ids: frontier })
      const next = []
      for (const node of data?.issues?.nodes ?? []) {
        for (const relation of node.relations?.nodes ?? []) {
          const target = relation.relatedIssue?.identifier
          if (relation.type !== 'blocks' || !target || previous.has(target)) continue
          previous.set(target, node.identifier)
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

  async function link(from, to, kind, actor, { dryRun = false } = {}) {
    const { a, b, before } = await pair(from, to, kind, actor)
    if (relationsBetween(a, b.identifier, kind).length > 0) return { before, after: before }
    if (kind === 'blocks') {
      const closing = await blockPath(b.identifier, a.identifier)
      if (closing) throw invalid(`${a.identifier} blocks ${b.identifier} would close a cycle: ${[a.identifier, ...closing].join(' → ')}`)
    }
    if (dryRun) return { before, after: withLink(before, b.identifier, kind, true) }
    const id = uuid()
    try {
      await client.request(RELATION_CREATE, { input: { id, type: kind, issueId: a.id, relatedIssueId: b.id } })
    } catch (error) {
      if (!isUnconfirmed(error)) throw error
      // The relation id pmkit chose tells whether the create happened. One read, then the original error.
      const again = await ops.readNode(from)
      if (!again.relations.nodes.some((item) => item.id === id)) throw error
      return { before, after: await ops.mapped(again) }
    }
    return { before, after: await ops.mapped(await ops.readNode(from)) }
  }

  async function unlink(from, to, kind, actor, { dryRun = false } = {}) {
    const { a, b, before } = await pair(from, to, kind, actor)
    const found = relationsBetween(a, b.identifier, kind)
    if (found.length === 0) return { before, after: before }
    if (dryRun) return { before, after: withLink(before, b.identifier, kind, false) }
    // Each relation is its own delete; deletes are idempotent, so none is sent twice.
    for (const relation of found) await client.request(RELATION_DELETE, { id: relation.id })
    return { before, after: await ops.mapped(await ops.readNode(from)) }
  }

  /** The parent's identifier followed by its ancestors', from one query nested PARENT_CHAIN_DEPTH levels. */
  async function ancestry(identifier) {
    const chain = []
    let current = (await client.request(PARENT_CHAIN_QUERY, { id: identifier }))?.issues?.nodes?.[0]
    while (current) {
      chain.push(current.identifier)
      current = current.parent
    }
    return chain
  }

  /** `parent` is an issue id or null. A Linear project is not a parent in pmkit until PMK-38. */
  async function setParent(id, parent, actor, { dryRun = false } = {}) {
    ops.requireWorkspace()
    await ops.requireViewer(actor)
    const node = await ops.readNode(id)
    const self = node.identifier
    if (parent !== null && !isIssueId(parent)) throw new PmkitError('NOT_SUPPORTED', NOT_EPICS, 'Use an issue id as the parent')
    if (parent !== null && issueKey(parent) === self) throw invalid(`${self} cannot be its own parent`)
    const parentNode = parent === null ? null : await ops.parentNodeOf(parent)
    if (parentNode) {
      const chain = await ancestry(parentNode.identifier)
      const at = chain.indexOf(self)
      if (at >= 0) throw invalid(`parent loop: ${[self, ...chain.slice(0, at + 1)].join(' → ')}`)
    }
    const context = await ops.contextFor([node])
    const before = toIssue(node, context)
    const next = parentNode?.identifier ?? null
    if ((before.parent ?? null) === next) return { before, after: before }
    return ops.writeUpdate(node, before, { parentId: parentNode?.id ?? null }, context, dryRun, next)
  }

  return { link, unlink, setParent }
}
