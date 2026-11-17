// The Relations family of the GitHub tracker: link, unlink and setParent.
// See docs/specs/2026-11-16-pmk-87-github-issues-relations-history-design.md, "Relations" and "Decisions from the user" 3.

import { PmkitError } from '../errors.mjs'
import { compareGithubIds } from './ids.mjs'
import { LINK_KINDS } from '../model.mjs'
import { epicOf, parseEpicId } from './projects.mjs'
import { sender } from './requests.mjs'

const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
const DEPTH = 10
const PROP = { blocks: 'blocks', related: 'related', duplicate: 'duplicateOf' }

/** The issue with `other` added to or removed from the list of `kind`, as a dry run shows it. */
function withLink(issue, other, kind, add) {
  const prop = PROP[kind]
  const list = add ? [...new Set([...issue[prop], other])].sort(compareGithubIds) : issue[prop].filter((id) => id !== other)
  return { ...issue, [prop]: list }
}

/** The relation operations over a GitHub client and the issue operations `ops` (readNode, requireActor). */
export function relationOperations({ client, ops, getContext }) {
  const send = sender(client)

  /** The checks before any read, then both issues. */
  async function pair(from, to, kind, actor) {
    await ops.requireActor(actor)
    if (!LINK_KINDS.includes(kind)) throw invalid(`kind must be one of ${LINK_KINDS.join(', ')}`)
    const context = await getContext()
    if (kind === 'related' && !context.features.relatesTo) {
      throw new PmkitError('NOT_SUPPORTED', 'GitHub Enterprise Server has no related issues', 'Use blocks or duplicate, or link the issues in a comment')
    }
    const a = await ops.readNode(from)
    const b = await ops.readNode(to)
    if (a.issue.id === b.issue.id) throw invalid(`${a.issue.id} cannot be linked to itself`)
    return { a, b, context }
  }

  /** The shortest path from `start` to `goal` along blocks relations, read one issue at a time, or null within DEPTH levels. */
  async function blockPath(start, goal) {
    const previous = new Map([[start, null]])
    let frontier = [start]
    for (let level = 0; level < DEPTH && frontier.length > 0; level += 1) {
      const next = []
      for (const id of frontier) {
        for (const target of (await ops.readNode(id)).issue.blocks) {
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

  const afterOf = async (id) => (await ops.readNode(id)).issue
  const note = (a, b) => `GitHub closed ${a} as a duplicate of ${b}`

  async function link(from, to, kind, actor, { dryRun = false } = {}) {
    const { a, b, context } = await pair(from, to, kind, actor)
    const before = a.issue
    const notes = kind === 'duplicate' ? [note(before.id, b.issue.id)] : []
    const withNotes = (result) => (notes.length > 0 ? { ...result, notes } : result)
    if (before[PROP[kind]].includes(b.issue.id)) return { before, after: before }
    if (kind === 'blocks') {
      const closing = await blockPath(b.issue.id, before.id)
      if (closing) throw invalid(`${before.id} blocks ${b.issue.id} would close a cycle: ${[before.id, ...closing].join(' → ')}`)
    }
    if (dryRun) {
      const after = withLink(before, b.issue.id, kind, true)
      return withNotes({ before, after: kind === 'duplicate' ? { ...after, status: { ...after.status, category: 'canceled' } } : after })
    }
    if (kind === 'blocks') await send(context, 'ADD_BLOCKED_BY', { issueId: b.node.id, blockingIssueId: a.node.id })
    else if (kind === 'related') await send(context, 'ADD_RELATES_TO', { issueId: a.node.id, relatedIssueId: b.node.id })
    else await send(context, 'CLOSE_ISSUE', { issueId: a.node.id, stateReason: 'DUPLICATE', duplicateIssueId: b.node.id }, true)
    return withNotes({ before, after: await afterOf(before.id) })
  }

  async function unlink(from, to, kind, actor, { dryRun = false } = {}) {
    const { a, b, context } = await pair(from, to, kind, actor)
    const before = a.issue
    if (!before[PROP[kind]].includes(b.issue.id)) return { before, after: before }
    if (dryRun) return { before, after: withLink(before, b.issue.id, kind, false) }
    if (kind === 'blocks') await send(context, 'REMOVE_BLOCKED_BY', { issueId: b.node.id, blockingIssueId: a.node.id })
    else if (kind === 'related') await send(context, 'REMOVE_RELATES_TO', { issueId: a.node.id, relatedIssueId: b.node.id })
    else await send(context, 'UNMARK_DUPLICATE', { duplicateId: a.node.id, canonicalId: b.node.id })
    return { before, after: await afterOf(before.id) }
  }

  /** The parent's id followed by its ancestors', read up to DEPTH levels. */
  async function ancestry(id) {
    const chain = []
    let current = id
    while (current !== undefined && chain.length < DEPTH) {
      chain.push(current)
      current = (await ops.readNode(current)).issue.parent
    }
    return chain
  }

  /** The items of a node in linked epic Projects: [{ id, project: { id } }]. The scope Project is no epic, so its item is never in the list. */
  const epicItems = (node, context) => (node.projectItems?.nodes ?? []).filter((item) => context.epics.has(item.project?.id))

  /** Runs the steps in order. A failure after the first write names what was done. */
  async function run(id, steps, before) {
    await ops.runSteps(id, steps)
    return { before, after: await afterOf(id) }
  }

  const deleteItemStep = (item, id, context, project) => ({
    done: `removed ${id} from epic ${context.epics.get(project)}`, doing: `removing it from epic ${context.epics.get(project)}`,
    run: () => send(context, 'DELETE_PROJECT_ITEM', { projectId: project, itemId: item.id }),
  })

  /** Takes the issue out of its parent: the parent issue when there is one, else its items in the epic Projects. */
  async function removeParent({ node, issue: before }, context, dryRun) {
    const steps = []
    if (node.parent) steps.push({ done: `removed the parent issue of ${before.id}`, doing: 'removing its parent issue', run: () => send(context, 'REMOVE_SUB_ISSUE', { issueId: node.parent.id, subIssueId: node.id }) })
    else steps.push(...epicItems(node, context).map((item) => deleteItemStep(item, before.id, context, item.project.id)))
    if (steps.length === 0) return { before, after: before }
    if (dryRun) return { before, after: { ...before, parent: undefined } }
    return run(before.id, steps, before)
  }

  /** The node and issue of a new parent. A parent GitHub does not find is INVALID_INPUT, as a create's parent is. */
  async function readParent(parent) {
    try {
      return await ops.readNode(parent)
    } catch (error) {
      if (error instanceof PmkitError && error.code === 'NOT_FOUND') {
        const epic = parseEpicId(parent) !== null
        throw invalid(`parent ${parent} is not an existing issue${epic ? ' or epic' : ''}`, 'pmkit issues list')
      }
      throw error
    }
  }

  /** Puts the issue in the epic: the parent issue goes first, then the epic's item is added, then the items in the other epics are deleted. */
  async function setEpicParent(read, epic, context, dryRun) {
    const { node, issue: before } = read
    const items = epicItems(node, context)
    const others = items.filter((item) => item.project.id !== epic.projectId)
    if (before.parent === epic.id && others.length === 0) return { before, after: before }
    if (dryRun) return { before, after: { ...before, parent: epic.id } }
    const steps = []
    if (node.parent) steps.push({ done: `removed the parent issue of ${before.id}`, doing: 'removing its parent issue', run: () => send(context, 'REMOVE_SUB_ISSUE', { issueId: node.parent.id, subIssueId: node.id }) })
    if (items.length === others.length) {
      steps.push({ done: `added ${before.id} to epic ${epic.id}`, doing: `adding it to epic ${epic.id}`, run: () => send(context, 'ADD_PROJECT_ITEM', { projectId: epic.projectId, contentId: node.id }) })
    }
    steps.push(...others.map((item) => deleteItemStep(item, before.id, context, item.project.id)))
    return run(before.id, steps, before)
  }

  /** `parent` is an issue id, an epic id (owner/number of a linked epic Project) or null. A new issue parent replaces the current one (replaceParent), and null removes it. */
  async function setParent(id, parent, actor, { dryRun = false } = {}) {
    await ops.requireActor(actor)
    const context = await getContext()
    const read = await ops.readNode(id)
    if (parent === null) return removeParent(read, context, dryRun)
    const epic = epicOf(context, parent)
    if (epic) return setEpicParent(read, epic, context, dryRun)
    const { node, issue: before } = read
    const target = await readParent(parent)
    if (target.issue.id === before.id) throw invalid(`${before.id} cannot be its own parent`)
    const chain = await ancestry(target.issue.id)
    const at = chain.indexOf(before.id)
    if (at >= 0) throw invalid(`parent loop: ${[before.id, ...chain.slice(0, at + 1)].join(' → ')}`)
    if (before.parent === target.issue.id) return { before, after: before }
    if (dryRun) return { before, after: { ...before, parent: target.issue.id } }
    await send(context, 'ADD_SUB_ISSUE', { issueId: target.node.id, subIssueId: node.id, replaceParent: true })
    return { before, after: await afterOf(before.id) }
  }

  return { link, unlink, setParent }
}
