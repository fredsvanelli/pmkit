// The next ADR (PMK-65): the slug, the number across four sources, the place, and `pmkit docs next-adr`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { run } from './pmkit.mjs'
import { ADR_SLUG_MAX, adrFiles, adrFolders, adrLocation, adrSlug, duplicateAdrs, highestAdr, setAdrStatus, adrStatusDropped, adrFenceClosers, adrStatusContinuation, adrKeptLines, adrSectionText, adrInfo, adrRef, adrStatusHeading, adrHtmlHeld, adrFenceHeld } from './lib/adr.mjs'
import { childEnv } from './golden-helpers.mjs'
import { makeRepo } from './test-helpers.mjs'
import { assertFast } from './assert-fast.mjs'

const code = (value) => (error) => error.code === value

test('adrSlug keeps lowercase letters and digits and joins words with one hyphen', () => {
  assert.equal(adrSlug('Use event files as the audit log'), 'use-event-files-as-the-audit-log')
  assert.equal(adrSlug('  Keep   estimates -- in points!  '), 'keep-estimates-in-points')
})

test('adrSlug turns a slash into a hyphen, so the file never lands in a subfolder', () => {
  assert.equal(adrSlug('Use CI/CD for releases'), 'use-ci-cd-for-releases')
  assert.equal(adrSlug('a\\b/c'), 'a-b-c')
})

test('adrSlug drops quotes and transliterates accents', () => {
  assert.equal(adrSlug('Don\'t "quote" “me”'), 'dont-quote-me')
  assert.equal(adrSlug('Decisão sobre a criação do áudio'), 'decisao-sobre-a-criacao-do-audio')
  assert.equal(adrSlug('Café au lait'), 'cafe-au-lait')
})

test('adrSlug cuts a 300 character title at a word boundary within the limit', () => {
  const slug = adrSlug(Array.from({ length: 60 }, (_, i) => `word${i}`).join(' '))
  assert.ok(slug.length <= ADR_SLUG_MAX, slug)
  assert.match(slug, /^word0-word1-/)
  assert.match(slug, /[a-z0-9]$/)
  assert.ok(!slug.endsWith('-'))
  assert.ok(/^(word\d+)(-word\d+)*$/.test(slug), `cut inside a word: ${slug}`)
})

test('adrSlug cuts a single word longer than the limit at the limit', () => {
  assert.equal(adrSlug('x'.repeat(300)).length, ADR_SLUG_MAX)
})

test('adrSlug refuses a title with no letter or digit', () => {
  for (const bad of ['', '   ', '!!! ??? ///', '——', '"\'"']) assert.throws(() => adrSlug(bad), code('INVALID_INPUT'), bad)
  assert.throws(() => adrSlug(undefined), code('INVALID_INPUT'))
})

test('highestAdr takes the highest number, allows gaps and lists the names with no number', () => {
  assert.deepEqual(highestAdr(['0001-a.md', '0003-b.md', 'README.md', 'notes-0009.md', '12-x.md']), { highest: 3, ignored: ['README.md', 'notes-0009.md', '12-x.md'] })
  assert.deepEqual(highestAdr([]), { highest: 0, ignored: [] })
})

const git = (cwd, ...args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: childEnv() })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}
const write = (root, rel, text = '# x\n') => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), text)
}
const configFile = (root) => path.join(root, '.pmkit', 'config.yaml')

function repo({ config = (text) => text } = {}) {
  const root = makeRepo('basic')
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'a@b.c')
  git(root, 'config', 'user.name', 'a')
  fs.writeFileSync(configFile(root), config(fs.readFileSync(configFile(root), 'utf8')))
  return root
}
// Puts a file on refs/remotes/origin/<branch> without leaving it in the working tree.
function onOrigin(root, branch, rel) {
  write(root, rel)
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'x')
  git(root, 'update-ref', `refs/remotes/origin/${branch}`, 'HEAD')
  git(root, 'rm', '-q', rel)
  git(root, 'commit', '-q', '-m', 'y')
}
const nextAdr = async (root, title = 'Keep estimates in points') => {
  const result = await run(['docs', 'next-adr', '--title', title, '--json'], { cwd: root, env: childEnv() })
  return { code: result.code, data: JSON.parse(result.stdout), stderr: result.stderr }
}

test('docs next-adr numbers an empty repository 0001 and writes to the tracker on Local', async () => {
  const root = repo()
  const { code: exit, data } = await nextAdr(root)
  assert.equal(exit, 0)
  assert.equal(data.number, '0001')
  assert.equal(data.slug, 'keep-estimates-in-points')
  assert.equal(data.destination, 'tracker')
  assert.equal(data.path, '.issues/docs/adr/0001-keep-estimates-in-points.md')
  assert.equal(data.docPath, 'adr/0001-keep-estimates-in-points.md')
})

test('docs next-adr reads nothing but takes the next number after a gap', async () => {
  const root = repo()
  write(root, '.issues/docs/adr/0001-a.md')
  write(root, '.issues/docs/adr/0003-b.md')
  write(root, '.issues/docs/adr/README.md')
  const { data } = await nextAdr(root)
  assert.equal(data.number, '0004')
  assert.match(data.notes.join('\n'), /README\.md/)
  assert.ok(!fs.existsSync(path.join(root, '.issues/docs/adr/0004-keep-estimates-in-points.md')))
})

test('docs next-adr uses docs/adr/ in the repository, and counts the tracker folder too', async () => {
  const root = repo()
  write(root, 'docs/adr/0001-a.md')
  write(root, '.issues/docs/adr/0002-b.md')
  const { data } = await nextAdr(root)
  assert.equal(data.destination, 'repo')
  assert.equal(data.number, '0003')
  assert.equal(data.path, 'docs/adr/0003-keep-estimates-in-points.md')
  assert.equal(data.docPath, null)
  assert.match(data.notes.join('\n'), /\.issues\/docs\/adr also has ADRs/)
})

test('docs next-adr follows tracker.path for the folder and the path', async () => {
  const root = repo({ config: (text) => text.replace('path: .issues', 'path: tracker') })
  fs.renameSync(path.join(root, '.issues'), path.join(root, 'tracker'))
  write(root, 'tracker/docs/adr/0007-a.md')
  const { code: exit, data } = await nextAdr(root)
  assert.equal(exit, 0, JSON.stringify(data))
  assert.equal(data.number, '0008')
  assert.equal(data.path, 'tracker/docs/adr/0008-keep-estimates-in-points.md')
})

test('docs next-adr reads origin/<default_branch> from the config', async () => {
  const root = repo({ config: (text) => text.replace(/git_host:\n( {2}.*\n)+/, 'git_host:\n  system: none\n  default_branch: develop\n') })
  onOrigin(root, 'develop', 'docs/adr/0005-merged.md')
  const { data } = await nextAdr(root)
  assert.equal(data.defaultBranch, 'develop')
  assert.equal(data.ref.name, 'origin/develop')
  assert.equal(data.number, '0006')
  assert.equal(data.destination, 'repo', 'docs/adr/ exists on origin, so the repository folder is the place')
  assert.ok(!data.notes.some((note) => /is not set/.test(note)))
})

test('docs next-adr falls back to main without a note when default_branch is not set, and says when the ref is missing', async () => {
  const root = repo()
  const { data, stderr } = await nextAdr(root)
  assert.equal(data.defaultBranch, 'main')
  assert.equal(data.ref, null)
  assert.ok(!data.notes.some((note) => /default_branch/.test(note)), 'an unset default_branch is silent, as in every other reader')
  assert.match(data.notes.join('\n'), /origin\/main does not exist here/)
  assert.ok(!/default_branch/.test(stderr), stderr)
})

test('docs next-adr refuses a title with no letter or digit', async () => {
  const root = repo()
  const result = await run(['docs', 'next-adr', '--title', '???', '--json'], { cwd: root, env: childEnv() })
  assert.equal(result.code, 2)
  assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
})

test('planNextAdr writes a repository file when the tracker is hosted, with no tracker folder read', async () => {
  const { planNextAdr } = await import('./lib/adr.mjs')
  const root = repo()
  write(root, '.issues/docs/adr/0009-ignored.md')
  const plan = planNextAdr({
    title: 'Use Linear', root, trackerPath: null, hosted: true, createSupported: false, defaultBranch: 'develop', defaultBranchSet: true, gitHost: 'github',
    git: () => ({ status: 1, stdout: '' }),
  })
  assert.equal(plan.destination, 'repo')
  assert.equal(plan.number, '0001')
  assert.equal(plan.path, 'docs/adr/0001-use-linear.md')
  assert.deepEqual(plan.sources.map((source) => source.place), ['repo'])
})

test('highestAdr counts a slug that starts with a digit but not a dated name', () => {
  assert.equal(highestAdr(['0003-2fa-x.md']).highest, 3)
  assert.equal(highestAdr(['0007-x.md']).highest, 7)
  assert.equal(highestAdr(['2026-10-31-x.md', '2026-10-31.md']).highest, 0)
})

test('highestAdr counts only names of the form NNNN-', () => {
  assert.deepEqual(highestAdr(['0006-y.md', '20261031.md', '0007a-x.md']), { highest: 6, ignored: ['20261031.md', '0007a-x.md'] })
  assert.deepEqual(highestAdr(['2026-10-31-notes.md', '20261031-x.md']), { highest: 0, ignored: ['2026-10-31-notes.md', '20261031-x.md'] })
})

test('adrSlug cuts by code point and refuses a title of only combining marks', () => {
  const slug = adrSlug(`${'a'.repeat(59)}𠮷`)
  assert.ok(!/[\ud800-\udfff]/.test(slug.replace(/[\ud800-\udbff][\udc00-\udfff]/g, '')), 'lone surrogate')
  assert.equal(Array.from(slug).length, 60)
  assert.throws(() => adrSlug('\u0301'), /no letter or digit/)
})

test('docs next-adr ignores a note named like a date', async () => {
  const root = repo()
  write(root, '.issues/docs/adr/0006-y.md')
  write(root, '.issues/docs/adr/20261031.md')
  assert.equal((await nextAdr(root)).data.number, '0007')
})

test('adrSlug keeps non-Latin letters and transliterates ß æ ø', () => {
  assert.equal(adrSlug('Использовать файлы событий'), 'использовать-файлы-событий')
  assert.equal(adrSlug('Использовать й'), 'использовать-й')
  assert.equal(adrSlug('イベント 記録'), 'イベント-記録')
  assert.equal(adrSlug('Straße æble ørsted'), 'strasse-aeble-orsted')
  assert.throws(() => adrSlug('!!! ???'), /no letter or digit/)
})

test('docs next-adr with tracker.path . counts the folder once', async () => {
  const root = repo()
  fs.writeFileSync(configFile(root), fs.readFileSync(configFile(root), 'utf8').replace('path: .issues', 'path: .'))
  for (const name of fs.readdirSync(path.join(root, '.issues'))) fs.renameSync(path.join(root, '.issues', name), path.join(root, name))
  write(root, 'docs/adr/0001-a.md')
  const { code: exit, data } = await nextAdr(root)
  assert.equal(exit, 0, JSON.stringify(data))
  assert.equal(data.number, '0002')
  assert.doesNotMatch(data.notes.join('\n'), /also has ADRs/)
})

