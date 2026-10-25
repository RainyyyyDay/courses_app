/* Shared upload/edit review-mode choice and automatic body/attachment AI advice. */
const REVIEW_METHOD_GUIDE = Object.freeze({
  standard: '先回忆，再选择清楚、模糊或不记得；清楚才算成功。',
  cloze: '从原文生成挖空，逐空作答。',
  self_explain: '用自己的话讲解，对照参考要点自评；AI 批改可选。',
  reading: '看完后确认是否熟悉内容。',
  contrast: '填写对比矩阵，对照对象、维度和关键异同自评；AI 批改可选。',
  retry: '重新执行已有练习，不另造判分。'
});
// All current review modes have manual execution. Only explicit AI actions require credentials.
const AI_DEPENDENT_REVIEW_METHODS = new Set();
function reviewMethodRequiresRealAi(method){return AI_DEPENDENT_REVIEW_METHODS.has(method);}
function reviewAdviceAiReady(){
  return typeof coursesAiSettings!=='undefined'&&typeof coursesAiSettings.realReady==='function'
    &&coursesAiSettings.realReady();
}
function reviewMethodIsAvailable(method){
  if(!Object.hasOwn(AI_SELECTABLE_METHODS,method))return false;
  return !reviewMethodRequiresRealAi(method)||reviewAdviceAiReady();
}
let creationReviewAdviceState = null;
let pendingCreationCloze = null;
const creationReviewOcrCache = new Map();

function readStoredReviewMethod(type, id) {
  if (type === 'mistake') return typeof readMistakeAiMethod === 'function'
    ? readMistakeAiMethod({courseId:currentCourseId,id}) : null;
  return typeof readResourceAiMethod === 'function'
    ? readResourceAiMethod({courseId:currentCourseId,type,id}) : null;
}

function saveStoredReviewMethod(type, id, method) {
  if (!Number.isSafeInteger(id) || id < 1) return false;
  if (type === 'mistake') return saveMistakeAiMethod({courseId:currentCourseId,id},method);
  const context={courseId:currentCourseId,type,id};
  const previous=readResourceAiMethod(context);
  if(method==='retry'&&typeof RESOURCE_RETRY_MODES!=='undefined'&&RESOURCE_RETRY_MODES.includes(previous)){
    mistakeStorageSet(resourceRetryKey(context),{version:1,mode:previous});
    if(mistakeStorageGet(resourceRetryKey(context))?.mode!==previous)return false;
  }
  if(!saveResourceAiMethod(context,method))return false;
  if(previous!==method&&typeof clearResourceSessionChoices==='function')clearResourceSessionChoices(context);
  return true;
}

function reviewModePrefix(prefix) { return String(prefix).replace(/[^A-Za-z0-9_-]/g,''); }
function reviewModeField(prefix, suffix) { return document.getElementById(prefix+suffix); }

