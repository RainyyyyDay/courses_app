// 分类选择与固定队列；仅保存导航，不代替后端单题步骤/状态。
let mistakeSelection = null;
let mistakeQueue = null;
let mistakeQueueLoading = false;
let mistakeReviewPicker = null;
let mistakePickerPlacements = [];

function mountMistakePickerDetail() {
  if (mistakePickerPlacements.length) return;
  const host = document.getElementById('mistakeReviewPickerDetail');
  for (const id of ['mistakeFilters', 'mistakeSelectionHeader', 'mistakeList']) {
    const node = document.getElementById(id);
    const anchor = document.createComment(id + ' original position');
    node.before(anchor); host.appendChild(node);
    mistakePickerPlacements.push({ node, anchor });
  }
}
function dismissMistakeReviewPicker() {
  const selection = mistakeReviewPicker;
  document.getElementById('mistakeReviewPicker').classList.remove('show');
  document.body.classList.remove('mistake-review-open');
  for (const { node, anchor } of mistakePickerPlacements) anchor.replaceWith(node);
  mistakePickerPlacements = [];
  if (selection?.originUi && selection.courseId === currentCourseId) {
    mistakeUi = { ...selection.originUi, nodeIds: [...selection.originUi.nodeIds] };
    rememberMistakeUi();
  }
  mistakeReviewPicker = null;
}

async function enterMistakeReviewFromHome() {
  if (!currentCourseId || mistakeQueueLoading) return;
  if (!mistakeSelection?.mixed || mistakeSelection.courseId !== currentCourseId) {
    mistakeSelection = { courseId: currentCourseId, type: mistakeUi.type, mixed: true, ids: new Set(), catalog: [], listLoading: false };
  }
  const selection = mistakeSelection;
  if (!mistakeReviewPicker) {
    selection.originUi = { ...mistakeUi, nodeIds: [...mistakeUi.nodeIds] };
    selection.pickerType = null;
  }
  mistakeReviewPicker = selection;
  selection.pickerLoading = true;
  document.getElementById('mistakeReviewPicker').classList.add('show');
  document.body.classList.add('mistake-review-open');
  document.getElementById('mistakeReviewPickerError').textContent = '';
  renderMistakeReviewPicker();
  document.getElementById('mistakeReviewPickerTitle').focus();
  try {
    const rows = await requestList(`${API}/courses/${selection.courseId}/mistakes`);
    if (mistakeReviewPicker !== selection || currentCourseId !== selection.courseId) return;
    selection.catalog = rows;
    selection.pickerLoading = false;
    selection.listLoading = false;
    renderMistakeReviewPicker();
  } catch (err) {
    if (mistakeReviewPicker !== selection || currentCourseId !== selection.courseId) return;
    document.getElementById('mistakeReviewPickerError').textContent = err.message;
    document.getElementById('mistakeReviewPickerError').insertAdjacentHTML('beforeend', '<button onclick="enterMistakeReviewFromHome()">重试加载</button>');
  }
}
async function closeMistakeReviewPicker() {
  if (mistakeQueueLoading) return;
  dismissMistakeReviewPicker();
  await loadMistakes();
}
function renderMistakeReviewPicker() {
  const selection = mistakeReviewPicker;
  if (!selection || selection.courseId !== currentCourseId) return;
  const loading = selection.pickerLoading || mistakeQueueLoading;
  document.getElementById('mistakeReviewPickerTitle').textContent = selection.pickerType ? MISTAKE_TYPES[selection.pickerType] : '选择复习分类';
  document.getElementById('mistakeReviewPickerBack').style.display = selection.pickerType ? 'inline-block' : 'none';
  document.getElementById('mistakeReviewPickerCategories').style.display = selection.pickerType ? 'none' : 'block';
  document.getElementById('mistakeReviewPickerDetail').style.display = selection.pickerType ? 'block' : 'none';
  document.getElementById('mistakeReviewPickerRows').innerHTML = Object.entries(MISTAKE_TYPES).map(([type, name]) => {
    const all = selection.catalog.filter(row => row.course_id === selection.courseId && row.mistake_type === type);
    const eligible = all.filter(row => !mistakeCannotReview(row));
    const count = eligible.filter(row => selection.ids.has(row.id)).length;
    return `<div class="mistake-review-category"><button data-review-category="${type}" onclick="openMistakeReviewCategory('${type}')" ${loading ? 'disabled' : ''}>${name}<small>${selection.pickerLoading ? '加载中…' : `已选 ${count} / ${all.length} 道${all.length > eligible.length ? `；其中 ${all.length - eligible.length} 道需补齐内容` : ''}`}</small></button><label><input data-review-category-all="${type}" type="checkbox" ${count && count === eligible.length ? 'checked' : ''} ${loading || !eligible.length ? 'disabled' : ''} onchange="selectMistakeReviewCategory('${type}',this.checked)" />全选</label></div>`;
  }).join('');
  document.querySelectorAll('[data-review-category-all]').forEach(input => {
    const rows = selection.catalog.filter(row => row.mistake_type === input.dataset.reviewCategoryAll && !mistakeCannotReview(row));
    const count = rows.filter(row => selection.ids.has(row.id)).length;
    input.indeterminate = count > 0 && count < rows.length;
  });
  document.getElementById('mistakeReviewPickerCount').textContent = selection.ids.size;
  document.getElementById('mistakeReviewPickerStart').disabled = loading || selection.listLoading || !selection.ids.size;
}
function selectMistakeReviewCategory(type, checked) {
  const selection = mistakeReviewPicker;
  if (!selection || selection.courseId !== currentCourseId || selection.pickerLoading || mistakeQueueLoading || !Object.hasOwn(MISTAKE_TYPES, type)) return;
  for (const row of selection.catalog) {
    if (row.course_id !== selection.courseId || row.mistake_type !== type || mistakeCannotReview(row)) continue;
    if (checked) selection.ids.add(row.id); else selection.ids.delete(row.id);
  }
  renderMistakeReviewPicker(); updateMistakeSelectionControls();
}
async function openMistakeReviewCategory(type) {
  if (!mistakeReviewPicker || mistakeReviewPicker.courseId !== currentCourseId || mistakeReviewPicker.pickerLoading || mistakeQueueLoading || !Object.hasOwn(MISTAKE_TYPES, type)) return;
  mistakeReviewPicker.pickerType = type;
  mountMistakePickerDetail();
  renderMistakeReviewPicker();
  document.getElementById('mistakeReviewPickerBody').scrollTop = 0;
  await openMistakeCategory(type, true);
}
async function returnToMistakeReviewPicker() {
  if (!mistakeReviewPicker || mistakeQueueLoading) return;
  mistakeReviewPicker.pickerType = null;
  renderMistakeReviewPicker();
  document.getElementById('mistakeReviewPickerBody').scrollTop = 0;
}
async function openMistakeReviewRepair(id) {
  await closeMistakeReviewPicker();
  await openMistakeDetail(id, false);
}
function mistakeQueueTypeFor(id) {
  return mistakeQueue?.types?.[id] || mistakeQueue?.type;
}

