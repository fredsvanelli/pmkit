// Opt-in live run of the tracker contract suite against the test team of the sandbox workspace.
// It writes, so it is gated twice: PMKIT_LIVE=1 and PMKIT_LIVE_WORKSPACE, the URL key the key must belong to.
// `npm test` does not load it (the name does not end in .test.mjs).
//
//   set -a; . ./.env; set +a; PMKIT_LIVE=1 PMKIT_LIVE_WORKSPACE=<url key> node scripts/lib/linear/contract-live.mjs
//   ... node scripts/lib/linear/contract-live.mjs cleanup          lists what the test team holds, writes nothing
//   ... node scripts/lib/linear/contract-live.mjs cleanup --yes    trashes those items
//
// It runs with node, not node --test, so the tests and the signal handlers share one process. Without PMKIT_LIVE=1, a set
// PMKIT_LIVE_WORKSPACE and a usable LINEAR_API_KEY, every test is skipped with one reason and nothing is sent.
// Running `cleanup --yes` during a live run trashes that run's items too.

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after, before, describe } from 'node:test'
import { pathToFileURL } from 'node:url'
import { runTrackerContract } from '../../contract-suite.mjs'
import { createLinearClient } from './client.mjs'
import { linearCredential } from './credential.mjs'
import {
  createGuardedFetch, findOrCreateTestTeam, listTestTeamItems, preflight, trashTestTeamItems, waitForCycles,
} from './sandbox.mjs'
import { createLinearTracker } from './tracker.mjs'

/** The families the Linear run covers. cycle-lifecycle, time, releases, milestone-writes and document-writes stay out. */
export const LINEAR_FAMILIES = ['discovery', 'issues', 'relations', 'history', 'cycles', 'deliverables', 'milestones', 'documents']