function mountReviewMethodEditor(prefix, type, id = null) {
  prefix = reviewModePrefix(prefix);
  let host = reviewModeField(prefix,'ReviewModeHost');
  if (!host && prefix === 'tagPicker') {
    host = document.createElement('section');
    host.id = 'tagPickerReviewModeHost';
    host.className = 'edit-card review-method-card';
    const body = document.getElementById('tagPickerBody');
    const tagBlock = document.getElementById('tagPickerTagBlock');
    if (body) body.insertBefore(host,tagBlock);
  }
  if (!host || !Object.hasOwn({material:1,note:1,mistake:1},type)) return;
  const saved = id ? readStoredReviewMethod(type,id) : null;
  const aiReady=reviewAdviceAiReady();
  host.style.display = 'block';
  host.dataset.reviewType = type;
  host.innerHTML = `<div class="edit-card-head"><span class="edit-card-icon">🧠</span><div class="edit-card-titles"><b>复习方式</b><small>可以手动选择，也可以让 AI 读取当前正文和附件后建议；两种方式都不会立即开始复习。</small></div></div>
    <div class="edit-card-body review-method-picker">
      <div class="review-mode-select-row"><label for="${prefix}ReviewMethod">复习方式
          <select id="${prefix}ReviewMethod" onchange="changeReviewMethodChoice('${prefix}')">
            <option value="">未手动选择（保存时按标准复习）</option>
            ${Object.entries(AI_SELECTABLE_METHODS).map(([value,label])=>`<option value="${value}" ${AI_DEPENDENT_REVIEW_METHODS.has(value)&&!aiReady?'disabled':''}>${escapeHtml(label)}</option>`).join('')}
          </select>
        </label><button type="button" class="review-mode-setup" id="${prefix}ClozeSetup" onclick="openClozeModeSetup('${prefix}')" hidden>设置挖空</button>
      </div>
      <div class="ai-action-row"><button type="button" class="ai-primary" id="${prefix}ReviewModeAdvice" onclick="openCreationReviewSuggestion('${prefix}')" ${aiReady?'':'disabled aria-disabled="true"'} title="${aiReady?'读取正文和附件后建议复习方式':'请先在 AI 设置中接入真实 API'}">AI 建议复习方式</button></div>
      <p class="review-api-note" id="${prefix}ReviewApiNote" ${aiReady?'hidden':''}>未接入 AI 仍可手动选择复习方式、准备材料并作答。只有 AI 建议、AI 生成材料及 AI 批改需要配置 AI。</p>
      <p class="review-method-status" id="${prefix}ReviewMethodStatus" role="status" aria-live="polite"></p>
      <p class="mistake-ai-note">未手动选择且未采用 AI 建议时，将按标准复习保存。标准复习是固定兜底，不交给 AI 选择。</p>
    </div>`;
  const select = reviewModeField(prefix,'ReviewMethod');
  select.value = saved || '';
  refreshReviewMethodApiAvailability();
  updateReviewMethodChoiceStatus(prefix);
}

function updateReviewMethodChoiceStatus(prefix,message='') {
  prefix = reviewModePrefix(prefix);
  const host = reviewModeField(prefix,'ReviewModeHost'),select = reviewModeField(prefix,'ReviewMethod');
  const status = reviewModeField(prefix,'ReviewMethodStatus');
  if (!host || !select || !status) return;
  const method = select.value;
  status.textContent = message || (method
    ? `已选择：${AI_REVIEW_METHODS[method]}。${REVIEW_METHOD_GUIDE[method]||''}`
    : '尚未手动选择；保存时将使用标准复习。');
  status.dataset.method = method || 'standard';
  status.classList.toggle('is-default',!method);
  const apiNote=reviewModeField(prefix,'ReviewApiNote');
  if(apiNote)apiNote.hidden=typeof coursesAiSettings!=='undefined'&&typeof coursesAiSettings.realReady==='function'&&coursesAiSettings.realReady();
  const clozeSetup=reviewModeField(prefix,'ClozeSetup');
  if(clozeSetup){
    clozeSetup.hidden=method!=='cloze';
    const pending=pendingCreationCloze?.prefix===prefix;
    clozeSetup.textContent=pending?'重新设置挖空':'设置挖空';
  }
  if (prefix === 'tagPicker' && host.dataset.reviewType === 'mistake') syncMistakeAdvancedReviewMethod(method);
}

function changeReviewMethodChoice(prefix) { updateReviewMethodChoiceStatus(reviewModePrefix(prefix)); }

function refreshReviewMethodApiAvailability() {
  const ready=reviewAdviceAiReady();
  for(const prefix of ['tagPicker','mistakeEdit']){
    const select=reviewModeField(prefix,'ReviewMethod');
    if(select)for(const option of select.options)if(AI_DEPENDENT_REVIEW_METHODS.has(option.value))option.disabled=!ready;
    const note=reviewModeField(prefix,'ReviewApiNote');
    if(note)note.hidden=ready;
    const advice=reviewModeField(prefix,'ReviewModeAdvice');
    if(advice){
      advice.disabled=!ready;
      advice.setAttribute('aria-disabled',String(!ready));
      advice.title=ready?'读取正文和附件后建议复习方式':'请先在 AI 设置中接入真实 API';
    }
  }
  for(const id of ['mistakeAiMethod','mistakeCreateAiMethod']){
    const select=document.getElementById(id);
    if(select)for(const option of select.options)if(AI_DEPENDENT_REVIEW_METHODS.has(option.value))option.disabled=!ready;
  }
}

