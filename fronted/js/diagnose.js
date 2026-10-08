/*
 * diagnose.js
 * 启动自检：万一某个 js 没加载成功、或者运行时报错，直接在页面顶部弹一条红色提示，
 * 写明「哪个文件 / 哪一行 / 什么错」。这样就不会再出现"白屏但不知道为什么"。
 *
 * 它是被 index.html 放在最前面加载的（在其它 js 之前），这样连"后面的脚本加载失败"
 * 也能被它抓到。
 *
 * 排查完可以删掉（连同 index.html 里的那一行），留着也不影响功能。
 */
(function () {
  var shown = false;

  function banner(text) {
    try {
      var box = document.getElementById('bootErrorBox');
      if (!box) {
        box = document.createElement('div');
        box.id = 'bootErrorBox';
        box.style.cssText = [
          'position:fixed', 'left:0', 'right:0', 'top:0', 'z-index:99999',
          'background:#c0392b', 'color:#fff', 'font:13px/1.7 monospace',
          'padding:10px 44px 10px 14px', 'white-space:pre-wrap',
          'word-break:break-all', 'box-shadow:0 2px 10px rgba(0,0,0,.3)'
        ].join(';');
        var close = document.createElement('button');
        close.textContent = '×';
        close.style.cssText = 'position:absolute;right:10px;top:6px;background:transparent;' +
          'border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1';
        close.onclick = function () { box.remove(); };
        box.appendChild(close);
        document.body.appendChild(box);
      }
      var line = document.createElement('div');
      line.textContent = text;
      box.appendChild(line);
      shown = true;
      console.error('[启动自检] ' + text);
    } catch (e) {
      console.error('[启动自检] 连错误都显示不出来：', e, text);
    }
  }

  // 1) 任何一个 <script> 加载失败（404 / 路径不对）
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'SCRIPT') {
      banner('✗ 脚本加载失败：' + (t.src || '（未知路径）'));
    } else if (e.message) {
      banner('✗ JS 报错：' + e.message + '\n    位置：' + (e.filename || '?') + ' 第 ' + e.lineno + ' 行');
    }
  }, true);

  // 2) Promise 里没被接住的错误
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    banner('✗ 未处理的错误：' + (r && r.message ? r.message : String(r)));
  });

  // 3) 所有脚本都加载完之后，点名检查关键函数在不在
  window.addEventListener('load', function () {
    var need = [
      'loadCourses', 'filterCourses', 'openCourseModal', 'addCourse',
      'openCourse', 'backToList', 'switchTab',
      'loadMaterials', 'loadNotes', 'loadAssessments', 'loadMistakes',
      'openManualModal', 'openTagPicker', 'confirmTagPicker',
      'showPageOnly', 'renderNodeDetail', 'loadTree', 'renderTree', 'toggleSortMode'
    ];
    var missing = need.filter(function (n) { return typeof window[n] !== 'function'; });
    if (missing.length) {
      banner('✗ 这些函数没加载出来：' + missing.join('、') +
        '\n    常见原因：对应的 js 文件 404（文件不在 js/ 目录里、或文件名拼错）、' +
        '或者该文件有语法错误被浏览器整份丢弃。');
    }
    if (!shown) console.log('[启动自检] 通过：脚本都加载好了');
  });
})();
