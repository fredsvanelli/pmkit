#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { BOOLEANS, parseArgs } from './lib/args.mjs'
import { gitUserEmail, resolveActor } from './lib/actor.mjs'
import { ADAPTERS, adapterFor } from './lib/adapters.mjs'
import { ESTIMATE_UNITS, GIT_HOSTS, findRoot, loadConfig, loadPmkitConfig, pmkitConfigMessages, pmkitConfigWarning, pmkitWriteRefusal, validateLocalConfig, validatePmkitConfig, withLocalDefaults } from './lib/config.mjs'
import { contractView } from './lib/contract.mjs'
import { longEntryNote, parseMinutes } from './lib/duration.mjs'
import { PmkitError, isPmkitError } from './lib/errors.mjs'
import { changeLines, customerRecord, dependencyText, epicRecord, eventTable, fields, goalRecord, issueRecord, issueTable, milestoneRecord, percent, releaseNotesText, releaseRecord, requestRecord, sprintRecord, table } from './lib/format.mjs'
import {
  aging, categoryLookup, cycleTimes, doneInRange, groupEventsByIssue, lastEntry, leadTimes, rangeInstant, sprintIssues, summary, throughput, velocity,
} from './lib/metrics.mjs'
import { buildNotes, chooseBasis } from './lib/release-notes.mjs'
import { dependencyMap, serializable } from './lib/dependencies.mjs'
import { blockedIssues, epicRisks, failingPullRequests, failingWorkflows, needsPrLookup, NO_HOST, prsByBranch, risksText, stalledIssues, stalledPullRequests } from './lib/risks.mjs'
import { pathNote } from './lib/path-notes.mjs'
import { planNextAdr } from './lib/adr.mjs'
import { NO_MOVE_MESSAGES, chooseUnit, proposeMoves, teamLoad } from './lib/team-load.mjs'
import { changeList, checkMembers, mergeCapacity, parseCapacityPairs, workingDays } from './lib/team-capacity.mjs'
import { localRunLine } from './lib/delegation.mjs'
import { SCANNERS, SEVERITIES, collectAlerts } from './lib/alerts.mjs'
import { READ_LIMIT, groupTodos, matchTodos, readExistingIssues, scanRepo } from './lib/todos.mjs'
import { validateRepo } from './lib/validate.mjs'
import { parseYaml } from './lib/yaml.mjs'
import { addMapEntry, removeKey, setMap, setScalar, setSchemaLine } from './lib/yaml-edit.mjs'
import { brokenMappings, parseMappingFlags, proposeMappings } from './lib/mappings.mjs'
import { chooseRemote, inferHost } from './lib/git-remote.mjs'
import { SCHEMA_FILES, schemaUrl } from './lib/schema-url.mjs'
import { lineDiff } from './lib/diff.mjs'
import { blockersText, collectBlockers } from './lib/pr-blockers.mjs'
import { CACHE_DIR, ensureCacheIgnored } from './lib/local/query-index.mjs'
import { writeFileAtomic } from './lib/local/store.mjs'
import { FORMAT_VERSION, MIGRATIONS, applyMigration, formatError, formatState, planMigration } from './lib/local/migrations.mjs'
import { parseChangelog, sectionsSince } from './lib/changelog.mjs'
import { runExport, runImport, runStatus, runSwitch, runUndo } from './lib/migrate/cli.mjs'
import { createGithubHost } from './lib/github/host.mjs'
import { ID_STYLES, branchName, isId, normalizeId } from './lib/ids.mjs'
import { boardDoc, hasMarker, problemsLine, renderDocument, roadmapDoc, sprintDoc } from './lib/render.mjs'
import { boardData, roadmapData, sprintData } from './lib/render-data.mjs'

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates')
const usageError = (message, nextStep = 'node scripts/pmkit.mjs --help') => new PmkitError('INVALID_INPUT', message, nextStep)

// Checks the final .pmkit/config.yaml text init is about to write. Returns null when it is valid, else the error to throw.
export function pmkitConfigRefusal(text, { update }) {
  let problems
  try {
    problems = validatePmkitConfig(parseYaml(text))
  } catch (error) {
    problems = [`config.yaml does not parse: ${error.message}`]
  }
  if (problems.length === 0) return null
  return usageError(`the ${update ? '' : 'generated '}.pmkit/config.yaml is not valid: ${problems.join('; ')}`,
    update ? 'Fix .pmkit/config.yaml by hand, then run init --update again' : 'Fix the init flags')
}

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

// A range bound: a date, or a date and time. Refuses a value that looks like a date but is not one.
function rangeText(name, value) {
  dateText(name, value)
  const instant = rangeInstant(value)
  // Date.parse rolls 2026-02-30 over to March 2, so compare the day it read with the day given.
  if (Number.isNaN(instant) || new Date(instant).toISOString().slice(0, 10) !== String(value).slice(0, 10)) throw usageError(`--${name} must be a date as YYYY-MM-DD`)
  return value
}

// The --since and --until bounds of a metrics command, each undefined when not given.
function rangeOptions(ctx) {
  const bound = (name) => (ctx.opt(name) === undefined ? undefined : rangeText(name, ctx.opt(name)))
  return { since: bound('since'), until: bound('until') }
}

// The count, median and p85 lines of a summary; the median and p85 read n/a when there is no value.
function summaryLines(stats) {
  const days = (value) => (value === null ? 'n/a' : `${value} days`)
  return fields([['count', stats.count], ['median', days(stats.median)], ['p85', days(stats.p85)]])
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

/** A filter as one line, key=value pairs in the order they were stored. */
const filterText = (filter) => Object.entries(filter).map(([key, value]) => `${key}=${[value].flat().join(',')}`).join(' ')

/** The result of an issue search as the CLI prints it: the table and the warnings. `sort` and `sprint` are the filter values. */
async function issueSearchResult(tracker, found, { sort, sprint }) {
  const warnings = found.problems.map(problemLine)
  if (found.hasMore === true) {
    const order = (sort ?? 'created') === 'created' ? '' : '; the order covers the issues read'
    warnings.push(`Linear has more matching issues than the 1000 pmkit read; narrow the filter${order}`)
  }
  if (sprint === 'current' && found.issues.length === 0 && (await tracker.currentCycle()) === null) {
    warnings.push('there is no active sprint, so --sprint current matches no issues; run pmkit cycle list')
  }
  return { data: found, text: issueTable(found.issues, { sprint: sprint === undefined }), warnings }
}

/** The create or update input from field flags and body files. */
async function issuePatch(ctx, { create }) {
  const { opt } = ctx
  const patch = {}
  const set = (key, value) => { if (value !== undefined) patch[key] = value }
  set('title', opt('title'))
  set('type', opt('type'))
  set('priority', create ? opt('priority') : orNull(opt('priority')))
  if (opt('estimate') !== undefined) {
    patch.estimate = opt('estimate') === 'none' ? null : parseEstimate(opt('estimate'), (await (await ctx.tracker()).discover()).estimate.scale ?? [])
  }
  if (opt('label') !== undefined) patch.labels = opt('label') === 'none' ? [] : csv(ctx.list('label'))
  set('sprint', orNull(opt('sprint')))
  set('due', orNull(opt('due')))
  if (create) {
    set('assignee', opt('assignee'))
    set('parent', opt('parent'))
    set('milestone', opt('milestone'))
    set('release', opt('release'))
  } else {
    set('milestone', orNull(opt('milestone')))
    set('release', orNull(opt('release')))
    set('branch', orNull(opt('branch')))
  }
  if (opt('description-file') !== undefined) patch.description = readInput(opt('description-file'))
  if (opt('criteria-file') !== undefined) patch.acceptanceCriteria = parseCriteria(readInput(opt('criteria-file')))
  return patch
}

async function tickCriteria(ctx, id, patch) {
  const ticks = [['check', true], ['uncheck', false]].flatMap(([name, done]) => ctx.list(name).map((n) => [whole(name, n), done]))
  if (ticks.length === 0) return
  const criteria = (patch.acceptanceCriteria ?? (await (await ctx.tracker()).getIssue(id)).acceptanceCriteria).map((item) => ({ ...item }))
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
    if (Object.hasOwn(map, match[1])) throw usageError(`--days-off names ${match[1]} twice`, `Join the dates with +, for example ${match[1]}=2026-10-14+2026-10-15`)
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
    // A hosted tracker picks the id of a new issue, so a dry-run create has none yet.
    const head = `${after.id ?? '(new)'}${after.title ? `  ${after.title}` : ''}`
    if (before === null) return [head, record(after)].join('\n')
    const lines = changeLines(before, after)
    return [head, ...(lines.length > 0 ? lines : ['no change'])].join('\n')
  }
  const text = header ?? (Array.isArray(result) ? result.map(one).join('\n\n') : one(result))
  return dryRun ? `${text}\ndry run: nothing was written` : text
}

/** Text of an issue delete: the full record, what goes, the warnings, and the way to keep the issue instead. A dry run is the preview. */
function deleteText({ before, removes, warnings, mentions, unchecked }, { dryRun }) {
  const lines = [`${dryRun ? 'would delete' : 'deleted'} ${before.id}  ${before.title}`, issueRecord(before), '']
  if (removes.trash) {
    lines.push("removes: the issue moves to Linear's trash, where the workspace can restore it for a while")
  } else {
    lines.push('removes:', ...removes.files.map((file) => `  ${file}`))
    lines.push(`${removes.events} events and ${removes.comments} comments go with it. Only git history can bring them back.`)
  }
  lines.push('references: no other issue lists it as blocked by, related, duplicate of or parent')
  if (warnings.length > 0) lines.push('warnings:', ...warnings.map((warning) => `  ${warning}`))
  if (mentions.length > 0) lines.push(`mentioned in the text of: ${mentions.map((mention) => `${mention.id} (${mention.in})`).join(', ')}. The text stays as it is.`)
  if (unchecked.length > 0) lines.push(`not checked: ${unchecked.join(', ')}`)
  lines.push(`archive instead: pmkit issues archive ${before.id} keeps the record and its history and hides the issue from lists. Delete removes them.`)
  if (dryRun) lines.push('dry run: nothing was written')
  return lines.join('\n')
}

/** A comment as text. The thread lines appear only for a reply and for a resolved root. */
const commentText = (c) =>
  `${c.created} ${c.author}${c.parent === undefined ? '' : ` (reply to ${c.parent})`}\n${c.body}${c.resolved === undefined ? '' : `\nresolved ${c.resolved.at} by ${c.resolved.by}`}`

const issueWrite = (ctx, result, id = result.after.id) => ({ data: result, text: writeText(result, ctx), commit: id })

/** The warning for an issue write that puts the issue in a release that is already released. Runs after the write, so a failure to read the release only drops the warning. */
async function releasedWarnings(ctx, patch) {
  if (typeof patch.release !== 'string') return []
  try {
    const tracker = await ctx.tracker()
    return (await tracker.getRelease(patch.release)).released ? [`release ${patch.release} is already released`] : []
  } catch (error) {
    if (error instanceof PmkitError) return []
    throw error
  }
}
const defaultBranch = (ctx) => ctx.config().pmkit.git_host?.default_branch ?? 'main'

