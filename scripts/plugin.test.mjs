import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
