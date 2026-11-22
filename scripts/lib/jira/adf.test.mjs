import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adfToText, textToAdf } from './adf.mjs';

const doc = (...content) => ({ type: 'doc', version: 1, content });
const t = (text) => ({ type: 'text', text });
const p = (...c) => ({ type: 'paragraph', content: c });

test('null reads as empty text', () => {
  assert.equal(adfToText(null), '');
});

test('paragraph with hard break', () => {
  assert.equal(adfToText(doc(p(t('a'), { type: 'hardBreak' }, t('b')))), 'a\nb');
});

test('heading level 2', () => {
  assert.equal(adfToText(doc({ type: 'heading', attrs: { level: 2 }, content: [t('x')] })), '## x');
});

test('bullet and ordered lists', () => {
  const li = (s) => ({ type: 'listItem', content: [p(t(s))] });
  assert.equal(adfToText(doc({ type: 'bulletList', content: [li('a'), li('b')] })), '- a\n- b');
  assert.equal(adfToText(doc({ type: 'orderedList', content: [li('a'), li('b')] })), '1. a\n1. b');
});

test('task list DONE and TODO', () => {
  const ti = (state, s) => ({ type: 'taskItem', attrs: { localId: 'x', state }, content: [t(s)] });
  const d = doc({ type: 'taskList', attrs: { localId: 'l' }, content: [ti('DONE', 'a'), ti('TODO', 'b')] });
  assert.equal(adfToText(d), '- [x] a\n- [ ] b');
});

test('code block, blockquote, rule', () => {
  assert.equal(adfToText(doc({ type: 'codeBlock', content: [t('x = 1')] })), '```\nx = 1\n```');
  assert.equal(
    adfToText(doc({ type: 'codeBlock', attrs: { language: 'js' }, content: [t('x')] })),
    '```js\nx\n```',
  );
  assert.equal(adfToText(doc({ type: 'blockquote', content: [p(t('q'))] })), '> q');
  assert.equal(adfToText(doc({ type: 'rule' })), '---');
});

test('mention and inlineCard read as text', () => {
  const d = doc(p(
    { type: 'mention', attrs: { id: '1', text: '@Ana' } },
    t(' see '),
    { type: 'inlineCard', attrs: { url: 'https://x.test/a' } },
  ));
  assert.equal(adfToText(d), '@Ana see https://x.test/a');
});

test('table keeps its cell text', () => {
  const cell = (s) => ({ type: 'tableCell', content: [p(t(s))] });
  const d = doc({ type: 'table', content: [{ type: 'tableRow', content: [cell('a'), cell('b')] }] });
  const out = adfToText(d);
  assert.match(out, /a/);
  assert.match(out, /b/);
});

test('blocks join with a blank line', () => {
  assert.equal(adfToText(doc(p(t('a')), p(t('b')))), 'a\n\nb');
});

test('textToAdf writes the subset', () => {
  const d = textToAdf('## H\n\n- [ ] a\n- [x] b\n\n- c\n\n```js\nx\n```\n\nl1\nl2');
  assert.equal(d.type, 'doc');
  assert.equal(d.version, 1);
  assert.deepEqual(d.content.map((n) => n.type), ['heading', 'taskList', 'bulletList', 'codeBlock', 'paragraph']);
  assert.deepEqual(d.content[1].content.map((n) => n.attrs), [
    { localId: 't1', state: 'TODO' },
    { localId: 't2', state: 'DONE' },
  ]);
  assert.equal(d.content[3].attrs.language, 'js');
  assert.deepEqual(d.content[4].content.map((n) => n.type), ['text', 'hardBreak', 'text']);
});

test('round trip', () => {
  const text = [
    'Intro line.',
    '## Acceptance criteria',
    '- [ ] first\n- [x] second',
    '- one\n- two',
    '```js\nconst a = 1;\n```',
  ].join('\n\n');
  assert.equal(adfToText(textToAdf(text)), text);
});

test('empty text gives an empty doc', () => {
  assert.deepEqual(textToAdf(''), { type: 'doc', version: 1, content: [] });
});
