// Opt-in live scenario suite: each scenario's `prompt` runs through a real agent (`claude -p`) on a fresh copy
// of its fixture, and the suite checks what the agent did. It costs money, so it never runs by default and
// `npm test` does not load it (the name does not end in .test.mjs).
//
//   PMKIT_LIVE=1 node --test scripts/scenarios-live.mjs        every scenario: 57 runs, up to $1 each
//   PMKIT_LIVE=1 node scripts/scenarios-live.mjs issues-move   only the named modules (node --test drops extra args)
//
// Each test is skipped unless PMKIT_LIVE is 1 and `claude` is on PATH. Each run passes --max-budget-usd 1, which
// the docs say can overshoot, so a full run can cost more than $32.
//
// Per scenario entry the suite prepares the copy as scripts/scenarios.test.mjs does (prepareCopy), logs every
// Bash and AskUserQuestion call through a PreToolUse hook, sends `prompt`, then each of `answers` as a new user
// turn after each `result` message, and closes stdin when the answers run out. It hashes the copy (outside
// .git) at each `result`.
//
// What a live run checks:
// - Every turn ends in success (no budget stop, no error).
// - stopProblems (scenario-helpers.mjs), in place of rule 9:
//   - the n-th write the agent ran comes after at least as many answers as the scenario has `confirm`
//     entries before its n-th write, so every stop counts, not only the first;
//   - the files of the copy do not change in a turn that starts with fewer answers than the scenario's first
//     write needs, or in any turn of a scenario that writes nothing. This needs no parsing of the log;
//   - a Bash command that names pmkit.mjs in a shape traceFromLog cannot read fails;
//   - a write that repeats a dry run of its CLI command has the args of an earlier dry run.
// - expect(repo): the full expect when it takes only `repo`. An expect that takes `saved` gets a stand-in that
//   stops it at the first `saved` read; the repo assertions before that read run, and LIVE_EXPECT_STOPS gives
//   the reason the rest cannot run live. An expect that stops with no reason listed, or runs to the end with
//   one listed, fails.
//
// What a live run does not check:
// - Rules 5 and 6 (which step a call belongs to) and the snapshot: the agent's calls vary from run to run.
// - Rules 7 and 10 (which confirmation point the agent hit): AskUserQuestion is not offered (see below), so a
//   stop is an answer turn with no key. Every answer counts as a stop, including the answer to a choice of
//   input (setup's prefix, a status name), so a write after such an answer counts as confirmed.
// - Rule 8 per call: only the tree hash at each stop.
// - The part of each expect after its first `saved` read (LIVE_EXPECT_STOPS lists 25 of 57 entries).
//
// Spike findings (claude 2.1.310, 2026-10-26, /pmkit:issues:move ISS-2X6D done on the team fixture, 2 runs):
// - The plugin command runs under -p despite `disable-model-invocation: true`. The agent read conventions.md,
//   ran issues get for the issue, its child and its blocker, then the dry run, and asked for approval.
// - AskUserQuestion is not offered under -p, with plain text input or with --input-format stream-json, even
//   when --tools names it: the init message did not list it. The agent asks in text and ends its turn, so no
//   hook can answer it. The hook below only logs AskUserQuestion, in case a later version offers the tool.
// - An answer sent as a second user turn over --input-format stream-json works: the write ran in that turn
//   and only then.
// - The PreToolUse hook also logs a call that the permission check then denies, so a denied write before an
//   answer fails although it never ran. The failure message lists the denials.
// - The agent chains calls in one Bash command (`P=.../pmkit.mjs; node $P issues get ...; node $P ...`).
// - Both runs passed --setting-sources project; only the second passed --strict-mcp-config. The first offered
//   50 MCP tools and cost $0.48 for one turn (9 model turns, one denied call); the second offered Bash and Read
//   and cost $0.12 for two turns. `total_cost_usd` of each result is cumulative.
//
// Permissions: --allowedTools "Bash(node *)" limits the program the agent may start, not what it does. A
// `node -e` script can write anywhere the developer can. The agent's environment holds childEnv() plus the
// keys claude needs (LIVE_ENV_KEYS), not the developer's whole environment.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { COMMANDS } from './pmkit.mjs'
import {
  expectUntilSaved, loadScenarios, makeRepoView, prepareCopy, snapshotFile, stopProblems, traceFromLog,
} from './scenario-helpers.mjs'
import { hashTree } from './test-helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.join(HERE, '..')
const SCENARIOS = path.join(HERE, '__scenarios__')
const FIXTURES = path.join(HERE, '__fixtures__')
const LIVE = process.env.PMKIT_LIVE === '1'
const ONLY = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
const RUN_TIMEOUT_MS = 10 * 60 * 1000
// childEnv() hides the global git config, so an agent commit takes the identity the scripted runner passes with -c.
const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'pmkit', GIT_AUTHOR_EMAIL: 'pmkit@example.com', GIT_COMMITTER_NAME: 'pmkit', GIT_COMMITTER_EMAIL: 'pmkit@example.com',
}
// What claude needs from the developer's environment: its home and login, locale, temp folder and network setup.
const LIVE_ENV_KEYS = /^(?:HOME|USER|LOGNAME|SHELL|LANG|LC_\w+|TMPDIR|XDG_\w+|ANTHROPIC_\w+|CLAUDE_CONFIG_DIR|(?:HTTPS?|NO|ALL)_PROXY|(?:https?|no|all)_proxy|NODE_EXTRA_CA_CERTS)$/

