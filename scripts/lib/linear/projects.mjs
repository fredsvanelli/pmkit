// A Linear project as a pmkit epic, plus its updates, milestones and documents. Pure: no request is made here.
// See docs/superpowers/specs/2026-10-28-pmk-38-linear-projects-as-epics-design.md, "Epic shape".

/** The pmkit category of each Linear project status type. A paused project counts as backlog. */
export const STATUS_CATEGORY = Object.freeze({
  backlog: 'backlog',
  planned: 'todo',
  started: 'in_progress',
  completed: 'done',
  canceled: 'canceled',
  paused: 'backlog',
})

export const HEALTH_FROM_LINEAR = Object.freeze({ onTrack: 'on_track', atRisk: 'at_risk', offTrack: 'off_track' })
export const HEALTH_TO_LINEAR = Object.freeze(Object.fromEntries(Object.entries(HEALTH_FROM_LINEAR).map(([linear, health]) => [health, linear])))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG = /^[0-9a-f]{12}$/i
const IDENTIFIER = /^[a-z]-[a-z0-9]+-[0-9]+$/i

/** Classifies an epic key as the identifier (upper case), the slug (lower case), the UUID or something else, which no project has. */
export function epicKey(input) {
  if (typeof input !== 'string') return { kind: 'other', value: input }
  if (UUID.test(input)) return { kind: 'uuid', value: input.toLowerCase() }
  if (SLUG.test(input)) return { kind: 'slug', value: input.toLowerCase() }
  if (IDENTIFIER.test(input)) return { kind: 'identifier', value: input.toUpperCase() }
  return { kind: 'other', value: input }
}

/** The canonical epic id of a project node: the identifier in upper case, or the slug in lower case when it has none. */
export const epicId = (node) => (node.identifier ? node.identifier.toUpperCase() : node.slugId.toLowerCase())

const nodesOf = (connection) => connection?.nodes ?? []
const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null && value !== undefined))

/** The pmkit epic of a project node. Unset fields are absent keys. */
export function toEpic(node) {
  const epic = { id: epicId(node), title: node.name }
  epic.status = { name: node.status.name, category: STATUS_CATEGORY[node.status.type] ?? 'backlog' }
  if (node.startDate) epic.start = node.startDate
  if (node.targetDate) epic.target = node.targetDate
  const description = node.content || node.description
  if (description) epic.description = description
  const health = HEALTH_FROM_LINEAR[node.health]
  if (health) epic.health = health
  if (typeof node.progress === 'number') epic.progress = node.progress
  if (node.url) epic.url = node.url
  if (node.projectMilestones) {
    epic.milestones = nodesOf(node.projectMilestones).map((item) => compact({ id: item.id, name: item.name, due: item.targetDate, status: item.status }))
    if (node.projectMilestones.pageInfo?.hasNextPage === true) epic.milestonesMore = true
  }
  if (node.documents) {
    epic.documents = nodesOf(node.documents).map((item) => ({ path: item.slugId, title: item.title }))
    if (node.documents.pageInfo?.hasNextPage === true) epic.documentsMore = true
  }
  return epic
}

/** The pmkit status update of a project update node. `project` is the node's own, or the one passed in. */
export function toStatusUpdate(node, project = node.project) {
  return { epic: epicId(project), at: node.createdAt, author: node.user?.id, health: HEALTH_FROM_LINEAR[node.health], body: node.body }
}

/** The pmkit milestone of a project milestone node. The id is Linear's UUID, and `epic` is the canonical id of its project. */
export function toMilestone(node) {
  return compact({
    id: node.id,
    name: node.name,
    due: node.targetDate,
    description: node.description || null,
    epic: node.project ? epicId(node.project) : null,
    status: node.status,
    progress: node.progress,
  })
}

/** The pmkit document of a Linear document node. The path is the slug, since Linear documents have no path. */
export const toDocument = (node) => ({ path: node.slugId, title: node.title, body: node.content ?? '' })

// The GraphQL documents. Every one has a name, and the fake routes by it.

const PAGE_INFO = 'pageInfo { hasNextPage endCursor }'
const PROJECT_REF = 'project { id slugId identifier }'
export const LIST_SIZE = 50

const PROJECT_FRAGMENT = `fragment PmkitProjectFields on Project {
  id slugId identifier name description content health progress scope url startDate targetDate createdAt
  status { id name type }
}`

const LISTS = `projectMilestones(first: ${LIST_SIZE}) @include(if: $withLists) { nodes { id name targetDate status } ${PAGE_INFO} }
    documents(first: ${LIST_SIZE}) @include(if: $withLists) { nodes { slugId title } ${PAGE_INFO} }`

/** Projects by filter. `$withLists` adds the first milestones and documents of each project, for a read of one. */
export const PROJECTS_QUERY = `${PROJECT_FRAGMENT}
query PmkitProjects($filter: ProjectFilter, $first: Int!, $after: String, $withLists: Boolean!) {
  projects(filter: $filter, first: $first, after: $after) { nodes { ...PmkitProjectFields
    ${LISTS}
  } ${PAGE_INFO} }
}`

export const PROJECT_CREATE = `${PROJECT_FRAGMENT}
mutation PmkitProjectCreate($input: ProjectCreateInput!) {
  projectCreate(input: $input) { success project { ...PmkitProjectFields } }
}`

const UPDATE_FIELDS = `id body health createdAt user { id } ${PROJECT_REF}`

export const PROJECT_UPDATE_CREATE = `mutation PmkitProjectUpdateCreate($input: ProjectUpdateCreateInput!) {
  projectUpdateCreate(input: $input) { success projectUpdate { ${UPDATE_FIELDS} } }
}`

export const PROJECT_UPDATES_QUERY = `query PmkitProjectUpdates($id: String!, $first: Int!, $after: String) {
  project(id: $id) { projectUpdates(first: $first, after: $after) { nodes { ${UPDATE_FIELDS} } ${PAGE_INFO} } }
}`

const MILESTONE_FIELDS = `id name description targetDate status progress ${PROJECT_REF}`

export const PROJECT_MILESTONES_QUERY = `query PmkitProjectMilestones($first: Int!, $after: String) {
  projectMilestones(first: $first, after: $after) { nodes { ${MILESTONE_FIELDS} } ${PAGE_INFO} }
}`

export const PROJECT_MILESTONE_QUERY = `query PmkitProjectMilestone($id: String!) {
  projectMilestone(id: $id) { ${MILESTONE_FIELDS} }
}`

export const DOCUMENT_QUERY = `query PmkitDocument($filter: DocumentFilter) {
  documents(filter: $filter, first: 1) { nodes { id slugId title content ${PROJECT_REF} } }
}`

/** The minimal fields progress counts: the state type for the category, the estimate and the parent for the chain. */
export const EPIC_ISSUES_QUERY = `query PmkitEpicIssues($filter: IssueFilter, $first: Int!, $after: String) {
  issues(filter: $filter, first: $first, after: $after) { nodes { identifier archivedAt estimate team { id } state { id type } parent { identifier } } ${PAGE_INFO} }
}`
