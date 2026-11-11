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
  'Tracker', 'Git host', 'Adapter', 'Issue', 'Sub-issue', 'Epic', 'Sprint', 'Status', 'Category', 'Blocked', 'Blocker chain', 'Critical path', 'Release notes', 'Event',
  'Synthetic event', 'Drift', 'Capability', 'Capability manifest', 'Member', 'Actor', 'Local tracker', 'Write policy', 'Dry run', 'Tracker format', 'Migration',
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

test('the plugin manifest has a GitHub repository URL', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'))
  assert.match(manifest.repository, /^https:\/\/github\.com\/[^/]+\/[^/]+$/)
})

test('both config schemas exist and parse as JSON', () => {
  for (const name of ['pmkit.config.schema.json', 'issues.config.schema.json']) {
    const file = path.join(ROOT, 'schemas', name)
    assert.ok(fs.existsSync(file), `schemas/${name} exists`)
    assert.equal(typeof JSON.parse(fs.readFileSync(file, 'utf8')), 'object', `schemas/${name} parses`)
  }
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
const COMMANDS = { '': ['setup', 'link-repo', 'help', 'upgrade'], issues: ['find', 'create', 'dependencies', 'update', 'move', 'assign', 'comment', 'link', 'summary', 'work', 'mine', 'capture', 'breakdown', 'progress', 'log-time', 'pause', 'estimate', 'delegate', 'track-agents', 'review', 'todos', 'security-alerts', 'unblock', 'delete', 'bulk', 'run-view', 'investigate-bug', 'inbox-digest'], spec: ['import', 'record-decision', 'adr-status'], backlog: ['groom', 'triage', 'prioritize-by-demand', 'request-queue'], report: ['status', 'release-notes', 'roadmap-review', 'initiatives-and-goals', 'release-readiness'], cycle: ['plan', 'close'], team: ['capacity', 'flow-metrics', 'standup', 'risk-radar', 'load'], linear: ['triage-rotation', 'customers'], local: ['doctor', 'render', 'migrate'] }

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
    for (const match of text.matchAll(/pmkit\.mjs" +([^\s`|]+)(?: +([^\s`|-][^\s`|]*))?(?: +([^\s`|-][^\s`|]*))?/g)) {
      const [, first, second, third] = match
      const name = [third ? `${first} ${second} ${third}` : null, second ? `${first} ${second}` : null, first].find((candidate) => candidate && known.has(candidate))
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

test('no command file puts a title, a name or a description on the shell command line, and conventions.md says how to write the files', () => {
  for (const file of markdownFiles(path.join(ROOT, 'commands'))) {
    // A title, a name or a description with an inline value (quoted, a placeholder or after `=`) in any command, on one line or broken over two.
    const inline = /--(title|name|description)(?:=|\s+)["'<$]/.exec(fs.readFileSync(file, 'utf8'))
    // A positional name taken from data would reach the shell: milestone and release ids come from the user or from a name that follows the id rule.
    const positional = /(?:milestone|release) create (?:<name>|["'])/.exec(fs.readFileSync(file, 'utf8'))
    assert.equal(positional, null, `${path.relative(ROOT, file)} passes a name as the positional id; pass an id that follows the id rule`)
    assert.equal(inline, null, `${path.relative(ROOT, file)} passes ${inline?.[0]} to the shell; use --${inline?.[1]}-file`)
  }
  const conventions = fs.readFileSync(path.join(ROOT, 'skills/pmkit/references/conventions.md'), 'utf8')
  assert.match(conventions, /file tool[^\n]*never[^\n]*`echo`/)
})

test('every command is listed in the skill table and in the README', () => {
  const skill = path.join(ROOT, 'skills/pmkit/SKILL.md')
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

test('record-decision.md covers the three places, the numbering, the bulk comments and a failed comment', () => {
  const text = fs.readFileSync(path.join(ROOT, 'commands/spec/record-decision.md'), 'utf8')
  const lines = text.split('\n')
  const step = (number) => {
    const from = lines.findIndex((line) => line.startsWith(`${number}. `))
    const to = lines.findIndex((line, index) => index > from && /^(\d+\. |## )/.test(line))
    return lines.slice(from, to).join('\n')
  }
  assert.match(step(3), /docs next-adr --title/, 'the CLI computes the number, the slug and the path')
  assert.match(step(3), /GIT_TERMINAL_PROMPT=0 git fetch origin <defaultBranch>/)
  assert.match(step(3), /20 seconds/)
  assert.match(step(3), /gitHost: none/, 'the fetch is skipped without a git host')
  assert.match(step(3), /already here/, 'a failed fetch keeps the local ref')
  assert.match(step(3), /INVALID_INPUT/)
  assert.match(step(5), /whatever `write_policy\.confirm` says/)
  assert.match(step(5), /Ask again after every change of the number or the path/)
  assert.match(step(5), /--dry-run/)
  assert.match(step(6), /no commit yet/, 'the preview warns that the repository file has no commit')
  assert.match(step(6), /bulk change/)
  assert.match(step(6), /unless `write_policy\.confirm` is `none`/, 'step 6 says what the Confirmation points say')
  assert.match(step(3), /only a valid branch name/)
  assert.match(step(2), /replaces older ADRs/, 'step 2 finds every replaced ADR the user names')
  assert.match(step(2), /docs adr-get <old number> --json/, 'the lookup only reads (PMK-263)')
  assert.doesNotMatch(step(2), /adr-status/)
  assert.match(step(4), /Supersedes: ADR <old number>, <old ref>/, 'the draft names each older ADR by number and ref')
  assert.match(step(4), /one line `Supersedes: ADR <old number>, <old ref>` per replaced ADR/, 'one Supersedes line per ADR (PMK-263)')
  assert.match(step(4), /replaces none, write no such line/, 'a decision with no older ADR is written as before')
  assert.match(step(7), /docs adr-status <old number> superseded --by <new number> --dry-run/)
  assert.match(step(7), /whatever `write_policy\.confirm` says/)
  assert.match(step(7), /When step 6 stopped on a failure, say so first/, 'step 7 mentions a step 6 failure before asking to mark (PMK-263)')
  assert.match(step(7), /bulk change/)
  assert.match(step(7), /list the ADRs marked and the ones left/)
  assert.match(step(1), /never ask again for a number the user named/)
  assert.match(step(1), /Count each ADR once, whatever the spelling of its number/, 'a repeated number is one ADR (PMK-263 review 2)')
  assert.match(step(4), /never two for the same ADR/)
  assert.match(step(7), /For each older ADR, once,/)
  assert.match(step(3), /higher than the new `number`, warn/, 'a replaced ADR newer than the new one is warned about (PMK-263)')
  assert.match(step(7), /is not marked/, 'a declined or failed mark leaves the older ADR alone and says so')
  assert.match(step(2), /`ref` is the path without the display label `tracker:`/, 'the Supersedes line takes ref, never the tracker: label')
  assert.match(step(4), /never the `path`/)
  assert.match(step(2), /any of the `statuses` already says superseded by another ADR/, 'step 2 warns before step 7 replaces a mark')
  assert.match(step(6), /When a comment or a `docs` update fails, stop step 6 there: do not retry, do not run the rest of the comments or links, and do not delete the ADR/, 'a failed write in the batch stops it, as before PMK-251')
  assert.match(step(6), /Step 8 lists what changed and what is left/)
  assert.match(step(4), /right under a status line when the ADR format puts one there/)
  assert.match(step(8), /List the issues that got the comment and the `docs` link and the ones that did not/)
  assert.match(step(8), /did not/)
  assert.doesNotMatch(text, /\.issues\/docs\/adr/, 'the tracker folder comes from the CLI, not from the file')
  assert.doesNotMatch(text, /Status:|## Context|## Decision/, 'the format is the one of the ADRs in docs/adr/')
  assert.match(text, /renames its file/)
})

test('delegate.md previews in step 5, writes in step 6, always asks, and runs the agent only after a question', () => {
  const text = fs.readFileSync(path.join(ROOT, 'commands/issues/delegate.md'), 'utf8')
  const step = (number) => text.split('\n').find((line) => line.startsWith(`${number}. `)) ?? ''
  const calls = (line) => [...line.matchAll(/pmkit\.mjs" issues delegate[^`]*`/g)].map((match) => match[0])
  assert.ok(calls(step(5)).length > 0 && calls(step(5)).every((call) => call.includes('--dry-run')), 'step 5 previews with --dry-run')
  assert.ok(calls(step(6)).length > 0 && calls(step(6)).every((call) => !call.includes('--dry-run')), 'step 6 writes without --dry-run')
  assert.match(step(5), /AskUserQuestion/)
  assert.match(step(5), /write_policy\.confirm: none/)
  assert.match(step(7), /AskUserQuestion/)
  assert.match(step(7), /--as <agent>/)
  assert.match(step(7), /commands\/issues\/work\.md/)
})

test('triage-rotation.md previews the set in step 6 and writes it in step 7', () => {
  const text = fs.readFileSync(path.join(ROOT, 'commands/linear/triage-rotation.md'), 'utf8')
  const step = (number) => text.split('\n').find((line) => line.startsWith(`${number}. `)) ?? ''
  const calls = (line) => [...line.matchAll(/pmkit\.mjs" linear triage set[^`]*`/g)].map((match) => match[0])
  assert.ok(calls(step(6)).length > 0 && calls(step(6)).every((call) => call.includes('--dry-run')), 'step 6 previews with --dry-run')
  assert.ok(calls(step(7)).length > 0 && calls(step(7)).every((call) => !call.includes('--dry-run')), 'step 7 writes without --dry-run')
  assert.match(step(5), /AskUserQuestion/)
})

test('customers.md previews set and link in step 5 and writes them in step 6', () => {
  const text = fs.readFileSync(path.join(ROOT, 'commands/linear/customers.md'), 'utf8')
  const step = (number) => text.split('\n').find((line) => line.startsWith(`${number}. `)) ?? ''
  const calls = (line, verb) => [...line.matchAll(new RegExp(`pmkit\\.mjs" linear customers ${verb}[^\`]*\``, 'g'))].map((match) => match[0])
  for (const verb of ['set', 'link']) {
    assert.ok(calls(step(5), verb).length > 0 && calls(step(5), verb).every((call) => call.includes('--dry-run')), `step 5 previews ${verb} with --dry-run`)
    assert.ok(calls(step(6), verb).length > 0 && calls(step(6), verb).every((call) => !call.includes('--dry-run')), `step 6 writes ${verb} without --dry-run`)
  }
  assert.match(step(4), /AskUserQuestion/)
  assert.match(step(5), /AskUserQuestion/)
})

test('migrate.md previews before every write', () => {
  const text = fs.readFileSync(path.join(ROOT, 'commands/local/migrate.md'), 'utf8')
  const lines = text.split('\n')
  const steps = lines.slice(lines.indexOf('## Steps') + 1, lines.indexOf('## Confirmation points')).join('\n').split(/\n(?=\d+\. )/)
  const calls = (step) => [...step.matchAll(/pmkit\.mjs" local-migrate (export|import|undo|switch)[^`]*`/g)].map((match) => ({ verb: match[1], call: match[0] }))
  let writes = 0
  steps.forEach((step, index) => {
    for (const { verb, call } of calls(step).filter(({ call }) => !call.includes('--dry-run'))) {
      writes += 1
      const preview = steps.slice(0, index).findIndex((earlier) => calls(earlier).some((found) => found.verb === verb && found.call.includes('--dry-run')))
      assert.ok(preview >= 0, `${call} has an earlier --dry-run`)
      const asks = steps.slice(preview, index + 1).some((between) => /AskUserQuestion/.test(between))
      assert.ok(asks, `${call} asks with AskUserQuestion after its preview`)
      if (verb !== 'switch') assert.ok(call.includes('--expect'), `${call} carries --expect`)
    }
  })
  assert.ok(writes >= 4, 'the export, import, undo and switch writes are all there')
})

test('upgrade.md carries the pieces the upgrade flow needs', () => {
  const text = fs.readFileSync(path.join(ROOT, 'commands/upgrade.md'), 'utf8')
  for (const needle of ['--accept-command', 'migrate --dry-run', '/reload-plugins']) assert.ok(text.includes(needle), `upgrade.md mentions ${needle}`)
  assert.doesNotMatch(text, /\s-y\b/)
})

test('the routing skill has a name and a description', () => {
  const data = parseYaml(splitFrontmatter(fs.readFileSync(path.join(ROOT, 'skills/pmkit/SKILL.md'), 'utf8')).yaml)
  assert.equal(data.name, 'pmkit')
  assert.ok(data.description && data.description.length > 20)
})

test('no command file puts a git_host.default_branch value in a shell command without the default-branch check (PMK-192)', () => {
  const dir = path.join(ROOT, 'commands')
  const files = markdownFiles(dir).filter((file) => !file.endsWith(`${path.sep}link-repo.md`))
  const offending = []
  for (const file of files) {
    for (const [index, line] of fs.readFileSync(file, 'utf8').split('\n').entries()) {
      const readsConfig = line.includes('git_host.default_branch')
      const shellBase = /git (log|diff)[^`]*<(base|default branch)>/.test(line)
      if ((readsConfig || shellBase) && !line.includes('default-branch --json')) offending.push(`${path.relative(ROOT, file)}:${index + 1}`)
    }
  }
  assert.deepEqual(offending, [])
  for (const name of ['issues/pause', 'issues/progress', 'issues/review', 'issues/investigate-bug', 'issues/work']) {
    assert.match(fs.readFileSync(path.join(dir, `${name}.md`), 'utf8'), /pmkit\.mjs" default-branch --json/, name)
  }
})

test('bulk.md tells what to do with NOT_FOUND and CONFLICT from a one-issue batch, and keeps the digest CONFLICT for the real run', () => {
  const text = fs.readFileSync(path.join(ROOT, 'commands/issues/bulk.md'), 'utf8')
  assert.match(text, /`NOT_FOUND` or `CONFLICT` and the filter matched exactly one issue/)
  assert.match(text, /Do not run the same dry run again/)
  assert.match(text, /`CONFLICT` without `result` on a real run with `--expect`/)
})

// PMK-229: text from data (a path, a pattern) never goes into a shell command between double quotes, where $(...) and backticks run,
// and a `git grep` never takes a pattern that can be read as an option.
test('command files hold text from data out of double quotes, and git grep takes its pattern with -F and -e or -f', () => {
  const offending = []
  for (const file of commandFiles()) {
    for (const [index, line] of fs.readFileSync(file, 'utf8').split('\n').entries()) {
      const at = `${path.relative(ROOT, file)}:${index + 1}`
      if (/"[^"\s]*<(path|pattern)>[^"\s]*"/.test(line)) offending.push(`${at}: <path> or <pattern> between double quotes`)
      for (const match of line.matchAll(/`(git grep [^`]*)`/g)) {
        if (!/ -F /.test(` ${match[1]} `) || !/ -(e|f) /.test(` ${match[1]} `)) offending.push(`${at}: ${match[1]} needs -F and -e or -f`)
      }
    }
  }
  assert.deepEqual(offending, [])
  // PMK-217: a branch from the tracker goes into a command only after the validBranch check, and between double quotes there
  // (a valid name holds no $ or backtick). These files still pass a bare <branch>: follow-up, not yet hardened.
  const BARE_BRANCH = ['commands/issues/inbox-digest.md', 'commands/issues/mine.md', 'commands/issues/unblock.md', 'commands/issues/work.md', 'commands/team/standup.md']
  const bare = []
  for (const file of commandFiles()) {
    const rel = path.relative(ROOT, file)
    const text = fs.readFileSync(file, 'utf8')
    const spans = [...text.matchAll(/`([^`]*<branch>[^`]*)`/g)].map((m) => m[1]).filter((span) => /pmkit\.mjs|^git /.test(span))
    if (spans.length === 0 || BARE_BRANCH.includes(rel)) continue
    for (const span of spans) if (span.replace(/"[^"]*"/g, '').includes('<branch>')) bare.push(`${rel}: ${span}`)
    if (!/the rule of `validBranch`/.test(text)) bare.push(`${rel}: puts <branch> in a command without the validBranch check`)
  }
  assert.deepEqual(bare, [])
  // The rule itself, so the two checks above have a reason that the agent reads.
  assert.match(fs.readFileSync(path.join(ROOT, 'skills/pmkit/references/conventions.md'), 'utf8'), /## Text from data in a command/)
})

test('cycle:plan takes the members of the configured team only, which is what cycle capacity accepts on Linear', () => {
  const text = fs.readFileSync(path.join(ROOT, 'commands/cycle/plan.md'), 'utf8')
  assert.match(text, /drop each member whose `teams` does not list it/)
  assert.match(text, /for the members of the team only/)
})
