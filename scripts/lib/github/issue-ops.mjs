// The issue operations of the GitHub adapter. This part reads: getIssue, searchIssues and readNode.
// See docs/specs/2026-11-16-pmk-87-github-issues-relations-history-design.md, "Ids", "The issue fragment" and "Search".

import { PmkitError } from '../errors.mjs'
import { checkFilter, issueComparator } from '../issue-filter.mjs'
import { issueDocuments } from './documents.mjs'
import { translateFilter } from './filter.mjs'
import { notFound, parseIssueId } from './ids.mjs'
import { toIssue } from './issues.mjs'

const PAGE_SIZE = 100
// The nested connections of the issue fragment that may have more pages than the fragment reads.
const NESTED = ['labels', 'subIssues', 'blockedBy', 'blocking', 'relatesTo']
const NOTHING = () => ({ issues: [], problems: [], hasMore: false })

/**
 * The issue operations over a GitHub client. getContext({ refresh }) returns the context of makeContext; the tracker
 * passes one over its discovery memo, and refresh rereads GitHub. The reads do not use config; the writes of later tasks do.
 */
export function issueOperations({ client, config, getContext }) {
  const documents = new WeakMap()
  /** The documents of a context's host and Project fields, built once per context. */
  function docsOf(context) {
    if (!documents.has(context)) documents.set(context, issueDocuments(context.features, context.projectFields))
    return documents.get(context)
  }

  /** Reads every page of each nested connection GitHub cut, so the node lists are complete before mapping. */
  async function completeNested(node, context) {
    const docs = docsOf(context)
    for (const field of NESTED) {
      if (node[field]?.pageInfo?.hasNextPage !== true) continue
      const variables = { id: node.id }
      if (field === 'blockedBy' && context.projectFields.status) variables.fStatus = context.fieldVariables.fStatus
      const { nodes } = await client.paginate(docs.MORE(field), variables, { select: (data) => data.node[field], pageSize: PAGE_SIZE })
      node[field] = { nodes, pageInfo: { hasNextPage: false } }
    }
    return node
  }

  /** The node and the issue of an id, in the scope repository or another one. A malformed id is NOT_FOUND with no request. */
  async function readNode(id) {
    const context = await getContext()
    const parsed = parseIssueId(id, context.repo)
    if (!parsed) throw notFound(id)
    const { repo, number } = parsed
    const [owner, name] = repo.split('/')
    let data
    try {
      data = await client.request(docsOf(context).ISSUE, { owner, name, number, ...context.fieldVariables })
    } catch (error) {
      if (error instanceof PmkitError && error.code === 'NOT_FOUND') throw notFound(id)
      throw error
    }
    const node = data?.repository?.issue
    if (!node) throw notFound(id)
    await completeNested(node, context)
    return { node, issue: toIssue(node, context) }
  }

  async function getIssue(id) {
    return (await readNode(id)).issue
  }

  /** Narrows on GitHub with filterBy, then runs the client steps, pmkit's order and the limit. */
  async function searchIssues(filter = {}) {
    const context = await getContext()
    const viewer = context.raw.viewer?.login ?? null
    const members = [...new Set([viewer, ...(context.raw.users ?? []).map((user) => user.login)].filter(Boolean))]
    // Any sprint passes the check here, so translateFilter answers NOT_SUPPORTED for it.
    checkFilter(filter, { types: Object.keys(context.pmkit?.mappings?.types ?? {}), members, sprintExists: () => true })
    const translated = translateFilter(filter, context, viewer)
    if (filter.limit === 0 || translated.empty) return NOTHING()
    const [owner, name] = context.repo.split('/')
    const variables = { owner, name, ...translated.variables, ...context.fieldVariables }
    // GitHub's order (created, oldest first) is pmkit's order for the created sort, so that read stops once limit issues passed.
    const enough = translated.sort === 'created' && translated.limit !== undefined ? translated.limit : Infinity
    const kept = []
    let stopped = false
    const { hasMore } = await client.paginate(docsOf(context).ISSUES, variables, {
      select: (data) => data.repository.issues,
      pageSize: PAGE_SIZE,
      limit: translated.serverLimit,
      stop: async (nodes) => {
        for (const node of nodes) {
          await completeNested(node, context)
          const issue = toIssue(node, context)
          if (translated.clientSteps.every((step) => step(issue, node))) kept.push(issue)
        }
        stopped = kept.length >= enough
        return stopped
      },
    })
    const issues = kept.sort(issueComparator(translated.sort, context.priorities))
    const cut = translated.limit === undefined ? issues : issues.slice(0, translated.limit)
    // hasMore means the page cap cut a read that still needed issues, never that the limit was reached.
    return { issues: cut, problems: [], hasMore: hasMore && !stopped }
  }

  return { getIssue, searchIssues, readNode }
}
