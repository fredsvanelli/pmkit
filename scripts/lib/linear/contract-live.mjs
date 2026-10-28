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

import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { createLinearClient } from './client.mjs'
import { linearCredential } from './credential.mjs'
import { createGuardedFetch, listTestTeamItems, preflight, trashTestTeamItems } from './sandbox.mjs'

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
  console.error('the live contract run is not wired yet')
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.env, process.argv.slice(2))
}
