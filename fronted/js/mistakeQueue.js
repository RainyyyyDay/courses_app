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
  if (!String(row.answer_content || '').trim() && !row.answer_image_url) return '缺少参考答案';
  if (!String(row.content || '').trim() && !row.image_url && !String(row.ocr_text || '').trim()) return '缺少题目内容';
  return '';
}
function saveMistakeQueue() { mistakeStorageSet(mistakeQueue?.storageKey || 'mistake-queue:' + currentCourseId, mistakeQueue); }
function readMistakeQueue(storageKey = 'mistake-queue:' + currentCourseId) {
  const saved = mistakeStorageGet(storageKey);
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
  // 计划仍 pending 而题目已完成，说明完成来自其他入口；需实际再复习，不能抵扣计划。
  if (mistakeQueue.planContext && p.stage === 'completed') delete mistakeQueue.rounds[state.id];
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
  if (mistakeQueue?.planContext) return returnFromPlanReview();
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
  const colors = ['#f7c948', '#ef6f5a', '#4a6cf7', '#38b6d9', '#f2a33c', '#7d5fe0', '#2fbf71', '#f5f0d8'];
  const num = (min, max) => min + Math.random() * (max - min);
  const int = (min, max) => Math.round(num(min, max));
  const pick = list => list[Math.floor(Math.random() * list.length)];

  // 每条彩带都是现算的波浪线：段数、振幅、左右起手都随机；三分之一再挂一个小圈，
  // 所以不会出现两条一样的、也不会是「一根直条」的僵硬化形状。
  function streamerPath(height) {
    const mid = 26;
    // 段数少一点、振幅大一点：出来是长而缓的波浪，不是密密的锯齿。
    const segs = int(2, 3);
    const amp = num(12, 24);
    const step = (height - 8) / segs;
    let dir = Math.random() < 0.5 ? 1 : -1;
    let y = 4;
    let d = `M ${mid} ${y}`;
    for (let i = 0; i < segs; i += 1) {
      const next = y + step;
      const bend = dir * amp * num(1.2, 2);
      d += ` C ${(mid + bend).toFixed(1)} ${(y + step * num(0.2, 0.35)).toFixed(1)},`
        + ` ${(mid - bend).toFixed(1)} ${(y + step * num(0.65, 0.8)).toFixed(1)},`
        + ` ${mid} ${next.toFixed(1)}`;
      y = next;
      dir = -dir;
    }
    if (Math.random() < 0.25) {
      // 在中间缠一个圈，像纸带打卷。
      const cy = 4 + step * Math.round(num(1, segs - 1));
      const r = num(9, 14);
      d += ` M ${(mid - r).toFixed(1)} ${cy.toFixed(1)} a ${r.toFixed(1)} ${r.toFixed(1)} 0 1 1 ${(r * 2).toFixed(1)} 0`
        + ` a ${r.toFixed(1)} ${r.toFixed(1)} 0 1 1 -${(r * 2).toFixed(1)} 0`;
    }
    return d;
  }

  let html = '';

  for (let i = 0; i < 12; i += 1) {
    const height = 200;
    const d = streamerPath(height);
    const color = pick(colors);
    const accent = pick(colors.filter(c => c !== color));
    const left = Math.round(-6 + Math.random() * 106);
    const delay = num(0, 0.5).toFixed(2);
    const duration = num(1.9, 3).toFixed(2);
    const drift = int(-90, 90);
    const spin = int(-70, 70);
    const tilt = int(-40, 40);
    // 渲染高度决定长度：彩带按 52:200 的比例缩放，细长一条。
    const h = int(190, 330);
    const w = Math.round(h * 0.26);
    // 第二遍描边用 dash 断成几段，做出参考图里那种一段黄一段蓝的彩带。
    html += `<span class="mistake-streamer" style="left:${left}%;--drift:${drift}px;--spin:${spin}deg;--tilt:${tilt}deg;`
      + `--amp:${int(5, 16)}px;--sway:${int(8, 26)}deg;--flutter:${num(1, 1.8).toFixed(2)}s;--flutter-delay:${num(0, 0.4).toFixed(2)}s;`
      + `animation-delay:${delay}s;animation-duration:${duration}s">`
      + `<svg viewBox="0 0 52 ${height}" width="${w}" height="${h}" aria-hidden="true">`
      + `<path d="${d}" fill="none" stroke="${color}" stroke-width="4.2" stroke-linecap="round"/>`
      + `<path d="${d}" fill="none" stroke="${accent}" stroke-width="4.2" stroke-linecap="round" stroke-dasharray="${int(70, 150)} ${int(170, 320)}" stroke-dashoffset="${int(0, 140)}"/>`
      + `</svg></span>`;
  }

  // 小碎片：方的、细长条、圆的都有，落的过程中自己翻面。
  const shapes = [
    { w: 7, h: 14, r: '1.5px' },
    { w: 4, h: 16, r: '2px' },
    { w: 9, h: 9, r: '2px' },
    { w: 8, h: 8, r: '50%' }
  ];
  for (let i = 0; i < 24; i += 1) {
    const shape = pick(shapes);
    const left = Math.round(Math.random() * 100);
    const delay = num(0, 0.55).toFixed(2);
    const duration = num(1.4, 2.4).toFixed(2);
    const drift = int(-70, 70);
    const spin = int(-540, 540);
    const tilt = int(-60, 60);
    html += `<span class="mistake-bit" style="left:${left}%;background:${pick(colors)};--drift:${drift}px;--spin:${spin}deg;--tilt:${tilt}deg;`
      + `--w:${shape.w}px;--h:${shape.h}px;--r:${shape.r};--tumble:${num(0.5, 0.9).toFixed(2)}s;`
      + `animation-delay:${delay}s;animation-duration:${duration}s"><i></i></span>`;
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
  if (mistakeQueue?.planContext) { forgetMistakeDetailLocation(); return returnFromPlanReview(); }
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
  if (mistakeQueue?.planContext) {
    mistakeStorageSet(mistakeQueue.storageKey,null); forgetMistakeDetailLocation(); return returnFromPlanReview();
  }
  mistakeStorageSet('mistake-queue:' + currentCourseId, null); mistakeQueue = null;
  await pauseMistakeQueue();
}
