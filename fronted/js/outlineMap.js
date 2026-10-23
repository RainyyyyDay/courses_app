/*
 * 大纲 → 结构图（SVG）。
 *
 * 输入是缩进文本，缩进（每 2 个空格）表示层级，行首的 - / * / • 会被去掉：
 *   - 第一章
 *     - 1.1 极限
 *     - 1.2 连续
 *
 * 只做只读展示：左→右的树形布局，节点可换行，连接线是贝塞尔曲线。
 * 不引入任何第三方库，生成后可以直接缩放、打印、截图。
 */
const OUTLINE_MAP = { current: null, currentTitle: '' };

function parseOutlineTree(text, rootTitle) {
  const root = { text: rootTitle || '', children: [] };
  const stack = [root];
  const lines = String(text || '').split('\n');

  // 不强制缩进：能认出「第X章 / 一、 / （一） / 1.1 / #」就按编号推层级，
  // 认不出就用缩进；两者都没有就按平级处理。
  const syntaxDepth = (line) => {
    let match = line.match(/^(#{1,6})\s+/);
    if (match) return match[1].length - 1;
    if (/^第[一二三四五六七八九十百零〇\d]+[章节篇部分]/.test(line)) return 0;
    if (/^[一二三四五六七八九十]+、/.test(line)) return 1;
    if (/^[（(][一二三四五六七八九十\d]+[）)]/.test(line)) return 2;
    match = line.match(/^(\d+(?:\.\d+)*)[.、)）]\s*/);
    if (match) return Math.min(match[1].split('.').length, 3);
    return null;
  };

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const indent = (raw.match(/^\s*/) || [''])[0].replace(/\t/g, '  ').length;
    const byIndent = Math.floor(indent / 2);
    const bySyntax = syntaxDepth(raw.trim());
    const depth = bySyntax === null ? byIndent : Math.max(byIndent, Math.min(bySyntax, 3));
    const label = raw.trim().replace(/^[-*•]\s*/, '').trim();
    if (!label) continue;

    const node = { text: label, children: [] };
    while (stack.length > depth + 1) stack.pop();
    const parent = stack[stack.length - 1] || root;
    parent.children.push(node);
    stack.push(node);
  }

  // 没有标题时，用第一条作为根
  if (!root.text && root.children.length) {
    root.text = root.children[0].text;
    root.children = root.children[0].children;
  }
  return root;
}

function wrapText(text, perLine, maxLines) {
  const value = String(text || '');
  const lines = [];
  for (let i = 0; i < value.length && lines.length < maxLines; i += perLine) {
    lines.push(value.slice(i, i + perLine));
  }
  if (value.length > perLine * maxLines && lines.length) {
    lines[lines.length - 1] = lines[lines.length - 1].slice(0, perLine - 1) + '…';
  }
  return lines.length ? lines : [''];
}

