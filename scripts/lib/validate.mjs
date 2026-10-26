// Read-only check of a whole local tracker. Reports problems; never fixes or writes.

import fs from 'node:fs'
import path from 'node:path'
import { TRACKERS, loadConfig, unsupportedTracker, validateLocalConfig, validatePmkitConfig } from './config.mjs'
import { isId, normalizeId } from './ids.mjs'
import { parseYaml } from './yaml.mjs'
import { parseEpicFile, walkParents } from './local/epics.mjs'
import { driftEvents, readEvents } from './local/events.mjs'
import { formatError } from './local/migrations.mjs'
import { hasMilestoneFiles, milestoneStems, parseMilestone, validMilestoneId } from './local/milestones.mjs'
import { hasConflictMarkers, parseIssueFile, toFrontmatter } from './local/issue-file.mjs'
import { overlaps, readSprint } from './local/sprints.mjs'

const LIST_REFS = ['blocked_by', 'related', 'duplicate_of']
const read = (file) => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
const subdirs = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : [])
const files = (dir, ext) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(ext)).sort() : [])

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name)
      return entry.isDirectory() ? walkFiles(full) : [full]
    })
}

function valueProblems(issue, local) {
  const problems = []
  const bad = (field, value, allowed) => problems.push(`${field} "${value}" is not allowed${allowed ? `, expected one of ${allowed.join(', ')}` : ''}`)
  const status = issue.status.name
  if (!Object.hasOwn(local.statuses, status)) bad('status', status, Object.keys(local.statuses))
  if (issue.type !== undefined && !local.types.includes(issue.type)) bad('type', issue.type, local.types)
  if (issue.priority !== undefined && !local.priorities.includes(issue.priority)) bad('priority', issue.priority, local.priorities)
  if (issue.assignee !== undefined && !Object.hasOwn(local.members, issue.assignee)) bad('assignee', issue.assignee, Object.keys(local.members))
  if (local.labels.length > 0) for (const label of issue.labels) if (!local.labels.includes(label)) bad('label', label, local.labels)
  if (issue.estimate !== undefined) {
    const { unit, scale } = local.estimate
    const ok = unit === 'hours' ? typeof issue.estimate === 'number' && issue.estimate > 0 : scale.includes(issue.estimate)
    if (!ok) bad('estimate', issue.estimate, unit === 'hours' ? null : scale)
  }
  return problems
}

/** Cycles in a blocked_by graph, each once, as lists of ids that start and end on the same id. */
function blockedByCycles(graph) {
  const cycles = []
  const done = new Set()
  const visit = (id, stack) => {
    if (stack.includes(id)) {
      cycles.push([...stack.slice(stack.indexOf(id)), id])
      return
    }
    if (done.has(id)) return
    for (const next of graph.get(id) ?? []) if (graph.has(next)) visit(next, [...stack, id])
    done.add(id)
  }
  for (const id of graph.keys()) visit(id, [])
  return cycles
}

const relative = (root, file) => path.relative(root, file).split(path.sep).join('/')
const noneChecked = () => ({ issues: 0, epics: 0, sprints: 0, milestones: 0, comments: 0 })
// A problem has no next step field, so the format problem carries it in its message.
const formatProblem = (root, file, error) => ({ path: relative(root, file), code: 'FORMAT', message: `${error.message}; run ${error.nextStep}` })

// loadConfig throws INVALID_INPUT when the local config.yaml does not parse, and NOT_SUPPORTED when its
// format is newer than this pmkit's. Both are findings, not failures. So is a failing migration step,
// listed with code `migration`. Its errors from .pmkit/config.yaml (a bad key, or an unsupported
// tracker.system) are rethrown here. pmkitConfigProblems lists them.
function brokenConfigProblem(root, error) {
  const format = error?.details?.format !== undefined
  const migration = error?.details?.migration !== undefined
  if (error?.code !== 'INVALID_INPUT' && !format) throw error
  let trackerPath
  try {
    const pmkit = parseYaml(read(path.join(root, '.pmkit', 'config.yaml')))
    trackerPath = typeof pmkit.tracker.path === 'string' ? pmkit.tracker.path : '.issues'
  } catch {
    throw error
  }
  // loadConfig starts every other INVALID_INPUT from the local config.yaml with this label.
  if (!format && !migration && !error.message.startsWith(`${trackerPath}/config.yaml`)) throw error
  const file = path.join(root, trackerPath, 'config.yaml')
  if (!fs.existsSync(file)) throw error
  if (format) return formatProblem(root, file, error)
  if (migration) return { path: relative(root, file), code: 'migration', message: error.message }
  const conflict = hasConflictMarkers(read(file))
  return {
    path: relative(root, file),
    code: conflict ? 'conflict' : 'config',
    message: conflict ? 'the file contains git conflict markers' : error.message,
  }
}

const byPathThenCode = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0)

const isMap = (x) => typeof x === 'object' && x !== null && !Array.isArray(x)