function mistakeSelectionCurrent() {
  return mistakeSelection && (!mistakeSelection.mixed || mistakeReviewPicker === mistakeSelection)
    && mistakeSelection.courseId === currentCourseId && Object.hasOwn(MISTAKE_TYPES, mistakeUi.type) && mistakeSelection.type === mistakeUi.type;
}
function mistakeQueueCurrent(state = mistakeDetailState) {
  return mistakeQueue && !mistakeQueue.finished && state?.review && mistakeQueue.courseId === currentCourseId
    && mistakeQueue.ids[mistakeQueue.index] === state.id;
}
function mistakeCannotReview(row) {
  if (!String(row.answer_content || '').trim()) return '缺少参考答案';
  if (!String(row.content || '').trim() && !row.image_url && !String(row.ocr_text || '').trim()) return '缺少题目内容';
  return '';
}
function saveMistakeQueue() { mistakeStorageSet('mistake-queue:' + currentCourseId, mistakeQueue); }
function readMistakeQueue() {
  const saved = mistakeStorageGet('mistake-queue:' + currentCourseId);
  if (!saved || saved.courseId !== currentCourseId || !(Object.hasOwn(MISTAKE_TYPES, saved.type) || saved.type === 'mixed')
    || !Array.isArray(saved.ids) || !saved.ids.length || saved.ids.some(id => !Number.isSafeInteger(id) || id < 1)
    || new Set(saved.ids).size !== saved.ids.length || !Number.isInteger(saved.index) || saved.index < 0 || saved.index > saved.ids.length
    || !saved.rounds || typeof saved.rounds !== 'object' || Array.isArray(saved.rounds)) return null;
  if (saved.type === 'mixed' && (!saved.types || saved.ids.some(id => !Object.hasOwn(MISTAKE_TYPES, saved.types[id])))) return null;
  return saved;
}
function renderMistakeSelectionControls() {
  const header = document.getElementById('mistakeSelectionHeader');
  if (!header) return;
  const selecting = mistakeSelectionCurrent();
  const saved = readMistakeQueue();
  const homeResume = document.getElementById('mistakeHomeReviewResume');
  if (homeResume) homeResume.style.display = saved && !saved.finished ? 'inline-block' : 'none';
  // 复习入口只保留在「错题」大页（#mistakeHomeReview）：四个分类详情页不再出现任何复习按钮。
  // 这条工具条只服务于复习弹窗里挂载过来的那份分类详情：进入选择状态时显示，选完 / 关闭弹窗后隐藏。
  header.style.display = selecting ? 'flex' : 'none';
  header.className = 'mistake-toolbar';
  header.innerHTML = selecting
    ? '<label><input id="mistakeSelectAll" type="checkbox" onchange="selectAllVisibleMistakes(this.checked)" /> 全选当前筛选结果</label><button onclick="clearMistakeSelection()">清空已选</button>'
    : '';
  updateMistakeSelectionControls();
  renderMistakeReviewPicker();
}
function updateMistakeSelectionControls() {
  if (!mistakeSelectionCurrent()) return;
  const rows = currentMistakes.filter(row => !mistakeCannotReview(row));
  const count = rows.filter(row => mistakeSelection.ids.has(row.id)).length;
  const all = document.getElementById('mistakeSelectAll');
  if (all) {
    all.checked = rows.length > 0 && count === rows.length;
    all.indeterminate = count > 0 && count < rows.length;
    all.disabled = mistakeQueueLoading || mistakeSelection.listLoading || rows.length === 0;
  }
  document.querySelectorAll('#mistakeList .mistake-select-check').forEach(input => { input.checked = mistakeSelection.ids.has(Number(input.value)); });
  renderMistakeReviewPicker();
}
async function cancelMistakeSelection() {
  if (mistakeReviewPicker) await closeMistakeReviewPicker();
  mistakeSelection = null; await loadMistakes();
}
function clearMistakeSelection() {
  if (mistakeSelection?.courseId === currentCourseId && !mistakeQueueLoading) {
    mistakeSelection.ids.clear(); updateMistakeSelectionControls(); renderMistakeReviewPicker();
  }
}
function chooseMistake(id, checked) {
  if (!mistakeSelectionCurrent() || mistakeQueueLoading || mistakeSelection.listLoading) return;
  const row = currentMistakes.find(r => r.id === id);
  if (!row || mistakeCannotReview(row)) return;
  if (checked) mistakeSelection.ids.add(id); else mistakeSelection.ids.delete(id);
  updateMistakeSelectionControls();
}
function toggleMistakeCard(event, id) {
  if (event.target.closest('a,button,input,label')) return;
  chooseMistake(id, !mistakeSelection.ids.has(id));
}
function selectAllVisibleMistakes(checked) {
  if (!mistakeSelectionCurrent() || mistakeSelection.listLoading || mistakeQueueLoading) return;
  for (const row of currentMistakes) {
    if (mistakeCannotReview(row)) continue;
    if (checked) mistakeSelection.ids.add(row.id); else mistakeSelection.ids.delete(row.id);
  }
  updateMistakeSelectionControls();
}
async function startMistakeQueue() {
  // 选择集合只可能来自复习弹窗（跨分类，mixed）；分类详情页自己没有入口。
  if (!(mistakeSelectionCurrent() || mistakeReviewPicker && mistakeReviewPicker === mistakeSelection && mistakeSelection.courseId === currentCourseId)
    || !mistakeSelection.ids.size || mistakeQueueLoading || mistakeSelection.listLoading || mistakeReviewPicker?.pickerLoading) return;
  const selection = mistakeSelection;
  mistakeQueueLoading = true; updateMistakeSelectionControls(); renderMistakeReviewPicker();
  try {
    const rows = await requestList(`${API}/courses/${selection.courseId}/mistakes`);
    const selected = rows.filter(row => selection.ids.has(row.id)); // 全分类当前顺序（后端统一按 ID 升序），包含其他筛选下的已选题。
    if (selected.length !== selection.ids.size) throw new Error('部分已选题目已删除或改变分类，请清空已选后重新选择');
    for (const row of selected) {
      if (mistakeCannotReview(row)) throw new Error(`${row.title}：${mistakeCannotReview(row)}，请先补齐`);
      const p = await mistakeReviewRequest(`${API}/courses/${selection.courseId}/mistakes/${row.id}/review`);
      const expectedType = selection.catalog.find(item => item.id === row.id)?.mistake_type;
      if (!p.reviewable || p.courseId !== selection.courseId || p.mistakeType !== expectedType || !Object.hasOwn(MISTAKE_TYPES, p.mistakeType)) throw new Error(`${row.title}：当前无法复习，请先检查分类和答案`);
    }
    if (mistakeSelection !== selection || currentCourseId !== selection.courseId) return;
    mistakeQueue = { courseId: selection.courseId, type: 'mixed',
      types: Object.fromEntries(selected.map(row => [row.id, row.mistake_type])), ids: selected.map(row => row.id), index: 0, rounds: {}, finished: false };
    dismissMistakeReviewPicker();
    saveMistakeQueue(); mistakeSelection = null;
    await openMistakeDetail(mistakeQueue.ids[0], true);
  } catch (err) {
    if (mistakeReviewPicker) document.getElementById('mistakeReviewPickerError').textContent = err.message;
  } finally { mistakeQueueLoading = false; updateMistakeSelectionControls(); renderMistakeReviewPicker(); renderMistakeQueueBanner(); }
}
async function resumeMistakeQueue() {
  const saved = readMistakeQueue();
  if (!saved || saved.finished) return;
  mistakeQueue = saved; mistakeSelection = null;
  if (saved.index === saved.ids.length) { await showMistakeQueueComplete(); return; }
  await openMistakeDetail(saved.ids[saved.index], true);
}
async function prepareMistakeQueueItem(state) {
  if (!mistakeQueueCurrent(state) || !state.progress) return;
  const p = state.progress;
  if (p.courseId !== mistakeQueue.courseId || p.mistakeType !== mistakeQueueTypeFor(state.id) || !p.reviewable) {
    renderMistakeQueueBanner();
    return;
  }
  if (mistakeQueue.rounds[state.id] === undefined) {
    // completed 可能是以前的复习，必须新开一轮；未完成步骤则继续。
    mistakeQueue.rounds[state.id] = p.stage === 'idle' || p.stage === 'completed' ? p.round + 1 : p.round;
    saveMistakeQueue();
    if (p.allowedActions.includes('start')) await submitMistakeReview('start');
  }
  if (mistakeDetailIsCurrent(state) && mistakeQueueCurrent(state)) renderMistakeReview(state);
  // 最后一题在进来之前就判完了（比如中途暂停过）：同样直接收尾。
  await tryFinishMistakeQueue(state, state.progress);
}

