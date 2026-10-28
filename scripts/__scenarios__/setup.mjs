// /pmkit:setup on a new repository, then on a repository that already has a config.
// Entry 0, first run: an empty git repository with no remote, so step 2 picks the git host `none`. The user answers
// prefix ISS, ID style random (the local tracker recommends it), estimate unit points, one member, Fred, and yes to
// the `needs-criteria` label, so steps 6 and 8 pass `--label needs-criteria`.
// Entry 1, existing config: the basic fixture. Setup brings it up to date with `init --update` and then deletes
// `.issues/.gitignore`. Its `labels` list is empty, so step 3 asks about the label; the user says yes, and since no
// issue has a label, `--label needs-criteria` is the only label flag and no rename is needed. The dry run lists
// the `create` of `.issues/.gitignore` and the `change` of `.issues/config.yaml`, no `differs` file, so step 6 asks
// nothing.
// Entry 2, Linear first run: an empty git repository with no remote (git host `none`) and a fake workspace where the
// viewer belongs to two teams. The first dry run returns only the team question. The user picks ACME, accepts In Review,
// says no status means blocked, and maps two types to labels and two to none, so the one dry run of step 6 has no
// question left. The user confirms the summary and step 6 writes `.pmkit/config.yaml` and no `.issues/`.
// Entry 3, existing Linear config: a repository whose `.pmkit/config.yaml` maps in review to a state the workspace no
// longer has. The `init --update` dry run lists it in `broken` and as the only question; the user picks In Review,
// confirms the diff, and step 5 writes it.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const members = 'fred:\n  name: Fred Vanelli\n  email: fred@example.com\n'
const init = ['init', '--git-host', 'none', '--prefix', 'ISS', '--id-style', 'random', '--estimate-unit', 'points', '--members-file', '-', '--label', 'needs-criteria']
const update = ['init', '--update', '--label', 'needs-criteria']
const firstRun = 'there is no config, so step 1 takes the first run'
const existing = 'the config exists, so step 1 takes the existing config path'
const notLinear = 'the user picks the Local tracker, so step 1 never reaches the Linear paths'
const linearOnly = 'the config names the Local tracker, so step 1 never reaches the Linear paths'
const localOnly = 'the tracker is Linear, so step 1 never reaches the Local paths'
const LINEAR_FIRST = ['Linear first run 3 init', 'Linear first run 6 init', 'Linear first run 9 validate', 'Linear first run 9 discover', 'Linear first run 9 capabilities']
const LINEAR_EXISTING = [
  'Existing Linear config 2 validate', 'Existing Linear config 3 init', 'Existing Linear config 5 init',
  'Existing Linear config 7 validate', 'Existing Linear config 7 discover', 'Existing Linear config 7 capabilities',
]
const LOCAL_CALLS = [
  'First run 6 init', 'First run 9 validate', 'First run 9 discover', 'First run 9 capabilities',
  'Existing config 2 validate', 'Existing config 3 discover', 'Existing config 3 issues list', 'Existing config 3 issues update',
  'Existing config 4 init', 'Existing config 8 init', 'Existing config 9 validate', 'Existing config 9 discover', 'Existing config 9 capabilities',
]
const skipAll = (keys, reason) => Object.fromEntries(keys.map((key) => [key, reason]))
const team = (id, key, name) => ({ id, key, name, parent: null, cyclesEnabled: false, triageEnabled: false, issueEstimationType: 'notUsed', issueEstimationAllowZero: false, issueEstimationExtended: false })
const state = (id, name, type, position, teamId) => ({ id, name, type, position, team: { id: teamId } })
const ACME_STATES = [
  state('s1', 'Backlog', 'backlog', 0, 'team-acme'), state('s2', 'Todo', 'unstarted', 1, 'team-acme'), state('s3', 'In Progress', 'started', 2, 'team-acme'),
  state('s4', 'Code Review', 'started', 3, 'team-acme'), state('s5', 'In Review', 'started', 4, 'team-acme'),
  state('s6', 'Done', 'completed', 5, 'team-acme'), state('s7', 'Canceled', 'canceled', 6, 'team-acme'),
]
const label = (id, name) => ({ id, name, isGroup: false, retiredAt: null, team: { id: 'team-acme' }, parent: null })
// The viewer belongs to ACME and BETA. BETA has no states worth asking about.
const TWO_TEAMS = {
  teams: [team('team-acme', 'ACME', 'Acme'), team('team-beta', 'BETA', 'Beta')],
  states: [...ACME_STATES, state('b1', 'Todo', 'unstarted', 0, 'team-beta'), state('b2', 'Doing', 'started', 1, 'team-beta')],
  labels: [label('l1', 'Bug'), label('l2', 'Feature')],
  users: [{ id: 'user-1', name: 'Test User', displayName: 'test', email: 'test@example.com', active: true, guest: false, app: false, teams: { nodes: [{ id: 'team-acme' }, { id: 'team-beta' }] } }],
}
const linearConfigExists = 'the config exists and names Linear, so step 1 takes the existing Linear config path'
const BROKEN_CONFIG = `version: 1
tracker:
  system: linear
  scope:
    workspace: acme
    team: ACME
git_host:
  system: none
write_policy:
  confirm: single_writes
  preview: [bulk, delete, publish_update, move_scope]
mappings:
  status:
    in_review: Peer Review
    blocked: none
  types: {}
`
const linearInit = ['init', '--tracker', 'linear', '--git-host', 'none']
const linearAnswers = ['--status', 'in_review=In Review', '--status', 'blocked=none', '--type-label', 'feature=Feature', '--type-label', 'bug=Bug', '--type-label', 'task=none', '--type-label', 'chore=none']
const linearWrite = [...linearInit, '--workspace', 'acme', '--team', 'ACME', ...linearAnswers]

