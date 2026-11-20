// E2E test of docs/runbooks/live-checks-github.md: runs the opt-in entry scripts/lib/github/client-live.mjs as the runbook says, as a
// subprocess, with a fake gh first on PATH that answers from two stateful fake GitHubs (github.com and a GHES host) and keeps
// their state in a fixture file between gh calls. No call leaves the machine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { liveGhOnPath } from './fake-gh-live.mjs'
import { fakeGithubIssues } from './fake-github-issues.mjs'
import { childEnv } from './golden-helpers.mjs'
import { tempDir } from './test-helpers.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(SCRIPTS, '..')
const ENTRY = 'scripts/lib/github/client-live.mjs'
const RUNBOOK = path.join(ROOT, 'docs', 'runbooks', 'live-checks-github.md')
const SCOPELESS = `ghp_${'R'.repeat(36)}`
const ITERATIONS = { completed: [{ id: 'IT_0', title: 'Sprint 1', startDate: '2026-11-02', duration: 14 }], iterations: [{ id: 'IT_1', title: 'Sprint 2', startDate: '2026-11-16', duration: 14 }] }
const GITHUB = { PMKIT_LIVE_GITHUB_REPO: 'acme/widgets', PMKIT_LIVE_GITHUB_PROJECT: 'acme/7', PMKIT_LIVE_GITHUB_SCOPELESS_TOKEN: SCOPELESS }
const GHES = { PMKIT_LIVE_GHES_HOST: 'ghes.example.com', PMKIT_LIVE_GHES_REPO: 'acme/widgets', PMKIT_LIVE_GHES_PROJECT: 'acme/7' }

/** The state "Prepare the accounts" describes: an empty throwaway Project with an iteration field on each host. */
function fakeGh() {
  return liveGhOnPath({
    github: fakeGithubIssues({ project: { title: 'pmkit-live checks', iterations: ITERATIONS } }).toJSON(),
    ghes: fakeGithubIssues({ host: 'ghes.example.com', ghesVersion: '3.19.0', project: { title: 'pmkit-live checks' } }).toJSON(),
    scopelessToken: SCOPELESS,
  }, tempDir('pmkit-fake-gh-live-'))
}

/** Runs the entry as the runbook says, with the TAP reporter. Returns { code, stdout, results: [{ ok, name, skip }] }. */
function runChecks(fake, vars) {
  const env = { ...childEnv(), PATH: `${fake.bin}${path.delimiter}${process.env.PATH}`, ...vars }
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ENTRY], { cwd: ROOT, env, encoding: 'utf8' })
  const results = [...result.stdout.matchAll(/^(not ok|ok) \d+ - (.+?)(?: # SKIP (.*))?$/gm)].map(([, ok, name, skip]) => ({ ok: ok === 'ok', name, skip: skip ?? null }))
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, results }
}

const state = (fake) => JSON.parse(fs.readFileSync(fake.fixtureFile, 'utf8'))

test('the runbook names the commands and the skip reasons this test checks', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8')
  for (const expected of [
    `node --test ${ENTRY}`, 'set PMKIT_LIVE=1 to run the live check', 'no GHES host configured', ...Object.keys({ ...GITHUB, ...GHES }), 'pmkit-live',
  ]) assert.ok(text.includes(expected), expected)
})

test('runbook: without PMKIT_LIVE every check is skipped with its reason, and nothing reaches gh', () => {
  const fake = fakeGh()
  const before = fs.readFileSync(fake.fixtureFile, 'utf8')
  const run = runChecks(fake, { ...GITHUB, ...GHES })
  assert.equal(run.code, 0, run.stdout + run.stderr)
  assert.equal(run.results.length, 8)
  assert.ok(run.results.every((result) => result.ok && result.skip === 'set PMKIT_LIVE=1 to run the live check'), run.stdout)
  assert.equal(fs.readFileSync(fake.fixtureFile, 'utf8'), before)
})

test('runbook: with the github.com targets the github.com checks pass and the GHES check is skipped with its note', () => {
  const fake = fakeGh()
  const run = runChecks(fake, { PMKIT_LIVE: '1', ...GITHUB })
  assert.equal(run.code, 0, run.stdout + run.stderr)
  const skipped = run.results.filter((result) => result.skip)
  assert.deepEqual(skipped.map((result) => result.name), ['a draft issue converts into an issue on GHES 3.19'])
  assert.match(skipped[0].skip, /^no GHES host configured: set PMKIT_LIVE_GHES_HOST/)
  assert.equal(run.results.filter((result) => result.ok && !result.skip).length, 7)
  assert.ok(!run.stdout.includes(SCOPELESS) && !run.stderr.includes(SCOPELESS))
  const github = state(fake).github
  assert.deepEqual(github.items, [])
  const field = github.project.fields.find((item) => item.dataType === 'ITERATION')
  assert.deepEqual([...field.configuration.completedIterations, ...field.configuration.iterations].map((item) => item.id).sort(), ['IT_0', 'IT_1'])
})

test('runbook: with every target all eight checks pass, and both throwaway Projects end empty', () => {
  const fake = fakeGh()
  const run = runChecks(fake, { PMKIT_LIVE: '1', ...GITHUB, ...GHES })
  assert.equal(run.code, 0, run.stdout + run.stderr)
  assert.equal(run.results.filter((result) => result.ok && !result.skip).length, 8, run.stdout)
  assert.match(run.stdout, /# GitHub Enterprise Server 3\.19\.0/)
  // TAP escapes # inside a diagnostic.
  assert.match(run.stdout, /# converted the draft into issue \\#1: https:\/\/ghes\.example\.com\/acme\/widgets\/issues\/1/)
  const { github, ghes } = state(fake)
  assert.deepEqual([github.items, ghes.items, ghes.issues], [[], [], []])
})

test('runbook: a check fails, and says why, on a Project that is not a throwaway one', () => {
  const fake = liveGhOnPath({ github: fakeGithubIssues({ project: { title: 'Roadmap', iterations: ITERATIONS } }).toJSON(), ghes: null, scopelessToken: SCOPELESS }, tempDir('pmkit-fake-gh-live-'))
  const run = runChecks(fake, { PMKIT_LIVE: '1', ...GITHUB })
  assert.equal(run.code, 1)
  const failed = run.results.filter((result) => !result.ok).map((result) => result.name)
  assert.deepEqual(failed, ['openCycle keeps the iteration of every item on a throwaway Project'])
  assert.match(run.stdout, /the title of the Project acme\/7 does not start with pmkit-live/)
  assert.deepEqual(state(fake).github.items, [])
})