function defaultPrBody(issue) {
  const lines = [`Tracker issue: ${issue.id}`]
  if (issue.acceptanceCriteria.length > 0) {
    lines.push('', '## Acceptance criteria', ...issue.acceptanceCriteria.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`))
  }
  return lines.join('\n')
}
const problemLine = (problem) => `${problem.id}: ${problem.code} ${problem.message}`
/** One warning per problem of a list, pointing to pmkit validate. The JSON carries the same problems. */
const problemWarnings = (problems) => problems.map((problem) => `${problemLine(problem)}; run pmkit validate`)

/** A table of requests in the order given: id, title, state, customer, where it came from and the issue. */
const requestTable = (requests) => table(
  ['ID', 'Title', 'State', 'Customer', 'From', 'Issue', 'Created'],
  requests.map((r) => [r.id, r.title, r.state, r.customer ? (r.customer.name ?? r.customer.id) : '', r.from ?? '', r.target?.id ?? '', r.created ?? '']),
)

/**
 * The member the caller is. A tracker whose discover() names a viewer, such as Linear, writes as that viewer (ADR-0005).
 * Otherwise from the tracker's members: by git email, then PMKIT_USER. Throws NOT_CONFIGURED when none matches.
 */
async function requireMember(ctx) {
  const tracker = await ctx.tracker()
  const found = await tracker.discover()
  if (found.viewer) return { id: found.viewer.id, member: { name: found.viewer.name } }
  const members = Object.fromEntries(found.members.map(({ id, name, email, availability }) => [id, { name, email, availability }]))
  const actor = resolveActor({ members }, { email: gitUserEmail(ctx.root), env: ctx.env })
  if (actor) return actor
  const nextStep = ctx.config().hosted ? 'Set PMKIT_USER to a member id from pmkit discover' : 'Add yourself to members in .issues/config.yaml or set PMKIT_USER'
  throw new PmkitError('NOT_CONFIGURED', 'cannot tell which member you are', nextStep)
}

/** The warning for a Linear read that a page cap cut: `history` and `comments` of one issue, or `issues` for the metric events. */
function capWarning(kind, id) {
  if (kind === 'history') return `Linear has more history for ${id} than the 1000 entries pmkit read; the oldest are missing`
  if (kind === 'comments') return `Linear has more comments for ${id} than the 1000 pmkit read`
  return 'Linear has more issues than the 1000 pmkit read; the result covers the 1000 most recently updated'
}
const capWarnings = (list, kind, id) => (list.truncated === true ? [capWarning(kind, id)] : [])

/** The one note for a metric command: the path native_metrics took, and for velocity the sprint count and the estimates. */
async function metricNotes(tracker, metric, extra = {}) {
  const capabilities = (await tracker.capabilities()).capabilities
  const entry = capabilities.find((c) => c.id === 'native_metrics')
  const note = pathNote(entry, { metric, estimation: capabilities.find((c) => c.id === 'estimation'), ...extra })
  return note === null ? [] : [note]
}

/** The note for one capability's path (capacity, deliverables, linked_code), as a list of zero or one lines. */
async function capabilityNotes(tracker, id) {
  const entry = (await tracker.capabilities()).capabilities.find((c) => c.id === id)
  const note = entry === undefined ? null : pathNote(entry)
  return note === null ? [] : [note]
}

/** The linked_code note of a command that reads git. A tracker that cannot load or report its manifest costs the note, not the command. */
async function linkedCodeNotes(ctx) {
  try {
    return await capabilityNotes(await ctx.tracker(), 'linked_code')
  } catch {
    return []
  }
}

/** discover().statuses as a categoryOf(statusName), and every issue's events grouped by issue. The flow metrics need each whole log. */
async function flowInputs(tracker) {
  const categoryOf = categoryLookup((await tracker.discover()).statuses)
  const list = await tracker.metricEvents()
  return { categoryOf, events: groupEventsByIssue(list), warnings: capWarnings(list, 'issues') }
}

// Command table. `run` returns { data, text, commit }: the JSON value, the plain text and, for a write, the id for the commit message.
// A command reaches the tracker through ctx.tracker(), which holds only the contract operations. `local: true` marks the commands
// that work on Local tracker files; they alone use ctx.local(), and the runner refuses them for any other tracker.system.
// `linear: true` does the same for Linear-only features (triage rotation): they use ctx.linear(feature).
export const COMMANDS = [
  {
    name: 'init', summary: 'writes .pmkit/config.yaml and scaffolds .issues/; refuses to overwrite unless --update, which edits only the lines its flags name and the schema line; --label only adds labels; --tracker linear writes only .pmkit/config.yaml and returns what setup must ask',
    usage: '[--tracker local|linear] [--git-host github|none] [--workspace key] [--team KEY] [--status key=name ...] [--field key=value ...] [--type-label type=label ...] [--prefix ISS] [--id-style random|numbered] [--estimate-unit points|hours|sizes] [--label name ...] [--member id --name n --email e] [--members-file f|-] [--update [--replace path ...]]',
    flags: ['tracker', 'git-host', 'workspace', 'team', 'status', 'field', 'type-label', 'prefix', 'id-style', 'member', 'name', 'email', 'estimate-unit', 'label', 'members-file', 'update', 'replace'], booleans: ['dry-run'], dryRun: true, exempt: true, run: runInit,
  },
  {
    name: 'link-repo', summary: 'links this repository to a git host and, on Linear, a team: infers the host and the repo from the git remote, checks the team against the workspace, and edits only those lines of .pmkit/config.yaml',
    usage: '[--git-host github|none] [--repo owner/name] [--default-branch name] [--remote name] [--team KEY]',
    flags: ['git-host', 'repo', 'default-branch', 'remote', 'team'], booleans: ['dry-run'], dryRun: true, exempt: true, run: runLinkRepo,
  },
  {
    name: 'capabilities', summary: 'prints the capability manifest', flags: [],
    run: async (ctx) => {
      const manifest = await (await ctx.tracker()).capabilities()
      const rows = manifest.capabilities.map((c) => [c.id, c.path, c.enableHint ?? (c.detail ? Object.entries(c.detail).map(([k, v]) => `${k}=${[v].flat().join('/')}`).join(' ') : '')])
      // A hosted manifest names its workspace; the Local one has none, so its output stays as it was.
      const hosted = manifest.workspace
        ? [['workspace', `${manifest.workspace.urlKey} (${manifest.workspace.plan})`], ['team', manifest.team ?? '(none)'], ['discovered', manifest.discoveredAt]]
        : []
      const head = fields([['tracker', manifest.tracker], ['git host', manifest.gitHost], ...hosted])
      return { data: manifest, text: [...head, '', table(['Capability', 'Path', 'Detail'], rows)].join('\n'), warnings: manifest.warnings ?? [] }
    },
  },
  {
    name: 'discover', summary: 'prints statuses with categories, types, priorities, labels, members and the estimate scale', flags: [],
    run: async (ctx) => {
      // discover always refreshes a hosted tracker's cache; the Local tracker ignores the argument.
      const d = await (await ctx.tracker()).discover({ refresh: true })
      const onOff = (on) => (on ? 'on' : 'off')
      const hosted = d.workspace
        ? [
            `workspace: ${d.workspace.name} (${d.workspace.urlKey}), plan ${d.workspace.plan}${d.auth ? `, viewer ${d.auth.viewer.name}` : ''}`,
            'teams:', ...(d.teams.length > 0 ? d.teams.map((t) => `  ${t.key}  ${t.name}  cycles ${onOff(t.cycles)}, triage ${onOff(t.triage)}, estimate ${t.estimate.type}`) : ['  (none)']),
          ]
        : []
      const text = [
        ...hosted,
        'statuses:', ...d.statuses.map((s) => `  ${s.name} (${s.category})`),
        ...fields([['types', d.types], ['priorities', d.priorities], ['labels', d.labels]]),
        'members:', ...(d.members.length > 0 ? d.members.map((m) => `  ${m.id}  ${m.name ?? ''} <${m.email ?? ''}>`) : ['  (none)']),
        `estimate: ${d.estimate.unit}${d.estimate.scale ? ` ${d.estimate.scale.join(', ')}` : ''}`,
      ].join('\n')
      return { data: d, text, warnings: d.warnings ?? [] }
    },
  },
  {
    name: 'whoami', summary: 'prints the resolved actor', flags: [],
    run: async (ctx) => {
      const actor = await requireMember(ctx)
      return { data: actor, text: `${actor.id}${actor.member?.name ? ` (${actor.member.name})` : ''}` }
    },
  },
  {
    name: 'issues list', summary: 'searches issues, oldest created first unless --sort says otherwise',
    usage: '[--text t] [--category c,..] [--type t,..] [--assignee me|none|id] [--label l,..] [--sprint current|none|id] [--parent id] [--blocked] [--updated-before d] [--updated-after d] [--sort s] [--limit n] [--archived]',
    flags: ['text', 'category', 'type', 'assignee', 'label', 'sprint', 'parent', 'blocked', 'updated-before', 'updated-after', 'sort', 'limit', 'archived'],
    run: async (ctx) => {
      const tracker = await ctx.tracker()
      return issueSearchResult(tracker, await tracker.searchIssues(issueFilter(ctx)), { sort: ctx.opt('sort'), sprint: ctx.opt('sprint') })
    },
  },
  {
    name: 'views save', summary: 'saves an issue filter under a name', usage: '<name> [issues list filter flags] [--overwrite]', write: true, args: ['name'],
    flags: ['text', 'category', 'type', 'assignee', 'label', 'sprint', 'parent', 'blocked', 'updated-before', 'updated-after', 'sort', 'limit', 'archived', 'overwrite'],
    run: async (ctx) => {
      const result = await (await ctx.tracker()).saveView(ctx.args[0], issueFilter(ctx), await ctx.actor(), { dryRun: ctx.dryRun, replace: ctx.flag('overwrite') })
      const record = (view) => `view ${view.name}\nfilter: ${filterText(view.filter)}`
      const replaced = result.before?.unreadable === undefined ? filterText(result.before?.filter ?? {}) : `a file that could not be read (${result.before.unreadable})`
      const text = result.before === null ? record(result.after) : `${record(result.after)}\nreplaces: ${replaced}`
      return { data: result, text: ctx.dryRun ? `${text}\ndry run: nothing was written` : text, commit: result.after.name }
    },
  },
  {
    name: 'views list', summary: 'lists the saved views', usage: '', flags: [],
    run: async (ctx) => {
      const { views, problems } = await (await ctx.tracker()).listViews()
      const warnings = problems.map((problem) => `${problemLine(problem)}; run pmkit validate`)
      return { data: views, text: views.length === 0 ? 'no views' : table(['Name', 'Filter'], views.map((view) => [view.name, filterText(view.filter)])), warnings }
    },
  },
  {
    name: 'views run', summary: 'runs a saved view and lists its issues', usage: '<name>', args: ['name'], flags: [],
    run: async (ctx) => {
      const tracker = await ctx.tracker()
      const found = await tracker.runView(ctx.args[0])
      return issueSearchResult(tracker, found, { sort: found.view.filter.sort, sprint: found.view.filter.sprint })
    },
  },
  {
    name: 'issues get', summary: 'one issue', usage: '<id> [--comments] [--history]', args: ['id'], flags: ['comments', 'history'],
    run: async (ctx) => {
      const tracker = await ctx.tracker()
      const issue = await tracker.getIssue(ctx.args[0])
      const data = { ...issue }
      const parts = [issueRecord(issue)]
      const warnings = []
      if (ctx.flag('comments')) {
        data.comments = await tracker.listComments(issue.id)
        warnings.push(...capWarnings(data.comments, 'comments', issue.id))
        parts.push('', 'comments:', ...(data.comments.length > 0 ? data.comments.map(commentText) : ['(none)']))
      }
      if (ctx.flag('history')) {
        data.history = await tracker.getHistory(issue.id)
        warnings.push(...capWarnings(data.history, 'history', issue.id))
        parts.push('', 'history:', eventTable(data.history))
      }
      return { data, text: parts.join('\n'), warnings }
    },
  },
  {
    name: 'issues dependencies', summary: 'the blocker chain, the hierarchy and the critical path of an issue or an epic', usage: '<id>', args: ['id'], flags: [],
    run: async (ctx) => {
      const tracker = await ctx.tracker()
      // The adapter tells an epic id from an issue id when it can; otherwise the epic prefix decides, and no prefix means an issue.
      const { epicPrefix, isEpicId } = ctx.settings()
      const isEpic = isEpicId ?? ((value) => epicPrefix !== null && isId(normalizeId(value), epicPrefix))
      const [id] = ctx.args
      const target = isEpic(id)
        ? { ...(await tracker.getDeliverable(id)), kind: 'epic' }
        : { ...(await tracker.getIssue(id)), kind: 'issue' }
      const found = await tracker.searchIssues({ archived: true })
      const dependencies = (await tracker.capabilities()).capabilities.find((c) => c.id === 'dependencies').path !== 'absent'
      const { unit } = (await tracker.discover()).estimate
      const map = dependencyMap({ target, issues: found.issues, dependencies, unreadable: found.problems.map((p) => p.id), unit })
      const problems = [...found.problems, ...map.problems]
      // Only JSON.stringify can overflow on a map the builder accepted, so check it for JSON output alone. The text printer copes with deeper chains.
      const data = ctx.json ? serializable({ ...map, problems }) : { ...map, problems }
      return { data, text: dependencyText(map), warnings: problems.map(problemLine) }
    },
  },
  {
    name: 'issues create', summary: 'creates an issue', write: true,
    usage: '--title t [--type] [--priority] [--estimate] [--assignee] [--label l,..] [--parent] [--sprint id|current|none] [--due] [--milestone m] [--release r] [--description-file f] [--criteria-file f]',
    flags: ['title', 'type', 'priority', 'estimate', 'assignee', 'label', 'parent', 'sprint', 'due', 'milestone', 'release', 'description-file', 'criteria-file'],
    run: async (ctx) => {
      const patch = await issuePatch(ctx, { create: true })
      if (patch.title === undefined) throw usageError('issues create needs --title', 'pmkit issues create --title "..."')
      const result = issueWrite(ctx, await (await ctx.tracker()).createIssue(patch, await ctx.actor(), { dryRun: ctx.dryRun }))
      return { ...result, warnings: await releasedWarnings(ctx, patch) }
    },
  },
  {
    name: 'issues update', summary: 'edits fields and criteria', write: true, args: ['id'],
    usage: '<id> [--title] [--type] [--priority] [--estimate] [--label l,..] [--sprint id|current|none] [--due] [--milestone] [--release] [--branch] [--description-file f] [--criteria-file f] [--check n] [--uncheck n]',
    flags: ['title', 'type', 'priority', 'estimate', 'label', 'sprint', 'due', 'milestone', 'release', 'branch', 'description-file', 'criteria-file', 'check', 'uncheck'],
    run: async (ctx) => {
      const [id] = ctx.args
      const patch = await issuePatch(ctx, { create: false })
      await tickCriteria(ctx, id, patch)
      if (Object.keys(patch).length === 0) throw usageError('issues update needs at least one field flag', 'pmkit issues update <id> --priority high')
      const result = issueWrite(ctx, await (await ctx.tracker()).updateIssue(id, patch, await ctx.actor(), { dryRun: ctx.dryRun }))
      return { ...result, warnings: await releasedWarnings(ctx, patch) }
    },
  },
  {
    name: 'issues move', summary: 'changes status by category', usage: '<id> <category> [--status name]', write: true, args: ['id', 'category'], flags: ['status'],
    run: async (ctx) => issueWrite(ctx, await (await ctx.tracker()).moveToCategory(ctx.args[0], ctx.args[1], await ctx.actor(), { status: ctx.opt('status'), dryRun: ctx.dryRun })),
  },
  {
    name: 'issues assign', summary: 'assigns', usage: '<id> <member|me|none>', write: true, args: ['id', 'member'], flags: [],
    run: async (ctx) => issueWrite(ctx, await (await ctx.tracker()).assign(ctx.args[0], ctx.args[1] === 'none' ? null : ctx.args[1], await ctx.actor(), { dryRun: ctx.dryRun })),
  },
  {
    name: 'issues delegate', summary: 'assigns an issue to an agent member and comments the instructions for local execution', usage: '<id> <agent:name> [--instructions-file f]', write: true, args: ['id', 'agent'], flags: ['instructions-file'],
    run: async (ctx) => {
      const instructions = ctx.opt('instructions-file') !== undefined ? readInput(ctx.opt('instructions-file')) : undefined
      const result = await (await ctx.tracker()).delegate(ctx.args[0], ctx.args[1], instructions, await ctx.actor(), { dryRun: ctx.dryRun })
      const lines = [writeText(result, { dryRun: false }), `${ctx.dryRun ? 'would comment' : 'commented'} ${result.comment.id}`]
      if (result.run === 'local') lines.push(localRunLine(result.after.id, result.after.assignee))
      if (ctx.dryRun) lines.push('dry run: nothing was written')
      return { data: result, text: lines.join('\n'), commit: result.after.id }
    },
  },
  {
    name: 'issues link', summary: 'links or unlinks', usage: '<from> <to> --kind blocks|related|duplicate [--remove]', write: true, args: ['from', 'to'], flags: ['kind', 'remove'],
    run: async (ctx) => {
      if (ctx.opt('kind') === undefined) throw usageError('issues link needs --kind', 'Use --kind blocks, related or duplicate')
      const op = ctx.flag('remove') ? 'unlink' : 'link'
      const result = await (await ctx.tracker())[op](ctx.args[0], ctx.args[1], ctx.opt('kind'), await ctx.actor(), { dryRun: ctx.dryRun })
      return issueWrite(ctx, result, ctx.args[0])
    },
  },
  {
    name: 'issues parent', summary: 'sets the parent', usage: '<id> <parent|none>', write: true, args: ['id', 'parent'], flags: [],
    run: async (ctx) => issueWrite(ctx, await (await ctx.tracker()).setParent(ctx.args[0], ctx.args[1] === 'none' ? null : ctx.args[1], await ctx.actor(), { dryRun: ctx.dryRun })),
  },
  {
    name: 'issues comment', summary: 'comments', usage: '<id> --body-file f [--reply-to comment]', write: true, args: ['id'], flags: ['body-file', 'reply-to'],
    run: async (ctx) => {
      if (ctx.opt('body-file') === undefined) throw usageError('issues comment needs --body-file', 'Pass a file, or - for stdin')
      const comment = await (await ctx.tracker()).comment(ctx.args[0], readInput(ctx.opt('body-file')), await ctx.actor(), { dryRun: ctx.dryRun, replyTo: ctx.opt('reply-to') })
      return { data: comment, text: writeText(null, { dryRun: ctx.dryRun, header: `commented on ${comment.issue}` }), commit: comment.issue }
    },
  },
  {
    name: 'issues resolve', summary: 'resolves a comment thread', usage: '<id> <comment>', write: true, args: ['id', 'comment'], flags: [],
    run: async (ctx) => {
      const result = await (await ctx.tracker()).resolveThread(ctx.args[0], ctx.args[1], await ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(null, { dryRun: ctx.dryRun, header: `resolved the thread ${result.after.id} on ${result.after.issue}` }), commit: result.after.issue }
    },
  },
  {
    name: 'issues log-time', summary: 'logs time', usage: '<id> <time>', write: true, args: ['id', 'time'], flags: [],
    run: async (ctx) => {
      const tracker = await ctx.tracker()
      // The capability comes first, so a tracker with no time tracking refuses before it reads the time, whatever the time is.
      const entry = (await tracker.capabilities()).capabilities.find((c) => c.id === 'time_tracking')
      const minutes = entry?.path === 'absent' ? NaN : parseMinutes(ctx.args[1])
      const result = await tracker.logTime(ctx.args[0], minutes, await ctx.actor(), { dryRun: ctx.dryRun })
      const note = longEntryNote(minutes)
      return { data: { ...result, minutes, note }, text: writeText(null, { dryRun: ctx.dryRun, header: `logged ${minutes} minutes on ${result.after.id}` }), notes: note ? [note] : [], commit: result.after.id }
    },
  },
  {
    name: 'issues parse-time', summary: 'reads a time such as 90, 45m, 1h30 or 1.5h as minutes, with no tracker and no write', usage: '<time>', args: ['time'], flags: [],
    run: async (ctx) => {
      const minutes = parseMinutes(ctx.args[0])
      const note = longEntryNote(minutes)
      return { data: { input: ctx.args[0], minutes, note }, text: `${ctx.args[0]} is ${minutes} minutes`, notes: note ? [note] : [] }
    },
  },
  {
    name: 'issues time-entries', summary: 'lists the time logged on an issue, with the total', usage: '<id>', args: ['id'], flags: [],
    run: async (ctx) => {
      const result = await (await ctx.tracker()).listTimeEntries(ctx.args[0])
      const text = result.entries.length === 0
        ? `no time logged on ${result.issue}\ntotal: 0 minutes`
        : [table(['At', 'By', 'Minutes'], result.entries.map((entry) => [entry.at, entry.by, String(entry.minutes)])), `total: ${result.total} minutes`].join('\n')
      const notes = result.ignored > 0 ? [`${result.ignored} log_time ${result.ignored === 1 ? 'event' : 'events'} ignored: minutes is not a positive integer`] : []
      return { data: result, text, notes }
    },
  },
  {
    name: 'issues archive', summary: 'archives', usage: '<id>', write: true, args: ['id'], flags: [],
    run: async (ctx) => issueWrite(ctx, await (await ctx.tracker()).archive(ctx.args[0], await ctx.actor(), { dryRun: ctx.dryRun })),
  },
  {
    name: 'issues delete', summary: 'deletes an issue for good; archive keeps it', usage: '<id>', write: true, args: ['id'], flags: [],
    run: async (ctx) => {
      const result = await (await ctx.tracker()).delete(ctx.args[0], await ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: deleteText(result, ctx), commit: result.before.id }
    },
  },
  {
    name: 'cycle list', summary: 'lists sprints', usage: '[--state s]', flags: ['state'],
    run: async (ctx) => {
      const sprints = await (await ctx.tracker()).listCycles({ state: ctx.opt('state') })
      const text = sprints.length === 0 ? 'no sprints' : table(['ID', 'State', 'Start', 'End', 'Name'], sprints.map((s) => [s.id, s.state, s.start, s.end, s.name]))
      return { data: sprints, text }
    },
  },
  {
    name: 'cycle current', summary: 'prints the active sprint', flags: [],
    run: async (ctx) => {
      const sprint = await (await ctx.tracker()).currentCycle()
      return { data: sprint, text: sprint ? sprintRecord(sprint) : 'no active sprint' }
    },
  },
  {
    name: 'cycle issues', summary: 'lists the issues of a sprint', usage: '<id>', args: ['id'], flags: [],
    run: async (ctx) => {
      const issues = await (await ctx.tracker()).cycleIssues(ctx.args[0])
      return { data: issues, text: issueTable(issues, { sprint: false }) }
    },
  },
  {
    name: 'cycle open', summary: 'opens a sprint; the end defaults from sprint_length_days', usage: '--start d [--end d] [--goal g] [--name n]',
    write: true, flags: ['start', 'end', 'goal', 'name'],
    run: async (ctx) => {
      const input = {}
      for (const key of ['start', 'end', 'goal', 'name']) if (ctx.opt(key) !== undefined) input[key] = ctx.opt(key)
      if (input.start === undefined) throw usageError('cycle open needs --start', 'pmkit cycle open --start YYYY-MM-DD')
      const result = await (await ctx.tracker()).openCycle(input, await ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, { ...ctx, record: sprintRecord }), commit: result.after.id }
    },
  },
  {
    name: 'cycle close', summary: 'closes a sprint and prints the unfinished issues', usage: '<id>', write: true, args: ['id'], flags: [],
    run: async (ctx) => {
      const result = await (await ctx.tracker()).closeCycle(ctx.args[0], await ctx.actor(), { dryRun: ctx.dryRun })
      const head = `${result.sprint.id}  ${result.sprint.name}\nstate: active → closed\nunfinished issues:\n${issueTable(result.unfinished)}`
      const warnings = result.problems.map(problemLine)
      return { data: result, text: writeText(null, { dryRun: ctx.dryRun, header: head }), commit: result.sprint.id, warnings }
    },
  },
  {
    name: 'cycle add', summary: 'moves issues into or out of a sprint', usage: '<id...> --to <sprint|current|none>', write: true, rest: 'id', flags: ['to'],
    run: async (ctx) => {
      if (ctx.opt('to') === undefined) throw usageError('cycle add needs --to', 'Use --to <sprint> or --to none')
      const to = ctx.opt('to') === 'none' ? null : ctx.opt('to')
      const result = await (await ctx.tracker()).moveToCycle(ctx.args, to, await ctx.actor(), { dryRun: ctx.dryRun })
      const sprint = to === null ? undefined : result[0].after.sprint
      return { data: result, text: writeText(result, ctx), commit: sprint ?? ctx.args.join(' ') }
    },
  },
  {
    name: 'cycle capacity', summary: 'reads or sets capacity and days off', usage: '<id> [--set member=n,..] [--days-off member=date+date,..]', write: true, readUnless: ['set', 'days-off'], args: ['id'], flags: ['set', 'days-off'],
    run: async (ctx) => {
      const tracker = await ctx.tracker()
      const [id] = ctx.args
      const set = ctx.opt('set') !== undefined
      const dayoff = ctx.opt('days-off') !== undefined
      if (!set && !dayoff) {
        const capacity = await tracker.getCapacity(id)
        const daysOff = await tracker.getDaysOff(id)
        const lines = [
          ...fields(Object.entries(capacity)),
          ...Object.entries(daysOff).map(([member, dates]) => `days off ${member}: ${[dates ?? []].flat().join(', ')}`),
        ]
        return { data: { capacity, days_off: daysOff }, text: lines.join('\n') || 'no capacity or days off set', notes: await capabilityNotes(tracker, 'capacity') }
      }
      const result = await tracker.updateCycleCapacity(id, { capacity: set ? parseCapacity(ctx) : undefined, daysOff: dayoff ? parseDaysOff(ctx) : undefined }, await ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, { ...ctx, record: sprintRecord }), commit: id }
    },
  },
  {
    name: 'epic list', summary: 'lists epics', flags: [],
    run: async (ctx) => {
      const epics = await (await ctx.tracker()).listDeliverables()
      // Health and progress are Linear fields. Their columns appear only when an epic carries one, so Local output is unchanged.
      const extra = epics.some((e) => e.health !== undefined || e.progress !== undefined)
      // The Goal column appears only when an epic links to a goal, so output without goals is unchanged.
      const goals = epics.some((e) => e.goal !== undefined)
      const text = epics.length === 0
        ? 'no epics'
        : table(
          ['ID', 'Title', 'Status', 'Start', 'Target', ...(extra ? ['Health', 'Progress'] : []), ...(goals ? ['Goal'] : [])],
          epics.map((e) => [
            e.id, e.title, e.status.name, e.start ?? '', e.target ?? '',
            ...(extra ? [e.health ?? '', e.progress === undefined ? '' : percent(e.progress)] : []), ...(goals ? [e.goal ?? ''] : []),
          ]),
        )
      return { data: epics, text }
    },
  },
  {
    name: 'epic get', summary: 'one epic', usage: '<id>', args: ['id'], flags: [],
    run: async (ctx) => {
      const epic = await (await ctx.tracker()).getDeliverable(ctx.args[0])
      return { data: epic, text: epicRecord(epic) }
    },
  },
  {
    name: 'epic progress', summary: 'counts the issues under an epic', usage: '<id>', args: ['id'], flags: [],
    run: async (ctx) => {
      const p = await (await ctx.tracker()).deliverableProgress(ctx.args[0])
      const text = [
        ...fields([['total', p.total], ['done', p.done], ['canceled', p.canceled], ['points', p.points], ['points done', p.pointsDone]]),
        ...Object.entries(p.byCategory).map(([category, count]) => `  ${category}: ${count}`),
        ...(p.native ? [`native: ${percent(p.native.progress)} of ${p.native.scope} issues in Linear's own count`] : []),
      ].join('\n')
      const warnings = p.hasMore === true ? ['Linear has more issues in this epic than the 1000 pmkit read; the counts cover the first 1000'] : []
      return { data: p, text, warnings, notes: await capabilityNotes(await ctx.tracker(), 'deliverables') }
    },
  },
  {
    name: 'epic create', summary: 'creates an epic', usage: '--title t [--start d] [--target d] [--goal id]', write: true, flags: ['title', 'start', 'target', 'goal'],
    run: async (ctx) => {
      if (ctx.opt('title') === undefined) throw usageError('epic create needs --title', 'pmkit epic create --title "..."')
      const input = { title: ctx.opt('title') }
      for (const key of ['start', 'target', 'goal']) if (ctx.opt(key) !== undefined) input[key] = ctx.opt(key)
      const result = await (await ctx.tracker()).createDeliverable(input, await ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, { ...ctx, record: epicRecord }), commit: result.after.id }
    },
  },
  {
    name: 'epic goal', summary: 'links an epic to a goal, or removes the link', usage: '<id> <goal|none>', write: true, args: ['id', 'goal'], flags: [],
    run: async (ctx) => {
      const result = await (await ctx.tracker()).setEpicGoal(ctx.args[0], ctx.args[1] === 'none' ? null : ctx.args[1], await ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, { ...ctx, record: epicRecord }), commit: result.after.id }
    },
  },
  {
    name: 'goal list', summary: 'lists the strategic goals with their epics', flags: [],
    run: async (ctx) => {
      const { goals, problems } = await (await ctx.tracker()).listGoals()
      const warnings = problems.map((problem) => `${problemLine(problem)}; run pmkit validate`)
      const rows = goals.map((goal) => [goal.id, goal.title, goal.target ?? '', goal.epics.join(', ')])
      return { data: goals, text: goals.length === 0 ? 'no goals' : table(['ID', 'Title', 'Target', 'Epics'], rows), warnings }
    },
  },
  {
    name: 'goal get', summary: 'one goal with its epics', usage: '<id>', args: ['id'], flags: [],
    run: async (ctx) => {
      const goal = await (await ctx.tracker()).getGoal(ctx.args[0])
      return { data: goal, text: goalRecord(goal) }
    },
  },
  {
    name: 'goal create', summary: 'creates a strategic goal', usage: '--title t [--target YYYY-MM-DD]', write: true, flags: ['title', 'target'],
    run: async (ctx) => {
      if (ctx.opt('title') === undefined) throw usageError('goal create needs --title', 'pmkit goal create --title "..."')
      const input = { title: ctx.opt('title') }
      if (ctx.opt('target') !== undefined) input.target = ctx.opt('target')
      const result = await (await ctx.tracker()).createGoal(input, await ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, { ...ctx, record: goalRecord }), commit: result.after.id }
    },
  },
  {
    name: 'goal progress', summary: 'rolls up the progress of the epics of a goal', usage: '<id>', args: ['id'], flags: [],
    run: async (ctx) => {
      const p = await (await ctx.tracker()).goalProgress(ctx.args[0])
      const rows = p.epics.map((e) => [e.id, e.title, e.status.name, e.progress.done, e.progress.total, e.progress.pointsDone, e.progress.points])
      const text = [
        `${p.goal.id}  ${p.goal.title}`,
        ...fields([['total', p.total], ['done', p.done], ['canceled', p.canceled], ['points', p.points], ['points done', p.pointsDone]]),
        ...Object.entries(p.byCategory).map(([category, count]) => `  ${category}: ${count}`),
        '',
        p.epics.length === 0 ? 'no epics' : table(['Epic', 'Title', 'Status', 'Done', 'Total', 'Points done', 'Points'], rows),
      ].join('\n')
      return { data: p, text }
    },
  },
  // Customers, requests and demand (PMK-46). customers list and show print the keys of linear customers list and show.
  {
    name: 'customers list', summary: 'lists the customers with status, tier, revenue, size and request count, highest revenue first', flags: [],
    run: async (ctx) => {
      const { customers, problems } = await (await ctx.tracker()).listCustomers()
      const rows = customers.map((c) => [c.id, c.name, c.status?.name ?? '', c.tier?.name ?? '', c.revenue ?? '', c.size ?? '', c.requests])
      return {
        data: { available: true, customers, hasMore: false, problems },
        text: customers.length === 0 ? 'no customers yet' : table(['ID', 'Name', 'Status', 'Tier', 'Revenue', 'Size', 'Requests'], rows),
        warnings: problemWarnings(problems),
      }
    },
  },
  {
    name: 'customers show', summary: 'one customer, by id or exact name, with its requests', usage: '<id or name>', args: ['customer'], flags: [],
    run: async (ctx) => {
      const { customer, requests, problems } = await (await ctx.tracker()).getCustomer(ctx.args[0])
      const text = [customerRecord(customer), '', requests.length === 0 ? 'no requests yet' : requestTable(requests)].join('\n')
      return { data: { available: true, customer, requests, problems }, text, warnings: problemWarnings(problems) }
    },
  },
  {
    name: 'customers create', summary: 'creates a customer', usage: '--name n [--status s] [--tier t] [--revenue n] [--size n] [--owner member]', write: true,
    flags: ['name', 'status', 'tier', 'revenue', 'size', 'owner'],
    run: async (ctx) => {
      if (ctx.opt('name') === undefined) throw usageError('customers create needs --name', 'pmkit customers create --name "..."')
      const input = { name: ctx.opt('name') }
      for (const key of ['status', 'tier', 'owner']) if (ctx.opt(key) !== undefined) input[key] = ctx.opt(key)
      // A number the flag spells as digits becomes a number; anything else goes through as text and the tracker refuses it.
      if (ctx.opt('revenue') !== undefined) input.revenue = /^\d+$/.test(ctx.opt('revenue')) ? Number(ctx.opt('revenue')) : ctx.opt('revenue')
      if (ctx.opt('size') !== undefined) input.size = /^\d+(\.\d+)?$/.test(ctx.opt('size')) ? Number(ctx.opt('size')) : ctx.opt('size')
      const result = await (await ctx.tracker()).createCustomer(input, await ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, { ...ctx, record: customerRecord }), commit: result.after.id }
    },
  },
  {
    name: 'requests list', summary: 'lists the requests, the open ones (the inbox) by default, oldest first', usage: '[--state open|accepted|declined|all] [--customer id]',
    flags: ['state', 'customer'],
    run: async (ctx) => {
      const state = ctx.opt('state') ?? 'open'
      const { requests, problems } = await (await ctx.tracker()).listRequests({ state, customer: ctx.opt('customer') })
      const empty = state === 'all' ? 'no requests' : `no ${state} requests`
      return { data: { requests, problems }, text: requests.length === 0 ? empty : requestTable(requests), warnings: problemWarnings(problems) }
    },
  },
  {
    name: 'requests get', summary: 'one request', usage: '<id>', args: ['id'], flags: [],
    run: async (ctx) => {
      const request = await (await ctx.tracker()).getRequest(ctx.args[0])
      return { data: request, text: requestRecord(request) }
    },
  },
  {
    name: 'requests create', summary: 'records a request in the inbox, or accepted into an issue with --issue',
    usage: '--title t [--customer id] [--from text] [--important] [--issue id] [--body-file f]', write: true,
    flags: ['title', 'customer', 'from', 'important', 'issue', 'body-file'],
    run: async (ctx) => {
      if (ctx.opt('title') === undefined) throw usageError('requests create needs --title', 'pmkit requests create --title "..."')
      const input = { title: ctx.opt('title') }
      for (const key of ['customer', 'from', 'issue']) if (ctx.opt(key) !== undefined) input[key] = ctx.opt(key)
      if (ctx.flag('important')) input.important = true
      if (ctx.opt('body-file') !== undefined) input.body = readInput(ctx.opt('body-file'))
      const result = await (await ctx.tracker()).createRequest(input, await ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, { ...ctx, record: requestRecord }), commit: result.after.id }
    },
  },
  {
    name: 'requests accept', summary: 'accepts a request into an existing issue', usage: '<id> <issue>', write: true, args: ['id', 'issue'], flags: [],
    run: async (ctx) => {
      const result = await (await ctx.tracker()).acceptRequest(ctx.args[0], ctx.args[1], await ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, { ...ctx, record: requestRecord }), commit: result.after.id }
    },
  },
  {
    name: 'requests decline', summary: 'declines a request', usage: '<id> [--reason text]', write: true, args: ['id'], flags: ['reason'],
    run: async (ctx) => {
      const result = await (await ctx.tracker()).declineRequest(ctx.args[0], ctx.opt('reason'), await ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, { ...ctx, record: requestRecord }), commit: result.after.id }
    },
  },
  {
    name: 'demand list', summary: 'the accepted requests grouped by issue, most requests first, with the customers who asked', flags: [],
    run: async (ctx) => {
      const { signals, problems } = await (await ctx.tracker()).listDemandSignals()
      const rows = signals.map((s) => [
        s.issue.id, s.issue.title ?? '(unreadable)', s.issue.status?.name ?? '', s.count, s.important, [...s.customers.map((c) => c.name ?? c.id), ...s.from].join(', '),
      ])
      return {
        data: { signals, problems },
        text: signals.length === 0 ? 'no demand signals' : table(['Issue', 'Title', 'Status', 'Requests', 'Important', 'Asked by'], rows),
        warnings: problemWarnings(problems),
      }
    },
  },
  // The user inbox (PMK-47). Reads and records the seen keys in the user store, never in the tracker, so neither command is a tracker write.
  {
    name: 'inbox list', summary: 'the mentions and assignments for a member that the member has not seen, oldest first; the first list shows the last 14 days', usage: '[--as member] [--since timestamp] [--all]',
    flags: ['as', 'since', 'all'],
    run: async (ctx) => {
      const result = await (await ctx.tracker()).listNotifications({ user: await ctx.actor(), since: ctx.opt('since'), all: ctx.flag('all') })
      const { user, since, hidden, items, complete, problems } = result
      const lines = []
      if (items.length === 0) lines.push(`no unseen mentions or assignments for ${user}${since === null ? '' : ` since ${since}`}`)
      else lines.push(table(['When', 'Kind', 'Issue', 'Title', 'By', 'Where', 'Key'], items.map((i) => [i.at, i.kind, i.issue, i.title ?? '(unreadable)', i.by ?? '', i.in, i.key])))
      if (hidden > 0) lines.push(`${hidden} older unseen ${hidden === 1 ? 'item is' : 'items are'} not shown, run pmkit inbox list --all`)
      if (!complete) lines.push(`the inbox is incomplete: ${problems.length} ${problems.length === 1 ? 'problem' : 'problems'} may hide items, run pmkit validate`)
      return { data: { available: true, ...result }, text: lines.join('\n'), warnings: problemWarnings(problems) }
    },
  },
  {
    name: 'inbox mark-read', summary: 'records the items a member has seen in the user store; --key marks only the keys the list showed, and with none it marks every unseen item; refuses when the inbox is incomplete',
    usage: '[--as member] [--key key ...] [--dry-run]', flags: ['as', 'key'], dryRun: true,
    run: async (ctx) => {
      const keys = ctx.list('key')
      const result = await (await ctx.tracker()).markRead({ user: await ctx.actor(), keys: keys.length > 0 ? keys : undefined, dryRun: ctx.dryRun })
      const count = `${result.marked.length} ${result.marked.length === 1 ? 'item' : 'items'}`
      const said = result.changed
        ? `${ctx.dryRun ? 'would mark' : 'marked'} ${count} read for ${result.user}${result.pruned > 0 ? `, and drop ${result.pruned} old ${result.pruned === 1 ? 'key' : 'keys'}` : ''}`
        : `nothing to mark read for ${result.user}`
      return { data: result, text: ctx.dryRun ? `${said}\ndry run: nothing was written` : said }
    },
  },
  {
    name: 'milestone list', summary: 'lists milestones', flags: [],
    run: async (ctx) => {
      const milestones = await (await ctx.tracker()).listMilestones()
      const text = milestones.length === 0 ? 'no milestones' : table(['ID', 'Name', 'Due'], milestones.map((m) => [m.id, m.name, m.due ?? '']))
      return { data: milestones, text }
    },
  },
  {
    name: 'milestone get', summary: 'one milestone', usage: '<id>', args: ['id'], flags: [],
    run: async (ctx) => {
      const milestone = await (await ctx.tracker()).getMilestone(ctx.args[0])
      return { data: milestone, text: milestoneRecord(milestone) }
    },
  },
  {
    name: 'milestone create', summary: 'creates a milestone', usage: '<id> [--name n] [--due YYYY-MM-DD]', write: true, args: ['id'], flags: ['name', 'due'],
    run: async (ctx) => {
      const input = { id: ctx.args[0] }
      for (const key of ['name', 'due']) if (ctx.opt(key) !== undefined) input[key] = ctx.opt(key)
      const result = await (await ctx.tracker()).createMilestone(input, await ctx.actor(), { dryRun: ctx.dryRun })
      // Milestone files are a Local tracker check, pointing to /pmkit:local:doctor. A hosted tracker skips it.
      const local = await ctx.local()
      const unfiled = local === null ? [] : local.unfiledMilestones(result.after.id)
      const warnings = unfiled.length === 0 ? [] : [`${unfiled.length} ${unfiled.length === 1 ? 'milestone named by issues or epics has' : 'milestones named by issues or epics have'} no file: ${unfiled.map((u) => `${u.name} (${u.count})`).join(', ')}; run /pmkit:local:doctor`]
      return { data: result, text: writeText(result, { ...ctx, record: milestoneRecord }), commit: result.after.id, warnings }
    },
  },
  {
    name: 'release list', summary: 'lists releases, oldest version first', usage: '[--state planned|released]', flags: ['state'],
    run: async (ctx) => {
      const tracker = await ctx.tracker()
      const releases = await tracker.listReleases(ctx.opt('state') === undefined ? {} : { state: ctx.opt('state') })
      const rows = releases.map((r) => [r.id, r.name, r.state, r.tag ?? '', r.target ?? '', r.released ?? ''])
      return { data: releases, text: releases.length === 0 ? 'no releases' : table(['ID', 'Name', 'State', 'Tag', 'Target', 'Released'], rows), notes: await capabilityNotes(tracker, 'releases') }
    },
  },
  {
    name: 'release get', summary: 'one release', usage: '<id>', args: ['id'], flags: [],
    run: async (ctx) => {
      const tracker = await ctx.tracker()
      const release = await tracker.getRelease(ctx.args[0])
      return { data: release, text: releaseRecord(release), notes: await capabilityNotes(tracker, 'releases') }
    },
  },
  {
    name: 'release issues', summary: 'lists the issues of a release', usage: '<id> [--archived]', args: ['id'], flags: ['archived'],
    run: async (ctx) => {
      const tracker = await ctx.tracker()
      const issues = await tracker.releaseIssues(ctx.args[0], { archived: ctx.flag('archived') })
      return { data: issues, text: issueTable(issues), notes: await capabilityNotes(tracker, 'releases') }
    },
  },
  {
    name: 'release create', summary: 'creates a release', usage: '<id> [--name n] [--tag t] [--target YYYY-MM-DD]', write: true, args: ['id'], flags: ['name', 'tag', 'target'],
    run: async (ctx) => {
      const input = { id: ctx.args[0] }
      for (const key of ['name', 'tag', 'target']) if (ctx.opt(key) !== undefined) input[key] = ctx.opt(key)
      const result = await (await ctx.tracker()).createRelease(input, await ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, { ...ctx, record: releaseRecord }), commit: result.after.id }
    },
  },
  {
    name: 'release mark-released', summary: 'marks a release released and lists its unfinished issues', usage: '<id> [--tag t]', write: true, args: ['id'], flags: ['tag'],
    run: async (ctx) => {
      const input = ctx.opt('tag') === undefined ? {} : { tag: ctx.opt('tag') }
      const result = await (await ctx.tracker()).markReleased(ctx.args[0], await ctx.actor(), { ...input, dryRun: ctx.dryRun })
      const header = writeText(result, { dryRun: false, record: releaseRecord })
      const text = writeText(null, { dryRun: ctx.dryRun, header: [header, 'unfinished issues:', issueTable(result.unfinished)].join('\n') })
      const { id, tag } = result.after
      const warnings = []
      if (result.unfinished.length > 0) {
        warnings.push(`release ${id} has ${result.unfinished.length} unfinished ${result.unfinished.length === 1 ? 'issue' : 'issues'}: ${result.unfinished.map((issue) => issue.id).join(', ')}`)
      }
      warnings.push(...result.problems.map(problemLine))
      if (tag !== undefined) {
        const warning = tagWarning(ctx.root, tag, ctx.env)
        if (warning !== null) warnings.push(warning)
      }
      return { data: result, text, commit: id, warnings }
    },
  },
  {
    name: 'release-notes', summary: 'the done issues of a release, a sprint or a period, grouped by type', usage: '[--release id | --sprint current|id | --since d [--until d]]', flags: ['release', 'sprint', 'since', 'until'],
    run: async (ctx) => {
      const tracker = await ctx.tracker()
      const next = 'pmkit release-notes --help'
      const given = ['release', 'sprint', 'since'].filter((name) => ctx.opt(name) !== undefined)
      if (given.length > 1) throw usageError(`--${given.join(', --')} exclude each other`, next)
      if (ctx.opt('until') !== undefined && ctx.opt('since') === undefined) throw usageError('--until needs --since', next)
      const since = ctx.opt('since') === undefined ? undefined : rangeText('since', ctx.opt('since'))
      const until = ctx.opt('until') === undefined ? undefined : rangeText('until', ctx.opt('until'))
      // Without --until the period ends today, so a --since after today is refused too.
      const effectiveUntil = until ?? ctx.now().toISOString().slice(0, 10)
      if (since !== undefined && rangeInstant(since) > rangeInstant(effectiveUntil, { endOfDay: true })) throw usageError(until === undefined ? '--since is after today' : '--since is after --until', next)
      const capabilities = (await tracker.capabilities()).capabilities
      const on = (id) => capabilities.find((c) => c.id === id).path !== 'absent'
      const releasesEntry = capabilities.find((c) => c.id === 'releases')
      if (!on('releases') && ctx.opt('release') !== undefined) throw new PmkitError('NOT_SUPPORTED', 'release notes by release need releases, which this workspace does not have', releasesEntry.enableHint)
      const releases = on('releases') ? await tracker.listReleases() : null
      const sprints = on('cycles') ? await tracker.listCycles({}) : null
      let selector = null
      if (ctx.opt('release') !== undefined) selector = { release: await tracker.getRelease(ctx.opt('release')) }
      else if (ctx.opt('sprint') !== undefined) {
        // `current` means the active sprint, as in `issues list --sprint current` and the render views.
        const current = ctx.opt('sprint') === 'current'
        const sprint = current ? (sprints === null ? null : await tracker.currentCycle()) : (sprints ?? []).find((item) => item.id === ctx.opt('sprint'))
        if (current && sprint === null) throw new PmkitError('INVALID_INPUT', 'there is no active sprint', 'pmkit cycle list')
        if (sprint === undefined) throw new PmkitError('NOT_FOUND', `sprint ${ctx.opt('sprint')} does not exist`, 'pmkit cycle list')
        selector = { sprint }
      } else if (since !== undefined) selector = until === undefined ? { since } : { since, until }
      const { defaults } = ctx.settings()
      const discovered = await tracker.discover()
      const categoryOf = categoryLookup(discovered.statuses)
      const choice = chooseBasis({ selector, releases, sprints, today: ctx.now().toISOString().slice(0, 10), windowDays: defaults.status_update_window_days ?? 14 })
      const problems = []
      let candidates
      if (choice.basis === 'release') {
        const found = await tracker.searchIssues({ release: choice.source.id, archived: true })
        problems.push(...found.problems)
        candidates = found.issues.map((issue) => ({ issue, doneAt: null }))
      } else if (choice.basis === 'sprint') {
        const events = groupEventsByIssue(await tracker.metricEvents())
        const found = await tracker.searchIssues({ sprint: choice.source.id, archived: true })
        problems.push(...found.problems)
        candidates = found.issues.map((issue) => ({ issue, doneAt: lastEntry(events[issue.id] ?? [], 'done', categoryOf) ?? null }))
      } else {
        const inRange = doneInRange(groupEventsByIssue(await tracker.metricEvents()), { categoryOf, since: choice.period.since, until: choice.period.until })
        candidates = []
        for (const [id, events] of Object.entries(inRange)) {
          try {
            candidates.push({ issue: await tracker.getIssue(id), doneAt: lastEntry(events, 'done', categoryOf) ?? null })
          } catch (error) {
            problems.push({ id, code: error.code, message: error.message })
          }
        }
      }
      const result = buildNotes({ choice, candidates, types: discovered.types, problems })
      const note = !on('releases') && choice.basis === 'sprint' ? pathNote(releasesEntry, { releaseNotesFrom: choice.source.id }) : null
      return { data: result, text: releaseNotesText(result), warnings: result.problems.map(problemLine), notes: note === null ? [] : [note] }
    },
  },
  {
    name: 'epic update-status', summary: 'publishes a status update', usage: '<id> --health h --body-file f', write: true, args: ['id'], flags: ['health', 'body-file'],
    run: async (ctx) => {
      if (ctx.opt('health') === undefined || ctx.opt('body-file') === undefined) throw usageError('epic update-status needs --health and --body-file', 'Health is on_track, at_risk or off_track')
      const input = { epic: ctx.args[0], health: ctx.opt('health'), body: readInput(ctx.opt('body-file')) }
      const result = await (await ctx.tracker()).publishStatusUpdate(input, await ctx.actor(), { dryRun: ctx.dryRun })
      const text = [`status update on ${input.epic}`, ...fields([['health', result.after.health], ['by', result.after.author], ['at', result.after.at]]), '', result.after.body].join('\n')
      return { data: result, text: ctx.dryRun ? `${text}\ndry run: nothing was written` : text, commit: input.epic }
    },
  },
  {
    name: 'epic updates', summary: 'lists the status updates of an epic, newest first', usage: '<id>', args: ['id'], flags: [],
    run: async (ctx) => {
      const updates = await (await ctx.tracker()).listStatusUpdates(ctx.args[0])
      const text = updates.length === 0
        ? 'no status updates'
        : updates.map((u) => [`${u.at}  ${u.health}  ${u.author}`, u.body].join('\n')).join('\n\n')
      return { data: updates, text }
    },
  },
  {
    name: 'docs read', summary: 'prints a document under the docs folder', usage: '<path>', args: ['path'], flags: [],
    run: async (ctx) => {
      const doc = await (await ctx.tracker()).readDocument(ctx.args[0])
      return { data: doc, text: doc.body }
    },
  },
  {
    name: 'docs list', summary: 'lists the documents under the docs folder', usage: '', args: [], flags: [],
    run: async (ctx) => {
      const docs = await (await ctx.tracker()).listDocuments()
      const text = docs.length === 0 ? 'no documents' : docs.map((doc) => doc.path).join('\n')
      return { data: docs, text }
    },
  },
  {
    name: 'docs next-adr', summary: 'the number, slug and path of the next ADR, and where it goes (repo or tracker); only reads', usage: '--title t', args: [], flags: ['title'], byTracker: true,
    run: async (ctx) => {
      if (typeof ctx.opt('title') !== 'string') throw usageError('docs next-adr needs --title', 'Pass the decision title, for example --title "Use event files as the audit log"')
      const { pmkit, hosted, issuesDir } = ctx.config()
      // A hosted tracker needs no call: the Linear adapter cannot create documents, so its ADR is a repository file.
      const documents = hosted ? undefined : (await (await ctx.tracker()).capabilities()).capabilities.find((c) => c.id === 'documents')
      // The Local tracker's folder as todos scan sees it: path.relative cleans ./ and a trailing slash, and a folder that climbs out of the repository has no ref to read.
      const trackerDir = hosted || !issuesDir ? null : path.join(issuesDir, 'docs', 'adr')
      const relative = trackerDir ? path.relative(ctx.root, trackerDir) : ''
      const configured = pmkit.git_host?.default_branch
      const branchOk = typeof configured === 'string' && validBranch(configured)
      const plan = planNextAdr({
        title: ctx.opt('title'),
        root: ctx.root,
        trackerDir,
        trackerFolder: trackerDir && !climbsOut(relative) ? slash(relative) : null,
        hosted: Boolean(hosted),
        createSupported: documents !== undefined && documents.path !== 'absent' && !documents.detail?.unsupported?.includes('createDocument'),
        defaultBranch: branchOk ? configured : 'main',
        defaultBranchNote: configured === undefined ? 'git_host.default_branch is not set in .pmkit/config.yaml, so main is used' : branchOk ? null : 'git_host.default_branch is not a valid branch name, so main is used',
        gitHost: pmkit.git_host?.system ?? 'none',
        git: (args) => {
          const result = readGit(ctx, args)
          return { status: result.error ? 1 : result.status, stdout: result.stdout ?? '' }
        },
      })
      const text = fields([['number', plan.number], ['slug', plan.slug], ['place', plan.destination], ['path', plan.path], ['tracker path', plan.docPath ?? '(none)'], ['default branch', plan.defaultBranch], ['git host', plan.gitHost]]).join('\n')
      return { data: plan, text, notes: plan.notes }
    },
  },
  {
    name: 'docs create', summary: 'creates a document under the docs folder', usage: '<path> --body-file f', write: true, args: ['path'], flags: ['body-file'],
    run: async (ctx) => {
      if (ctx.opt('body-file') === undefined) throw usageError('docs create needs --body-file', 'Pass a file, or - for stdin')
      const result = await (await ctx.tracker()).createDocument(ctx.args[0], readInput(ctx.opt('body-file')), await ctx.actor(), { dryRun: ctx.dryRun })
      const text = `${ctx.dryRun ? 'would create' : 'created'} document ${result.after.path}${ctx.dryRun ? '\ndry run: nothing was written' : ''}`
      return { data: result, text, commit: result.after.path }
    },
  },
  {
    name: 'metrics velocity', summary: 'points or counts done per closed sprint, and the average', usage: '[--window n]', flags: ['window'],
    run: async (ctx) => {
      const tracker = await ctx.tracker()
      const window = ctx.opt('window') === undefined ? ctx.settings().defaults.velocity_window : whole('window', ctx.opt('window'))
      const { categoryOf, events, warnings } = await flowInputs(tracker)
      const sprints = await tracker.listCycles({ state: 'closed' })
      const bySprint = sprintIssues((await tracker.searchIssues({ archived: true })).issues, events, categoryOf)
      const result = velocity(sprints, bySprint, { window, categoryOf })
      const rows = result.perSprint.map((s) => [s.id, s.points, s.count])
      const text = [rows.length > 0 ? table(['Sprint', 'Points', 'Issues'], rows) : 'no closed sprints', `average: ${result.average} ${result.unit}`].join('\n')
      return { data: result, text, warnings, notes: await metricNotes(tracker, 'velocity', { sprints: result.perSprint.length }) }
    },
  },
  {
    name: 'metrics cycle-time', summary: 'median and p85 days from first in_progress to done', usage: '[--since d] [--until d]', flags: ['since', 'until'],
    run: async (ctx) => {
      const tracker = await ctx.tracker()
      const { since, until } = rangeOptions(ctx)
      const { categoryOf, events, warnings } = await flowInputs(tracker)
      const inRange = doneInRange(events, { categoryOf, since, until })
      const issues = cycleTimes(inRange, { categoryOf })
      const stats = summary(issues.map((item) => item.days))
      const text = summaryLines(stats).join('\n')
      return { data: { ...stats, issues }, text, warnings, notes: await metricNotes(tracker, 'cycle-time') }
    },
  },
  {
    name: 'metrics lead-time', summary: 'median and p85 days from creation to done', usage: '[--since d] [--until d]', flags: ['since', 'until'],
    run: async (ctx) => {
      const tracker = await ctx.tracker()
      const { since, until } = rangeOptions(ctx)
      const { categoryOf, events, warnings } = await flowInputs(tracker)
      const inRange = doneInRange(events, { categoryOf, since, until })
      const issues = leadTimes(inRange, { categoryOf })
      const stats = summary(issues.map((item) => item.days))
      const text = summaryLines(stats).join('\n')
      return { data: { ...stats, issues }, text, warnings, notes: await metricNotes(tracker, 'lead-time') }
    },
  },
  {
    name: 'metrics throughput', summary: 'issues done in a range, by type', usage: '[--since d] [--until d]', flags: ['since', 'until'],
    run: async (ctx) => {
      const tracker = await ctx.tracker()
      const { since, until } = rangeOptions(ctx)
      const { categoryOf, events, warnings } = await flowInputs(tracker)
      const inRange = doneInRange(events, { categoryOf, since, until })
      const result = throughput(inRange, { categoryOf })
      const lines = [`count: ${result.count}`]
      if (result.count > 0) lines.push(table(['Type', 'Issues'], Object.entries(result.byType)))
      return { data: result, text: lines.join('\n'), warnings, notes: await metricNotes(tracker, 'throughput') }
    },
  },
  {
    name: 'metrics aging', summary: 'days since work started, per issue in progress or in review at a date, oldest first', usage: '[--until d]', flags: ['until'],
    run: async (ctx) => {
      const tracker = await ctx.tracker()
      const until = ctx.opt('until') === undefined ? undefined : rangeText('until', ctx.opt('until'))
      const asOfMs = until === undefined ? ctx.now().getTime() : rangeInstant(until, { endOfDay: true })
      const asOf = new Date(Math.floor(asOfMs / 1000) * 1000).toISOString().replace(/\.000Z$/, 'Z')
      const { categoryOf, events, warnings } = await flowInputs(tracker)
      const issues = aging(events, { categoryOf, asOf })
      const stats = summary(issues.map((item) => item.days))
      const lines = issues.length > 0
        ? [
          table(['Issue', 'Status', 'Started', 'Days'], issues.map((item) => [item.issue, item.status, item.startedAt, item.days])),
          ...summaryLines(stats),
        ]
        : ['no work in progress']
      lines.push(`as of: ${asOf}`)
      return { data: { asOf, ...stats, issues }, text: lines.join('\n'), warnings, notes: await metricNotes(tracker, 'aging') }
    },
  },
  {
    name: 'events', summary: 'all events in a range, for digests', usage: '[--since d] [--until d]', flags: ['since', 'until'],
    run: async (ctx) => {
      const range = {}
      for (const key of ['since', 'until']) if (ctx.opt(key) !== undefined) range[key] = dateText(key, ctx.opt(key))
      const tracker = await ctx.tracker()
      const events = await tracker.metricEvents(range)
      return { data: events, text: eventTable(events), warnings: capWarnings(events, 'issues'), notes: await metricNotes(tracker, 'events') }
    },
  },
  {
    name: 'risks', summary: 'blockers, stalled issues and PRs, late epics, epics without a recent status update and broken CI; reads only', flags: [],
    run: (ctx) => runRisks(ctx),
  },
  {
    name: 'team load', summary: 'issues, estimates and work in progress per member for the active sprint (or all open work without one), with imbalances, members with no work and a move proposal; reads only',
    usage: '[--sprint current|id]', flags: ['sprint'],
    run: (ctx) => runTeamLoad(ctx),
  },
  {
    name: 'team capacity', summary: 'capacity and days off per member for a sprint, with the load effect of a change; --set and --days-off write them', write: true, readUnless: ['set', 'days-off'],
    usage: '[--sprint current|id] [--set member=n|none,..] [--days-off member=date+date|none,..]', flags: ['sprint', 'set', 'days-off'],
    run: (ctx) => runTeamCapacity(ctx),
  },
  {
    name: 'alerts list', summary: 'security alerts from the scanners the repository has (npm audit), highest severity first; reads only', usage: '[--severity critical,high,medium,low]', flags: ['severity'],
    run: (ctx) => {
      ctx.config() // loads and checks .pmkit/config.yaml like every command, though alerts never read the tracker
      const wanted = csv(ctx.list('severity'))
      const unknown = wanted.filter((value) => !SEVERITIES.includes(value))
      if (unknown.length > 0) throw usageError(`--severity must be one of ${SEVERITIES.join(', ')}, not ${unknown.join(', ')}`)
      const found = collectAlerts(ctx.root, { env: ctx.env })
      const alerts = wanted.length === 0 ? found.alerts : found.alerts.filter((alert) => wanted.includes(alert.severity))
      // The per-scanner count follows the filter, so scanners[].alerts always adds up to alerts.length.
      const scanners = found.scanners.map((scanner) => ({ ...scanner, alerts: alerts.filter((alert) => alert.scanner === scanner.id).length }))
      const failed = scanners.filter((scanner) => scanner.error !== undefined)
      let text
      if (!scanners.some((scanner) => scanner.detected)) {
        text = `no scanners found in this repository (looked for: ${SCANNERS.map((scanner) => `${scanner.id} needs ${scanner.needs}`).join('; ')})`
      } else if (alerts.length > 0) text = table(['ID', 'Severity', 'Package', 'Title'], alerts.map((alert) => [alert.id, alert.severity, alert.package, alert.title]))
      else text = failed.length === 0 ? 'no alerts' : 'no alerts read'
      // A failed scanner left part of the scan unread, so the text never reads as a clean result.
      if (failed.length > 0) text = [text, ...failed.map((scanner) => `incomplete: ${scanner.id} failed (${scanner.error}), so this result may miss alerts`)].join('\n')
      return { data: { incomplete: failed.length > 0, scanners, alerts }, text, warnings: found.warnings }
    },
  },
  {
    name: 'todos scan', summary: 'TODO and FIXME comments in the files git lists, minus the ones an existing issue matches; reads only', usage: '[--path folder-or-file]', flags: ['path'],
    run: async (ctx) => {
      // The tracker folder is data, not code. A hosted tracker has no folder, so it adds nothing to skip.
      const { issuesDir } = ctx.config()
      const relative = issuesDir ? path.relative(ctx.root, issuesDir) : ''
      const skip = relative !== '' && !climbsOut(relative) ? [slash(relative)] : []
      const { found, files, skippedEmpty, skipped } = scanRepo(ctx.root, { path: ctx.opt('path'), skip, env: ctx.env })
      const existing = await readExistingIssues(await ctx.tracker())
      const { candidates, matched } = matchTodos(groupTodos(found), existing.issues)
      const warnings = existing.problems.map(problemLine)
      if (existing.cut) warnings.push(`incomplete: the tracker has more issues than the ${READ_LIMIT} pmkit read, so a comment that an issue covers may show as new. Do not create issues from this list`)
      if (existing.unread.count > 0) {
        const { count, ids } = existing.unread
        const which = ids.length > 0 ? ` (${ids.join(', ')})` : ''
        const next = ctx.config().system === 'local' ? 'Run /pmkit:local:doctor to fix them, then scan again' : 'Fix them in the tracker, then scan again'
        warnings.push(`incomplete: ${count} ${count === 1 ? 'issue' : 'issues'} could not be read${which}, so a comment that one of them covers may show as new. Do not create issues from this list. ${next}`)
      }
      if (skippedEmpty > 0) warnings.push(`${skippedEmpty} TODO or FIXME comments have no text and were skipped`)
      const unread = Object.entries(skipped.unsupported).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      if (unread.length > 0) {
        const total = unread.reduce((sum, [, count]) => sum + count, 0)
        warnings.push(`${total} files of types the scan cannot read were not read: ${unread.map(([type, count]) => `${type} (${count})`).join(', ')}`)
      }
      const parts = []
      if (candidates.length > 0) parts.push(table(['Key', 'Tag', 'Location', 'Text'], candidates.map((c) => [c.key, c.tag, c.locations.length > 1 ? `${c.locations[0]} (+${c.locations.length - 1})` : c.locations[0], c.title])))
      if (matched.length > 0) parts.push(`already in the tracker:\n${table(['Issue', 'Status', 'Reason', 'Text'], matched.map((m) => [m.issue, m.status ?? '', m.reason, m.text]))}`)
      return { data: { files, skippedEmpty, skipped, incomplete: existing.incomplete, unread: existing.unread, candidates, matched }, text: parts.length > 0 ? parts.join('\n\n') : 'no TODO or FIXME found', warnings }
    },
  },
  {
    name: 'issues branch', summary: 'creates the issue branch and records it on the issue', usage: '<id> [--from branch]', write: true, args: ['id'], flags: ['from'],
    run: async (ctx) => {
      const host = ctx.host()
      const tracker = await ctx.tracker()
      const issue = await tracker.getIssue(ctx.args[0])
      // A tracker that names branches, such as Linear, keeps its name, so its link to the git host works.
      const branch = ctx.settings().trackerBranch === true && issue.branch ? issue.branch : branchName(issue.id, issue.title)
      const from = ctx.opt('from') ?? defaultBranch(ctx)
      // Check the tracker write first, so a refused write leaves git on the branch it was on.
      const actor = await ctx.actor()
      await tracker.updateIssue(issue.id, { branch }, actor, { dryRun: true })
      if (ctx.dryRun) return { data: { branch, from }, text: `would create branch ${branch} from ${from}\ndry run: nothing was written` }
      host.createBranch(branch, { from })
      const result = await tracker.updateIssue(issue.id, { branch }, actor)
      return { data: { branch, ...result }, text: `created branch ${branch} from ${from}\n${writeText(result, ctx)}`, commit: issue.id, notes: await linkedCodeNotes(ctx) }
    },
  },
  {
    name: 'pr open', summary: 'pushes the issue branch and opens a pull request, or returns the one already open', usage: '--issue <id> [--draft] [--body-file f]', write: true, args: [], flags: ['issue', 'body-file', 'draft'],
    run: async (ctx) => {
      if (ctx.opt('issue') === undefined) throw usageError('pr open needs --issue', 'pmkit pr open --issue <id>')
      const host = ctx.host()
      const issue = await (await ctx.tracker()).getIssue(ctx.opt('issue'))
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
        return { data: { ...request, existing: open !== null, pr: open }, text: `${text}\ndry run: nothing was written`, notes: await linkedCodeNotes(ctx) }
      }
      host.push(issue.branch)
      if (open) return { data: { ...open, existing: true }, text: `pushed ${issue.branch} to the open pull request #${open.number}${open.isDraft ? ' (draft)' : ''} ${open.url}`, notes: await linkedCodeNotes(ctx) }
      const pr = host.openPullRequest(request)
      return { data: { ...pr, existing: false }, text: `opened pull request #${pr.number} ${pr.url}`, notes: await linkedCodeNotes(ctx) }
    },
  },
  {
    name: 'pr ready', summary: 'marks the open draft pull request of an issue ready for review', usage: '--issue <id>', write: true, args: [], flags: ['issue'],
    run: async (ctx) => {
      if (ctx.opt('issue') === undefined) throw usageError('pr ready needs --issue', 'pmkit pr ready --issue <id>')
      const host = ctx.host()
      const issue = await (await ctx.tracker()).getIssue(ctx.opt('issue'))
      if (!issue.branch) throw usageError(`${issue.id} has no branch`, `pmkit issues branch ${issue.id}`)
      const pr = host.getPullRequest({ head: issue.branch })
      if (pr?.state !== 'OPEN') throw usageError(`${issue.branch} has no open pull request`, `pmkit pr open --issue ${issue.id}`)
      if (!pr.isDraft) throw usageError(`pull request #${pr.number} is not a draft, it is already ready for review`, `pmkit pr status --branch ${issue.branch}`)
      if (ctx.dryRun) return { data: { ...pr, isDraft: false }, text: `would mark pull request #${pr.number} ready for review ${pr.url}\ndry run: nothing was written`, notes: await linkedCodeNotes(ctx) }
      const ready = host.markReady(pr.number)
      return { data: ready, text: `marked pull request #${ready.number} ready for review ${ready.url}`, notes: await linkedCodeNotes(ctx) }
    },
  },
  {
    name: 'pr status', summary: 'pull request, checks and reviews of a branch', usage: '[--branch b]', args: [], flags: ['branch'],
    run: async (ctx) => {
      const host = ctx.host()
      const branch = ctx.opt('branch') ?? host.currentBranch()
      if (branch === '') throw new PmkitError('INVALID_INPUT', 'no current branch (detached HEAD)', 'pass --branch <branch>, or switch to a branch')
      const pr = host.getPullRequest({ head: branch })
      const checks = pr ? host.prChecks(pr.number) : []
      const reviews = pr ? host.prReviews(pr.number).reviews : []
      const lines = pr
        ? [`#${pr.number} ${pr.title} (${pr.state}${pr.isDraft ? ', draft' : ''})`, pr.url, `checks: ${checks.length === 0 ? '(none)' : checks.map((c) => `${c.name} ${c.bucket ?? c.state}`).join(', ')}`, `reviews: ${reviews.length === 0 ? '(none)' : reviews.map((r) => r.state).join(', ')}`]
        : [`no pull request for ${branch}`]
      return { data: { branch, pr, checks, reviews }, text: lines.join('\n'), notes: await linkedCodeNotes(ctx) }
    },
  },
  {
    name: 'deploys list', summary: 'deployments of the repository with the state of the latest status of each', usage: '[--environment e] [--limit n]', args: [], flags: ['environment', 'limit'],
    run: async (ctx) => {
      const limit = ctx.opt('limit') === undefined ? undefined : whole('limit', ctx.opt('limit'))
      if (limit !== undefined && (limit < 1 || limit > 100)) throw usageError('--limit must be from 1 to 100')
      if (ctx.opt('environment') === '') throw usageError('--environment must not be empty')
      const deploys = ctx.host().listDeploys({ environment: ctx.opt('environment'), limit })
      const lines = deploys.map((d) => `${d.environment} ${d.state} ${d.ref} ${d.sha.slice(0, 7)} ${d.createdAt}${d.url ? ` ${d.url}` : ''}`)
      return { data: { deploys }, text: lines.length === 0 ? 'no deployments' : lines.join('\n'), notes: await linkedCodeNotes(ctx) }
    },
  },
  {
    name: 'ci logs', summary: 'log of the failed steps of a workflow run: the given run, or the newest failed run of a branch', usage: '[--branch b] [--run id] [--tail n]', args: [], flags: ['branch', 'run', 'tail'],
    run: async (ctx) => {
      const runId = ctx.opt('run') === undefined ? undefined : whole('run', ctx.opt('run'))
      if (runId === 0) throw usageError('--run must be a run id')
      if (runId !== undefined && ctx.opt('branch') !== undefined) throw usageError('--run and --branch exclude each other', 'Pass one of them')
      const tail = ctx.opt('tail') === undefined ? 200 : whole('tail', ctx.opt('tail'))
      if (tail < 1) throw usageError('--tail must be at least 1')
      const host = ctx.host()
      const branch = runId === undefined ? ctx.opt('branch') ?? host.currentBranch() : undefined
      if (branch === '') throw new PmkitError('INVALID_INPUT', 'no current branch (detached HEAD)', 'pass --branch <branch> or --run <id>, or switch to a branch')
      const found = host.ciLogs({ branch, runId })
      if (found === null) return { data: { branch, run: null, truncated: false }, text: `no failed run on ${branch}`, notes: await linkedCodeNotes(ctx) }
      const lines = found.log.split('\n')
      const hasFinalNewline = found.log.endsWith('\n')
      const body = hasFinalNewline ? lines.slice(0, -1) : lines
      const truncated = body.length > tail
      const log = truncated ? `${body.slice(-tail).join('\n')}${hasFinalNewline ? '\n' : ''}` : found.log
      return { data: { branch, run: { ...found, log }, truncated }, text: `run ${found.runId}${found.workflowName ? ` ${found.workflowName}` : ''}${truncated ? `, last ${tail} lines` : ''}\n${log}`, notes: await linkedCodeNotes(ctx) }
    },
  },
  {
    name: 'pr diff', summary: 'diff of the pull request of a branch, or the local diff against the base branch when it has none', usage: '[--branch b] [--base b] [--max-lines n]', args: [], flags: ['branch', 'base', 'max-lines'],
    run: async (ctx) => {
      const maxLines = ctx.opt('max-lines') === undefined ? 2000 : whole('max-lines', ctx.opt('max-lines'))
      if (maxLines < 1) throw usageError('--max-lines must be at least 1')
      const requested = ctx.opt('base')
      if (requested !== undefined && (requested === '' || requested.startsWith('-'))) throw new PmkitError('INVALID_INPUT', `base "${requested}" is not a valid branch name`, 'Use a branch name that does not start with -')
      const host = ctx.host()
      const branch = ctx.opt('branch') ?? host.currentBranch()
      if (branch === '') throw new PmkitError('INVALID_INPUT', 'no current branch (detached HEAD)', 'pass --branch <branch>, or switch to a branch')
      const found = host.getPullRequest({ head: branch })
      const notes = []
      // Only an open or merged pull request holds the work of the branch. A closed one is not what the review looks at.
      const pr = found && (found.state === 'OPEN' || found.state === 'MERGED') ? found : null
      if (found && !pr) notes.push(`pull request #${found.number} is closed without merge, so this is the local diff`)
      let full = null
      let local = null
      if (pr) {
        full = host.prDiff(pr.number)
        if (full === null) {
          notes.push(`GitHub refused the diff of pull request #${pr.number} because it is too large, so this is the local diff`)
        } else {
          const unpushed = host.unpushedCommits(branch)
          if (unpushed > 0) notes.push(unpushed === 1 ? `${branch} has 1 local commit that is not on origin, so the pull request diff does not include it` : `${branch} has ${unpushed} local commits that are not on origin, so the pull request diff does not include them`)
        }
      }
      const source = full === null ? 'local' : 'pull_request'
      if (full === null) {
        local = host.localDiff({ branch, base: requested ?? defaultBranch(ctx) })
        full = local.diff
        if (local.uncommitted) notes.push('the local diff includes the uncommitted changes of tracked files')
      }
      const base = local?.base ?? null
      const all = full === '' ? [] : full.replace(/\n$/, '').split('\n')
      const truncated = all.length > maxLines
      const diff = truncated ? `${all.slice(0, maxLines).join('\n')}\n` : full
      const size = truncated ? `first ${maxLines} of ${all.length} lines` : `${all.length} lines`
      const head = source === 'pull_request' ? `pull request #${pr.number}, ${size}` : `local diff of ${branch} against ${base}, ${size}`
      return { data: { branch, source, pr: source === 'pull_request' ? pr : null, base, uncommitted: local?.uncommitted ?? false, diff, truncated, lines: all.length }, text: `${head}\n${diff}`, notes: [...notes, ...(await linkedCodeNotes(ctx))] }
    },
  },
  {
    name: 'pr blockers', summary: 'what blocks the pull request of a branch: checks, reviews, conflicts, open threads and policies; reads only', usage: '[--branch b]', args: [], flags: ['branch'],
    run: async (ctx) => {
      const host = ctx.host()
      const branch = ctx.opt('branch') ?? host.currentBranch()
      if (branch === '') throw new PmkitError('INVALID_INPUT', 'no current branch (detached HEAD)', 'pass --branch <branch>, or switch to a branch')
      const pr = host.getPullRequest({ head: branch })
      if (!pr) return { data: { branch, pr: null, blocked: null }, text: `no pull request for ${branch}`, notes: await linkedCodeNotes(ctx) }
      const found = collectBlockers(host, pr)
      return { data: { branch, pr, ...found }, text: blockersText(pr, found), notes: await linkedCodeNotes(ctx) }
    },
  },
  {
    name: 'pr sync', summary: 'moves in_review issues to done when their pull request is merged', write: true, args: [], flags: [],
    run: async (ctx) => {
      const host = ctx.host()
      const tracker = await ctx.tracker()
      const actor = await ctx.actor()
      const found = await tracker.searchIssues({ categories: ['in_review'] })
      const candidates = found.issues.filter((issue) => issue.branch)
      const moved = []
      // A file that does not parse may be an in_review issue, so it is reported, not skipped.
      const problems = found.problems.map(({ id, code, message }) => ({ id, code, message }))
      for (const issue of candidates) {
        try {
          const pr = host.getPullRequest({ head: issue.branch })
          if (pr?.mergedAt) {
            await tracker.moveToCategory(issue.id, 'done', actor, { dryRun: ctx.dryRun })
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
      return { data, text: lines.join('\n'), commit: moved.length > 0 ? moved.map((m) => m.id).join(' ') : undefined, notes: await linkedCodeNotes(ctx) }
    },
  },
  {
    name: 'changelog', summary: 'prints the CHANGELOG.md sections newer than a version, oldest first; needs no config', usage: '--file f --since v', flags: ['file', 'since'], exempt: true,
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
    name: 'render', summary: 'renders a board, roadmap or sprint view as Markdown or HTML',
    usage: '<board|roadmap|sprint> [--format md|html] [--sprint id|current] [--out f | --save]',
    args: ['view'], flags: ['format', 'sprint', 'out', 'save'], dryRun: true, local: true, run: runRender,
  },
  {
    name: 'migrate', summary: 'moves the tracker files to the format this pmkit writes; --dry-run lists every file it would touch', write: true, local: true, flags: [],
    run: (ctx) => runMigrate(ctx.root, { dryRun: ctx.dryRun }),
  },
  {
    name: 'local-migrate export', summary: 'moves .issues/ to the Linear team; a rerun resumes; --dry-run prints the preview and its digest',
    usage: '[--workspace acme --team ACME] [--status cat=Name] [--type-label type=Label] [--field estimate=native|none] [--expect <digest>] [--dry-run]',
    flags: ['workspace', 'team', 'path', 'status', 'type-label', 'field', 'expect'], write: true, dryRun: true, systems: ['local', 'linear'], run: runExport,
  },
  {
    name: 'local-migrate import', summary: 'copies the Linear team into an empty .issues/; a rerun resumes; --dry-run prints the preview and its digest',
    usage: '[--workspace acme --team ACME] [--path .issues] [--expect <digest>] [--dry-run]',
    flags: ['workspace', 'team', 'path', 'expect'], write: true, dryRun: true, systems: ['local', 'linear'], run: runImport,
  },
  {
    name: 'local-migrate status', summary: 'prints the newest migration map: direction, counts by state, failures and the next step; sends no request',
    usage: '[--file .pmkit/migrations/<map>.yaml]', flags: ['file'], systems: ['local', 'linear'], run: runStatus,
  },
  {
    name: 'local-migrate undo', summary: 'deletes what an export created, after the full preview; for an import map prints the git commands',
    usage: '[--file .pmkit/migrations/<map>.yaml] [--expect <digest>] [--dry-run]',
    flags: ['file', 'expect'], write: true, dryRun: true, systems: ['local', 'linear'], run: runUndo,
  },
  {
    name: 'local-migrate switch', summary: 'writes tracker.system, the scope and the mappings of a finished map to .pmkit/config.yaml; sends no request',
    usage: '--to linear|local [--file .pmkit/migrations/<map>.yaml] [--dry-run]',
    flags: ['to', 'file'], write: true, dryRun: true, systems: ['local', 'linear'], run: runSwitch,
  },
  {
    name: 'reindex', summary: 'rebuilds the query index in .issues/.cache/ from the issue files; changes only files git ignores', local: true, flags: [],
    run: async (ctx) => {
      const result = (await ctx.local()).reindex()
      if (!result.written) {
        return { data: result, text: `the query index was not written: ${result.reason}`, warnings: ['searches still work, they read every issue file'] }
      }
      return { data: result, text: `indexed ${result.issues} issues (${result.problems} could not be read) in ${result.path}` }
    },
  },
  {
    name: 'linear triage show', summary: 'who is on triage duty for a team; says so when the plan or the team setting lacks the feature',
    usage: '[--team KEY]', linear: true, flags: ['team'],
    run: async (ctx) => (await ctx.linear('triage')).show({ team: ctx.opt('team') }),
  },
  {
    name: 'linear triage suggestions', summary: 'the active Triage Intelligence suggestions for the issues in a team\'s triage inbox',
    usage: '[--team KEY] [--limit n]', linear: true, flags: ['team', 'limit'],
    run: async (ctx) => (await ctx.linear('triage')).suggestions({ team: ctx.opt('team'), limit: ctx.opt('limit') }),
  },
  {
    name: 'linear triage set', summary: 'changes the manual triage rotation or its action, or turns the responsibility off; --dry-run previews',
    usage: '(--members id,.. [--action assign|notify] | --action assign|notify | --off) [--team KEY]',
    write: true, linear: true, dryRun: true, flags: ['team', 'members', 'action', 'off'],
    run: async (ctx) => (await ctx.linear('triage')).set({ team: ctx.opt('team'), members: ctx.opt('members'), action: ctx.opt('action'), off: ctx.flag('off') ? true : undefined, dryRun: ctx.dryRun }),
  },
  {
    name: 'linear customers list', summary: 'customers with status, tier, revenue, size and request count, highest revenue first; says so when the workspace has no customers',
    usage: '[--status NAME] [--tier NAME] [--limit n]', linear: true, flags: ['status', 'tier', 'limit'],
    run: async (ctx) => (await ctx.linear('customers')).list({ status: ctx.opt('status'), tier: ctx.opt('tier'), limit: ctx.opt('limit') }),
  },
  {
    name: 'linear customers show', summary: 'one customer with its requests, newest first, and what each request is linked to',
    usage: '--customer ID_OR_NAME', linear: true, flags: ['customer'],
    run: async (ctx) => (await ctx.linear('customers')).show({ customer: ctx.opt('customer') }),
  },
  {
    name: 'linear customers set', summary: 'edits the status, tier, revenue, size, owner or name of one customer; --dry-run previews',
    usage: '--customer ID_OR_NAME [--status NAME] [--tier NAME|none] [--revenue n] [--size n] [--owner MEMBER_ID|none] [--name TEXT]',
    write: true, linear: true, dryRun: true, flags: ['customer', 'status', 'tier', 'revenue', 'size', 'owner', 'name'],
    run: async (ctx) => (await ctx.linear('customers')).set({
      customer: ctx.opt('customer'), status: ctx.opt('status'), tier: ctx.opt('tier'), revenue: ctx.opt('revenue'), size: ctx.opt('size'), owner: ctx.opt('owner'), name: ctx.opt('name'), dryRun: ctx.dryRun,
    }),
  },
  {
    name: 'linear customers link', summary: 'links a customer request to an issue or a project, or moves an existing request with --request; --dry-run previews',
    usage: '--customer ID_OR_NAME (--issue KEY | --project NAME) [--body TEXT] [--important] [--request ID]',
    write: true, linear: true, dryRun: true, flags: ['customer', 'issue', 'project', 'request', 'body', 'important'],
    run: async (ctx) => (await ctx.linear('customers')).link({
      customer: ctx.opt('customer'), issue: ctx.opt('issue'), project: ctx.opt('project'), request: ctx.opt('request'), body: ctx.opt('body'), important: ctx.flag('important') ? true : undefined, dryRun: ctx.dryRun,
    }),
  },
  {
    name: 'validate', summary: 'checks every file and reference; problems are output, not errors', flags: [], exempt: true,
    run: (ctx) => {
      const result = validateRepo(ctx.root, { adapters: ctx.adapters })
      const c = result.checked
      const head = `checked: ${c.issues} issues, ${c.epics} epics, ${c.sprints} sprints, ${c.milestones} milestones, ${c.releases} releases, ${c.comments} comments`
      const body = result.problems.length === 0 ? 'no problems' : result.problems.map((p) => `${p.path}  ${p.code}  ${p.message}`).join('\n')
      return { data: result, text: `${head}\n${body}` }
    },
  },
]

/**
 * Whether `tag` exists in the repository at `root`, as a warning text, or null when it does. Reads git and writes nothing.
 * `env` lets a test hide git through PATH.
 */
export function tagWarning(root, tag, env) {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { cwd: root, env, encoding: 'utf8' })
  if (result.error) {
    const reason = result.error.code === 'ENOENT' ? 'git is not installed or not on PATH' : result.error.message
    return `cannot check tag ${tag}: ${reason}`
  }
  if (result.status === 0) return null
  if (result.status === 1) return `tag ${tag} is not in this repository; create and push it, or run git fetch --tags`
  const first = (result.stderr ?? '').split('\n')[0].replace(/^fatal: /, '').trim()
  return `cannot check tag ${tag}: ${first || `git exited with ${result.status}`}`
}

const errorOf = (error) => ({ code: error.code, message: error.message, nextStep: error.nextStep })

/** The risk radar: reads the tracker and, with a git host, the open pull requests and the runs on the default branch. Writes nothing. */
async function runRisks(ctx) {
  const tracker = await ctx.tracker()
  const { defaults } = ctx.settings()
  const today = ctx.now().toISOString().slice(0, 10)
  const stuckBusinessDays = defaults.stuck_business_days
  const windowDays = defaults.status_update_window_days
  const warnings = []

  const { issues: all, problems: found } = await tracker.searchIssues({ archived: true })
  const problems = found.map(({ id, code, message }) => ({ id, code, message }))
  warnings.push(...found.map(problemLine))
  const byId = new Map(all.map((issue) => [issue.id, issue]))
  const problemsById = new Map(problems.map((problem) => [problem.id, problem.code]))
  // A Linear team with cycles off has no active sprint: risks goes on without one, and the cycles note says why.
  let activeSprintId = null
  const cycleNotes = []
  try {
    activeSprintId = (await tracker.currentCycle())?.id ?? null
  } catch (error) {
    if (!isPmkitError(error) || error.code !== 'NOT_SUPPORTED') throw error
    cycleNotes.push(...(await capabilityNotes(tracker, 'cycles')))
  }
  const eventsByIssue = groupEventsByIssue(await tracker.metricEvents())
  const issuesByBranch = Object.create(null)
  for (const issue of all) if (!issue.archived && issue.branch && issuesByBranch[issue.branch] === undefined) issuesByBranch[issue.branch] = issue.id

  const system = ctx.config().pmkit.git_host?.system ?? 'none'
  const branch = defaultBranch(ctx)
  let gitHost = { system, available: true }
  let openPrsByBranch = Object.create(null)
  let closedPrsByBranch = Object.create(null)
  // null: not checked because no host is available. { error }: that one call failed.
  let prs = null
  let ci = null
  const hostWarnings = []
  // A missing or logged out gh fails every call the same way, so it ends the host phase and drops what it read.
  const stopsHost = (error) => isPmkitError(error) && (error.code === 'NOT_CONFIGURED' || error.code === 'AUTH')
  // A rate limit or an upstream failure affects only the call that raised it.
  const affectsOneCall = (error) => isPmkitError(error) && (error.code === 'RATE_LIMITED' || error.code === 'UPSTREAM')
  try {
    const host = ctx.host()
    try {
      prs = host.listPullRequests()
      if (prs.length === 200) hostWarnings.push('only the 200 most recently created open pull requests were read')
      openPrsByBranch = prsByBranch(prs)
    } catch (error) {
      if (!affectsOneCall(error)) throw error
      prs = { error: errorOf(error) }
      hostWarnings.push(`pull requests not checked: ${error.message}`)
    }
    if (Array.isArray(prs)) {
      for (const issue of needsPrLookup(all, { eventsByIssue, openPrsByBranch, today, stuckBusinessDays })) {
        try {
          const pr = host.getPullRequest({ head: issue.branch })
          if (pr !== null && pr.state !== 'OPEN') closedPrsByBranch[issue.branch] = pr
        } catch (error) {
          // A branch hand-edited to something gh rejects (INVALID_INPUT) fails only this lookup.
          if (!affectsOneCall(error) && !(isPmkitError(error) && error.code === 'INVALID_INPUT')) throw error
          hostWarnings.push(`${issue.id}: the pull request of ${issue.branch} could not be read: ${error.message}`)
        }
      }
    }
    let defaultBranchCi
    try {
      defaultBranchCi = { branch, ...failingWorkflows(host.listRuns({ branch })) }
    } catch (error) {
      if (!affectsOneCall(error)) throw error
      defaultBranchCi = { branch, error: errorOf(error) }
      hostWarnings.push(`CI on ${branch} not checked: ${error.message}`)
    }
    ci = { defaultBranch: defaultBranchCi, pullRequests: Array.isArray(prs) ? failingPullRequests(prs) : prs }
    warnings.push(...hostWarnings)
  } catch (error) {
    if (isPmkitError(error) && error.code === 'NOT_SUPPORTED') {
      warnings.push(`no git host is configured, ${NO_HOST}`)
    } else if (stopsHost(error)) {
      warnings.push(`${error.message}, ${NO_HOST}; next: ${error.nextStep}`)
    } else throw error
    gitHost = { system, available: false, reason: errorOf(error) }
    openPrsByBranch = Object.create(null)
    closedPrsByBranch = Object.create(null)
    prs = null
    ci = null
  }

  const updatesByEpic = {}
  const epicWarnings = []
  const epics = await tracker.listDeliverables()
  for (const epic of epics) {
    try {
      updatesByEpic[epic.id] = await tracker.listStatusUpdates(epic.id)
    } catch (error) {
      if (!isPmkitError(error)) throw error
      updatesByEpic[epic.id] = []
      problems.push({ id: epic.id, code: error.code, message: error.message })
      epicWarnings.push(`${epic.id}: ${error.code} ${error.message}`)
    }
  }
  warnings.push(...epicWarnings)

  const report = {
    today,
    thresholds: { stuckBusinessDays, statusUpdateWindowDays: windowDays },
    gitHost,
    blocked: blockedIssues(all, { byId, problemsById, activeSprintId }),
    stalledIssues: stalledIssues(all, { eventsByIssue, openPrsByBranch, closedPrsByBranch, today, stuckBusinessDays }),
    stalledPullRequests: Array.isArray(prs) ? stalledPullRequests(prs, { issuesByBranch, today, stuckBusinessDays }) : prs,
    epics: epicRisks(epics, { updatesByEpic, today, windowDays }),
    ci,
    problems,
  }
  return { data: report, text: risksText(report), warnings, notes: [...cycleNotes, ...(await metricNotes(tracker, 'stalled-issue history'))] }
}

const LOAD_CATEGORIES = ['todo', 'in_progress', 'in_review']

/** Calls a tracker read that a tracker may not have, and returns `fallback` on NOT_SUPPORTED. */
async function orSupported(read, fallback) {
  try {
    return await read()
  } catch (error) {
    if (!isPmkitError(error) || error.code !== 'NOT_SUPPORTED') throw error
    return fallback
  }
}


/**
 * The members of the team the tracker is scoped to. Linear lists the whole workspace, and each member carries the keys of
 * its teams. Without a team in the scope, or on a tracker whose members carry no teams (Local), every member counts.
 */
const teamMembers = (members, teamKey) => (teamKey === undefined ? members : members.filter((member) => member.teams === undefined || member.teams.includes(teamKey)))

/** The load per member for the active sprint, or for all open work without one. Writes nothing. */
async function runTeamLoad(ctx) {
  const { data, warnings, notes } = await teamLoadReport(ctx, { wanted: ctx.opt('sprint') })
  return { data, text: teamLoadText(data), warnings, notes }
}

/**
 * The load report of `team load`. `wanted` is `current`, a sprint id or undefined. `requireSprint` fails with NOT_FOUND when no sprint is
 * in scope. `capacity` and `daysOff` replace the stored maps, which `team capacity` uses to show the load a change would give.
 */
async function teamLoadReport(ctx, { wanted, requireSprint = false, capacity: capacityOverride, daysOff: daysOffOverride, withAging = true }) {
  const tracker = await ctx.tracker()
  const notes = []
  const warnings = []
  let sprint = null
  if (wanted === undefined || wanted === 'current') {
    // A Linear team with cycles off has no active sprint: the load covers all open work, and the cycles note says why.
    try {
      sprint = await tracker.currentCycle()
    } catch (error) {
      if (!isPmkitError(error) || error.code !== 'NOT_SUPPORTED') throw error
      notes.push(...(await capabilityNotes(tracker, 'cycles')))
    }
    if (sprint === null && requireSprint) throw new PmkitError('NOT_FOUND', 'no sprint is active', 'Create one with /pmkit:cycle:plan, or name a sprint with --sprint <id>')
    if (sprint === null) notes.push('no active sprint: counted every open issue in todo, in_progress and in_review')
  } else {
    // An explicit sprint needs cycles: listCycles answers NOT_SUPPORTED when the tracker has none.
    sprint = (await tracker.listCycles({})).find((item) => item.id === wanted) ?? null
    if (sprint === null) throw new PmkitError('NOT_FOUND', `sprint ${wanted} does not exist`, 'pmkit cycle list')
  }
  const found = await tracker.searchIssues({ categories: LOAD_CATEGORIES, ...(sprint ? { sprint: sprint.id } : {}) })
  warnings.push(...found.problems.map(problemLine))
  const truncated = found.hasMore === true
  if (truncated) warnings.push('the issue read was cut before the end, so the load covers only part of the scope and no move is proposed')
  const capabilities = (await tracker.capabilities()).capabilities
  const estimation = capabilities.find((c) => c.id === 'estimation')
  const choice = chooseUnit(found.issues, estimation)
  if (choice.unit === 'issues') notes.push(`counted issues instead of estimates: ${choice.reason}${estimation?.path === 'absent' && estimation.enableHint ? ` (${estimation.enableHint})` : ''}`)
  if (estimation?.path === 'conditional') notes.push(...(await capabilityNotes(tracker, 'estimation')))
  const capacity = capacityOverride ?? (sprint ? await orSupported(() => tracker.getCapacity(sprint.id), {}) : {})
  const daysOff = daysOffOverride ?? (sprint ? await orSupported(() => tracker.getDaysOff(sprint.id), {}) : {})
  if (sprint) notes.push(...(await capabilityNotes(tracker, 'capacity')))
  let ages = []
  if (withAging) {
    const { categoryOf, events, warnings: capped } = await flowInputs(tracker)
    warnings.push(...capped)
    ages = aging(events, { categoryOf, asOf: ctx.now().toISOString().replace(/\.\d{3}Z$/, 'Z') })
  }
  const report = teamLoad(found.issues, { members: teamMembers((await tracker.discover()).members, ctx.config().pmkit?.tracker?.scope?.team), aging: ages, capacity, daysOff, unit: choice.unit })
  if (report.unknownLoad.length > 0) {
    const n = report.unknownLoad.length
    notes.push(`${n} ${n === 1 ? 'member has' : 'members have'} open issues and no estimate: their load is unknown, so they stay out of the average, the flags and the proposed moves`)
  }
  const counted = [report.unassigned.unestimated, ...report.rows.filter((row) => !row.unknown).map((row) => row.unestimated)]
  if (choice.unit !== 'issues' && counted.some((n) => n > 0)) {
    warnings.push(`some issues have no estimate and count 0 ${choice.unit}; the Unestimated column shows how many per member`)
  }
  if (withAging) notes.push(...(await metricNotes(tracker, 'aging')))
  const proposal = truncated ? { moves: [], reason: null } : proposeMoves(report, found.issues)
  const suggestions = proposal.moves
  const noMoves = proposal.reason === null ? null : { reason: proposal.reason, message: NO_MOVE_MESSAGES[proposal.reason] }
  const data = { sprint: sprint ? { id: sprint.id, name: sprint.name, start: sprint.start, end: sprint.end } : null, truncated, ...report, suggestions, noMoves }
  return { data, warnings, notes, sprint, incomplete: truncated || found.problems.length > 0 }
}

const HUMAN_ROW = (row) => !row.agent && row.isMember

/** The part of a load report that a capacity change moves: the imbalances and the flags per member. Null when the read was cut. */
const loadView = (report, incomplete) => (incomplete ? null : { imbalances: report.imbalances, flags: Object.fromEntries(report.rows.filter(HUMAN_ROW).map((row) => [row.member, row.flags])) })

/** Capacity and days off per member for a sprint. With --set or --days-off it writes them in one tracker call, so a batch is atomic. */
async function runTeamCapacity(ctx) {
  const tracker = await ctx.tracker()
  const wanted = ctx.opt('sprint') ?? 'current'
  const writing = ctx.opt('set') !== undefined || ctx.opt('days-off') !== undefined
  const current = await teamLoadReport(ctx, { wanted, requireSprint: true, withAging: false })
  const { sprint, incomplete } = current
  const humans = current.data.rows.filter(HUMAN_ROW)
  const warnings = [...current.warnings]
  const unit = current.data.unit
  const members = (report, hide) => humans.map((row) => {
    const live = report.rows.find((item) => item.member === row.member)
    return {
      member: row.member, name: row.name, availability: row.availability ?? null, capacity: live.capacity, daysOff: live.daysOff,
      workingDays: workingDays(sprint, live.daysOff), estimate: hide ? null : live.estimate, load: hide ? null : live.load, flags: hide ? null : live.flags,
    }
  })
  const header = `sprint ${sprint.id} (${sprint.start} to ${sprint.end}), capacity${unit === 'issues' ? '' : ` in ${unit}`}`
  if (!writing) {
    const data = { sprint: { id: sprint.id, name: sprint.name, start: sprint.start, end: sprint.end }, unit, sprintWorkingDays: workingDays(sprint), members: members(current.data, incomplete), imbalances: incomplete ? null : current.data.imbalances, notes: current.notes, warnings }
    const label = unit === 'issues' ? 'Capacity' : `Capacity (${unit})`
    const text = [header, table(['Member', 'Availability', label, 'Days off', 'Working days', 'Load', 'Flags'], data.members.map((row) => [row.member, row.availability ?? '', row.capacity ?? 'not set', row.daysOff.join(', '), row.workingDays, row.load ?? '?', (row.flags ?? []).join(', ')]))].join('\n')
    return { data, text, warnings, notes: current.notes }
  }
  const set = ctx.opt('set') === undefined ? undefined : parseCapacityPairs(csv(ctx.list('set')))
  const off = ctx.opt('days-off') === undefined ? undefined : parseDaysOff(ctx)
  checkMembers([...Object.keys(set ?? {}), ...Object.keys(off ?? {})], humans.map((row) => row.member))
  const capacity = set === undefined ? undefined : mergeCapacity(await tracker.getCapacity(sprint.id), set)
  const result = await tracker.updateCycleCapacity(sprint.id, { capacity, daysOff: off }, await ctx.actor(), { dryRun: ctx.dryRun })
  const ids = humans.map((row) => row.member)
  const changes = changeList({ capacity: result.before.capacity, daysOff: result.before.daysOff }, { capacity: result.after.capacity, daysOff: result.after.daysOff }, ids)
  let after = null
  if (!incomplete) after = loadView((await teamLoadReport(ctx, { wanted: sprint.id, capacity: result.after.capacity, daysOff: result.after.daysOff, withAging: false })).data, false)
  else warnings.push('the load effect of this change is not verified, because the issue read is incomplete')
  const readNote = await capabilityNotes(tracker, 'capacity')
  const notes = [...current.notes.filter((note) => !readNote.includes(note))]
  if (readNote.length > 0 && (await tracker.capabilities()).capabilities.find((c) => c.id === 'capacity')?.path === 'derived') {
    notes.push(ctx.dryRun ? 'capacity and days off would be written to .pmkit/capacity.yaml; Linear is not changed' : 'capacity and days off written to .pmkit/capacity.yaml; Linear was not changed')
  }
  const data = { dryRun: ctx.dryRun === true, sprint: { id: sprint.id, name: sprint.name, start: sprint.start, end: sprint.end }, unit, changes, load: { before: loadView(current.data, incomplete), after }, notes, warnings }
  const lines = [header]
  if (changes.length === 0) lines.push('no change')
  for (const change of changes) {
    lines.push(change.member)
    if (change.capacity.before !== change.capacity.after) lines.push(`  capacity ${change.capacity.before ?? 'not set'} → ${change.capacity.after ?? 'not set'}`)
    if (change.daysOff.before.join() !== change.daysOff.after.join()) lines.push(`  days off ${change.daysOff.before.join(', ') || 'none'} → ${change.daysOff.after.join(', ') || 'none'}`)
  }
  if (after !== null && data.load.before !== null) {
    for (const member of ids) {
      const [was, now] = [data.load.before.flags[member] ?? [], after.flags[member] ?? []]
      if (was.join() !== now.join()) lines.push(`flags ${member}: ${was.join(', ') || 'none'} → ${now.join(', ') || 'none'}`)
    }
  }
  if (ctx.dryRun) lines.push('dry run: nothing was written')
  return { data, text: lines.join('\n'), warnings, notes, commit: sprint.id }
}

function teamLoadText(data) {
  const estimated = data.unit !== 'issues'
  const label = data.unit.charAt(0).toUpperCase() + data.unit.slice(1)
  const rows = [...data.rows, { ...data.unassigned, member: 'unassigned', wip: '', oldestWipDays: null, capacity: null, flags: [], unknown: false }]
  const lines = [
    data.sprint ? `sprint ${data.sprint.id} (${data.sprint.start} to ${data.sprint.end}), load in ${data.unit}, average ${data.average}` : `no sprint, load in ${data.unit}, average ${data.average}`,
    table(
      ['Member', 'Issues', ...(estimated ? [label, 'Unestimated'] : []), 'WIP', 'Oldest WIP days', ...(estimated ? ['Capacity'] : []), 'Flags'],
      rows.map((row) => [
        row.member + (row.agent ? ' (agent)' : '') + (row.isMember === false ? ' (not a member)' : '') + (row.partial ? ' (partial)' : ''), row.issues,
        ...(estimated ? [row.unknown ? '?' : row.estimate, row.unestimated] : []), row.wip, row.oldestWipDays ?? '', ...(estimated ? [row.capacity ?? ''] : []), (row.flags ?? []).join(', '),
      ]),
    ),
  ]
  if (data.imbalances.length > 0) lines.push('imbalances:', ...data.imbalances.map((item) => `  ${item.member}: ${item.flag}, load ${item.load}, limit ${item.limit}`))
  if (data.noWork.length > 0) lines.push(`no work in scope: ${data.noWork.map((item) => item.member + (item.daysOff.length > 0 ? ` (days off ${item.daysOff.join(', ')})` : '')).join(', ')}`)
  if (data.noMoves) lines.push(`no proposed moves: ${data.noMoves.message}`)
  if (data.suggestions.length > 0) lines.push('proposed moves:', ...data.suggestions.map((move) => `  ${move.issue}: ${move.from} to ${move.to}`))
  return lines.join('\n')
}

const RENDER_VIEWS = ['board', 'roadmap', 'sprint']
const RENDER_FORMATS = ['md', 'html']

const HTML_EXTENSIONS = ['.html', '.htm']
const MARKDOWN_EXTENSIONS = ['.md', '.markdown']

/** True when `rel`, a relative path, climbs out of its base. A name that only starts with two dots, such as `..board.md`, stays inside. */
const climbsOut = (rel) => rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)

