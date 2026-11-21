// GitHub discovery: the GHES version check, the read queries, the raw data and the discover result.
// See docs/specs/2026-11-16-pmk-86-github-discovery-and-setup-design.md, "Discovery", and ADR 0007.

import { PmkitError } from '../errors.mjs'
import { hideAbsolutePaths } from '../paths.mjs'
import { hostFeatures, issueDocuments } from './documents.mjs'
import { INSTALL_STEP } from './host.mjs'
import { priorityRule } from './issues.mjs'
import { brokenGithubMappings, fieldOf, labelOf, NONE, parseLabelValue } from './mappings.mjs'

export const MINIMUM_GHES = '3.19'
// Issue fields reach GHES in 3.22 (ADR 0007, amended by PMK-335): the 3.21 schema has Issue.issueFieldValues but no
// Repository.issueFields, so pmkit cannot discover them there. No GHES schema has isIssueField or ProjectV2MultiSelectField.
const ISSUE_FIELDS_GHES = '3.22'
const FIRST = 50
const LABELS_FIRST = 100
const USERS_PAGE = 100
// paginate stops after ten pages without a limit.
const USERS_MAX = USERS_PAGE * 10
const PRIORITIES = ['urgent', 'high', 'medium', 'low']

const PAGE = 'pageInfo { hasNextPage }'
const ISSUE_FIELD_NODES = 'nodes { __typename ... on IssueFieldDate { id name dataType } ... on IssueFieldNumber { id name dataType } ... on IssueFieldText { id name dataType } ... on IssueFieldSingleSelect { id name dataType options { id name } } ... on IssueFieldMultiSelect { id name dataType options { id name } } }'

/**
 * The repository query. Issue fields are asked only where the schema has them. `named` is the number of labels read by name,
 * as aliases l0, l1, ... over the variables $l0, $l1, ..., so a mapped label past the first page is still found.
 */
export const repoQuery = ({ issueFields, named = 0 }) => {
  const aliases = Array.from({ length: named }, (_, index) => `l${index}`)
  return `query PmkitRepo($owner: String!, $name: String!${aliases.map((alias) => `, $${alias}: String!`).join('')}) { viewer { id login name } repository(owner: $owner, name: $name) { id nameWithOwner owner { id login __typename } ` +
    `issueTypes(first: ${FIRST}) { nodes { id name description isEnabled } ${PAGE} } ` +
    (issueFields ? `issueFields(first: ${FIRST}) { ${ISSUE_FIELD_NODES} ${PAGE} } ` : '') +
    `labels(first: ${LABELS_FIRST}) { nodes { id name } ${PAGE} } ` +
    aliases.map((alias) => `${alias}: label(name: $${alias}) { id name } `).join('') +
    '} }'
}

/**
 * The label names that mappings.status and mappings.types name as label:<name>, then the extra names (setup's answers, bare
 * or label:<name>), once each without case.
 */
export function mappedLabelNames(pmkit, extra = []) {
  const values = [...['status', 'types', 'priority', 'estimate'].flatMap((group) => Object.values(pmkit?.mappings?.[group] ?? {})), ...extra.map((name) => parseLabelValue(name) ? name : `label:${name}`)]
  const names = []
  for (const value of values) {
    const name = parseLabelValue(value)
    if (name && !names.some((held) => held.toLowerCase() === name.toLowerCase())) names.push(name)
  }
  return names
}

/**
 * The Project query: the Project of an owner, user or organization, with its fields. ghes leaves out isIssueField and the
 * multi-select fragment, which no GHES schema has.
 */
export const projectQuery = ({ issueFields, ghes = false }) => {
  const flag = issueFields && !ghes ? ' isIssueField' : ''
  const multi = ghes ? '' : ` ... on ProjectV2MultiSelectField { id name dataType${flag} }`
  return 'query PmkitProject($owner: String!, $number: Int!) { repositoryOwner(login: $owner) { ... on ProjectV2Owner { projectV2(number: $number) { id number title url ' +
    `fields(first: ${FIRST}) { nodes { __typename ... on ProjectV2Field { id name dataType${flag} } ... on ProjectV2IterationField { id name dataType${flag} configuration { duration startDay iterations { id title startDate duration } completedIterations { id title startDate duration } } } ` +
    `... on ProjectV2SingleSelectField { id name dataType${flag} options { id name } }${multi} } ${PAGE} } } } } }`
}

