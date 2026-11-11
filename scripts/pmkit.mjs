#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { BOOLEANS, parseArgs } from './lib/args.mjs'
import { gitUserEmail, resolveActor } from './lib/actor.mjs'
import { ADAPTERS, adapterFor } from './lib/adapters.mjs'
import { ESTIMATE_UNITS, GIT_HOSTS, findRoot, loadConfig, loadPmkitConfig, pmkitConfigMessages, pmkitConfigWarning, pmkitWriteRefusal, resolveDefaultBranch, validBranch, validateLocalConfig, validatePmkitConfig, withLocalDefaults } from './lib/config.mjs'
import { contractView } from './lib/contract.mjs'
import { longEntryNote, parseMinutes } from './lib/duration.mjs'
import { PmkitError, isPmkitError } from './lib/errors.mjs'
import { changeLines, customerRecord, dependencyText, epicRecord, eventTable, fields, goalRecord, issueRecord, issueTable, milestoneRecord, percent, readinessText, releaseNotesText, releaseRecord, requestRecord, sprintRecord, table } from './lib/format.mjs'
import {
  aging, categoryLookup, cycleTimes, doneInRange, groupEventsByIssue, lastEntry, leadTimes, rangeInstant, sprintIssues, summary, throughput, velocity,
} from './lib/metrics.mjs'
import { buildNotes, chooseBasis } from './lib/release-notes.mjs'
import { buildReadiness, chooseReadinessBasis } from './lib/release-readiness.mjs'
import { dependencyMap, serializable } from './lib/dependencies.mjs'
import { buildRoadmapReview, roadmapReviewText } from './lib/roadmap-review.mjs'
import { blockedIssues, epicRisks, epicsUpdatesNotChecked, failingPullRequests, failingWorkflows, FAILED_RUN, needsPrLookup, NO_HOST, prsByBranch, risksText, stalledIssues, stalledPullRequests } from './lib/risks.mjs'
import { pathNote } from './lib/path-notes.mjs'
import { fileMentions } from './lib/mentions.mjs'
import { REPO_UNCHECKED } from './lib/delete-refusal.mjs'
import { ADR_STATUSES, adrFiles, adrFolders, adrLocation, adrText, planNextAdr, setAdrStatus } from './lib/adr.mjs'
import { similarResult } from './lib/similar.mjs'
import { isBlocked } from './lib/model.mjs'
import { chooseUnit, noMoveMessage, proposeMoves, teamLoad } from './lib/team-load.mjs'
import { changeList, checkMembers, mergeDaysOff, parseCapacityPairs, recomputeCapacity, teamMembers, workingDays } from './lib/team-capacity.mjs'
import { AGENT_ID, localRunLine, nativeRunLine } from './lib/delegation.mjs'
import { agentFilter, authorAgent, blockedText, delegationOf, prSummary, prText } from './lib/track-agents.mjs'
import { SCANNERS, SEVERITIES, alertCandidate, collectAlerts, matchAlerts, readReport } from './lib/alerts.mjs'
import { READ_LIMIT, groupTodos, matchTodos, readExistingIssues, scanRepo } from './lib/todos.mjs'
import { validateRepo } from './lib/validate.mjs'
import { FrontmatterError, parseYaml } from './lib/yaml.mjs'
import { addMapEntry, removeKey, setMap, setScalar, setSchemaLine } from './lib/yaml-edit.mjs'
import { brokenMappings, parseMappingFlags, proposeMappings } from './lib/mappings.mjs'
import { chooseRemote, inferHost, parseRemoteUrl } from './lib/git-remote.mjs'
import { SCHEMA_FILES, schemaUrl } from './lib/schema-url.mjs'
import { lineDiff } from './lib/diff.mjs'
import { DEFAULT_MAX, HARD_MAX, buildPreview, bulkText, checkBulkFilter, parseChange, valueError } from './lib/bulk.mjs'
import { blockersText, collectBlockers } from './lib/pr-blockers.mjs'
import { CACHE_DIR, ensureCacheIgnored } from './lib/local/query-index.mjs'
import { writeFileAtomic } from './lib/local/store.mjs'
import { FORMAT_VERSION, MIGRATIONS, applyMigration, formatError, formatState, planMigration } from './lib/local/migrations.mjs'
import { parseChangelog, sectionsSince } from './lib/changelog.mjs'
import { runExport, runImport, runStatus, runSwitch, runUndo } from './lib/migrate/cli.mjs'
import { createGithubHost } from './lib/github/host.mjs'
import { VIEWS_CUT } from './lib/linear/views.mjs'
import { ID_STYLES, branchName, isId, normalizeId } from './lib/ids.mjs'
import { boardDoc, hasMarker, problemsLine, renderDocument, roadmapDoc, sprintDoc } from './lib/render.mjs'
import { boardData, roadmapData, sprintData } from './lib/render-data.mjs'
import { redact } from './lib/redact.mjs'
import { shareDone, topLevelRollup } from './lib/initiatives.mjs'
import { tailLines } from './lib/tail-lines.mjs'
import { rightLines, splitDiff } from './lib/diff-files.mjs'

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
// A pull request read with `detail` keeps it out of the JSON: the review bodies would come back twice.
const withoutDetail = (pr) => (pr ? (({ detail, ...view }) => view)(pr) : pr)
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

/**
 * Why a scan may miss alerts, one phrase per scanner that ran but left part unread: it failed, it did not audit every
 * package (pip-audit skips), or it was detected but not read because `--report` named other scanners.
 */
function scannerGaps(scanners) {
  return scanners.flatMap((scanner) => {
    if (scanner.error !== undefined) return [`${scanner.id} failed (${scanner.error})`]
    if (scanner.incomplete) return [`${scanner.id} did not audit every package`]
    if (scanner.skipped) return [`${scanner.id} was not read because --report was given without it (pass --report ${scanner.id}=<file>)`]
    return []
  })
}

/** The saved scanner reports of `--report <scanner>=<file>`, read up front, as the `reports` map of collectAlerts. `example` is the next step of a bad value. */
function readReports(ctx, example) {
  const reports = new Map()
  for (const value of ctx.list('report')) {
    const text = String(value)
    const at = text.indexOf('=')
    if (at <= 0 || at === text.length - 1) throw usageError(`--report must be <scanner>=<file>, not ${text}`, example)
    const id = text.slice(0, at)
    const file = text.slice(at + 1)
    if (!SCANNERS.some((scanner) => scanner.id === id)) throw usageError(`--report names the unknown scanner "${id}"; use one of ${SCANNERS.map((scanner) => scanner.id).join(', ')}`, example)
    if (reports.has(id)) throw usageError(`--report gives ${id} twice`, 'pass one report per scanner')
    try {
      reports.set(id, { path: file, text: readReport(path.resolve(ctx.cwd, file)) })
    } catch (error) {
      throw usageError(`cannot read ${file}: ${error.message}`, `save the scanner's --json output to ${file} first`)
    }
  }
  return reports
}

/** The inline comments of pr review: a JSON array of { path, line, body }. Every bad entry is named in one error. */
function reviewComments(text) {
  let list
  try { list = JSON.parse(text) } catch {}
  if (!Array.isArray(list)) throw usageError('the comments file is not a JSON array', 'Write a JSON array of { "path", "line", "body" } to the comments file')
  const bad = list.map((c, i) => (c && typeof c.path === 'string' && c.path !== '' && Number.isInteger(c.line) && c.line > 0 && typeof c.body === 'string' && c.body.trim() !== '' ? null : `comment ${i + 1} needs a path, a line number above 0 and a body`)).filter(Boolean)
  if (bad.length > 0) throw usageError(bad.join('; '), 'Write a JSON array of { "path", "line", "body" } to the comments file')
  return list.map(({ path: file, line, body }) => ({ path: file, line, body }))
}

