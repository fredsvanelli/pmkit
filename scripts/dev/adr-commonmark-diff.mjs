#!/usr/bin/env node
// Compares where `adrInfo` ends the `## Status` section at two refs with where CommonMark ends it (PMK-291). A developer check, not part
// of `npm test`, with no dependency of the repository: the oracle is a commonmark.js installed outside it, for example
//   npm install --prefix /tmp/cm commonmark@0.31.2
//   node scripts/dev/adr-commonmark-diff.mjs --commonmark /tmp/cm/node_modules/commonmark [--base origin/develop] [--head HEAD] [--random 1000000] [--status-random 500000] [--seed 1] [--lines 8] [--show 20]
// COMMONMARK=<dir> works in place of --commonmark. A ref of `worktree` reads scripts/lib of the working tree. The text of each case is
// `## Status\n\n<case>\n## Context\n`; the expected status is the trimmed lines from the Status heading to the next heading CommonMark
// puts at the top level of the document. Exit code 1 when a case is worse at the head than at the base, or (PMK-315) when the head's write removes text the base kept or refused.
//
// The write check (PMK-315) runs `setAdrStatus` at both refs on every body and compares what each deletes (adr-write-compare.mjs). A ref refuses a body the way `docs adr-status`
// does: `adrHtmlHeld`, `adrFenceHeld` or `adrStatusDropped` reports something, so nothing is written; a refusal is its own result, never "removed". An exception from a guard or from `setAdrStatus` is not a refusal (the guards are what refuse), it is a bug: it is counted as `threw` with an example, and the run exits 1 when the head throws on a body (a base that throws is only counted and reported).
// The text a write removes is the trimmed non-blank lines of the document before it minus those after, as a multiset; the write adds `Superseded by <sentinel>`, a line
// no body has. The head always removes the one line it replaces (its status line, `adrInfo(text).status`), which is not counted. "The head removes text the base kept or
// refused" (the `worse` count, which fails the run) is the section text that disappears at the head and stayed at the base: both write and the head removes a line the base
// did not, or the base refuses and the head removes any line besides its status line. A base that wrote and a head that refuses is `newly refused`, counted apart.
// The corpus of PMK-315 (status words with and without emphasis, `Superseded by ADR 2`, dates, `Supersedes`, `Key: value`) is added after the cases of PMK-291 and
// PMK-311, which are unchanged and in the same order; `--status-random` sets its random part.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { compareWrites, removedLines } from './adr-write-compare.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { values: args } = parseArgs({
  options: {
    commonmark: { type: 'string', default: process.env.COMMONMARK },
    base: { type: 'string', default: 'origin/develop' },
    head: { type: 'string', default: 'HEAD' },
    random: { type: 'string', default: '1000000' },
    'status-random': { type: 'string', default: '500000' },
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
// `write` is what `docs adr-status` does with a body: `{ refused: true }` when a guard names something, `{ threw }` when a guard or `setAdrStatus` throws, else the lines the write removes (PMK-315).
const SENTINEL = 'sentinel.md'
const readerOf = (mod) => ({
  section: (text) => (mod.adrSectionText ? mod.adrSectionText(text) : mod.adrInfo(text).status) ?? '',
  line: (text) => mod.adrInfo(text).status ?? '',
  write(text) {
    try {
      if (mod.adrHtmlHeld(text) || mod.adrFenceHeld(text) || mod.adrStatusDropped(text).length > 0) return { refused: true }
      return { removed: removedLines(text, mod.setAdrStatus(text, 'superseded', SENTINEL).text) }
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

const textOf = (body) => `## Status\n\n${body}\n## Context\n`
function expected(text) {
  const lines = text.split('\n')
  let next = parser.parse(text).firstChild.next
  while (next !== null && next.type !== 'heading') next = next.next
  return lines.slice(1, next === null ? lines.length : next.sourcepos[0][0] - 1).map((line) => line.trim()).filter(Boolean).join(' ')
}

// The cases: each cycle of the PR #241 review and the issue, every pair of lines, then random runs of lines.
const FIXED = [
  '- x\n\n1. a\n\n  b\n---', '- a\n\n```\nz\n```\n  b\n---', '- a\nlazy\n\n  b\n---',
  '- a\n-\n\n  x\n---', '-     a\nlazy\n\n  x\n---', '-     a\nz\n\n  x\n---', '-     a\n-\n\n  x\n---',
  '- a\n\n      code\nmore\n---', '- a\n\n  ```\n  z\n  ```\n```\ny\n```\n  b\n---', '- a\n  > q\nlazy\n\n  b\n---',
  '- a\nlazy\n\n\n      x\nlazy\n---', '-\n  x\n\n      x\nlazy\n---', '-\n      code\n\n  x\n---', '- a\n\n  > q\nlazy\n\n  c\n---',
  '- a\n    - m\n\n      c\nlazy\n---', '\n -\n      1) b\n\n      3)      b\na\n---', '\n   1. x\nlazy\n\n        3) \na\n  \tlazy\n   ===',
  '2.    lazy\n      a\n     b\nx\n\n        1.      a\nc d\n  + \n--',
  '-\n<!-- x -->\n---', '* \n<!-- x -->\n ---', '-\n[a]: /u\n ---', '> ###\n[a]: /u "t"\n ---', '1. ```\n[a]: /u\n-', '-\n</div>\n---', '<pre>\n\t~~~\n-',
  '<!--\n```\n-->\nAccepted\n',
]
const ITEMS = ['- a', '* a', '+ a', '1. a', '1) a', '2. a', '10) a', '-', '*', '1.', '2)', '-     a', '1.      a', '-\ta', '1.\ta', '- \ta', '\t- a',
  ' - a', '  - b', '   - b', '    - b', '     - c', '      - c', '  1) b', '   1. b', '    2. b', '- - a', '1. - a', '- 1) a', '-  a', '- * a', '  -', '    -']
const TEXT = ['a', 'lazy', ' x', '  x', '   x', '    x', '     x', '      x', '        x', '\tx', '\t\tx', ' \tx', '  \tx', '\t  x', '  # h']
const QUOTES = ['> q', '  > q', '>', '> - a', '- > q', '  - > q', '  > - q', '>     x', '>\tx', '    > q']
const FENCES = ['```', '~~~', '  ```', '   ~~~', '    ```', '````', '```x', '``` `', '      ```', '\t```', '~~~~', '  ~~~']
const BLANKS = ['', '', '  ', '\t']
const BREAKS = ['***', '* * *', '- - -', '___', '# h', '  ---']
// HTML blocks of the seven kinds, inline tags that are not blocks, and link reference definitions, whole or spread over lines.
const HTML = ['<!-- x -->', '<!-- c', '-->', '<div>', '</div>', '<div class="a">', '  <p>', '<pre>', '</pre>', '<script>', '</script>', '<x-y>', '</x-y>',
  '<a href="u">', '<span>x</span>', '<em>', '<![CDATA[', ']]>', '<!DOCTYPE html>', '<?php', '?>', '<x-y a=1 b="2"/>', '    <div>', '<div>x</div>']
const DEFS = ['[a]: /u', '[a]: /u "t"', "[b]: <u> 't'", '[a]: /u (t)', '[a]:', '/u', '"t"', '[a]: /u "t" x', '[ ]: /u', '[a]: /u\t', '[a]', ': /u', '  [a]: /u', '[a]: (u)']
const UNDERLINES = ['---', '===', '--', '-', ' ---', '   ===', '----  ']
// PMK-315: the lines that make the status line choice matter: known status words with and without emphasis, a date, `Supersedes`, `Key: value`, and a status with its own date.
const STATUS_WORDS = ['Accepted', 'accepted', '**Accepted**', '*Proposed*', '_Deprecated_', 'Proposed', 'Rejected', 'Draft', 'Superseded by ADR 2', '**Superseded by ADR 2**', 'Superseded by [ADR 2](0002-x.md)', '  Accepted', '    Accepted']
const STATUS_OTHER = ['Date: 2024-01-02', '2024-01-02', '- Date: 2024-01-02', 'Supersedes ADR 1', 'Supersedes: ADR 1', '**Supersedes** ADR 1', 'Status: Accepted', 'Deciders: a, b', 'Key: value', 'Accepted Date: 2024-01-02', 'Proposed by a']
const STATUSY = [...STATUS_WORDS, ...STATUS_OTHER]
const ALPHABET = [...ITEMS, ...TEXT, ...QUOTES, ...FENCES, ...BLANKS, ...BREAKS, ...HTML, ...DEFS]
// The weights of each kind in a random run: lists and text most, so nesting and lazy lines meet often. COMPOSED builds a line from parts.
const COMPOSED = []
const KINDS = [[ITEMS, 20], [TEXT, 18], [COMPOSED, 20], [BLANKS, 15], [QUOTES, 8], [FENCES, 9], [BREAKS, 3], [HTML, 10], [DEFS, 10]]
const WEIGHT = KINDS.reduce((sum, [, weight]) => sum + weight, 0)
// Parts of a composed line: an indent of 0 to 8 columns with tabs, up to two quote or list markers each with a gap of 0 to 6 columns, then content.
const INDENTS = ['', ' ', '  ', '   ', '    ', '     ', '      ', '        ', '\t', ' \t', '  \t', '\t ', '\t\t']
const MARKERS = ['-', '*', '+', '1.', '1)', '2.', '3)', '10.', '>']
const GAPS = ['', ' ', '  ', '   ', '    ', '     ', '      ', '\t', ' \t']
const CONTENTS = ['a', 'lazy', '', '```', '~~~', '---', '# h', 'x y', '<!-- x -->', '<div>', '<pre>', '<x-y>', '[a]: /u', '[a]: /u "t"']

function* cases() {
  yield* FIXED
  for (const a of ALPHABET) for (const u of UNDERLINES) yield `${a}\n${u}`
  for (const a of ALPHABET) for (const b of ALPHABET) for (const u of UNDERLINES) yield `${a}\n${b}\n${u}`
  let seed = Number(args.seed) >>> 0
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pick = (list) => list[Math.floor(random() * list.length)]
  for (let n = 0; n < Number(args.random); n++) {
    const lines = []
    const count = 1 + Math.floor(random() * Number(args.lines))
    for (let i = 0; i < count; i++) {
      let roll = random() * WEIGHT
      const [kind] = KINDS.find(([, weight]) => (roll -= weight) < 0)
      if (kind !== COMPOSED) lines.push(pick(kind))
      else {
        let line = pick(INDENTS)
        for (let m = Math.floor(random() * 3); m > 0; m--) line += pick(MARKERS) + pick(GAPS)
        lines.push(line + pick(CONTENTS))
      }
    }
    if (random() < 0.9) lines.push(pick(UNDERLINES))
    yield lines.join('\n')
  }
  // PMK-315: bodies with status words. Pairs and triples with a status line in them, then random runs weighted to status lines, blanks between them and a few other blocks.
  for (const s of STATUSY) for (const a of [...STATUSY, ...ALPHABET]) for (const u of UNDERLINES) yield `${s}\n${a}\n${u}`
  for (const a of ALPHABET) for (const s of STATUSY) for (const u of UNDERLINES) yield `${a}\n${s}\n${u}`
  for (const s of STATUSY) for (const t of STATUSY) for (const a of [...STATUSY, ...ALPHABET]) for (const u of UNDERLINES) yield `${s}\n${t}\n${a}\n${u}`
  for (const s of STATUSY) for (const a of ALPHABET) for (const t of STATUSY) for (const u of UNDERLINES) yield `${s}\n${a}\n${t}\n${u}`
  const STATUS_KINDS = [[STATUSY, 35], [BLANKS, 15], [ITEMS, 8], [TEXT, 6], [COMPOSED, 6], [QUOTES, 4], [FENCES, 4], [HTML, 6], [DEFS, 3], [BREAKS, 3]]
  const statusWeight = STATUS_KINDS.reduce((sum, [, weight]) => sum + weight, 0)
  seed = (Number(args.seed) + 1) >>> 0
  for (let n = 0; n < Number(args['status-random']); n++) {
    const lines = []
    const count = 1 + Math.floor(random() * Number(args.lines))
    for (let i = 0; i < count; i++) {
      let roll = random() * statusWeight
      const [kind] = STATUS_KINDS.find(([, weight]) => (roll -= weight) < 0)
      if (kind !== COMPOSED) lines.push(pick(kind))
      else {
        let line = pick(INDENTS)
        for (let m = Math.floor(random() * 3); m > 0; m--) line += pick(MARKERS) + pick(GAPS)
        lines.push(line + pick(CONTENTS))
      }
    }
    if (random() < 0.3) lines.push(pick(UNDERLINES))
    yield lines.join('\n')
  }
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
for (const body of cases()) {
  const text = textOf(body)
  const want = expected(text)
  const before = base.section(text)
  const after = head.section(text)
  // PMK-311: the status `adrInfo` reads at the head is one line of the section: the same text for a one-line section, else a part of it, never text from outside it.
  const line = head.line(text)
  if (after === '') counts.empty++
  else if (line === after) counts.lineOfSection++
  else if (line === '' || after.includes(line)) counts.lineChanged++
  else counts.lineOutside++
  counts.cases++
  const compared = compareWrites({ base: base.write(text), head: head.write(text), headStatus: line })
  counts[`write${compared.outcome[0].toUpperCase()}${compared.outcome.slice(1)}`]++
  if (compared.error !== undefined && threw.length < Number(args.show)) threw.push({ body, [compared.outcome === 'headThrew' ? args.head : args.base]: `threw: ${compared.error}` })
  if (compared.outcome === 'worse' && writeWorse.length < Number(args.show)) writeWorse.push({ body, removedExtra: compared.extra })
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
for (const example of worse) console.log(JSON.stringify(example))
for (const example of writeWorse) console.log(JSON.stringify(example))
for (const example of threw) console.log(JSON.stringify(example))
process.exit(counts.worse > 0 || counts.lineOutside > 0 || counts.writeWorse > 0 || counts.writeHeadThrew > 0 ? 1 : 0)
