// /pmkit:issues:run-view. One entry per branch of step 4 (a view that runs, NOT_FOUND, and the three INVALID_INPUT reasons
// `invalid_view_name`, `view_out_of_date` and `view_file_broken`) and one for the Linear branch of step 1.
// The entries that fail read the stable `error.reason`, never the text of `error.message`.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const writeView = (root, name, text) => {
  const dir = path.join(root, '.issues', 'views')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${name}.yaml`), text)
}
const skip = { '2 views list': 'the prompt names the view, so the list of views is not needed' }
const notHit = { 'Step 2': 'the prompt names the view, so the list of views is not asked for' }
const base = { command: 'issues/run-view', fixture: 'team', answers: [], notHit }
const failing = (name, expectError) => [
  { step: '1', read: ['capabilities'] },
  { step: '3', read: ['views', 'run', name], expectError, save: 'run' },
]

const LINEAR_CONFIG = `version: 1
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
    in_review: In Review
    blocked: none
  types:
    feature: Feature
    bug: Bug
    task: none
    chore: none
`

export default [
  // The view holds `categories: [in_progress]`, so the run lists the in-progress issues and writes nothing.
  {
    ...base,
    setup: ({ root }) => writeView(root, 'in-progress', 'filter:\n  categories: [in_progress]\n'),
    prompt: '/pmkit:issues:run-view in-progress',
    steps: [
      { step: '1', read: ['capabilities'] },
      { step: '3', read: ['views', 'run', 'in-progress'], save: 'run' },
    ],
    skip,
    expect(repo, saved) {
      assert.deepEqual(saved.run.issues.map((issue) => issue.id), ['ISS-2X6D', 'ISS-5N1R'], 'the two issues in progress')
    },
  },
  // Step 4, NOT_FOUND: the closest names come from `views list`.
  {
    ...base,
    setup: ({ root }) => writeView(root, 'in-progress', 'filter:\n  categories: [in_progress]\n'),
    prompt: '/pmkit:issues:run-view in-progres',
    steps: [...failing('in-progres', 'NOT_FOUND'), { step: '2', read: ['views', 'list'], save: 'list' }],
    skip: {},
    expect(repo, saved) {
      assert.equal(saved.run.error.code, 'NOT_FOUND')
      assert.equal(saved.run.error.reason, undefined, 'NOT_FOUND is told by its code')
      assert.deepEqual(saved.list.views.map((view) => view.name), ['in-progress'])
    },
  },
  // Step 4, invalid_view_name: no file is read.
  {
    ...base,
    prompt: '/pmkit:issues:run-view .bad',
    steps: failing('.bad', 'INVALID_INPUT'),
    skip,
    expect(repo, saved) {
      assert.equal(saved.run.error.reason, 'invalid_view_name')
    },
  },
  // Step 4, view_out_of_date: the stored filter comes from `views list` as structured data.
  {
    ...base,
    setup: ({ root }) => writeView(root, 'old-bugs', 'filter:\n  types: [gone]\n'),
    prompt: '/pmkit:issues:run-view old-bugs',
    steps: [...failing('old-bugs', 'INVALID_INPUT'), { step: '2', read: ['views', 'list'], save: 'list' }],
    skip: {},
    expect(repo, saved) {
      assert.equal(saved.run.error.reason, 'view_out_of_date')
      assert.deepEqual(saved.list.views.find((view) => view.name === 'old-bugs').filter, { types: ['gone'] })
    },
  },
  // Step 4, view_file_broken: no filter runs in its place.
  {
    ...base,
    setup: ({ root }) => writeView(root, 'broken', 'filter: 3\n'),
    prompt: '/pmkit:issues:run-view broken',
    steps: failing('broken', 'INVALID_INPUT'),
    skip,
    expect(repo, saved) {
      assert.equal(saved.run.error.reason, 'view_file_broken')
    },
  },
  // Step 1, Linear: `saved_views` is `absent`, so `views run` is never called.
  {
    ...base,
    git: true,
    linear: {},
    setup: ({ root }) => fs.writeFileSync(path.join(root, '.pmkit', 'config.yaml'), LINEAR_CONFIG),
    prompt: '/pmkit:issues:run-view open-bugs',
    steps: [{ step: '1', read: ['capabilities'], save: 'capabilities' }],
    skip: { ...skip, '3 views run': 'the tracker has no saved views, so step 1 stops the command' },
    expect(repo, saved) {
      assert.equal(saved.capabilities.tracker, 'linear')
      assert.deepEqual(Object.keys(saved), ['capabilities'], 'views run is not called')
      assert.equal(saved.capabilities.capabilities.find((capability) => capability.id === 'saved_views').path, 'absent')
    },
  },
]
