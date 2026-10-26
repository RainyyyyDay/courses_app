/* 单题详情、编辑和复习。复习状态与步骤始终以后端响应为准。 */
let mistakeDetailState = null;
let mistakeDetailRequest = 0;
let mistakeReviewBusy = false;

async function openMistakeDetail(mistakeId, review = false) {
  navStack.push(currentView);
  currentView = { type: 'mistake', id: mistakeId, review };
  await renderMistakeDetailPage(mistakeId, review);
}
function mistakeDetailLocationKey(courseId) { return mistakeQueue?.planContext || mistakeQueue?.centerContext ? mistakeQueue.storageKey + ':detail' : 'mistake-detail:' + courseId; }
function forgetMistakeDetailLocation() { mistakeStorageSet(mistakeDetailLocationKey(currentCourseId), null); }
async function restoreMistakeLocation(courseId) {
  const saved = mistakeStorageGet('mistake-detail:' + courseId);
  if (saved && Number.isSafeInteger(saved.id) && saved.id > 0 && currentCourseId === courseId) {
    if (typeof readMistakeQueue === 'function') {
      const queue = readMistakeQueue();
      if (saved.queue && saved.review && queue && !queue.finished && queue.ids[queue.index] === saved.id) mistakeQueue = queue;
    }
    await openMistakeDetail(saved.id, saved.review === true);
  }
}
async function toggleMistakeReviewMode() {
  if (!mistakeDetailState || mistakeReviewBusy) return;
  if (typeof mistakeQueueCurrent === 'function' && mistakeQueueCurrent()) {
    const id = mistakeDetailState.id;
    await pauseMistakeQueue();
    await openMistakeDetail(id, false);
    return;
  }
  currentView.review = !mistakeDetailState.review;
  await renderMistakeDetailPage(mistakeDetailState.id, currentView.review);
}
function mistakeDetailIsCurrent(state) {
  return mistakeDetailState === state && currentCourseId === state.courseId && currentView.type === 'mistake' && currentView.id === state.id;
}

async function renderMistakeDetailPage(mistakeId, review = false) {
  const request = ++mistakeDetailRequest;
  const courseId = currentCourseId;
  const state = { id: mistakeId, courseId, review, row: null, progress: null,
    planItemId: mistakeQueue?.planContext?.items?.[mistakeId] || null,
    sessionItemId:mistakeQueue?.sessionItems?.[mistakeId] || null };
  mistakeDetailState = state;
  if (typeof resetMistakeAi === 'function') resetMistakeAi();
  showPageOnly('mistakeDetailPage');
  const detailBody = document.getElementById('mistakeDetailBody');
  if (detailBody) detailBody.style.display = 'block';
  if (typeof renderMistakeQueueBanner === 'function') renderMistakeQueueBanner();
  mistakeStorageSet(mistakeDetailLocationKey(courseId), { id: mistakeId, review,
    queue: typeof mistakeQueueCurrent === 'function' && !!mistakeQueueCurrent(state) });
  document.getElementById('mistakeDetailTitle').textContent = review ? '错题复习' : '错题详情';
  document.getElementById('mistakeDetailName').textContent = '加载中…';
  document.getElementById('mistakeDetailMeta').textContent = '';
  document.getElementById('mistakeDetailFormat').innerHTML = '';
  document.getElementById('mistakeDetailPreparation').innerHTML = '';
  document.getElementById('mistakeDetailTags').innerHTML = '';
  document.getElementById('mistakeDetailImage').style.display = 'none';
  document.getElementById('mistakeDetailImage').removeAttribute('src');
  document.getElementById('mistakeDetailImageError').style.display = 'none';
  document.getElementById('mistakeDetailFile').style.display = 'none';
  document.getElementById('mistakeDetailContent').innerHTML = '';
  document.getElementById('mistakeReadPanel').style.display = 'none';
  document.getElementById('mistakeAnswerText').textContent = '';
  document.getElementById('mistakeExplanationText').textContent = '';
  document.getElementById('mistakeEditAnswer').value = '';
  document.getElementById('mistakeEditExplanation').value = '';
  document.getElementById('mistakeReviewPanel').style.display = review ? 'block' : 'none';
  document.getElementById('mistakeReviewPanel').innerHTML = '<div class="loading-tip">加载复习进度…</div>';
  const reviewToggle = document.getElementById('mistakeReviewToggle');
  if (reviewToggle) reviewToggle.disabled = true;
  try {
    const res = await requestApi(`${API}/mistakes/${mistakeId}`);
    const row = await res.json();
    if (request !== mistakeDetailRequest || !mistakeDetailIsCurrent(state)) return;
    if (row.course_id !== courseId) throw new Error('这道错题不属于当前课程');
    state.row = row;
    renderMistakeDetail(row, review);
    if (reviewToggle) reviewToggle.disabled = false;
    if (review) {
      await refreshMistakeReview(state);
      if (typeof prepareMistakeQueueItem === 'function') await prepareMistakeQueueItem(state);
    }
  } catch (err) {
    if (request !== mistakeDetailRequest || !mistakeDetailIsCurrent(state)) return;
    document.getElementById('mistakeDetailName').textContent = '加载失败';
    document.getElementById('mistakeDetailContent').innerHTML = `<div class="mistake-inline-error">${escapeHtml(err.message)}</div><button onclick="renderMistakeDetailPage(${mistakeId}, ${review})">重试</button>`;
  }
}

