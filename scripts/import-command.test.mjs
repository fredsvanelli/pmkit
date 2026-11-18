// Static checks of commands/spec/import.md for PMK-347: the spec is stored before the epic, and a new epic gets a description.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'commands', 'spec', 'import.md')
const text = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n')

// The numbered steps of the command: a line that starts with `<n>. ` and its continuation lines, up to the next numbered step or `## ` heading.
const steps = (() => {
  const blocks = []
  let current = null
  for (const line of text.split('\n')) {
    if (/^\d+\. /.test(line)) {
      current = [line]
      blocks.push(current)
    } else if (/^## /.test(line)) {
      current = null
    } else if (current) {
      current.push(line)
    }
  }
  return blocks.map((block) => block.join('\n'))
})()

// The top-level step numbered `n`, with its sub-steps.
const step = (n) => steps.find((block) => block.startsWith(`${n}. `)) ?? ''

// The text of a `## ` section, up to the next `## ` heading.
const section = (name) => text.split(/\n(?=## )/).find((block) => block.startsWith(`## ${name}\n`)) ?? ''

test('step 3 drafts the epic description in the template', () => {
  const block = step(3)
  for (const heading of ['### Purpose', '### Scope (in)', '### Out of scope', '### Documents']) {
    assert.ok(block.includes(heading), `step 3 lacks ${heading}`)
  }
})

test('step 3 runs the docs create dry run before the tree is shown', () => {
  const block = step(3)
  assert.ok(block.includes('docs create specs/<name>.md --body-file <file> --dry-run --json'))
  assert.match(block, /`CONFLICT`/)
  assert.match(block, /`NOT_SUPPORTED`/)
  assert.match(block, /repository file `docs\/specs\/<name>\.md`/)
})

test('step 5 offers to store the spec, create without storing it, or stop', () => {
  const block = step(5)
  assert.match(block, /three choices/)
  assert.match(block, /store the spec/)
  assert.match(block, /without storing the spec/)
  assert.match(block, /stop/)
  assert.match(block, /already under the tracker's `docs\/` folder[^]*two choices/)
})

test('step 7 stores the spec before the epic', () => {
  const block = step(7)
  const docs = block.indexOf('docs create')
  const epic = block.indexOf('epic create')
  assert.ok(docs >= 0, 'step 7 has no docs create')
  assert.ok(epic >= 0, 'step 7 has no epic create')
  assert.ok(docs < epic, 'step 7 creates the epic before it stores the spec')
  assert.match(block.slice(epic), /^epic create [^`]*--description-file <epic description file>[^`]*--json`/)
})

test('the epic dry run of step 6 carries the description', () => {
  assert.match(step(6), /epic create --title-file <epic title file> --description-file <epic description file> [^`]*--dry-run --json/)
})

test('no step stores the spec after the issues', () => {
  for (const n of [8, 9, 10, 11]) assert.doesNotMatch(step(n), /docs create/, `step ${n} stores the spec`)
  assert.doesNotMatch(step(10), /store/, 'step 10 removes the temporary files only')
  assert.match(step(10), /temporary files/)
})

test('Documents paths are relative to the repository root', () => {
  const block = step(3)
  assert.match(block, /relative to the repository root/)
  assert.ok(block.includes('.issues/docs/specs/<name>.md'), 'step 3 lacks the tracker document path from the repository root')
})

test('a repository spec file is said to have no commit', () => {
  assert.match(section('Output'), /`docs\/specs\/<name>\.md` has no commit yet/)
})

test('an existing epic gets no description', () => {
  assert.match(text, /With an `epic-id`[^.]*no description is drafted/)
})

test('the step 10 confirmation point is gone and step 5 covers the spec', () => {
  const points = section('Confirmation points')
  assert.doesNotMatch(points, /Step 10/)
  assert.match(points, /- Step 5:[^\n]*spec/)
})

test('a GitHub readme that fails after the create stops with the epic ID and the drafted description', () => {
  const block = step(7)
  assert.match(block, /`UPSTREAM`/)
  assert.match(block, /new epic ID/)
  assert.match(block, /has no description/)
  assert.match(block, /show the drafted description[^.]*readme by hand/)
  assert.match(block, /`epic update`[^.]*PMK-348/)
})
