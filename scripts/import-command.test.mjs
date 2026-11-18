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

// The final review of PMK-347.

test('on Linear and GitHub a spec read from docs/specs/ is already stored there', () => {
  const block = step(3)
  assert.match(block, /`NOT_SUPPORTED`[^]*repository file under `docs\/specs\/`[^.]*already stored/)
  assert.match(block, /already stored[^]*Documents cites that path[^]*nothing is written in step 7\.1/)
  assert.match(block, /no existence check/)
  assert.match(step(5), /already stored[^]*two choices: create everything, or stop/)
  const missing = section('If something is missing')
  assert.match(missing, /`NOT_SUPPORTED`[^\n]*already stored/)
})

test('a CONFLICT in step 3 offers another name or not storing the spec', () => {
  const conflict = step(3).split('\n').find((line) => line.includes('- `CONFLICT`')) ?? ''
  assert.match(conflict, /another name/)
  assert.match(conflict, /without storing the spec/)
})

test('a stop after the spec is stored names the continue command with the stored path', () => {
  const block = step(7)
  assert.ok(block.includes('/pmkit:spec:import <stored path> [<epic-id>]'), 'step 7 lacks the continue command')
  assert.match(block, /stored path is `specs\/<name>\.md` on the local tracker/)
  assert.match(block, /`docs\/specs\/<name>\.md` on Linear and GitHub/)
  assert.match(block, /new epic ID when the epic exists/)
  assert.match(block, /already stored[^.]*no second copy/)
  assert.match(step(8), /stop as step 7 says/)
  assert.match(step(1), /relative to the `docs\/` folder, such as `specs\/<name>\.md`/)
})

test('step 7.1 checks again that the repository file is absent just before it writes it', () => {
  const block = step(7)
  assert.match(block, /just before the write, check again with the file tools that `docs\/specs\/<name>\.md` is still absent/i)
  assert.match(block, /When it exists, stop before the epic, as for `CONFLICT`/)
})

test('an UPSTREAM that starts with "GitHub created the Project" always lists the epic as created', () => {
  const block = step(7)
  assert.match(block, /starts with `GitHub created the Project`[^.]*the epic exists/)
  assert.match(block, /`could not set its readme`[^.]*has no description/)
  assert.match(block, /`--start` or `--target`[^.]*next step[^.]*status update/)
})

test('without storing, Documents cites the source path only for a file inside the repository', () => {
  const block = step(5)
  assert.match(block, /inside the repository[^.]*relative to the repository root/)
  assert.match(block, /Otherwise[^.]*Documents section is left out/)
  assert.doesNotMatch(block, /Ask once/)
  assert.match(block, /replaces the first/)
})

test('a pasted spec with no title gets a storage name from the user', () => {
  assert.match(section('If something is missing'), /no title[^\n]*ask for a storage name[^\n]*same rule/)
})

// The review-work findings of PMK-347.

test('a path or an epic ID from the user reaches the shell between single quotes', () => {
  // Each pmkit.mjs call of the command file, up to its closing backtick.
  const calls = [...text.matchAll(/pmkit\.mjs" ([^`]*)/g)].map((match) => match[1])
  const reads = calls.filter((call) => call.startsWith('docs read '))
  assert.equal(reads.length, 1, 'step 1 reads the spec')
  assert.deepEqual(reads, ["docs read '<path>' --json"])
  assert.ok(calls.includes("epic get '<epic-id>' --json"), 'the epic ID the user gives is quoted')
  const bare = calls.flatMap((call) => [...call.replace(/'[^']*'/g, '').matchAll(/<(path|epic-id)>/g)].map((match) => match[0]))
  assert.deepEqual(bare, [], 'no call holds the path or the epic ID bare')
  assert.match(step(1), /`'\\''`/, 'step 1 says how to quote')
  assert.match(step(2), /quoted as the path of step 1, because it comes from the user/)
  assert.match(step(1), /The path comes from the user/)
  assert.match(step(1), /Refuse a path with a newline/)
  assert.match(step(2), /[Ll]ater calls use the `id` that `epic get` returned/)
  assert.ok(step(2).includes('issues list --parent <id> --json'), 'issues list uses the returned id')
})

test('when from-prd follows step 7, its own stop rule names the continue command', () => {
  assert.match(step(7), /When `\/pmkit:spec:from-prd` follows this step, its own stop rule names the continue command/)
})

test('the step 5 confirmation point says when step 5 asks only create or stop', () => {
  const point = section('Confirmation points').split('\n').find((line) => line.startsWith('- Step 5:')) ?? ''
  assert.match(point, /chose in step 3 to go on without storing[^.]*only[^.]*create everything or stop/)
  assert.match(point, /without storing[^.]*second question[^.]*replaces the first/)
})

test('step 3 calls itself this step', () => {
  assert.doesNotMatch(step(3), /step 3 runs no existence check/)
  assert.match(step(3), /this step runs no existence check/)
})