const LINKED_PAGE = 100
// A repository GitHub answers without lists no Projects, as before the read paged.
const NO_PROJECTS = { nodes: [], pageInfo: { hasNextPage: false } }
export const LINKED_PROJECTS_QUERY =
  'query PmkitLinkedProjects($owner: String!, $name: String!, $first: Int!, $after: String) { repository(owner: $owner, name: $name) { projectsV2(first: $first, after: $after) { nodes { number title owner { ... on Organization { login } ... on User { login } } } pageInfo { hasNextPage endCursor } } } }'

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

/** Runs `gh api --hostname <host> meta` and returns its stdout, or throws the pmkit error of the failure. */
function readMeta(exec, host) {
  let result
  try {
    result = exec('gh', ['api', '--hostname', host, 'meta'], { timeout: 30000 })
  } catch (error) {
    if (error.code === 'ENOENT') throw new PmkitError('NOT_CONFIGURED', 'gh is not installed', INSTALL_STEP)
    if (error.code === 'ETIMEDOUT') throw new PmkitError('UPSTREAM', `gh api meta did not answer for ${host} within 30 s`, `Check that ${host} is reachable, then retry`)
    throw error
  }
  if (result.status === 0) return result.stdout
  const stderr = result.stderr ?? ''
  if (stderr.includes('gh auth login')) throw new PmkitError('AUTH', 'GitHub CLI is not logged in', `gh auth login -h ${host}`)
  const line = hideAbsolutePaths(stderr.split(/\r?\n/).find((item) => item.trim()) ?? `exit ${result.status}`)
  throw new PmkitError('UPSTREAM', `gh api meta failed for ${host}: ${line}`, `Check that ${host} is a GitHub Enterprise Server host`)
}

/** installed_version of a meta document, or null when it has none that reads as a version. */
function installedVersion(stdout) {
  try {
    const version = JSON.parse(stdout)?.installed_version
    return typeof version === 'string' && /^\d+(\.\d+)*$/.test(version) ? version : null
  } catch {
    return null
  }
}

/**
 * On GHES, reads installed_version from `gh api meta` and refuses a version below 3.19 (ADR 0007).
 * Returns the version, or null on github.com and GHE.com, where nothing runs.
 */
export async function checkGhesVersion({ exec, host }) {
  if (!needsVersionCheck(host)) return null
  const version = installedVersion(readMeta(exec, host))
  if (version === null) {
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
const iteration = (node) => ({ id: node.id, title: node.title, startDate: node.startDate, duration: node.duration })
// A cache entry or an answer with no configuration reads as no iterations.
const configurationOf = (node) => ({
  duration: node?.duration ?? null,
  startDay: node?.startDay ?? null,
  iterations: (node?.iterations ?? []).map(iteration),
  completedIterations: (node?.completedIterations ?? []).map(iteration),
})
const field = (node) => ({ id: node.id, name: node.name, dataType: node.dataType, options: (node.options ?? []).map(option) })

/** True when the schema of this host has issue fields: github.com, GHE.com and GHES 3.21 or later. */
export const hasIssueFields = (ghesVersion) => ghesVersion === null || compareVersions(ghesVersion, ISSUE_FIELDS_GHES) >= 0

/**
 * Reads one Project with its fields, as { project, truncated }. project is owner/number. A Project GitHub does not return is
 * NOT_FOUND; a missing scope is the client's AUTH.
 */
export async function fetchProject(client, project, { issueFields = true, ghes = false } = {}) {
  const picked = parseProject(project)
  const reply = await client.request(projectQuery({ issueFields, ghes }), picked)
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
      fields: (node.fields?.nodes ?? []).filter((item) => item?.name).map((item) => ({ ...field(item), issueField: item.isIssueField === true, ...(item.dataType === 'ITERATION' ? { configuration: configurationOf(item.configuration) } : {}) })),
    },
  }
}

/** The users GitHub can assign issues of the repository to, as { users: [{ id, login, name }], truncated }. */
async function fetchAssignableUsers(client, features, { owner, name }) {
  const { nodes, hasMore } = await client.paginate(issueDocuments(features).ASSIGNABLE_USERS, { owner, name }, { select: (data) => data.repository.assignableUsers, pageSize: USERS_PAGE })
  return { users: nodes.filter((node) => node?.login).map((node) => ({ id: node.id, login: node.login, name: node.name ?? null })), truncated: hasMore }
}

/**
 * Reads the repository, then the Project when `project` is owner/number, and returns the raw data setup and discover read.
 * With users, it also pages the assignable users; setup leaves them out and gets users: [].
 * exec runs the GHES check; a host that needs none never calls it.
 */