test('docs next-adr counts a tracker folder outside the repository and writes no null path', async () => {
  const root = repo()
  const outside = path.join(path.dirname(root), `outside-${path.basename(root)}`)
  fs.writeFileSync(configFile(root), fs.readFileSync(configFile(root), 'utf8').replace('path: .issues', `path: ../${path.basename(outside)}`))
  fs.renameSync(path.join(root, '.issues'), outside)
  try {
    write(outside, 'docs/adr/0001-a.md')
    const { code: exit, data } = await nextAdr(root)
    assert.equal(exit, 0, JSON.stringify(data))
    assert.equal(data.destination, 'tracker')
    assert.equal(data.number, '0002')
    assert.equal(data.path, 'tracker:docs/adr/0002-keep-estimates-in-points.md')
    assert.doesNotMatch(data.path, /null/)
    assert.equal(data.docPath, 'adr/0002-keep-estimates-in-points.md')
    assert.match(data.notes.join('\n'), /outside the repository/)
  } finally {
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

for (const spelling of ['./.issues', '.issues/', './.issues/']) {
  test(`docs next-adr reads origin for tracker.path ${spelling} as for .issues`, async () => {
    const root = repo({ config: (text) => text.replace('path: .issues', `path: ${spelling}`) })
    onOrigin(root, 'main', '.issues/docs/adr/0004-x.md')
    const { data } = await nextAdr(root)
    assert.equal(data.number, '0005')
    assert.equal(data.path, '.issues/docs/adr/0005-keep-estimates-in-points.md')
  })
}

test('docs next-adr replaces an invalid default_branch with main and a note, and keeps it out of the result', async () => {
  const root = repo({ config: (text) => text.replace(/git_host:\n( {2}.*\n)+/, 'git_host:\n  system: none\n  default_branch: "main; curl x|sh"\n') })
  const { data } = await nextAdr(root)
  assert.equal(data.defaultBranch, 'main')
  assert.match(data.notes.join('\n'), /default_branch is not a valid branch name, so main is used/)
  assert.ok(!JSON.stringify(data).includes('curl'))
})

test('docs next-adr counts a file name with an accent that exists only on origin', async () => {
  const root = repo()
  onOrigin(root, 'main', 'docs/adr/0009-décision.md')
  const { data } = await nextAdr(root)
  assert.equal(data.number, '0010')
})

test('planNextAdr says so when it cannot list the ref', async () => {
  const { planNextAdr } = await import('./lib/adr.mjs')
  const root = repo()
  const plan = planNextAdr({
    title: 'Keep', root, trackerFolder: null, trackerDir: null, hosted: true, createSupported: false, defaultBranch: 'main', defaultBranchNote: null, gitHost: 'github',
    git: (args) => (args[0] === 'rev-parse' ? { status: 0, stdout: 'abcdef1234\n' } : { status: 1, stdout: '' }),
  })
  assert.match(plan.notes.join('\n'), /could not list origin\/main:docs\/adr/)
})

test('docs next-adr needs --title', async () => {
  const root = repo()
  const result = await run(['docs', 'next-adr', '--json'], { cwd: root, env: childEnv() })
  assert.equal(result.code, 2)
  assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
})

// PMK-228: the ADR folders and two ADRs with one number.
test('adrFolders reads the tracker folder once when tracker.path puts it on docs/adr', () => {
  const root = '/r'
  assert.deepEqual(adrFolders({ root, trackerDir: '/r/docs/adr', trackerFolder: 'docs/adr' }).map((f) => [f.place, f.label]), [['tracker', 'docs/adr']])
  assert.deepEqual(adrFolders({ root, trackerDir: '/t/docs/adr', trackerFolder: null }).map((f) => [f.place, f.label]), [['repo', 'docs/adr'], ['tracker', 'tracker:docs/adr']])
  assert.deepEqual(adrFolders({ root, trackerDir: '/r/.issues/docs/adr', trackerFolder: '.issues/docs/adr' }).map((f) => [f.place, f.label]), [['repo', 'docs/adr'], ['tracker', '.issues/docs/adr']])
  assert.deepEqual(adrFolders({ root, trackerDir: null, trackerFolder: null }).map((f) => f.place), ['repo'])
})

test('adrFiles lists the numbered files of each folder and duplicateAdrs names every other file with the number', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-adr-'))
  try {
    const repo = path.join(root, 'docs', 'adr')
    const tracker = path.join(root, '.issues', 'docs', 'adr')
    fs.mkdirSync(repo, { recursive: true })
    fs.mkdirSync(tracker, { recursive: true })
    for (const name of ['0003-a.md', '0003-b.md', '0004-c.md', 'README.md', '.0003-hidden.md']) fs.writeFileSync(path.join(repo, name), '# x\n')
    fs.writeFileSync(path.join(tracker, '0003-c.md'), '# x\n')
    const files = adrFiles(adrFolders({ root, trackerDir: tracker, trackerFolder: '.issues/docs/adr' }))
    assert.deepEqual(files.map((f) => [f.number, f.path, f.place]), [
      ['0003', '.issues/docs/adr/0003-c.md', 'tracker'], ['0003', 'docs/adr/0003-a.md', 'repo'], ['0003', 'docs/adr/0003-b.md', 'repo'], ['0004', 'docs/adr/0004-c.md', 'repo'],
    ])
    assert.deepEqual(duplicateAdrs(files), [
      { path: '.issues/docs/adr/0003-c.md', number: '0003', others: ['docs/adr/0003-a.md', 'docs/adr/0003-b.md'] },
      { path: 'docs/adr/0003-a.md', number: '0003', others: ['.issues/docs/adr/0003-c.md', 'docs/adr/0003-b.md'] },
      { path: 'docs/adr/0003-b.md', number: '0003', others: ['.issues/docs/adr/0003-c.md', 'docs/adr/0003-a.md'] },
    ])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// PMK-228: the status of an ADR.
test('setAdrStatus puts a Status line under the title, replaces one above the first section and keeps LF', () => {
  const set = (text, status, by) => setAdrStatus(text, status, by).text
  assert.equal(set('# Title\n\nContext.\n', 'deprecated'), '# Title\n\nStatus: deprecated\n\nContext.\n')
  assert.equal(set('# Title\nContext.\n', 'deprecated'), '# Title\n\nStatus: deprecated\n\nContext.\n')
  assert.equal(set('Context only.\n', 'deprecated'), 'Status: deprecated\n\nContext only.\n')
  assert.equal(set('# Title\r\n\r\nStatus: accepted\r\n\r\nContext.\r\n', 'deprecated'), '# Title\n\nStatus: deprecated\n\nContext.\n')
  const sectioned = '# Title\n\nContext.\n\n## Notes\n\nStatus: draft of the notes\n'
  assert.equal(set(sectioned, 'accepted'), '# Title\n\nStatus: accepted\n\nContext.\n\n## Notes\n\nStatus: draft of the notes\n')
  assert.deepEqual(setAdrStatus('# T\n\nStatus: accepted\n\nX\n', 'accepted'), { text: '# T\n\nStatus: accepted\n\nX\n', before: 'Status: accepted', after: 'Status: accepted' })
  assert.deepEqual(setAdrStatus('# T\n\nX\n', 'superseded', 'docs/adr/0007-new.md'), { text: '# T\n\nStatus: superseded by docs/adr/0007-new.md\n\nX\n', before: null, after: 'Status: superseded by docs/adr/0007-new.md' })
})

test('setAdrStatus replaces the body of a ## Status section, the Nygard format, and adds no second status (PMK-228 review)', () => {
  const nygard = '# 4. Use X\n\nDate: 2026-11-10\n\n## Status\n\nAccepted\n\n## Context\n\nWhy.\n'
  assert.deepEqual(setAdrStatus(nygard, 'deprecated'), { text: '# 4. Use X\n\nDate: 2026-11-10\n\n## Status\n\nDeprecated\n\n## Context\n\nWhy.\n', before: 'Accepted', after: 'Deprecated' })
  const twoLines = '# T\n\n## Status\n\nProposed\nAccepted after review\n\n## Context\n'
  assert.deepEqual(setAdrStatus(twoLines, 'superseded', 'docs/adr/0009-b.md'), { text: '# T\n\n## Status\n\nSuperseded by docs/adr/0009-b.md\n\n## Context\n', before: 'Proposed Accepted after review', after: 'Superseded by docs/adr/0009-b.md' })
  assert.equal(setAdrStatus('# T\n\n## status\n\naccepted\n', 'deprecated').text, '# T\n\n## status\n\nDeprecated\n')
  assert.deepEqual(setAdrStatus('# T\n\n## Status\n\n## Context\n', 'accepted'), { text: '# T\n\n## Status\n\nAccepted\n\n## Context\n', before: null, after: 'Accepted' })
})

test('setAdrStatus keeps a bold **Status:** line bold and replaces it in place (PMK-228 review)', () => {
  assert.deepEqual(setAdrStatus('# T\n\n**Status:** accepted\n\nX\n', 'deprecated'), { text: '# T\n\n**Status:** deprecated\n\nX\n', before: '**Status:** accepted', after: '**Status:** deprecated' })
  assert.equal(setAdrStatus('# T\n\n**Status**: Accepted\n', 'deprecated').text, '# T\n\n**Status:** deprecated\n')
  assert.equal(setAdrStatus('# T\n\n- Status: accepted\n', 'deprecated').text, '# T\n\n- Status: deprecated\n')
})

test('setAdrStatus edits the status key of YAML front matter and never writes above the front matter (PMK-228 review)', () => {
  const madr = '---\nstatus: accepted\ndate: 2026-11-10\n---\n\n# Use X\n\nWhy.\n'
  assert.deepEqual(setAdrStatus(madr, 'deprecated'), { text: '---\nstatus: deprecated\ndate: 2026-11-10\n---\n\n# Use X\n\nWhy.\n', before: 'status: accepted', after: 'status: deprecated' })
  assert.equal(setAdrStatus('---\ndate: 2026-11-10\n---\n\nWhy.\n', 'deprecated').text, '---\ndate: 2026-11-10\n---\n\nStatus: deprecated\n\nWhy.\n')
  assert.equal(setAdrStatus('---\ndate: 2026-11-10\n---\n# Use X\n\nWhy.\n', 'deprecated').text, '---\ndate: 2026-11-10\n---\n# Use X\n\nStatus: deprecated\n\nWhy.\n')
})

test('docs adr-status on a Nygard ADR shows the old status in the preview and writes one status', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0004-use-x.md', '# 4. Use X\n\nDate: 2026-11-10\n\n## Status\n\nAccepted\n\n## Context\n\nWhy.\n')
  const dry = await adrStatus(root, '4', 'deprecated', '--dry-run')
  assert.equal(dry.code, 0, dry.stderr)
  assert.deepEqual(dry.data.status, { before: 'Accepted', after: 'Deprecated' })
  await adrStatus(root, '4', 'deprecated')
  const text = fs.readFileSync(path.join(root, 'docs/adr/0004-use-x.md'), 'utf8')
  assert.doesNotMatch(text, /Accepted|^Status:/m)
  assert.match(text, /## Status\n\nDeprecated\n/)
})

const adrStatus = async (root, ...args) => {
  const result = await run(['docs', 'adr-status', ...args, '--json'], { cwd: root, env: childEnv() })
  return { code: result.code, data: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr }
}
const writeAdr = (root, rel, text = '# A decision\n\nWhy.\n') => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), text)
}

test('docs adr-status --dry-run shows the status line and writes nothing; the real run writes the repository file with no commit', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0001-a.md')
  writeAdr(root, 'docs/adr/0002-b.md')
  const dry = await adrStatus(root, '1', 'superseded', '--by', '0002', '--dry-run')
  assert.equal(dry.code, 0, dry.stderr)
  assert.deepEqual([dry.data.number, dry.data.path, dry.data.place, dry.data.status], ['0001', 'docs/adr/0001-a.md', 'repo', { before: null, after: 'Status: superseded by docs/adr/0002-b.md' }])
  assert.equal(dry.data.after, '# A decision\n\nStatus: superseded by docs/adr/0002-b.md\n\nWhy.\n')
  assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), '# A decision\n\nWhy.\n')
  const real = await adrStatus(root, '0001', 'superseded', '--by', '2')
  assert.equal(real.code, 0, real.stderr)
  assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), dry.data.after)
  assert.match(real.stderr, /note: docs\/adr\/0001-a\.md is a repository file and has no commit yet/)
  assert.deepEqual(real.data.notes, ['docs/adr/0001-a.md is a repository file and has no commit yet; commit it with the work it belongs to'], 'the JSON carries the note the command file repeats')
  assert.deepEqual(dry.data.notes, [])
  const same = await adrStatus(root, '1', 'superseded', '--by', '2')
  assert.equal(same.data.before, same.data.after)
})

test('docs adr-status writes a tracker ADR through the tracker', async () => {
  const root = repo()
  writeAdr(root, '.issues/docs/adr/0001-a.md')
  const result = await adrStatus(root, '1', 'deprecated')
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual([result.data.path, result.data.place], ['.issues/docs/adr/0001-a.md', 'tracker'])
  assert.equal(fs.readFileSync(path.join(root, '.issues/docs/adr/0001-a.md'), 'utf8'), '# A decision\n\nStatus: deprecated\n\nWhy.\n')
})

test('docs adr-status refuses bad input before any write', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0001-a.md')
  writeAdr(root, 'docs/adr/0003-c.md')
  writeAdr(root, '.issues/docs/adr/0003-d.md')
  const cases = [
    [['1', 'superseded'], 'INVALID_INPUT'],
    [['1', 'deprecated', '--by', '3'], 'INVALID_INPUT'],
    [['1', 'superseded', '--by', '1'], 'INVALID_INPUT'],
    [['1', 'superseded', '--by', '9'], 'NOT_FOUND'],
    [['9', 'deprecated'], 'NOT_FOUND'],
    [['3', 'deprecated'], 'CONFLICT'],
    [['1', 'superseded', '--by', '3'], 'CONFLICT'],
    [['1', 'foo'], 'INVALID_INPUT'],
    [['12345', 'deprecated'], 'INVALID_INPUT'],
    [['x1', 'deprecated'], 'INVALID_INPUT'],
  ]
  const before = fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8')
  for (const [args, expected] of cases) {
    const result = await adrStatus(root, ...args)
    assert.equal(result.code, 2, args.join(' '))
    assert.equal(result.data.error.code, expected, args.join(' '))
  }
  assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), before)
  const conflict = await adrStatus(root, '3', 'deprecated')
  assert.match(conflict.data.error.message, /\.issues\/docs\/adr\/0003-d\.md.*docs\/adr\/0003-c\.md/)
})

test('docs adr-status on a hosted tracker writes the repository ADR with no Linear request', async () => {
  const { useLinear } = await import('./fake-hosted.mjs')
  const root = useLinear(repo())
  writeAdr(root, 'docs/adr/0001-a.md')
  const env = { ...childEnv() }
  delete env.LINEAR_API_KEY
  const result = await run(['docs', 'adr-status', '1', 'deprecated', '--json'], { cwd: root, env })
  assert.equal(result.code, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).place, 'repo')
  assert.match(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), /^Status: deprecated$/m)
})

// PMK-228: origin/HEAD is the default branch when git_host.default_branch is unset.
test('default-branch and docs next-adr use origin/HEAD when default_branch is unset', async () => {
  const root = repo()
  writeAdr(root, 'README.md', '# r\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'x')
  git(root, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD')
  git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
  const result = await run(['default-branch', '--json'], { cwd: root, env: childEnv() })
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { branch: 'trunk', configured: null, valid: true, note: 'git_host.default_branch is not set, so origin/HEAD (trunk) is used' })
  const { data } = await nextAdr(root)
  assert.equal(data.defaultBranch, 'trunk')
  assert.ok(data.notes.includes('git_host.default_branch is not set, so origin/HEAD (trunk) is used'), data.notes.join('\n'))
})

test('default-branch reads origin/HEAD when a local branch is also named origin/<name> (PMK-228 review)', async () => {
  const root = repo()
  writeAdr(root, 'README.md', '# r\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'x')
  git(root, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD')
  git(root, 'branch', 'origin/trunk')
  git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
  const result = await run(['default-branch', '--json'], { cwd: root, env: childEnv() })
  assert.equal(JSON.parse(result.stdout).branch, 'trunk', result.stderr)
})

test('default-branch stays main with no note when origin/HEAD is missing', async () => {
  const root = repo()
  const result = await run(['default-branch', '--json'], { cwd: root, env: childEnv() })
  assert.deepEqual(JSON.parse(result.stdout), { branch: 'main', configured: null, valid: true, note: null })
})

test('docs adr-status notes in the JSON when --by names an older ADR (PMK-228 review)', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0003-a.md')
  writeAdr(root, 'docs/adr/0005-b.md')
  const swapped = await adrStatus(root, '5', 'superseded', '--by', '3', '--dry-run')
  assert.equal(swapped.code, 0, swapped.stderr)
  assert.deepEqual(swapped.data.notes, ['ADR 0003 is older than ADR 0005; check that --by names the decision that replaces it'])
  const right = await adrStatus(root, '3', 'superseded', '--by', '5', '--dry-run')
  assert.deepEqual(right.data.notes, [])
})

test('adrLocation gives the tracker ADR folder relative to the repository, null outside it, and none for a hosted tracker (PMK-228 review)', () => {
  const root = path.join(os.tmpdir(), 'r')
  assert.deepEqual(adrLocation({ root, issuesDir: path.join(root, '.issues'), hosted: false }), { trackerDir: path.join(root, '.issues', 'docs', 'adr'), trackerFolder: '.issues/docs/adr' })
  assert.equal(adrLocation({ root, issuesDir: path.join(root, '..x'), hosted: false }).trackerFolder, '..x/docs/adr')
  assert.equal(adrLocation({ root, issuesDir: path.join(root, '..', 'tracker'), hosted: false }).trackerFolder, null)
  assert.deepEqual(adrLocation({ root, issuesDir: undefined, hosted: true }), { trackerDir: null, trackerFolder: null })
})

test('setAdrStatus leaves an ADR untouched when its status does not change, whatever the blank lines or letter case (PMK-248)', () => {
  for (const text of ['# T\n\n## Status\nAccepted\n## Context\n\nWhy.\n', '# T\n\n## Status\n\naccepted\n\n## Context\n', '---\nstatus: Accepted\n---\n\n# T\n', '# T\n\n**Status:** ACCEPTED\n\nX\n']) {
    const result = setAdrStatus(text, 'accepted')
    assert.equal(result.text, text)
  }
  const sup = '# T\n\n## Status\nSuperseded by docs/adr/0009-b.md\n## Context\n'
  assert.equal(setAdrStatus(sup, 'superseded', 'docs/adr/0009-b.md').text, sup)
  // A section that is empty or holds more than the status is still a change.
  assert.notEqual(setAdrStatus('# T\n\n## Status\n\n## Context\n', 'accepted').text, '# T\n\n## Status\n\n## Context\n')
  assert.equal(setAdrStatus('# T\n\n## Status\n\nAccepted\nafter review\n\n## Context\n', 'accepted').text, '# T\n\n## Status\n\nAccepted\nafter review\n\n## Context\n')
})

test('setAdrStatus changes the front matter key and the ## Status section together (PMK-248)', () => {
  const both = '---\nstatus: accepted\n---\n\n# T\n\n## Status\n\nAccepted\n\n## Context\n'
  assert.deepEqual(setAdrStatus(both, 'deprecated'), { text: '---\nstatus: deprecated\n---\n\n# T\n\n## Status\n\nDeprecated\n\n## Context\n', before: 'status: accepted; ## Status: Accepted', after: 'status: deprecated; ## Status: Deprecated' })
  // The key is current but the section is not: the section still changes.
  const stale = '---\nstatus: deprecated\n---\n\n# T\n\n## Status\n\nAccepted\n'
  assert.equal(setAdrStatus(stale, 'deprecated').text, '---\nstatus: deprecated\n---\n\n# T\n\n## Status\n\nDeprecated\n')
})

test('setAdrStatus reports an unchanged status as the same text before and after, and both places when both change (PMK-257)', () => {
  for (const text of ['# T\n\n## Status\n\naccepted\n\n## Context\n', '---\nstatus: Accepted\n---\n\n# T\n', '# T\n\n**Status:** ACCEPTED\n']) {
    const result = setAdrStatus(text, 'accepted')
    assert.equal(result.before, result.after, text)
  }
  const both = setAdrStatus('---\nstatus: accepted\n---\n\n# T\n\n## Status\n\naccepted\n', 'accepted')
  assert.deepEqual([both.before, both.after], ['status: accepted; ## Status: accepted', 'status: accepted; ## Status: accepted'])
})

test('setAdrStatus counts status: accepted # comment as accepted and keeps the comment (PMK-257)', () => {
  const same = '---\nstatus: accepted # agreed in review\n---\n\n# T\n'
  assert.deepEqual(setAdrStatus(same, 'accepted'), { text: same, before: 'status: accepted # agreed in review', after: 'status: accepted # agreed in review' })
  const changed = setAdrStatus(same, 'deprecated')
  assert.deepEqual(changed, { text: '---\nstatus: deprecated # agreed in review\n---\n\n# T\n', before: 'status: accepted # agreed in review', after: 'status: deprecated # agreed in review' })
  assert.equal(setAdrStatus('---\nstatus: "accepted"   #c\n---\n', 'accepted').text, '---\nstatus: "accepted"   #c\n---\n')
})

// PMK-247: the tracker folder is the repository's, or lies outside it.
const trackerAtRoot = (root, autoCommit) => {
  fs.writeFileSync(configFile(root), fs.readFileSync(configFile(root), 'utf8').replace('path: .issues', 'path: .'))
  for (const name of fs.readdirSync(path.join(root, '.issues'))) fs.renameSync(path.join(root, '.issues', name), path.join(root, name))
  fs.rmSync(path.join(root, '.issues'), { recursive: true })
  fs.writeFileSync(path.join(root, 'config.yaml'), fs.readFileSync(path.join(root, 'config.yaml'), 'utf8').replace(/^auto_commit: .*$/m, `auto_commit: ${autoCommit}`))
  writeAdr(root, 'docs/adr/0001-a.md')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'init')
}

test('docs next-adr with tracker.path . answers a tracker document, as for any tracker path (PMK-247)', async () => {
  const root = repo()
  trackerAtRoot(root, true)
  const { data } = await nextAdr(root)
  assert.deepEqual([data.destination, data.path, data.docPath], ['tracker', 'docs/adr/0002-keep-estimates-in-points.md', 'adr/0002-keep-estimates-in-points.md'])
  assert.doesNotMatch(data.notes.join('\n'), /also has ADRs/)
})

test('docs adr-status with tracker.path . and auto_commit true commits the ADR (PMK-247)', async () => {
  const root = repo()
  trackerAtRoot(root, true)
  const before = git(root, 'rev-list', '--count', 'HEAD').trim()
  const result = await adrStatus(root, '1', 'deprecated')
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.data.place, 'tracker')
  assert.deepEqual(result.data.notes, [])
  assert.equal(Number(git(root, 'rev-list', '--count', 'HEAD').trim()), Number(before) + 1)
  assert.match(git(root, 'show', '--name-only', '--format=', 'HEAD'), /docs\/adr\/0001-a\.md/)
  assert.equal(git(root, 'status', '--porcelain', '--', 'docs'), '')
})