function renderMistakeDetail(mistake, review = false) {
  document.getElementById('mistakeDetailFormat').innerHTML = review ? '' : mistakeFormatHtml(mistake);
  document.getElementById('mistakeDetailPreparation').innerHTML='';
  if(!review && typeof mountReviewPreparation==='function')mountReviewPreparation(document.getElementById('mistakeDetailPreparation'),'mistake',mistake);
  const aiSaved = document.getElementById('mistakeAiSavedDetail');
  if (aiSaved && typeof mistakeAiSavedHtml === 'function') aiSaved.innerHTML = mistakeAiSavedHtml(mistake.course_id, mistake.id);
  document.getElementById('mistakeDetailTitle').textContent = review ? '错题复习' : '错题详情';
  document.getElementById('mistakeDetailName').textContent = mistake.title || '（无标题）';
  document.getElementById('mistakeDetailMeta').textContent =
    `${MISTAKE_TYPES[mistake.mistake_type] || '待分类'} · ${mistakeStatusText(mistake.review_status)}${mistake.favorite ? ' · ★ 已收藏' : ''} · ${mistake.created_at || ''}`;
  const tags = Array.isArray(mistake.knowledge) ? mistake.knowledge : [];
  document.getElementById('mistakeDetailTags').innerHTML = tags.length
    ? tags.map(k => tagChipHtml(k, false, true)).join('') : '<span class="tag-none">暂无标签</span>';
  // 单独复习入口已移除；复习/考前计划仍可进入 review 模式。
  const reviewToolbar = document.getElementById('mistakeReviewToolbar');
  if (reviewToolbar) reviewToolbar.style.display = 'none';
  document.getElementById('mistakeReadPanel').style.display = review ? 'none' : 'block';
  if(!review&&typeof mountItemReviewHistory==='function')mountItemReviewHistory(document.getElementById('mistakeReadPanel'),'mistake',mistake.id);
  document.getElementById('mistakeReviewPanel').style.display = review ? 'block' : 'none';
  document.getElementById('mistakeEditError').textContent = '';
  if (typeof closeMistakeEdit === 'function' && mistakeEditPending) closeMistakeEdit();
  if (!review) {
    document.getElementById('mistakeAnswerText').textContent = mistake.answer_content || (mistake.answer_image_url ? '' : '尚未填写答案');
    const answerFileBox = document.getElementById('mistakeDetailAnswerFile');
    answerFileBox.innerHTML = mistakeAttachmentHtml('答案附件', mistake.answer_image_url, mistake.answer_file_type);
    answerFileBox.style.display = mistake.answer_image_url ? 'block' : 'none';
    document.getElementById('mistakeExplanationText').textContent = mistake.explanation || '尚未填写解析或错误原因';
    const detailParts = mistakeEditNameParts(mistake);
    document.getElementById('mistakeEditTitle').value = detailParts.base;
    setMistakeEditNameExt(detailParts.ext);
    document.getElementById('mistakeEditType').value = mistake.mistake_type || 'unclassified';
    document.getElementById('mistakeEditContent').value = mistake.content || '';
    document.getElementById('mistakeEditAnswer').value = mistake.answer_content || '';
    document.getElementById('mistakeEditExplanation').value = mistake.explanation || '';
    const editFormat = document.getElementById('mistakeEditFormat');
    const editChoiceType = document.getElementById('mistakeEditChoiceType');
    if (editFormat) editFormat.value = mistake.question_format || 'open';
    if (editChoiceType) editChoiceType.value = mistake.choice_type || 'single';
    setMistakeChoiceEditor('Edit', mistake.options_json, mistake.correct_option, mistake.choice_type);
    toggleMistakeChoiceFields('Edit');
  }
  const img = document.getElementById('mistakeDetailImage');
  const errBox = document.getElementById('mistakeDetailImageError');
  const fileBox = document.getElementById('mistakeDetailFile');
  document.getElementById('mistakeDetailSectionTitle').textContent = '题目';
  document.getElementById('mistakeDetailContent').textContent = mistake.content || mistake.ocr_text || '';
  img.style.display = 'none'; img.removeAttribute('src'); errBox.style.display = 'none';
  fileBox.style.display = 'none'; fileBox.innerHTML = '';
  if (!mistake.image_url) return;
  const url = API.replace(/\/api\/?$/, '') + mistake.image_url;
  if (!isImageFile(mistake.file_type, mistake.image_url)) {
    fileBox.style.display = 'block';
    fileBox.innerHTML = attachmentActionsHtml(url,mistake.file_type,'题目附件');
    return;
  }
  img.onerror = () => { img.style.display = 'none'; errBox.style.display = 'block'; };
  img.style.display = 'block'; img.src = url;
  img.tabIndex=0;img.setAttribute('role','button');img.setAttribute('aria-label','放大查看题目图片');img.onclick=()=>void openAttachmentPreview(url,mistake.file_type||'image/unknown','题目图片');img.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();img.click();}};
  fileBox.style.display='block';fileBox.innerHTML=attachmentActionsHtml(url,mistake.file_type||'image/unknown','题目附件');
}

/* ========== 编辑错题（弹窗） ========== */
// 弹窗里「还没保存」的改动：删掉哪个附件、选了哪个新文件、标签选了哪些
let mistakeEditPending = null;
let mistakeEditRequest = 0;

function mistakeEditIsCurrent(pending) {
  return mistakeEditPending === pending && currentCourseId === pending.courseId && currentView === pending.view;
}

// 附件怎么展示：图片直接显示（外面用 CSS 限制高度），其它类型给一个打开入口
function mistakeAttachmentHtml(label, value, fileType) {
  if(!value)return '';
  const url=attachmentUrl(value);if(!url)return '<p class="ai-help">附件地址不可用。</p>';
  const image=attachmentKind(fileType,value)==='image';
  return (image?`<button type="button" class="attachment-image-button" data-attachment-preview data-url="${escapeHtml(url)}" data-type="${escapeHtml(fileType||'image/unknown')}" data-name="${escapeHtml(label)}" aria-label="放大查看${escapeHtml(label)}"><img class="mistake-detail-image mistake-detail-image-capped" id="mistakeDetail${escapeHtml(label)}" src="${escapeHtml(url)}" alt="${escapeHtml(label)}" /></button>`:'')+attachmentActionsHtml(url,fileType,label);
}

// 名称 = 用户能改的名字 + 固定的文件后缀。
// 后缀只由附件决定：附件在，后缀就是那个文件的；附件没有（或删掉了），名字里也不带后缀。
function mistakeEditNameParts(row) {
  const title = row.title || '';
  const fileUrl = row.image_url || '';
  if (!fileUrl) return { base: title, ext: '' };
  const ext = extname(fileUrl) || splitNameExt(title).ext;
  const base = ext && title.toLowerCase().endsWith(ext.toLowerCase())
    ? title.slice(0, title.length - ext.length)
    : title;
  return { base: base, ext: ext };
}

// 保存时用的完整标题（名字 + 固定后缀）
function mistakeEditTitleValue() {
  const base = (document.getElementById('mistakeEditTitle').value || '').trim();
  const ext = document.getElementById('mistakeEditNameExt').textContent || '';
  return base + ext;
}

// 后缀那一小块固定文字：只显示，不给改
function setMistakeEditNameExt(ext) {
  const chip = document.getElementById('mistakeEditNameExt');
  if (!chip) return;
  chip.textContent = ext || '';
  chip.style.display = ext ? 'inline-block' : 'none';
}

// 选了新文件：后缀跟着新文件走，名字里原来带的旧后缀先摘掉
function syncMistakeEditNameExt(file) {
  const chip = document.getElementById('mistakeEditNameExt');
  const oldExt = chip ? (chip.textContent || '') : '';
  const input = document.getElementById('mistakeEditTitle');
  if (oldExt && input.value.toLowerCase().endsWith(oldExt.toLowerCase())) {
    input.value = input.value.slice(0, input.value.length - oldExt.length);
  }
  setMistakeEditNameExt(splitNameExt((file && file.name) || '').ext || oldExt);
}

function openMistakeEdit(row = mistakeDetailState?.row) {
  if (!row) return;
  if (mistakeEditPending?.saving) return;
  if (typeof closeCreationReviewSuggestion === 'function') closeCreationReviewSuggestion();
  if(typeof resetMistakeAnswerAi==='function')resetMistakeAnswerAi('Edit');
  ++mistakeEditRequest;
  mistakeEditPending = {
    row, id: row.id, courseId: currentCourseId, view: currentView,
    scrollX: window.scrollX, scrollY: window.scrollY, saving: false,
    questionRemoved: false, questionFile: null,
    answerRemoved: false, answerFile: null,
    tags: (row.knowledge || []).map(k => ({ id: k.id, name: k.name, type: k.type }))
  };
  const nameParts = mistakeEditNameParts(row);
  document.getElementById('mistakeEditTitle').value = nameParts.base;
  setMistakeEditNameExt(nameParts.ext);
  document.getElementById('mistakeEditType').value = row.mistake_type || 'unclassified';
  document.getElementById('mistakeEditContent').value = row.content || '';
  document.getElementById('mistakeEditAnswer').value = row.answer_content || '';
  document.getElementById('mistakeEditExplanation').value = row.explanation || '';
  const editFormat = document.getElementById('mistakeEditFormat');
  const editChoiceType = document.getElementById('mistakeEditChoiceType');
  if (editFormat) editFormat.value = row.question_format || 'open';
  document.getElementById('mistakeEditFormatConfirmed').checked = row.question_format_confirmed === 1;
  if (editChoiceType) editChoiceType.value = row.choice_type || 'single';
  setMistakeChoiceEditor('Edit', row.options_json, row.correct_option, row.choice_type);
  toggleMistakeChoiceFields('Edit');
  document.getElementById('mistakeEditQuestionUpload').value = '';
  document.getElementById('mistakeEditAnswerUpload').value = '';
  document.getElementById('mistakeEditError').textContent = '';
  document.getElementById('mistakeEditSave').disabled = false;
  document.getElementById('mistakeEditTagSearch').value = '';
  mistakeEditTagSearch = '';
  mistakeEditTagTree = [];
  mistakeEditTagExpanded = new Set();
  mistakeEditTagRootExpanded = false;
  mistakeEditTagMeta = new Map();
  renderMistakeEditFiles();
  renderMistakeEditTags();
  if (typeof mountReviewMethodEditor === 'function') mountReviewMethodEditor('mistakeEdit','mistake',row.id);
  refreshMistakeEditDirty();
  document.getElementById('mistakeEditModal').classList.add('show');
  const tagBox = document.getElementById('mistakeEditTagTree');
  tagBox.innerHTML = '<div class="edit-tag-empty">正在加载知识框架…</div>';
  const pending = mistakeEditPending;
  document.body.classList.add('mistake-edit-open');
  document.getElementById('mistakeEditBody').scrollTop = 0;
  return loadMistakeEditTagTree(pending)
    .then(() => { if (mistakeEditIsCurrent(pending)) renderMistakeEditTagTree(); })
    .catch(err => {
      if (mistakeEditIsCurrent(pending)) tagBox.innerHTML = '<div class="edit-tag-empty">' + escapeHtml(err.message) +
        '</div><button type="button" class="edit-mini-btn" onclick="retryMistakeEditTagTree()">重试加载标签</button>';
    });
}

