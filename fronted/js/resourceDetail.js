/*
 * resourceDetail.js
 * 资料 / 笔记详情页（含文件预览）
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

/* ========== 资源详情（资料 / 笔记通用，不复制两套页面） ========== */
let resourceDetailRequest = 0;
let resourceDetailRow = null;

async function openResourceDetailEditor(section = 'body', generate = '') {
  const row = resourceDetailRow, view = currentView;
  if (!row || view.type !== 'resource' || row.id !== view.id) return;
  await openTagPicker('edit', view.resourceType, row.id);
  const state = tagPickerState;
  if (!state || state.mode !== 'edit' || state.resourceType !== view.resourceType || state.resourceId !== row.id) return;
  const target = document.getElementById(section === 'outline' ? 'tagPickerOutlineBlock' : 'tagPickerResourceFields');
  target?.scrollIntoView({ block: 'start', behavior: 'instant' });
  const field = document.getElementById(section === 'outline' ? 'tagPickerOutline' : 'tagPickerResourceContent');
  field?.focus({ preventScroll: true });
  if (generate) await generatePickerOutline(generate);
}

async function openResourceDetail(resourceType, resourceId) {
  navStack.push(currentView);
  currentView = { type: 'resource', resourceType: resourceType, id: resourceId };
  await renderResourceDetailPage(resourceType, resourceId);
}

async function renderResourceDetailPage(resourceType, resourceId) {
  if(typeof resetResourceAi==='function')resetResourceAi();
  const request = ++resourceDetailRequest;
  resourceDetailRow = null;
  const courseId = currentCourseId;
  const isCurrent = () => request === resourceDetailRequest && currentCourseId === courseId
    && currentView.type === 'resource' && currentView.resourceType === resourceType && currentView.id === resourceId;
  showPageOnly('resourceDetailPage');

  const label = '资料';
  document.getElementById('resourceDetailTitle').textContent = label + '详情';
  document.getElementById('resourceDetailName').textContent = '加载中…';
  document.getElementById('resourceDetailType').textContent = '';
  document.getElementById('resourceDetailMeta').textContent = '';
  document.getElementById('resourceDetailTags').innerHTML = '';
  document.getElementById('resourceDetailPreview').innerHTML = '';
  document.getElementById('resourceDetailFileSection').hidden = true;
  document.getElementById('resourceDetailEdit').disabled = true;
  document.getElementById('resourceDetailOutlineSection').style.display = 'none';
  document.getElementById('resourceDetailMindmapSection').style.display = 'none';
  document.getElementById('resourceDetailReviewActions').replaceChildren();
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
    if(typeof mountReviewPreparation==='function')mountReviewPreparation(document.getElementById('resourceDetailReviewActions'),resourceType,row);
    if(globalThis.COURSES_SHOW_LEGACY_RESOURCE_AI===true&&typeof mountResourceAi==='function')mountResourceAi(document.getElementById('resourceDetailPreview').parentElement,resourceType,row);
    if(typeof mountItemReviewHistory==='function')mountItemReviewHistory(document.getElementById('resourceDetailHistory'),resourceType,row.id);
  } catch (err) {
    if (!isCurrent()) return;
    console.warn('加载资源详情失败:', err.message);
    showToast(err.message || ('加载' + label + '详情失败'));
    await backFromDetail(); // 资源可能已被删掉，退回来源页
  }
}

