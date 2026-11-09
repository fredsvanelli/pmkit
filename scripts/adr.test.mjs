// The next ADR (PMK-65): the slug, the number across four sources, the place, and `pmkit docs next-adr`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { run } from './pmkit.mjs'
import { ADR_SLUG_MAX, adrSlug, highestAdr } from './lib/adr.mjs'
import { childEnv } from './golden-helpers.mjs'
import { makeRepo } from './test-helpers.mjs'

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
    assert.equal(data.path, 'docs/adr/0002-keep-estimates-in-points.md')
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
