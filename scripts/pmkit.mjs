#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { BOOLEANS, parseArgs } from './lib/args.mjs'
import { requireActor, gitUserEmail } from './lib/actor.mjs'
import { findRoot, loadConfig, validateLocalConfig } from './lib/config.mjs'
import { PmkitError, isPmkitError } from './lib/errors.mjs'
import { changeLines, epicRecord, eventTable, fields, issueRecord, issueTable, sprintRecord, table } from './lib/format.mjs'
import { cycleTimes, lastEntry, summary, velocity } from './lib/metrics.mjs'
import { validateRepo } from './lib/validate.mjs'
import { stringifyYaml, parseYaml } from './lib/yaml.mjs'
import { createLocalTracker } from './lib/local/tracker.mjs'

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates')
const usageError = (message, nextStep = 'node scripts/pmkit.mjs --help') => new PmkitError('INVALID_INPUT', message, nextStep)

// Option readers. A repeated option arrives as an array; the last one wins unless the command asks for a list.
const last = (value) => (Array.isArray(value) ? value[value.length - 1] : value)
const csv = (value) => [value].flat().filter((item) => typeof item === 'string').flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean)

function whole(name, value) {
  if (!/^\d+$/.test(String(value))) throw usageError(`--${name} must be a whole number`)
  return Number(value)
}

function dateText(name, value) {
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(String(value))) throw usageError(`--${name} must be a date as YYYY-MM-DD`)
  return value
}

function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// PMKIT_NOW and PMKIT_SEED exist for tests and agents; the library never reads them.
function clock(env) {
  if (env.PMKIT_NOW === undefined) return () => new Date()
  if (Number.isNaN(Date.parse(env.PMKIT_NOW))) throw usageError('PMKIT_NOW must be an ISO timestamp')
  return () => new Date(env.PMKIT_NOW)
}

function randomSource(env) {
  if (env.PMKIT_SEED === undefined) return (n) => crypto.randomInt(n)
  if (!/^-?\d+$/.test(env.PMKIT_SEED)) throw usageError('PMKIT_SEED must be an integer')
  const next = mulberry32(Number(env.PMKIT_SEED))
  return (n) => Math.floor(next() * n)
}

function readInput(source) {
  try {
    return fs.readFileSync(source === '-' ? 0 : source, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  } catch (error) {
    throw new PmkitError('INVALID_INPUT', `cannot read ${source === '-' ? 'stdin' : source}: ${error.message}`, 'Pass a readable file, or - for stdin')
  }
}

function parseCriteria(text) {
  return text.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(?:-\s*)?(?:\[([ xX])\]\s*)?(.*)$/.exec(line)
      return { text: match[2].trim(), done: match[1] !== undefined && match[1] !== ' ' }
    })
}

function parseEstimate(raw, scale) {
  const found = scale.find((item) => String(item) === raw)
  return found !== undefined ? found : Number(raw)
}

const orNull = (raw) => (raw === 'none' ? null : raw)

function issueFilter(ctx) {
  const filter = {}
  const set = (key, value) => { if (value !== undefined) filter[key] = value }
  const { opt } = ctx
  set('text', opt('text'))
  if (opt('category')) filter.categories = csv(opt('category'))
  if (opt('type')) filter.types = csv(opt('type'))
  set('assignee', opt('assignee'))
  if (opt('label')) filter.labels = csv(ctx.list('label'))
  set('sprint', opt('sprint'))
  set('parent', opt('parent'))
  if (ctx.flag('blocked')) filter.blocked = true
  if (ctx.flag('archived')) filter.archived = true
  if (opt('updated-before')) filter.updatedBefore = dateText('updated-before', opt('updated-before'))
  if (opt('updated-after')) filter.updatedAfter = dateText('updated-after', opt('updated-after'))
  set('sort', opt('sort'))
  if (opt('limit') !== undefined) filter.limit = whole('limit', opt('limit'))
  return filter
}

