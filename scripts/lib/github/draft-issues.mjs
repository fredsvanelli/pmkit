// The draft issues of a GitHub Project for the GitHub Issues tracker: list them, and convert the chosen ones into issues,
// read and written through GraphQL with the gh client. A draft is text anyone who can edit the Project wrote, so it travels
// only as JSON data and GraphQL variables, never in a document.
// See docs/specs/2026-11-17-pmk-91-github-draft-issues-design.md.

import { PmkitError } from '../errors.mjs'
import { fetchLinkedProjects, parseProject } from './discovery.mjs'

const PAGE_SIZE = 100
const MAX_PAGES = 10
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const GHOST = 'ghost'
const TITLE_FIELD = 'Title'
const ITEM_ID = /^[A-Za-z0-9_=+/-]{1,200}$/
const NO_PROJECT_HINT = 'Pass --project owner/number, or set tracker.scope.project with /pmkit:setup'

const FIELD = 'field { ... on ProjectV2FieldCommon { name } }'
const ITEM = `id type isArchived
      content { ... on DraftIssue { title body createdAt updatedAt creator { login } assignees(first: 10) { nodes { login } } } }
      fieldValues(first: 20) {
        nodes {
          __typename
          ... on ProjectV2ItemFieldSingleSelectValue { name ${FIELD} }
          ... on ProjectV2ItemFieldTextValue { text ${FIELD} }
          ... on ProjectV2ItemFieldNumberValue { number ${FIELD} }
          ... on ProjectV2ItemFieldDateValue { date ${FIELD} }
          ... on ProjectV2ItemFieldIterationValue { title ${FIELD} }
        }
      }`

// Each document starts with its operation, as the fake GitHub reads only the first definition.
export const DRAFT_DOCUMENTS = Object.freeze({
  PROJECT: `query PmkitDraftProject($owner: String!, $number: Int!) {
  repositoryOwner(login: $owner) { projectV2(number: $number) { id title url } }
}`,
  ITEMS: `query PmkitDraftItems($project: ID!, $first: Int!, $after: String) {
  node(id: $project) {
    ... on ProjectV2 {
      items(first: $first, after: $after) {
        nodes { ${ITEM} }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`,
})

/** A Project item id, checked before it reaches GitHub or a command line. Anything else is INVALID_INPUT. */
export function parseItemId(value) {
  if (typeof value !== 'string' || !ITEM_ID.test(value)) {
    throw new PmkitError('INVALID_INPUT', `"${String(value ?? '')}" is not a Project item id; pass the item of a draft from pmkit github draft-issues list`, 'pmkit github draft-issues list')
  }
  return value
}

function parseLimit(value) {
  if (value === undefined) return DEFAULT_LIMIT
  const limit = /^\d+$/.test(String(value)) ? Number(value) : NaN
  if (!(limit >= 1 && limit <= MAX_LIMIT)) throw new PmkitError('INVALID_INPUT', `--limit must be a whole number from 1 to ${MAX_LIMIT}`, `Pass --limit ${DEFAULT_LIMIT}`)
  return limit
}

const login = (actor) => actor?.login ?? GHOST

/** { <field name>: value } of an item's field values, without the Title. */
function fieldsOf(item) {
  const fields = {}
  for (const node of item.fieldValues?.nodes ?? []) {
    const name = node?.field?.name
    if (!name || name === TITLE_FIELD) continue
    const value = node.name ?? node.text ?? node.number ?? node.date ?? node.title
    if (value !== undefined && value !== null) fields[name] = value
  }
  return fields
}

const draftView = (item) => ({
  item: item.id, title: item.content.title, body: item.content.body, assignees: (item.content.assignees?.nodes ?? []).map(login),
  creator: login(item.content.creator), created: item.content.createdAt, updated: item.content.updatedAt, fields: fieldsOf(item),
})

const isDraft = (item) => item.type === 'DRAFT_ISSUE' && item.isArchived !== true

/** The first single-select value of a draft, the Status when it has one. */
const statusOf = (draft) => draft.fields.Status ?? Object.values(draft.fields).find((value) => typeof value === 'string') ?? ''

/** The plain text of a list result. */
export function listText(result) {
  if (!result.available) return `no Project to read for ${result.repo}; ${result.enableHint}`
  if (result.drafts.length === 0) return `no draft issues in ${result.project.title}`
  const lines = result.drafts.map((draft) => `${draft.item}  ${draft.title}  ${statusOf(draft)}  ${draft.updated}`.trimEnd())
  return [...lines, ...(result.hasMore ? ['more drafts exist; pass --limit to read more'] : []), ...result.warnings.map((line) => `warning: ${line}`)].join('\n')
}

/** The draft issue operations of one repository. scope is tracker.scope: { host, repo, project }. */
export function draftIssueOperations({ client, scope }) {
  /** The Project to read: { name, id, title, url }, or null when none is set. A --project the repository does not link is INVALID_INPUT. */
  async function resolveProject(option) {
    const name = option ?? scope.project
    const parsed = parseProject(name)
    if (parsed === undefined) throw new PmkitError('INVALID_INPUT', '--project must be owner/number, such as acme/7', 'Pass --project owner/number')
    if (parsed === null) return null
    const wanted = `${parsed.owner}/${parsed.number}`
    if (option !== undefined && wanted.toLowerCase() !== String(scope.project ?? '').toLowerCase()) {
      const linked = await fetchLinkedProjects(client, scope.repo)
      if (!linked.some((project) => project.id.toLowerCase() === wanted.toLowerCase())) {
        const names = linked.map((project) => project.id)
        throw new PmkitError('INVALID_INPUT', `${wanted} is not linked to ${scope.repo}; its linked Projects are ${names.length > 0 ? names.join(', ') : 'none'}`, 'Pass --project with one of those Projects')
      }
    }
    const data = await client.request(DRAFT_DOCUMENTS.PROJECT, parsed)
    const node = data.repositoryOwner.projectV2
    return { name: wanted, id: node.id, title: node.title, url: node.url }
  }

  async function list({ project, limit } = {}) {
    const cap = parseLimit(limit)
    const found = await resolveProject(project)
    if (!found) return { available: false, reason: 'no_project', enableHint: NO_PROJECT_HINT, repo: scope.repo, drafts: [], hasMore: false, warnings: [] }
    const drafts = []
    const warnings = []
    let after = null
    for (let pageIndex = 0; ; pageIndex += 1) {
      const data = await client.request(DRAFT_DOCUMENTS.ITEMS, { project: found.id, first: PAGE_SIZE, after })
      const items = data.node.items
      drafts.push(...items.nodes.filter(isDraft).map(draftView))
      if (!items.pageInfo.hasNextPage) break
      if (pageIndex + 1 === MAX_PAGES) {
        warnings.push(`${found.name} has more than ${MAX_PAGES * PAGE_SIZE} items and pmkit read the first ${MAX_PAGES * PAGE_SIZE}`)
        break
      }
      after = items.pageInfo.endCursor
    }
    return { available: true, project: { id: found.id, title: found.title, url: found.url }, repo: scope.repo, drafts: drafts.slice(0, cap), hasMore: drafts.length > cap, warnings }
  }

  return { list }
}