function renderOutlineSvg(text, options = {}) {
  const root = parseOutlineTree(text, options.rootTitle || '');
  const boxW = options.boxWidth || 168;
  const gapX = 56;
  const rowH = 14;
  const padY = 12;
  const fontSize = 13;
  const perLine = 11;
  const maxLines = 4;

  let cursorY = 40;
  const nodes = [];
  const edges = [];

  const measure = (node) => {
    node.lines = wrapText(node.text, perLine, maxLines);
    node.h = node.lines.length * rowH + padY;
    node.children.forEach(measure);
  };
  measure(root);

  const place = (node, depth) => {
    node.depth = depth;
    node.x = 40 + depth * (boxW + gapX);
    if (!node.children.length) {
      node.y = cursorY;
      cursorY += node.h + 14;
    } else {
      node.children.forEach((child) => place(child, depth + 1));
      const first = node.children[0];
      const last = node.children[node.children.length - 1];
      node.y = (first.y + last.y) / 2;
      node.children.forEach((child) => edges.push({ from: node, to: child }));
    }
    nodes.push(node);
  };
  place(root, 0);

  const maxDepth = Math.max(...nodes.map((n) => n.depth));
  const width = 80 + (maxDepth + 1) * boxW + maxDepth * gapX;
  const height = Math.max(120, cursorY + 20);
  const palette = ['#3b6cf6', '#4f8df5', '#22a06b', '#c98a2b', '#8a6cf0'];

  const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'Microsoft YaHei', system-ui, sans-serif">`,
    `<rect width="${width}" height="${height}" fill="#fbfcff"/>`,
  ];

  for (const edge of edges) {
    const x1 = edge.from.x + boxW;
    const y1 = edge.from.y + edge.from.h / 2;
    const x2 = edge.to.x;
    const y2 = edge.to.y + edge.to.h / 2;
    const mid = (x1 + x2) / 2;
    parts.push(`<path d="M${x1} ${y1} C${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" fill="none" stroke="#c3cde6" stroke-width="1.6"/>`);
  }

  for (const node of nodes) {
    const color = palette[node.depth % palette.length];
    const isRoot = node.depth === 0;
    parts.push(
      `<g class="outline-node" data-text="${esc(node.text)}" style="cursor:pointer">`
      + `<title>${esc(node.text)}</title>`
      + `<rect x="${node.x}" y="${node.y}" width="${boxW}" height="${node.h}" rx="10" fill="${isRoot ? color : '#ffffff'}" stroke="${color}" stroke-width="${isRoot ? 0 : 1.4}"/>`,
    );
    node.lines.forEach((line, index) => {
      const y = node.y + 13 + index * rowH;
      const fill = isRoot ? '#ffffff' : '#1b2230';
      const weight = isRoot ? 600 : 400;
      parts.push(`<text x="${node.x + 12}" y="${y}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${esc(line)}</text>`);
    });
    parts.push('</g>');
  }

  parts.push('</svg>');
  return parts.join('');
}

function renderOutlineMap(container, text, options = {}) {
  if (!container) return false;
  const value = String(text || '').trim();
  if (!value) {
    container.innerHTML = '';
    return false;
  }
  container.innerHTML = renderOutlineSvg(value, options);
  bindOutlineNodeClick(container);
  OUTLINE_MAP.current = value;
  return true;
}

// 点击任意节点看完整文字（预览里会截断）
function bindOutlineNodeClick(container) {
  if (!container || container.dataset.bound === '1') return;
  container.dataset.bound = '1';
  container.addEventListener('click', (event) => {
    const group = event.target.closest('.outline-node');
    if (!group) return;
    showOutlineNodePopup(group.getAttribute('data-text') || '');
  });
}

function showOutlineNodePopup(text) {
  let popup = document.getElementById('outlineNodePopup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'outlineNodePopup';
    popup.style.cssText = 'display:none;position:fixed;inset:0;z-index:10001;background:rgba(17,25,40,.45);align-items:center;justify-content:center;padding:24px;';
    popup.innerHTML = `<div style="max-width:720px;max-height:80vh;overflow:auto;background:#fff;border-radius:14px;padding:20px 22px;box-shadow:0 24px 60px rgba(17,25,40,.3);">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:10px;">
        <b style="font-size:15px;">节点内容</b>
        <button type="button" class="edit-mini-btn" onclick="document.getElementById('outlineNodePopup').style.display='none'">关闭</button>
      </div>
      <div id="outlineNodePopupText" style="white-space:pre-wrap;line-height:1.75;font-size:14px;color:#1b2230;"></div>
    </div>`;
    popup.addEventListener('click', (e) => { if (e.target === popup) popup.style.display = 'none'; });
    document.body.appendChild(popup);
  }
  document.getElementById('outlineNodePopupText').textContent = text;
  popup.style.display = 'flex';
}

function openOutlineFullscreen() {
  const overlay = document.getElementById('outlineFullscreen');
  const body = document.getElementById('outlineFullscreenBody');
  if (!overlay || !body) return;
  body.innerHTML = OUTLINE_MAP.current
    ? renderOutlineSvg(OUTLINE_MAP.current, { rootTitle: OUTLINE_MAP.currentTitle })
    : '<div class="empty">还没有大纲</div>';
  bindOutlineNodeClick(body);
  overlay.classList.add('show');
}

function closeOutlineFullscreen() {
  const overlay = document.getElementById('outlineFullscreen');
  if (overlay) overlay.classList.remove('show');
}

