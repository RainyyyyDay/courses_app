/* 复用错题本地存储保存最终复习方式；不写库、不映射 mistake_type。 */
let mistakeAiState = null;
const mistakeAiElement = name => document.getElementById('mistakeAi' + name);
const mistakeAiStorageKey = detail => 'mistake-ai-method:' + detail.courseId + ':' + detail.id;

function readMistakeAiRecord(detail) {
  const saved = mistakeStorageGet(mistakeAiStorageKey(detail));
  if (!saved || typeof saved.method !== 'string') return null;
  if (saved.version === 1 && Object.hasOwn(AI_REVIEW_METHODS, saved.method)) return {method:saved.method};
  // Never guess a migration for recall/guided/unclassified or unknown versions.
  // Keep original bytes in storage until the user explicitly confirms a new mode.
  return {method:null, needsReselection:true};
}

function readMistakeAiMethod(detail) {
  return readMistakeAiRecord(detail)?.method || null;
}

function saveMistakeAiMethod(detail, method) {
  if (!Number.isSafeInteger(detail.courseId) || detail.courseId < 1
    || !Number.isSafeInteger(detail.id) || detail.id < 1 || !Object.hasOwn(AI_REVIEW_METHODS, method)) return false;
  mistakeStorageSet(mistakeAiStorageKey(detail), {version:1, method});
  return readMistakeAiMethod(detail) === method;
}

function mistakeAiSuggestionText(result) {
  return Object.hasOwn(AI_REVIEW_METHODS, result.review_method) ? 'AI 建议：' + AI_REVIEW_METHODS[result.review_method]
    : 'AI 暂未给出可用建议，请人工选择';
}

function updateMistakeAiConfirm() {
  const state = mistakeAiState;
  mistakeAiElement('Confirm').disabled = !state || state.busy
    || !(state.result || state.savedMethod || state.needsReselection)
    || !Object.hasOwn(AI_REVIEW_METHODS, mistakeAiElement('Method').value);
}

function mistakeAiSavedText(detail) {
  const record = readMistakeAiRecord(detail), method = record?.method;
  if (record?.needsReselection) return '旧版 AI 复习建议需重新选择（原记录已保留）';
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
  } else if (readMistakeAiRecord(detail)?.needsReselection) {
    mistakeAiState.needsReselection = true;
    mistakeAiElement('Result').hidden = false;
    mistakeAiElement('Method').value = '';
    mistakeAiElement('Suggested').textContent = '旧版 AI 复习建议需重新选择（原记录已保留）';
    mistakeAiElement('Status').textContent = '旧记录无法可靠对应新模式，请从七种模式中选择并确认；取消不会覆盖旧记录。';
  }
  mistakeAiElement('Panel').hidden = false;
  mistakeAiElement('Toggle').setAttribute('aria-expanded', 'true');
  updateMistakeAiConfirm();
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
    const usable = Object.hasOwn(AI_REVIEW_METHODS, result.review_method);
    mistakeAiElement('Suggested').textContent = mistakeAiSuggestionText(result);
    mistakeAiElement('Reason').textContent = '分类理由：' + result.reason;
    mistakeAiElement('Method').value = usable ? result.review_method : '';
    mistakeAiElement('Confirmation').textContent = '';
    mistakeAiElement('Result').hidden = false;
    mistakeAiElement('Status').textContent = usable ? '建议已生成，请人工复核。原错题分类未改变。'
      : 'AI 暂未给出可用建议，请人工选择';
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
      updateMistakeAiConfirm();
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
    updateMistakeAiConfirm();
  }
}

