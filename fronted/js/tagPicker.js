/*
 * tagPicker.js
 * 通用标签选择器：打开 / 关闭 / 确认保存、树索引、选中逻辑
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

/* ========== 通用标签选择器（错题 / 资料 / 笔记 共用同一套代码） ========== */

// 从列表缓存里取一条资源（编辑时回显标签和名字用，不用再打一次接口）
function currentResourceRow(resourceType, resourceId) {
  const list =
    resourceType === 'material' ? currentMaterials :
    resourceType === 'note' ? currentNotes : currentMistakes;
  return (list || []).find(x => x.id === resourceId)
    || (typeof resourceDetailRow !== 'undefined' && currentView?.resourceType === resourceType && resourceDetailRow?.id === resourceId ? resourceDetailRow : null);
}

// 取某条资源当前的标签 id
function currentResourceNodes(resourceType, resourceId) {
  const row = currentResourceRow(resourceType, resourceId);
  return row ? rowNodes(row).map(k => k.id) : [];
}

//   resourceId   = edit 时的资源 id，upload 传 null
function cancelPickerResourceText() {
  const request = recognizePickerResourceFile.request;
  if (!request) return;
  request.controller.abort();
  if (request.button) { request.button.disabled = false; request.button.textContent = request.original; }
  recognizePickerResourceFile.request = null;
}
let tagPickerOpenRequest = 0;
async function openTagPicker(mode, resourceType, resourceId) {
  const opening = ++tagPickerOpenRequest, openingCourse = currentCourseId;
  let originalRow = null;
  if (mode === 'edit' && ['material', 'note'].includes(resourceType)) {
    try {
      const response = await requestApi(`${API}/${resourceType === 'note' ? 'notes' : 'materials'}/${resourceId}`);
      originalRow = await response.json();
      if (opening !== tagPickerOpenRequest || openingCourse !== currentCourseId) return;
      if (originalRow.course_id !== openingCourse) throw new Error('内容不属于当前课程');
      const rows = resourceType === 'note' ? currentNotes : currentMaterials;
      const index = rows.findIndex(row => row.id === resourceId);
      if (index < 0) rows.push(originalRow); else rows[index] = originalRow;
    } catch (error) { showToast('无法打开编辑窗口：' + error.message); return; }
  }
  cancelPickerResourceText();
  cancelPickerOutline();
  closePickerResourceOcr();
  const mapStatus = document.getElementById('tagPickerMindmapStatus');
  if (mapStatus) mapStatus.textContent = '';
  const outlineStatus = document.getElementById('tagPickerOutlineStatus');
  if (outlineStatus) outlineStatus.textContent = '可根据正文生成，或先识别附件再生成；可能计费，核对后保存。';
  // 脚本加载顺序可能让这个函数晚到，缺失时跳过即可
  if (typeof cancelMistakeCreateAi === 'function') cancelMistakeCreateAi();
  if(typeof resetPendingCreationCloze==='function')resetPendingCreationCloze('tagPicker');
  if (mode !== 'edit') {
    pickerExistingFile = null;
    pendingResourceRemoveFile = false;
  }
  // 每次打开都新建一份独立状态，避免残留上一门课 / 上一条资源的选择与展开状态
  tagPickerState = {
    originalRow,
    mode: mode,
    resourceType: resourceType,
    resourceId: resourceId,
    formId: typeof reviewRequestId==='function'?reviewRequestId():String(Date.now())+'-'+Math.random().toString(36).slice(2),
    courseId: currentCourseId, // 记下打开时的课程，请求回来后再校验一次
    selected: new Set(),   // 已选节点 id（folder 和 knowledge 一视同仁）
    nodeMeta: new Map(),   // id -> { name, type }
    expanded: new Set(),   // 选择器内展开的 folder id（纯前端临时状态）
    rootExpanded: false,   // 每次打开先只显示“知识框架”总入口
    parentMap: new Map(),  // 子节点 id -> 父节点 id（顶层为 null）
    search: '',            // 搜索关键词（只影响显示，不影响已选）
    tree: []
  };

  await mountResourceTypesPicker(tagPickerState);
  if(opening!==tagPickerOpenRequest||currentCourseId!==openingCourse)return;
  // 编辑模式：用这条资源现有的标签回显（folder / knowledge 都要勾上）
  if (mode === 'edit') {
    currentResourceNodes(resourceType, resourceId)
      .forEach(id => tagPickerState.selected.add(id));
  }

  const resourceLabel =
    ['material','note'].includes(resourceType) ? '资料' : '错题';
  const isMistakeCreate = resourceType === 'mistake' && mode !== 'edit';
  document.getElementById('tagPickerTitle').textContent = isMistakeCreate
    ? '添加错题'
    : (['material', 'note'].includes(resourceType) ? (mode === 'edit' ? '编辑' : '添加') + resourceLabel : (mode === 'edit' ? '编辑' : '选择') + resourceLabel + '标签');
  document.getElementById('tagPickerConfirm').textContent =
    (mode === 'edit' || mode === 'manual' || isMistakeCreate) ? '保存' : '上传';
  document.getElementById('tagPickerConfirm').disabled = false;
  const recognitionHost = document.getElementById('tagPickerRecognitionOptions');
  if (recognitionHost) recognitionHost.innerHTML = recognitionOptionsHtml('tagPickerRecognitionMethod', 'tagPickerResourceOcrBtn');

  const tagPickerBody = document.getElementById('tagPickerBody');
  document.getElementById('tagPickerModal').classList.toggle('resource-editor', ['material', 'note'].includes(resourceType));
  if (tagPickerBody) {
    tagPickerBody.classList.toggle('mistake-create-body', isMistakeCreate);
    tagPickerBody.classList.toggle('resource-edit-body', ['material', 'note'].includes(resourceType));
  }
  const tagBlock = document.getElementById('tagPickerTagBlock');
  if (tagBlock) tagBlock.classList.toggle('mistake-create-card', isMistakeCreate);
  const tagHeading = document.getElementById('tagPickerTagHeading');
  if (tagHeading) tagHeading.style.display = isMistakeCreate || ['material', 'note'].includes(resourceType) ? 'flex' : 'none';
  const nameHeading = document.getElementById('tagPickerNameHeading');
  if (nameHeading) nameHeading.style.display = isMistakeCreate ? 'flex' : 'none';
  const mistakeTypeField = document.getElementById('tagPickerMistakeTypeField');
  if (mistakeTypeField) mistakeTypeField.style.display = isMistakeCreate ? 'flex' : 'none';

  const mistakeFields = document.getElementById('tagPickerMistakeFields');
  mistakeFields.style.display = resourceType === 'mistake' && mode !== 'edit' ? 'grid' : 'none';
  if (resourceType === 'mistake' && mode !== 'edit') {
    ensureMistakeUi();
    document.getElementById('mistakeCreateType').value = mistakeUi.type || '';
    document.getElementById('mistakeCreateAnswer').value = '';
    document.getElementById('mistakeCreateExplanation').value = '';
    const createFormat = document.getElementById('mistakeCreateFormat');
    if (createFormat) createFormat.value = 'open';
    const createChoiceType = document.getElementById('mistakeCreateChoiceType');
    if (createChoiceType) createChoiceType.value = 'single';
    setMistakeChoiceEditor('Create', [], [], 'single');
    toggleMistakeChoiceFields('Create');
    const createContent = document.getElementById('mistakeCreateContent');
    if (createContent) createContent.value = mode === 'manual' && pendingManual ? (pendingManual.content || '') : '';
    const createUpload = document.getElementById('mistakeCreateQuestionUpload');
    if (createUpload) createUpload.value = '';
    renderMistakeCreateFileSummary();
    closeMistakeOcr();
    updateMistakeCreateContentClear();
    updateMistakeCreateOcrActions();
    prepareMistakeCreateAi(tagPickerState);
  }
  if (typeof mountReviewMethodEditor === 'function') {
    mountReviewMethodEditor('tagPicker',resourceType,mode==='edit'?resourceId:null);
  }

  // 名称那一行：上传和编辑时都显示，可以改名字。
  // 后缀单独做成一块固定文字（不进输入框），所以用户改不到它。
  const nameRow = document.getElementById('tagPickerNameRow');
  // 资料 / 笔记：把标签选择挪到「名称」下一行；错题保持原顺序
  const tagBlockEl = document.getElementById('tagPickerTagBlock');
  const selectedEl = document.getElementById('tagPickerSelected');
  const mistakeFieldsEl = document.getElementById('tagPickerMistakeFields');
  const isResourceMode = resourceType === 'material' || resourceType === 'note';
  if (nameRow && tagBlockEl) {
    if (isResourceMode) {
      nameRow.parentNode.insertBefore(tagBlockEl, nameRow.nextSibling);
      if (selectedEl) tagBlockEl.parentNode.insertBefore(selectedEl, tagBlockEl.nextSibling);
    } else if (mistakeFieldsEl) {
      mistakeFieldsEl.parentNode.insertBefore(tagBlockEl, mistakeFieldsEl.nextSibling);
      if (selectedEl) tagBlockEl.parentNode.insertBefore(selectedEl, tagBlockEl.nextSibling);
    }
  }
  // 资料 / 笔记：显示「重点总结 / 大纲」；手动输入模式下可以自动提炼
  const outlineBlock = document.getElementById('tagPickerOutlineBlock');
  const isResource = resourceType === 'material' || resourceType === 'note';
  if (outlineBlock) {
    outlineBlock.style.display = isResource && mode !== 'edit' ? 'block' : 'none';
    const gen = document.getElementById('tagPickerOutlineGen');
    if (gen) gen.style.display = isResource ? 'inline-flex' : 'none';
    refreshPickerOutlineAvailability();
    const mindmapBlock = document.getElementById('tagPickerMindmapBlock');
    if (mindmapBlock) mindmapBlock.style.display = isResource ? 'block' : 'none';
    renderPickerMindmapSummary();
    refreshMindmapAiAvailability();
  }
  const resourceFields = document.getElementById('tagPickerResourceFields');
  if (resourceFields) {
    const isResourceForm = resourceType === 'material' || resourceType === 'note';
    // 编辑时也显示：可以换附件、改正文
    resourceFields.style.display = isResourceForm ? 'block' : 'none';
    if (isResourceForm) {
      const titleEl = document.getElementById('tagPickerResourceTitle');
      if (titleEl) titleEl.textContent = '正文与附件';
      const contentEl = document.getElementById('tagPickerResourceContent');
      if (contentEl && mode === 'manual' && pendingManual) contentEl.value = pendingManual.content || '';
      if (mode === 'edit') {
        const row = currentResourceRow(resourceType, resourceId) || {};
        if (contentEl) contentEl.value = row.content || '';
        pendingUploadFile = null;
        pendingResourceRemoveFile = false;
        pickerExistingFile = row.file_url
          ? { name: row.title || '附件', type: row.file_type || '', url: row.file_url }
          : null;
      }
      renderPickerResourceSummary();
    }
  }
  // 编辑资料/笔记标签时，也能改大纲与导图
  if (isResource && mode === 'edit' && outlineBlock) {
    outlineBlock.style.display = 'block';
    const row = currentResourceRow(resourceType, resourceId) || {};
    const outlineInput = document.getElementById('tagPickerOutline');
    if (outlineInput) outlineInput.value = row.outline || '';
    if (mode === 'edit') pendingMindmapJson = row.mindmap_json || '';
    pendingMindmapImage = row.mindmap_image || '';
    pendingMindmapSource = '';
    const titleInput = document.getElementById('tagPickerMindmapTitle');
    if (titleInput) {
      let mapTitle = '';
      try { mapTitle = JSON.parse(pendingMindmapJson || 'null')?.title || ''; } catch { mapTitle = ''; }
      titleInput.value = mapTitle || row.title || '';
    }
    // 上面先渲染过一次摘要，这里补一次，确保删除键和预览按已有导图显示
    renderPickerMindmapSummary();
  }
  if (isResource && mode !== 'edit') pendingMindmapImage = '';
  if (isResource) updatePickerResourceClear();
  refreshVisionOcrOptions();
  const nameInput = document.getElementById('tagPickerName');
  const extChip = document.getElementById('tagPickerNameExt');
  const nameTip = document.getElementById('tagPickerNameTip');
  if (nameRow) nameRow.classList.toggle('mistake-create-card', isMistakeCreate && (mode === 'upload' || mode === 'manual'));

  const fileSummary = document.getElementById('mistakeCreateFileSummary');
  if (isMistakeCreate) {
    renderMistakeCreateFileSummary();
  } else if (fileSummary) {
    fileSummary.style.display = 'none';
    fileSummary.innerHTML = '';
  }

  let nameBase = '';
  let nameExt = '';

  if (mode === 'upload' && pendingUploadFile) {
    // 默认填文件名（不含后缀），不改就是原来的行为
    const parts = splitNameExt(pendingUploadFile.name || '');
    nameBase = parts.base;
    nameExt = parts.ext;
  } else if (isMistakeCreate && mode === 'manual' && pendingManual) {
    nameBase = pendingManual.title || '';
  } else if (mode === 'edit') {
    const row = currentResourceRow(resourceType, resourceId);
    const title = row ? (row.title || '') : '';
    // 后缀以磁盘上那个文件为准，不让标题里写的后缀带偏
    const fileUrl = row ? (row.file_url || row.image_url || '') : '';
    if (fileUrl) {
      nameExt = extname(fileUrl) || splitNameExt(title).ext;
      nameBase = (nameExt && title.toLowerCase().endsWith(nameExt.toLowerCase()))
        ? title.slice(0, title.length - nameExt.length)
        : title;
    } else {
      nameBase = title; // 手动输入的没有文件，也就没有后缀
    }
  }

  if (mode === 'upload' || mode === 'edit' || (isMistakeCreate && mode === 'manual')) {
    nameRow.style.display = 'block';
    nameInput.value = nameBase;
    extChip.textContent = nameExt;
    extChip.style.display = nameExt ? 'inline-block' : 'none';
    nameTip.style.display = nameExt ? 'block' : 'none';
  } else {
    nameRow.style.display = 'none';
    nameInput.value = '';
  }

  document.getElementById('tagPickerTree').innerHTML = '<div class="loading-tip">加载中…</div>';
  document.getElementById('tagPickerSelected').innerHTML = '';

  // 搜索框每次打开都清空；树还没加载出来之前先不显示它
  const searchRow = document.getElementById('tagPickerSearchRow');
  const searchInput = document.getElementById('tagPickerSearch');
  if (searchInput) searchInput.value = '';
  if (searchRow) searchRow.style.display = 'none';

  // 中间滚动区复位到顶部 + 锁住背景页面滚动 + 绑定 Esc 关闭（只绑一次）
  const pickerBody = document.getElementById('tagPickerBody');
  if (pickerBody) pickerBody.scrollTop = 0;
  setTagPickerBodyLock(true);
  bindTagPickerKeys();

  document.getElementById('tagPickerModal').classList.add('show');
  if(typeof courseRichText!=='undefined')courseRichText.reset();
  const openedState = tagPickerState;

  try {
    // 只加载当前课程的知识树，保证看不到其它课程的知识点
    const res = await fetch(`${API}/courses/${currentCourseId}/knowledge-tree`);
    if (!res.ok) throw new Error('服务器返回了错误状态');
    const tree = await res.json();

    // 请求期间用户可能已经切走了课程，这时放弃这次结果
    if (tagPickerState !== openedState || tagPickerState.courseId !== currentCourseId) return;

    tagPickerState.tree = Array.isArray(tree) ? tree : [];
    // “未分类”不是标签，不出现在选择器里（它只负责收纳“一个标签都没勾”的资源）
    tagPickerState.tree = tagPickerState.tree.filter(n => !n.is_system);
    indexTagTree(tagPickerState.tree, null);
    initTagPickerExpanded();
    renderTagPicker();
  } catch (err) {
    if (tagPickerState !== openedState) return;
    console.error('加载标签失败:', err);
    document.getElementById('tagPickerTree').innerHTML =
      '<div class="empty">加载标签失败，请检查后端是否运行。</div>';
  }
}

