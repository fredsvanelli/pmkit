import assert from 'node:assert/strict'
import test from 'node:test'
import { isMutation, operationName } from './client.mjs'
import * as documents from './documents.mjs'

const DOCUMENTS = {
  ISSUES_QUERY: 'PmkitIssues', ISSUE_BY_ID_QUERY: 'PmkitIssueById', ISSUE_CREATE: 'PmkitIssueCreate', ISSUE_UPDATE: 'PmkitIssueUpdate',
  ISSUE_ARCHIVE: 'PmkitIssueArchive', RELATION_CREATE: 'PmkitRelationCreate', RELATION_DELETE: 'PmkitRelationDelete',
  BLOCK_GRAPH_QUERY: 'PmkitBlockGraph', PARENT_CHAIN_QUERY: 'PmkitParentChain',
}

test('every document has its name and the right kind', () => {
  for (const [key, name] of Object.entries(DOCUMENTS)) {
    assert.equal(operationName(documents[key]), name, key)
    assert.equal(isMutation(documents[key]), /CREATE|UPDATE|ARCHIVE|DELETE/.test(key), key)
  }
  for (const [field, document] of Object.entries(documents.NESTED_PAGES)) {
    assert.match(operationName(document), /^PmkitIssue\w+Page$/, field)
    assert.equal(isMutation(document), false, field)
  }
  assert.deepEqual(Object.keys(documents.NESTED_PAGES), ['labels', 'children', 'relations', 'inverseRelations'])
})

test('documents that select issue fields start with the fragment', () => {
  for (const key of ['ISSUES_QUERY', 'ISSUE_BY_ID_QUERY', 'ISSUE_CREATE', 'ISSUE_UPDATE']) {
    assert.ok(documents[key].startsWith(documents.ISSUE_FRAGMENT), key)
  }
  assert.match(documents.ISSUE_FRAGMENT, /^fragment PmkitIssueFields on Issue \{/)
})

test('the parent chain nests 10 levels', () => {
  assert.equal(documents.PARENT_CHAIN_QUERY.match(/parent \{/g).length, 10)
})
