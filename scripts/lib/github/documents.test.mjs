import test from 'node:test'
import assert from 'node:assert/strict'
import { hostFeatures, issueDocuments, ITEM_TYPES } from './documents.mjs'
import { isMutation, operationName } from '../graphql.mjs'

const GITHUB = hostFeatures({ host: 'github.com', ghesVersion: null })
const GHES = hostFeatures({ host: 'git.acme.dev', ghesVersion: '3.19.2' })
const ALL_FIELDS = { status: true, priority: true, estimate: true, due: true }

const MUTATIONS = {
  CREATE_ISSUE: 'PmkitCreateIssue', UPDATE_ISSUE: 'PmkitUpdateIssue', CLOSE_ISSUE: 'PmkitCloseIssue', REOPEN_ISSUE: 'PmkitReopenIssue',
  ADD_PROJECT_ITEM: 'PmkitAddProjectItem', SET_PROJECT_FIELD: 'PmkitSetProjectField', CLEAR_PROJECT_FIELD: 'PmkitClearProjectField',
  ARCHIVE_ITEM: 'PmkitArchiveItem', DELETE_ISSUE: 'PmkitDeleteIssue', ADD_BLOCKED_BY: 'PmkitAddBlockedBy', REMOVE_BLOCKED_BY: 'PmkitRemoveBlockedBy',
  UNMARK_DUPLICATE: 'PmkitUnmarkDuplicate', ADD_SUB_ISSUE: 'PmkitAddSubIssue', REMOVE_SUB_ISSUE: 'PmkitRemoveSubIssue', ADD_COMMENT: 'PmkitAddComment',
  CREATE_LINKED_BRANCH: 'PmkitCreateLinkedBranch',
}
const QUERIES = {
  ISSUE: 'PmkitIssue', ISSUES: 'PmkitIssues', TIMELINE: 'PmkitTimeline', TIMELINES: 'PmkitTimelines', COMMENTS: 'PmkitComments',
  BRANCH_HEAD: 'PmkitBranchHead', ASSIGNABLE_USERS: 'PmkitAssignableUsers',
}

test('hostFeatures per host', () => {
  assert.deepEqual(GITHUB, { issueFields: true, relatesTo: true, statusEvents: true })
  assert.deepEqual(hostFeatures({ host: 'acme.ghe.com', ghesVersion: null }), { issueFields: true, relatesTo: true, statusEvents: true })
  assert.deepEqual(hostFeatures({ host: 'git.acme.dev', ghesVersion: '3.21.0' }), { issueFields: true, relatesTo: false, statusEvents: true })
  assert.deepEqual(GHES, { issueFields: false, relatesTo: false, statusEvents: false })
})

for (const [label, features] of [['github.com', GITHUB], ['GHES 3.19', GHES]]) {
  test(`documents parse as one named operation on ${label}`, () => {
    const docs = issueDocuments(features, ALL_FIELDS)
    for (const [key, name] of Object.entries(QUERIES)) {
      assert.equal(operationName(docs[key]), name, key)
      assert.equal(isMutation(docs[key]), false, key)
      assert.match(docs[key], new RegExp(`^query ${name}\\(`), key)
    }
    for (const [key, name] of Object.entries(MUTATIONS)) {
      assert.equal(operationName(docs[key]), name, key)
      assert.equal(isMutation(docs[key]), true, key)
      assert.match(docs[key], new RegExp(`^mutation ${name}\\(\\$input: \\w+Input!`), key)
    }
    const connections = ['labels', 'subIssues', 'blockedBy', 'blocking', ...(features.relatesTo ? ['relatesTo'] : [])]
    for (const connection of connections) {
      assert.equal(operationName(docs.MORE(connection)), `PmkitIssueMore_${connection}`)
      assert.match(docs.MORE(connection), /^query /)
    }
    assert.throws(() => docs.MORE('nope'))
  })
}

test('GHES 3.19 has no relatesTo, issue fields or status events', () => {
  const docs = issueDocuments(GHES, ALL_FIELDS)
  for (const key of ['SET_ISSUE_FIELD', 'ADD_RELATES_TO', 'REMOVE_RELATES_TO']) assert.equal(docs[key], undefined, key)
  assert.doesNotMatch(docs.ISSUE, /relatesTo|issueFieldValues/)
  assert.equal(ITEM_TYPES(GHES).includes('PROJECT_V2_ITEM_STATUS_CHANGED_EVENT'), false)
  assert.throws(() => docs.MORE('relatesTo'))
})