// 给整棵树建索引：id → {name,type}，以及子 id → 父 id（顶层为 null）
function indexTagTree(nodes, parentId) {
  for (const node of nodes || []) {
    tagPickerState.nodeMeta.set(node.id, { name: node.name, type: node.type });
    tagPickerState.parentMap.set(node.id, parentId);
    indexTagTree(node.children, node.id);
  }
}

// 每次打开弹窗都从全折叠开始；展开状态只保留在本次弹窗内。
function initTagPickerExpanded() {
  const state = tagPickerState;
  state.expanded = new Set();
  state.rootExpanded = false;
}

// 关闭选择器（取消时不会提交任何东西）
function closeTagPicker() {
  if (tagPickerState?.saving) { showToast('正在保存，请稍候'); return; }
  ++tagPickerOpenRequest;
  cancelPickerResourceText();
  cancelPickerOutline();
  cancelMistakeCreateAi();
  if(typeof resetPendingCreationCloze==='function')resetPendingCreationCloze('tagPicker');
  if (typeof closeCreationReviewSuggestion === 'function') closeCreationReviewSuggestion();
  const modal = document.getElementById('tagPickerModal');
  if (modal) modal.classList.remove('show');

  // 背景滚动锁和搜索框都恢复干净，下一次打开不会带着上一次的状态
  setTagPickerBodyLock(false);
  const searchInput = document.getElementById('tagPickerSearch');
  if (searchInput) searchInput.value = '';

  tagPickerState = null;
  const reviewModeHost = document.getElementById('tagPickerReviewModeHost');
  if (reviewModeHost) { reviewModeHost.style.display = 'none'; reviewModeHost.replaceChildren(); }
  pendingUploadFile = null;
  pendingAnswerFile = null;
  pickerExistingFile = null;
  pendingResourceRemoveFile = false;
  pendingManual = null;
  const outlineInput = document.getElementById('tagPickerOutline');
  if (outlineInput) outlineInput.value = '';
  pendingMindmapJson = '';
  pendingMindmapImage = '';
  pendingMindmapSource = '';
  const resourceContent = document.getElementById('tagPickerResourceContent');
  if (resourceContent) resourceContent.value = '';
  renderPickerResourceSummary();
  const mindmapInput = document.getElementById('tagPickerMindmapFile');
  if (mindmapInput) mindmapInput.value = '';
  renderPickerMindmapSummary();
}