test('docs adr-status with tracker.path . and auto_commit false writes the file and commits nothing (PMK-247)', async () => {
  const root = repo()
  trackerAtRoot(root, false)
  const before = git(root, 'rev-list', '--count', 'HEAD').trim()
  const result = await adrStatus(root, '1', 'deprecated')
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.data.place, 'tracker')
  assert.deepEqual(result.data.notes, [])
  assert.equal(git(root, 'rev-list', '--count', 'HEAD').trim(), before)
  assert.match(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), /^Status: deprecated$/m)
})

test('a number used in the repository and in a tracker outside it shows two different paths in validate and CONFLICT (PMK-247)', async () => {
  const root = repo()
  const outside = path.join(path.dirname(root), `outside-${path.basename(root)}`)
  fs.writeFileSync(configFile(root), fs.readFileSync(configFile(root), 'utf8').replace('path: .issues', `path: ../${path.basename(outside)}`))
  fs.renameSync(path.join(root, '.issues'), outside)
  try {
    writeAdr(root, 'docs/adr/0002-a.md')
    writeAdr(outside, 'docs/adr/0002-a.md')
    const status = await adrStatus(root, '2', 'deprecated')
    assert.equal(status.code, 2)
    assert.equal(status.data.error.code, 'CONFLICT')
    assert.match(status.data.error.message, /^ADR number 0002 is used by (docs\/adr\/0002-a\.md and tracker:docs\/adr\/0002-a\.md|tracker:docs\/adr\/0002-a\.md and docs\/adr\/0002-a\.md)$/)
    const validate = await run(['validate', '--json'], { cwd: root, env: childEnv() })
    const messages = JSON.parse(validate.stdout).problems.filter((problem) => problem.code === 'adr').map((problem) => `${problem.path} ${problem.message}`)
    assert.deepEqual(messages.sort(), ['docs/adr/0002-a.md ADR number 0002 is also used by tracker:docs/adr/0002-a.md', 'tracker:docs/adr/0002-a.md ADR number 0002 is also used by docs/adr/0002-a.md'])
  } finally {
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('docs adr-status superseded --by writes a plain relative path into the ADR, never the tracker: label (PMK-247 review)', async () => {
  const root = repo()
  const outside = path.join(path.dirname(root), `outside-${path.basename(root)}`)
  fs.writeFileSync(configFile(root), fs.readFileSync(configFile(root), 'utf8').replace('path: .issues', `path: ../${path.basename(outside)}`))
  fs.renameSync(path.join(root, '.issues'), outside)
  try {
    writeAdr(root, 'docs/adr/0002-a.md')
    writeAdr(outside, 'docs/adr/0003-x.md')
    const dry = await adrStatus(root, '2', 'superseded', '--by', '3', '--dry-run')
    assert.equal(dry.code, 0, dry.stderr)
    // A reader opens it from the repository root (PMK-257).
    assert.equal(dry.data.status.after, `Status: superseded by ../${path.basename(outside)}/docs/adr/0003-x.md`)
    assert.ok(fs.existsSync(path.join(root, `../${path.basename(outside)}/docs/adr/0003-x.md`)))
    await adrStatus(root, '2', 'superseded', '--by', '3')
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'docs/adr/0002-a.md'), 'utf8'), /tracker:/)
    // The other way round: the ADR in the outside tracker names a repository ADR.
    writeAdr(outside, 'docs/adr/0004-y.md')
    writeAdr(root, 'docs/adr/0005-z.md')
    const back = await adrStatus(root, '4', 'superseded', '--by', '5')
    assert.equal(back.code, 0, back.stderr)
    assert.equal(back.data.path, 'tracker:docs/adr/0004-y.md', 'the display path keeps the label')
    assert.equal(fs.readFileSync(path.join(outside, 'docs/adr/0004-y.md'), 'utf8'), '# A decision\n\nStatus: superseded by docs/adr/0005-z.md\n\nWhy.\n')
  } finally {
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

// PMK-257: auto_commit with a tracker outside the repository.
const withOutsideTracker = async (inGit, fn) => {
  const root = repo()
  const outside = path.join(path.dirname(root), `outside-${path.basename(root)}`)
  fs.writeFileSync(configFile(root), fs.readFileSync(configFile(root), 'utf8').replace('path: .issues', `path: ../${path.basename(outside)}`))
  fs.renameSync(path.join(root, '.issues'), outside)
  fs.writeFileSync(path.join(outside, 'config.yaml'), fs.readFileSync(path.join(outside, 'config.yaml'), 'utf8').replace(/^auto_commit: .*$/m, 'auto_commit: true'))
  writeAdr(outside, 'docs/adr/0001-a.md')
  if (inGit) {
    git(outside, 'init', '-q')
    git(outside, 'config', 'user.name', 'T')
    git(outside, 'config', 'user.email', 't@example.com')
    git(outside, 'add', '-A')
    git(outside, 'commit', '-q', '-m', 'init')
  }
  try {
    await fn({ root, outside })
  } finally {
    fs.rmSync(outside, { recursive: true, force: true })
  }
}

test('docs adr-status with a tracker outside the repository commits in the git repository that holds the tracker (PMK-257)', async () => {
  await withOutsideTracker(true, async ({ root, outside }) => {
    const result = await run(['docs', 'adr-status', '1', 'deprecated'], { cwd: root, env: childEnv() })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(git(outside, 'rev-list', '--count', 'HEAD').trim(), '2')
    assert.match(git(outside, 'show', '--name-only', '--format=', 'HEAD'), /docs\/adr\/0001-a\.md/)
    assert.equal(git(outside, 'status', '--porcelain'), '')
    assert.ok(!(result.stdout + result.stderr).includes(outside), 'no absolute path')
  })
})

test('docs adr-status with a tracker outside the repository and outside any git repository writes the ADR and says nothing was committed (PMK-257)', async () => {
  await withOutsideTracker(false, async ({ root, outside }) => {
    const result = await run(['docs', 'adr-status', '1', 'deprecated', '--json'], { cwd: root, env: childEnv() })
    assert.equal(result.code, 0, result.stderr)
    assert.match(fs.readFileSync(path.join(outside, 'docs/adr/0001-a.md'), 'utf8'), /^Status: deprecated$/m)
    assert.match(result.stderr, /^note: .*not in a git repository, so nothing was committed/m)
    assert.ok(!(result.stdout + result.stderr).includes(outside), 'no absolute path')
  })
})

test('docs adr-status returns ref, the path without the tracker: label, in the JSON and the dry run (PMK-251 review)', async () => {
  const root = repo()
  const outside = path.join(path.dirname(root), `outside-${path.basename(root)}`)
  fs.writeFileSync(configFile(root), fs.readFileSync(configFile(root), 'utf8').replace('path: .issues', `path: ../${path.basename(outside)}`))
  fs.renameSync(path.join(root, '.issues'), outside)
  try {
    writeAdr(root, 'docs/adr/0002-a.md')
    writeAdr(outside, 'docs/adr/0004-y.md')
    const inRepo = await adrStatus(root, '2', 'deprecated', '--dry-run')
    assert.deepEqual([inRepo.data.path, inRepo.data.ref], ['docs/adr/0002-a.md', 'docs/adr/0002-a.md'])
    for (const args of [['4', 'deprecated', '--dry-run'], ['4', 'deprecated']]) {
      const result = await adrStatus(root, ...args)
      assert.deepEqual([result.data.path, result.data.ref], ['tracker:docs/adr/0004-y.md', `../${path.basename(outside)}/docs/adr/0004-y.md`], args.join(' '))
    }
  } finally {
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('docs adr-status superseded --by with tracker.path . writes the repository path (PMK-247 review)', async () => {
  const root = repo()
  trackerAtRoot(root, false)
  writeAdr(root, 'docs/adr/0002-b.md')
  const result = await adrStatus(root, '1', 'superseded', '--by', '2')
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.data.status.after, 'Status: superseded by docs/adr/0002-b.md')
  assert.match(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), /^Status: superseded by docs\/adr\/0002-b\.md$/m)
})

test('setAdrStatus changes a Status: line above the first section together with the front matter and the ## Status section (PMK-263)', () => {
  const line = '# T\n\nStatus: accepted\n\n## Status\n\nAccepted\n\n## Context\n'
  assert.deepEqual(setAdrStatus(line, 'deprecated'), { text: '# T\n\nStatus: deprecated\n\n## Status\n\nDeprecated\n\n## Context\n', before: 'Status: accepted; ## Status: Accepted', after: 'Status: deprecated; ## Status: Deprecated' })
  const all = '---\nstatus: accepted\n---\n\n# T\n\n**Status:** Accepted\n\n## Status\n\nAccepted\n'
  assert.deepEqual(setAdrStatus(all, 'deprecated'), { text: '---\nstatus: deprecated\n---\n\n# T\n\n**Status:** deprecated\n\n## Status\n\nDeprecated\n', before: 'status: accepted; **Status:** Accepted; ## Status: Accepted', after: 'status: deprecated; **Status:** deprecated; ## Status: Deprecated' })
  const fm = '---\nstatus: accepted\n---\n\n# T\n\nStatus: accepted\n\nWhy.\n'
  assert.equal(setAdrStatus(fm, 'deprecated').text, '---\nstatus: deprecated\n---\n\n# T\n\nStatus: deprecated\n\nWhy.\n')
  // Nothing changes when every place already has the status.
  const same = '# T\n\nStatus: Accepted\n\n## Status\n\naccepted\n'
  assert.equal(setAdrStatus(same, 'accepted').text, same)
  // A Status: line inside a later section is not a status line.
  const later = '# T\n\n## Status\n\nAccepted\n\n## Context\n\nStatus: draft notes\n'
  assert.equal(setAdrStatus(later, 'deprecated').text, '# T\n\n## Status\n\nDeprecated\n\n## Context\n\nStatus: draft notes\n')
})

test('adrInfo reads the title and the status in every form an ADR uses, null when absent (PMK-263)', () => {
  assert.deepEqual(adrInfo('# 4. Use X\n\nDate: 2026-11-10\n\n## Status\n\nAccepted\n\n## Context\n'), { title: '4. Use X', status: 'Accepted', statuses: ['Accepted'] })
  assert.deepEqual(adrInfo('---\nstatus: "accepted"  # agreed\n---\n\n# Use X\n'), { title: 'Use X', status: 'accepted', statuses: ['accepted'] })
  assert.deepEqual(adrInfo('---\ntitle: Use Y\nstatus: proposed\n---\n\nWhy.\n'), { title: 'Use Y', status: 'proposed', statuses: ['proposed'] })
  assert.deepEqual(adrInfo('# T\r\n\r\n**Status:** Deprecated\r\n'), { title: 'T', status: 'Deprecated', statuses: ['Deprecated'] })
  assert.deepEqual(adrInfo('Why.\n'), { title: null, status: null, statuses: [] })
  // Two forms: the first (front matter, then the line above the first section, then the section) wins and both are listed.
  assert.deepEqual(adrInfo('---\nstatus: accepted\n---\n\n# T\n\n## Status\n\nDeprecated\n'), { title: 'T', status: 'accepted', statuses: ['accepted', 'Deprecated'] })
  // A Status: line in a later section is not the status.
  assert.equal(adrInfo('# T\n\n## Context\n\nStatus: notes\n').status, null)
})

test('docs adr-get shows number, title, status and path, notes a disagreement and writes nothing (PMK-263)', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0004-use-x.md', '---\nstatus: accepted\n---\n\n# 4. Use X\n\n## Status\n\nDeprecated\n')
  writeAdr(root, '.issues/docs/adr/0005-use-y.md', '# Use Y\n\nStatus: proposed\n')
  const run1 = async (...args) => {
    const result = await run(['docs', 'adr-get', ...args, '--json'], { cwd: root, env: childEnv() })
    return { code: result.code, data: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr }
  }
  const one = await run1('4')
  assert.equal(one.code, 0, one.stderr)
  assert.deepEqual({ ...one.data, notes: undefined }, { number: '0004', title: '4. Use X', status: 'accepted', statuses: ['accepted', 'Deprecated'], statusHeading: null, htmlHeld: null, fenceHeld: null, path: 'docs/adr/0004-use-x.md', ref: 'docs/adr/0004-use-x.md', place: 'repo', supersedesRef: null, notes: undefined })
  assert.equal(one.data.notes.length, 1)
  assert.match(one.data.notes[0], /accepted.*Deprecated/)
  assert.match(one.data.notes[0], /status in the JSON is the first/, 'the note matches what the text and the JSON show')
  assert.doesNotMatch(one.data.notes[0], /the first is shown/)
  const two = await run1('0005')
  assert.deepEqual([two.data.title, two.data.status, two.data.place, two.data.path, two.data.notes], ['Use Y', 'proposed', 'tracker', '.issues/docs/adr/0005-use-y.md', []])
  assert.equal(JSON.parse((await run(['docs', 'adr-get', '9', '--json'], { cwd: root, env: childEnv() })).stdout).error.code, 'NOT_FOUND')
  assert.equal((await run(['docs', 'adr-get', 'x', '--json'], { cwd: root, env: childEnv() })).code, 2)
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout
  assert.doesNotMatch(status, /^ M/m)
  assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0004-use-x.md'), 'utf8').startsWith('---\nstatus: accepted'), true)
})

test('setAdrStatus and adrInfo ignore status lines, headings and sections inside code blocks (PMK-263 review)', () => {
  const fm = '---\nstatus: accepted\n---\n\n# T\n\n```yaml\nstatus: accepted\n```\n\n## Context\n'
  assert.equal(setAdrStatus(fm, 'deprecated').text, '---\nstatus: deprecated\n---\n\n# T\n\n```yaml\nstatus: accepted\n```\n\n## Context\n')
  const section = '# T\n\n~~~\nStatus: draft\n~~~\n\n## Status\n\nAccepted\n'
  assert.deepEqual(setAdrStatus(section, 'deprecated'), { text: '# T\n\n~~~\nStatus: draft\n~~~\n\n## Status\n\nDeprecated\n', before: 'Accepted', after: 'Deprecated' })
  const fenced = '# T\n\n```md\n## Status\n\nold\n```\n\n## Status\n\nAccepted\n'
  assert.equal(setAdrStatus(fenced, 'deprecated').text, '# T\n\n```md\n## Status\n\nold\n```\n\n## Status\n\nDeprecated\n')
  const plain = '# T\n\n```\nStatus: draft\n```\n\nWhy.\n'
  assert.equal(setAdrStatus(plain, 'deprecated').text, '# T\n\nStatus: deprecated\n\n```\nStatus: draft\n```\n\nWhy.\n')
  assert.deepEqual(adrInfo(fm), { title: 'T', status: 'accepted', statuses: ['accepted'] })
  assert.deepEqual(adrInfo(section), { title: 'T', status: 'Accepted', statuses: ['Accepted'] })
  assert.equal(adrInfo('```sh\n# a comment\n```\n\n# Real\n').title, 'Real')
  assert.equal(adrInfo('```sh\n# a comment\n```\n').title, null)
})

test('adrInfo keeps a # inside quotes and drops a YAML comment outside them (PMK-263 review)', () => {
  assert.equal(adrInfo('---\ntitle: "Fix issue #42"\n---\n').title, 'Fix issue #42')
  assert.equal(adrInfo("---\ntitle: 'Fix #42'  # note\n---\n").title, 'Fix #42')
  assert.equal(adrInfo('---\ntitle: Fix  # note\n---\n').title, 'Fix')
  assert.equal(adrInfo('---\nstatus: "accepted # x"\n---\n').status, 'accepted # x')
})

test('docs adr-get lists every status it read, so a superseded one is never hidden (PMK-263 review)', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0004-use-x.md', '---\nstatus: accepted\n---\n\n# Use X\n\n## Status\n\nSuperseded by docs/adr/0009-y.md\n')
  writeAdr(root, 'docs/adr/0005-use-z.md', '# Use Z\n\n## Status\n\nAccepted\n')
  const get = async (n) => JSON.parse((await run(['docs', 'adr-get', n, '--json'], { cwd: root, env: childEnv() })).stdout)
  assert.deepEqual((await get('4')).statuses, ['accepted', 'Superseded by docs/adr/0009-y.md'])
  assert.deepEqual((await get('5')).statuses, ['Accepted'])
})

test('a YAML single-quoted value with an escaped quote is read and rewritten whole (PMK-263 review 2)', () => {
  assert.equal(adrInfo("---\ntitle: 'Don''t use X'\n---\n").title, "Don't use X")
  assert.equal(adrInfo("---\nstatus: 'it''s ok'  # why\n---\n").status, "it's ok")
  assert.equal(setAdrStatus("---\nstatus: 'it''s ok'  # why\n---\n\n# T\n", 'deprecated').text, '---\nstatus: deprecated  # why\n---\n\n# T\n')
  const same = "---\nstatus: 'it''s ok'\n---\n"
  assert.equal(setAdrStatus(same, "it's ok").text, same)
})

test('a fence needs its own character and length to close, and inline triple backticks open nothing (PMK-263 review 2)', () => {
  const inline = '# T\n\n```npm test``` runs the suite.\n\n## Status\n\nAccepted\n'
  assert.equal(setAdrStatus(inline, 'deprecated').text, '# T\n\n```npm test``` runs the suite.\n\n## Status\n\nDeprecated\n')
  const longer = '# T\n\n````md\n```\nStatus: draft\n```\n````\n\n## Status\n\nAccepted\n'
  assert.equal(setAdrStatus(longer, 'deprecated').text, '# T\n\n````md\n```\nStatus: draft\n```\n````\n\n## Status\n\nDeprecated\n')
  const mixed = '# T\n\n~~~\n```\nStatus: draft\n~~~\n\n**Status:** Accepted\n'
  assert.equal(adrInfo(mixed).status, 'Accepted')
  assert.equal(adrInfo('# T\n\n```js\ncode\n```  \n\n## Status\n\nProposed\n').status, 'Proposed')
})

test('docs adr-status superseded --by with both ADRs in a tracker outside the repository writes a path that resolves from the ADR that holds it (PMK-268)', async () => {
  await withOutsideTracker(false, async ({ root, outside }) => {
    writeAdr(outside, 'docs/adr/0003-x.md')
    const { data, code, stderr } = await adrStatus(root, '1', 'superseded', '--by', '3')
    assert.equal(code, 0, stderr)
    assert.equal(data.status.after, 'Status: superseded by 0003-x.md')
    const written = fs.readFileSync(path.join(outside, 'docs/adr/0001-a.md'), 'utf8')
    assert.match(written, /^Status: superseded by 0003-x\.md$/m)
    // Opened from the folder of the ADR that holds it, as a reader of the tracker alone does: the path read from the Status line resolves to a file.
    const [, cited] = /^Status: superseded by (.+)$/m.exec(written)
    assert.ok(fs.existsSync(path.resolve(path.dirname(path.join(outside, 'docs/adr/0001-a.md')), cited)), `${cited} does not resolve from the ADR`)
    // path and ref in the JSON keep their meaning.
    assert.deepEqual([data.path, data.ref], ['tracker:docs/adr/0001-a.md', `../${path.basename(outside)}/docs/adr/0001-a.md`])
  })
})

test('a subsection of the ## Status section is not part of the status, and adr-status keeps it (PMK-269)', () => {
  const text = '# T\n\n## Status\n\nAccepted\n\n### Notes\n\nmore\n\n#### Deeper\n\nx\n\n## Context\n\nWhy.\n'
  assert.deepEqual(adrInfo(text), { title: 'T', status: 'Accepted', statuses: ['Accepted'] })
  assert.deepEqual(setAdrStatus(text, 'deprecated'), { text: text.replace('\nAccepted\n', '\nDeprecated\n'), before: 'Accepted', after: 'Deprecated' })
  // An unchanged status leaves the text as it came.
  assert.equal(setAdrStatus(text, 'accepted').text, text)
  // A section with only a subsection has no status text; the subsection stays after the new one.
  assert.equal(setAdrStatus('# T\n\n## Status\n\n### Notes\n\nmore\n', 'accepted').text, '# T\n\n## Status\n\nAccepted\n\n### Notes\n\nmore\n')
  // A heading inside a fenced block is an example, so it does not end the section (PMK-263).
  assert.equal(adrSectionText('# T\n\n## Status\n\nAccepted\n\n```md\n### Notes\n```\n\n## Context\n'), 'Accepted ```md ### Notes ```')
})

const statusWith = (after) => `# T\n\n## Status\n\nAccepted\n${after}\n## Context\n\nWhy.\n`

test('the Status section ends at a setext, indented, tab or empty heading, in adr-get and adr-status alike (PMK-273)', () => {
  const heads = {
    'setext ===': '\nNotes\n=====\n\nmore\n',
    'setext ---': '\nNotes\n-----\n\nmore\n',
    'setext right under the status text': '\nNotes\n---\nmore\n',
    'multi-line setext paragraph': '\nNotes\nand more\n===\n\nx\n',
    'one space': '\n ## Notes\n\nmore\n',
    'three spaces': '\n   ## Notes\n\nmore\n',
    'tab after #': '\n##\tNotes\n\nmore\n',
    'empty ##': '\n##\n\nmore\n',
    'empty #': '\n#\n\nmore\n',
  }
  for (const [name, tail] of Object.entries(heads)) {
    const text = statusWith(tail)
    assert.equal(adrInfo(text).status, 'Accepted', name)
    assert.deepEqual(setAdrStatus(text, 'deprecated'), { text: text.replace('\nAccepted\n', '\nDeprecated\n'), before: 'Accepted', after: 'Deprecated' }, name)
    assert.equal(setAdrStatus(text, 'accepted').text, text, name)
  }
  // A setext heading right under the status text takes the text with it: the status is empty, and the new one goes above.
  assert.equal(adrInfo('# T\n\n## Status\n\nAccepted\n---\n').status, null)
})

test('a line that is not a heading does not end the Status section (PMK-273)', () => {
  const kept = {
    'four spaces': '\n    ## Notes\n',
    hashtag: '\n#hashtag\n',
    'thematic break after a blank line': '\n---\n\nmore\n',
    'thematic break between blank lines, ***': '\n***\n',
    'list item then ---': '\n- item\n---\n',
    'quote then ===': '\n> quote\n===\n',
    'fenced setext': '\n```\nNotes\n===\n```\n',
  }
  for (const [name, tail] of Object.entries(kept)) {
    const info = { status: adrSectionText(statusWith(tail)) }
    assert.ok(info.status.startsWith('Accepted ') && info.status.length > 'Accepted '.length, `${name}: ${info.status}`)
  }
  // The thematic break and the text after it are part of the section, so adr-status rewrites them with it, as for any other text.
  assert.equal(setAdrStatus(statusWith('\n---\n\nmore\n'), 'deprecated').text, '# T\n\n## Status\n\nDeprecated\n\n---\n\nmore\n\n## Context\n\nWhy.\n')
})

test('docs adr-get and docs adr-status end the Status section at a setext heading (PMK-273)', async () => {
  const root = repo()
  const text = '# 5. Use Y\n\n## Status\n\nAccepted\n\nNotes\n=====\n\nmore\n\n   ### Indented\n\nx\n\n## Context\n\nWhy.\n'
  writeAdr(root, 'docs/adr/0005-use-y.md', text)
  const get = await adrGetFrom(root, '5')
  assert.equal(get.code, 0)
  assert.equal(get.data.status, 'Accepted')
  const result = await adrStatus(root, '5', 'deprecated')
  assert.equal(result.code, 0, result.stderr)
  assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0005-use-y.md'), 'utf8'), text.replace('\nAccepted\n', '\nDeprecated\n'))
})

test('setAdrStatus on a Status section underlined by --- pins the CommonMark reading (PMK-283)', () => {
  // CommonMark makes `Accepted` a setext h2 heading, so the Status section is empty and the status is null.
  // This pins that reading: a human reader sees two status-like entries (Deprecated and Accepted) after the write.
  const text = '# 1. Use X\n\n## Status\nAccepted\n---\n\n## Context\n\nSome text.\n'
  assert.deepEqual(adrInfo(text), { title: '1. Use X', status: null, statuses: [] })
  assert.deepEqual(setAdrStatus(text, 'deprecated'), {
    text: '# 1. Use X\n\n## Status\n\nDeprecated\n\nAccepted\n---\n\n## Context\n\nSome text.\n',
    before: null,
    after: 'Deprecated',
  })
})

test('setAdrStatus on a Status section underlined by === pins the same reading (PMK-294)', () => {
  const text = '# 1. Use X\n\n## Status\nAccepted\n===\n\n## Context\n\nSome text.\n'
  assert.deepEqual(adrInfo(text), { title: '1. Use X', status: null, statuses: [] })
  assert.deepEqual(setAdrStatus(text, 'deprecated'), { text: '# 1. Use X\n\n## Status\n\nDeprecated\n\nAccepted\n===\n\n## Context\n\nSome text.\n', before: null, after: 'Deprecated' })
})

test('docs adr-status and docs adr-get on a Status section underlined by --- pin what is written (PMK-283)', async () => {
  // The same CommonMark reading as the unit test above: a human reader sees Deprecated and Accepted after the write.
  const root = repo()
  const text = '# 1. Use X\n\n## Status\nAccepted\n---\n\n## Context\n\nSome text.\n'
  const written = '# 1. Use X\n\n## Status\n\nDeprecated\n\nAccepted\n---\n\n## Context\n\nSome text.\n'
  writeAdr(root, 'docs/adr/0001-use-x.md', text)
  const before = await adrGetFrom(root, '1')
  assert.equal(before.code, 0)
  assert.equal(before.data.status, null)
  const result = await adrStatus(root, '1', 'deprecated')
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(result.data.status, { before: null, after: 'Deprecated' })
  assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0001-use-x.md'), 'utf8'), written)
  const after = await adrGetFrom(root, '1')
  assert.equal(after.code, 0)
  assert.equal(after.data.status, 'Deprecated')
})

test('adrStatusHeading names the line a setext heading makes of an empty Status section, and nothing else (PMK-294)', () => {
  const cases = {
    '---': ['## Status\nAccepted\n---\n\n## Context\n', 'Accepted'],
    '===': ['## Status\nAccepted\n===\n\n## Context\n', 'Accepted'],
    'blank lines before it': ['## Status\n\nAccepted\n===\n', 'Accepted'],
    'indented': ['## Status\n\n  Accepted  \n  ---\n', 'Accepted'],
    'a multi-line heading is named whole': ['## Status\nAccepted\nfor now\n---\n', 'Accepted for now'],
    'indented lines of a multi-line heading': ['## Status\n  Accepted\n   for now  \n===\n', 'Accepted for now'],
    'link definitions are not the heading': ['## Status\n[a]: /u\nAccepted\n---\n', 'Accepted'],
    'link definitions with a title and a destination on the next line': ['## Status\n[a]:\n/u "t"\n[b]: /v\nAccepted\nfor now\n---\n', 'Accepted for now'],
    'a === line first is text of the heading': ['## Status\n===\nAccepted\n---\n', '=== Accepted'],
    'a lone = first is text of the heading': ['## Status\n=\nAccepted\n---\n', '= Accepted'],
    'a lone - underlines': ['## Status\nAccepted\n-\n', 'Accepted'],
    'a lone - alone is an empty item': ['## Status\n-\n', null],
    'a === alone is text, no heading': ['## Status\n===\n', null],
    'definitions, then a === line, then text': ['## Status\n[a]: /u\n===\nAccepted\n---\n', '=== Accepted'],
    'definitions alone are not a heading': ['## Status\n[a]: /u\n---\n', null],
    'CRLF': ['## Status\r\nAccepted\r\nfor now\r\n---\r\n', 'Accepted for now'],
    'a filled section': ['## Status\n\nAccepted\n\n---\n\n## Context\n', null],
    'a thematic break after a blank line': ['## Status\n\n---\n\nAccepted\n===\n', null],
    'a list item is not a heading': ['## Status\n- Accepted\n---\n', null],
    'a quote is not a heading': ['## Status\n> Accepted\n---\n', null],
    'an empty section before ## Context': ['## Status\n\n## Context\n', null],
    'an empty section at the end': ['## Status\n\n', null],
    'an empty section before an ATX heading': ['## Status\n### Sub\n', null],
    'a fence in the section': ['## Status\n```\nAccepted\n===\n```\n', null],
    'no Status section': ['# T\n\nAccepted\n===\n', null],
  }
  for (const [name, [text, expected]] of Object.entries(cases)) assert.equal(adrStatusHeading(`# T\n\n${text}`)?.heading ?? null, expected, name)
})

for (const underline of ['---', '===']) {
  test(`docs adr-get and docs adr-status say that Accepted reads as a heading under ${underline} and write what they wrote before (PMK-294)`, async () => {
    const root = repo()
    const text = `# 1. Use X\n\n## Status\nAccepted\n${underline}\n\n## Context\n\nSome text.\n`
    writeAdr(root, 'docs/adr/0001-use-x.md', text)
    const get = await adrGetFrom(root, '1')
    assert.equal(get.data.status, null)
    assert.equal(get.data.statusHeading, 'Accepted')
    assert.equal(get.data.notes.length, 1)
    assert.match(get.data.notes[0], /docs\/adr\/0001-use-x\.md: the Status section is empty because "Accepted" reads as a heading/)
    assert.match(get.data.notes[0], /remove the underline/)
    const gotText = await run(['docs', 'adr-get', '1'], { cwd: root, env: childEnv() })
    assert.match(gotText.stdout + gotText.stderr, /"Accepted" reads as a heading/)
    const dryText = await run(['docs', 'adr-status', '1', 'deprecated', '--dry-run'], { cwd: root, env: childEnv() })
    assert.match(dryText.stdout + dryText.stderr, /"Accepted" reads as a heading/)
    const dry = await adrStatus(root, '1', 'deprecated', '--dry-run')
    assert.equal(dry.data.statusHeading, 'Accepted')
    assert.match(dry.data.notes.join('\n'), /"Accepted" reads as a heading/)
    const result = await adrStatus(root, '1', 'deprecated')
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.data.statusHeading, 'Accepted')
    assert.match(result.data.notes.join('\n'), /"Accepted" reads as a heading/)
    assert.deepEqual(result.data.status, { before: null, after: 'Deprecated' })
    assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0001-use-x.md'), 'utf8'), `# 1. Use X\n\n## Status\n\nDeprecated\n\nAccepted\n${underline}\n\n## Context\n\nSome text.\n`)
  })
}

test('the heading note offers both ways out, and does not ask for a second status when another form holds one (PMK-294 review)', async () => {
  const section = '## Status\nAccepted\nfor now\n---\n\n## Context\n'
  const cases = {
    'no other status': [`# 1. Use X\n\n${section}`, true],
    'a Status: line': [`# 1. Use X\n\nStatus: Old\n\n${section}`, false],
    'YAML front matter': [`---\nstatus: Old\n---\n\n# 1. Use X\n\n${section}`, false],
  }
  for (const [name, [text, empty]] of Object.entries(cases)) {
    const root = repo()
    writeAdr(root, 'docs/adr/0001-use-x.md', text.replaceAll('\n', name === 'no other status' ? '\r\n' : '\n'))
    const get = await adrGetFrom(root, '1')
    assert.equal(get.data.statusHeading, 'Accepted for now', name)
    const [note] = get.data.notes.filter((item) => item.includes('reads as a heading'))
    assert.match(note, /because "Accepted for now" reads as a heading/, name)
    if (empty) {
      assert.match(note, /remove the underline/, name)
      assert.match(note, /blank line before the underline/, name)
      assert.doesNotMatch(note, /the first line/, name)
    } else {
      assert.doesNotMatch(note, /remove the underline|so "Accepted for now" is the status/, name)
      assert.match(note, /another form/, name)
    }
    const set = await adrStatus(root, '1', 'deprecated', '--dry-run')
    const [setNote] = set.data.notes.filter((item) => item.includes('reads as a heading'))
    assert.doesNotMatch(setNote, /remove the underline|blank line before/, name)
    assert.match(setNote, /would stay below the status this would write, "[^"]*Deprecated"/, name)
  }
})

for (const underline of ['---', '===']) {
  for (const [form, head] of [['no other status', ''], ['a Status: line', 'Status: Old\n\n'], ['a status: key', '---\nstatus: Old\n---\n\n']]) {
    test(`docs adr-status says the ${underline} heading stays below the status it writes, with ${form} (PMK-300)`, async () => {
      const root = repo()
      writeAdr(root, 'docs/adr/0001-use-x.md', `${head}# 1. Use X\n\n## Status\nAccepted\n${underline}\n\n## Context\n`)
      const get = (await adrGetFrom(root, '1')).data.notes.join('\n')
      const dry = (await adrStatus(root, '1', 'deprecated', '--dry-run')).data.notes.filter((n) => n.includes('"Accepted"'))
      assert.equal(dry.length, 1)
      assert.match(dry[0], new RegExp(`^docs/adr/0001-use-x\\.md: "Accepted" reads as a heading \\(an underline, ${underline}, follows it\\) and would stay below the status this would write, "[^"]*Deprecated"; docs adr-status does not remove it, so delete "Accepted" and its ${underline} line yourself if it is not part of the status$`))
      const real = (await adrStatus(root, '1', 'deprecated')).data.notes.filter((n) => n.includes('"Accepted"'))
      assert.equal(real.length, 1)
      assert.match(real[0], new RegExp(`"Accepted" reads as a heading \\(an underline, ${underline}, follows it\\) and stays below the status written here, "[^"]*Deprecated"; `))
      assert.doesNotMatch(real[0], /would|before the write|not a second status|remove the underline/)
      assert.match(get, /remove the underline|not a second status/, 'adr-get keeps its note')
      assert.doesNotMatch(get, /stays below/)
    })
  }
}

test('docs adr-status run again on the ADR it wrote says nothing about the heading below the status (PMK-300)', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0001-use-x.md', '# 1. Use X\n\n## Status\nAccepted\n---\n\n## Context\n')
  await adrStatus(root, '1', 'deprecated')
  const again = await adrStatus(root, '1', 'deprecated')
  assert.equal(again.data.before, again.data.after)
  assert.deepEqual([again.data.statusHeading, again.data.notes.filter((n) => n.includes('heading'))], [null, []])
})