/** The create or update input from field flags and body files. */
function issuePatch(ctx, { create }) {
  const { opt } = ctx
  const patch = {}
  const set = (key, value) => { if (value !== undefined) patch[key] = value }
  set('title', opt('title'))
  set('type', opt('type'))
  set('priority', create ? opt('priority') : orNull(opt('priority')))
  if (opt('estimate') !== undefined) patch.estimate = opt('estimate') === 'none' ? null : parseEstimate(opt('estimate'), ctx.config().local.estimate.scale)
  if (opt('label') !== undefined) patch.labels = opt('label') === 'none' ? [] : csv(ctx.list('label'))
  set('sprint', orNull(opt('sprint')))
  set('due', orNull(opt('due')))
  if (create) {
    set('assignee', opt('assignee'))
    set('parent', opt('parent'))
  } else {
    set('milestone', orNull(opt('milestone')))
    set('branch', orNull(opt('branch')))
  }
  if (opt('description-file') !== undefined) patch.description = readInput(opt('description-file'))
  if (opt('criteria-file') !== undefined) patch.acceptanceCriteria = parseCriteria(readInput(opt('criteria-file')))
  return patch
}

function tickCriteria(ctx, id, patch) {
  const ticks = [['check', true], ['uncheck', false]].flatMap(([name, done]) => ctx.list(name).map((n) => [whole(name, n), done]))
  if (ticks.length === 0) return
  const criteria = (patch.acceptanceCriteria ?? ctx.tracker().getIssue(id).acceptanceCriteria).map((item) => ({ ...item }))
  for (const [n, done] of ticks) {
    if (n < 1 || n > criteria.length) throw usageError(`${id} has ${criteria.length} acceptance criteria, there is no number ${n}`, `pmkit issues get ${id}`)
    criteria[n - 1].done = done
  }
  patch.acceptanceCriteria = criteria
}

function parseCapacity(ctx) {
  const map = {}
  for (const pair of csv(ctx.list('set'))) {
    const match = /^([^=]+)=(\d+(?:\.\d+)?)$/.exec(pair)
    if (!match) throw usageError(`--set takes member=number pairs, got "${pair}"`, 'Use --set fred=8,ana=10')
    map[match[1]] = Number(match[2])
  }
  return map
}

/** Text of a write: the changed fields, or the new record after a create. */
function writeText(result, { dryRun, record = issueRecord, header }) {
  const one = (entry) => {
    const { before, after } = entry
    const head = `${after.id}${after.title ? `  ${after.title}` : ''}`
    if (before === null) return [head, record(after)].join('\n')
    const lines = changeLines(before, after)
    return [head, ...(lines.length > 0 ? lines : ['no change'])].join('\n')
  }
  const text = header ?? (Array.isArray(result) ? result.map(one).join('\n\n') : one(result))
  return dryRun ? `${text}\ndry run: nothing was written` : text
}

const issueWrite = (ctx, result, id = result.after.id) => ({ data: result, text: writeText(result, ctx), commit: id })

