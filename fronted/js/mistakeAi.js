/* 复用错题本地存储保存最终复习方式；不写库、不映射 mistake_type。 */
let mistakeAiState = null;
const mistakeAiElement = name => document.getElementById('mistakeAi' + name);
const mistakeAiStorageKey = detail => 'mistake-ai-method:' + detail.courseId + ':' + detail.id;

function renderMistakeAiAnalysis(prefix, result) {
  const host=document.getElementById(prefix+'Analysis');host.replaceChildren();host.hidden=!result.analysis;
  if(!result.analysis)return;
  const a=result.analysis;
  const section=(title,lines)=>{
    const heading=document.createElement('h4');heading.textContent=title;host.append(heading);
    const list=document.createElement('ul');
    for(const line of lines){const item=document.createElement('li');item.textContent=line;list.append(item);}host.append(list);
  };
  section('答案观察（AI 初步判断，需核对）',[({correct:'未发现作答错误，不应强行归因。',incorrect:'作答存在错误或差异。',uncertain:'现有信息不足，暂不能判断对错。'})[a.answer_status],...a.observations]);
  section('参考答案核验',[a.reference_check]);
  section('候选错因（不是已确认分类）',a.possible_causes.length?a.possible_causes.map(c=>
    `${({knowledge:'知识方面',thinking:'思路方面',execution:'执行方面',unclassified:'待确定'})[c.category]} · ${c.support==='supported'?'有具体线索，仍待复核':'可能，尚不能确诊'}：${c.explanation}；依据／局限：${c.evidence}`):['暂不归因；正确作答或现有证据不足时，不制造错误原因。']);
  if(a.follow_up_questions.length)section('可补充的问题（写进过程或补充说明后，可手动再次分析）',a.follow_up_questions);
  section('建议的练习动作',[(AI_REVIEW_METHODS[result.review_method]||'暂无可用模式，请人工选择')+'：'+result.reason]);
  if(a.alternatives.length)section('可选的其他模式',a.alternatives.map(x=>AI_REVIEW_METHODS[x.mode_id]+'：'+x.reason));
  section('材料需求（尚未检查是否已有）',a.material_requirements);
}

function addMistakeAiEvidence(input, row, steps) {
  if(steps.trim())input.solution_steps=steps.trim();
  if(row){
    input.mistake_category=['knowledge','thinking','execution'].includes(row.mistake_type)?row.mistake_type:'unclassified';
    input.question_format=row.question_format_confirmed===1&&['choice','open'].includes(row.question_format)?row.question_format:'unknown';
  }
}

function clearMistakeAiKey(prefix, resetProvider=false) {
  const node=name=>document.getElementById(prefix+name);
  if(node('ApiKey'))node('ApiKey').value='';
  if(node('Cost'))node('Cost').checked=false;
  const shared=node('Provider')?.querySelector('option[value="shared"]');
  if(shared&&typeof coursesAiSettings!=='undefined')shared.textContent=coursesAiSettings.label();
  if(resetProvider&&node('Provider')){node('Provider').value='shared';node('Model').value='deepseek-flash';node('KeySettings').hidden=true;}
}
function changeMistakeAiProvider(prefix) {
  clearMistakeAiKey(prefix);
  document.getElementById(prefix+'KeySettings').hidden=document.getElementById(prefix+'Provider').value!=='deepseek';
}
function readMistakeAiKey(prefix) {
  const node=name=>document.getElementById(prefix+name);
  if(node('Provider').value==='shared'){const credentials=coursesAiSettings.read();if(!credentials)throw new Error('请先打开 AI 设置并配置真实 AI，也可以继续手动填写。');return credentials;}
  if(node('Provider').value!=='deepseek')return null;
  if(!/^[\x21-\x7e]{1,512}$/.test(node('ApiKey').value))throw mistakeAiError('INVALID_API_KEY');
  if(!node('Cost').checked)throw mistakeAiError('COST_CONFIRMATION_REQUIRED');
  return {apiKey:node('ApiKey').value,model:node('Model').value,confirmCost:true};
}
addEventListener('pagehide',()=>{
  clearMistakeAiKey('mistakeAi',true);clearMistakeAiKey('mistakeCreateAi',true);
  mistakeAiState?.controller?.abort();
  if(typeof tagPickerState!=='undefined')tagPickerState?.aiCreate?.controller?.abort();
});

