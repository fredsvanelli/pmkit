// Opt-in live run of the degraded paths of every command on the sandbox workspace (PMK-40). Nothing here has run yet.
// It writes, so it is gated twice: PMKIT_LIVE=1 and PMKIT_LIVE_WORKSPACE, the URL key the key must belong to.
// `npm test` does not load it (the name does not end in .test.mjs).
//
//   set -a; . ./.env; set +a; PMKIT_LIVE=1 PMKIT_LIVE_WORKSPACE=<url key> node scripts/lib/linear/degraded-live.mjs
//
// The test team `pmkit-test` must exist and be empty: this run does not create teams, so run contract-live.mjs once before it.
// A crash leaves items behind; `node scripts/lib/linear/contract-live.mjs cleanup [--yes]` removes them, because both runs share the team.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { run as pmkit } from '../../pmkit.mjs'
import { ADAPTERS } from '../adapters.mjs'
import { skipReason, installSignalHandlers } from './contract-live.mjs'
import { createLinearClient } from './client.mjs'
import { linearDescriptor } from './adapter.mjs'
import { SUITE_ALLOWLIST, createGuardedFetch, findOrCreateTestTeam, listTestTeamItems, preflight, trashTestTeamItems, waitForCycles } from './sandbox.mjs'

/** The request budget of the run. The spec aims at about 140 requests. */
export const REQUEST_CAP = 300

/** The seed writes (issueCreate, issueUpdate) and the cleanup deletes. Nothing else may reach Linear. */
export const DEGRADED_ALLOWLIST = Object.freeze({
  issueCreate: SUITE_ALLOWLIST.issueCreate,
  issueUpdate: SUITE_ALLOWLIST.issueUpdate,
  issueDelete: SUITE_ALLOWLIST.issueDelete,
  projectDelete: SUITE_ALLOWLIST.projectDelete,
})

const HOST = 'this repository has no git host configured'

/**
 * The rows the spec marks "Live". `argv` may use {A} and {B}, the identifiers of the two seeded issues. `code` is the exit code.
 * `note` is the exact note line, `noNote` says the result prints none, `refusal` is a substring of the first error line.
 */
export const LIVE_ROWS = [
  { argv: ['capabilities'], code: 0, noNote: true },
  { argv: ['whoami'], code: 0, noNote: true },
  { argv: ['issues', 'list'], code: 0, noNote: true },
  { argv: ['issues', 'get', '{A}'], code: 0, noNote: true },
  { argv: ['issues', 'dependencies', '{A}'], code: 0, noNote: true },
  { argv: ['issues', 'log-time', '{A}', '5'], code: 2, refusal: 'Linear has no time tracking' },
  { argv: ['issues', 'create', '--title', 'x', '--estimate', '3'], code: 2, refusal: 'estimates off' },
  { argv: ['cycle', 'list'], code: 0, noNote: true },
  { argv: ['cycle', 'current'], code: 0, noNote: true },
  { argv: ['cycle', 'open', '--start', '2026-11-02'], code: 2, refusal: 'NOT_SUPPORTED' },
  { argv: ['cycle', 'close', '1'], code: 2, refusal: 'NOT_SUPPORTED' },
  { argv: ['epic', 'list'], code: 0, noNote: true },
  { argv: ['milestone', 'list'], code: 0, noNote: true },
  { argv: ['milestone', 'create', 'm1'], code: 2, refusal: 'does not create them' },
  { argv: ['release', 'list'], code: 0, noteStarts: 'note: releases is absent: ' },
  { argv: ['release', 'create', '1.0'], code: 2, refusal: 'NOT_SUPPORTED' },
  { argv: ['release', 'mark-released', '1.0'], code: 2, refusal: 'NOT_SUPPORTED' },
  { argv: ['docs', 'create', 'a.md', '--body-file', '{BODY}'], code: 2, refusal: 'does not create them' },
  { argv: ['metrics', 'velocity'], code: 0, noteStarts: 'note: velocity computed from the last ' },
  { argv: ['metrics', 'cycle-time'], code: 0, note: 'note: cycle-time computed from Linear issue history' },
  { argv: ['metrics', 'lead-time'], code: 0, note: 'note: lead-time computed from Linear issue history' },
  { argv: ['metrics', 'throughput'], code: 0, note: 'note: throughput computed from Linear issue history' },
  { argv: ['metrics', 'aging'], code: 0, note: 'note: aging computed from Linear issue history' },
  { argv: ['events'], code: 0, note: 'note: events computed from Linear issue history' },
  { argv: ['pr', 'status', '--branch', 'x'], code: 2, refusal: HOST },
  { argv: ['render', 'board'], code: 2, refusal: 'works only with the Local tracker' },
]

/** Fills {A}, {B} and {BODY} in a row's argv. */
export const fillArgv = (argv, values) => argv.map((arg) => arg.replace(/\{(A|B|BODY)\}/g, (_, key) => values[key]))