/** `file` with the symlinks of its nearest existing parent folder resolved, so a link into a folder is seen as that folder. */
const realParent = (file) => {
  const rest = []
  let current = file
  while (!fs.existsSync(current) && path.dirname(current) !== current) {
    rest.unshift(path.basename(current))
    current = path.dirname(current)
  }
  return path.join(fs.realpathSync(current), ...rest)
}

/** True when `file` is `dir` or inside it, by the real location of both. */
const isInside = (dir, file) => {
  const rel = path.relative(realParent(dir), realParent(file))
  return rel === '' || !climbsOut(rel)
}

/** Refuses a destination that is a folder, for --out and --save alike. */
function refuseFolder(ctx, file) {
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) throw usageError(`${renderPath(ctx, file)} is a folder`, 'Name a file, such as board.md')
}

/**
 * The file a render writes and its format, or a null file for stdout. Checks the destination flags before any read.
 * `--save` writes to the real tracker folder, never to the migrated copy of an older format.
 */
function renderTarget(ctx, view) {
  const out = ctx.opt('out')
  const save = ctx.flag('save')
  const format = ctx.opt('format')
  if (format !== undefined && !RENDER_FORMATS.includes(format)) throw usageError('--format must be md or html')
  if (out !== undefined && save) throw usageError('--out and --save cannot go together', 'Use --save for the default location, or --out <path>')
  if (out === undefined) {
    const chosen = format ?? 'md'
    if (!save) return { file: null, format: chosen }
    const target = path.join(ctx.config().issuesDir, CACHE_DIR, 'render', `${view}.${chosen}`)
    refuseFolder(ctx, target)
    return { file: target, format: chosen, save: true }
  }
  const file = path.resolve(ctx.cwd, out)
  const ext = path.extname(file).toLowerCase()
  if ((format === 'md' && HTML_EXTENSIONS.includes(ext)) || (format === 'html' && MARKDOWN_EXTENSIONS.includes(ext))) {
    throw usageError(`--format ${format} does not match the extension of ${out}`, 'Drop --format, or change the --out extension')
  }
  const display = renderPath(ctx, file)
  const { issuesDir } = ctx.config()
  if (isInside(issuesDir, file)) {
    const tracker = slash(path.relative(ctx.root, issuesDir))
    throw usageError(`${display} is inside the tracker folder ${tracker}/`, `Use --save, or a path outside ${tracker}/`)
  }
  refuseFolder(ctx, file)
  return { file, format: format ?? (HTML_EXTENSIONS.includes(ext) ? 'html' : 'md') }
}