function confirmMistakeAiSuggestion() {
  const state = mistakeAiState;
  if (!state || (!state.result && !state.savedMethod && !state.needsReselection) || state.busy || !mistakeAiIsCurrent(state)) return;
  const method = mistakeAiElement('Method').value;
  if (!Object.hasOwn(AI_REVIEW_METHODS, method)) return;
  state.confirmedMethod = method;
  const persisted = saveMistakeAiMethod(state.detail, method);
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

// Optional creation view: shares adapter, mode map and persistence with existing advice.
const mistakeCreateAiElement = name => document.getElementById('mistakeCreateAi' + name);

function cancelMistakeCreateAi() {
  tagPickerState?.aiCreate?.controller?.abort();
}

function prepareMistakeCreateAi(state) {
  state.aiCreate = {selectedMethod:'', result:null, busy:false, controller:null};
  const panel = mistakeCreateAiElement('Panel');
  panel.open = false;
  panel.setAttribute('aria-busy','false');
  for (const name of ['StudentAnswer','ErrorType','Suggested','Reason','Status','Error']) {
    const node = mistakeCreateAiElement(name);
    if ('value' in node) node.value = ''; else node.textContent = '';
  }
  mistakeCreateAiElement('Method').replaceChildren(new Option('不选择',''),
    ...Object.entries(AI_REVIEW_METHODS).map(([id,label])=>new Option(label,id)));
  mistakeCreateAiElement('Fields').disabled = false;
  mistakeCreateAiElement('Get').disabled = false;
  mistakeCreateAiElement('Adopt').disabled = true;
  mistakeCreateAiElement('Result').hidden = true;
}

function changeMistakeCreateAiMethod() {
  const state = tagPickerState;
  if (!state?.aiCreate || state.saving) return;
  const method = mistakeCreateAiElement('Method').value;
  state.aiCreate.selectedMethod = Object.hasOwn(AI_REVIEW_METHODS,method) ? method : '';
  mistakeCreateAiElement('Status').textContent = state.aiCreate.selectedMethod
    ? '已选择：' + AI_REVIEW_METHODS[method] + (state.createdMistake
      ? '。错题已创建，点击“重试保存建议”仅保存此选择。' : '。将在错题创建成功后保存到本浏览器。')
    : '不选择：只添加错题，不保存复习建议。';
}

function adoptMistakeCreateAi() {
  const method = tagPickerState?.aiCreate?.result?.review_method;
  if (!Object.hasOwn(AI_REVIEW_METHODS,method) || tagPickerState.saving) return;
  mistakeCreateAiElement('Method').value = method;
  changeMistakeCreateAiMethod();
}

async function requestMistakeCreateAi() {
  const state = tagPickerState, draft = state?.aiCreate;
  if (!draft || draft.busy || state.saving || state.courseId !== currentCourseId) return;
  const current = ()=>tagPickerState===state && state.aiCreate===draft && state.courseId===currentCourseId;
  const input = {
    question:document.getElementById('mistakeCreateContent').value.trim(),
    student_answer:mistakeCreateAiElement('StudentAnswer').value.trim(),
    error_type:mistakeCreateAiElement('ErrorType').value,
    correct_answer:document.getElementById('mistakeCreateFormat').value==='choice'
      ? readMistakeChoiceAnswerIds('Create').join(', ') : document.getElementById('mistakeCreateAnswer').value.trim(),
    context:document.getElementById('mistakeCreateExplanation').value.trim()
  };
  mistakeCreateAiElement('Error').textContent = '';
  if (!input.question || !input.student_answer || !input.error_type) {
    mistakeCreateAiElement('Error').textContent = '获取建议前请填写题干、学生作答并选择明确错误原因；这些信息不影响直接添加错题。';
    return;
  }
  draft.busy = true; draft.controller = new AbortController();
  mistakeCreateAiElement('Get').disabled = true;
  mistakeCreateAiElement('Adopt').disabled = true;
  mistakeCreateAiElement('Panel').setAttribute('aria-busy','true');
  mistakeCreateAiElement('Status').textContent = '正在获取建议…';
  try {
    const result = await classifyMistakeWithAi(input,{signal:draft.controller.signal});
    if (!current()) return;
    draft.result = result;
    mistakeCreateAiElement('Suggested').textContent = mistakeAiSuggestionText(result);
    mistakeCreateAiElement('Reason').textContent = result.reason;
    mistakeCreateAiElement('Result').hidden = false;
    // Never preselect or overwrite an explicit manual selection from an AI response.
    mistakeCreateAiElement('Status').textContent = '建议仅供参考；采用建议或手动选择后，才会随错题保存。';
  } catch (err) {
    if (current() && err.name!=='AbortError') mistakeCreateAiElement('Error').textContent = err.message;
  } finally {
    if (current()) {
      draft.busy = false; draft.controller = null;
      mistakeCreateAiElement('Get').disabled = false;
      mistakeCreateAiElement('Adopt').disabled = !Object.hasOwn(AI_REVIEW_METHODS,draft.result?.review_method);
      mistakeCreateAiElement('Panel').setAttribute('aria-busy','false');
    }
  }
}

function saveCreatedMistakeAi(state, row) {
  const method = state.aiCreate?.selectedMethod;
  if (!method) return true;
  const valid = row?.course_id===state.courseId && Number.isSafeInteger(row.id) && row.id>0;
  if (valid && saveMistakeAiMethod({courseId:row.course_id,id:row.id},method)) {
    refreshMistakeAiSaved();return true;
  }
  mistakeCreateAiElement('Panel').open = true;
  mistakeCreateAiElement('Error').textContent = valid
    ? '错题已创建，但复习建议本地保存失败。选择已保留；点击“重试保存建议”不会重复创建错题。'
    : '错题已创建，但返回的课程或错题编号无效，建议未关联。请关闭后从列表检查该题。';
  return false;
}