// Entries whose expect reads `saved` (the CLI results of the scripted run) and so stops there in a live run,
// with what is left unchecked. Keys are the test labels.
const LIVE_EXPECT_STOPS = {
  'backlog-groom': 'the backlog lists of the scripted run, and the estimate of 2, which the agent proposes',
  'cycle-close': 'the sync preview and issue lists, and the split estimates and retro text, which the agent chooses',
  'cycle-plan': 'the velocity and the scope the agent picks for the sprint',
  help: 'the capability manifest, the only thing a read-only help checks',
  'issues-dependencies.0': 'the dependency map of the scripted run, whose critical path the agent derives',
  'issues-dependencies.1': 'the dependency map of the scripted run, whose basis the agent derives',
  'issues-find': 'the two result lists, the only thing a read-only find checks',
  'issues-mine': 'the sync, list and PR status results the agent shows',
  'issues-pause': 'the PR preview and view results',
  'issues-summary.1': 'the epic, update and children results the summary shows',
  'issues-work': 'the readiness, PR preview and PR view results, and the follow-up issue, whose ID the agent gets',
  'local-doctor': 'the doctor results and the ISS-5 conflict resolution, which needs a file edit',
  'local-render': 'the render result of the scripted run, whose path, overwrite flag and problems the agent reports',
  'report-release-notes.0': 'the release and issue results of the scripted run, whose draft grouping and wording the agent writes',
  'report-release-notes.1': 'the release and issue results of the scripted run, whose period and wording the agent chooses',
  'setup.0': 'the init preview, validate and discover results',
  'setup.1': 'the init preview and validate results',
  'spec-import': 'every check: they find the new epic and issues through the IDs the scripted run saved',
  'team-capacity': 'the capacity reads and the preview of the scripted run, which the agent words itself',
  'team-flow-metrics': 'the metrics results the agent shows',
  'team-load': 'the load tables of the scripted run, which the agent words itself',
  'team-risk-radar': 'the risks of the scripted run, which the agent ranks and words itself',
  'team-standup': 'the sync, list, events and PR status results the standup shows',
  'issues-unblock': 'the blockers result of the scripted run, which the agent words itself',
  upgrade: 'the changelog sections and the migration plan',
}

const HOOK = `// PreToolUse hook of the live suite: appends { tool, command } or { tool, questions } to the log in argv[2].
// A failed append exits 2, which blocks the call, so no call runs unlogged.
import fs from 'node:fs'
try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'))
  const row = input.tool_name === 'Bash'
    ? { tool: 'Bash', command: input.tool_input.command }
    : { tool: input.tool_name, questions: input.tool_input.questions }
  fs.appendFileSync(process.argv[2], JSON.stringify(row) + '\\n')
} catch (error) {
  process.stderr.write('live suite hook: ' + error.message)
  process.exit(2)
}
`

function skipReason() {
  if (!LIVE) return 'set PMKIT_LIVE=1 to run the live suite'
  if (spawnSync('claude', ['--version']).status !== 0) return 'claude is not on PATH'
  return null
}

/** The agent's environment: the scenario env, the keys claude needs from the developer's, and the git identity. */
function liveEnv(env) {
  const kept = Object.entries(process.env).filter(([key]) => LIVE_ENV_KEYS.test(key))
  return { ...Object.fromEntries(kept), ...env, ...GIT_IDENTITY }
}

