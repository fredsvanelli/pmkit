#!/usr/bin/env node
// Compares where `adrInfo` ends the `## Status` section at two refs with where CommonMark ends it (PMK-291). A developer check, not part
// of `npm test`, with no dependency of the repository: the oracle is a commonmark.js installed outside it, for example
//   npm install --prefix /tmp/cm commonmark@0.31.2
//   node scripts/dev/adr-commonmark-diff.mjs --commonmark /tmp/cm/node_modules/commonmark [--base origin/develop] [--head HEAD] [--random 1000000] [--status-random 500000] [--break-random 250000] [--seed 1] [--lines 8] [--show 20]
// COMMONMARK=<dir> works in place of --commonmark. A ref of `worktree` reads scripts/lib of the working tree. The text of each case is
// `## Status\n\n<case>\n## Context\n`; the expected status is the trimmed lines from the Status heading to the next heading CommonMark
// puts at the top level of the document. Exit code 1 when a case is worse at the head than at the base, or (PMK-315, PMK-318) when the head's write removes text the base kept or refused, replaces a line that is not a known status, or duplicates, reorders or moves a line.
//
// The write check (PMK-315) runs `setAdrStatus` at both refs on every body and compares what each deletes (adr-write-compare.mjs). A ref refuses a body the way `docs adr-status`
// does: `adrHtmlHeld`, `adrFenceHeld` or `adrStatusDropped` reports something, so nothing is written; a refusal is its own result, never "removed". An exception from a guard or from `setAdrStatus` is not a refusal (the guards are what refuse), it is a bug: it is counted as `threw` with an example, and the run exits 1 when the head throws on a body (a base that throws is only counted and reported).
// A write is checked by its shape (PMK-318, `writeShape` in adr-write-compare.mjs): the head either replaces exactly one line in place, a line of the section as CommonMark ends it that reads as a known status (the helper has its own copy of the PMK-311 rule,
// never the head's), keeping every other line of the document in order and byte for byte (a hard line break stays on that line, PMK-314); or it replaces the whole section (the lines CommonMark puts in it, no fewer) by one new line, as the base does or refuses.
// A duplicated, reordered or moved line, a replaced line that is not a known status or is outside the section, or a part of the section replaced by one line, is `worse`. A whole-section write is compared with the base as before: the text a write removes is the trimmed non-blank lines of the
// document before it minus those after, as a multiset (the write adds `Superseded by <sentinel>`, a line no body has). "The head removes text the base kept or refused" (the `worse` count, which fails the run) is then
// that shape failing, or a whole-section write that removes a line the base did not, or, where the base refuses, any line but the one of a one-line section (the section as CommonMark reads it). A base that wrote and a head that refuses is `newly refused`, counted apart.
// PMK-321: the new line of an in-place write has to be the line it replaced with the status asked for (`Superseded by sentinel.md`) in place of the status, the indent and the hard line break of the old line kept, or it is `worse`;
// in a section of one line CommonMark reads, the plain status is also right (the section is replaced whole, nothing is lost). A whole-section write keeps every raw line outside the section, not trimmed, or it is `worse`.
// The PMK-321 cases (after the PMK-315 ones below) have the status on a plain line, then a fence or an HTML block in a quote or list item holding a heading-like line, closed by a later line, a blank line, an ATX or setext heading or the end of the file; the summary tallies them by that end.
// The corpus of PMK-315 (status words with and without emphasis, `Superseded by ADR 2`, dates, `Supersedes`, `Key: value`) is added after the cases of PMK-291 and
// PMK-311, which are unchanged and in the same order; `--status-random` sets its random part.
// PMK-324: after the PMK-321 cases, pairs, triples and random status runs with status lines ending in a hard line break (two or more spaces, one or three backslashes) or two backslashes (not a break), the older cases unchanged
// and in the same order; `--break-random` sets its random part. The corpus (`cases`) lives in adr-write-compare.mjs, so `npm test` checks it holds those lines and that the older cases do not change.
// PMK-327: after the PMK-324 cases, an HTML block of kind 1 to 5 in a quote or list item holding `## X`, with the PMK-321 ends and the end of the file with no final newline (tallied as its own end), then pairs of a status line
// then a break line and triples of two status lines then a break line, with status lines that end in exactly one space (not a break) among them, then those one-space lines next to each line of the corpus (as the only status line of a section, the one `setAdrStatus` writes in place). The older cases are unchanged and in the same order.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { cases, compareWrites, textOf, writeShape } from './adr-write-compare.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { values: args } = parseArgs({
  options: {
    commonmark: { type: 'string', default: process.env.COMMONMARK },
    base: { type: 'string', default: 'origin/develop' },
    head: { type: 'string', default: 'HEAD' },
    random: { type: 'string', default: '1000000' },
    'status-random': { type: 'string', default: '500000' },
    'break-random': { type: 'string', default: '250000' },
    seed: { type: 'string', default: '1' },
    lines: { type: 'string', default: '8' },
    show: { type: 'string', default: '20' },
  },
})
if (!args.commonmark) {
  console.error('Pass --commonmark <dir of an installed commonmark package> or set COMMONMARK.')
  process.exit(2)
}
const { Parser } = createRequire(import.meta.url)(path.resolve(args.commonmark))
const parser = new Parser()

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-commonmark-diff-'))
// The reading of the whole section at a ref: `adrSectionText` when it has one (PMK-311: `adrInfo` then reads one line of it), else `adrInfo` (before PMK-311 its status was the section). `line` is that `adrInfo` status.
// `write` is what `docs adr-status` does with a body: `{ refused: true }` when a guard names something, `{ threw }` when a guard or `setAdrStatus` throws, else the shape of the write (`writeShape`: PMK-315, PMK-318, with the `span` of the section, PMK-321).
const SENTINEL = 'sentinel.md'
// The status the write is asked for, as it has to be written (PMK-321).
const STATUS = `Superseded by ${SENTINEL}`
const readerOf = (mod) => ({
  section: (text) => (mod.adrSectionText ? mod.adrSectionText(text) : mod.adrInfo(text).status) ?? '',
  line: (text) => mod.adrInfo(text).status ?? '',
  write(text, span) {
    try {
      if (mod.adrHtmlHeld(text) || mod.adrFenceHeld(text) || mod.adrStatusDropped(text).length > 0) return { refused: true }
      return writeShape(text, mod.setAdrStatus(text, 'superseded', SENTINEL).text, span)
    } catch (error) {
      return { threw: String(error?.message ?? error) }
    }
  },
})
async function adrInfoAt(ref) {
  if (ref === 'worktree') return readerOf(await import(pathToFileURL(path.join(ROOT, 'scripts/lib/adr.mjs'))))
  const archive = spawnSync('git', ['archive', ref, 'scripts/lib'], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 })
  if (archive.status !== 0) throw new Error(`git archive ${ref}: ${archive.stderr}`)
  const dir = fs.mkdtempSync(path.join(temp, 'ref-'))
  const untar = spawnSync('tar', ['-x', '-C', dir], { input: archive.stdout, maxBuffer: 256 * 1024 * 1024 })
  if (untar.status !== 0) throw new Error(`tar: ${untar.stderr}`)
  return readerOf(await import(pathToFileURL(path.join(dir, 'scripts/lib/adr.mjs'))))
}

