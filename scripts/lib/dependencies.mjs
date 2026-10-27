// The dependency map of an issue or an epic: pure, no file access. The caller passes every issue
// (archived ones included, oldest created first) and the target, and gets back the scope, the
// hierarchy under the target, the chain of open blockers that reaches it and its critical path.

import { walkParents } from './local/epics.mjs'
import { TERMINAL } from './model.mjs'
import { compareIds } from './ids.mjs'
import { PmkitError } from './errors.mjs'

const isOpen = (issue) => !TERMINAL.includes(issue.status?.category)

/**
 * @param {object} input
 * @param {object} input.target an issue from getIssue or an epic from getDeliverable, plus kind: 'issue' | 'epic'
 * @param {object[]} input.issues every issue, archived ones included, oldest created first (searchIssues({ archived: true }).issues)
 * @param {boolean} [input.dependencies=true] false when the manifest gives the dependencies capability the path absent
 * @param {string[]} [input.unreadable=[]] IDs of issue files that did not parse (the ids of searchIssues problems)
 * @param {string} [input.unit='points'] estimate.unit from the local config
 */
export function dependencyMap(input) {
  try {
    return buildMap(input)
  } catch (error) {
    throw tooDeep(error)
  }
}

/** The loop break, the critical path and the printers recurse along a chain; a chain that overflows the stack becomes a PmkitError. */
export function tooDeep(error) {
  if (!(error instanceof RangeError)) return error
  return new PmkitError('INVALID_INPUT', 'The dependency chain is too deep to map.', 'Shorten the blocked_by or parent chain, or run /pmkit:local:doctor.')
}

function buildMap({ target, issues, dependencies = true, unreadable = [], unit = 'points' }) {
  const byId = new Map(issues.map((issue) => [issue.id, issue]))
  const rank = new Map(issues.map((issue, index) => [issue.id, index]))
  const parentOf = (id) => byId.get(id)?.parent

  const scope = scopeOf(target, issues, parentOf)
  const ancestors = ancestorsOf(target, parentOf)
  const tree = treeOf(target, scope, parentOf)

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
      outside: false,
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

  // A node is under the target when it is in scope or its parent chain, through the nodes listed, reaches the target.
  // An archived parent that is not a node cuts the chain, so a node under it is outside.
  for (const node of nodes) {
    let under = false
    for (let seen = new Set(), current = node; current && !seen.has(current.id); current = graph.get(current.parent)) {
      if (current.scope || current.parent === target.id) {
        under = true
        break
      }
      seen.add(current.id)
    }
    node.outside = !under
  }

  const problems = breakLoops(nodes, graph)

  let basis = 'blockers'
  let reason = null
  if (!dependencies) [basis, reason] = ['hierarchy', 'absent']
  else if (!nodes.some((node) => node.blockedBy.length > 0)) [basis, reason] = ['hierarchy', resolved > 0 ? 'resolved' : 'none']

  const estimated = nodes.some((node) => node.open && typeof node.estimate === 'number')
  const weight = { unit: estimated ? unit : 'issues' }
  const criticalPath = basis === 'blockers' ? criticalPathOf(nodes, graph, weight.unit) : null
  for (const id of criticalPath?.ids ?? []) graph.get(id).critical = true

  return {
    target: { id: target.id, kind: target.kind, title: target.title, status: target.status, ancestors },
    basis,
    reason,
    weight,
    nodes,
    tree,
    criticalPath,
    resolved,
    related: relatedPairs(scope),
    problems,
  }
}

/**
 * Drops each kept edge that closes a blocked_by loop, so the graph is acyclic, and returns one
 * problem per dropped edge. The walk starts from the open scope issues, then takes the nodes left.
 */
function breakLoops(nodes, graph) {
  const problems = []
  const visited = new Set()
  const stack = []
  const visit = (node) => {
    visited.add(node.id)
    stack.push(node.id)
    for (const id of [...node.blockedBy]) {
      if (stack.includes(id)) {
        node.blockedBy = node.blockedBy.filter((other) => other !== id)
        const loop = [...stack.slice(stack.indexOf(id)), id].join(' → ')
        problems.push({ id: node.id, code: 'cycle', message: `blocked_by loop: ${loop}; run /pmkit:local:doctor` })
      } else if (!visited.has(id)) {
        visit(graph.get(id))
      }
    }
    stack.pop()
  }
  const starts = [...nodes.filter((node) => node.scope && node.open), ...nodes]
  for (const node of starts) if (!visited.has(node.id)) visit(node)
  return problems
}

/**
 * The heaviest chain of nodes, linked by kept blocker edges, that ends at an open scope issue.
 * The graph is acyclic here. Ties go to the chain whose nodes come first in creation order,
 * compared from the start of the chain; when one chain is a prefix of the other, the shorter wins.
 */
function criticalPathOf(nodes, graph, unit) {
  const rank = new Map(nodes.map((node, index) => [node.id, index]))
  const weightOf = (node) => (unit === 'issues' ? 1 : typeof node.estimate === 'number' ? node.estimate : 0)
  const before = (a, b) => {
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
      if (a[index] !== b[index]) return rank.get(a[index]) < rank.get(b[index])
    }
    return a.length < b.length
  }
  const better = (a, b) => b === undefined || a.length > b.length || (a.length === b.length && before(a.ids, b.ids))

  const memo = new Map()
  const best = (node) => {
    if (memo.has(node.id)) return memo.get(node.id)
    let chain
    for (const id of node.blockedBy) {
      const from = best(graph.get(id))
      const candidate = { ids: [...from.ids, node.id], length: from.length + weightOf(node) }
      if (better(candidate, chain)) chain = candidate
    }
    chain ??= { ids: [node.id], length: weightOf(node) }
    memo.set(node.id, chain)
    return chain
  }

  let path
  for (const node of nodes) {
    if (!node.scope || !node.open) continue
    const chain = best(node)
    if (better(chain, path)) path = chain
  }
  if (path === undefined) return null
  const unestimated = unit === 'issues' ? [] : path.ids.filter((id) => typeof graph.get(id).estimate !== 'number')
  return { ids: path.ids, length: path.length, unestimated }
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

/**
 * The hierarchy under the target, children in creation order. An ID already placed is never placed again.
 * A scope issue whose parent is not in the scope (an archived parent) hangs from its nearest ancestor that is.
 */
function treeOf(target, scope, parentOf) {
  const inScope = new Set([target.id, ...scope.map((issue) => issue.id)])
  const childrenOf = new Map()
  for (const issue of scope) {
    if (issue.id === target.id) continue
    let up = issue.parent
    for (const seen = new Set([issue.id]); up != null && !inScope.has(up) && !seen.has(up); up = parentOf(up)) seen.add(up)
    const key = up != null && inScope.has(up) ? up : target.id
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key).push(issue.id)
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