test('the heading note shows the real underline and heading in its example (PMK-294 review)', async () => {
  const cases = { '---': 'Accepted for now ---', '=====': 'Accepted for now =====', '===': '=== Accepted ===' }
  for (const [underline, example] of Object.entries(cases)) {
    const root = repo()
    const body = example.startsWith('===') ? `===\nAccepted\n${underline}` : `Accepted\nfor now\n${underline}`
    writeAdr(root, 'docs/adr/0001-use-x.md', `# 1. Use X\n\n## Status\n${body}\n\n## Context\n`)
    const note = (await adrGetFrom(root, '1')).data.notes.join('\n')
    assert.ok(note.includes(`("${example}")`), `${underline}: ${note}`)
    assert.ok(!note.includes('""'), underline)
    const heading = example.startsWith('===') ? '=== Accepted' : 'Accepted for now'
    const setNote = (await adrStatus(root, '1', 'deprecated', '--dry-run')).data.notes.join('\n')
    assert.ok(setNote.includes(`"${heading}" reads as a heading (an underline, ${underline}, follows it)`) && setNote.includes(`delete "${heading}" and its ${underline} line`), `${underline}: ${setNote}`)
  }
  const root = repo()
  writeAdr(root, 'docs/adr/0001-use-x.md', '# 1. Use X\n\n## Status\n===\n\n## Context\n')
  assert.deepEqual([(await adrGetFrom(root, '1')).data.statusHeading, (await adrGetFrom(root, '1')).data.notes], [null, []])
})

