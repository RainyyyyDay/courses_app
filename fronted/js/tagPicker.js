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
  return (list || []).find(x => x.id === resourceId) || null;
}

// 取某条资源当前的标签 id
function currentResourceNodes(resourceType, resourceId) {
  const row = currentResourceRow(resourceType, resourceId);
  return row ? rowNodes(row).map(k => k.id) : [];
}

//   resourceId   = edit 时的资源 id，upload 传 null
async function openTagPicker(mode, resourceType, resourceId) {
  cancelMistakeCreateAi();
  // 每次打开都新建一份独立状态，避免残留上一门课 / 上一条资源的选择与展开状态
  tagPickerState = {
    mode: mode,
    resourceType: resourceType,
    resourceId: resourceId,
    courseId: currentCourseId, // 记下打开时的课程，请求回来后再校验一次
    selected: new Set(),   // 已选节点 id（folder 和 knowledge 一视同仁）
    nodeMeta: new Map(),   // id -> { name, type }
    expanded: new Set(),   // 选择器内展开的 folder id（纯前端临时状态）
    parentMap: new Map(),  // 子节点 id -> 父节点 id（顶层为 null）
    search: '',            // 搜索关键词（只影响显示，不影响已选）
    tree: []
  };

  // 编辑模式：用这条资源现有的标签回显（folder / knowledge 都要勾上）
  if (mode === 'edit') {
    currentResourceNodes(resourceType, resourceId)
      .forEach(id => tagPickerState.selected.add(id));
  }

  const resourceLabel =
    resourceType === 'material' ? '资料' : (resourceType === 'note' ? '笔记' : '错题');
  const isMistakeCreate = resourceType === 'mistake' && mode !== 'edit';
  document.getElementById('tagPickerTitle').textContent = isMistakeCreate
    ? '添加错题'
    : (mode === 'edit' ? '编辑' : '选择') + resourceLabel + '标签';
  document.getElementById('tagPickerConfirm').textContent =
    (mode === 'edit' || mode === 'manual' || isMistakeCreate) ? '保存' : '上传';
  document.getElementById('tagPickerConfirm').disabled = false;

  const tagPickerBody = document.getElementById('tagPickerBody');
  if (tagPickerBody) tagPickerBody.classList.toggle('mistake-create-body', isMistakeCreate);
  const tagBlock = document.getElementById('tagPickerTagBlock');
  if (tagBlock) tagBlock.classList.toggle('mistake-create-card', isMistakeCreate);
  const tagHeading = document.getElementById('tagPickerTagHeading');
  if (tagHeading) tagHeading.style.display = isMistakeCreate ? 'flex' : 'none';
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

  // 名称那一行：上传和编辑时都显示，可以改名字。
  // 后缀单独做成一块固定文字（不进输入框），所以用户改不到它。
  const nameRow = document.getElementById('tagPickerNameRow');
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

  try {
    // 只加载当前课程的知识树，保证看不到其它课程的知识点
    const res = await fetch(`${API}/courses/${currentCourseId}/knowledge-tree`);
    if (!res.ok) throw new Error('服务器返回了错误状态');
    const tree = await res.json();

    // 请求期间用户可能已经切走了课程，这时放弃这次结果
    if (!tagPickerState || tagPickerState.courseId !== currentCourseId) return;

    tagPickerState.tree = Array.isArray(tree) ? tree : [];
    // “未分类”不是标签，不出现在选择器里（它只负责收纳“一个标签都没勾”的资源）
    tagPickerState.tree = tagPickerState.tree.filter(n => !n.is_system);
    indexTagTree(tagPickerState.tree, null);
    initTagPickerExpanded();
    renderTagPicker();
  } catch (err) {
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

// 选择器打开时的默认展开策略（纯前端临时状态）：
//   - 顶层 folder 默认展开，更深的层级默认收起（不把整棵树一次性摊开）
//   - 编辑已有错题时，把已选节点的所有祖先路径都展开，让用户直接看到勾选
function initTagPickerExpanded() {
  const state = tagPickerState;
  state.expanded = new Set();

  for (const node of state.tree) {
    if (node.type === 'folder' && (node.children || []).length) {
      state.expanded.add(node.id);
    }
  }

  for (const id of state.selected) {
    let parentId = state.parentMap.get(id);
    while (parentId !== null && parentId !== undefined) {
      state.expanded.add(parentId);
      parentId = state.parentMap.get(parentId);
    }
  }
}

// 关闭选择器（取消时不会提交任何东西）
function closeTagPicker() {
  cancelMistakeCreateAi();
  const modal = document.getElementById('tagPickerModal');
  if (modal) modal.classList.remove('show');

  // 背景滚动锁和搜索框都恢复干净，下一次打开不会带着上一次的状态
  setTagPickerBodyLock(false);
  const searchInput = document.getElementById('tagPickerSearch');
  if (searchInput) searchInput.value = '';

  tagPickerState = null;
  pendingUploadFile = null;
  pendingManual = null;
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
  if (state.resourceType === 'mistake' && state.mode !== 'edit' && !state.createdMistake) {
    try { mistakeCreationFields(); } catch (err) { showToast(err.message); return; }
  }

  const nodeIds = [...state.selected];
  const mode = state.mode;
  const resourceType = state.resourceType;
  const resourceId = state.resourceId;
  const file = pendingUploadFile;
  const manual = pendingManual;
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
        if (!file) return;
        if (resourceType === 'material') saved = await doUploadMaterial(file, nodeIds, title);
        else saved = await doUploadNote(file, nodeIds, title);
      }
    } else if (mode === 'manual') {
      if (!manual) return;
      if (resourceType === 'mistake') {
        const content = (document.getElementById('mistakeCreateContent')?.value || '').trim();
        if (content) manual.content = content;
      }
      saved = await doCreateManual(nodeIds);
    } else {
      saved = await saveResourceTags(resourceType, resourceId, nodeIds, title);
    }
    if (saved && tagPickerState === state && currentCourseId === state.courseId) {
      if (state.aiCreate) {
        state.createdMistake = saved;
        if (!saveCreatedMistakeAi(state, saved)) {
          button.textContent = '重试保存建议';
          return;
        }
      }
      closeTagPicker();
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
    showToast('已保存');
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