function readInput(source) {
  try {
    return fs.readFileSync(source === '-' ? 0 : source, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  } catch (error) {
    throw new PmkitError('INVALID_INPUT', `cannot read ${source === '-' ? 'stdin' : source}: ${error.message}`, 'Pass a readable file, or - for stdin')
  }
}

/**
 * A one-line text (a title, a name) from `--<key>` or from the file of `--<key>-file`. A text read from a file never passes
 * through the shell, so a backtick or $( in it stays text. The two flags are exclusive, and the file holds one line, not empty.
 * Returns undefined when neither flag is given.
 */
function lineFromFlag(opt, key) {
  const file = opt(`${key}-file`)
  if (file === undefined) return opt(key)
  if (opt(key) !== undefined) throw usageError(`--${key} and --${key}-file are exclusive`, 'pass one of them')
  const text = readInput(file).replace(/\n+$/, '')
  if (text.trim() === '') throw usageError(`${file} has no ${key}`, `write the ${key} on the first line`)
  if (text.includes('\n')) throw usageError(`${file} has more than one line`, `a ${key} is one line`)
  return text
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
const quoteValue = (value) => (/[\s=",]/.test(String(value)) ? JSON.stringify(String(value)) : String(value))
const filterText = (filter) => Object.entries(filter).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}=${[value].flat().map(quoteValue).join(',')}`).join(' ')

/** The filter line of a stored view, or what made its file unreadable. */
const storedViewText = (view) => (view.unreadable === undefined ? `filter: ${filterText(view.filter)}` : `a file that could not be read (${view.unreadable})`)

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
  set('title', create ? lineFromFlag(opt, 'title') : opt('title'))
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

/** --add-doc and --remove-doc as the whole new docs list, so the caller never merges lists. Adding a path already there or removing an absent one changes nothing. */
async function docLinks(ctx, id, patch) {
  // A flag given with no value comes back as true, alone or inside a repeated list.
  const paths = (name) => ctx.list(name).map((item) => {
    if (typeof item !== 'string' || item.trim() === '') throw usageError(`--${name} needs a path`, `Pass the path of the document, such as --${name} docs/adr/0001-use-points.md`)
    return item.trim()
  })
  const adds = paths('add-doc')
  const removes = paths('remove-doc')
  if (adds.length === 0 && removes.length === 0) return
  const tracker = await ctx.tracker()
  // The manifest says before the issue is read when the tracker has no docs field (Linear), so nothing else is asked of it.
  const documents = (await tracker.capabilities()).capabilities.find((c) => c.id === 'documents')
  if (documents?.detail?.unsupported?.includes('issueDocs')) throw new PmkitError('NOT_SUPPORTED', 'Linear issues have no docs field', 'The comment on the issue stays the link to the document')
  const current = (await tracker.getIssue(id)).docs ?? []
  const kept = current.filter((item) => !removes.includes(item))
  patch.docs = [...kept, ...adds.filter((item) => !kept.includes(item))]
}

const originHeads = new WeakMap()
/** The branch origin/HEAD points to, without origin/, or null when git cannot say. Read once per run (PMK-228). */
function originHead(ctx) {
  if (!originHeads.has(ctx)) {
    // The full ref, not --short: a local branch named origin/<name> makes --short print remotes/origin/<name>.
    const prefix = 'refs/remotes/origin/'
    const result = readGit(ctx, ['symbolic-ref', '--quiet', `${prefix}HEAD`])
    const ref = !result.error && result.status === 0 ? result.stdout.trim() : ''
    originHeads.set(ctx, ref.startsWith(prefix) ? ref.slice(prefix.length) : null)
  }
  return originHeads.get(ctx)
}

const adrPlace = (ctx) => adrLocation({ root: ctx.root, issuesDir: ctx.config().issuesDir, hosted: ctx.config().hosted })

/** The one ADR file with `number` (1 to 4 digits). NOT_FOUND when none has it, CONFLICT when several do. */
function adrByNumber(files, number, flag) {
  if (!/^\d{1,4}$/.test(number)) throw new PmkitError('INVALID_INPUT', `${flag} "${number}" is not an ADR number`, 'Pass the number of the ADR, such as 3 or 0003')
  const padded = number.padStart(4, '0')
  const found = files.filter((file) => file.number === padded)
  if (found.length === 0) throw new PmkitError('NOT_FOUND', `no ADR has the number ${padded}`, 'Check the number in docs/adr/; pmkit docs next-adr names the folders it reads')
  if (found.length > 1) throw new PmkitError('CONFLICT', `ADR number ${padded} is used by ${found.map((file) => file.path).join(' and ')}`, 'Rename one of them to the number docs next-adr gives; pmkit validate lists every repeated number')
  return found[0]
}

/** docs adr-status (PMK-228): the Status line of one ADR, in the repository folder or the Local tracker's. */
async function runAdrStatus(ctx) {
  const [number, status] = ctx.args
  if (!ADR_STATUSES.includes(status)) throw usageError(`status "${status}" is not one of ${ADR_STATUSES.join(', ')}`, 'Pass accepted, deprecated, or superseded --by <number>')
  const by = ctx.opt('by')
  if (status === 'superseded' && by === undefined) throw usageError('superseded needs --by with the number of the newer ADR', 'Pass --by <number>, such as --by 7')
  if (status !== 'superseded' && by !== undefined) throw usageError('--by goes only with superseded', `Leave --by out for ${status}`)
  const { trackerDir, trackerFolder } = adrPlace(ctx)
  const folders = adrFolders({ root: ctx.root, trackerDir, trackerFolder })
  const files = adrFiles(folders)
  const adr = adrByNumber(files, number, 'number')
  const notes = []
  let byPath
  if (by !== undefined) {
    const newer = adrByNumber(files, by, '--by')
    if (newer.number === adr.number) throw usageError(`ADR ${adr.number} cannot supersede itself`, 'Pass the number of the newer ADR in --by')
    // A permanent record: say so when the arguments look swapped, but the user may supersede with an older ADR on purpose.
    if (newer.number < adr.number) notes.push(`ADR ${newer.number} is older than ADR ${adr.number}; check that --by names the decision that replaces it`)
    // The text of the ADR cites the path without the display label tracker: (PMK-247).
    byPath = newer.ref
  }
  const before = adrText(fs.readFileSync(adr.file, 'utf8'))
  const { text: after, before: statusBefore, after: line } = setAdrStatus(before, status, byPath)
  let commit
  if (before !== after && !ctx.dryRun) {
    if (adr.place === 'tracker') {
      await (await ctx.tracker()).updateDocument(`adr/${adr.name}`, after, await ctx.actor())
      commit = adr.path
    } else {
      writeFileAtomic(adr.file, after)
      notes.push(`${adr.path} is a repository file and has no commit yet; commit it with the work it belongs to`)
    }
  }
  const data = { number: adr.number, path: adr.path, place: adr.place, status: { before: statusBefore, after: line }, before, after, notes }
  const verb = before === after ? 'unchanged' : ctx.dryRun ? 'would set' : 'set'
  const text = [`${verb} ${adr.path}: ${statusBefore ?? '(no status)'} -> ${line}`, ...(ctx.dryRun ? ['dry run: nothing was written'] : [])].join('\n')
  return { data, text, notes, commit }
}

/** The id of the active sprint, NOT_FOUND with the next step when none is active. */
async function activeSprintId(tracker) {
  const sprint = await tracker.currentCycle()
  if (sprint === null) throw new PmkitError('NOT_FOUND', 'no sprint is active', 'pmkit cycle list shows the sprints to name by id; /pmkit:cycle:plan opens one on a tracker that can (Linear creates cycles from the team schedule)')
  return sprint.id
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

const REPO_MENTIONS_TIMEOUT_MS = 30_000
const REPO_MENTIONS_TEXT = 10

/**
 * The files of the repository that cite `id` (PMK-222): one `git grep` over the tracked and untracked files that are not ignored, minus
 * the issue folders of the tracker (the delete reads their texts itself), filtered by the mention rule. The tracker's docs, epics and
 * sprints are scanned. `--no-color` keeps the user's color settings out of the output. A failed run or an output that does not parse
 * is `{ files: [], error }`, never "no file cites it".
 */
function repoMentions(ctx, id) {
  const { issuesDir } = ctx.config()
  const relative = issuesDir ? path.relative(ctx.root, path.join(issuesDir, 'issues')) : ''
  const skip = relative !== '' && !climbsOut(relative) ? [`:(exclude,literal)${slash(relative)}`] : []
  const result = spawnSync('git', ['grep', '--no-color', '-z', '-n', '-I', '-F', '--untracked', '-e', id, '--', '.', ...skip], {
    cwd: ctx.root, env: ctx.env, encoding: 'utf8', timeout: REPO_MENTIONS_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024,
  })
  if (result.status === 0) {
    try {
      return { files: fileMentions(id, result.stdout), error: null }
    } catch (error) {
      return { files: [], error: error.message }
    }
  }
  if (result.status === 1 && !result.error) return { files: [], error: null }
  return { files: [], error: grepFailure(result) }
}

/** Why the scan failed, in pmkit's words where the cause is known: git's own text changes with its version and setup. */
function grepFailure(result) {
  if (result.error?.code === 'ENOENT') return 'git is not installed'
  if (result.error?.code === 'ETIMEDOUT') return `it took longer than ${REPO_MENTIONS_TIMEOUT_MS / 1000} s`
  if (result.error) return result.error.message
  if (result.status === 128 && /not a git repository/i.test(result.stderr)) return 'not a git repository'
  return result.stderr.trim().split(/\r?\n/)[0] || `exit status ${result.status}`
}

/** Text of an issue delete: the full record, what goes, the warnings, and the way to keep the issue instead. A dry run is the preview. */
function deleteText({ before, removes, warnings, mentions, files = [], unchecked }, { dryRun }) {
  const lines = [`${dryRun ? 'would delete' : 'deleted'} ${before.id}  ${before.title}`, issueRecord(before), '']
  if (removes.trash) {
    lines.push(`removes: the issue moves to Linear's trash, where the workspace can restore it for a while: pmkit issues restore ${before.id}`)
  } else {
    lines.push('removes:', ...removes.files.map((file) => `  ${file}`))
    const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
    const recovery = removes.autoCommit ? 'Only git history can bring them back.' : 'Nothing commits this delete (auto_commit is off), so git can bring them back only if you committed them before.'
    lines.push(`${count(removes.events, 'event')} and ${count(removes.comments, 'comment')} go with it. ${recovery}`)
  }
  lines.push('references: no other issue lists it as blocked by, related, duplicate of or parent')
  if (warnings.length > 0) lines.push('warnings:', ...warnings.map((warning) => `  ${warning}`))
  if (mentions.length > 0) lines.push(`mentioned in the text of: ${mentions.map((mention) => `${mention.id} (${mention.in})`).join(', ')}. The text stays as it is.`)
  if (files.length > 0) {
    lines.push('cited in these files of the repository, which stay as they are:', ...files.slice(0, REPO_MENTIONS_TEXT).map((file) => `  ${file.path}:${file.lines.join(',')}`))
    if (files.length > REPO_MENTIONS_TEXT) lines.push(`  ${files.length - REPO_MENTIONS_TEXT} more files in --json`)
  }
  if (unchecked.length > 0) lines.push(`not checked: ${unchecked.join(', ')}`)
  lines.push(`archive instead: pmkit issues archive ${before.id} keeps the record and its history and hides the issue from lists. Delete removes them.`)
  if (dryRun) lines.push('dry run: nothing was written')
  return lines.join('\n')
}

/** A comment as text. The thread lines appear only for a reply and for a resolved root. */
const commentText = (c) =>
  `${c.created} ${c.author}${c.parent === undefined ? '' : ` (reply to ${c.parent})`}\n${c.body}${c.resolved === undefined ? '' : `\nresolved ${c.resolved.at} by ${c.resolved.by}`}`

/**
 * `issues link --remove` with several targets (PMK-222): one unlink after another, each as the single-target call does. A failure stops
 * the run as `issues bulk` does: what ran stays written, the error lists applied, failed and remaining, and auto_commit keeps the writes.
 */
async function unlinkMany(ctx, tracker, actor, from, targets) {
  const kind = ctx.opt('kind')
  const results = []
  for (const to of targets) {
    try {
      results.push({ to, ...(await tracker.unlink(from, to, kind, actor, { dryRun: ctx.dryRun })) })
    } catch (error) {
      const code = isPmkitError(error) ? error.code : 'UPSTREAM'
      const applied = results.map((item) => item.to)
      const stopped = { applied, failed: { to, code, message: error.message }, remaining: targets.slice(results.length + 1) }
      const stop = new PmkitError(code, `${to} failed after ${applied.length} of ${targets.length} unlinks: ${error.message}`, ctx.dryRun
        ? 'Nothing was written (dry run). The dry run stopped at the failed target: fix it or leave it out, then run the dry run again'
        : 'The targets in applied are unlinked and the ones in remaining are not. Run the call again with the remaining targets once the failed one is fixed')
      stop.written = {
        data: stopped,
        text: [`${ctx.dryRun ? 'would unlink' : 'applied'}: ${applied.join(', ') || '(none)'}`, `failed: ${to} ${code} ${error.message}`, `remaining: ${stopped.remaining.join(', ') || '(none)'}`].join('\n'),
      }
      if (applied.length > 0 && !ctx.dryRun) stop.partialCommit = `${from} --remove (${applied.length} of ${targets.length})`
      throw stop
    }
  }
  return { data: { results }, text: results.map((item) => writeText(item, ctx)).join('\n\n'), commit: `${from} --remove ${targets.join(' ')}` }
}

const issueWrite = (ctx, result, id = result.after.id) => ({ data: result, text: writeText(result, ctx), commit: id })

const NOTES_CUT = 'Linear has more issues than the 1000 pmkit read, so the notes may be missing issues'

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
/** The default branch every reader uses, validated: `main` when git_host.default_branch is unset or not a branch name. */
const defaultBranch = (ctx) => resolveDefaultBranch(ctx.config().pmkit, { originHead: () => originHead(ctx) }).branch
/** The note for a default_branch that was replaced by main, for a command that read it. */
const defaultBranchNotes = (ctx) => {
  const { note } = resolveDefaultBranch(ctx.config().pmkit, { originHead: () => originHead(ctx) })
  return note === null ? [] : [note]
}

function defaultPrBody(issue) {
  const lines = [`Tracker issue: ${issue.id}`]
  if (issue.acceptanceCriteria.length > 0) {
    lines.push('', '## Acceptance criteria', ...issue.acceptanceCriteria.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`))
  }
  return lines.join('\n')
}
const problemLine = (problem) => `${problem.id === null ? '' : `${problem.id}: `}${problem.code} ${problem.message}`
/** One warning per problem of a list, pointing to pmkit validate. A cut hosted read (INCOMPLETE) is no file problem. The JSON carries the same problems. */
const problemWarnings = (problems) => problems.map((problem) => (problem.code === 'INCOMPLETE' ? problemLine(problem) : `${problemLine(problem)}; run pmkit validate`))
/** A goal list problem as a warning. A cut Linear read (INCOMPLETE) is no file problem, so validate is no help there. */
const goalProblemWarning = (problem) => (problem.code === 'INCOMPLETE' ? problemLine(problem) : `${problemLine(problem)}; run pmkit validate`)

/**
 * The customer fields of customers create and update, from their flags. A number the flag spells as digits becomes a number;
 * anything else goes through as text and the tracker refuses it.
 */
function customerInput(ctx) {
  const input = {}
  for (const key of ['name', 'status', 'tier', 'owner']) if (ctx.opt(key) !== undefined) input[key] = ctx.opt(key)
  if (ctx.opt('revenue') !== undefined) input.revenue = /^\d+$/.test(ctx.opt('revenue')) ? Number(ctx.opt('revenue')) : ctx.opt('revenue')
  if (ctx.opt('size') !== undefined) input.size = /^\d+(\.\d+)?$/.test(ctx.opt('size')) ? Number(ctx.opt('size')) : ctx.opt('size')
  return input
}

/**
 * Turns a request into a new issue and accepts the request into it (PMK-221): the issue gets the request title and a description
 * of the request body, who asked (the customer name, else `from`, else the customer id) and `Request: <id>`, the text
 * /pmkit:backlog:request-queue writes. An accepted request is refused, so it never gets a second issue. When the accept fails
 * after the create, the issue stays and the error names both ids; `partialCommit` lets auto_commit keep the issue.
 * Returns { issue: { before, after }, request: { before, after }, problems, warnings }. A dry run creates nothing and projects the request.
 */
export async function acceptIntoNewIssue(tracker, id, actor, { dryRun = false } = {}) {
  const { problems, ...request } = await tracker.getRequest(id)
  if (request.state === 'accepted') {
    throw new PmkitError('CONFLICT', `request ${request.id} is already accepted into ${request.target?.id}`, `pmkit requests accept ${request.id} <issue> moves it to another issue`)
  }
  // A retry after an accept that failed must not make a second issue: look for an issue that already names the request.
  const { id: named, warnings } = await issueNamingRequest(tracker, request.id)
  if (named) throw new PmkitError('CONFLICT', `issue ${named} already names request ${request.id}`, `pmkit requests accept ${request.id} ${named}`)
  const asker = request.customer ? (request.customer.name ?? request.customer.id) : request.from
  const description = [request.body, [asker ? `Asked by: ${asker}` : null, `Request: ${request.id}`].filter(Boolean).join('\n')].filter(Boolean).join('\n\n')
  const issue = await tracker.createIssue({ title: request.title, description }, actor, { dryRun })
  if (dryRun) {
    const target = { type: 'issue', id: issue.after.id, title: issue.after.title }
    return { issue, request: { before: request, after: { ...request, state: 'accepted', target, triaged: { at: null, by: actor }, reason: null } }, problems, warnings }
  }
  try {
    const accepted = await tracker.acceptRequest(request.id, issue.after.id, actor)
    return { issue, request: { before: accepted.before, after: accepted.after }, problems: accepted.problems ?? problems, warnings }
  } catch (error) {
    // Any error, a system one (EACCES, ENOSPC) or a bug too, names both ids and lets auto_commit keep the issue.
    const failure = new PmkitError(
      isPmkitError(error) ? error.code : 'UPSTREAM',
      `issue ${issue.after.id} was created, but request ${request.id} was not accepted: ${error.message}; the request is still ${request.state}`,
      `pmkit requests accept ${request.id} ${issue.after.id}`,
    )
    failure.cause = error
    failure.partialCommit = `${request.id} ${issue.after.id}`
    throw failure
  }
}

/**
 * { id, warnings }: the id of an issue whose description has the line `Request: <id>`, archived ones included, or null.
 * A cut read (hasMore) refuses, since it may hide that issue. An issue file that does not parse is a warning that names it,
 * not a refusal (PMK-221 review B6): the issue an earlier run made is written by pmkit and parses, so the search finds it,
 * and refusing would block every --create in a tracker with one broken file.
 */
async function issueNamingRequest(tracker, id) {
  const { issues, problems = [], hasMore = false } = await tracker.searchIssues({ text: `Request: ${id}`, archived: true })
  const line = new RegExp(`^Request: ${id}$`, 'm')
  const found = issues.find((issue) => line.test(issue.description ?? ''))
  if (found) return { id: found.id, warnings: [] }
  if (hasMore) {
    throw new PmkitError(
      'INVALID_INPUT',
      `the issues could not all be read, so an issue made for request ${id} by an earlier run cannot be ruled out`,
      'Accept the request into an existing issue with pmkit requests accept <id> <issue>',
    )
  }
  const unread = problems.map((problem) => problem.id ?? problem.path).filter(Boolean)
  if (problems.length === 0) return { id: null, warnings: [] }
  const named = unread.length > 0 ? unread.join(', ') : `${problems.length} issue files`
  return { id: null, warnings: [`${named} could not be read, so an issue an earlier run made for request ${id} is not ruled out; run pmkit validate`] }
}

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
  return metricNotesFrom((await tracker.capabilities()).capabilities, metric, extra)
}

/** metricNotes over a manifest already read, for a command that reads the manifest once. */
function metricNotesFrom(capabilities, metric, extra = {}) {
  const entry = capabilities.find((c) => c.id === 'native_metrics')
  const note = pathNote(entry, { metric, estimation: capabilities.find((c) => c.id === 'estimation'), ...extra })
  return note === null ? [] : [note]
}

/** The note for one capability's path (capacity, deliverables, linked_code), as a list of zero or one lines. */
async function capabilityNotes(tracker, id) {
  return capabilityNotesFrom((await tracker.capabilities()).capabilities, id)
}

/** capabilityNotes over a manifest already read. */
function capabilityNotesFrom(capabilities, id) {
  const entry = capabilities.find((c) => c.id === id)
  const note = entry === undefined ? null : pathNote(entry)
  return note === null ? [] : [note]
}

/** The note of a command that must work without its tracker (default linked_code). A tracker that cannot load or report its manifest costs the note, not the command. */
async function capabilityNotesOrNone(ctx, id = 'linked_code') {
  try {
    return await capabilityNotes(await ctx.tracker(), id)
  } catch (error) {
    // Only a failure of the tracker or its manifest costs the note; a bug in the code does not hide.
    if (error instanceof TypeError) throw error
    return []
  }
}

/** discover().statuses as a categoryOf(statusName), and every issue's events grouped by issue. The flow metrics need each whole log. */
async function flowInputs(tracker, statuses) {
  const categoryOf = categoryLookup(statuses ?? (await tracker.discover()).statuses)
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
    usage: '[--git-host github|none] [--repo owner/name] [--default-branch name] [--remote name] [--team KEY] [--recheck-team]',
    flags: ['git-host', 'repo', 'default-branch', 'remote', 'team', 'recheck-team'], booleans: ['dry-run'], dryRun: true, exempt: true, run: runLinkRepo,
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
      const { views, problems, hasMore = false } = await (await ctx.tracker()).listViews()
      const warnings = problems.map((problem) => `${problemLine(problem)}; run pmkit validate`)
      if (hasMore) warnings.push(VIEWS_CUT)
      // A Linear view keeps Linear's own filter, which pmkit shows as it is stored.
      const shown = (view) => (view.filter === null ? `linear: ${JSON.stringify(view.linear.filterData)}` : filterText(view.filter))
      return { data: { views, problems, hasMore }, text: views.length === 0 ? (problems.length === 0 ? (hasMore ? 'no view among the views pmkit read' : 'no views') : `no view could be read: ${problems.length} view ${problems.length === 1 ? 'file' : 'files'} could not be read, run pmkit validate`) : table(['Name', 'Filter'], views.map((view) => [view.name, shown(view)])), warnings }
    },
  },
  {
    name: 'views run', summary: 'runs a saved view and lists its issues; --limit and --sort replace the stored values for this run', usage: '<name> [--limit n] [--sort s]', args: ['name'], flags: ['limit', 'sort'],
    run: async (ctx) => {
      const tracker = await ctx.tracker()
      const limit = ctx.opt('limit') === undefined ? undefined : whole('limit', ctx.opt('limit'))
      const found = await tracker.runView(ctx.args[0], { limit, sort: ctx.opt('sort') })
      return issueSearchResult(tracker, found, { sort: found.overrides.sort ?? found.view.filter?.sort, sprint: found.view.filter?.sprint })
    },
  },
  {
    name: 'views delete', summary: 'deletes a saved view; --dry-run is the full preview', usage: '<name>', write: true, args: ['name'], flags: [],
    run: async (ctx) => {
      const result = await (await ctx.tracker()).deleteView(ctx.args[0], await ctx.actor(), { dryRun: ctx.dryRun })
      const text = `deleted view ${result.before.name}\n${storedViewText(result.before)}`
      return { data: result, text: ctx.dryRun ? `${text}\ndry run: nothing was written` : text, commit: result.before.name }
    },
  },
  {
    name: 'views rename', summary: 'renames a saved view and keeps its filter', usage: '<name> <new-name>', write: true, args: ['name', 'new-name'], flags: [],
    run: async (ctx) => {
      const result = await (await ctx.tracker()).renameView(ctx.args[0], ctx.args[1], await ctx.actor(), { dryRun: ctx.dryRun })
      const text = `renamed view ${result.before.name} to ${result.after.name}\n${storedViewText(result.after)}`
      return { data: result, text: ctx.dryRun ? `${text}\ndry run: nothing was written` : text, commit: result.after.name }
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
    name: 'issues similar', summary: 'issues that read like this one (text similarity), done ones by default, with their estimates; only reads',
    usage: '<id> [--category c,..] [--limit n]', args: ['id'], flags: ['category', 'limit'],
    run: async (ctx) => {
      const tracker = await ctx.tracker()
      const target = await tracker.getIssue(ctx.args[0])
      const limit = ctx.opt('limit') === undefined ? 5 : whole('limit', ctx.opt('limit'))
      if (limit < 1) throw usageError('--limit must be at least 1')
      const categories = csv(ctx.opt('category') ?? 'done')
      if (categories.length === 0) throw usageError('--category needs at least one category', 'pmkit issues similar <id> --category done')
      const found = await tracker.searchIssues({ categories })
      const data = similarResult(target, found, { limit })
      const warnings = data.problems.map(problemLine)
      if (data.hasMore) warnings.push('Linear has more matching issues than the 1000 pmkit read, so the list is not verified')
      if (data.reason === 'no_comparable_text') warnings.push(`${target.id} has no title or description words to compare (reason no_comparable_text), so the similar issues are not verified. Ask what the work covers, or estimate from the code alone`)
      if (!data.complete) warnings.push('incomplete: the similar list is not verified. Do not say that no similar issue exists')
      const rows = [...data.similar, ...data.unestimated]
      // With an incomplete read the stdout always says why it is not verified, with a table or without one.
      const why = [
        ...(data.problems.length > 0 ? [`${data.problems.length} issue ${data.problems.length === 1 ? 'file' : 'files'} could not be read (${data.problems.map((p) => p.id ?? 'unknown').join(', ')})`] : []),
        ...(data.hasMore ? ['Linear has more issues than the 1000 pmkit read'] : []),
        ...(data.reason === 'no_comparable_text' ? [`${target.id} has no words to compare`] : []),
      ]
      const notVerified = data.complete ? [] : [`not verified: ${why.join('; ')}. Do not say that no similar issue exists`]
      const body = rows.length === 0
        ? (data.complete ? `no similar issues among the ${data.considered} read` : `no similar issues found among the ${data.considered} read`)
        : table(['ID', 'Title', 'Status', 'Assignee', 'Estimate', 'Score', 'Shared'], rows.map((hit) => [hit.id, hit.title, hit.status.name, hit.assignee ?? '', hit.estimate ?? '', hit.score, hit.shared.join(', ')]))
      const text = [body, ...notVerified].join('\n')
      return { data, text, warnings }
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
    usage: '(--title t | --title-file f) [--type] [--priority] [--estimate] [--assignee] [--label l,..] [--parent] [--sprint id|current|none] [--due] [--milestone m] [--release r] [--description-file f] [--criteria-file f]',
    flags: ['title', 'title-file', 'type', 'priority', 'estimate', 'assignee', 'label', 'parent', 'sprint', 'due', 'milestone', 'release', 'description-file', 'criteria-file'],
    run: async (ctx) => {
      const patch = await issuePatch(ctx, { create: true })
      if (patch.title === undefined) throw usageError('issues create needs --title or --title-file', 'pmkit issues create --title "..."')
      const result = issueWrite(ctx, await (await ctx.tracker()).createIssue(patch, await ctx.actor(), { dryRun: ctx.dryRun }))
      return { ...result, warnings: await releasedWarnings(ctx, patch) }
    },
  },
  {
    name: 'issues update', summary: 'edits fields and criteria', write: true, args: ['id'],
    usage: '<id> [--title] [--type] [--priority] [--estimate] [--label l,..] [--sprint id|current|none] [--due] [--milestone] [--release] [--branch] [--add-doc path] [--remove-doc path] [--description-file f] [--criteria-file f] [--check n] [--uncheck n]',
    flags: ['title', 'type', 'priority', 'estimate', 'label', 'sprint', 'due', 'milestone', 'release', 'branch', 'add-doc', 'remove-doc', 'description-file', 'criteria-file', 'check', 'uncheck'],
    run: async (ctx) => {
      const [id] = ctx.args
      const patch = await issuePatch(ctx, { create: false })
      await tickCriteria(ctx, id, patch)
      await docLinks(ctx, id, patch)
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
    name: 'issues delegate', summary: 'hands an issue to an agent member with a delegation comment: the agent becomes the assignee (local run) or the tracker\'s delegate (native run)', usage: '<id> <agent:name> [--instructions-file f]', write: true, args: ['id', 'agent'], flags: ['instructions-file'],
    run: async (ctx) => {
      const instructions = ctx.opt('instructions-file') !== undefined ? readInput(ctx.opt('instructions-file')) : undefined
      const result = await (await ctx.tracker()).delegate(ctx.args[0], ctx.args[1], instructions, await ctx.actor(), { dryRun: ctx.dryRun })
      // A Linear dry run has no comment id yet.
      const lines = [writeText(result, { dryRun: false }), `${ctx.dryRun ? 'would comment' : 'commented'}${result.comment.id ? ` ${result.comment.id}` : ''}`]
      if (result.run === 'local') lines.push(localRunLine(result.after.id, result.after.assignee))
      if (result.run === 'native' && !ctx.dryRun) lines.push(nativeRunLine(result.after.id, result.after.delegate))
      if (ctx.dryRun) lines.push('dry run: nothing was written')
      return { data: result, text: lines.join('\n'), commit: result.after.id }
    },
  },
  {
    name: 'issues track-agents', summary: 'open issues assigned to agent members (on Linear, open pull requests by bot authors), with the delegation record and the state of each pull request; reads only', usage: '[--agent <name>]', args: [], flags: ['agent'],
    run: (ctx) => runTrackAgents(ctx),
  },
  {
    name: 'issues link', summary: 'links or unlinks; --remove takes several targets', usage: '<from> <to...> --kind blocks|related|duplicate [--remove]', write: true, rest: 'id', flags: ['kind', 'remove'],
    run: async (ctx) => {
      const [from, ...targets] = ctx.args
      if (targets.length === 0) throw usageError('issues link takes <from> <to>', 'Usage: issues link <from> <to...> --kind blocks|related|duplicate [--remove]')
      if (ctx.opt('kind') === undefined) throw usageError('issues link needs --kind', 'Use --kind blocks, related or duplicate')
      const op = ctx.flag('remove') ? 'unlink' : 'link'
      const tracker = await ctx.tracker()
      const actor = await ctx.actor()
      if (targets.length === 1) return issueWrite(ctx, await tracker[op](from, targets[0], ctx.opt('kind'), actor, { dryRun: ctx.dryRun }), from)
      if (op === 'link') throw usageError('several targets work only with --remove', 'Link one target per call, or add --remove')
      const repeated = targets.find((to, i) => targets.indexOf(to) !== i)
      if (repeated !== undefined) throw usageError(`${repeated} is named twice`, 'Name each target once')
      if (targets.includes(from)) throw usageError(`${from} is both <from> and a target`, 'Leave <from> out of the targets')
      return unlinkMany(ctx, tracker, actor, from, targets)
    },
  },
  {
    name: 'issues parent', summary: 'sets the parent', usage: '<id> <parent|none>', write: true, args: ['id', 'parent'], flags: [],
    run: async (ctx) => issueWrite(ctx, await (await ctx.tracker()).setParent(ctx.args[0], ctx.args[1] === 'none' ? null : ctx.args[1], await ctx.actor(), { dryRun: ctx.dryRun })),
  },
  {
    name: 'issues bulk', summary: 'applies one change to every issue a filter or a saved view returns; --dry-run is the full preview and prints a digest, the real run needs it as --expect', write: true, args: ['change', 'value?'],
    usage: '<move|assign|priority|estimate|label-add|label-remove|due|type|archive|unarchive|milestone|release|sprint|parent|link> [<value>] (<issues list filter flags> | --view name) [--max n] [--status name] [--kind k] [--remove] [--expect digest]',
    flags: ['text', 'category', 'type', 'assignee', 'label', 'sprint', 'parent', 'blocked', 'updated-before', 'updated-after', 'archived', 'view', 'max', 'status', 'kind', 'remove', 'expect'],
    run: (ctx) => runBulk(ctx),
  },
  {
    name: 'issues comment', summary: 'comments', usage: '<id> --body-file f [--reply-to comment] [--redact]', write: true, args: ['id'], flags: ['body-file', 'reply-to', 'redact'],
    run: async (ctx) => {
      if (ctx.opt('body-file') === undefined) throw usageError('issues comment needs --body-file', 'Pass a file, or - for stdin')
      let body = readInput(ctx.opt('body-file'))
      // --redact (PMK-229) replaces the secrets before the tracker gets the body, so the dry run and the write hold the same text.
      let redacted
      if (ctx.flag('redact')) {
        const { text, count, counts, summary } = redact(body)
        redacted = { count, counts, summary }
        body = count === 0 ? text : `${text.trimEnd()}\n\n${summary}`
      }
      const comment = await (await ctx.tracker()).comment(ctx.args[0], body, await ctx.actor(), { dryRun: ctx.dryRun, replyTo: ctx.opt('reply-to') })
      const note = redacted === undefined || redacted.count === 0 ? null : `redacted ${redacted.count} ${redacted.count === 1 ? 'value' : 'values'}: ${Object.entries(redacted.counts).map(([type, n]) => `${type} ${n}`).join(', ')}`
      return { data: redacted === undefined ? comment : { ...comment, redacted }, text: writeText(null, { dryRun: ctx.dryRun, header: `commented on ${comment.issue}` }), notes: note ? [note] : [], commit: comment.issue }
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
      const note = longEntryNote(minutes, { written: !ctx.dryRun })
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
    name: 'default-branch', summary: 'prints git_host.default_branch as a valid branch name; when it is unset, the branch of origin/HEAD with a note, else main; main with a note when it is not a name; reads .pmkit/config.yaml and origin/HEAD only, no tracker, writes nothing', flags: [], args: [], exempt: true,
    run: async (ctx) => {
      // Only .pmkit/config.yaml, never the tracker: a missing, broken or newer tracker config must not cost the command files their base branch.
      let resolved
      try {
        resolved = resolveDefaultBranch(parseYaml(fs.readFileSync(path.join(ctx.root, '.pmkit', 'config.yaml'), 'utf8')), { originHead: () => originHead(ctx) })
      } catch (error) {
        const reason = error.code === 'ENOENT' ? 'it does not exist' : error.message.split('\n')[0]
        resolved = { branch: 'main', configured: null, valid: false, note: `cannot read .pmkit/config.yaml (${reason}), so main is used` }
      }
      return { data: resolved, text: resolved.branch, notes: resolved.note === null ? [] : [resolved.note] }
    },
  },
  {
    name: 'text redact', summary: 'replaces the secrets in a text file with [redacted] and counts them by type, with no tracker and no write', usage: '--file f', flags: ['file'], args: [],
    run: async (ctx) => {
      if (ctx.opt('file') === undefined) throw usageError('text redact needs --file', 'Pass a file, or - for stdin')
      const result = redact(readInput(ctx.opt('file')))
      const note = result.count === 0 ? null : `redacted ${result.count} ${result.count === 1 ? 'value' : 'values'}: ${Object.entries(result.counts).map(([type, n]) => `${type} ${n}`).join(', ')}`
      return { data: result, text: result.text, notes: note ? [note] : [] }
    },
  },
  {
    name: 'issues time-entries', summary: 'lists the time logged on an issue, with the total and the totals per person and per sprint', usage: '<id>', args: ['id'], flags: [],
    run: async (ctx) => {
      const result = await (await ctx.tracker()).listTimeEntries(ctx.args[0])
      const text = result.entries.length === 0
        ? `no time logged on ${result.issue}\ntotal: 0 minutes`
        : [
            table(['At', 'By', 'Minutes', 'Time'], result.entries.map((entry) => [entry.at, entry.by, String(entry.minutes), entry.time])),
            `total: ${result.total} minutes (${result.totalTime})`,
            `per person\n${table(['By', 'Minutes', 'Time'], result.byPerson.map((row) => [row.by, String(row.minutes), row.time]))}`,
            `per sprint\n${table(['Sprint', 'Minutes', 'Time'], result.bySprint.map((row) => [row.sprint ?? 'no sprint', String(row.minutes), row.time]))}`,
          ].join('\n')
      const notes = [
        ...(result.ignored > 0 ? [`${result.ignored} log_time ${result.ignored === 1 ? 'event' : 'events'} ignored: minutes is not a positive integer`] : []),
        ...(result.sprintsUnread ? [`could not read the sprint ${result.sprintsUnread.length === 1 ? 'file' : 'files'} ${result.sprintsUnread.join(', ')}; entries dated in ${result.sprintsUnread.length === 1 ? "that sprint's" : 'those sprints'} period count as no sprint, the other sprints still count; run pmkit validate`] : []),
      ]
      return { data: result, text, notes }
    },
  },
  {
    name: 'issues archive', summary: 'archives', usage: '<id>', write: true, args: ['id'], flags: [],
    run: async (ctx) => issueWrite(ctx, await (await ctx.tracker()).archive(ctx.args[0], await ctx.actor(), { dryRun: ctx.dryRun })),
  },
  {
    name: 'issues unarchive', summary: 'brings an archived issue back (Local tracker)', usage: '<id>', write: true, args: ['id'], flags: [],
    run: async (ctx) => {
      const result = await (await ctx.tracker()).unarchive(ctx.args[0], await ctx.actor(), { dryRun: ctx.dryRun })
      // A call that changes nothing has no commit and says so in both the text and the JSON.
      if (result.before.archived !== result.after.archived) return issueWrite(ctx, result)
      const message = `${result.after.id} is not archived, so nothing changed`
      return { data: { ...result, unchanged: true, message }, text: `${writeText(result, ctx)}\n${message}` }
    },
  },
  {
    name: 'issues delete', summary: 'deletes an issue for good; archive keeps it', usage: '<id>', write: true, args: ['id'], flags: [],
    run: async (ctx) => {
      const result = await (await ctx.tracker()).delete(ctx.args[0], await ctx.actor(), { dryRun: ctx.dryRun })
      const scan = repoMentions(ctx, result.before.id)
      const data = {
        ...result,
        files: scan.files,
        unchecked: result.unchecked.flatMap((item) => (item !== REPO_UNCHECKED ? [item] : scan.error === null ? [] : [`${item} (git grep failed: ${scan.error})`])),
      }
      return { data, text: deleteText(data, ctx), commit: result.before.id }
    },
  },
  {
    name: 'issues restore', summary: "brings a deleted issue back from Linear's trash; the Local tracker answers with the git commands", usage: '<id>', write: true, args: ['id'], flags: [],
    run: async (ctx) => {
      const result = await (await ctx.tracker()).restore(ctx.args[0], await ctx.actor(), { dryRun: ctx.dryRun })
      const lines = [`${ctx.dryRun ? 'would restore' : 'restored'} ${result.after.id}  ${result.after.title}`, issueRecord(result.after)]
      if (result.warnings?.length > 0) lines.push('warnings:', ...result.warnings.map((warning) => `  ${warning}`))
      if (ctx.dryRun) lines.push('dry run: nothing was written')
      return { data: result, text: lines.join('\n'), commit: result.after.id }
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
    name: 'cycle capacity', summary: 'reads or sets capacity and days off', usage: '<id|current> [--set member=n,..] [--days-off member=date+date,..]', write: true, readUnless: ['set', 'days-off'], args: ['id'], flags: ['set', 'days-off'],
    run: async (ctx) => {
      const tracker = await ctx.tracker()
      // `current` is the active sprint, as in `team capacity --sprint current`.
      const id = ctx.args[0] === 'current' ? await activeSprintId(tracker) : ctx.args[0]
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
    name: 'epic create', summary: 'creates an epic', usage: '(--title t | --title-file f) [--start d] [--target d] [--goal id]', write: true, flags: ['title', 'title-file', 'start', 'target', 'goal'],
    run: async (ctx) => {
      const title = lineFromFlag(ctx.opt, 'title')
      if (title === undefined) throw usageError('epic create needs --title or --title-file', 'pmkit epic create --title-file title.txt')
      const input = { title }
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
      const warnings = problems.map(goalProblemWarning)
      const rows = goals.map((goal) => [goal.id, goal.title, goal.status, goal.target ?? '', goal.epics.join(', ')])
      return { data: goals, text: goals.length === 0 ? 'no goals' : table(['ID', 'Title', 'Status', 'Target', 'Epics'], rows), warnings }
    },
  },
  {
    name: 'goal get', summary: 'one goal with its epics', usage: '<id>', args: ['id'], flags: [],
    run: async (ctx) => {
      const tracker = await ctx.tracker()
      const goal = await tracker.getGoal(ctx.args[0])
      // As goal list and goal progress: an unreadable epic may link to the goal, and a cut Linear read may hide its epics.
      const warnings = (await tracker.listGoals()).problems.filter((problem) => problem.kind === 'epic' || problem.id === goal.id).map(goalProblemWarning)
      const text = [goalRecord(goal), ...(warnings.length > 0 ? [INCOMPLETE_LINE] : [])].join('\n')
      return { data: { ...goal, complete: warnings.length === 0, warnings }, text, warnings }
    },
  },
  {
    name: 'goal create', summary: 'creates a strategic goal', usage: '(--title t | --title-file f) [--target YYYY-MM-DD] [--status s]', write: true, flags: ['title', 'title-file', 'target', 'status'],
    run: async (ctx) => {
      const title = lineFromFlag(ctx.opt, 'title')
      if (title === undefined) throw usageError('goal create needs --title or --title-file', 'pmkit goal create --title-file title.txt')
      const input = { title }
      for (const key of ['target', 'status']) if (ctx.opt(key) !== undefined) input[key] = ctx.opt(key)
      const result = await (await ctx.tracker()).createGoal(input, await ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, { ...ctx, record: goalRecord }), commit: result.after.id }
    },
  },
  {
    name: 'goal update', summary: 'changes the title, target or status of a goal; --target none removes the target', usage: '<id> [--title t | --title-file f] [--target YYYY-MM-DD|none] [--status s]', write: true, args: ['id'], flags: ['title', 'title-file', 'target', 'status'],
    run: async (ctx) => {
      const input = {}
      const title = lineFromFlag(ctx.opt, 'title')
      if (title !== undefined) input.title = title
      if (ctx.opt('target') !== undefined) input.target = ctx.opt('target') === 'none' ? null : ctx.opt('target')
      if (ctx.opt('status') !== undefined) input.status = ctx.opt('status')
      const result = await (await ctx.tracker()).updateGoal(ctx.args[0], input, await ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, { ...ctx, record: goalRecord }), commit: result.after.id }
    },
  },
  {
    name: 'goal close', summary: 'marks a goal completed', usage: '<id>', write: true, args: ['id'], flags: [],
    run: async (ctx) => {
      const result = await (await ctx.tracker()).updateGoal(ctx.args[0], { status: 'completed' }, await ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, { ...ctx, record: goalRecord }), commit: result.after.id }
    },
  },
  {
    name: 'goal delete', summary: 'deletes a goal file; refuses while an epic links to it', usage: '<id>', write: true, args: ['id'], flags: [],
    run: async (ctx) => {
      const result = await (await ctx.tracker()).deleteGoal(ctx.args[0], await ctx.actor(), { dryRun: ctx.dryRun })
      const text = [`${ctx.dryRun ? 'would delete' : 'deleted'} goal ${result.before.id}  ${result.before.title}`, goalRecord(result.before), '', `removes: ${result.removes.file}`, ...(ctx.dryRun ? ['dry run: nothing was written'] : [])].join('\n')
      return { data: result, text, commit: result.before.id }
    },
  },
  {
    name: 'goal progress', summary: 'rolls up the progress of the epics of a goal', usage: '<id>', args: ['id'], flags: [],
    run: async (ctx) => {
      const p = await (await ctx.tracker()).goalProgress(ctx.args[0])
      const rows = p.epics.map((e) => [e.id, e.title, e.counted ? e.status.name : `${e.status.name} (canceled, not counted)`, e.progress.done, e.progress.total, e.progress.pointsDone, e.progress.points])
      const text = [
        `${p.goal.id}  ${p.goal.title}`,
        ...fields([['total', p.total], ['done', p.done], ['canceled', p.canceled], ['points', p.points], ['points done', p.pointsDone]]),
        ...Object.entries(p.byCategory).map(([category, count]) => `  ${category}: ${count}`),
        '',
        p.epics.length === 0 ? 'no epics' : table(['Epic', 'Title', 'Status', 'Done', 'Total', 'Points done', 'Points'], rows),
        ...(p.warnings.length > 0 ? [INCOMPLETE_LINE] : []),
      ].join('\n')
      return { data: { ...p, complete: p.warnings.length === 0 }, text, warnings: p.warnings }
    },
  },
  {
    name: 'goals overview', summary: 'each strategic goal with the progress of its epics; without goals, the top-level issues with the progress of their sub-issues; reads only', flags: [],
    run: (ctx) => runGoalsOverview(ctx),
  },
  // Customers, requests and demand (PMK-46). customers list and show print the keys of linear customers list and show.
  {
    name: 'customers list', summary: 'lists the customers with status, tier, revenue, size and request count, highest revenue first', flags: [],
    run: async (ctx) => {
      const { customers, problems, hasMore = false } = await (await ctx.tracker()).listCustomers()
      const rows = customers.map((c) => [c.id, c.name, c.status?.name ?? '', c.tier?.name ?? '', c.revenue ?? '', c.size ?? '', c.requests])
      return {
        data: { available: true, customers, hasMore, problems },
        text: customers.length === 0 ? 'no customers yet' : table(['ID', 'Name', 'Status', 'Tier', 'Revenue', 'Size', 'Requests'], rows),
        warnings: problemWarnings(problems),
      }
    },
  },
  {
    name: 'customers show', summary: 'one customer, by id or exact name, with its requests, newest first; --customer is the linear customers show spelling',
    usage: '(<id or name> | --customer <id or name>)', args: ['customer?'], flags: ['customer'],
    run: async (ctx) => {
      if ((ctx.args[0] === undefined) === (ctx.opt('customer') === undefined)) {
        throw usageError('customers show takes the customer as <id or name> or as --customer, and not both', 'pmkit customers show CUS-1')
      }
      const { customer, requests, problems } = await (await ctx.tracker()).getCustomer(ctx.args[0] ?? ctx.opt('customer'))
      const text = [customerRecord(customer), '', requests.length === 0 ? 'no requests yet' : requestTable(requests)].join('\n')
      return { data: { available: true, customer, requests, problems }, text, warnings: problemWarnings(problems) }
    },
  },
  {
    name: 'customers create', summary: 'creates a customer', usage: '--name n [--status s] [--tier t] [--revenue n] [--size n] [--owner member]', write: true,
    flags: ['name', 'status', 'tier', 'revenue', 'size', 'owner'],
    run: async (ctx) => {
      if (ctx.opt('name') === undefined) throw usageError('customers create needs --name', 'pmkit customers create --name "..."')
      const input = customerInput(ctx)
      const result = await (await ctx.tracker()).createCustomer(input, await ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, { ...ctx, record: customerRecord }), commit: result.after.id }
    },
  },
  {
    name: 'customers update', summary: 'edits a customer, by id or exact name; none clears the status, tier or owner',
    usage: '<id or name> [--name n] [--status s|none] [--tier t|none] [--revenue n] [--size n] [--owner member|none]', write: true,
    args: ['customer'], flags: ['name', 'status', 'tier', 'revenue', 'size', 'owner'],
    run: async (ctx) => {
      const result = await (await ctx.tracker()).updateCustomer(ctx.args[0], customerInput(ctx), await ctx.actor(), { dryRun: ctx.dryRun })
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
      return { data: request, text: requestRecord(request), warnings: problemWarnings(request.problems) }
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
    name: 'requests accept', summary: 'accepts a request into an existing issue, or with --create into a new issue made from the request',
    usage: '<id> (<issue> | --create)', write: true, args: ['id', 'issue?'], flags: ['create'],
    run: async (ctx) => {
      const [id, issue] = ctx.args
      if ((issue === undefined) === !ctx.flag('create')) throw usageError('requests accept takes an <issue> or --create, and not both', 'pmkit requests accept REQ-1 ISS-1, or pmkit requests accept REQ-1 --create')
      if (ctx.flag('create')) {
        const result = await acceptIntoNewIssue(await ctx.tracker(), id, await ctx.actor(), { dryRun: ctx.dryRun })
        const text = [
          writeText(result.issue, { ...ctx, dryRun: false, record: issueRecord }),
          '',
          writeText(result.request, { ...ctx, record: requestRecord }),
        ].join('\n')
        return {
          data: result, text, commit: `${result.request.after.id} ${result.issue.after.id}`, warnings: [...problemWarnings(result.problems), ...result.warnings],
          notes: ctx.dryRun ? ['the issue ID is assigned when written, and so is the triage time'] : [],
        }
      }
      const result = await (await ctx.tracker()).acceptRequest(id, issue, await ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, { ...ctx, record: requestRecord }), commit: result.after.id, warnings: problemWarnings(result.problems) }
    },
  },
  {
    name: 'requests update', summary: 'edits the title or the body of a request; the state and the triage stay',
    usage: '<id> [--title t | --title-file f] [--body-file f]', write: true, args: ['id'], flags: ['title', 'title-file', 'body-file'],
    run: async (ctx) => {
      const changes = {}
      const title = lineFromFlag(ctx.opt, 'title')
      if (title !== undefined) changes.title = title
      if (ctx.opt('body-file') !== undefined) changes.body = readInput(ctx.opt('body-file'))
      const result = await (await ctx.tracker()).updateRequest(ctx.args[0], changes, await ctx.actor(), { dryRun: ctx.dryRun })
      // changeLines skips `body` (an issue's whole file), so the request text is compared as `text`, printed as "text: changed".
      const withText = (view) => ({ ...view, text: view.body })
      const text = writeText({ before: withText(result.before), after: withText(result.after) }, { ...ctx, record: requestRecord })
      return { data: result, text, commit: result.after.id, warnings: problemWarnings(result.problems) }
    },
  },
  {
    name: 'requests decline', summary: 'declines a request', usage: '<id> [--reason text]', write: true, args: ['id'], flags: ['reason'],
    run: async (ctx) => {
      const result = await (await ctx.tracker()).declineRequest(ctx.args[0], ctx.opt('reason'), await ctx.actor(), { dryRun: ctx.dryRun })
      return { data: result, text: writeText(result, { ...ctx, record: requestRecord }), commit: result.after.id, warnings: problemWarnings(result.problems) }
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
    name: 'inbox list',
    summary: 'the mentions, assignments and status changes for a member that the member has not seen, oldest first; the first list shows the last 14 days; --reviews adds the open pull requests that request the member\'s review, matched by member id or --login',
    usage: '[--as member] [--since timestamp] [--all] [--reviews [--login github-login ...]]',
    flags: ['as', 'since', 'all', 'reviews', 'login'],
    run: async (ctx) => {
      if (ctx.list('login').length > 0 && !ctx.flag('reviews')) throw usageError('--login matches review requests, so it needs --reviews', 'Add --reviews, or drop --login')
      const result = await (await ctx.tracker()).listNotifications({ user: await ctx.actor(), since: ctx.opt('since'), all: ctx.flag('all') })
      const { user, since, hidden, items, complete, problems } = result
      const reviews = ctx.flag('reviews') ? reviewRequests(ctx, user, ctx.list('login')) : null
      const lines = []
      if (items.length === 0) lines.push(`no unseen mentions, assignments or status changes for ${user}${since === null ? '' : ` since ${since}`}`)
      else lines.push(table(['When', 'Kind', 'Issue', 'Title', 'By', 'Where', 'Text', 'Seen', 'Key'], items.map((i) => [i.at, i.kind, i.issue, i.title ?? '(unreadable)', i.by ?? '', i.in, inboxText(i), i.seen ? 'yes' : 'no', i.key])))
      if (hidden > 0) lines.push(`${hidden} older unseen ${hidden === 1 ? 'item is' : 'items are'} not shown, run pmkit inbox list --all`)
      // A problem with no issue (a cut Linear read) is not a file pmkit validate can find.
      const validate = problems.some((problem) => problem.id !== null)
      if (!complete) lines.push(`the inbox is incomplete: ${problems.length} ${problems.length === 1 ? 'problem' : 'problems'} may hide items${validate ? ', run pmkit validate' : ''}`)
      if (reviews !== null) lines.push(...reviewLines(reviews, user))
      const data = { available: true, ...result, counts: { ...result.counts, reviewRequests: reviews?.verified ? reviews.requested.length : null }, reviews }
      return { data, text: lines.join('\n'), warnings: problems.map((problem) => (problem.id === null ? problemLine(problem) : `${problemLine(problem)}; run pmkit validate`)) }
    },
  },
  {
    name: 'inbox mark-read', summary: 'records the items a member has seen in the user store; --key marks only the keys the list showed, and with none it marks every unseen item; a key no item has is reported and the others are marked; refuses when the inbox is incomplete',
    usage: '[--as member] [--key key ...] [--dry-run]', flags: ['as', 'key'], dryRun: true,
    run: async (ctx) => {
      const keys = ctx.list('key')
      const result = await (await ctx.tracker()).markRead({ user: await ctx.actor(), keys: keys.length > 0 ? keys : undefined, dryRun: ctx.dryRun })
      const count = `${result.marked.length} ${result.marked.length === 1 ? 'item' : 'items'}`
      const said = result.changed
        ? `${ctx.dryRun ? 'would mark' : 'marked'} ${count} read for ${result.user}${result.pruned > 0 ? `, and drop ${result.pruned} old ${result.pruned === 1 ? 'key' : 'keys'}` : ''}`
        : `nothing to mark read for ${result.user}`
      const warnings = result.unknown.map((key) => `no item has the key ${key}; run pmkit inbox list --all for the keys`)
      return { data: result, text: ctx.dryRun ? `${said}\ndry run: nothing was written` : said, warnings, notes: result.note === null ? [] : [result.note] }
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
    name: 'milestone create', summary: 'creates a milestone', usage: '<id> [--name n | --name-file f] [--due YYYY-MM-DD]', write: true, args: ['id'], flags: ['name', 'name-file', 'due'],
    run: async (ctx) => {
      const input = { id: ctx.args[0] }
      const name = lineFromFlag(ctx.opt, 'name')
      if (name !== undefined) input.name = name
      if (ctx.opt('due') !== undefined) input.due = ctx.opt('due')
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
    name: 'release create', summary: 'creates a release', usage: '<id> [--name n | --name-file f] [--tag t] [--target YYYY-MM-DD]', write: true, args: ['id'], flags: ['name', 'name-file', 'tag', 'target'],
    run: async (ctx) => {
      const input = { id: ctx.args[0] }
      const name = lineFromFlag(ctx.opt, 'name')
      if (name !== undefined) input.name = name
      for (const key of ['tag', 'target']) if (ctx.opt(key) !== undefined) input[key] = ctx.opt(key)
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
      // A read the tracker cut (hasMore) makes the notes incomplete, said in the JSON, the text and a warning (review of PMK-246).
      let truncated = false
      let candidates
      if (choice.basis === 'release') {
        const found = await tracker.searchIssues({ release: choice.source.id, archived: true })
        problems.push(...found.problems)
        truncated = found.hasMore === true
        candidates = found.issues.map((issue) => ({ issue, doneAt: null }))
      } else if (choice.basis === 'sprint') {
        const events = groupEventsByIssue(await tracker.metricEvents())
        const found = await tracker.searchIssues({ sprint: choice.source.id, archived: true })
        problems.push(...found.problems)
        truncated = found.hasMore === true
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
      const result = buildNotes({ choice, candidates, types: discovered.types, problems, truncated })
      const note = !on('releases') && choice.basis === 'sprint' ? pathNote(releasesEntry, { releaseNotesFrom: choice.source.id }) : null
      return { data: result, text: releaseNotesText(result), warnings: [...result.problems.map(problemLine), ...(truncated ? [NOTES_CUT] : [])], notes: note === null ? [] : [note] }
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
    name: 'docs list', summary: 'lists the documents: the files under the docs folder (Local) or the documents of the team projects (Linear)', usage: '', args: [], flags: [],
    run: async (ctx) => {
      const docs = await (await ctx.tracker()).listDocuments()
      const text = docs.length === 0 ? 'no documents' : docs.map((doc) => (doc.title ? `${doc.path}  ${doc.title}` : doc.path)).join('\n')
      return { data: docs, text }
    },
  },
  {
    name: 'docs next-adr', summary: 'the number, slug and path of the next ADR, and where it goes (repo or tracker); only reads', usage: '(--title t | --title-file f)', args: [], flags: ['title', 'title-file'], byTracker: true,
    run: async (ctx) => {
      const title = lineFromFlag(ctx.opt, 'title')
      if (typeof title !== 'string') throw usageError('docs next-adr needs --title or --title-file', 'Pass the decision title, for example --title-file title.txt')
      const { pmkit, hosted } = ctx.config()
      // A hosted tracker needs no call: the Linear adapter cannot create documents, so its ADR is a repository file.
      const documents = hosted ? undefined : (await (await ctx.tracker()).capabilities()).capabilities.find((c) => c.id === 'documents')
      const { trackerDir, trackerFolder } = adrPlace(ctx)
      const resolved = resolveDefaultBranch(pmkit, { originHead: () => originHead(ctx) })
      const plan = planNextAdr({
        title,
        root: ctx.root,
        trackerDir,
        trackerFolder,
        hosted: Boolean(hosted),
        createSupported: documents !== undefined && documents.path !== 'absent' && !documents.detail?.unsupported?.includes('createDocument'),
        defaultBranch: resolved.branch,
        defaultBranchNote: resolved.note,
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
    name: 'docs adr-status', summary: 'sets the Status line of an existing ADR (accepted, deprecated, or superseded --by a newer ADR); a repository file is written without a commit, a tracker document through the tracker', usage: '<number> <accepted|deprecated|superseded> [--by number]', write: true, args: ['number', 'status'], flags: ['by'], byTracker: true,
    run: (ctx) => runAdrStatus(ctx),
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
    name: 'roadmap review', summary: 'epics and milestones with dates, health and delays, and the epics with no recent status update; reads only', flags: [],
    run: (ctx) => runRoadmapReview(ctx),
  },
  {
    name: 'release-readiness', summary: 'what is left for a release: open issues, open pull requests and deploys; without releases a milestone or a sprint; reads only',
    usage: '[--release id | --milestone id | --sprint current|id]', flags: ['release', 'milestone', 'sprint'],
    run: (ctx) => runReleaseReadiness(ctx),
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
    name: 'alerts list', summary: 'security alerts from the scanners the repository has (npm, yarn and pnpm audit, pip-audit, cargo audit) or from saved reports, highest severity first; reads only', usage: '[--severity critical,high,medium,low,unknown] [--report scanner=file ..]', flags: ['severity', 'report'],
    run: async (ctx) => {
      ctx.config() // loads and checks .pmkit/config.yaml like every command, though alerts never read the tracker
      const wanted = csv(ctx.list('severity'))
      const unknown = wanted.filter((value) => !SEVERITIES.includes(value))
      if (unknown.length > 0) throw usageError(`--severity must be one of ${SEVERITIES.join(', ')}, not ${unknown.join(', ')}`)
      const found = collectAlerts(ctx.root, { env: ctx.env, reports: readReports(ctx, 'pmkit alerts list --report npm-audit=npm-audit.json') })
      const alerts = wanted.length === 0 ? found.alerts : found.alerts.filter((alert) => wanted.includes(alert.severity))
      // The per-scanner count follows the filter, so scanners[].alerts always adds up to alerts.length.
      const scanners = found.scanners.map((scanner) => ({ ...scanner, alerts: alerts.filter((alert) => alert.scanner === scanner.id).length }))
      const gaps = scannerGaps(scanners)
      let text
      if (!scanners.some((scanner) => scanner.detected)) {
        text = `no scanners found in this repository (looked for: ${SCANNERS.map((scanner) => `${scanner.id} needs ${scanner.needs}`).join('; ')})`
      } else if (alerts.length > 0) text = table(['ID', 'Severity', 'Package', 'Title'], alerts.map((alert) => [alert.id, alert.severity, alert.package, alert.title]))
      else text = gaps.length === 0 ? 'no alerts' : 'no alerts read'
      // A failed, partial or skipped scanner left part of the scan unread, so the text never reads as a clean result.
      if (gaps.length > 0) text = [text, ...gaps.map((gap) => `incomplete: ${gap}, so this result may miss alerts`)].join('\n')
      return { data: { incomplete: gaps.length > 0, scanners, alerts }, text, warnings: found.warnings, notes: await capabilityNotesOrNone(ctx, 'security_alerts') }
    },
  },
  {
    name: 'alerts scan', summary: 'security alerts no issue covers yet, each with a type, a priority from the severity and a description that holds its alert-key line; reads only', usage: '[--severity critical,high,medium,low,unknown] [--report scanner=file ..]', flags: ['severity', 'report'],
    run: async (ctx) => {
      const wanted = csv(ctx.list('severity'))
      const unknown = wanted.filter((value) => !SEVERITIES.includes(value))
      if (unknown.length > 0) throw usageError(`--severity must be one of ${SEVERITIES.join(', ')}, not ${unknown.join(', ')}`)
      ctx.config()
      const found = collectAlerts(ctx.root, { env: ctx.env, reports: readReports(ctx, 'pmkit alerts scan --report npm-audit=npm-audit.json') })
      const gaps = scannerGaps(found.scanners)
      const warnings = [...found.warnings]
      const noUnread = { count: 0, ids: [] }
      if (!found.scanners.some((scanner) => scanner.detected)) {
        const looked = SCANNERS.map((scanner) => `${scanner.id} needs ${scanner.needs}`).join('; ')
        return { data: { absent: true, incomplete: false, scanners: found.scanners, unread: noUnread, candidates: [], matched: [] }, text: `security alerts are absent in this repository: no scanner found (${looked})`, warnings }
      }
      const tracker = await ctx.tracker()
      const { priorities, types } = await tracker.discover()
      const alerts = wanted.length === 0 ? found.alerts : found.alerts.filter((alert) => wanted.includes(alert.severity))
      // The per-scanner count follows the filter, like alerts list, so scanners[].alerts adds up to the alerts scanned.
      const scanners = found.scanners.map((scanner) => ({ ...scanner, alerts: alerts.filter((alert) => alert.scanner === scanner.id).length }))
      const existing = await readExistingIssues(tracker)
      const { candidates, matched } = matchAlerts(alerts.map((alert) => alertCandidate(alert, { priorities, types })), existing.issues)
      warnings.push(...existing.problems.map(problemLine))
      for (const gap of gaps) warnings.push(`incomplete: ${gap}, so this list may miss alerts. Do not create issues from this list`)
      if (existing.cut) warnings.push(`incomplete: the tracker has more issues than the ${READ_LIMIT} pmkit read, so an alert that an issue covers may show as new. Do not create issues from this list`)
      if (existing.unread.count > 0) {
        const { count, ids } = existing.unread
        const which = ids.length > 0 ? ` (${ids.join(', ')})` : ''
        const next = ctx.config().system === 'local' ? 'Run /pmkit:local:doctor to fix them, then scan again' : 'Fix them in the tracker, then scan again'
        warnings.push(`incomplete: ${count} ${count === 1 ? 'issue' : 'issues'} could not be read${which}, so an alert that one of them covers may show as new. Do not create issues from this list. ${next}`)
      }
      const incomplete = gaps.length > 0 || existing.incomplete
      const parts = []
      if (candidates.length > 0) parts.push(table(['Key', 'Severity', 'Priority', 'Package', 'Title'], candidates.map((c) => [c.key, c.severity, c.priority ?? '', c.package, c.title])))
      if (matched.length > 0) parts.push(`already in the tracker:\n${table(['Issue', 'Status', 'Severity', 'Package', 'Title'], matched.map((m) => [m.issue, m.status ?? '', m.severity, m.package, m.advisories.length > 0 ? m.advisories.map((item) => item.title ?? item.url).join('; ') : m.title]))}`)
      const empty = gaps.length === 0 ? 'no alerts' : 'no alerts read'
      return { data: { absent: false, incomplete, scanners, unread: existing.unread, candidates, matched }, text: parts.length > 0 ? parts.join('\n\n') : empty, warnings, notes: await capabilityNotes(tracker, 'security_alerts') }
    },
  },
  {
    name: 'todos scan', summary: 'TODO, FIXME, HACK and XXX comments in the files git lists, minus the ones an existing issue matches; reads only', usage: '[--path folder-or-file]', flags: ['path'],
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
      if (skippedEmpty > 0) warnings.push(`${skippedEmpty} TODO, FIXME, HACK or XXX comments have no text and were skipped`)
      const unread = Object.entries(skipped.unsupported).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      if (unread.length > 0) {
        const total = unread.reduce((sum, [, count]) => sum + count, 0)
        const more = unread.length > 10 ? ` and ${unread.length - 10} more types` : ''
        warnings.push(`${total} files of types the scan cannot read were not read: ${unread.slice(0, 10).map(([type, count]) => `${type} (${count})`).join(', ')}${more}`)
      }
      const parts = []
      if (candidates.length > 0) parts.push(table(['Key', 'Tag', 'Location', 'Text'], candidates.map((c) => [c.key, c.tag, c.locations.length > 1 ? `${c.locations[0]} (+${c.locations.length - 1})` : c.locations[0], c.title])))
      if (matched.length > 0) parts.push(`already in the tracker:\n${table(['Issue', 'Status', 'Reason', 'Text'], matched.map((m) => [m.issue, m.status ?? '', m.reason, m.text]))}`)
      return { data: { files, skippedEmpty, skipped, incomplete: existing.incomplete, cut: existing.cut, unread: existing.unread, candidates, matched }, text: parts.length > 0 ? parts.join('\n\n') : 'no TODO, FIXME, HACK or XXX found', warnings }
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
      if (ctx.dryRun) return { data: { branch, from }, text: `would create branch ${branch} from ${from}\ndry run: nothing was written`, notes: ctx.opt('from') === undefined ? defaultBranchNotes(ctx) : [] }
      host.createBranch(branch, { from })
      const result = await tracker.updateIssue(issue.id, { branch }, actor)
      return { data: { branch, ...result }, text: `created branch ${branch} from ${from}\n${writeText(result, ctx)}`, commit: issue.id, notes: [...(ctx.opt('from') === undefined ? defaultBranchNotes(ctx) : []), ...(await capabilityNotesOrNone(ctx))] }
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
        return { data: { ...request, existing: open !== null, pr: open }, text: `${text}\ndry run: nothing was written`, notes: [...(open ? [] : defaultBranchNotes(ctx)), ...(await capabilityNotesOrNone(ctx))] }
      }
      host.push(issue.branch)
      if (open) return { data: { ...open, existing: true }, text: `pushed ${issue.branch} to the open pull request #${open.number}${open.isDraft ? ' (draft)' : ''} ${open.url}`, notes: await capabilityNotesOrNone(ctx) }
      const pr = host.openPullRequest(request)
      return { data: { ...pr, existing: false }, text: `opened pull request #${pr.number} ${pr.url}`, notes: [...defaultBranchNotes(ctx), ...(await capabilityNotesOrNone(ctx))] }
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
      if (ctx.dryRun) return { data: { ...pr, isDraft: false }, text: `would mark pull request #${pr.number} ready for review ${pr.url}\ndry run: nothing was written`, notes: await capabilityNotesOrNone(ctx) }
      const ready = host.markReady(pr.number)
      return { data: ready, text: `marked pull request #${ready.number} ready for review ${ready.url}`, notes: await capabilityNotesOrNone(ctx) }
    },
  },
  {
    name: 'pr review', summary: 'posts one review that comments on the open pull request of an issue, with inline comments on lines of its diff', usage: '--issue <id> --body-file f [--comments-file f] [--redact]', write: true, args: [], flags: ['issue', 'body-file', 'comments-file', 'redact'],
    run: async (ctx) => {
      if (ctx.opt('issue') === undefined) throw usageError('pr review needs --issue', 'pmkit pr review --issue <id> --body-file <file>')
      if (ctx.opt('body-file') === undefined) throw usageError('pr review needs --body-file', 'pmkit pr review --issue <id> --body-file <file>')
      const host = ctx.host()
      let body = readInput(ctx.opt('body-file'))
      if (body.trim() === '') throw usageError('the review body is empty', 'Write the summary of the review to the body file')
      let comments = ctx.opt('comments-file') === undefined ? [] : reviewComments(readInput(ctx.opt('comments-file')))
      // --redact, as issues comment has it (PMK-229): the secrets of the body and of each inline comment go before GitHub gets them.
      let redacted
      if (ctx.flag('redact')) {
        const counts = {}
        const clean = (text) => {
          const result = redact(text)
          for (const [type, n] of Object.entries(result.counts)) counts[type] = (counts[type] ?? 0) + n
          return result.text
        }
        body = clean(body)
        comments = comments.map((c) => ({ ...c, body: clean(c.body) }))
        const count = Object.values(counts).reduce((sum, n) => sum + n, 0)
        redacted = { count, counts }
      }
      const issue = await (await ctx.tracker()).getIssue(ctx.opt('issue'))
      if (!issue.branch) throw usageError(`${issue.id} has no branch`, `pmkit issues branch ${issue.id}`)
      const found = host.getPullRequest({ head: issue.branch })
      if (found?.state !== 'OPEN') throw usageError(`${issue.branch} has no open pull request`, `pmkit pr open --issue ${issue.id}, or post the review on the issue with pmkit issues comment`)
      // Every inline line is checked against the diff before any write, so a dry run shows what GitHub would refuse.
      let commitId = null
      if (comments.length > 0) {
        // The head is read before the diff, so the lines checked are never newer than the commit the review is pinned to.
        commitId = host.prRefs(found.number).headRefOid
        const diff = host.prDiff(found.number)
        if (diff === null) throw usageError(`GitHub refused the diff of pull request #${found.number} as too large, so the lines of the inline comments cannot be checked`, 'Put the findings in the body and post the review without --comments-file')
        const lines = new Map()
        for (const section of splitDiff(diff)) lines.set(section.path, new Set([...(lines.get(section.path) ?? []), ...rightLines(section.text)]))
        const off = comments.map((c, i) => (lines.get(c.path)?.has(c.line) ? null : `comment ${i + 1} (${c.path}:${c.line}) is not on a line of the diff`)).filter(Boolean)
        if (off.length > 0) throw usageError(off.join('; '), 'Point each inline comment at an added or unchanged line of the diff, or move it to the body')
      }
      const pr = { number: found.number, url: found.url }
      const data = { pr, event: 'COMMENT', commitId, body, comments, ...(redacted === undefined ? {} : { redacted }) }
      const notes = [...(redacted?.count > 0 ? [`redacted ${redacted.count} ${redacted.count === 1 ? 'value' : 'values'}: ${Object.entries(redacted.counts).map(([type, n]) => `${type} ${n}`).join(', ')}`] : []), ...(await capabilityNotesOrNone(ctx))]
      const what = `a review with ${comments.length} inline ${comments.length === 1 ? 'comment' : 'comments'} on pull request #${pr.number} ${pr.url}`
      if (ctx.dryRun) return { data, text: `would post ${what}\ndry run: nothing was written`, notes }
      const review = host.postReview(pr.number, { body, comments, commitId })
      return { data: { ...data, review }, text: `posted ${what}\n${review.url}`, notes }
    },
  },
  {
    name: 'pr status', summary: 'pull request, checks, reviews and the blockers verdict of a branch', usage: '[--branch b]', args: [], flags: ['branch'],
    run: async (ctx) => {
      const host = ctx.host()
      const branch = ctx.opt('branch') ?? host.currentBranch()
      if (branch === '') throw new PmkitError('INVALID_INPUT', 'no current branch (detached HEAD)', 'pass --branch <branch>, or switch to a branch')
      const pr = host.getPullRequest({ head: branch }, { detail: true })
      const checks = pr ? host.prChecks(pr.number) : []
      const reviews = pr?.detail.reviews ?? []
      // The checks are read once: collectBlockers gets the list this command already has. A merged or closed pull request reads nothing more.
      // A blocker read that fails for a reason that may pass (rate limit, 5xx, network) must not lose the pull request and its checks:
      // the verdict is unknown, with the cause, and the reads after it are not made.
      let found = null
      let failed = null
      if (pr) {
        try {
          found = collectBlockers({ ...host, prChecks: () => checks }, pr)
        } catch (error) {
          if (!isPmkitError(error) || (error.code !== 'UPSTREAM' && error.code !== 'RATE_LIMITED')) throw error
          failed = { area: 'blockers', code: error.code, message: error.message, nextStep: error.nextStep }
          found = { blocked: null, blocking: [], pending: [], unknown: [], unchecked: [failed] }
        }
      }
      const lines = pr
        ? [`#${pr.number} ${pr.title} (${pr.state}${pr.isDraft ? ', draft' : ''})`, pr.url, `checks: ${checks.length === 0 ? '(none)' : checks.map((c) => `${c.name} ${c.bucket ?? c.state}${c.bucket === 'fail' && c.runId ? ` (ci logs --run ${c.runId})` : ''}`).join(', ')}`, `reviews: ${reviews.length === 0 ? '(none)' : reviews.map((r) => r.state).join(', ')}`]
        : [`no pull request for ${branch}`]
      if (failed) lines.push(`blockers: not verified (${failed.message})`)
      else if (pr?.state === 'OPEN') lines.push(`blockers: ${blockedText(prSummary(pr, found))}`)
      const blockers = found && { blocked: found.blocked, blocking: found.blocking, pending: found.pending, unknown: found.unknown, unchecked: found.unchecked }
      return { data: { branch, pr: withoutDetail(pr), checks, reviews, blockers }, text: lines.join('\n'), notes: await capabilityNotesOrNone(ctx) }
    },
  },
  {
    name: 'deploys list', summary: 'deployments of the repository with the state of the latest status of each', usage: '[--environment e] [--limit n]', args: [], flags: ['environment', 'limit'],
    run: async (ctx) => {
      const limit = ctx.opt('limit') === undefined ? undefined : whole('limit', ctx.opt('limit'))
      if (limit !== undefined && (limit < 1 || limit > 100)) throw usageError('--limit must be from 1 to 100')
      if (ctx.opt('environment') === '') throw usageError('--environment must not be empty')
      const deploys = ctx.host().listDeploys({ environment: ctx.opt('environment'), limit })
      const lines = deploys.map((d) => `${d.environment} ${d.state ?? 'unknown'} ${d.ref} ${d.sha.slice(0, 7)} ${d.createdAt}${d.url ? ` ${d.url}` : ''}`)
      const warnings = unknownDeployWarnings(deploys)
      return { data: { deploys }, text: lines.length === 0 ? 'no deployments' : lines.join('\n'), warnings, notes: await capabilityNotesOrNone(ctx) }
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
      if (found === null) return { data: { branch, run: null, truncated: false }, text: `no failed run on ${branch}`, notes: await capabilityNotesOrNone(ctx) }
      const { log, truncated } = tailLines(found.log, tail)
      const failed = FAILED_RUN.has(found.conclusion)
      const hasLog = found.log.trim() !== ''
      const label = `run ${found.runId}${found.workflowName ? ` ${found.workflowName}` : ''}`
      const logNote = found.conclusion === null && !hasLog ? `${label} has not finished (${found.status ?? 'unknown status'}), so it has no failed-step log yet`
        : !failed ? `${label} did not fail (${found.conclusion ?? found.status}), ${hasLog ? 'the log below holds its failed steps' : 'so it has no failed-step log'}`
          : hasLog ? null
            : found.conclusion === 'startup_failure' ? `${label} ended with startup_failure: it never started a job, so it has no log`
              : `${label} failed (${found.conclusion}) but GitHub returned no log for it`
      const newer = found.newerRun
      const supersededNote = newer ? `newer run ${newer.runId} of ${found.workflowName ?? 'the same workflow'} ended ${newer.conclusion} on ${newer.createdAt}, so this failure may already be fixed` : null
      const run = { ...found, log, failed, hasLog, logNote, supersededNote }
      const when = [found.createdAt, found.headSha?.slice(0, 7)].filter(Boolean).join(', ')
      return { data: { branch, run, truncated }, text: `${label}${when ? `, ${when}` : ''}${truncated ? `, last ${tail} lines` : ''}\n${supersededNote === null ? '' : `${supersededNote}\n`}${logNote === null ? '' : `${logNote}\n`}${hasLog ? log : ''}`, notes: await capabilityNotesOrNone(ctx) }
    },
  },
  {
    name: 'pr diff', summary: 'diff of the pull request of a branch, or the local diff against the base branch when it has none', usage: '[--branch b] [--base b] [--max-lines n] [--file path]', args: [], flags: ['branch', 'base', 'max-lines', 'file'],
    run: async (ctx) => {
      const maxLines = ctx.opt('max-lines') === undefined ? 2000 : whole('max-lines', ctx.opt('max-lines'))
      if (maxLines < 1) throw usageError('--max-lines must be at least 1')
      const only = ctx.opt('file')
      if (only === '') throw usageError('--file must not be empty', 'Pass a path from the files of pr diff --json')
      const requested = ctx.opt('base')
      if (requested !== undefined && (requested === '' || requested.startsWith('-'))) throw new PmkitError('INVALID_INPUT', `base "${requested}" is not a valid branch name`, 'Use a branch name that does not start with -')
      const host = ctx.host()
      const branch = ctx.opt('branch') ?? host.currentBranch()
      if (branch === '') throw new PmkitError('INVALID_INPUT', 'no current branch (detached HEAD)', 'pass --branch <branch>, or switch to a branch')
      const found = host.getPullRequest({ head: branch })
      const notes = []
      // Only an open or merged pull request holds the work of the branch. A closed one is not what the review looks at.
      let pr = found && (found.state === 'OPEN' || found.state === 'MERGED') ? found : null
      if (found && !pr) notes.push(`pull request #${found.number} is closed without merge, so this is the local diff`)
      // The refs of a pull request are read once, and only by the paths that need them.
      let refsOf
      const prRefs = () => (refsOf ??= host.prRefs(found.number))
      // gh returns the newest merged pull request of a name, so a reused branch name finds an old one. Its head is then not on the branch
      // (a tip of the local branch or of origin, or behind one: the local branch may be ahead of or behind what was merged).
      if (pr?.state === 'MERGED') {
        const onBranch = host.branchHas(branch, () => prRefs().headRefOid)
        if (onBranch === false) {
          notes.push(`pull request #${pr.number} is merged and its head is not on ${branch}, so it is not used and this is the local diff`)
          pr = null
        }
      }
      let full = null
      let local = null
      let incomplete = false
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
        // A stacked pull request is compared with its own base, not the default branch. --base still wins.
        const prBase = requested === undefined && pr ? prRefs().baseRefName : undefined
        const diffAgainst = (name) => host.localDiff({ branch, base: name })
        if (prBase !== undefined) {
          try {
            local = diffAgainst(prBase)
          } catch (error) {
            if (error.code !== 'INVALID_INPUT' || !/base branch/.test(error.message)) throw error
            incomplete = true
            notes.push(...defaultBranchNotes(ctx))
            local = diffAgainst(defaultBranch(ctx))
            notes.push(`the base ${prBase} of pull request #${pr.number} does not exist here or on origin, so this is the local diff against ${local.base}; run git fetch origin`)
          }
        } else {
          if (requested === undefined) notes.push(...defaultBranchNotes(ctx))
          local = diffAgainst(requested ?? defaultBranch(ctx))
        }
        full = local.diff
        if (local.uncommitted) notes.push('the local diff includes the uncommitted changes of tracked files')
        // A merged branch no longer differs from its base, so an empty range of commits says nothing about the pull request,
        // whatever the working tree adds to the diff.
        if (pr?.state === 'MERGED' && local.committedEmpty) {
          incomplete = true
          notes.push(`pull request #${pr.number} is merged and GitHub refused its diff as too large, and the commits of ${branch} no longer differ from ${local.base}, so the diff is not available`)
        }
      }
      // The notes about the working tree are warnings: a tree that cannot be read must not stop the command.
      let tree = local
      let treeError = local?.treeError ?? null
      if (local === null) {
        try { tree = host.workingTree(branch) } catch (error) { treeError = error.message }
      }
      if (treeError !== null) {
        incomplete = true
        notes.push(`could not read the working tree of ${branch} (${treeError.split('\n')[0]}), so its uncommitted and untracked files are not checked`)
      }
      if (source === 'pull_request' && tree?.uncommitted) notes.push(`${branch} has uncommitted changes, so the pull request diff does not include them`)
      if (tree?.untracked > 0) notes.push(`${tree.untracked} untracked ${tree.untracked === 1 ? 'file is' : 'files are'} not in the diff`)
      const base = local?.base ?? null
      // A cut diff is read again file by file: --file keeps the sections of one path, and the cut then applies to that file.
      let sections = splitDiff(full)
      if (only !== undefined) {
        sections = sections.filter((section) => section.path === only)
        if (sections.length === 0) throw new PmkitError('INVALID_INPUT', `${only} is not in the diff of ${branch}${incomplete ? ', which is incomplete' : ''}`, 'Pass a path from the files of pr diff --json')
        full = sections.map((section) => section.text).join('')
      }
      const lineCount = (text) => (text === '' ? 0 : text.replace(/\n$/, '').split('\n').length)
      let seen = 0
      const files = sections.map((section) => {
        const lines = lineCount(section.text)
        seen += lines
        return { path: section.path, lines, cut: seen > maxLines }
      })
      const all = full === '' ? [] : full.replace(/\n$/, '').split('\n')
      const truncated = all.length > maxLines
      const diff = truncated ? `${all.slice(0, maxLines).join('\n')}\n` : full
      const size = `${only === undefined ? '' : `${only}, `}${truncated ? `first ${maxLines} of ${all.length} lines` : `${all.length} lines`}`
      const head = source === 'pull_request' ? `pull request #${pr.number}, ${size}` : `local diff of ${branch} against ${base}, ${size}`
      return { data: { branch, source, pr, base, uncommitted: tree?.uncommitted ?? false, uncommittedIncluded: local?.uncommitted ?? false, untracked: tree?.untracked ?? 0, incomplete, diff, truncated, lines: all.length, file: only ?? null, files }, text: `${head}\n${diff}`, notes: [...notes, ...(await capabilityNotesOrNone(ctx))] }
    },
  },
  {
    name: 'pr blockers', summary: 'what blocks the pull request of a branch: checks, reviews, conflicts, open threads and policies; reads only', usage: '[--branch b]', args: [], flags: ['branch'],
    run: async (ctx) => {
      const host = ctx.host()
      const branch = ctx.opt('branch') ?? host.currentBranch()
      if (branch === '') throw new PmkitError('INVALID_INPUT', 'no current branch (detached HEAD)', 'pass --branch <branch>, or switch to a branch')
      const pr = host.getPullRequest({ head: branch }, { detail: true })
      if (!pr) return { data: { branch, pr: null, blocked: null }, text: `no pull request for ${branch}`, notes: await capabilityNotesOrNone(ctx) }
      const found = collectBlockers(host, pr)
      return { data: { branch, pr: withoutDetail(pr), ...found }, text: blockersText(pr, found), notes: await capabilityNotesOrNone(ctx) }
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
      return { data, text: lines.join('\n'), commit: moved.length > 0 ? moved.map((m) => m.id).join(' ') : undefined, notes: await capabilityNotesOrNone(ctx) }
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
      const head = `checked: ${c.issues} issues, ${c.epics} epics, ${c.sprints} sprints, ${c.milestones} milestones, ${c.releases} releases, ${c.goals} goals, ${c.comments} comments, ${c.views} views`
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
      updatesByEpic[epic.id] = null
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
    updatesNotChecked: epicsUpdatesNotChecked(epics, { updatesByEpic, today, windowDays }),
    ci,
    problems,
  }
  return { data: report, text: risksText(report), warnings, notes: [...cycleNotes, ...(system === 'none' ? [] : defaultBranchNotes(ctx)), ...(await metricNotes(tracker, 'stalled-issue history'))] }
}

/** The roadmap review (PMK-66): epics, milestones, delays and missing status updates. Writes nothing. */
async function runRoadmapReview(ctx) {
  const tracker = await ctx.tracker()
  const today = ctx.now().toISOString().slice(0, 10)
  const windowDays = ctx.settings().defaults.status_update_window_days ?? 14
  const warnings = []
  const problems = []
  const notes = new Set()
  // Why a section is missing: the code of the error that cost it. Only NOT_SUPPORTED means the tracker lacks it.
  const sectionErrors = {}
  // After a rate limit every further read would fail the same way, so the per-epic reads stop.
  let rateLimited = false
  // Auth and configuration fail every read the same way, so they stop the command; anything else costs one value.
  const recoverable = (error) => isPmkitError(error) && error.code !== 'AUTH' && error.code !== 'NOT_CONFIGURED'
  // A list the tracker lacks, or that failed for a reason other than auth or config, costs its section.
  const section = async (read, capability, what) => {
    try {
      return await read()
    } catch (error) {
      if (!recoverable(error)) throw error
      sectionErrors[what] = error.code
      if (error.code === 'RATE_LIMITED') rateLimited = true
      if (error.code === 'NOT_SUPPORTED') {
        warnings.push(`${what} not checked: ${error.message}`)
        for (const note of await capabilityNotesOrNone(ctx, capability)) notes.add(note)
      } else {
        problems.push({ id: what, code: error.code, message: error.message })
        warnings.push(`${what} not checked: ${error.code} ${error.message}`)
      }
      return null
    }
  }

  const { issues, problems: found, hasMore } = await tracker.searchIssues({ archived: true })
  problems.push(...found.map(({ id, code, message }) => ({ id, code, message })))
  warnings.push(...found.map(problemLine))
  if (hasMore === true) warnings.push('the tracker has more issues than pmkit read, so milestone issue counts are unknown')
  const epics = await section(() => tracker.listDeliverables(), 'deliverables', 'epics')
  // After a rate limit on the epic list the next read would fail the same way: leave the milestones unread.
  let milestones = null
  if (rateLimited) {
    sectionErrors.milestones = 'RATE_LIMITED'
    warnings.push('milestones not checked: rate limited while listing epics')
  } else milestones = await section(() => tracker.listMilestones(), 'deliverables', 'milestones')
  // The Local tracker skips an epic or milestone file that does not parse; say so, and keep the milestone as a row.
  const local = await ctx.local()
  if (local !== null) {
    const unreadable = local.unreadableRecords()
    for (const { id, code, message } of [...unreadable.epics, ...unreadable.milestones]) {
      problems.push({ id, code, message })
      warnings.push(`${id}: ${code} ${message}`)
    }
    if (milestones !== null) milestones = [...milestones, ...unreadable.milestones.map(({ id }) => ({ id, name: id, unreadable: true }))]
  }

  const progressByEpic = {}
  const updatesByEpic = {}
  let updatesSupported = true
  // One epic's failed read is null for that epic only. A tracker without status updates stops asking after the first.
  const perEpic = async (id, read, { updates = false } = {}) => {
    try {
      return await read()
    } catch (error) {
      if (!recoverable(error)) throw error
      if (error.code === 'NOT_SUPPORTED' && updates) {
        updatesSupported = false
        warnings.push(`status updates not checked: ${error.message}`)
        for (const note of await capabilityNotesOrNone(ctx, 'status_update')) notes.add(note)
        return null
      }
      if (error.code === 'RATE_LIMITED') rateLimited = true
      problems.push({ id, code: error.code, message: error.message })
      warnings.push(`${id}: ${error.code} ${error.message}`)
      return null
    }
  }
  const skipped = []
  for (const epic of epics ?? []) {
    if (rateLimited) {
      skipped.push(epic.id)
      progressByEpic[epic.id] = null
      updatesByEpic[epic.id] = null
      continue
    }
    progressByEpic[epic.id] = await perEpic(epic.id, () => tracker.deliverableProgress(epic.id))
    if (progressByEpic[epic.id]?.hasMore === true) warnings.push(`${epic.id}: the tracker has more issues in this epic than pmkit read; the progress counts are partial`)
    // A rate limit on this epic's progress read skips its updates read: say so as for the epics after it.
    if (updatesSupported && rateLimited) skipped.push(epic.id)
    updatesByEpic[epic.id] = updatesSupported && !rateLimited ? await perEpic(epic.id, () => tracker.listStatusUpdates(epic.id), { updates: true }) : null
  }
  if (skipped.length) warnings.push(`rate limited: the reads of ${skipped.join(', ')} were skipped, so their progress and status updates are not checked`)

  const report = buildRoadmapReview({ today, windowDays, issues, issuesComplete: hasMore !== true && found.length === 0, epics, milestones, progressByEpic, updatesByEpic, sectionErrors })
  report.problems = problems
  report.incomplete ||= problems.length > 0
  return { data: report, text: roadmapReviewText(report), warnings, notes: [...notes] }
}

/** The warning for deployments whose status could not be read (state null), as a list of zero or one line. */
function unknownDeployWarnings(deploys) {
  const unknown = deploys.filter((d) => d.state === null)
  return unknown.length === 0 ? [] : [`the state of ${unknown.length} deployment(s) is unknown: ${unknown[0].statusError}`]
}

/** What is left for a release (or a milestone, or a sprint): open issues, their open pull requests and the repository deploys. Writes nothing. */
async function runReleaseReadiness(ctx) {
  const tracker = await ctx.tracker()
  const next = 'pmkit release-readiness --help'
  const given = ['release', 'milestone', 'sprint'].filter((name) => ctx.opt(name) !== undefined)
  if (given.length > 1) throw usageError(`--${given.join(', --')} exclude each other`, next)
  const capabilities = (await tracker.capabilities()).capabilities
  const releasesOn = capabilities.find((c) => c.id === 'releases').path !== 'absent'
  if (!releasesOn && ctx.opt('release') !== undefined) {
    throw new PmkitError('NOT_SUPPORTED', 'release readiness by release needs releases, which this workspace does not have', capabilities.find((c) => c.id === 'releases').enableHint)
  }
  const warnings = []
  const notes = []
  const problems = []
  let truncated = false
  const notSupported = (error) => isPmkitError(error) && error.code === 'NOT_SUPPORTED'
  // Every issue read goes through here: a cut read (hasMore) marks the report incomplete, and a file that does not parse is listed once.
  const readIssues = async (filter) => {
    const found = await tracker.searchIssues(filter)
    for (const problem of found.problems) {
      if (problems.some((known) => known.id === problem.id)) continue
      problems.push({ id: problem.id, code: problem.code, message: problem.message })
      warnings.push(problemLine(problem))
    }
    if (found.hasMore === true) {
      if (!truncated) warnings.push('Linear has more issues than the 1000 pmkit read, so the basis and the open work may be incomplete')
      truncated = true
    }
    return found.issues.filter((issue) => !issue.archived)
  }

  // The automatic pick reads the releases, the milestones and the active sprint. A selector reads only what it needs, so a
  // stub or a transient error in a read it does not use cannot stop it. A read that failed leaves its rung "not read" (the
  // report is incomplete); only a selector that needs the read, or a pick with nothing left, turns that error into the answer.
  const unread = []
  const unreadErrors = []
  const tolerant = async (rung, id, read, fallback) => {
    try {
      return await read()
    } catch (error) {
      // Only a transient error (and the release stub) is "not read". Any other error is a real failure and stops the command.
      if (!isPmkitError(error) || !(error.code === 'RATE_LIMITED' || error.code === 'UPSTREAM' || (rung === 'release' && notSupported(error)))) {
        if (rung === 'milestone' && notSupported(error)) return fallback
        throw error
      }
      unread.push(rung)
      unreadErrors.push(error)
      problems.push({ id, code: error.code, message: error.message })
      warnings.push(`${id} not read: ${error.message}`)
      return fallback
    }
  }
  const auto = ctx.opt('release') === undefined && ctx.opt('milestone') === undefined && ctx.opt('sprint') === undefined

  let activeSprint = null
  let cyclesAbsent = false
  const readCycle = async () => {
    try {
      activeSprint = (await tracker.currentCycle()) ?? null
    } catch (error) {
      if (!notSupported(error)) throw error
      cyclesAbsent = true
      notes.push(...(await capabilityNotes(tracker, 'cycles')))
    }
  }
  if (!auto && ctx.opt('sprint') === 'current') await readCycle()
  let selector = null
  if (ctx.opt('release') !== undefined) selector = { release: await tracker.getRelease(ctx.opt('release')) }
  else if (ctx.opt('milestone') !== undefined) selector = { milestone: await tracker.getMilestone(ctx.opt('milestone')) }
  else if (ctx.opt('sprint') !== undefined) {
    const id = ctx.opt('sprint')
    if (id === 'current') {
      if (cyclesAbsent) throw new PmkitError('NOT_SUPPORTED', 'there is no current sprint: this tracker has no cycles', `pmkit release-readiness --milestone <id>${releasesOn ? ' or --release <id>' : ''}`)
      if (activeSprint === null) throw new PmkitError('INVALID_INPUT', 'there is no active sprint', 'pmkit cycle list')
      selector = { sprint: activeSprint }
    } else {
      const sprint = (await tracker.listCycles({})).find((item) => item.id === id)
      if (sprint === undefined) throw new PmkitError('NOT_FOUND', `sprint ${id} does not exist`, 'pmkit cycle list')
      selector = { sprint }
    }
  }
  // The automatic pick reads one rung at a time and stops at the first that has something, so a read it does not reach cannot fail it.
  const releases = releasesOn && auto ? await tolerant('release', 'releases', () => tracker.listReleases(), null) : releasesOn ? [] : null
  const planned = (releases ?? []).some((release) => release.state === 'planned')
  // The whole tracker is read only when the basis needs it: a milestone, or the milestone rung after no planned release.
  const needsAll = selector?.milestone !== undefined || (selector === null && !planned)
  const milestones = auto && !planned ? await tolerant('milestone', 'milestones', () => tracker.listMilestones(), []) : []
  const everything = needsAll ? await readIssues({}) : []
  const openMilestones = new Set(everything.filter((i) => i.milestone && i.status.category !== 'done' && i.status.category !== 'canceled').map((i) => i.milestone))
  if (auto && !planned && !milestones.some((m) => openMilestones.has(m.id))) await tolerant('sprint', 'cycles', async () => { await readCycle() })
  const choice = chooseReadinessBasis({
    selector,
    releases,
    milestones,
    openMilestones,
    activeSprint,
    cyclesAbsent,
    unread,
  })
  if (choice.basis === null) {
    // Nothing was picked and a read failed: the read error is the answer, not "nothing to check".
    if (unreadErrors.length > 0) throw unreadErrors.find((e) => e.code !== 'NOT_SUPPORTED') ?? unreadErrors[0]
    const sprintHint = cyclesAbsent ? '' : ' or pmkit cycle open --start <date>'
    throw new PmkitError('INVALID_INPUT', `there is no planned release, no milestone with an open issue and no ${cyclesAbsent ? 'sprint (this tracker has no cycles)' : 'active sprint'} to check`, `pmkit release create <id> or pmkit milestone create <id>${sprintHint}`)
  }
  if (!releasesOn) notes.push(...(await capabilityNotes(tracker, 'releases')))
  // The release and the sprint are filtered by the tracker, so a long list cuts the other issues and not these. A milestone has no filter.
  const issues = choice.basis === 'milestone'
    ? everything.filter((issue) => issue.milestone === choice.source.id)
    : await readIssues(choice.basis === 'release' ? { release: choice.source.id } : { sprint: choice.source.id })

  const system = ctx.config().pmkit.git_host?.system ?? 'none'
  const NO_HOST_READ = 'so pull requests and deploys are not checked'
  let gitHost = { system, available: true }
  let prs = null
  let prsIncomplete = false
  let deploys = null
  const affectsOneCall = (error) => isPmkitError(error) && (error.code === 'RATE_LIMITED' || error.code === 'UPSTREAM')
  // Collected apart from `warnings`, so a host that turns out to be unavailable drops what it said about the lists it read.
  const hostWarnings = []
  try {
    const host = ctx.host()
    try {
      prs = host.listPullRequests()
      if (prs.length === 200) {
        prsIncomplete = true
        hostWarnings.push('only the 200 most recently created open pull requests were read')
      }
    } catch (error) {
      if (!affectsOneCall(error)) throw error
      prs = { error: errorOf(error) }
      hostWarnings.push(`pull requests not checked: ${error.message}`)
    }
    try {
      deploys = host.listDeploys({})
      // The tag's own deploy may be older than the newest 20: ask for the deploys made for the tag, as `v1` and as `refs/tags/v1`.
      if (choice.basis === 'release' && choice.source.tag) {
        const known = new Set(deploys.map((d) => d.id))
        for (const ref of [choice.source.tag, `refs/tags/${choice.source.tag}`]) {
          for (const deploy of host.listDeploys({ ref, limit: 100 })) if (!known.has(deploy.id)) { known.add(deploy.id); deploys.push(deploy) }
        }
        deploys.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      }
    } catch (error) {
      if (!affectsOneCall(error)) throw error
      deploys = { error: errorOf(error) }
      hostWarnings.push(`deploys not checked: ${error.message}`)
    }
    if (Array.isArray(deploys)) hostWarnings.push(...unknownDeployWarnings(deploys))
    warnings.push(...hostWarnings)
  } catch (error) {
    if (isPmkitError(error) && error.code === 'NOT_SUPPORTED') warnings.push(`no git host is configured, ${NO_HOST_READ}`)
    else if (isPmkitError(error) && (error.code === 'NOT_CONFIGURED' || error.code === 'AUTH')) warnings.push(`${error.message}, ${NO_HOST_READ}; next: ${error.nextStep}`)
    else throw error
    gitHost = { system, available: false, reason: errorOf(error) }
    prs = null
    prsIncomplete = false
    deploys = null
  }
  const report = buildReadiness({ choice, issues, prs, prsIncomplete, deploys, gitHost, problems, truncated })
  return { data: report, text: readinessText(report), warnings, notes }
}

// Errors a dry run reports for one issue. Any other error is about the change or the tracker, so it stops the whole command.
const PER_ISSUE_CODES = ['INVALID_INPUT', 'NOT_FOUND', 'CONFLICT']

async function runBulk(ctx) {
  const tracker = await ctx.tracker()
  const [kind, value] = ctx.args
  const view = ctx.opt('view')
  // A hosted tracker's view keeps the tracker's own filter, which pmkit cannot check narrows the set, so it is refused before any read.
  if (view !== undefined && ctx.config().system !== 'local') throw usageError(`${ctx.config().system === 'linear' ? 'Linear' : 'a hosted'} view ${view} keeps the tracker's own filter, so pmkit cannot check that it narrows the set`, 'Pass filter flags to issues bulk instead of --view')
  const scale = kind === 'estimate' ? ((await tracker.discover()).estimate.scale ?? []) : []
  const change = parseChange(kind, value, { status: ctx.opt('status'), linkKind: ctx.opt('kind'), remove: ctx.flag('remove'), scale })
  const max = ctx.opt('max') === undefined ? DEFAULT_MAX : whole('max', ctx.opt('max'))
  if (max < 1 || max > HARD_MAX) throw usageError(`--max must be from 1 to ${HARD_MAX}`, 'Narrow the filter instead of raising --max')

  if (kind === 'unarchive' && ctx.config().system !== 'local') throw new PmkitError('NOT_SUPPORTED', 'unarchive works on the Local tracker only', "pmkit issues restore <id> brings a deleted issue back from Linear's trash")
  // Only unarchive reads --archived: for every other change it stays an unknown option, as before.
  if (kind !== 'unarchive' && ctx.flag('archived')) throw usageError('unknown option --archived: only bulk unarchive takes it', 'Run pmkit issues bulk --help')
  let filter = issueFilter(ctx)
  if (view !== undefined && Object.keys(filter).length > 0) throw usageError('issues bulk takes --view or filter flags, not both', 'Save the filter with pmkit views save, or drop --view')
  if (view === undefined) checkBulkFilter(filter, 'the filter', undefined, kind)
  let found = view === undefined ? await tracker.searchIssues(filter) : await tracker.runView(view)
  if (view !== undefined) {
    filter = found.view.filter
    checkBulkFilter(filter, `view ${view}`, view, kind)
  }
  // `archived` returns the live issues too; unarchive brings back the archived ones only, so the preview never lists a live issue.
  if (kind === 'unarchive') found = { ...found, issues: found.issues.filter((issue) => issue.archived) }
  if (found.hasMore === true) throw usageError('the tracker has more matching issues than pmkit read, so the set is cut and nothing can be written from it', 'Narrow the filter')
  if (found.issues.length > max) {
    throw usageError(`the filter matches ${found.issues.length} issues, more than the ${max} one bulk change takes`, `Narrow the filter${max < HARD_MAX ? `, or raise --max up to ${HARD_MAX}` : ''}`)
  }

  const actor = await ctx.actor()
  const results = []
  for (const issue of found.issues) {
    try {
      results.push(await change.apply(tracker, issue, actor, { dryRun: true }))
    } catch (error) {
      if (!isPmkitError(error) || !PER_ISSUE_CODES.includes(error.code)) throw error
      results.push({ error: { code: error.code, message: error.message, nextStep: error.nextStep } })
    }
  }
  const wrong = valueError(change, results)
  // One issue is not "wrong for every issue": its own error keeps its code (NOT_FOUND, CONFLICT).
  if (wrong) throw new PmkitError(results.length === 1 ? wrong.code : 'INVALID_INPUT', `${`${change.kind} ${change.value}`.trim()}: ${wrong.message}`, wrong.nextStep ?? 'Correct the value, then run the dry run again')
  const preview = buildPreview({ change, found, results })
  const releaseWarnings = kind === 'release' && value !== 'none' ? await releasedWarnings(ctx, { release: value }) : []
  const archiveWarnings = kind === 'archive' && preview.writes > 0 ? ['archived issues leave every list and are never matched by a bulk change again'] : []
  const data = { ...preview, filter, view: view ?? null, max, dryRun: ctx.dryRun, warnings: [...releaseWarnings, ...archiveWarnings] }
  const warnings = [...found.problems.map(problemLine), ...releaseWarnings, ...archiveWarnings]
  if (ctx.dryRun) return { data, text: bulkText(preview, { dryRun: true }), warnings }

  if (preview.blockers.length > 0) {
    throw new PmkitError('INVALID_INPUT', `issues bulk cannot write: ${preview.blockers.join('; ')}`, 'Fix what the blockers name, then run the dry run again')
  }
  if (preview.writes === 0) return { data: { ...data, applied: [] }, text: `${bulkText(preview, { dryRun: false })}\nnothing to write`, warnings }
  const expect = ctx.opt('expect')
  if (typeof expect !== 'string' || expect === '') {
    throw new PmkitError('INVALID_INPUT', 'issues bulk needs the digest of its preview before it writes', 'Run the same command with --dry-run, show the preview, then pass its digest with --expect')
  }
  if (expect !== preview.digest) {
    throw new PmkitError('CONFLICT', 'the issues changed since the preview, so nothing was written', 'Run the dry run again and confirm the new preview', { expected: expect, digest: preview.digest })
  }

  const todo = found.issues.filter((_, i) => preview.items[i].state === 'change')
  const applied = []
  for (const issue of todo) {
    try {
      await change.apply(tracker, issue, actor, { dryRun: false })
      applied.push(issue.id)
    } catch (error) {
      const code = isPmkitError(error) ? error.code : 'UPSTREAM'
      const stopped = { applied, failed: { id: issue.id, code, message: error.message }, remaining: todo.slice(applied.length + 1).map((item) => item.id) }
      const stop = new PmkitError(code, `${issue.id} failed after ${applied.length} of ${todo.length} writes: ${error.message}`,
        'The issues in applied are written and the ones in remaining are not. Run the dry run again for what is left; bulk does not retry')
      stop.written = {
        data: stopped,
        text: [`applied: ${applied.join(', ') || '(none)'}`, `failed: ${issue.id} ${code} ${error.message}`, `remaining: ${stopped.remaining.join(', ') || '(none)'}`].join('\n'),
      }
      if (applied.length > 0) stop.partialCommit = `${`${change.kind} ${change.value}`.trim()} (${applied.length} of ${todo.length})`
      throw stop
    }
  }
  return { data: { ...data, applied }, text: `${bulkText(preview, { dryRun: false })}\nwritten: ${applied.join(', ')}`, commit: `${`${change.kind} ${change.value}`.trim()} (${applied.length} issues)`, warnings }
}

const AGENT_CATEGORIES = ['triage', 'backlog', 'todo', 'in_progress', 'in_review']

/**
 * The host with the branch protection and the rules of a base read once per base. They do not change between pull requests.
 * A refusal (403 or 404) is as stable as an answer, so it is kept and thrown again; a failure that may pass (a 502, a rate
 * limit) is not kept.
 */
function blockerReadCache(host) {
  const protections = new Map()
  const rules = new Map()
  const once = (cache, read) => (base) => {
    if (!cache.has(base)) {
      try {
        cache.set(base, { value: read(base) })
      } catch (error) {
        if (!isPmkitError(error) || error.code !== 'UPSTREAM' || ![403, 404].includes(error.httpStatus)) throw error
        cache.set(base, { error })
      }
    }
    const kept = cache.get(base)
    if (kept.error) throw kept.error
    return kept.value
  }
  return Object.assign(Object.create(host), {
    branchProtection: once(protections, (base) => host.branchProtection(base)),
    branchRules: once(rules, (base) => host.branchRules(base)),
  })
}

/** The delegation of an issue from its comments. A comment read that fails marks the issue `unknown` with a problem; NOT_CONFIGURED and AUTH stop the command. */
async function readDelegation(tracker, id, holder) {
  try {
    const comments = await tracker.listComments(id)
    return { delegation: delegationOf(comments, holder, { incomplete: comments.truncated === true }), problem: null }
  } catch (error) {
    // A comment file that does not parse throws FrontmatterError, which is not a PmkitError: it marks this issue, never the whole command.
    const broken = error instanceof FrontmatterError
    if (!broken && (!isPmkitError(error) || error.code === 'NOT_CONFIGURED' || error.code === 'AUTH')) throw error
    return { delegation: { state: 'unknown', agent: null, by: null, comment: null, at: null }, problem: { code: broken ? 'INVALID_INPUT' : error.code, message: `the comments could not be read: ${error.message}` } }
  }
}


/** The delegation and the pull request state of every open issue assigned to an agent member. Writes nothing. */
async function runTrackAgents(ctx) {
  const agent = ctx.opt('agent') === undefined ? null : agentFilter(ctx.opt('agent'))
  const tracker = await ctx.tracker()
  const entry = (await tracker.capabilities()).capabilities.find((c) => c.id === 'agent_delegation')
  if (entry?.path === 'absent') throw new PmkitError('NOT_SUPPORTED', 'this tracker has no agent delegation, so there are no agent issues to track', entry.enableHint)
  // Linear delegates natively: the agent is the issue's delegate, not an agent: assignee, so the issue list would miss every agent issue.
  // The pull requests of bot authors stand in for it (PMK-215).
  if (entry?.detail?.unsupported?.includes('issues track-agents')) {
    // The id that `delegate` shows (agent:<Linear user id>) never matches a login, so it would filter everything out silently.
    if (/^\s*agent:/i.test(String(ctx.opt('agent') ?? ''))) {
      throw new PmkitError('INVALID_INPUT', 'on this tracker --agent matches the login of the pull request author, and an agent:<id> never does', 'Use --agent <login>, for example --agent claude for the author app/claude')
    }
    return runTrackAgentPullRequests(ctx, tracker, agent)
  }
  const found = await tracker.searchIssues({ categories: AGENT_CATEGORIES })
  const warnings = problemWarnings(found.problems)
  const notes = []
  let incomplete = found.problems.length > 0
  if (found.hasMore === true) {
    incomplete = true
    warnings.push('the issue read was cut before the end, so the list may miss agent issues')
  }
  let host = null
  try {
    host = ctx.host()
  } catch (error) {
    if (!isPmkitError(error) || error.code !== 'NOT_SUPPORTED') throw error
    notes.push('git_host is none, so the list has no pull request state')
  }
  const cachedHost = host === null ? null : blockerReadCache(host)
  let rateLimited = false
  const rows = []
  for (const issue of found.issues.filter((item) => AGENT_ID.test(item.assignee ?? '') && (agent === null || item.assignee.toLowerCase() === `agent:${agent}`))) {
    const row = { id: issue.id, title: issue.title, status: issue.status?.name ?? null, assignee: issue.assignee, branch: issue.branch ?? null, delegation: null, pr: null, problems: [] }
    const read = await readDelegation(tracker, issue.id, issue.assignee)
    row.delegation = read.delegation
    if (read.problem) row.problems.push(read.problem)
    if (host !== null) {
      if (!row.branch) row.pr = { state: 'no_branch' }
      else if (rateLimited) row.pr = { state: 'unknown', code: 'RATE_LIMITED', message: 'not read: GitHub rate limit reached earlier in this run' }
      else {
        try {
          const pr = cachedHost.getPullRequest({ head: row.branch }, { detail: true })
          row.pr = pr ? prSummary(pr, collectBlockers(cachedHost, pr)) : { state: 'no_pr' }
        } catch (error) {
          // A missing or logged out gh fails every lookup the same way, so it stops the command.
          if (!isPmkitError(error) || error.code === 'NOT_CONFIGURED' || error.code === 'AUTH') throw error
          row.pr = { state: 'unknown', code: error.code, message: error.message }
          row.problems.push({ code: error.code, message: `the pull request could not be read: ${error.message}${error.code === 'RATE_LIMITED' ? '; the pull requests of the issues after this one were not read' : ''}` })
          if (error.code === 'RATE_LIMITED') rateLimited = true
        }
      }
    }
    if (row.problems.length > 0 || row.delegation.state === 'unknown' || row.pr?.state === 'unknown' || row.pr?.blocked === null || (row.pr?.unchecked ?? []).length > 0) incomplete = true
    for (const problem of row.problems) warnings.push(`${row.id}: ${problem.message}`)
    rows.push(row)
  }
  // The causes that happened, so the line never blames GitHub for an issue file with a conflict marker.
  const causes = []
  if (found.problems.length > 0) causes.push('an issue file did not parse')
  if (found.hasMore === true) causes.push('the issue read was cut')
  if (rows.some((row) => row.delegation.state === 'unknown')) causes.push('the comments of an issue could not be read or were cut')
  if (rows.some((row) => row.pr?.state === 'unknown')) causes.push('a pull request could not be read from GitHub')
  if (rows.some((row) => row.pr?.blocked === null || (row.pr?.unchecked ?? []).length > 0)) causes.push('a pull request was not ready (GitHub had not computed the merge state) or a blocker read was refused')
  const incompleteLine = `the list is incomplete: ${causes.join('; ') || 'some reads failed'}, so what is marked unknown or not verified is not confirmed`
  if (incomplete) warnings.push(incompleteLine)
  if (host !== null) notes.push(...(await capabilityNotesOrNone(ctx)))
  const stale = rows.filter((row) => row.delegation.state === 'stale').length
  if (stale > 0) notes.push(`${stale} ${stale === 1 ? 'issue has' : 'issues have'} an agent as assignee but the newest delegation record names another agent`)
  const header = ['Issue', 'Agent', 'Status', 'Delegation', 'Branch', 'Pull request']
  const text = rows.length === 0
    ? (incomplete ? `no agent issue${agent === null ? '' : ` for ${agent}`} was found, but ${incompleteLine}, and an agent issue may be missing` : agent === null ? 'no open issue is assigned to an agent' : `no open issue is assigned to agent ${agent}`)
    : table(header, rows.map((row) => [row.id, row.assignee, row.status, row.delegation.state === 'current' ? `by ${row.delegation.by}` : row.delegation.state === 'stale' ? `stale (${row.delegation.agent})` : row.delegation.state, row.branch ?? '', prText(row)]))
  return { data: { source: 'issues', agent, issues: rows, incomplete, hasMore: found.hasMore === true, warnings, notes }, text, warnings, notes }
}

/**
 * `issues track-agents` where the tracker delegates natively (Linear): the open pull requests whose author is a bot, each matched
 * to the issue with the same branch. Nothing is concluded from a read that may be cut or that failed: the list says so.
 */
async function runTrackAgentPullRequests(ctx, tracker, agent) {
  let host
  try {
    host = ctx.host()
  } catch (error) {
    if (!isPmkitError(error) || error.code !== 'NOT_SUPPORTED') throw error
    throw new PmkitError('NOT_SUPPORTED', 'this tracker hands issues to agents natively and git_host is none, so there is no pull request to find an agent by', 'Set git_host in .pmkit/config.yaml (run /pmkit:setup) to find the pull requests of agent authors')
  }
  const warnings = []
  const causes = []
  let list = []
  let cut = false
  try {
    list = host.listPullRequests()
    if (list.length === 200) {
      cut = true
      causes.push('only the 200 most recently created open pull requests were read')
    }
  } catch (error) {
    if (!isPmkitError(error) || !['RATE_LIMITED', 'UPSTREAM'].includes(error.code)) throw error
    causes.push(`the open pull requests could not be read: ${error.message}`)
  }
  const mine = list.filter((item) => {
    const name = authorAgent(item)
    return name !== null && (agent === null || name === agent)
  })
  let byBranch = new Map()
  let issuesWhole = true
  let issuesCut = false
  if (mine.length > 0) {
    const found = await tracker.searchIssues({ categories: AGENT_CATEGORIES })
    issuesWhole = found.problems.length === 0 && found.hasMore !== true
    issuesCut = found.hasMore === true
    warnings.push(...problemWarnings(found.problems))
    if (found.problems.length > 0) causes.push('an issue file did not parse, so a pull request may have an issue that was not matched')
    if (found.hasMore === true) causes.push('the issue read was cut, so a pull request may have an issue that was not matched')
    byBranch = new Map(found.issues.filter((issue) => issue.branch).map((issue) => [issue.branch, issue]))
  }
  const cachedHost = blockerReadCache(host)
  let rateLimited = false
  const rows = []
  for (const item of mine) {
    const issue = byBranch.get(item.headRefName)
    const row = {
      id: issue?.id ?? null, title: issue?.title ?? null, status: issue?.status?.name ?? null, delegate: issue?.delegate ?? null,
      number: item.number, author: item.author.login, agent: authorAgent(item), branch: item.headRefName, delegation: null, issueMatch: issue ? 'found' : issuesWhole ? 'none' : 'unknown', pr: null, problems: [],
    }
    if (issue) {
      const read = await readDelegation(tracker, issue.id, issue.delegate ?? null)
      row.delegation = read.delegation
      if (read.problem) row.problems.push(read.problem)
    }
    if (!issue) {
      // A pull request with no issue is not read in detail: that read costs several calls, and a bot with no work behind it is noise.
      row.pr = { state: item.isDraft === true ? 'draft' : 'open', number: item.number, url: item.url, blocked: null, blocking: [], unknown: ['not read: no issue has this branch'], unchecked: [] }
    } else if (rateLimited) row.pr = { state: 'unknown', code: 'RATE_LIMITED', message: 'not read: GitHub rate limit reached earlier in this run' }
    else {
      try {
        const pr = cachedHost.getPullRequest({ number: item.number }, { detail: true })
        row.pr = pr ? prSummary(pr, collectBlockers(cachedHost, pr)) : { state: 'unknown', code: 'UPSTREAM', message: `pull request #${item.number} was listed but could not be read` }
      } catch (error) {
        if (!isPmkitError(error) || error.code === 'NOT_CONFIGURED' || error.code === 'AUTH') throw error
        row.pr = { state: 'unknown', code: error.code, message: error.message }
        row.problems.push({ code: error.code, message: `the pull request could not be read: ${error.message}${error.code === 'RATE_LIMITED' ? '; the pull requests after this one were not read' : ''}` })
        if (error.code === 'RATE_LIMITED') rateLimited = true
      }
    }
    for (const problem of row.problems) warnings.push(`${item.headRefName}: ${problem.message}`)
    rows.push(row)
  }
  if (rows.some((row) => row.problems.some((problem) => problem.message.startsWith('the comments')) || (row.delegation?.state === 'unknown' && row.delegate !== null))) causes.push('the comments of an issue could not be read or were cut')
  if (rows.some((row) => row.pr?.state === 'unknown')) causes.push('a pull request could not be read from GitHub')
  if (rows.some((row) => row.issueMatch === 'found' && (row.pr?.blocked === null || (row.pr?.unchecked ?? []).length > 0))) causes.push('a pull request was not ready (GitHub had not computed the merge state) or a blocker read was refused')
  const incomplete = causes.length > 0
  const incompleteLine = `the list is incomplete: ${causes.join('; ')}, so what is marked unknown or not verified is not confirmed`
  if (incomplete) warnings.push(incompleteLine)
  const notes = ['this tracker delegates natively: the list is the open pull requests with a bot author, matched to issues by branch, so an agent whose pull request is by a person is not listed']
  const forAgent = agent === null ? '' : ` for ${agent}`
  const header = ['Pull request', 'Agent', 'Issue', 'Delegation', 'Branch', 'State']
  const issueCell = (row) => row.id ?? (row.issueMatch === 'unknown' ? 'issue not verified' : 'no issue with this branch')
  const delegationCell = (row) => row.delegation === null ? '' : row.delegation.state === 'current' ? `by ${row.delegation.by}` : row.delegation.state === 'stale' ? `stale (${row.delegation.agent})` : row.delegation.state
  const text = rows.length === 0
    ? (incomplete ? `no agent pull request${forAgent} was found, but ${incompleteLine}, and an agent pull request may be missing` : agent === null ? 'no open pull request has an agent author' : `no agent pull request${forAgent} was found`)
    : table(header, rows.map((row) => [`#${row.number}`, row.author, issueCell(row), delegationCell(row), row.branch, prText(row)]))
  return { data: { source: 'pull_requests', agent, issues: rows, incomplete, hasMore: cut || issuesCut, warnings, notes }, text, warnings, notes }
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

/** The record a warning line is about: the text before its first ": ", as problemLine writes it. */
const recordOf = (line) => line.split(': ')[0]

const NO_GOALS_NOTE = 'no goals: using top-level issues (issues with no parent, or whose parent is an epic) and the progress of their sub-issues'
const INCOMPLETE_LINE = 'incomplete: some files or issues were not read, so these numbers may be low; do not conclude from them'

/** The warnings of an issue read: files that do not parse and a read cut at the limit. */
const issueReadWarnings = (found) => [
  ...found.problems.map(problemLine),
  ...(found.hasMore === true ? ['Linear has more issues than the 1000 pmkit read, so the progress covers only part of the work'] : []),
]

/** `goals overview`: the goals with their epics' progress, or the top-level issues when the tracker has no goals. */
async function runGoalsOverview(ctx) {
  const tracker = await ctx.tracker()
  const notes = []
  const warnings = []
  let listed = null
  try {
    listed = await tracker.listGoals()
  } catch (error) {
    if (!isPmkitError(error) || error.code !== 'NOT_SUPPORTED') throw error
    notes.push(`${NO_GOALS_NOTE}; this tracker has no goals: ${error.message}`)
  }
  // A file in goals/ that is not named after a goal id is no goal: it is noted, never a warning, and it does not block the fallback.
  for (const problem of listed?.problems.filter((item) => item.kind === 'file') ?? []) notes.push(`ignored ${problem.id}.md in .issues/goals: it is not a goal file; pmkit validate lists it`)
  const problems = listed?.problems.filter((item) => item.kind !== 'file') ?? []
  // A goal file that cannot be read may be the only goal, so it is not "no goals": the fallback runs only when every goal file was read.
  const unreadableGoal = problems.some((problem) => problem.kind === 'goal')
  if (listed !== null && (listed.goals.length > 0 || unreadableGoal)) {
    // A broken epic file may link to a goal, so on this path it is part of the answer. The fallback below does not read epics.
    warnings.push(...problems.map(goalProblemWarning))
    // goalProgress counts the issues it can read, so an issue file that does not parse may hold work of any epic.
    warnings.push(...issueReadWarnings(await tracker.searchIssues({})).map((line) => `${line}; goal progress may be low`))
    const items = []
    for (const goal of listed.goals) {
      const p = await tracker.goalProgress(goal.id)
      // A goal's own warnings reach the overview (a cut Linear epic read is only known here), once per record: the lines name
      // the record first, and the overview already warned about each file that does not parse above.
      const { goal: ignored, epics, warnings: perGoal, ...sum } = p
      const said = new Set(warnings.map(recordOf))
      for (const line of perGoal ?? []) {
        if (said.has(recordOf(line))) continue
        said.add(recordOf(line))
        warnings.push(line)
      }
      items.push({ goal: { id: goal.id, title: goal.title, target: goal.target }, epics: epics.map((e) => ({ id: e.id, title: e.title, status: e.status, counted: e.counted, progress: e.progress })), ...sum, progress: shareDone(sum.done, sum.total) })
    }
    const rows = items.map((i) => [i.goal.id, i.goal.title, i.progress === null ? 'not known' : percent(i.progress), `${i.done}/${i.total}`, `${i.pointsDone}/${i.points}`, i.epics.map((e) => e.id).join(', ')])
    const data = { source: 'goals', complete: warnings.length === 0, items, withoutChildren: 0, notes, warnings }
    const text = [
      'goals',
      items.length === 0 ? 'no goal could be read' : table(['Goal', 'Title', 'Progress', 'Done/Total', 'Points done/points', 'Epics'], rows),
      ...(warnings.length > 0 ? [INCOMPLETE_LINE] : []),
    ].join('\n')
    return { data, text, warnings, notes }
  }
  if (listed !== null) notes.push(NO_GOALS_NOTE)
  // Archived issues are read too, so the live children of an archived parent are not taken for top-level issues.
  const found = await tracker.searchIssues({ archived: true })
  warnings.push(...issueReadWarnings(found))
  const { items, withoutChildren, unreached } = topLevelRollup(found.issues, { unreadable: new Set(found.problems.map((problem) => problem.id)) })
  if (unreached.length > 0) warnings.push(`${unreached.length} issues are in a parent cycle, under an archived parent or under a parent file that did not parse and are not counted: ${unreached.join(', ')}`)
  const rows = items.map((i) => [i.issue.id, i.issue.title, i.progress === null ? 'not known' : percent(i.progress), `${i.done}/${i.total}`, `${i.pointsDone}/${i.points}`])
  const data = { source: 'top_level', complete: warnings.length === 0, items, withoutChildren, notes, warnings }
  const text = [
    NO_GOALS_NOTE,
    items.length === 0 ? 'no top-level issues with sub-issues' : table(['Issue', 'Title', 'Progress', 'Done/Total', 'Points done/points'], rows),
    ...(withoutChildren > 0 ? [`${withoutChildren} top-level issues have no sub-issues and are not listed`] : []),
    ...(warnings.length > 0 ? [INCOMPLETE_LINE] : []),
  ].join('\n')
  return { data, text, warnings, notes }
}

/** The load per member for the active sprint, or for all open work without one. Writes nothing. */
async function runTeamLoad(ctx) {
  const { data, warnings, notes } = await teamLoadReport(ctx, { wanted: ctx.opt('sprint') })
  return { data, text: teamLoadText(data), warnings, notes }
}

/**
 * The load report of `team load`. `wanted` is `current`, a sprint id or undefined. `requireSprint` fails with NOT_FOUND when no sprint is
 * in scope. `capacity` and `daysOff` replace the stored maps, which `team capacity` uses to show the load a change would give.
 */
async function teamLoadReport(ctx, { wanted, requireSprint = false, capacity, daysOff, withAging = true }) {
  return buildLoadReport(ctx, await readLoadInputs(ctx, { wanted, requireSprint, withAging }), { capacity, daysOff })
}

/**
 * Every tracker read of the load report, once: the open issues, the issues done in the sprint, the blockers outside the scope,
 * capacity, days off, the flow history, the members and the manifest. `buildLoadReport` computes from it with no tracker call,
 * so `team capacity` can build the report before and after a change from one read.
 */
async function readLoadInputs(ctx, { wanted, requireSprint = false, withAging = true, withDelivered = true, withBlocked = true }) {
  const tracker = await ctx.tracker()
  const notes = []
  const warnings = []
  const manifest = (await tracker.capabilities()).capabilities
  const discovered = await tracker.discover()
  let sprint = null
  let noSprintNamed = false
  if (wanted === undefined || wanted === 'current') {
    // A Linear team with cycles off has no active sprint: the load covers all open work, and the cycles note says why.
    let cyclesOff = false
    try {
      sprint = await tracker.currentCycle()
    } catch (error) {
      if (!isPmkitError(error) || error.code !== 'NOT_SUPPORTED') throw error
      cyclesOff = true
      notes.push(...capabilityNotesFrom(manifest, 'cycles'))
    }
    if (sprint === null && requireSprint) throw new PmkitError('NOT_FOUND', 'no sprint is active', 'Create one with /pmkit:cycle:plan, or name a sprint with --sprint <id>')
    // An explicit `--sprint current` with cycles on and no active sprint matches no issue, as `issues list --sprint current` does.
    noSprintNamed = sprint === null && wanted === 'current' && !cyclesOff
    if (sprint === null && !noSprintNamed) notes.push('no active sprint: counted every open issue in todo, in_progress and in_review')
  } else {
    // An explicit sprint needs cycles: listCycles answers NOT_SUPPORTED when the tracker has none.
    sprint = (await tracker.listCycles({})).find((item) => item.id === wanted) ?? null
    if (sprint === null) throw new PmkitError('NOT_FOUND', `sprint ${wanted} does not exist`, 'pmkit cycle list')
  }
  const found = noSprintNamed ? { issues: [], problems: [], hasMore: false } : await tracker.searchIssues({ categories: LOAD_CATEGORIES, ...(sprint ? { sprint: sprint.id } : {}) })
  if (noSprintNamed) warnings.push('there is no active sprint, so --sprint current matches no issues; run pmkit cycle list')
  warnings.push(...found.problems.map(problemLine))
  const truncated = found.hasMore === true
  if (truncated) warnings.push('the issue read was cut before the end, so the load covers only part of the scope and no move is proposed')
  const estimation = manifest.find((c) => c.id === 'estimation')
  const choice = chooseUnit(found.issues, estimation)
  if (choice.unit === 'issues' && !noSprintNamed) notes.push(`counted issues instead of estimates: ${choice.reason}${estimation?.path === 'absent' && estimation.enableHint ? ` (${estimation.enableHint})` : ''}`)
  if (estimation?.path === 'conditional') notes.push(...capabilityNotesFrom(manifest, 'estimation'))
  const capacity = sprint ? await orSupported(() => tracker.getCapacity(sprint.id), {}) : {}
  const daysOff = sprint ? await orSupported(() => tracker.getDaysOff(sprint.id), {}) : {}
  if (sprint) notes.push(...capabilityNotesFrom(manifest, 'capacity'))
  // The issues done in the sprint, archived ones included: an archived issue was still delivered. A cut or damaged read is not verified, so nobody gets a count from it.
  let delivered = null
  if (sprint && !noSprintNamed && withDelivered) {
    const done = await tracker.searchIssues({ categories: ['done'], sprint: sprint.id, archived: true })
    if (done.hasMore === true || done.problems.length > 0) warnings.push(`the delivered count is not verified: ${done.hasMore === true ? 'the read of the issues done in the sprint was cut' : 'an issue file did not parse'}`)
    else delivered = done.issues
  }
  // `team capacity` shows no blocked count and proposes no move, so it neither reads blockers nor warns about them.
  const blockedIds = withBlocked ? await openBlocked(tracker, found.issues, warnings) : new Set()
  let ages = []
  // With no active sprint named nothing was read, so there is no age to compute.
  const aged = withAging && !noSprintNamed
  if (aged) {
    const { categoryOf, events, warnings: capped } = await flowInputs(tracker, discovered.statuses)
    warnings.push(...capped)
    ages = aging(events, { categoryOf, asOf: ctx.now().toISOString().replace(/\.\d{3}Z$/, 'Z') })
  }
  const agingNotes = aged ? metricNotesFrom(manifest, 'aging') : []
  return { manifest, sprint, noSprintNamed, found, truncated, choice, capacity, daysOff, delivered, blockedIds, ages, members: teamMembers(discovered.members, ctx.config().pmkit?.tracker?.scope?.team), notes, warnings, agingNotes }
}

/**
 * The ids of the open issues in `issues` that wait on an open blocker. A blocker outside the scope is read once with getIssue. A blocker
 * that cannot be read counts as blocking, as the model says, and a warning names it: its state is not verified, so nothing says "not blocked".
 */
async function openBlocked(tracker, issues, warnings) {
  const byId = new Map(issues.map((issue) => [issue.id, issue]))
  const outside = [...new Set(issues.flatMap((issue) => issue.blockedBy ?? []))].filter((id) => !byId.has(id))
  const unread = []
  for (const id of outside) {
    try {
      byId.set(id, await tracker.getIssue(id))
    } catch (error) {
      if (error instanceof TypeError) throw error
      unread.push(id)
    }
  }
  if (unread.length > 0) warnings.push(`blocker state is not verified for ${unread.join(', ')}: ${unread.length === 1 ? 'it' : 'they'} could not be read, so ${unread.length === 1 ? 'it counts' : 'they count'} as blocking`)
  return new Set(issues.filter((issue) => isBlocked(issue, byId)).map((issue) => issue.id))
}

/** The load report from the inputs of readLoadInputs. `capacity` and `daysOff` replace the ones read. Calls no tracker operation. */
function buildLoadReport(ctx, inputs, { capacity, daysOff, proposals = true }) {
  const { sprint, noSprintNamed, found, truncated, choice, delivered, blockedIds, ages } = inputs
  const notes = [...inputs.notes]
  const warnings = [...inputs.warnings]
  const report = teamLoad(found.issues, { members: inputs.members, aging: ages, capacity: capacity ?? inputs.capacity, daysOff: daysOff ?? inputs.daysOff, unit: choice.unit, overloadFactor: ctx.settings().defaults.overload_factor, delivered, blocked: blockedIds })
  // Nothing was read, so nobody is known to have no work.
  if (noSprintNamed) report.noWork = []
  if (report.unknownLoad.length > 0) {
    const n = report.unknownLoad.length
    notes.push(`${n} ${n === 1 ? 'member has' : 'members have'} open issues and no estimate: their load is unknown, so they stay out of the average, the flags and the proposed moves`)
  }
  const counted = [report.unassigned.unestimated, ...report.rows.filter((row) => !row.unknown).map((row) => row.unestimated)]
  if (choice.unit !== 'issues' && counted.some((n) => n > 0)) {
    warnings.push(`some issues have no estimate and count 0 ${choice.unit}; the Unestimated column shows how many per member`)
  }
  notes.push(...inputs.agingNotes)
  // `team capacity` shows no proposal, so it builds none.
  const proposal = truncated || !proposals ? { moves: [], reason: null } : proposeMoves(report, found.issues)
  const suggestions = proposal.moves
  const noMoves = proposal.reason === null ? null : { reason: proposal.reason, message: noMoveMessage(proposal.reason, report.imbalances) }
  const data = { sprint: sprint ? { id: sprint.id, name: sprint.name, start: sprint.start, end: sprint.end } : null, truncated, ...report, suggestions, noMoves }
  return { data, warnings, notes, sprint, incomplete: truncated || found.problems.length > 0 }
}

/** A capacity for the text: two decimals at most, and `not set` for null. The JSON keeps the stored number. */
const shown = (capacity) => (capacity === null ? 'not set' : typeof capacity === 'number' ? Number(capacity.toFixed(2)) : capacity)

const HUMAN_ROW = (row) => !row.agent && row.isMember

/** The part of a load report that a capacity change moves: the imbalances and the flags per member. Null when the read was cut. */
const loadView = (report, incomplete) => (incomplete ? null : { imbalances: report.imbalances, flags: Object.fromEntries(report.rows.filter(HUMAN_ROW).map((row) => [row.member, row.flags])) })

/** Capacity and days off per member for a sprint. With --set or --days-off it writes them in one tracker call, so a batch is atomic. */
async function runTeamCapacity(ctx) {
  const tracker = await ctx.tracker()
  const wanted = ctx.opt('sprint') ?? 'current'
  const writing = ctx.opt('set') !== undefined || ctx.opt('days-off') !== undefined
  const inputs = await readLoadInputs(ctx, { wanted, requireSprint: true, withAging: false, withDelivered: false, withBlocked: false })
  const current = buildLoadReport(ctx, inputs, { proposals: false })
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
    const text = [header, table(['Member', 'Availability', label, 'Days off', 'Working days', 'Load', 'Flags'], data.members.map((row) => [row.member, row.availability ?? '', shown(row.capacity), row.daysOff.join(', '), row.workingDays, row.load ?? '?', (row.flags ?? []).join(', ')]))].join('\n')
    return { data, text, warnings, notes: current.notes }
  }
  const set = ctx.opt('set') === undefined ? undefined : parseCapacityPairs(csv(ctx.list('set')))
  const off = ctx.opt('days-off') === undefined ? undefined : parseDaysOff(ctx)
  checkMembers([...Object.keys(set ?? {}), ...Object.keys(off ?? {})], humans.map((row) => row.member))
  // A days-off change moves the working days, so it moves the capacity the formula of cycle:plan gave, except where --set named the member.
  // Every scaled value comes from the base the user gave (`capacityBase`), so the same days off and back give that number again.
  const scaled = off === undefined ? { patch: {}, basePatch: {}, recomputed: [], skipped: [] } : recomputeCapacity(sprint, inputs.capacity, sprint.capacityBase ?? {}, inputs.daysOff, mergeDaysOff(inputs.daysOff, off), set ?? {})
  warnings.push(...scaled.skipped.map((member) => `${member} has no working days to scale the capacity from, so it is unchanged`))
  // Only the members this call changes are written, merged by the tracker: the other keys of the stored map are neither checked nor rewritten.
  // A number typed with --set is a new base, so the base of that member goes.
  const capacityPatch = set === undefined && scaled.recomputed.length === 0 ? undefined : { ...set, ...scaled.patch }
  const dropped = Object.fromEntries(Object.keys(set ?? {}).filter((member) => sprint.capacityBase?.[member] !== undefined).map((member) => [member, null]))
  const basePatch = { ...dropped, ...scaled.basePatch }
  const result = await tracker.updateCycleCapacity(sprint.id, { capacityPatch, ...(Object.keys(basePatch).length > 0 ? { capacityBasePatch: basePatch } : {}), daysOff: off }, await ctx.actor(), { dryRun: ctx.dryRun })
  const ids = humans.map((row) => row.member)
  const changes = changeList({ capacity: result.before.capacity, daysOff: result.before.daysOff }, { capacity: result.after.capacity, daysOff: result.after.daysOff }, ids)
  let after = null
  if (!incomplete) after = loadView(buildLoadReport(ctx, inputs, { capacity: result.after.capacity, daysOff: result.after.daysOff, proposals: false }).data, false)
  else warnings.push('the load effect of this change is not verified, because the issue read is incomplete')
  const readNote = capabilityNotesFrom(inputs.manifest, 'capacity')
  const notes = [...current.notes.filter((note) => !readNote.includes(note))]
  if (readNote.length > 0 && inputs.manifest.find((c) => c.id === 'capacity')?.path === 'derived') {
    notes.push(ctx.dryRun ? 'capacity and days off would be written to .pmkit/capacity.yaml; Linear is not changed' : 'capacity and days off written to .pmkit/capacity.yaml; Linear was not changed')
  }
  if (scaled.recomputed.length > 0) notes.push(`capacity scaled by working days for ${scaled.recomputed.map((item) => item.member).join(', ')}: capacity x new working days / old working days, from the number you gave; --set <member>=<n> keeps a number`)
  const data = { dryRun: ctx.dryRun === true, sprint: { id: sprint.id, name: sprint.name, start: sprint.start, end: sprint.end }, unit, changes, recomputed: scaled.recomputed, load: { before: loadView(current.data, incomplete), after }, notes, warnings }
  const lines = [header]
  if (changes.length === 0) lines.push('no change')
  for (const change of changes) {
    lines.push(change.member)
    if (change.capacity.before !== change.capacity.after) lines.push(`  capacity ${shown(change.capacity.before)} → ${shown(change.capacity.after)}`)
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
  const rows = [...data.rows, { ...data.unassigned, member: 'unassigned', wip: '', blocked: '', oldestWipDays: null, capacity: null, flags: [], unknown: false }]
  // The delivered column exists only with a sprint; a count that is not verified shows `?`, never 0.
  const withDelivered = data.sprint !== null
  const factor = data.overloadFactor === 1.5 ? '' : `, overload factor ${data.overloadFactor}`
  const lines = [
    data.sprint ? `sprint ${data.sprint.id} (${data.sprint.start} to ${data.sprint.end}), load in ${data.unit}, average ${data.average}${factor}` : `no sprint, load in ${data.unit}, average ${data.average}${factor}`,
    table(
      ['Member', 'Issues', ...(estimated ? [label, 'Unestimated'] : []), 'WIP', 'Blocked', ...(withDelivered ? ['Delivered'] : []), 'Oldest WIP days', ...(estimated ? ['Capacity'] : []), 'Flags'],
      rows.map((row) => [
        row.member + (row.agent ? ' (agent)' : '') + (row.isMember === false ? ' (not a member)' : '') + (row.partial ? ' (partial)' : ''), row.issues,
        ...(estimated ? [row.unknown ? '?' : row.estimate, row.unestimated] : []), row.wip, row.blocked, ...(withDelivered ? [row.delivered ?? '?'] : []), row.oldestWipDays ?? '', ...(estimated ? [row.capacity === null ? '' : shown(row.capacity)] : []), (row.flags ?? []).join(', '),
      ]),
    ),
  ]
  if (data.imbalances.length > 0) lines.push('imbalances:', ...data.imbalances.map((item) => `  ${item.member}: ${item.flag}, load ${item.load ?? 'unknown'}, limit ${item.limit}`))
  if (data.noWork.length > 0) lines.push(`no work in scope: ${data.noWork.map((item) => item.member + (item.daysOff.length > 0 ? ` (days off ${item.daysOff.join(', ')})` : '')).join(', ')}`)
  if (data.noMoves) lines.push(`no proposed moves: ${data.noMoves.message}`)
  if (data.suggestions.length > 0) lines.push('proposed moves:', ...data.suggestions.map((move) => `  ${move.issue}: ${move.from} to ${move.to}${move.unsized ? ` (${move.unsized === 'unestimated' ? 'no estimate' : 'estimate 0'}, load effect unknown)` : ''}`))
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
    pmkit = withGithubRepo(pmkit, root, host)
  } else {
    const repo = originRepo(root)
    pmkit = template('pmkit.config.yaml').replace(
      /git_host:\n {2}system: .*\n {2}repo: .*\n/,
      `git_host:\n  system: ${host ?? 'none'}\n${repo ? `  repo: ${repo}\n` : ''}`,
    )
    withGithubRepo(pmkit, root, host)
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

// The GitHub repository the origin remote names, read the way link-repo reads it, or undefined when there is none.
const originRepo = (root) => {
  const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', timeout: GIT_READ_TIMEOUT_MS })
  return remote.status === 0 ? (inferHost(remote.stdout.trim()).repo ?? undefined) : undefined
}

// init never writes git_host.system github without a repo, which validate reports. A config that has none takes the origin's, or the call is refused.
function withGithubRepo(text, root, host) {
  if (host !== 'github') return text
  let held
  try {
    held = parseYaml(text)?.git_host?.repo
  } catch {
    return text // the caller reports a file that does not parse
  }
  if (held) return text
  const repo = originRepo(root)
  if (!repo) throw usageError('git_host github needs a repo, and the origin remote is not a GitHub repository', 'Add a GitHub origin remote, or leave out --git-host and run /pmkit:link-repo --git-host github --repo owner/name')
  return setScalar(text, ['git_host', 'repo'], repo)
}

// link-repo. See docs/superpowers/specs/2026-10-31-pmk-53-link-repo-design.md.
// GitHub owner and repository names do not differ by case.
// A remote read for the repo: a DNS host name and owner and name in GitHub's character set (no leading -, not . or ..), so nothing else is written or quoted.
const DNS_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/
const GITHUB_NAME = /^(?!-)[A-Za-z0-9_.-]+$/
const validGithubRemote = (url) => url !== null && !url.owner.includes('/') && DNS_HOST.test(url.host) && [url.owner, url.name].every((part) => GITHUB_NAME.test(part) && part !== '.' && part !== '..')
const sameRepo = (a, b) => a != null && b != null && a.toLowerCase() === b.toLowerCase()
const GIT_READ_TIMEOUT_MS = 10_000
const GIT_READ_MAX_OUTPUT = 1024 * 1024

const readGit = (ctx, args) => spawnSync('git', args, { cwd: ctx.root, env: ctx.env, encoding: 'utf8', timeout: GIT_READ_TIMEOUT_MS, maxBuffer: GIT_READ_MAX_OUTPUT })

// The remotes of the repository as { ok: true, remotes: [{ name, url }] }, or { ok: false, reason } when git cannot say.
// One `git remote -v` call lists every remote with its fetch URL.
function readRemotes(ctx) {
  // `git remote -v` in a subdirectory reads the enclosing repository, so the pmkit root must be the repository root.
  const top = readGit(ctx, ['rev-parse', '--show-toplevel'])
  if (!top.error && top.status === 0 && fs.realpathSync(top.stdout.trim()) !== fs.realpathSync(ctx.root)) {
    return { ok: false, reason: `${ctx.root} is not the root of a git repository` }
  }
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

// The team named by --team, or held in the file, checked against the workspace. A discovery whose teams or states are cut at the client cap (`truncated`) proves nothing about a team or its mappings, so the team is not checked then; a cut of users or labels does not matter here.
async function linkTeam(ctx, parsed, wanted, source) {
  const adapter = adapterFor('linear', ctx.adapters)
  const workspace = parsed.tracker.scope?.workspace
  const tracker = await adapter.create({ root: ctx.root, system: 'linear', pmkit: { ...parsed, tracker: { system: 'linear', ...(workspace ? { scope: { workspace } } : {}) }, mappings: undefined } }, { now: ctx.now, env: ctx.env })
  const view = await tracker.discover({ refresh: true })
  const defaults = withLocalDefaults({}).types
  const types = [...defaults, ...Object.keys(parsed.mappings?.types ?? {}).filter((type) => !defaults.includes(type))]
  const description = adapter.describe(view.raw, view, view.auth?.viewer?.id ?? null, types)
  const truncated = (view.raw?.truncated ?? []).filter((kind) => kind === 'teams' || kind === 'states')
  if (truncated.length > 0) return { description, truncated }
  const keys = description.teams.map((team) => team.key)
  if (!keys.includes(wanted)) throw usageError(`${source === 'flag' ? `--team ${wanted}` : `tracker.scope.team ${wanted}`} is not a team of workspace ${description.workspace.urlKey}`, `Pass one of: ${keys.join(', ')}${source === 'flag' ? '' : ' with --team, or run /pmkit:setup'}`)
  return { description, truncated }
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
  let invalidRemote = null
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
  } else if (flagHost === 'github' && chosen.remote) {
    // GitHub Enterprise or an SSH alias: the user said it is GitHub, so a missing repo is read from that remote. gh resolves the host from the remote itself.
    const remoteUrl = parseRemoteUrl(chosen.remote.url)
    if (!validGithubRemote(remoteUrl)) {
      invalidRemote = `remote ${chosen.remote.name} does not have a valid host name and owner/name, so the repo was not read from it`
      notes.push(invalidRemote)
    } else if (held.repo === null) {
      repoAfter = `${remoteUrl.owner}/${remoteUrl.name}`
      repoSource = 'remote'
      notes.push(`the repo ${repoAfter} was read from remote ${chosen.remote.name} on ${remoteUrl.host}; gh must be logged in to that host (gh auth login --hostname ${remoteUrl.host})`)
    } else if (!sameRepo(held.repo, `${remoteUrl.owner}/${remoteUrl.name}`)) {
      warnings.push(`remote ${chosen.remote.name} points to ${remoteUrl.owner}/${remoteUrl.name} on ${remoteUrl.host} and the file keeps repo ${held.repo}; pass --repo to change it`)
    }
  }
  let branchAfter = held.branch
  let branchSource = 'file'
  // The branch comes from the remote only when that remote is the repository being written.
  const inferredBranch = inferred.system === 'github' && sameRepo(repoAfter, inferred.repo) ? readDefaultBranch(ctx, chosen.remote.name) : null
  if (flagHost === 'none') {
    branchAfter = null
    branchSource = 'flag'
  } else if (flagBranch !== undefined) {
    branchAfter = flagBranch
    branchSource = 'flag'
  } else if (inferredBranch !== null && hostAfter === 'github') {
    branchAfter = inferredBranch
    branchSource = 'remote'
  }
  // A file that is already github without a repo is not made worse, so --team or --default-branch still work on it.
  if (hostAfter === 'github' && repoAfter === null) {
    if (held.system !== 'github') throw usageError(`git_host github needs a repo, and none was given or found${invalidRemote ? ` (${invalidRemote})` : ''}`, 'Pass --repo owner/name, or --git-host none')
    warnings.push('git_host.repo is not set while git_host is github, and none was given or found; pass --repo owner/name')
  }
  // A new repo with the old branch name may point at the wrong branch, so the value is kept and the note says it may be wrong.
  if (branchSource === 'file' && held.branch !== null && held.repo !== null && !sameRepo(repoAfter, held.repo)) {
    notes.push(`the repo changed from ${held.repo} to ${repoAfter ?? 'none'} and the default branch could not be inferred, so default_branch ${held.branch} may be wrong; pass --default-branch <name>, or run git remote set-head <remote> --auto and run this again`)
  }
  if (chosen.remote && flagHost !== undefined) {
    if (inferred.system !== null && inferred.system !== flagHost) {
      warnings.push(`remote ${chosen.remote.name} points to ${inferred.host}, which is GitHub, and --git-host ${flagHost} was used as given`)
    } else if (inferred.system === null && inferred.host !== null && flagHost === 'github') {
      warnings.push(`remote ${chosen.remote.name} points to ${inferred.host}, which is not recognized as GitHub, and --git-host github was used as given`)
    }
  }
  if (flagRepo !== undefined && inferred.repo !== null && !sameRepo(inferred.repo, flagRepo)) {
    warnings.push(`remote ${chosen.remote.name} points to ${inferred.repo} and --repo ${flagRepo} was used as given`)
  }

  // The team. Linear is called only for --team or --recheck-team, so a host change needs no key, no network and no team.
  const heldTeam = parsed.tracker.scope?.team ?? null
  const wantedTeam = ctx.opt('team')
  let scope = null
  let broken = []
  const recheck = ctx.flag('recheck-team')
  if (recheck && !hosted) throw usageError(`the ${system} tracker has no scope, so --recheck-team does not apply`, 'Remove --recheck-team')
  if (recheck && wantedTeam === undefined && heldTeam === null) throw usageError('tracker.scope.team is not set, so there is no team to re-check', 'Pass --team KEY, or run /pmkit:setup')
  if (hosted) {
    scope = { team: { before: heldTeam, after: heldTeam, source: 'file', verified: false } }
    if (wantedTeam !== undefined || recheck) {
      const checked = wantedTeam ?? heldTeam
      const source = wantedTeam !== undefined ? 'flag' : 'file'
      const { description, truncated } = await linkTeam(ctx, parsed, checked, source)
      if (truncated.length > 0 && checked !== heldTeam) {
        throw new PmkitError('UPSTREAM', `Linear has more than the first part of its ${truncated.join(', ')}, so --team ${checked} could not be checked against the workspace`, 'Edit tracker.scope.team in .pmkit/config.yaml by hand')
      }
      if (truncated.length > 0) {
        warnings.push(`Linear has more than the first part of its ${truncated.join(', ')}, so team ${checked} was not checked against the workspace`)
      } else {
        scope = { team: { before: heldTeam, after: checked, source, verified: true } }
        broken = brokenMappings(description, { tracker: { scope: { team: checked } }, mappings: parsed.mappings })
      }
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
  if (branchAfter === null && held.branch !== null) text = edit('git_host.default_branch', () => removeKey(text, ['git_host', 'default_branch']))
  else if (branchAfter !== null && branchAfter !== held.branch) text = edit('git_host.default_branch', () => setScalar(text, ['git_host', 'default_branch'], branchAfter))
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
    // Host only: the file changes, no team changes, no mapping breaks, nothing warns, the host is not lowered and no repo or branch the file holds is replaced.
    hostOnly: changed && !teamChanged && broken.length === 0 && warnings.length === 0 && hostAfter !== 'none' && (held.repo === null || repoAfter === held.repo) && (held.branch === null || branchAfter === held.branch),
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
    ...(broken.length > 0 ? [teamChanged ? 'broken by the new team:' : 'broken for the team in the file:', ...broken.map((item) => `  ${item.problem}`)] : []),
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
    const repo = originRepo(root)
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
  text = withGithubRepo(text, root, host)
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
  // On disk with its exact case: where the file system ignores case, the old name of a case-only rename still "exists".
  const onDisk = (file) => {
    const full = path.join(config.root, file)
    try {
      return fs.readdirSync(path.dirname(full)).includes(path.basename(full))
    } catch {
      return false
    }
  }
  const present = paths.filter(onDisk)
  // A removed path is committed only when git tracks it: a file git never saw, such as a view written by hand, is not an error.
  const removed = paths.filter((file) => !onDisk(file) && git('ls-files', '--', file).stdout.trim() !== '')
  if (removed.length > 0) {
    // git rm --cached drops the old name from the index, which git add cannot do for a case-only rename.
    const dropped = git('rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', ...removed)
    if (dropped.status !== 0) throw fail(dropped)
  }
  if (present.length > 0) {
    const added = git('add', '--', ...present)
    if (added.status !== 0) throw fail(added)
  }
  const staged = [...removed, ...present]
  if (staged.length === 0 || git('diff', '--cached', '--quiet', '--', ...staged).status === 0) return
  const committed = git('commit', '-m', message, '--', ...staged)
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
  // An argument named with a trailing ? is optional, and only the last ones can be.
  const required = expected.filter((a) => !a.endsWith('?')).length
  const label = `${command.name}${command.usage ? ` ${command.usage}` : ''}`
  if (command.rest ? positionals.length < 1 : positionals.length < required || positionals.length > expected.length) {
    const named = expected.map((a) => (a.endsWith('?') ? `[<${a.slice(0, -1)}>]` : `<${a}>`)).join(' ')
    throw usageError(`${command.name} takes ${command.rest ? 'at least one <id>' : expected.length === 0 ? 'no arguments' : named}`, `Usage: ${label}`)
  }
}

const INBOX_TEXT = 60
/** The Text cell of an inbox item: the mention excerpt or the status change, cut at 60 characters. */
function inboxText(item) {
  const text = item.kind === 'status' && item.to !== null ? `${item.from ?? '?'} → ${item.to}` : (item.excerpt ?? '')
  return text.length > INBOX_TEXT ? `${text.slice(0, INBOX_TEXT - 1)}…` : text
}

/**
 * The open pull requests that request a review of one of `logins` (ignoring case), from one gh call (PMK-225). A request made to a
 * team never matches and is listed apart. A failed read is `verified: false` with the reason, never an empty list.
 */
function reviewRequests(ctx, user, logins) {
  // A Linear member id is a Linear user id, never a GitHub login, so without --login there is nothing to match: not verified, never 0.
  if (ctx.config().pmkit.tracker?.system === 'linear' && logins.length === 0) {
    return { verified: false, requested: null, teamRequests: null, complete: false, reason: 'the Linear member id is not a GitHub login; pass --login <github login> to match review requests', code: 'INVALID_INPUT' }
  }
  const wanted = new Set([user, ...logins].map((login) => String(login).toLowerCase()))
  let prs
  try {
    prs = ctx.host().listReviewRequests()
  } catch (error) {
    if (!isPmkitError(error)) throw error
    return { verified: false, requested: null, teamRequests: null, complete: false, reason: error.message, code: error.code }
  }
  const requested = []
  const teamRequests = []
  for (const pr of prs) {
    const asks = Array.isArray(pr.reviewRequests) ? pr.reviewRequests : []
    for (const ask of asks.filter((entry) => entry?.__typename === 'Team')) teamRequests.push({ number: pr.number, team: ask.slug ?? ask.name ?? null })
    if (asks.some((entry) => entry?.__typename !== 'Team' && typeof entry?.login === 'string' && wanted.has(entry.login.toLowerCase()))) {
      requested.push({ number: pr.number, url: pr.url ?? null, title: pr.title ?? null, branch: pr.headRefName ?? null, author: pr.author?.login ?? null })
    }
  }
  const complete = prs.length < 200
  return { verified: true, requested, teamRequests, complete, reason: complete ? null : 'only the 200 most recently created open pull requests were read' }
}

/** The text lines of the review requests of inbox list. */
function reviewLines(reviews, user) {
  if (!reviews.verified) return [`review requests not verified: ${reviews.reason}`]
  const count = reviews.requested.length
  const lines = [`${count} review ${count === 1 ? 'request' : 'requests'} waiting for ${user}${reviews.complete ? '' : ` (at least; ${reviews.reason})`}`]
  if (count > 0) lines.push(table(['PR', 'Title', 'Branch', 'Author'], reviews.requested.map((r) => [`#${r.number}`, r.title ?? '', r.branch ?? '', r.author ?? ''])))
  if (reviews.teamRequests.length > 0) lines.push(`${reviews.teamRequests.length} team review ${reviews.teamRequests.length === 1 ? 'request is' : 'requests are'} not matched to ${user}`)
  return lines
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
    // auto_commit commits Local tracker files, so a hosted tracker never commits.
    const autoCommit = (commit, written) => {
      if (!command.write || dryRun || commit === undefined || ctx.config().system !== 'local' || ctx.config().local.auto_commit !== true) return
      // Only the files this command wrote; a write that changed nothing commits nothing.
      const paths = tracker?.writtenFiles() ?? []
      try {
        if (paths.length > 0) commitTracker(ctx.config(), `pmkit: ${command.name} ${commit}`, paths)
      } catch (error) {
        // The write succeeded; the caller still gets what was written, in the same single output.
        error.written ??= written
        throw error
      }
    }
    let result
    try {
      result = await command.run(ctx)
    } catch (error) {
      // A bulk write that stopped midway still commits the issues it wrote.
      if (error?.partialCommit !== undefined) {
        try {
          autoCommit(error.partialCommit)
        } catch (commitError) {
          error.message = `${error.message}; ${commitError.message}`
        }
      }
      throw error
    }
    autoCommit(result.commit, { data: result.data, text: result.text })
    stdout.push(json ? `${JSON.stringify(result.data, null, 2)}\n` : `${result.text}\n`)
    readWarning()
    for (const warning of result.warnings ?? []) stderr.push(`warning: ${warning}\n`)
    for (const note of result.notes ?? []) stderr.push(`note: ${note}\n`)
    // Notes the tracker collected while it read, such as an issue release it could not read (Linear).
    for (const note of tracker?.takeNotes?.() ?? []) stderr.push(`note: ${note}\n`)
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
        // The two digests of a CONFLICT, so an agent sees what the preview held and what the tracker holds now.
        if (typeof error.details?.expected === 'string' && typeof error.details?.digest === 'string') Object.assign(body.error, { expected: error.details.expected, digest: error.details.digest })
        // A stable reason, for an error whose code alone does not say which case it is (the three INVALID_INPUT errors of a view).
        if (typeof error.details?.reason === 'string') body.error.reason = error.details.reason
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
