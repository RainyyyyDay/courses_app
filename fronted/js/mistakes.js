/* 错题分类与列表。沿用全局脚本和现有页面容器，不引入路由或框架。 */
const MISTAKE_TYPES = { knowledge: '知识类', thinking: '思维类', execution: '执行类', unclassified: '待分类' };
let mistakeUi = { courseId: null, type: null, q: '', favorite: '', reviewStatus: '', nodeIds: [] };
let mistakeListRequest = 0;
let mistakeTagRequest = 0;
const mistakeFavoritePending = new Set();

function mistakeStorageGet(key) {
  try { return typeof localStorage === 'undefined' ? null : JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function mistakeStorageSet(key, value) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value)); } catch { /* 存储不可用仍可正常操作，进度以后端为准。 */ }
}
function ensureMistakeUi() {
  if (mistakeUi.courseId === currentCourseId) return;
  const saved = mistakeStorageGet('mistake-list:' + currentCourseId) || {};
  mistakeUi = {
    courseId: currentCourseId, type: Object.hasOwn(MISTAKE_TYPES, saved.type) ? saved.type : null,
    q: typeof saved.q === 'string' ? saved.q : '',
    favorite: saved.favorite === 'true' ? 'true' : '',
    reviewStatus: ['reviewed', 'unreviewed'].includes(saved.reviewStatus) ? saved.reviewStatus : '',
    nodeIds: Array.isArray(saved.nodeIds) ? saved.nodeIds.filter(Number.isSafeInteger) : []
  };
}
function rememberMistakeUi() { mistakeStorageSet('mistake-list:' + currentCourseId, mistakeUi); }
function mistakeStatusText(status) { return status === 'reviewed' ? '已复习' : '未复习'; }
function mistakeFormatHtml(row) {
  const confirmed = row.question_format_confirmed === 1;
  const name = confirmed ? (row.question_format === 'choice' ? '选择题' : '主观题') : '题型待确认';
  return `<div class="mistake-format" data-format-id="${Number(row.id)}"><span class="mistake-state">${name}</span>${confirmed ? '' : `
    <button type="button" class="edit-mini-btn" data-format-confirm onclick="event.stopPropagation();confirmMistakeFormat(${Number(row.id)}, '${row.question_format === 'choice' ? 'choice' : 'open'}')">${row.question_format === 'choice' ? '确认当前选择题' : '确认是主观题'}</button>
    <button type="button" class="edit-mini-btn" data-format-edit onclick="event.stopPropagation();editMistakeFormatAsChoice(${Number(row.id)})">编辑为选择题</button>`}</div>`;
}
const mistakeFormatPending = new Set();
function refreshMistakeFormat(row) {
  currentMistakes = currentMistakes.map(item => item.id === row.id ? {...item, ...row} : item);
  document.querySelectorAll('[data-format-id="'+row.id+'"]').forEach(node => { node.outerHTML = mistakeFormatHtml(row); });
}
async function confirmMistakeFormat(id, expectedFormat) {
  const courseId = currentCourseId, key = courseId + ':' + id;
  if (mistakeFormatPending.has(key)) return;
  mistakeFormatPending.add(key);
  try {
    const row = await (await requestApi(`${API}/mistakes/${id}`)).json();
    if (currentCourseId !== courseId || row.course_id !== courseId) return;
    if (row.question_format !== expectedFormat) throw new Error('题型已被修改，请重新打开后确认');
    const saved = await (await requestApi(`${API}/courses/${courseId}/mistakes/${id}`, {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({questionFormatConfirmed:true, expectedRevision:row.review_revision})
    })).json();
    if (currentCourseId !== courseId) return;
    refreshMistakeFormat(saved);
    if (mistakeDetailState?.id === id && mistakeDetailState.courseId === courseId) mistakeDetailState.row = saved;
    showToast('题型已确认，复习进度保持不变');
  } catch (err) { showToast(err.message || '确认失败，请重试'); }
  finally { mistakeFormatPending.delete(key); }
}
function markMistakeFormatSelected() {
  document.getElementById('mistakeEditFormatConfirmed').checked = true;
}
async function editMistakeFormatAsChoice(id) {
  await editMistakeFromList(id);
  if (!mistakeEditPending || mistakeEditPending.id !== id || !mistakeEditIsCurrent(mistakeEditPending)) return;
  document.getElementById('mistakeEditFormat').value = 'choice';
  markMistakeFormatSelected();
  toggleMistakeChoiceFields('Edit');
  refreshMistakeEditDirty();
}
function choiceLetters(count) {
  return Array.from({ length: Math.max(0, count) }, (_, index) => String.fromCharCode(65 + index));
}
function parseMistakeChoiceOptions(raw) {
  let options = [];
  try { options = Array.isArray(raw) ? raw : JSON.parse(raw || '[]'); } catch { options = []; }
  return Array.isArray(options)
    ? options.map((option, index) => {
        const letter = choiceLetters(index + 1)[index];
        if (typeof option === 'string') return { id: letter, text: option };
        return { id: String(option?.id || letter).toUpperCase(), text: String(option?.text || '') };
      })
    : [];
}
function parseMistakeCorrectIds(choiceType, raw) {
  if (choiceType === 'multiple') {
    if (Array.isArray(raw)) return raw.map(value => String(value).toUpperCase());
    try {
      const parsed = JSON.parse(raw || '[]');
      if (Array.isArray(parsed)) return parsed.map(value => String(value).toUpperCase());
    } catch { /* 兼容逗号分隔值 */ }
    return String(raw || '').split(',').map(value => value.trim().toUpperCase()).filter(Boolean);
  }
  return raw ? [String(raw).toUpperCase()] : [];
}
function toggleMistakeChoiceFields(prefix) {
  const format = document.getElementById(`mistake${prefix}Format`);
  const box = document.getElementById(`mistake${prefix}ChoiceFields`);
  const choice = format?.value === 'choice';
  if (box) box.style.display = choice ? (prefix === 'Create' ? 'block' : 'grid') : 'none';
  const choiceAnswer = document.getElementById(`mistake${prefix}ChoiceAnswerField`);
  if (choiceAnswer) choiceAnswer.style.display = choice ? 'grid' : 'none';
  const openAnswer = document.getElementById(`mistake${prefix}OpenAnswerFields`);
  if (openAnswer) openAnswer.style.display = choice ? 'none' : 'grid';
  const answerHint = document.getElementById(`mistake${prefix}AnswerHint`);
  if (answerHint) answerHint.textContent = choice
    ? '从选项中选择正确答案；多选题可多选'
    : (prefix === 'Edit' ? '可填写答案文字或上传答案附件；填写后方可进入复习' : '可后补；补齐后才能复习');
  const questionTitle = document.getElementById(`mistake${prefix}QuestionTitle`);
  if (questionTitle) questionTitle.textContent = choice ? '题干' : '题目';
  const questionHint = document.getElementById(`mistake${prefix}QuestionHint`);
  if (questionHint) questionHint.textContent = choice
    ? '可上传题干附件，也可直接录入题干'
    : '可上传题目附件，也可直接录入题目内容';
  if (prefix === 'Create') updateMistakeCreateOcrActions();
  if (prefix === 'Edit' && typeof updateMistakeEditOcrActions === 'function') updateMistakeEditOcrActions();
}
function readMistakeChoiceOptionValues(prefix) {
  return [...document.querySelectorAll(`#mistake${prefix}OptionsList .choice-option-input`)].map(input => input.value);
}
function readMistakeChoiceAnswerIds(prefix) {
  return [...document.querySelectorAll(`#mistake${prefix}AnswerOptions input:checked`)].map(input => input.value);
}
function renderMistakeChoiceAnswerOptions(prefix, selected = readMistakeChoiceAnswerIds(prefix)) {
  const box = document.getElementById(`mistake${prefix}AnswerOptions`);
  if (!box) return;
  const values = readMistakeChoiceOptionValues(prefix);
  const type = document.getElementById(`mistake${prefix}ChoiceType`)?.value || 'single';
  const letters = choiceLetters(values.length);
  const selectedSet = new Set(type === 'single' ? selected.slice(0, 1) : selected);
  box.innerHTML = letters.length
    ? letters.map((letter, index) => `<label class="choice-answer-option">
        <input type="${type === 'multiple' ? 'checkbox' : 'radio'}" name="mistake${prefix}CorrectAnswer"
          value="${letter}" ${selectedSet.has(letter) ? 'checked' : ''} ${values[index].trim() ? '' : 'disabled'}
          onchange="syncMistakeChoiceAnswer('${prefix}')" />
        <span>${letter}</span>
      </label>`).join('')
    : '<span class="tag-none">先添加选项</span>';
}
function renderMistakeChoiceOptionRows(prefix, values, selected) {
  const list = document.getElementById(`mistake${prefix}OptionsList`);
  if (!list) return;
  const currentSelected = selected === undefined ? readMistakeChoiceAnswerIds(prefix) : selected;
  const rows = Array.isArray(values) ? values.slice(0, 26) : [];
  while (rows.length < 2) rows.push('');
  const letters = choiceLetters(rows.length);
  list.innerHTML = rows.map((text, index) => `<div class="choice-option-row" data-choice-option-index="${index}">
    <span class="choice-option-letter">${letters[index]}.</span>
    <input class="choice-option-input" maxlength="500" value="${escapeHtml(text || '')}" placeholder="选项内容"
      oninput="syncMistakeChoiceAnswer('${prefix}')" />
    <button type="button" class="choice-option-remove" onclick="removeMistakeChoiceOption('${prefix}',${index})"
      ${rows.length <= 2 ? 'disabled' : ''} aria-label="删除选项 ${letters[index]}">×</button>
  </div>`).join('');
  const add = document.querySelector(`#mistake${prefix}ChoiceFields .choice-add-option`);
  if (add) add.disabled = rows.length >= 26;
  renderMistakeChoiceAnswerOptions(prefix, currentSelected.filter(id => letters.includes(id)));
}
function setMistakeChoiceEditor(prefix, options, correctOption, choiceType = 'single') {
  const type = choiceType === 'multiple' ? 'multiple' : 'single';
  const typeSelect = document.getElementById(`mistake${prefix}ChoiceType`);
  if (typeSelect) typeSelect.value = type;
  const parsed = parseMistakeChoiceOptions(options);
  const values = parsed.length ? parsed.map(option => option.text) : ['', ''];
  const selected = parseMistakeCorrectIds(type, correctOption);
  renderMistakeChoiceOptionRows(prefix, values, selected);
}
function addMistakeChoiceOption(prefix) {
  const values = readMistakeChoiceOptionValues(prefix);
  const selected = readMistakeChoiceAnswerIds(prefix);
  if (values.length >= 26) { showToast('最多只能添加 26 个选项（A–Z）'); return; }
  values.push('');
  renderMistakeChoiceOptionRows(prefix, values, selected);
  if (prefix === 'Edit') refreshMistakeEditDirty();
}
function removeMistakeChoiceOption(prefix, index) {
  const values = readMistakeChoiceOptionValues(prefix);
  const selected = readMistakeChoiceAnswerIds(prefix);
  if (values.length <= 2) { showToast('至少保留两个选项'); return; }
  const letters = choiceLetters(values.length);
  const removed = letters[index];
  const mapped = selected.filter(id => id !== removed).map(id => {
    const code = id.charCodeAt(0);
    return code > removed.charCodeAt(0) ? String.fromCharCode(code - 1) : id;
  });
  values.splice(index, 1);
  renderMistakeChoiceOptionRows(prefix, values, mapped);
  if (prefix === 'Edit') refreshMistakeEditDirty();
}
function changeMistakeChoiceType(prefix) {
  const selected = readMistakeChoiceAnswerIds(prefix);
  const type = document.getElementById(`mistake${prefix}ChoiceType`)?.value || 'single';
  const next = type === 'single' ? selected.slice(0, 1) : selected;
  renderMistakeChoiceAnswerOptions(prefix, next);
  if (prefix === 'Edit') refreshMistakeEditDirty();
}
function syncMistakeChoiceAnswer(prefix) {
  renderMistakeChoiceAnswerOptions(prefix, readMistakeChoiceAnswerIds(prefix));
  if (prefix === 'Create') updateMistakeCreateAnswerClear();
  if (prefix === 'Edit') refreshMistakeEditDirty();
}
function mistakeChoiceFields(prefix) {
  const format = document.getElementById(`mistake${prefix}Format`)?.value || 'open';
  const choiceType = document.getElementById(`mistake${prefix}ChoiceType`)?.value || 'single';
  if (format === 'open') return { questionFormat: 'open', options: [], correctOption: '', choiceType };
  const values = readMistakeChoiceOptionValues(prefix).map(value => value.trim());
  if (values.length < 2) throw new Error('选择题至少需要两个选项');
  if (values.some(value => !value)) throw new Error('请填写每个选项的内容');
  if (new Set(values).size !== values.length) throw new Error('选项内容不能重复');
  const letters = choiceLetters(values.length);
  const selected = readMistakeChoiceAnswerIds(prefix);
  if (choiceType === 'single' && selected.length !== 1) throw new Error('单选题只能选择一个正确答案');
  if (choiceType === 'multiple' && selected.length < 1) throw new Error('多选题至少选择一个正确答案');
  return {
    questionFormat: 'choice',
    options: values.map((text, index) => ({ id: letters[index], text })),
    correctOption: choiceType === 'single' ? selected[0] : selected,
    choiceType,
  };
}
function mistakeCreationFields() {
  const mistakeType = document.getElementById('mistakeCreateType').value;
  if (!Object.hasOwn(MISTAKE_TYPES, mistakeType)) throw new Error('请选择错题类型');
  return { mistakeType, answerContent: document.getElementById('mistakeCreateAnswer').value,
    explanation: document.getElementById('mistakeCreateExplanation').value, ...mistakeChoiceFields('Create') };
}

