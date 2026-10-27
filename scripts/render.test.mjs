import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  boardDoc, escapeHtml, escapeMarkdown, hasMarker, marker, plural, problemsLine, renderDocument, statusLabel, toHtml, toMarkdown,
} from './lib/render.mjs'

const HEADER = ['ID', 'Title', 'Type', 'Priority', 'Assignee', 'Estimate', 'Notes']

function sampleDoc(overrides = {}) {
  return {
    title: 'Board',
    lead: ['Tracker state as of 2026-10-22T17:00:00Z'],
    sections: [
      {
        heading: 'In progress (2)',
        lines: [],
        table: {
          header: HEADER,
          rows: [
            ['ISS-2X6D', 'Billing export to CSV', 'feature', 'high', 'Ana Souza', '8', 'blocked by ISS-5N1R'],
            ['ISS-5N1R', 'Paginate the events API', 'task', 'medium', 'Fred Vanelli', '3', ''],
          ],
        },
        empty: null,
      },
      { heading: 'In review (0)', lines: [], table: null, empty: 'No issues' },
    ],
    closing: ['1 issue could not be read: ISS-3Q6T; run /pmkit:local:doctor'],
    columns: false,
    ...overrides,
  }
}

const tableRows = (text) => text.split('\n').filter((line) => line.startsWith('| '))
// Splits a Markdown table row on the pipes that are not escaped.
const cellsOf = (row) => row.slice(2, -2).split(/(?<!\\) \| /)

describe('toMarkdown', () => {
  const text = toMarkdown(sampleDoc(), 'board')
  const lines = text.split('\n')

  test('starts with the marker and the title', () => {
    assert.equal(lines[0], marker('board'))
    assert.equal(lines[1], '')
    assert.equal(lines[2], '# Board')
  })

  test('writes a heading per section in order, a row per issue and the empty text', () => {
    const headings = lines.filter((line) => line.startsWith('## '))
    assert.deepEqual(headings, ['## In progress (2)', '## In review (0)'])
    const rows = tableRows(text)
    assert.equal(rows.length, 4)
    assert.deepEqual(cellsOf(rows[0]), HEADER)
    assert.ok(rows[2].startsWith('| ISS-2X6D | Billing export to CSV |'))
    assert.ok(lines.indexOf('No issues') > lines.indexOf('## In review (0)'))
  })

  test('ends with the closing line and exactly one newline, with no carriage return', () => {
    assert.ok(text.endsWith('\n1 issue could not be read: ISS-3Q6T; run /pmkit:local:doctor\n'))
    assert.ok(!text.endsWith('\n\n'))
    assert.ok(!text.includes('\r'))
  })

  test('keeps a title with a pipe and a line break on one row with the header cell count', () => {
    const doc = sampleDoc()
    doc.sections[0].table.rows[0][1] = 'a|b\nc'
    const rows = tableRows(toMarkdown(doc, 'board'))
    assert.equal(rows.length, 4)
    assert.equal(cellsOf(rows[2]).length, HEADER.length)
    assert.equal(cellsOf(rows[2])[1], 'a\\|b c')
  })

  test('escapes the title, the lead, headings and closing lines', () => {
    const doc = sampleDoc({ title: 'B*o*ard', lead: ['<lead>'], closing: ['_end_'] })
    doc.sections[0].heading = 'In [progress]'
    const out = toMarkdown(doc, 'board')
    assert.ok(out.includes('# B\\*o\\*ard\n'))
    assert.ok(out.includes('\n\\<lead\\>\n'))
    assert.ok(out.includes('## In \\[progress\\]\n'))
    assert.ok(out.endsWith('\n\\_end\\_\n'))
  })

  test('writes the text of a toned cell', () => {
    const doc = sampleDoc()
    doc.sections[0].table.rows[0][6] = { text: 'at_risk (2026-10-20)', tone: 'at_risk' }
    assert.ok(toMarkdown(doc, 'board').includes('| at\\_risk (2026-10-20) |'))
  })

  test('is the same with columns on', () => {
    assert.equal(toMarkdown(sampleDoc({ columns: true }), 'board'), text)
  })
})

