// A fake gh first on PATH for the runbook tests: it answers through answerGh (scripts/fake-github-api.mjs) from a fixture file,
// writes the fixture back after each call so the state of the stateful fake GitHub persists between CLI runs, and logs each call.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tempDir } from './test-helpers.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))

/**
 * The init of a GitHub Issues tracker on the stateful fake GitHub's acme/widgets and its Project acme/7: what the runbook
 * tests and the GitHub scenarios set up first.
 */
export const GITHUB_TRACKER_INIT = Object.freeze([
  'init', '--tracker', 'github', '--git-host', 'github', '--host', 'github.com', '--repo', 'acme/widgets', '--project', 'acme/7',
  ...['backlog=Backlog', 'todo=Todo', 'in_progress=In Progress', 'in_review=In Review', 'done=Done', 'canceled=none', 'blocked=none'].flatMap((item) => ['--status', item]),
  ...['priority=issue:Priority', 'estimate=issue:Effort', 'start_date=issue:Start date', 'target_date=issue:Target date'].flatMap((item) => ['--field', item]),
  ...['feature=Feature', 'bug=Bug', 'task=Task', 'chore=none'].flatMap((item) => ['--type-label', item]),
])

/** Writes the fake gh into a new folder and returns { bin, fixtureFile, log }. */
export function statefulGhOnPath(fixture) {
  const bin = tempDir('pmkit-fake-gh-')
  const fixtureFile = path.join(bin, 'fixture.json')
  const log = path.join(bin, 'calls.jsonl')
  fs.writeFileSync(fixtureFile, JSON.stringify(fixture))
  const api = pathToFileURL(path.join(SCRIPTS, 'fake-github-api.mjs')).href
  const script = `#!/usr/bin/env node
import fs from 'node:fs'
import { answerGh } from ${JSON.stringify(api)}
const args = process.argv.slice(2)
let input = ''
try { input = fs.readFileSync(0, 'utf8') } catch {}
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, input }) + '\\n')
const fixture = JSON.parse(fs.readFileSync(${JSON.stringify(fixtureFile)}, 'utf8'))
const answer = answerGh(args, input, fixture)
fs.writeFileSync(${JSON.stringify(fixtureFile)}, JSON.stringify(fixture))
process.stdout.write(answer.stdout)
process.stderr.write(answer.stderr)
process.exitCode = answer.status
`
  fs.writeFileSync(path.join(bin, 'gh.mjs'), script)
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, 'gh.mjs')}" "$@"\n`, { mode: 0o755 })
  return { bin, fixtureFile, log }
}

/** The calls the fake gh logged, each { args, input }. */
export const statefulGhCalls = (fake) => (fs.existsSync(fake.log) ? fs.readFileSync(fake.log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [])