function renderMistakeCategories(rows = null) {
  const home = !mistakeUi.type;
  const reviewEntry = document.getElementById('mistakeHomeReview');
  // 错题单独复习入口已移除；只保留总复习和考前计划。
  if (reviewEntry) reviewEntry.style.display = 'none';
  // 录入入口（上传文件 / 手动输入）只留在「错题」大页：
  // 分类详情页是用来查看和复习的，加题请回大页点分类上方的按钮。
  const entryBtns = document.getElementById('mistakeEntryBtns');
  if (entryBtns) entryBtns.style.display = home ? 'flex' : 'none';
  document.getElementById('mistakeCategories').style.display = home ? 'grid' : 'none';
  document.getElementById('mistakeFilters').style.display = home ? 'none' : 'block';
  document.getElementById('mistakeCategories').innerHTML = Object.entries(MISTAKE_TYPES).map(([type, name]) =>
    `<button type="button" data-mistake-category="${type}" onclick="openMistakeCategory('${type}')">${name}<small>${rows ? rows.filter(r => r.mistake_type === type).length + ' 道' : '…'}</small></button>`).join('');
  document.getElementById('mistakeCategoryTitle').textContent = MISTAKE_TYPES[mistakeUi.type] || '';
  document.getElementById('mistakeSearch').value = mistakeUi.q;
  document.getElementById('mistakeFavoriteFilter').checked = mistakeUi.favorite === 'true';
  document.getElementById('mistakeStatusFilter').value = mistakeUi.reviewStatus;
}

