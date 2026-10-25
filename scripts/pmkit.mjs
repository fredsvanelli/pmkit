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
import { parseYaml } from './lib/yaml.mjs'
import { addMapEntry, setScalar } from './lib/yaml-edit.mjs'
import { lineDiff } from './lib/diff.mjs'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { FORMAT_VERSION, MIGRATIONS, applyMigration, formatError, formatState, planMigration } from './lib/local/migrations.mjs'
import { parseChangelog, sectionsSince } from './lib/changelog.mjs'
import { createGithubHost } from './lib/github/host.mjs'
import { ID_STYLES, branchName } from './lib/ids.mjs'

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
    set('milestone', opt('milestone'))
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

function parseDaysOff(ctx) {
  const map = {}
  for (const pair of csv(ctx.list('days-off'))) {
    const fail = () => usageError(`--days-off takes member=date+date pairs, got "${pair}"`, 'Use --days-off ana=2026-10-16+2026-10-19')
    const match = /^([^=]+)=(.+)$/.exec(pair)
    if (!match) throw fail()
    if (match[2] === 'none') {
      map[match[1]] = null
      continue
    }
    const dates = match[2].split('+')
    if (dates.some((date) => date === '')) throw fail()
    map[match[1]] = dates
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
const defaultBranch = (ctx) => ctx.config().pmkit.git_host?.default_branch ?? 'main'

function defaultPrBody(issue) {
  const lines = [`Tracker issue: ${issue.id}`]
  if (issue.acceptanceCriteria.length > 0) {
    lines.push('', '## Acceptance criteria', ...issue.acceptanceCriteria.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`))
  }
  return lines.join('\n')
}
const problemLine = (problem) => `${problem.id}: ${problem.code} ${problem.message}`

// Command table. `run` returns { data, text, commit }: the JSON value, the plain text and, for a write, the id for the commit message.
export const COMMANDS = [
  {
    name: 'init', summary: 'writes .pmkit/config.yaml and scaffolds .issues/; refuses to overwrite unless --update, which edits only the lines its flags name',
    usage: '[--tracker local] [--git-host github|none] [--prefix ISS] [--id-style random|numbered] [--estimate-unit points|hours|sizes] [--member id --name n --email e] [--members-file f|-] [--update [--replace path ...]]',
    flags: ['tracker', 'git-host', 'prefix', 'id-style', 'member', 'name', 'email', 'estimate-unit', 'members-file', 'update', 'replace'], booleans: ['dry-run'], dryRun: true, run: runInit,
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
    name: 'issues list', summary: 'searches issues, oldest created first unless --sort says otherwise',
    usage: '[--text t] [--category c,..] [--type t,..] [--assignee me|none|id] [--label l,..] [--sprint current|none|id] [--parent id] [--blocked] [--updated-before d] [--updated-after d] [--sort s] [--limit n] [--archived]',
    flags: ['text', 'category', 'type', 'assignee', 'label', 'sprint', 'parent', 'blocked', 'updated-before', 'updated-after', 'sort', 'limit', 'archived'],
    run: (ctx) => {
      const found = ctx.tracker().searchIssues(issueFilter(ctx))
      const warnings = found.problems.map(problemLine)
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
    usage: '--title t [--type] [--priority] [--estimate] [--assignee] [--label l,..] [--parent] [--sprint] [--due] [--milestone m] [--description-file f] [--criteria-file f]',
    flags: ['title', 'type', 'priority', 'estimate', 'assignee', 'label', 'parent', 'sprint', 'due', 'milestone', 'description-file', 'criteria-file'],
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
    name: 'issues assign', summary: 'assigns', usage: '<id> <member|me|none>', write: true, args: ['id', 'member'], flags: [],
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
      const warnings = result.problems.map(problemLine)
      return { data: result, text: writeText(null, { dryRun: ctx.dryRun, header: head }), commit: result.sprint.id, warnings }
    },
  },
  {
    name: 'cycle add', summary: 'moves issues into or out of a sprint', usage: '<id...> --to <sprint|current|none>', write: true, rest: 'id', flags: ['to'],
    run: (ctx) => {
      if (ctx.opt('to') === undefined) throw usageError('cycle add needs --to', 'Use --to <sprint> or --to none')
      const to = ctx.opt('to') === 'none' ? null : ctx.opt('to')
      const result = ctx.tracker().moveToCycle(ctx.args, to, ctx.actor(), { dryRun: ctx.dryRun })
      const sprint = to === null ? undefined : result[0].after.sprint
      return { data: result, text: writeText(result, ctx), commit: sprint ?? ctx.args.join(' ') }
    },
  },
  {
    name: 'cycle capacity', summary: 'reads or sets capacity and days off', usage: '<id> [--set member=n,..] [--days-off member=date+date,..]', write: true, args: ['id'], flags: ['set', 'days-off'],
    run: (ctx) => {
      const tracker = ctx.tracker()
      const [id] = ctx.args
      const set = ctx.opt('set') !== undefined
      const dayoff = ctx.opt('days-off') !== undefined
      if (!set && !dayoff) {
        const capacity = tracker.getCapacity(id)
        const daysOff = tracker.getDaysOff(id)
        const lines = [
          ...fields(Object.entries(capacity)),
          ...Object.entries(daysOff).map(([member, dates]) => `days off ${member}: ${dates.join(', ')}`),
        ]
        return { data: { capacity, days_off: daysOff }, text: lines.join('\n') || 'no capacity or days off set' }
      }
      const result = tracker.updateCycleCapacity(id, { capacity: set ? parseCapacity(ctx) : undefined, daysOff: dayoff ? parseDaysOff(ctx) : undefined }, ctx.actor(), { dryRun: ctx.dryRun })
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
    name: 'epic updates', summary: 'lists the status updates of an epic, newest first', usage: '<id>', args: ['id'], flags: [],
    run: (ctx) => {
      const updates = ctx.tracker().listStatusUpdates(ctx.args[0])
      const text = updates.length === 0
        ? 'no status updates'
        : updates.map((u) => [`${u.at}  ${u.health}  ${u.author}`, u.body].join('\n')).join('\n\n')
      return { data: updates, text }
    },
  },
  {
    name: 'docs read', summary: 'prints a document under the docs folder', usage: '<path>', args: ['path'], flags: [],
    run: (ctx) => {
      const doc = ctx.tracker().readDocument(ctx.args[0])
      return { data: doc, text: doc.body }
    },
  },
  {
    name: 'docs create', summary: 'creates a document under the docs folder', usage: '<path> --body-file f', write: true, args: ['path'], flags: ['body-file'],
    run: (ctx) => {
      if (ctx.opt('body-file') === undefined) throw usageError('docs create needs --body-file', 'Pass a file, or - for stdin')
      const result = ctx.tracker().createDocument(ctx.args[0], readInput(ctx.opt('body-file')), ctx.actor(), { dryRun: ctx.dryRun })
      const text = `${ctx.dryRun ? 'would create' : 'created'} document ${result.after.path}${ctx.dryRun ? '\ndry run: nothing was written' : ''}`
      return { data: result, text, commit: result.after.path }
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
    name: 'issues branch', summary: 'creates the issue branch and records it on the issue', usage: '<id> [--from branch]', write: true, args: ['id'], flags: ['from'],
    run: (ctx) => {
      const host = ctx.host()
      const tracker = ctx.tracker()
      const issue = tracker.getIssue(ctx.args[0])
      const branch = branchName(issue.id, issue.title)
      const from = ctx.opt('from') ?? defaultBranch(ctx)
      // Check the tracker write first, so a refused write leaves git on the branch it was on.
      const actor = ctx.actor()
      tracker.updateIssue(issue.id, { branch }, actor, { dryRun: true })
      if (ctx.dryRun) return { data: { branch, from }, text: `would create branch ${branch} from ${from}\ndry run: nothing was written` }
      host.createBranch(branch, { from })
      const result = tracker.updateIssue(issue.id, { branch }, actor)
      return { data: { branch, ...result }, text: `created branch ${branch} from ${from}\n${writeText(result, ctx)}`, commit: issue.id }
    },
  },
  {
    name: 'pr open', summary: 'pushes the issue branch and opens a pull request, or returns the one already open', usage: '--issue <id> [--draft] [--body-file f]', write: true, args: [], flags: ['issue', 'body-file', 'draft'],
    run: (ctx) => {
      if (ctx.opt('issue') === undefined) throw usageError('pr open needs --issue', 'pmkit pr open --issue <id>')
      const host = ctx.host()
      const issue = ctx.tracker().getIssue(ctx.opt('issue'))
      if (!issue.branch) throw usageError(`${issue.id} has no branch`, `pmkit issues branch ${issue.id}`)
      const body = ctx.opt('body-file') !== undefined ? readInput(ctx.opt('body-file')) : defaultPrBody(issue)
      const request = { title: `${issue.title} (${issue.id})`, body, head: issue.branch, base: defaultBranch(ctx), draft: ctx.flag('draft') }
      // gh refuses a second pull request for a branch, so an open one is pushed to and returned as it is.
      const found = host.getPullRequest({ head: issue.branch })
      const open = found?.state === 'OPEN' ? found : null
      if (ctx.dryRun) {
        const text = open
          ? `would push ${issue.branch} to the open pull request #${open.number}${open.isDraft ? ' (draft)' : ''} ${open.url}`
          : `would open a pull request ${request.head} to ${request.base}\n${request.title}\n\n${body}`
        return { data: { ...request, existing: open !== null, pr: open }, text: `${text}\ndry run: nothing was written` }
      }
      host.push(issue.branch)
      if (open) return { data: { ...open, existing: true }, text: `pushed ${issue.branch} to the open pull request #${open.number}${open.isDraft ? ' (draft)' : ''} ${open.url}` }
      const pr = host.openPullRequest(request)
      return { data: { ...pr, existing: false }, text: `opened pull request #${pr.number} ${pr.url}` }
    },
  },
  {
    name: 'pr ready', summary: 'marks the open draft pull request of an issue ready for review', usage: '--issue <id>', write: true, args: [], flags: ['issue'],
    run: (ctx) => {
      if (ctx.opt('issue') === undefined) throw usageError('pr ready needs --issue', 'pmkit pr ready --issue <id>')
      const host = ctx.host()
      const issue = ctx.tracker().getIssue(ctx.opt('issue'))
      if (!issue.branch) throw usageError(`${issue.id} has no branch`, `pmkit issues branch ${issue.id}`)
      const pr = host.getPullRequest({ head: issue.branch })
      if (pr?.state !== 'OPEN') throw usageError(`${issue.branch} has no open pull request`, `pmkit pr open --issue ${issue.id}`)
      if (!pr.isDraft) throw usageError(`pull request #${pr.number} is not a draft, it is already ready for review`, `pmkit pr status --branch ${issue.branch}`)
      if (ctx.dryRun) return { data: { ...pr, isDraft: false }, text: `would mark pull request #${pr.number} ready for review ${pr.url}\ndry run: nothing was written` }
      const ready = host.markReady(pr.number)
      return { data: ready, text: `marked pull request #${ready.number} ready for review ${ready.url}` }
    },
  },
  {
    name: 'pr status', summary: 'pull request, checks and reviews of a branch', usage: '[--branch b]', args: [], flags: ['branch'],
    run: (ctx) => {
      const host = ctx.host()
      const branch = ctx.opt('branch') ?? host.currentBranch()
      if (branch === '') throw new PmkitError('INVALID_INPUT', 'no current branch (detached HEAD)', 'pass --branch <branch>, or switch to a branch')
      const pr = host.getPullRequest({ head: branch })
      const checks = pr ? host.prChecks(pr.number) : []
      const reviews = pr ? host.prReviews(pr.number).reviews : []
      const lines = pr
        ? [`#${pr.number} ${pr.title} (${pr.state}${pr.isDraft ? ', draft' : ''})`, pr.url, `checks: ${checks.length === 0 ? '(none)' : checks.map((c) => `${c.name} ${c.bucket ?? c.state}`).join(', ')}`, `reviews: ${reviews.length === 0 ? '(none)' : reviews.map((r) => r.state).join(', ')}`]
        : [`no pull request for ${branch}`]
      return { data: { branch, pr, checks, reviews }, text: lines.join('\n') }
    },
  },
  {
    name: 'pr sync', summary: 'moves in_review issues to done when their pull request is merged', write: true, args: [], flags: [],
    run: (ctx) => {
      const host = ctx.host()
      const tracker = ctx.tracker()
      const actor = ctx.actor()
      const found = tracker.searchIssues({ categories: ['in_review'] })
      const candidates = found.issues.filter((issue) => issue.branch)
      const moved = []
      // A file that does not parse may be an in_review issue, so it is reported, not skipped.
      const problems = found.problems.map(({ id, code, message }) => ({ id, code, message }))
      for (const issue of candidates) {
        try {
          const pr = host.getPullRequest({ head: issue.branch })
          if (pr?.mergedAt) {
            tracker.moveToCategory(issue.id, 'done', actor, { dryRun: ctx.dryRun })
            moved.push({ id: issue.id, pr: pr.number })
          }
        } catch (error) {
          // A missing or logged out gh fails every lookup the same way, so it stops the command.
          if (!isPmkitError(error) || error.code === 'NOT_CONFIGURED' || error.code === 'AUTH') throw error
          problems.push({ id: issue.id, code: error.code, message: error.message })
        }
      }
      const lines = [`checked ${candidates.length} in_review issues, moved ${moved.length} to done`, ...moved.map((m) => `  ${m.id} merged in #${m.pr}`), ...problems.map((p) => `  ${problemLine(p)}`)]
      if (ctx.dryRun) lines.push('dry run: nothing was written')
      const data = { checked: candidates.length, moved, problems }
      return { data, text: lines.join('\n'), commit: moved.length > 0 ? moved.map((m) => m.id).join(' ') : undefined }
    },
  },
  {
    name: 'changelog', summary: 'prints the CHANGELOG.md sections newer than a version, oldest first; needs no config', usage: '--file f --since v', flags: ['file', 'since'],
    run: (ctx) => {
      if (ctx.opt('file') === undefined || ctx.opt('since') === undefined) throw usageError('changelog needs --file and --since', 'Use --file <CHANGELOG.md> --since <version>')
      const sections = sectionsSince(parseChangelog(readInput(path.resolve(ctx.cwd, ctx.opt('file')))), ctx.opt('since'))
      const text = sections.length === 0
        ? 'no changes since this version'
        : sections.map((s) => [`${s.version}  ${s.date}`, s.body, ...(s.trackerFormat === null ? [] : [`tracker format: ${s.trackerFormat}`]), ...s.setup.map((reason) => `setup: ${reason}`)].filter(Boolean).join('\n')).join('\n\n')
      return { data: sections, text }
    },
  },
  {
    name: 'migrate', summary: 'moves the tracker files to the format this pmkit writes; --dry-run lists every file it would touch', write: true, flags: [],
    run: (ctx) => runMigrate(ctx.root, { dryRun: ctx.dryRun }),
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

const gitIn = (root, ...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })

/** Plans the migration, then writes it unless `dryRun`. `formatVersion` and `migrations` default to the real ones. */
export function runMigrate(root, { dryRun = false, formatVersion = FORMAT_VERSION, migrations = MIGRATIONS } = {}) {
  const config = loadConfig(root, { checkFormat: false })
  const { version } = config.format
  const trackerPath = (config.pmkit.tracker.path ?? '.issues').split(path.sep).join('/')
  const state = formatState(version, formatVersion)
  if (state === 'ahead') throw formatError({ state, version, current: formatVersion })
  const result = (steps, commit) => {
    const data = { from: version, to: formatVersion, steps: steps.map(({ from, to, changes }) => ({ from, to, changes })) }
    if (commit !== undefined) data.commit = commit
    const lines = steps.length === 0
      ? [`the tracker is already at format ${formatVersion}, nothing to migrate`]
      : [
          `${dryRun ? 'would migrate' : 'migrated'} tracker format ${version} to ${formatVersion}`,
          ...steps.flatMap((step) => [`step ${step.from} to ${step.to}: ${step.describe}`, ...step.changes.map((c) => `  ${c.action}  ${c.path}`)]),
          ...(commit !== undefined ? [`committed: ${commit}`] : []),
          ...(dryRun ? ['dry run: nothing was written'] : []),
        ]
    return { data, text: lines.join('\n') }
  }
  if (state === 'current') return result([])
  const inside = gitIn(root, 'rev-parse', '--is-inside-work-tree')
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    throw new PmkitError('NOT_CONFIGURED', 'this folder is not a git repository, or git is not installed', 'migrate needs a git repository: git history is the only way back from a migration')
  }
  const dirty = gitIn(root, 'status', '--porcelain', '--', trackerPath)
  if (dirty.status !== 0 || dirty.stdout.trim() !== '') {
    throw new PmkitError('CONFLICT', `there are uncommitted changes under ${trackerPath}`, `Commit or discard the changes under ${trackerPath} first`)
  }
  const plan = planMigration({ root, trackerPath, from: version, to: formatVersion, migrations })
  if (dryRun) return result(plan.steps)
  applyMigration(plan, { root })
  const message = `pmkit: migrate tracker format ${version} to ${formatVersion}`
  const migrated = loadConfig(root, { formatVersion, migrations })
  if (migrated.local.auto_commit !== true) return result(plan.steps)
  const done = result(plan.steps, message)
  try {
    commitTracker(migrated, message)
  } catch (error) {
    error.written = { data: done.data, text: done.text }
    throw error
  }
  return done
}

export const USAGE = `Usage: pmkit.mjs <command> [options]

Every command takes --json and --root <dir>. Every write also takes --dry-run and --as <member>.

Commands:
${COMMANDS.map((c) => `  ${c.name}${c.usage ? ` ${c.usage}` : ''}\n      ${c.summary}`).join('\n')}
`

// init is the only command that runs before a config exists.
const ESTIMATE_UNITS = ['points', 'hours', 'sizes']
const SIZE_SCALE = ['XS', 'S', 'M', 'L', 'XL']
const slash = (file) => file.split(path.sep).join('/')
const normalized = (text) => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')

// Members from --member and --members-file, as [id, { name, email }] pairs.
function initMembers(opt) {
  const entries = []
  const check = (id) => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw usageError(`member id "${id}" must be kebab-case, like fred`)
  }
  const member = opt('member')
  if (member !== undefined) {
    check(member)
    entries.push([member, { name: opt('name') ?? member, email: opt('email') }])
  }
  if (opt('members-file') !== undefined) {
    let parsed
    try {
      parsed = parseYaml(readInput(opt('members-file')))
    } catch (error) {
      if (isPmkitError(error)) throw error
      throw usageError(`--members-file is not valid YAML: ${error.message}`)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw usageError('--members-file must be a YAML map of id: { name, email }')
    for (const [id, value] of Object.entries(parsed)) {
      check(id)
      if (value === null || typeof value !== 'object' || typeof value.name !== 'string' || value.name === '') {
        throw usageError(`member ${id} needs a name`)
      }
      entries.push([id, { name: value.name, email: value.email }])
    }
  }
  return entries
}

function runInit(ctx) {
  const { opt } = ctx
  const update = ctx.flag('update')
  if ((opt('tracker') ?? 'local') !== 'local') throw new PmkitError('NOT_SUPPORTED', `tracker "${opt('tracker')}" is not supported yet`, 'Use --tracker local')
  const host = opt('git-host')
  if (host !== undefined && !['github', 'none'].includes(host)) throw usageError('--git-host must be github or none')
  const idStyle = opt('id-style')
  if (idStyle !== undefined && !ID_STYLES.includes(idStyle)) throw usageError(`--id-style must be ${ID_STYLES.join(' or ')}`)
  const unit = opt('estimate-unit')
  if (unit !== undefined && !ESTIMATE_UNITS.includes(unit)) throw usageError(`--estimate-unit must be ${ESTIMATE_UNITS.join(', ')}`)
  if (update && opt('prefix') !== undefined) throw usageError('id_prefix cannot change after setup', 'Remove --prefix')
  const members = initMembers(opt)

  const root = ctx.root
  const read = (file) => normalized(fs.readFileSync(path.join(root, file), 'utf8'))
  const exists = (file) => fs.existsSync(path.join(root, file))
  const template = (name) => fs.readFileSync(path.join(TEMPLATES, name), 'utf8')
  const pmkitFile = path.join('.pmkit', 'config.yaml')
  let trackerDir = '.issues'
  if (update) {
    if (!exists(pmkitFile)) throw usageError('.pmkit/config.yaml does not exist, so there is no setup to update', 'Run init without --update')
    try {
      trackerDir = parseYaml(read(pmkitFile)).tracker?.path ?? '.issues'
    } catch (error) {
      throw new PmkitError('INVALID_INPUT', `.pmkit/config.yaml is not valid YAML: ${error.message}`, 'Fix the file, then run init --update again')
    }
  }
  const issuesConfig = path.join(trackerDir, 'config.yaml')
  if (update) {
    if (!exists(issuesConfig)) throw new PmkitError('NOT_CONFIGURED', `${slash(issuesConfig)} does not exist`, 'Restore it from git, or delete .pmkit/config.yaml and run init without --update')
  } else {
    for (const file of [pmkitFile, issuesConfig]) {
      if (exists(file)) throw new PmkitError('CONFLICT', `${slash(file)} already exists`, 'Edit it, or delete it to start over')
    }
  }

  // A file edited by hand may hold a shape the line editor cannot change; name the file and the key.
  const edit = (file, key, change) => {
    try {
      return change()
    } catch (error) {
      if (isPmkitError(error)) throw error
      throw new PmkitError('INVALID_INPUT', `cannot set ${key} in ${slash(file)}: ${error.message}`, `Edit ${key} in ${slash(file)} by hand, then run init --update again`)
    }
  }
  let pmkit
  let local
  if (update) {
    pmkit = read(pmkitFile)
    local = read(issuesConfig)
    if (host !== undefined) pmkit = edit(pmkitFile, 'git_host.system', () => setScalar(pmkit, ['git_host', 'system'], host))
  } else {
    const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' })
    const repo = remote.status === 0 ? /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?\s*$/.exec(remote.stdout)?.[1] : undefined
    pmkit = template('pmkit.config.yaml').replace(
      /git_host:\n {2}system: .*\n {2}repo: .*\n/,
      `git_host:\n  system: ${host ?? 'none'}\n${repo ? `  repo: ${repo}\n` : ''}`,
    )
    local = setScalar(template('issues.config.yaml').replace('id_prefix: ISS', `id_prefix: ${opt('prefix') ?? 'ISS'}`), ['version'], FORMAT_VERSION)
  }
  if (idStyle !== undefined) local = edit(issuesConfig, 'id_style', () => setScalar(local, ['id_style'], idStyle))
  if (unit !== undefined) {
    local = edit(issuesConfig, 'estimate.unit', () => setScalar(local, ['estimate', 'unit'], unit))
    if (unit === 'sizes') local = edit(issuesConfig, 'estimate.scale', () => setScalar(local, ['estimate', 'scale'], SIZE_SCALE))
  }
  const parsedLocal = () => {
    try {
      return parseYaml(local)
    } catch (error) {
      throw new PmkitError('INVALID_INPUT', `${slash(issuesConfig)} is not valid YAML: ${error.message}`, 'Fix the file, then run init --update again')
    }
  }
  const kept = []
  const existing = update ? Object.keys(parsedLocal().members ?? {}) : []
  for (const [id, value] of members) {
    if (existing.includes(id)) {
      if (!kept.includes(id)) kept.push(id)
    } else {
      local = edit(issuesConfig, `members.${id}`, () => addMapEntry(local, ['members'], id, value))
      existing.push(id)
    }
  }
  const problems = validateLocalConfig(parsedLocal())
  if (problems.length > 0) throw usageError(`the ${update ? '' : 'generated '}${slash(issuesConfig)} is not valid: ${problems.join('; ')}`, 'Fix the init flags')

  const replace = new Set(ctx.list('replace').flatMap((item) => String(item).split(',')).map((item) => item.trim().replace(/\\/g, '/')))
  const entries = []
  const place = (file, content) => {
    const rel = slash(file)
    if (!exists(file)) return entries.push({ path: rel, action: 'create', content })
    const before = read(file)
    if (before === content) return entries.push({ path: rel, action: 'keep', content })
    const diff = lineDiff(before, content)
    if (!replace.has(rel)) return entries.push({ path: rel, action: 'differs', diff, content: before })
    return entries.push({ path: rel, action: 'replace', diff, content })
  }
  const edited = (file, content) => {
    const rel = slash(file)
    if (!exists(file)) return entries.push({ path: rel, action: 'create', content })
    const before = read(file)
    if (before === content) return entries.push({ path: rel, action: 'keep', content })
    return entries.push({ path: rel, action: 'change', diff: lineDiff(before, content), content })
  }
  edited(pmkitFile, pmkit)
  edited(issuesConfig, local)
  place(path.join(trackerDir, '.gitattributes'), template('issues.gitattributes'))
  place(path.join(trackerDir, '.gitignore'), template('issues.gitignore'))
  for (const dir of ['issues', 'epics', 'sprints', 'docs']) place(path.join(trackerDir, dir, '.gitkeep'), '')

  if (!ctx.dryRun) {
    for (const entry of entries) {
      if (!['create', 'change', 'replace'].includes(entry.action)) continue
      const file = path.join(root, entry.path)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, entry.content)
    }
  }
  const files = entries.map(({ content, ...entry }) => entry)
  const label = { create: 'create', change: 'change', replace: 'replace', differs: 'differs, left as it is', keep: 'keep' }
  const lines = files.map((file) => `  ${file.path}: ${ctx.dryRun && file.action !== 'keep' && file.action !== 'differs' ? 'would ' : ''}${label[file.action]}`)
  return {
    data: { dryRun: ctx.dryRun, files, kept },
    text: [
      ctx.dryRun ? 'files:' : 'wrote:', ...lines,
      ...(kept.length > 0 ? [`members kept as they were: ${kept.join(', ')}`] : []),
      ...files.filter((file) => file.diff).flatMap((file) => ['', `${file.path}:`, file.diff.trimEnd()]),
      ...(ctx.dryRun ? ['dry run: nothing was written'] : []),
    ].join('\n'),
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

function makeHost(ctx) {
  if (ctx.config().pmkit.git_host?.system !== 'github') {
    throw new PmkitError('NOT_SUPPORTED', 'this repository has no git host configured', 'Set git_host.system to github in .pmkit/config.yaml, or run /pmkit:setup')
  }
  return createGithubHost({ root: ctx.root, env: ctx.env })
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
    let host
    const ctx = {
      root, cwd, env, dryRun, args: parsed.positionals, json,
      opt: (name) => last(options[name]),
      list: (name) => (options[name] === undefined ? [] : [options[name]].flat()),
      flag: (name) => last(options[name]) === true,
      config: () => (loaded ??= loadConfig(root)),
      tracker: () => (tracker ??= createLocalTracker(root, { config: ctx.config(), now, random, env })),
      host: () => (host ??= makeHost(ctx)),
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