// 资料 / 笔记的统一入口：一个按钮直接进弹窗，附件在弹窗里选
function openResourceCreate(type) {
  pendingUploadFile = null;
  pendingManual = null;
  pendingMindmapJson = '';
  pendingMindmapSource = '';
  return openTagPicker('upload', type, null);
}

// ===== 上传弹窗里的思维导图 =====
let pendingMindmapJson = '';
let pendingMindmapImage = '';
let pendingMindmapSource = '';
let pickerExistingFile = null;
let pendingResourceRemoveFile = false;

function importPickerMindmapImage(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!/^image\//.test(file.type)) { showToast('请选择图片文件'); return; }
  if (file.size > 2 * 1024 * 1024) { showToast('图片不能超过 2MB'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    pendingMindmapImage = String(reader.result || '');
    renderPickerMindmapSummary();
    showToast('已上传导图图片');
  };
  reader.readAsDataURL(file);
}

// 一个入口同时收 JSON 和图片，按类型分派
function uploadPickerMindmap(input) {
  const file = input.files?.[0];
  if (!file) return;
  const isJson = /json$/i.test(file.type || '') || /\.json$/i.test(file.name || '');
  if (isJson) { importPickerMindmap(input); return; }
  if (/^image\//.test(file.type || '')) { importPickerMindmapImage(input); return; }
  input.value = '';
  showToast('只支持导图 JSON 或图片');
}

function renderPickerMindmapSummary() {
  const box = document.getElementById('tagPickerMindmapSummary');
  const clear = document.getElementById('tagPickerMindmapClear');
  const regenerate = document.getElementById('tagPickerMindmapRegenerate');
  if(regenerate)regenerate.hidden=!pendingMindmapJson&&!pendingMindmapImage;
  if (!box) return;
  if (!pendingMindmapJson && !pendingMindmapImage) {
    box.style.display = 'none';
    box.innerHTML = '';
    if (clear) clear.style.display = 'none';
    renderPickerMindmapPreview();
    return;
  }
  let count = 0;
  try { count = countMindmapNodes(JSON.parse(pendingMindmapJson)); } catch { count = 0; }
  box.className = 'mistake-create-file';
  box.style.display = 'flex';
  const parts = [];
  if (pendingMindmapJson) parts.push(`${count} 个节点`);
  if (pendingMindmapImage) parts.push('含导图截图');
  if (pendingMindmapSource) parts.push(pendingMindmapSource);
  box.innerHTML = `<span class="mistake-create-file-icon">🗺️</span><div><strong>已关联思维导图</strong><small>${parts.join(' · ')} · 保存后可在详情页查看</small></div>`;
  if (clear) clear.style.display = 'inline-flex';
  renderPickerMindmapPreview();
}

// 编辑弹窗里的小预览：能大致看清现有导图长什么样
function renderPickerMindmapPreview() {
  const host = document.getElementById('tagPickerMindmapPreview');
  if (!host) return;
  if (!pendingMindmapJson) { host.style.display = 'none'; host.innerHTML = ''; return; }
  let map = null;
  try { map = JSON.parse(pendingMindmapJson); } catch { map = null; }
  if (!map) { host.style.display = 'none'; host.innerHTML = ''; return; }
  host.style.display='block';previewCourseMindmap(host,map);
  const button=document.createElement('button');button.type='button';button.className='edit-mini-btn';button.textContent='编辑导图';button.onclick=()=>void generatePickerMindmap();host.append(button);
}

function importPickerMindmap(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const map = JSON.parse(String(reader.result || ''));
      if (!Array.isArray(map.nodes) || !map.nodes.length) throw new Error('JSON 里没有 nodes');
      pendingMindmapJson = JSON.stringify(map);
      pendingMindmapSource = '导入导图';
      renderPickerMindmapSummary();
      showToast(`已导入导图，共 ${countMindmapNodes(map)} 个节点`);
    } catch (err) {
      pendingMindmapJson = '';
      renderPickerMindmapSummary();
      showToast('这个文件不是导图 JSON：' + err.message);
    }
  };
  reader.onerror = () => showToast('文件读取失败');
  reader.readAsText(file);
  input.value = '';
}