test('docs adr-get and docs adr-status give no heading note for an ADR with a status (PMK-294)', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0001-use-x.md', '# 1. Use X\n\n## Status\n\nAccepted\n\n## Context\n')
  const get = await adrGetFrom(root, '1')
  assert.deepEqual([get.data.statusHeading, get.data.notes], [null, []])
  const set = await adrStatus(root, '1', 'deprecated')
  assert.deepEqual([set.data.statusHeading, set.data.notes.filter((n) => n.includes('heading'))], [null, []])
})

const headings = {
  'one space': ' ## Status',
  'three spaces': '   ## Status',
  'tab after ##': '##\tStatus',
  closed: '## Status ##',
  'closed with five': '## Status #####',
  'closed, trailing blank': '## Status ## ',
  'closed with a tab': '## Status\t##',
  'indented and closed': '  ## Status ##',
  'upper case': '## STATUS ##',
}

test('an indented or closed ## Status heading is found, and adr-status keeps it as written (PMK-282)', () => {
  for (const [name, heading] of Object.entries(headings)) {
    const text = `# T\n\n${heading}\n\nAccepted\n\n## Context\n\nWhy.\n`
    assert.deepEqual(adrInfo(text), { title: 'T', status: 'Accepted', statuses: ['Accepted'] }, name)
    assert.deepEqual(setAdrStatus(text, 'deprecated'), { text: text.replace('\nAccepted\n', '\nDeprecated\n'), before: 'Accepted', after: 'Deprecated' }, name)
    assert.equal(setAdrStatus(text, 'accepted').text, text, name)
    // With a front matter key too: both change, the heading stays.
    const both = `---\nstatus: accepted\n---\n\n# T\n\n${heading}\n\nAccepted\n`
    assert.equal(setAdrStatus(both, 'deprecated').text, `---\nstatus: deprecated\n---\n\n# T\n\n${heading}\n\nDeprecated\n`, name)
  }
  // No second Status line is added above the title text.
  assert.doesNotMatch(setAdrStatus('# T\n\n ## Status\n\nAccepted\n', 'deprecated').text, /^Status:/m)
})

test('a line that is not a Status heading is not the Status section (PMK-282)', () => {
  const not = {
    'no space before the #': '## Status#',
    'four spaces': '    ## Status',
    'level 3': '### Status',
    'level 1': '# Status',
    'word after': '## Status ## x',
    'more words': '## Status quo',
    'setext (PMK-283)': 'Status\n------',
  }
  for (const [name, heading] of Object.entries(not)) {
    const text = `# T\n\n${heading}\n\nAccepted\n`
    assert.equal(adrInfo(text).status, null, name)
    assert.match(setAdrStatus(text, 'deprecated').text, /^Status: deprecated$/m, name)
  }
  const fenced = '# T\n\n```md\n## Status ##\n\nAccepted\n```\n'
  assert.equal(adrInfo(fenced).status, null)
  assert.equal(adrInfo('# T\n\n```md\n ## Status\n\nAccepted\n```\n').status, null)
})

test('the title drops a closing # sequence as the Status heading does (PMK-293)', () => {
  const titles = {
    '# 5. Use X #': '5. Use X',
    '# 5. Use X ###': '5. Use X',
    '# 5. Use X # #': '5. Use X #',
    '# 5. Use X\t#': '5. Use X',
    '   # 5. Use X #': '5. Use X',
    '#\t5. Use X #  ': '5. Use X',
    '# 5. Use X#': '5. Use X#',
    '# 5. Use X \\#': '5. Use X \\#',
    '# 5. Use X #y': '5. Use X #y',
    '# #': '',
    '#': '',
  }
  for (const [heading, title] of Object.entries(titles)) assert.equal(adrInfo(`${heading}\n\n## Status\n\nAccepted\n`).title, title, heading)
})

test('docs adr-get shows a title with a closing # sequence without it (PMK-293)', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0005-use-x.md', '# 5. Use X #\n\n## Status\n\nAccepted\n')
  const result = await adrGetFrom(root, '5')
  assert.equal(result.code, 0)
  assert.equal(result.data.title, '5. Use X')
})

test('## Status # is the Status section; ## Status # # and ## Status \\# are not, as CommonMark reads them (PMK-293)', () => {
  const text = '# T\n\n## Status #\n\nAccepted\n\n## Context\n\nWhy.\n'
  assert.deepEqual(adrInfo(text), { title: 'T', status: 'Accepted', statuses: ['Accepted'] })
  assert.equal(setAdrStatus(text, 'deprecated').text, text.replace('\nAccepted\n', '\nDeprecated\n'))
  // Only the last run closes the heading, so `# #` leaves the text `Status #` (the criterion of PMK-293 said otherwise and was corrected).
  for (const heading of ['## Status # #', '## Status \\#']) {
    const other = `# T\n\n${heading}\n\nAccepted\n`
    assert.equal(adrInfo(other).status, null, heading)
    assert.match(setAdrStatus(other, 'deprecated').text, /^Status: deprecated$/m, heading)
  }
})

test('docs adr-get reads and docs adr-status rewrites an indented or closed ## Status heading in place (PMK-282)', async () => {
  const root = repo()
  let number = 1
  for (const [name, heading] of Object.entries(headings)) {
    const file = `docs/adr/${String(number).padStart(4, '0')}-use-s.md`
    const text = `# ${number}. Use S\n\n${heading}\n\nAccepted\n\n## Context\n\nWhy.\n`
    writeAdr(root, file, text)
    const get = await adrGetFrom(root, String(number))
    assert.equal(get.code, 0, name)
    assert.equal(get.data.status, 'Accepted', name)
    const dry = await adrStatus(root, String(number), 'deprecated', '--dry-run')
    assert.equal(dry.code, 0, name)
    assert.equal(dry.data.after, text.replace('\nAccepted\n', '\nDeprecated\n'), name)
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), text, name)
    const real = await adrStatus(root, String(number), 'deprecated')
    assert.equal(real.code, 0, name)
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), text.replace('\nAccepted\n', '\nDeprecated\n'), name)
    assert.equal((await adrGetFrom(root, String(number))).data.status, 'Deprecated', name)
    number++
  }
})

test('a list item, a quote or a thematic break above ---, === interrupts the paragraph, so the status is kept (PMK-273 review)', async () => {
  const cases = {
    'list item then ---': ['Accepted\n- a\n---\n', 'Accepted - a ---'],
    'quote then ===': ['Accepted\n> n\n===\n', 'Accepted > n ==='],
    'thematic break, then a setext heading': ['Accepted\n***\nNotes\n---\nmore\n', 'Accepted ***'],
  }
  const root = repo()
  let number = 6
  for (const [name, [tail, status]] of Object.entries(cases)) {
    const text = `# ${number}. Use Z\n\n## Status\n\n${tail}\n## Context\n\nWhy.\n`
    assert.equal(adrSectionText(text), status, name)
    const written = setAdrStatus(text, 'deprecated').text
    assert.equal(written.match(/^Deprecated$/gm)?.length, 1, name)
    assert.doesNotMatch(written, /Accepted/, name)
    // The same ADR through the CLI: adr-get reads the status, adr-status writes one.
    const file = `docs/adr/000${number}-use-z.md`
    writeAdr(root, file, text)
    assert.equal((await adrGetFrom(root, String(number))).data.status, adrInfo(text).status, name)
    await statusWrites(root, String(number), file, text, written, name, status)
    number++
  }
})

test('a list item continuation above --- keeps the Status section open, in adr-get and adr-status alike (PMK-280)', async () => {
  const cases = {
    'issue text': ['Accepted\n\n- a\n\n  b\n---\n', 'Accepted - a b ---'],
    'ordered item': ['Accepted\n\n1. a\n\n   b\n---\n', 'Accepted 1. a b ---'],
    'two-line continuation': ['Accepted\n\n- a\n\n  b\n  c\n---\n', 'Accepted - a b c ---'],
    'continuation then ===': ['Accepted\n\n- a\n\n  b\n===\n', 'Accepted - a b ==='],
  }
  const root = repo()
  let number = 5
  for (const [name, [tail, status]] of Object.entries(cases)) {
    const text = `# ${number}. Use W\n\n## Status\n\n${tail}\n## Context\n\nWhy.\n`
    assert.equal(adrSectionText(text), status, name)
    const written = setAdrStatus(text, 'deprecated').text
    assert.equal(written, text.replace('Accepted', 'Deprecated'), name)
    const file = `docs/adr/000${number}-use-w.md`
    writeAdr(root, file, text)
    assert.equal((await adrGetFrom(root, String(number))).data.status, adrInfo(text).status, name)
    await statusWrites(root, String(number), file, text, written, name, status)
    number++
  }
  // A line indented less than the item content is not a continuation: it is the setext paragraph, so the section ends at it.
  assert.equal(adrSectionText('# T\n\n## Status\n\nAccepted\n\n- a\n\n b\n---\n'), 'Accepted - a')
  // A paragraph at no indent after a list is a setext paragraph too.
  assert.equal(adrSectionText('# T\n\n## Status\n\nAccepted\n\n- a\n\nb\n---\n'), 'Accepted - a')
})

test('only a line that CommonMark lets interrupt a paragraph does, so 2. foo, an empty item and a tab line are part of it (PMK-281)', async () => {
  const cases = {
    'ordered item not at 1': ['Accepted\n2. foo\n===\n', null],
    'empty * item': ['Accepted\n*\n===\n', null],
    'empty ordered item': ['Accepted\n1.\n===\n', null],
    // A lone `-` is the underline of `Accepted` (a setext H2), so it ends the section there whatever the interrupt rule says.
    'lone - underlines Accepted': ['Accepted\n-\nfoo\n===\n', null],
    // An empty item holds no line that is not indented into it, so `foo` is a paragraph and `===` underlines it (PMK-291).
    'empty - after a blank line, then ===': ['Accepted\n\n-\nfoo\n===\n', 'Accepted -'],
    'tab line inside the paragraph': ['Accepted\n\tcode\nmore\n===\n', null],
    'tab code, then a paragraph': ['Accepted\n\n\tcode\nmore\n===\n', 'Accepted code'],
    'space and tab are four columns': ['Accepted\n\n \tcode\nmore\n---\n', 'Accepted code'],
    'item at 1 interrupts': ['Accepted\n1. foo\n===\n', 'Accepted 1. foo ==='],
    '2. foo after a blank line starts a list': ['Accepted\n\n2. foo\n===\n', 'Accepted 2. foo ==='],
    'empty item after a blank line starts a list': ['Accepted\n\n-\n===\n', 'Accepted - ==='],
    'tab code and no paragraph': ['Accepted\n\n\tcode\n===\n', 'Accepted code ==='],
    'a thematic break is not a list item': ['Accepted\n\n- - -\n\n  b\n---\n', 'Accepted - - -'],
  }
  const root = repo()
  let number = 1
  for (const [name, [tail, status]] of Object.entries(cases)) {
    const text = `# ${number}. Use V\n\n## Status\n\n${tail}\n## Context\n\nWhy.\n`
    assert.equal(adrSectionText(text), status, name)
    const written = setAdrStatus(text, 'deprecated').text
    assert.match(written, /\n## Status\n\nDeprecated\n/, name)
    assert.ok(written.endsWith('\n## Context\n\nWhy.\n'), name)
    const file = `docs/adr/${String(number).padStart(4, "0")}-use-v.md`
    writeAdr(root, file, text)
    assert.equal((await adrGetFrom(root, String(number))).data.status, adrInfo(text).status, name)
    await statusWrites(root, String(number), file, text, written, name, status)
    number++
  }
})

test('a list item continuation of four columns or a tab is not indented code, so the Status section stays open (PMK-281 review)', async () => {
  const cases = {
    'four spaces': 'Accepted\n- a\n\n    b\nc\n---\n',
    tab: 'Accepted\n- a\n\n\tb\nc\n---\n',
    // With five or more columns after the marker the content starts one column after it (width 2), so four columns still continue the item.
    'five spaces after the marker': 'Accepted\n-     a\n\n    b\nc\n---\n',
    'tab after the marker': 'Accepted\n-\ta\n\n    b\nc\n---\n',
    'ordered, five spaces': 'Accepted\n1.     a\n\n    b\nc\n---\n',
  }
  const root = repo()
  let number = 1
  for (const [name, tail] of Object.entries(cases)) {
    const text = `# ${number}. Use U\n\n## Status\n\n${tail}\n## Context\n\nWhy.\n`
    const status = tail.split('\n').filter((item) => item.trim() !== '').map((item) => item.trim()).join(' ')
    assert.equal(adrSectionText(text), status, name)
    const written = setAdrStatus(text, 'deprecated').text
    assert.equal(written, text.replace('Accepted', 'Deprecated'), name)
    const file = `docs/adr/000${number}-use-u.md`
    writeAdr(root, file, text)
    assert.equal((await adrGetFrom(root, String(number))).data.status, adrInfo(text).status, name)
    await statusWrites(root, String(number), file, text, written, name, status)
    number++
  }
  // Outside a list item the same lines are indented code, then a paragraph.
  assert.equal(adrSectionText('# T\n\n## Status\n\nAccepted\n\n    b\nc\n---\n'), 'Accepted b')
})

test('an indented ## heading is the first section, found by the same test as the end of the Status section (PMK-273 review)', () => {
  // A Status line below an indented `## Context` is not above the first section, so it is not the ADR's status.
  assert.equal(adrInfo('# T\n\n ## Context\n\nStatus: Accepted\n').status, null)
  assert.equal(adrInfo('# T\n\n## Context\n\nStatus: Accepted\n').status, null)
  assert.equal(adrInfo('# T\n\nStatus: Accepted\n\n   ## Context\n').status, 'Accepted')
  // An indented `# ` heading is the title.
  assert.equal(adrInfo('  # T\n\n## Status\n\nAccepted\n').title, 'T')
})

const adrGetFrom = async (root, ...args) => {
  const result = await run(['docs', 'adr-get', ...args, '--json'], { cwd: root, env: childEnv() })
  return { code: result.code, data: result.stdout ? JSON.parse(result.stdout) : null }
}

test('adrRef is the name relative to the holder when both ADRs are in a tracker outside the repository, the ref otherwise (PMK-270)', () => {
  const holder = { place: 'tracker', file: '/o/docs/adr/0003-x.md', ref: '../o/docs/adr/0003-x.md' }
  const target = { place: 'tracker', file: '/o/docs/adr/0001-a.md', ref: '../o/docs/adr/0001-a.md' }
  assert.equal(adrRef(holder, target, null), '0001-a.md')
  assert.equal(adrRef(holder, target, '.issues/docs/adr'), target.ref)
  assert.equal(adrRef({ ...holder, place: 'repo' }, target, null), target.ref)
  assert.equal(adrRef(holder, { ...target, place: 'repo' }, null), target.ref)
})

test('docs adr-get --from gives a Supersedes ref relative to the new ADR, the same base adr-status --by writes (PMK-270)', async () => {
  await withOutsideTracker(false, async ({ root, outside }) => {
    const { data, code } = await adrGetFrom(root, '1', '--from', 'tracker:docs/adr/0003-x.md')
    assert.equal(code, 0)
    assert.equal(data.supersedesRef, '0001-a.md')
    assert.equal(data.ref, `../${path.basename(outside)}/docs/adr/0001-a.md`, 'ref keeps the path from the repository root')
    // The new ADR is written and the old one marked: both lines resolve to the old and the new ADR from the folder that holds them.
    writeAdr(outside, 'docs/adr/0003-x.md', `# X\n\nSupersedes: ADR 0001, ${data.supersedesRef}\n`)
    await adrStatus(root, '1', 'superseded', '--by', '3')
    const dir = path.join(outside, 'docs/adr')
    const [, supersedes] = /^Supersedes: ADR 0001, (.+)$/m.exec(fs.readFileSync(path.join(dir, '0003-x.md'), 'utf8'))
    const [, by] = /^Status: superseded by (.+)$/m.exec(fs.readFileSync(path.join(dir, '0001-a.md'), 'utf8'))
    assert.equal(path.resolve(dir, supersedes), path.join(dir, '0001-a.md'))
    assert.equal(path.resolve(dir, by), path.join(dir, '0003-x.md'))
    // A new ADR in the repository keeps the path from the repository root.
    assert.equal((await adrGetFrom(root, '1', '--from', 'docs/adr/0003-x.md')).data.supersedesRef, data.ref)
  })
})

test('docs adr-get --from keeps ref for repository ADRs and a tracker inside the repository, and is null without it (PMK-270)', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0001-a.md')
  writeAdr(root, '.issues/docs/adr/0002-b.md')
  const repoOne = await adrGetFrom(root, '1', '--from', 'docs/adr/0003-x.md')
  assert.deepEqual([repoOne.data.supersedesRef, repoOne.data.ref], ['docs/adr/0001-a.md', 'docs/adr/0001-a.md'])
  const inside = await adrGetFrom(root, '2', '--from', '.issues/docs/adr/0003-x.md')
  assert.deepEqual([inside.data.supersedesRef, inside.data.ref], ['.issues/docs/adr/0002-b.md', '.issues/docs/adr/0002-b.md'])
  assert.equal((await adrGetFrom(root, '1')).data.supersedesRef, null)
  for (const bad of ['nowhere/0003-x.md', 'docs/adr/notes.md']) {
    const result = await adrGetFrom(root, '1', '--from', bad)
    assert.equal(result.code, 2, bad)
    assert.equal(result.data.error.code, 'INVALID_INPUT', bad)
  }
  assert.equal((await adrGetFrom(root, '9', '--from', 'docs/adr/0003-x.md')).data.error.code, 'NOT_FOUND')
})

