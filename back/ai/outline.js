/*
 * 从正文提炼「重点总结 / 大纲」。
 *
 * 先用本地规则：识别 Markdown 标题、中文序号（一、/（一）/第X章）、
 * 数字编号（1. / 1.1）和列表符号；都没有就按段落取首句。
 * 不依赖模型，离线可用；以后接了大模型可以在此基础上再润色。
 *
 * 输出是缩进文本，缩进代表层级：
 *   - 一级
 *     - 二级
 */

const MAX_ITEMS = 60;
const MAX_LEN = 60;

function clean(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\t/g, '    ');
}

function shorten(text) {
  const value = String(text || '').trim();
  if (value.length <= MAX_LEN) return value;
  const cut = value.slice(0, MAX_LEN);
  const stop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('，'), cut.lastIndexOf('；'));
  return (stop > 12 ? cut.slice(0, stop) : cut) + '…';
}

function detectLevel(line, index) {
  let match = line.match(/^(#{1,6})\s+(.*)$/);
  if (match) return { level: match[1].length - 1, text: match[2] };

  match = line.match(/^第[一二三四五六七八九十百零〇\d]+[章节篇部分]\s*(.*)$/);
  if (match) return { level: 0, text: match[1] || line };

  match = line.match(/^[一二三四五六七八九十]+、\s*(.*)$/);
  if (match) return { level: match[0].includes('、') ? 1 : 1, text: match[1] };

  match = line.match(/^[（(][一二三四五六七八九十\d]+[）)]\s*(.*)$/);
  if (match) return { level: 2, text: match[1] };

  match = line.match(/^(\d+(?:\.\d+)*)[.、)）]?\s+(.*)$/);
  if (match) return { level: Math.min(match[1].split('.').length, 3), text: match[2] };

  match = line.match(/^[-*•·]\s+(.*)$/);
  if (match) return { level: 1, text: match[1] };

  // 没有编号：当成正文段落，取首句
  return { level: index === 0 ? 0 : 1, text: firstSentence(line) };
}

function firstSentence(text) {
  const value = String(text || '').trim();
  const match = value.match(/^[^。！？!?；;]{4,}[。！？!?]?/);
  return match ? match[0] : value;
}

function buildOutline(rawText) {
  const lines = clean(rawText)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const items = [];
  for (let i = 0; i < lines.length && items.length < MAX_ITEMS; i += 1) {
    const line = lines[i];
    if (line.length < 2) continue;
    const { level, text } = detectLevel(line, items.length);
    const value = shorten(text);
    if (!value) continue;
    items.push({ level: Math.max(0, Math.min(level, 3)), text: value });
  }

  if (!items.length) return '';

  // 第一项永远当根节点，后面最多比它深三级
  const rootLevel = items[0].level;
  return items
    .map((item) => {
      const depth = Math.max(0, Math.min(item.level - rootLevel, 3));
      return `${'  '.repeat(depth)}- ${item.text}`;
    })
    .join('\n');
}

const MINDMAP_MAX_ITEMS = 60;
const MINDMAP_MAX_DEPTH = 2;
const MINDMAP_MAX_NODE_LENGTH = 60;

function mindmapNodeText(text) {
  return shorten(
    String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/[：:；;，,。.!！?？]+$/g, '')
      .trim(),
  );
}

function splitRunOnMindmapText(text) {
  const value = String(text || '').trim();
  const colon = value.match(/^(.{2,30})[：:]\s*(.+)$/);
  if (colon) {
    const children = colon[2]
      .split(/[、；;]+/)
      .map(mindmapNodeText)
      .filter(Boolean);
    if (children.length >= 2) {
      return [{ text: mindmapNodeText(colon[1]), delta: 0 }]
        .concat(children.map((child) => ({ text: child, delta: 1 })));
    }
  }

  const sentences = (value.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [])
    .map(mindmapNodeText)
    .filter(Boolean);
  if (sentences.length >= 2) {
    return sentences.map((sentence, index) => ({ text: sentence, delta: index ? 1 : 0 }));
  }
  return [];
}

function mindmapLineParts(rawLine, index) {
  const raw = String(rawLine || '');
  const indentation = (raw.match(/^\s*/) || [''])[0].replace(/\t/g, '    ').length;
  const byIndent = Math.floor(indentation / 2);
  let text = raw.trim();
  let level = null;
  let structured = false;
  let match;

  match = text.match(/^(#{1,6})\s+(.+)$/);
  if (match) {
    level = match[1].length - 1;
    text = match[2];
    structured = true;
  } else if (/^第[一二三四五六七八九十百零\d]+[章节篇部分]/.test(text)) {
    level = 0;
    structured = true;
  } else if (/^[一二三四五六七八九十]+、/.test(text)) {
    level = 1;
    text = text.replace(/^[一二三四五六七八九十]+、\s*/, '');
    structured = true;
  } else if ((match = text.match(/^[（(][一二三四五六七八九十\d]+[）)]\s*(.+)$/))) {
    level = 2;
    text = match[1];
    structured = true;
  } else if ((match = text.match(/^(\d+(?:\.\d+)*)[.．、)]?\s*(.+)$/))) {
    level = Math.min(match[1].split('.').length + 1, 4);
    text = match[2];
    structured = true;
  } else if ((match = text.match(/^[-*•·]\s+(.+)$/))) {
    level = 1;
    text = match[1];
    structured = true;
  }

  const node = mindmapNodeText(text);
  if (!node) return [];
  if (!structured) {
    const split = splitRunOnMindmapText(node);
    if (split.length) {
      const startLevel = index === 0 ? 0 : 1;
      return split.map((part) => ({ text: part.text, level: startLevel + part.delta }));
    }
    return [{ text: node, level: index === 0 ? 0 : 1 }];
  }
  return [{ text: node, level: Math.max(0, level + byIndent) }];
}

function buildMindmapOutline(rawText) {
  const lines = clean(rawText).split('\n').filter((line) => line.trim());
  const items = [];
  for (let index = 0; index < lines.length && items.length < MINDMAP_MAX_ITEMS; index += 1) {
    items.push(...mindmapLineParts(lines[index], index));
  }
  if (!items.length) return '';

  const rootLevel = items[0].level;
  const output = [];
  let previousText = '';
  let previousDepth = 0;
  for (const item of items.slice(0, MINDMAP_MAX_ITEMS)) {
    const text = mindmapNodeText(item.text).slice(0, MINDMAP_MAX_NODE_LENGTH).trim();
    if (!text || text === previousText) continue;
    let depth = Math.max(0, Math.min(item.level - rootLevel, MINDMAP_MAX_DEPTH));
    if (output.length) depth = Math.min(depth, previousDepth + 1);
    output.push(`${'  '.repeat(depth)}- ${text}`);
    previousText = text;
    previousDepth = depth;
  }
  return output.join('\n');
}

module.exports = { buildOutline, buildMindmapOutline };
