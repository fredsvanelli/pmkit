// The Local tracker: issues as files under .issues/. Every write goes through
// `change` (existing issue) or `createIssue`, and both end in `save`.

import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from '../config.mjs'
import { PmkitError } from '../errors.mjs'
import { isId, newId, normalizeId } from '../ids.mjs'
import { CATEGORIES, LINK_KINDS } from '../model.mjs'
import { appendEvents, driftEvents, readEvents } from './events.mjs'
import { parseIssueFile, serializeIssue, toFrontmatter } from './issue-file.mjs'
import { fileMtimeIso, issuePaths, listIssueIds, writeFileAtomic } from './store.mjs'

const CREATE_KEYS = [
  'title', 'type', 'status', 'priority', 'estimate', 'assignee', 'labels', 'parent', 'sprint',
  'milestone', 'due', 'branch', 'description', 'acceptanceCriteria',
]
const UPDATE_KEYS = [
  'title', 'type', 'priority', 'estimate', 'labels', 'sprint', 'milestone', 'due', 'branch',
  'description', 'acceptanceCriteria',
]
// Fields another operation owns, with the command that writes them. An empty string means no next step.
const OWNED = {
  id: '',
  created: '',
  status: 'pmkit issues move',
  assignee: 'pmkit issues assign',
  parent: 'pmkit issues parent',
  blockedBy: 'pmkit issues link',
  related: 'pmkit issues link',
  duplicateOf: 'pmkit issues link',
  archived: 'pmkit issues archive',
}
const LINKS = {
  blocks: { field: 'blocked_by', prop: 'blockedBy' },
  related: { field: 'related', prop: 'related' },
  duplicate: { field: 'duplicate_of', prop: 'duplicateOf' },
}
const BODY_FIELDS = { description: 'description', acceptanceCriteria: 'acceptance_criteria' }

const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep || undefined)
const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')
const blank = (value) => value === undefined || value === null

function validDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  return new Date(`${text}T00:00:00Z`).toISOString().startsWith(text)
}

function checkKeys(input, allowed) {
  for (const key of Object.keys(input)) {
    if (allowed.includes(key)) continue
    if (Object.hasOwn(OWNED, key)) throw invalid(`${key} cannot be set here`, OWNED[key])
    throw invalid(`unknown field "${key}"`, `Use one of: ${allowed.join(', ')}`)
  }
}

