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
