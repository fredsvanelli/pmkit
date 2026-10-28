// The Linear writer of a migration: one mutation per record, with the id the engine chose, and the reads by UUID that
// tell a rerun which creates happened. See the PMK-41 spec, "Order of writes" and "Running and resuming".

import { COMMENT_CREATE, COMMENT_RESOLVE, COMMENTS_BY_IDS, ISSUE_ARCHIVE, ISSUE_CREATE, ISSUE_DELETE, ISSUES_BY_IDS, LABEL_CREATE, LABEL_DELETE, RELATION_CREATE } from './documents.mjs'
import { isUnconfirmed } from './issue-ops.mjs'
import { PROJECT_CREATE, PROJECT_DELETE, PROJECT_UPDATE_CREATE, PROJECT_UPDATES_QUERY, PROJECTS_BY_IDS, epicId } from './projects.mjs'

const PAGE = 100
const chunks = (list) => Array.from({ length: Math.ceil(list.length / PAGE) }, (_, i) => list.slice(i * PAGE, (i + 1) * PAGE))

export function createLinearWriter({ client, discovery, uuid }) {
  const byIds = async (document, field, ids) => {
    const nodes = []
    for (const part of chunks([...new Set(ids)])) nodes.push(...(await client.request(document, { ids: part }))[field].nodes)
    return new Map(nodes.map((node) => [node.id, node]))
  }
  const issuesByIds = (ids) => byIds(ISSUES_BY_IDS, 'issues', ids)
  const live = (node) => node && node.trashed !== true

  async function create(kind, record, chosenId, fields) {
    switch (kind) {
      case 'label': {
        const data = await client.request(LABEL_CREATE, { input: { id: chosenId, ...fields } })
        return { id: data.issueLabelCreate.issueLabel?.id ?? chosenId, created: true }
      }
      case 'epic': {
        const data = await client.request(PROJECT_CREATE, { input: { id: chosenId, ...fields } })
        return { id: epicId(data.projectCreate.project) }
      }
      case 'issue': {
        const data = await client.request(ISSUE_CREATE, { input: { id: chosenId, ...fields } })
        return { id: data.issueCreate.issue.identifier }
      }
      case 'link':
        await client.request(RELATION_CREATE, { input: { id: chosenId, ...fields } })
        return { id: chosenId }
      case 'comment':
        await client.request(COMMENT_CREATE, { input: { id: chosenId, ...fields } })
        return { id: chosenId }
      case 'thread':
        await client.request(COMMENT_RESOLVE, { id: fields.commentId })
        return { id: fields.commentId }
      case 'update':
        await client.request(PROJECT_UPDATE_CREATE, { input: { id: chosenId, ...fields } })
        return { id: chosenId }
      case 'archive':
        await client.request(ISSUE_ARCHIVE, { id: fields.issueId })
        return { id: fields.issueId }
      default:
        throw new TypeError(`the Linear writer has no create for ${kind}`)
    }
  }

  async function exists(kind, entries, lookup = () => undefined) {
    const found = new Map()
    const uuidOf = (refKind, key) => lookup(refKind, key)?.uuid
    if (kind === 'issue') {
      const nodes = await issuesByIds(entries.map((entry) => entry.uuid))
      for (const entry of entries) if (live(nodes.get(entry.uuid))) found.set(entry.key, { id: nodes.get(entry.uuid).identifier })
    } else if (kind === 'archive') {
      const targets = entries.map((entry) => ({ entry, id: uuidOf('issue', entry.key) })).filter((item) => item.id)
      const nodes = await issuesByIds(targets.map((item) => item.id))
      for (const { entry, id } of targets) if (live(nodes.get(id)) && nodes.get(id).archivedAt) found.set(entry.key, { id })
    } else if (kind === 'link') {
      const targets = entries.map((entry) => ({ entry, from: uuidOf('issue', entry.key.split(' ')[1]) })).filter((item) => item.from)
      const nodes = await issuesByIds(targets.map((item) => item.from))
      for (const { entry, from } of targets) {
        if ((nodes.get(from)?.relations?.nodes ?? []).some((relation) => relation.id === entry.uuid)) found.set(entry.key, { id: entry.uuid })
      }
    } else if (kind === 'comment') {
      const nodes = await byIds(COMMENTS_BY_IDS, 'comments', entries.map((entry) => entry.uuid))
      for (const entry of entries) if (nodes.has(entry.uuid)) found.set(entry.key, { id: entry.uuid })
    } else if (kind === 'thread') {
      const targets = entries.map((entry) => ({ entry, id: uuidOf('comment', entry.key) })).filter((item) => item.id)
      const nodes = await byIds(COMMENTS_BY_IDS, 'comments', targets.map((item) => item.id))
      for (const { entry, id } of targets) if (nodes.get(id)?.resolvedAt) found.set(entry.key, { id })
    } else if (kind === 'epic') {
      const nodes = await byIds(PROJECTS_BY_IDS, 'projects', entries.map((entry) => entry.uuid))
      for (const entry of entries) if (nodes.has(entry.uuid)) found.set(entry.key, { id: epicId(nodes.get(entry.uuid)) })
    } else if (kind === 'update') {
      const byProject = new Map()
      for (const entry of entries) {
        const project = uuidOf('epic', entry.key.split('/')[0])
        if (project) byProject.set(project, [...(byProject.get(project) ?? []), entry])
      }
      for (const [project, list] of byProject) {
        const { nodes } = await client.paginate(PROJECT_UPDATES_QUERY, { id: project }, { select: (data) => data.project.projectUpdates, pageSize: 50 })
        const ids = new Set(nodes.map((node) => node.id))
        for (const entry of list) if (ids.has(entry.uuid)) found.set(entry.key, { id: entry.uuid })
      }
    } else if (kind === 'label') {
      const result = await discovery({ refresh: true })
      const ids = new Set((result.raw ?? result).labels.map((label) => label.id))
      for (const entry of entries) if (ids.has(entry.uuid)) found.set(entry.key, { id: entry.uuid })
    } else {
      throw new TypeError(`the Linear writer has no lookup for ${kind}`)
    }
    return found
  }

  async function remove(kind, entry) {
    if (kind === 'issue') await client.request(ISSUE_DELETE, { id: entry.uuid })
    else if (kind === 'epic') await client.request(PROJECT_DELETE, { id: entry.uuid })
    else if (kind === 'label') await client.request(LABEL_DELETE, { id: entry.uuid })
    else throw new TypeError(`the Linear writer cannot remove ${kind}`)
  }

  return { system: 'linear', chooseId: () => uuid(), exists, create, remove, budget: () => client.rateLimit(), isUnconfirmed }
}