// Command table. `run` returns { data, text, commit }: the JSON value, the plain text and, for a write, the id for the commit message.
export const COMMANDS = [
  {
    name: 'init', summary: 'writes .pmkit/config.yaml and scaffolds .issues/; refuses to overwrite',
    usage: '[--tracker local] [--git-host github|none] [--prefix ISS] [--member id --name n --email e]',
    flags: ['tracker', 'git-host', 'prefix', 'member', 'name', 'email'], booleans: ['dry-run'], dryRun: true, run: runInit,
  },
  {
    name: 'capabilities', summary: 'prints the capability manifest', flags: [],
    run: (ctx) => {
      const manifest = ctx.tracker().capabilities()
      const rows = manifest.capabilities.map((c) => [c.id, c.path, c.enableHint ?? (c.detail ? Object.entries(c.detail).map(([k, v]) => `${k}=${[v].flat().join('/')}`).join(' ') : '')])
      return { data: manifest, text: [...fields([['tracker', manifest.tracker], ['git host', manifest.gitHost]]), '', table(['Capability', 'Path', 'Detail'], rows)].join('\n') }
    },
  },
  {
    name: 'discover', summary: 'prints statuses with categories, types, priorities, labels, members and the estimate scale', flags: [],
    run: (ctx) => {
      const d = ctx.tracker().discover()
      const text = [
        'statuses:', ...d.statuses.map((s) => `  ${s.name} (${s.category})`),
        ...fields([['types', d.types], ['priorities', d.priorities], ['labels', d.labels]]),
        'members:', ...(d.members.length > 0 ? d.members.map((m) => `  ${m.id}  ${m.name ?? ''} <${m.email ?? ''}>`) : ['  (none)']),
        `estimate: ${d.estimate.unit}${d.estimate.scale ? ` ${d.estimate.scale.join(', ')}` : ''}`,
      ].join('\n')
      return { data: d, text }
    },
  },
  {
    name: 'whoami', summary: 'prints the resolved actor', flags: [],
    run: (ctx) => {
      const actor = requireActor(ctx.config().local, { email: gitUserEmail(ctx.root), env: ctx.env })
      return { data: actor, text: `${actor.id}${actor.member?.name ? ` (${actor.member.name})` : ''}` }
    },
  },
  {
    name: 'issues list', summary: 'searches issues',
    usage: '[--text t] [--category c,..] [--type t,..] [--assignee me|none|id] [--label l,..] [--sprint current|none|id] [--parent id] [--blocked] [--updated-before d] [--updated-after d] [--sort s] [--limit n] [--archived]',
    flags: ['text', 'category', 'type', 'assignee', 'label', 'sprint', 'parent', 'blocked', 'updated-before', 'updated-after', 'sort', 'limit', 'archived'],
    run: (ctx) => {
      const found = ctx.tracker().searchIssues(issueFilter(ctx))
      const warnings = found.problems.map((p) => `${p.id}: ${p.code} ${p.message}`)
      return { data: found, text: issueTable(found.issues, { sprint: ctx.opt('sprint') === undefined }), warnings }
    },
  },
  {
    name: 'issues get', summary: 'one issue', usage: '<id> [--comments] [--history]', args: ['id'], flags: ['comments', 'history'],
    run: (ctx) => {
      const tracker = ctx.tracker()
      const issue = tracker.getIssue(ctx.args[0])
      const data = { ...issue }
      const parts = [issueRecord(issue)]
      if (ctx.flag('comments')) {
        data.comments = tracker.listComments(issue.id)
        parts.push('', 'comments:', ...(data.comments.length > 0 ? data.comments.map((c) => `${c.created} ${c.author}\n${c.body}`) : ['(none)']))
      }
      if (ctx.flag('history')) {
        data.history = tracker.getHistory(issue.id)
        parts.push('', 'history:', eventTable(data.history))
      }
      return { data, text: parts.join('\n') }
    },
  },
  {
    name: 'issues create', summary: 'creates an issue', write: true,
    usage: '--title t [--type] [--priority] [--estimate] [--assignee] [--label l,..] [--parent] [--sprint] [--due] [--description-file f] [--criteria-file f]',
    flags: ['title', 'type', 'priority', 'estimate', 'assignee', 'label', 'parent', 'sprint', 'due', 'description-file', 'criteria-file'],
    run: (ctx) => {
      const patch = issuePatch(ctx, { create: true })
      if (patch.title === undefined) throw usageError('issues create needs --title', 'pmkit issues create --title "..."')
      return issueWrite(ctx, ctx.tracker().createIssue(patch, ctx.actor(), { dryRun: ctx.dryRun }))
    },
  },
  {
    name: 'issues update', summary: 'edits fields and criteria', write: true, args: ['id'],
    usage: '<id> [--title] [--type] [--priority] [--estimate] [--label l,..] [--sprint] [--due] [--milestone] [--branch] [--description-file f] [--criteria-file f] [--check n] [--uncheck n]',
    flags: ['title', 'type', 'priority', 'estimate', 'label', 'sprint', 'due', 'milestone', 'branch', 'description-file', 'criteria-file', 'check', 'uncheck'],
    run: (ctx) => {
      const [id] = ctx.args
      const patch = issuePatch(ctx, { create: false })
      tickCriteria(ctx, id, patch)
      if (Object.keys(patch).length === 0) throw usageError('issues update needs at least one field flag', 'pmkit issues update <id> --priority high')
      return issueWrite(ctx, ctx.tracker().updateIssue(id, patch, ctx.actor(), { dryRun: ctx.dryRun }))
    },
  },
  {
    name: 'issues move', summary: 'changes status by category', usage: '<id> <category> [--status name]', write: true, args: ['id', 'category'], flags: ['status'],
    run: (ctx) => issueWrite(ctx, ctx.tracker().moveToCategory(ctx.args[0], ctx.args[1], ctx.actor(), { status: ctx.opt('status'), dryRun: ctx.dryRun })),
  },
  {
    name: 'issues assign', summary: 'assigns', usage: '<id> <member|none>', write: true, args: ['id', 'member'], flags: [],
    run: (ctx) => issueWrite(ctx, ctx.tracker().assign(ctx.args[0], ctx.args[1] === 'none' ? null : ctx.args[1], ctx.actor(), { dryRun: ctx.dryRun })),
  },
  {
    name: 'issues link', summary: 'links or unlinks', usage: '<from> <to> --kind blocks|related|duplicate [--remove]', write: true, args: ['from', 'to'], flags: ['kind', 'remove'],
    run: (ctx) => {
      if (ctx.opt('kind') === undefined) throw usageError('issues link needs --kind', 'Use --kind blocks, related or duplicate')
      const op = ctx.flag('remove') ? 'unlink' : 'link'
      const result = ctx.tracker()[op](ctx.args[0], ctx.args[1], ctx.opt('kind'), ctx.actor(), { dryRun: ctx.dryRun })
      return issueWrite(ctx, result, ctx.args[0])
    },
  },
  {
    name: 'issues parent', summary: 'sets the parent', usage: '<id> <parent|none>', write: true, args: ['id', 'parent'], flags: [],
    run: (ctx) => issueWrite(ctx, ctx.tracker().setParent(ctx.args[0], ctx.args[1] === 'none' ? null : ctx.args[1], ctx.actor(), { dryRun: ctx.dryRun })),
  },
  {
    name: 'issues comment', summary: 'comments', usage: '<id> --body-file f', write: true, args: ['id'], flags: ['body-file'],
    run: (ctx) => {
      if (ctx.opt('body-file') === undefined) throw usageError('issues comment needs --body-file', 'Pass a file, or - for stdin')
      const comment = ctx.tracker().comment(ctx.args[0], readInput(ctx.opt('body-file')), ctx.actor(), { dryRun: ctx.dryRun })
      return { data: comment, text: writeText(null, { dryRun: ctx.dryRun, header: `commented on ${comment.issue}` }), commit: comment.issue }
    },
  },
  {
    name: 'issues log-time', summary: 'logs time', usage: '<id> <minutes>', write: true, args: ['id', 'minutes'], flags: [],
    run: (ctx) => {
      const minutes = /^\d+$/.test(ctx.args[1]) ? Number(ctx.args[1]) : NaN
      const result = ctx.tracker().logTime(ctx.args[0], minutes, ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(null, { dryRun: ctx.dryRun, header: `logged ${minutes} minutes on ${result.after.id}` }), commit: result.after.id }
    },
  },
  {
    name: 'issues archive', summary: 'archives', usage: '<id>', write: true, args: ['id'], flags: [],
    run: (ctx) => issueWrite(ctx, ctx.tracker().archive(ctx.args[0], ctx.actor(), { dryRun: ctx.dryRun })),
  },
  {
    name: 'cycle list', summary: 'lists sprints', usage: '[--state s]', flags: ['state'],
    run: (ctx) => {
      const sprints = ctx.tracker().listCycles({ state: ctx.opt('state') })
      const text = sprints.length === 0 ? 'no sprints' : table(['ID', 'State', 'Start', 'End', 'Name'], sprints.map((s) => [s.id, s.state, s.start, s.end, s.name]))
      return { data: sprints, text }
    },
  },
  {
    name: 'cycle current', summary: 'prints the active sprint', flags: [],
    run: (ctx) => {
      const sprint = ctx.tracker().currentCycle()
      return { data: sprint, text: sprint ? sprintRecord(sprint) : 'no active sprint' }
    },
  },
  {
    name: 'cycle issues', summary: 'lists the issues of a sprint', usage: '<id>', args: ['id'], flags: [],
    run: (ctx) => {
      const issues = ctx.tracker().cycleIssues(ctx.args[0])
      return { data: issues, text: issueTable(issues, { sprint: false }) }
    },
  },
  {
    name: 'cycle open', summary: 'opens a sprint; the end defaults from sprint_length_days', usage: '--start d [--end d] [--goal g] [--name n]',
    write: true, flags: ['start', 'end', 'goal', 'name'],
    run: (ctx) => {
      const input = {}
      for (const key of ['start', 'end', 'goal', 'name']) if (ctx.opt(key) !== undefined) input[key] = ctx.opt(key)
      if (input.start === undefined) throw usageError('cycle open needs --start', 'pmkit cycle open --start YYYY-MM-DD')
      const result = ctx.tracker().openCycle(input, ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, { ...ctx, record: sprintRecord }), commit: result.after.id }
    },
  },
  {
    name: 'cycle close', summary: 'closes a sprint and prints the unfinished issues', usage: '<id>', write: true, args: ['id'], flags: [],
    run: (ctx) => {
      const result = ctx.tracker().closeCycle(ctx.args[0], ctx.actor(), { dryRun: ctx.dryRun })
      const head = `${result.sprint.id}  ${result.sprint.name}\nstate: active → closed\nunfinished issues:\n${issueTable(result.unfinished)}`
      return { data: result, text: writeText(null, { dryRun: ctx.dryRun, header: head }), commit: result.sprint.id }
    },
  },
  {
    name: 'cycle add', summary: 'moves issues into or out of a sprint', usage: '<id...> --to <sprint|none>', write: true, rest: 'id', flags: ['to'],
    run: (ctx) => {
      if (ctx.opt('to') === undefined) throw usageError('cycle add needs --to', 'Use --to <sprint> or --to none')
      const to = ctx.opt('to') === 'none' ? null : ctx.opt('to')
      const result = ctx.tracker().moveToCycle(ctx.args, to, ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, ctx), commit: to ?? ctx.args.join(' ') }
    },
  },
  {
    name: 'cycle capacity', summary: 'reads or sets capacity', usage: '<id> [--set member=n,..]', write: true, args: ['id'], flags: ['set'],
    run: (ctx) => {
      const tracker = ctx.tracker()
      const [id] = ctx.args
      if (ctx.opt('set') === undefined) {
        const capacity = tracker.getCapacity(id)
        return { data: capacity, text: fields(Object.entries(capacity)).join('\n') || 'no capacity set' }
      }
      const result = tracker.setCapacity(id, parseCapacity(ctx), ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, { ...ctx, record: sprintRecord }), commit: id }
    },
  },
  {
    name: 'epic list', summary: 'lists epics', flags: [],
    run: (ctx) => {
      const epics = ctx.tracker().listDeliverables()
      const text = epics.length === 0 ? 'no epics' : table(['ID', 'Title', 'Status', 'Start', 'Target'], epics.map((e) => [e.id, e.title, e.status.name, e.start ?? '', e.target ?? '']))
      return { data: epics, text }
    },
  },
  {
    name: 'epic get', summary: 'one epic', usage: '<id>', args: ['id'], flags: [],
    run: (ctx) => {
      const epic = ctx.tracker().getDeliverable(ctx.args[0])
      return { data: epic, text: epicRecord(epic) }
    },
  },
  {
    name: 'epic progress', summary: 'counts the issues under an epic', usage: '<id>', args: ['id'], flags: [],
    run: (ctx) => {
      const p = ctx.tracker().deliverableProgress(ctx.args[0])
      const text = [
        ...fields([['total', p.total], ['done', p.done], ['canceled', p.canceled], ['points', p.points], ['points done', p.pointsDone]]),
        ...Object.entries(p.byCategory).map(([category, count]) => `  ${category}: ${count}`),
      ].join('\n')
      return { data: p, text }
    },
  },
  {
    name: 'epic create', summary: 'creates an epic', usage: '--title t [--start d] [--target d]', write: true, flags: ['title', 'start', 'target'],
    run: (ctx) => {
      if (ctx.opt('title') === undefined) throw usageError('epic create needs --title', 'pmkit epic create --title "..."')
      const input = { title: ctx.opt('title') }
      for (const key of ['start', 'target']) if (ctx.opt(key) !== undefined) input[key] = ctx.opt(key)
      const result = ctx.tracker().createDeliverable(input, ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, { ...ctx, record: epicRecord }), commit: result.after.id }
    },
  },
  {
    name: 'epic update-status', summary: 'publishes a status update', usage: '<id> --health h --body-file f', write: true, args: ['id'], flags: ['health', 'body-file'],
    run: (ctx) => {
      if (ctx.opt('health') === undefined || ctx.opt('body-file') === undefined) throw usageError('epic update-status needs --health and --body-file', 'Health is on_track, at_risk or off_track')
      const input = { epic: ctx.args[0], health: ctx.opt('health'), body: readInput(ctx.opt('body-file')) }
      const result = ctx.tracker().publishStatusUpdate(input, ctx.actor(), { dryRun: ctx.dryRun })
      const text = [`status update on ${input.epic}`, ...fields([['health', result.after.health], ['by', result.after.author], ['at', result.after.at]]), '', result.after.body].join('\n')
      return { data: result, text: ctx.dryRun ? `${text}\ndry run: nothing was written` : text, commit: input.epic }
    },
  },
  {
    name: 'metrics velocity', summary: 'points or counts done per closed sprint, and the average', usage: '[--window n]', flags: ['window'],
    run: (ctx) => {
      const tracker = ctx.tracker()
      const window = ctx.opt('window') === undefined ? ctx.config().local.defaults.velocity_window : whole('window', ctx.opt('window'))
      const result = velocity(tracker.listCycles({ state: 'closed' }), tracker.issuesBySprint(), { window, categoryOf: tracker.categoryOf })
      const rows = result.perSprint.map((s) => [s.id, s.points, s.count])
      const text = [rows.length > 0 ? table(['Sprint', 'Points', 'Issues'], rows) : 'no closed sprints', `average: ${result.average} ${result.unit}`].join('\n')
      return { data: result, text }
    },
  },
  {
    name: 'metrics cycle-time', summary: 'median and p85 days from first in_progress to done', usage: '[--since d] [--until d]', flags: ['since', 'until'],
    run: (ctx) => {
      const tracker = ctx.tracker()
      const since = ctx.opt('since') === undefined ? undefined : dateText('since', ctx.opt('since'))
      const until = ctx.opt('until') === undefined ? undefined : dateText('until', ctx.opt('until'))
      const lastAt = until !== undefined && !until.includes('T') ? `${until}T23:59:59Z` : until
      const inRange = {}
      for (const [id, events] of Object.entries(tracker.eventsByIssue())) {
        const doneAt = lastEntry(events, 'done', tracker.categoryOf)
        if (doneAt === undefined || (since !== undefined && doneAt < since) || (lastAt !== undefined && doneAt > lastAt)) continue
        inRange[id] = events
      }
      const issues = cycleTimes(inRange, { categoryOf: tracker.categoryOf })
      const stats = summary(issues.map((item) => item.days))
      const text = fields([['count', stats.count], ['median', stats.median === null ? 'n/a' : `${stats.median} days`], ['p85', stats.p85 === null ? 'n/a' : `${stats.p85} days`]]).join('\n')
      return { data: { ...stats, issues }, text }
    },
  },
  {
    name: 'events', summary: 'all events in a range, for digests', usage: '[--since d] [--until d]', flags: ['since', 'until'],
    run: (ctx) => {
      const range = {}
      for (const key of ['since', 'until']) if (ctx.opt(key) !== undefined) range[key] = dateText(key, ctx.opt(key))
      const events = ctx.tracker().metricEvents(range)
      return { data: events, text: eventTable(events) }
    },
  },
  {
    name: 'validate', summary: 'checks every file and reference; problems are output, not errors', flags: [],
    run: (ctx) => {
      const result = validateRepo(ctx.root)
      const c = result.checked
      const head = `checked: ${c.issues} issues, ${c.epics} epics, ${c.sprints} sprints, ${c.comments} comments`
      const body = result.problems.length === 0 ? 'no problems' : result.problems.map((p) => `${p.path}  ${p.code}  ${p.message}`).join('\n')
      return { data: result, text: `${head}\n${body}` }
    },
  },
]