export async function fetchDiscovery(client, { host, repo, project, exec, users = false, labels = [] }) {
  const ghesVersion = await checkGhesVersion({ exec, host })
  const issueFields = hasIssueFields(ghesVersion)
  const { owner, name } = parseRepo(repo) ?? {}
  const named = Object.fromEntries(labels.map((label, index) => [`l${index}`, label]))
  const data = await client.request(repoQuery({ issueFields, named: labels.length }), { owner, name, ...named })
  const repository = data?.repository
  if (!repository) throw new PmkitError('NOT_FOUND', `GitHub found no repository ${repo}`, 'Check tracker.scope.repo, and that the gh account can see the repository')
  const truncated = TRUNCATED_LISTS.filter(([key]) => repository[key]?.pageInfo?.hasNextPage).map(([, kind]) => kind)
  const features = hostFeatures({ host, ghesVersion })
  const assignable = users ? await readNested(fetchAssignableUsers(client, features, { owner, name }), 'assignable users', truncated) : { users: [] }
  const projectRead = parseProject(project) ? await readNested(fetchProject(client, project, { issueFields, ghes: needsVersionCheck(host) }), 'Project fields', truncated) : { project: null }
  return {
    version: 1,
    host,
    repo: repository.nameWithOwner,
    repositoryId: repository.id,
    ownerId: repository.owner?.id ?? null,
    ghesVersion,
    features,
    ...repositoryLists(data, repository, labels.length),
    users: assignable.users,
    project: projectRead.project,
    truncated,
  }
}

// The repository lists discovery reads in the first request, and the name a truncation warning gives each.
const TRUNCATED_LISTS = [['issueTypes', 'issue types'], ['issueFields', 'issue fields'], ['labels', 'labels']]

/** Awaits a read that pages on its own, and adds its kind to truncated when GitHub had more than it read. */
async function readNested(promise, kind, truncated) {
  const read = await promise
  if (read.truncated) truncated.push(kind)
  return read
}

/** The viewer, owner, issue types, issue fields and labels of the repository query's answer. */
function repositoryLists(data, repository, named = 0) {
  const labels = (repository.labels?.nodes ?? []).filter((node) => node?.name).map((node) => ({ id: node.id, name: node.name }))
  for (let index = 0; index < named; index += 1) {
    const node = repository[`l${index}`]
    if (node?.name && !labels.some((label) => label.id === node.id)) labels.push({ id: node.id, name: node.name })
  }
  return {
    viewer: { id: data.viewer?.id ?? null, login: data.viewer?.login ?? null, name: data.viewer?.name ?? null },
    owner: { login: repository.owner?.login ?? null, type: repository.owner?.__typename ?? null },
    issueTypes: (repository.issueTypes?.nodes ?? []).filter((node) => node?.isEnabled !== false).map((node) => ({ id: node.id, name: node.name, description: node.description ?? null })),
    issueFields: (repository.issueFields?.nodes ?? []).filter((node) => node?.name).map(field),
    labels,
  }
}

/**
 * The Projects linked to the repository, as [{ id: owner/number, title }], read 100 a page up to the client's 10-page cap. An AUTH
 * error propagates, so setup can show its step.
 */
export async function fetchLinkedProjects(client, repo) {
  const { nodes } = await client.paginate(LINKED_PROJECTS_QUERY, parseRepo(repo) ?? {}, { select: (data) => data?.repository?.projectsV2 ?? NO_PROJECTS, pageSize: LINKED_PAGE })
  return nodes.filter((node) => node?.owner?.login).map((node) => ({ id: `${node.owner.login}/${node.number}`, title: node.title }))
}

const STATUS_FIELD = 'Status'

/** The Project's Status field, or null. */
export const statusFieldOf = (project) => project?.fields.find((item) => item.name === STATUS_FIELD && item.dataType === 'SINGLE_SELECT') ?? null

const plainField = ({ name, dataType, options }) => ({ name, dataType, options: options.map((item) => item.name) })

/** True when every estimate key is a number, so the estimate labels give points; otherwise they give sizes (ADR 0012). */
export const isPointsScale = (keys) => keys.every((key) => /^\d+(?:\.\d+)?$/.test(key))

/**
 * The estimate values whose label the repository has, in mapping order, when estimate labels hold: no Project and no estimate
 * field (ADR 0012). Empty otherwise.
 */
export function estimateLabelScale(raw, pmkit) {
  if (raw.project !== null || ![undefined, null, '', NONE].includes(pmkit?.mappings?.fields?.estimate)) return []
  return Object.entries(pmkit?.mappings?.estimate ?? {}).filter(([, value]) => {
    const name = parseLabelValue(value)
    return name !== null && labelOf(raw, name) !== null
  }).map(([key]) => key)
}