async function openMistakeCategory(type, keepSelection = false) {
  ensureMistakeUi();
  mistakeUi.type = Object.hasOwn(MISTAKE_TYPES, type) ? type : null;
  if (typeof mistakeSelection !== 'undefined') {
    if (keepSelection && mistakeSelection?.mixed && mistakeSelection.courseId === currentCourseId) mistakeSelection.type = mistakeUi.type;
    else mistakeSelection = null;
  }
  rememberMistakeUi();
  mistakeStorageSet('mistake-detail:' + currentCourseId, null);
  await loadMistakes();
}

async function loadMistakes() {
  ensureMistakeUi();
  const courseId = currentCourseId;
  const request = ++mistakeListRequest;
  const box = document.getElementById('mistakeList');
  renderMistakeCategories();
  if (typeof mistakeSelectionCurrent === 'function') {
    if (mistakeSelectionCurrent()) mistakeSelection.listLoading = true;
    renderMistakeSelectionControls();
  }
  box.innerHTML = '<div class="loading-tip">加载中…</div>';
  const filters = mistakeUi.type ? {
    mistakeType: mistakeUi.type, q: mistakeUi.q.trim(), favorite: mistakeUi.favorite,
    reviewStatus: mistakeUi.reviewStatus, nodeIds: mistakeUi.nodeIds.join(',')
  } : {};
  const query = Object.entries(filters).filter(([, value]) => value !== '').map(([key, value]) => key + '=' + encodeURIComponent(value)).join('&');
  if (mistakeUi.type) loadMistakeFilterTags();
  try {
    const rows = await requestList(`${API}/courses/${courseId}/mistakes${query ? '?' + query : ''}`);
    if (request !== mistakeListRequest || courseId !== currentCourseId) return;
    currentMistakes = rows;
    const selecting = typeof mistakeSelectionCurrent === 'function' && mistakeSelectionCurrent();
    if (selecting) mistakeSelection.listLoading = false;
    if (typeof renderMistakeSelectionControls === 'function') renderMistakeSelectionControls();
    if (!mistakeUi.type) {
      renderMistakeCategories(rows);
      box.innerHTML = `<div class="empty">${rows.length ? '选择一个分类查看错题' : '暂无错题，可上传文件或手动输入'}</div>`;
      return;
    }
    if (!rows.length) { box.innerHTML = '<div class="empty">暂无符合条件的错题</div>'; return; }
    box.innerHTML = rows.map(r => `
      <div class="item-row ${selecting ? 'mistake-selectable' : 'card-openable'}" data-mistake-id="${r.id}"
        ${selecting ? `onclick="toggleMistakeCard(event, ${r.id})"` : `role="link" tabindex="0" aria-label="查看错题：${escapeHtml(r.title)}" onclick="openMistakeCard(event, ${r.id})" onkeydown="openMistakeCardKey(event, ${r.id})"`}>
        <div class="info">
          <div${selecting ? ' class="mistake-title-row"' : ''}>
            <div class="title">${escapeHtml(r.title)}</div>
            ${selecting ? `<input class="mistake-select-check" type="checkbox" value="${r.id}" aria-label="选择 ${escapeHtml(r.title)}" ${mistakeSelection.ids.has(r.id) ? 'checked' : ''} ${mistakeCannotReview(r) ? 'disabled' : ''} onchange="chooseMistake(${r.id}, this.checked)" />` : ''}
          </div>
          ${mistakeFormatHtml(r)}
          ${selecting ? `<div class="mistake-line"><span class="mistake-state ${r.review_status === 'reviewed' ? 'mistake-state-reviewed' : ''}">${mistakeStatusText(r.review_status)}</span>${r.favorite ? '<span class="mistake-state">★ 已收藏</span>' : ''}${(r.knowledge || []).map(k => `<span class="mistake-state">${escapeHtml(k.name)}</span>`).join('')}</div>`
            : `<span class="material-review-badge">${mistakeStatusText(r.review_status)}</span>`}
          <div class="meta">${!r.image_url ? '手动输入' : (isImageFile(r.file_type, r.image_url) ? '图片' : '文件')} · ${escapeHtml(r.created_at || '')}</div>
          ${r.content ? `<div class="row-content">${escapeHtml(r.content)}</div>` : ''}
          ${typeof mistakeAiSavedHtml === 'function' ? mistakeAiSavedHtml(courseId, r.id) : ''}
          ${selecting ? '' : `<div class="mistake-tags">${nodeChipsHtml(r)}</div>`}
          ${selecting && mistakeCannotReview(r) ? `<button type="button" class="mistake-inline-error mistake-repair" title="点击补齐内容" onclick="event.stopPropagation();${typeof mistakeReviewPicker !== 'undefined' && mistakeReviewPicker ? 'openMistakeReviewRepair' : 'openMistakeDetail'}(${r.id})">⚠️${mistakeCannotReview(r)}，暂不能勾选，请补齐内容。</button>` : ''}
        </div>
        <div class="mistake-actions" ${selecting ? 'style="display:none;"' : ''}>
          <button class="reading-favorite ${r.favorite ? 'is-favorite' : ''}" data-mistake-favorite="${r.id}" aria-label="${r.favorite ? '取消收藏' : '收藏'}" aria-pressed="${!!r.favorite}" ${mistakeFavoritePending.has(currentCourseId + ':' + r.id) ? 'disabled' : ''} onclick="event.stopPropagation();toggleMistakeFavorite(${r.id}, ${!r.favorite}, this)">${r.favorite ? '★' : '☆'}</button>
          <button onclick="event.stopPropagation();openMistakeDetail(${r.id})">查看</button>
          <button type="button" class="mistake-ai-entry" onclick="event.stopPropagation();openMistakeAiFromList(${r.id},this)">AI 复习建议</button>
          <button onclick="event.stopPropagation();editMistakeFromList(${r.id})">编辑</button>
          <button onclick="event.stopPropagation();delItem('mistakes', ${r.id}, loadMistakes)">删除</button>
        </div>
      </div>`).join('');
  } catch (err) {
    if (request !== mistakeListRequest || courseId !== currentCourseId) return;
    currentMistakes = [];
    if (typeof mistakeSelectionCurrent === 'function' && mistakeSelectionCurrent()) {
      mistakeSelection.listLoading = true; // 加载失败时禁止以旧结果全选或开始。
      updateMistakeSelectionControls();
    }
    showListError(box, err);
    box.insertAdjacentHTML?.('beforeend', '<button type="button" onclick="loadMistakes()">重试</button>');
  }
}