test('escapeMarkdown escapes every special character and turns line breaks into spaces', () => {
  assert.equal(escapeMarkdown('a|b *c* _d_ [e] <f> \\ `g`\nh'), 'a\\|b \\*c\\* \\_d\\_ \\[e\\] \\<f\\> \\\\ \\`g\\` h')
  assert.equal(escapeMarkdown('a\r\nb\rc'), 'a b c')
})

describe('toHtml', () => {
  const text = toHtml(sampleDoc(), 'board')
  const lines = text.split('\n')

  test('is one offline file with the doctype and the marker first', () => {
    assert.equal(lines[0], '<!doctype html>')
    assert.equal(lines[1], marker('board'))
    for (const part of ['<html lang="en">', '<meta charset="utf-8">', '<meta name="viewport"', '<title>Board</title>']) {
      assert.ok(text.includes(part), part)
    }
    assert.equal(text.split('<style>').length, 2)
    assert.ok(!text.includes('<script'))
    assert.ok(!text.includes('<link'))
    assert.ok(!text.includes('http'))
    assert.ok(text.endsWith('</html>\n'))
    assert.ok(!text.includes('\r'))
  })

  test('holds every heading, cell, empty text and closing line', () => {
    for (const part of ['<h1>Board</h1>', 'In progress (2)', 'Billing export to CSV', 'blocked by ISS-5N1R', 'No issues', 'ISS-3Q6T; run /pmkit:local:doctor']) {
      assert.ok(text.includes(part), part)
    }
  })

  test('escapes a script in the title and in a cell', () => {
    const doc = sampleDoc({ title: '<script>alert(1)</script>' })
    doc.sections[0].table.rows[0][1] = '<script>alert(1)</script>'
    const out = toHtml(doc, 'board')
    assert.ok(!out.includes('<script'))
    assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  })

  test('puts the tone of a cell in a class on that cell', () => {
    const doc = sampleDoc()
    doc.sections[0].table.rows[0][6] = { text: 'at_risk (2026-10-20)', tone: 'at_risk' }
    assert.match(toHtml(doc, 'board'), /<td class="tone-at_risk">at_risk \(2026-10-20\)<\/td>/)
  })

  test('with columns, renders each section as a column of cards with every non-empty cell', () => {
    const out = toHtml(sampleDoc({ columns: true }), 'board')
    assert.ok(out.includes('class="columns"'))
    assert.ok(!out.includes('<table'))
    assert.equal(out.split('class="column"').length - 1, 2)
    assert.equal(out.split('class="card"').length - 1, 2)
    for (const cell of ['ISS-2X6D', 'Billing export to CSV', 'feature', 'high', 'Ana Souza', '8', 'blocked by ISS-5N1R', 'ISS-5N1R', 'Fred Vanelli']) {
      assert.ok(out.includes(cell), cell)
    }
    assert.ok(!out.includes('<dt>Notes</dt><dd></dd>'))
  })
})

test('escapeHtml replaces the five special characters', () => {
  assert.equal(escapeHtml('<script>alert(1)</script> & "q" \'s\''), '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot; &#39;s&#39;')
})

test('renderDocument picks the writer by format', () => {
  assert.equal(renderDocument(sampleDoc(), 'board', 'md'), toMarkdown(sampleDoc(), 'board'))
  assert.equal(renderDocument(sampleDoc(), 'board', 'html'), toHtml(sampleDoc(), 'board'))
})

describe('hasMarker', () => {
  test('finds the marker on line 1 or line 2', () => {
    assert.equal(hasMarker(toMarkdown(sampleDoc(), 'board')), true)
    assert.equal(hasMarker(toHtml(sampleDoc(), 'roadmap')), true)
    assert.equal(hasMarker(`# Title\n${marker('sprint')}\n`), true)
  })

  test('is false for other files and for a marker on line 3', () => {
    assert.equal(hasMarker('# Notes\n'), false)
    assert.equal(hasMarker(`a\nb\n${marker('board')}\n`), false)
    assert.equal(hasMarker(''), false)
  })
})

const row = (id, overrides = {}) => ({
  id, title: `Title of ${id}`, type: 'task', priority: 'medium', assignee: '', estimate: null, blockedBy: [], labels: [], ...overrides,
})

