// Every GraphQL document the GitHub issue operations send, built per host. Each document starts with its operation and
// puts fragments after it, because the fake GitHub API reads only the first definition.
import { compareVersions, hasIssueFields, needsVersionCheck } from './discovery.mjs'

/**
 * Which parts of the schema the host has: { issueFields, relatesTo, statusEvents, iterationIds }. github.com and GHE.com have all of them.
 * GHES has issue fields and Status events from 3.21 and never has relatesTo.
 */
export function hostFeatures({ host, ghesVersion }) {
  if (!needsVersionCheck(host)) return { issueFields: true, relatesTo: true, statusEvents: true, iterationIds: true }
  if (ghesVersion === null || ghesVersion === undefined) return { issueFields: true, relatesTo: true, statusEvents: true, iterationIds: false }
  const recent = hasIssueFields(ghesVersion) && compareVersions(ghesVersion, '3.21') >= 0
  return { issueFields: recent, relatesTo: false, statusEvents: recent, iterationIds: false }
}

const ITEM_TYPE_NAMES = [
  'ISSUE_COMMENT', 'RENAMED_TITLE_EVENT', 'ASSIGNED_EVENT', 'UNASSIGNED_EVENT', 'LABELED_EVENT', 'UNLABELED_EVENT', 'CLOSED_EVENT', 'REOPENED_EVENT',
  'ISSUE_TYPE_ADDED_EVENT', 'ISSUE_TYPE_CHANGED_EVENT', 'ISSUE_TYPE_REMOVED_EVENT', 'BLOCKED_BY_ADDED_EVENT', 'BLOCKED_BY_REMOVED_EVENT',
  'BLOCKING_ADDED_EVENT', 'BLOCKING_REMOVED_EVENT', 'PARENT_ISSUE_ADDED_EVENT', 'PARENT_ISSUE_REMOVED_EVENT', 'SUB_ISSUE_ADDED_EVENT',
  'SUB_ISSUE_REMOVED_EVENT', 'MARKED_AS_DUPLICATE_EVENT', 'UNMARKED_AS_DUPLICATE_EVENT', 'MILESTONED_EVENT', 'DEMILESTONED_EVENT',
]

/** The timeline item types of the history table; the Status change event only where the host has it. */
export const ITEM_TYPES = (features) => [...ITEM_TYPE_NAMES, ...(features.statusEvents ? ['PROJECT_V2_ITEM_STATUS_CHANGED_EVENT'] : [])]

const REPO = 'repository { nameWithOwner }'
const REF = `id number state stateReason ${REPO}`
const PAGE = 'pageInfo { hasNextPage endCursor }'

const PROJECT_VALUE = '{ __typename ... on ProjectV2ItemFieldSingleSelectValue { name optionId } ... on ProjectV2ItemFieldNumberValue { number } ... on ProjectV2ItemFieldDateValue { date } ... on ProjectV2ItemFieldIterationValue { iterationId title startDate duration } }'
const ISSUE_FIELD_FIELD = 'field { ... on IssueFieldSingleSelect { id name } ... on IssueFieldNumber { id name } ... on IssueFieldDate { id name } }'
const ISSUE_FIELD_VALUES = `issueFieldValues(first: 20) { nodes { __typename ... on IssueFieldSingleSelectValue { optionId name ${ISSUE_FIELD_FIELD} } ... on IssueFieldNumberValue { value ${ISSUE_FIELD_FIELD} } ... on IssueFieldDateValue { value ${ISSUE_FIELD_FIELD} } } ${PAGE} }`

// Variable and alias of each configured Project field. Values reach the document through variables, never literals.
const FIELD_ALIASES = [['status', 'status', 'fStatus'], ['priority', 'fPriority', 'fPriority'], ['estimate', 'fEstimate', 'fEstimate'], ['due', 'fDue', 'fDue'], ['sprint', 'fSprint', 'fSprint']]
const fieldAliases = (projectFields) => FIELD_ALIASES.filter(([key]) => projectFields?.[key])
const fieldVariables = (projectFields) => fieldAliases(projectFields).map(([, , variable]) => `$${variable}: String!`)
const fieldSelections = (projectFields) => fieldAliases(projectFields).map(([, alias, variable]) => `${alias}: fieldValueByName(name: $${variable}) ${PROJECT_VALUE}`).join(' ')
const statusSelection = (projectFields) => (projectFields?.status ? `projectItems(first: 20) { nodes { project { id } status: fieldValueByName(name: $fStatus) ${PROJECT_VALUE} } }` : '')

