// The Local tracker: issues as files under .issues/. Every write goes through
// `change` (existing issue) or `createIssue`, and both end in `save`.

import fs from 'node:fs'
import path from 'node:path'
import { requireActor, gitUserEmail } from '../actor.mjs'
import { loadConfig } from '../config.mjs'
import { PmkitError } from '../errors.mjs'
import { joinFrontmatter, parseYaml, splitFrontmatter } from '../yaml.mjs'
import { isId, newId, normalizeId } from '../ids.mjs'
import { CATEGORIES, LINK_KINDS, TERMINAL } from '../model.mjs'
import { appendEvents, driftEvents, readEvents } from './events.mjs'
import {
  HEALTH, epicFrontmatter, parseEpicFile, parseUpdateFile, serializeEpic, serializeUpdate, sortEpics, sortUpdates, walkParents,
} from './epics.mjs'
import { parseIssueFile, serializeIssue, toFrontmatter } from './issue-file.mjs'
import { checkFilter, runQuery } from './query.mjs'
import {
  SPRINT_STATES, addDays, overlaps, readSprint, readSprints, requireCapacity, serializeSprint, validDate,
} from './sprints.mjs'
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

function checkKeys(input, allowed) {
  for (const key of Object.keys(input)) {
    if (allowed.includes(key)) continue
    if (Object.hasOwn(OWNED, key)) throw invalid(`${key} cannot be set here`, OWNED[key])
    throw invalid(`unknown field "${key}"`, `Use one of: ${allowed.join(', ')}`)
  }
}