test('docs adr-get --from of a repository ADR that replaces a tracker ADR outside the repository gives supersedesRef equal to ref (PMK-276)', async () => {
  await withOutsideTracker(false, async ({ root, outside }) => {
    writeAdr(root, 'docs/adr/0003-x.md')
    const { code, data } = await adrGetFrom(root, '1', '--from', 'docs/adr/0003-x.md')
    assert.equal(code, 0)
    assert.equal(data.ref, `../${path.basename(outside)}/docs/adr/0001-a.md`)
    assert.equal(data.supersedesRef, data.ref)
  })
})

test('docs adr-get --from with no path is refused as INVALID_INPUT, saying it needs a path, with a next step (PMK-275)', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0001-a.md')
  for (const args of [['--from'], ['--from='], ['--from', '']]) {
    const result = await adrGetFrom(root, '1', ...args)
    assert.equal(result.code, 2, args.join(' '))
    assert.equal(result.data.error.code, 'INVALID_INPUT', args.join(' '))
    assert.match(result.data.error.message, /--from needs a path/, args.join(' '))
    assert.match(result.data.error.nextStep, /--from docs\/adr\/0003-x\.md/, args.join(' '))
  }
})

test('docs adr-get --from gives the same supersedesRef for every spelling of the path, in the repository and a tracker (PMK-275)', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0001-a.md')
  const plain = await adrGetFrom(root, '1', '--from', 'docs/adr/0003-x.md')
  for (const spelling of ['./docs/adr/0003-x.md', 'docs//adr/0003-x.md', 'docs\\adr\\0003-x.md']) {
    const result = await adrGetFrom(root, '1', '--from', spelling)
    assert.equal(result.code, 0, spelling)
    assert.equal(result.data.supersedesRef, plain.data.supersedesRef, spelling)
  }
  await withOutsideTracker(false, async ({ root: outsideRoot }) => {
    const plainTracker = await adrGetFrom(outsideRoot, '1', '--from', 'tracker:docs/adr/0003-x.md')
    assert.equal(plainTracker.code, 0)
    for (const spelling of ['tracker:./docs/adr/0003-x.md', 'tracker:docs//adr/0003-x.md']) {
      const result = await adrGetFrom(outsideRoot, '1', '--from', spelling)
      assert.equal(result.code, 0, spelling)
      assert.equal(result.data.supersedesRef, plainTracker.data.supersedesRef, spelling)
    }
  })
})

test('docs adr-get --from normalises `..` inside the folder and refuses a path that climbs out of it (PMK-275)', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0001-a.md')
  const plain = await adrGetFrom(root, '1', '--from', 'docs/adr/0003-x.md')
  const inside = await adrGetFrom(root, '1', '--from', 'docs/adr/../adr/0003-x.md')
  assert.equal(inside.code, 0)
  assert.equal(inside.data.supersedesRef, plain.data.supersedesRef)
  const climbs = await adrGetFrom(root, '1', '--from', '../docs/adr/0003-x.md')
  assert.equal(climbs.code, 2)
  assert.equal(climbs.data.error.code, 'INVALID_INPUT')
})

test('the item that holds the line decides: a wider sibling, a fence at column 0 and a lazy line before the continuation (PMK-291)', async () => {
  const cases = {
    // `1. a` closes `- x` and `b` is outside it (content at column 3): `b` is a heading line, `---` underlines it.
    'wider sibling': ['- x\n\n1. a\n\n  b\n---\n', '- x 1. a'],
    // The fence at column 0 ends the list: `b` is a paragraph.
    'fence at column 0': ['- a\n\n```\nz\n```\n  b\n---\n', '- a ``` z ```'],
    // `lazy` belongs to `- a`, so `b` is inside the item and `---` is a thematic break.
    'lazy continuation': ['- a\nlazy\n\n  b\n---\n', '- a lazy b ---'],
  }
  const root = repo()
  let number = 1
  for (const [name, [tail, status]] of Object.entries(cases)) {
    const text = `# ${number}. Use U\n\n## Status\n\n${tail}\n## Context\n\nWhy.\n`
    assert.equal(adrSectionText(text), status, name)
    const file = `docs/adr/000${number}-use-u.md`
    writeAdr(root, file, text)
    assert.equal((await adrGetFrom(root, String(number))).data.status, adrInfo(text).status, name)
    const written = setAdrStatus(text, 'deprecated').text
    assert.equal(adrInfo(written).status, 'Deprecated', name)
    await statusWrites(root, String(number), file, text, written, name, status)
    number++
  }
})

test('an empty item and an item that opens with indented code are not paragraphs for the lazy walk (PMK-291 review)', async () => {
  const cases = {
    'empty item after an item': ['- a\n-\n\n  x\n---\n', '- a -'],
    'five spaces, lazy line': ['-     a\nlazy\n\n  x\n---\n', '-     a lazy'],
    'five spaces, other text': ['-     a\nz\n\n  x\n---\n', '-     a z'],
    'five spaces, empty item': ['-     a\n-\n\n  x\n---\n', '-     a -'],
  }
  const root = repo()
  let number = 1
  for (const [name, [tail, status]] of Object.entries(cases)) {
    const text = `# ${number}. Use U\n\n## Status\n\n${tail}\n## Context\n\nWhy.\n`
    assert.equal(adrSectionText(text), status, name)
    if (number === 1) {
      const file = 'docs/adr/0001-use-u.md'
      writeAdr(root, file, text)
      assert.equal((await adrGetFrom(root, '1')).data.status, adrInfo(text).status, name)
      const written = setAdrStatus(text, 'deprecated').text
      await statusWrites(root, '1', file, text, written, name, status)
    }
    number++
  }
})

test('indented code inside a list item is not the item continuing, so a lazy line before the underline stays the heading (PMK-291 cycle 2)', async () => {
  const cases = {
    'code after a lazy line': ['- a\nlazy\n\n\n      x\nlazy\n---\n', '- a lazy x'],
    'code, no lazy line before': ['- a\n\n      x\nlazy\n---\n', '- a x'],
    'five spaces marker, code': ['-     a\n\n\n          x\nlazy\n---\n', '-     a x'],
    'empty item, code': ['- a\n-\n\n      x\nlazy\n---\n', '- a - x'],
  }
  const root = repo()
  let number = 1
  for (const [name, [tail, status]] of Object.entries(cases)) {
    const text = `# ${number}. Use U\n\n## Status\n\n${tail}\n## Context\n\nWhy.\n`
    assert.equal(adrSectionText(text), status, name)
    if (number === 1) {
      const file = 'docs/adr/0001-use-u.md'
      writeAdr(root, file, text)
      assert.equal((await adrGetFrom(root, '1')).data.status, adrInfo(text).status, name)
      const written = setAdrStatus(text, 'deprecated').text
      await statusWrites(root, '1', file, text, written, name, status)
    }
    number++
  }
})

test('a line belongs to the deepest open item whose content column it reaches, as CommonMark nests items, quotes and fences (PMK-291 cycle 3)', async () => {
  const cases = {
    // `- m` sits inside `- a` (content at column 2), `c` inside `- m` (content at column 6): `lazy` continues `c` and `---` is a break.
    'nested item four columns in': ['- a\n    - m\n\n      c\nlazy\n---\n', '- a - m c lazy ---'],
    'nested ordered items, lazy line': ['\n -\n      1) b\n\n      3)      b\na\n---\n', '- 1) b 3)      b'],
    'empty ordered item after a blank': ['\n   1. x\nlazy\n\n        3) \na\n  \tlazy\n   ===\n', '1. x lazy 3)'],
    'item opening with code inside a wide item': ['2.    lazy\n      a\n     b\nx\n\n        1.      a\nc d\n  + \n--\n', '2.    lazy a b x 1.      a'],
    // The fence at column 0 opens right after the one inside the item closes, so it ends the list and `b` is a paragraph.
    'fence right after a fence': ['- a\n\n  ```\n  z\n  ```\n```\ny\n```\n  b\n---\n', '- a ``` z ``` ``` y ```'],
    'code under an item, then a line': ['- a\n\n      code\nmore\n---\n', '- a code'],
    'empty item opening with code': ['-\n      code\n\n  x\n---\n', '- code x ---'],
    // `lazy` continues the quote inside the item, so the item stays open and holds `b`.
    'quote inside an item, lazy line': ['- a\n  > q\nlazy\n\n  b\n---\n', '- a > q lazy b ---'],
    'quote after a blank, lazy line': ['- a\n\n  > q\nlazy\n\n  c\n---\n', '- a > q lazy c ---'],
    // A heading inside an item is not a section heading.
    'heading inside an item': ['- a\n  ## b\n\n  c\n---\n', '- a ## b c ---'],
  }
  const root = repo()
  let number = 1
  for (const [name, [tail, status]] of Object.entries(cases)) {
    const text = `# ${number}. Use U\n\n## Status\n\n${tail}\n## Context\n\nWhy.\n`
    assert.equal(adrSectionText(text), status, name)
    if (number === 1) {
      const file = 'docs/adr/0001-use-u.md'
      writeAdr(root, file, text)
      assert.equal((await adrGetFrom(root, '1')).data.status, adrInfo(text).status, name)
      const written = setAdrStatus(text, 'deprecated').text
      assert.equal(adrInfo(written).status, 'Deprecated', name)
      await statusWrites(root, '1', file, text, written, name, status)
    }
    number++
  }
})

test('an HTML block and a paragraph of link reference definitions end the Status section where CommonMark does (PMK-291 cycle 4 review)', async () => {
  const cases = {
    // After an empty item, the comment is an HTML block, not a paragraph, so `---` is a thematic break.
    'comment after an empty item': ['-\n<!-- x -->\n---\n', '- <!-- x --> ---'],
    // A paragraph of link reference definitions only is not a setext heading.
    'definition after an empty item': ['-\n[a]: /u\n---\n', '- [a]: /u ---'],
    'comment after an empty * item': ['* \n<!-- x -->\n ---\n', '* <!-- x --> ---'],
    'definition with a title after a quoted heading': ['> ###\n[a]: /u "t"\n ---\n', '> ### [a]: /u "t" ---'],
    'definition after an item opening a fence': ['1. ```\n[a]: /u\n-\n', '1. ``` [a]: /u -'],
    'closing tag after an empty item': ['-\n</div>\n---\n', '- </div> ---'],
    // `<pre>` runs to `</pre>`: the fence and the underline inside it are HTML.
    'pre block holds a fence': ['<pre>\n\t~~~\n-\n</pre>\n', '<pre> ~~~ - </pre>'],
    'definition then ===': ['Accepted\n\n[a]: /u\n===\n', 'Accepted [a]: /u ==='],
    // A definition before text: the text is the heading, and the heading starts at the definition.
    'definition then text': ['Accepted\n\n[a]: /u\nfoo\n---\n', 'Accepted'],
    // `<div>` (type 6) interrupts a paragraph; a custom tag (type 7) does not.
    'div interrupts a paragraph': ['Accepted\n<div>\nb\n---\n', 'Accepted <div> b ---'],
    'custom tag does not': ['Accepted\n<x-y>\n---\n', null],
    'fence inside a comment': ['<!--\n```\n-->\nAccepted\n', '<!-- ``` --> Accepted'],
    'comment across a blank line': ['Accepted\n\n<!-- a\n\n---\n-->\nb\n---\n', 'Accepted <!-- a --- -->'],
  }
  const root = repo()
  let number = 1
  for (const [name, [tail, status]] of Object.entries(cases)) {
    const text = `# ${number}. Use U\n\n## Status\n\n${tail}\n## Context\n\nWhy.\n`
    assert.equal(adrSectionText(text), status, name)
    if (number === 1) {
      const file = 'docs/adr/0001-use-u.md'
      writeAdr(root, file, text)
      assert.equal((await adrGetFrom(root, '1')).data.status, adrInfo(text).status, name)
      const written = setAdrStatus(text, 'deprecated').text
      assert.equal(adrInfo(written).status, 'Deprecated', name)
      await statusWrites(root, '1', file, text, written, name, status)
    }
    number++
  }
})

// Review of PR #241, cycle 5: an unclosed link title of escapes once made the title pattern backtrack twice per escape. Every
// pattern of the link reference definition and of the HTML block reads a long line of its own kind in well under the ceiling of
// assert-fast.mjs (PMK-307).
test('probe: no link reference definition or HTML block pattern takes ten seconds on a long line of its own kind (PMK-291 cycle 5 review)', async () => {
  const n = 20000
  const bodies = [
    `[a]: /u "${'\\!'.repeat(n)}`, `[a]: /u '${'\\!'.repeat(n)}`, `[a]: /u (${'\\!'.repeat(n)}`, `[a]: /u "${'\\!'.repeat(n)}"x`,
    `[${'\\['.repeat(n)}`, `[a${'\\]'.repeat(n)}: /u`, `[a]: ${'('.repeat(n)}`, `[a]: ${'\\('.repeat(n)}(`, `[a]: <${'\\<'.repeat(n)}`,
    '[a]: /u "t"\n'.repeat(n / 5), `[a]: /u\n"${'\\!'.repeat(n)}`, `<x-y${' a=1'.repeat(n)}`, `<x-y${' a="b'.repeat(n)}`,
  ]
  await assertFast('probe-targets.mjs#adrInfoBody', bodies)
})

test('an empty item followed by a line and a === or --- underline ends the Status section at that line, in adr-get and adr-status alike (PMK-292)', async () => {
  const cases = {
    'empty - then ---': ['Accepted\n\n-\nfoo\n---\n', 'Accepted -'],
    'empty * then ===': ['Accepted\n\n*\nfoo\n===\n', 'Accepted *'],
    'empty * then ---': ['Accepted\n\n*\nfoo\n---\n', 'Accepted *'],
    'empty 1. then ===': ['Accepted\n\n1.\nfoo\n===\n', 'Accepted 1.'],
    'empty 1. then ---': ['Accepted\n\n1.\nfoo\n---\n', 'Accepted 1.'],
  }
  const root = repo()
  let number = 20
  for (const [name, [tail, status]] of Object.entries(cases)) {
    const text = `# ${number}. Use E\n\n## Status\n\n${tail}\n## Context\n\nWhy.\n`
    assert.equal(adrSectionText(text), status, name)
    const written = setAdrStatus(text, 'deprecated').text
    assert.match(written, /\n## Status\n\nDeprecated\n/, name)
    assert.ok(written.endsWith('\n## Context\n\nWhy.\n'), name)
    const file = `docs/adr/${String(number).padStart(4, '0')}-use-e.md`
    writeAdr(root, file, text)
    assert.equal((await adrGetFrom(root, String(number))).data.status, adrInfo(text).status, name)
    await statusWrites(root, String(number), file, text, written, name, status)
    number++
  }
})

test('a 10-digit ordered marker is paragraph text, so an underline ends the Status section at it, in adr-get and adr-status alike (PMK-292)', async () => {
  const cases = {
    'blank line, then --- underline': ['Accepted\n\n1234567890. a\nb\n---\n', 'Accepted'],
    'blank line, then === underline': ['Accepted\n\n1234567890. a\nb\n===\n', 'Accepted'],
    // Glued to the status text, the underline takes the text with it, as a setext heading does (PMK-273).
    'glued to the status, then ---': ['Accepted\n1234567890. a\nb\n---\n', null],
  }
  const root = repo()
  let number = 30
  for (const [name, [tail, status]] of Object.entries(cases)) {
    const text = `# ${number}. Use T\n\n## Status\n\n${tail}\n## Context\n\nWhy.\n`
    assert.equal(adrInfo(text).status, status, name)
    const written = setAdrStatus(text, 'deprecated').text
    assert.ok(written.endsWith('\n## Context\n\nWhy.\n'), name)
    const file = `docs/adr/${String(number).padStart(4, '0')}-use-t.md`
    writeAdr(root, file, text)
    assert.equal((await adrGetFrom(root, String(number))).data.status, adrInfo(text).status, name)
    await statusWrites(root, String(number), file, text, written, name, status)
    number++
  }
})

test('a 9-digit ordered marker is still a list item, so the Status section stays open past it, in adr-get and adr-status alike (PMK-292)', async () => {
  const text = '# 40. Use N\n\n## Status\n\nAccepted\n\n123456789. a\nb\n---\n\n## Context\n\nWhy.\n'
  assert.equal(adrSectionText(text), 'Accepted 123456789. a b ---')
  const root = repo()
  const file = 'docs/adr/0040-use-n.md'
  writeAdr(root, file, text)
  assert.equal((await adrGetFrom(root, '40')).data.status, 'Accepted')
  assert.equal((await adrStatus(root, '40', 'deprecated')).code, 0)
  assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), text.replace('Accepted', 'Deprecated'))
})

