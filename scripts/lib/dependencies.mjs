// The dependency map of an issue or an epic: pure, no file access. The caller passes every issue
// (archived ones included, oldest created first) and the target, and gets back the scope, the
// hierarchy under the target, the chain of open blockers that reaches it and its critical path.

import { walkParents } from './local/epics.mjs'
import { TERMINAL } from './model.mjs'
import { compareIds } from './ids.mjs'

const isOpen = (issue) => !TERMINAL.includes(issue.status?.category)

/**
 * @param {object} input
 * @param {object} input.target an issue from getIssue or an epic from getDeliverable, plus kind: 'issue' | 'epic'
 * @param {object[]} input.issues every issue, archived ones included, oldest created first (searchIssues({ archived: true }).issues)
 * @param {boolean} [input.dependencies=true] false when the manifest gives the dependencies capability the path absent
 * @param {string[]} [input.unreadable=[]] IDs of issue files that did not parse (the ids of searchIssues problems)
 * @param {string} [input.unit='points'] estimate.unit from the local config
 */
export function dependencyMap({ target, issues, dependencies = true, unreadable = [], unit = 'points' }) {
  const byId = new Map(issues.map((issue) => [issue.id, issue]))
  const rank = new Map(issues.map((issue, index) => [issue.id, index]))
  const parentOf = (id) => byId.get(id)?.parent

  const scope = scopeOf(target, issues, parentOf)
  const ancestors = ancestorsOf(target, parentOf)
  const tree = treeOf(target, scope)

  // The graph: one node per scope issue and per blocker reached from an open scope issue.
  const graph = new Map()
  const addNode = (id, fields) => {
    const issue = byId.get(id)
    const node = {
      id,
      title: issue?.title ?? null,
      status: issue?.status ?? null,
      assignee: issue?.assignee ?? null,
      estimate: issue?.estimate ?? null,
      parent: issue?.parent ?? null,
      scope: false,
      open: issue ? isOpen(issue) : true,
      archived: issue?.archived === true,
      missing: false,
      unreadable: false,
      blockedBy: [],
      critical: false,
      ...fields,
    }
    graph.set(id, node)
    return node
  }
  for (const issue of scope) addNode(issue.id, { scope: true })

  let resolved = 0
  if (dependencies) {
    const queue = scope.filter(isOpen)
    const queued = new Set(queue.map((issue) => issue.id))
    for (let index = 0; index < queue.length; index++) {
      const issue = queue[index]
      const node = graph.get(issue.id)
      for (const id of new Set(issue.blockedBy ?? [])) {
        const blocker = byId.get(id)
        if (blocker && !isOpen(blocker)) {
          resolved++
          continue
        }
        node.blockedBy.push(id)
        if (graph.has(id)) {
          if (blocker && !queued.has(id)) {
            queued.add(id)
            queue.push(blocker)
          }
          continue
        }
        if (!blocker) {
          const isUnreadable = unreadable.includes(id)
          addNode(id, { missing: !isUnreadable, unreadable: isUnreadable })
          continue
        }
        addNode(id)
        queued.add(id)
        queue.push(blocker)
      }
    }
  }

  const nodes = [...graph.values()].sort((a, b) => {
    const ra = rank.get(a.id)
    const rb = rank.get(b.id)
    if (ra !== undefined && rb !== undefined) return ra - rb
    if (ra !== undefined) return -1
    if (rb !== undefined) return 1
    return compareIds(a.id, b.id)
  })

  const problems = []

  let basis = 'blockers'
  let reason = null
  if (!dependencies) [basis, reason] = ['hierarchy', 'absent']
  else if (!nodes.some((node) => node.blockedBy.length > 0)) [basis, reason] = ['hierarchy', resolved > 0 ? 'resolved' : 'none']

  const estimated = nodes.some((node) => node.open && typeof node.estimate === 'number')
  const weight = { unit: estimated ? unit : 'issues' }

  return {
    target: { id: target.id, kind: target.kind, title: target.title, status: target.status, ancestors },
    basis,
    reason,
    weight,
    nodes,
    tree,
    criticalPath: null,
    resolved,
    related: relatedPairs(scope),
    problems,
  }
}

/** The scope issues in creation order: for an epic, the non-archived issues under it; for an issue, itself and its non-archived sub-issues. */
function scopeOf(target, issues, parentOf) {
  if (target.kind === 'epic') return issues.filter((issue) => !issue.archived && walkParents(issue.id, parentOf).chain.includes(target.id))
  const scope = issues.filter((issue) => issue.id === target.id || (!issue.archived && walkParents(issue.id, parentOf).chain.includes(target.id)))
  if (!scope.some((issue) => issue.id === target.id)) scope.unshift(target)
  return scope
}

/** The parent chain of an issue target, nearest first, cut before the first repeated ID. An epic has none. */
function ancestorsOf(target, parentOf) {
  if (target.kind === 'epic') return []
  const { chain, loop } = walkParents(target.id, parentOf)
  return chain.slice(1, loop ? -1 : undefined)
}

/** The hierarchy under the target, children in creation order. An ID already placed is never placed again. */
function treeOf(target, scope) {
  const childrenOf = new Map()
  for (const issue of scope) {
    if (!childrenOf.has(issue.parent)) childrenOf.set(issue.parent, [])
    childrenOf.get(issue.parent).push(issue.id)
  }
  const placed = new Set()
  const build = (id) => {
    placed.add(id)
    const children = []
    for (const child of childrenOf.get(id) ?? []) if (!placed.has(child)) children.push(build(child))
    return { id, children }
  }
  if (target.kind !== 'epic') return [build(target.id)]
  return build(target.id).children
}

/** The related links of the scope issues, as [a, b] pairs, each pair once in either order. */
function relatedPairs(scope) {
  const pairs = []
  const seen = new Set()
  for (const issue of scope) {
    for (const other of issue.related ?? []) {
      const key = [issue.id, other].sort().join('\n')
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push([issue.id, other])
    }
  }
  return pairs
}