// ===== 大纲 ⇄ 导图数据（功能包的 map.json） =====
function outlineToMindmap(text, title) {
  let rootTitle = title || '思维导图';
  // 文件上传的资料标题可能是哈希/UUID，不适合当中心主题：改用大纲首行
  if (/^[0-9a-f][0-9a-f-]{15,}$/i.test(rootTitle.replace(/\.[a-z0-9]+$/i, ''))) {
    const first = String(text || '').trim().split('\n')[0] || '';
    rootTitle = first.replace(/^[-*•]\s*/, '').trim().slice(0, 40) || '思维导图';
  }
  const tree = parseOutlineTree(text, rootTitle);
  let seq = 0;
  const walk = (node) => ({
    id: `n${(seq += 1)}`,
    text: node.text,
    children: node.children.map(walk),
  });
  return {
    id: `material-${Date.now()}`,
    title: rootTitle,
    nodes: [walk(tree)],
    pos: {},
    size: {},
    edges: [],
    v: 3,
  };
}

// 把导图数据摊回缩进文本，好复用上面的 SVG 渲染
function mindmapToOutline(map) {
  // 平铺导图（flat + edges）：节点都在顶层，关系靠连线。
  // 预览时取连接最多的那个当中心，其余作为它的子节点，保证所有节点都能显示。
  if (map && map.flat === true && Array.isArray(map.nodes) && Array.isArray(map.edges)) {
    const degree = new Map();
    const bump = (id) => degree.set(id, (degree.get(id) || 0) + 1);
    for (const edge of map.edges) {
      if (edge?.from?.node) bump(edge.from.node);
      if (edge?.to?.node) bump(edge.to.node);
    }
    const ranked = [...map.nodes].sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0));
    const center = ranked[0];
    if (center) {
      const lines = [`- ${String(center.text || '').replace(/\s*\n+\s*/g, ' ').trim() || '思维导图'}`];
      for (const node of map.nodes) {
        if (node === center) continue;
        const text = String(node.text || '').replace(/\s*\n+\s*/g, ' ').trim();
        if (text) lines.push(`  - ${text}`);
      }
      if (lines.length > 1) return lines.join('\n');
    }
  }
  const root = Array.isArray(map?.nodes) ? map.nodes[0] : null;
  if (!root) return '';
  const lines = [];
  const walk = (node, depth) => {
    const text = String(node.text || '').replace(/\s*\n+\s*/g, ' ').trim();
    if (text) lines.push(`${'  '.repeat(depth)}- ${text}`);
    (node.children || []).forEach((child) => walk(child, depth + 1));
  };
  walk(root, 0);
  return lines.join('\n');
}

function countMindmapNodes(map) {
  let count = 0;
  const walk = (node) => {
    count += 1;
    (node.children || []).forEach(walk);
  };
  (Array.isArray(map?.nodes) ? map.nodes : []).forEach(walk);
  return count;
}

// 下载导图 JSON，交给导图工具导入
function downloadMindmapJson(mapJson, title) {
  let map = null;
  try { map = typeof mapJson === 'string' ? JSON.parse(mapJson) : mapJson; } catch { map = null; }
  if (!map || !Array.isArray(map.nodes)) { showToast('没有可下载的导图数据'); return; }
  const safe = String(title || map.title || '思维导图').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  const blob = new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safe}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('已下载导图 JSON，可在导图工具里导入');
}

// 导图工具地址：她的本地服务默认 8794，部署后换成正式地址即可
const MINDMAP_APP_URL = globalThis.MINDMAP_APP_URL || 'http://127.0.0.1:8794/';