function boardData(overrides = {}) {
  return {
    asOf: '2026-10-22T17:00:00Z',
    problems: [],
    unit: 'points',
    statuses: [
      { name: 'triage', issues: [row('ISS-1V9Z')] },
      { name: 'backlog', issues: [row('ISS-3F7H', { estimate: 2 }), row('ISS-6J0B')] },
      { name: 'todo', issues: [row('ISS-4M2S', { estimate: 1 })] },
      { name: 'in_progress', issues: [
        row('ISS-2X6D', { estimate: 8, assignee: 'Ana Souza', blockedBy: ['ISS-5N1R'], labels: ['billing', 'backend'] }),
        row('ISS-5N1R', { estimate: 3 }),
      ] },
      { name: 'in_review', issues: [row('ISS-8C4W', { estimate: 5 })] },
      { name: 'ready', issues: [] },
    ],
    done: 3,
    canceled: 1,
    ...overrides,
  }
}

describe('boardDoc', () => {
  const doc = boardDoc(boardData())

  test('has a section per status in order, with the count in the heading', () => {
    assert.equal(doc.title, 'Board')
    assert.deepEqual(doc.sections.map((s) => s.heading), ['Triage (1)', 'Backlog (2)', 'Todo (1)', 'In progress (2)', 'In review (1)', 'Ready (0)'])
    assert.equal(doc.sections[5].empty, 'No issues')
    assert.equal(doc.sections[5].table, null)
    assert.equal(doc.columns, true)
  })

  test('leads with the as-of line and the summary', () => {
    assert.deepEqual(doc.lead, ['Tracker state as of 2026-10-22T17:00:00Z', '7 open issues, 19 points open, done: 3, canceled: 1'])
    assert.deepEqual(boardDoc(boardData({ asOf: null })).lead, ['7 open issues, 19 points open, done: 3, canceled: 1'])
    assert.deepEqual(boardDoc(boardData({ unit: 'sizes' })).lead.at(-1), '7 open issues, done: 3, canceled: 1')
    assert.deepEqual(boardDoc(boardData({ unit: 'hours' })).lead.at(-1), '7 open issues, 19 hours open, done: 3, canceled: 1')
  })

  test('writes the issue columns and the notes', () => {
    const table = doc.sections[3].table
    assert.deepEqual(table.header, ['ID', 'Title', 'Type', 'Priority', 'Assignee', 'Estimate', 'Notes'])
    assert.deepEqual(table.rows[0], ['ISS-2X6D', 'Title of ISS-2X6D', 'task', 'medium', 'Ana Souza', '8', 'blocked by ISS-5N1R; labels: billing, backend'])
    assert.deepEqual(table.rows[1], ['ISS-5N1R', 'Title of ISS-5N1R', 'task', 'medium', '', '3', ''])
    assert.equal(boardDoc(boardData({ statuses: [{ name: 'todo', issues: [row('A', { labels: ['x'] })] }] })).sections[0].table.rows[0][6], 'labels: x')
  })

  test('closes with the problems line', () => {
    assert.deepEqual(doc.closing, [])
    const problems = [{ id: 'ISS-3Q6T', code: 'INVALID_INPUT', message: 'conflict markers' }]
    assert.deepEqual(boardDoc(boardData({ problems })).closing, ['1 issue could not be read: ISS-3Q6T; run /pmkit:local:doctor'])
  })
})

test('problemsLine names the unreadable issues, or is null', () => {
  assert.equal(problemsLine([{ id: 'ISS-3Q6T' }]), '1 issue could not be read: ISS-3Q6T; run /pmkit:local:doctor')
  assert.equal(problemsLine([{ id: 'A' }, { id: 'B' }]), '2 issues could not be read: A, B; run /pmkit:local:doctor')
  assert.equal(problemsLine([]), null)
})

test('plural and statusLabel', () => {
  assert.equal(plural(1, 'issue'), '1 issue')
  assert.equal(plural(0, 'issue'), '0 issues')
  assert.equal(statusLabel('in_review'), 'In review')
  assert.equal(statusLabel('done'), 'Done')
})