async function generatePickerMindmap(regenerate=false) {
 const state=tagPickerState,title=document.getElementById('tagPickerMindmapTitle')?.value.trim()||document.getElementById('tagPickerName')?.value.trim()||'思维导图';
 const source={title,text:document.getElementById('tagPickerResourceContent')?.value||'',outline:document.getElementById('tagPickerOutline')?.value||'',file:pendingUploadFile||null,attachment:!pendingResourceRemoveFile?pickerExistingFile:null,generate:regenerate||!pendingMindmapJson};
 showCourseMindmap(!regenerate&&pendingMindmapJson?JSON.parse(pendingMindmapJson):null,{title,source,replacing:regenerate,onSave:async value=>{
  if(tagPickerState!==state)throw Error('资料编辑窗口已变化，导图仍保留在工作台草稿中');
  pendingMindmapJson=JSON.stringify(value);pendingMindmapImage='';pendingMindmapSource='导图工作台';renderPickerMindmapSummary();showToast('导图已关联，保存资料后生效');
 }});
}

// 中心主题可编辑：改了就把导图根节点的文字一起改掉
function updatePickerMindmapTitle() {
  if (!pendingMindmapJson) return;
  const title = (document.getElementById('tagPickerMindmapTitle')?.value || '').trim();
  if (!title) return;
  try {
    const map = JSON.parse(pendingMindmapJson);
    if (Array.isArray(map.nodes) && map.nodes[0]) {
      map.title = title;
      map.nodes[0].text = title;
      pendingMindmapJson = JSON.stringify(map);
      renderPickerMindmapSummary();
    }
  } catch { /* 数据坏了就不动 */ }
}

