// GitHub milestones as pmkit milestones, and the document that reads them. Pure: no request is sent here.
// See docs/specs/2026-11-17-pmk-88-github-iterations-milestones-epics-design.md, "Milestones".

export const MILESTONES_QUERY = `query PmkitMilestones($owner: String!, $name: String!, $first: Int, $after: String) {
  repository(owner: $owner, name: $name) {
    milestones(first: $first, after: $after, states: [OPEN, CLOSED]) {
      nodes { id number title description dueOn state }
      pageInfo { hasNextPage endCursor }
    }
  }
}`

/**
 * The pmkit milestone of a GitHub milestone node. A milestone has no id but its title, so the title is both id and name. The node is
 * a GraphQL one (dueOn, state OPEN) or a REST answer (due_on, state open). `due` is the date part and `description` is left out when empty.
 */
export function toMilestone(node) {
  const due = node.dueOn ?? node.due_on ?? null
  const milestone = { id: node.title, name: node.title }
  if (due) milestone.due = due.slice(0, 10)
  if (node.description) milestone.description = node.description
  milestone.status = String(node.state).toLowerCase() === 'closed' ? 'closed' : 'open'
  return milestone
}

/** Every milestone node of the scope repository, open and closed. */
export async function readMilestoneNodes(client, repo) {
  const [owner, name] = repo.split('/')
  const { nodes } = await client.paginate(MILESTONES_QUERY, { owner, name }, { select: (data) => data.repository.milestones, pageSize: 100 })
  return nodes
}

// Epics: a GitHub Project linked to the repository, other than the scope Project. See the design, "Epics".

/** The Project statuses of a status update and the pmkit status each one reads as: [name, category]. */
export const STATUS_OF = {
  INACTIVE: ['Inactive', 'backlog'],
  ON_TRACK: ['On track', 'in_progress'],
  AT_RISK: ['At risk', 'in_progress'],
  OFF_TRACK: ['Off track', 'in_progress'],
  COMPLETE: ['Complete', 'done'],
}
const HEALTH_STATUSES = ['ON_TRACK', 'AT_RISK', 'OFF_TRACK']

const UPDATE_FIELDS = 'id status body startDate targetDate createdAt creator { login }'
const PAGE = 'pageInfo { hasNextPage endCursor }'
const PROJECT_FIELDS = 'id number title closed url shortDescription readme owner { ... on Organization { login } ... on User { login } }'

export const EPIC_QUERY = `query PmkitEpic($owner: String!, $number: Int!, $statusFirst: Int, $statusAfter: String) {
  repositoryOwner(login: $owner) {
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        ${PROJECT_FIELDS}
        statusUpdates(first: $statusFirst, after: $statusAfter, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { ${UPDATE_FIELDS} } ${PAGE} }
      }
    }
  }
}`

/** Up to 100 Projects by node id, each with its latest status update, in one read. nodes(ids:) answers the Node interface, so the fields sit in a fragment. */
export const EPICS_QUERY = `query PmkitEpics($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on ProjectV2 {
      ${PROJECT_FIELDS}
      statusUpdates(first: 1, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { ${UPDATE_FIELDS} } }
    }
  }
}`

export const STATUS_UPDATES_QUERY = `query PmkitStatusUpdates($project: ID!, $first: Int!, $after: String) {
  node(id: $project) {
    ... on ProjectV2 {
      statusUpdates(first: $first, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { ${UPDATE_FIELDS} } ${PAGE} }
    }
  }
}`

export const CREATE_PROJECT = `mutation PmkitCreateProject($input: CreateProjectV2Input!) {
  createProjectV2(input: $input) { projectV2 { id number } }
}`
export const UPDATE_PROJECT_README = `mutation PmkitUpdateProjectReadme($input: UpdateProjectV2Input!) {
  updateProjectV2(input: $input) { projectV2 { id } }
}`
export const SET_PROJECT_CLOSED = `mutation PmkitSetProjectClosed($input: UpdateProjectV2Input!) {
  updateProjectV2(input: $input) { projectV2 { id } }
}`
export const CREATE_STATUS_UPDATE = `mutation PmkitCreateStatusUpdate($input: CreateProjectV2StatusUpdateInput!) {
  createProjectV2StatusUpdate(input: $input) { statusUpdate { id } }
}`

/**
 * The items of a Project with the issue fragment, for the progress count. `fragment` is the PmkitIssueFields fragment of the issue
 * documents and `variables` are the names of the Project field variables it reads, such as fStatus.
 */
export const epicItemsQuery = (fragment, variables) => `query PmkitEpicItems(${['$project: ID!', '$first: Int!', '$after: String', ...variables.map((name) => `$${name}: String!`)].join(', ')}) {
  node(id: $project) {
    ... on ProjectV2 {
      items(first: $first, after: $after) { nodes { id isArchived content { __typename ... on Issue { ...PmkitIssueFields } } } ${PAGE} }
    }
  }
}
${fragment}`

/** The issues of a list of node ids with the issue fragment, in one read. The same field variables as epicItemsQuery. */
export const issueNodesQuery = (fragment, variables) => `query PmkitIssueNodes(${['$ids: [ID!]!', ...variables.map((name) => `$${name}: String!`)].join(', ')}) {
  nodes(ids: $ids) { __typename ... on Issue { ...PmkitIssueFields } }
}
${fragment}`

const EPIC_ID = /^[A-Za-z0-9-]+\/\d+$/

/** { owner, number } of an epic id such as acme/12, or null for any other text. */
export function parseEpicId(id) {
  if (typeof id !== 'string' || !EPIC_ID.test(id)) return null
  const [owner, number] = id.split('/')
  return { owner, number: Number(number) }
}

/** The linked epic of an id, { id, projectId } with the id as GitHub writes it, or null when the id is no epic id or names no linked epic. The owner matches in any case. */
export function epicOf(context, id) {
  if (parseEpicId(id) === null) return null
  for (const [projectId, written] of context.epics) if (written.toLowerCase() === id.toLowerCase()) return { id: written, projectId }
  return null
}

/**
 * The pmkit epic of a Project node and its latest status update (or none). The id is the owner as GitHub writes it and the number.
 * A closed Project reads as done and shows no health. start and target come from the latest update and stay out when null.
 */
export function toEpic(project, latest = null) {
  const known = latest ? STATUS_OF[latest.status] : undefined
  const [name, category] = project.closed ? ['Closed', 'done'] : (known ?? ['No update', 'todo'])
  const epic = { id: `${project.owner.login}/${project.number}`, title: project.title, status: { name, category } }
  if (latest?.startDate) epic.start = latest.startDate
  if (latest?.targetDate) epic.target = latest.targetDate
  epic.description = project.readme || project.shortDescription || ''
  if (!project.closed && HEALTH_STATUSES.includes(latest?.status)) epic.health = latest.status.toLowerCase()
  epic.url = project.url
  return epic
}

/** The pmkit status update of a status update node. INACTIVE and COMPLETE have no health and carry a status instead. */
export function toStatusUpdate(node, epicId) {
  const update = { epic: epicId, at: node.createdAt, author: node.creator?.login ?? '' }
  if (HEALTH_STATUSES.includes(node.status)) update.health = node.status.toLowerCase()
  else if (node.status) update.status = node.status.toLowerCase()
  update.body = node.body ?? ''
  return update
}
