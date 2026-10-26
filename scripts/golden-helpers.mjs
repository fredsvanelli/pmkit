// Helpers for scripts/goldens.test.mjs: child environment, runs, transcripts and file names.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const NOW = '2026-10-23T12:00:00Z'
export const SEED = '1'

const PMKIT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pmkit.mjs')

/** The golden file name, without extension, of a command: `issues get` gives `issues-get`. */
export const goldenName = (command) => command.replace(/ /g, '-')

/** Groups of command names that would share one golden file. */
export function findCollisions(commandNames) {
  const byFile = new Map()
  for (const name of commandNames) byFile.set(goldenName(name), [...(byFile.get(goldenName(name)) ?? []), name])
  return [...byFile.values()].filter((names) => names.length > 1)
}

/** Commands with no case (`missing`) and cases that name no command (`extra`). */
export function compareNames(caseNames, commandNames) {
  const cases = new Set(caseNames)
  const commands = new Set(commandNames)
  return { missing: commandNames.filter((name) => !cases.has(name)), extra: caseNames.filter((name) => !commands.has(name)) }
}

/**
 * The environment of every child run, built from scratch so nothing from the
 * developer's shell (PMKIT_USER, git identity, global git config) reaches the CLI.
 */
export function childEnv() {
  const env = {
    PATH: process.env.PATH ?? '',
    TZ: 'UTC',
    PMKIT_USER: 'fred',
    PMKIT_NOW: NOW,
    PMKIT_SEED: SEED,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
  }
  if (process.platform === 'win32') env.SYSTEMROOT = process.env.SYSTEMROOT ?? ''
  return env
}

/** The argument lists of one case in golden order: text, --json, then for a write --dry-run and --dry-run --json. */
export function expandCase(isWrite, args) {
  const runs = [args, [...args, '--json']]
  if (isWrite) runs.push([...args, '--dry-run'], [...args, '--dry-run', '--json'])
  return runs
}

/**
 * Replaces the fixture copy's root with `<root>` and the inputs folder with `<inputs>`,
 * in plain, realpath and JSON-escaped forms. Longer forms go first, so a path that
 * contains another (macOS `/private/var/...` around `/var/...`) is replaced whole.
 */
export function makeNormalizer({ root, inputs }) {
  const pairs = []
  for (const [dir, token] of [[root, '<root>'], [inputs, '<inputs>']]) {
    const forms = new Set([dir])
    try {
      forms.add(fs.realpathSync(dir))
    } catch {
      // A folder that does not exist has no other real path.
    }
    for (const form of [...forms]) forms.add(JSON.stringify(form).slice(1, -1))
    for (const form of forms) pairs.push([form, token])
  }
  pairs.sort((a, b) => b[0].length - a[0].length)
  return (text) => pairs.reduce((out, [from, to]) => out.split(from).join(to), text)
}

const quote = (arg) => (arg === '' || /[\s'"]/.test(arg) ? `'${arg.replace(/'/g, "'\\''")}'` : arg)

function streamLines(text) {
  if (text === '') return ['(empty)']
  if (text.endsWith('\n')) return [text.slice(0, -1)]
  return [text, '\\ no newline at end']
}

/** One run of a transcript, with no trailing newline. */
export function formatRun({ args, code, stdout, stderr }) {
  return [`$ pmkit ${args.map(quote).join(' ')}`, `exit ${code}`, '--- stdout', ...streamLines(stdout), '--- stderr', ...streamLines(stderr)].join('\n')
}

/** Runs the CLI as a child process with `childEnv()` and empty stdin. A non-zero exit resolves, it does not reject. */
export function runPmkit(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [PMKIT, ...args], { cwd, env: childEnv(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') reject(error)
      else resolve({ code: error ? error.code : 0, stdout, stderr })
    })
    child.stdin.end()
  })
}

/** Like `Promise.all(items.map(fn))`, with at most `limit` calls running at once. Results keep input order. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** Entries in `dir` that are not the golden of any command, sorted. `_inputs` is skipped. */
export function staleGoldens(dir, commandNames) {
  if (!fs.existsSync(dir)) return []
  const expected = new Set(commandNames.map((name) => `${goldenName(name)}.txt`))
  return fs.readdirSync(dir).filter((name) => name !== '_inputs' && !expected.has(name)).sort()
}