// PMK-306: the fixture says whether the Status section holds more than the status (its `status` is neither null nor just Accepted): then adr-status refuses and the file stays as it was, else it writes `written`.
async function statusWrites(root, number, file, text, written, name, status) {
  // PMK-311: refused when the section has more than the status and no top-level status line to replace.
  const refused = adrStatusDropped(text).length > 0
  assert.equal((await adrStatus(root, number, 'deprecated')).code, refused ? 2 : 0, name)
  assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), refused ? text : written, name)
}

// PMK-299: an HTML block that takes a heading or later text into the Status section is never deleted by adr-status.
const HELD = [
  ['an unclosed comment', '## Status\n\n<!-- note\nAccepted\n\n## Context\n\nWhy we did it.\n', '<!-- note', ['## Context', 'Why we did it.']],
  ['a div (kind 6)', '## Status\n\n<div>\n## Context\n\nWhy.\n', '<div>', ['## Context']],
  ['a custom tag (kind 7)', '## Status\n\n<custom-tag>\n## Context\n\nWhy.\n', '<custom-tag>', ['## Context']],
  ['an unclosed comment with plain text after a blank line', '## Status\n\n<!-- note\nAccepted\n\nWhy we did it.\n', '<!-- note', ['Why we did it.']],
  ['a setext heading in a div (kind 6)', '## Status\n\n<div>\nContext\n---\n\nWhy.\n', '<div>', ['Context']],
  ['a closed comment that holds a heading', '## Status\n\n<!--\n## Context\n-->\n\nAccepted\n', '<!--', ['## Context']],
]
const HELD_OK = [
  ['no Status section', '# T\n\n<!-- note\n## Context\n'],
]
for (const [name, text, opener, lines] of HELD) {
  test(`adrHtmlHeld, docs adr-status and docs adr-get name ${name} and refuse to delete what it holds (PMK-299)`, async () => {
    assert.deepEqual(adrHtmlHeld(text), { opener, lines })
    const root = repo()
    writeAdr(root, 'docs/adr/0001-a.md', text)
    const get = await adrGetFrom(root, '1')
    assert.equal(get.code, 0)
    assert.deepEqual(get.data.htmlHeld, { opener, lines })
    assert.ok(get.data.notes.join('\n').includes(`the HTML block "${opener}" takes ${lines.map((item) => `"${item}"`).join(', ')} into the Status section`))
    // The reading is as before.
    assert.equal(get.data.status, adrInfo(text).status)
    for (const flags of [['--dry-run'], []]) {
      const result = await adrStatus(root, '1', 'deprecated', ...flags)
      assert.equal(result.code, 2, flags.join(' '))
      assert.equal(result.data.error.code, 'INVALID_INPUT')
      assert.match(result.data.error.message, /would delete/)
      assert.match(result.data.error.nextStep, /close a comment with -->, or add a blank line after the HTML line/)
      assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), text)
    }
  })
}
for (const [name, text] of HELD_OK) {
  test(`adrHtmlHeld is null and docs adr-status writes as before for ${name} (PMK-299)`, async () => {
    assert.equal(adrHtmlHeld(text), null)
    const root = repo()
    writeAdr(root, 'docs/adr/0001-a.md', text)
    assert.equal((await adrGetFrom(root, '1')).data.htmlHeld, null)
    const result = await adrStatus(root, '1', 'deprecated')
    assert.equal(result.code, 0, result.stderr)
    if (text.includes('## Status')) assert.match(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), /## Status\n\nDeprecated\n/)
  })
}

// PMK-302: a code fence that is not closed takes a heading into the Status section; adr-status never deletes it.
const FENCE_HELD = [
  ['an unclosed ``` fence', '## Status\n\n```\nAccepted\n\n## Context\n\nWhy.\n', '```', ['## Context']],
  ['an unclosed ~~~ fence', '## Status\n\nAccepted\n\n~~~\n## Context\n\nWhy.\n', '~~~', ['## Context']],
  ['an unclosed fence with an info string', '## Status\n\n```js\nAccepted\n\n## Context\n\nWhy.\n', '```js', ['## Context']],
  ['a 4-backtick fence that 3 backticks do not close', '## Status\n\n````\nAccepted\n```\n## Context\n\nWhy.\n', '````', ['## Context']],
  ['a fence a loose fence line closes much later', '## Status\n\n```\nAccepted\n\n## Context\n\nWhy.\n\n```js\nx\n```\n\n## Cons\n', '```', ['## Context']],
  ['a fence in a list item that the container closes', '## Status\n\n- ```\n  Accepted\n  ## Context\n\nWhy.\n', '```', ['## Context']],
  ['a fence in a quote that the container closes', '## Status\n\n> ```\n> Accepted\n> ## Context\n\n## Next\n\nWhy.\n', '```', ['> ## Context']],
  ['a closed fence that holds a heading', '## Status\n\n```\n## x\n```\n\n## Context\n', '```', ['## x']],
  ['a setext heading in an unclosed fence', '## Status\n\n```\nAccepted\n\nContext\n---\n\nWhy.\n', '```', ['Context']],
  ['a setext heading (===) in a closed fence', '## Status\n\n~~~\nContext\n===\n~~~\n', '~~~', ['Context']],
  ['an unclosed fence with CRLF line ends', '## Status\r\n\r\n```\r\nAccepted\r\n\r\n## Context\r\n\r\nWhy.\r\n', '```', ['## Context']],
]
const FENCE_OK = [
]
for (const [name, text, opener, lines] of FENCE_HELD) {
  test(`adrFenceHeld, docs adr-status and docs adr-get name ${name} and refuse to delete what it holds (PMK-302)`, async () => {
    assert.deepEqual(adrFenceHeld(text), { opener, lines })
    assert.equal(adrHtmlHeld(text), null)
    const root = repo()
    writeAdr(root, 'docs/adr/0001-a.md', text)
    const get = await adrGetFrom(root, '1')
    assert.equal(get.code, 0)
    assert.deepEqual(get.data.fenceHeld, { opener, lines })
    assert.ok(get.data.notes.join('\n').includes(`the code fence "${opener}" takes ${lines.map((item) => `"${item}"`).join(', ')} into the Status section`))
    assert.equal(get.data.status, adrInfo(text).status)
    for (const flags of [['--dry-run'], []]) {
      const result = await adrStatus(root, '1', 'deprecated', ...flags)
      assert.equal(result.code, 2, flags.join(' '))
      assert.equal(result.data.error.code, 'INVALID_INPUT')
      assert.match(result.data.error.message, /would delete/)
      assert.match(result.data.error.message, /nothing was written/)
      assert.match(result.data.error.nextStep, /Close the code fence/)
      assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), text)
    }
  })
}
for (const [name, text] of FENCE_OK) {
  test(`adrFenceHeld is null and docs adr-status writes as before for ${name} (PMK-302)`, async () => {
    assert.equal(adrFenceHeld(text), null)
    const root = repo()
    writeAdr(root, 'docs/adr/0001-a.md', text)
    assert.equal((await adrGetFrom(root, '1')).data.fenceHeld, null)
    const result = await adrStatus(root, '1', 'deprecated')
    assert.equal(result.code, 0, result.stderr)
    assert.match(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), /## Status\n\nDeprecated\n/)
  })
}

// PMK-311 (reverses PMK-306): adr-status replaces only the status line and keeps every other line of the Status section; adrStatusDropped is empty for these.
const OTHER = [
  ['a paragraph after the status', '## Status\n\nAccepted\n\nWhy this was chosen.\n'],
  ['a comment before the status', '## Status\n\n<!-- note -->\n\nAccepted\n\n## Context\n'],
  ['CRLF line ends', '## Status\r\n\r\nAccepted\r\n\r\nWhy this was chosen.\r\n'],
  ['a list item glued to the status', '## Status\n\nAccepted\n- Supersedes ADR 3\n\n## Context\n'],
  ['a quote glued to the status', '## Status\n\nAccepted\n> n\n\n## Context\n'],
  ['a comment glued to the status', '## Status\n\nAccepted\n<!-- x -->\n\n## Context\n'],
  ['a closed fence glued to the status', '## Status\n\nAccepted\n```\ncode\n```\n\n## Context\n'],
  ['a lazy line glued to the status', '## Status\n\nAccepted\nWhy.\n\n## Context\n'],
  ['a MADR date line (PMK-311)', '# T\n\n## Status\n\nAccepted\nDate: 2024-01-02\n\n## Context\n'],
  ['a Nygard Supersedes line (PMK-311)', '# T\n\n## Status\n\nAccepted\n\nSupersedes [ADR 3](0003-x.md)\n\n## Context\n'],
]
for (const [name, text] of OTHER) {
  test(`adr-status keeps ${name}, dry run writes nothing, real writes only the status (PMK-311)`, async () => {
    assert.deepEqual(adrStatusDropped(text), [])
    assert.equal(adrInfo(text).status, 'Accepted')
    const root = repo()
    writeAdr(root, 'docs/adr/0001-a.md', text)
    const dry = await adrStatus(root, '1', 'deprecated', '--dry-run')
    assert.equal(dry.code, 0, dry.stderr)
    assert.equal(dry.data.status.before, 'Accepted')
    assert.equal(dry.data.after, text.replaceAll('\r\n', '\n').replace('Accepted', 'Deprecated'))
    assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), text)
    assert.equal((await adrStatus(root, '1', 'deprecated')).code, 0)
    assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), text.replaceAll('\r\n', '\n').replace('Accepted', 'Deprecated'))
  })
}
test('docs adr-get reads the status line alone for MADR and Nygard, and a one-line section as before (PMK-311)', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0001-a.md', '# A\n\n## Status\n\nAccepted\nDate: 2024-01-02\n')
  writeAdr(root, 'docs/adr/0002-b.md', '# B\n\n## Status\n\nAccepted\n\nSupersedes [ADR 3](0003-x.md)\n')
  writeAdr(root, 'docs/adr/0003-c.md', '# C\n\n## Status\n\nAccepted\n')
  for (const n of ['1', '2', '3']) assert.equal((await adrGetFrom(root, n)).data.status, 'Accepted', n)
  assert.deepEqual(adrInfo('## Status\n\n<!-- c -->\n').statuses, ['<!-- c -->'])
  assert.deepEqual(adrInfo('## Status\n\n\n').statuses, [])
})
test('docs adr-status ... superseded --by N keeps a Supersedes line and adds no second one (PMK-311)', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0003-x.md', '# X\n\n## Status\n\nAccepted\n')
  writeAdr(root, 'docs/adr/0005-a.md', '# A\n\n## Status\n\nAccepted\n\nSupersedes [ADR 3](0003-x.md)\n')
  writeAdr(root, 'docs/adr/0007-b.md', '# B\n')
  const result = await adrStatus(root, '5', 'superseded', '--by', '7')
  assert.equal(result.code, 0, result.stderr)
  const after = fs.readFileSync(path.join(root, 'docs/adr/0005-a.md'), 'utf8')
  assert.equal(after, '# A\n\n## Status\n\nSuperseded by docs/adr/0007-b.md\n\nSupersedes [ADR 3](0003-x.md)\n')
  assert.equal(after.match(/Supersedes/g).length, 1)
  assert.equal(result.data.notes.filter((item) => item.includes('already names')).length, 0)
})
test('a kept line that already names the --by ADR (by number or file name) gets a note, never a second line (PMK-311)', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0005-a.md', '# A\n\n## Status\n\nAccepted\nSee [ADR 7](0007-b.md)\n')
  writeAdr(root, 'docs/adr/0007-b.md', '# B\n')
  const result = await adrStatus(root, '5', 'superseded', '--by', '7', '--dry-run')
  assert.equal(result.code, 0, result.stderr)
  assert.ok(result.data.notes.some((item) => item.includes('already names ADR 7;')), result.data.notes.join('\n'))
  assert.equal(result.data.after.match(/0007-b/g).length, 2)
})
test('a Status section whose lines all open a block, with more than one line, is still refused as other text (PMK-311)', async () => {
  const text = '## Status\n\n> Accepted\n> more\n\n## Context\n'
  assert.deepEqual(adrStatusDropped(text), ['> more'])
  const root = repo()
  writeAdr(root, 'docs/adr/0001-a.md', text)
  for (const flags of [['--dry-run'], []]) {
    const result = await adrStatus(root, '1', 'deprecated', ...flags)
    assert.equal(result.code, 2)
    assert.match(result.data.error.message, /the other text of the Status section, "> more"/)
    assert.match(result.data.error.nextStep, /Put the status on a plain line of its own/)
    assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), text)
  }
})
// PMK-311 review: the line is replaced in place only when it is a paragraph line at the top level (no comment, fence, code, item, quote or HTML around it, only blanks or one-line comments before it, and not a `Key: value` or `Supersedes` line); else the write is refused as before PMK-311 and the reading is the whole section.
const UNSAFE = [
  ['a multi-line comment around a template hint', '## Status\n\n<!--\nProposed | Accepted | Deprecated\n-->\nAccepted\n\n## Context\n'],
  ['a fence around the status and a visible line after it', '## Status\n\n```\nAccepted\n```\nProposed\n\n## Context\n'],
  ['indented code before the status', '## Status\n\n    code\nAccepted\n\n## Context\n'],
  ['a list item status, a blank line and a date', '## Status\n\n- Accepted\n\nDate: 2024-01-02\n\n## Context\n'],
  ['a * item status, a blank line and a date', '## Status\n\n* Accepted\n\nDate: 2024-01-02\n\n## Context\n'],
  ['an ordered item status, a blank line and a date', '## Status\n\n1. Accepted\n\nDate: 2024-01-02\n\n## Context\n'],
  ['a quote status, a blank line and a Supersedes line', '## Status\n\n> Accepted\n\nSupersedes [ADR 3](0003-x.md)\n\n## Context\n'],
  ['an HTML status, a blank line and a date', '## Status\n\n<b>Accepted</b>\n\nDate: 2024-01-02\n\n## Context\n'],
  ['a table status, a blank line and a date', '## Status\n\n| Accepted |\n\nDate: 2024-01-02\n\n## Context\n'],
  ['a date line before the status', '## Status\n\nDate: 2024-01-02\n\nAccepted\n\n## Context\n'],
  ['a Supersedes line before the status', '## Status\n\nSupersedes [ADR 3](0003-x.md)\n\nAccepted\n\n## Context\n'],
  ['a list item status with a continuation line', '## Status\n\n- Accepted\n  Date: 2024-01-02\n\n## Context\n'],
  ['a quote status with a date line', '## Status\n\n> Accepted\nDate: 2024-01-02\n\n## Context\n'],
  ['an emphasised date line before the status', '## Status\n\n**Date:** 2024-01-02\n\nAccepted\n\n## Context\n'],
  ['an italic date line before the status', '## Status\n\n_Date:_ 2024-01-02\nAccepted\n\n## Context\n'],
  ['a bare date before the status', '## Status\n\n2024-01-02\n\nAccepted\n\n## Context\n'],
  ['an emphasised Supersedes line before the status', '## Status\n\n**Supersedes** [ADR 2](0002-x.md)\n\nAccepted\n\n## Context\n'],
  ['a date line with a non-ASCII key before the status', '## Status\n\nDécidé le: 2024\n\nAccepted\n\n## Context\n'],
  ['an unknown status word, then a date', '## Status\n\nPending review\nDate: 2024-01-02\n\n## Context\n'],
  ['a second line that also reads as a known status', '## Status\n\nAccepted\n\nSuperseded by [ADR 5](0005-x.md)\n\n## Context\n'],
  ['a second line that reads as a status in another case, with emphasis', '## Status\n\nProposed\n**Accepted**\n\n## Context\n'],
]
for (const [name, text] of UNSAFE) {
  test(`adr-status refuses ${name}, reads the whole section, and writes nothing (PMK-311 review)`, async () => {
    assert.ok(adrStatusDropped(text).length > 0, 'names the other text')
    assert.equal(adrInfo(text).status, adrSectionText(text))
    const root = repo()
    writeAdr(root, 'docs/adr/0001-a.md', text)
    assert.equal((await adrGetFrom(root, '1')).data.status, adrSectionText(text))
    for (const flags of [['--dry-run'], []]) {
      const result = await adrStatus(root, '1', 'deprecated', ...flags)
      assert.equal(result.code, 2, flags.join(' '))
      assert.match(result.data.error.message, /the other text of the Status section/)
      assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), text)
    }
  })
}
test('a status word with emphasis, any case, or a common ADR status (proposed, rejected, draft) is the status line (PMK-311 review)', async () => {
  for (const [line, other] of [['**Accepted**', 'Date: 2024-01-02'], ['_proposed_', 'Date: x'], ['Rejected.', 'Date: x'], ['draft', 'Date: x'], ['Superseded by [ADR 5](0005-x.md)', 'Date: x']]) {
    const text = `## Status\n\n${line}\n${other}\n\n## Context\n`
    assert.equal(adrInfo(text).status, line, line)
    assert.equal(setAdrStatus(text, 'deprecated').text, `## Status\n\nDeprecated\n${other}\n\n## Context\n`, line)
  }
})
test('an ambiguous section is refused without the note about a continuation, and the refusal also covers an unknown status word (PMK-311 review)', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0001-a.md', '## Status\n\nAccepted\n\nSuperseded by [ADR 5](0005-x.md)\n')
  const refusal = (await adrStatus(root, '1', 'deprecated', '--dry-run')).data.error
  assert.match(refusal.message, /"Superseded by \[ADR 5\]\(0005-x\.md\)"/)
  assert.match(refusal.nextStep, /word that is not a known status/)
  assert.match(refusal.nextStep, /two lines that read as a status/)
})
test('a Status section of one line writes as before PMK-311, whatever the line looks like (PMK-311 review)', async () => {
  for (const line of ['- Accepted', '> Accepted', '<!-- Accepted -->', 'Date: 2024-01-02', '    Accepted']) {
    const root = repo()
    writeAdr(root, 'docs/adr/0001-a.md', `## Status\n\n${line}\n\n## Context\n`)
    assert.equal((await adrStatus(root, '1', 'deprecated')).code, 0, line)
    assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), '## Status\n\nDeprecated\n\n## Context\n', line)
  }
})
test('a one-line comment before the status is skipped, and the line after the status that continues its paragraph gets a note (PMK-311 review)', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0001-a.md', '## Status\n\n<!-- pick one -->\nAccepted\nwith conditions\n\n## Context\n')
  const result = await adrStatus(root, '1', 'deprecated', '--dry-run')
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.data.after, '## Status\n\n<!-- pick one -->\nDeprecated\nwith conditions\n\n## Context\n')
  assert.ok(result.data.notes.some((item) => item.includes('"with conditions"') && item.includes('rest of the old status')), result.data.notes.join('\n'))
  writeAdr(root, 'docs/adr/0002-b.md', '## Status\n\nAccepted\nDate: 2024-01-02\n\n## Context\n')
  assert.ok(!(await adrStatus(root, '2', 'deprecated', '--dry-run')).data.notes.some((item) => item.includes('rest of the old status')))
})
test('docs adr-status writes as before for a section that holds only the status (PMK-306)', async () => {
  for (const text of ['## Status\n\nAccepted\n\n## Context\n\nWhy.\n', '## Status\r\n\r\nAccepted\r\n', '# T\n\nNo section\n']) assert.deepEqual(adrStatusDropped(text), [])
  const root = repo()
  writeAdr(root, 'docs/adr/0001-a.md', '## Status\n\nAccepted\n\n## Context\n\nWhy.\n')
  assert.equal((await adrStatus(root, '1', 'deprecated')).code, 0)
  assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), '## Status\n\nDeprecated\n\n## Context\n\nWhy.\n')
})
test('docs adr-status names the HTML block, the fence and the other text in one refusal (PMK-306)', async () => {
  const text = '## Status\n\n```\n## A\n```\n\nAccepted\n\n<div>\n## B\n\nWhy.\n'
  const root = repo()
  writeAdr(root, 'docs/adr/0001-a.md', text)
  for (const flags of [['--dry-run'], []]) {
    const result = await adrStatus(root, '1', 'deprecated', ...flags)
    assert.equal(result.code, 2)
    const { message, nextStep } = result.data.error
    assert.match(message, /the HTML block "<div>"/)
    assert.match(message, /the code fence "```"/)
    assert.match(message, /the other text of the Status section/)
    assert.match(nextStep, /close a comment with -->/)
    assert.match(nextStep, /Close the code fence/)
    assert.match(nextStep, /Put the status on a plain line of its own/)
    assert.equal(nextStep.match(/then run the command again/g).length, 1)
    assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), text)
  }
})

