import assert from 'node:assert/strict'
import test from 'node:test'
import { FEATURES, assertQuery, findMatches, graphql, run, summarize } from './verify-api.mjs'

const schema = {
  queryType: { name: 'Query' },
  mutationType: { name: 'Mutation' },
  types: [
    { name: 'Query', kind: 'OBJECT', fields: [{ name: 'releases' }, { name: 'projectRelations' }, { name: 'issues' }] },
    { name: 'Mutation', kind: 'OBJECT', fields: [{ name: 'releaseCreate' }, { name: 'projectRelationCreate' }, { name: 'issueCreate' }] },
    { name: 'Release', kind: 'OBJECT', fields: [{ name: 'id' }] },
    { name: 'Issue', kind: 'OBJECT', fields: [{ name: 'recurringIssueTemplate' }, { name: 'releases' }, { name: 'title' }] },
  ],
}

test('findMatches lists types, queries, mutations and fields whose name matches', () => {
  const found = findMatches(schema, /release/i)
  assert.deepEqual(found.types, ['Release'])
  assert.deepEqual(found.queries, ['releases'])
  assert.deepEqual(found.mutations, ['releaseCreate'])
  assert.deepEqual(found.fields, ['Issue.releases'])
})

test('findMatches returns empty lists when nothing matches', () => {
  assert.deepEqual(findMatches(schema, /insight|analytic|metric/i), { types: [], queries: [], mutations: [], fields: [] })
})

const feature = (id) => FEATURES.find((item) => item.id === id)

test('FEATURES defines the four features with a pattern and live queries', () => {
  assert.deepEqual(FEATURES.map((item) => item.id), ['recurring', 'project_dependencies', 'releases', 'insights'])
  for (const item of FEATURES) {
    assert.ok(item.pattern instanceof RegExp)
    assert.ok(Array.isArray(item.liveQueries))
  }
  assert.equal(feature('insights').liveQueries.length, 0)
  assert.deepEqual(feature('releases').liveQueries.map((query) => query.name), ['releases', 'releasePipelines'])
})

test('summarize reports found names and ok for a list with nodes', () => {
  const out = summarize(feature('releases'), schema, {
    releases: { data: { releases: { nodes: [{ id: '1' }] } } },
    releasePipelines: { data: { releasePipelines: { nodes: [] } } },
  })
  assert.equal(out.feature, 'releases')
  assert.deepEqual(out.found.types, ['Release'])
  assert.equal(out.live, 'ok')
})

test('summarize reports empty when every list has no nodes', () => {
  const out = summarize(feature('project_dependencies'), schema, {
    projectRelations: { data: { projectRelations: { nodes: [] } } },
  })
  assert.equal(out.live, 'empty')
})

test('summarize reports the GraphQL error code and message', () => {
  const out = summarize(feature('project_dependencies'), schema, {
    projectRelations: { errors: [{ message: 'nope', extensions: { code: 'FORBIDDEN' } }] },
  })
  assert.deepEqual(out.live, { error: { code: 'FORBIDDEN', message: 'nope' } })
})

test('summarize reports skipped without a live query and empty found lists', () => {
  const out = summarize(feature('insights'), schema, {})
  assert.equal(out.live, 'skipped')
  assert.deepEqual(out.found, { types: [], queries: [], mutations: [], fields: [] })
})

test('assertQuery rejects a mutation, even behind whitespace or comments', () => {
  assert.throws(() => assertQuery('mutation { x }'), /read-only/)
  assert.throws(() => assertQuery('  mutation M { x }'), /read-only/)
  assert.throws(() => assertQuery('# note\n\n  mutation { x }'), /read-only/)
})

test('assertQuery accepts queries', () => {
  assertQuery('query { viewer { id } }')
  assertQuery('{ viewer { id } }')
})

const KEY = 'lin_test_SECRET'

function fakeFetch(response) {
  const calls = []
  const fn = async (...args) => {
    calls.push(args)
    return response
  }
  fn.calls = calls
  return fn
}

const reply = (status, text) => ({ ok: status >= 200 && status < 300, status, text: async () => text })