/** A path relative to the repository root with `/`, or the absolute path when the file is outside the root. */
const renderPath = (ctx, file) => {
  const rel = path.relative(ctx.root, file)
  return slash(rel === '' || climbsOut(rel) ? file : rel)
}

/** Gathers the view data through tracker reads and renders it to stdout or one file. Changes no tracker file and never replaces a file it did not render. */
async function runRender(ctx) {
  const [view] = ctx.args
  if (!RENDER_VIEWS.includes(view)) throw usageError(`view must be board, roadmap or sprint, got "${view}"`, 'pmkit render board')
  const sprint = ctx.opt('sprint')
  if (sprint !== undefined && view !== 'sprint') throw usageError('--sprint works only with the sprint view', 'pmkit render sprint --sprint <id>')
  const { file, format, save } = renderTarget(ctx, view)
  const display = file === null ? null : renderPath(ctx, file)
  const overwrote = file !== null && fs.existsSync(file)
  if (overwrote && !hasMarker(fs.readFileSync(file, 'utf8'))) {
    throw new PmkitError('CONFLICT', `${display} exists and was not written by pmkit render`, 'Pick another path, or delete the file first')
  }
  const tracker = await ctx.local()
  const { local } = ctx.config()
  const views = {
    board: () => [boardData(tracker, local), boardDoc],
    roadmap: () => [roadmapData(tracker, local), roadmapDoc],
    sprint: () => [sprintData(tracker, local, sprint ?? 'current'), sprintDoc],
  }
  const [viewData, toDoc] = views[view]()
  const content = renderDocument(toDoc(viewData), view, format)
  const warnings = [problemsLine(viewData.problems)].filter((line) => line !== null)
  const meta = { asOf: viewData.asOf, problems: viewData.problems, ...(ctx.dryRun ? { dryRun: true } : {}) }
  if (file === null) {
    // The run loop adds the final newline.
    return { data: { view, format, path: null, content, ...meta }, text: content.replace(/\n$/, ''), warnings }
  }
  if (!ctx.dryRun) {
    if (save) ensureCacheIgnored(path.join(ctx.config().issuesDir, CACHE_DIR))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    writeFileAtomic(file, content)
  }
  const line = `${ctx.dryRun ? 'would write' : 'wrote'} ${display} (${view}, ${format})`
  return {
    data: { view, format, path: display, overwrote, ...meta },
    text: ctx.dryRun ? `${line}\ndry run: nothing was written` : line,
    warnings,
  }
}

