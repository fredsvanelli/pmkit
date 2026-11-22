// Every contract operation a remote adapter's `*-ops.mjs` module implements is routed by its tracker (PMK-354). An operation the `contract` map of
// `tracker.mjs` leaves out falls to the stub and answers NOT_SUPPORTED with no other sign, as `moveDeliverable` did before PMK-353.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { TRACKER_OPERATIONS } from './contract.mjs'
import { fakeGithubIssues } from '../fake-github-issues.mjs'
import { ACME_STATES, ACME_TEAM, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeLinearProjects, fakeWorkspace } from '../fake-linear-api.mjs'
import { tempDir, userStoreEnv } from '../test-helpers.mjs'
import { createGithubTracker } from './github/tracker.mjs'
import { createLinearTracker } from './linear/tracker.mjs'

const LIB = path.dirname(fileURLToPath(import.meta.url))

// A stand-in for any dependency of an ops factory: every property and call gives it back, so a factory returns its operations without a client.
const inert = new Proxy(function () {}, { get: (_, key) => (key === 'then' ? undefined : key === Symbol.toPrimitive ? () => '' : inert), apply: () => inert })

/** The contract operations each `*Operations` factory of `scripts/lib/<system>/*-ops.mjs` returns, as `[operation, file]`. A new module is read with no change here. */
async function opsOperations(system) {
  const found = []
  for (const file of fs.readdirSync(path.join(LIB, system)).filter((name) => name.endsWith('-ops.mjs')).sort()) {
    const module = await import(pathToFileURL(path.join(LIB, system, file)).href)
    for (const [name, factory] of Object.entries(module)) {
      if (typeof factory !== 'function' || !name.endsWith('Operations')) continue
      for (const operation of Object.keys(factory(inert))) if (TRACKER_OPERATIONS.includes(operation)) found.push([operation, file])
    }
  }
  return found
}

/** The operations the tracker answers with the stub's refusal, each named with the module that implements it. Arguments are left out: any other outcome means the operation is routed. */
async function unrouted(tracker, operations, system) {
  const missing = []
  for (const [operation, file] of operations) {
    try {
      await tracker[operation]()
    } catch (error) {
      if (error.code === 'NOT_SUPPORTED' && error.message.includes(`does not implement ${operation} yet`)) missing.push(`${operation} (${file}) is not routed by scripts/lib/${system}/tracker.mjs`)
    }
  }
  return missing
}

function githubTracker() {
  const STATUS = { triage: 'Triage', backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress', in_review: 'In Review', done: 'Done', canceled: 'Canceled' }
  const fake = fakeGithubIssues({ project: { statusOptions: Object.values(STATUS), iterations: { fieldName: 'Sprint' } } })
  const { env } = userStoreEnv()
  const config = {
    root: tempDir(),
    pmkit: {
      version: 1,
      tracker: { system: 'github', scope: { host: 'github.com', repo: 'acme/widgets', project: 'acme/7' } },
      git_host: { system: 'github' },
      mappings: { status: STATUS, types: { feature: 'Feature', bug: 'Bug', task: 'Task' }, fields: { priority: 'issue:Priority', estimate: 'issue:Effort', target_date: 'issue:Target date', start_date: 'none', sprint: 'project:Sprint' } },
    },
  }
  return createGithubTracker(config, { env, exec: fake.exec, now: () => new Date('2026-11-16T12:00:00Z') })
}

function linearTracker() {
  const teams = [{ ...ACME_TEAM, triageEnabled: true, cyclesEnabled: true }]
  const issues = fakeLinearIssues({ teams, states: ACME_STATES, cycles: [] })
  const projects = fakeLinearProjects({ issues, teams, states: ACME_STATES })
  const fetch = fakeLinearFetch({ ...fakeWorkspace({ teams, states: ACME_STATES }), ...issues.routes, ...projects.routes })
  const { env } = userStoreEnv()
  const config = { root: tempDir(), pmkit: { version: 1, tracker: { system: 'linear', scope: { workspace: 'acme', team: 'ACME' } }, git_host: { system: 'github' }, mappings: { status: { in_review: 'In Review' } } } }
  return createLinearTracker(config, { env: { ...env, LINEAR_API_KEY: FAKE_KEY }, fetch })
}

for (const [system, make] of [['github', githubTracker], ['linear', linearTracker]]) {
  test(`the ${system} tracker routes every contract operation its *-ops.mjs modules implement (PMK-354)`, async () => {
    const operations = await opsOperations(system)
    // A floor, so a test that reads no module cannot pass by finding nothing.
    assert.ok(operations.length >= 30, `only ${operations.length} operations found in scripts/lib/${system}/*-ops.mjs`)
    assert.deepEqual(await unrouted(make(), operations, system), [])
  })
}
