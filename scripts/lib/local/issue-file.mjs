// Reads and writes issues/<ID>/issue.md: YAML frontmatter plus a Markdown body.
// See the pmkit design spec, "Issue file".

import { PmkitError } from '../errors.mjs'
import { FrontmatterError, joinFrontmatter, parseYaml, splitFrontmatter } from '../yaml.mjs'

export const ISSUE_KEYS = [
  'id', 'title', 'type', 'status', 'priority', 'estimate', 'assignee', 'labels', 'parent',
  'blocked_by', 'related', 'duplicate_of', 'sprint', 'milestone', 'due', 'branch', 'archived',
  'created', 'updated',
]

const DESCRIPTION = 'Description'
const CRITERIA = 'Acceptance criteria'
const TASK_ITEM = /^- \[([ xX])\] (.*)$/

const normalize = (text) => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
const asList = (value) => (Array.isArray(value) ? value.map(String) : value == null ? [] : [String(value)])

const FENCE = /^(```|~~~)/

// The lines of a Markdown text that are outside fenced code blocks.
function unfencedLines(text) {
  let fence = false
  return text.split('\n').filter((line) => {
    if (!FENCE.test(line)) return !fence
    fence = !fence
    return false
  })
}

/** True when a line outside fenced code blocks starts with a git conflict marker. */
export const hasConflictMarkers = (text) => unfencedLines(text).some((line) => /^(<<<<<<< |>>>>>>> )/.test(line))

/** True when a line outside fenced code blocks is a `## ` heading, which would start a new section of the issue body. */
export const hasSectionHeading = (text) => unfencedLines(text).some((line) => line.startsWith('## '))

function assertNoConflict(text) {
  if (hasConflictMarkers(text)) {
    throw new PmkitError('CONFLICT', 'The issue file contains git conflict markers.', '/pmkit:local:doctor')
  }
}

// Splits a body into a preamble and one chunk per `## ` heading. Headings inside code fences do not count.
function splitSections(body) {
  const chunks = [{ title: null, text: '' }]
  let fence = false
  for (const line of body.split(/(?<=\n)/)) {
    if (FENCE.test(line)) fence = !fence
    const heading = !fence && line.match(/^## (.*?)\s*$/)
    if (heading) chunks.push({ title: heading[1], text: '' })
    chunks[chunks.length - 1].text += line
  }
  return chunks
}

const sectionLines = (chunk) => (chunk ? chunk.text.split('\n').slice(1) : [])

function readDescription(chunk) {
  return sectionLines(chunk).join('\n').trim()
}

function readCriteria(chunk) {
  return sectionLines(chunk)
    .map((line) => line.match(TASK_ITEM))
    .filter(Boolean)
    .map((match) => ({ text: match[2].trim(), done: match[1] !== ' ' }))
}

const trailingNewlines = (text) => text.match(/\n*$/)[0] || '\n'

function renderSection(title, content, trailing) {
  if (!content) return `## ${title}${trailing}`
  return `## ${title}\n\n${content}\n${trailing.slice(1)}`
}

export function parseIssueFile(text, { statuses = {} } = {}) {
  const normalized = normalize(text)
  assertNoConflict(normalized)
  const split = splitFrontmatter(normalized)
  if (!split) throw new PmkitError('INVALID_INPUT', 'The issue file has no frontmatter.', '/pmkit:local:doctor')
  let data
  try {
    data = parseYaml(split.yaml)
  } catch (error) {
    if (!(error instanceof FrontmatterError)) throw error
    throw new PmkitError('INVALID_INPUT', `The issue frontmatter does not parse: ${error.message}`, '/pmkit:local:doctor')
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new PmkitError('INVALID_INPUT', 'The issue frontmatter is not a map.', '/pmkit:local:doctor')
  }

  const body = split.body.replace(/^\n/, '')
  const chunks = splitSections(body)
  const named = (title) => chunks.find((chunk) => chunk.title === title)
  const statusName = data.status == null ? '' : String(data.status)

  const issue = {
    id: String(data.id ?? ''),
    title: String(data.title ?? ''),
    status: { name: statusName, category: statuses[statusName]?.category ?? null },
    labels: asList(data.labels),
    blockedBy: asList(data.blocked_by),
    blocks: [],
    related: asList(data.related),
    duplicateOf: asList(data.duplicate_of),
    children: [],
    archived: data.archived === true,
    description: readDescription(named(DESCRIPTION)),
    acceptanceCriteria: readCriteria(named(CRITERIA)),
    created: data.created == null ? undefined : String(data.created),
    updated: data.updated == null ? undefined : String(data.updated),
    body,
  }
  for (const key of ['type', 'priority', 'estimate', 'assignee', 'parent', 'sprint', 'milestone', 'due', 'branch']) {
    if (data[key] != null) issue[key] = data[key]
  }
  for (const key of ['created', 'updated']) if (issue[key] === undefined) delete issue[key]
  return issue
}

/** The frontmatter values of an issue, keyed as they are written to the file. */
export function toFrontmatter(issue) {
  return {
    id: issue.id,
    title: issue.title,
    type: issue.type,
    status: issue.status?.name,
    priority: issue.priority,
    estimate: issue.estimate,
    assignee: issue.assignee,
    labels: issue.labels,
    parent: issue.parent,
    blocked_by: issue.blockedBy,
    related: issue.related,
    duplicate_of: issue.duplicateOf,
    sprint: issue.sprint,
    milestone: issue.milestone,
    due: issue.due,
    branch: issue.branch,
    archived: issue.archived ? true : undefined,
    created: issue.created,
    updated: issue.updated,
  }
}

// Replaces the description and criteria sections that changed and keeps every other line.
function updateBody(issue) {
  const body = issue.body ?? ''
  const chunks = splitSections(body)
  const named = (title) => chunks.find((chunk) => chunk.title === title)
  const description = (issue.description ?? '').trim()
  const criteria = (issue.acceptanceCriteria ?? []).map(({ text, done }) => ({ text: text.trim(), done: Boolean(done) }))
  const criteriaContent = criteria.map(({ text, done }) => `- [${done ? 'x' : ' '}] ${text}`).join('\n')
  const wanted = [
    [DESCRIPTION, description !== readDescription(named(DESCRIPTION)), description],
    [CRITERIA, JSON.stringify(criteria) !== JSON.stringify(readCriteria(named(CRITERIA))), criteriaContent],
  ]

  for (const [title, changed, content] of wanted) {
    if (!changed) continue
    const chunk = named(title)
    if (chunk) chunk.text = renderSection(title, content, trailingNewlines(chunk.text))
    else if (content) {
      const last = chunks[chunks.length - 1]
      if (last.text && !last.text.endsWith('\n\n')) last.text += last.text.endsWith('\n') ? '\n' : '\n\n'
      chunks.push({ title, text: renderSection(title, content, '\n') })
    }
  }
  return chunks.map((chunk) => chunk.text).join('')
}

export function serializeIssue(issue) {
  return joinFrontmatter(toFrontmatter(issue), updateBody(issue), { order: ISSUE_KEYS })
}