const declare = (...variables) => variables.flat().filter(Boolean).join(', ')

const AUTHOR = 'actor { login }'
const EVENT = (typename, fields) => `... on ${typename} { ${AUTHOR} createdAt ${fields} }`
const ISSUE_LINK = `number ${REPO}`
const NAMED_ISSUE = (field) => `${field} { ${ISSUE_LINK} }`

function timelineNodes(features) {
  const items = [
    '__typename ... on Node { id }',
    '... on IssueComment { id author { login } body createdAt }',
    EVENT('RenamedTitleEvent', 'previousTitle currentTitle'),
    ...['LabeledEvent', 'UnlabeledEvent'].map((name) => EVENT(name, 'label { name }')),
    ...['AssignedEvent', 'UnassignedEvent'].map((name) => EVENT(name, 'assignee { ... on User { login } }')),
    EVENT('ClosedEvent', 'stateReason'),
    EVENT('ReopenedEvent', ''),
    ...['BlockedByAddedEvent', 'BlockedByRemovedEvent'].map((name) => EVENT(name, NAMED_ISSUE('blockingIssue'))),
    ...['BlockingAddedEvent', 'BlockingRemovedEvent'].map((name) => EVENT(name, NAMED_ISSUE('blockedIssue'))),
    ...['ParentIssueAddedEvent', 'ParentIssueRemovedEvent'].map((name) => EVENT(name, NAMED_ISSUE('parent'))),
    ...['SubIssueAddedEvent', 'SubIssueRemovedEvent'].map((name) => EVENT(name, NAMED_ISSUE('subIssue'))),
    ...['MarkedAsDuplicateEvent', 'UnmarkedAsDuplicateEvent'].map((name) => EVENT(name, `canonical { ... on Issue { ${ISSUE_LINK} } }`)),
    ...['IssueTypeAddedEvent', 'IssueTypeRemovedEvent'].map((name) => EVENT(name, 'issueType { name }')),
    ...['MilestonedEvent', 'DemilestonedEvent'].map((name) => EVENT(name, 'milestoneTitle')),
    EVENT('IssueTypeChangedEvent', 'prevIssueType { name } issueType { name }'),
  ]
  if (features.statusEvents) items.push(EVENT('ProjectV2ItemStatusChangedEvent', 'previousStatus status project { id }'))
  return items.join(' ')
}