// 复习队列的最后一题判完就该结束了：不需要用户再点按钮，自动弹完成弹窗。
let mistakeQueueAutoFinishing = false;
function mistakeQueueShouldAutoFinish(state, progress) {
  if (!mistakeQueue || !mistakeQueueCurrent(state) || !progress) return false;
  if (mistakeQueue.index !== mistakeQueue.ids.length - 1) return false;
  return progress.stage === 'completed'
    && progress.round === mistakeQueue.rounds[state.id]
    && progress.reviewable
    && progress.mistakeType === mistakeQueueTypeFor(state.id);
}
async function tryFinishMistakeQueue(state, progress) {
  // 布尔锁：收尾过程中触发的重渲染不会再进来一次，失败也不会反复重试。
  if (mistakeQueueAutoFinishing || !mistakeQueueShouldAutoFinish(state, progress)) return;
  mistakeQueueAutoFinishing = true;
  try { await nextMistakeQueueItem(); } finally { mistakeQueueAutoFinishing = false; }
}
function renderMistakeQueueBanner() {
  const box = document.getElementById('mistakeQueueBanner');
  if (!box) return;
  const state = mistakeDetailState;
  box.style.display = mistakeQueueCurrent(state) ? 'block' : 'none';
  if (!mistakeQueueCurrent(state)) return;
  const p = state.progress;
  const valid = p?.reviewable && p.courseId === mistakeQueue.courseId && p.mistakeType === mistakeQueueTypeFor(state.id);
  const completed = valid && p.stage === 'completed' && p.round === mistakeQueue.rounds[state.id];
  const pending = mistakeStorageGet(mistakePendingKey(state)) || state.pending;
  // 最后一题不再有「下一题 / 完成」按钮：判完自动收尾。
  const last = mistakeQueue.index + 1 === mistakeQueue.ids.length;
  box.innerHTML = `<strong>第 ${mistakeQueue.index + 1} / ${mistakeQueue.ids.length} 题</strong> · 已完成 ${mistakeQueue.index + (completed ? 1 : 0)} 题
    <div class="mistake-toolbar">${last ? '' : `<button id="mistakeQueueNext" onclick="nextMistakeQueueItem()" ${!completed || pending || mistakeReviewBusy || mistakeQueueLoading ? 'disabled' : ''}>下一题</button>`}<button onclick="pauseMistakeQueue()">返回列表，稍后继续</button><button onclick="endMistakeQueue()">结束本轮</button></div>${p && !valid ? '<p class="mistake-inline-error">本题已改变分类或缺少内容，请退出并补齐；不会自动跳过。</p>' : ''}`;
}
async function nextMistakeQueueItem() {
  const state = mistakeDetailState;
  if (!mistakeQueueCurrent(state) || mistakeReviewBusy || mistakeQueueLoading) return;
  mistakeQueueLoading = true;
  try {
    const p = await mistakeReviewRequest(mistakeReviewUrl(state));
    if (!mistakeDetailIsCurrent(state)) return;
    state.progress = p;
    if (!p.reviewable || p.courseId !== mistakeQueue.courseId || p.stage !== 'completed' || p.round !== mistakeQueue.rounds[state.id] || p.mistakeType !== mistakeQueueTypeFor(state.id)
      || mistakeStorageGet(mistakePendingKey(state)) || state.pending) throw new Error('请先完成并确认本题复习');
    mistakeQueue.index += 1; saveMistakeQueue();
    if (mistakeQueue.index === mistakeQueue.ids.length) {
      mistakeQueue.finished = true; saveMistakeQueue(); await showMistakeQueueComplete();
    } else {
      currentView = { type: 'mistake', id: mistakeQueue.ids[mistakeQueue.index], review: true };
      await renderMistakeDetailPage(currentView.id, true);
    }
  } catch (err) { showToast(err.message); }
  finally { mistakeQueueLoading = false; renderMistakeQueueBanner(); }
}
function showMistakeQueueComplete() {
  showPageOnly('mistakeDetailPage');
  currentView = { type: 'mistakeQueueComplete' };
  document.getElementById('mistakeDetailTitle').textContent = '本轮复习完成';
  document.getElementById('mistakeDetailBody').style.display = 'none';
  forgetMistakeDetailLocation();
  return openMistakeCompleteModal();
}

