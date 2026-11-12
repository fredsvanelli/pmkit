// PMK-278: a message that repeats git's stderr never shows an absolute path. A broken global git config makes every git call
// fail with "fatal: bad config line 1 in file <absolute path>", which is the text these tests look for.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeRepo, tempDir } from './test-helpers.mjs'
import { tagWarning } from './pmkit.mjs'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pmkit.mjs')
const GOOD = { ...process.env, PMKIT_USER: 'fred', PMKIT_NOW: '2026-10-23T12:00:00Z', PMKIT_SEED: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }

/** A git config that does not parse, in a folder whose name has a space, and the strings that must not show in any message. */
function brokenConfig() {
  const dir = path.join(tempDir('pmkit-git paths-'), 'a b')
  fs.mkdirSync(dir)
  const file = path.join(dir, 'gitconfig')
  fs.writeFileSync(file, '[broken\n')
  return { file, env: { ...GOOD, GIT_CONFIG_GLOBAL: file }, secrets: [dir, fs.realpathSync(dir), path.basename(path.dirname(dir))] }
}

const cli = (cwd, args, env) => {
  const result = spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, env, encoding: 'utf8' })
  return { status: result.status, text: result.stdout + result.stderr, stdout: result.stdout }
}

const repo = () => {
  const root = makeRepo('basic')
  spawnSync('git', ['init', '-q'], { cwd: root, env: GOOD })
  return root
}

const assertHidden = (text, secrets) => {
  for (const secret of secrets) assert.ok(!text.includes(secret), `${secret} shows in: ${text}`)
  assert.match(text, /<path>/)
}

test('todos scan hides the absolute path in git\'s error and keeps the folder it was asked to scan', () => {
  const { env, secrets } = brokenConfig()
  const root = repo()
  const result = cli(root, ['todos', 'scan'], env)
  assert.equal(result.status, 2)
  assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
  assert.ok(JSON.parse(result.stdout).error.message.includes(`cannot list the files of ${root}`), result.text)
  assertHidden(result.text.replaceAll(root, ''), secrets)
})

test('issues delete hides the absolute path in the git grep failure it reports as unchecked', () => {
  const { env, secrets } = brokenConfig()
  const root = repo()
  const id = JSON.parse(cli(root, ['issues', 'create', '--title', 'One'], GOOD).stdout).after.id
  const result = cli(root, ['issues', 'delete', id, '--dry-run'], env)
  assert.equal(result.status, 0, result.text)
  assert.match(JSON.parse(result.stdout).unchecked[0], /git grep failed: .*<path>/)
  assertHidden(result.text, secrets)
})

test('tagWarning hides the absolute path in git\'s error', () => {
  const { env, secrets } = brokenConfig()
  const warning = tagWarning(repo(), 'v1.0.0', env)
  assert.match(warning, /^cannot check tag v1\.0\.0: bad config line 1 in file <path>$/)
  assertHidden(warning, secrets)
})

test('link-repo hides the absolute path in the note about git remotes it could not read', () => {
  const { env, secrets } = brokenConfig()
  const root = repo()
  fs.writeFileSync(path.join(root, '.pmkit/config.yaml'), 'version: 1\ntracker:\n  system: local\n  path: .issues\ngit_host:\n  system: none\nwrite_policy:\n  confirm: single_writes\n  preview: [bulk, delete, publish_update, move_scope]\n')
  const result = cli(root, ['link-repo', '--dry-run'], env)
  assert.match(result.text, /could not read the git remotes/, result.text)
  assertHidden(result.text, secrets)
})