export default [
  {
    command: 'setup',
    fixture: null,
    git: true,
    prompt: '/pmkit:setup',
    answers: ['Local (Recommended)', 'ISS', 'random (Recommended)', 'points', 'Fred Vanelli <fred@example.com>', 'Yes (Recommended)', 'Yes'],
    steps: [
      // Step 6: preview with the members file on stdin. Step 7 shows the summary, step 8 writes.
      { step: 'First run 6', dryRun: init, stdin: members, save: 'preview' },
      { confirm: 'First run' },
      { step: 'First run 6', write: init, stdin: members },
      // Step 9: check the new tracker.
      { step: 'First run 9', read: ['validate'], save: 'problems' },
      { step: 'First run 9', read: ['discover'], save: 'discovered' },
      { step: 'First run 9', read: ['capabilities'] },
    ],
    skip: {
      'Existing config 2 validate': firstRun,
      'Existing config 3 discover': firstRun,
      'Existing config 3 issues list': firstRun,
      'Existing config 3 issues update': firstRun,
      'Existing config 4 init': firstRun,
      'Existing config 8 init': firstRun,
      'Existing config 9 validate': firstRun,
      'Existing config 9 discover': firstRun,
      'Existing config 9 capabilities': firstRun,
      ...skipAll([...LINEAR_FIRST, ...LINEAR_EXISTING], notLinear),
    },
    notHit: { 'Existing config': firstRun, 'Existing config step 3': firstRun, 'Linear first run': notLinear, 'Existing Linear config': notLinear },
    expect(repo, saved) {
      assert.ok(repo.file('.pmkit/config.yaml'), '.pmkit/config.yaml exists')
      assert.match(repo.file('.issues/config.yaml'), /^id_prefix: ISS$/m)
      assert.ok(saved.preview.files.every((file) => file.action === 'create'), 'every file is new')
      assert.deepEqual(saved.problems.problems, [])
      assert.deepEqual(saved.discovered.members.map((member) => member.id), ['fred'])
      assert.deepEqual(saved.discovered.labels, ['needs-criteria'])
    },
  },
  {
    command: 'setup',
    fixture: 'basic',
    async setup({ root, pmkit }) {
      await pmkit(['init', '--update'])
      fs.rmSync(path.join(root, '.issues', '.gitignore'))
    },
    prompt: '/pmkit:setup',
    answers: ['Yes (Recommended)', 'Yes'],
    steps: [
      { step: 'Existing config 2', read: ['validate'] },
      // Step 3: `labels` is empty, the user wants the label, and the issues in use have no label to carry over.
      { step: 'Existing config 3', read: ['discover'], save: 'before' },
      { step: 'Existing config 3', read: ['issues', 'list', '--archived'], save: 'inUse' },
      // Step 4: no setting changes, so the label is the only extra flag. Step 5 shows the files, step 7 asks once.
      { step: 'Existing config 4', dryRun: update, save: 'preview' },
      { confirm: 'Existing config' },
      { step: 'Existing config 8', write: update },
      { step: 'Existing config 9', read: ['validate'], save: 'problems' },
      { step: 'Existing config 9', read: ['discover'], save: 'after' },
      { step: 'Existing config 9', read: ['capabilities'] },
    ],
    skip: {
      'First run 6 init': existing,
      'First run 9 validate': existing,
      'First run 9 discover': existing,
      'First run 9 capabilities': existing,
      'Existing config 3 issues update': 'no issue uses a label, so there is no label name to rename',
      ...skipAll([...LINEAR_FIRST, ...LINEAR_EXISTING], linearOnly),
    },
    notHit: {
      'Linear first run': linearOnly,
      'Existing Linear config': linearOnly,
      'First run': existing,
      'Existing config step 3': 'no issue uses a label, so there is no label name to rename',
    },
    expect(repo, saved) {
      assert.ok(repo.file('.issues/.gitignore'), 'the deleted file is back')
      assert.deepEqual(saved.before.labels, [])
      assert.deepEqual(saved.inUse.issues.flatMap((issue) => issue.labels ?? []), [])
      const changed = saved.preview.files.filter((file) => file.action !== 'keep').map(({ path, action }) => ({ path, action }))
      assert.deepEqual(changed, [
        { path: '.issues/config.yaml', action: 'change' },
        { path: '.issues/.gitignore', action: 'create' },
      ])
      assert.deepEqual(saved.problems.problems, [])
      assert.deepEqual(saved.after.labels, ['needs-criteria'])
      assert.match(repo.file('.issues/config.yaml'), /^labels: \[needs-criteria\]$/m)
    },
  },
  {
    command: 'setup',
    fixture: null,
    git: true,
    linear: TWO_TEAMS,
    prompt: '/pmkit:setup',
    // Step 1: the tracker. Step 4: the team. Step 5: in review, blocked, and the four types, in a batch of four and a batch of two.
    answers: ['Linear', 'ACME', 'In Review (Recommended)', 'No status means blocked (Recommended)', 'Feature (Recommended)', 'Bug (Recommended)', 'No label stands for this type (Recommended)', 'No label stands for this type (Recommended)', 'Yes'],
    steps: [
      // Step 3: the team is the only question, because the viewer belongs to two teams.
      { step: 'Linear first run 3', dryRun: linearInit, save: 'first' },
      // Step 6: one dry run with every answer, shown as the one summary of step 7. Step 8 writes.
      { step: 'Linear first run 6', dryRun: linearWrite, save: 'preview' },
      { confirm: 'Linear first run' },
      { step: 'Linear first run 6', write: linearWrite },
      { step: 'Linear first run 9', read: ['validate'], save: 'problems' },
      { step: 'Linear first run 9', read: ['discover'], save: 'discovered' },
      { step: 'Linear first run 9', read: ['capabilities'] },
    ],
    skip: {
      ...skipAll([...LOCAL_CALLS, ...LINEAR_EXISTING], 'a first run has no config yet, so step 1 never reaches this path'),
    },
    notHit: { 'First run': 'the user picks Linear', 'Existing config': firstRun, 'Existing config step 3': firstRun, 'Existing Linear config': firstRun },
    expect(repo, saved) {
      assert.deepEqual(saved.first.questions.map((q) => q.path), ['tracker.scope.team'])
      assert.deepEqual(saved.first.questions[0].candidates, ['ACME', 'BETA'])
      assert.deepEqual(saved.preview.questions, [])
      assert.deepEqual(saved.preview.files, [{ path: '.pmkit/config.yaml', action: 'create' }])
      assert.ok(!repo.file('.issues/config.yaml'), 'Linear setup creates no .issues/')
      const config = repo.file('.pmkit/config.yaml')
      assert.match(config, /^ {2}system: linear$/m)
      assert.match(config, /^ {4}workspace: acme\n {4}team: ACME$/m)
      assert.match(config, /^mappings:\n {2}status:\n {4}in_review: In Review\n {4}blocked: none\n {2}types:\n {4}feature: Feature\n {4}bug: Bug$/m)
      assert.deepEqual(saved.problems.problems, [])
      assert.equal(saved.discovered.team, 'ACME')
      assert.deepEqual(saved.discovered.types, ['feature', 'bug'])
    },
  },
  {
    command: 'setup',
    fixture: null,
    git: true,
    linear: TWO_TEAMS,
    async setup({ root }) {
      fs.mkdirSync(path.join(root, '.pmkit'))
      fs.writeFileSync(path.join(root, '.pmkit', 'config.yaml'), BROKEN_CONFIG)
    },
    prompt: '/pmkit:setup',
    // Step 4: the one broken mapping. Step 5: whether to apply the diff.
    answers: ['In Review', 'Yes'],
    steps: [
      { step: 'Existing Linear config 2', read: ['validate'], save: 'before' },
      { step: 'Existing Linear config 3', dryRun: ['init', '--update'], save: 'broken' },
      { step: 'Existing Linear config 5', dryRun: ['init', '--update', '--status', 'in_review=In Review'], save: 'preview' },
      { confirm: 'Existing Linear config' },
      { step: 'Existing Linear config 5', write: ['init', '--update', '--status', 'in_review=In Review'] },
      { step: 'Existing Linear config 7', read: ['validate'], save: 'problems' },
      { step: 'Existing Linear config 7', read: ['discover'], save: 'discovered' },
      { step: 'Existing Linear config 7', read: ['capabilities'] },
    ],
    skip: {
      ...skipAll([...LOCAL_CALLS, ...LINEAR_FIRST], linearConfigExists),
    },
    notHit: { 'First run': existing, 'Existing config': linearConfigExists, 'Existing config step 3': linearConfigExists, 'Linear first run': existing },
    expect(repo, saved) {
      assert.deepEqual(saved.before.problems, [])
      assert.deepEqual(saved.broken.broken, [{ path: 'mappings.status.in_review', value: 'Peer Review', problem: 'mappings.status.in_review names Peer Review, which team ACME no longer has' }])
      assert.deepEqual(saved.broken.questions.map((q) => q.path), ['mappings.status.in_review'])
      assert.deepEqual(saved.preview.questions, [])
      assert.deepEqual(saved.preview.files.map((file) => file.action), ['change'])
      // The write adds the schema line and changes the one mapping.
      const config = repo.file('.pmkit/config.yaml')
      assert.match(config.split('\n')[0], /^# yaml-language-server: \$schema=/)
      assert.equal(config.split('\n').slice(1).join('\n'), BROKEN_CONFIG.replace('in_review: Peer Review', 'in_review: In Review'))
      assert.deepEqual(saved.problems.problems, [])
      assert.deepEqual(saved.discovered.warnings, [])
    },
  },
]
