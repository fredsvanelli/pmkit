// PMK-158: a next step that starts with `pmkit ` names a CLI command, which the agent runs as
// node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" <command> (skills/pmkit/references/conventions.md, "Reading errors").
// This test keeps every such string in the CLI sources pointing at a command that exists.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMMANDS } from './pmkit.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const NAMES = new Set(COMMANDS.map((command) => command.name))

/** Each quoted text in `source` that starts with `pmkit ` and names no CLI command (the longest leading words are tried). */
function unknownCommands(source) {
  const misses = []
  for (const match of source.matchAll(/['`"]pmkit ([a-z][a-z-]*(?: [a-z][a-z-]*)*)/g)) {
    const words = match[1].split(' ')
    if (!words.some((_, i) => NAMES.has(words.slice(0, words.length - i).join(' ')))) misses.push(`pmkit ${match[1]}`)
  }
  return misses
}

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sources(full)
    return entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs') ? [full] : []
  })
}

test('unknownCommands finds a pmkit next step whose command does not exist, and passes one followed by prose', () => {
  assert.deepEqual(unknownCommands("throw invalid('x', 'pmkit cycle lists')"), ['pmkit cycle lists'])
  assert.deepEqual(unknownCommands("'pmkit epic get shows the documents of an epic'"), [])
  assert.deepEqual(unknownCommands("'pmkit cycle list'; `pmkit validate`"), [])
})

test('every next step that starts with pmkit names a command of the CLI', () => {
  const files = [path.join(SCRIPTS, 'pmkit.mjs'), ...sources(path.join(SCRIPTS, 'lib'))]
  const misses = files.flatMap((file) => unknownCommands(fs.readFileSync(file, 'utf8')).map((miss) => `${path.relative(SCRIPTS, file)}: ${miss}`))
  assert.deepEqual(misses, [])
})