function syncMistakeAdvancedReviewMethod(method) {
  const select = document.getElementById('mistakeCreateAiMethod');
  if (!select || !tagPickerState?.aiCreate) return;
  select.value = method && Object.hasOwn(AI_SELECTABLE_METHODS,method) ? method : '';
  tagPickerState.aiCreate.selectedMethod = select.value;
  const status = document.getElementById('mistakeCreateAiStatus');
  if (status) status.textContent = select.value
    ? `已从上方复习方式同步：${AI_REVIEW_METHODS[select.value]}。`
    : '尚未选择最终复习方式；保存时将使用标准复习。';
}

function syncTagPickerReviewMethod(method) {
  const select = document.getElementById('tagPickerReviewMethod');
  if (!select) return;
  select.value = Object.hasOwn(AI_SELECTABLE_METHODS,method) ? method : '';
  updateReviewMethodChoiceStatus('tagPicker');
}

function readReviewMethodEditor(prefix) {
  const select = reviewModeField(reviewModePrefix(prefix),'ReviewMethod');
  return select && Object.hasOwn(AI_SELECTABLE_METHODS,select.value) ? select.value : 'standard';
}

function persistReviewMethodEditor(prefix, type, id) {
  const method = readReviewMethodEditor(prefix);
  return saveStoredReviewMethod(type,id,method);
}

function reviewModeSourceText(prefix) {
  if(prefix==='mistakeEdit')return document.getElementById('mistakeEditContent')?.value.trim()||'';
  const type=tagPickerState?.resourceType;
  if(type==='mistake')return document.getElementById('mistakeCreateContent')?.value.trim()||'';
  return document.getElementById('tagPickerResourceContent')?.value.trim()||'';
}

function resetPendingCreationCloze(prefix='tagPicker') {
  if(!prefix||pendingCreationCloze?.prefix===prefix)pendingCreationCloze=null;
}

function openPendingCreationCloze(prefix,type) {
  ensureReviewWorkbench();
  if(reviewWorkbench)closeReviewWorkbench(false);
  const state={courseId:currentCourseId,type,id:null,mode:'cloze',busy:false,pendingCreation:true,setupPrefix:prefix};
  reviewWorkbench=state;
  const title=wb('Header')?.querySelector('h2');if(title)title.textContent='设置挖空回忆';
  wb('Settings').hidden=true;wb('Header').hidden=false;
  wb('Editor').innerHTML=clozeEditorHtml({prompt:reviewModeSourceText(prefix),blanks:[]})
    +(typeof reviewMaterialAiGeneratorHtml==='function'?reviewMaterialAiGeneratorHtml('cloze'):'');
  wb('Actions').innerHTML='<button type="button" class="ai-primary" onclick="savePendingCreationCloze()">保存挖空设置</button>';
  if(wb('Draft'))wb('Draft').replaceChildren();
  wb('Error').textContent='';
  if(!wb('Dialog').open)wb('Dialog').showModal();
  initClozeEditor();
  updateWorkbenchPreparation();
  if(typeof refreshWorkbenchAiAvailability==='function')refreshWorkbenchAiAvailability();
}

async function openClozeModeSetup(prefix) {
  prefix=reviewModePrefix(prefix);
  const select=reviewModeField(prefix,'ReviewMethod');
  if(select?.value!=='cloze')return;
  try{
    const type=prefix==='mistakeEdit'?'mistake':tagPickerState?.resourceType;
    if(!type)return;
    const id=prefix==='mistakeEdit'?mistakeEditPending?.id:
      (tagPickerState?.mode==='edit'?tagPickerState.resourceId:null);
    if(!id){openPendingCreationCloze(prefix,type);return;}
    const row=prefix==='mistakeEdit'?mistakeEditPending?.row:currentResourceRow(type,id);
    await openReviewWorkbench(type,id,{row,mode:'cloze',
      sourceText:reviewModeSourceText(prefix),referenceText:row?.answer_content||row?.explanation||''});
    if(reviewWorkbench)await editWorkbenchMaterial();
  }catch(err){
    const status=reviewModeField(prefix,'ReviewMethodStatus');
    if(status)status.textContent=`无法打开挖空设置：${err.message}`;
    console.error('打开挖空设置失败',err);
  }
}