// PMK-310: the refusal names each line once, under the cause that takes it, and names the line a reader takes as the status as the status.
const NAMED = [
  ['an HTML block that takes a heading', '## Status\n\n<!-- note\nAccepted\n\n## Context\n\nWhy.\n', ['<!-- note', '## Context', 'Why.'], ['the HTML block "<!-- note"']],
  ['a fence that takes a heading', '## Status\n\n```\nAccepted\n\n## Context\n', ['```', '## Context'], ['the code fence "```"']],
]
for (const [name, text, quoted, causes] of NAMED) {
  test(`the refusal names the opener of ${name} once, with its block (PMK-310)`, async () => {
    const root = repo()
    writeAdr(root, 'docs/adr/0001-a.md', text)
    const { message, nextStep } = (await adrStatus(root, '1', 'deprecated', '--dry-run')).data.error
    for (const cause of causes) assert.ok(message.includes(cause), cause)
    assert.equal(message.split(`"${quoted[0]}"`).length - 1, 1, message)
    assert.equal(nextStep.match(/Put the status on a plain line/g)?.length ?? 0, 0, nextStep)
  })
}
const STATUS_NAMED = [
  ['a list item then a lazy line', '## Status\n\n- Accepted\nlazy\n\n## Context\n', ['lazy'], '- Accepted'],
  ['a quote then a lazy line', '## Status\n\n> Accepted\nlazy\n\n## Context\n', ['lazy'], '> Accepted'],
]
for (const [name, text, dropped, status] of STATUS_NAMED) {
  test(`the refusal for ${name} names the extra line, not the status (PMK-310)`, async () => {
    assert.deepEqual(adrStatusDropped(text), dropped)
    const root = repo()
    writeAdr(root, 'docs/adr/0001-a.md', text)
    const result = await adrStatus(root, '1', 'deprecated', '--dry-run')
    assert.equal(result.code, 2)
    const { message } = result.data.error
    for (const line of dropped) assert.ok(message.includes(`"${line}"`), line)
    assert.ok(!message.includes(`"${status}"`), message)
  })
}

// PMK-310 review: a fence opener inside a quote is named once, and an empty list item has no lazy line.
test('the refusal names the opener of a fence in a quote once (PMK-310)', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0001-a.md', '## Status\n\nAccepted\n\n> ```\n> ## Context\n')
  const { message } = (await adrStatus(root, '1', 'deprecated', '--dry-run')).data.error
  assert.match(message, /the code fence "```"/)
  assert.ok(!message.includes('"> ```"'), message)
  assert.ok(!message.includes('the other text'), message)
})
for (const [name, text, status, dropped] of [
  ['an empty list item then a line', '## Status\n\n-\nfoo\n\n## Context\n', '-', ['foo']],
  ['an empty quote then a line', '## Status\n\n>\nfoo\n\n## Context\n', '>', ['foo']],
]) {
  test(`${name} is not a lazy line: the refusal names the line after it, the item is the other text (PMK-310)`, async () => {
    // `foo` is the status a reader takes, so the empty marker is what the user has to move.
    assert.deepEqual(adrStatusDropped(text), [status])
    const root = repo()
    writeAdr(root, 'docs/adr/0001-a.md', text)
    const { message } = (await adrStatus(root, '1', 'deprecated', '--dry-run')).data.error
    assert.ok(message.includes(`"${status}"`), message)
    assert.ok(!message.includes(`"${dropped[0]}"`), message)
  })
}

// PMK-310 review cycle 2: only an open paragraph takes a lazy line, so an item or quote whose content is a block (HTML, heading, fence, thematic break) has none.
for (const block of ['<!-- c -->', '# H', '```', '~~~', '---', '* * *', '<div>']) {
  for (const host of ['> ', '- ', '1. ']) {
    test(`"${host}${block}" then a line: the refusal names the block line, foo is the status (PMK-310)`, async () => {
      const text = `## Status\n\n${host}${block}\nfoo\n\n## Context\n`
      assert.deepEqual(adrStatusDropped(text), [`${host}${block}`])
    })
  }
}
test('a code span then a Key: value line: the code span is the status and the line is kept (PMK-310, PMK-311)', async () => {
  const text = '## Status\n\n`Accepted`\nDate: 2020\n\n## Context\n'
  assert.deepEqual(adrStatusDropped(text), [])
  assert.equal(adrInfo(text).status, '`Accepted`')
})

// PMK-313: a status in a list item or a quote is the status the refusal shows, so the extra line (a date, Supersedes, a lazy line) is the text to move.
for (const [name, text, dropped, status] of [
  ['a list item, a blank line and a date', '## Status\n\n- Accepted\n\nDate: 2024-01-02\n\n## Context\n', ['Date: 2024-01-02'], '- Accepted'],
  ['a star item, a blank line and a Supersedes line', '## Status\n\n* Accepted\n\nSupersedes [ADR 3](0003-x.md)\n\n## Context\n', ['Supersedes [ADR 3](0003-x.md)'], '* Accepted'],
  ['a quote, a blank line and a date', '## Status\n\n> Accepted\n\nDate: 2024-01-02\n\n## Context\n', ['Date: 2024-01-02'], '> Accepted'],
  ['a one-line comment, an item, a blank line and a date', '## Status\n\n<!-- c -->\n- Accepted\n\nDate: 2024-01-02\n\n## Context\n', ['<!-- c -->', 'Date: 2024-01-02'], '- Accepted'],
  ['a nested item then a lazy line', '## Status\n\n- - Accepted\nbar\n\n## Context\n', ['bar'], '- - Accepted'],
  ['a nested quote in an item then a lazy line', '## Status\n\n- > Accepted\nbar\n\n## Context\n', ['bar'], '- > Accepted'],
]) {
  test(`the refusal for ${name} names the extra line, not the status (PMK-313)`, async () => {
    assert.deepEqual(adrStatusDropped(text), dropped)
    const root = repo()
    writeAdr(root, 'docs/adr/0001-a.md', text)
    const result = await adrStatus(root, '1', 'deprecated', '--dry-run')
    assert.equal(result.code, 2)
    const { message } = result.data.error
    for (const line of dropped) assert.ok(message.includes(`"${line}"`), line)
    assert.ok(!message.includes(`"${status}"`), message)
  })
}

// PMK-313: the closing line of a fence the heading guard names goes with the fence, in a list item and in a quote.
for (const [name, text] of [
  ['a list item', '## Status\n\n- Accepted\n\n```\n## X\n```\n\n## Context\n'],
  ['a quote', '## Status\n\n> Accepted\n\n> ```\n> ## X\n> ```\n\n## Context\n'],
]) {
  test(`the refusal names the closing fence of a fence after ${name} once, with its fence (PMK-313)`, async () => {
    const root = repo()
    writeAdr(root, 'docs/adr/0001-a.md', text)
    const result = await adrStatus(root, '1', 'deprecated', '--dry-run')
    assert.equal(result.code, 2)
    const { message } = result.data.error
    assert.match(message, /## X".*the code fence/)
    assert.ok(!message.includes('the other text'), message)
    // The fence is named once, by its opener, and neither it nor the closing line comes again as other text.
    assert.equal(message.split('"```"').length - 1, 1, message)
    assert.ok(!message.includes('"> ```"'), message)
  })
}

// PMK-314: a section with a top-level status line is written in place and nothing is deleted, so the HTML block and fence guards and the adr-get notes do not run for it.
for (const [name, text] of [
  ['a closed comment holding a heading', '## Status\n\nAccepted\n\n<!--\n## X\n-->\n\n## Context\n'],
  ['a closed fence holding a heading', '## Status\n\nAccepted\n\n```\n## X\n```\n\n## Context\n'],
  ['a closed fence holding a setext heading', '## Status\n\nAccepted\n\n~~~\nX\n---\n~~~\n\n## Context\n'],
  ['a closed fence in a quote', '## Status\n\nAccepted\n\n> ```\n> ## X\n> ```\n\n## Context\n'],
]) {
  test(`${name} after a status line of its own is written in place, real and dry run, with no note in adr-get (PMK-314)`, async () => {
    assert.equal(adrHtmlHeld(text), null)
    assert.equal(adrFenceHeld(text), null)
    assert.deepEqual(adrFenceClosers(text), [])
    const root = repo()
    writeAdr(root, 'docs/adr/0001-a.md', text)
    const get = await adrGetFrom(root, '1')
    assert.equal(get.data.status, 'Accepted')
    assert.deepEqual(get.data.notes, [])
    assert.equal(get.data.htmlHeld, null)
    assert.equal(get.data.fenceHeld, null)
    const dry = await adrStatus(root, '1', 'deprecated', '--dry-run')
    assert.equal(dry.code, 0, dry.stderr)
    assert.equal(dry.data.after, text.replace('Accepted', 'Deprecated'))
    assert.equal((await adrStatus(root, '1', 'deprecated')).code, 0)
    assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), text.replace('Accepted', 'Deprecated'))
  })
}
// The guards still refuse when the whole section is replaced: an unclosed comment or fence, no known status line, a status in an item, an ambiguous section.
for (const [name, text, guard] of [
  ['an unclosed comment after the status line', '## Status\n\nAccepted\n\n<!--\n## X\n', 'HTML'],
  ['an unclosed fence after the status line', '## Status\n\nAccepted\n\n```\n## X\n', 'fence'],
  ['a quoted fence the quote closes after the status line', '## Status\n\nAccepted\n\n> ```\n> ## X\n\n## Context\n', 'fence'],
  ['an unclosed comment before the status', '## Status\n\n<!--\nAccepted\n\n## X\n-->\n', 'HTML'],
  ['a closed comment before the status', '## Status\n\n<!--\n## X\n-->\n\nAccepted\n', 'HTML'],
  ['a closed fence before the status', '## Status\n\n```\n## X\n```\n\nAccepted\n', 'fence'],
  ['an item status then a closed fence', '## Status\n\n- Accepted\n\n```\n## X\n```\n', 'fence'],
  ['no known status line and a closed comment', '## Status\n\nMaybe\n\n<!--\n## X\n-->\n', 'HTML'],
  ['two status lines and a closed fence', '## Status\n\nAccepted\n\nDeprecated\n\n```\n## X\n```\n', 'fence'],
]) {
  test(`the ${guard} guard still refuses ${name}, real and dry run (PMK-314)`, async () => {
    const root = repo()
    writeAdr(root, 'docs/adr/0001-a.md', text)
    for (const flag of [['--dry-run'], []]) {
      const result = await adrStatus(root, '1', 'deprecated', ...flag)
      assert.equal(result.code, 2)
      assert.match(result.data.error.message, /## X/)
    }
    assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), text)
    assert.ok((await adrGetFrom(root, '1')).data.notes.length > 0)
  })
}
// A hard line break at the end of the status line is kept and read without.
for (const [name, brk] of [['two spaces', '  '], ['four spaces', '    '], ['a backslash', '\\']]) {
  test(`a status line that ends with ${name} keeps the break after the write, and adr-get reads the status without it (PMK-314)`, async () => {
    const text = `## Status\n\nAccepted${brk}\nDate: 2024-01-02\n\n## Context\n`
    assert.equal(adrInfo(text).status, 'Accepted')
    const root = repo()
    writeAdr(root, 'docs/adr/0001-a.md', text)
    assert.equal((await adrGetFrom(root, '1')).data.status, 'Accepted')
    const dry = await adrStatus(root, '1', 'deprecated', '--dry-run')
    assert.equal(dry.data.status.before, 'Accepted')
    assert.equal(dry.data.after, `## Status\n\nDeprecated${brk}\nDate: 2024-01-02\n\n## Context\n`)
    assert.equal((await adrStatus(root, '1', 'deprecated')).code, 0)
    assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8'), `## Status\n\nDeprecated${brk}\nDate: 2024-01-02\n\n## Context\n`)
    // The status is already the requested one: the file is not rewritten.
    const written = fs.readFileSync(path.join(root, 'docs/adr/0001-a.md'), 'utf8')
    assert.equal(setAdrStatus(written, 'deprecated').text, written)
  })
}
test('a backslash pair is an escaped backslash, not a break, and one space is not a break (PMK-314)', () => {
  assert.equal(adrSectionText('## Status\n\nAccepted\\\\\nDate: 2024-01-02\n'), 'Accepted\\\\ Date: 2024-01-02')
  assert.equal(adrInfo('## Status\n\nAccepted\\\\\nDate: 2024-01-02\n').status, 'Accepted\\\\')
  assert.equal(setAdrStatus('## Status\n\nAccepted \nDate: 2024-01-02\n', 'deprecated').text, '## Status\n\nDeprecated\nDate: 2024-01-02\n')
})
test('a section of one line with a break at its end reads without it and is written whole (PMK-314)', () => {
  for (const brk of ['  ', '\\']) {
    const text = `## Status\n\nAccepted${brk}\n\n## Context\n`
    assert.equal(adrInfo(text).status, 'Accepted')
    assert.equal(setAdrStatus(text, 'deprecated').text, '## Status\n\nDeprecated\n\n## Context\n')
    assert.equal(setAdrStatus(text, 'accepted').after, 'Accepted')
  }
})
// `***` and `___` are thematic breaks, not the rest of a status.
test('the continuation note does not name a thematic break (PMK-314)', async () => {
  for (const line of ['***', '___', '* * *', '_ _ _', '- - -', '**********']) assert.equal(adrStatusContinuation(`## Status\n\nAccepted\n${line}\n\n## Context\n`), null, line)
  assert.equal(adrStatusContinuation('## Status\n\nAccepted\nwith conditions\n\n## Context\n'), 'with conditions')
  const root = repo()
  writeAdr(root, 'docs/adr/0001-a.md', '## Status\n\nAccepted\n***\n\n## Context\n')
  const result = await adrStatus(root, '1', 'deprecated', '--dry-run')
  assert.equal(result.code, 0, result.stderr)
  assert.ok(!result.data.notes.some((item) => item.includes('continues the paragraph')), result.data.notes.join('\n'))
  assert.equal(result.data.after, '## Status\n\nDeprecated\n***\n\n## Context\n')
})
