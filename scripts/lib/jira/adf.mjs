const kids = (node) => node.content ?? [];

function inline(node) {
  switch (node.type) {
    case 'text': return node.text ?? '';
    case 'hardBreak': return '\n';
    case 'mention': return node.attrs?.text ?? '';
    case 'inlineCard': return node.attrs?.url ?? '';
    default: return kids(node).map(inline).join('');
  }
}

const prefixed = (node, prefix) => kids(node).map((item) => prefix(item) + blocks(item).join('\n').replace(/\n/g, '\n  '));

function blocks(node) {
  return kids(node).map(block);
}

function block(node) {
  switch (node.type) {
    case 'paragraph': return inline(node);
    case 'heading': return `${'#'.repeat(node.attrs?.level ?? 1)} ${inline(node)}`;
    case 'bulletList': return prefixed(node, () => '- ').join('\n');
    case 'orderedList': return prefixed(node, () => '1. ').join('\n');
    case 'taskList':
      return kids(node).map((i) => `- [${i.attrs?.state === 'DONE' ? 'x' : ' '}] ${inline(i)}`).join('\n');
    case 'codeBlock': return `\`\`\`${node.attrs?.language ?? ''}\n${inline(node)}\n\`\`\``;
    case 'blockquote': return blocks(node).join('\n\n').replace(/^/gm, '> ');
    case 'rule': return '---';
    case 'listItem': return blocks(node).join('\n');
    default: return container(node);
  }
}

// Unknown nodes: block children join by blank line, inline ones concatenate.
function container(node) {
  const children = kids(node);
  if (children.some((c) => c.type === 'paragraph' || c.content)) {
    return children.map(block).filter(Boolean).join(node.type === 'tableRow' ? ' | ' : '\n\n');
  }
  return inline(node);
}

// Reads an Atlassian Document Format doc as markdown-like text.
export function adfToText(doc) {
  if (!doc) return '';
  return blocks(doc).join('\n\n');
}

const text = (s) => ({ type: 'text', text: s });

function paragraph(lines) {
  const content = [];
  lines.forEach((line, i) => {
    if (i > 0) content.push({ type: 'hardBreak' });
    if (line) content.push(text(line));
  });
  return { type: 'paragraph', content };
}

const para = (s) => ({ type: 'paragraph', content: s ? [text(s)] : [] });

// Writes the text back as ADF, the reverse of adfToText over the same subset.
export function textToAdf(source) {
  const lines = String(source ?? '').split('\n');
  const content = [];
  const counter = { n: 0 };
  let i = 0;
  while (i < lines.length) {
    i = readBlock(lines, i, content, counter);
  }
  return { type: 'doc', version: 1, content };
}

const TASK = /^- \[([ xX])\] ?(.*)$/;
const BULLET = /^- (.*)$/;
const FENCE = /^```(.*)$/;
const HEADING = /^(#{1,6}) (.*)$/;

function readBlock(lines, i, content, counter) {
  const line = lines[i];
  if (line.trim() === '') return i + 1;
  const fence = FENCE.exec(line);
  if (fence) return readFence(lines, i, fence[1], content);
  const heading = HEADING.exec(line);
  if (heading) {
    content.push({ type: 'heading', attrs: { level: heading[1].length }, content: [text(heading[2])] });
    return i + 1;
  }
  if (TASK.test(line)) return readRun(lines, i, TASK, content, (m) => taskItem(m, counter), 'taskList');
  if (BULLET.test(line)) return readRun(lines, i, BULLET, content, bulletItem, 'bulletList');
  return readParagraph(lines, i, content);
}

function readFence(lines, i, language, content) {
  const body = [];
  let j = i + 1;
  while (j < lines.length && !FENCE.test(lines[j])) body.push(lines[j++]);
  const node = { type: 'codeBlock', content: body.length ? [text(body.join('\n'))] : [] };
  if (language) node.attrs = { language };
  content.push(node);
  return j + 1;
}

function readRun(lines, i, re, content, make, type) {
  const items = [];
  let j = i;
  while (j < lines.length && re.test(lines[j])) items.push(make(re.exec(lines[j++])));
  const node = { type, content: items };
  if (type === 'taskList') node.attrs = { localId: `l${items[0].attrs.localId.slice(1)}` };
  content.push(node);
  return j;
}

function taskItem(m, counter) {
  counter.n += 1;
  const state = m[1] === ' ' ? 'TODO' : 'DONE';
  return { type: 'taskItem', attrs: { localId: `t${counter.n}`, state }, content: m[2] ? [text(m[2])] : [] };
}

const bulletItem = (m) => ({ type: 'listItem', content: [para(m[1])] });

function readParagraph(lines, i, content) {
  const run = [];
  let j = i;
  while (j < lines.length && lines[j].trim() !== '' && (j === i || !startsBlock(lines[j]))) run.push(lines[j++]);
  content.push(paragraph(run));
  return j;
}

const startsBlock = (line) => FENCE.test(line) || HEADING.test(line) || TASK.test(line) || BULLET.test(line);
