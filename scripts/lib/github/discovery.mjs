// GitHub discovery: the GHES version check, the read queries, the raw data and the discover result.
// See docs/specs/2026-11-16-pmk-86-github-discovery-and-setup-design.md, "Discovery", and ADR 0007.

import { PmkitError } from '../errors.mjs'
import { hideAbsolutePaths } from '../paths.mjs'
import { INSTALL_STEP } from './host.mjs'
import { brokenGithubMappings, fieldOf, NONE } from './mappings.mjs'

export const MINIMUM_GHES = '3.19'
// Issue fields reach GHES in 3.21 (ADR 0007): older schemas have no issueFields and no isIssueField.
const ISSUE_FIELDS_GHES = '3.21'
const FIRST = 50
const LABELS_FIRST = 100
const PRIORITIES = ['urgent', 'high', 'medium', 'low']

const PAGE = 'pageInfo { hasNextPage }'
const ISSUE_FIELD_NODES = 'nodes { __typename ... on IssueFieldDate { id name dataType } ... on IssueFieldNumber { id name dataType } ... on IssueFieldText { id name dataType } ... on IssueFieldSingleSelect { id name dataType options { id name } } ... on IssueFieldMultiSelect { id name dataType options { id name } } }'

/** The repository query. Issue fields are asked only where the schema has them. */
export const repoQuery = ({ issueFields }) =>
  'query PmkitRepo($owner: String!, $name: String!) { viewer { login name } repository(owner: $owner, name: $name) { id nameWithOwner owner { login __typename } ' +
  `issueTypes(first: ${FIRST}) { nodes { id name description isEnabled } ${PAGE} } ` +
  (issueFields ? `issueFields(first: ${FIRST}) { ${ISSUE_FIELD_NODES} ${PAGE} } ` : '') +
  `labels(first: ${LABELS_FIRST}) { nodes { name } ${PAGE} } } }`

/** The Project query: the Project of an owner, user or organization, with its fields. */
export const projectQuery = ({ issueFields }) => {
  const flag = issueFields ? ' isIssueField' : ''
  return 'query PmkitProject($owner: String!, $number: Int!) { repositoryOwner(login: $owner) { ... on ProjectV2Owner { projectV2(number: $number) { id number title url ' +
    `fields(first: ${FIRST}) { nodes { __typename ... on ProjectV2Field { id name dataType${flag} } ... on ProjectV2IterationField { id name dataType${flag} } ` +
    `... on ProjectV2SingleSelectField { id name dataType${flag} options { id name } } ... on ProjectV2MultiSelectField { id name dataType${flag} } } ${PAGE} } } } } }`
}

export const LINKED_PROJECTS_QUERY =
  'query PmkitLinkedProjects($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { projectsV2(first: 20) { nodes { number title owner { ... on Organization { login } ... on User { login } } } } } }'

/** True for a GitHub Enterprise Server host: any host but github.com and GHE.com (*.ghe.com). */
export function needsVersionCheck(host) {
  if (typeof host !== 'string' || host === '') return false
  const name = host.toLowerCase().replace(/:\d+$/, '')
  return name !== 'github.com' && !name.endsWith('.ghe.com')
}

/** -1, 0 or 1 for two dotted versions, compared by number. */
export function compareVersions(a, b) {
  const left = String(a).split('.').map(Number)
  const right = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}

/**
 * On GHES, reads installed_version from `gh api meta` and refuses a version below 3.19 (ADR 0007).
 * Returns the version, or null on github.com and GHE.com, where nothing runs.
 */
