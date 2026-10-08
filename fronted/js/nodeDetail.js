/*
 * nodeDetail.js
 * 节点详情页（分类 / 知识点通用）
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */


/* ========== 节点详情（folder / knowledge 通用） ========== */

async function openNodeDetail(nodeId) {
  navStack.push(currentView);
  currentView = { type: 'node', id: nodeId };
  await renderNodeDetailPage(nodeId);
}

async function renderNodeDetailPage(nodeId) {
  showPageOnly('nodeDetailPage');

  document.getElementById('nodeDetailTitle').textContent = '节点详情';
  document.getElementById('nodeDetailName').textContent = '加载中…';
  document.getElementById('nodeDetailType').textContent = '';
  document.getElementById('nodeDetailType').className = 'detail-type';
  document.getElementById('nodeDetailCourse').textContent = '';
  document.getElementById('nodeDetailPath').textContent = '';
  document.getElementById('nodeDetailMistakeTitle').textContent = '关联错题';
  document.getElementById('nodeDetailMistakeList').innerHTML =
    '<div class="loading-tip">加载中…</div>';
  document.getElementById('nodeDetailMaterialTitle').textContent = '关联资料';
  document.getElementById('nodeDetailMaterialList').innerHTML = '';
  document.getElementById('nodeDetailNoteTitle').textContent = '关联笔记';
  document.getElementById('nodeDetailNoteList').innerHTML = '';

  try {
    // 每次打开都重新拉：路径与关联错题都必须是后端的最新结果（节点可能刚被移动过）
    const res = await fetch(`${API}/knowledge-nodes/${nodeId}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '找不到节点');
    }
    renderNodeDetail(await res.json());
  } catch (err) {
    // 节点可能是刚被删掉的，属于正常的“找不到”，用 warn 就够了，不给控制台报错
    console.warn('加载节点详情失败:', err.message);
    showToast(err.message || '加载节点详情失败');
    // 直接退回来源页：navStack 顶部就是刚 push 进来的来源视图
    await backFromDetail();
  }
}

function renderNodeDetail(node) {
  const typeLabel =
    node.type === 'folder' ? '分类' : (node.type === 'knowledge' ? '知识点' : '节点');

  document.getElementById('nodeDetailTitle').textContent = node.name;
  document.getElementById('nodeDetailName').textContent = node.name;
  const typeEl = document.getElementById('nodeDetailType');
  typeEl.textContent = typeLabel;
  typeEl.className = 'detail-type ' + (node.type === 'folder' ? 'tag-folder' : 'tag-knowledge');
  document.getElementById('nodeDetailCourse').textContent =
    node.course ? node.course.name : '（课程已删除）';

  // 路径由后端给（getKnowledgePath），前端不自己拼父级链
  const path = Array.isArray(node.path) ? node.path : [];
  document.getElementById('nodeDetailPath').innerHTML = path.length
    ? path
        .map(
          (p, i) =>
            (i ? '<span class="path-sep">›</span>' : '') +
            `<span class="path-item">${escapeHtml(p.name)}</span>`
        )
        .join('')
    : '<span class="tag-none">（无路径）</span>';

  const mistakes = Array.isArray(node.mistakes) ? node.mistakes : [];
  document.getElementById('nodeDetailMistakeTitle').textContent =
    '关联错题（' + mistakes.length + '）';

  const box = document.getElementById('nodeDetailMistakeList');
  if (mistakes.length === 0) {
    box.innerHTML = '<div class="empty">暂无关联错题</div>';
  } else {
    box.innerHTML = mistakes
      .map(
        m => `
    <div class="item-row detail-link-row" onclick="openMistakeDetail(${m.id})">
      <div class="info">
        <div class="title">${escapeHtml(m.title)}</div>
        <div class="meta">${escapeHtml(m.created_at || '')}</div>
      </div>
      <span class="row-arrow">›</span>
    </div>`
      )
      .join('');
  }

  // 关联资料 / 关联笔记：同样只显示直接绑定当前节点的，不聚合子节点
  renderNodeResourceSection(
    'Material',
    '关联资料',
    Array.isArray(node.materials) ? node.materials : [],
    '暂无关联资料',
    'material'
  );
  renderNodeResourceSection(
    'Note',
    '关联笔记',
    Array.isArray(node.notes) ? node.notes : [],
    '暂无关联笔记',
    'note'
  );
}

// 节点详情里的“关联资料 / 关联笔记”section
function renderNodeResourceSection(key, label, items, emptyText, resourceType) {
  document.getElementById('nodeDetail' + key + 'Title').textContent =
    label + '（' + items.length + '）';

  const box = document.getElementById('nodeDetail' + key + 'List');
  if (items.length === 0) {
    box.innerHTML = '<div class="empty">' + emptyText + '</div>';
    return;
  }

  box.innerHTML = items
    .map(
      r => `
    <div class="item-row detail-link-row" onclick="openResourceDetail('${resourceType}', ${r.id})">
      <div class="info">
        <div class="title">${escapeHtml(r.title)}</div>
        <div class="meta">${escapeHtml(r.created_at || '')}</div>
      </div>
      <span class="row-arrow">›</span>
    </div>`
    )
    .join('');
}