function expected(text) {
  const lines = text.split('\n')
  let next = parser.parse(text).firstChild.next
  while (next !== null && next.type !== 'heading') next = next.next
  const end = next === null ? lines.length : next.sourcepos[0][0] - 1
  return { section: lines.slice(1, end).map((line) => line.trim()).filter(Boolean), span: [1, end] }
}

let base, head
try {
  base = await adrInfoAt(args.base)
  head = await adrInfoAt(args.head)
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}
const counts = { empty: 0, writeRefusedBoth: 0, writeNewlyRefused: 0, writeAcceptedWhereRefused: 0, writeSame: 0, writeWorse: 0, writeHeadThrew: 0, writeBaseThrew: 0, lineOfSection: 0, lineChanged: 0, lineOutside: 0, cases: 0, right: 0, fixed: 0, worse: 0, wrongSame: 0, wrongDifferent: 0 }
const worse = []
const writeWorse = []
const threw = []
const containers = {}
for (const item of cases({ seed: Number(args.seed), random: Number(args.random), statusRandom: Number(args['status-random']), breakRandom: Number(args['break-random']), lines: Number(args.lines) })) {
  const body = item.text ?? item
  const text = item.text ?? textOf(body)
  const { section, span } = expected(text)
  const want = section.join(' ')
  const before = base.section(text)
  const after = head.section(text)
  // PMK-311: the status `adrInfo` reads at the head is one line of the section: the same text for a one-line section, else a part of it, never text from outside it.
  const line = head.line(text)
  if (after === '') counts.empty++
  else if (line === after) counts.lineOfSection++
  else if (line === '' || after.includes(line)) counts.lineChanged++
  else counts.lineOutside++
  counts.cases++
  const compared = compareWrites({ base: base.write(text, span), head: head.write(text, span), section, span, status: STATUS })
  if (item.end) {
    const tally = (containers[item.end] ??= {})
    tally[compared.outcome] = (tally[compared.outcome] ?? 0) + 1
  }
  counts[`write${compared.outcome[0].toUpperCase()}${compared.outcome.slice(1)}`]++
  if (compared.error !== undefined && threw.length < Number(args.show)) threw.push({ body, [compared.outcome === 'headThrew' ? args.head : args.base]: `threw: ${compared.error}` })
  if (compared.outcome === 'worse' && writeWorse.length < Number(args.show)) writeWorse.push({ body, removedExtra: compared.extra, written: compared.written, reason: compared.reason })
  if (before === want && after === want) counts.right++
  else if (after === want) counts.fixed++
  else if (before === want) {
    counts.worse++
    if (worse.length < Number(args.show)) worse.push({ body, commonmark: want, [args.base]: before, [args.head]: after })
  } else if (before === after) counts.wrongSame++
  else counts.wrongDifferent++
}
console.log(`${args.base} -> ${args.head}, commonmark ${createRequire(import.meta.url)(path.join(path.resolve(args.commonmark), 'package.json')).version}`)
console.log(`cases ${counts.cases}: right on both ${counts.right}, fixed ${counts.fixed}, worse ${counts.worse}, wrong on both ${counts.wrongSame + counts.wrongDifferent} (same answer ${counts.wrongSame}, different ${counts.wrongDifferent})`)
console.log(`adrInfo status at ${args.head}: empty status ${counts.empty}, the whole section ${counts.lineOfSection}, one line of it ${counts.lineChanged}, text from outside the section ${counts.lineOutside}`)
console.log(`setAdrStatus at ${args.base} vs ${args.head}: same removal ${counts.writeSame}, refused on both ${counts.writeRefusedBoth}, newly refused at the head ${counts.writeNewlyRefused}, written at the head where the base refused ${counts.writeAcceptedWhereRefused}, head removes text the base kept or refused ${counts.writeWorse}, threw at the head ${counts.writeHeadThrew}, threw at the base ${counts.writeBaseThrew}`)
for (const [end, outcomes] of Object.entries(containers)) console.log(`container cases ending at ${end} (PMK-321): ${Object.entries(outcomes).map(([outcome, n]) => `${outcome} ${n}`).join(', ')}`)
for (const example of worse) console.log(JSON.stringify(example))
for (const example of writeWorse) console.log(JSON.stringify(example))
for (const example of threw) console.log(JSON.stringify(example))
process.exit(counts.worse > 0 || counts.lineOutside > 0 || counts.writeWorse > 0 || counts.writeHeadThrew > 0 ? 1 : 0)
