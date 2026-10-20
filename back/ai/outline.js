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

module.exports = { buildOutline };