function clearPickerMindmap() {
  pendingMindmapJson = '';
  pendingMindmapImage = '';
  pendingMindmapSource = '';
  renderPickerMindmapSummary();
}

// ===== 资料 / 笔记 的「文件 + 正文」卡片 =====
function renderPickerResourceSummary() {
  const box = document.getElementById('tagPickerResourceFileSummary');
  const remove = document.getElementById('tagPickerResourceRemove');
  const ocr = document.getElementById('tagPickerResourceOcrBtn');
  if (!box) return;
  const existing = pendingResourceRemoveFile ? null : pickerExistingFile;
  if (!pendingUploadFile && !existing) {
    box.style.display = 'none';
    box.innerHTML = '';
    if (remove) remove.style.display = 'none';
    if (ocr) ocr.style.display = 'none';
    closePickerResourceOcr();
    const upload = document.getElementById('tagPickerResourceUploadBtn');
    if (upload) upload.textContent = '上传附件';
    refreshPickerOutlineAvailability();
    return;
  }
  const file = pendingUploadFile || existing;
  box.style.display = 'flex';
  box.innerHTML = `<span class="mistake-create-file-icon">📎</span><div><strong>${escapeHtml(file.name || '附件')}</strong><small>${escapeHtml(file.type || '附件')} · ${pendingUploadFile ? '保存后上传' : '已保存'}</small></div>`;
  if (remove) remove.style.display = 'inline-flex';
  if (ocr) ocr.style.display = 'inline-flex';
  const upload = document.getElementById('tagPickerResourceUploadBtn');
  if (upload) upload.textContent = '更换附件';
  refreshPickerOutlineAvailability();
}

async function pickerResourceFile(signal) {
  if (pendingUploadFile) return pendingUploadFile;
  if (!pendingResourceRemoveFile && pickerExistingFile) return fetchResourceAttachmentFile(pickerExistingFile, signal);
  throw new Error('请先上传附件');
}

async function recognizePickerResourceFile() {
  if (!pendingUploadFile && (pendingResourceRemoveFile || !pickerExistingFile)) { showToast('请先上传附件'); return; }
  const button = document.getElementById('tagPickerResourceOcrBtn');
  if (button?.disabled) return;
  const original = button ? button.textContent : '';
  const selectedFile = pendingUploadFile, existingFile = pickerExistingFile, state = tagPickerState;
  const request = { controller: new AbortController(), button, original };
  recognizePickerResourceFile.request = request;
  const isCurrent = () => recognizePickerResourceFile.request === request && !request.controller.signal.aborted
    && tagPickerState === state && pendingUploadFile === selectedFile && pickerExistingFile === existingFile;
  if (button) { button.disabled = true; button.textContent = '识别中…'; }
  refreshVisionOcrOptions();
  try {
    const file = await pickerResourceFile(request.controller.signal);
    if (!isCurrent()) return;
    const result = await recognizeUploadedFile(file, (message) => {
      if (isCurrent() && button) button.textContent = message;
    }, { signal: request.controller.signal, recognitionMethod: document.getElementById('tagPickerRecognitionMethod')?.value || 'local' });
    if (!isCurrent()) return;
    const text = document.getElementById('tagPickerResourceOcrText');
    const panel = document.getElementById('tagPickerResourceOcrPanel');
    const meta = document.getElementById('tagPickerResourceOcrMeta');
    if (text) text.value = result.text || '';
    if (panel) panel.style.display = 'grid';
    if (meta) {
      const parts = [];
      if (result.provider) parts.push(`识别来源：${ocrProviderLabel(result.provider)}`);
      if (Number.isFinite(result.confidence)) parts.push(`置信度 ${Math.round(result.confidence * 100)}%`);
      if (result.warnings?.length) parts.push(result.warnings.join('；'));
      meta.textContent = parts.join(' · ');
    }
    if (result.provider === 'mock') {
      if (meta) meta.textContent = '⚠ 这是 mock 样例数据，不是真实识别。';
      showToast('当前是 mock 样例数据，不是真实识别');
      return;
    }
    if (panel) panel.dataset.pendingAdoption = 'true';
    notifyTextRecognitionSuccess(result, panel);
  } catch (err) {
    if (isCurrent()) showToast(err.message);
  } finally {
    if (recognizePickerResourceFile.request === request) {
      recognizePickerResourceFile.request = null;
      if (button) { button.disabled = false; button.textContent = original; }
      refreshVisionOcrOptions();
    }
  }
}

function applyPickerResourceOcr(mode) {
  const text = (document.getElementById('tagPickerResourceOcrText')?.value || '').trim();
  if (!text) { showToast('识别结果为空'); return; }
  const content = document.getElementById('tagPickerResourceContent');
  if (!content) return;
  content.value = mode === 'append' && content.value.trim() ? `${content.value.trim()}\n\n${text}` : text;
  const panel = document.getElementById('tagPickerResourceOcrPanel');
  if (panel) panel.dataset.pendingAdoption = 'false';
  updatePickerResourceClear();
  showToast(mode === 'append' ? '已追加到正文' : '已替换正文');
}

function closePickerResourceOcr() {
  const panel = document.getElementById('tagPickerResourceOcrPanel');
  const text = document.getElementById('tagPickerResourceOcrText');
  const meta = document.getElementById('tagPickerResourceOcrMeta');
  if (panel) { panel.style.display = 'none'; panel.dataset.pendingAdoption = 'false'; }
  if (text) text.value = '';
  if (meta) meta.textContent = '';
}