export async function checkGhesVersion({ exec, host }) {
  if (!needsVersionCheck(host)) return null
  let result
  try {
    result = exec('gh', ['api', '--hostname', host, 'meta'], { timeout: 30000 })
  } catch (error) {
    if (error.code === 'ENOENT') throw new PmkitError('NOT_CONFIGURED', 'gh is not installed', INSTALL_STEP)
    if (error.code === 'ETIMEDOUT') throw new PmkitError('UPSTREAM', `gh api meta did not answer for ${host} within 30 s`, `Check that ${host} is reachable, then retry`)
    throw error
  }
  if (result.status !== 0) {
    const stderr = result.stderr ?? ''
    if (stderr.includes('gh auth login')) throw new PmkitError('AUTH', 'GitHub CLI is not logged in', `gh auth login -h ${host}`)
    const line = hideAbsolutePaths(stderr.split(/\r?\n/).find((item) => item.trim()) ?? `exit ${result.status}`)
    throw new PmkitError('UPSTREAM', `gh api meta failed for ${host}: ${line}`, `Check that ${host} is a GitHub Enterprise Server host`)
  }
  let version
  try {
    version = JSON.parse(result.stdout)?.installed_version
  } catch {
    version = undefined
  }
  if (typeof version !== 'string' || !/^\d+(\.\d+)*$/.test(version)) {
    throw new PmkitError('UPSTREAM', `gh api meta did not return installed_version for ${host}`, `Check that ${host} is a GitHub Enterprise Server host`)
  }
  if (compareVersions(version, MINIMUM_GHES) < 0) {
    throw new PmkitError('NOT_SUPPORTED', `GitHub Enterprise Server ${version} is older than ${MINIMUM_GHES}, the oldest version pmkit supports`, `Upgrade the server to ${MINIMUM_GHES} or later, or use tracker.system local`)
  }
  return version
}

/** { owner, number } for owner/number, null for none or no value, undefined for anything else. */
export function parseProject(value) {
  if (value === undefined || value === null || value === NONE) return null
  const found = /^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([1-9]\d*)$/.exec(String(value))
  return found ? { owner: found[1], number: Number(found[2]) } : undefined
}

/** { owner, name } of owner/name, or undefined. */
export function parseRepo(value) {
  const found = /^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)$/.exec(String(value ?? ''))
  return found && found[2] !== '.' && found[2] !== '..' ? { owner: found[1], name: found[2] } : undefined
}

const option = (node) => ({ id: node.id, name: node.name })
const field = (node) => ({ id: node.id, name: node.name, dataType: node.dataType, options: (node.options ?? []).map(option) })

/** True when the schema of this host has issue fields: github.com, GHE.com and GHES 3.21 or later. */
export const hasIssueFields = (ghesVersion) => ghesVersion === null || compareVersions(ghesVersion, ISSUE_FIELDS_GHES) >= 0

/**
 * Reads one Project with its fields, as { project, truncated }. project is owner/number. A Project GitHub does not return is
 * NOT_FOUND; a missing scope is the client's AUTH.
 */
export async function fetchProject(client, project, { issueFields = true } = {}) {
  const picked = parseProject(project)
  const reply = await client.request(projectQuery({ issueFields }), picked)
  const node = reply?.repositoryOwner?.projectV2
  if (!node) throw new PmkitError('NOT_FOUND', `GitHub Project ${project} does not exist, or the gh account cannot see it`, 'Check tracker.scope.project, or run /pmkit:setup to pick another Project')
  return {
    truncated: node.fields?.pageInfo?.hasNextPage === true,
    project: {
      id: node.id,
      owner: picked.owner,
      number: node.number,
      title: node.title,
      url: node.url,
      fields: (node.fields?.nodes ?? []).filter((item) => item?.name).map((item) => ({ ...field(item), issueField: item.isIssueField === true })),
    },
  }
}

/**
 * Reads the repository, then the Project when `project` is owner/number, and returns the raw data setup and discover read.
 * exec runs the GHES check; a host that needs none never calls it.
 */
export async function fetchDiscovery(client, { host, repo, project, exec }) {
  const ghesVersion = await checkGhesVersion({ exec, host })
  const issueFields = hasIssueFields(ghesVersion)
  const { owner, name } = parseRepo(repo) ?? {}
  const data = await client.request(repoQuery({ issueFields }), { owner, name })
  const repository = data?.repository
  if (!repository) throw new PmkitError('NOT_FOUND', `GitHub found no repository ${repo}`, 'Check tracker.scope.repo, and that the gh account can see the repository')
  const truncated = []
  if (repository.issueTypes?.pageInfo?.hasNextPage) truncated.push('issue types')
  if (repository.issueFields?.pageInfo?.hasNextPage) truncated.push('issue fields')
  if (repository.labels?.pageInfo?.hasNextPage) truncated.push('labels')

  let projectData = null
  if (parseProject(project)) {
    const read = await fetchProject(client, project, { issueFields })
    if (read.truncated) truncated.push('Project fields')
    projectData = read.project
  }

  return {
    version: 1,
    host,
    repo: repository.nameWithOwner,
    ghesVersion,
    viewer: { login: data.viewer?.login ?? null, name: data.viewer?.name ?? null },
    owner: { login: repository.owner?.login ?? null, type: repository.owner?.__typename ?? null },
    issueTypes: (repository.issueTypes?.nodes ?? []).filter((node) => node?.isEnabled !== false).map((node) => ({ id: node.id, name: node.name, description: node.description ?? null })),
    issueFields: (repository.issueFields?.nodes ?? []).filter((node) => node?.name).map(field),
    labels: (repository.labels?.nodes ?? []).map((node) => node.name),
    project: projectData,
    truncated,
  }
}