async function loadMistakeFilterTags() {
  const courseId = currentCourseId;
  const request = ++mistakeTagRequest;
  const box = document.getElementById('mistakeFilterTags');
  box.innerHTML = '<div class="loading-tip">加载标签…</div>';
  try {
    const tree = await requestList(`${API}/courses/${courseId}/knowledge-tree`);
    if (courseId !== currentCourseId || request !== mistakeTagRequest) return;
    const nodes = [];
    function visit(children, path) {
      for (const node of children) {
        if (node.is_system) continue;
        const name = [...path, node.name];
        nodes.push({ id: node.id, name: name.join(' / ') });
        visit(node.children || [], name);
      }
    }
    visit(tree, []);
    // 已删除标签不再作为筛选参数发送，避免列表一直返回 400。
    const valid = new Set(nodes.map(n => n.id));
    const old = mistakeUi.nodeIds.length;
    mistakeUi.nodeIds = mistakeUi.nodeIds.filter(id => valid.has(id));
    rememberMistakeUi();
    box.innerHTML = nodes.length ? nodes.map(n => `<label class="reading-review-tag"><input type="checkbox" value="${n.id}" ${mistakeUi.nodeIds.includes(n.id) ? 'checked' : ''} onchange="changeMistakeTagFilter(${n.id}, this.checked)" />${escapeHtml(n.name)}</label>`).join('') : '<span class="tag-none">暂无可选标签</span>';
    if (old !== mistakeUi.nodeIds.length) loadMistakes();
  } catch (err) {
    if (courseId !== currentCourseId || request !== mistakeTagRequest) return;
    box.innerHTML = `<div class="mistake-inline-error">${escapeHtml(err.message)}</div><button type="button" onclick="loadMistakeFilterTags()">重试标签</button>`;
  }
}

