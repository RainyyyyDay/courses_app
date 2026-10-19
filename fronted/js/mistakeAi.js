/* 复用错题本地存储保存最终复习方式；不写库、不映射 mistake_type。 */
let mistakeAiState = null;
const mistakeAiElement = name => document.getElementById('mistakeAi' + name);
const mistakeAiStorageKey = detail => 'mistake-ai-method:' + detail.courseId + ':' + detail.id;

function readMistakeAiMethod(detail) {
  const saved = mistakeStorageGet(mistakeAiStorageKey(detail));
  return saved?.version === 1 && typeof saved.method === 'string'
    && Object.hasOwn(AI_REVIEW_METHODS, saved.method) ? saved.method : null;
}

function mistakeAiSavedText(detail) {
  const method = readMistakeAiMethod(detail);
  return method ? '已保存的 AI 复习建议：' + AI_REVIEW_METHODS[method] : '暂无已保存的 AI 复习建议';
}

function mistakeAiSavedHtml(courseId, id) {
  return `<span class="mistake-ai-saved" data-ai-course="${Number(courseId)}" data-ai-mistake="${Number(id)}">${mistakeAiSavedText({courseId, id})}</span>`;
}

function refreshMistakeAiSaved() {
  document.querySelectorAll('[data-ai-course][data-ai-mistake]').forEach(node => {
    node.textContent = mistakeAiSavedText({courseId:Number(node.dataset.aiCourse), id:Number(node.dataset.aiMistake)});
  });
}

function openMistakeAiFromList(id, trigger = document.activeElement) {
  const row = currentMistakes.find(item => item.id === id && item.course_id === currentCourseId);
  if (!row) return;
  resetMistakeAi();
  const dialog = document.getElementById('mistakeAiDialog');
  document.getElementById('mistakeAiDialogBody').append(mistakeAiElement('Panel'));
  document.getElementById('mistakeAiDialogFoot').append(mistakeAiElement('Actions'));
  startMistakeAi({courseId:currentCourseId, id, row, review:false}, {source:'list', view:currentView, trigger});
  document.getElementById('mistakeAiDialogQuestionTitle').textContent = row.title || '无标题';
  dialog.showModal();
  document.getElementById('mistakeAiDialogTitle').focus({preventScroll:true});
  document.getElementById('mistakeAiDialogBody').scrollTop = 0;
}

function resetMistakeAi() {
  const trigger = mistakeAiState?.trigger;
  mistakeAiState?.controller?.abort();
  mistakeAiState = null;
  const panel = mistakeAiElement('Panel');
  if (!panel) return;
  panel.hidden = true;
  panel.setAttribute('aria-busy', 'false');
  mistakeAiElement('Toggle').setAttribute('aria-expanded', 'false');
  mistakeAiElement('Form').reset();
  mistakeAiElement('Inputs').disabled = false;
  mistakeAiElement('Submit').disabled = false;
  mistakeAiElement('Submit').textContent = '获取 AI 建议';
  mistakeAiElement('Result').hidden = true;
  mistakeAiElement('Confirm').disabled = true;
  mistakeAiElement('Method').disabled = false;
  for (const name of ['Status', 'Error', 'Suggested', 'Reason', 'Confirmation']) mistakeAiElement(name).textContent = '';
  mistakeAiElement('Confirmation').classList.remove('mistake-inline-error');
  const dialog = document.getElementById('mistakeAiDialog');
  if (dialog?.open) dialog.close();
  if (dialog?.contains(mistakeAiElement('Actions'))) mistakeAiElement('ActionsHome').after(mistakeAiElement('Actions'));
  if (dialog?.contains(panel)) document.getElementById('mistakeAiHome').after(panel);
  if (trigger?.isConnected) trigger.focus({preventScroll:true});
}

function mistakeAiIsCurrent(state) {
  return mistakeAiState === state && !state.detail.review && (state.source === 'list'
    ? currentCourseId === state.detail.courseId && currentView === state.view
    : mistakeDetailIsCurrent(state.detail));
}

function toggleMistakeAi() {
  if (!mistakeDetailState?.row || mistakeDetailState.review || !mistakeDetailIsCurrent(mistakeDetailState)) return;
  if (mistakeAiState) { resetMistakeAi(); return; }
  startMistakeAi(mistakeDetailState);
}

function startMistakeAi(detail, options = {}) {
  mistakeAiState = { detail, busy: false, result: null, controller: null, ...options };
  const row = detail.row;
  if (globalThis.COURSES_AI_LOCAL_MOCK) mistakeAiElement('Status').textContent = '本地 Mock 演示：按明确的错误原因返回固定规则建议，不调用真实模型。';
  // 不截断原文；超过契约限制时要求用户精简，不能静默丢失上下文。
  mistakeAiElement('Question').value = row.content || row.ocr_text || '';
  mistakeAiElement('CorrectAnswer').value = row.answer_content || '';
  const saved = readMistakeAiMethod(detail);
  if (saved) {
    mistakeAiState.savedMethod = saved;
    mistakeAiState.confirmedMethod = saved;
    mistakeAiElement('Method').value = saved;
    mistakeAiElement('Result').hidden = false;
    mistakeAiElement('Suggested').textContent = '本地已保存的最终选择：' + AI_REVIEW_METHODS[saved];
    mistakeAiElement('Status').textContent = '已恢复本浏览器的确认选择；可修改后重新确认。';
    mistakeAiElement('Confirmation').textContent = '已保存到本浏览器：' + AI_REVIEW_METHODS[saved] + '。刷新后可恢复；原错题分类未改变。';
  }
  mistakeAiElement('Panel').hidden = false;
  mistakeAiElement('Toggle').setAttribute('aria-expanded', 'true');
  mistakeAiElement('Confirm').disabled = !saved;
  if (options.source !== 'list') mistakeAiElement('Question').focus();
}