const gitIn = (root, ...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })

/** Plans the migration, then writes it unless `dryRun`. `formatVersion` and `migrations` default to the real ones. */
export function runMigrate(root, { dryRun = false, formatVersion = FORMAT_VERSION, migrations = MIGRATIONS } = {}) {
  const config = loadConfig(root, { checkFormat: false })
  if (config.pmkitProblems.length > 0) throw pmkitWriteRefusal(config.pmkitProblems)
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
    commitTracker(migrated, message, [trackerPath])
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

// Label names from --label, deduplicated in flag order.
function initLabels(ctx) {
  const names = []
  for (const name of csv(ctx.list('label'))) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) throw usageError(`label "${name}" must match ^[a-z0-9][a-z0-9_-]*$, like needs-criteria`)
    if (!names.includes(name)) names.push(name)
  }
  return names
}

const LINEAR_FLAGS = ['workspace', 'team', 'status', 'field', 'type-label']
const LOCAL_ONLY_FLAGS = ['prefix', 'id-style', 'estimate-unit', 'label', 'member', 'name', 'email', 'members-file']

function runInit(ctx) {
  const { opt } = ctx
  const update = ctx.flag('update')
  // A Linear repository takes the hosted branch. setup cannot move a repository from one tracker to another.
  const requested = opt('tracker')
  let system = requested ?? 'local'
  if (update && fs.existsSync(path.join(ctx.root, '.pmkit', 'config.yaml'))) {
    let filed
    try {
      filed = parseYaml(normalized(fs.readFileSync(path.join(ctx.root, '.pmkit', 'config.yaml'), 'utf8')))?.tracker?.system
    } catch {
      // A file that does not parse is reported by the update path below.
    }
    if (filed === 'linear' || requested === 'linear') {
      if (requested !== undefined && requested !== filed) throw new PmkitError('NOT_SUPPORTED', 'setup cannot switch trackers', 'Keep tracker.system as it is')
      system = filed
    }
  }
  if (system === 'linear') return runInitLinear(ctx)
  for (const flag of LINEAR_FLAGS) {
    if (opt(flag) !== undefined) throw usageError(`--${flag} applies only with --tracker linear`, `Remove --${flag}`)
  }
  if ((opt('tracker') ?? 'local') !== 'local') throw new PmkitError('NOT_SUPPORTED', `tracker "${opt('tracker')}" is not supported yet`, 'Use --tracker local')
  const host = opt('git-host')
  if (host !== undefined && !GIT_HOSTS.includes(host)) throw usageError(`--git-host must be ${GIT_HOSTS.join(' or ')}`)
  const idStyle = opt('id-style')
  if (idStyle !== undefined && !ID_STYLES.includes(idStyle)) throw usageError(`--id-style must be ${ID_STYLES.join(' or ')}`)
  const unit = opt('estimate-unit')
  if (unit !== undefined && !ESTIMATE_UNITS.includes(unit)) throw usageError(`--estimate-unit must be ${ESTIMATE_UNITS.join(', ')}`)
  if (update && opt('prefix') !== undefined) throw usageError('id_prefix cannot change after setup', 'Remove --prefix')
  const members = initMembers(opt)
  const labels = initLabels(ctx)

  const root = ctx.root
  const read = (file) => normalized(fs.readFileSync(path.join(root, file), 'utf8'))
  const exists = (file) => fs.existsSync(path.join(root, file))
  const template = (name) => fs.readFileSync(path.join(TEMPLATES, name), 'utf8')
  const pmkitFile = path.join('.pmkit', 'config.yaml')
  let trackerDir = '.issues'
  if (update) {
    if (!exists(pmkitFile)) throw usageError('.pmkit/config.yaml does not exist, so there is no setup to update', 'Run init without --update')
    try {
      const parsed = parseYaml(read(pmkitFile))
      const tp = parsed?.tracker?.path
      trackerDir = typeof tp === 'string' ? tp : '.issues'
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
  // pmkit is final here. This check runs first and alone, before any .issues/config.yaml parse and before entries exist.
  pmkit = setSchemaLine(pmkit, schemaUrl(SCHEMA_FILES.pmkit))
  const refusal = pmkitConfigRefusal(pmkit, { update })
  if (refusal) throw refusal
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
  // A hand-written `labels: bug` is a string: leave it alone so the validator below refuses it, instead of spreading it into letters or replacing it.
  const labelsValue = parsedLocal().labels
  const currentLabels = Array.isArray(labelsValue) ? labelsValue : []
  const labelsKept = labels.filter((name) => currentLabels.includes(name))
  const labelsAdded = labels.filter((name) => !currentLabels.includes(name))
  if (labelsAdded.length > 0 && (labelsValue === undefined || Array.isArray(labelsValue))) {
    local = edit(issuesConfig, 'labels', () => setScalar(local, ['labels'], [...currentLabels, ...labelsAdded]))
  }
  local = setSchemaLine(local, schemaUrl(SCHEMA_FILES.issues))
  const problems = validateLocalConfig(parsedLocal())
  if (problems.length > 0) {
    throw usageError(`the ${update ? '' : 'generated '}${slash(issuesConfig)} is not valid: ${problems.join('; ')}`,
      update ? `Fix ${slash(issuesConfig)} by hand, then run init --update again` : 'Fix the init flags')
  }

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
    data: { dryRun: ctx.dryRun, files, kept, labelsAdded, labelsKept },
    text: [
      ctx.dryRun ? 'files:' : 'wrote:', ...lines,
      ...(kept.length > 0 ? [`members kept as they were: ${kept.join(', ')}`] : []),
      ...(labelsAdded.length > 0 ? [`labels added: ${labelsAdded.join(', ')}`] : []),
      ...(labelsKept.length > 0 ? [`labels kept as they were: ${labelsKept.join(', ')}`] : []),
      ...files.filter((file) => file.diff).flatMap((file) => ['', `${file.path}:`, file.diff.trimEnd()]),
      ...(ctx.dryRun ? ['dry run: nothing was written'] : []),
    ].join('\n'),
  }
}

// link-repo. See docs/superpowers/specs/2026-10-31-pmk-53-link-repo-design.md.
const GIT_READ_TIMEOUT_MS = 10_000
const GIT_READ_MAX_OUTPUT = 1024 * 1024
const BRANCH_NAME = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/
const validBranch = (name) => BRANCH_NAME.test(name) && !name.includes('..') && !name.endsWith('/') && !name.endsWith('.lock')

const readGit = (ctx, args) => spawnSync('git', args, { cwd: ctx.root, env: ctx.env, encoding: 'utf8', timeout: GIT_READ_TIMEOUT_MS, maxBuffer: GIT_READ_MAX_OUTPUT })

// The remotes of the repository as { ok: true, remotes: [{ name, url }] }, or { ok: false, reason } when git cannot say.
// One `git remote -v` call lists every remote with its fetch URL.
function readRemotes(ctx) {
  const listed = readGit(ctx, ['remote', '-v'])
  if (listed.error || listed.status !== 0) {
    return { ok: false, reason: (listed.error?.message ?? listed.stderr ?? '').trim().split('\n')[0] || `git exited with ${listed.status}` }
  }
  const remotes = []
  for (const line of listed.stdout.split('\n')) {
    const found = /^(\S+)\t(.+) \((fetch|push)\)$/.exec(line.trimEnd())
    if (!found) continue
    const [, name, url, kind] = found
    const known = remotes.find((remote) => remote.name === name)
    if (!known) remotes.push({ name, url })
    else if (kind === 'fetch') known.url = url
  }
  return { ok: true, remotes }
}

// The default branch the remote's HEAD names, read from the local refs with no network call, or null when it is not set.
function readDefaultBranch(ctx, remote) {
  const prefix = `refs/remotes/${remote}/`
  const result = readGit(ctx, ['symbolic-ref', '--quiet', `${prefix}HEAD`])
  if (result.error || result.status !== 0) return null
  const ref = result.stdout.trim()
  const name = ref.startsWith(prefix) ? ref.slice(prefix.length) : null
  return name !== null && validBranch(name) ? name : null
}

// The team named by --team, checked against the workspace.
async function linkTeam(ctx, parsed, wanted) {
  const adapter = adapterFor('linear', ctx.adapters)
  const workspace = parsed.tracker.scope?.workspace
  const tracker = await adapter.create({ root: ctx.root, system: 'linear', pmkit: { ...parsed, tracker: { system: 'linear', ...(workspace ? { scope: { workspace } } : {}) }, mappings: undefined } }, { now: ctx.now, env: ctx.env })
  const view = await tracker.discover({ refresh: true })
  const defaults = withLocalDefaults({}).types
  const types = [...defaults, ...Object.keys(parsed.mappings?.types ?? {}).filter((type) => !defaults.includes(type))]
  const description = adapter.describe(view.raw, view, view.auth?.viewer?.id ?? null, types)
  const keys = description.teams.map((team) => team.key)
  if (!keys.includes(wanted)) throw usageError(`--team ${wanted} is not a team of workspace ${description.workspace.urlKey}`, `Pass one of: ${keys.join(', ')}`)
  return description
}

async function runLinkRepo(ctx) {
  const flagHost = ctx.opt('git-host')
  const flagRepo = ctx.opt('repo')
  const flagBranch = ctx.opt('default-branch')
  const wantedRemote = ctx.opt('remote')
  if (flagHost !== undefined && !GIT_HOSTS.includes(flagHost)) throw usageError(`--git-host must be ${GIT_HOSTS.join(' or ')}`)
  if (flagRepo !== undefined && !/^[^/\s]+\/[^/\s]+$/.test(flagRepo)) throw usageError('--repo must be owner/name, like acme/app')
  if (flagBranch !== undefined && !validBranch(flagBranch)) throw usageError(`--default-branch ${flagBranch} is not a branch name`, 'Pass a branch name such as main')

  // An invalid file refuses the dry run and the write alike, so nothing is ever written over it.
  const { pmkit: parsed, system, pmkitProblems } = loadPmkitConfig(ctx.root, { adapters: ctx.adapters })
  if (pmkitProblems.length > 0) throw pmkitWriteRefusal(pmkitProblems)
  const pmkitFile = path.join('.pmkit', 'config.yaml')
  const file = path.join(ctx.root, pmkitFile)
  const before = normalized(fs.readFileSync(file, 'utf8'))
  const hosted = adapterFor(system, ctx.adapters).hosted
  if (!hosted && ctx.opt('team') !== undefined) throw usageError(`the ${system} tracker has no scope, so --team does not apply`, 'Remove --team')

  const notes = []
  const warnings = []
  const read = readRemotes(ctx)
  const remotes = read.ok ? read.remotes : []
  let chosen = { remote: null, state: 'none', notes: [] }
  if (read.ok) {
    chosen = chooseRemote(remotes, wantedRemote)
    if (chosen.state === 'unknown-name') throw usageError(chosen.notes[0], `Pass one of: ${remotes.map((remote) => remote.name).join(', ') || 'no remote exists'}`)
    notes.push(...chosen.notes)
  } else {
    notes.push(`could not read the git remotes (${read.reason}), so the git host was not inferred`)
  }
  const inferred = chosen.remote ? inferHost(chosen.remote.url) : { system: null, repo: null, host: null }
  if (read.ok && chosen.state === 'none') notes.push('there is no git remote, so the git host was not inferred; pass --git-host github or none')
  // An inference never lowers a configured host. Only --git-host none does.
  if (chosen.remote && inferred.system === null && flagHost === undefined) {
    notes.push(inferred.host === null
      ? `the URL of remote ${chosen.remote.name} is not recognized (${chosen.remote.url}), so git_host was not changed`
      : `remote ${chosen.remote.name} points to ${inferred.host}, which is not recognized as GitHub, so git_host was not changed; pass --git-host github if it is GitHub (Enterprise or an SSH alias), or --git-host none to lower it`)
  }

  const held = { system: parsed.git_host.system, repo: parsed.git_host.repo ?? null, branch: parsed.git_host.default_branch ?? null }
  const hostAfter = flagHost ?? (inferred.system === 'github' ? 'github' : held.system)
  const hostSource = flagHost !== undefined ? 'flag' : inferred.system === 'github' ? 'remote' : 'file'
  if (flagRepo !== undefined && hostAfter === 'none') throw usageError('--repo needs the git host github', 'Pass --git-host github, or remove --repo')
  if (flagBranch !== undefined && hostAfter === 'none') throw usageError('--default-branch needs the git host github', 'Pass --git-host github, or remove --default-branch')
  let repoAfter = held.repo
  let repoSource = 'file'
  if (flagHost === 'none') {
    repoAfter = null
    repoSource = 'flag'
  } else if (flagRepo !== undefined) {
    repoAfter = flagRepo
    repoSource = 'flag'
  } else if (inferred.system === 'github') {
    repoAfter = inferred.repo
    repoSource = 'remote'
  }
  let branchAfter = held.branch
  let branchSource = 'file'
  const inferredBranch = inferred.system === 'github' ? readDefaultBranch(ctx, chosen.remote.name) : null
  if (flagBranch !== undefined) {
    branchAfter = flagBranch
    branchSource = 'flag'
  } else if (inferredBranch !== null && hostAfter === 'github') {
    branchAfter = inferredBranch
    branchSource = 'remote'
  }
  // A new repo with the old branch name may point at the wrong branch, so the value is kept and the note says it may be wrong.
  if (branchSource === 'file' && held.branch !== null && held.repo !== null && repoAfter !== held.repo) {
    notes.push(`the repo changed from ${held.repo} to ${repoAfter ?? 'none'} and the default branch could not be inferred, so default_branch ${held.branch} may be wrong; pass --default-branch <name>, or run git remote set-head <remote> --auto and run this again`)
  }
  if (chosen.remote && flagHost !== undefined) {
    if (inferred.system !== null && inferred.system !== flagHost) {
      warnings.push(`remote ${chosen.remote.name} points to ${inferred.host}, which is GitHub, and --git-host ${flagHost} was used as given`)
    } else if (inferred.system === null && inferred.host !== null && flagHost === 'github') {
      warnings.push(`remote ${chosen.remote.name} points to ${inferred.host}, which is not recognized as GitHub, and --git-host github was used as given`)
    }
  }
  if (flagRepo !== undefined && inferred.repo !== null && inferred.repo !== flagRepo) {
    warnings.push(`remote ${chosen.remote.name} points to ${inferred.repo} and --repo ${flagRepo} was used as given`)
  }

  // The team. Linear is called only for --team, so a host change needs no key, no network and no team.
  const heldTeam = parsed.tracker.scope?.team ?? null
  const wantedTeam = ctx.opt('team')
  let scope = null
  let broken = []
  if (hosted) {
    scope = { team: { before: heldTeam, after: heldTeam, source: 'file', verified: false } }
    if (wantedTeam !== undefined) {
      const description = await linkTeam(ctx, parsed, wantedTeam)
      scope = { team: { before: heldTeam, after: wantedTeam, source: 'flag', verified: true } }
      broken = brokenMappings(description, { tracker: { scope: { team: wantedTeam } }, mappings: parsed.mappings })
    } else if (heldTeam === null) {
      notes.push('tracker.scope.team is not set; pass --team KEY or run /pmkit:setup')
    }
  }

  const edit = (key, change) => {
    try {
      return change()
    } catch (error) {
      throw new PmkitError('INVALID_INPUT', `cannot set ${key} in ${slash(pmkitFile)}: ${error.message}`, `Edit ${key} in ${slash(pmkitFile)} by hand, then run link-repo again`)
    }
  }
  let text = before
  if (hostAfter !== held.system) text = edit('git_host.system', () => setScalar(text, ['git_host', 'system'], hostAfter))
  if (repoAfter === null && held.repo !== null) text = edit('git_host.repo', () => removeKey(text, ['git_host', 'repo']))
  else if (repoAfter !== null && repoAfter !== held.repo) text = edit('git_host.repo', () => setScalar(text, ['git_host', 'repo'], repoAfter))
  if (branchAfter !== held.branch) text = edit('git_host.default_branch', () => setScalar(text, ['git_host', 'default_branch'], branchAfter))
  const teamChanged = scope !== null && scope.team.after !== heldTeam
  if (teamChanged) text = edit('tracker.scope.team', () => setScalar(text, ['tracker', 'scope', 'team'], scope.team.after))
  if (text !== before) {
    let problems
    try {
      problems = pmkitConfigMessages(parseYaml(text), ctx.adapters)
    } catch (error) {
      problems = [`config.yaml does not parse: ${error.message}`]
    }
    if (problems.length > 0) throw usageError(`the new .pmkit/config.yaml would not be valid: ${problems.join('; ')}`, 'Fix the values you passed')
  }

  if (!ctx.dryRun && teamChanged && broken.length > 0) {
    throw new PmkitError('NOT_CONFIGURED', `team ${scope.team.after} does not fit the mappings in .pmkit/config.yaml: ${broken.map((item) => item.problem).join('; ')}`, '/pmkit:setup', { mappings: broken })
  }
  const changed = text !== before
  const entry = changed ? { path: slash(pmkitFile), action: 'change', diff: lineDiff(before, text) } : { path: slash(pmkitFile), action: 'keep' }
  if (!ctx.dryRun && changed) fs.writeFileSync(file, text)

  const remote = chosen.remote ? { name: chosen.remote.name, url: chosen.remote.url, host: inferred.host } : null
  const data = {
    dryRun: ctx.dryRun,
    tracker: system,
    remote,
    remotes: remotes.map(({ name, url }) => ({ name, url, host: inferHost(url).host })),
    gitHost: { before: held.system, after: hostAfter, source: hostSource },
    repo: { before: held.repo, after: repoAfter, source: repoSource },
    defaultBranch: { before: held.branch, after: branchAfter, source: branchSource },
    scope,
    broken,
    notes,
    warnings,
    files: [entry],
  }
  const origin = (source) => (source === 'remote' ? ` (from remote ${remote.name})` : source === 'flag' ? ' (from the flag)' : '')
  const show = (label, item) => `${label}: ${item.before ?? '(none)'}${item.before === item.after ? ' (unchanged)' : ` -> ${item.after ?? '(none)'}`}${origin(item.source)}`
  const lines = [
    show('git host', data.gitHost),
    show('repo', data.repo),
    show('default branch', data.defaultBranch),
    ...(scope ? [show('team', scope.team) + (scope.team.verified ? '' : ' (not checked against the workspace)')] : []),
    ...(broken.length > 0 ? ['broken by the new team:', ...broken.map((item) => `  ${item.problem}`)] : []),
    ...warnings.map((warning) => `warning: ${warning}`),
    ...notes.map((note) => `note: ${note}`),
    changed ? (ctx.dryRun ? 'files:' : 'wrote:') : 'already linked, nothing to change',
    ...(changed ? [`  ${entry.path}: ${ctx.dryRun ? 'would ' : ''}change`, '', entry.diff.trimEnd()] : []),
    ...(ctx.dryRun ? ['dry run: nothing was written'] : []),
  ]
  return { data, text: lines.join('\n'), warnings, notes }
}

// The hosted branch of init: infers what it can from the workspace, returns what it must ask, and writes only .pmkit/config.yaml.
// See docs/superpowers/specs/2026-10-27-pmk-34-ask-for-mappings-design.md, "The init call for Linear".
const sameEntries = (a, b) => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort())

