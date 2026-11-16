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