function closeMistakeEdit() {
  const pending = mistakeEditPending;
  if (pending?.saving) return;
  if(typeof resetMistakeAnswerAi==='function')resetMistakeAnswerAi('Edit');
  if(typeof closeCreationReviewSuggestion==='function')closeCreationReviewSuggestion();
  ++mistakeEditRequest;
  const modal = document.getElementById('mistakeEditModal');
  if (modal) modal.classList.remove('show');
  document.body.classList.remove('mistake-edit-open');
  mistakeEditPending = null;
  const reviewModeHost=document.getElementById('mistakeEditReviewModeHost');
  if(reviewModeHost)reviewModeHost.replaceChildren();
  if (pending && pending.view === currentView) window.scrollTo(pending.scrollX, pending.scrollY);
}

// 小工具：新选的文件先用浏览器内的临时地址预览
function mistakeEditPreviewUrl(file) {
  if (!file) return '';
  return (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(file) : '';
}

// 附件区：照片只放一小块；有原文件时只能先删，删掉之后才让传新的
function renderMistakeEditFiles() {
  const row = mistakeEditPending?.row || {};
  const pending = mistakeEditPending;
  if (!pending) return;
  const base = API.replace(/\/api\/?$/, '');

  const paint = (config) => {
    const box = document.getElementById(config.boxId);
    const removeBtn = document.getElementById(config.removeId);
    const uploadBtn = document.getElementById(config.uploadId);
    const oldUrl = (config.removedFlag ? '' : config.oldUrl) || '';
    const file = config.file;
    const fileType = file ? file.type : config.oldFileType;
    const previewUrl = file ? mistakeEditPreviewUrl(file) : (oldUrl ? base + oldUrl : '');

    // 和上传弹窗保持同一种呈现：图标 + 文件名 + 类型/状态
    if (previewUrl) {
      const rawName = decodeURIComponent(String(oldUrl || '').split('/').pop() || '');
      const rawExt = (rawName.split('.').pop() || '').toLowerCase();
      const baseName = config.displayName || config.label;
      // 服务器存的是「时间戳-随机数.扩展名」，原文件名没保留，只能用标题/卡片名代替
      const name = file
        ? file.name
        : (rawExt && !baseName.toLowerCase().endsWith('.' + rawExt) ? `${baseName}.${rawExt}` : baseName);
      const ext = (name.split('.').pop() || '').toLowerCase();
      const icon = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'].includes(ext)
        ? '🖼'
        : (ext === 'pdf' ? '📄' : '📎');
      const typeText = (fileType || ext || '附件').toString();
      box.className = 'edit-file-preview mistake-create-file';
      box.style.display = 'flex';
      box.innerHTML = `<span class="mistake-create-file-icon">${icon}</span><div>`
        + `<strong>${escapeHtml(name)}</strong>`
        + `<small>${escapeHtml(typeText)} · ${file ? '保存后上传' : '已保存'}</small>${attachmentActionsHtml(previewUrl,fileType||(ext==='pdf'?'application/pdf':''),name)}</div>`;
    } else {
      box.className = 'edit-file-preview';
      box.style.display = 'none';
      box.innerHTML = '';
    }
    // 删除和上传并排：有东西可删（原文件还在，或刚选了新文件）时才显示删除
    removeBtn.style.display = (oldUrl || file) ? 'inline-flex' : 'none';
    // 有附件就能识别（新选的或原来的都行）
    const ocrBtn = document.getElementById(config.ocrId);
    if (ocrBtn) ocrBtn.style.display = (oldUrl || file) ? 'inline-flex' : 'none';
    const label = document.getElementById(config.labelId);
    if (label) label.textContent = file ? '重新选择' : config.uploadText;
  };

  paint({
    boxId: 'mistakeEditQuestionFile', removeId: 'mistakeEditQuestionRemove', uploadId: 'mistakeEditQuestionUploadBtn',
    ocrId: 'mistakeEditQuestionOcrBtn',
    labelId: 'mistakeEditQuestionUploadLabel', label: '题目附件', displayName: row.title, uploadText: '上传新内容',
    oldUrl: row.image_url, oldFileType: row.file_type,
    removedFlag: pending.questionRemoved, file: pending.questionFile
  });
  paint({
    boxId: 'mistakeEditAnswerFile', removeId: 'mistakeEditAnswerRemove', uploadId: 'mistakeEditAnswerUploadBtn',
    ocrId: 'mistakeEditAnswerOcrBtn',
    labelId: 'mistakeEditAnswerUploadLabel', label: '答案附件', displayName: '答案附件', uploadText: '上传新内容',
    oldUrl: row.answer_image_url, oldFileType: row.answer_file_type,
    removedFlag: pending.answerRemoved, file: pending.answerFile
  });
}

function chooseMistakeEditQuestionFile(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file || !mistakeEditPending) return;
  mistakeEditPending.questionFile = file;
  syncMistakeEditNameExt(file);
  renderMistakeEditFiles();
  refreshMistakeEditDirty();
}
function removeMistakeEditQuestionFile() {
  if (!mistakeEditPending) return;
  mistakeEditPending.questionFile = null;
  mistakeEditPending.questionRemoved = true;
  setMistakeEditNameExt('');
  renderMistakeEditFiles();
  refreshMistakeEditDirty();
}
function chooseMistakeEditAnswerFile(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file || !mistakeEditPending) return;
  mistakeEditPending.answerFile = file;
  renderMistakeEditFiles();
  refreshMistakeEditDirty();
}
function removeMistakeEditAnswerFile() {
  if (!mistakeEditPending) return;
  mistakeEditPending.answerFile = null;
  mistakeEditPending.answerRemoved = true;
  renderMistakeEditFiles();
  refreshMistakeEditDirty();
}

// ===== 编辑弹窗里的 OCR：题目和答案各一套 =====
function updateMistakeEditOcrActions() {
  const choice = document.getElementById('mistakeEditFormat')?.value === 'choice';
  const toOptions = document.getElementById('mistakeEditOcrToOptions');
  if (toOptions) toOptions.style.display = choice ? 'inline-flex' : 'none';
}