async function runInitLinear(ctx) {
  const { opt } = ctx
  const update = ctx.flag('update')
  for (const flag of LOCAL_ONLY_FLAGS) {
    if (opt(flag) !== undefined || ctx.list(flag).length > 0) throw usageError(`Linear sets --${flag} itself`, `Remove --${flag}`)
  }
  const host = opt('git-host')
  if (host !== undefined && !GIT_HOSTS.includes(host)) throw usageError(`--git-host must be ${GIT_HOSTS.join(' or ')}`)
  const adapter = adapterFor('linear', ctx.adapters)

  const root = ctx.root
  const pmkitFile = path.join('.pmkit', 'config.yaml')
  const file = path.join(root, pmkitFile)
  let before = null
  let text
  if (update) {
    if (!fs.existsSync(file)) throw usageError('.pmkit/config.yaml does not exist, so there is no setup to update', 'Run init without --update')
    before = normalized(fs.readFileSync(file, 'utf8'))
    text = before
  } else {
    if (fs.existsSync(file)) throw new PmkitError('CONFLICT', `${slash(pmkitFile)} already exists`, 'Edit it, or delete it to start over')
    const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' })
    const repo = remote.status === 0 ? /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?\s*$/.exec(remote.stdout)?.[1] : undefined
    text = fs.readFileSync(path.join(TEMPLATES, 'pmkit.config.yaml'), 'utf8')
      .replace(/tracker:\n {2}system: .*\n {2}path: .*\n/, 'tracker:\n  system: linear\n')
      .replace(/git_host:\n {2}system: .*\n {2}repo: .*\n {2}default_branch: .*\n/, `git_host:\n  system: ${host ?? 'none'}\n${repo ? `  repo: ${repo}\n` : ''}`)
  }
  const edit = (key, change) => {
    try {
      return change()
    } catch (error) {
      if (isPmkitError(error)) throw error
      throw new PmkitError('INVALID_INPUT', `cannot set ${key} in ${slash(pmkitFile)}: ${error.message}`, `Edit ${key} in ${slash(pmkitFile)} by hand, then run init --update again`)
    }
  }
  if (update && host !== undefined) text = edit('git_host.system', () => setScalar(text, ['git_host', 'system'], host))
  let draft
  try {
    draft = parseYaml(text)
  } catch (error) {
    throw new PmkitError('INVALID_INPUT', `.pmkit/config.yaml is not valid YAML: ${error.message}`, 'Fix the file, then run init --update again')
  }
  const current = {
    scope: draft?.tracker?.scope ?? {},
    status: draft?.mappings?.status ?? {},
    fields: draft?.mappings?.fields ?? {},
    types: draft?.mappings?.types,
  }

  // Only the workspace pins the key. The team and the mappings are what this call decides, so the discovery ignores them.
  const workspace = opt('workspace') ?? current.scope.workspace
  const discoveryConfig = {
    root,
    system: 'linear',
    pmkit: { ...draft, tracker: { system: 'linear', ...(workspace ? { scope: { workspace } } : {}) }, mappings: undefined },
  }
  const tracker = await adapter.create(discoveryConfig, { now: ctx.now, env: ctx.env })
  const view = await tracker.discover({ refresh: true })
  // A type the file maps by hand joins the list, so a label of it that broke gets the label candidates.
  const defaults = withLocalDefaults({}).types
  const types = [...defaults, ...Object.keys(current.types ?? {}).filter((type) => !defaults.includes(type))]
  const description = adapter.describe(view.raw, view, view.auth?.viewer?.id ?? null, types)
  const flags = parseMappingFlags(ctx)
  const proposal = proposeMappings(description, current, { workspace: opt('workspace'), team: opt('team'), ...flags })
  const { values } = proposal

  // The file: only the lines that differ from what it holds.
  const put = (keys, value, held) => {
    if (value !== undefined && value !== held) text = edit(keys.join('.'), () => setScalar(text, keys, value))
  }
  put(['tracker', 'scope', 'workspace'], values.scope.workspace, current.scope.workspace)
  put(['tracker', 'scope', 'team'], values.scope.team, current.scope.team)
  for (const [key, value] of Object.entries(values.status)) put(['mappings', 'status', key], value, current.status[key])
  for (const [key, value] of Object.entries(values.fields)) put(['mappings', 'fields', key], value, current.fields[key])
  if (values.types !== undefined && (current.types === undefined || !sameEntries(values.types, current.types))) {
    text = edit('mappings.types', () => setMap(text, ['mappings', 'types'], values.types))
  }
  text = setSchemaLine(text, schemaUrl(SCHEMA_FILES.pmkit))
  const refusal = pmkitConfigRefusal(text, { update })
  if (refusal) throw refusal
  const problems = adapter.configProblems(parseYaml(text))
  if (problems.length > 0) {
    throw usageError(`the ${update ? '' : 'generated '}.pmkit/config.yaml is not valid: ${problems.join('; ')}`,
      update ? 'Fix .pmkit/config.yaml by hand, then run init --update again' : 'Fix the init flags')
  }

  if (!ctx.dryRun && proposal.questions.length > 0) {
    throw new PmkitError('INVALID_INPUT', `setup has unanswered questions: ${proposal.questions.map((q) => q.path).join(', ')}`, '/pmkit:setup')
  }
  const entry = before === null
    ? { path: slash(pmkitFile), action: 'create' }
    : before === text ? { path: slash(pmkitFile), action: 'keep' } : { path: slash(pmkitFile), action: 'change', diff: lineDiff(before, text) }
  if (!ctx.dryRun && (entry.action === 'create' || entry.action === 'change')) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }

  // The team's statuses as the answers leave them: a state a status mapping names takes that category.
  const team = description.teams.find((item) => item.key === proposal.team)
  const named = new Map(Object.entries(values.status).filter(([key, value]) => key !== 'blocked' && value !== 'none').map(([key, value]) => [value, key]))
  const statuses = (team?.statuses ?? []).map(({ name, category, type }) => ({ name, category: named.get(name) ?? category, type }))
  const viewer = view.auth?.viewer ? { id: view.auth.viewer.id, name: view.auth.viewer.name } : null
  const data = {
    dryRun: ctx.dryRun,
    tracker: 'linear',
    workspace: proposal.workspace,
    viewer,
    team: proposal.team,
    applied: proposal.applied,
    questions: proposal.questions,
    broken: proposal.broken,
    statuses,
    notes: proposal.notes,
    files: [entry],
  }
  const lines = [
    `workspace: ${proposal.workspace.name} (${proposal.workspace.urlKey}), plan ${proposal.workspace.plan}${viewer ? `, viewer ${viewer.name}` : ''}`,
    `team: ${proposal.team ?? '(not chosen yet)'}`,
    ...(proposal.applied.length > 0 ? ['applied:', ...proposal.applied.map((item) => `  ${item.path} = ${item.value} (${item.reason})`)] : []),
    ...(proposal.broken.length > 0 ? ['broken:', ...proposal.broken.map((item) => `  ${item.problem}`)] : []),
    ...(proposal.questions.length > 0
      ? ['questions:', ...proposal.questions.map((q) => `  ${q.path}  ${q.flag}  one of: ${[...q.candidates, 'none'].join(', ')}${q.recommended ? `  (recommended: ${q.recommended})` : ''}`)]
      : []),
    ...(statuses.length > 0 ? ['statuses:', ...statuses.map((item) => `  ${item.name}  ${item.category}`)] : []),
    ...proposal.notes.map((note) => `note: ${note}`),
    ctx.dryRun ? 'files:' : 'wrote:',
    `  ${entry.path}: ${ctx.dryRun && entry.action !== 'keep' ? 'would ' : ''}${entry.action}`,
    ...(entry.diff ? ['', `${entry.path}:`, entry.diff.trimEnd()] : []),
    ...(ctx.dryRun ? ['dry run: nothing was written'] : []),
  ]
  return { data, text: lines.join('\n') }
}

