import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { hashTree, tempDir } from './test-helpers.mjs'
import { lineDiff } from './lib/diff.mjs'
import { FORMAT_VERSION } from './lib/local/migrations.mjs'
import { parseYaml } from './lib/yaml.mjs'
import { pmkitConfigRefusal } from './pmkit.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = path.join(ROOT, 'scripts', 'pmkit.mjs')

function run(cwd, args, { input } = {}) {
  const env = { ...process.env, PMKIT_USER: 'fred', PMKIT_NOW: '2026-10-23T12:00:00Z', PMKIT_SEED: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, env, input, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const json = (cwd, args, options) => {
  const result = run(cwd, [...args, '--json'], options)
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

const tmp = () => tempDir('pmkit-init-')
const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8')

test('lineDiff marks removed and added lines and keeps the common ones', () => {
  assert.equal(lineDiff('a\nb\n', 'a\nc\n'), '  a\n-b\n+c\n')
  assert.equal(lineDiff('a\n', 'a\n'), '  a\n')
  assert.equal(lineDiff('', 'x\n'), '+x\n')
})

test('a first run sets the estimate unit, adds every member from stdin and writes the current format version', () => {
  const dir = tmp()
  const members = 'fred: { name: Fred, email: f@x.dev }\nana: { name: Ana }\n'
  const result = json(dir, ['init', '--estimate-unit', 'hours', '--members-file', '-'], { input: members })
  assert.deepEqual(result.files.map((f) => f.action).filter((a) => a !== 'create'), [])
  assert.deepEqual(result.kept, [])
  const local = parseYaml(read(dir, '.issues/config.yaml'))
  assert.equal(local.estimate.unit, 'hours')
  assert.deepEqual(Object.keys(local.members), ['fred', 'ana'])
  assert.equal(local.members.fred.email, 'f@x.dev')
  assert.equal(local.version, FORMAT_VERSION)
})

test('--estimate-unit sizes also sets the scale', () => {
  const dir = tmp()
  assert.equal(run(dir, ['init', '--estimate-unit', 'sizes']).status, 0)
  const local = parseYaml(read(dir, '.issues/config.yaml'))
  assert.equal(local.estimate.unit, 'sizes')
  assert.deepEqual(local.estimate.scale, ['XS', 'S', 'M', 'L', 'XL'])
  assert.equal(run(dir, ['init', '--root', tmp(), '--estimate-unit', 'days']).status, 2)
})

test('--id-style sets id_style on a first run and on --update, and refuses an unknown style', () => {
  const dir = tmp()
  assert.equal(run(dir, ['init']).status, 0)
  assert.equal(parseYaml(read(dir, '.issues/config.yaml')).id_style, 'random')
  const update = json(dir, ['init', '--update', '--id-style', 'numbered'])
  assert.deepEqual(update.files.filter((f) => f.action === 'change').map((f) => f.path), ['.issues/config.yaml'])
  assert.equal(parseYaml(read(dir, '.issues/config.yaml')).id_style, 'numbered')
  const other = tmp()
  assert.equal(run(other, ['init', '--id-style', 'numbered']).status, 0)
  assert.equal(parseYaml(read(other, '.issues/config.yaml')).id_style, 'numbered')
  assert.equal(run(tmp(), ['init', '--id-style', 'sequential']).status, 2)
})

test('--update adds id_style to a config written before it existed', () => {
  const dir = tmp()
  assert.equal(run(dir, ['init']).status, 0)
  fs.writeFileSync(path.join(dir, '.issues/config.yaml'), read(dir, '.issues/config.yaml').replace('id_style: random\n', ''))
  assert.equal(json(dir, ['init', '--update', '--dry-run']).files.find((f) => f.path === '.issues/config.yaml').action, 'keep')
  assert.equal(run(dir, ['init', '--update', '--id-style', 'numbered']).status, 0)
  assert.equal(parseYaml(read(dir, '.issues/config.yaml')).id_style, 'numbered')
})

test('--update --git-host changes only the system line', () => {
  const dir = tmp()
  assert.equal(run(dir, ['init']).status, 0)
  const file = path.join(dir, '.pmkit/config.yaml')
  const edited = `# my notes\n${fs.readFileSync(file, 'utf8').replace('confirm: single_writes', 'confirm: none # no prompts')}`
  fs.writeFileSync(file, edited)
  const result = json(dir, ['init', '--update', '--git-host', 'github'])
  const change = result.files.find((f) => f.path === '.pmkit/config.yaml')
  assert.equal(change.action, 'change')
  assert.match(change.diff, /^-  system: none$/m)
  assert.equal(read(dir, '.pmkit/config.yaml'), edited.replace('system: none', 'system: github'))
  assert.ok(result.files.filter((f) => f.path !== '.pmkit/config.yaml').every((f) => f.action === 'keep'))
})

test('--update reports a hand-edited template file as differs and replaces it only when asked', () => {
  const dir = tmp()
  assert.equal(run(dir, ['init']).status, 0)
  const file = path.join(dir, '.issues/.gitattributes')
  fs.writeFileSync(file, 'events.jsonl merge=ours\n')
  const first = json(dir, ['init', '--update'])
  const entry = first.files.find((f) => f.path === '.issues/.gitattributes')
  assert.equal(entry.action, 'differs')
  assert.match(entry.diff, /^-events\.jsonl merge=ours$/m)
  assert.match(entry.diff, /^\+events\.jsonl merge=union$/m)
  assert.equal(fs.readFileSync(file, 'utf8'), 'events.jsonl merge=ours\n')
  const second = json(dir, ['init', '--update', '--replace', '.issues/.gitattributes'])
  assert.equal(second.files.find((f) => f.path === '.issues/.gitattributes').action, 'replace')
  assert.match(fs.readFileSync(file, 'utf8'), /merge=union/)
})

test('--update recreates a missing file and keeps an existing member', () => {
  const dir = tmp()
  assert.equal(run(dir, ['init', '--member', 'fred', '--name', 'Fred']).status, 0)
  fs.rmSync(path.join(dir, '.issues/.gitignore'))
  const result = json(dir, ['init', '--update', '--members-file', '-'], { input: 'fred: { name: Other }\nana: { name: Ana }\n' })
  assert.equal(result.files.find((f) => f.path === '.issues/.gitignore').action, 'create')
  assert.deepEqual(result.kept, ['fred'])
  const members = parseYaml(read(dir, '.issues/config.yaml')).members
  assert.equal(members.fred.name, 'Fred')
  assert.equal(members.ana.name, 'Ana')
})

test('--update reads the tracker folder from the config', () => {
  const dir = tmp()
  assert.equal(run(dir, ['init']).status, 0)
  fs.renameSync(path.join(dir, '.issues'), path.join(dir, 'tracker'))
  fs.writeFileSync(path.join(dir, '.pmkit/config.yaml'), read(dir, '.pmkit/config.yaml').replace('path: .issues', 'path: tracker'))
  const result = json(dir, ['init', '--update', '--estimate-unit', 'hours'])
  assert.ok(result.files.every((f) => f.path.startsWith('tracker/') || f.path.startsWith('.pmkit/')))
  assert.equal(parseYaml(read(dir, 'tracker/config.yaml')).estimate.unit, 'hours')
  assert.equal(fs.existsSync(path.join(dir, '.issues')), false)
})

test('--update --dry-run writes nothing, and --update refuses --prefix or a missing setup', () => {
  const dir = tmp()
  assert.equal(run(dir, ['init']).status, 0)
  const before = hashTree(dir)
  const dry = json(dir, ['init', '--update', '--dry-run', '--git-host', 'github', '--estimate-unit', 'hours'])
  assert.equal(dry.dryRun, true)
  assert.ok(dry.files.some((f) => f.action === 'change'))
  assert.equal(hashTree(dir), before)
  const prefix = run(dir, ['init', '--update', '--prefix', 'ABC', '--json'])
  assert.equal(prefix.status, 2)
  assert.match(JSON.parse(prefix.stdout).error.message, /id_prefix cannot change after setup/)
  const empty = run(tmp(), ['init', '--update', '--json'])
  assert.equal(empty.status, 2)
  assert.equal(JSON.parse(empty.stdout).error.code, 'INVALID_INPUT')
  assert.match(JSON.parse(empty.stdout).error.nextStep, /without --update/)
})

test('--update that cannot edit a key fails with INVALID_INPUT naming the file and the key', () => {
  const dir = tmp()
  assert.equal(run(dir, ['init']).status, 0)
  const file = path.join(dir, '.issues/config.yaml')
  fs.writeFileSync(file, read(dir, '.issues/config.yaml').replace('scale: [1, 2, 3, 5, 8, 13]', 'scale:\n    - 1\n    - 2\n    - 3'))
  const before = hashTree(dir)
  const result = run(dir, ['init', '--update', '--estimate-unit', 'sizes', '--json'])
  assert.equal(result.status, 2)
  const error = JSON.parse(result.stdout).error
  assert.equal(error.code, 'INVALID_INPUT')
  assert.match(error.message, /\.issues\/config\.yaml/)
  assert.match(error.message, /estimate\.scale/)
  assert.doesNotMatch(error.message, /members/)
  assert.equal(hashTree(dir), before)
})

const PMKIT_URL = 'https://raw.githubusercontent.com/fredsvanelli/pmkit/main/schemas/pmkit.config.schema.json'
const ISSUES_URL = 'https://raw.githubusercontent.com/fredsvanelli/pmkit/main/schemas/issues.config.schema.json'
const lineFor = (url) => `# yaml-language-server: $schema=${url}`
const stripLine = (text) => text.split('\n').slice(1).join('\n')

test('a first run writes the schema line first in both files, then the template', () => {
  const dir = tmp()
  try {
    assert.equal(run(dir, ['init']).status, 0)
    const pmkit = read(dir, '.pmkit/config.yaml')
    const local = read(dir, '.issues/config.yaml')
    assert.equal(pmkit.split('\n')[0], lineFor(PMKIT_URL))
    assert.equal(local.split('\n')[0], lineFor(ISSUES_URL))
    assert.deepEqual(parseYaml(pmkit), parseYaml(stripLine(pmkit)))
    assert.equal(parseYaml(local).id_prefix, 'ISS')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('--update adds the line to a config without it and changes only that line', () => {
  const dir = tmp()
  try {
    assert.equal(run(dir, ['init']).status, 0)
    const files = ['.pmkit/config.yaml', '.issues/config.yaml']
    const old = {}
    for (const f of files) {
      old[f] = stripLine(read(dir, f))
      fs.writeFileSync(path.join(dir, f), old[f])
    }
    const result = json(dir, ['init', '--update'])
    for (const f of files) {
      assert.equal(result.files.find((x) => x.path === f).action, 'change')
      const now = read(dir, f)
      assert.equal(lineDiff(old[f], now).split('\n').filter((l) => l.startsWith('+') || l.startsWith('-')).length, 1)
      assert.equal(stripLine(now), old[f])
    }
    const again = json(dir, ['init', '--update'])
    assert.deepEqual(again.files.filter((x) => files.includes(x.path)).map((x) => x.action), ['keep', 'keep'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('--update replaces an old-ref pmkit line and leaves a line for another host alone', () => {
  const dir = tmp()
  try {
    assert.equal(run(dir, ['init']).status, 0)
    const pmkitFile = path.join(dir, '.pmkit/config.yaml')
    const issuesFile = path.join(dir, '.issues/config.yaml')
    fs.writeFileSync(pmkitFile, lineFor(PMKIT_URL.replace('/main/', '/v0.1.0/')) + '\n' + stripLine(read(dir, '.pmkit/config.yaml')))
    const foreign = lineFor('https://example.com/mine.schema.json')
    fs.writeFileSync(issuesFile, foreign + '\n' + stripLine(read(dir, '.issues/config.yaml')))
    const issuesBefore = read(dir, '.issues/config.yaml')
    const result = json(dir, ['init', '--update'])
    assert.equal(result.files.find((x) => x.path === '.pmkit/config.yaml').action, 'change')
    assert.equal(read(dir, '.pmkit/config.yaml').split('\n')[0], lineFor(PMKIT_URL))
    assert.equal(result.files.find((x) => x.path === '.issues/config.yaml').action, 'keep')
    assert.equal(read(dir, '.issues/config.yaml'), issuesBefore)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('--update --dry-run reports change for the line and leaves the files byte-equal', () => {
  const dir = tmp()
  try {
    assert.equal(run(dir, ['init']).status, 0)
    for (const f of ['.pmkit/config.yaml', '.issues/config.yaml']) fs.writeFileSync(path.join(dir, f), stripLine(read(dir, f)))
    const before = hashTree(dir)
    const result = json(dir, ['init', '--update', '--dry-run'])
    assert.deepEqual(result.files.filter((x) => x.path.endsWith('config.yaml')).map((x) => x.action), ['change', 'change'])
    assert.equal(hashTree(dir), before)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('--update on an invalid existing config writes nothing and says to fix it and run again', () => {
  const dir = tmp()
  try {
    assert.equal(run(dir, ['init']).status, 0)
    const file = path.join(dir, '.issues/config.yaml')
    fs.writeFileSync(file, stripLine(read(dir, '.issues/config.yaml')) + 'auto_commit: "yes"\n')
    const before = hashTree(dir)
    const result = run(dir, ['init', '--update', '--json'])
    assert.equal(result.status, 2)
    const error = JSON.parse(result.stdout).error
    assert.match(error.message, /auto_commit must be true or false/)
    assert.match(error.nextStep, /\.issues\/config\.yaml/)
    assert.match(error.nextStep, /init --update again/)
    assert.equal(hashTree(dir), before)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('--label on a first run fills labels from repeated and comma-separated flags', () => {
  const dir = tmp()
  try {
    const result = json(dir, ['init', '--label', 'a', '--label', 'b,c', '--label', 'a'])
    assert.deepEqual(parseYaml(read(dir, '.issues/config.yaml')).labels, ['a', 'b', 'c'])
    assert.deepEqual(result.labelsAdded, ['a', 'b', 'c'])
    assert.deepEqual(result.labelsKept, [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('--update --label appends and keeps existing labels, comments and key order', () => {
  const dir = tmp()
  try {
    assert.equal(run(dir, ['init']).status, 0)
    const file = path.join(dir, '.issues/config.yaml')
    fs.writeFileSync(file, read(dir, '.issues/config.yaml').replace('labels: []', 'labels: [bug-report] # shown in the board').replace(/^types:/m, '# keep me\ntypes:'))
    const order = Object.keys(parseYaml(read(dir, '.issues/config.yaml')))
    const result = json(dir, ['init', '--update', '--label', 'needs-criteria,bug-report'])
    const text = read(dir, '.issues/config.yaml')
    assert.ok(text.split('\n').includes('labels: [bug-report, needs-criteria] # shown in the board'))
    assert.ok(text.includes('# keep me'))
    assert.deepEqual(Object.keys(parseYaml(text)), order)
    assert.deepEqual(result.labelsAdded, ['needs-criteria'])
    assert.deepEqual(result.labelsKept, ['bug-report'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('--label text output lists added and kept labels', () => {
  const dir = tmp()
  try {
    assert.equal(run(dir, ['init', '--label', 'x']).status, 0)
    const result = run(dir, ['init', '--update', '--label', 'x,y'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /labels added: y/)
    assert.match(result.stdout, /labels kept as they were: x/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('an invalid label exits 2 and writes nothing', () => {
  const dir = tmp()
  try {
    assert.equal(run(dir, ['init']).status, 0)
    const before = hashTree(dir)
    for (const value of ['Bad', '-x', 'a b']) {
      const result = run(dir, ['init', '--update', '--label', value, '--json'])
      assert.equal(result.status, 2)
      const message = JSON.parse(result.stdout).error.message
      assert.ok(message.includes(value))
      assert.ok(message.includes('^[a-z0-9][a-z0-9_-]*$'))
      assert.equal(hashTree(dir), before)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('--update --label --dry-run writes nothing and reports the diff', () => {
  const dir = tmp()
  try {
    assert.equal(run(dir, ['init']).status, 0)
    const before = hashTree(dir)
    const result = json(dir, ['init', '--update', '--label', 'needs-criteria', '--dry-run'])
    assert.equal(hashTree(dir), before)
    const entry = result.files.find((f) => f.path === '.issues/config.yaml')
    assert.equal(entry.action, 'change')
    assert.ok(entry.diff.includes('+labels: [needs-criteria]'))
    assert.deepEqual(result.labelsAdded, ['needs-criteria'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a block-style labels list fails with the by-hand hint', () => {
  const dir = tmp()
  try {
    assert.equal(run(dir, ['init']).status, 0)
    fs.writeFileSync(path.join(dir, '.issues/config.yaml'), read(dir, '.issues/config.yaml').replace('labels: []', 'labels:\n  - bug-report'))
    const before = hashTree(dir)
    const result = run(dir, ['init', '--update', '--label', 'x', '--json'])
    assert.equal(result.status, 2)
    const error = JSON.parse(result.stdout).error
    assert.equal(error.code, 'INVALID_INPUT')
    assert.match(error.message, /\.issues\/config\.yaml/)
    assert.match(error.message, /labels/)
    assert.match(error.nextStep, /by hand/)
    assert.equal(hashTree(dir), before)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('init --label without --update still refuses an existing setup', () => {
  const dir = tmp()
  try {
    assert.equal(run(dir, ['init']).status, 0)
    const result = run(dir, ['init', '--label', 'a', '--json'])
    assert.equal(result.status, 2)
    assert.equal(JSON.parse(result.stdout).error.code, 'CONFLICT')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('--update --label on a hand-written string labels value refuses with the validator message and writes nothing', () => {
  const dir = tmp()
  try {
    assert.equal(run(dir, ['init']).status, 0)
    fs.writeFileSync(path.join(dir, '.issues/config.yaml'), read(dir, '.issues/config.yaml').replace('labels: []', 'labels: bug'))
    const before = hashTree(dir)
    const result = run(dir, ['init', '--update', '--label', 'x', '--json'])
    assert.equal(result.status, 2)
    const error = JSON.parse(result.stdout).error
    assert.match(error.message, /\.issues\/config\.yaml is not valid/)
    assert.match(error.message, /labels must be a list of strings/)
    assert.doesNotMatch(error.message, /"b", "u", "g"|\[b, u, g/)
    assert.equal(error.nextStep, 'Fix .issues/config.yaml by hand, then run init --update again')
    assert.equal(hashTree(dir), before)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// Breaks the .pmkit/config.yaml that init wrote: git_host.system becomes an unsupported host.
function bad(dir) {
  assert.equal(run(dir, ['init']).status, 0)
  const file = path.join(dir, '.pmkit/config.yaml')
  const text = fs.readFileSync(file, 'utf8')
  const broken = text.replace(/^(\s+system: )(none|github)$/m, (line, head, value, offset) => (text.slice(0, offset).includes('git_host:') ? `${head}gitlab` : line))
  assert.notEqual(broken, text)
  fs.writeFileSync(file, broken)
}

test('init --update refuses a bad .pmkit/config.yaml and writes nothing', () => {
  const dir = tmp()
  bad(dir)
  const before = hashTree(dir)
  const result = run(dir, ['init', '--update', '--json'])
  assert.equal(result.status, 2)
  const { error } = JSON.parse(result.stdout)
  assert.equal(error.code, 'INVALID_INPUT')
  assert.match(error.message, /\.pmkit\/config\.yaml/)
  assert.match(error.message, /git_host\.system/)
  assert.match(error.nextStep, /\.pmkit\/config\.yaml/)
  assert.match(error.nextStep, /init --update again/)
  assert.deepEqual(hashTree(dir), before)
})

test('init --update --dry-run refuses a bad .pmkit/config.yaml and writes nothing', () => {
  const dir = tmp()
  bad(dir)
  const before = hashTree(dir)
  assert.equal(run(dir, ['init', '--update', '--dry-run', '--json']).status, 2)
  assert.deepEqual(hashTree(dir), before)
})

test('--update --git-host github works on a valid .pmkit/config.yaml', () => {
  const dir = tmp()
  assert.equal(run(dir, ['init']).status, 0)
  json(dir, ['init', '--update', '--git-host', 'github'])
  assert.equal(parseYaml(read(dir, '.pmkit/config.yaml')).git_host.system, 'github')
})

test('a minimal hand-written .pmkit/config.yaml is refused with the missing keys', () => {
  const dir = tmp()
  assert.equal(run(dir, ['init']).status, 0)
  fs.writeFileSync(path.join(dir, '.pmkit/config.yaml'), 'tracker:\n  system: local\n')
  const before = hashTree(dir)
  for (const extra of [[], ['--dry-run']]) {
    const result = run(dir, ['init', '--update', ...extra, '--json'])
    assert.equal(result.status, 2)
    const { error } = JSON.parse(result.stdout)
    assert.match(error.message, /version must be 1/)
    assert.match(error.message, /git_host\.system must be github or none/)
    assert.match(error.message, /write_policy\.confirm must be one of all_writes, single_writes, none/)
    assert.match(error.nextStep, /\.pmkit\/config\.yaml/)
    assert.deepEqual(hashTree(dir), before)
  }
})

test('when both config files are invalid, the error names only .pmkit/config.yaml', () => {
  const dir = tmp()
  bad(dir)
  fs.writeFileSync(path.join(dir, '.issues/config.yaml'), 'version: 1\nthis line has no colon\n')
  const result = run(dir, ['init', '--update', '--json'])
  assert.equal(result.status, 2)
  const { error } = JSON.parse(result.stdout)
  assert.match(error.message, /\.pmkit\/config\.yaml/)
  assert.doesNotMatch(error.message, /\.issues\/config\.yaml/)
})

test('pmkitConfigRefusal words the refusal for a first run and for --update', () => {
  const badText = 'version: 1\ntracker: { system: local }\ngit_host: { system: gitlab }\nwrite_policy: { confirm: none }\n'
  const first = pmkitConfigRefusal(badText, { update: false })
  assert.equal(first.code, 'INVALID_INPUT')
  assert.ok(first.message.startsWith('the generated .pmkit/config.yaml is not valid:'))
  assert.equal(first.nextStep, 'Fix the init flags')
  const again = pmkitConfigRefusal(badText, { update: true })
  assert.ok(again.message.startsWith('the .pmkit/config.yaml is not valid:'))
  assert.equal(again.nextStep, 'Fix .pmkit/config.yaml by hand, then run init --update again')
  assert.equal(pmkitConfigRefusal(fs.readFileSync(path.join(ROOT, 'templates/pmkit.config.yaml'), 'utf8'), { update: false }), null)
  const unparsable = pmkitConfigRefusal('a: [\n', { update: false })
  assert.equal(unparsable.code, 'INVALID_INPUT')
  assert.match(unparsable.message, /does not parse/)
})

// Replaces .pmkit/config.yaml in an existing setup, then runs init --update on it.
function updateWith(dir, text) {
  fs.writeFileSync(path.join(dir, ".pmkit/config.yaml"), text)
  return run(dir, ["init", "--update", "--json"])
}

test("an empty .pmkit/config.yaml in --update is refused with the file named", () => {
  const dir = tmp()
  assert.equal(run(dir, ["init"]).status, 0)
  const result = updateWith(dir, "")
  assert.equal(result.status, 2)
  assert.doesNotMatch(result.stderr, /TypeError/)
  const { error } = JSON.parse(result.stdout)
  assert.equal(error.code, "INVALID_INPUT")
  assert.match(error.message, /\.pmkit\/config\.yaml/)
})

test("a non-string tracker.path in --update is refused with the file named", () => {
  const dir = tmp()
  assert.equal(run(dir, ["init"]).status, 0)
  const text = read(dir, ".pmkit/config.yaml").replace(/^(\s+path: ).*$/m, "$17")
  const result = updateWith(dir, text)
  assert.equal(result.status, 2)
  assert.doesNotMatch(result.stderr, /TypeError/)
  const { error } = JSON.parse(result.stdout)
  assert.equal(error.code, "INVALID_INPUT")
  assert.match(error.message, /\.pmkit\/config\.yaml/)
  assert.match(error.message, /tracker\.path must be a string/)
})

test("the same two inputs answer NOT_CONFIGURED when .issues/config.yaml is missing", () => {
  const dir = tmp()
  assert.equal(run(dir, ["init"]).status, 0)
  const valid = read(dir, ".pmkit/config.yaml")
  fs.rmSync(path.join(dir, ".issues/config.yaml"))
  for (const text of ["", valid.replace(/^(\s+path: ).*$/m, "$17")]) {
    const result = updateWith(dir, text)
    assert.doesNotMatch(result.stderr, /TypeError/)
    assert.equal(JSON.parse(result.stdout).error.code, "NOT_CONFIGURED")
  }
})

test("an unparseable .pmkit/config.yaml in --update keeps the is not valid YAML message", () => {
  const dir = tmp()
  assert.equal(run(dir, ["init"]).status, 0)
  const result = updateWith(dir, "a: [\n")
  assert.equal(result.status, 2)
  const { error } = JSON.parse(result.stdout)
  assert.equal(error.code, "INVALID_INPUT")
  assert.match(error.message, /is not valid YAML/)
})
