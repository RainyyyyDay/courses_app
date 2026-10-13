/* 单题详情、编辑和复习。复习状态与步骤始终以后端响应为准。 */
let mistakeDetailState = null;
let mistakeDetailRequest = 0;
let mistakeReviewBusy = false;

async function openMistakeDetail(mistakeId, review = false) {
  navStack.push(currentView);
  currentView = { type: 'mistake', id: mistakeId, review };
  await renderMistakeDetailPage(mistakeId, review);
}
function forgetMistakeDetailLocation() { mistakeStorageSet('mistake-detail:' + currentCourseId, null); }
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
  const state = { id: mistakeId, courseId, review, row: null, progress: null };
  mistakeDetailState = state;
  showPageOnly('mistakeDetailPage');
  const detailBody = document.getElementById('mistakeDetailBody');
  if (detailBody) detailBody.style.display = 'block';
  const complete = document.getElementById('mistakeQueueComplete');
  if (complete) complete.style.display = 'none';
  if (typeof renderMistakeQueueBanner === 'function') renderMistakeQueueBanner();
  mistakeStorageSet('mistake-detail:' + courseId, { id: mistakeId, review,
    queue: typeof mistakeQueueCurrent === 'function' && !!mistakeQueueCurrent(state) });
  document.getElementById('mistakeDetailTitle').textContent = review ? '错题复习' : '错题详情';
  document.getElementById('mistakeDetailName').textContent = '加载中…';
  document.getElementById('mistakeDetailMeta').textContent = '';
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
  document.getElementById('mistakeReviewToggle').disabled = true;
  try {
    const res = await requestApi(`${API}/mistakes/${mistakeId}`);
    const row = await res.json();
    if (request !== mistakeDetailRequest || !mistakeDetailIsCurrent(state)) return;
    if (row.course_id !== courseId) throw new Error('这道错题不属于当前课程');
    state.row = row;
    renderMistakeDetail(row, review);
    document.getElementById('mistakeReviewToggle').disabled = false;
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
  document.getElementById('mistakeDetailTitle').textContent = review ? '错题复习' : '错题详情';
  document.getElementById('mistakeDetailName').textContent = mistake.title || '（无标题）';
  document.getElementById('mistakeDetailMeta').textContent =
    `${MISTAKE_TYPES[mistake.mistake_type] || '待分类'} · ${mistakeStatusText(mistake.review_status)}${mistake.favorite ? ' · ★ 已收藏' : ''} · ${mistake.created_at || ''}`;
  const tags = Array.isArray(mistake.knowledge) ? mistake.knowledge : [];
  document.getElementById('mistakeDetailTags').innerHTML = tags.length
    ? tags.map(k => tagChipHtml(k, false, true)).join('') : '<span class="tag-none">暂无标签</span>';
  document.getElementById('mistakeReviewToggle').textContent = review ? '查看 / 编辑资料' : '进入复习';
  document.getElementById('mistakeReadPanel').style.display = review ? 'none' : 'block';
  document.getElementById('mistakeReviewPanel').style.display = review ? 'block' : 'none';
  document.getElementById('mistakeEditor').open = false;
  document.getElementById('mistakeEditError').textContent = '';
  if (!review) {
    document.getElementById('mistakeAnswerText').textContent = mistake.answer_content || '尚未填写答案';
    document.getElementById('mistakeExplanationText').textContent = mistake.explanation || '尚未填写解析或错误原因';
    document.getElementById('mistakeEditTitle').value = mistake.title;
    document.getElementById('mistakeEditType').value = mistake.mistake_type || 'unclassified';
    document.getElementById('mistakeEditContent').value = mistake.content || '';
    document.getElementById('mistakeEditAnswer').value = mistake.answer_content || '';
    document.getElementById('mistakeEditExplanation').value = mistake.explanation || '';
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
    fileBox.innerHTML = `<a class="detail-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">打开题目附件</a>`;
    return;
  }
  img.onerror = () => { img.style.display = 'none'; errBox.style.display = 'block'; };
  img.style.display = 'block'; img.src = url;
}