function savePendingCreationCloze() {
  const s=reviewWorkbench;
  if(!s?.pendingCreation||s.mode!=='cloze')return;
  const material=readWorkbenchMaterial(),missing=workbenchMaterialMissing('cloze',material);
  if(missing.length){wb('Error').textContent='请先补全挖空：'+missing.join('；');return;}
  pendingCreationCloze={prefix:s.setupPrefix,type:s.type,
    formId:s.setupPrefix==='tagPicker'?tagPickerState?.formId:null,material};
  updateReviewMethodChoiceStatus(s.setupPrefix,'挖空已设置；保存上方内容后会写入这条记录。');
  closeReviewWorkbench(false);
  showToast('挖空设置已暂存');
}

async function persistPendingCreationCloze(prefix,type,id) {
  const pending=pendingCreationCloze;
  const formId=prefix==='tagPicker'?tagPickerState?.formId:null;
  if(!pending||pending.prefix!==prefix||pending.type!==type
    ||(prefix==='tagPicker'&&pending.formId!==formId))return {ok:true,skipped:true};
  try{
    const response=await requestApi(`${API}/courses/${currentCourseId}/review-items/${type}/${id}/materials/cloze`,{
      method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({expectedVersion:0,confirmed:true,material:pending.material})
    });
    if(!response.ok)throw new Error('保存挖空材料失败');
    resetPendingCreationCloze(prefix);
    return {ok:true};
  }catch(err){return {ok:false,error:err.message};}
}

function creationAdviceTypedText(prefix,type) {
  const value = id => (document.getElementById(id)?.value || '').trim();
  if (prefix === 'mistakeEdit') {
    const parts = [];
    if (value('mistakeEditContent')) parts.push(['题目',value('mistakeEditContent')]);
    if (document.getElementById('mistakeEditFormat')?.value === 'choice') {
      const options = typeof readMistakeChoiceOptionValues === 'function' ? readMistakeChoiceOptionValues('Edit') : [];
      if (options.some(Boolean)) parts.push(['选项',options.map((text,index)=>`${String.fromCharCode(65+index)}. ${text}`).join('\n')]);
    }
    if (value('mistakeEditAnswer')) parts.push(['参考答案',value('mistakeEditAnswer')]);
    if (value('mistakeEditExplanation')) parts.push(['解析 / 错因',value('mistakeEditExplanation')]);
    return parts;
  }
  if (type === 'mistake') {
    const parts = [];
    if (value('mistakeCreateContent')) parts.push(['题目',value('mistakeCreateContent')]);
    if (value('mistakeCreateFormat') === 'choice') {
      const options = typeof readMistakeChoiceOptionValues === 'function' ? readMistakeChoiceOptionValues('Create') : [];
      if (options.some(Boolean)) parts.push(['选项',options.map((text,index)=>`${String.fromCharCode(65+index)}. ${text}`).join('\n')]);
    }
    if (value('mistakeCreateAiStudentAnswer')) parts.push(['学生作答',value('mistakeCreateAiStudentAnswer')]);
    if (value('mistakeCreateAiSteps')) parts.push(['解题过程',value('mistakeCreateAiSteps')]);
    if (value('mistakeCreateAnswer')) parts.push(['参考答案',value('mistakeCreateAnswer')]);
    if (value('mistakeCreateExplanation')) parts.push(['解析 / 错因',value('mistakeCreateExplanation')]);
    return parts;
  }
  const text = value('tagPickerResourceContent');
  return text ? [['正文',text]] : [];
}

