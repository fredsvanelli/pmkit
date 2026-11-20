// Opt-in live checks of the GitHub adapter against github.com and a GitHub Enterprise Server host (PMK-335): the client's error
// shapes, discover, openCycle on a throwaway Project, and the conversion of a draft issue on GHES.
// `npm test` does not load it (the name does not end in .test.mjs), and scripts/run-tests.mjs strips PMKIT_LIVE from its child.
//
//   PMKIT_LIVE=1 PMKIT_LIVE_GITHUB_REPO=<owner/name> PMKIT_LIVE_GITHUB_PROJECT=<owner/number> node --test scripts/lib/github/client-live.mjs
//
// docs/runbooks/live-checks-github.md lists every variable, how to prepare the account and how to clean up. Each test is skipped,
// with the reason that names the missing variable, unless PMKIT_LIVE is 1 and its targets are set. The checks run the gh login of
// the shell, write only to the throwaway Projects they check first, and clean up after themselves.

import os from 'node:os'
import test from 'node:test'
import { defaultExec } from './host.mjs'
import {
  checkDiscover, checkGhesConversion, checkMissingScope, checkNoLogin, checkNotFound, checkOpenCycle, checkRateHeaders, checkRejectedToken,
  skipReasons,
} from './live-checks.mjs'

const reasons = skipReasons(process.env)
const makeExec = (env) => defaultExec({ root: os.tmpdir(), env })

/** One test body: runs the check, then prints what it asserted and wrote as diagnostics. */
const run = (check) => async (t) => {
  const { asserted } = await check({ env: process.env, makeExec, write: (line) => t.diagnostic(line) })
  for (const line of asserted) t.diagnostic(`asserted: ${line}`)
}

test('github.com error shape: gh with no login is AUTH', { skip: reasons.errors }, run(checkNoLogin))
test('github.com error shape: a token GitHub does not know is AUTH', { skip: reasons.errors }, run(checkRejectedToken))
test('github.com error shape: a repository that does not exist is NOT_FOUND', { skip: reasons.errors }, run(checkNotFound))
test('github.com error shape: the rate-limit headers fill the GraphQL bucket', { skip: reasons.errors }, run(checkRateHeaders))
test('github.com error shape: a token without the project scope is AUTH with gh auth refresh -s project', { skip: reasons.scope }, run(checkMissingScope))
test('discover reads a github.com repository with a Project', { skip: reasons.discover }, run(checkDiscover))
test('openCycle keeps the iteration of every item on a throwaway Project', { skip: reasons.openCycle }, run(checkOpenCycle))
test('a draft issue converts into an issue on GHES 3.19', { skip: reasons.ghes }, run(checkGhesConversion))