async function applyMistakeFilters() {
  // 输入时保留空格，查询时再 trim，避免实时筛选吃掉尚未输入下一词的空格。
  mistakeUi.q = document.getElementById('mistakeSearch').value;
  mistakeUi.favorite = document.getElementById('mistakeFavoriteFilter').checked ? 'true' : '';
  mistakeUi.reviewStatus = document.getElementById('mistakeStatusFilter').value;
  rememberMistakeUi();
  await loadMistakes();
}
async function changeMistakeTagFilter(id, checked) {
  mistakeUi.nodeIds = checked ? [...new Set([...mistakeUi.nodeIds, id])] : mistakeUi.nodeIds.filter(value => value !== id);
  await applyMistakeFilters();
}
async function clearMistakeFilters() {
  Object.assign(mistakeUi, { q: '', favorite: '', reviewStatus: '', nodeIds: [] });
  rememberMistakeUi();
  await loadMistakes();
}
async function toggleMistakeFavorite(id, favorite, button) {
  const courseId = currentCourseId;
  const key = courseId + ':' + id;
  if (mistakeFavoritePending.has(key)) return;
  mistakeFavoritePending.add(key);
  const scrollX = window.scrollX, scrollY = window.scrollY;
  const view = currentView;
  if (button) button.disabled = true;
  try {
    const res = await requestApi(`${API}/courses/${courseId}/mistakes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite }) });
    const row = await res.json();
    if (row.id !== id || row.course_id !== courseId || !!row.favorite !== favorite) throw new Error('收藏保存响应无效，请重试');
    if (courseId === currentCourseId) {
      await loadMistakes();
      if (view === currentView) window.scrollTo(scrollX, scrollY);
    }
  } catch (err) { if (courseId === currentCourseId) showToast(err.message); }
  finally {
    mistakeFavoritePending.delete(key);
    if (button) button.disabled = false;
    if (courseId === currentCourseId) document.querySelectorAll(`[data-mistake-favorite="${id}"]`).forEach(star => { star.disabled = false; });
  }
}

// 点白色卡片 = 打开这道题的详情（点里面的按钮、链接、勾选框不算）
function openMistakeCard(event, id) {
  if (event.target.closest('a,button,input,label')) return;
  openMistakeDetail(id);
}
function openMistakeCardKey(event, id) {
  if (event.target.closest('a,button,input,label')) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  openMistakeDetail(id);
}

// 只读取最新数据，不改视图、导航栈或列表筛选。
async function editMistakeFromList(id) {
  const request = ++mistakeEditRequest;
  const courseId = currentCourseId;
  const view = currentView;
  try {
    const res = await requestApi(`${API}/mistakes/${id}`);
    const row = await res.json();
    if (request !== mistakeEditRequest || courseId !== currentCourseId || view !== currentView) return;
    if (row.course_id !== courseId) throw new Error('这道错题不属于当前课程');
    await openMistakeEdit(row);
  } catch (err) {
    if (request === mistakeEditRequest && courseId === currentCourseId && view === currentView) showToast(err.message);
  }
}

async function uploadMistake() {
  const input = document.getElementById('mistakeFile');
  const file = input.files[0];
  if (!file) return;
  pendingUploadFile = file;
  input.value = '';
  await openTagPicker('upload', 'mistake', null);
}
function openMistakeCreate() {
  pendingUploadFile = null;
  pendingManual = null;
  pendingAnswerFile = null;
  return openTagPicker('upload', 'mistake', null);
}
function renderMistakeCreateFileSummary() {
  renderMistakeCreateAnswerFileSummary();
  const summary = document.getElementById('mistakeCreateFileSummary');
  const remove = document.getElementById('mistakeCreateQuestionRemove');
  const ocr = document.getElementById('mistakeCreateOcrBtn');
  if (!summary) return;
  if (!pendingUploadFile) {
    summary.style.display = 'none';
    summary.innerHTML = '';
    if (remove) remove.style.display = 'none';
    if (ocr) ocr.style.display = 'none';
    return;
  }
  summary.innerHTML = `<span class="mistake-create-file-icon">📎</span><div><strong>${escapeHtml(pendingUploadFile.name)}</strong><small>${escapeHtml(pendingUploadFile.type || '附件')} · 保存后上传</small></div>`;
  summary.style.display = 'flex';
  if (remove) remove.style.display = 'inline-flex';
  if (ocr) ocr.style.display = 'inline-flex';
}
function chooseMistakeCreateFile(input) {
  const file = input.files?.[0] || null;
  pendingUploadFile = file;
  if (file) {
    const nameInput = document.getElementById('tagPickerName');
    const extChip = document.getElementById('tagPickerNameExt');
    const nameTip = document.getElementById('tagPickerNameTip');
    const parts = splitNameExt(file.name || '');
    if (nameInput && !nameInput.value.trim()) nameInput.value = parts.base;
    if (extChip) {
      extChip.textContent = parts.ext || '';
      extChip.style.display = parts.ext ? 'inline-block' : 'none';
    }
    if (nameTip) nameTip.style.display = parts.ext ? 'block' : 'none';
  }
  renderMistakeCreateFileSummary();
}
function clearMistakeCreateFile() {
  pendingUploadFile = null;
  const input = document.getElementById('mistakeCreateQuestionUpload');
  if (input) input.value = '';
  const extChip = document.getElementById('tagPickerNameExt');
  if (extChip) { extChip.textContent = ''; extChip.style.display = 'none'; }
  const nameTip = document.getElementById('tagPickerNameTip');
  if (nameTip) nameTip.style.display = 'none';
  closeMistakeOcr();
  renderMistakeCreateFileSummary();
}

// ===== 答案附件：单独上传/识别，保存错题后一起提交 =====
let pendingAnswerFile = null;

function renderMistakeCreateAnswerFileSummary() {
  const summary = document.getElementById('mistakeCreateAnswerFileSummary');
  const remove = document.getElementById('mistakeCreateAnswerRemove');
  const ocr = document.getElementById('mistakeCreateAnswerOcrBtn');
  if (!summary) return;
  if (!pendingAnswerFile) {
    summary.style.display = 'none';
    summary.innerHTML = '';
    if (remove) remove.style.display = 'none';
    if (ocr) ocr.style.display = 'none';
    closeMistakeAnswerOcr();
    return;
  }
  summary.innerHTML = `<span class="mistake-create-file-icon">📎</span><div><strong>${escapeHtml(pendingAnswerFile.name)}</strong><small>${escapeHtml(pendingAnswerFile.type || '附件')} · 保存后上传</small></div>`;
  summary.style.display = 'flex';
  if (remove) remove.style.display = 'inline-flex';
  if (ocr) ocr.style.display = 'inline-flex';
}

function chooseMistakeAnswerFile(input) {
  pendingAnswerFile = input.files?.[0] || null;
  closeMistakeAnswerOcr();
  renderMistakeCreateAnswerFileSummary();
}

function clearMistakeAnswerFile() {
  pendingAnswerFile = null;
  const input = document.getElementById('mistakeCreateAnswerUpload');
  if (input) input.value = '';
  closeMistakeAnswerOcr();
  renderMistakeCreateAnswerFileSummary();
}

function closeMistakeAnswerOcr() {
  const panel = document.getElementById('mistakeCreateAnswerOcrPanel');
  const text = document.getElementById('mistakeCreateAnswerOcrText');
  const meta = document.getElementById('mistakeCreateAnswerOcrMeta');
  if (panel) panel.style.display = 'none';
  if (text) text.value = '';
  if (meta) meta.textContent = '';
}

async function recognizeMistakeAnswerFile() {
  if (!pendingAnswerFile) { showToast('请先选择答案附件'); return; }
  const button = document.getElementById('mistakeCreateAnswerOcrBtn');
  if (button?.disabled) return;
  const original = button ? button.textContent : '';
  if (button) { button.disabled = true; button.textContent = '识别中…'; }
  try {
    const result = await recognizeUploadedFile(pendingAnswerFile, (message) => {
      if (button) button.textContent = message;
    });
    const text = document.getElementById('mistakeCreateAnswerOcrText');
    const panel = document.getElementById('mistakeCreateAnswerOcrPanel');
    const meta = document.getElementById('mistakeCreateAnswerOcrMeta');
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
    showToast('识别完成，请校对后填入答案');
  } catch (err) {
    showToast(err.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = original; }
  }
}

function applyMistakeAnswerOcr() {
  const text = (document.getElementById('mistakeCreateAnswerOcrText')?.value || '').trim();
  if (!text) { showToast('识别结果为空'); return; }
  fillMistakeAnswerFromOcr(text);
}
function updateMistakeCreateContentClear() {
  const button = document.getElementById('mistakeCreateContentClear');
  const content = document.getElementById('mistakeCreateContent');
  if (button) button.style.display = content?.value.trim() ? 'inline-flex' : 'none';
}
function clearMistakeCreateContent() {
  const content = document.getElementById('mistakeCreateContent');
  if (content) content.value = '';
  updateMistakeCreateContentClear();
}
function updateMistakeCreateAnswerClear() {
  const button = document.getElementById('mistakeCreateAnswerClear');
  const choice = document.getElementById('mistakeCreateFormat')?.value === 'choice';
  const hasAnswer = choice
    ? !!document.querySelector('#mistakeCreateAnswerOptions input:checked')
    : !!document.getElementById('mistakeCreateAnswer')?.value.trim();
  if (button) button.style.display = hasAnswer ? 'inline-flex' : 'none';
}
function clearMistakeCreateAnswer() {
  const choice = document.getElementById('mistakeCreateFormat')?.value === 'choice';
  if (choice) {
    document.querySelectorAll('#mistakeCreateAnswerOptions input:checked').forEach(input => { input.checked = false; });
  } else {
    const answer = document.getElementById('mistakeCreateAnswer');
    if (answer) answer.value = '';
  }
  updateMistakeCreateAnswerClear();
}
function updateMistakeCreateExplanationClear() {
  const button = document.getElementById('mistakeCreateExplanationClear');
  const hasText = !!document.getElementById('mistakeCreateExplanation')?.value.trim();
  if (button) button.style.display = hasText ? 'inline-flex' : 'none';
}
function clearMistakeCreateExplanation() {
  const explanation = document.getElementById('mistakeCreateExplanation');
  if (explanation) explanation.value = '';
  updateMistakeCreateExplanationClear();
}
function updateMistakeCreateOcrActions() {
  const choice = document.getElementById('mistakeCreateFormat')?.value === 'choice';
  const toOptions = document.getElementById('mistakeCreateOcrToOptions');
  if (toOptions) toOptions.style.display = choice ? 'inline-flex' : 'none';
  updateMistakeCreateContentClear();
  updateMistakeCreateAnswerClear();
  updateMistakeCreateExplanationClear();
}
function closeMistakeOcr() {
  const panel = document.getElementById('mistakeCreateOcrPanel');
  const text = document.getElementById('mistakeCreateOcrText');
  const meta = document.getElementById('mistakeCreateOcrMeta');
  if (panel) panel.style.display = 'none';
  if (text) text.value = '';
  if (meta) meta.textContent = '';
}
// 浏览器端优先；file:// 打开、PDF、老浏览器这些情况回退服务端。
async function recognizeUploadedFile(file, onProgress) {
  try {
    return await recognizeTextInBrowser(file, onProgress);
  } catch (err) {
    const reason = err?.message || String(err);
    const intentional = err?.code === 'OCR_WEB_PDF';
    if (intentional) {
      onProgress?.('PDF 交由服务端识别…');
    } else {
      console.warn('浏览器端 OCR 不可用，回退服务端：', reason);
      const hint = err?.code === 'OCR_WEB_PROTOCOL' ? '当前是 file:// 打开的，浏览器端 OCR 不可用' : reason;
      showToast(`浏览器端不可用：${hint}`);
      onProgress?.('浏览器端不可用，改用服务端识别…');
    }
    const form = new FormData();
    form.append('file', file);
    const response = await requestApi(`${API}/ocr`, { method: 'POST', body: form });
    const result = await response.json();
    // 把回退原因留在校对面板的说明行里，别再被吞掉
    result.fallbackReason = reason;
    result.warnings = [...(result.warnings || []), intentional ? 'PDF 用服务端识别' : `浏览器端未使用：${reason}`];
    return result;
  }
}

function ocrProviderLabel(provider) {
  if (provider === 'browser') return '浏览器端';
  if (provider === 'paddle') return '服务端';
  return provider || '';
}

async function recognizeMistakeCreateFile() {
  if (!pendingUploadFile) { showToast('请先选择题目附件'); return; }
  const button = document.getElementById('mistakeCreateOcrBtn');
  if (button?.disabled) return;
  const original = button ? button.textContent : '';
  if (button) { button.disabled = true; button.textContent = '识别中…'; }
  try {
    const result = await recognizeUploadedFile(pendingUploadFile, (message) => {
      if (button) button.textContent = message;
    });
    const text = document.getElementById('mistakeCreateOcrText');
    const panel = document.getElementById('mistakeCreateOcrPanel');
    const meta = document.getElementById('mistakeCreateOcrMeta');
    if (text) text.value = result.text || '';
    if (panel) panel.style.display = 'grid';
    if (meta) {
      const parts = [];
      if (result.provider) parts.push(`识别来源：${ocrProviderLabel(result.provider)}`);
      if (Number.isFinite(result.confidence)) parts.push(`置信度 ${Math.round(result.confidence * 100)}%`);
      if (result.warnings?.length) parts.push(result.warnings.join('；'));
      meta.textContent = parts.join(' · ');
    }
    updateMistakeCreateOcrActions();
    if (result.provider === 'mock') {
      if (meta) meta.textContent = '⚠ 这是 mock 样例数据，不是真实识别。后端没走 OCR 服务，请检查 OCR_PROVIDER。';
      showToast('当前是 mock 样例数据，不是真实识别');
      return;
    }
    showToast('识别完成，请核对后再填入');
  } catch (err) {
    showToast(err.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = original; }
  }
}
// OCR 出来的是整页文字，塞进答案栏前先切出“答案：…”那一段。
function extractMistakeOcrAnswer(text) {
  const lines = String(text || '').normalize('NFKC').split('\n').map(line => line.trim()).filter(Boolean);
  const head = /^(?:正确答案|参考答案|答案|答)\s*[:：]\s*/;
  const stop = /^(?:解析|分析|说明|点评|考点|错因)\s*[:：]?/;
  const index = lines.findIndex(line => head.test(line));
  if (index === -1) return '';
  const picked = [];
  for (let i = index; i < lines.length; i += 1) {
    if (i > index && stop.test(lines[i])) break;
    picked.push(i === index ? lines[i].replace(head, '') : lines[i]);
  }
  return picked.join('\n').trim();
}

function applyMistakeOcr(target, mode = 'replace') {
  const text = (document.getElementById('mistakeCreateOcrText')?.value || '').trim();
  if (!text) { showToast('识别结果为空'); return; }
  const format = document.getElementById('mistakeCreateFormat')?.value || 'open';
  if (target === 'question') {
    const content = document.getElementById('mistakeCreateContent');
    if (!content) return;
    content.value = mode === 'append' && content.value.trim() ? `${content.value.trim()}\n\n${text}` : text;
    updateMistakeCreateContentClear();
    showToast(mode === 'append' ? '已追加到题干' : '已替换题干');
    return;
  }
  if (target === 'options') {
    if (format !== 'choice') return;
    const values = [];
    for (const rawLine of text.split('\n')) {
      // OCR 常输出全角字母、全角标点、（A）这类写法，先归一化再解析。
      const line = rawLine.normalize('NFKC');
      const match = line.match(/^\s*[（(]?\s*([A-Za-z])\s*(?:[）)]\s*|[.、,:：;；)）]\s*|\s+)(.+)$/);
      if (match) values.push(match[2].trim());
    }
    if (values.length < 2) { showToast('没有识别到 A./B./C. 形式的选项行，请手动校对'); return; }
    renderMistakeChoiceOptionRows('Create', values, []);
    showToast('已填入选项，请核对编号和内容');
    return;
  }
  // 答案走答案附件自己的识别面板，题目识别只负责题干和选项。
}

// 题目附件和答案附件共用这一套“填答案”逻辑。
function fillMistakeAnswerFromOcr(text) {
  const format = document.getElementById('mistakeCreateFormat')?.value || 'open';
  const answerText = extractMistakeOcrAnswer(text);
  const payload = answerText || text;
  if (format === 'choice') {
    const match = text.normalize('NFKC').match(/(?:正确答案|答案)\s*[：:]?\s*((?:[A-Za-z]\s*[,，、;；\s]*)+)/);
    if (!match) { showToast('没有识别到“答案：A”形式的字母'); return; }
    const ids = [...new Set((match[1].toUpperCase().match(/[A-Z]/g) || []))];
    const letters = choiceLetters(readMistakeChoiceOptionValues('Create').length);
    const valid = ids.filter(id => letters.includes(id));
    if (!valid.length) { showToast('答案字母不在当前选项中，请先填入选项'); return; }
    const type = document.getElementById('mistakeCreateChoiceType')?.value || 'single';
    renderMistakeChoiceAnswerOptions('Create', type === 'single' ? valid.slice(0, 1) : valid);
    updateMistakeCreateAnswerClear();
    showToast('已填入正确答案，请核对');
  } else {
    const answer = document.getElementById('mistakeCreateAnswer');
    if (answer) answer.value = payload;
    updateMistakeCreateAnswerClear();
    showToast(answerText ? '已填入答案（只取“答案：”之后的内容）' : '没有找到“答案：”标记，已填入整段识别文字');
  }
}
async function doCreateMistake(file, knowledgeIds, title, content) {
  const options = mistakeCreationFields();
  const fd = new FormData();
  if (file) fd.append('file', file);
  if (title) fd.append('title', title);
  fd.append('content', content || '');
  fd.append('knowledgeIds', JSON.stringify(knowledgeIds));
  for (const [key, value] of Object.entries(options)) {
    fd.append(key, key === 'options' || (key === 'correctOption' && Array.isArray(value))
      ? JSON.stringify(value) : value);
  }
  try {
    const response = await requestApi(`${API}/courses/${currentCourseId}/mistakes`, { method: 'POST', body: fd });
    const created = await response.json().catch(() => null);
    // 答案附件是独立接口：错题建好后再挂上去，失败不影响已保存的错题。
    let answerError = '';
    if (pendingAnswerFile && created?.id) {
      const answerForm = new FormData();
      answerForm.append('file', pendingAnswerFile);
      try {
        await requestApi(`${API}/courses/${currentCourseId}/mistakes/${created.id}/answer-file`, {
          method: 'PUT', body: answerForm,
        });
      } catch (err) {
        answerError = err.message;
      }
    }
    pendingAnswerFile = null;
    showToast(answerError
      ? `错题已保存，但答案附件上传失败：${answerError}`
      : (file ? '上传成功' : '已添加错题'));
    await loadMistakes();
    return created;
  } catch (err) {
    showToast(err.message || '保存失败，请重试');
    return false;
  }
}
async function doUploadMistake(file, knowledgeIds, title) {
  const content = document.getElementById('mistakeCreateContent')?.value || '';
  return doCreateMistake(file, knowledgeIds, title, content);
}
