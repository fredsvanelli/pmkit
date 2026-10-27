// The Local tracker: issues as files under .issues/. Every write goes through
// `change` (existing issue) or `createIssue`, and both end in `save`.

import fs from 'node:fs'
import path from 'node:path'
import { requireActor, gitUserEmail } from '../actor.mjs'
import { loadConfig, validateLocalConfig } from '../config.mjs'
import { PmkitError } from '../errors.mjs'
import { joinFrontmatter, parseYaml, splitFrontmatter } from '../yaml.mjs'
import { isBranchName, isId, newId, nextNumberedId, normalizeId } from '../ids.mjs'
import { CATEGORIES, LINK_KINDS, TERMINAL } from '../model.mjs'
import { appendEvents, driftEvents, readEvents } from './events.mjs'
import { formatError } from './migrations.mjs'
import {
  HEALTH, epicFrontmatter, parseEpicFile, parseUpdateFile, serializeEpic, serializeUpdate, sortEpics, sortUpdates, walkParents,
} from './epics.mjs'
import { hasSectionHeading, parseIssueFile, serializeIssue, toFrontmatter } from './issue-file.mjs'
import { buildCapabilities } from '../capabilities.mjs'
import { lastEntry } from '../metrics.mjs'
import { createDocumentFile, readDocumentFile } from './documents.mjs'
import { hasMilestoneFiles, milestoneStems, parseMilestone, serializeMilestone, sortMilestones, validMilestoneId } from './milestones.mjs'
import { parseRelease, releaseStems, serializeRelease, sortReleases, validReleaseId, validTag } from './releases.mjs'
import { checkFilter, runQuery } from './query.mjs'
import { CACHE_DIR, INDEX_FILE, clearIndex, indexHeader, readThroughIndex } from './query-index.mjs'
import {
  SPRINT_STATES, addDays, overlaps, parseSprint, readSprint, readSprints, requireCapacity, requireDaysOff, serializeSprint, validDate,
} from './sprints.mjs'
import { fileMtimeIso, issuePaths, listIssueIds, writeFileAtomic } from './store.mjs'