async function requestMistakeAi() {
  const state = mistakeAiState;
  if (!state || state.busy || !mistakeAiIsCurrent(state)) return;
  const input = {
    question: mistakeAiElement('Question').value.trim(),
    student_answer: mistakeAiElement('StudentAnswer').value.trim(),
    error_type: mistakeAiElement('ErrorType').value,
    correct_answer: mistakeAiElement('CorrectAnswer').value.trim(),
    context: mistakeAiElement('Context').value.trim()
  };
  mistakeAiElement('Error').textContent = '';
  if (!input.question || !input.student_answer || !input.error_type) {
    mistakeAiElement('Error').textContent = '请填写题目、学生作答并选择已明确的错误原因。';
    return;
  }
  state.busy = true;
  state.controller = new AbortController();
  mistakeAiElement('Inputs').disabled = true;
  mistakeAiElement('Submit').disabled = true;
  mistakeAiElement('Confirm').disabled = true;
  mistakeAiElement('Method').disabled = true;
  mistakeAiElement('Panel').setAttribute('aria-busy', 'true');
  mistakeAiElement('Status').textContent = '正在分类，请稍候…';
  try {
    const result = await classifyMistakeWithAi(input, { signal: state.controller.signal });
    if (!mistakeAiIsCurrent(state)) return;
    state.result = result;
    delete state.confirmedMethod;
    mistakeAiElement('Suggested').textContent = 'AI 建议：' + AI_REVIEW_METHODS[result.review_method];
    mistakeAiElement('Reason').textContent = '分类理由：' + result.reason;
    mistakeAiElement('Method').value = result.review_method;
    mistakeAiElement('Confirmation').textContent = '';
    mistakeAiElement('Result').hidden = false;
    mistakeAiElement('Status').textContent = '建议已生成，请人工复核。原错题分类未改变。';
  } catch (err) {
    if (!mistakeAiIsCurrent(state) || err.name === 'AbortError') return;
    mistakeAiElement('Error').textContent = err.message;
    mistakeAiElement('Status').textContent = state.result || state.savedMethod ? '本次请求失败，保留上一次建议或本地选择和原错题分类。' : '本次请求失败，原错题分类未改变。';
  } finally {
    if (mistakeAiIsCurrent(state)) {
      state.busy = false;
      state.controller = null;
      mistakeAiElement('Inputs').disabled = false;
      mistakeAiElement('Submit').disabled = false;
      mistakeAiElement('Submit').textContent = '重新获取 / 重试';
      mistakeAiElement('Confirm').disabled = !state.result && !state.savedMethod;
      mistakeAiElement('Method').disabled = false;
      mistakeAiElement('Panel').setAttribute('aria-busy', 'false');
    }
  }
}

function changeMistakeAiSuggestion() {
  if (mistakeAiState && mistakeAiIsCurrent(mistakeAiState) && !mistakeAiState.busy) {
    delete mistakeAiState.confirmedMethod;
    mistakeAiElement('Confirmation').classList.remove('mistake-inline-error');
    mistakeAiElement('Confirmation').textContent = '已修改本次建议，待确认；尚未保存。';
  }
}

function confirmMistakeAiSuggestion() {
  const state = mistakeAiState;
  if (!state || (!state.result && !state.savedMethod) || state.busy || !mistakeAiIsCurrent(state)) return;
  const method = mistakeAiElement('Method').value;
  if (!Object.hasOwn(AI_REVIEW_METHODS, method)) return;
  state.confirmedMethod = method;
  mistakeStorageSet(mistakeAiStorageKey(state.detail), { version: 1, method });
  const persisted = readMistakeAiMethod(state.detail) === method;
  mistakeAiElement('Confirmation').classList.toggle('mistake-inline-error', !persisted);
  if (persisted) state.savedMethod = method;
  if (persisted) refreshMistakeAiSaved();
  if (persisted && state.source === 'list') {
    resetMistakeAi();
    showToast('复习建议已保存到本浏览器');
    return;
  }
  mistakeAiElement('Confirmation').textContent = persisted
    ? '已保存到本浏览器：' + AI_REVIEW_METHODS[method] + '。刷新后可恢复；原错题分类未改变。'
    : '已确认：' + AI_REVIEW_METHODS[method] + '。本地保存失败，仅本页暂存，刷新后可能丢失；请重试。原错题分类未改变。';
}