export const USAGE = `Usage: pmkit.mjs <command> [options]

Every command takes --json and --root <dir>. Every write also takes --dry-run and --as <member>.

Commands:
${COMMANDS.map((c) => `  ${c.name}${c.usage ? ` ${c.usage}` : ''}\n      ${c.summary}`).join('\n')}
`

// init is the only command that runs before a config exists.
function runInit(ctx) {
  const { opt } = ctx
  if ((opt('tracker') ?? 'local') !== 'local') throw new PmkitError('NOT_SUPPORTED', `tracker "${opt('tracker')}" is not supported yet`, 'Use --tracker local')
  const host = opt('git-host') ?? 'none'
  if (!['github', 'none'].includes(host)) throw usageError('--git-host must be github or none')
  const member = opt('member')
  if (member !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(member)) throw usageError('--member must be kebab-case, like fred')

  const root = ctx.root
  const pmkitFile = path.join('.pmkit', 'config.yaml')
  const issuesConfig = path.join('.issues', 'config.yaml')
  for (const file of [pmkitFile, issuesConfig]) {
    if (fs.existsSync(path.join(root, file))) {
      throw new PmkitError('CONFLICT', `${file.split(path.sep).join('/')} already exists`, 'Edit it, or delete it to start over')
    }
  }

  const template = (name) => fs.readFileSync(path.join(TEMPLATES, name), 'utf8')
  const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' })
  const repo = remote.status === 0 ? /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?\s*$/.exec(remote.stdout)?.[1] : undefined
  const pmkit = template('pmkit.config.yaml').replace(
    /git_host:\n {2}system: .*\n {2}repo: .*\n/,
    `git_host:\n  system: ${host}\n${repo ? `  repo: ${repo}\n` : ''}`,
  )
  const members = member === undefined
    ? 'members: {}'
    : `members:\n${stringifyYaml({ [member]: { name: opt('name') ?? member, email: opt('email') } }).replace(/^/gm, '  ').trimEnd()}`
  const local = template('issues.config.yaml').replace('id_prefix: ISS', `id_prefix: ${opt('prefix') ?? 'ISS'}`).replace('members: {}', members)
  const problems = validateLocalConfig(parseYaml(local))
  if (problems.length > 0) throw usageError(`the generated .issues/config.yaml is not valid: ${problems.join('; ')}`, 'Fix the init flags')

  const files = [
    [pmkitFile, pmkit],
    [issuesConfig, local],
    [path.join('.issues', '.gitattributes'), template('issues.gitattributes')],
    [path.join('.issues', '.gitignore'), template('issues.gitignore')],
    ...['issues', 'epics', 'sprints', 'docs'].map((dir) => [path.join('.issues', dir, '.gitkeep'), '']),
  ]
  if (!ctx.dryRun) {
    for (const [file, content] of files) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      fs.writeFileSync(path.join(root, file), content)
    }
  }
  const written = files.map(([file]) => file.split(path.sep).join('/'))
  return {
    data: { dryRun: ctx.dryRun, written },
    text: [ctx.dryRun ? 'would write:' : 'wrote:', ...written.map((file) => `  ${file}`), ...(ctx.dryRun ? ['dry run: nothing was written'] : [])].join('\n'),
  }
}