/** The reason the live run cannot start, or false when the gate is open. */
export function skipReason(env) {
  if (env.PMKIT_LIVE !== '1') return 'set PMKIT_LIVE=1 to run the live check'
  if (!env.PMKIT_LIVE_WORKSPACE) return 'set PMKIT_LIVE_WORKSPACE to the sandbox workspace URL key'
  try {
    linearCredential(env)
  } catch (error) {
    return `LINEAR_API_KEY is not usable: ${error.message}`
  }
  return false
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

/**
 * The cleanup command. Lists the test team's items, and trashes them when `yes` is set. Returns the exit code.
 * The preflight runs without the emptiness check and refuses a test team that fails the name, key or marker checks.
 */
export async function runCleanup({ client, env, workspace, guard, yes, write }) {
  let ready
  try {
    ready = await preflight({ client, env, workspace, guard, requireEmpty: false })
  } catch (error) {
    write(`cleanup stopped: ${error.message}`)
    return 1
  }
  if (!ready.team) {
    write('the workspace has no test team, so there is nothing to clean up')
    return 0
  }
  const { issues, projects } = await listTestTeamItems({ client, team: ready.team, guard })
  write(`the test team holds ${plural(issues.length, 'issue')} and ${plural(projects.length, 'project')}`)
  for (const issue of issues) write(`  ${issue.identifier}`)
  if (!yes) {
    if (issues.length + projects.length > 0) write('run again with --yes to trash them')
    return 0
  }
  const counts = await trashTestTeamItems({ client, team: ready.team, guard })
  write(`trashed ${plural(counts.issues, 'issue')} and ${plural(counts.projects, 'project')}`)
  return 0
}

/**
 * Everything the live run needs, over an injected fetch so a scripted one can drive it. Returns { before, after, setup, totals, guard }.
 * `before` checks the workspace, finds or creates the test team and fills the discovery cache. `setup` is the contract suite's
 * setup: a new tracker on an empty test team. `after` sweeps the team once more and removes the temporary folders.
 */
export function buildLiveRun({ env, fetch, workspace, sleep, now = () => new Date(), uuid = randomUUID, write = (line) => console.log(line) }) {
  const { fetch: guarded, guard } = createGuardedFetch({ fetch, workspace })
  const client = createLinearClient({ env, tracker: { system: 'linear', scope: { workspace } }, fetch: guarded })
  const run = { guard, client, team: null, viewer: null, today: null, home: null, root: null, env: null, config: null }

  const newTracker = () => createLinearTracker(run.config, { env: run.env, fetch: guarded })

  async function before() {
    run.home = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-live-'))
    run.root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-live-repo-'))
    run.env = { ...env, PMKIT_HOME: path.join(run.home, 'store'), HOME: run.home, XDG_CONFIG_HOME: path.join(run.home, '.config') }
    const ready = await preflight({ client, env, workspace, guard })
    run.viewer = ready.viewer
    run.today = now().toISOString().slice(0, 10)
    const found = await findOrCreateTestTeam({ client, guard, now, uuid })
    run.team = found.team
    write(found.created ? 'created the test team' : 'found the test team')
    await waitForCycles({ client, team: run.team, guard, sleep })
    run.config = {
      root: run.root,
      pmkit: {
        tracker: { system: 'linear', scope: { workspace, team: run.team.key } },
        git_host: { system: 'none' },
        mappings: { status: { in_review: 'In Review' }, types: { bug: 'Bug', feature: 'Feature' } },
      },
    }
    await newTracker().discover({ refresh: true })
  }

  async function sweep() {
    return trashTestTeamItems({ client, team: run.team, guard })
  }

  async function setup() {
    const { issues, projects } = await listTestTeamItems({ client, team: run.team, guard })
    if (issues.length + projects.length > 0) throw new Error('the test team is not empty')
    const tracker = newTracker()
    const pick = (state) => async () => {
      const [found] = await tracker.listCycles({ state })
      if (!found) throw new Error(`the test team has no ${state} cycle`)
      return { id: found.id, start: found.start, end: found.end }
    }
    return {
      tracker, actor: run.viewer.id, today: run.today, env: run.env, root: run.root, cycles: { active: pick('active'), planned: pick('planned') },
      async teardown() {
        await sweep()
        fs.rmSync(path.join(run.root, '.pmkit', 'capacity.yaml'), { force: true })
      },
    }
  }

  async function after() {
    try {
      if (run.team) {
        const counts = await sweep()
        write(`last sweep trashed ${plural(counts.issues, 'issue')} and ${plural(counts.projects, 'project')}`)
      }
    } finally {
      for (const dir of [run.home, run.root]) if (dir) fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  function totals() {
    const { requests, writes, complexity, rate, refused } = guard.stats()
    return [
      `requests ${requests}, writes ${writes}, complexity ${complexity}`,
      `left in the window: ${rate.requestsRemaining ?? 'unknown'} requests, ${rate.complexityRemaining ?? 'unknown'} complexity`,
      ...(refused.length > 0 ? [`the guard refused ${refused.length} requests`, ...refused.slice(0, 10)] : []),
    ]
  }

  return { before, after, setup, totals, guard, client, get config() { return run.config } }
}

/**
 * Stops the run cleanly on Ctrl-C or SIGTERM. The first signal sets the guard's stopping flag, runs `finish` and exits with 130.
 * A second signal exits at once and leaves the items for the cleanup command.
 */
export function installSignalHandlers({ proc = process, guard, finish, exit = (code) => process.exit(code) }) {
  let signalled = false
  const handler = async () => {
    if (signalled) return exit(130)
    signalled = true
    guard.stop()
    try {
      await finish()
    } finally {
      exit(130)
    }
  }
  for (const name of ['SIGINT', 'SIGTERM']) proc.on(name, handler)
}

/** Registers the live suite: the hooks of `run`, the contract tests of the Linear families and the run's totals. */
export function registerLiveSuite(run) {
  describe('Linear tracker contract against the sandbox workspace', () => {
    before(() => run.before())
    after(() => run.after())
    runTrackerContract({ name: 'contract', families: LINEAR_FAMILIES, setup: run.setup })
    test('the totals of the run', (t) => {
      for (const line of run.totals()) t.diagnostic(line)
    })
  })
}

async function main(env, args) {
  const reason = skipReason(env)
  if (args[0] === 'cleanup') {
    if (reason) {
      console.log(reason)
      return 0
    }
    const workspace = env.PMKIT_LIVE_WORKSPACE
    const { fetch, guard } = createGuardedFetch({ fetch: globalThis.fetch, workspace })
    const client = createLinearClient({ env, tracker: { system: 'linear', scope: { workspace } }, fetch })
    return runCleanup({ client, env, workspace, guard, yes: args.includes('--yes'), write: (line) => console.log(line) })
  }
  if (reason) {
    test('the Linear contract suite against the sandbox workspace', { skip: reason }, () => {})
    return 0
  }
  const run = buildLiveRun({ env, fetch: globalThis.fetch, workspace: env.PMKIT_LIVE_WORKSPACE })
  installSignalHandlers({ guard: run.guard, finish: () => run.after() })
  registerLiveSuite(run)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.env, process.argv.slice(2))
}