/** Writes the hook and the settings file into `scratch` and returns the settings path and the log path. */
function writeHooks(scratch) {
  const hook = path.join(scratch, 'log-hook.mjs')
  const log = path.join(scratch, 'log.jsonl')
  const settings = path.join(scratch, 'settings.json')
  fs.writeFileSync(hook, HOOK)
  fs.writeFileSync(log, '')
  const command = `node ${JSON.stringify(hook)} ${JSON.stringify(log)}`
  fs.writeFileSync(settings, JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash|AskUserQuestion', hooks: [{ type: 'command', command }] }] },
  }))
  return { settings, log }
}

/**
 * Runs `claude -p` with stream-json input in `root`: sends `prompt`, then one answer per `result` message until
 * the answers run out, and logs each answer as a `turn` line. Returns the `result` messages and the hash of the
 * copy (outside .git) at each of them, taken before the next answer goes out.
 */
function runClaude({ root, env, settings, log, prompt, answers, git }) {
  const allowed = ['Bash(node *)', 'Read', 'Glob', 'Grep', ...(git ? ['Bash(git *)'] : [])]
  const args = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--plugin-dir', PLUGIN, '--settings', settings, '--setting-sources', 'project', '--strict-mcp-config',
    '--tools', 'Bash,Read,Glob,Grep', '--allowedTools', ...allowed,
    '--max-budget-usd', '1', '--no-session-persistence',
  ]
  const pending = [...answers]
  const results = []
  const trees = []
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const send = (text) => child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`)
    const timer = setTimeout(() => child.kill('SIGTERM'), RUN_TIMEOUT_MS)
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let message
      try {
        message = JSON.parse(line)
      } catch {
        return
      }
      if (message.type !== 'result') return
      results.push(message)
      trees.push(hashTree(root, ['.git']))
      const answer = pending.shift()
      if (answer === undefined || message.subtype !== 'success') return child.stdin.end()
      fs.appendFileSync(log, `${JSON.stringify({ tool: 'turn', answer })}\n`)
      send(answer)
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (signal || !results.length) reject(new Error(`claude exited ${signal ?? code} with ${results.length} results: ${stderr}`))
      else resolve({ results, trees })
    })
    send(prompt)
  })
}

/** Runs the expect of a live entry: the whole of it, or up to its first `saved` read when LIVE_EXPECT_STOPS lists it. */
async function liveExpect(t, label, scenario, repo) {
  const reason = LIVE_EXPECT_STOPS[label]
  const stoppedAt = await expectUntilSaved(scenario.expect, repo)
  if (!stoppedAt) {
    assert.equal(reason, undefined, `LIVE_EXPECT_STOPS lists ${label}, but its expect ran to the end`)
    return
  }
  assert.ok(reason, `expect read ${stoppedAt}, and LIVE_EXPECT_STOPS gives no reason for ${label}`)
  t.diagnostic(`expect stopped at ${stoppedAt}; not checked live: ${reason}`)
}

const LOADED = (await loadScenarios(SCENARIOS)).filter(({ name }) => !ONLY.length || ONLY.includes(name))
const SKIP = skipReason()

describe('live scenarios', () => {
  for (const { name, entries } of LOADED) {
    entries.forEach((scenario, index) => {
      const label = snapshotFile(name, index, entries.length).replace(/\.after\.txt$/, '')
      test(`live ${label}`, { skip: SKIP ?? (scenario.linear ? 'a Linear scenario runs only on the fake workspace' : false) }, async (t) => {
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-live-'))
        try {
          const { root, env, baseline, gh } = await prepareCopy(scenario, { scratch, fixturesDir: FIXTURES })
          const baselineTree = hashTree(root, ['.git'])
          const { settings, log } = writeHooks(scratch)
          const { results, trees } = await runClaude({
            root,
            env: liveEnv(env),
            settings,
            log,
            prompt: scenario.prompt,
            answers: scenario.answers ?? [],
            git: scenario.git || scenario.github,
          })
          const cost = results.at(-1).total_cost_usd
          const denials = results.flatMap((result) => result.permission_denials ?? [])
          t.diagnostic(`cost $${cost}, ${results.length} turns, ${denials.length} denied calls`)
          const context = `\ndenied calls: ${JSON.stringify(denials.map((denial) => denial.tool_input))}`
          const failed = results.filter((result) => result.subtype !== 'success')
          assert.deepEqual(failed.map((result) => result.subtype), [], `the run did not finish${context}`)

          const lines = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
          const trace = traceFromLog(lines, COMMANDS)
          assert.deepEqual(stopProblems({ steps: scenario.steps, trace, trees, baseline: baselineTree }), [], context)
          await liveExpect(t, label, scenario, makeRepoView(root, baseline, gh, env))
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true })
        }
      })
    })
  }
})
