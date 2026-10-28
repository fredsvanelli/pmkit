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
  team { id key } state { id name type } assignee { id } parent { identifier } project { id slugId identifier } projectMilestone { id }
  cycle { id number }
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

// PMK-36: history and comments, added after the PMK-35 documents.
const HISTORY_PAGE = 50

/** The fields of one IssueHistory entry. */
export const HISTORY_FIELDS = `createdAt actor { id } botActor { type name } autoClosed autoArchived archived updatedDescription
    fromState { id name type } toState { id name type } fromAssigneeId toAssigneeId fromTitle toTitle fromPriority toPriority
    fromEstimate toEstimate fromDueDate toDueDate
    addedLabels { id name parent { name } } removedLabels { id name parent { name } } addedLabelIds removedLabelIds
    fromParent { identifier } toParent { identifier } relationChanges { identifier type }
    fromCycle { number } toCycle { number } fromProject { id slugId identifier } toProject { id slugId identifier }
    fromProjectMilestone { id } toProjectMilestone { id }`

/** The fields of one comment. */
export const COMMENT_FIELDS = 'id createdAt body user { id } botActor { type name } externalUser { id } parentId resolvedAt resolvingUser { id }'

export const ISSUE_HISTORY_QUERY = `query PmkitIssueHistory($id: String!, $first: Int!, $after: String) {
  issue(id: $id) { creator { id } botActor { type name } history(first: $first, after: $after) { nodes { ${HISTORY_FIELDS} } ${PAGE_INFO} } }
}`

export const ISSUE_COMMENTS_QUERY = `query PmkitIssueComments($id: String!, $first: Int!, $after: String) {
  issue(id: $id) { comments(first: $first, after: $after) { nodes { ${COMMENT_FIELDS} } ${PAGE_INFO} } }
}`

// Read through the comments filter, not comment(id): Linear answers an unknown comment with an error, which the client reports as UPSTREAM.
export const COMMENT_BY_ID_QUERY = `query PmkitCommentById($id: ID!) {
  comments(filter: { id: { eq: $id } }, first: 1) { nodes { ${COMMENT_FIELDS} issue { identifier } } }
}`

export const COMMENT_CREATE = `mutation PmkitCommentCreate($input: CommentCreateInput!) {
  commentCreate(input: $input) { success comment { ${COMMENT_FIELDS} issue { identifier } } }
}`

export const COMMENT_RESOLVE = `mutation PmkitCommentResolve($id: String!) {
  commentResolve(id: $id) { success comment { ${COMMENT_FIELDS} issue { identifier } } }
}`

export const ISSUE_EVENTS_QUERY = `${ISSUE_FRAGMENT}
query PmkitIssueEvents($filter: IssueFilter, $first: Int!, $after: String, $includeArchived: Boolean, $sort: [IssueSortInput!]) {
  issues(filter: $filter, first: $first, after: $after, includeArchived: $includeArchived, sort: $sort) {
    nodes {
      ...PmkitIssueFields creator { id } botActor { type name }
      history(first: ${HISTORY_PAGE}) { nodes { ${HISTORY_FIELDS} } ${PAGE_INFO} }
      comments(first: ${HISTORY_PAGE}) { nodes { ${COMMENT_FIELDS} } ${PAGE_INFO} }
    }
    ${PAGE_INFO}
  }
}`

const CYCLE_FIELDS = 'id number name description startsAt endsAt completedAt isActive isFuture isPast'

export const CYCLES_QUERY = `query PmkitCycles($filter: CycleFilter, $first: Int!, $after: String) {
  cycles(filter: $filter, first: $first, after: $after) { nodes { ${CYCLE_FIELDS} } ${PAGE_INFO} }
}`

export const CYCLE_BY_NUMBER_QUERY = `query PmkitCycleByNumber($filter: CycleFilter) {
  cycles(filter: $filter, first: 1) { nodes { ${CYCLE_FIELDS} } }
}`

// PMK-41: the reads by UUID that tell a migration rerun which creates happened, and the creates and deletes no other command sends.

export const ISSUES_BY_IDS = `query PmkitIssuesByIds($ids: [ID!]) {
  issues(filter: { id: { in: $ids } }, includeArchived: true, first: 100) { nodes { id identifier updatedAt archivedAt trashed relations(first: ${NESTED}) { nodes { id } } } }
}`

export const COMMENTS_BY_IDS = `query PmkitCommentsByIds($ids: [ID!]) {
  comments(filter: { id: { in: $ids } }, first: 100) { nodes { id resolvedAt } }
}`

export const LABEL_CREATE = `mutation PmkitLabelCreate($input: IssueLabelCreateInput!) {
  issueLabelCreate(input: $input) { success issueLabel { id name } }
}`

export const LABEL_DELETE = 'mutation PmkitLabelDelete($id: String!) { issueLabelDelete(id: $id) { success } }'

// Without permanentlyDelete, Linear moves the issue to its trash.
export const ISSUE_DELETE = 'mutation PmkitIssueDelete($id: String!) { issueDelete(id: $id) { success } }'
