// Static checks of commands/spec/from-prd.md for PMK-338: the command file is the product, so the rules are pinned in its text.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'commands', 'spec', 'from-prd.md')
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

// The step whose text holds `<name>:`, such as `Stage 0:`. `stage('Stage 3')` never returns the step of `Stage 3b:`.
const stage = (name) => steps.find((step) => step.includes(`${name}:`)) ?? ''

// The text of a `## ` section, up to the next `## ` heading.
const section = (name) => text.split(/\n(?=## )/).find((block) => block.startsWith(`## ${name}\n`)) ?? ''

// The rules of `## Steps` that come before the first numbered step, such as the stop rule.
const preamble = section('Steps').split(/\n(?=1\. )/)[0]

test('stage 0 reads with a subagent that writes nothing, and runs in sequence without one', () => {
  const step = stage('Stage 0')
  assert.match(step, /subagent/)
  assert.match(step, /writes nothing/)
  assert.match(step, /without subagents/i)
  assert.match(step, /issues list --text/)
  assert.match(step, /epic list --json/)
  assert.match(step, /docs list --json/)
})

test('likely duplicates are shown before the first question', () => {
  const step = stage('Stage 0')
  assert.match(step, /duplicate/)
  assert.match(step, /AskUserQuestion/)
})

test('the interview asks one question per message and nothing technical', () => {
  const step = stage('Stage 1')
  assert.match(step, /one question per message/)
  assert.match(step, /never asks? about technology, architecture or storage/)
})

test('the interview skips what the PRD, the recon or the code answer', () => {
  const step = stage('Stage 1')
  assert.match(step, /Skip any question the PRD/)
  assert.match(step, /go(es)? to the code, not to the PM/)
})

test('the interview covers scope, use cases and criteria, with error and edge cases', () => {
  const step = stage('Stage 1')
  assert.match(step, /scope/)
  assert.match(step, /use cases?/)
  assert.match(step, /acceptance criteri/)
  assert.match(step, /edge cases?/)
})

test('each decision is marked ADR or PRD only, and ADR means hard to reverse', () => {
  const step = stage('Stage 1')
  assert.match(step, /`ADR`/)
  assert.match(step, /`PRD only`/)
  assert.match(step, /hard to reverse/)
})

test('the interview stops on coverage, with a soft limit of 15 questions', () => {
  const step = stage('Stage 1')
  assert.match(step, /at least one acceptance criterion/)
  assert.match(step, /15 questions/)
})

test('an early stop sends the gaps to Open questions and the import marks them needs criteria', () => {
  const step = stage('Stage 1')
  assert.match(step, /Open questions/)
  assert.match(step, /needs criteria/)
})

test('stage 2 approves the content and the path, and does not write the file', () => {
  const step = stage('Stage 2')
  assert.match(step, /docs create specs\/<slug>-prd\.md --body-file <file> --dry-run --json/)
  assert.match(step, /AskUserQuestion/)
  assert.match(step, /Stage 3b/)
})

test('each ADR follows record-decision and is asked one by one', () => {
  const step = stage('Stage 3')
  assert.match(step, /commands\/spec\/record-decision\.md/)
  assert.match(step, /once per ADR|one approval per ADR/)
})

test('an ADR cites the refined PRD path and has no related issues yet', () => {
  const step = stage('Stage 3')
  assert.match(step, /names the refined PRD path/)
  assert.match(step, /stage 6 links them/i)
})

test('a declined ADR becomes PRD only and the flow goes on', () => {
  const step = stage('Stage 3')
  assert.match(step, /declines one ADR[^.]*`PRD only`/)
  assert.match(step, /never stops the flow/)
})

test('stage 3b writes the refined PRD after the ADRs, with no new approval', () => {
  const step = stage('Stage 3b')
  assert.match(step, /docs create/)
  assert.match(step, /after the ADRs/)
  assert.match(step, /no new approval|covers it/)
})

test('a taken path asks for a new name and names both paths', () => {
  const step = stage('Stage 3b')
  assert.match(step, /`CONFLICT`/)
  assert.match(step, /both paths/)
})

test('a tracker that cannot create documents gets a repository file', () => {
  const step = stage('Stage 3b')
  assert.match(step, /`NOT_SUPPORTED`/)
  assert.match(step, /docs\/specs\/<slug>-prd\.md/)
})

test('an unknown epic-id is a main agent question, not a recon subagent action', () => {
  const step = stage('Stage 0')
  assert.match(step, /the main agent asks for a corrected ID before the first question/)
  assert.doesNotMatch(step, /stops the flow before the first question/)
})

test('the epic and milestones are approved before any issue', () => {
  const step = stage('Stage 4')
  assert.match(step, /commands\/spec\/import\.md/)
  assert.match(step, /AskUserQuestion/)
})

test('drafting subagents copy the criteria from the refined PRD and never invent them', () => {
  const step = stage('Stage 5')
  assert.match(step, /subagent/)
  assert.match(step, /never new ones|never invent/)
  assert.match(step, /without subagents/i)
})

test('draft estimates use done issues, not issues similar', () => {
  const step = stage('Stage 5')
  assert.match(step, /issues list --category done --text/)
  assert.match(step, /code alone/)
  assert.doesNotMatch(step, /issues similar <id>/)
})

test('the tree is shown in full and the links follow spec:import', () => {
  const step = stage('Stage 5')
  assert.match(step, /full tree/)
  assert.match(step, /issues link/)
})

test('the final check reads and reports, and fixes only with approval', () => {
  const step = stage('Stage 6')
  assert.match(step, /issues dependencies <epic-id> --json/)
  assert.match(step, /requirements? .*with no issue/)
  assert.match(step, /one bulk preview/)
  assert.match(step, /never as an issue created without approval/)
})

test('no subagent writes', () => {
  assert.match(text, /No subagent writes to the tracker/)
})

test('a resume skips existing ADRs in the tracker and in the repository', () => {
  const step = stage('Resume')
  assert.match(step, /docs list/)
  assert.match(step, /docs\/adr\//)
  assert.match(step, /skips? the decisions that already have one/)
})

test('the resume step comes before the interview', () => {
  assert.ok(stage('Resume'), 'a step holds `Resume:`')
  assert.ok(steps.indexOf(stage('Resume')) < steps.indexOf(stage('Stage 1')), 'the resume step comes before stage 1')
})

test('a declined stage lists what was written and names the next command', () => {
  assert.match(preamble, /\/pmkit:spec:from-prd specs\/<slug>-prd\.md/)
  assert.match(preamble, /lists what it already wrote/)
  assert.match(preamble, /[Bb]efore Stage 3b[^.]*`\/pmkit:spec:from-prd <prd>`/)
})

test('the continue command names the epic ID the flow knows', () => {
  assert.match(preamble, /epic ID[^.]*given, chosen in Stage 0 or created in Stage 4/)
  assert.match(preamble, /`\/pmkit:spec:from-prd specs\/<slug>-prd\.md <epic-id>`/)
})

test('any stop during stage 3 stores the refined PRD first, so no ADR is recorded twice', () => {
  assert.match(preamble, /[Aa]ny stop during Stage 3[^.]*stores the refined PRD first/)
  const step = stage('Stage 3')
  assert.match(step, /[Aa]ny stop during Stage 3[^.]*PM says stop[^.]*CLI fails/)
  assert.match(step, /[Bb]efore the stop, Stage 3b stores the refined PRD/)
  assert.match(step, /no ADR is recorded twice/)
})

test('a stop at a stage 3b CONFLICT lists the ADRs written and the path they cite', () => {
  assert.match(stage('Stage 3b'), /`CONFLICT`[^\n]*stop there lists the ADRs written and the path they cite/)
})

test('no subagent writes to the tracker or asks the PM anything', () => {
  assert.match(preamble, /No subagent writes to the tracker or asks the PM anything/)
})

test('the confirmation points list every approval', () => {
  const points = section('Confirmation points').split('\n')
  const point = (name) => points.find((line) => line.startsWith(`- ${name}:`)) ?? ''
  assert.match(point('Stage 2'), /the refined PRD, its content and its path/)
  assert.match(point('Stage 3'), /each ADR, one approval per ADR/)
  assert.match(point('Stage 4'), /the epic with its milestones/)
  assert.match(point('Stage 5'), /the full issue tree/)
  assert.match(point('Stage 6'), /the extra links of the final check/)
})

test('stage 6 runs the same checklist without subagents', () => {
  assert.match(stage('Stage 6'), /[Ww]ithout subagents, the main agent runs the same checklist/)
})

test('the stage 6 checker counts the issues the epic already held, from the stage 5 list', () => {
  const step = stage('Stage 6')
  assert.match(step, /the issues the epic already held, from the `issues list --parent` result of Stage 5/)
  assert.doesNotMatch(step, /issues list --parent <epic-id>/, 'stage 6 reuses the stage 5 result and runs no new list')
})

test('the stage 6 checker gets the ADRs of stage 3 and those the resume found', () => {
  assert.match(stage('Stage 6'), /the ADRs of Stage 3 and those the Resume step found/)
})

test('stage 5 says so and goes on to stage 6 when the epic already holds every row', () => {
  assert.match(stage('Stage 5'), /no row is left[^.]*go on to Stage 6 without asking/)
})

test('an ADR decision in the refined PRD carries its context and rejected alternatives', () => {
  assert.match(stage('Stage 2'), /`ADR` decision[^.]*context and the rejected alternatives/)
})

test('each ADR keeps Related issues: none, and the links live in the issue comments and docs lists', () => {
  assert.match(stage('Stage 3'), /keeps "Related issues: none"[^.]*no `docs update`/)
  assert.match(section('Output'), /"Related issues: none"[^.]*issue comments and the `docs` lists of Stage 6/)
})

test('CONTEXT.md stores the refined PRD in the tracker docs folder or the repository, and does not call a spec one issue design', () => {
  const context = fs.readFileSync(path.join(path.dirname(FILE), '..', '..', 'CONTEXT.md'), 'utf8')
  const entry = context.split(/\n(?=\*\*)/).find((block) => block.startsWith('**Refined PRD**:')) ?? ''
  assert.match(entry, /`specs\/<slug>-prd\.md` in the tracker's docs folder, or `docs\/specs\/<slug>-prd\.md` in the repository when the tracker cannot create documents/)
  assert.doesNotMatch(entry, /technical design of one issue/)
})

test('the output ends with the critical path and cycle:plan', () => {
  const output = section('Output')
  assert.match(output, /critical path/)
  assert.match(output, /\/pmkit:cycle:plan/)
})

test('the output lists the changed marks, says a repository PRD has no commit, and removes the temporary files', () => {
  const output = section('Output')
  assert.match(output, /changed mark/)
  assert.match(output, /no commit yet/)
  assert.match(output, /[Rr]emove the temporary files/)
})

test('a docs-relative path such as the resume input goes to docs read, with the repository file as fallback', () => {
  const step = stage('Stage 0')
  assert.match(section('Parameters'), /specs\/<slug>-prd\.md/)
  assert.match(step, /path relative to the `docs\/` folder, such as `specs\/<slug>-prd\.md`/)
  assert.match(step, /`NOT_FOUND`[^.]*repository file `docs\/<path>`/)
})

test('stage 3 keeps the refined PRD temporary file that record-decision would remove', () => {
  assert.match(stage('Stage 3'), /[Kk]eep the temporary file of the refined PRD/)
})

test('stage 3b checks a new name with a dry run before writing', () => {
  assert.match(stage('Stage 3b'), /`CONFLICT`[^\n]*dry run again with the new name/)
})

test('a CLI error during an ADR write stops the flow, unlike a declined ADR', () => {
  const step = stage('Stage 3')
  assert.match(step, /error from the CLI[^.]*stops the flow/)
  assert.match(step, /each decision not yet reached, or whose write failed, still marked `ADR`/)
  assert.match(step, /stops as the rule above the steps says/)
  assert.doesNotMatch(step, /\/pmkit:spec:from-prd specs/, 'the stop rule names the command, since stage 3b can fail too')
})

test('a resume needs a refined PRD in the specs folder and finds ADRs by the docs-relative path', () => {
  const step = stage('Resume')
  assert.match(step, /`specs\/` folder of the docs/)
  assert.match(step, /`specs\/<slug>-prd\.md`, whatever form the input took/)
  assert.match(step, /`CONFLICT` rename cite the old path/)
})

test('stage 3 on a resume takes the context from the stored refined PRD', () => {
  assert.match(stage('Stage 3'), /no interview[^.]*stored refined PRD/)
})

test('stage 6 reads the place and path of an ADR found by a resume with docs adr-get', () => {
  const step = stage('Stage 6')
  assert.match(step, /docs adr-get <number> --json/)
  assert.match(step, /`place`[^.]*`destination`/)
})

test('the confirmation points declare the superseded ADRs and the milestones of a resume', () => {
  const points = section('Confirmation points').split('\n')
  assert.match(points.find((line) => line.startsWith('- Stage 3:')) ?? '', /step 7 of `record-decision\.md`/)
  assert.match(points.find((line) => line.startsWith('- Stage 5:')) ?? '', /new milestones/)
})

test('stage 4 asks nothing when an existing epic needs no new milestone', () => {
  assert.match(stage('Stage 4'), /no new milestone[^.]*without asking/)
})

test('the output gives the commit state of repository ADRs', () => {
  assert.match(section('Output'), /`docs\/adr\/`[^.]*no commit yet/)
})