// A tracker.system that is known but not local gets the loadConfig rule as a problem. Any other shape is
// already a validatePmkitConfig message.
function unsupportedTrackerMessage(parsed) {
  if (!isMap(parsed) || !isMap(parsed.tracker) || !TRACKERS.includes(parsed.tracker.system)) return null
  const rule = unsupportedTracker(parsed.tracker.system)
  return rule === null ? null : `${rule.message}, set it to local`
}

// The root .pmkit/config.yaml is read here, not through loadConfig, which throws on the first bad key.
function pmkitConfigProblems(root) {
  const file = path.join(root, '.pmkit', 'config.yaml')
  if (!fs.existsSync(file)) return []
  const text = read(file)
  const at = relative(root, file)
  if (hasConflictMarkers(text)) return [{ path: at, code: 'conflict', message: 'the file contains git conflict markers' }]
  let parsed
  try {
    parsed = parseYaml(text)
  } catch (error) {
    return [{ path: at, code: 'config', message: `config.yaml does not parse: ${error.message}` }]
  }
  const messages = validatePmkitConfig(parsed)
  const unsupported = unsupportedTrackerMessage(parsed)
  if (unsupported !== null) messages.push(unsupported)
  return messages.map((message) => ({ path: at, code: 'config', message }))
}

export function validateRepo(root, { config, migrations } = {}) {
  const pmkit = pmkitConfigProblems(root)
  if (!config) {
    try {
      config = loadConfig(root, { migrations })
    } catch (error) {
      let broken
      try {
        broken = brokenConfigProblem(root, error)
      } catch (rethrown) {
        if (pmkit.length > 0 && rethrown.code !== 'NOT_CONFIGURED') return { checked: noneChecked(), problems: pmkit }
        throw rethrown
      }
      return { checked: noneChecked(), problems: [...pmkit, broken].sort(byPathThenCode) }
    }
  }
  const { local, issuesDir } = config
  // An older format is one problem: the other checks assume the current shape.
  if (config.format && config.format.state !== 'current') {
    return { checked: noneChecked(), problems: [...pmkit, formatProblem(root, path.join(issuesDir, 'config.yaml'), formatError(config.format))].sort(byPathThenCode) }
  }
  const problems = [...pmkit]
  const rel = (file) => relative(root, file)
  const add = (file, code, message) => problems.push({ path: rel(file), code, message })
  const checked = noneChecked()

  const configFile = path.join(issuesDir, 'config.yaml')
  const conflicted = new Set()
  for (const file of walkFiles(issuesDir).filter((name) => name.endsWith('.md') || name.endsWith('.yaml'))) {
    if (!hasConflictMarkers(read(file))) continue
    conflicted.add(file)
    add(file, 'conflict', 'the file contains git conflict markers')
  }

  if (!conflicted.has(configFile)) {
    let raw = null
    try {
      raw = parseYaml(read(configFile))
    } catch (error) {
      add(configFile, 'config', `config.yaml does not parse: ${error.message}`)
    }
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const message of validateLocalConfig(raw)) add(configFile, 'config', message)
    } else if (raw !== null) add(configFile, 'config', 'config.yaml must be a map')
  }

  // Epics
  const epicIds = new Set()
  const epics = new Map()
  for (const name of subdirs(path.join(issuesDir, 'epics'))) {
    const file = path.join(issuesDir, 'epics', name, 'epic.md')
    if (!fs.existsSync(file)) continue
    epicIds.add(name)
    checked.epics++
    if (conflicted.has(file)) continue
    try {
      const epic = parseEpicFile(read(file), { statuses: local.statuses })
      epics.set(name, epic)
      if (epic.id !== name) add(file, 'id', `folder ${name} and id ${epic.id} differ`)
    } catch (error) {
      add(file, 'frontmatter', error.message)
    }
  }

  // Sprints
  const sprintDir = path.join(issuesDir, 'sprints')
  const sprints = []
  for (const name of files(sprintDir, '.yaml')) {
    const file = path.join(sprintDir, name)
    checked.sprints++
    if (conflicted.has(file)) continue
    try {
      const sprint = readSprint(sprintDir, path.basename(name, '.yaml'))
      if (sprint.start > sprint.end) add(file, 'sprint', `start ${sprint.start} is after end ${sprint.end}`)
      else sprints.push({ sprint, file })
    } catch (error) {
      add(file, 'sprint', error.message)
    }
  }
  sprints.forEach(({ sprint, file }, index) => {
    for (const other of sprints.slice(0, index)) {
      if (overlaps(other.sprint, sprint)) add(file, 'sprint', `overlaps sprint ${other.sprint.id}`)
    }
  })
  const active = sprints.filter(({ sprint }) => sprint.state === 'active')
  for (const { sprint, file } of active.slice(1)) add(file, 'sprint', `more than one active sprint, ${active[0].sprint.id} is active too`)

  // Milestones
  const milestonesDir = path.join(issuesDir, 'milestones')
  const milestoneIds = milestoneStems(milestonesDir)
  for (const id of [...milestoneIds].sort()) {
    const file = path.join(milestonesDir, `${id}.md`)
    checked.milestones++
    if (conflicted.has(file)) continue
    if (!validMilestoneId(id)) {
      add(file, 'milestone', `milestone id "${id}" must start and end with a letter or digit and hold only letters, digits, ".", "_" and "-"`)
      continue
    }
    try {
      parseMilestone(read(file), id)
    } catch (error) {
      add(file, 'milestone', error.message)
    }
  }

  // Issues
  const folders = subdirs(path.join(issuesDir, 'issues'))
  const byNormalized = new Map()
  for (const name of folders) {
    const key = normalizeId(name)
    byNormalized.set(key, [...(byNormalized.get(key) ?? []), name])
  }
  const issues = new Map()
  for (const name of folders) {
    const dir = path.join(issuesDir, 'issues', name)
    const file = path.join(dir, 'issue.md')
    checked.issues++
    checked.comments += files(path.join(dir, 'comments'), '.md').length
    if (!isId(name, local.id_prefix)) add(file, 'id', `folder name ${name} is not a valid ${local.id_prefix} id`)
    const twins = byNormalized.get(normalizeId(name))
    if (twins.length > 1 && twins[0] === name) add(file, 'id', `folders ${twins.join(', ')} have the same id`)

    const events = readEvents(path.join(dir, 'events.jsonl'))
    for (const message of events.problems) add(path.join(dir, 'events.jsonl'), 'events', message)

    if (!fs.existsSync(file)) {
      add(file, 'frontmatter', 'issue.md is missing')
      continue
    }
    if (conflicted.has(file)) continue
    let issue
    try {
      issue = parseIssueFile(read(file), { statuses: local.statuses })
    } catch (error) {
      add(file, 'frontmatter', error.message)
      continue
    }
    issues.set(name, issue)
    if (issue.id !== name) add(file, 'id', `folder ${name} and id "${issue.id}" differ`)
    else if (!isId(issue.id, local.id_prefix)) add(file, 'id', `id ${issue.id} is not a valid ${local.id_prefix} id`)
    for (const message of valueProblems(issue, local)) add(file, 'value', message)

    if (events.events.length > 0) {
      const drift = driftEvents(toFrontmatter(issue), events.events, { at: '', by: '' })
      if (drift.length > 0) add(file, 'drift', `frontmatter differs from the events in ${drift.map((event) => event.field).join(', ')}`)
    }
  }

  // References
  const folderSet = new Set(folders)
  // Milestones are free text until milestones/ holds a .md file.
  const milestonesChecked = hasMilestoneFiles(milestonesDir)
  const milestoneMissing = (value) => milestonesChecked && value !== undefined && !milestoneIds.has(String(value))
  const sprintIds = new Set(files(sprintDir, '.yaml').map((name) => path.basename(name, '.yaml')))
  for (const [name, issue] of issues) {
    const file = path.join(issuesDir, 'issues', name, 'issue.md')
    const missing = (field, value) => add(file, 'reference', `${field} ${value} does not exist`)
    if (issue.parent !== undefined && !folderSet.has(String(issue.parent)) && !epicIds.has(String(issue.parent))) missing('parent', issue.parent)
    for (const [field, values] of [['blocked_by', issue.blockedBy], ['related', issue.related], ['duplicate_of', issue.duplicateOf]]) {
      for (const value of values) if (!folderSet.has(value)) missing(field, value)
    }
    if (issue.sprint !== undefined && !sprintIds.has(String(issue.sprint))) missing('sprint', issue.sprint)
    if (milestoneMissing(issue.milestone)) missing('milestone', issue.milestone)
  }
  for (const [name, epic] of epics) {
    if (milestoneMissing(epic.milestone)) add(path.join(issuesDir, 'epics', name, 'epic.md'), 'reference', `milestone ${epic.milestone} does not exist`)
  }

  // Cycles
  const reported = new Set()
  const report = (kind, cycle) => {
    const members = cycle.slice(0, -1)
    const key = `${kind} ${[...members].sort().join(' ')}`
    if (reported.has(key)) return
    reported.add(key)
    const first = [...members].sort()[0]
    add(path.join(issuesDir, 'issues', first, 'issue.md'), 'cycle', `${kind} cycle: ${cycle.join(' -> ')}`)
  }
  const parentOf = (id) => (issues.has(id) ? issues.get(id).parent : undefined)
  for (const id of issues.keys()) {
    const { chain, loop } = walkParents(id, parentOf)
    if (loop) report('parent', chain.slice(chain.indexOf(chain[chain.length - 1])))
  }
  const graph = new Map([...issues].map(([id, issue]) => [id, issue.blockedBy]))
  for (const cycle of blockedByCycles(graph)) report('blocked_by', cycle)

  problems.sort(byPathThenCode)
  return { checked, problems }
}