test('github.com has the optional documents and fields', () => {
  const docs = issueDocuments(GITHUB, ALL_FIELDS)
  assert.equal(operationName(docs.SET_ISSUE_FIELD), 'PmkitSetIssueField')
  assert.equal(operationName(docs.ADD_RELATES_TO), 'PmkitAddRelatesTo')
  assert.equal(operationName(docs.REMOVE_RELATES_TO), 'PmkitRemoveRelatesTo')
  assert.equal(isMutation(docs.ADD_RELATES_TO), true)
  assert.match(docs.ISSUE, /relatesTo\(first: 50\)/)
  assert.match(docs.ISSUE, /issueFieldValues/)
  assert.ok(ITEM_TYPES(GITHUB).includes('PROJECT_V2_ITEM_STATUS_CHANGED_EVENT'))
  assert.ok(ITEM_TYPES(GHES).includes('BLOCKED_BY_ADDED_EVENT'))
})

test('a fragment never comes first', () => {
  const docs = issueDocuments(GITHUB, ALL_FIELDS)
  for (const [key, value] of Object.entries(docs)) {
    const document = typeof value === 'function' ? value('labels') : value
    assert.doesNotMatch(document, /^\s*fragment/, key)
    assert.match(document, /^(query|mutation) /, key)
  }
})

test('field variables follow the configured aliases', () => {
  const only = issueDocuments(GITHUB, { status: true })
  assert.match(only.ISSUE, /\$fStatus: String!/)
  assert.doesNotMatch(only.ISSUE, /\$fPriority|\$fEstimate|\$fDue/)
  assert.match(only.ISSUE, /status: fieldValueByName\(name: \$fStatus\)/)
  const all = issueDocuments(GITHUB, ALL_FIELDS)
  for (const name of ['fStatus', 'fPriority', 'fEstimate', 'fDue']) {
    assert.match(all.ISSUE, new RegExp(`\\$${name}: String!`))
    assert.match(all.ISSUES, new RegExp(`\\$${name}: String!`))
  }
  assert.match(all.ISSUE, /fPriority: fieldValueByName\(name: \$fPriority\)/)
  const none = issueDocuments(GITHUB, {})
  assert.doesNotMatch(none.ISSUE, /\$f[A-Z]|fieldValueByName/)
  assert.doesNotMatch(none.ISSUE, /\$fStatus/)
})

test('issue reads declare their variables and page', () => {
  const docs = issueDocuments(GITHUB, { status: true })
  assert.match(docs.ISSUE, /\$owner: String!, \$name: String!, \$number: Int!/)
  assert.match(docs.ISSUES, /\$first: Int!, \$after: String, \$filterBy: IssueFilters/)
  assert.match(docs.ISSUES, /orderBy: \{ field: CREATED_AT, direction: ASC \}/)
  assert.match(docs.ISSUES, /pageInfo \{ hasNextPage endCursor \}/)
  assert.match(docs.TIMELINE, /\$since: DateTime, \$itemTypes: \[IssueTimelineItemsItemType!\]/)
  assert.match(docs.TIMELINES, /\$ids: \[ID!\]!/)
  assert.match(docs.TIMELINES, /timelineItems\(first: 100/)
  assert.match(docs.BRANCH_HEAD, /\$qualifiedName: String!/)
  assert.match(docs.BRANCH_HEAD, /ref\(qualifiedName: \$qualifiedName\) \{ name target \{ oid \} \}/)
  assert.doesNotMatch(docs.BRANCH_HEAD, /defaultBranchRef/)
  assert.match(docs.ADD_COMMENT, /commentEdge \{ node \{ id author \{ login \} body createdAt \} \}/)
  assert.match(docs.UNMARK_DUPLICATE, /duplicate \{ \.\.\. on Issue \{ id number \} \}/)
  assert.match(docs.blockedByStatus ?? docs.ISSUE, /blockedBy\(first: 50\)[\s\S]*projectItems\(first: 20\)[\s\S]*status: fieldValueByName/)
})

test('timeline items carry typename and id', () => {
  const docs = issueDocuments(GITHUB, {})
  assert.match(docs.TIMELINE, /__typename/)
  assert.match(docs.TIMELINE, /\.\.\. on Node \{ id \}/)
  assert.match(docs.TIMELINE, /ProjectV2ItemStatusChangedEvent/)
  assert.doesNotMatch(issueDocuments(GHES, {}).TIMELINE, /ProjectV2ItemStatusChangedEvent/)
  assert.match(docs.TIMELINE, /RenamedTitleEvent[\s\S]*previousTitle currentTitle/)
})