function creationAdviceFiles(prefix,type) {
  const files = [];
  const add = (label,file,key) => {
    if (!file) return;
    const identity=file instanceof Blob ? `${file.name||''}:${file.size||0}:${file.lastModified||0}`
      : `${label}:${file.url||''}:${file.name||''}`;
    files.push({label,file,key:key||identity});
  };
  if (prefix === 'mistakeEdit') {
    const pending = mistakeEditPending;
    if (pending?.questionFile) add('题目附件',pending.questionFile);
    else if (pending?.row?.image_url && !pending.questionRemoved) add('题目附件',
      {url:pending.row.image_url,name:pending.row.title||'题目附件',type:pending.row.file_type||''});
    if (pending?.answerFile) add('答案附件',pending.answerFile);
    else if (pending?.row?.answer_image_url && !pending.answerRemoved) add('答案附件',
      {url:pending.row.answer_image_url,name:'答案附件',type:pending.row.answer_file_type||''});
    return files;
  }
  if (type === 'mistake') {
    add('题目附件',pendingUploadFile);
    add('答案附件',pendingAnswerFile);
    return files;
  }
  if (pendingUploadFile) add('内容附件',pendingUploadFile);
  else if (tagPickerState?.mode === 'edit' && pickerExistingFile && !pendingResourceRemoveFile) {
    add('内容附件',{url:pickerExistingFile.url,name:pickerExistingFile.name,type:pickerExistingFile.type});
  }
  return files;
}