/** Commits exactly `paths` (root-relative, `/` separators). Nothing staged for them means no commit. */
function commitTracker(config, message, paths) {
  const folder = (config.pmkit.tracker.path ?? '.issues').split(path.sep).join('/')
  // --literal-pathspecs keeps a name such as notes/[x].md from matching as a glob.
  const git = (...args) => spawnSync('git', ['--literal-pathspecs', ...args], { cwd: config.root, encoding: 'utf8' })
  const named = paths.length <= 5 ? paths.join(' ') : folder
  const fail = (result) => new PmkitError('UPSTREAM', `the write succeeded but auto_commit failed: ${(result.stderr || result.stdout).trim()}`, `Commit ${named} yourself`)
  const added = git('add', '--', ...paths)
  if (added.status !== 0) throw fail(added)
  if (git('diff', '--cached', '--quiet', '--', ...paths).status === 0) return
  const committed = git('commit', '-m', message, '--', ...paths)
  if (committed.status !== 0) throw fail(committed)
}

/** How a call treats .pmkit/config.yaml: exempt skips the check, read warns, write refuses. `options` is `parseArgs(argv).options`. */
export function configClass(command, options) {
  if (command.exempt) return 'exempt'
  if (!command.write) return 'read'
  if (command.readUnless === undefined || command.readUnless.some((name) => options[name] !== undefined)) return 'write'
  return 'read'
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

/** Runs one command line. Resolves to the text for each stream and the exit code. */
export async function run(argv, { env = process.env, cwd = process.cwd(), adapters = ADAPTERS } = {}) {
  const stdout = []
  const stderr = []
  let code = 0
  // Until the arguments parse, a bare --json or --json=true still asks for a JSON error.
  let json = argv.includes('--json') || argv.includes('--json=true')
  // Seen by the catch: a read with problems in .pmkit/config.yaml prints the warning before its error.
  let loaded
  let kind
  const readWarning = () => {
    if (kind === 'read' && loaded?.pmkitProblems.length > 0) stderr.push(`warning: ${pmkitConfigWarning(loaded.pmkitProblems)}\n`)
  }
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
    let tracker
    let pending
    let host
    const ctx = {
      root, cwd, env, dryRun, now, args: parsed.positionals, json, adapters,
      opt: (name) => last(options[name]),
      list: (name) => (options[name] === undefined ? [] : [options[name]].flat()),
      flag: (name) => last(options[name]) === true,
      config: () => (loaded ??= loadConfig(root, { adapters })),
      // Created once per run through the registry. Commands get the contract view; the raw tracker is kept for ctx.local and auto-commit.
      tracker: () => (pending ??= (async () => {
        const config = ctx.config()
        tracker = await adapterFor(config.system, adapters).create(config, { now, random, env, dryRun })
        return contractView(tracker)
      })()),
      // The raw Local tracker, for the features only it has, or null for any other system.
      local: async () => {
        if (ctx.config().system !== 'local') return null
        await ctx.tracker()
        return tracker
      },
      // The Linear-only features of the raw Linear tracker, or null for any other system.
      linear: async (feature) => {
        if (ctx.config().system !== 'linear') return null
        await ctx.tracker()
        return tracker[feature]
      },
      settings: () => adapterFor(ctx.config().system, adapters).settings(ctx.config()),
      host: () => (host ??= makeHost(ctx)),
      actor: async () => (typeof options.as === 'string' ? options.as : (await requireMember(ctx)).id),
    }
    kind = configClass(command, options)
    // Read before the full config: migrate reads a tracker of any format, which ctx.config() would refuse first.
    if (command.local) {
      const { system } = loadPmkitConfig(root, { adapters })
      if (system !== 'local') throw new PmkitError('NOT_SUPPORTED', `${command.name} works only with the Local tracker, and tracker.system is "${system}"`, 'node scripts/pmkit.mjs --help')
    }
    if (command.systems) {
      const { system } = loadPmkitConfig(root, { adapters })
      if (!command.systems.includes(system)) throw new PmkitError('NOT_SUPPORTED', `\`${command.name}\` works only with the Local or Linear tracker, and tracker.system is "${system}"`, 'node scripts/pmkit.mjs --help')
    }
    // migrate refuses in runMigrate: ctx.config() checks the format, which would hide migrate's own format errors.
    if (kind === 'write' && command.name !== 'migrate') {
      const { pmkitProblems } = ctx.config()
      if (pmkitProblems.length > 0) throw pmkitWriteRefusal(pmkitProblems)
    }
    if (command.linear) {
      const { system } = ctx.config()
      if (system !== 'linear') throw new PmkitError('NOT_SUPPORTED', `\`${command.name}\` works only with the Linear tracker, and tracker.system is "${system}"`, 'node scripts/pmkit.mjs --help')
    }
    const result = await command.run(ctx)
    // auto_commit commits Local tracker files, so a hosted tracker never commits.
    if (command.write && !dryRun && result.commit !== undefined && ctx.config().system === 'local' && ctx.config().local.auto_commit === true) {
      // Only the files this command wrote; a write that changed nothing commits nothing.
      const paths = tracker?.writtenFiles() ?? []
      try {
        if (paths.length > 0) commitTracker(ctx.config(), `pmkit: ${command.name} ${result.commit}`, paths)
      } catch (error) {
        // The write succeeded; the caller still gets what was written, in the same single output.
        error.written = { data: result.data, text: result.text }
        throw error
      }
    }
    stdout.push(json ? `${JSON.stringify(result.data, null, 2)}\n` : `${result.text}\n`)
    readWarning()
    for (const warning of result.warnings ?? []) stderr.push(`warning: ${warning}\n`)
    for (const note of result.notes ?? []) stderr.push(`note: ${note}\n`)
  } catch (error) {
    code = 2
    readWarning()
    if (isPmkitError(error)) {
      if (json) {
        const body = { error: { code: error.code, message: error.message, nextStep: error.nextStep } }
        // The details that reach the output: the mappings a hosted tracker found broken, and the problems a migration plan found.
        if (Array.isArray(error.details?.mappings)) body.error.mappings = error.details.mappings
        if (Array.isArray(error.details?.problems)) body.error.problems = error.details.problems
        // The records that block a delete, so an agent reading the JSON sees the same list as the message.
        if (Array.isArray(error.details?.references)) body.error.references = error.details.references
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
  const result = await run(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exitCode = result.code
}