export function createLocalTracker(root, { config = loadConfig(root), now = () => new Date(), random } = {}) {
  const { local, issuesDir } = config
  const stamp = () => isoSeconds(now())

  const statusOf = (name) => ({ name, category: local.statuses[name]?.category ?? null })
  const oneOf = (field, value, allowed) => {
    if (!allowed.includes(value)) throw invalid(`${field} must be one of ${allowed.join(', ')}`)
    return value
  }

  function requireMember(id, label) {
    if (typeof id !== 'string' || !Object.hasOwn(local.members, id)) {
      throw invalid(`${label} "${id}" is not a member`, `Use one of: ${Object.keys(local.members).join(', ')}`)
    }
    return id
  }

  function requireEstimate(value) {
    const { unit, scale } = local.estimate
    if (unit === 'hours') {
      if (typeof value !== 'number' || !(value > 0)) throw invalid('estimate must be a positive number of hours')
    } else if (!scale.includes(value)) {
      throw invalid(`estimate must be one of ${scale.join(', ')}`)
    }
    return value
  }

  function requireParent(value) {
    const id = normalizeId(String(value))
    const issue = isId(id, local.id_prefix) && fs.existsSync(issuePaths(issuesDir, id).dir)
    const epic = isId(id, local.epic_prefix) && fs.existsSync(path.join(issuesDir, 'epics', id, 'epic.md'))
    if (!issue && !epic) throw invalid(`parent ${value} is not an existing issue or epic`, 'pmkit issues list')
    return id
  }

  function requireSprint(value) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(value)) || !fs.existsSync(path.join(issuesDir, 'sprints', `${value}.yaml`))) {
      throw invalid(`sprint ${value} does not exist`, 'pmkit sprints list')
    }
    return String(value)
  }

  function requireLabels(value) {
    if (!Array.isArray(value) || !value.every((label) => typeof label === 'string')) throw invalid('labels must be a list of strings')
    if (local.labels.length > 0) for (const label of value) oneOf('label', label, local.labels)
    return value
  }

  function requireCriteria(value) {
    if (!Array.isArray(value)) throw invalid('acceptanceCriteria must be a list')
    return value.map((item) => {
      const text = typeof item === 'string' ? item : item?.text
      if (typeof text !== 'string' || text.trim() === '') throw invalid('each acceptance criterion needs text')
      return { text: text.trim(), done: item?.done === true }
    })
  }

  const text = (field) => (value) => {
    if (typeof value !== 'string') throw invalid(`${field} must be a string`)
    return value
  }

  // A normalizer per input field. Optional fields accept null to clear them.
  const NORMALIZE = {
    title: (value) => {
      if (typeof value !== 'string' || value.trim() === '') throw invalid('title is required')
      return value.trim()
    },
    type: (value) => oneOf('type', value, local.types),
    status: (value) => oneOf('status', value, Object.keys(local.statuses)),
    priority: (value) => oneOf('priority', value, local.priorities),
    estimate: requireEstimate,
    assignee: (value) => requireMember(value, 'assignee'),
    labels: requireLabels,
    parent: requireParent,
    sprint: requireSprint,
    milestone: text('milestone'),
    due: (value) => {
      if (!validDate(value)) throw invalid('due must be a date as YYYY-MM-DD')
      return value
    },
    branch: text('branch'),
    description: (value) => text('description')(value).trim(),
    acceptanceCriteria: requireCriteria,
  }
  const REQUIRED = ['title', 'type', 'status']

  function applyFields(issue, input) {
    for (const [key, value] of Object.entries(input)) {
      if (blank(value) && !REQUIRED.includes(key)) {
        if (key === 'labels') issue.labels = []
        else if (key === 'description') issue.description = ''
        else if (key === 'acceptanceCriteria') issue.acceptanceCriteria = []
        else delete issue[key]
      } else if (key === 'status') {
        issue.status = statusOf(NORMALIZE.status(value))
      } else {
        issue[key] = NORMALIZE[key](value)
      }
    }
    return issue
  }

  function readIssue(id) {
    const normalized = normalizeId(String(id))
    const paths = issuePaths(issuesDir, normalized)
    if (!isId(normalized, local.id_prefix) || !fs.existsSync(paths.file)) {
      throw new PmkitError('NOT_FOUND', `issue ${id} does not exist`, 'pmkit issues list')
    }
    const issue = parseIssueFile(fs.readFileSync(paths.file, 'utf8'), { statuses: local.statuses })
    return { issue, paths }
  }

  // The returned issue is what a reader sees after the write, so parse the text that gets saved.
  function save(issue, events, paths, { dryRun }) {
    const content = serializeIssue(issue)
    if (!dryRun) {
      fs.mkdirSync(paths.dir, { recursive: true })
      writeFileAtomic(paths.file, content)
      appendEvents(paths.events, events)
    }
    return parseIssueFile(content, { statuses: local.statuses })
  }

  /** The one write path for existing issues: settle drift, then let `edit` return the next issue and its events. */
  function change(id, actor, { dryRun = false, eventsOnly = false } = {}, edit) {
    requireMember(actor, 'actor')
    const { issue: before, paths } = readIssue(id)
    const logged = readEvents(paths.events).events
    const newest = logged.length > 0 ? logged[logged.length - 1].at : ''
    const mtime = fileMtimeIso(paths.file)
    const drift = driftEvents(toFrontmatter(before), logged, { at: mtime > newest ? mtime : newest, by: actor })
    if (!dryRun) appendEvents(paths.events, drift)
    const at = stamp()
    const next = structuredClone(before)
    const events = edit(next, { at, by: actor }, before)
    if (events.length === 0) return { before, after: before }
    if (eventsOnly) {
      if (!dryRun) appendEvents(paths.events, events)
      return { before, after: before }
    }
    next.updated = at
    return { before, after: save(next, events, paths, { dryRun }) }
  }

  const fieldEvent = (op, field, before, after, meta) => ({
    ...meta, op, field, from: toFrontmatter(before)[field] ?? null, to: toFrontmatter(after)[field] ?? null,
  })

  /** Every issue that parses. A file with conflict markers or bad frontmatter is skipped. */
  function scanIssues() {
    return listIssueIds(issuesDir, local.id_prefix).flatMap((id) => {
      try {
        return [readIssue(id).issue]
      } catch (error) {
        if (error instanceof PmkitError) return []
        throw error
      }
    })
  }

  /** Fills `blocks` and `children` on an issue from the other issues. */
  function withComputed(issue, all = scanIssues()) {
    return {
      ...issue,
      blocks: all.filter((other) => other.blockedBy.includes(issue.id)).map((other) => other.id),
      children: all.filter((other) => other.parent === issue.id).map((other) => other.id),
    }
  }

  function getIssue(id) {
    return withComputed(readIssue(id).issue)
  }

  function createIssue(input, actor, { dryRun = false } = {}) {
    requireMember(actor, 'actor')
    checkKeys(input, CREATE_KEYS)
    const at = stamp()
    const issue = applyFields({
      id: '',
      title: '',
      type: local.types[0],
      status: statusOf(local.default_status),
      labels: [],
      blockedBy: [],
      blocks: [],
      related: [],
      duplicateOf: [],
      children: [],
      archived: false,
      description: '',
      acceptanceCriteria: [],
      created: at,
      updated: at,
      body: '',
    }, input)
    if (!input.title) throw invalid('title is required')
    const id = newId(local.id_prefix, { random, exists: (candidate) => fs.existsSync(issuePaths(issuesDir, candidate).dir) })
    issue.id = id
    const event = { at, by: actor, op: 'create', to: toFrontmatter(issue) }
    return { before: null, after: save(issue, [event], issuePaths(issuesDir, id), { dryRun }) }
  }

  function updateIssue(id, patch, actor, options) {
    checkKeys(patch, UPDATE_KEYS)
    return change(id, actor, options, (issue, meta, before) => {
      applyFields(issue, patch)
      return Object.keys(patch).flatMap((key) => {
        if (BODY_FIELDS[key]) {
          const same = JSON.stringify(issue[key]) === JSON.stringify(before[key])
          return same ? [] : [{ ...meta, op: 'update', field: BODY_FIELDS[key] }]
        }
        const event = fieldEvent('update', key, before, issue, meta)
        return JSON.stringify(event.from) === JSON.stringify(event.to) ? [] : [event]
      })
    })
  }

  function moveToCategory(id, category, actor, { status, dryRun } = {}) {
    oneOf('category', category, CATEGORIES)
    const inCategory = Object.keys(local.statuses).filter((name) => local.statuses[name].category === category)
    const name = status ?? inCategory[0]
    if (!inCategory.includes(name)) throw invalid(`status ${name} is not in category ${category}`, `Use one of: ${inCategory.join(', ')}`)
    return change(id, actor, { dryRun }, (issue, meta, before) => {
      if (before.status.name === name) return []
      issue.status = statusOf(name)
      return [fieldEvent('move', 'status', before, issue, meta)]
    })
  }

  function assign(id, member, actor, { dryRun } = {}) {
    if (member !== null) requireMember(member, 'assignee')
    return change(id, actor, { dryRun }, (issue, meta, before) => {
      if ((before.assignee ?? null) === member) return []
      if (member === null) delete issue.assignee
      else issue.assignee = member
      return [fieldEvent('assign', 'assignee', before, issue, meta)]
    })
  }

  function archive(id, actor, { dryRun } = {}) {
    return change(id, actor, { dryRun }, (issue, meta, before) => {
      if (before.archived) return []
      issue.archived = true
      return [{ ...meta, op: 'archive' }]
    })
  }

  const knownIssue = (id) => readIssue(id).issue.id

  function listEdit(op, prop, field, other) {
    return (issue, meta, before) => {
      if (before[prop].includes(other) === (op === 'unlink')) {
        issue[prop] = op === 'link' ? [...before[prop], other] : before[prop].filter((item) => item !== other)
        return [{ ...meta, op, field, to: other }]
      }
      return []
    }
  }

  // The shortest path from `start` to `goal` along "blocks" edges, or null.
  function blockPath(start, goal, all) {
    const queue = [[start]]
    const seen = new Set([start])
    while (queue.length > 0) {
      const trail = queue.shift()
      const last = trail[trail.length - 1]
      if (last === goal) return trail
      for (const next of all.filter((issue) => issue.blockedBy.includes(last)).map((issue) => issue.id)) {
        if (!seen.has(next)) {
          seen.add(next)
          queue.push([...trail, next])
        }
      }
    }
    return null
  }

  function relate(op, from, to, kind, actor, { dryRun = false } = {}) {
    requireMember(actor, 'actor')
    if (!LINK_KINDS.includes(kind)) throw invalid(`kind must be one of ${LINK_KINDS.join(', ')}`)
    const a = knownIssue(from)
    const b = knownIssue(to)
    if (a === b) throw invalid(`${a} cannot be linked to itself`)
    const { field, prop } = LINKS[kind]
    const options = { dryRun }
    if (kind === 'blocks') {
      const all = scanIssues()
      const before = withComputed(all.find((issue) => issue.id === a), all)
      const closing = op === 'link' ? blockPath(b, a, all) : null
      if (closing) throw invalid(`${a} blocks ${b} would close a cycle: ${[a, ...closing].join(' → ')}`)
      const written = change(b, actor, options, listEdit(op, prop, field, a))
      const changed = written.after !== written.before
      const blocks = op === 'link' ? [...before.blocks, b].sort() : before.blocks.filter((item) => item !== b)
      return { before, after: changed ? { ...before, blocks } : before }
    }
    const result = change(a, actor, options, listEdit(op, prop, field, b))
    if (kind !== 'related') return result
    return { ...result, other: change(b, actor, options, listEdit(op, prop, field, a)) }
  }

  const link = (from, to, kind, actor, options) => relate('link', from, to, kind, actor, options)
  const unlink = (from, to, kind, actor, options) => relate('unlink', from, to, kind, actor, options)

  function setParent(id, parent, actor, { dryRun = false } = {}) {
    requireMember(actor, 'actor')
    const self = knownIssue(id)
    const next = parent === null ? null : requireParent(parent)
    if (next !== null) {
      const chain = [self, next]
      let current = next
      while (current !== undefined && isId(current, local.id_prefix)) {
        const up = readIssue(current).issue.parent
        if (up === undefined) break
        chain.push(up)
        if (up === self) throw invalid(`parent loop: ${chain.join(' → ')}`)
        current = up
      }
      if (next === self) throw invalid(`${self} cannot be its own parent`)
    }
    return change(self, actor, { dryRun }, (issue, meta, before) => {
      if ((before.parent ?? null) === next) return []
      if (next === null) delete issue.parent
      else issue.parent = next
      return [fieldEvent('update', 'parent', before, issue, meta)]
    })
  }

  return { getIssue, createIssue, updateIssue, moveToCategory, assign, archive, link, unlink, setParent }
}