test('graphql posts the query to Linear with the key in the Authorization header only', async () => {
  const fetch = fakeFetch(reply(200, JSON.stringify({ data: { viewer: { id: '1' } } })))
  const result = await graphql({ fetch, key: KEY, query: '{ viewer { id } }' })
  assert.deepEqual(result, { data: { viewer: { id: '1' } } })
  const [url, init] = fetch.calls[0]
  assert.equal(url, 'https://api.linear.app/graphql')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.Authorization, KEY)
  assert.equal(JSON.parse(init.body).query, '{ viewer { id } }')
  assert.ok(!init.body.includes(KEY))
  assert.ok(!url.includes(KEY))
})

test('graphql returns GraphQL errors of a 200 response to the caller', async () => {
  const fetch = fakeFetch(reply(200, JSON.stringify({ errors: [{ message: 'x' }] })))
  const result = await graphql({ fetch, key: KEY, query: '{ a }' })
  assert.equal(result.errors[0].message, 'x')
})

test('graphql refuses a mutation before any call', async () => {
  const fetch = fakeFetch(reply(200, '{}'))
  await assert.rejects(() => graphql({ fetch, key: KEY, query: 'mutation { x }' }), /read-only/)
  assert.equal(fetch.calls.length, 0)
})

test('graphql errors on HTTP failure or a non-JSON body name the status, not the key', async () => {
  for (const response of [reply(401, 'denied'), reply(200, '<html>')]) {
    await assert.rejects(
      () => graphql({ fetch: fakeFetch(response), key: KEY, query: '{ a }' }),
      (error) => /HTTP/.test(error.message) && !error.message.includes(KEY),
    )
  }
})

function liveFetch({ failOn } = {}) {
  const calls = []
  const answer = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })
  const fn = async (url, init) => {
    const { query } = JSON.parse(init.body)
    calls.push(query)
    if (query.includes('__schema')) return answer({ data: { __schema: schema } })
    if (query.includes('organization')) return answer({ data: { organization: { urlKey: 'acme' } } })
    if (failOn && query.includes(failOn)) return answer({ errors: [{ message: 'boom', extensions: { code: 'FORBIDDEN' } }] })
    return answer({ data: { releases: { nodes: [] }, releasePipelines: { nodes: [] }, projectRelations: { nodes: [] }, templates: [], issues: { nodes: [] } } })
  }
  fn.calls = calls
  return fn
}

function capture() {
  const out = []
  return { out, write: (text) => out.push(text) }
}

test('run skips without PMKIT_LIVE and sends nothing', async () => {
  const fetch = liveFetch()
  const { out, write } = capture()
  const code = await run({ env: {}, fetch, write })
  assert.equal(code, 0)
  assert.equal(out.length, 1)
  assert.match(out[0], /PMKIT_LIVE=1/)
  assert.equal(fetch.calls.length, 0)
})

test('run exits 2 without a key and sends nothing', async () => {
  const fetch = liveFetch()
  const { out, write } = capture()
  const code = await run({ env: { PMKIT_LIVE: '1' }, fetch, write })
  assert.equal(code, 2)
  assert.equal(out.length, 1)
  assert.equal(fetch.calls.length, 0)
})

test('run prints the workspace and one summary per feature, with queries only', async () => {
  const fetch = liveFetch()
  const { out, write } = capture()
  const code = await run({ env: { PMKIT_LIVE: '1', LINEAR_API_KEY: KEY }, fetch, write })
  assert.equal(code, 0)
  const text = out.join('')
  assert.ok(!text.includes(KEY))
  const report = JSON.parse(text)
  assert.equal(report.organization.urlKey, 'acme')
  assert.deepEqual(report.features.map((item) => item.feature), FEATURES.map((item) => item.id))
  assert.equal(report.features.find((item) => item.feature === 'releases').live, 'empty')
  for (const query of fetch.calls) assert.match(query.trim(), /^(query\b|\{)/)
})

test('run reports one failing live query without stopping the others', async () => {
  const { out, write } = capture()
  await run({ env: { PMKIT_LIVE: '1', LINEAR_API_KEY: KEY }, fetch: liveFetch({ failOn: 'projectRelations' }), write })
  const report = JSON.parse(out.join(''))
  assert.equal(report.features.find((item) => item.feature === 'project_dependencies').live.error.code, 'FORBIDDEN')
  assert.equal(report.features.find((item) => item.feature === 'releases').live, 'empty')
})