function choosePickerResourceFile(input) {
  cancelPickerResourceText();
  const file = input.files?.[0];
  if (!file) return;
  cancelPickerOutline(); closePickerResourceOcr();
  pendingUploadFile = file;
  pendingResourceRemoveFile = false;
  renderPickerResourceSummary();
  const nameInput = document.getElementById('tagPickerName');
  if (pendingUploadFile && nameInput) {
    const parts = splitNameExt(pendingUploadFile.name || '');
    if (!nameInput.value.trim()) nameInput.value = parts.base;
    const chip = document.getElementById('tagPickerNameExt');
    if (chip) { chip.textContent = parts.ext || ''; chip.style.display = parts.ext ? 'inline-block' : 'none'; }
    document.getElementById('tagPickerNameTip').style.display = parts.ext ? 'block' : 'none';
  }
}

function clearPickerResourceFile() {
  cancelPickerResourceText();
  cancelPickerOutline(); closePickerResourceOcr();
  if (!pendingUploadFile && pickerExistingFile) {
    // 编辑既有资料：标记为"保存后删除原附件"
    pendingResourceRemoveFile = true;
  }
  pendingUploadFile = null;
  const input = document.getElementById('tagPickerResourceUpload');
  if (input) input.value = '';
  renderPickerResourceSummary();
}

function updatePickerResourceClear() {
  if(typeof courseRichText!=='undefined')courseRichText.refresh('tagPickerResourceContent');
  const button = document.getElementById('tagPickerResourceClear');
  const content = document.getElementById('tagPickerResourceContent');
  if (button) button.style.display = content?.value.trim() ? 'inline-flex' : 'none';
}

function clearPickerResourceContent() {
  const content = document.getElementById('tagPickerResourceContent');
  if (content) content.value = '';
  updatePickerResourceClear();
}

// AI 只填入当前表单，确认上传或保存后才会写入资料。
let pickerOutlineRequest = null;
function refreshPickerOutlineAvailability() {
  const button = document.getElementById('tagPickerOutlineGen');
  if (!button) return;
  const ready = typeof mindmapAiReady === 'function' && mindmapAiReady();
  button.disabled = !!pickerOutlineRequest || !ready;
  button.textContent = pickerOutlineRequest ? '正在生成大纲…' : 'AI 根据正文生成';
  button.setAttribute('aria-busy', String(!!pickerOutlineRequest));
  button.title = ready ? '使用当前正文生成大纲，可能计费' : '请先在 AI 设置中配置服务、Key 并同意费用';
  const fromFile = document.getElementById('tagPickerOutlineFileGen');
  if (fromFile) {
    const hasFile = !!pendingUploadFile || (!pendingResourceRemoveFile && !!pickerExistingFile);
    fromFile.disabled = !!pickerOutlineRequest || !ready || !hasFile;
    fromFile.title = !ready ? '请先配置 AI 服务和 Key' : !hasFile ? '请先上传附件' : '先在本机提取附件文字，再交给 AI 生成大纲；不会替换正文';
  }
}
function cancelPickerOutline() {
  if (pickerOutlineRequest) pickerOutlineRequest.controller.abort();
  pickerOutlineRequest = null;
  refreshPickerOutlineAvailability();
}
async function generatePickerOutline(source = 'body') {
  if (pickerOutlineRequest || !tagPickerState) return;
  const status = document.getElementById('tagPickerOutlineStatus');
  const report = message => { if (status) status.textContent = message; };
  if (!mindmapAiReady()) { report('请先在 AI 设置中配置服务和 Key，并同意发送正文及可能产生的费用。'); return; }
  const contentInput = document.getElementById('tagPickerResourceContent');
  const input = document.getElementById('tagPickerOutline');
  const bodySnapshot = contentInput?.value || '';
  let content = bodySnapshot.trim();
  if (source !== 'attachment' && !content) { report('正文为空。请先填写正文，或选择“AI 从附件生成”。'); return; }
  const previous = input.value;
  if (previous.trim() && !confirm('生成成功后将替换当前大纲，是否继续？')) return;
  const state = tagPickerState;
  const selectedFile = pendingUploadFile, existingFile = pickerExistingFile;
  const request = { controller: new AbortController() };
  pickerOutlineRequest = request;
  refreshPickerOutlineAvailability();
  report(source === 'attachment' ? '正在本机读取附件，识别后交给 AI 生成大纲…' : 'AI 正在根据正文生成大纲，请稍候…');
  try {
    if (source === 'attachment') {
      const file = await pickerResourceFile(request.controller.signal);
      const result = await recognizeUploadedFile(file, message => report(message), { signal: request.controller.signal, recognitionMethod: document.getElementById('tagPickerRecognitionMethod')?.value || 'local', reservedCalls: 1 });
      if (result.provider === 'mock') throw new Error('附件返回模拟识别结果，未发送给 AI');
      if (result.partial) throw new Error('附件仅完成部分识别，请先使用“从附件识别文字”校对并补齐正文，再根据正文生成大纲');
      content = String(result.text || '').trim();
      if (!content) throw new Error('附件没有识别到文字');
    }
    if (pickerOutlineRequest !== request || tagPickerState !== state || request.controller.signal.aborted) return;
    if (content.length > 500000) throw new Error('正文超过当前接口可接收的 50 万字符，请缩小范围；原内容保留');
    report('AI 正在根据' + (source === 'attachment' ? '附件识别文字' : '正文') + '生成大纲，请稍候…');
    const title = (document.getElementById('tagPickerName')?.value || '').trim().slice(0, 200);
    const result = await requestAiMindmapOutline(content, title, { signal: request.controller.signal, purpose: 'outline_draft' });
    if (pickerOutlineRequest !== request || tagPickerState !== state || currentCourseId !== state.courseId) return;
    if (input.value !== previous || contentInput.value !== bodySnapshot || pendingUploadFile !== selectedFile || pickerExistingFile !== existingFile) {
      report('正文或大纲已修改，本次结果未填入，以保留你的修改。请重新生成。');
      return;
    }
    input.value = result.outline;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    report('大纲已根据' + (source === 'attachment' ? '附件' : '正文') + '生成，正文未改动；可继续编辑，保存后生效。');
    showToast('AI 大纲已生成，尚未保存', 4000, 'success');
  } catch (error) {
    if (pickerOutlineRequest === request && tagPickerState === state) report('大纲未生成：' + error.message.replace(/[。；;\s]+$/, '') + '。原大纲已保留。');
  } finally {
    if (pickerOutlineRequest === request) {
      pickerOutlineRequest = null;
      refreshPickerOutlineAvailability();
    }
  }
}