async function recognizeMistakeEditFile(kind) {
  const pending = mistakeEditPending;
  // 以编辑态自己保存的行数据为准：详情页状态可能是旧快照
  const row = pending?.row || (mistakeDetailState && mistakeDetailState.row);
  const isQuestion = kind === 'question';
  const newFile = isQuestion ? pending?.questionFile : pending?.answerFile;
  const removed = isQuestion ? pending?.questionRemoved : pending?.answerRemoved;
  const oldUrl = isQuestion ? row?.image_url : row?.answer_image_url;
  const sourceUrl = !removed && oldUrl ? oldUrl : '';
  if (!newFile && !sourceUrl) { showToast('请先上传附件'); return; }

  const button = document.getElementById(isQuestion ? 'mistakeEditQuestionOcrBtn' : 'mistakeEditAnswerOcrBtn');
  if (button?.disabled) return;
  const original = button ? button.textContent : '';
  if (button) { button.disabled = true; button.textContent = '识别中…'; }
  try {
    let file = newFile;
    if (!file) {
      // 识别原有附件：先下载成本地 File，再走同一套识别流程
      const base = API.replace(/\/api\/?$/, '');
      const response = await fetch(base + sourceUrl);
      if (!response.ok) throw new Error('原附件下载失败');
      const blob = await response.blob();
      file = new File([blob], sourceUrl.split('/').pop() || 'attachment', { type: blob.type });
    }
    const result = await recognizeUploadedFile(file, (message) => {
      if (button) button.textContent = message;
    });
    const textBox = document.getElementById(isQuestion ? 'mistakeEditQuestionOcrText' : 'mistakeEditAnswerOcrText');
    const panel = document.getElementById(isQuestion ? 'mistakeEditQuestionOcrPanel' : 'mistakeEditAnswerOcrPanel');
    const meta = document.getElementById(isQuestion ? 'mistakeEditQuestionOcrMeta' : 'mistakeEditAnswerOcrMeta');
    setOcrTextResult(textBox, result);
    if (panel) panel.style.display = 'grid';
    if (meta) {
      const parts = [];
      if (result.provider) parts.push(`识别来源：${ocrProviderLabel(result.provider)}`);
      if (Number.isFinite(result.confidence)) parts.push(`置信度 ${Math.round(result.confidence * 100)}%`);
      if (result.warnings?.length) parts.push(result.warnings.join('；'));
      meta.textContent = parts.join(' · ');
    }
    updateMistakeEditOcrActions();
    if (result.provider === 'mock') {
      if (meta) meta.textContent = '⚠ 这是 mock 样例数据，不是真实识别。';
      showToast('当前是 mock 样例数据，不是真实识别');
      return;
    }
    notifyTextRecognitionSuccess(result, panel);
  } catch (err) {
    showToast(err.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = original; }
  }
}

function closeMistakeEditOcr(kind) {
  const isQuestion = kind === 'question';
  const panel = document.getElementById(isQuestion ? 'mistakeEditQuestionOcrPanel' : 'mistakeEditAnswerOcrPanel');
  const text = document.getElementById(isQuestion ? 'mistakeEditQuestionOcrText' : 'mistakeEditAnswerOcrText');
  const meta = document.getElementById(isQuestion ? 'mistakeEditQuestionOcrMeta' : 'mistakeEditAnswerOcrMeta');
  if (panel) panel.style.display = 'none';
  setOcrTextResult(text, null);
  if (meta) meta.textContent = '';
}

function applyMistakeEditOcr(target, mode = 'replace') {
  const isQuestion = target !== 'answer';
  const text = (document.getElementById(isQuestion ? 'mistakeEditQuestionOcrText' : 'mistakeEditAnswerOcrText')?.value || '').trim();
  if (!text) { showToast('识别结果为空'); return; }

  if (isQuestion && target === 'content') {
    const content = document.getElementById('mistakeEditContent');
    if (!content) return;
    content.value = mode === 'append' && content.value.trim() ? `${content.value.trim()}\n\n${text}` : text;
    refreshMistakeEditDirty();
    showToast(mode === 'append' ? '已追加到题干' : '已替换题干');
    return;
  }
  if (target === 'options') {
    const format = document.getElementById('mistakeEditFormat')?.value;
    if (format !== 'choice') { showToast('这道题不是选择题'); return; }
    const values = [];
    for (const rawLine of text.split('\n')) {
      const line = rawLine.normalize('NFKC');
      const match = line.match(/^\s*[（(]?\s*([A-Za-z])\s*(?:[）)]\s*|[.、,:：;；)）]\s*|\s+)(.+)$/);
      if (match) values.push(match[2].trim());
    }
    if (values.length < 2) { showToast('没有识别到 A./B./C. 形式的选项行，请手动校对'); return; }
    renderMistakeChoiceOptionRows('Edit', values, []);
    refreshMistakeEditDirty();
    showToast('已填入选项，请核对编号和内容');
    return;
  }
  if (target === 'answer') fillMistakeEditAnswerFromOcr(text);
}

function fillMistakeEditAnswerFromOcr(text) {
  const format = document.getElementById('mistakeEditFormat')?.value || 'open';
  const answerText = extractMistakeOcrAnswer(text);
  const payload = answerText || text;
  if (format === 'choice') {
    const match = text.normalize('NFKC').match(/(?:正确答案|答案)\s*[：:]?\s*((?:[A-Za-z]\s*[,，、;；\s]*)+)/);
    if (!match) { showToast('没有识别到“答案：A”形式的字母'); return; }
    const ids = [...new Set((match[1].toUpperCase().match(/[A-Z]/g) || []))];
    const letters = choiceLetters(readMistakeChoiceOptionValues('Edit').length);
    const valid = ids.filter(id => letters.includes(id));
    if (!valid.length) { showToast('答案字母不在当前选项中，请先填入选项'); return; }
    const type = document.getElementById('mistakeEditChoiceType')?.value || 'single';
    renderMistakeChoiceAnswerOptions('Edit', type === 'single' ? valid.slice(0, 1) : valid);
    refreshMistakeEditDirty();
    showToast('已填入正确答案，请核对');
    return;
  }
  const answer = document.getElementById('mistakeEditAnswer');
  if (answer) answer.value = payload;
  refreshMistakeEditDirty();
  showToast(answerText ? '已填入答案（只取“答案：”之后的内容）' : '没有找到“答案：”标记，已填入整段识别文字');
}

// 当前课程的分类 / 知识点（弹窗里直接勾，不用跳别的弹窗）
let mistakeEditTagTree = [];
let mistakeEditTagExpanded = new Set();
let mistakeEditTagRootExpanded = false;
let mistakeEditTagMeta = new Map();
let mistakeEditTagSearch = '';

async function loadMistakeEditTagTree(pending = mistakeEditPending) {
  const res = await requestApi(`${API}/courses/${pending.courseId}/knowledge-tree`);
  if (!res.ok) throw new Error('加载分类 / 知识点失败');
  const tree = await res.json();
  if (!mistakeEditIsCurrent(pending)) return;
  // 「未分类」是系统分类，不参与打标签（和标签选择器一致）
  mistakeEditTagTree = (Array.isArray(tree) ? tree : []).filter(node => !node.is_system);
  mistakeEditTagMeta = new Map();
  mistakeEditTagExpanded = new Set();
  mistakeEditTagRootExpanded = false;
  (function walk(nodes, parentId) {
    for (const node of nodes || []) {
      mistakeEditTagMeta.set(node.id, { name: node.name, type: node.type, parentId: parentId });
      walk(node.children, node.id);
    }
  })(mistakeEditTagTree, null);
  return mistakeEditTagTree;
}

