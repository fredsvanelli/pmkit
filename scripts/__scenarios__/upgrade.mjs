// /pmkit:upgrade on the basic fixture, with git. Setup puts the tracker back on format 1 and commits it, so the
// migration of step 5 has work to do on a clean tree.
// Steps 1, 2 and 4 run `claude plugin` and `git clone`, which are not pmkit calls: the live suite covers them, and
// here the installed version is 0.1.0 and `<latest>` is the frozen changelog in _inputs/CHANGELOG.md.
// The plugin update of step 4 reports no `shownCommand`, so its confirmation is not reached.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const changelog = path.join(import.meta.dirname, '_inputs', 'CHANGELOG.md')

export default {
  command: 'upgrade',
  fixture: 'basic',
  git: true,
  async setup({ root, git }) {
    const config = path.join(root, '.issues', 'config.yaml')
    fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace(/^version: 2$/m, 'version: 1'))
    git('commit', '-qam', 'tracker on format 1')
  },
  prompt: '/pmkit:upgrade',
  answers: ['Yes', 'Yes'],
  steps: [
    // Step 3: the changelog since the installed version, then one question to update.
    { step: '3', read: ['changelog', '--file', changelog, '--since', '0.1.0'], save: 'sections' },
    { confirm: 'Step 3' },
    // Step 5: preview the migration, ask once, then migrate.
    { step: '5', dryRun: ['migrate'], save: 'plan' },
    { confirm: 'Step 5' },
    { step: '5', write: ['migrate'] },
  ],
  skip: {},
  notHit: {
    'Step 4': 'the plugin update is a `claude plugin` call, left to the live suite; here it reports no shownCommand',
  },
  expect(repo, saved) {
    assert.match(repo.file('.issues/config.yaml'), /^version: 2$/m)
    assert.deepEqual(saved.sections.map((section) => section.version), ['0.2.0', '0.3.0'])
    assert.equal(saved.plan.from, 1)
    assert.ok(saved.plan.steps.length > 0, 'the dry run lists the step from format 1')
  },
}
