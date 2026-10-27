import assert from 'node:assert/strict'
import test from 'node:test'
import { findMatches } from './verify-api.mjs'

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
