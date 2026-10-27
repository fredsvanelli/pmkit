// Verification tool for PMK-29, not adapter code. It reads the Linear GraphQL
// schema and runs read-only list queries so the API check can be repeated.
// Results are recorded in API-VERIFICATION.md.

const sorted = (list) => [...list].sort()

export function findMatches(schema, pattern) {
  const roots = new Set([schema.queryType?.name, schema.mutationType?.name].filter(Boolean))
  const byName = new Map(schema.types.map((type) => [type.name, type]))
  const rootFields = (root) =>
    (byName.get(schema[root]?.name)?.fields ?? []).map((field) => field.name).filter((name) => pattern.test(name))
  const types = []
  const fields = []
  for (const type of schema.types) {
    if (roots.has(type.name)) continue
    if (pattern.test(type.name)) types.push(type.name)
    for (const field of type.fields ?? []) {
      if (pattern.test(field.name)) fields.push(`${type.name}.${field.name}`)
    }
  }
  return {
    types: sorted(types),
    queries: sorted(rootFields('queryType')),
    mutations: sorted(rootFields('mutationType')),
    fields: sorted(fields),
  }
}