/** Checks one result against its row. The note lines are the `note: ` lines of stderr; `refusal` is looked up in stdout and stderr, because --json prints the error object on stdout. */
export function checkRow(row, result) {
  assert.equal(result.code, row.code, `${row.argv.join(' ')}\n${result.stdout}${result.stderr}`)
  const notes = result.stderr.split('\n').filter((line) => line.startsWith('note: '))
  if (row.noNote) assert.deepEqual(notes, [])
  if (row.note) assert.deepEqual(notes, [row.note])
  if (row.noteStarts) {
    assert.equal(notes.length, 1, result.stderr)
    assert.ok(notes[0].startsWith(row.noteStarts), notes[0])
  }
  if (row.refusal) {
    assert.ok(`${result.stdout}\n${result.stderr}`.includes(row.refusal), result.stdout + result.stderr)
    assert.deepEqual(notes, [])
  }
}

/** The state of one run, over an injected fetch. Returns { before, after, runRow, totals, guard, seed }. */
export function buildDegradedRun({ env, fetch, workspace, sleep, write = (line) => console.log(line) }) {
  const { fetch: guarded, guard } = createGuardedFetch({ fetch, workspace, allowlist: DEGRADED_ALLOWLIST, cap: REQUEST_CAP, reserve: 50 })
  const client = createLinearClient({ env, tracker: { system: 'linear', scope: { workspace } }, fetch: guarded })
  const state = { team: null, home: null, root: null, env: null, ids: {}, body: null }
  const adapters = { ...ADAPTERS, linear: linearDescriptor({ fetch: guarded }) }
  const exec = (argv) => pmkit(argv, { cwd: state.root, env: state.env, adapters })

  async function before() {
    state.home = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-degraded-live-'))
    state.root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-degraded-repo-'))
    state.env = { ...env, PMKIT_HOME: path.join(state.home, 'store'), HOME: state.home, XDG_CONFIG_HOME: path.join(state.home, '.config') }
    await preflight({ client, env, workspace, guard })
    const found = await findOrCreateTestTeam({ client, guard })
    state.team = found.team
    await waitForCycles({ client, team: state.team, guard, sleep })
    fs.mkdirSync(path.join(state.root, '.pmkit'), { recursive: true })
    fs.writeFileSync(path.join(state.root, '.pmkit', 'config.yaml'), [
      'version: 1', 'tracker:', '  system: linear', '  scope:', `    workspace: ${workspace}`, `    team: ${state.team.key}`,
      'git_host:', '  system: none', 'mappings:', '  status:', '    in_review: In Review', '  types:', '    bug: Bug', '    feature: Feature', '',
    ].join('\n'))
    state.body = path.join(state.home, 'body.md')
    fs.writeFileSync(state.body, 'text\n')
    const discovered = await exec(['discover'])
    assert.equal(discovered.code, 0, discovered.stderr)
  }

  /** 2 issues, one moved to in_progress and then done, so the metrics have an entry. 4 mutations. */
  async function seed() {
    for (const key of ['A', 'B']) {
      const made = await exec(['issues', 'create', '--title', `pmkit degraded ${key}`, '--json'])
      assert.equal(made.code, 0, made.stderr)
      state.ids[key] = JSON.parse(made.stdout).data.id
    }
    for (const category of ['in_progress', 'done']) {
      const moved = await exec(['issues', 'move', state.ids.A, category, '--json'])
      assert.equal(moved.code, 0, moved.stderr)
    }
  }

  async function runRow(row) {
    const before = guard.stats().writes
    const result = await exec([...fillArgv(row.argv, { ...state.ids, BODY: state.body }), '--json'])
    // --json prints the error on stdout; the note and error lines are checked on stderr as the CLI prints them.
    checkRow(row, result)
    assert.equal(guard.stats().writes, before, `${row.argv.join(' ')} sent a mutation`)
  }

  async function after() {
    try {
      if (state.team) {
        const counts = await trashTestTeamItems({ client, team: state.team, guard })
        write(`last sweep trashed ${counts.issues} issues and ${counts.projects} projects`)
      }
    } finally {
      for (const dir of [state.home, state.root]) if (dir) fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  const totals = () => {
    const { requests, writes, complexity, refused } = guard.stats()
    return [`request count: ${requests}, writes ${writes}, complexity ${complexity}`, ...(refused.length > 0 ? [`the guard refused ${refused.length} requests`, ...refused.slice(0, 10)] : [])]
  }

  return { before, after, seed, runRow, totals, guard, client, listItems: () => listTestTeamItems({ client, team: state.team, guard }) }
}

/** Registers the live suite: hooks, the seed, one test per row, and the totals with the assertion that the guard refused nothing. */
export function registerDegradedSuite(live) {
  describe('degraded paths against the sandbox workspace', () => {
    before(() => live.before().then(() => live.seed()))
    after(() => live.after())
    for (const row of LIVE_ROWS) test(row.argv.join(' '), () => live.runRow(row))
    test('the guard refused nothing, and the totals of the run', (t) => {
      for (const line of live.totals()) t.diagnostic(line)
      assert.deepEqual(live.guard.stats().refused, [])
    })
  })
}

async function main(env) {
  const reason = skipReason(env)
  if (reason) {
    test('the degraded paths against the sandbox workspace', { skip: reason }, () => {})
    return 0
  }
  const live = buildDegradedRun({ env, fetch: globalThis.fetch, workspace: env.PMKIT_LIVE_WORKSPACE })
  installSignalHandlers({ guard: live.guard, finish: () => live.after() })
  registerDegradedSuite(live)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.env)
}