async function retryMistakeEditTagTree() {
  const pending = mistakeEditPending;
  if (!pending) return;
  try {
    await loadMistakeEditTagTree(pending);
    if (mistakeEditIsCurrent(pending)) renderMistakeEditTagTree();
  } catch (err) {
    if (mistakeEditIsCurrent(pending)) showToast(err.message);
  }
}

function searchMistakeEditTags(value) {
  mistakeEditTagSearch = (value || '').trim();
  renderMistakeEditTagTree();
}

function renderMistakeEditTagTree() {
  const box = document.getElementById('mistakeEditTagTree');
  const scroll = box.scrollTop;
  if (!mistakeEditTagTree.length) {
    box.innerHTML = '<div class="edit-tag-empty">当前课程暂无分类或知识点，请先在「知识框架」中创建</div>';
    return;
  }
  // 只复用共享选择器的纯搜索函数，编辑状态仍留在当前表单里。
  const nodes = mistakeEditTagSearch ? filterTagTree(mistakeEditTagTree, mistakeEditTagSearch) : mistakeEditTagTree;
  const expanded = !!mistakeEditTagSearch || mistakeEditTagRootExpanded;
  const content = nodes.length ? nodes.map(node => mistakeEditTagNodeHtml(node)).join('')
    : '<div class="edit-tag-empty">没有匹配的分类或知识点</div>';
  box.innerHTML = `<div class="edit-tag-root">
    <button type="button" class="edit-tag-root-toggle" aria-expanded="${expanded}"
      onclick="toggleMistakeEditTagRoot()">
      <span class="edit-tag-root-arrow" aria-hidden="true">${expanded ? '▾' : '▸'}</span>
      <span>知识框架</span>
      <small>${expanded ? '收起' : '展开分类和知识点'}</small>
    </button>
    ${expanded ? `<div class="edit-tag-root-children">${content}</div>` : ''}
  </div>`;
  box.scrollTop = scroll;
}

function mistakeEditTagNodeHtml(node) {
  const isFolder = node.type === 'folder';
  const children = Array.isArray(node.children) ? node.children : [];
  const expanded = !!mistakeEditTagSearch || mistakeEditTagExpanded.has(node.id);
  const checked = !!mistakeEditPending && mistakeEditPending.tags.some(t => t.id === node.id);
  const v = tagVisual(node.type);
  const toggle = (isFolder && children.length)
    ? `<button type="button" class="edit-tag-toggle" data-tag-id="${node.id}" onclick="toggleMistakeEditTagExpand(${node.id})" title="${expanded ? '收起' : '展开'}">${expanded ? '▾' : '▸'}</button>`
    : '<span class="edit-tag-toggle edit-tag-toggle-empty"></span>';
  return `<div class="edit-tag-node">
      <div class="edit-tag-row${checked ? ' is-checked' : ''}">
        ${toggle}
        <input type="checkbox" id="mistake-edit-tagchk-${node.id}" aria-label="${escapeHtml(node.name)}" class="edit-tag-check" ${checked ? 'checked' : ''} onchange="toggleMistakeEditTag(${node.id}, this.checked)" />
        <span class="edit-tag-name ${v.cls}" onclick="toggleMistakeEditTag(${node.id})">${v.icon} ${escapeHtml(node.name)}</span>
      </div>
      ${isFolder && children.length && expanded ? `<div class="edit-tag-children">${children.map(child => mistakeEditTagNodeHtml(child)).join('')}</div>` : ''}
    </div>`;
}

function toggleMistakeEditTagRoot() {
  mistakeEditTagRootExpanded = !mistakeEditTagRootExpanded;
  renderMistakeEditTagTree();
}

function toggleMistakeEditTagExpand(id) {
  if (mistakeEditTagExpanded.has(id)) mistakeEditTagExpanded.delete(id);
  else mistakeEditTagExpanded.add(id);
  renderMistakeEditTagTree();
}

// 勾 / 取消勾选：只动待保存的标签，保存时才落库
function toggleMistakeEditTag(id, checked) {
  const pending = mistakeEditPending;
  if (!pending) return;
  const has = pending.tags.some(t => t.id === id);
  const want = typeof checked === 'boolean' ? checked : !has;
  if (want && !has) {
    const meta = mistakeEditTagMeta.get(id) || {};
    pending.tags.push({ id: id, name: meta.name || ('#' + id), type: meta.type || 'unknown' });
  }
  if (!want && has) pending.tags = pending.tags.filter(t => t.id !== id);
  renderMistakeEditTags();
  renderMistakeEditTagTree();
  refreshMistakeEditDirty();
}

// 每个板块右上角的「已改」：让用户知道改了哪儿
function refreshMistakeEditDirty() {
  const row = mistakeEditPending?.row;
  const pending = mistakeEditPending;
  if (!row || !pending) return;
  const flag = (id, dirty) => {
    const el = document.getElementById(id);
    if (el) el.style.display = dirty ? 'inline-block' : 'none';
  };
  const value = id => (document.getElementById(id) || {}).value || '';
  flag('mistakeEditFlagName', mistakeEditTitleValue() !== (row.title || '')
    || value('mistakeEditType') !== (row.mistake_type || 'unclassified'));
  const before = (row.knowledge || []).map(k => k.id).sort((a, b) => a - b).join(',');
  const after = pending.tags.map(t => t.id).sort((a, b) => a - b).join(',');
  flag('mistakeEditFlagTags', before !== after);
  const rowOptions = parseMistakeChoiceOptions(row.options_json).map(option => option.text.trim());
  const currentOptions = readMistakeChoiceOptionValues('Edit').map(value => value.trim());
  const rowSelected = parseMistakeCorrectIds(row.choice_type || 'single', row.correct_option).sort();
  const currentSelected = readMistakeChoiceAnswerIds('Edit').sort();
  const rowFormat = row.question_format || 'open';
  const currentFormat = value('mistakeEditFormat');
  const choiceDirty = (currentFormat === 'choice' || rowFormat === 'choice') && (
    value('mistakeEditChoiceType') !== (row.choice_type || 'single')
    || JSON.stringify(currentOptions) !== JSON.stringify(rowOptions)
    || JSON.stringify(currentSelected) !== JSON.stringify(rowSelected));
  flag('mistakeEditFlagQuestion', (pending.questionRemoved && !!row.image_url) || !!pending.questionFile
    || value('mistakeEditContent') !== (row.content || '')
    || currentFormat !== rowFormat
    || document.getElementById('mistakeEditFormatConfirmed').checked !== (row.question_format_confirmed === 1)
    || choiceDirty);
  flag('mistakeEditFlagAnswer', (pending.answerRemoved && !!row.answer_image_url) || !!pending.answerFile
    || value('mistakeEditAnswer') !== (row.answer_content || ''));
  flag('mistakeEditFlagExplanation', value('mistakeEditExplanation') !== (row.explanation || ''));
}

