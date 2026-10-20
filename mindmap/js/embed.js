/*
 * embed.js —— 把导图作为「只读视图」嵌进资料详情页。
 *
 * 用法：
 *   <iframe src="/mindmap/embed.html?embed=1"></iframe>
 *   宿主监听 message：{type:'mm-ready'} 后发送 {type:'mm:load', map}
 *   导图处理完回传 {type:'mm:loaded'} 或 {type:'mm:error', message}
 *
 * map 是导图自己的数据格式（title + nodes 树 + 可选 pos/size）。
 * 这里只调用组员暴露的 window.Mindmap.replaceDocument()，不碰内部实现。
 */
(function () {
  'use strict';

  var embed = new URLSearchParams(location.search).get('embed') === '1';

  if (embed) {
    document.documentElement.classList.add('mm-embed');
    var style = document.createElement('style');
    style.textContent = [
      'html.mm-embed, html.mm-embed body { height: 100%; }',
      'html.mm-embed .mm-head { display: none !important; }',
      'html.mm-embed #banner { display: none !important; }',
      'html.mm-embed #mmShortcuts { display: none !important; }',
      'html.mm-embed body.mm-shortcuts-open #mmBox { padding-right: 0 !important; }',
      'html.mm-embed .mm-box { height: 100vh !important; padding: 0 !important; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  function post(message) {
    try { parent.postMessage(message, '*'); } catch (e) { /* 跨域失败就静默 */ }
  }

  window.addEventListener('message', function (event) {
    var data = event.data || {};
    if (data.type !== 'mm:load' || !data.map) return;
    if (!window.Mindmap || typeof window.Mindmap.replaceDocument !== 'function') {
      post({ type: 'mm:error', message: '导图模块还没加载完' });
      return;
    }
    try {
      window.Mindmap.replaceDocument(data.map);
      if (data.fit !== false) {
        setTimeout(function () {
          try {
            if (typeof window.Mindmap.zoom === 'function') window.Mindmap.zoom(1);
          } catch (e) { /* 缩放失败不影响显示 */ }
        }, 120);
      }
      post({ type: 'mm:loaded' });
    } catch (err) {
      post({ type: 'mm:error', message: String((err && err.message) || err) });
    }
  });

  window.addEventListener('load', function () {
    post({ type: 'mm-ready' });
  });
})();
