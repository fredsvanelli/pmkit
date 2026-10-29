import assert from 'node:assert/strict'
import test from 'node:test'
import { isMutation, operationName } from './client.mjs'
import * as documents from './documents.mjs'

const DOCUMENTS = {
  ISSUES_QUERY: 'PmkitIssues', ISSUE_BY_ID_QUERY: 'PmkitIssueById', ISSUE_CREATE: 'PmkitIssueCreate', ISSUE_UPDATE: 'PmkitIssueUpdate',
  ISSUE_ARCHIVE: 'PmkitIssueArchive', RELATION_CREATE: 'PmkitRelationCreate', RELATION_DELETE: 'PmkitRelationDelete',
  BLOCK_GRAPH_QUERY: 'PmkitBlockGraph', PARENT_CHAIN_QUERY: 'PmkitParentChain',
  ISSUE_HISTORY_QUERY: 'PmkitIssueHistory', ISSUE_COMMENTS_QUERY: 'PmkitIssueComments', COMMENT_BY_ID_QUERY: 'PmkitCommentById',
  COMMENT_CREATE: 'PmkitCommentCreate', COMMENT_RESOLVE: 'PmkitCommentResolve', ISSUE_EVENTS_QUERY: 'PmkitIssueEvents',
  CYCLES_QUERY: 'PmkitCycles', CYCLE_BY_NUMBER_QUERY: 'PmkitCycleByNumber',
}

test('every document has its name and the right kind', () => {
  for (const [key, name] of Object.entries(DOCUMENTS)) {
    assert.equal(operationName(documents[key]), name, key)
    assert.equal(isMutation(documents[key]), /CREATE|UPDATE|ARCHIVE|DELETE|RESOLVE/.test(key), key)
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

test('ISSUE_FRAGMENT is unchanged by PMK-36, gains the cycle in PMK-37 and the project in PMK-38', () => {
  assert.equal(documents.ISSUE_FRAGMENT, `fragment PmkitIssueFields on Issue {
  id identifier title description priority estimate dueDate branchName archivedAt trashed createdAt updatedAt
  team { id key } state { id name type } assignee { id } parent { identifier } project { id slugId identifier } projectMilestone { id }
  cycle { id number }
  labels(first: 50) { nodes { id name parent { name } } pageInfo { hasNextPage endCursor } }
  children(first: 50) { nodes { identifier } pageInfo { hasNextPage endCursor } }
  relations(first: 50) { nodes { id type relatedIssue { identifier state { id type } } } pageInfo { hasNextPage endCursor } }
  inverseRelations(first: 50) { nodes { id type issue { identifier state { id type } } } pageInfo { hasNextPage endCursor } }
}`)
})

test('the parent chain nests 10 levels', () => {
  assert.equal(documents.PARENT_CHAIN_QUERY.match(/parent \{/g).length, 10)
})

test('the issue fragment selects the cycle', () => {
  assert.match(documents.ISSUE_FRAGMENT, /cycle \{ id number \}/)
})

test('the issue fragment selects the project and the project milestone', () => {
  assert.match(documents.ISSUE_FRAGMENT, /project \{ id slugId identifier \}/)
  assert.match(documents.ISSUE_FRAGMENT, /projectMilestone \{ id \}/)
})

test('the history query selects the keys an epic id is made from', () => {
  assert.match(documents.ISSUE_HISTORY_QUERY, /fromProject \{ id slugId identifier \} toProject \{ id slugId identifier \}/)
  assert.match(documents.ISSUE_HISTORY_QUERY, /fromProjectMilestone \{ id \} toProjectMilestone \{ id \}/)
})

test('the migration documents name their operation', async () => {
  const projects = await import('./projects.mjs')
  const named = {
    ISSUES_BY_IDS: [documents, 'PmkitIssuesByIds'], COMMENTS_BY_IDS: [documents, 'PmkitCommentsByIds'], LABEL_CREATE: [documents, 'PmkitLabelCreate'],
    LABEL_DELETE: [documents, 'PmkitLabelDelete'], ISSUE_DELETE: [documents, 'PmkitIssueDelete'],
    PROJECTS_BY_IDS: [projects, 'PmkitProjectsByIds'], PROJECT_STATUSES: [projects, 'PmkitProjectStatuses'], PROJECT_DELETE: [projects, 'PmkitProjectDelete'],
  }
  for (const [key, [module, name]] of Object.entries(named)) {
    assert.equal(operationName(module[key]), name, key)
    assert.equal(isMutation(module[key]), /CREATE|DELETE/.test(key), key)
  }
  assert.match(documents.ISSUES_BY_IDS, /includeArchived: true, first: 100/)
  assert.match(documents.ISSUES_BY_IDS, /updatedAt archivedAt trashed relations\(first: 50\) \{ nodes \{ id \} \}/)
})

test('ISSUE_DELETE sends no permanentlyDelete', () => {
  assert.doesNotMatch(documents.ISSUE_DELETE, /permanentlyDelete/)
  assert.match(documents.ISSUE_DELETE, /\$id: String!/)
})
