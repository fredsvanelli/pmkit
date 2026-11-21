// Opt-in live checks of the GitHub adapter against github.com and a GitHub Enterprise Server host (PMK-335): the client's error
// shapes, discover, openCycle on a throwaway Project, and the conversion of a draft issue on GHES.
// `npm test` does not load it (the name does not end in .test.mjs), and scripts/run-tests.mjs strips PMKIT_LIVE from its child.
//
//   PMKIT_LIVE=1 PMKIT_LIVE_GITHUB_REPO=<owner/name> PMKIT_LIVE_GITHUB_PROJECT=<owner/number> node scripts/lib/github/client-live.mjs
//
// docs/runbooks/live-checks-github.md lists every variable, how to prepare the account and how to clean up. Each test is skipped,
// with the reason that names the missing variable, unless PMKIT_LIVE is 1 and its targets are set. The checks run the gh login of
// the shell, write only to the throwaway Projects they check first, and clean up after themselves.

import fs from 'node:fs'
import os from 'node:os'
import test from 'node:test'
import { defaultExec } from './host.mjs'
import {
  checkDiscover, checkGhesConversion, checkMissingScope, checkNoLogin, checkNotFound, checkOpenCycle, checkRateHeaders, checkRejectedToken,
  cleanUpPending, INTERRUPTED_STEP, skipReasons,
} from './live-checks.mjs'

const reasons = skipReasons(process.env)

// Ctrl-C (SIGINT) or SIGTERM stops the run after the cleanup of the writing check in flight, and exits 130 or 143 (PMK-349).
// gh runs synchronously, so Ctrl-C usually lands during a gh call: it ends that call, which the exec below reports, the check fails
// and runs its own cleanup, and the run stops before the next check. A signal between two calls reaches the handlers, which run
// the pending cleanup. Lines go to stderr with writeSync, as an exit drops what an asynchronous pipe has not written yet.
// Run the entry with plain node, as the runbook says: under node --test the runner exits first and leaves nowhere to print.
let stopped = null
let finishing = null
const say = (line) => fs.writeSync(2, `${line}\n`)
/** Records the signal that stops the run, once, and says so before the cleanup lines. */
const stop = (signal) => {
  if (stopped) return
  stopped = signal
  say(`${signal}: stopping the live checks after cleaning up what they wrote`)
}
const finish = () => (finishing ??= (async () => {
  await cleanUpPending(say)
  say(INTERRUPTED_STEP)
  process.exit(stopped === 'SIGTERM' ? 143 : 130)
})())
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stop(signal)
    finish()
  })
}

const makeExec = (env) => {
  const exec = defaultExec({ root: os.tmpdir(), env })
  return (cmd, args, options) => {
    const answer = exec(cmd, args, options)
    if (answer.signal === 'SIGINT' || answer.signal === 'SIGTERM') stop(answer.signal)
    return answer
  }
}

/** One test body: runs the check, then prints what it asserted and wrote as diagnostics, or to stderr once stopped. */
const run = (check) => async (t) => {
  const write = (line) => (stopped ? say(line) : t.diagnostic(line))
  try {
    const { asserted } = await check({ env: process.env, makeExec, write })
    for (const line of asserted) t.diagnostic(`asserted: ${line}`)
  } finally {
    if (stopped) await finish()
  }
}

test('github.com error shape: gh with no login is AUTH', { skip: reasons.errors }, run(checkNoLogin))
test('github.com error shape: a token GitHub does not know is AUTH', { skip: reasons.errors }, run(checkRejectedToken))
test('github.com error shape: a repository that does not exist is NOT_FOUND', { skip: reasons.errors }, run(checkNotFound))
test('github.com error shape: the rate-limit headers fill the GraphQL bucket', { skip: reasons.errors }, run(checkRateHeaders))
test('github.com error shape: a token without the project scope is AUTH with gh auth refresh -s project', { skip: reasons.scope }, run(checkMissingScope))
test('discover reads a github.com repository with a Project', { skip: reasons.discover }, run(checkDiscover))
test('openCycle keeps the iteration of every item on a throwaway Project', { skip: reasons.openCycle }, run(checkOpenCycle))
test('a draft issue converts into an issue on GHES 3.19', { skip: reasons.ghes }, run(checkGhesConversion))
