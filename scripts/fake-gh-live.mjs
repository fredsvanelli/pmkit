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
import { BAD_TOKEN } from './lib/github/live-checks.mjs'
import { tempDir } from './test-helpers.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const TOKEN_VARIABLES = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']
const LOGGED_OUT = 'To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n'
const RATE = 'X-Ratelimit-Limit: 5000\r\nX-Ratelimit-Remaining: 4998\r\nX-Ratelimit-Used: 2\r\nX-Ratelimit-Resource: graphql\r\nX-Ratelimit-Reset: 1795000000\r\n'
const SCOPE_REPLY = {
  errors: [{ type: 'INSUFFICIENT_SCOPES', message: "Your token has not been granted the required scopes to execute this query. The 'projectsV2' field requires one of the following scopes: ['read:project'], but your token has only been granted the: ['repo'] scopes. Please modify your token's scopes at: https://github.com/settings/tokens." }],
}

const head = (status, reason, extra = '') => `HTTP/2.0 ${status} ${reason}\r\nContent-Type: application/json; charset=utf-8\r\n${extra}\r\n`

/** gh's answer for args and stdin under env: { status, stdout, stderr }. fakes is { github, ghes }, each a fake GitHub or null. */
export function answerLive(fakes, env, args, input, { scopelessToken = null } = {}) {
  const token = TOKEN_VARIABLES.map((name) => env[name]).find((value) => typeof value === 'string' && value !== '')
  if (!token && env.GH_CONFIG_DIR && !fs.existsSync(path.join(env.GH_CONFIG_DIR, 'hosts.yml'))) return { status: 4, stdout: '', stderr: LOGGED_OUT }
  const graphql = args.includes('graphql')
  if (token === BAD_TOKEN) {
    return { status: 1, stdout: `${head(401, 'Unauthorized')}{"message":"Bad credentials","documentation_url":"https://docs.github.com/graphql","status":"401"}`, stderr: 'gh: Bad credentials (HTTP 401)\n' }
  }
  if (graphql && scopelessToken && token === scopelessToken && /projectsV2?\b/.test(JSON.parse(input ?? '{}').query ?? '')) {
    return { status: 1, stdout: `${head(200, 'OK', RATE)}${JSON.stringify(SCOPE_REPLY)}`, stderr: `gh: ${SCOPE_REPLY.errors[0].message}\n` }
  }
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
 * Writes a fake gh first on PATH over a fixture { github, ghes, scopelessToken }, where github and ghes are the toJSON() of fake
 * GitHubs or null. The state is written back after each call. Returns { bin, fixtureFile }.
 */
export function liveGhOnPath(fixture) {
  const bin = tempDir('pmkit-fake-gh-live-')
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

/** One call of the PATH fake: loads the fixture, answers, and saves the new state of both fake GitHubs. */
export function answerLiveFromFile(fixtureFile, env, args, input) {
  const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'))
  const fakes = { github: fixture.github ? fakeGithubIssuesFrom(fixture.github) : null, ghes: fixture.ghes ? fakeGithubIssuesFrom(fixture.ghes) : null }
  const answer = answerLive(fakes, env, args, input, { scopelessToken: fixture.scopelessToken })
  fs.writeFileSync(fixtureFile, JSON.stringify({ ...fixture, github: fakes.github?.toJSON() ?? null, ghes: fakes.ghes?.toJSON() ?? null }))
  return answer
}
