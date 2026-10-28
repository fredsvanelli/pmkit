// The GraphQL documents of the issue and relation operations. Every document has a name, and the fake routes by it.
// A document that selects issue fields starts with the fragment, which operationName skips.

const NESTED = 50

// The fields of each node in the issue's nested connections, shared with the documents that read their later pages.
const NODE_FIELDS = {
  labels: 'id name parent { name }',
  children: 'identifier',
  relations: 'id type relatedIssue { identifier state { id type } }',
  inverseRelations: 'id type issue { identifier state { id type } }',
}
const PAGE_INFO = 'pageInfo { hasNextPage endCursor }'

export const ISSUE_FRAGMENT = `fragment PmkitIssueFields on Issue {
  id identifier title description priority estimate dueDate branchName archivedAt trashed createdAt updatedAt
  team { id key } state { id name type } assignee { id } parent { identifier }
${Object.entries(NODE_FIELDS).map(([field, fields]) => `  ${field}(first: ${NESTED}) { nodes { ${fields} } ${PAGE_INFO} }`).join('\n')}
}`

export const ISSUES_QUERY = `${ISSUE_FRAGMENT}
query PmkitIssues($filter: IssueFilter, $first: Int!, $after: String, $includeArchived: Boolean, $sort: [IssueSortInput!]) {
  issues(filter: $filter, first: $first, after: $after, includeArchived: $includeArchived, sort: $sort) { nodes { ...PmkitIssueFields } ${PAGE_INFO} }
}`

export const ISSUE_BY_ID_QUERY = `${ISSUE_FRAGMENT}
query PmkitIssueById($id: ID!) {
  issues(filter: { id: { eq: $id } }, includeArchived: true, first: 1) { nodes { ...PmkitIssueFields } }
}`

export const ISSUE_CREATE = `${ISSUE_FRAGMENT}
mutation PmkitIssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { ...PmkitIssueFields } }
}`

export const ISSUE_UPDATE = `${ISSUE_FRAGMENT}
mutation PmkitIssueUpdate($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { success issue { ...PmkitIssueFields } }
}`

export const ISSUE_ARCHIVE = 'mutation PmkitIssueArchive($id: String!) { issueArchive(id: $id) { success } }'

export const RELATION_CREATE = 'mutation PmkitRelationCreate($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success issueRelation { id } } }'

export const RELATION_DELETE = 'mutation PmkitRelationDelete($id: String!) { issueRelationDelete(id: $id) { success } }'

export const BLOCK_GRAPH_QUERY = `query PmkitBlockGraph($ids: [ID!]) {
  issues(filter: { id: { in: $ids } }, includeArchived: true, first: 250) { nodes { identifier relations(first: ${NESTED}) { nodes { type relatedIssue { identifier } } } } }
}`

export const PARENT_CHAIN_DEPTH = 10
const chain = (depth) => (depth === 0 ? '' : ` parent { identifier${chain(depth - 1)} }`)

export const PARENT_CHAIN_QUERY = `query PmkitParentChain($id: ID!) {
  issues(filter: { id: { eq: $id } }, includeArchived: true, first: 1) { nodes { identifier${chain(PARENT_CHAIN_DEPTH)} } }
}`

const pageName = (field) => `PmkitIssue${field[0].toUpperCase()}${field.slice(1)}Page`

/** One document per nested connection, which reads the pages after the first for one issue. */
export const NESTED_PAGES = Object.fromEntries(
  Object.entries(NODE_FIELDS).map(([field, fields]) => [
    field,
    `query ${pageName(field)}($id: String!, $first: Int!, $after: String) { issue(id: $id) { ${field}(first: $first, after: $after) { nodes { ${fields} } ${PAGE_INFO} } } }`,
  ]),
)
export const NESTED_PAGE_SIZE = NESTED
