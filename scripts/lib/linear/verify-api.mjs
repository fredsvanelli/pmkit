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

const connection = (name) => (data) => data?.[name]?.nodes ?? []

export const FEATURES = [
  {
    id: 'recurring',
    pattern: /recurr/i,
    liveQueries: [
      { name: 'templates', query: '{ templates { id name type } }', nodes: (data) => data?.templates ?? [] },
      {
        name: 'recurringIssueTemplate',
        query: '{ issues(first: 1) { nodes { id recurringIssueTemplate { id name type } } } }',
        nodes: (data) => (data?.issues?.nodes ?? []).map((issue) => issue.recurringIssueTemplate).filter(Boolean),
      },
    ],
  },
  {
    id: 'project_dependencies',
    pattern: /projectRelation/i,
    liveQueries: [
      { name: 'projectRelations', query: '{ projectRelations(first: 1) { nodes { id type } } }', nodes: connection('projectRelations') },
    ],
  },
  {
    id: 'releases',
    pattern: /release/i,
    liveQueries: [
      { name: 'releases', query: '{ releases(first: 1) { nodes { id } } }', nodes: connection('releases') },
      { name: 'releasePipelines', query: '{ releasePipelines(first: 1) { nodes { id } } }', nodes: connection('releasePipelines') },
    ],
  },
  { id: 'insights', pattern: /insight|analytic|metric/i, liveQueries: [] },
]

function summarizeLive(feature, liveResults) {
  if (feature.liveQueries.length === 0) return 'skipped'
  let populated = false
  for (const query of feature.liveQueries) {
    const result = liveResults[query.name]
    if (!result || result.errors?.length) {
      const first = result?.errors?.[0]
      return { error: { code: first?.extensions?.code ?? first?.extensions?.type ?? 'UNKNOWN', message: first?.message ?? 'no result' } }
    }
    if (query.nodes(result.data).length > 0) populated = true
  }
  return populated ? 'ok' : 'empty'
}

// Never decides yes or no. The note's author applies the answer rules.
export function summarize(feature, schema, liveResults) {
  return { feature: feature.id, found: findMatches(schema, feature.pattern), live: summarizeLive(feature, liveResults) }
}

const ENDPOINT = 'https://api.linear.app/graphql'

export function assertQuery(document) {
  const body = document.replace(/#[^\n]*/g, '').trim()
  if (/^mutation\b/i.test(body)) throw new Error('verify-api is read-only: refusing to send a mutation')
}

export async function graphql({ fetch = globalThis.fetch, key, query, variables }) {
  assertQuery(query)
  let response
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: key },
      body: JSON.stringify({ query, variables }),
    })
  } catch {
    throw new Error('Linear request failed before a response (network error)')
  }
  const text = await response.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  if (!response.ok) throw new Error(`Linear answered HTTP ${response.status}`)
  if (parsed === undefined) throw new Error(`Linear returned a non-JSON body (HTTP ${response.status})`)
  return parsed
}
