// E2E test of docs/runbooks/draft-issues-github.md: the real CLI, run as a subprocess, with a fake gh first on PATH that keeps the
// state of the stateful fake GitHub in a fixture file between runs. No logged call may hold the token.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fakeGithubIssues } from './fake-github-issues.mjs'
import { statefulGhCalls, statefulGhOnPath } from './fake-gh-path.mjs'
import { childEnv } from './golden-helpers.mjs'
import { tempDir, userStoreEnv } from './test-helpers.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(SCRIPTS, 'pmkit.mjs')
const TOKEN = `ghp_${'Qw7E'.repeat(9)}`
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'draft-issues-github.md')

const SETUP = [
  'init', '--tracker', 'github', '--git-host', 'github', '--host', 'github.com', '--repo', 'acme/widgets', '--project', 'acme/7',
  ...['backlog=Backlog', 'todo=Todo', 'in_progress=In Progress', 'in_review=In Review', 'done=Done', 'canceled=none', 'blocked=none'].flatMap((item) => ['--status', item]),
  ...['priority=issue:Priority', 'estimate=issue:Effort', 'start_date=issue:Start date', 'target_date=issue:Target date'].flatMap((item) => ['--field', item]),
  ...['feature=Feature', 'bug=Bug', 'task=Task', 'chore=none'].flatMap((item) => ['--type-label', item]),
  '--json',
]

const COMMANDS = {
  list: ['github', 'draft-issues', 'list', '--json'],
  convertDry: ['github', 'draft-issues', 'convert', 'PVTI_1', 'PVTI_3', '--dry-run', '--json'],
  convert: ['github', 'draft-issues', 'convert', 'PVTI_1', 'PVTI_3', '--json'],
  get1: ['issues', 'get', '1', '--json'],
  updateDry: ['issues', 'update', '1', '--type', 'feature', '--priority', 'high', '--label', 'bug', '--dry-run', '--json'],
  update: ['issues', 'update', '1', '--type', 'feature', '--priority', 'high', '--label', 'bug', '--json'],
  wrong: ['github', 'draft-issues', 'convert', 'PVTI_2', '--dry-run', '--json'],
  otherRepo: ['github', 'draft-issues', 'convert', 'PVTI_4', '--repo', 'acme/docs', '--dry-run', '--json'],
  noProject: ['github', 'draft-issues', 'list', '--json'],
}

/** The state "Before you start" describes: setup done, three drafts and one archived draft in the Project. Returns { fake, pmkit, root }. */
function runbookRepo() {
  const root = tempDir('pmkit-runbook-draft-issues-github-')
  spawnSync('git', ['init', '-q'], { cwd: root })
  const github = fakeGithubIssues()
  github.seedDraft({ title: 'Add an offline mode', body: '### Context\n\nUsers asked to work without a network.\n\n### Acceptance criteria\n\n- The app opens without a network', assignees: ['hubot'], values: { Status: 'Todo' }, updatedAt: '2026-11-10T00:00:00Z' })
  github.seedDraft({ title: 'Old idea', archived: true })
  github.seedDraft({ title: 'Dark theme', body: 'A dark palette for the app.', updatedAt: '2026-11-12T00:00:00Z' })
  github.seedDraft({ title: 'Docs: a getting started page' })
  github.seedRepository('acme/docs')
  const fake = statefulGhOnPath({ meta: null, issues: github.toJSON() })
  const env = { ...childEnv(), ...userStoreEnv().env, GH_TOKEN: TOKEN, PATH: `${fake.bin}${path.delimiter}${process.env.PATH}` }
  const pmkit = (args) => {
    const result = spawnSync(process.execPath, [CLI, ...args], { cwd: root, env, encoding: 'utf8' })
    return { code: result.status, stdout: result.stdout, stderr: result.stderr }
  }
  json(pmkit(SETUP))
  return { fake, pmkit, root }
}

function json(result) {
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout)
}
function failure(result) {
  assert.equal(result.code, 2, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout).error
}
const state = (fake) => JSON.parse(fs.readFileSync(fake.fixtureFile, 'utf8')).issues
const mutationNames = (fake) => statefulGhCalls(fake).map((call) => /mutation (\w+)/.exec(JSON.parse(call.input || '{}').query ?? '')?.[1]).filter(Boolean)