function renderMistakeEditTags() {
  const box = document.getElementById('mistakeEditTags');
  const tags = mistakeEditPending ? mistakeEditPending.tags : [];
  const count = document.getElementById('mistakeEditTagCount');
  if (count) count.textContent = '已选 ' + tags.length + ' 项';
  box.innerHTML = tags.length
    ? tags.map(t => {
        const v = tagVisual(t.type);
        return '<span class="tag-chip ' + v.cls + '"><span class="tag-chip-icon">' + v.icon + '</span>' +
          escapeHtml(t.name) + '<button class="tag-chip-x" type="button" onclick="removeMistakeEditTag(' + t.id + ')" title="移除">×</button></span>';
      }).join('')
    : '<span class="tag-none">暂无标签</span>';
}
function removeMistakeEditTag(id) {
  if (!mistakeEditPending) return;
  mistakeEditPending.tags = mistakeEditPending.tags.filter(t => t.id !== id);
  renderMistakeEditTags();
  renderMistakeEditTagTree();
  refreshMistakeEditDirty();
}
async function saveMistakeDetail() {
  const state = mistakeEditPending;
  const button = document.getElementById('mistakeEditSave');
  if (!state?.row || state.saving || button.disabled || !mistakeEditIsCurrent(state)) return;
  const pending = state;
  const reviewMethodWasDefault = !document.getElementById('mistakeEditReviewMethod')?.value;
  let choice;
  try { choice = mistakeChoiceFields('Edit'); }
  catch (err) { document.getElementById('mistakeEditError').textContent = err.message; showToast(err.message); return; }
  const body = {
    title: mistakeEditTitleValue(),
    content: document.getElementById('mistakeEditContent').value,
    mistakeType: document.getElementById('mistakeEditType').value,
    answerContent: document.getElementById('mistakeEditAnswer').value,
    explanation: document.getElementById('mistakeEditExplanation').value,
    ...choice,
    expectedRevision: state.row.review_revision
  };
  body.questionFormatConfirmed = document.getElementById('mistakeEditFormatConfirmed').checked;
  if (!body.title) { showToast('请输入标题'); return; }
  if (body.questionFormat !== (state.row.question_format || 'open')
    && !await showConfirm('更改题型将重新开始本题当前复习并标记为未复习；历史评分和复习会话记录会保留。确定保存吗？', '更改题型')) return;
  if (!mistakeEditIsCurrent(state) || state.saving) return;
  const attachmentUrl = suffix => `${API}/courses/${state.courseId}/mistakes/${state.id}/${suffix}`;
  let textSaved = false;
  const attachmentsChanged = (pending.questionRemoved && !!state.row.image_url) || !!pending.questionFile
    || (pending.answerRemoved && !!state.row.answer_image_url) || !!pending.answerFile;
  state.saving = true;
  button.disabled = true;
  document.getElementById('mistakeEditError').textContent = '';
  try {
    // 1) 文字字段（标题 / 类型 / 题目文字 / 答案 / 错因）
    const response = await requestApi(`${API}/courses/${state.courseId}/mistakes/${state.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const savedRow = await response.json();
    textSaved = true;
    if (!mistakeEditIsCurrent(state)) return;
    // 后续附件 / 标签失败时允许重试文字保存，使用已提交的最新版本。
    state.row = savedRow;
    // 2) 附件：先删掉用户点了删除的原文件，再上传新选的（都在后端会刷新复习状态）
    if (pending.questionRemoved && state.row.image_url) {
      await requestApi(attachmentUrl('question-file'), { method: 'DELETE' });
      state.row.image_url = ''; pending.questionRemoved = false;
    }
    if (pending?.questionFile) {
      const fd = new FormData();
      fd.append('file', pending.questionFile);
      await requestApi(attachmentUrl('question-file'), { method: 'PUT', body: fd });
      pending.questionFile = null;
    }
    if (pending?.answerRemoved && state.row.answer_image_url) {
      await requestApi(attachmentUrl('answer-file'), { method: 'DELETE' });
      state.row.answer_image_url = ''; pending.answerRemoved = false;
    }
    if (pending?.answerFile) {
      const fd = new FormData();
      fd.append('file', pending.answerFile);
      await requestApi(attachmentUrl('answer-file'), { method: 'PUT', body: fd });
      pending.answerFile = null;
    }
    // 3) 标签：改过才提交（完整替换）
    if (pending) {
      const before = (state.row.knowledge || []).map(k => k.id).sort((a, b) => a - b);
      const after = pending.tags.map(t => t.id).sort((a, b) => a - b);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        await requestApi(`${API}/mistakes/${state.id}/knowledge`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ knowledgeIds: after })
        });
      }
    }
    if (!mistakeEditIsCurrent(state)) return;
    // 实质编辑会使旧的未确认复习请求失效，不能再发送旧步骤。
    if (savedRow.review_revision !== body.expectedRevision || attachmentsChanged) {
      mistakeStorageSet('mistake-pending:' + state.courseId + ':' + state.id, null);
    }
    if (typeof persistReviewMethodEditor === 'function' && !persistReviewMethodEditor('mistakeEdit','mistake',state.id)) {
      showToast('内容已保存，但复习方式未能保存到本浏览器，请重新打开编辑页重试。');
    } else if (reviewMethodWasDefault) {
      showToast('已保存；未手动选择复习方式，已按标准复习保存。');
    } else {
      showToast('已保存');
    }
    refreshMistakeFormat(savedRow);
    state.saving = false;
    closeMistakeEdit();
    if (state.view.type === 'mistake' && state.view.id === state.id) {
      await renderMistakeDetailPage(state.id, !!state.view.review);
    } else {
      await loadMistakes();
      if (state.view === currentView) window.scrollTo(state.scrollX, state.scrollY);
    }
  } catch (err) {
    if (mistakeEditIsCurrent(state)) {
      document.getElementById('mistakeEditError').textContent = err.message + '；输入已保留。';
      // 多接口保存可能已有部分成功，补读版本以便重试；不覆盖用户输入。
      try {
        if (!textSaved) return;
        const res = await requestApi(`${API}/mistakes/${state.id}`);
        const row = await res.json();
        if (mistakeEditIsCurrent(state)) {
          state.row = row;
          renderMistakeEditFiles();
        }
      } catch { /* 离线时仍保留表单和待上传文件。 */ }
    }
  } finally { state.saving = false; button.disabled = false; }
}
// 旧入口保留成薄壳，避免还有别处引用
async function editMistakeDetailTags() {
  openMistakeEdit();
}

async function mistakeReviewRequest(url, body) {
  let response;
  try {
    response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  } catch { throw new Error('无法连接服务器，操作可能已保存，请重试确认'); }
  const json = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(json?.message || `服务器返回 HTTP ${response.status}`), { status: response.status, code: json?.code });
  if (!json || !Number.isSafeInteger(json.version) || !Array.isArray(json.allowedActions)) throw new Error('复习数据格式不正确，请重试确认');
  return json;
}
function mistakeReviewUrl(state) { return `${API}/courses/${state.courseId}/mistakes/${state.id}/review`; }
function mistakePendingKey(state) { return (state.sessionItemId ? 'session-mistake-pending:'+state.sessionItemId : state.planItemId ? 'plan-mistake-pending:' + state.planItemId : 'mistake-pending:' + state.courseId) + ':' + state.id; }
async function refreshMistakeReview(state = mistakeDetailState) {
  if (!state) return;
  try {
    const progress = await mistakeReviewRequest(mistakeReviewUrl(state));
    if (!mistakeDetailIsCurrent(state)) return;
    state.progress = progress;
    renderMistakeReview(state);
  } catch (err) {
    if (!mistakeDetailIsCurrent(state)) return;
    document.getElementById('mistakeReviewPanel').innerHTML = `<div class="mistake-inline-error">${escapeHtml(err.message)}</div><button onclick="refreshMistakeReview()">重新加载</button>`;
  }
}

function mistakeChoiceHtml(p) {
  const choice = p.choice;
  if (!choice || !Array.isArray(choice.options)) return '';
  const completed = p.stage === 'completed';
  const multiple = choice.type === 'multiple';
  const selectedIds = new Set(Array.isArray(choice.selectedOption)
    ? choice.selectedOption : choice.selectedOption ? [choice.selectedOption] : []);
  const correctIds = new Set(Array.isArray(choice.correctOption)
    ? choice.correctOption : choice.correctOption ? [choice.correctOption] : []);
  const options = choice.options.map((option) => {
    const selected = selectedIds.has(option.id);
    const correct = completed && correctIds.has(option.id);
    const wrong = completed && selected && !correct;
    return `<label class="mistake-choice-option${correct ? ' is-correct' : ''}${wrong ? ' is-wrong' : ''}">
      <input type="${multiple ? 'checkbox' : 'radio'}" name="mistakeChoiceOption" value="${escapeHtml(option.id)}" ${selected ? 'checked' : ''} ${completed ? 'disabled' : ''} />
      <span class="mistake-choice-id">${escapeHtml(option.id)}</span>
      <span class="mistake-choice-text">${escapeHtml(option.text)}</span>
    </label>`;
  }).join('');
  const correctText = Array.isArray(choice.correctOption) ? choice.correctOption.join('、') : choice.correctOption || '';
  const result = completed && choice.correct !== null
    ? `<p class="mistake-choice-result ${choice.correct ? 'is-correct' : 'is-wrong'}">${p.responseKind==='unanswered'?'未作答，按不会记录':choice.correct ? '回答正确' : '回答错误'}${correctText ? ` · 正确答案 ${escapeHtml(correctText)}` : ''}</p>`
    : '';
  return `<div class="mistake-choice-options" role="${multiple ? 'group' : 'radiogroup'}" aria-label="选择答案">${options}</div>${result}`;
}

function renderMistakeReview(state) {
  const p = state.progress;
  const memorySelfReview = p.mistakeType === 'knowledge' && p.mode?.id === 'standard';
  const roundKey=p.round+':'+p.mode?.id;
  if(state.renderedRoundKey!==roundKey){state.firstAnswerDraft='';document.getElementById('mistakeFirstAnswer')?.remove();state.renderedRoundKey=roundKey;}
  const typedAnswer=document.getElementById('mistakeFirstAnswer')?.value || state.firstAnswerDraft || '';
  state.firstAnswerDraft=typedAnswer;
  const panel = document.getElementById('mistakeReviewPanel');
  const pending = mistakeStorageGet(mistakePendingKey(state)) || state.pending;
  const reasons = { missing_answer: '请先补充参考答案', missing_question: '请先补充题目文字或附件',
    missing_choice_options: '选择题缺少选项或正确选项' };
  const isChoice = p.mode?.id === 'choice_reproduction';
  if (!(isChoice && p.stage === 'question')) state.choiceStartedAt = null;
  const usesMastered = ['thinking', 'unclassified'].includes(p.mistakeType);
  document.getElementById('mistakeDetailMeta').textContent = `${MISTAKE_TYPES[p.mistakeType]}${p.mode?.name ? ' · ' + p.mode.name : ''} · ${mistakeStatusText(p.reviewStatus)} · 第 ${p.round} 轮`;
  let message = '';
  let actions = '';
  function button(text, action, key, value) {
    return `<button type="button" data-review-action="${key ? action + '-' + String(value) : action}" onclick="submitMistakeReview('${action}'${key ? ", '" + key + "', " + JSON.stringify(value).replace(/"/g, "'") : ''})">${text}</button>`;
  }
  if (!p.reviewable) {
    message = (p.blockedReasons || []).map(r => reasons[r] || r).join('；');
    actions = '<button onclick="openMistakeEdit()">补齐内容</button>';
  } else if (p.stage === 'idle') {
    message = '先看题目，开始本轮复习。'; actions = button('开始复习', 'start');
  } else if (isChoice && p.stage === 'question') {
    message = '遮住答案，重新选择一次。';
    state.choiceStartedAt ||= Date.now();
    message += ' 可以直接留空提交，按不会记录。';
    actions = '<button type="button" data-review-action="choose" onclick="submitMistakeChoice()">提交答案</button>';
  } else if (p.stage === 'question' && p.mistakeType === 'knowledge') {
    message = '你对这道题的记忆程度是？';
    actions = button('清楚', 'recall', 'recall', 'clear') + button('模糊', 'recall', 'recall', 'vague') + button('不记得', 'recall', 'recall', 'forgotten');
  } else if (p.stage === 'question') {
    message = p.mistakeType === 'unclassified' ? '请先自行回忆或重新解题，再查看答案。'
      : usesMastered ? '请先重新思考或解题，再对照答案。' : '请先重新做题，再对照答案和错误原因。';
    message += ' 留空提交按不会记录，不提供 AI 批改。';
    actions = button('提交作答，查看参考', 'reveal_answer')+'<button type="button" data-review-action="reveal_answer" onclick="submitMistakeReview(\'reveal_answer\',null,null,{firstAnswer:\'\'})">不会，查看参考</button>';
  } else if (p.stage === 'answer') {
    if (usesMastered) {
      message = '对照答案后，是否已经掌握？';
      actions = button('已掌握', 'judge', 'mastered', true) + button('仍需复习', 'judge', 'mastered', false);
    } else {
      message = memorySelfReview && !p.firstAnswer ? '对照答案后，你的回忆是否基本一致？本轮仅记录记忆自评。' : '对照答案后，你的判断是？';
      actions = button(memorySelfReview && !p.firstAnswer ? '基本记得' : '正确', 'judge', 'correct', true)
        + button(memorySelfReview && !p.firstAnswer ? '仍需复习' : '错误', 'judge', 'correct', false);
    }
  } else {
    if (p.responseKind==='unanswered') {
      message='本轮未作答，已按不会记录，仍需复习；可以查看参考后再试一次。';
    } else if (isChoice && p.choice) {
      message = p.choice.correct ? '回答正确，本轮完成。' : '回答错误，本题仍为未复习。';
    } else {
      message = p.recall === 'forgotten' && p.reviewStatus !== 'reviewed' ? '已记录“不记得”，这道题仍为未复习。' : `本轮已保存：${mistakeStatusText(p.reviewStatus)}。`;
    }
    actions = typeof mistakeQueueCurrent === 'function' && mistakeQueueCurrent(state) && p.round === mistakeQueue.rounds[state.id]
      ? '' : button('再次复习', 'start');
    if(p.responseKind==='unanswered'&&mistakeQueue?.centerContext&&mistakeQueueCurrent(state)){
      actions='<button type="button" onclick="centerReviewItemFinished()">看完了，继续复习</button>';
    }
  }
  // 队列新开一轮时，不短暂展示上次已完成复习的答案。
  const answerVisible = p.answerVisible && (typeof mistakeQueueCurrent !== 'function' || !mistakeQueueCurrent(state)
    || p.round === mistakeQueue.rounds[state.id]);
  const answerText = p.answer?.content || '';
  const answerFile = p.answer ? mistakeAttachmentHtml('答案附件', p.answer.fileUrl, p.answer.fileType) : '';
  const answerBlock = answerVisible && p.answer
    ? `${answerText || answerFile ? `<h2>参考答案</h2>${answerText ? `<div id="mistakeReviewAnswer" class="detail-content">${escapeHtml(answerText)}</div>` : ''}${answerFile}` : ''}
      <h2>解析 / 错误原因</h2><div class="detail-content">${escapeHtml(p.answer.explanation || '暂无解析或错误原因')}</div>`
    : '';
  const modeSwitch = !mistakeQueue?.centerContext && p.mode?.availableModes?.length > 1
    ? `<label class="mistake-mode-switch"><span>复习模式</span><select onchange="changeMistakeReviewMode(this.value)" ${mistakeReviewBusy ? 'disabled' : ''}>${p.mode.availableModes.map(mode =>
      `<option value="${escapeHtml(mode.id)}" ${mode.id === p.mode.id ? 'selected' : ''}>${escapeHtml(mode.name)}</option>`).join('')}</select></label>`
    : '';
  const answerEditor = `<label>${memorySelfReview ? '回忆内容（选填；记录后可用于 AI 批改）' : '首次作答（可留空；留空提交按不会记录）'}<textarea id="mistakeFirstAnswer" rows="4" oninput="mistakeDetailState.firstAnswerDraft=this.value">${escapeHtml(typedAnswer)}</textarea></label>`;
  const firstAnswerInput=!isChoice && p.stage==='question'
    ? memorySelfReview ? `<details data-memory-answer${typedAnswer ? ' open' : ''}><summary>记录我的回忆（选填）</summary><p class="ai-help">可先在心里回忆、口头背诵或在纸上作答，再直接选择记忆程度。需要 AI 批改时，请在这里记录实际回忆。</p>${answerEditor}</details>` : answerEditor
    : p.firstAnswer ? `<p>首次作答：${escapeHtml(p.firstAnswer)}${p.answerRevealed && !isChoice ? ' · 已看答案，本轮最高评为“基本掌握”' : ''}</p>` : '';
  panel.innerHTML = `${modeSwitch}<p>${escapeHtml(message)}</p>${firstAnswerInput}${isChoice && p.choice ? mistakeChoiceHtml(p) : ''}${answerBlock}
    <div class="mistake-review-actions">${pending ? '<span>有一次操作待确认，请先重试。</span><button onclick="retryMistakeReview()">重试上次操作</button>' : actions}</div>
    <div id="mistakeReviewError" class="mistake-inline-error" role="alert"></div>`;
  if (mistakeReviewBusy) panel.querySelectorAll('button').forEach(b => { b.disabled = true; });
  panel.querySelectorAll('[data-review-action]').forEach(b => {
    const action = b.dataset.reviewAction.split('-')[0];
    if (!p.allowedActions.includes(action)) b.disabled = true;
  });
  if (typeof mistakeQueueCurrent === 'function' && mistakeQueueCurrent(state)
    && (p.mistakeType !== mistakeQueueTypeFor(state.id) || !p.reviewable)) {
    panel.querySelectorAll('[data-review-action]').forEach(b => { b.disabled = true; });
  }
  if (typeof renderMistakeQueueBanner === 'function') renderMistakeQueueBanner();
  if(typeof mountMistakeFeedback==='function')mountMistakeFeedback(state,answerVisible);
}