function renderResourceDetail(resourceType, item) {
  resourceDetailRow = item;
  const label = '资料';
  const hasFile = !!item.file_url;
  const url = attachmentUrl(item.file_url||'');

  document.getElementById('resourceDetailTitle').textContent = label + '详情';
  document.getElementById('resourceDetailName').textContent = item.title || '（无标题）';
  const edit = document.getElementById('resourceDetailEdit');
  edit.disabled = false; edit.textContent = '编辑' + label;
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
  typeEl.className='resource-badge-row';
  typeEl.innerHTML=resourceTypesHtml(item)+'<span class="material-review-badge">'+(item.review_status==='reviewed'?'已复习':'未复习')+'</span>';
  const typeEdit=document.createElement('button');typeEdit.className='edit-mini-btn';typeEdit.textContent='修改类型';typeEdit.onclick=()=>editSelectedResourceTypes([{kind:resourceType,id:item.id}]);typeEl.append(typeEdit);

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

  document.getElementById('resourceDetailSectionTitle').textContent = '附件';
  document.getElementById('resourceDetailFileSection').hidden = !hasFile;

  const openEl = document.getElementById('resourceDetailOpen');
  if (hasFile) {
    openEl.style.display = 'none';
    openEl.href = url;
    renderResourcePreview(item.file_type, url);
  } else {
    openEl.style.display = 'none';
    document.getElementById('resourceDetailPreview').replaceChildren();
  }

  // 附件和正文可以同时存在；不能因为有附件而跳过已经保存的正文。
  const content = String(item.content || '');
  const contentSection = document.getElementById('resourceDetailContentSection');
  const contentBox = document.getElementById('resourceDetailContent');
  contentSection.hidden = false;
  courseRichText.render(contentBox,content,'尚未填写正文。可以手动编辑，也可以从附件识别文字后补充。');
  contentBox.classList.toggle('is-empty', !content.trim());
  const contentActions = document.getElementById('resourceDetailContentActions');
  contentActions.replaceChildren();
  const editBody = document.createElement('button');
  editBody.type = 'button'; editBody.className = 'edit-mini-btn'; editBody.textContent = '编辑正文';
  editBody.onclick = () => void openResourceDetailEditor('body'); contentActions.append(editBody);
  if (typeof mountResourceTextAction === 'function') mountResourceTextAction(resourceType, item);

  // 「重点总结 / 大纲」是文本输入，「思维导图」是独立产物，两者分开显示。
  const outlineSection = document.getElementById('resourceDetailOutlineSection');
  const mindmapSection = document.getElementById('resourceDetailMindmapSection');
  const savedOutline = String(item.outline || '').trim();
  OUTLINE_MAP.currentTitle = item.title || '';
  if (outlineSection) outlineSection.style.display = '';
  const outlineText = document.getElementById('resourceDetailOutlineText');
  if (outlineText) {
    courseRichText.render(outlineText,savedOutline,'还没有填写重点总结或大纲。');
    outlineText.classList.toggle('is-empty', !savedOutline);
  }
  const outlineActions = document.getElementById('resourceDetailOutlineActions');
  outlineActions.replaceChildren();
  for (const [text, action, aiOnly] of [
    ['编辑大纲', () => openResourceDetailEditor('outline'), false],
    ['AI 根据正文生成', () => openResourceDetailEditor('outline', 'body'), true],
    ...(hasFile ? [['AI 从附件生成', () => openResourceDetailEditor('outline', 'attachment'), true]] : []),
    ['AI 设置', () => coursesAiSettings.open(), false]
  ]) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'edit-mini-btn'; button.textContent = text;
    button.onclick = () => void action();
    if (aiOnly) button.dataset.resourceOutlineAi = '';
    outlineActions.append(button);
  }

  if (mindmapSection) mindmapSection.style.display = '';
  const mapBox = document.getElementById('resourceDetailOutlineMap');
  if(item.mindmap_json)previewCourseMindmap(mapBox,item.mindmap_json);
  else if(item.mindmap_image){const img=document.createElement('img');img.src=item.mindmap_image;img.alt='思维导图';img.style.maxWidth='100%';mapBox.replaceChildren(img);}
  else mapBox.innerHTML='<div class="empty">还没有思维导图。可直接使用正文、大纲或附件，在导图工作台中生成。</div>';
  window.__mindmapTarget={courseId:currentCourseId,resourceType,id:item.id,label:item.title||'',baseline:{mindmap_json:item.mindmap_json||'',mindmap_image:item.mindmap_image||'',outline:item.outline||''}};
  const actionHost=document.getElementById('resourceDetailMindmapActions');actionHost.replaceChildren();
  const source={text:item.content||'',attachment:item.file_url?{url:item.file_url,type:item.file_type||'',name:item.title}:null};
  const hasMindmap=!!(item.mindmap_json||item.mindmap_image);
  for(const [label,action] of [
    ...(item.mindmap_json||!hasMindmap?[[item.mindmap_json?'编辑导图':'生成导图',()=>openMindmapEditor(item.mindmap_json,item.title,savedOutline,{...source,generate:!item.mindmap_json})]]:[]),
    ...(hasMindmap?[['重新生成',()=>openMindmapEditor('',item.title,savedOutline,{...source,generate:true,regenerate:true})]]:[]),
    ['上传导图',()=>reuploadMindmap(resourceType,item.id)]
  ]){const button=document.createElement('button');button.type='button';button.className='edit-btn';button.textContent=label;button.onclick=()=>void action();actionHost.append(button);}
  if(hasMindmap){const more=document.createElement('details');more.className='course-map-more';const summary=document.createElement('summary');summary.className='edit-btn';summary.textContent='更多';const remove=document.createElement('button');remove.type='button';remove.className='edit-btn edit-btn-danger';remove.textContent='移除导图';remove.onclick=()=>void removeResourceMindmap(resourceType,item,remove);more.append(summary,remove);actionHost.append(more);}
  refreshMindmapAiAvailability();
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
  }else if(kind==='office'){
    const card=document.createElement('div');card.className='attachment-pdf-card';card.textContent='Word / PPT 文档 · 支持站内翻页和缩放，首次预览需准备';box.append(card);
  }
  box.insertAdjacentHTML('beforeend',attachmentActionsHtml(url,fileType,kind==='pdf'?'PDF':kind==='image'?'图片':'附件'));
}