const CREATE_KEYS = [
  'title', 'type', 'status', 'priority', 'estimate', 'assignee', 'labels', 'parent', 'sprint',
  'milestone', 'release', 'due', 'branch', 'description', 'acceptanceCriteria',
]
const UPDATE_KEYS = [
  'title', 'type', 'priority', 'estimate', 'labels', 'sprint', 'milestone', 'release', 'due', 'branch',
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
const HEADING_STEP = 'Use ### or deeper headings inside the description'

// Single-line fields are written as one YAML or Markdown line, so a line break would break the file.
function oneLine(field, value) {
  if (/[\r\n]/.test(value)) throw invalid(`${field} must not contain a line break`)
  return value
}

function noSectionHeading(field, value) {
  if (hasSectionHeading(value)) throw invalid(`${field} has a line starting with "## ", which would end the section`, HEADING_STEP)
  return value
}

/** Parses the text a write is about to save, so a text that would not read back is refused before anything is written. */
function readBack(label, parse) {
  try {
    return parse()
  } catch (error) {
    if (!(error instanceof PmkitError)) throw error
    const step = error.code === 'CONFLICT' ? 'Put example conflict markers inside a fenced code block' : undefined
    throw invalid(`the ${label} would not read back after this write: ${error.message}`, step)
  }
}

function checkKeys(input, allowed) {
  for (const key of Object.keys(input)) {
    if (allowed.includes(key)) continue
    if (Object.hasOwn(OWNED, key)) throw invalid(`${key} cannot be set here`, OWNED[key])
    throw invalid(`unknown field "${key}"`, `Use one of: ${allowed.join(', ')}`)
  }
}

export function createLocalTracker(root, {
  config = loadConfig(root), now = () => new Date(), random, gitEmail, env = process.env, index = true, onIndexRead = () => {},
} = {}) {
  const { local } = config
  if (![true, 'read', false].includes(index)) throw invalid('index must be true, read or false')
  // An older format is read from its migrated copy; see loadConfig.
  const issuesDir = config.readDir ?? config.issuesDir
  const stamp = () => isoSeconds(now())
  // Every file this tracker writes, so auto_commit can commit those paths and nothing else.
  const writtenPaths = new Set()
  const writeFile = (file, text) => {
    writeFileAtomic(file, text)
    writtenPaths.add(file)
  }
  const append = (file, events) => {
    appendEvents(file, events)
    if (events.length > 0) writtenPaths.add(file)
  }
  const writtenFiles = () => [...writtenPaths].map((file) => path.relative(config.root, file).split(path.sep).join('/')).sort()
  // Creation times carry milliseconds, so creates in the same second keep their order. Within one
  // tracker they only grow, so two creates in the same millisecond still differ.
  let lastCreated = 0
  const createdStamp = () => {
    lastCreated = Math.max(now().getTime(), lastCreated + 1)
    return new Date(lastCreated).toISOString()
  }

  // `dir` holds one folder per id, the issues or the epics.
  const nextId = (prefix, dir) => local.id_style === 'numbered'
    ? nextNumberedId(prefix, fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    : newId(prefix, { random, exists: (candidate) => fs.existsSync(path.join(dir, candidate)) })

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

  let configProblems
  // A write on a config that fails validation would store values no reader can map, such as a status without a category.
  // A write on an older format would mix shapes, so it is refused before any other check.
  function requireWriter(actor) {
    if (config.format?.state === 'behind') throw formatError(config.format)
    configProblems ??= validateLocalConfig(local)
    if (configProblems.length > 0) throw invalid(`the tracker config is not valid, so writes are refused: ${configProblems[0]}`, 'pmkit validate')
    return requireMember(actor, 'actor')
  }

  function requireEstimate(value) {
    const { unit, scale } = local.estimate
    if (unit === 'hours') {
      if (!Number.isFinite(value) || value <= 0) throw invalid('estimate must be a positive number of hours')
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

  const milestonesDir = path.join(issuesDir, 'milestones')
  const releasesDir = path.join(issuesDir, 'releases')

  // A milestone is free text until milestones/ holds a .md file; from then on it must name one, exactly.
  function requireMilestone(value) {
    const milestone = oneLine('milestone', text('milestone')(value))
    if (hasMilestoneFiles(milestonesDir) && !milestoneStems(milestonesDir).has(milestone)) {
      throw invalid(`milestone ${milestone} does not exist`, `pmkit milestone create ${milestone}`)
    }
    return milestone
  }

  // A release must have a file, exactly. Unlike milestones, it is never free text.
  function requireRelease(value) {
    const release = oneLine('release', text('release')(value))
    if (!releaseStems(releasesDir).has(release)) throw invalid(`release ${release} does not exist`, `pmkit release create ${release}`)
    readRelease(release) // refuses a file that does not parse, so the issue write cannot fail afterwards
    return release
  }

  const sprintExists = (id) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(id)) && fs.existsSync(path.join(issuesDir, 'sprints', `${id}.yaml`))

  function requireSprint(value) {
    if (value === 'current') return requireActiveSprintId()
    if (!sprintExists(value)) throw invalid(`sprint ${value} does not exist`, 'pmkit cycle list')
    return String(value)
  }

  function requireLabels(value) {
    if (!Array.isArray(value) || !value.every((label) => typeof label === 'string')) throw invalid('labels must be a list of strings')
    for (const label of value) oneLine('label', label)
    if (local.labels.length > 0) for (const label of value) oneOf('label', label, local.labels)
    return value
  }

  function requireCriteria(value) {
    if (!Array.isArray(value)) throw invalid('acceptanceCriteria must be a list')
    return value.map((item) => {
      const text = typeof item === 'string' ? item : item?.text
      if (typeof text !== 'string' || text.trim() === '') throw invalid('each acceptance criterion needs text')
      const trimmed = noSectionHeading('acceptance criterion', oneLine('acceptance criterion', text.trim()))
      return { text: trimmed, done: item?.done === true }
    })
  }

  const text = (field) => (value) => {
    if (typeof value !== 'string') throw invalid(`${field} must be a string`)
    return value
  }
  const plainText = (field, value) => text(field)(value).replace(/\r\n/g, '\n').trim()

  // A normalizer per input field. Optional fields accept null to clear them.
  const NORMALIZE = {
    title: (value) => {
      if (typeof value !== 'string' || value.trim() === '') throw invalid('title is required')
      return oneLine('title', value.trim())
    },
    type: (value) => oneOf('type', value, local.types),
    status: (value) => oneOf('status', value, Object.keys(local.statuses)),
    priority: (value) => oneOf('priority', value, local.priorities),
    estimate: requireEstimate,
    assignee: (value) => requireMember(value, 'assignee'),
    labels: requireLabels,
    parent: requireParent,
    sprint: requireSprint,
    milestone: requireMilestone,
    release: requireRelease,
    due: (value) => {
      if (!validDate(value)) throw invalid('due must be a date as YYYY-MM-DD')
      return value
    },
    branch: (value) => {
      const name = oneLine('branch', text('branch')(value))
      if (!isBranchName(name)) throw invalid(`branch "${name}" is not a valid git branch name`, 'Use a name git accepts, like iss-7k3q-retry-webhooks, that does not start with -')
      return name
    },
    description: (value) => noSectionHeading('description', plainText('description', value)),
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

  // The returned issue is what a reader sees after the write, so parse the text that gets saved, before saving it.
  function save(issue, events, paths, { dryRun }) {
    const content = serializeIssue(issue)
    const after = readBack('issue file', () => parseIssueFile(content, { statuses: local.statuses }))
    // An unclosed code fence in the description, for one, hides the sections after it.
    const same = (key, empty) => JSON.stringify(after[key]) === JSON.stringify(issue[key] ?? empty)
    if (!same('description', '') || !same('acceptanceCriteria', [])) {
      throw invalid('the issue file would not read back after this write: the description or the acceptance criteria would change', 'Close every code fence in the description')
    }
    if (!dryRun) {
      fs.mkdirSync(paths.dir, { recursive: true })
      writeFile(paths.file, content)
      append(paths.events, events)
    }
    return after
  }

  /** The one write path for existing issues: settle drift, then let `edit` return the next issue and its events. */
  function change(id, actor, { dryRun = false, eventsOnly = false } = {}, edit) {
    requireWriter(actor)
    const { issue: before, paths } = readIssue(id)
    const at = stamp()
    const logged = readEvents(paths.events).events
    const newest = logged.length > 0 ? logged[logged.length - 1].at : ''
    const mtime = fileMtimeIso(paths.file)
    // Drift is dated max(mtime, newest event), clamped to this write's time.
    const latest = mtime > newest ? mtime : newest
    const drift = driftEvents(toFrontmatter(before), logged, { at: latest < at ? latest : at, by: actor })
    if (!dryRun) {
      append(paths.events, drift)
      // Drift events describe a hand edit of issue.md, so the commit must carry that edit with them.
      if (drift.length > 0) writtenPaths.add(paths.file)
    }
    const next = structuredClone(before)
    const events = edit(next, { at, by: actor }, before)
    if (events.length === 0) return { before, after: before }
    if (eventsOnly) {
      if (!dryRun) append(paths.events, events)
      return { before, after: before }
    }
    next.updated = at
    return { before, after: save(next, events, paths, { dryRun }) }
  }

  const fieldEvent = (op, field, before, after, meta) => ({
    ...meta, op, field, from: toFrontmatter(before)[field] ?? null, to: toFrontmatter(after)[field] ?? null,
  })

  /** Every issue that parses, and a problem for each file that does not (conflict markers, bad frontmatter). */
  function scan() {
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

  // The query index (PMK-7). A tracker on an older format reads a migrated temp copy, so the index is off there.
  const cacheDir = path.join(issuesDir, CACHE_DIR)
  const indexMode = config.readDir === undefined ? index : false

  function indexedRead(write) {
    return readThroughIndex({
      cacheDir,
      header: indexHeader(local.statuses),
      ids: listIssueIds(issuesDir, local.id_prefix),
      fileOf: (id) => issuePaths(issuesDir, normalizeId(id)).file,
      read: (id) => readIssue(id).issue,
      write,
    })
  }

  /** Every issue that parses, and a problem for each file that does not (conflict markers, bad frontmatter). `save: false` never writes the index. */
  function readAll({ save = true } = {}) {
    if (indexMode === false) return scan()
    let result
    try {
      result = indexedRead(indexMode === true && save)
    } catch {
      // The index only makes a read faster. Any error in its path leaves the answer to the plain scan.
      return scan()
    }
    onIndexRead(result.stats)
    return { issues: result.issues, problems: result.problems }
  }

  /** Rebuilds the query index from every issue file. Not a write: no actor, no dry run, no event, and only ignored files change. */
  function reindex() {
    if (config.readDir !== undefined) {
      return { written: false, reason: `this repository uses tracker format ${config.format.version}; run /pmkit:upgrade before the index can be written` }
    }
    if (indexMode !== true) return { written: false, reason: 'the query index is off for this tracker' }
    try {
      clearIndex(cacheDir)
      const { issues, problems, stats } = indexedRead(true)
      if (stats.error) throw stats.error
      const rel = path.relative(root, path.join(cacheDir, INDEX_FILE)).split(path.sep).join('/')
      return { written: true, path: rel, issues: issues.length, problems: problems.length }
    } catch (error) {
      return { written: false, reason: error.message }
    }
  }

  const scanIssues = (options) => readAll(options).issues

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
    if (!sprintExists(id)) {
      throw new PmkitError('NOT_FOUND', `sprint ${id} does not exist`, 'pmkit cycle list')
    }
    return readSprint(sprintsDir, String(id))
  }

  function listCycles({ state } = {}) {
    if (state !== undefined) oneOf('state', state, SPRINT_STATES)
    return readSprints(sprintsDir).filter((sprint) => state === undefined || sprint.state === state)
  }

  const currentCycle = () => listCycles({ state: 'active' })[0] ?? null
  const activeSprintId = () => currentCycle()?.id ?? null
  const requireActiveSprintId = () => {
    const id = activeSprintId()
    if (id === null) throw invalid('there is no active sprint', 'pmkit cycle list')
    return id
  }

  function search(filter, { save = true } = {}) {
    checkFilter(filter, { types: local.types, members: Object.keys(local.members), sprintExists })
    const resolved = { ...filter }
    if (filter.assignee === 'me') {
      resolved.assignee = requireActor(local, { email: gitEmail ?? gitUserEmail(root), env }).id
    }
    if (filter.sprint === 'current') resolved.sprint = activeSprintId()
    const { issues, problems } = readAll({ save })
    const found = runQuery(issues, resolved, { priorities: local.priorities })
    return { issues: found.map((issue) => withComputed(issue, issues)), problems }
  }

  function searchIssues(filter = {}) {
    return search(filter)
  }

  function createIssue(input, actor, { dryRun = false } = {}) {
    requireWriter(actor)
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
      created: createdStamp(),
      updated: at,
      body: '',
    }, input)
    if (!input.title) throw invalid('title is required')
    const id = nextId(local.id_prefix, path.join(issuesDir, 'issues'))
    issue.id = id
    const event = { at, by: actor, op: 'create', to: toFrontmatter(issue) }
    return { before: null, after: save(issue, [event], issuePaths(issuesDir, id), { dryRun }) }
  }

  function updateIssue(id, patch, actor, options) {
    requireWriter(actor)
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
    requireWriter(actor)
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

  /** `member` is a member id, `me` for the actor, or null to unassign. */
  function assign(id, who, actor, { dryRun } = {}) {
    requireWriter(actor)
    const member = who === 'me' ? actor : who
    if (member !== null) requireMember(member, 'assignee')
    return change(id, actor, { dryRun }, (issue, meta, before) => {
      if ((before.assignee ?? null) === member) return []
      if (member === null) delete issue.assignee
      else issue.assignee = member
      return [fieldEvent('assign', 'assignee', before, issue, meta)]
    })
  }

  function archive(id, actor, { dryRun } = {}) {
    requireWriter(actor)
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
    requireWriter(actor)
    if (!LINK_KINDS.includes(kind)) throw invalid(`kind must be one of ${LINK_KINDS.join(', ')}`)
    // Unlinking needs only the issue whose file changes, so a reference to a missing issue can be removed.
    const exists = (id) => isId(id, local.id_prefix) && fs.existsSync(issuePaths(issuesDir, id).file)
    const keep = op === 'unlink'
    const a = keep && kind === 'blocks' && !exists(from) ? from : knownIssue(from)
    const b = keep && kind !== 'blocks' && !exists(to) ? to : knownIssue(to)
    if (a === b) throw invalid(`${a} cannot be linked to itself`)
    const { field, prop } = LINKS[kind]
    const options = { dryRun }
    if (kind === 'blocks') {
      const all = scanIssues({ save: !dryRun })
      const blocker = all.find((issue) => issue.id === a)
      const closing = op === 'link' ? blockPath(b, a, all) : null
      if (closing) throw invalid(`${a} blocks ${b} would close a cycle: ${[a, ...closing].join(' → ')}`)
      const written = change(b, actor, options, listEdit(op, prop, field, a))
      // A missing blocker has no record, so the result is the blocked issue, whose blocked_by changes.
      if (!blocker) return written
      const before = withComputed(blocker, all)
      const changed = written.after !== written.before
      const blocks = op === 'link' ? [...before.blocks, b].sort() : before.blocks.filter((item) => item !== b)
      return { before, after: changed ? { ...before, blocks } : before }
    }
    const result = change(a, actor, options, listEdit(op, prop, field, b))
    if (kind !== 'related') return result
    if (!exists(b)) return result
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
    requireWriter(actor)
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

  const categoryOf = (name) => local.statuses[name]?.category ?? null

  /** Every readable event log, keyed by issue id. Archived and unparseable issues count. */
  function eventsByIssue() {
    const result = {}
    for (const id of listIssueIds(issuesDir, local.id_prefix)) {
      const { events } = readEvents(issuePaths(issuesDir, id).events)
      if (events.length > 0) result[id] = events
    }
    return result
  }

  /** Every issue's events in the range, tagged with the issue id and sorted by `at`. A date-only `until` includes that day. */
  function metricEvents({ since, until } = {}) {
    const last = until !== undefined && !until.includes('T') ? `${until}T23:59:59Z` : until
    return Object.entries(eventsByIssue())
      .flatMap(([issue, events]) => events.map((event) => ({ ...event, issue })))
      .filter((event) => (since === undefined || event.at >= since) && (last === undefined || event.at <= last))
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  }

  /** The `issuesBySprint` input of `velocity`: issues grouped by their current sprint, with the time they last reached a done status. */
  function issuesBySprint() {
    const logs = eventsByIssue()
    const grouped = {}
    for (const issue of scanIssues()) {
      if (!issue.sprint) continue
      const doneAt = lastEntry(logs[issue.id] ?? [], 'done', categoryOf)
      ;(grouped[issue.sprint] ??= []).push({ id: issue.id, estimate: issue.estimate, status: issue.status.name, doneAt })
    }
    return grouped
  }

  function discover() {
    return {
      statuses: Object.keys(local.statuses).map(statusOf),
      types: local.types,
      priorities: local.priorities,
      labels: local.labels,
      members: Object.keys(local.members).sort().map((id) => ({ id, name: local.members[id].name, email: local.members[id].email, availability: local.members[id].availability })),
      estimate: local.estimate,
    }
  }

  function capabilities() {
    const gitHost = config.pmkit.git_host?.system ?? 'none'
    return { tracker: 'local', gitHost, generatedAt: stamp(), capabilities: buildCapabilities({ estimate: local.estimate, gitHost }) }
  }

  function comment(id, body, actor, { dryRun = false } = {}) {
    requireWriter(actor)
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
        writeFile(path.join(dir, `${name}.md`), joinFrontmatter({ author: actor, created: meta.at }, `${written.body}\n`, { order: ['author', 'created'] }))
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
    requireWriter(actor)
    if (!Number.isInteger(minutes) || minutes <= 0) throw invalid('minutes must be a positive integer')
    return change(id, actor, { dryRun, eventsOnly: true }, (issue, meta) => [{ ...meta, op: 'log_time', minutes }])
  }

  function cycleIssues(id) {
    return searchIssues({ sprint: getSprint(id).id }).issues
  }

  function writeSprint(before, after, { dryRun }) {
    const content = serializeSprint(after)
    readBack('sprint file', () => parseSprint(content, after.id))
    if (!dryRun) {
      fs.mkdirSync(sprintsDir, { recursive: true })
      writeFile(path.join(sprintsDir, `${after.id}.yaml`), content)
    }
    return { before, after }
  }

  function openCycle(input, actor, { dryRun = false } = {}) {
    requireWriter(actor)
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
    oneLine('name', name.trim())
    const goal = input.goal ?? ''
    if (typeof goal !== 'string') throw invalid('goal must be a string')
    oneLine('goal', goal)
    const existing = listCycles()
    if (existing.some((sprint) => sprint.id === start)) throw invalid(`a sprint file for ${start} already exists`, 'pmkit cycle list')
    const clash = existing.find((sprint) => sprint.state !== 'closed' && overlaps(sprint, { start, end }))
    if (clash) throw invalid(`sprint ${start} to ${end} overlaps ${clash.id} (${clash.start} to ${clash.end})`, 'pmkit cycle list')
    const state = start <= today() && !existing.some((sprint) => sprint.state === 'active') ? 'active' : 'planned'
    const sprint = { id: start, name: name.trim(), start, end, goal, state, capacity: {}, daysOff: {} }
    return writeSprint(null, sprint, { dryRun })
  }

  function closeCycle(id, actor, { dryRun = false } = {}) {
    requireWriter(actor)
    const before = getSprint(id)
    if (before.state !== 'active') throw invalid(`sprint ${before.id} is not active (it is ${before.state})`, 'pmkit cycle list')
    // An issue that does not parse may belong to the sprint, so it is reported rather than left out silently.
    const { issues, problems } = search({ sprint: before.id }, { save: !dryRun })
    // Built in model order, so closed sits right after state, and a closed the file already had is replaced.
    const { capacity, daysOff, extra, closed: _previous, ...head } = before
    const { closed: _malformed, ...kept } = extra ?? {}
    const next = { ...head, state: 'closed', closed: stamp(), capacity, daysOff, ...(Object.keys(kept).length > 0 ? { extra: kept } : {}) }
    const { after } = writeSprint(before, next, { dryRun })
    return { sprint: after, unfinished: issues.filter((issue) => !TERMINAL.includes(issue.status.category)), problems }
  }

  /** `to` is a sprint id, `current` for the active sprint, or null to take the issues out of their sprint. */
  function moveToCycle(ids, to, actor, { dryRun = false } = {}) {
    requireWriter(actor)
    if (!Array.isArray(ids) || ids.length === 0) throw invalid('ids must be a non-empty list')
    const known = ids.map(knownIssue)
    const sprint = to === 'current' ? requireActiveSprintId() : to
    if (sprint !== null) getSprint(sprint)
    return known.map((id) => updateIssue(id, { sprint }, actor, { dryRun }))
  }

  const getCapacity = (id) => getSprint(id).capacity

  const getDaysOff = (id) => getSprint(id).daysOff

  function updateCycleCapacity(id, { capacity, daysOff } = {}, actor, { dryRun = false } = {}) {
    requireWriter(actor)
    const before = getSprint(id)
    const next = { ...before }
    if (capacity !== undefined) next.capacity = requireCapacity(capacity, local.members)
    if (daysOff !== undefined) {
      const merged = { ...before.daysOff }
      for (const [member, dates] of Object.entries(requireDaysOff(daysOff, local.members, before))) {
        if (dates === null) delete merged[member]
        else merged[member] = dates
      }
      next.daysOff = merged
    }
    return writeSprint(before, next, { dryRun })
  }

  const setCapacity = (id, map, actor, opts) => updateCycleCapacity(id, { capacity: map }, actor, opts)

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

  /** Every epic that parses. An epic file that does not parse is skipped, as searchIssues skips a bad issue. */
  function listDeliverables() {
    if (!fs.existsSync(epicsDir)) return []
    const ids = fs.readdirSync(epicsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isId(entry.name, local.epic_prefix) && fs.existsSync(path.join(epicsDir, entry.name, 'epic.md')))
      .map((entry) => entry.name)
    const epics = []
    const created = {}
    for (const id of ids) {
      try {
        epics.push(getDeliverable(id))
        created[id] = readEvents(path.join(epicsDir, id, 'events.jsonl')).events.find((event) => event.op === 'create')?.at
      } catch (error) {
        if (!(error instanceof PmkitError)) throw error
      }
    }
    return sortEpics(epics, created)
  }

  function createDeliverable(input, actor, { dryRun = false } = {}) {
    requireWriter(actor)
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
    if (!blank(input.description)) epic.description = plainText('description', input.description)
    epic.id = nextId(local.epic_prefix, epicsDir)
    const content = serializeEpic(epic)
    const after = readBack('epic file', () => parseEpicFile(content, { statuses: local.statuses }))
    if (!dryRun) {
      const dir = path.join(epicsDir, epic.id)
      fs.mkdirSync(dir, { recursive: true })
      writeFile(path.join(dir, 'epic.md'), content)
      append(path.join(dir, 'events.jsonl'), [{ at: createdStamp(), by: actor, op: 'create', to: epicFrontmatter(epic) }])
    }
    return { before: null, after }
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
    requireWriter(actor)
    const { epic, dir } = readEpic(input.epic)
    oneOf('health', input.health, HEALTH)
    if (typeof input.body !== 'string' || input.body.trim() === '') throw invalid('status update body must be a non-empty string')
    const at = stamp()
    const update = { epic: epic.id, at, author: actor, health: input.health, body: input.body.trim() }
    const content = serializeUpdate(update)
    readBack('status update file', () => parseUpdateFile(content, epic.id))
    if (!dryRun) {
      const updates = path.join(dir, 'updates')
      const base = `${at.slice(0, 10)}-${fileSafe(actor)}`
      let name = base
      for (let n = 2; fs.existsSync(path.join(updates, `${name}.md`)); n++) name = `${base}-${n}`
      fs.mkdirSync(updates, { recursive: true })
      writeFile(path.join(updates, `${name}.md`), content)
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

  const readMilestone = (id) => parseMilestone(fs.readFileSync(path.join(milestonesDir, `${id}.md`), 'utf8'), id)

  function getMilestone(id) {
    if (!validMilestoneId(id) || !milestoneStems(milestonesDir).has(id)) {
      throw new PmkitError('NOT_FOUND', `milestone ${id} does not exist`, 'pmkit milestone list')
    }
    return readMilestone(id)
  }

  /** Every milestone that parses. A file that does not parse, or whose stem breaks the id rule, is skipped; validate reports it. */
  function listMilestones() {
    const milestones = []
    for (const id of [...milestoneStems(milestonesDir)].filter(validMilestoneId)) {
      try {
        milestones.push(readMilestone(id))
      } catch (error) {
        if (!(error instanceof PmkitError)) throw error
      }
    }
    return sortMilestones(milestones)
  }

  function createMilestone(input, actor, { dryRun = false } = {}) {
    requireWriter(actor)
    const allowed = ['id', 'name', 'due']
    for (const key of Object.keys(input)) {
      if (!allowed.includes(key)) throw invalid(`unknown field "${key}"`, `Use one of: ${allowed.join(', ')}`)
    }
    const { id } = input
    if (!validMilestoneId(id)) {
      throw invalid(`milestone id "${id}" must start and end with a letter or digit and hold only letters, digits, ".", "_" and "-"`, 'Use an id like local-gaps or v1.0')
    }
    const clash = [...milestoneStems(milestonesDir)].find((stem) => stem.toLowerCase() === id.toLowerCase())
    if (clash !== undefined) throw new PmkitError('CONFLICT', `milestone ${clash} already exists`, 'pmkit milestone list')
    let name = id
    if (!blank(input.name)) {
      if (typeof input.name !== 'string' || input.name.trim() === '') throw invalid('name must be a non-empty string')
      name = oneLine('name', input.name.trim())
    }
    const milestone = { name }
    if (!blank(input.due)) {
      if (!validDate(input.due)) throw invalid('due must be a date as YYYY-MM-DD')
      milestone.due = input.due
    }
    const content = serializeMilestone(milestone)
    const after = readBack('milestone file', () => parseMilestone(content, id))
    if (!dryRun) {
      fs.mkdirSync(milestonesDir, { recursive: true })
      writeFile(path.join(milestonesDir, `${id}.md`), content)
    }
    return { before: null, after }
  }

  const readRelease = (id) => parseRelease(fs.readFileSync(path.join(releasesDir, `${id}.md`), 'utf8'), id)

  function getRelease(id) {
    if (!validReleaseId(id) || !releaseStems(releasesDir).has(id)) {
      throw new PmkitError('NOT_FOUND', `release ${id} does not exist`, 'pmkit release list')
    }
    return readRelease(id)
  }

  /** Every release that parses, oldest version first. A file that does not parse, or whose stem breaks the id rule, is skipped; validate reports it. */
  function listReleases({ state } = {}) {
    if (state !== undefined && !['planned', 'released'].includes(state)) throw invalid('state must be planned or released', 'pmkit release list')
    const releases = []
    for (const id of [...releaseStems(releasesDir)].filter(validReleaseId)) {
      try {
        releases.push(readRelease(id))
      } catch (error) {
        if (!(error instanceof PmkitError)) throw error
      }
    }
    return sortReleases(releases).filter((release) => state === undefined || release.state === state)
  }

  function createRelease(input, actor, { dryRun = false } = {}) {
    requireWriter(actor)
    const allowed = ['id', 'name', 'tag', 'target']
    for (const key of Object.keys(input)) {
      if (!allowed.includes(key)) throw invalid(`unknown field "${key}"`, `Use one of: ${allowed.join(', ')}`)
    }
    const { id } = input
    if (!validReleaseId(id)) {
      throw invalid(`release id "${id}" must start and end with a letter or digit and hold only letters, digits, ".", "_" and "-"`, 'Use an id like 1.2.0 or v1.2.0')
    }
    const clash = [...releaseStems(releasesDir)].find((stem) => stem.toLowerCase() === id.toLowerCase())
    if (clash !== undefined) throw new PmkitError('CONFLICT', `release ${clash} already exists`, 'pmkit release list')
    let name = id
    if (!blank(input.name)) {
      if (typeof input.name !== 'string' || input.name.trim() === '') throw invalid('name must be a non-empty string')
      name = oneLine('name', input.name.trim())
    }
    const release = { name }
    if (!blank(input.tag)) {
      if (!validTag(input.tag)) throw invalid(`tag "${input.tag}" is not a valid git tag name`, 'Use a tag like v1.2.0')
      release.tag = input.tag
    }
    if (!blank(input.target)) {
      if (!validDate(input.target)) throw invalid('target must be a date as YYYY-MM-DD')
      release.target = input.target
    }
    const content = serializeRelease(release)
    const after = readBack('release file', () => parseRelease(content, id))
    if (!dryRun) {
      fs.mkdirSync(releasesDir, { recursive: true })
      writeFile(path.join(releasesDir, `${id}.md`), content)
    }
    return { before: null, after }
  }

  const releaseIssues = (id) => searchIssues({ release: getRelease(id).id }).issues

  /** Marks a release released now. `tag` replaces the stored tag. `unfinished` lists the members that are not done or canceled. */
  function markReleased(id, actor, { tag, dryRun = false } = {}) {
    requireWriter(actor)
    const before = getRelease(id)
    if (before.released) throw new PmkitError('CONFLICT', `release ${before.id} was released at ${before.released}`, `pmkit release get ${before.id}`)
    if (!blank(tag) && !validTag(tag)) throw invalid(`tag "${tag}" is not a valid git tag name`, 'Use a tag like v1.2.0')
    // An issue that does not parse may belong to the release, so it is reported rather than left out silently.
    const { issues, problems } = search({ release: before.id }, { save: !dryRun })
    const { id: _id, state: _state, released: _previous, tag: storedTag, ...rest } = before
    const next = { ...rest, ...(blank(tag) ? (storedTag === undefined ? {} : { tag: storedTag }) : { tag }), released: stamp() }
    const content = serializeRelease(next)
    const after = readBack('release file', () => parseRelease(content, before.id))
    if (!dryRun) writeFile(path.join(releasesDir, `${before.id}.md`), content)
    return { before, after, unfinished: issues.filter((issue) => !TERMINAL.includes(issue.status.category)), problems }
  }

  /**
   * Milestone names that issues or epics use and that have no file, with how many of each use them. Archived issues count, as they do in `validate`.
   * `except` is an id about to be filed. Not a contract operation; the CLI warns with it.
   */
  function unfiledMilestones(except) {
    const filed = milestoneStems(milestonesDir)
    const counts = new Map()
    const tally = (name) => {
      if (name === undefined || name === except || filed.has(name)) return
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    for (const issue of searchIssues({ archived: true }).issues) tally(issue.milestone)
    for (const epic of listDeliverables()) tally(epic.milestone)
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  const docsDir = path.join(issuesDir, 'docs')
  const readDocument = (docPath) => readDocumentFile(docsDir, docPath)

  function createDocument(docPath, body, actor, { dryRun = false } = {}) {
    requireWriter(actor)
    return createDocumentFile(docsDir, docPath, body, { dryRun, onWrite: (file) => writtenPaths.add(file) })
  }

  return {
    listDeliverables, getDeliverable, createDeliverable, deliverableProgress, publishStatusUpdate, listStatusUpdates,
    listMilestones, getMilestone, createMilestone, unfiledMilestones,
    listReleases, getRelease, createRelease, releaseIssues, markReleased,
    getIssue, searchIssues, createIssue, updateIssue, moveToCategory, assign, archive, link, unlink, setParent,
    comment, listComments, getHistory, logTime, readDocument, createDocument,
    discover, capabilities, reindex, categoryOf, eventsByIssue, metricEvents, issuesBySprint,
    listCycles, currentCycle, cycleIssues, openCycle, closeCycle, moveToCycle, getCapacity, setCapacity, getDaysOff, updateCycleCapacity,
    writtenFiles,
  }
}
