import assert from 'node:assert/strict'
import test from 'node:test'
import { FEATURES, findMatches, summarize } from './verify-api.mjs'

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
