// /pmkit:local:migrate. The scenario helper runs the real CLI in a child process, so it cannot inject the fake Linear
// fetch. The export, the import, the switch and the undo of an export are covered by the CLI tests in
// scripts/cli-migrate.test.mjs. Two entries cover what a child process can reach: step 3 on a repository with no map,
// where status stops with NOT_FOUND, and the undo branch on a finished import map, whose dry run prints the git commands
// and sends no request.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MAP = '.pmkit/migrations/2026-10-28-import-linear.yaml'
const SKIPPED = 'needs the Linear API, which a child process cannot fake; scripts/cli-migrate.test.mjs covers it'
const skip = {
  '4 local-migrate export': SKIPPED,
  '4 local-migrate import': SKIPPED,
  '7 local-migrate export': SKIPPED,
  '7 local-migrate import': SKIPPED,
  '9 local-migrate switch': SKIPPED,
  '10 local-migrate switch': SKIPPED,
  '12 local-migrate undo': SKIPPED,
}
const notHit = {
  'Step 3': 'status finds no map, so there is nothing to resume',
  'Step 4': 'the export dry run needs the Linear API, so the scenario stops before a mapping question',
  'Step 6': 'the dry run needs the Linear API, so the scenario stops before the preview',
  'Step 10': 'the switch follows a finished write, which needs the Linear API',
  'Step 12': 'the undo of an import map prints git commands and asks nothing',
}

export default [
  {
    command: 'local/migrate',
    fixture: 'team',
    git: true,
    prompt: '/pmkit:local:migrate export --workspace acme --team ACME',
    answers: [],
    steps: [{ step: '3', read: ['local-migrate', 'status'], expectError: 'NOT_FOUND', save: 'status' }],
    skip: { ...skip, '11 local-migrate undo': 'entry 1 runs the undo branch on an import map' },
    notHit,
    expect(repo, saved) {
      assert.equal(saved.status.error.code, 'NOT_FOUND')
      assert.equal(repo.git('status', '--porcelain'), '')
    },
  },
  {
    command: 'local/migrate',
    fixture: 'team',
    git: true,
    async setup({ root }) {
      fs.mkdirSync(path.join(root, '.pmkit', 'migrations'), { recursive: true })
      fs.copyFileSync(path.join(HERE, '_inputs', 'import-map.yaml'), path.join(root, MAP))
    },
    prompt: '/pmkit:local:migrate undo',
    answers: [],
    steps: [{ step: '11', dryRun: ['local-migrate', 'undo'], save: 'undo' }],
    skip: { ...skip, '3 local-migrate status': 'entry 0 runs status on a repository with no map' },
    notHit,
    expect(repo, saved) {
      assert.equal(saved.undo.direction, 'import')
      assert.deepEqual(saved.undo.commands, ['git restore --source=HEAD -- .issues .pmkit/migrations', 'git clean -fd -- .issues'])
    },
  },
]
