// A fake gh for the GitHub live checks (scripts/lib/github/live-checks.mjs). It answers from two stateful fake GitHubs, one for
// github.com and one for the GHES host of --hostname, and reads the environment gh would read: with GH_CONFIG_DIR set to a folder
// without hosts.yml and no token it answers as a logged-out gh, BAD_TOKEN gets HTTP 401 and the scopeless token gets
// INSUFFICIENT_SCOPES on a Project read. Every GraphQL answer carries the rate-limit headers GitHub sends.
// liveGhExec serves the unit tests through makeExec; liveGhOnPath writes a gh first on PATH for the runbook's E2E test.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { hostnameOf } from './fake-github-api.mjs'
import { fakeGithubIssuesFrom } from './fake-github-issues.mjs'
import { BAD_TOKEN, TOKEN_VARIABLES } from './lib/github/live-checks.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const LOGGED_OUT = 'To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n'
const RATE = 'X-Ratelimit-Limit: 5000\r\nX-Ratelimit-Remaining: 4998\r\nX-Ratelimit-Used: 2\r\nX-Ratelimit-Resource: graphql\r\nX-Ratelimit-Reset: 1795000000\r\n'
const SCOPE_REPLY = {
  errors: [{ type: 'INSUFFICIENT_SCOPES', message: "Your token has not been granted the required scopes to execute this query. The 'projectsV2' field requires one of the following scopes: ['read:project'], but your token has only been granted the: ['repo'] scopes. Please modify your token's scopes at: https://github.com/settings/tokens." }],
}

const head = (status, reason, extra = '') => `HTTP/2.0 ${status} ${reason}\r\nContent-Type: application/json; charset=utf-8\r\n${extra}\r\n`

/** The answer gh gives for the token or login of env before any fake GitHub reads the call, or null when the call goes through. */
function credentialAnswer(env, args, input, scopelessToken) {
  const token = TOKEN_VARIABLES.map((name) => env[name]).find((value) => typeof value === 'string' && value !== '')
  if (!token && env.GH_CONFIG_DIR && !fs.existsSync(path.join(env.GH_CONFIG_DIR, 'hosts.yml'))) return { status: 4, stdout: '', stderr: LOGGED_OUT }
  if (token === BAD_TOKEN) {
    return { status: 1, stdout: `${head(401, 'Unauthorized')}{"message":"Bad credentials","documentation_url":"https://docs.github.com/graphql","status":"401"}`, stderr: 'gh: Bad credentials (HTTP 401)\n' }
  }
  const readsProjects = args.includes('graphql') && /projectsV2?\b/.test(JSON.parse(input ?? '{}').query ?? '')
  if (scopelessToken && token === scopelessToken && readsProjects) {
    return { status: 1, stdout: `${head(200, 'OK', RATE)}${JSON.stringify(SCOPE_REPLY)}`, stderr: `gh: ${SCOPE_REPLY.errors[0].message}\n` }
  }
  return null
}

/** gh's answer for args and stdin under env: { status, stdout, stderr }. fakes is { github, ghes }, each a fake GitHub or null. */
export function answerLive(fakes, env, args, input, { scopelessToken = null } = {}) {
  const refused = credentialAnswer(env, args, input, scopelessToken)
  if (refused) return refused
  const graphql = args.includes('graphql')
  const host = hostnameOf(args) ?? 'github.com'
  const fake = host === 'github.com' ? fakes.github : fakes.ghes
  if (!fake) return { status: 1, stdout: '', stderr: `error connecting to ${host}\n` }
  const answer = fake.exec('gh', args, { input })
  if (!graphql || !answer.stdout.startsWith('HTTP/')) return answer
  return { ...answer, stdout: answer.stdout.replace(/X-Ratelimit-Limit: \d+\r\nX-Ratelimit-Remaining: \d+\r\n/, RATE) }
}

/** makeExec for the live checks over two fake GitHubs: (env) => exec. */
export const liveGhExec = (fakes, options = {}) => (env) => (cmd, args, { input } = {}) => answerLive(fakes, env, args, input, options)

/**
 * Writes a fake gh into the folder bin, to put first on PATH, over a fixture { github, ghes, scopelessToken }, where github and ghes
 * are the toJSON() of fake GitHubs or null. The state is written back after each call. Returns { bin, fixtureFile }.
 * The gh script imports this module, so the module loads nothing that prints, such as node:test.
 */
export function liveGhOnPath(fixture, bin) {
  const fixtureFile = path.join(bin, 'fixture.json')
  fs.writeFileSync(fixtureFile, JSON.stringify(fixture))
  const script = `#!/usr/bin/env node
import fs from 'node:fs'
import { answerLiveFromFile } from ${JSON.stringify(pathToFileURL(path.join(SCRIPTS, 'fake-gh-live.mjs')).href)}
let input = ''
try { input = fs.readFileSync(0, 'utf8') } catch {}
const answer = answerLiveFromFile(${JSON.stringify(fixtureFile)}, process.env, process.argv.slice(2), input)
process.stdout.write(answer.stdout)
process.stderr.write(answer.stderr)
process.exitCode = answer.status
`
  fs.writeFileSync(path.join(bin, 'gh.mjs'), script)
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, 'gh.mjs')}" "$@"\n`, { mode: 0o755 })
  return { bin, fixtureFile }
}

/**
 * One call of the PATH fake: loads the fixture, answers, and saves the new state of both fake GitHubs. A fixture whose pauseOn names
 * the call's GraphQL operation pauses once instead: it writes the file paused next to the fixture and blocks for up to 30 seconds,
 * so a test can send the run a signal while this call is in flight (PMK-349).
 */
export function answerLiveFromFile(fixtureFile, env, args, input) {
  const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'))
  if (fixture.pauseOn && new RegExp(`\\b${fixture.pauseOn}\\b`).test(input ?? '')) {
    fs.writeFileSync(fixtureFile, JSON.stringify({ ...fixture, pauseOn: null }))
    fs.writeFileSync(path.join(path.dirname(fixtureFile), 'paused'), '')
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000)
    return { status: 1, stdout: '', stderr: 'the fake gh paused and was not stopped\n' }
  }
  const fakes = { github: fixture.github ? fakeGithubIssuesFrom(fixture.github) : null, ghes: fixture.ghes ? fakeGithubIssuesFrom(fixture.ghes) : null }
  const answer = answerLive(fakes, env, args, input, { scopelessToken: fixture.scopelessToken })
  fs.writeFileSync(fixtureFile, JSON.stringify({ ...fixture, github: fakes.github?.toJSON() ?? null, ghes: fakes.ghes?.toJSON() ?? null }))
  return answer
}