function readMistakeAiRecord(detail) {
  const saved = mistakeStorageGet(mistakeAiStorageKey(detail));
  if (!saved || typeof saved.method !== 'string') return null;
  if (saved.version === 1 && Object.hasOwn(AI_REVIEW_METHODS, saved.method)) return {method:saved.method==='choice_reproduction'?'retry':saved.method};
  // Never guess a migration for recall/guided/unclassified or unknown versions.
  // Keep original bytes in storage until the user explicitly confirms a new mode.
  return {method:null, needsReselection:true};
}

function readMistakeAiMethod(detail) {
  return readMistakeAiRecord(detail)?.method || null;
}

function saveMistakeAiMethod(detail, method) {
  if(method==='choice_reproduction')method='retry';
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
  mistakeAiElement('Confirm').hidden=!!state&&readMistakeAiMethod(state.detail)===mistakeAiElement('Method').value;
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
  clearMistakeAiKey('mistakeAi',true);
  mistakeAiElement('Inputs').disabled = false;
  mistakeAiElement('Submit').disabled = false;
  mistakeAiElement('Submit').textContent = '获取 AI 建议';
  mistakeAiElement('Result').hidden = true;
  mistakeAiElement('Analysis').replaceChildren();mistakeAiElement('Analysis').hidden=true;
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
  clearMistakeAiKey('mistakeAi',true);
  if(typeof refreshReviewMethodApiAvailability==='function')refreshReviewMethodApiAvailability();
  mistakeAiState = { detail, busy: false, result: null, controller: null, ...options };
  const row = detail.row;
  mistakeAiElement('Status').textContent = '请配置 AI 后获取建议，也可以继续手动选择。';
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
    mistakeAiElement('Status').textContent = '旧记录无法可靠对应新模式，请重新选择并确认；取消不会覆盖旧记录。';
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
  if (!input.question || !input.student_answer) {
    mistakeAiElement('Error').textContent = '请填写题目和学生作答；错误原因与过程可留空，由真实 AI 辅助分析。';
    return;
  }
  let deepseek;
  try { deepseek=readMistakeAiKey('mistakeAi'); }
  catch(err){mistakeAiElement('Error').textContent=err.message;return;}
  addMistakeAiEvidence(input,deepseek?state.detail.row:null,mistakeAiElement('Steps').value);
  state.busy = true;
  state.controller = new AbortController();
  mistakeAiElement('Inputs').disabled = true;
  mistakeAiElement('Submit').disabled = true;
  mistakeAiElement('Confirm').disabled = true;
  mistakeAiElement('Method').disabled = true;
  mistakeAiElement('Panel').setAttribute('aria-busy', 'true');
  mistakeAiElement('Status').textContent = deepseek?'正在请求 '+coursesAiSettings.describe(deepseek)+'（可能计费），不会自动重试…':'正在分类，请稍候…';
  try {
    const pending=classifyMistakeWithAi(input, { signal: state.controller.signal, deepseek });
    clearMistakeAiKey('mistakeAi');if(deepseek)deepseek.apiKey='';
    const result = await pending;
    if (!mistakeAiIsCurrent(state)) return;
    state.result = result;
    delete state.confirmedMethod;
    const usable = Object.hasOwn(AI_REVIEW_METHODS, result.review_method);
    mistakeAiElement('Suggested').textContent = mistakeAiSuggestionText(result);
    mistakeAiElement('Reason').textContent = '分类理由：' + result.reason;
    renderMistakeAiAnalysis('mistakeAi',result);
    mistakeAiElement('Method').value = usable ? result.review_method : '';
    mistakeAiElement('Confirmation').textContent = '';
    mistakeAiElement('Result').hidden = false;
    mistakeAiElement('Status').textContent = usable ? (deepseek?coursesAiSettings.describe(deepseek)+'建议已生成，请人工复核。临时输入已清空，共享 Key 遵循 AI 设置。原错题分类未改变。':'建议已生成，请人工复核。原错题分类未改变。')
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
  if(typeof reviewMethodIsAvailable==='function'&&!reviewMethodIsAvailable(method)){
    mistakeAiElement('Error').textContent='自述讲解和对比辨析需要先接入真实 AI API。';
    return;
  }
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
  updateMistakeAiConfirm();
}

// Optional creation view: shares adapter, mode map and persistence with existing advice.
const mistakeCreateAiElement = name => document.getElementById('mistakeCreateAi' + name);

function cancelMistakeCreateAi() {
  if(typeof resetMistakeAnswerAi==='function')resetMistakeAnswerAi('Create');
  tagPickerState?.aiCreate?.controller?.abort();
  clearMistakeAiKey('mistakeCreateAi',true);
}

function prepareMistakeCreateAi(state) {
  if(typeof resetMistakeAnswerAi==='function')resetMistakeAnswerAi('Create');
  clearMistakeAiKey('mistakeCreateAi',true);
  state.aiCreate = {selectedMethod:'', result:null, busy:false, controller:null};
  const panel = mistakeCreateAiElement('Panel');
  panel.open = false;
  panel.setAttribute('aria-busy','false');
  for (const name of ['StudentAnswer','Steps','ErrorType','Suggested','Reason','Status','Error']) {
    const node = mistakeCreateAiElement(name);
    if ('value' in node) node.value = ''; else node.textContent = '';
  }
  const options=Object.entries(AI_SELECTABLE_METHODS).map(([id,label])=>{
    const option=new Option(label,id);if(typeof reviewMethodIsAvailable==='function')option.disabled=!reviewMethodIsAvailable(id);return option;
  });
  mistakeCreateAiElement('Method').replaceChildren(new Option('不选择',''),...options);
  mistakeCreateAiElement('Fields').disabled = false;
  mistakeCreateAiElement('Get').disabled = false;
  mistakeCreateAiElement('Adopt').disabled = true;
  mistakeCreateAiElement('Result').hidden = true;
  mistakeCreateAiElement('Analysis').replaceChildren();mistakeCreateAiElement('Analysis').hidden=true;
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
  if(typeof syncTagPickerReviewMethod==='function')syncTagPickerReviewMethod(state.aiCreate.selectedMethod);
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
  if (!input.question || !input.student_answer) {
    mistakeCreateAiElement('Error').textContent = '获取建议前请填写题干和学生作答；错误原因可留空，也可直接添加错题。';
    return;
  }
  let deepseek;
  try { deepseek=readMistakeAiKey('mistakeCreateAi'); }
  catch(err){mistakeCreateAiElement('Error').textContent=err.message;return;}
  addMistakeAiEvidence(input,null,mistakeCreateAiElement('Steps').value);
  if(deepseek){
    input.question_format=document.getElementById('mistakeCreateFormat').value==='choice'?'choice':'open';
    input.mistake_category='unclassified';
  }
  draft.busy = true; draft.controller = new AbortController();
  mistakeCreateAiElement('Fields').disabled = true;
  mistakeCreateAiElement('Get').disabled = true;
  mistakeCreateAiElement('Adopt').disabled = true;
  mistakeCreateAiElement('Panel').setAttribute('aria-busy','true');
  mistakeCreateAiElement('Status').textContent = deepseek?'正在请求 '+coursesAiSettings.describe(deepseek)+'（可能计费），不会自动重试…':'正在获取建议…';
  try {
    const pending=classifyMistakeWithAi(input,{signal:draft.controller.signal,deepseek});
    clearMistakeAiKey('mistakeCreateAi');if(deepseek)deepseek.apiKey='';
    const result = await pending;
    if (!current()) return;
    draft.result = result;
    mistakeCreateAiElement('Suggested').textContent = mistakeAiSuggestionText(result);
    mistakeCreateAiElement('Reason').textContent = result.reason;
    renderMistakeAiAnalysis('mistakeCreateAi',result);
    mistakeCreateAiElement('Result').hidden = false;
    // Never preselect or overwrite an explicit manual selection from an AI response.
    mistakeCreateAiElement('Status').textContent = (deepseek?coursesAiSettings.describe(deepseek)+'建议；临时输入已清空，共享 Key 遵循 AI 设置。':'')+'建议仅供参考；采用建议或手动选择后，才会随错题保存。';
  } catch (err) {
    if (current() && err.name!=='AbortError') mistakeCreateAiElement('Error').textContent = err.message;
  } finally {
    if (current()) {
      draft.busy = false; draft.controller = null;
      mistakeCreateAiElement('Fields').disabled = false;
      mistakeCreateAiElement('Get').disabled = false;
      mistakeCreateAiElement('Adopt').disabled = !Object.hasOwn(AI_REVIEW_METHODS,draft.result?.review_method);
      mistakeCreateAiElement('Panel').setAttribute('aria-busy','false');
    }
  }
}

function saveCreatedMistakeAi(state, row) {
  const method = state.aiCreate?.selectedMethod;
  if (!method) return true;
  if(typeof reviewMethodIsAvailable==='function'&&!reviewMethodIsAvailable(method)){
    mistakeCreateAiElement('Error').textContent='自述讲解和对比辨析需要先接入真实 AI API。';
    return false;
  }
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
