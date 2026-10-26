// A fake `gh` for tests, and a helper that adds a bare origin to a repo. Shared by the pr and scenario tests.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { tempDir } from './test-helpers.mjs'

// The fake gh answers from the JSON file named by PMKIT_FAKE_GH: args joined by a space map to { status, stdout, stderr }.
// It appends each call to the same file name plus .log. A reply may also be an array: the Nth call of that command gets
// element N, and the last element repeats.
export const FAKE_GH_SCRIPT = `#!/usr/bin/env node
const fs = require('node:fs')
const key = process.argv.slice(2).join(' ')
fs.appendFileSync(process.env.PMKIT_FAKE_GH + '.log', key + '\\n')
const canned = JSON.parse(fs.readFileSync(process.env.PMKIT_FAKE_GH, 'utf8'))
let answer = canned[key]
if (Array.isArray(answer)) {
  const seen = fs.readFileSync(process.env.PMKIT_FAKE_GH + '.log', 'utf8').split('\\n').filter((line) => line === key).length
  answer = answer[Math.min(seen - 1, answer.length - 1)]
}
if (!answer) {
  process.stderr.write('fake gh: no canned response for ' + key + '\\n')
  process.exit(1)
}
process.stdout.write(answer.stdout ?? '')
process.stderr.write(answer.stderr ?? '')
process.exit(answer.status ?? 0)
`

/** Writes the fake gh and its canned responses into `dir` (a new `pmkit-pr-` folder from `tempDir` when not given, removed after the test). */
export function fakeGh(canned, dir = tempDir('pmkit-pr-')) {
  fs.writeFileSync(path.join(dir, 'gh'), FAKE_GH_SCRIPT, { mode: 0o755 })
  fs.chmodSync(path.join(dir, 'gh'), 0o755)
  const responses = path.join(dir, 'responses.json')
  fs.writeFileSync(responses, JSON.stringify(canned))
  return { dir, responses }
}

/** The calls the fake gh has answered, one args string per call. */
export const ghCalls = ({ responses }) => (fs.existsSync(`${responses}.log`) ? fs.readFileSync(`${responses}.log`, 'utf8').split('\n').filter(Boolean) : [])

/** Initializes `remote` as a bare repo and adds it to `root` as `origin`. `env` is merged over the git defaults. */
export function addBareOrigin(root, remote, env = {}) {
  const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', ...env }
  for (const [cwd, args] of [[remote, ['init', '-q', '--bare']], [root, ['remote', 'add', 'origin', remote]]]) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv })
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
}
