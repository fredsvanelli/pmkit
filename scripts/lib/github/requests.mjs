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
