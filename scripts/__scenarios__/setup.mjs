// /pmkit:setup on a new repository, then on a repository that already has a config.
// Entry 0, first run: an empty git repository with no remote, so step 2 picks the git host `none`. The user answers
// prefix ISS, ID style random (the local tracker recommends it), estimate unit points, one member, Fred, and yes to
// the `needs-criteria` label, so steps 6 and 8 pass `--label needs-criteria`.
// Entry 1, existing config: the basic fixture. Setup brings it up to date with `init --update` and then deletes
// `.issues/.gitignore`. Its `labels` list is empty, so step 3 asks about the label; the user says yes, and since no
// issue has a label, `--label needs-criteria` is the only label flag and no rename is needed. The dry run lists
// the `create` of `.issues/.gitignore` and the `change` of `.issues/config.yaml`, no `differs` file, so step 6 asks
// nothing.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const members = 'fred:\n  name: Fred Vanelli\n  email: fred@example.com\n'
const init = ['init', '--git-host', 'none', '--prefix', 'ISS', '--id-style', 'random', '--estimate-unit', 'points', '--members-file', '-', '--label', 'needs-criteria']
const update = ['init', '--update', '--label', 'needs-criteria']
const firstRun = 'there is no config, so step 1 takes the first run'
const existing = 'the config exists, so step 1 takes the existing config path'

export default [
  {
    command: 'setup',
    fixture: null,
    git: true,
    prompt: '/pmkit:setup',
    answers: ['ISS', 'random (Recommended)', 'points', 'Fred Vanelli <fred@example.com>', 'Yes (Recommended)', 'Yes'],
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
    },
    notHit: { 'Existing config': firstRun, 'Existing config step 3': firstRun },
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
    },
    notHit: {
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
]