test('the runbook names the commands this test runs', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8')
  for (const args of Object.values(COMMANDS)) assert.ok(text.includes(`node scripts/pmkit.mjs ${args.join(' ')}`), args.join(' '))
  for (const expected of ['item PVTI_2 is archived', 'acme/docs is not tracker.scope.repo (acme/widgets), so pmkit will not track the new issues', 'Pass --project owner/number, or set tracker.scope.project with /pmkit:setup']) {
    assert.ok(text.includes(expected), expected)
  }
})

test('runbook: list, preview, convert, set the fields, and the refusals, steps 1 to 8', () => {
  const { fake, pmkit, root } = runbookRepo()

  // Step 1: the unarchived drafts in board order.
  const listed = json(pmkit(COMMANDS.list))
  assert.equal(listed.available, true)
  assert.deepEqual(listed.drafts.map((draft) => [draft.item, draft.title]), [['PVTI_1', 'Add an offline mode'], ['PVTI_3', 'Dark theme'], ['PVTI_4', 'Docs: a getting started page']])
  assert.deepEqual([listed.drafts[0].assignees, listed.drafts[0].fields], [['hubot'], { Status: 'Todo' }])

  // Step 2: the preview writes nothing.
  const dry = json(pmkit(COMMANDS.convertDry))
  assert.deepEqual([dry.dryRun, dry.target, dry.drafts.map((draft) => draft.title), dry.warnings], [true, { repo: 'acme/widgets', tracked: true }, ['Add an offline mode', 'Dark theme'], []])
  assert.deepEqual(mutationNames(fake), [])

  // Step 3: two issues, and the items stay in the Project.
  const done = json(pmkit(COMMANDS.convert))
  assert.deepEqual(done.converted.map((item) => [item.item, item.number, item.id, item.url]), [['PVTI_1', 1, '1', 'https://github.com/acme/widgets/issues/1'], ['PVTI_3', 2, '2', 'https://github.com/acme/widgets/issues/2']])
  assert.deepEqual(mutationNames(fake), ['PmkitConvertDraftItem', 'PmkitConvertDraftItem'])

  // Step 4: the issue keeps its Status.
  const issue = json(pmkit(COMMANDS.get1))
  assert.deepEqual([issue.title, issue.status.category, issue.assignee], ['Add an offline mode', 'todo', 'hubot'])

  // Step 5: the fields, previewed, then written.
  const preview = json(pmkit(COMMANDS.updateDry))
  assert.deepEqual([preview.after.type, preview.after.priority, preview.after.labels], ['feature', 'high', ['bug']])
  assert.equal(state(fake).issues[0].issueTypeId, null)
  const updated = json(pmkit(COMMANDS.update))
  assert.deepEqual([updated.after.type, updated.after.priority, updated.after.labels], ['feature', 'high', ['bug']])

  // Step 6: an archived draft refuses the batch.
  assert.deepEqual(failure(pmkit(COMMANDS.wrong)), { code: 'INVALID_INPUT', message: 'item PVTI_2 is archived', nextStep: 'pmkit github draft-issues list' })

  // Step 7: another repository, with the warning.
  const other = json(pmkit(COMMANDS.otherRepo))
  assert.deepEqual([other.target, other.warnings], [{ repo: 'acme/docs', tracked: false }, ['acme/docs is not tracker.scope.repo (acme/widgets), so pmkit will not track the new issues']])

  // Step 8: no Project.
  const configFile = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(configFile, fs.readFileSync(configFile, 'utf8').replace('project: acme/7', 'project: none'))
  const off = json(pmkit(COMMANDS.noProject))
  assert.deepEqual([off.available, off.reason, off.enableHint], [false, 'no_project', 'Pass --project owner/number, or set tracker.scope.project with /pmkit:setup'])

  // No call holds the token, and every call names the host.
  const made = statefulGhCalls(fake)
  assert.ok(made.length > 0)
  for (const call of made) {
    assert.deepEqual(call.args.slice(0, 3), ['api', '--hostname', 'github.com'])
    assert.ok(!JSON.stringify(call).includes(TOKEN), 'a gh call holds the token')
  }
})
