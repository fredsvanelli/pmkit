// Reads one Linear team as a migration snapshot, from bulk reads only. See the PMK-41 spec, "The snapshot".

import { CYCLES_QUERY, ISSUE_COMMENTS_QUERY, ISSUE_EVENTS_QUERY, ISSUE_HISTORY_QUERY, NESTED_PAGES, NESTED_PAGE_SIZE } from './documents.mjs'
import { toEvents } from './history.mjs'
import { makeContext, toIssue } from './issues.mjs'
import { HEALTH_FROM_LINEAR, PROJECTS_QUERY, PROJECT_UPDATES_QUERY, toEpic } from './projects.mjs'
import { toSprint } from './cycles.mjs'

const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')
const LINK_TYPES = ['blocks', 'related', 'duplicate']
const DISCOVERY_REQUESTS = 8
const PROJECT_PAGE = 10

/** A client that counts the requests it sends, pages included. */
function counting(client) {
  const counter = { count: 0 }
  counter.client = {
    request: (...args) => {
      counter.count++
      return client.request(...args)
    },
    paginate: (document, variables, options) => client.paginate(document, variables, {
      ...options,
      select: (data) => {
        counter.count++
        return options.select(data)
      },
    }),
    session: client.session,
    rateLimit: client.rateLimit,
  }
  return counter
}