// ===== 复习完成弹窗 =====
// 过完全部所选题后弹出：正确率 100% 飘彩带 + 恭喜；三个去向 —— 取消（回错题大页）/ 再来一遍 / 开始新复习。
function mistakeConfettiHtml() {
  // 尊重系统「减少动态效果」偏好：关掉动画就什么都不放。
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return '';
  const colors = ['#f7c948', '#ef6f5a', '#4a6cf7', '#38b6d9', '#f2a33c', '#7d5fe0', '#2fbf71'];
  // 三条波浪/卷曲的彩带路径，随机挑一条，配随机长度和角度。
  const paths = [
    'M12 2 C 34 26, -10 44, 12 68 C 34 92, -10 110, 12 134 C 28 152, 0 160, 12 172',
    'M12 2 C -8 24, 32 40, 12 62 C -8 84, 32 100, 12 122 C -4 140, 24 152, 12 172',
    'M12 2 C 30 18, -6 34, 12 52 C 30 70, -6 86, 12 104 C 30 122, -6 138, 12 156 C 24 166, 4 170, 12 172'
  ];
  let html = '';
  for (let i = 0; i < 14; i += 1) {
    const color = colors[i % colors.length];
    const left = Math.round(-4 + Math.random() * 104);
    const delay = (Math.random() * 0.5).toFixed(2);
    const duration = (1.9 + Math.random() * 1.1).toFixed(2);
    const drift = Math.round(-80 + Math.random() * 160);
    const spin = Math.round(-300 + Math.random() * 600);
    const tilt = Math.round(-30 + Math.random() * 60);
    const width = 16 + Math.round(Math.random() * 10);
    const height = 160 + Math.round(Math.random() * 140);
    html += `<span class="mistake-streamer" style="left:${left}%;--drift:${drift}px;--spin:${spin}deg;--tilt:${tilt}deg;animation-delay:${delay}s;animation-duration:${duration}s">`
      + `<svg viewBox="0 0 24 174" width="${width}" height="${height}" aria-hidden="true"><path d="${paths[i % paths.length]}" fill="none" stroke="${color}" stroke-width="6.5" stroke-linecap="round"/></svg></span>`;
  }
  for (let i = 0; i < 34; i += 1) {
    const left = Math.round(Math.random() * 100);
    const delay = (Math.random() * 0.5).toFixed(2);
    const duration = (1.5 + Math.random() * 0.9).toFixed(2);
    const drift = Math.round(-60 + Math.random() * 120);
    const spin = Math.round(-540 + Math.random() * 1080);
    html += `<span class="mistake-bit" style="left:${left}%;background:${colors[(i + 3) % colors.length]};--drift:${drift}px;--spin:${spin}deg;animation-delay:${delay}s;animation-duration:${duration}s"></span>`;
  }
  return html;
}
// 这一轮的正确率：每题判断后的最终状态就是答案（「正确 / 已掌握」= 已复习）。
async function mistakeQueueRoundScore() {
  const ids = mistakeQueue?.ids || [];
  if (!ids.length) return null;
  try {
    const rows = await requestList(`${API}/courses/${mistakeQueue.courseId}/mistakes`);
    const reviewed = new Set(rows.filter(row => row.review_status === 'reviewed').map(row => row.id));
    return { correct: ids.filter(id => reviewed.has(id)).length, total: ids.length };
  } catch { return null; }
}
async function openMistakeCompleteModal() {
  const box = document.getElementById('mistakeCompleteModal');
  if (!box) return;
  const score = await mistakeQueueRoundScore();
  const perfect = !!score && score.correct === score.total;
  document.getElementById('mistakeCompleteTitle').textContent = perfect ? '恭喜你！你成功复习了所有所选题' : '本轮复习完成';
  document.getElementById('mistakeCompleteText').textContent = score
    ? `本轮 ${score.total} 道题，答对 ${score.correct} 道，正确率 ${Math.round(score.correct / score.total * 100)}%。${perfect ? '' : '答错或不记得的题目仍为未复习，可以再来一遍。'}`
    : '判断结果已保存。答错或不记得的题目仍为未复习。';
  const confetti = document.getElementById('mistakeCompleteConfetti');
  if (!confetti.dataset.bound) {
    // 飘出屏幕的碎片自己移除，别在页面上留一堆动画节点。
    confetti.addEventListener('animationend', event => { if (event.target.parentNode === confetti) event.target.remove(); });
    confetti.dataset.bound = '1';
  }
  confetti.innerHTML = perfect ? mistakeConfettiHtml() : '';
  box.classList.add('show');
  document.body.classList.add('mistake-review-open');
  document.getElementById('mistakeCompleteTitle').focus();
}
function closeMistakeCompleteModal() {
  const box = document.getElementById('mistakeCompleteModal');
  if (!box || !box.classList.contains('show')) return;
  box.classList.remove('show');
  document.body.classList.remove('mistake-review-open');
  document.getElementById('mistakeCompleteConfetti').innerHTML = '';
}
async function cancelMistakeComplete() {
  closeMistakeCompleteModal();
  await pauseMistakeQueue();
}
async function replayMistakeQueue() {
  if (!mistakeQueue || mistakeReviewBusy || mistakeQueueLoading) return;
  closeMistakeCompleteModal();
  mistakeQueue.index = 0;
  mistakeQueue.rounds = {};
  mistakeQueue.finished = false;
  saveMistakeQueue();
  navStack = [];
  await openMistakeDetail(mistakeQueue.ids[0], true);
}
async function startNewMistakeReview() {
  if (mistakeReviewBusy || mistakeQueueLoading) return;
  closeMistakeCompleteModal();
  await pauseMistakeQueue();
  await enterMistakeReviewFromHome();
}
async function pauseMistakeQueue() {
  if (mistakeReviewBusy) return;
  closeMistakeCompleteModal();
  forgetMistakeDetailLocation();
  ensureMistakeUi();
  if (mistakeQueue?.courseId === currentCourseId) { mistakeUi.type = mistakeQueue.type === 'mixed' ? null : mistakeQueue.type; rememberMistakeUi(); }
  mistakeQueue = null;
  navStack = []; currentView = { type: 'course', tab: 'mistakes' };
  showPageOnly('detailPage'); switchTab('mistakes');
}
async function endMistakeQueue() {
  if (mistakeReviewBusy) return;
  mistakeStorageSet('mistake-queue:' + currentCourseId, null); mistakeQueue = null;
  await pauseMistakeQueue();
}
