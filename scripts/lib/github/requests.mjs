// The request helpers the GitHub operation modules share: the documents of a context, and a mutation sent with its input.

import { issueDocuments } from './documents.mjs'

const documents = new WeakMap()

/** The documents of a context's host and Project fields, built once per context. */
export function docsOf(context) {
  if (!documents.has(context)) documents.set(context, issueDocuments(context.features, context.projectFields))
  return documents.get(context)
}

/**
 * send(context, name, input, withFields) runs the document `name` over the client with { input }. withFields adds the
 * context's field variables, for a mutation that answers with the issue fragment.
 */
export function sender(client) {
  return (context, name, input, withFields = false) => client.request(docsOf(context)[name], withFields ? { input, ...context.fieldVariables } : { input })
}

const ITEM_PAGE = 100

/**
 * Rereads every Project item of an issue node whose projectItems GitHub cut, with MORE('projectItems'), so the item of the configured
 * Project is there before the node is mapped. The reread includes archived items; archived false drops them, for a read that left
 * them out. A node with no further page costs no request.
 */
export async function completeProjectItems(client, context, node, { archived }) {
  if (node?.projectItems?.pageInfo?.hasNextPage !== true) return node
  const { nodes } = await client.paginate(docsOf(context).MORE('projectItems'), { id: node.id, ...context.fieldVariables }, { select: (data) => data.node.projectItems, pageSize: ITEM_PAGE })
  node.projectItems = { nodes: archived ? nodes : nodes.filter((item) => !item.isArchived), pageInfo: { hasNextPage: false } }
  return node
}