export async function readLinearSnapshot({ client: given, discovery, teamKey, pmkit, now = () => new Date() }) {
  const counter = counting(given)
  const client = counter.client
  const found = await discovery({ refresh: true })
  const raw = found.raw ?? found
  const session = await given.session()
  const scoped = { ...pmkit, tracker: { ...pmkit.tracker, scope: { ...pmkit.tracker?.scope, team: teamKey } } }
  const context = makeContext(raw, scoped, session.viewer)

  const { nodes: all } = await client.paginate(ISSUE_EVENTS_QUERY, { filter: { team: { key: { eq: teamKey } } }, includeArchived: true }, {
    select: (data) => data.issues, pageSize: 100, maxPages: 100000,
  })
  const nodes = all.filter((node) => node.trashed !== true)
  for (const node of nodes) {
    for (const field of Object.keys(NESTED_PAGES)) {
      if (node[field]?.pageInfo?.hasNextPage !== true) continue
      const page = await client.paginate(NESTED_PAGES[field], { id: node.id }, { select: (data) => data.issue[field], pageSize: NESTED_PAGE_SIZE, maxPages: 100000 })
      node[field] = { nodes: page.nodes, pageInfo: { hasNextPage: false, endCursor: null } }
    }
    // The first page came with the issue, so only the pages after it are read.
    for (const [field, document] of [['history', ISSUE_HISTORY_QUERY], ['comments', ISSUE_COMMENTS_QUERY]]) {
      let page = node[field]
      const collected = [...(page?.nodes ?? [])]
      while (page?.pageInfo?.hasNextPage === true) {
        page = (await client.request(document, { id: node.id, first: 50, after: page.pageInfo.endCursor })).issue[field]
        collected.push(...page.nodes)
      }
      node[field] = { nodes: collected }
    }
  }
  const inTeam = new Set(nodes.map((node) => node.identifier))
  const outside = { parents: 0, links: 0 }

  const issues = nodes.map((node) => {
    const issue = toIssue(node, context)
    const events = toEvents({ node, origin: { creator: node.creator, botActor: node.botActor }, entries: node.history?.nodes ?? [], comments: node.comments?.nodes ?? [] }, context)
    let parent = issue.parent ?? null
    if (node.parent?.identifier && !inTeam.has(node.parent.identifier)) {
      outside.parents++
      parent = node.project ? toEpic({ ...node.project, name: '', status: { name: '', type: 'backlog' } }).id : null
    }
    return {
      id: node.identifier, uuid: node.id, title: issue.title, type: issue.type ?? null, status: issue.status, priority: issue.priority ?? null,
      estimate: issue.estimate ?? null, assignee: issue.assignee ?? null, labels: issue.labels, labelGroups: (node.labels?.nodes ?? []).filter((label) => label.parent).map((label) => label.name),
      parent, sprint: issue.sprint ?? null, milestone: issue.milestone ?? null, release: null, due: issue.due ?? null, branch: issue.branch ?? null,
      description: issue.description, acceptanceCriteria: issue.acceptanceCriteria, archived: issue.archived, created: issue.created,
      completed: node.completedAt ?? null, events,
    }
  })

  const links = []
  for (const node of nodes) {
    for (const relation of node.relations?.nodes ?? []) {
      if (!LINK_TYPES.includes(relation.type)) continue
      if (!inTeam.has(relation.relatedIssue.identifier)) {
        outside.links++
        continue
      }
      links.push({ kind: relation.type, from: node.identifier, to: relation.relatedIssue.identifier })
    }
    for (const relation of node.inverseRelations?.nodes ?? []) {
      if (LINK_TYPES.includes(relation.type) && !inTeam.has(relation.issue.identifier)) outside.links++
    }
  }
  links.sort((a, b) => (`${a.kind} ${a.from} ${a.to}` < `${b.kind} ${b.from} ${b.to}` ? -1 : 1))

  const comments = nodes.flatMap((node) => (node.comments?.nodes ?? []).map((comment) => ({
    id: comment.id, issue: node.identifier, author: comment.user?.id ?? comment.botActor?.name ?? comment.externalUser?.id ?? null,
    created: comment.createdAt, body: comment.body ?? '', parent: comment.parentId ?? null, resolved: Boolean(comment.resolvedAt),
  })))

  // With the milestone and document lists of 50 each, a page of 50 projects went over Linear's limit of 10000 complexity
  // points (Linear answered 17420). A page of 10 costs about 3500 points if cost scales with page size.
  const { nodes: projectNodes } = await client.paginate(PROJECTS_QUERY, { filter: { accessibleTeams: { some: { key: { eq: teamKey } } } }, withLists: true }, {
    select: (data) => data.projects, pageSize: PROJECT_PAGE, maxPages: 100000,
  })
  const epics = []
  for (const node of projectNodes) {
    const epic = toEpic(node)
    const { nodes: updates } = await client.paginate(PROJECT_UPDATES_QUERY, { id: node.id }, { select: (data) => data.project.projectUpdates, pageSize: 50, maxPages: 100000 })
    epics.push({
      id: epic.id, uuid: node.id, title: epic.title, status: epic.status, start: epic.start ?? null, target: epic.target ?? null, milestone: null,
      description: node.content ?? node.description ?? '', created: node.createdAt ?? null,
      milestones: node.projectMilestones?.nodes?.length ?? 0, documents: node.documents?.nodes?.length ?? 0,
      updates: updates.map((update) => ({ id: update.id, at: update.createdAt, author: update.user?.id ?? null, health: HEALTH_FROM_LINEAR[update.health] ?? 'on_track', body: update.body ?? '' }))
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)),
    })
  }

  const team = raw.teams.find((item) => item.key === teamKey)
  const sprints = []
  if (team?.cyclesEnabled) {
    const { nodes: cycles } = await client.paginate(CYCLES_QUERY, { filter: { team: { key: { eq: teamKey } } } }, { select: (data) => data.cycles, pageSize: 50, maxPages: 100000 })
    for (const node of cycles) {
      const sprint = toSprint(node)
      sprints.push({ id: sprint.id, uuid: node.id, name: sprint.name, start: sprint.start, end: sprint.end, goal: sprint.goal, state: sprint.state, closed: sprint.closed ?? null })
    }
  }

  const snapshot = {
    system: 'linear',
    scope: { workspace: raw.workspace.urlKey, team: teamKey },
    read: isoSeconds(now()),
    people: raw.users.map((user) => ({ id: user.id, name: user.name, email: user.email, app: user.app })),
    labels: [...new Set(issues.flatMap((issue) => issue.labels))].sort(),
    epics,
    sprints,
    issues,
    links,
    comments,
    outside,
  }
  // The session and the seven discovery reads come first.
  return { snapshot, readRequests: counter.count + DISCOVERY_REQUESTS }
}