/** The documents of the issue operations for one host. projectFields says which Project field aliases the issue fragment carries. */
export function issueDocuments(features, projectFields = {}) {
  const vars = fieldVariables(projectFields)
  // The Status of each item, archived ones included as in the issue fragment, for the open issues a ReopenedEvent names.
  const metricStatus = projectFields?.status ? `projectItems(first: 20, includeArchived: true) { nodes { project { id } status: fieldValueByName(name: $fStatus) ${PROJECT_VALUE} } }` : ''
  const ITEM_SELECTION = `id isArchived project { id number owner { ... on Organization { login } ... on User { login } } } ${fieldSelections(projectFields)}`
  const fragment = `fragment PmkitIssueFields on Issue {
  id number title body state stateReason createdAt updatedAt url
  ${REPO}
  author { login }
  issueType { id name }
  assignees(first: 10) { nodes { id login } }
  labels(first: 50) { nodes { id name } pageInfo { hasNextPage } }
  milestone { id number title }
  parent { ${REF} }
  subIssues(first: 50) { nodes { ${REF} } pageInfo { hasNextPage } }
  blockedBy(first: 50) { nodes { ${REF} ${statusSelection(projectFields)} } pageInfo { hasNextPage } }
  blocking(first: 50) { nodes { ${REF} } pageInfo { hasNextPage } }
  duplicateOf { ${REF} }
${features.relatesTo ? `  relatesTo(first: 50) { nodes { ${REF} } pageInfo { hasNextPage } }\n` : ''}  linkedBranches(first: 5) { nodes { ref { name } } }
  projectItems(first: 20, includeArchived: true) { nodes { ${ITEM_SELECTION} } pageInfo { hasNextPage } }
${features.issueFields ? `  ${ISSUE_FIELD_VALUES}\n` : ''}}`

  const issueMutation = (name, type, payload, { withFragment = false } = {}) => `mutation ${name}(${declare('$input: ' + type + '!', withFragment ? vars : [])}) {
  ${payload(withFragment ? '...PmkitIssueFields' : 'id number')}
}${withFragment ? `\n${fragment}` : ''}`
  const simple = (name, type, payload) => `mutation ${name}($input: ${type}!) { ${payload} }`
  const returningIssue = (name, type, field) => issueMutation(name, type, (issue) => `${field}(input: $input) { issue { ${issue} } }`, { withFragment: true })
  const ids = '{ id number }'

  const MORE_SELECTIONS = {
    labels: 'id name',
    subIssues: REF,
    blockedBy: `${REF} ${statusSelection(projectFields)}`,
    blocking: REF,
    ...(features.relatesTo ? { relatesTo: REF } : {}),
    // The items of every Project the issue is in: the configured Project's item may come after the first page.
    projectItems: ITEM_SELECTION,
  }
  // The variables each connection's selection reads, past $id, $first and $after.
  const moreVariables = (connection) => {
    if (connection === 'projectItems') return vars
    return connection === 'blockedBy' && projectFields?.status ? '$fStatus: String!' : []
  }
  const MORE = (connection) => {
    if (!Object.hasOwn(MORE_SELECTIONS, connection)) throw new Error(`No further pages for the connection ${connection}`)
    const archived = connection === 'projectItems' ? ', includeArchived: true' : ''
    return `query PmkitIssueMore_${connection}(${declare('$id: ID!', '$first: Int!', '$after: String', moreVariables(connection))}) {
  node(id: $id) { ... on Issue { ${connection}(first: $first, after: $after${archived}) { nodes { ${MORE_SELECTIONS[connection]} } ${PAGE} } } }
}`
  }

  const timelineConnection = (first, after) => `timelineItems(first: ${first}, ${after}since: $since, itemTypes: $itemTypes) { nodes { ${timelineNodes(features)} } ${PAGE} }`
  const itemTypesVariable = '$itemTypes: [IssueTimelineItemsItemType!]'

  const documents = {
    ISSUE: `query PmkitIssue(${declare('$owner: String!', '$name: String!', '$number: Int!', vars)}) {
  repository(owner: $owner, name: $name) { issue(number: $number) { ...PmkitIssueFields } }
}
${fragment}`,
    ISSUES: `query PmkitIssues(${declare('$owner: String!', '$name: String!', '$first: Int!', '$after: String', '$filterBy: IssueFilters', '$orderBy: IssueOrder!', vars)}) {
  repository(owner: $owner, name: $name) {
    issues(first: $first, after: $after, filterBy: $filterBy, orderBy: $orderBy) { nodes { ...PmkitIssueFields } ${PAGE} }
  }
}
${fragment}`,
    // The issue read of metricEvents: only what toEvents reads, so a read of up to 1000 issues stays small.
    METRIC_ISSUES: `query PmkitMetricIssues(${declare('$owner: String!', '$name: String!', '$first: Int!', '$after: String', '$filterBy: IssueFilters', '$orderBy: IssueOrder!', projectFields?.status ? '$fStatus: String!' : [])}) {
  repository(owner: $owner, name: $name) {
    issues(first: $first, after: $after, filterBy: $filterBy, orderBy: $orderBy) { nodes { id number title state stateReason createdAt ${REPO} author { login } ${metricStatus} } ${PAGE} }
  }
}`,
    MORE,
    TIMELINE: `query PmkitTimeline($id: ID!, $first: Int!, $after: String, $since: DateTime, ${itemTypesVariable}) {
  node(id: $id) { ... on Issue { ${timelineConnection('$first', 'after: $after, ')} } }
}`,
    TIMELINES: `query PmkitTimelines($ids: [ID!]!, $since: DateTime, ${itemTypesVariable}) {
  nodes(ids: $ids) { ... on Issue { id number ${REPO} ${timelineConnection(100, '')} } }
}`,
    COMMENTS: `query PmkitComments($id: ID!, $first: Int!, $after: String) {
  node(id: $id) { ... on Issue { comments(first: $first, after: $after) { nodes { id author { login } body createdAt isMinimized minimizedReason } ${PAGE} } } }
}`,
    BRANCH_HEAD: `query PmkitBranchHead($owner: String!, $name: String!, $qualifiedName: String!) {
  repository(owner: $owner, name: $name) { id ref(qualifiedName: $qualifiedName) { name target { oid } } }
}`,
    ASSIGNABLE_USERS: `query PmkitAssignableUsers($owner: String!, $name: String!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) { assignableUsers(first: $first, after: $after) { nodes { id login name } ${PAGE} } }
}`,
    CREATE_ISSUE: returningIssue('PmkitCreateIssue', 'CreateIssueInput', 'createIssue'),
    UPDATE_ISSUE: returningIssue('PmkitUpdateIssue', 'UpdateIssueInput', 'updateIssue'),
    CLOSE_ISSUE: returningIssue('PmkitCloseIssue', 'CloseIssueInput', 'closeIssue'),
    REOPEN_ISSUE: returningIssue('PmkitReopenIssue', 'ReopenIssueInput', 'reopenIssue'),
    ADD_PROJECT_ITEM: simple('PmkitAddProjectItem', 'AddProjectV2ItemByIdInput', 'addProjectV2ItemById(input: $input) { item { id } }'),
    SET_PROJECT_FIELD: simple('PmkitSetProjectField', 'UpdateProjectV2ItemFieldValueInput', 'updateProjectV2ItemFieldValue(input: $input) { projectV2Item { id } }'),
    CLEAR_PROJECT_FIELD: simple('PmkitClearProjectField', 'ClearProjectV2ItemFieldValueInput', 'clearProjectV2ItemFieldValue(input: $input) { projectV2Item { id } }'),
    ADD_LABELS: simple('PmkitAddLabels', 'AddLabelsToLabelableInput', 'addLabelsToLabelable(input: $input) { clientMutationId }'),
    REMOVE_LABELS: simple('PmkitRemoveLabels', 'RemoveLabelsFromLabelableInput', 'removeLabelsFromLabelable(input: $input) { clientMutationId }'),
    DELETE_PROJECT_ITEM: simple('PmkitDeleteProjectItem', 'DeleteProjectV2ItemInput', 'deleteProjectV2Item(input: $input) { deletedItemId }'),
    ARCHIVE_ITEM: simple('PmkitArchiveItem', 'ArchiveProjectV2ItemInput', 'archiveProjectV2Item(input: $input) { item { id } }'),
    DELETE_ISSUE: simple('PmkitDeleteIssue', 'DeleteIssueInput', 'deleteIssue(input: $input) { repository { id } }'),
    ADD_BLOCKED_BY: simple('PmkitAddBlockedBy', 'AddBlockedByInput', `addBlockedBy(input: $input) { issue ${ids} blockingIssue ${ids} }`),
    REMOVE_BLOCKED_BY: simple('PmkitRemoveBlockedBy', 'RemoveBlockedByInput', `removeBlockedBy(input: $input) { issue ${ids} blockingIssue ${ids} }`),
    UNMARK_DUPLICATE: simple('PmkitUnmarkDuplicate', 'UnmarkIssueAsDuplicateInput', 'unmarkIssueAsDuplicate(input: $input) { duplicate { ... on Issue { id number } } }'),
    ADD_SUB_ISSUE: simple('PmkitAddSubIssue', 'AddSubIssueInput', `addSubIssue(input: $input) { issue ${ids} subIssue ${ids} }`),
    REMOVE_SUB_ISSUE: simple('PmkitRemoveSubIssue', 'RemoveSubIssueInput', `removeSubIssue(input: $input) { issue ${ids} subIssue ${ids} }`),
    ADD_COMMENT: simple('PmkitAddComment', 'AddCommentInput', 'addComment(input: $input) { commentEdge { node { id author { login } body createdAt } } }'),
    CREATE_LINKED_BRANCH: simple('PmkitCreateLinkedBranch', 'CreateLinkedBranchInput', 'createLinkedBranch(input: $input) { linkedBranch { ref { name } } }'),
  }
  if (features.issueFields) documents.SET_ISSUE_FIELD = simple('PmkitSetIssueField', 'SetIssueFieldValueInput', `setIssueFieldValue(input: $input) { issue ${ids} }`)
  if (features.relatesTo) {
    documents.ADD_RELATES_TO = simple('PmkitAddRelatesTo', 'AddRelatesToInput', `addRelatesTo(input: $input) { issue ${ids} relatedIssue ${ids} }`)
    documents.REMOVE_RELATES_TO = simple('PmkitRemoveRelatesTo', 'RemoveRelatesToInput', `removeRelatesTo(input: $input) { issue ${ids} relatedIssue ${ids} }`)
  }
  return documents
}