function clearPickerOutline() {
  const input = document.getElementById('tagPickerOutline');
  if (input) { input.value = ''; input.dispatchEvent(new Event('input',{bubbles:true})); }
  showToast('大纲已清空，保存后生效');
}

// 选择器打开时锁住背景页面，别让它跟着一起滚。
// （没有真实 body / classList 的环境直接跳过，不影响其它功能）
function setTagPickerBodyLock(on) {
  const body = document.body;
  if (!body || !body.classList) return;
  if (on) body.classList.add('tag-picker-open');
  else body.classList.remove('tag-picker-open');
}

// 桌面习惯：按 Esc 关掉选择器。只绑一次。
let tagPickerKeysBound = false;
function bindTagPickerKeys() {
  if (tagPickerKeysBound || typeof document.addEventListener !== 'function') return;
  tagPickerKeysBound = true;
  document.addEventListener('keydown', event => {
    if (!tagPickerState || event.key !== 'Escape') return;
    // Let the top native dialog (AI settings, page selection, confirmation) handle Escape.
    if (document.querySelector('dialog[open]')) return;
    const modal = document.getElementById('tagPickerModal');
    if (!modal || !modal.classList.contains('show')) return;
    event.preventDefault();
    closeTagPicker();
  });
}

// 搜索框输入：只改显示用的关键词，重新画树；已选标签一个都不动
function onTagSearchInput(value) {
  if (!tagPickerState) return;
  tagPickerState.search = (value || '').trim();
  renderTagPicker();
}