async function saveMistakeDetail() {
  const state = mistakeDetailState;
  const button = document.getElementById('mistakeEditSave');
  if (!state?.row || button.disabled) return;
  const body = {
    title: document.getElementById('mistakeEditTitle').value.trim(),
    content: document.getElementById('mistakeEditContent').value,
    mistakeType: document.getElementById('mistakeEditType').value,
    answerContent: document.getElementById('mistakeEditAnswer').value,
    explanation: document.getElementById('mistakeEditExplanation').value,
    expectedRevision: state.row.review_revision
  };
  if (!body.title) { showToast('请输入标题'); return; }
  button.disabled = true;
  document.getElementById('mistakeEditError').textContent = '';
  try {
    await requestApi(`${API}/courses/${state.courseId}/mistakes/${state.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!mistakeDetailIsCurrent(state)) return;
    // 实质编辑会使旧的未确认复习请求失效，不能再发送旧步骤。
    mistakeStorageSet('mistake-pending:' + state.courseId + ':' + state.id, null);
    showToast('已保存');
    await renderMistakeDetailPage(state.id, false);
  } catch (err) {
    if (mistakeDetailIsCurrent(state)) document.getElementById('mistakeEditError').textContent = err.message + '；输入已保留。';
  } finally { button.disabled = false; }
}
async function editMistakeDetailTags() {
  const row = mistakeDetailState?.row;
  if (!row) return;
  currentMistakes = currentMistakes.filter(r => r.id !== row.id).concat(row);
  await openTagPicker('edit', 'mistake', row.id);
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
function mistakePendingKey(state) { return 'mistake-pending:' + state.courseId + ':' + state.id; }
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

function renderMistakeReview(state) {
  const p = state.progress;
  const panel = document.getElementById('mistakeReviewPanel');
  const pending = mistakeStorageGet(mistakePendingKey(state)) || state.pending;
  const reasons = { missing_answer: '请先补充参考答案', missing_question: '请先补充题目文字或附件' };
  const usesMastered = ['thinking', 'unclassified'].includes(p.mistakeType);
  document.getElementById('mistakeDetailMeta').textContent = `${MISTAKE_TYPES[p.mistakeType]} · ${mistakeStatusText(p.reviewStatus)} · 第 ${p.round} 轮`;
  let message = '';
  let actions = '';
  function button(text, action, key, value) {
    return `<button type="button" data-review-action="${key ? action + '-' + String(value) : action}" onclick="submitMistakeReview('${action}'${key ? ", '" + key + "', " + JSON.stringify(value).replace(/"/g, "'") : ''})">${text}</button>`;
  }
  if (!p.reviewable) {
    message = (p.blockedReasons || []).map(r => reasons[r] || r).join('；');
    actions = '<button onclick="toggleMistakeReviewMode()">补齐内容</button>';
  } else if (p.stage === 'idle') {
    message = '先看题目，开始本轮复习。'; actions = button('开始复习', 'start');
  } else if (p.stage === 'question' && p.mistakeType === 'knowledge') {
    message = '你对这道题的记忆程度是？';
    actions = button('清楚', 'recall', 'recall', 'clear') + button('模糊', 'recall', 'recall', 'vague') + button('不记得', 'recall', 'recall', 'forgotten');
  } else if (p.stage === 'question') {
    message = p.mistakeType === 'unclassified' ? '请先自行回忆或重新解题，再查看答案。'
      : usesMastered ? '请先重新思考或解题，再对照答案。' : '请先重新做题，再对照答案和错误原因。';
    actions = button('查看答案和解析', 'reveal_answer');
  } else if (p.stage === 'answer') {
    if (usesMastered) {
      message = '对照答案后，是否已经掌握？';
      actions = button('已掌握', 'judge', 'mastered', true) + button('仍需复习', 'judge', 'mastered', false);
    } else {
      message = '对照答案后，你的判断是？';
      actions = button('正确', 'judge', 'correct', true) + button('错误', 'judge', 'correct', false);
    }
  } else {
    message = p.recall === 'forgotten' ? '已记录“不记得”，这道题仍为未复习。' : `本轮已保存：${mistakeStatusText(p.reviewStatus)}。`;
    actions = typeof mistakeQueueCurrent === 'function' && mistakeQueueCurrent(state) && p.round === mistakeQueue.rounds[state.id]
      ? '' : button('再次复习', 'start');
  }
  // 队列新开一轮时，不短暂展示上次已完成复习的答案。
  const answerVisible = p.answerVisible && (typeof mistakeQueueCurrent !== 'function' || !mistakeQueueCurrent(state)
    || p.round === mistakeQueue.rounds[state.id]);
  panel.innerHTML = `<p>${escapeHtml(message)}</p>${answerVisible && p.answer ?
    `<h2>参考答案</h2><div id="mistakeReviewAnswer" class="detail-content">${escapeHtml(p.answer.content || '')}</div><h2>解析 / 错误原因</h2><div class="detail-content">${escapeHtml(p.answer.explanation || '暂无解析或错误原因')}</div>` : ''}
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
}

async function submitMistakeReview(action, key, value) {
  const state = mistakeDetailState;
  if (!state?.progress || mistakeReviewBusy || !state.progress.allowedActions.includes(action)) return;
  if (typeof mistakeQueueCurrent === 'function' && mistakeQueueCurrent(state)
    && (state.progress.mistakeType !== mistakeQueueTypeFor(state.id) || !state.progress.reviewable)) return;
  if (mistakeStorageGet(mistakePendingKey(state)) || state.pending) return;
  if (action === 'start' && typeof mistakeQueueCurrent === 'function' && mistakeQueueCurrent(state)) {
    mistakeQueue.rounds[state.id] = state.progress.round + 1;
    saveMistakeQueue();
  }
  const requestId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2);
  const body = { action, requestId, expectedVersion: state.progress.version };
  if (key) body[key] = value;
  const pending = { body, start: action === 'start' };
  mistakeStorageSet(mistakePendingKey(state), pending);
  state.pending = pending; // localStorage 不可用时，仍能在当前页面重试。
  await sendMistakeReview(state, pending);
}
async function retryMistakeReview() {
  const state = mistakeDetailState;
  const pending = state && (mistakeStorageGet(mistakePendingKey(state)) || state.pending);
  if (pending && !mistakeReviewBusy) await sendMistakeReview(state, pending);
}
async function sendMistakeReview(state, pending) {
  mistakeReviewBusy = true;
  if (mistakeDetailIsCurrent(state)) renderMistakeReview(state);
  try {
    const progress = await mistakeReviewRequest(mistakeReviewUrl(state) + (pending.start ? '' : '/events'), pending.body);
    mistakeStorageSet(mistakePendingKey(state), null); state.pending = null;
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
  }
}
