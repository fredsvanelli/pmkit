// Reads a Local tracker as a migration snapshot, through the tracker's own reads. Sends no request and writes nothing.
// See the PMK-41 spec, "The snapshot".

import fs from 'node:fs'
import path from 'node:path'
import { TERMINAL } from '../model.mjs'
import { localLinks } from '../migrate/snapshot.mjs'
import { parseUpdateFile, sortUpdates } from './epics.mjs'
import { readEvents } from './events.mjs'
import { issuePaths } from './store.mjs'
import { createLocalTracker } from './tracker.mjs'

const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')

function readUpdates(dir, epic) {
  const updates = path.join(dir, 'updates')
  if (!fs.existsSync(updates)) return []
  const entries = fs.readdirSync(updates)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ name, update: parseUpdateFile(fs.readFileSync(path.join(updates, name), 'utf8'), epic) }))
  // Oldest first, the order the updates were published in.
  return sortUpdates(entries).reverse().map(({ name, update }) => ({
    id: `${epic}/${name.slice(0, -3)}`, at: update.at, author: update.author, health: update.health, body: update.body,
  }))
}

const countFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((name) => !String(name).split(path.sep).pop().startsWith('.') && fs.statSync(path.join(dir, String(name))).isFile()).length : 0)

export function readLocalSnapshot({ root, config, tracker, commit = null, now = () => new Date() }) {
  const local = tracker ?? createLocalTracker(root, { config, now, index: false })
  const issuesDir = config.readDir ?? config.issuesDir
  const categoryOf = (name) => config.local.statuses[name]?.category ?? null
  const issues = local.searchIssues({ archived: true }).issues
  let timeLogs = 0

  const snapshotIssues = issues.map((issue) => {
    const { events } = readEvents(issuePaths(issuesDir, issue.id).events)
    timeLogs += events.filter((event) => event.op === 'log_time').length
    const moves = events.filter((event) => event.op === 'move' && TERMINAL.includes(categoryOf(event.to)))
    return {
      id: issue.id,
      title: issue.title,
      type: issue.type ?? null,
      status: issue.status,
      priority: issue.priority ?? null,
      estimate: issue.estimate ?? null,
      assignee: issue.assignee ?? null,
      labels: issue.labels ?? [],
      parent: issue.parent ?? null,
      sprint: issue.sprint ?? null,
      milestone: issue.milestone ?? null,
      release: issue.release ?? null,
      due: issue.due ?? null,
      branch: issue.branch ?? null,
      description: issue.description ?? '',
      acceptanceCriteria: issue.acceptanceCriteria ?? [],
      archived: Boolean(issue.archived),
      created: issue.created,
      completed: TERMINAL.includes(issue.status.category) && moves.length > 0 ? moves[moves.length - 1].at : null,
    }
  })

  const comments = issues.flatMap((issue) => local.listComments(issue.id).map((comment) => ({
    id: `${issue.id}/${comment.id}`,
    issue: issue.id,
    author: comment.author,
    created: comment.created,
    body: comment.body,
    parent: comment.parent === undefined ? null : `${issue.id}/${comment.parent}`,
    resolved: Boolean(comment.resolved),
  })))

  const epics = local.listDeliverables().map((epic) => {
    const dir = path.join(issuesDir, 'epics', epic.id)
    const created = readEvents(path.join(dir, 'events.jsonl')).events.find((event) => event.op === 'create')?.at ?? null
    return {
      id: epic.id,
      title: epic.title,
      status: epic.status,
      start: epic.start ?? null,
      target: epic.target ?? null,
      milestone: epic.milestone ?? null,
      description: epic.description ?? '',
      created,
      updates: readUpdates(dir, epic.id),
    }
  })

  const sprints = local.listCycles().map((sprint) => ({
    id: sprint.id, name: sprint.name, start: sprint.start, end: sprint.end, goal: sprint.goal ?? '', state: sprint.state, closed: sprint.closed ?? null,
  }))

  const people = Object.keys(config.local.members).sort().map((id) => ({
    id, name: config.local.members[id].name, email: config.local.members[id].email ?? null, app: id.startsWith('agent:'),
  }))

  return {
    system: 'local',
    scope: { path: path.relative(config.root ?? root, config.issuesDir).split(path.sep).join('/') || '.issues' },
    read: isoSeconds(now()),
    commit,
    people,
    labels: [...(config.local.labels ?? [])],
    epics,
    sprints,
    issues: snapshotIssues,
    links: localLinks(issues),
    comments,
    outOfScope: {
      releases: local.listReleases().length,
      timeLogs,
      documents: countFiles(path.join(issuesDir, 'docs')),
      milestones: local.listMilestones().length,
      views: countFiles(path.join(issuesDir, 'views')),
      goals: countFiles(path.join(issuesDir, 'goals')),
      customers: countFiles(path.join(issuesDir, 'customers')),
      requests: countFiles(path.join(issuesDir, 'requests')),
    },
  }
}
