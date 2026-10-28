// The Linear GraphQL client. See docs/superpowers/specs/2026-10-27-pmk-30-linear-api-client-design.md.

export const LINEAR_ENDPOINT = 'https://api.linear.app/graphql'

const stripComments = (document) => document.replace(/#[^\n]*/g, '').trim()

/** True when the document is a mutation. Comments and leading whitespace do not count. */
export function isMutation(document) {
  return /^mutation\b/i.test(stripComments(document))
}

/** The operation name of a document, or null when it is anonymous. */
export function operationName(document) {
  const match = /^(?:query|mutation|subscription)\s+([A-Za-z_]\w*)/.exec(stripComments(document))
  return match ? match[1] : null
}
