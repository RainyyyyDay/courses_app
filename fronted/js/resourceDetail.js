/*
 * resourceDetail.js
 * 资料 / 笔记详情页（含文件预览）
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

/* ========== 资源详情（资料 / 笔记通用，不复制两套页面） ========== */
let resourceDetailRequest = 0;

async function openResourceDetail(resourceType, resourceId) {
  navStack.push(currentView);
  currentView = { type: 'resource', resourceType: resourceType, id: resourceId };
  await renderResourceDetailPage(resourceType, resourceId);
}

async function renderResourceDetailPage(resourceType, resourceId) {
  const request = ++resourceDetailRequest;
  const courseId = currentCourseId;
  const isCurrent = () => request === resourceDetailRequest && currentCourseId === courseId
    && currentView.type === 'resource' && currentView.resourceType === resourceType && currentView.id === resourceId;
  showPageOnly('resourceDetailPage');

  const label = resourceType === 'note' ? '笔记' : '资料';
  document.getElementById('resourceDetailTitle').textContent = label + '详情';
  document.getElementById('resourceDetailName').textContent = '加载中…';
  document.getElementById('resourceDetailType').textContent = '';
  document.getElementById('resourceDetailMeta').textContent = '';
  document.getElementById('resourceDetailTags').innerHTML = '';
  document.getElementById('resourceDetailPreview').innerHTML = '';
  document.getElementById('resourceDetailOpen').href = '#';

  try {
    // 详情页的数据一律按 id 独立重新加载，不依赖列表缓存
    const res = await fetch(`${API}/${resourceType === 'note' ? 'notes' : 'materials'}/${resourceId}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || ('找不到' + label));
    }
    const row = await res.json();
    if (!isCurrent()) return;
    if (row.course_id !== courseId) throw new Error('这条内容不属于当前课程');
    renderResourceDetail(resourceType, row);
    if(typeof mountReviewPreparation==='function')mountReviewPreparation(document.getElementById('resourceDetailTags'),resourceType,row);
    if(typeof mountResourceAi==='function')mountResourceAi(document.getElementById('resourceDetailPreview').parentElement,resourceType,row);
    if(typeof mountItemReviewHistory==='function')mountItemReviewHistory(document.getElementById('resourceDetailPreview').parentElement,resourceType,row.id);
  } catch (err) {
    if (!isCurrent()) return;
    console.warn('加载资源详情失败:', err.message);
    showToast(err.message || ('加载' + label + '详情失败'));
    await backFromDetail(); // 资源可能已被删掉，退回来源页
  }
}

function renderResourceDetail(resourceType, item) {
  const label = resourceType === 'note' ? '笔记' : '资料';
  const hasFile = !!item.file_url;
  const url = 'http://localhost:3000' + (item.file_url || '');

  document.getElementById('resourceDetailTitle').textContent = label + '详情';
  document.getElementById('resourceDetailName').textContent = item.title || '（无标题）';

  const typeEl = document.getElementById('resourceDetailType');
  typeEl.textContent = label;
  typeEl.className = 'detail-type' + (resourceType === 'note' ? ' tag-knowledge' : ' tag-folder');

  const parts = [
    hasFile ? '文件类型：' + (item.file_type || '未知') : '✍ 手动输入',
    '创建时间：' + (item.created_at || '—')
  ];
  if (resourceType === 'note') parts.splice(1, 0, '来源：' + (item.source || '—'));
  document.getElementById('resourceDetailMeta').textContent = parts.join(' · ');

  const nodes = Array.isArray(item.nodes) ? item.nodes : [];
  document.getElementById('resourceDetailTags').innerHTML = nodes.length
    ? nodes.map(k => tagChipHtml({ id: k.id, name: k.name, type: k.type }, false, true)).join('')
    : '<span class="tag-none">暂无标签</span>';

  // 有文件才是“文件”区；手动输入的显示“内容”区
  document.getElementById('resourceDetailSectionTitle').textContent = hasFile ? '文件' : '内容';

  const openEl = document.getElementById('resourceDetailOpen');
  if (hasFile) {
    openEl.style.display = '';
    openEl.href = url;
    renderResourcePreview(item.file_type, url);
  } else {
    openEl.style.display = 'none';
    document.getElementById('resourceDetailPreview').innerHTML = item.content
      ? '<div class="detail-content">' + escapeHtml(item.content) + '</div>'
      : '<div class="empty">这条' + label + '是手动输入的，但没有填内容。</div>';
  }

  // 大纲结构图：有就显示，没有就整块隐藏
  const outlineSection = document.getElementById('resourceDetailOutlineSection');
  OUTLINE_MAP.currentTitle = item.title || '';
  let outlineText = item.outline || '';
  if (!outlineText && item.mindmap_json) {
    try { outlineText = mindmapToOutline(JSON.parse(item.mindmap_json)); } catch { outlineText = ''; }
  }
  const hasOutline = renderOutlineMap(document.getElementById('resourceDetailOutlineMap'), outlineText, { rootTitle: item.title || '' });
  const mapBox = document.getElementById('resourceDetailOutlineMap');
  if (mapBox && item.mindmap_image) {
    mapBox.innerHTML = `<img src="${item.mindmap_image}" alt="思维导图" style="max-width:100%;border-radius:10px;display:block;" />`;
  }
  if (outlineSection) outlineSection.style.display = hasOutline ? '' : 'none';
  // 有关联导图时，给一个「展开导图」入口，用功能包渲染真画布
  const head = outlineSection?.querySelector('.detail-section-title');
  if (head && !head.querySelector('.open-mindmap-btn')) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'edit-mini-btn open-mindmap-btn';
    edit.textContent = '在导图中编辑';
    edit.onclick = () => openMindmapEditor(item.mindmap_json, item.title, item.outline);
    head.appendChild(edit);

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'edit-mini-btn';
    back.style.marginLeft = '6px';
    back.textContent = '回传导图';
    back.onclick = () => reuploadMindmap(resourceType, item.id);
    head.appendChild(back);
  }
}

// 按文件类型做最简预览：图片直接显示、PDF 用 iframe，其它只给“打开文件”
function renderResourcePreview(fileType, url, target = null) {
  const box = target || document.getElementById('resourceDetailPreview');
  box.innerHTML = '';

  const type = String(fileType || '');

  if (type.indexOf('image/') === 0) {
    const img = document.createElement('img');
    img.className = 'mistake-detail-image';
    img.alt = '文件预览';
    img.onerror = () => {
      box.innerHTML = '<div class="empty">图片不存在或已丢失</div>';
    };
    img.src = url;
    box.appendChild(img);
    return;
  }

  if (type === 'application/pdf') {
    const frame = document.createElement('iframe');
    frame.className = 'resource-pdf';
    frame.src = url;
    box.appendChild(frame);
    return;
  }

  box.innerHTML =
    '<div class="empty">该文件类型（' + escapeHtml(type || '未知') +
    '）不支持在线预览，请点下面的“打开文件”。</div>';
}
