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
  if(typeof resetResourceAi==='function')resetResourceAi();
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
  document.getElementById('resourceDetailContentSection').hidden = true;
  document.getElementById('resourceDetailContent').textContent = '';
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
    if(globalThis.COURSES_SHOW_LEGACY_RESOURCE_AI===true&&typeof mountResourceAi==='function')mountResourceAi(document.getElementById('resourceDetailPreview').parentElement,resourceType,row);
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
  const url = attachmentUrl(item.file_url||'');

  document.getElementById('resourceDetailTitle').textContent = label + '详情';
  document.getElementById('resourceDetailName').textContent = item.title || '（无标题）';
  if (window.__mindmapTarget?.courseId === currentCourseId
    && window.__mindmapTarget.resourceType === (resourceType === 'note' ? 'note' : 'material')
    && window.__mindmapTarget.id === item.id) {
    window.__mindmapTarget.baseline = {
      mindmap_json: item.mindmap_json || '',
      mindmap_image: item.mindmap_image || '',
      outline: item.outline || ''
    };
  }

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
    openEl.style.display = 'none';
    openEl.href = url;
    renderResourcePreview(item.file_type, url);
  } else {
    openEl.style.display = 'none';
    document.getElementById('resourceDetailPreview').innerHTML = item.content
      ? '<div class="detail-content">' + escapeHtml(item.content) + '</div>'
      : '<div class="empty">这条' + label + '是手动输入的，但没有填内容。</div>';
  }

  // 附件和正文可以同时存在；不能因为有附件而跳过已经保存的正文。
  const content = String(item.content || '');
  const contentSection = document.getElementById('resourceDetailContentSection');
  const contentBox = document.getElementById('resourceDetailContent');
  contentSection.hidden = !hasFile || !content.trim();
  contentBox.textContent = hasFile ? content : '';

  // 大纲 + 思维导图：详情页里直接可编辑（和上传弹窗一致）
  const outlineSection = document.getElementById('resourceDetailOutlineSection');
  OUTLINE_MAP.currentTitle = item.title || '';
  // 导图数据是权威来源（用户在导图工具里改过）；没有导图才退回大纲文本
  let outlineText = '';
  if (item.mindmap_json) {
    try { outlineText = mindmapToOutline(JSON.parse(item.mindmap_json)); } catch { outlineText = ''; }
  }
  if (!outlineText) outlineText = item.outline || '';
  if (outlineSection) {
    outlineSection.style.display = '';
  }
  const hasOutline = renderOutlineMap(document.getElementById('resourceDetailOutlineMap'), outlineText, { rootTitle: item.title || '' });
  const mapBox = document.getElementById('resourceDetailOutlineMap');
  if (mapBox && item.mindmap_image) {
    mapBox.innerHTML = `<img src="${item.mindmap_image}" alt="思维导图" style="max-width:100%;border-radius:10px;display:block;" />`;
  }
  if (!hasOutline && !item.mindmap_image) {
    if (mapBox) mapBox.innerHTML = '<div class="empty">还没有大纲，写一段再点“用大纲生成导图”。</div>';
  }
  // 导图入口：跳去她的工具编辑，或把她导出的文件传回来（编辑内容在「编辑标签」弹窗里）
  const head = outlineSection?.querySelector('.detail-section-title');
  if (head) {
    let edit = head.querySelector('.open-mindmap-btn');
    if (!edit) {
      edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'edit-mini-btn open-mindmap-btn';
      edit.textContent = '在导图中编辑';
      head.appendChild(edit);
    }
    edit.onclick = () => {
      window.__mindmapTarget = {
        courseId: currentCourseId,
        resourceType,
        id: item.id,
        label: item.title || '',
        baseline: {mindmap_json:item.mindmap_json||'',mindmap_image:item.mindmap_image||'',outline:item.outline||''}
      };
      openMindmapEditor(item.mindmap_json, item.title, item.outline);
    };

    let back = head.querySelector('.reupload-mindmap-btn');
    if (!back) {
      back = document.createElement('button');
      back.type = 'button';
      back.className = 'edit-mini-btn reupload-mindmap-btn';
      back.style.marginLeft = '6px';
      back.textContent = '上传导图';
      head.appendChild(back);
    }
    back.onclick = () => reuploadMindmap(resourceType, item.id);
  }
}

// 文件预览独立于正文：图片缩略图、PDF 预览入口，其它格式提供下载。
function renderResourcePreview(fileType, value, target = null) {
  const box=target||document.getElementById('resourceDetailPreview'),url=attachmentUrl(value),kind=attachmentKind(fileType,value);
  box.replaceChildren();
  if(!url){box.innerHTML='<p class="empty">附件地址不可用。</p>';return;}
  if(kind==='image'){
    const button=document.createElement('button');button.type='button';button.className='attachment-image-button';button.setAttribute('aria-label','放大查看图片');
    const img=document.createElement('img');img.className='mistake-detail-image';img.alt='附件图片预览';img.loading='lazy';img.src=url;
    img.onerror=()=>{button.replaceChildren(document.createTextNode('图片加载失败，可尝试下载原图。'));};button.append(img);button.onclick=()=>void openAttachmentPreview(url,fileType||'image/unknown','图片附件');box.append(button);
  }else if(kind==='pdf'){
    const card=document.createElement('div');card.className='attachment-pdf-card';card.textContent='PDF 文档 · 支持站内翻页和缩放';box.append(card);
  }
  box.insertAdjacentHTML('beforeend',attachmentActionsHtml(url,fileType,kind==='pdf'?'PDF':kind==='image'?'图片':'附件'));
}