export function createLocalTracker(root, { config = loadConfig(root), now = () => new Date(), random, gitEmail, env = process.env } = {}) {
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

  /** Every issue that parses, and a problem for each file that does not (conflict markers, bad frontmatter). */
  function readAll() {
    const issues = []
    const problems = []
    for (const id of listIssueIds(issuesDir, local.id_prefix)) {
      try {
        issues.push(readIssue(id).issue)
      } catch (error) {
        if (!(error instanceof PmkitError)) throw error
        problems.push({ id, code: error.code, message: error.message })
      }
    }
    return { issues, problems }
  }

  const scanIssues = () => readAll().issues

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

  const sprintsDir = path.join(issuesDir, 'sprints')
  const today = () => now().toISOString().slice(0, 10)

  function getSprint(id) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(id)) || !fs.existsSync(path.join(sprintsDir, `${id}.yaml`))) {
      throw new PmkitError('NOT_FOUND', `sprint ${id} does not exist`, 'pmkit sprints list')
    }
    return readSprint(sprintsDir, String(id))
  }

  function listCycles({ state } = {}) {
    if (state !== undefined) oneOf('state', state, SPRINT_STATES)
    return readSprints(sprintsDir).filter((sprint) => state === undefined || sprint.state === state)
  }

  const currentCycle = () => listCycles({ state: 'active' })[0] ?? null
  const activeSprintId = () => currentCycle()?.id ?? null

  function searchIssues(filter = {}) {
    checkFilter(filter)
    const resolved = { ...filter }
    if (filter.assignee === 'me') {
      resolved.assignee = requireActor(local, { email: gitEmail ?? gitUserEmail(root), env }).id
    }
    if (filter.sprint === 'current') resolved.sprint = activeSprintId()
    const { issues, problems } = readAll()
    const found = runQuery(issues, resolved, { priorities: local.priorities })
    return { issues: found.map((issue) => withComputed(issue, issues)), problems }
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

  // The parent of an issue on disk. Epics, missing issues and issues without a parent end the chain.
  function parentOfIssue(id) {
    if (!isId(id, local.id_prefix) || !fs.existsSync(issuePaths(issuesDir, id).file)) return undefined
    return readIssue(id).issue.parent
  }

  function setParent(id, parent, actor, { dryRun = false } = {}) {
    requireMember(actor, 'actor')
    const self = knownIssue(id)
    const next = parent === null ? null : requireParent(parent)
    if (next === self) throw invalid(`${self} cannot be its own parent`)
    if (next !== null) {
      const { chain, loop } = walkParents(next, parentOfIssue)
      const at = chain.indexOf(self)
      if (at >= 0) throw invalid(`parent loop: ${[self, ...chain.slice(0, at + 1)].join(' → ')}`)
      if (loop) throw invalid(`parent loop: ${chain.join(' → ')}`)
    }
    return change(self, actor, { dryRun }, (issue, meta, before) => {
      if ((before.parent ?? null) === next) return []
      if (next === null) delete issue.parent
      else issue.parent = next
      return [fieldEvent('update', 'parent', before, issue, meta)]
    })
  }

  const fileSafe = (text) => text.replaceAll(':', '-')

  function readComment(id, file) {
    const split = splitFrontmatter(fs.readFileSync(file, 'utf8'))
    const data = split ? parseYaml(split.yaml) : {}
    return {
      id: path.basename(file, '.md'),
      issue: id,
      author: String(data.author ?? ''),
      body: split ? split.body.trim() : '',
      created: String(data.created ?? ''),
    }
  }

  function comment(id, body, actor, { dryRun = false } = {}) {
    if (typeof body !== 'string' || body.trim() === '') throw invalid('comment body must be a non-empty string')
    let written
    // Settles drift and logs the event without rewriting issue.md; the comment lives in its own file.
    change(id, actor, { dryRun, eventsOnly: true }, (issue, meta) => {
      const dir = issuePaths(issuesDir, issue.id).comments
      const base = `${fileSafe(meta.at)}-${fileSafe(actor)}`
      let name = base
      for (let n = 2; fs.existsSync(path.join(dir, `${name}.md`)); n++) name = `${base}-${n}`
      written = { id: name, issue: issue.id, author: actor, body: body.trim(), created: meta.at }
      if (!dryRun) {
        fs.mkdirSync(dir, { recursive: true })
        writeFileAtomic(path.join(dir, `${name}.md`), joinFrontmatter({ author: actor, created: meta.at }, `${written.body}\n`, { order: ['author', 'created'] }))
      }
      return [{ ...meta, op: 'comment', to: `${name}.md` }]
    })
    return written
  }

  function listComments(id) {
    const { issue, paths } = readIssue(id)
    if (!fs.existsSync(paths.comments)) return []
    return fs.readdirSync(paths.comments)
      .filter((name) => name.endsWith('.md'))
      .map((name) => readComment(issue.id, path.join(paths.comments, name)))
      .sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  function getHistory(id, { since } = {}) {
    const { events } = readEvents(readIssue(id).paths.events)
    return since === undefined ? events : events.filter((event) => event.at >= since)
  }

  function logTime(id, minutes, actor, { dryRun = false } = {}) {
    if (!Number.isInteger(minutes) || minutes <= 0) throw invalid('minutes must be a positive integer')
    return change(id, actor, { dryRun, eventsOnly: true }, (issue, meta) => [{ ...meta, op: 'log_time', minutes }])
  }

  function cycleIssues(id) {
    return searchIssues({ sprint: getSprint(id).id }).issues
  }

  function writeSprint(before, after, { dryRun }) {
    if (!dryRun) {
      fs.mkdirSync(sprintsDir, { recursive: true })
      writeFileAtomic(path.join(sprintsDir, `${after.id}.yaml`), serializeSprint(after))
    }
    return { before, after }
  }

  function openCycle(input, actor, { dryRun = false } = {}) {
    requireMember(actor, 'actor')
    const allowed = ['start', 'end', 'goal', 'name']
    for (const key of Object.keys(input)) {
      if (!allowed.includes(key)) throw invalid(`unknown field "${key}"`, `Use one of: ${allowed.join(', ')}`)
    }
    const { start } = input
    if (!validDate(start)) throw invalid('start must be a date as YYYY-MM-DD')
    const end = input.end ?? addDays(start, local.defaults.sprint_length_days - 1)
    if (!validDate(end)) throw invalid('end must be a date as YYYY-MM-DD')
    if (start > end) throw invalid(`start ${start} is after end ${end}`)
    const name = input.name ?? `Sprint ${start}`
    if (typeof name !== 'string' || name.trim() === '') throw invalid('name must be a non-empty string')
    const goal = input.goal ?? ''
    if (typeof goal !== 'string') throw invalid('goal must be a string')
    const existing = listCycles()
    if (existing.some((sprint) => sprint.id === start)) throw invalid(`a sprint file for ${start} already exists`, 'pmkit sprints list')
    const clash = existing.find((sprint) => sprint.state !== 'closed' && overlaps(sprint, { start, end }))
    if (clash) throw invalid(`sprint ${start} to ${end} overlaps ${clash.id} (${clash.start} to ${clash.end})`, 'pmkit sprints list')
    const state = start <= today() && !existing.some((sprint) => sprint.state === 'active') ? 'active' : 'planned'
    const sprint = { id: start, name: name.trim(), start, end, goal, state, capacity: {}, daysOff: {} }
    return writeSprint(null, sprint, { dryRun })
  }

  function closeCycle(id, actor, { dryRun = false } = {}) {
    requireMember(actor, 'actor')
    const before = getSprint(id)
    if (before.state !== 'active') throw invalid(`sprint ${before.id} is not active (it is ${before.state})`, 'pmkit sprints list')
    const { after } = writeSprint(before, { ...before, state: 'closed' }, { dryRun })
    const unfinished = cycleIssues(before.id).filter((issue) => !TERMINAL.includes(issue.status.category))
    return { sprint: after, unfinished }
  }

  function moveToCycle(ids, sprint, actor, { dryRun = false } = {}) {
    requireMember(actor, 'actor')
    if (!Array.isArray(ids) || ids.length === 0) throw invalid('ids must be a non-empty list')
    const known = ids.map(knownIssue)
    if (sprint !== null) getSprint(sprint)
    return known.map((id) => updateIssue(id, { sprint }, actor, { dryRun }))
  }

  const getCapacity = (id) => getSprint(id).capacity

  function setCapacity(id, map, actor, { dryRun = false } = {}) {
    requireMember(actor, 'actor')
    const before = getSprint(id)
    return writeSprint(before, { ...before, capacity: requireCapacity(map, local.members) }, { dryRun })
  }

  const epicsDir = path.join(issuesDir, 'epics')

  function readEpic(id) {
    const normalized = normalizeId(String(id))
    const file = path.join(epicsDir, normalized, 'epic.md')
    if (!isId(normalized, local.epic_prefix) || !fs.existsSync(file)) {
      throw new PmkitError('NOT_FOUND', `epic ${id} does not exist`, 'pmkit epic list')
    }
    return { epic: parseEpicFile(fs.readFileSync(file, 'utf8'), { statuses: local.statuses }), dir: path.join(epicsDir, normalized) }
  }

  const getDeliverable = (id) => readEpic(id).epic

  function listDeliverables() {
    if (!fs.existsSync(epicsDir)) return []
    const ids = fs.readdirSync(epicsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isId(entry.name, local.epic_prefix) && fs.existsSync(path.join(epicsDir, entry.name, 'epic.md')))
      .map((entry) => entry.name)
    return sortEpics(ids.map(getDeliverable))
  }

  function createDeliverable(input, actor, { dryRun = false } = {}) {
    requireMember(actor, 'actor')
    const allowed = ['title', 'start', 'target', 'milestone', 'description']
    for (const key of Object.keys(input)) {
      if (!allowed.includes(key)) throw invalid(`unknown field "${key}"`, `Use one of: ${allowed.join(', ')}`)
    }
    const epic = { id: '', title: NORMALIZE.title(input.title), status: statusOf(local.default_status), description: '' }
    for (const key of ['start', 'target']) {
      if (blank(input[key])) continue
      if (!validDate(input[key])) throw invalid(`${key} must be a date as YYYY-MM-DD`)
      epic[key] = input[key]
    }
    if (!blank(input.milestone)) epic.milestone = NORMALIZE.milestone(input.milestone)
    if (!blank(input.description)) epic.description = NORMALIZE.description(input.description)
    epic.id = newId(local.epic_prefix, { random, exists: (candidate) => fs.existsSync(path.join(epicsDir, candidate)) })
    const content = serializeEpic(epic)
    if (!dryRun) {
      const dir = path.join(epicsDir, epic.id)
      fs.mkdirSync(dir, { recursive: true })
      writeFileAtomic(path.join(dir, 'epic.md'), content)
      appendEvents(path.join(dir, 'events.jsonl'), [{ at: stamp(), by: actor, op: 'create', to: epicFrontmatter(epic) }])
    }
    return { before: null, after: parseEpicFile(content, { statuses: local.statuses }) }
  }

  /** Counts the non-archived issues whose parent chain reaches the epic. */
  function deliverableProgress(id) {
    const { id: epic } = getDeliverable(id)
    const issues = scanIssues()
    const byId = new Map(issues.map((issue) => [issue.id, issue]))
    const parentOf = (key) => byId.get(key)?.parent
    const progress = { total: 0, done: 0, canceled: 0, points: 0, pointsDone: 0, byCategory: Object.fromEntries(CATEGORIES.map((category) => [category, 0])) }
    for (const issue of issues) {
      if (issue.archived || !walkParents(issue.id, parentOf).chain.includes(epic)) continue
      const { category } = issue.status
      if (category in progress.byCategory) progress.byCategory[category]++
      if (category === 'canceled') {
        progress.canceled++
        continue
      }
      progress.total++
      if (category === 'done') progress.done++
      if (typeof issue.estimate === 'number') {
        progress.points += issue.estimate
        if (category === 'done') progress.pointsDone += issue.estimate
      }
    }
    return progress
  }

  function publishStatusUpdate(input, actor, { dryRun = false } = {}) {
    requireMember(actor, 'actor')
    const { epic, dir } = readEpic(input.epic)
    oneOf('health', input.health, HEALTH)
    if (typeof input.body !== 'string' || input.body.trim() === '') throw invalid('status update body must be a non-empty string')
    const at = stamp()
    const update = { epic: epic.id, at, author: actor, health: input.health, body: input.body.trim() }
    if (!dryRun) {
      const updates = path.join(dir, 'updates')
      const base = `${at.slice(0, 10)}-${fileSafe(actor)}`
      let name = base
      for (let n = 2; fs.existsSync(path.join(updates, `${name}.md`)); n++) name = `${base}-${n}`
      fs.mkdirSync(updates, { recursive: true })
      writeFileAtomic(path.join(updates, `${name}.md`), serializeUpdate(update))
    }
    return { before: null, after: update }
  }

  function listStatusUpdates(id) {
    const { epic, dir } = readEpic(id)
    const updates = path.join(dir, 'updates')
    if (!fs.existsSync(updates)) return []
    const entries = fs.readdirSync(updates)
      .filter((name) => name.endsWith('.md'))
      .map((name) => ({ name, update: parseUpdateFile(fs.readFileSync(path.join(updates, name), 'utf8'), epic.id) }))
    return sortUpdates(entries).map((entry) => entry.update)
  }

  return {
    listDeliverables, getDeliverable, createDeliverable, deliverableProgress, publishStatusUpdate, listStatusUpdates,
    getIssue, searchIssues, createIssue, updateIssue, moveToCategory, assign, archive, link, unlink, setParent,
    comment, listComments, getHistory, logTime,
    listCycles, currentCycle, cycleIssues, openCycle, closeCycle, moveToCycle, getCapacity, setCapacity,
  }
}
