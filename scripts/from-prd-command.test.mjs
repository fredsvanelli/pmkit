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
