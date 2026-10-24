import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseChangelog } from './lib/changelog.mjs'
import { FORMAT_VERSION } from './lib/local/migrations.mjs'
import { splitFrontmatter, parseYaml } from './lib/yaml.mjs'
import { COMMANDS as CLI_COMMANDS } from './pmkit.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const TERMS = [
  'Tracker', 'Git host', 'Adapter', 'Issue', 'Sub-issue', 'Epic', 'Sprint', 'Status', 'Category', 'Blocked', 'Event',
  'Synthetic event', 'Drift', 'Capability', 'Capability manifest', 'Member', 'Actor', 'Local tracker', 'Write policy', 'Dry run',
]

function markdownFiles(dir = ROOT) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__fixtures__' || entry.name === 'node_modules' ? [] : markdownFiles(full)
    return entry.name.endsWith('.md') ? [full] : []
  })
}

test('the plugin manifest names pmkit and its version', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'))
  assert.equal(manifest.name, 'pmkit')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  assert.equal(typeof manifest.description, 'string')
})

test('package.json has no dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.dependencies, undefined)
  assert.equal(pkg.devDependencies, undefined)
})

test('every ${CLAUDE_PLUGIN_ROOT} path in the plugin docs exists', () => {
  const missing = []
  for (const file of markdownFiles()) {
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)) {
      const target = match[1].replace(/[.]+$/, '')
      if (!fs.existsSync(path.join(ROOT, target))) missing.push(`${path.relative(ROOT, file)} -> ${target}`)
    }
  }
  assert.deepEqual(missing, [])
})

test('CONTEXT.md defines every term of the model', () => {
  const text = fs.readFileSync(path.join(ROOT, 'CONTEXT.md'), 'utf8')
  const defined = [...text.matchAll(/^\*\*(.+?)\*\*:$/gm)].map((match) => match[1])
  assert.deepEqual(TERMS.filter((term) => !defined.includes(term)), [])
})

function scriptFiles(dir = path.join(ROOT, 'scripts')) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__fixtures__' ? [] : scriptFiles(full)
    return entry.name.endsWith('.mjs') ? [full] : []
  })
}

test('no script holds a literal U+FEFF; BOM regexes and tests use the \\uFEFF escape', () => {
  const holders = scriptFiles().filter((file) => fs.readFileSync(file, 'utf8').includes('\uFEFF'))
  assert.deepEqual(holders.map((file) => path.relative(ROOT, file)), [])
})

test('CHANGELOG.md has a section for the plugin version and a Tracker format that matches FORMAT_VERSION', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'))
  const sections = parseChangelog(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'))
  assert.ok(sections.some((section) => section.version === manifest.version), `no section for ${manifest.version}`)
  const newest = sections.find((section) => section.trackerFormat !== null)
  if (newest) assert.equal(newest.trackerFormat, FORMAT_VERSION)
  else assert.equal(FORMAT_VERSION, 1)
})

// Each Task that writes command files adds their names here.
const COMMANDS = { '': ['setup', 'help', 'upgrade'], issues: ['find', 'create', 'update', 'move', 'assign', 'comment', 'link', 'summary', 'work', 'mine', 'capture', 'breakdown', 'progress', 'pause'], spec: [], backlog: [], report: [], cycle: [], team: [], local: [] }

const HEADINGS = ['## Parameters', '## Steps', '## Confirmation points', '## Output', '## If something is missing']

function commandFiles() {
  const dir = path.join(ROOT, 'commands')
  return fs.existsSync(dir) ? markdownFiles(dir) : []
}

test('every command has its frontmatter keys and its six sections in order', () => {
  for (const file of commandFiles()) {
    const rel = path.relative(ROOT, file)
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    const parts = splitFrontmatter(text)
    assert.ok(parts, `${rel} has no frontmatter`)
    const data = parseYaml(parts.yaml)
    assert.equal(typeof data.description, 'string', `${rel} description`)
    assert.equal(typeof data['argument-hint'], 'string', `${rel} argument-hint`)
    assert.equal(data['disable-model-invocation'], true, `${rel} disable-model-invocation`)
    const lines = parts.body.split('\n')
    const title = lines.findIndex((line) => /^# \S/.test(line))
    assert.ok(title >= 0, `${rel} has a title`)
    assert.ok(lines.includes('Arguments: `$ARGUMENTS`'), `${rel} shows its arguments`)
    let last = title
    for (const heading of HEADINGS) {
      const at = lines.indexOf(heading, last + 1)
      assert.ok(at > last, `${rel} has ${heading} in order`)
      last = at
    }
    const steps = lines.slice(lines.indexOf('## Steps') + 1).filter((line) => line.trim() !== '')
    assert.equal(steps[0], 'Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.', `${rel} reads the conventions first`)
  }
})

test('every pmkit.mjs call in a command names a command of the CLI', () => {
  const known = new Set(CLI_COMMANDS.map((command) => command.name))
  const bad = []
  for (const file of commandFiles()) {
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(/pmkit\.mjs" +([^\s`|]+)(?: +([^\s`|-][^\s`|]*))?/g)) {
      const [, first, second] = match
      const name = [second ? `${first} ${second}` : null, first].find((candidate) => candidate && known.has(candidate))
      if (!name) bad.push(`${path.relative(ROOT, file)}: ${match[0]}`)
    }
  }
  assert.deepEqual(bad, [])
})

for (const [folder, names] of Object.entries(COMMANDS)) {
  const dir = folder ? `commands/${folder}` : 'commands'
  test(`the ${names.length} commands in ${dir} exist`, () => {
    const full = path.join(ROOT, dir)
    const found = fs.existsSync(full)
      ? fs.readdirSync(full, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => path.basename(entry.name, '.md')).sort()
      : []
    assert.deepEqual(found, [...names].sort())
  })
}

test('every command is listed in the skill table and in the README', (t) => {
  const skill = path.join(ROOT, 'skills/pmkit/SKILL.md')
  if (!fs.existsSync(skill)) return t.skip('skills/pmkit/SKILL.md does not exist yet')
  for (const doc of [skill, path.join(ROOT, 'README.md')]) {
    const text = fs.readFileSync(doc, 'utf8')
    for (const [folder, names] of Object.entries(COMMANDS)) {
      for (const name of names) {
        const command = folder ? `${folder}:${name}` : name
        assert.match(text, new RegExp(`/pmkit:${command}(?![\\w:-])`), `${path.relative(ROOT, doc)} lists ${command}`)
      }
    }
  }
})

test('upgrade.md carries the pieces the upgrade flow needs', () => {
  const text = fs.readFileSync(path.join(ROOT, 'commands/upgrade.md'), 'utf8')
  for (const needle of ['--accept-command', 'migrate --dry-run', '/reload-plugins']) assert.ok(text.includes(needle), `upgrade.md mentions ${needle}`)
  assert.doesNotMatch(text, /\s-y\b/)
})
