// Opt-in live scenario suite: each scenario's `prompt` runs through a real agent (`claude -p`) on a fresh copy
// of its fixture, and the suite checks what the agent did. It costs money, so it never runs by default and
// `npm test` does not load it (the name does not end in .test.mjs).
//
//   PMKIT_LIVE=1 node --test scripts/scenarios-live.mjs        every scenario
//   PMKIT_LIVE=1 node scripts/scenarios-live.mjs issues-move   only the named modules (node --test drops extra args)
//
// Each test is skipped unless PMKIT_LIVE is 1 and `claude` is on PATH. Each run passes --max-budget-usd 1.
//
// Per scenario entry the suite:
// - prepares the copy as scripts/scenarios.test.mjs does (prepareCopy: fixture, git, github, setup, baseline);
// - logs every Bash and AskUserQuestion call through a PreToolUse hook into a JSONL file;
// - sends `prompt`, then each of `answers` as a new user turn after each `result` message, and closes stdin
//   when the answers run out;
// - builds the trace with traceFromLog and checks rule 9 (every write after a confirm), that the agent stopped
//   for at least as many answers as the scenario has `confirm` entries, and `expect(repo)`.
// It never compares snapshots: the agent's calls vary from run to run.
//
// Spike findings (claude 2.1.310, 2026-10-26, /pmkit:issues:move ISS-2X6D done on the team fixture):
// - The plugin command runs under -p despite `disable-model-invocation: true`. The agent read conventions.md,
//   ran issues get for the issue, its child and its blocker, then the dry run, and asked for approval.
// - AskUserQuestion is not offered under -p, with plain text input or with --input-format stream-json, even
//   when --tools names it: the init message lists only Bash and Read. The agent asks in text and ends its turn,
//   so no hook can answer it. The hook below only logs AskUserQuestion, in case a later version offers the tool.
// - An answer sent as a second user turn over --input-format stream-json works: the write ran in that turn and
//   only then. So a confirm here is an answer turn (a `turn` line in the log), not a question, and it carries
//   no confirmation key. Rule 7 and rule 10 (which point was confirmed) cannot be checked live.
// - Every answer counts as a confirm, including answers to a choice of input (setup's prefix, a status name).
//   A write that comes after any answer passes rule 9.
// - The PreToolUse hook also logs a call that the permission check then denies. A denied write before an
//   answer fails rule 9 although it never ran. The result lists denials in the failure message.
// - The agent chains calls in one Bash command (`P=.../pmkit.mjs; node $P issues get ...; node $P ...`);
//   traceFromLog splits them.
// - --strict-mcp-config and --setting-sources project keep the user's MCP servers, plugins and hooks out of the
//   session. The run without them offered 50 MCP tools and cost $0.48 for one turn; the run with them offered
//   Bash and Read and cost $0.12 for both turns. `total_cost_usd` of each result is cumulative.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { COMMANDS } from './pmkit.mjs'
import { loadScenarios, makeRepoView, orderProblems, prepareCopy, snapshotFile, traceFromLog } from './scenario-helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.join(HERE, '..')
const SCENARIOS = path.join(HERE, '__scenarios__')
const FIXTURES = path.join(HERE, '__fixtures__')
const LIVE = process.env.PMKIT_LIVE === '1'
const ONLY = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
const RUN_TIMEOUT_MS = 10 * 60 * 1000
const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'pmkit', GIT_AUTHOR_EMAIL: 'pmkit@example.com', GIT_COMMITTER_NAME: 'pmkit', GIT_COMMITTER_EMAIL: 'pmkit@example.com',
}

const HOOK = `// PreToolUse hook of the live suite: appends { tool, command } or { tool, questions } to the log in argv[2].
import fs from 'node:fs'
const input = JSON.parse(fs.readFileSync(0, 'utf8'))
const row = input.tool_name === 'Bash'
  ? { tool: 'Bash', command: input.tool_input.command }
  : { tool: input.tool_name, questions: input.tool_input.questions }
fs.appendFileSync(process.argv[2], JSON.stringify(row) + '\\n')
`

function skipReason() {
  if (!LIVE) return 'set PMKIT_LIVE=1 to run the live suite'
  if (spawnSync('claude', ['--version']).status !== 0) return 'claude is not on PATH'
  return null
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
 * the answers run out, and logs each answer as a `turn` line. Returns the `result` messages.
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
      const answer = pending.shift()
      if (answer === undefined || message.subtype !== 'success') return child.stdin.end()
      fs.appendFileSync(log, `${JSON.stringify({ tool: 'turn', answer })}\n`)
      send(answer)
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (signal || !results.length) reject(new Error(`claude exited ${signal ?? code} with ${results.length} results: ${stderr}`))
      else resolve(results)
    })
    send(prompt)
  })
}

const LOADED = (await loadScenarios(SCENARIOS)).filter(({ name }) => !ONLY.length || ONLY.includes(name))
const SKIP = skipReason()

describe('live scenarios', () => {
  for (const { name, entries } of LOADED) {
    entries.forEach((scenario, index) => {
      const label = snapshotFile(name, index, entries.length).replace(/\.after\.txt$/, '')
      test(`live ${label}`, { skip: SKIP ?? false }, async (t) => {
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-live-'))
        try {
          const { root, env, baseline, gh } = await prepareCopy(scenario, { scratch, fixturesDir: FIXTURES })
          const { settings, log } = writeHooks(scratch)
          const results = await runClaude({
            root,
            // claude needs HOME and its login from the developer's environment. childEnv() hides the global git
            // config, so an agent commit takes the identity the scripted runner passes with -c.
            env: { ...process.env, ...env, ...GIT_IDENTITY },
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
          assert.deepEqual(orderProblems(trace).map((problem) => `rule 9: ${problem}`), [], context)
          const wanted = scenario.steps.filter((entry) => 'confirm' in entry).length
          const answered = trace.filter((row) => row.kind === 'confirm').length
          assert.ok(answered >= wanted, `the agent stopped for ${answered} answers; the scenario confirms ${wanted} times${context}`)

          // An expect that takes `saved` reads the results of the scripted run, which a live run does not have.
          if (scenario.expect?.length >= 2) t.diagnostic('expect skipped: it reads the saved results of the scripted run')
          else await scenario.expect?.(makeRepoView(root, baseline, gh, env))
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true })
        }
      })
    })
  }
})
