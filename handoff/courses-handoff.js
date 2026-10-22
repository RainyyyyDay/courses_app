/*
 * 课程网站 → 导图工具 的交接脚本。
 *
 * 只在 URL 带 ?from=courses_app 时生效，其余情况一行逻辑都不执行，
 * 不会影响导图工具现有功能。
 *
 * 参数：
 *   title   新导图标题
 *   outline 大纲原文（缩进两格表示下一级，行首 - 会被去掉）
 *
 * 行为：新建一张导图 → 预填节点 → 直接进入这张图的编辑页。
 */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  if (params.get('from') !== 'courses_app') return;

  var title = (params.get('title') || '新导图').slice(0, 80);
  var outline = params.get('outline') || '';

  function parseOutline(text) {
    var root = { text: title, children: [] };
    var stack = [root];
    String(text).split('\n').forEach(function (raw) {
      if (!raw.trim()) return;
      var indent = (raw.match(/^\s*/) || [''])[0].replace(/\t/g, '  ').length;
      var depth = Math.floor(indent / 2);
      var label = raw.trim().replace(/^[-*•]\s*/, '').trim();
      if (!label) return;
      var node = { text: label, children: [] };
      while (stack.length > depth + 1) stack.pop();
      (stack[stack.length - 1] || root).children.push(node);
      stack.push(node);
    });
    return root;
  }

  function buildMap() {
    var seq = 0;
    function walk(node) {
      seq += 1;
      return { id: 'n' + seq, text: node.text, children: (node.children || []).map(walk) };
    }
    return {
      id: 'courses-' + Date.now(),
      title: title,
      nodes: [walk(parseOutline(outline))],
      pos: {},
      size: {},
      edges: [],
      v: 3
    };
  }

  function start() {
    if (!window.Mindmap || typeof window.Mindmap.openDocument !== 'function') return false;
    try {
      window.Mindmap.openDocument(buildMap());
      return true;
    } catch (err) {
      console.warn('[courses-handoff] 打开失败', err);
      return false;
    }
  }

  if (document.readyState === 'complete') {
    setTimeout(start, 200);
  } else {
    window.addEventListener('load', function () { setTimeout(start, 200); });
  }
})();