async function submitMistakeReview(action, key, value, extra = {}) {
  const state = mistakeDetailState;
  if (!state?.progress || mistakeReviewBusy || !state.progress.allowedActions.includes(action)) return;
  if (typeof mistakeQueueCurrent === 'function' && mistakeQueueCurrent(state)
    && (state.progress.mistakeType !== mistakeQueueTypeFor(state.id) || !state.progress.reviewable)) return;
  if (mistakeStorageGet(mistakePendingKey(state)) || state.pending) return;
  if (['start','restart'].includes(action) && typeof mistakeQueueCurrent === 'function' && mistakeQueueCurrent(state)) {
    mistakeQueue.rounds[state.id] = state.progress.round + 1;
    saveMistakeQueue();
  }
  const requestId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2);
  const body = { action, requestId, expectedVersion: state.progress.version };
  if (key) body[key] = value;
  if (['recall','reveal_answer'].includes(action)) {
    body.firstAnswer=(document.getElementById('mistakeFirstAnswer')?.value || state.firstAnswerDraft || '').trim();
  }
  if (['start','restart'].includes(action)) state.firstAnswerDraft='';
  if (state.progress.startedAt) body.durationMs=Math.max(1,Math.min(86400000,Date.now()-Date.parse(state.progress.startedAt)));
  Object.assign(body, extra);
  const pending = { body, start: action === 'start', planItemId:state.planItemId,sessionItemId:state.sessionItemId };
  mistakeStorageSet(mistakePendingKey(state), pending);
  state.pending = pending; // localStorage 不可用时，仍能在当前页面重试。
  await sendMistakeReview(state, pending);
}
function submitMistakeChoice() {
  const state = mistakeDetailState;
  if (!state?.progress || mistakeReviewBusy || state.progress.stage !== 'question') return;
  const selected = [...document.querySelectorAll('input[name="mistakeChoiceOption"]:checked')].map(input => input.value);
  const durationMs = Math.max(0, Math.min(86400000, Date.now() - (state.choiceStartedAt || Date.now())));
  return submitMistakeReview('choose', 'selectedOption',
    state.progress.choice?.type === 'multiple' ? selected : (selected[0]||''), { durationMs });
}
async function changeMistakeReviewMode(modeId) {
  const state = mistakeDetailState;
  if (!state?.progress || mistakeReviewBusy || !modeId || modeId === state.progress.mode?.id) return;
  if (state.progress.stage !== 'idle'
    && !await showConfirm('切换复习模式会重新开始本轮，记忆状态和排期会保留。确定吗？', '切换复习模式')) {
    renderMistakeReview(state);
    return;
  }
  mistakeReviewBusy = true;
  renderMistakeReview(state);
  try {
    const response = await requestApi(`${API}/courses/${state.courseId}/mistakes/${state.id}/mode`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modeId })
    });
    const mode = await response.json();
    if (!mistakeDetailIsCurrent(state)) return;
    await refreshMistakeReview(state);
    if(typeof rememberReviewModeSelection==='function')rememberReviewModeSelection({...state,type:'mistake'},modeId);
    showToast(`已切换为${mode.name || '新复习模式'}`);
  } catch (err) {
    if (mistakeDetailIsCurrent(state)) showToast(err.message);
  } finally {
    mistakeReviewBusy = false;
    if (mistakeDetailIsCurrent(state)) renderMistakeReview(state);
  }
}
async function retryMistakeReview() {
  const state = mistakeDetailState;
  const pending = state && (mistakeStorageGet(mistakePendingKey(state)) || state.pending);
  if (pending && !mistakeReviewBusy) await sendMistakeReview(state, pending);
}
async function sendMistakeReview(state, pending) {
  mistakeReviewBusy = true;
  let saved = false;
  if (mistakeDetailIsCurrent(state)) renderMistakeReview(state);
  try {
    const params=new URLSearchParams();if(pending.planItemId)params.set('planItemId',pending.planItemId);if(pending.sessionItemId)params.set('sessionItemId',pending.sessionItemId);
    const progress = await mistakeReviewRequest(mistakeReviewUrl(state) + (pending.start ? '' : '/events')
      + (params.size ? '?'+params : ''), pending.body);
    mistakeStorageSet(mistakePendingKey(state), null); state.pending = null;
    saved = true;
    if (mistakeDetailIsCurrent(state)) {
      state.progress = progress;
      await refreshMistakeReview(state);
    }
  } catch (err) {
    if (err.status && err.status < 500) {
      // 已明确拒绝的操作不再重试，读取服务端新步骤。
      mistakeStorageSet(mistakePendingKey(state), null); state.pending = null;
      if (mistakeDetailIsCurrent(state)) await refreshMistakeReview(state);
    }
    if (mistakeDetailIsCurrent(state)) {
      const errorBox = document.getElementById('mistakeReviewError');
      if (errorBox) errorBox.textContent = err.message;
      showToast(err.message);
    }
  } finally {
    mistakeReviewBusy = false;
    if (mistakeDetailIsCurrent(state)) {
      const error = document.getElementById('mistakeReviewError')?.textContent || '';
      renderMistakeReview(state);
      document.getElementById('mistakeReviewError').textContent = error;
    } else if (mistakeDetailState?.review && mistakeDetailState.progress && mistakeDetailIsCurrent(mistakeDetailState)) {
      renderMistakeReview(mistakeDetailState);
    }
    // 过完全部所选题（最后一题判完）自动弹出完成弹窗，不用再点按钮。
    if (saved && typeof tryFinishMistakeQueue === 'function') await tryFinishMistakeQueue(state, state.progress);
  }
}