// 跳到导图工具，带上标题与大纲，让对方那边直接新建
async function openMindmapEditor(mapJson, title, outline) {
  const target = window.__mindmapTarget;
  if (!target) { showToast('请从资料详情页进入'); return; }
  const collection = target.resourceType === 'note' ? 'notes' : 'materials';
  try {
    // 走她定义的交接协议：先向后端申请一次性 token
    const response = await requestApi(`${API}/courses/${currentCourseId}/${collection}/${target.id}/handoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await response.json();
    // The page may be served by the AI harness on 3002 while business APIs stay on 3000.
    // Resolve the bridge against the API origin, never the page origin.
    const apiBase = new URL(API, location.href);
    const bridge = new URL(data.bridge || '/api/mindmap-handoffs', apiBase).href.replace(/\/+$/, '');
    const url = MINDMAP_APP_URL.replace(/\/?$/, '/')
      + '?from=courses_app&bridge=' + encodeURIComponent(bridge)
      + '#handoff=' + data.token;
    window.__mindmapEditorWindow = window.open(url, '_blank');
    showToast('已打开导图工具；改完点「保存并回传课程」即可');
  } catch (err) {
    showToast('打开导图失败：' + err.message);
  }
}

// 导图工具点「回传到课程网站」→ 直接写入当前资料，不需要下载文件
window.addEventListener('message', (event) => {
  if (event.data?.type !== 'mm:send' || !event.data.map) return;
  const target = window.__mindmapTarget;
  if (!target) { showToast('没有正在编辑的资料'); return; }
  const path = target.resourceType === 'note' ? 'notes' : 'materials';
  requestApi(`${API}/courses/${currentCourseId}/${path}/${target.id}/mindmap`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    // 清掉旧截图，否则详情页会继续优先显示那张旧图
    // 只更新导图，绝不动大纲：大纲是用户/AI 的输入，导图是产物
    body: JSON.stringify({ mindmapJson: JSON.stringify(event.data.map), mindmapImage: '' }),
  }).then(() => {
    showToast('导图已回传并保存');
    openResourceDetail(target.resourceType, target.id);
  }).catch((err) => showToast('回传失败：' + err.message));
});

let mindmapReturnRefresh = null;
async function refreshActiveMindmapResource() {
  const target = window.__mindmapTarget;
  if (!target?.baseline || document.visibilityState === 'hidden'
    || currentCourseId !== target.courseId || currentView.type !== 'resource'
    || currentView.id !== target.id || currentView.resourceType !== target.resourceType) return false;
  if (mindmapReturnRefresh) return mindmapReturnRefresh;
  mindmapReturnRefresh = (async () => {
    try {
      const path = target.resourceType === 'note' ? 'notes' : 'materials';
      const response = await requestApi(`${API}/${path}/${target.id}`);
      const row = await response.json();
      if (!row || row.course_id !== currentCourseId || currentView.type !== 'resource' || currentView.id !== target.id) return false;
      const before = target.baseline;
      const changed = ['mindmap_json', 'mindmap_image', 'outline'].some(key => String(row[key] || '') !== String(before[key] || ''));
      if (!changed) return false;
      const list = target.resourceType === 'note' ? currentNotes : currentMaterials;
      const index = list.findIndex(item => item.id === target.id);
      if (index >= 0) list[index] = {...list[index], ...row};
      target.baseline = {mindmap_json:row.mindmap_json || '',mindmap_image:row.mindmap_image || '',outline:row.outline || ''};
      renderResourceDetail(target.resourceType, row);
      if (typeof mountReviewPreparation === 'function') {
        mountReviewPreparation(document.getElementById('resourceDetailTags'), target.resourceType, row);
      }
      showToast('导图已自动更新');
      return true;
    } catch {
      return false;
    } finally {
      mindmapReturnRefresh = null;
    }
  })();
  return mindmapReturnRefresh;
}
function scheduleMindmapReturnRefresh() {
  if (document.visibilityState === 'hidden') return;
  void refreshActiveMindmapResource();
  setTimeout(() => { void refreshActiveMindmapResource(); }, 700);
}
window.addEventListener('focus', scheduleMindmapReturnRefresh);
window.addEventListener('pageshow', scheduleMindmapReturnRefresh);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleMindmapReturnRefresh();
});

// 把她那边编辑/导出的文件传回来，更新当前资料/笔记的导图
function reuploadMindmap(resourceType, id) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json,image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const payload = {};
      try {
        if (/json$/i.test(file.type) || /\.json$/i.test(file.name)) {
          const map = JSON.parse(String(reader.result || ''));
          if (!Array.isArray(map.nodes)) throw new Error('JSON 里没有 nodes');
          payload.mindmapJson = JSON.stringify(map);
        } else {
          payload.mindmapImage = String(reader.result || '');
        }
        const path = resourceType === 'note' ? 'notes' : 'materials';
        await requestApi(`${API}/courses/${currentCourseId}/${path}/${id}/mindmap`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        showToast('导图已更新');
        openResourceDetail(resourceType, id);
      } catch (err) {
        showToast('上传失败：' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}
