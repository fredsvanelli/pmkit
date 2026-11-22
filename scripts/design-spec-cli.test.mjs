import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMMANDS } from './pmkit.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SPEC = path.join(ROOT, 'docs', 'superpowers', 'specs', '2026-10-23-pmkit-design.md')
const GLOBAL_FLAGS = ['json', 'dry-run']

// `--flag value` and `<positional>` tokens of a usage string or a table row.
function slots(text) {
  const flags = new Map()
  const positionals = []
  for (const m of text.matchAll(/--([a-z][a-z-]*)(?: (<[^>]+>|[^\s[\]()]+))?|(<[^>]+>)/g)) {
    if (m[3]) positionals.push(m[3])
    else flags.set(m[1], m[2])
  }
  return { flags, positionals }
}

// The choices of `a|b|c` or `<a|b|c>`, sorted; null when the value is not a choice list.
const choices = (value) => (value?.includes('|') ? value.replace(/[<>]/g, '').split('|').sort().join('|') : null)

/** Every drift between the rows of a `## CLI` table and the usage strings of `commands`. */
function tableProblems(section, commands) {
  const names = commands.map((command) => command.name).sort((a, b) => b.length - a.length)
  const problems = []
  for (const row of section.split(/\r?\n/).filter((line) => line.startsWith('| `'))) {
    const cell = row.slice(2).split(' | ')[0]
    for (const [, written] of cell.matchAll(/`([^`]+)`/g)) {
      const call = written.replace(/\\\|/g, '|')
      const name = names.find((n) => call === n || call.startsWith(`${n} `))
      if (!name) { problems.push(`${call}: no such command`); continue }
      const usage = slots(commands.find((command) => command.name === name).usage ?? '')
      const shown = slots(call.slice(name.length))
      for (const [flag, value] of shown.flags) {
        if (GLOBAL_FLAGS.includes(flag)) continue
        if (!usage.flags.has(flag)) problems.push(`${name}: --${flag} is not in the usage`)
        else if (choices(value) && choices(value) !== choices(usage.flags.get(flag))) problems.push(`${name}: --${flag} ${value}, the usage has ${usage.flags.get(flag)}`)
      }
      shown.positionals.forEach((value, i) => {
        if (choices(value) !== choices(usage.positionals[i])) problems.push(`${name}: ${value}, the usage has ${usage.positionals[i] ?? 'no argument there'}`)
      })
    }
  }
  return problems
}

test('every row of the design spec CLI table matches the CLI usage', () => {
  const text = fs.readFileSync(SPEC, 'utf8')
  const section = text.split(/\r?\n## CLI\r?\n/)[1].split(/\r?\n## /)[0]
  assert.deepEqual(tableProblems(section, COMMANDS), [])
})

test('the check catches a command, a flag and a set of choices that drift from the usage', () => {
  const table = [
    '| `cycle add <id...> --to <sprint\\|none>` | x |',
    '| `cycle add <id...> --into s` | x |',
    '| `issues assign <id> <member\\|none>` | x |',
    '| `issues nope` | x |',
    '| `epic update-status <id> --health h --dry-run` | x |',
  ].join('\n')
  assert.deepEqual(tableProblems(table, COMMANDS), [
    'cycle add: --to <sprint|none>, the usage has <sprint|current|none>',
    'cycle add: --into is not in the usage',
    'issues assign: <member|none>, the usage has <member|me|none>',
    'issues nope: no such command',
  ])
})