/** The estimate unit and scale of the mapped estimate field (sizes for a single select, points otherwise), or of the estimate labels. */
export function estimateOf(raw, pmkit) {
  const found = fieldOf(raw, pmkit?.mappings?.fields?.estimate)
  if (found?.dataType === 'SINGLE_SELECT') return { unit: 'sizes', scale: found.options.map((item) => item.name) }
  const scale = found ? [] : estimateLabelScale(raw, pmkit)
  return isPointsScale(scale) ? { unit: 'points', scale: scale.map(Number) } : { unit: 'sizes', scale }
}

// The names pmkit gives an issue's state when no Status option names it: history moves use them, so discover lists them.
export const OPEN = 'Open'
export const CLOSED = 'Closed'
export const CLOSED_NOT_PLANNED = 'Closed as not planned'
const STATE_STATUSES = [{ name: OPEN, category: 'todo' }, { name: CLOSED, category: 'done' }, { name: CLOSED_NOT_PLANNED, category: 'canceled' }]

/**
 * The statuses of the discover result: each Status option with its mapped category, then Open, Closed and Closed as not planned,
 * each unless an option has that name. Without a Project, only those three.
 */
function statusesOf(raw, status, warnings) {
  if (raw.project === null) return labelStatusesOf(raw, status, warnings)
  const statusField = statusFieldOf(raw.project)
  if (!statusField) warnings.push(`GitHub Project ${raw.project.owner}/${raw.project.number} has no single-select Status field`)
  const categoryOf = new Map(Object.entries(status).filter(([category, value]) => category !== 'blocked' && typeof value === 'string' && value !== NONE).map(([category, value]) => [value, category]))
  const options = (statusField?.options ?? []).map(({ name }) => {
    const category = categoryOf.get(name)
    if (!category) warnings.push(`Status option ${name} has no category in mappings.status; issues in it count as in_progress`)
    return { name, category: category ?? 'in_progress' }
  })
  const taken = new Set(options.map((option) => option.name))
  return [...options, ...STATE_STATUSES.filter((entry) => !taken.has(entry.name)).map((entry) => ({ ...entry }))]
}

// The open categories a status label can stand for, in the order discover lists them.
const LABEL_CATEGORIES = ['triage', 'backlog', 'todo', 'in_progress', 'in_review']

/** Without a Project: each mapped status label with its category, then the state statuses. */
function labelStatusesOf(raw, status, warnings) {
  const rows = LABEL_CATEGORIES.flatMap((category) => {
    const name = parseLabelValue(status[category])
    return name ? [{ name: labelOf(raw, name)?.name ?? name, category }] : []
  })
  if (rows.length === 0) warnings.push('tracker.scope.project is none and no status label is mapped; issues read open as todo and closed as done')
  return [...rows, ...STATE_STATUSES.map((entry) => ({ ...entry }))]
}

/** The assignable users as members, ids by login, with the viewer first when GitHub leaves the viewer out. */
function membersOf(raw) {
  const member = (user) => ({ id: user.login, name: user.name ?? null, email: null })
  const users = (raw.users ?? []).map(member)
  const { login } = raw.viewer
  if (login && !users.some((user) => user.id === login)) users.unshift(member(raw.viewer))
  return users
}

/** The warning for the options of the mapped priority field that the priority rule maps to no priority, or null. */
function unsetPriorityWarning(raw, pmkit) {
  const found = fieldOf(raw, pmkit?.mappings?.fields?.priority)
  if (found?.dataType !== 'SINGLE_SELECT') return null
  const rule = priorityRule(found.options)
  const unset = found.options.map((item) => item.name).filter((name) => !rule.has(name))
  if (unset.length === 0) return null
  return `the priority field ${found.name} has options that map to no priority (${unset.join(', ')}); issues in them read with no priority`
}

/** The discover result. pmkit is config.pmkit; the raw discovery stays on it as a hidden property. */
export function discoveryView(raw, pmkit = {}) {
  const keptOf = { labels: LABELS_FIRST, 'assignable users': USERS_MAX }
  const warnings = raw.truncated.map((kind) => `GitHub has more ${kind} than discovery reads; it kept the first ${keptOf[kind] ?? FIRST}`)
  const statusOptions = (statusFieldOf(raw.project)?.options ?? []).map((item) => item.name)
  const statuses = statusesOf(raw, pmkit?.mappings?.status ?? {}, warnings)
  warnings.push(...brokenGithubMappings(raw, pmkit).map((item) => item.problem))
  const priorityWarning = unsetPriorityWarning(raw, pmkit)
  if (priorityWarning) warnings.push(priorityWarning)

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
    labels: raw.labels.map((label) => label.name),
    members: membersOf(raw),
    estimate: estimateOf(raw, pmkit),
    warnings,
  }
  Object.defineProperty(view, 'raw', { value: raw, enumerable: false })
  return view
}