/** The Projects linked to the repository, as [{ id: owner/number, title }]. An AUTH error propagates, so setup can show its step. */
export async function fetchLinkedProjects(client, repo) {
  const data = await client.request(LINKED_PROJECTS_QUERY, parseRepo(repo) ?? {})
  return (data?.repository?.projectsV2?.nodes ?? []).filter((node) => node?.owner?.login).map((node) => ({ id: `${node.owner.login}/${node.number}`, title: node.title }))
}

const STATUS_FIELD = 'Status'

/** The Project's Status field, or null. */
export const statusFieldOf = (project) => project?.fields.find((item) => item.name === STATUS_FIELD && item.dataType === 'SINGLE_SELECT') ?? null

const plainField = ({ name, dataType, options }) => ({ name, dataType, options: options.map((item) => item.name) })

/** The estimate unit and scale of the mapped estimate field: sizes for a single select, points otherwise. */
function estimateOf(raw, pmkit) {
  const found = fieldOf(raw, pmkit?.mappings?.fields?.estimate)
  if (found?.dataType === 'SINGLE_SELECT') return { unit: 'sizes', scale: found.options.map((item) => item.name) }
  return { unit: 'points', scale: [] }
}

/** The statuses of the discover result: each Status option with its mapped category, or open and closed without a Project. */
function statusesOf(raw, status, warnings) {
  if (raw.project === null) {
    warnings.push('tracker.scope.project is none; statuses are open and closed only until PMK-89 adds the rest')
    return [{ name: 'Open', category: 'todo' }, { name: 'Closed', category: 'done' }]
  }
  const statusField = statusFieldOf(raw.project)
  if (!statusField) warnings.push(`GitHub Project ${raw.project.owner}/${raw.project.number} has no single-select Status field`)
  const categoryOf = new Map(Object.entries(status).filter(([category, value]) => category !== 'blocked' && typeof value === 'string' && value !== NONE).map(([category, value]) => [value, category]))
  return (statusField?.options ?? []).map(({ name }) => {
    const category = categoryOf.get(name)
    if (!category) warnings.push(`Status option ${name} has no category in mappings.status; issues in it count as in_progress`)
    return { name, category: category ?? 'in_progress' }
  })
}

/** The discover result. pmkit is config.pmkit; the raw discovery stays on it as a hidden property. */
export function discoveryView(raw, pmkit = {}) {
  const warnings = raw.truncated.map((kind) => `GitHub has more ${kind} than discovery reads; it kept the first ${kind === 'labels' ? LABELS_FIRST : FIRST}`)
  const statusOptions = (statusFieldOf(raw.project)?.options ?? []).map((item) => item.name)
  const statuses = statusesOf(raw, pmkit?.mappings?.status ?? {}, warnings)
  warnings.push(...brokenGithubMappings(raw, pmkit).map((item) => item.problem))

  const types = Object.entries(pmkit?.mappings?.types ?? {}).filter(([, value]) => typeof value === 'string' && value !== NONE).map(([type]) => type)
  const view = {
    host: raw.host,
    repo: raw.repo,
    ...(raw.ghesVersion ? { ghesVersion: raw.ghesVersion } : {}),
    viewer: { id: raw.viewer.login, name: raw.viewer.name },
    project: raw.project ? { owner: raw.project.owner, number: raw.project.number, title: raw.project.title, url: raw.project.url } : null,
    issueTypes: raw.issueTypes.map(({ name, description }) => ({ name, description })),
    issueFields: raw.issueFields.map(plainField),
    projectFields: (raw.project?.fields ?? []).map((item) => ({ ...plainField(item), issueField: item.issueField })),
    statusOptions,
    statuses,
    types,
    priorities: [...PRIORITIES],
    labels: [...raw.labels],
    members: raw.viewer.login ? [{ id: raw.viewer.login, name: raw.viewer.name, email: null }] : [],
    estimate: estimateOf(raw, pmkit),
    warnings,
  }
  Object.defineProperty(view, 'raw', { value: raw, enumerable: false })
  return view
}