function commitTracker(config, message) {
  const rel = (config.pmkit.tracker.path ?? '.issues').split(path.sep).join('/')
  const git = (...args) => spawnSync('git', args, { cwd: config.root, encoding: 'utf8' })
  const fail = (result) => new PmkitError('UPSTREAM', `the write succeeded but auto_commit failed: ${(result.stderr || result.stdout).trim()}`, `Commit ${rel} yourself`)
  const added = git('add', '--', rel)
  if (added.status !== 0) throw fail(added)
  if (git('diff', '--cached', '--quiet', '--', rel).status === 0) return
  const committed = git('commit', '-m', message, '--', rel)
  if (committed.status !== 0) throw fail(committed)
}

function findCommand(name) {
  return COMMANDS.find((command) => command.name === name)
}

function checkUsage(command, { options, positionals }) {
  const allowed = new Set(['json', 'root', 'help', ...command.flags, ...(command.write || command.dryRun ? ['dry-run'] : []), ...(command.write ? ['as'] : [])])
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw usageError(`unknown option --${key} for ${command.name}`, `pmkit.mjs --help (${command.name}${command.usage ? ` ${command.usage}` : ''})`)
    if (options[key] === true && !BOOLEANS.has(key)) {
      throw usageError(`--${key} needs a value`, `pmkit.mjs --help (${command.name})`)
    }
  }
  const expected = command.args ?? []
  const label = `${command.name}${command.usage ? ` ${command.usage}` : ''}`
  if (command.rest ? positionals.length < 1 : positionals.length !== expected.length) {
    throw usageError(`${command.name} takes ${command.rest ? 'at least one <id>' : expected.length === 0 ? 'no arguments' : expected.map((a) => `<${a}>`).join(' ')}`, `Usage: ${label}`)
  }
}