async function adviceFileObject(item) {
  if (item.file instanceof Blob) return item.file;
  const apiBase=String(typeof API==='string'?API:'/api').replace(/\/api\/?$/,'')||location.origin;
  const url = new URL(item.file.url,apiBase+'/');
  const response = await fetch(url.href,{cache:'no-store'});
  if (!response.ok) throw new Error(`${item.label}读取失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  return new File([blob],item.file.name||item.label,{type:item.file.type||blob.type||'application/octet-stream'});
}

function setCreationAdviceStatus(message,busy=false) {
  const status = document.getElementById('creationModeAdviceStatus');
  const progress = document.getElementById('creationModeAdviceProgress');
  if (status) status.textContent = message;
  if (progress) progress.hidden = !busy;
  const dialog = document.getElementById('creationModeAdviceDialog');
  if (dialog) dialog.setAttribute('aria-busy',String(!!busy));
}

async function collectCreationAdviceInput(prefix,state) {
  const type = tagPickerState?.resourceType || 'mistake';
  const title = prefix === 'mistakeEdit'
    ? document.getElementById('mistakeEditTitle')?.value.trim() || '错题'
    : document.getElementById('tagPickerName')?.value.trim() || (type === 'note' ? '笔记' : type === 'material' ? '资料' : '错题');
  const typed = creationAdviceTypedText(prefix,type);
  const files = creationAdviceFiles(prefix,type);
  const warnings = [];
  let attachmentChars = 0;
  const attachmentParts = [];
  for (const item of files) {
    if (state.cancelled) throw Object.assign(new Error('已取消'),{name:'AbortError'});
    setCreationAdviceStatus(`正在读取${item.label}并识别文字…`,true);
    try {
      const file = await adviceFileObject(item);
      let text = creationReviewOcrCache.get(item.key);
      if (text === undefined) {
        const result = await recognizeUploadedFile(file,message=>setCreationAdviceStatus(`${item.label}：${message}`,true));
        text = String(result?.text || '').trim();
        creationReviewOcrCache.set(item.key,text);
      }
      if (text) {attachmentParts.push(`${item.label} OCR：\n${text}`);attachmentChars += text.length;}
      else warnings.push(`${item.label}未识别到文字`);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      warnings.push(`${item.label}读取失败：${err.message}`);
    }
  }
  const typedText = typed.map(([label,text])=>`${label}：\n${text}`).join('\n\n');
  const fullText = [typedText,...attachmentParts].filter(Boolean).join('\n\n');
  if (!fullText.trim()) throw new Error('没有读到正文或附件文字。请填写正文，或换一个可识别的附件后重试。');
  const content = fullText.slice(0,4000);
  return {input:{kind:type,title:title.slice(0,4000),content},typedChars:typed.reduce((sum,[,text])=>sum+text.length,0),
    attachmentChars,originalChars:fullText.length,truncated:fullText.length>content.length,warnings};
}

function creationAdviceAllowedMethods() {
  const aiReady=typeof coursesAiSettings!=='undefined'&&typeof coursesAiSettings.realReady==='function'&&coursesAiSettings.realReady();
  if(aiReady)return AI_SUGGESTABLE_METHODS;
  return Object.freeze(Object.fromEntries(Object.entries(AI_SUGGESTABLE_METHODS)
    .filter(([id])=>!AI_DEPENDENT_REVIEW_METHODS.has(id))));
}

function creationAdviceContext(prefix,type) {
  const goal=document.getElementById('creationModeAdviceGoal')?.value||'';
  const extra=document.getElementById('creationModeAdviceExtra')?.value.trim()||'';
  const mistakeType=type==='mistake'
    ? (prefix==='mistakeEdit'?document.getElementById('mistakeEditType')?.value:document.getElementById('mistakeCreateType')?.value)||''
    : '';
  return {goal,extra_context:extra.slice(0,2000),mistake_type:mistakeType};
}

function invalidateCreationAdviceResult() {
  const state=creationReviewAdviceState;
  if(!state||state.busy||!state.result)return;
  state.result=null;
  document.getElementById('creationModeAdviceResult').hidden=true;
  document.getElementById('creationModeAdviceAdopt').hidden=true;
  document.getElementById('creationModeAdviceAnalyze').hidden=false;
  setCreationAdviceStatus('复习目标或补充说明已改变；请重新分析。');
}

async function prepareCreationReviewAdvice(state) {
  const analyze=document.getElementById('creationModeAdviceAnalyze');
  if (!state || creationReviewAdviceState !== state) return;
  state.result=null;state.sources=null;
  document.getElementById('creationModeAdviceResult').hidden=true;
  document.getElementById('creationModeAdviceAdopt').hidden=true;
  document.getElementById('creationModeAdviceRetry').hidden=true;
  analyze.hidden=true;analyze.disabled=true;
  try {
    const extracted = await collectCreationAdviceInput(state.prefix,state);
    if (creationReviewAdviceState !== state || state.cancelled) return;
    state.sources = extracted;
    const warnings = extracted.warnings.length ? `；部分附件未读到：${extracted.warnings.join('；')}` : '';
    const truncation = extracted.truncated ? `；原文共 ${extracted.originalChars} 字，本次只发送前 4000 字` : '';
    document.getElementById('creationModeAdviceSource').textContent =
      `读取范围：正文 ${extracted.typedChars} 字、附件 OCR ${extracted.attachmentChars} 字${truncation}${warnings}。`;
    setCreationAdviceStatus(`已读取内容。请选择复习目标并填写补充说明，然后点击“分析复习方式”。${warnings}`);
    analyze.hidden=false;analyze.disabled=false;
  } catch (err) {
    if (creationReviewAdviceState !== state || err?.name === 'AbortError' || state.cancelled) return;
    setCreationAdviceStatus(`未能读取内容：${err.message}。正文和已选手动模式都未改变。`);
    const retry=document.getElementById('creationModeAdviceRetry');retry.textContent='重新读取';retry.hidden=false;
  } finally {
    if (creationReviewAdviceState === state) state.busy = false;
    const progress=document.getElementById('creationModeAdviceProgress');if(progress)progress.hidden = true;
    document.getElementById('creationModeAdviceDialog')?.setAttribute('aria-busy','false');
  }
}

async function analyzeCreationReviewAdvice() {
  const state=creationReviewAdviceState;
  if(!state||state.busy)return;
  if(!state.sources){await prepareCreationReviewAdvice(state);return;}
  const type=state.sources.input.kind;
  const input={...state.sources.input,...creationAdviceContext(state.prefix,type)};
  state.busy=true;state.result=null;
  const analyze=document.getElementById('creationModeAdviceAnalyze'),adopt=document.getElementById('creationModeAdviceAdopt');
  document.getElementById('creationModeAdviceResult').hidden=true;adopt.hidden=true;
  analyze.hidden=true;analyze.disabled=true;
  state.controller?.abort();state.controller=new AbortController();
  setCreationAdviceStatus('正在综合内容、复习目标和补充说明，判断适合的复习方式…',true);
  let credentials=null;
  try{
    credentials=coursesAiSettings.read();
    const pending=fetchResourceAi(input,{
      signal:state.controller.signal,
      deepseek:credentials,
      endpointPath:'review-mode-advice',
      allowedMethods:creationAdviceAllowedMethods(),
      maxBytes:32768
    });
    if(credentials)credentials.apiKey='';
    const result=await pending;
    if(creationReviewAdviceState!==state||state.cancelled)return;
    state.result=result;
    const method=result.review_method;
    document.getElementById('creationModeAdviceTitle').textContent=`建议：${AI_REVIEW_METHODS[method]}`;
    document.getElementById('creationModeAdviceReason').textContent=result.reason;
    adopt.textContent=`采用建议：${AI_REVIEW_METHODS[method]}`;
    adopt.hidden=false;adopt.disabled=false;
    document.getElementById('creationModeAdviceResult').hidden=false;
    analyze.hidden=false;analyze.disabled=false;analyze.textContent='重新分析';
    setCreationAdviceStatus('建议只供参考；点击“采用建议”后才会填入复习方式，仍需保存内容。');
  }catch(err){
    if(creationReviewAdviceState!==state||err?.name==='AbortError'||state.cancelled)return;
    setCreationAdviceStatus(`AI 分析失败：${err.message}。目标和补充说明已保留。`);
    const retry=document.getElementById('creationModeAdviceRetry');retry.textContent='重新分析';retry.hidden=false;
  }finally{
    if(credentials)credentials.apiKey='';
    if(creationReviewAdviceState===state)state.busy=false;
    const progress=document.getElementById('creationModeAdviceProgress');if(progress)progress.hidden=true;
    document.getElementById('creationModeAdviceDialog')?.setAttribute('aria-busy','false');
  }
}

function openCreationReviewSuggestion(prefix) {
  if(!reviewAdviceAiReady()){
    showToast('AI 建议需要先接入真实 API；仍可手动选择复习方式');
    return;
  }
  closeCreationReviewSuggestion();
  const state = {prefix:reviewModePrefix(prefix),busy:true,result:null,controller:null,cancelled:false,trigger:document.activeElement};
  creationReviewAdviceState = state;
  const dialog = document.getElementById('creationModeAdviceDialog');
  document.getElementById('creationModeAdviceTitle').textContent = '正在读取内容';
  document.getElementById('creationModeAdviceReason').textContent = '';
  document.getElementById('creationModeAdviceSource').textContent = '';
  document.getElementById('creationModeAdviceResult').hidden = true;
  document.getElementById('creationModeAdviceAdopt').hidden = true;
  const analyze=document.getElementById('creationModeAdviceAnalyze');analyze.hidden = true;analyze.textContent='分析复习方式';
  document.getElementById('creationModeAdviceRetry').hidden = true;
  document.getElementById('creationModeAdviceRetry').textContent = '重新读取';
  document.getElementById('creationModeAdviceGoal').value = '';
  document.getElementById('creationModeAdviceExtra').value = '';
  setCreationAdviceStatus('正在读取正文与附件，附件会使用现有 OCR 功能；这可能需要一些时间…',true);
  if (!dialog.open) dialog.showModal();
  document.getElementById('creationModeAdviceHeading').focus({preventScroll:true});
  void prepareCreationReviewAdvice(state);
}

function retryCreationReviewSuggestion() {
  const state=creationReviewAdviceState;
  if(!state||state.busy)return;
  document.getElementById('creationModeAdviceRetry').hidden=true;
  void (state.sources?analyzeCreationReviewAdvice():prepareCreationReviewAdvice(state));
}

function adoptCreationReviewSuggestion() {
  const state=creationReviewAdviceState,method=state?.result?.review_method;
  if(!state||!Object.hasOwn(AI_SUGGESTABLE_METHODS,method))return;
  if(!Object.hasOwn(creationAdviceAllowedMethods(),method)){
    setCreationAdviceStatus('这个模式需要接入真实 AI API，当前不能采用。');
    return;
  }
  const select=reviewModeField(state.prefix,'ReviewMethod');
  if(!select)return;
  select.value=method;
  updateReviewMethodChoiceStatus(state.prefix,`已采用 AI 建议：${AI_REVIEW_METHODS[method]}。尚未保存内容。`);
  closeCreationReviewSuggestion();
}

function closeCreationReviewSuggestion() {
  const state=creationReviewAdviceState;
  if(state){state.cancelled=true;state.controller?.abort();}
  creationReviewAdviceState=null;
  const dialog=document.getElementById('creationModeAdviceDialog');
  if(dialog?.open)dialog.close();
  if(state?.trigger?.isConnected)state.trigger.focus({preventScroll:true});
}

addEventListener('pagehide',closeCreationReviewSuggestion);
