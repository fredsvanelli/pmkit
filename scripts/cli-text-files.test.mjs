import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { makeRepo, tempDir } from './test-helpers.mjs'

// PMK-198: `epic create --title-file`, `milestone create --name-file`, `release create --name-file` and `docs next-adr --title-file`
// read a one-line text from a file, with the rules of `issues create --title-file`, so a text taken from data never reaches the shell.

const TEXT = 'Webhooks `touch pwned` and $(echo x) "quoted"'
const env = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', PMKIT_USER: 'fred' }

function setup() {
  const root = makeRepo('basic')
  const dir = tempDir('pmkit-text-')
  const file = (name, content) => {
    const full = path.join(dir, name)
    fs.writeFileSync(full, content)
    return full
  }
  const pmkit = async (args) => {
    const result = await run([...args, '--json'], { env, cwd: root })
    return { ...result, data: result.stdout.trim().startsWith('{') ? JSON.parse(result.stdout) : null }
  }
  return { pmkit, file }
}

// [command, text flag, extra args, where the text lands in the result]
const CASES = [
  [['epic', 'create'], 'title', [], (data) => data.after.title],
  [['milestone', 'create', 'm-text'], 'name', [], (data) => data.after.name],
  [['release', 'create', 'r-text'], 'name', [], (data) => data.after.name],
  [['docs', 'next-adr'], 'title', [], (data) => data.slug === 'webhooks-touch-pwned-and-echo-x-quoted' ? TEXT : data.slug],  // the ADR result holds the slug, not the title
]

for (const [command, key, extra, pick] of CASES) {
  const label = `${command.slice(0, 2).join(' ')} --${key}-file`
  test(`${label} takes the text as it is, with a backtick, a command substitution and CRLF`, async () => {
    const { pmkit, file } = setup()
    const result = await pmkit([...command, `--${key}-file`, file('t.txt', `${TEXT}\r\n`), ...extra])
    assert.equal(result.code, 0, result.stdout + result.stderr)
    assert.equal(pick(result.data), TEXT)
  })

  test(`${label} is exclusive with --${key}, and the file has one non-empty line`, async () => {
    const { pmkit, file } = setup()
    const both = await pmkit([...command, `--${key}`, 'x', `--${key}-file`, file('t.txt', 'y\n'), ...extra])
    assert.equal(both.code, 2)
    assert.equal(both.data.error.code, 'INVALID_INPUT')
    assert.match(both.data.error.message, /exclusive/)
    const empty = await pmkit([...command, `--${key}-file`, file('empty.txt', '\n'), ...extra])
    assert.equal(empty.data.error.code, 'INVALID_INPUT')
    const two = await pmkit([...command, `--${key}-file`, file('two.txt', 'a\nb\n'), ...extra])
    assert.equal(two.data.error.code, 'INVALID_INPUT')
    assert.match(two.data.error.message, /more than one line/)
    const missing = await pmkit([...command, `--${key}-file`, path.join(tempDir('pmkit-text-'), 'nope.txt'), ...extra])
    assert.equal(missing.data.error.code, 'INVALID_INPUT')
  })
}

test('epic create and docs next-adr still need a title, and the message names the file flag', async () => {
  const { pmkit } = setup()
  for (const command of [['epic', 'create'], ['docs', 'next-adr']]) {
    const result = await pmkit(command)
    assert.equal(result.code, 2)
    assert.match(result.data.error.message, /--title-file/)
  }
})