/** Runs one command line. Returns the text for each stream and the exit code. */
export function run(argv, { env = process.env, cwd = process.cwd() } = {}) {
  const stdout = []
  const stderr = []
  let code = 0
  // Until the arguments parse, a bare --json or --json=true still asks for a JSON error.
  let json = argv.includes('--json') || argv.includes('--json=true')
  try {
    const parsed = parseArgs(argv)
    json = last(parsed.options.json) === true
    if (last(parsed.options.help) === true) {
      stdout.push(USAGE)
      return { code: 2, stdout: stdout.join(''), stderr: '' }
    }
    const command = parsed.command === undefined ? undefined : findCommand(parsed.command)
    if (!command) {
      const message = parsed.command === undefined ? 'no command given' : `unknown command "${parsed.command}"`
      if (json) throw usageError(message)
      stderr.push(`error: ${message}\n${USAGE}`)
      return { code: 2, stdout: '', stderr: stderr.join('') }
    }
    checkUsage(command, parsed)
    const { options } = parsed
    const root = path.resolve(typeof options.root === 'string' ? options.root : findRoot(cwd))
    const dryRun = last(options['dry-run']) === true
    const now = clock(env)
    const random = randomSource(env)
    let loaded
    let tracker
    const ctx = {
      root, env, dryRun, args: parsed.positionals, json,
      opt: (name) => last(options[name]),
      list: (name) => (options[name] === undefined ? [] : [options[name]].flat()),
      flag: (name) => last(options[name]) === true,
      config: () => (loaded ??= loadConfig(root)),
      tracker: () => (tracker ??= createLocalTracker(root, { config: ctx.config(), now, random, env })),
      actor: () => (typeof options.as === 'string'
        ? options.as
        : requireActor(ctx.config().local, { email: gitUserEmail(root), env }).id),
    }
    const result = command.run(ctx)
    if (command.write && !dryRun && result.commit !== undefined && ctx.config().local.auto_commit === true) {
      try {
        commitTracker(ctx.config(), `pmkit: ${command.name} ${result.commit}`)
      } catch (error) {
        // The write succeeded; the caller still gets what was written, in the same single output.
        error.written = { data: result.data, text: result.text }
        throw error
      }
    }
    stdout.push(json ? `${JSON.stringify(result.data, null, 2)}\n` : `${result.text}\n`)
    for (const warning of result.warnings ?? []) stderr.push(`warning: ${warning}\n`)
  } catch (error) {
    code = 2
    if (isPmkitError(error)) {
      if (json) {
        const body = { error: { code: error.code, message: error.message, nextStep: error.nextStep } }
        if (error.written) body.result = error.written.data
        stdout.push(`${JSON.stringify(body, null, 2)}\n`)
      } else if (error.written) {
        stdout.push(`${error.written.text}\n`)
        stderr.push(`error: ${error.message}\n${error.nextStep ? `next: ${error.nextStep}\n` : ''}`)
      } else stderr.push(`error: ${error.message}\n${error.nextStep ? `next: ${error.nextStep}\n` : ''}`)
    } else if (json) {
      stdout.push(`${JSON.stringify({ error: { code: 'UNEXPECTED', message: `unexpected: ${error.message}` } }, null, 2)}\n`)
    } else {
      stderr.push(`error: unexpected: ${error.message}\n`)
    }
  }
  return { code, stdout: stdout.join(''), stderr: stderr.join('') }
}

const invokedPath = process.argv[1] ? fs.realpathSync(process.argv[1]) : null
if (invokedPath && invokedPath === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const result = run(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exitCode = result.code
}