// 点“上传 / 保存”
async function confirmTagPicker() {
  const state = tagPickerState;
  if (!state || state.saving) return;
  const resultPanel = document.getElementById('tagPickerResourceOcrPanel');
  if (['material', 'note'].includes(state.resourceType)
      && resultPanel?.dataset.pendingAdoption === 'true'
      && document.getElementById('tagPickerResourceOcrText')?.value.trim()) {
    showToast('识别／提取结果还没填入正文。请先点“替换正文”或“追加正文”再保存；不需要可点“放弃”。', 6000);
    resultPanel.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (state.resourceType === 'mistake' && state.mode !== 'edit' && !state.createdMistake) {
    try { mistakeCreationFields(); } catch (err) { showToast(err.message); return; }
  }

  const nodeIds = [...state.selected];
  const mode = state.mode;
  const resourceType = state.resourceType;
  const resourceId = state.resourceId;
  const file = pendingUploadFile;
  const manual = pendingManual;
  if (['material', 'note'].includes(resourceType)) {
    if(!state.typesReady){showToast('资料类型尚未读取成功，请重试后保存');return;}
    const content = document.getElementById('tagPickerResourceContent').value.trim();
    if (!content && !file && (pendingResourceRemoveFile || !pickerExistingFile)) {
      showToast('正文和附件至少保留一项'); return;
    }
    if (recognizePickerResourceFile.request || pickerOutlineRequest) { showToast('请等待识别或大纲生成完成后保存'); return; }
  }
  // 名字 = 用户填的部分 + 固定的后缀（后缀不是输入框，改不到）
  const nameBase = (document.getElementById('tagPickerName').value || '').trim();
  const nameExt = document.getElementById('tagPickerNameExt').textContent || '';
  const title = nameBase ? nameBase + nameExt : '';

  // 编辑时必须有个名字；上传时留空就退回用原始文件名（和以前一样）
  if (mode === 'edit' && !title) {
    showToast('请输入名称');
    return;
  }
  if (mode === 'manual' && resourceType === 'mistake' && manual && title) {
    manual.title = title;
  }

  const button = document.getElementById('tagPickerConfirm');
  const reviewMethodWasDefault = !document.getElementById('tagPickerReviewMethod')?.value;
  const autoInput = typeof coursesAiSettings!=='undefined' && resourceType==='mistake' && mode!=='edit' && !state.createdMistake
    ? coursesAiSettings.captureCreation() : null;
  state.saving = true;
  button.disabled = true;
  if (state.aiCreate) {
    cancelMistakeCreateAi();
    mistakeCreateAiElement('Fields').disabled = true;
  }
  try {
    let saved = state.createdMistake || false;
    if (state.createdMistake) {
      // A failed local write must never repeat the successful creation request.
    } else if (mode === 'upload') {
      if (resourceType === 'mistake') {
        const content = (document.getElementById('mistakeCreateContent')?.value || '').trim();
        if (!file && !content) { showToast('请上传题目附件或输入题干'); return; }
        if (!title && !file) { showToast('请输入名称'); return; }
        saved = await doCreateMistake(file, nodeIds, title, content);
      } else {
        const content = (document.getElementById('tagPickerResourceContent')?.value || '').trim();
        if (!file && !content) { showToast('请上传附件或填写正文'); return; }
        const finalTitle = title.trim() || content.slice(0, 20) || (file ? file.name : '');
        if (resourceType === 'material') saved = await doUploadMaterial(file, nodeIds, finalTitle, content);
        else saved = await doUploadNote(file, nodeIds, finalTitle, content);
      }
    } else if (mode === 'manual') {
      if (!manual) return;
      if (resourceType === 'mistake') {
        const content = (document.getElementById('mistakeCreateContent')?.value || '').trim();
        if (content) manual.content = content;
      }
      if (resourceType === 'material' || resourceType === 'note') {
        manual.content = (document.getElementById('tagPickerResourceContent')?.value || '').trim();
      }
      saved = await doCreateManual(nodeIds);
    } else {
      if (['material', 'note'].includes(resourceType)) {
        const original = state.originalRow;
        const content = document.getElementById('tagPickerResourceContent').value.trim();
        if (!content && pendingUploadFile && !original.file_url) {
          const form = new FormData(); form.append('file', pendingUploadFile);
          const response = await requestApi(`${API}/courses/${state.courseId}/${resourceType === 'note' ? 'notes' : 'materials'}/${resourceId}/file`, {method:'PUT',body:form});
          const attached = await response.json();
          original.file_url = attached.file_url; original.file_type = attached.file_type;
          pickerExistingFile = {name: attached.title, type: attached.file_type, url: attached.file_url};
          pendingUploadFile = null; pendingResourceRemoveFile = false;
        }
        if (content !== (original.content || '')) {
          const response = await requestApi(`${API}/courses/${state.courseId}/${resourceType === 'note' ? 'notes' : 'materials'}/${resourceId}/content`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: content, mode: 'replace', expectedContent: original.content || '' })
          });
          original.content = (await response.json()).content;
        }
      }
      saved = await saveResourceTags(resourceType, resourceId, nodeIds, title);
      if(saved&&['material','note'].includes(resourceType))await assignResourceTypes([{kind:resourceType,id:resourceId}],selectedPickerResourceTypes(),state.courseId);
      // 资料/笔记：顺便保存大纲与导图
      if (saved && (resourceType === 'material' || resourceType === 'note')) {
        const pathName = resourceType === 'note' ? 'notes' : 'materials';
        // 附件：先换新的，或删除原有
        if (pendingUploadFile) {
          const form = new FormData();
          form.append('file', pendingUploadFile);
          await requestApi(`${API}/courses/${currentCourseId}/${pathName}/${resourceId}/file`, { method: 'PUT', body: form });
          pendingUploadFile = null;
          pickerExistingFile = null;
          pendingResourceRemoveFile = false;
        } else if (pendingResourceRemoveFile) {
          await requestApi(`${API}/courses/${currentCourseId}/${pathName}/${resourceId}/file`, { method: 'DELETE' });
          pickerExistingFile = null;
          pendingResourceRemoveFile = false;
        }
        const outlineValue = (document.getElementById('tagPickerOutline')?.value || '').trim();
        const row = state.originalRow || {};
        const payload = {};
        if (outlineValue !== (row.outline || '')) payload.outline = outlineValue;
        if (pendingMindmapJson !== (row.mindmap_json || '')) payload.mindmapJson = pendingMindmapJson;
        if (pendingMindmapImage !== (row.mindmap_image || '')) payload.mindmapImage = pendingMindmapImage;
        if (Object.keys(payload).length) {
          if (Object.hasOwn(payload, 'outline')) payload.expectedOutline = row.outline || '';
          const path = resourceType === 'note' ? 'notes' : 'materials';
          const mapResponse = await requestApi(`${API}/courses/${currentCourseId}/${path}/${resourceId}/mindmap`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          Object.assign(row, await mapResponse.json());
        }
        // Refresh only after the outline and map writes have completed.
        if (resourceType === 'note') await loadNotes();
        else await loadMaterials();
      }
    }
    if (saved && tagPickerState === state && currentCourseId === state.courseId) {
      if(autoInput)void coursesAiSettings.afterCreated(saved,autoInput);
      if (state.aiCreate) {
        state.createdMistake = saved;
        if (!saveCreatedMistakeAi(state, saved)) {
          button.textContent = '重试保存建议';
          return;
        }
      }
      const savedId = Number.isSafeInteger(saved?.id) ? saved.id : resourceId;
      const methodPersisted = typeof persistReviewMethodEditor==='function'
        ? persistReviewMethodEditor('tagPicker',resourceType,savedId) : true;
      if (!methodPersisted) showToast('内容已保存，但复习方式未能保存到本浏览器，请在编辑页重试。');
      else if (reviewMethodWasDefault) showToast('内容已保存（含大纲和导图），复习方式按标准复习保存。');
      else if (resourceType === 'material' || resourceType === 'note') showToast('内容、大纲和导图已保存。', 4000, 'success');
      if(methodPersisted&&readReviewMethodEditor('tagPicker')==='cloze'
        &&typeof persistPendingCreationCloze==='function'){
        const clozeResult=await persistPendingCreationCloze('tagPicker',resourceType,savedId);
        if(!clozeResult.ok)showToast(`内容已保存，但挖空设置未保存：${clozeResult.error}。可从编辑页重新设置。`);
        else if(!clozeResult.skipped)showToast('挖空设置已保存。');
      }
      state.saving = false;
      closeTagPicker();
      if (currentView.type === 'resource' && currentView.resourceType === resourceType && currentView.id === savedId) {
        await renderResourceDetailPage(resourceType, savedId);
      }
    }
  } catch (err) {
    showToast(err.message || '保存失败，请重试');
  } finally {
    state.saving = false;
    if (tagPickerState === state) {
      button.disabled = false;
      if (state.aiCreate) mistakeCreateAiElement('Fields').disabled = false;
    }
  }
}

// 编辑某条资源：改名（可选）+ 完整替换标签（“替换”不是“追加”）
// 错题的接口字段沿用历史的 knowledgeIds / /knowledge，资料和笔记用 nodeIds / /nodes
async function saveResourceTags(resourceType, resourceId, nodeIds, title) {
  const cfg = {
    mistake: { url: `/mistakes/${resourceId}/knowledge`, field: 'knowledgeIds', reload: loadMistakes },
    material: { url: `/materials/${resourceId}/nodes`, field: 'nodeIds', reload: loadMaterials },
    note: { url: `/notes/${resourceId}/nodes`, field: 'nodeIds', reload: loadNotes }
  }[resourceType];
  if (!cfg) return;

  try {
    const body = {};
    body[cfg.field] = nodeIds;
    if (title) body.title = title;

    await requestApi(`${API}${cfg.url}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (resourceType === 'mistake') showToast('已保存');
    await cfg.reload();
    if (resourceType === 'mistake' && currentView.type === 'mistake' && currentView.id === resourceId) {
      await renderMistakeDetailPage(resourceId, !!currentView.review);
    }
    return true;
  } catch (err) {
    console.error('保存标签失败:', err);
    showToast(err.message || '保存失败，请重试');
    return false;
  }
}
