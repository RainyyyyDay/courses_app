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
    var params = new URLSearchParams(location.search);
    var api = params.get('api');
    var course = params.get('course');
    var type = params.get('type');
    var id = params.get('id');

    // 优先用现有的导图数据（含用户以前在导图里加的节点），没有才用大纲新建
    if (api && type && id) {
      var path = type === 'note' ? 'notes' : 'materials';
      return fetch(api.replace(/\/$/, '') + '/' + path + '/' + id)
        .then(function (res) { return res.ok ? res.json() : null; })
        .catch(function () { return null; })
        .then(function (row) {
          var existing = null;
          try { existing = row && row.mindmap_json ? JSON.parse(row.mindmap_json) : null; } catch (e) { existing = null; }
          if (existing && Array.isArray(existing.nodes) && existing.nodes.length) {
            try {
              if (typeof window.Mindmap.openInMemory === 'function') {
                return Promise.resolve(window.Mindmap.openInMemory(existing)).then(function () { return true; });
              }
              window.Mindmap.openDocument(existing);
              return true;
            } catch (e1) {
              // 有些数据 openDocument 会拒（缺字段等），退回直接替换当前文档
              try {
                if (typeof window.Mindmap.replaceDocument === 'function') {
                  window.Mindmap.replaceDocument(JSON.parse(JSON.stringify(existing)));
                  return true;
                }
              } catch (e2) { /* 继续退回新建 */ }
            }
          }
          try { window.Mindmap.openDocument(buildMap()); return true; } catch (e) { return false; }
        });
    }
    try {
      window.Mindmap.openDocument(buildMap());
      return true;
    } catch (err) {
      console.warn('[courses-handoff] 打开失败', err);
      return false;
    }
  }

  // 回传按钮：只在本页是从课程网站打开时出现
  function addSendBackButton() {
    if (document.getElementById('coursesSendBack')) return;
    var btn = document.createElement('button');
    btn.id = 'coursesSendBack';
    btn.type = 'button';
    var label = new URLSearchParams(location.search).get('label') || '';
    btn.textContent = (label ? ('回传到《' + label + '》') : '回传到课程网站') + ' v3';
    btn.style.cssText = [
      'position:fixed', 'right:18px', 'bottom:18px', 'z-index:99999',
      'padding:10px 16px', 'border:0', 'border-radius:10px',
      'background:#3b6cf6', 'color:#fff', 'font:14px/1.4 "Microsoft YaHei",system-ui,sans-serif',
      'cursor:pointer', 'box-shadow:0 8px 20px rgba(59,108,246,.35)'
    ].join(';');
    btn.addEventListener('click', function () {
      var map = null;
      try {
        map = window.Mindmap && typeof window.Mindmap.editingSnapshot === 'function'
          ? window.Mindmap.editingSnapshot()
          : null;
      } catch (err) { map = null; }
      if (!map) { alert('当前没有可回传的导图'); return; }
      var nodeCount = 0;
      (map.nodes || []).forEach(function walk(n) {
        nodeCount += 1;
        (n.children || []).forEach(walk);
      });
      var params = new URLSearchParams(location.search);
      var api = params.get('api');
      var course = params.get('course');
      var type = params.get('type');
      var id = params.get('id');

      function done(ok, message) {
        var base = label ? ('回传到《' + label + '》') : '回传到课程网站';
        btn.textContent = ok ? ('已回传 ✓ ' + nodeCount + ' 节点') : ('回传失败：' + message);
        setTimeout(function () { btn.textContent = base; }, 2600);
      }

      // 优先直连课程网站接口（不依赖 window.opener）
      if (api && course && type && id) {
        var path = type === 'note' ? 'notes' : 'materials';
        fetch(api.replace(/\/$/, '') + '/courses/' + course + '/' + path + '/' + id + '/mindmap', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mindmapJson: JSON.stringify(map), mindmapImage: '' })
        }).then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          done(true);
        }).catch(function (err) { done(false, err.message); });
        return;
      }

      // 兜底：从课程网站打开时用 opener 传
      if (window.opener) {
        window.opener.postMessage({ type: 'mm:send', map: map }, '*');
        done(true);
        return;
      }
      done(false, '缺少回传参数，请从课程网站重新打开');
    });
    document.body.appendChild(btn);

    // 常驻显示当前画布节点数，方便一眼看出打开的是哪张图
    setInterval(function () {
      if (btn.textContent.indexOf('回传失败') === 0 || btn.textContent.indexOf('已回传') === 0) return;
      var map = null;
      try { map = window.Mindmap && window.Mindmap.editingSnapshot ? window.Mindmap.editingSnapshot() : null; } catch (e) { map = null; }
      if (!map || !map.nodes) return;
      var n = 0;
      map.nodes.forEach(function walk(x) { n += 1; (x.children || []).forEach(walk); });
      var base = label ? ('回传到《' + label + '》') : '回传到课程网站';
      btn.textContent = base + ' · ' + n + ' 节点';
    }, 1500);
  }

  if (document.readyState === 'complete') {
    setTimeout(function () { start(); addSendBackButton(); }, 200);
  } else {
    window.addEventListener('load', function () { setTimeout(function () { start(); addSendBackButton(); }, 200); });
  }
})();
