// Reads GraphQL documents without a parser: the clients of Linear and GitHub use it to tell a mutation from a query.

const DEFINITION_KEYWORDS = new Set(['query', 'mutation', 'subscription', 'fragment'])

/**
 * Each top-level definition as { keyword, name }, with keyword '{' for an anonymous query and name null when none follows,
 * or null when the document cannot be read: an unclosed string, unbalanced brackets or an unknown keyword.
 * Strings, block strings and comments are skipped, so a word inside them never counts.
 */
function definitions(document) {
  const found = []
  let expectName = false
  const stack = []
  let expectDefinition = true
  let index = 0
  while (index < document.length) {
    const char = document[index]
    if (char === '#') {
      let end = index + 1
      while (end < document.length && document[end] !== '\n' && document[end] !== '\r') end += 1
      index = end
    } else if (document.startsWith('"""', index)) {
      let end = index + 3
      while (end < document.length && !(document.startsWith('"""', end) && document[end - 1] !== '\\')) end += 1
      if (end >= document.length) return null
      index = end + 3
    } else if (char === '"') {
      let end = index + 1
      while (end < document.length && document[end] !== '"' && document[end] !== '\n') end += document[end] === '\\' ? 2 : 1
      if (end >= document.length || document[end] !== '"') return null
      index = end + 1
    } else if (char === '{' || char === '(' || char === '[') {
      expectName = false
      if (char === '{' && stack.length === 0 && expectDefinition) {
        found.push({ keyword: '{', name: null })
        expectDefinition = false
      }
      stack.push(char)
      index += 1
    } else if (char === '}' || char === ')' || char === ']') {
      const open = stack.pop()
      if (open !== { '}': '{', ')': '(', ']': '[' }[char]) return null
      if (char === '}' && stack.length === 0) expectDefinition = true
      index += 1
    } else if (/[A-Za-z_]/.test(char)) {
      const name = /^[A-Za-z_]\w*/.exec(document.slice(index))[0]
      if (stack.length === 0 && expectDefinition) {
        const keyword = name.toLowerCase()
        if (!DEFINITION_KEYWORDS.has(keyword)) return null
        found.push({ keyword, name: null })
        expectDefinition = false
        expectName = true
      } else if (stack.length === 0 && expectName) {
        found[found.length - 1].name = name
        expectName = false
      }
      index += name.length
    } else {
      if (!/\s|,/.test(char)) expectName = false
      index += 1
    }
  }
  return stack.length === 0 ? found : null
}

/**
 * True when any operation in the document is a mutation, so the client sends it once.
 * A document the lexer cannot read counts as a mutation too: a wrong yes costs a retry, a wrong no can apply a change twice.
 */
export function isMutation(document) {
  const found = definitions(document)
  return found === null || found.some((definition) => definition.keyword === 'mutation')
}

/** The name of the first operation in a document, skipping fragments, or null when it is anonymous or the document cannot be read. */
export function operationName(document) {
  const operation = definitions(document)?.find((definition) => definition.keyword !== 'fragment')
  return operation?.name ?? null
}

const positiveInteger = (value) => Number.isInteger(value) && value >= 1

const optionalFunction = (value) => value === undefined || typeof value === 'function'
const optionalPositive = (value) => value === undefined || positiveInteger(value)

/** Throws a TypeError, before any request, for options that are a bug in the caller. Returns the page cap. */
function checkPageOptions({ select, pageSize, limit, maxPages, stop }, maxPageSize) {
  if (typeof select !== 'function') throw new TypeError('paginate needs a select function')
  if (!optionalFunction(stop)) throw new TypeError('stop must be a function')
  if (!positiveInteger(pageSize) || pageSize > maxPageSize) throw new TypeError(`pageSize must be an integer from 1 to ${maxPageSize}`)
  if (!optionalPositive(maxPages)) throw new TypeError('maxPages must be an integer of at least 1')
  if (!optionalPositive(limit)) throw new TypeError('limit must be an integer of at least 1')
  // Without a limit, ten pages bound an unbounded call. With one, the limit bounds the loop.
  return maxPages ?? (limit === undefined ? 10 : Infinity)
}

/** The connection select() picks from a page, or null when it is not one: no nodes list or no pageInfo object. */
function connectionOf(select, data) {
  let connection
  try {
    connection = select(data)
  } catch {
    return null
  }
  const valid = Array.isArray(connection?.nodes) && connection.pageInfo !== null && typeof connection.pageInfo === 'object'
  return valid ? connection : null
}

/** A next cursor is a new, non-empty string: a missing or repeated one would loop forever. */
const validCursor = (cursor, after) => typeof cursor === 'string' && cursor !== '' && cursor !== after

/** Whether options.stop asks the loop to end after this page. */
const stopsAfter = async (stop, connection) => stop !== undefined && (await stop(connection.nodes, connection)) === true

/** Whether the loop ends while the server still has a next page: stop said so, the limit is reached or the page cap is. */
const shouldEnd = ({ stopped, count, limit, pages, cap }) => stopped || (limit !== undefined && count >= limit) || pages >= cap

/**
 * Pages through a Relay connection: the document takes $first: Int! and $after: String, and select(data) returns the
 * connection. Returns { nodes, hasMore }, where hasMore says the loop stopped while the server still had a next page.
 * broken(name) builds the error for a page that is not a connection, has no cursor or repeats the last one.
 * options.stop, when given, is awaited as stop(pageNodes, connection) after each page is added. When it returns true the
 * loop ends after that page, and hasMore says whether the server still had a next page, as for a limit or the page cap.
 * The Linear and GitHub clients share it (PMK-30, PMK-85).
 */
export async function paginateConnection(request, document, variables, options, { maxPageSize, broken }) {
  const pageSize = options.pageSize ?? 100
  const { select, limit, stop } = options
  const cap = checkPageOptions({ ...options, pageSize }, maxPageSize)
  const fail = () => broken(operationName(document) ?? 'an anonymous query')
  const nodes = []
  const result = (hasMore) => ({ nodes: nodes.slice(0, limit), hasMore })
  let after = null
  for (let pages = 1; ; pages += 1) {
    const first = limit === undefined ? pageSize : Math.min(pageSize, limit - nodes.length)
    const connection = connectionOf(select, await request(document, { ...variables, first, after }))
    if (connection === null) throw fail()
    nodes.push(...connection.nodes)
    const stopped = await stopsAfter(stop, connection)
    if (connection.pageInfo.hasNextPage !== true) return result(false)
    const cursor = connection.pageInfo.endCursor
    if (!validCursor(cursor, after)) throw fail()
    if (shouldEnd({ stopped, count: nodes.length, limit, pages, cap })) return result(true)
    after = cursor
  }
}
