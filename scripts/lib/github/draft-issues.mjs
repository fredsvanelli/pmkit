// The draft issues of a GitHub Project for the GitHub Issues tracker: list them, and convert the chosen ones into issues,
// read and written through GraphQL with the gh client. A draft is text anyone who can edit the Project wrote, so it travels
// only as JSON data and GraphQL variables, never in a document.
// See docs/specs/2026-11-17-pmk-91-github-draft-issues-design.md.

import { PmkitError } from '../errors.mjs'
import { fetchLinkedProjects, parseProject, parseRepo } from './discovery.mjs'

const PAGE_SIZE = 100
const MAX_PAGES = 10
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MAX_CONVERT = 50
const GHOST = 'ghost'
const TITLE_FIELD = 'Title'
const ITEM_ID = /^[A-Za-z0-9_=+/-]{1,200}$/
// What an item that is not a draft is, by its ProjectV2ItemType. REDACTED, and any type GitHub adds later, read as unseen.
const OTHER_ITEMS = { ISSUE: 'an issue', PULL_REQUEST: 'a pull request' }
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
  repositoryOwner(login: $owner) { ... on ProjectV2Owner { projectV2(number: $number) { id title url } } }
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
  ITEM: `query PmkitDraftItem($id: ID!) {
  node(id: $id) { ... on ProjectV2Item { ${ITEM} project { id } } }
}`,
  TARGET: `query PmkitDraftTarget($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { id nameWithOwner hasIssuesEnabled }
}`,
  CONVERT: `mutation PmkitConvertDraftItem($input: ConvertProjectV2DraftIssueItemToIssueInput!) {
  convertProjectV2DraftIssueItemToIssue(input: $input) { item { id content { ... on Issue { id number url repository { nameWithOwner } } } } }
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

/** The plain text of a list result. The CLI prints the warnings on stderr. */
export function listText(result) {
  if (!result.available) return `no Project to read for ${result.repo}; ${result.enableHint}`
  if (result.drafts.length === 0) return `no draft issues in ${result.project.title}`
  const lines = result.drafts.map((draft) => `${draft.item}  ${draft.title}  ${statusOf(draft)}  ${draft.updated}`.trimEnd())
  return [...lines, ...(result.hasMore ? ['more drafts exist; pass --limit to read more'] : [])].join('\n')
}

/** The plain text of a convert result. The CLI prints the warnings on stderr. */
export function convertText(result, dryRun) {
  const count = dryRun ? result.drafts.length : result.converted.length
  const head = dryRun
    ? `would convert ${count} draft${count === 1 ? '' : 's'} of ${result.project.title} into issues in ${result.target.repo}`
    : `converted ${count} draft${count === 1 ? '' : 's'} into issues in ${result.target.repo}: ${result.converted.map((item) => `#${item.number}`).join(', ')}`
  return head
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

  /** The ids of a convert call: 1 to 50 checked ids, a repeated one once, in the order given. */
  function itemIds(items) {
    const ids = [...new Set((items ?? []).map(parseItemId))]
    if (ids.length < 1 || ids.length > MAX_CONVERT) throw new PmkitError('INVALID_INPUT', `convert takes 1 to ${MAX_CONVERT} item ids`, 'Pass the items of the drafts to convert from pmkit github draft-issues list')
    return ids
  }

  /** The repository the drafts become issues in: { id, repo, tracked }. */
  async function resolveTarget(option) {
    const name = option ?? scope.repo
    const parsed = parseRepo(name)
    if (!parsed) throw new PmkitError('INVALID_INPUT', '--repo must be owner/name, such as acme/widgets', 'Pass --repo owner/name')
    let repository
    try {
      repository = (await client.request(DRAFT_DOCUMENTS.TARGET, parsed)).repository
    } catch (error) {
      if (error?.code !== 'NOT_FOUND') throw error
    }
    if (!repository) throw new PmkitError('NOT_FOUND', `GitHub has no repository ${name}`, 'Check the --repo name, and that the gh account can see it')
    if (repository.hasIssuesEnabled === false) throw new PmkitError('INVALID_INPUT', `${repository.nameWithOwner} has issues turned off`, 'Turn on issues in the repository settings on GitHub, or pass another --repo')
    const tracked = repository.nameWithOwner.toLowerCase() === String(scope.repo).toLowerCase()
    return { id: repository.id, repo: tracked ? scope.repo : repository.nameWithOwner, tracked }
  }

  /** One draft item of the Project, read and checked. Anything else is INVALID_INPUT that names the id. */
  async function readDraft(id, project) {
    const refuse = (reason) => new PmkitError('INVALID_INPUT', `item ${id} ${reason}`, 'pmkit github draft-issues list')
    let node
    try {
      node = (await client.request(DRAFT_DOCUMENTS.ITEM, { id })).node
    } catch (error) {
      if (error?.code !== 'NOT_FOUND') throw error
    }
    if (!node?.id) throw refuse('does not exist')
    if (node.project?.id !== project.id) throw refuse(`is not in ${project.name}`)
    if (node.type !== 'DRAFT_ISSUE') throw refuse(`is ${OTHER_ITEMS[node.type] ?? 'an item the gh account cannot see'}, not a draft`)
    if (node.isArchived) throw refuse('is archived')
    return node
  }

  async function convert(items, { project, repo, dryRun = false } = {}) {
    const ids = itemIds(items)
    const found = await resolveProject(project)
    if (!found) throw new PmkitError('NOT_SUPPORTED', `no Project to read drafts from for ${scope.repo}`, NO_PROJECT_HINT)
    const target = await resolveTarget(repo)
    const nodes = []
    for (const id of ids) nodes.push(await readDraft(id, found))
    const head = { project: { id: found.id, title: found.title, url: found.url }, target: { repo: target.repo, tracked: target.tracked } }
    const warnings = target.tracked ? [] : [`${target.repo} is not tracker.scope.repo (${scope.repo}), so pmkit will not track the new issues`]
    if (dryRun) {
      const drafts = nodes.map((node) => {
        const { item, title, body, assignees, fields } = draftView(node)
        return { item, title, body, assignees, fields }
      })
      return { dryRun: true, ...head, drafts, warnings }
    }
    const converted = []
    for (const [index, node] of nodes.entries()) {
      let issue
      try {
        issue = (await client.request(DRAFT_DOCUMENTS.CONVERT, { input: { itemId: node.id, repositoryId: target.id } })).convertProjectV2DraftIssueItemToIssue.item.content
      } catch (error) {
        if (converted.length === 0) throw error
        const notConverted = nodes.slice(index).map((item) => item.id)
        throw new PmkitError('UPSTREAM', `GitHub converted ${converted.length} of ${nodes.length} drafts, but ${node.id} failed: ${error.message}`, `pmkit github draft-issues convert ${notConverted.join(' ')}`, { converted, notConverted })
      }
      converted.push({ item: node.id, title: node.content.title, number: issue.number, id: target.tracked ? String(issue.number) : null, url: issue.url })
    }
    return { ...head, converted, warnings }
  }

  return { list, convert }
}
