/* One manual editor and attempt UI for cloze/open-answer/reading; existing choice and standard stay intact. */
let reviewWorkbench=null;
const wb=name=>document.getElementById('reviewWb'+name);
const WORKBENCH_REQUIREMENTS={cloze:'填写完整原文，选中文字创建空位，答案自动记录',self_explain:'讲解任务、参考要点及可选评分量规',contrast:'至少两个比较对象、比较维度、关键异同与核对要点',reading:'阅读正文或片段',standard:'任务与参考答案或核对要点'};
function reviewModeSelectionKey(s){return `review-mode-selection:${s.courseId}:${s.sessionItemId}:${s.type}:${s.id}`;}
const reviewModeSelections=new Map();
function rememberReviewModeSelection(s,mode){
  if(!s.sessionItemId)return;
  reviewModeSelections.set(reviewModeSelectionKey(s),mode);mistakeStorageSet(reviewModeSelectionKey(s),mode);
}
// A newly saved resource preference replaces old unstarted session choices.
// Active attempts keep their own mode and answer snapshot until completed.
function clearResourceSessionChoices(s){
  if(!['material','note'].includes(s.type))return;
  const current=new RegExp('^review-mode-selection:'+s.courseId+':[^:]+:'+s.type+':'+s.id+'$');
  const legacy=new RegExp('^review-mode-selection:'+s.courseId+':'+s.type+':'+s.id+':[^:]+$');
  const matches=key=>current.test(key)||legacy.test(key);
  for(const key of reviewModeSelections.keys())if(matches(key))reviewModeSelections.delete(key);
  const keys=[];
  for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(matches(key))keys.push(key);}
  for(const key of keys)localStorage.removeItem(key);
}
function saveWorkbenchStandardMode(){
  const s=reviewWorkbench;if(!s||s.busy||s.sessionItemId||s.mode!=='standard'||!['material','note'].includes(s.type))return;
  try{
    if(!saveResourceAiMethod(s,'standard'))throw Error('复习方式未能保存到本浏览器，请重试');
    clearResourceSessionChoices(s);closeReviewWorkbench();showToast('已保存为标准复习');
  }catch(err){wb('Error').textContent=err.message;}
}
const RESOURCE_RETRY_MODES=['standard','cloze','self_explain','contrast'];
const resourceRetryKey=s=>`resource-retry-target:${s.courseId}:${s.type}:${s.id}`;
function resourceRetryMode(s){
  const saved=mistakeStorageGet(resourceRetryKey(s));
  const preferred=readReviewAiMethod(s);
  return [s.resourceRetryTarget,s.lastExecutableMode,saved?.mode,preferred,'standard'].find(mode=>RESOURCE_RETRY_MODES.includes(mode));
}
function saveResourceRetryMode(){
  const s=reviewWorkbench;if(!s||s.busy||s.sessionItemId||s.mode!=='retry'||!s.resourceRetryTarget)return;
  try{
    mistakeStorageSet(resourceRetryKey(s),{version:1,mode:s.resourceRetryTarget});
    if(mistakeStorageGet(resourceRetryKey(s))?.mode!==s.resourceRetryTarget||!saveResourceAiMethod(s,'retry'))throw Error('重新作答方式未能保存，请重试');
    clearResourceSessionChoices(s);closeReviewWorkbench();showToast('已保存为重新作答');
  }catch(err){wb('Error').textContent=err.message;}
}
async function prepareResourceRetryTask(){
  const s=reviewWorkbench;if(!s||s.busy||s.type==='mistake')return;
  s.modeChoice='retry';s.resourceRetryTarget='standard';
  await loadReviewWorkbenchMode('standard',false);
  if(reviewWorkbench!==s||!wb('Prompt'))return;
  wb('Mode').value='retry';
  wb('Prompt').closest('label').firstChild.textContent='题目（可编辑，已带入正文）';
  wb('Reference').closest('label').firstChild.textContent='参考答案 / 解析（必填）';
  wb('Rubric').closest('label').firstChild.textContent='判定要点（可选）';
  wb('Actions').querySelector('button').textContent=s.sessionItemId?'保存题目与答案并开始本轮':'保存题目、答案并使用重新作答';
  renderWorkbenchReadiness('draft','设置重新作答题目与参考答案；这与标准复习的记忆自评分开保存');
}
// A confirmed suggestion chooses a mode, never supplies its materials or a grade.
function recommendReviewMode(type,row={},explicit=null,ai=null){
  row=row||{};
  const confirmed=row.question_format_confirmed===1;
  let options=[];try{options=Array.isArray(row.options_json)?row.options_json:JSON.parse(row.options_json||'[]');}catch{}
  const choice=type==='mistake'&&confirmed&&row.question_format==='choice'&&Array.isArray(options)&&options.length>=2&&options.length<=26&&!!(row.choice_ready||row.correct_option);
  const alternatives=type!=='mistake'?['cloze','standard','self_explain','contrast','reading','retry']
    :[...(choice?['choice_reproduction']:[]),...(confirmed&&row.mistake_type==='execution'?['retry','standard']:['standard','retry']),
      ...(row.mistake_type==='knowledge'?['cloze']:row.mistake_type==='thinking'?['self_explain','contrast']:[]),'reading'];
  if(explicit&&Object.hasOwn(AI_REVIEW_METHODS,explicit))return {mode:explicit,source:'user',alternatives};
  if(ai&&Object.hasOwn(AI_REVIEW_METHODS,ai))return {mode:ai,source:'ai',alternatives};
  return {mode:'standard',source:'rule',alternatives};
}
function workbenchSelection(s){
  const explicit=readReviewModeChoice(s);
  const ai=typeof readReviewAiMethod==='function'?readReviewAiMethod(s):s.type==='mistake'&&typeof readMistakeAiMethod==='function'?readMistakeAiMethod(s):null;
  return recommendReviewMode(s.type,s.row||{},explicit,ai);
}

const REVIEW_MATERIAL_NEEDS=WORKBENCH_REQUIREMENTS;
// Preparation feedback only; the existing server remains the final material validator.
function workbenchMaterialMissing(mode,m={}){
  const missing=[],has=v=>typeof v==='string'&&!!v.trim();
  if(!has(m.prompt))missing.push(mode==='reading'?'阅读正文':'任务题面');
  if(mode==='cloze'){
    const blanks=Array.isArray(m.blanks)?m.blanks:[],ids=new Set();
    if(!blanks.length)missing.push('有效空位及答案');
    if(blanks.length>20)missing.push('空位数量过多');
    for(const b of blanks){
      if(!/^[A-Za-z][A-Za-z0-9_]{0,29}$/.test(b.id)||ids.has(b.id))missing.push('有效且不重复的空位编号');
      ids.add(b.id);
      if((m.prompt||'').split('【'+b.id+'】').length!==2)missing.push('题面中恰好一处【'+b.id+'】');
      if(!has(b.answer)||!b.answer.replace(/[\s\u3000，。；：、,.!?！？；：""''（）()\[\]【】]/g,''))missing.push('空位 '+(b.id||'未编号')+' 的有效答案');
    }
    for(const [,id]of (m.prompt||'').matchAll(/【([A-Za-z][A-Za-z0-9_]*)】/g))if(!ids.has(id))missing.push('空位 '+id+' 的答案设置');
  }else if(mode!=='reading'&&!has(m.reference))missing.push('参考答案或核对要点');
  if(mode==='contrast'){
    if((m.objects||[]).filter(has).length<2)missing.push('至少两个比较对象');
    if(!(m.dimensions||[]).some(has))missing.push('至少一个比较维度');
  }
  return [...new Set(missing)];
}
function renderWorkbenchReadiness(kind,message,missing=[]){
  const host=wb('Readiness');if(!host)return;
  host.dataset.materialState=kind;
  host.innerHTML='<strong>'+escapeHtml(message)+'</strong>'+(missing.length?'<ul>'+missing.map(v=>'<li>'+escapeHtml(v)+'</li>').join('')+'</ul>':'');
}
function updateWorkbenchPreparation(){
  const s=reviewWorkbench;if(!s||!wb('Prompt'))return;
  if(s.mode==='cloze'&&typeof refreshClozeEditor==='function')refreshClozeEditor();
  const missing=workbenchMaterialMissing(s.mode,readWorkbenchMaterial());
  if(s.mode==='cloze'){
    const host=wb('Readiness');
    if(host){
      host.dataset.materialState='hint';
      host.innerHTML='<p class="ai-help">可手动选字挖空，也可以使用 AI 生成后继续修改。</p>';
    }
    return;
  }
  renderWorkbenchReadiness('draft',missing.length?'还缺以下材料（当前输入只是草稿）':'草稿已填写；确认保存后才可以开始',missing);
}
async function prepareCenterSuggestedMaterial(){
  const owner=centerReview,item=currentCenterItem(),q=owner?.quickMode;
  if(!item||!q?.aiMode||q.busy||reviewWorkbench?.busy||centerReviewHasPendingSave()||quickModeHasPending(item,owner.session))return;
  await openReviewWorkbench(item.item_type,item.item_id,{...centerWorkbenchContext(item,owner.session),mode:q.aiMode});
  if(reviewWorkbench?.sessionItemId===item.id&&reviewWorkbench.mode===q.aiMode&&!q.ready&&wb('Actions').querySelector('[data-prepare-material]'))await editWorkbenchMaterial();
}
// Read both released key layouts; only explicit actions update the current key.
function legacyReviewSelectionKey(s){return `review-mode-selection:${s.courseId}:${s.type}:${s.id}:${s.sessionItemId||'prepare'}`;}
function reviewSelectionKey(s){return reviewModeSelectionKey(s);}
const reviewSelections=reviewModeSelections;
function rememberReviewSelection(s,mode){rememberReviewModeSelection(s,mode);}
function readReviewModeChoice(s){return s.modeChoice||reviewModeSelections.get(reviewModeSelectionKey(s))||mistakeStorageGet(reviewModeSelectionKey(s))||mistakeStorageGet(legacyReviewSelectionKey(s));}
function readReviewActive(s){return mistakeStorageGet(reviewModeSelectionKey(s)+':active')||mistakeStorageGet(legacyReviewSelectionKey(s)+':active');}
function writeReviewActive(s,value){mistakeStorageSet(reviewModeSelectionKey(s)+':active',value);mistakeStorageSet(legacyReviewSelectionKey(s)+':active',value);}
function centerWorkbenchContext(item,session){
  const row=item.item_type==='mistake'?mistakeDetailState?.row:activeReadingReview?.row;
  return {courseId:session.course_id,type:item.item_type,id:item.item_id,row,sessionItemId:item.id,sessionId:session.id,
    ...(item.plan_item_id?{planItemId:item.plan_item_id}:{}),sourceText:row?.content||row?.ocr_text||''};
}
async function routeCenterReviewMode(item,session){
  if(item.status!=='pending'||centerReviewHasPendingSave())return;
  const context=centerWorkbenchContext(item,session),active=readReviewActive(context),mode=active?.mode||workbenchSelection(context).mode;
  if(typeof reviewMethodRequiresRealAi==='function'&&reviewMethodRequiresRealAi(mode)
    &&!(typeof reviewMethodIsAvailable==='function'&&reviewMethodIsAvailable(mode)))return;
  // Resource standard/reading have native in-page flows and start immediately.
  if(item.item_type!=='mistake'&&['standard','reading'].includes(mode)&&!active?.viaRetry)return;
  await openReviewWorkbench(item.item_type,item.item_id,{...context,mode,retryExecution:!!active?.viaRetry});
  if(!reviewWorkbench||reviewWorkbench.sessionItemId!==item.id)return;
  if((item.item_type==='mistake'&&['standard','retry','choice_reproduction'].includes(mode))||mode==='retry'){
    await runExistingReviewMode();
    return;
  }
  // The bound mode is authoritative: an existing material starts without another confirmation.
  if(reviewWorkbench.version>0&&!reviewWorkbench.attempt)await startWorkbenchAttempt();
  else if(reviewWorkbench.version===0)await editWorkbenchMaterial();
}
// Only selects a flow; execution remains in the native controller / material workbench.
async function prepareCenterQuickMode(item,session){
  if(item.status!=='pending')return;
  const owner=centerReview,context=centerWorkbenchContext(item,session),record=item.item_type==='mistake'?readMistakeAiRecord(context):{method:readReviewAiMethod(context)},aiMode=record?.method;
  // No resource advice: preserve the original reading/settings entry and rule default.
  if(item.item_type!=='mistake'&&!aiMode)return;
  const originalKey=reviewSelectionKey(context)+':original-mode';
  const originalMode=mistakeStorageGet(originalKey)||mistakeStorageGet(legacyReviewSelectionKey(context)+':original-mode')||(item.item_type==='mistake'?mistakeDetailState?.progress?.mode?.id||'standard':'standard');
  mistakeStorageSet(originalKey,originalMode);
  const q={itemId:item.id,aiMode,originalMode,ready:false,modeId:originalMode,reason:'没有已确认的 AI 建议，沿用原复习。',busy:false};
  if(record?.needsReselection)q.reason='AI 建议无效或版本过旧，使用标准复习。';
  if(aiMode){
    if(item.item_type!=='mistake'&&['reading','standard'].includes(aiMode))q.ready=true;
    else if(item.item_type==='mistake'&&['standard','retry'].includes(aiMode))q.ready=!!mistakeDetailState?.progress?.reviewable;
    else if(aiMode==='choice_reproduction')q.ready=mistakeDetailState?.row?.question_format_confirmed===1&&mistakeDetailState.progress.mode.availableModes.some(m=>m.id===aiMode);
    else try{const materialMode=aiMode==='retry'?(readReviewActive(context)?.mode||'standard'):aiMode;const data=await(await requestApi(reviewWorkbenchBase(context)+'/materials/'+materialMode+'?view=practice')).json();q.ready=data.version>0&&!!data.material;}catch{q.reason='无法确认建议材料，暂用原复习；可从手动材料入口重试。';}
    if(q.ready)q.reason=item.item_type!=='mistake'&&aiMode==='standard'?'标准复习无需额外材料：先回忆，再选择清楚/模糊/不记得。':'可以直接开始：建议材料可用；点击确认开始后执行，不会自动评分。';
    else if(!q.reason.startsWith('无法'))q.reason=`${AI_REVIEW_METHODS[aiMode]}材料不完整：还需${REVIEW_MATERIAL_NEEDS[aiMode]||'原题、答案或已保存的可重做任务'}。可在本页手动准备，无需 AI。`;
  }
  const explicit=readReviewModeChoice(context);
  const active=readReviewActive(context);
  q.modeId=explicit&&Object.hasOwn(AI_REVIEW_METHODS,explicit)?explicit:aiMode||originalMode;
  // Restore a real in-progress flow without replacing it with a new default.
  if(active?.mode)q.modeId=active.viaRetry?'retry':active.mode;
  if(centerReview===owner&&currentCenterItem()?.id===item.id)owner.quickMode=q;
}
function syncCenterQuickMode(mode){
  const q=typeof centerReview!=='undefined'&&centerReview?.quickMode;
  if(q&&q.itemId===currentCenterItem()?.id&&Object.hasOwn(AI_REVIEW_METHODS,mode))q.modeId=mode;
}
function quickModeHasPending(item,session){
  const context=centerWorkbenchContext(item,session),active=readReviewActive(context);
  return !!reviewWorkbench?.pending||!!(active?.mode&&mistakeStorageGet(reviewWorkbenchKey({...context,mode:active.mode})+':pending'));
}
async function toggleCenterQuickMode(){
  const owner=centerReview,q=owner?.quickMode,item=currentCenterItem();if(!q||q.busy||q.itemId!==item?.id||centerReviewHasPendingSave()||reviewWorkbench?.busy)return;
  if(quickModeHasPending(item,owner.session)){showToast('有作答提交待确认，请从手动材料入口重试后再切换。');return;}
  if(!q.aiMode){showToast(q.reason);return;}
  // Closing preserves material/answer drafts; selecting a mode does not submit it.
  if(reviewWorkbench)closeReviewWorkbench();
  const context=centerWorkbenchContext(item,owner.session);
  q.modeId=q.modeId===q.aiMode?q.originalMode:q.aiMode;rememberReviewSelection(context,q.modeId);renderCenterReviewToolbar();
  if(q.modeId===q.aiMode&&!q.ready){await openReviewWorkbench(item.item_type,item.item_id,{...context,mode:q.aiMode});return;}
  await confirmCenterQuickMode();
}
async function confirmCenterQuickMode(){
  const owner=centerReview,q=owner?.quickMode,item=currentCenterItem();if(!q||q.busy||q.itemId!==item?.id||centerReviewHasPendingSave()||reviewWorkbench?.busy)return;
  if(quickModeHasPending(item,owner.session)){showToast('有作答提交待确认，请从手动材料入口重试后再开始。');return;}
  q.busy=true;renderCenterReviewToolbar();
  try{
    const selected=q.modeId;
    if(item.item_type!=='mistake'&&selected==='standard'){
      if(reviewWorkbench)closeReviewWorkbench();const context=centerWorkbenchContext(item,owner.session);
      rememberReviewSelection(context,'standard');writeReviewActive(context,null);q.ready=true;
      q.reason='标准复习无需额外材料：请先回忆，再选择清楚、模糊或不记得。';
      renderCenterReviewToolbar();return;
    }
    // Recheck availability on confirm, so a displayed label cannot start a stale/invalid mode.
    if(item.item_type!=='mistake'&&selected==='reading'){
      if(reviewWorkbench)closeReviewWorkbench();const context=centerWorkbenchContext(item,owner.session);
      rememberReviewSelection(context,'reading');writeReviewActive(context,null);q.reason='使用原阅读流程，仅记录曝光，不自动评分。';return;
    }
    if(selected===q.aiMode&&!(item.item_type==='mistake'&&['standard','retry','choice_reproduction'].includes(selected))&&selected!=='retry'){
      const context=centerWorkbenchContext(item,owner.session);let data=null;
      try{data=await(await requestApi(reviewWorkbenchBase(context)+'/materials/'+selected+'?view=practice')).json();}catch{}
      if(!data?.version||!data.material){
        q.ready=false;q.reason='建议材料无法确认或已不可用；请准备材料，或切换原复习。';
        if(centerReview===owner&&currentCenterItem()?.id===item.id)await openReviewWorkbench(item.item_type,item.item_id,{...context,mode:selected});
        return;
      }
    }
    if(centerReview!==owner||currentCenterItem()?.id!==item.id)return;
    const context=centerWorkbenchContext(item,owner.session);rememberReviewSelection(context,q.modeId);
    await openReviewWorkbench(item.item_type,item.item_id,{...context,mode:q.modeId});
    if(reviewWorkbench?.mode!==q.modeId)return;
    if(q.modeId==='retry'||item.item_type==='mistake'&&['standard','choice_reproduction'].includes(q.modeId))await runExistingReviewMode();
    else if(!reviewWorkbench.attempt)await startWorkbenchAttempt();
    else {writeReviewActive(context,{mode:reviewWorkbench.attempt.modeId});renderWorkbenchAttempt();}
  }catch(err){if(centerReview===owner)showToast('未开始复习：'+err.message);}
  finally{q.busy=false;if(centerReview===owner)renderCenterReviewToolbar();}
}
function renderWorkbenchInfo(s){
  const actual=s.retryExecution?'retry':s.attempt?.modeId||readReviewActive(s)?.mode||(s.type==='mistake'?mistakeDetailState?.progress?.mode?.id:'standard');
  const suggestion=readReviewAiMethod(s),selection=workbenchSelection(s);
  wb('Info').textContent=s.sessionItemId?`当前实际流程：${AI_REVIEW_METHODS[actual]||'尚未开始'}。待使用：${AI_REVIEW_METHODS[s.mode]}（${{user:'本次明确选择',ai:'已保存的选择，尚需本次采用',rule:'规则推荐'}[selection.source]}）。选择/准备不评分；开始本轮后才执行选中模式。切换不会改写历史、评分或计划；已完成项目请在记录中再次复习。`:'材料准备：手动填写即可，AI 可选。确认保存后从总复习或计划进入。';
  wb('Suggestion').innerHTML=s.sessionItemId&&suggestion?`<p>已保存的复习方式：${escapeHtml(AI_REVIEW_METHODS[suggestion])}；不等于已创建材料。</p>${s.mode===suggestion?'<p>本次已选用此方式，无需重复确认。</p>':'<button type="button" onclick="useWorkbenchSuggestion()">本次使用此方式（先检查材料）</button>'}`:'';
}
async function useWorkbenchSuggestion(){const s=reviewWorkbench,mode=s&&readReviewAiMethod(s);if(mode)await loadReviewWorkbenchMode(mode);}
function reviewWorkbenchBase(s=reviewWorkbench){return `${API}/courses/${s.courseId}/review-items/${s.type}/${s.id}`;}
function reviewWorkbenchKey(s=reviewWorkbench){return `review-workbench:${s.courseId}:${s.type}:${s.id}:${s.sessionItemId||'prepare'}:${s.mode}`;}
function ensureReviewWorkbench(){
  if(wb('Dialog'))return;
  const dialog=document.createElement('dialog');dialog.id='reviewWbDialog';dialog.className='review-workbench';
  dialog.innerHTML=`<div id="reviewWbPanel" class="review-workbench-content"><header id="reviewWbHeader"><h2>复习材料与作答</h2><button type="button" class="btn-cancel" onclick="closeReviewWorkbench()">关闭</button></header>
    <div class="review-workbench-body"><details id="reviewWbSettings" open><summary>复习设置 / 模式选择</summary><p id="reviewWbInfo" class="mistake-ai-note"></p>
    <div id="reviewWbSuggestion"></div><label>本次待使用的模式<select id="reviewWbMode" onchange="loadReviewWorkbenchMode(this.value)"></select></label>
    </details>
    <section id="reviewWbReadiness" role="status" aria-live="polite"></section><div id="reviewWbEditor"></div><div id="reviewWbAttempt"></div><p id="reviewWbError" role="alert" class="mistake-inline-error"></p></div>
    <footer id="reviewWbActions" class="modal-actions"></footer></div>`;
  document.body.append(dialog);dialog.addEventListener('cancel',event=>{event.preventDefault();closeReviewWorkbench();});
  wb('Editor').addEventListener('input',updateWorkbenchPreparation);
}
function saveWorkbenchAnswerDraft(){
  const s=reviewWorkbench;if(!s?.attempt||s.attempt.stage!=='question')return;
  const answer=s.attempt.modeId==='cloze'?Object.fromEntries([...wb('Attempt').querySelectorAll('[data-review-blank]')].map(n=>[n.dataset.reviewBlank,n.value])):s.attempt.modeId==='contrast'?JSON.stringify({kind:'contrast-v1',fields:Object.fromEntries([...wb('Attempt').querySelectorAll('[data-contrast-field]')].map(n=>[n.dataset.contrastField,n.value]))}):wb('Answer')?.value||'';
  mistakeStorageSet(reviewWorkbenchKey(s)+':answer:'+s.attempt.id,{answer});
}
function closeReviewWorkbench(refresh=true){
  if(reviewWorkbench?.busy)return;
  clearWorkbenchAutoAdvance(reviewWorkbench);
  if(reviewWorkbench&&typeof resetReviewFeedback==='function')resetReviewFeedback(reviewWorkbench);
  if(!reviewWorkbench?.pendingCreation){
    saveWorkbenchAnswerDraft();
    if(reviewWorkbench&&wb('Prompt')){
      const material=reviewWorkbench.aiDraft&&reviewWorkbench.beforeAi?reviewWorkbench.beforeAi:readWorkbenchMaterial();
      mistakeStorageSet(reviewWorkbenchKey()+':draft',material);
    }
  }
  if(wb('Panel'))wb('Dialog').append(wb('Panel'));
  wb('Dialog')?.close();if(wb('Inline'))wb('Inline').hidden=true;
  reviewWorkbench=null;
  if(refresh&&typeof centerReview!=='undefined'&&centerReview)renderCenterReviewToolbar();
}
function mountInlineReviewWorkbench(s){
  const anchor=document.getElementById(s.type==='mistake'?'mistakeReviewPanel':'materialReviewContent');
  if(!anchor)throw Error('当前复习页面尚未就绪，请返回队列重试');
  let host=wb('Inline');if(!host){host=document.createElement('section');host.id='reviewWbInline';host.className='review-workbench review-workbench-inline';host.setAttribute('aria-label','当前模式作答');}
  anchor.after(host);host.hidden=false;host.append(wb('Panel'));
  wb('Header').hidden=true;wb('Settings').open=false;wb('Settings').hidden=true;
}
async function openCenterReviewSettings(){
  const item=currentCenterItem(),owner=centerReview;if(!item||!owner)return;
  if(reviewWorkbench?.inline&&reviewWorkbench.sessionItemId===item.id){wb('Settings').open=!wb('Settings').open;return;}
  const context=centerWorkbenchContext(item,owner.session),mode=readReviewActive(context)?.mode||owner.quickMode?.modeId||workbenchSelection(context).mode;
  await openReviewWorkbench(item.item_type,item.item_id,{...context,mode,retryExecution:!!readReviewActive(context)?.viaRetry});
  if(reviewWorkbench?.sessionItemId===item.id)wb('Settings').open=true;
}
function mountReviewPreparation(host,type,row){
  let button=host.querySelector('[data-review-preparation]');if(!button){button=document.createElement('button');button.type='button';button.className='btn-cancel';button.dataset.reviewPreparation='';host.append(button);}
  button.textContent='复习材料管理（查看 / 手动 / 可选 AI）';button.onclick=()=>openReviewWorkbench(type,row.id,{row,sourceText:row.content||row.ocr_text||'',referenceText:row.answer_content||row.explanation||''});
}
async function openReviewWorkbench(type,id,context={}){
  if(reviewWorkbench?.busy)return;
  ensureReviewWorkbench();if(reviewWorkbench)closeReviewWorkbench();
  wb('Settings').hidden=false;
  const headerTitle=wb('Header')?.querySelector('h2');if(headerTitle)headerTitle.textContent='复习材料与作答';
  wb('Editor').innerHTML='';wb('Attempt').innerHTML='';
  const s={courseId:currentCourseId,type,id,version:0,busy:false,...context};s.inline=!!s.sessionItemId;reviewWorkbench=s;
  if(!s.row&&type==='mistake'&&mistakeDetailState?.id===id&&mistakeDetailState.courseId===s.courseId)s.row=mistakeDetailState.row;
  s.modeChoice=context.mode||null;s.mode=context.mode||workbenchSelection(s).mode;
  s.lastExecutableMode=readReviewActive(s)?.mode||null;
  const methods={...AI_REVIEW_METHODS};delete methods.choice_reproduction;
  wb('Mode').replaceChildren(...Object.entries(methods).map(([value,label])=>new Option(label,value)));
  wb('Mode').value=s.mode==='choice_reproduction'?'retry':s.mode;
  if(s.inline)mountInlineReviewWorkbench(s);
  else {wb('Dialog').append(wb('Panel'));wb('Header').hidden=false;wb('Settings').open=true;wb('Dialog').showModal();}
  await loadReviewWorkbenchMode(s.mode,false);
  if(s.inline&&typeof centerReview!=='undefined'&&centerReview)renderCenterReviewToolbar();
}
function wbInput(label,id,value='',rows=3){return `<label>${escapeHtml(label)}<textarea id="reviewWb${id}" rows="${rows}">${escapeHtml(value)}</textarea></label>`;}
function wbBlank(blank){return `<details class="edit-card review-blank"><summary>空位答案：${escapeHtml(blank.answer||'待填写')}</summary><input type="hidden" data-blank="id" value="${escapeHtml(blank.id)}"><label>答案<textarea data-blank="answer" rows="2">${escapeHtml(blank.answer||'')}</textarea></label><label>其他可接受答案（每行一个，可选）<textarea data-blank="aliases" rows="2">${escapeHtml((blank.aliases||[]).join('\n'))}</textarea></label><label>提示（可选）<input data-blank="hint" value="${escapeHtml(blank.hint||'')}"></label><button type="button" onclick="removeReviewBlank(this)">取消挖空，恢复文字</button></details>`;}
function addReviewBlank(){
  const ids=[...wb('Blanks').querySelectorAll('[data-blank="id"]')].map(n=>n.value);let n=1;while(ids.includes('b'+n))n++;
  wb('Blanks').insertAdjacentHTML('beforeend',wbBlank({id:'b'+n}));
  updateWorkbenchPreparation();
}
function removeReviewBlank(button){if(typeof rememberClozeEdit==='function')rememberClozeEdit();const row=button.closest('.review-blank'),id=row.querySelector('[data-blank="id"]').value,answer=row.querySelector('[data-blank="answer"]').value;wb('Prompt').value=wb('Prompt').value.split('【'+id+'】').join(answer);row.remove();updateWorkbenchPreparation();}
function readWorkbenchMaterial(){
  const s=reviewWorkbench;
  return {prompt:wb('Prompt').value,reference:wb('Reference')?.value||'',rubric:wb('Rubric')?.value||'',
    objects:(wb('Objects')?.value||'').split('\n').map(v=>v.trim()).filter(Boolean),dimensions:(wb('Dimensions')?.value||'').split('\n').map(v=>v.trim()).filter(Boolean),
    blanks:s.mode==='cloze'?[...wb('Blanks').querySelectorAll('.review-blank')].map(row=>Object.fromEntries(['id','answer','aliases','hint'].map(key=>{const v=row.querySelector('[data-blank="'+key+'"]').value;return [key,key==='aliases'?v.split('\n').map(x=>x.trim()).filter(Boolean):v];}))):[]};
}
async function loadReviewWorkbenchMode(mode,explicit=true){
  const s=reviewWorkbench;if(!s||s.busy)return;
  if(s.mode&&(mistakeStorageGet(reviewWorkbenchKey(s)+':pending')||s.pending)){wb('Error').textContent='有提交待确认，请先重试当前操作，再切换模式。';wb('Mode').value=s.mode;return;}
  saveWorkbenchAnswerDraft();
  if(s.mode && wb('Prompt'))mistakeStorageSet(reviewWorkbenchKey(s)+':draft',readWorkbenchMaterial());
  if(explicit){s.modeChoice=mode;s.retryExecution=false;rememberReviewSelection(s,mode);if(s.sessionItemId)syncCenterQuickMode(mode);s.editing=false;}
  s.aiDraft=null;s.beforeAi=null;
  s.mode=mode;s.startRequestId=null;s.attempt=null;s.pending=null;wb('Error').textContent='';wb('Editor').innerHTML='';wb('Attempt').innerHTML='';wb('Actions').innerHTML='';
  wb('Mode').value=mode==='choice_reproduction'||s.retryExecution&&mode==='standard'?'retry':mode;renderWorkbenchInfo(s);
  if(mode==='standard'&&s.type!=='mistake'&&readReviewModeChoice(s)!=='retry'&&!s.retryExecution){
    renderWorkbenchReadiness('ready','标准复习直接使用原正文和附件，无需准备参考要点或核对标准');
    wb('Editor').innerHTML='<p>先阅读资料或笔记，再回忆并选择“清楚”“模糊”或“不记得”。标准复习不需要另填任务、参考要点和核对标准。</p>';
    wb('Actions').innerHTML=(!s.sessionItemId?'<button type="button" onclick="saveWorkbenchStandardMode()">保存为标准复习</button>':'')+'<button type="button" onclick="closeReviewWorkbench()">返回复习</button>';
    return;
  }
  renderWorkbenchReadiness('checking','正在检查材料；不会创建轮次或评分…');
  if(mode==='retry'||mode==='choice_reproduction'||(mode==='standard'&&s.type==='mistake')){
    const incompatible=mode==='choice_reproduction'&&!recommendReviewMode(s.type,s.row||{}).alternatives.includes(mode);
    renderWorkbenchReadiness(incompatible?'missing':mode==='retry'&&s.type!=='mistake'?'checking':'ready',incompatible?'还缺已确认的选择题选项和正确答案':mode==='retry'&&s.type!=='mistake'?'开始前将检查已有任务；不会用通用输入框代替缺失材料':'使用已有原题和答案，无需额外创建材料');
    if(s.type==='mistake'&&mistakeDetailState?.id===s.id&&!mistakeDetailState.progress?.reviewable)renderWorkbenchReadiness('missing','还需在错题详情补齐原题、参考答案或题型信息；不需要另建专属材料');
    wb('Editor').textContent=incompatible?'当前缺少已确认且完整的选择题选项和正确答案。请在错题详情编辑题型，或明确切换标准复习。':mode==='retry'?'将隐藏旧作答、答案和解析，开启新轮次。复用已有流程和判分，旧轮次证据保留；不会覆盖历史。':'使用原题和答案，不需要额外材料。进入后先独立作答，再揭示答案并自评。切换原生模式会重新开始本轮，但不改变记忆状态。';
    wb('Actions').innerHTML=incompatible?'<p class="mistake-inline-error">当前绑定的选择题材料不完整，请先在内容编辑页补齐。</p>':s.sessionItemId?'<p>正在按该条内容绑定的复习模式进入…</p>':'<p>请从总复习或考前计划中运行。</p>';
    if(mode==='retry'&&s.type!=='mistake'){
      let showRetryEditor=false;
      s.busy=true;wb('Mode').disabled=true;
      try{
        const target=resourceRetryMode(s),data=await(await requestApi(reviewWorkbenchBase(s)+'/materials/'+target+'?view=practice')).json();
        if(reviewWorkbench!==s)return;
        s.resourceRetryTarget=data.version?target:null;
        showRetryEditor=!s.sessionItemId&&(!data.version||target==='standard');
        renderWorkbenchReadiness(data.version?'ready':'missing',data.version?'可以直接开始：复用已确认的'+AI_REVIEW_METHODS[target]+'材料':'还需设置重新作答的题目与参考答案；无需连接 AI');
        if(data.version&&!s.sessionItemId)wb('Actions').innerHTML='<button type="button" onclick="saveResourceRetryMode()">保存为重新作答</button><button type="button" onclick="prepareResourceRetryTask()">另设重新作答题目与答案</button>';
        if(!data.version){wb('Editor').textContent='正文或附件可以作为题面，但还需要你确认参考答案。保存后从复习入口开始作答；标准复习仍只需记忆自评。';wb('Actions').innerHTML='<button type="button" onclick="prepareResourceRetryTask()">设置重新作答题目与答案</button>';}
      }catch(err){if(reviewWorkbench===s){renderWorkbenchReadiness('error','无法确认已有任务；可重试或返回原阅读');wb('Error').textContent=err.message;wb('Actions').innerHTML='<button onclick="loadReviewWorkbenchMode(\'retry\',false)">重试检查</button><button onclick="switchWorkbenchToAvailableMode()">返回原阅读流程</button>';}}
      finally{if(reviewWorkbench===s){s.busy=false;wb('Mode').disabled=false;}}
      if(showRetryEditor&&reviewWorkbench===s)await prepareResourceRetryTask();
    }
    return;
  }
  s.busy=true;wb('Mode').disabled=true;
  if(s.inline)renderCenterReviewToolbar();
  try{
    const response=await requestApi(reviewWorkbenchBase(s)+'/materials/'+mode+(s.sessionItemId&&!s.editing?'?view=practice':''));const data=await response.json();if(reviewWorkbench!==s)return;s.version=data.version;
    if(s.sessionItemId&&!s.editing){
      const saved=mistakeStorageGet(reviewWorkbenchKey(s));
      if(saved?.attemptId){try{s.attempt=await (await requestApi(reviewWorkbenchBase(s)+'/attempts/'+encodeURIComponent(saved.attemptId))).json();}catch(err){if(!err.message.includes('404'))throw err;}}
      if(s.attempt){s.lastExecutableMode=s.attempt.modeId;renderWorkbenchReadiness('active','已有复习轮次，继续作答；新材料不会覆盖本轮快照');renderWorkbenchAttempt();}
      else {wb('Editor').textContent=data.version?'材料已准备，确认开始后将使用此模式的新轮次。':`缺少${AI_REVIEW_METHODS[mode]}正式材料：${REVIEW_MATERIAL_NEEDS[mode]}。保存 AI 建议不会创建这些材料。`;
        renderWorkbenchReadiness(data.version?'ready':'missing',data.version?'可以直接开始：已确认的正式材料可用':'还缺正式材料；保存建议不等于准备完成',data.version?[]:[REVIEW_MATERIAL_NEEDS[mode]]);
        wb('Actions').innerHTML=data.version?'<p>已载入该条内容绑定的模式，正在开始…</p>':'<button data-prepare-material onclick="editWorkbenchMaterial()">准备材料并开始</button>';}
    }else{
      const draft=mistakeStorageGet(reviewWorkbenchKey(s)+':draft');
      const saved=data.material||{prompt:s.sourceText||'',reference:s.referenceText||'',rubric:'',blanks:[]};const m=draft||saved;
      wb('Editor').innerHTML=(draft?'<p class="mistake-ai-note">已恢复本浏览器未确认草稿，尚未覆盖正式材料。</p>':'')+(mode==='cloze'?clozeEditorHtml(m):wbInput('任务 / 阅读正文','Prompt',m.prompt,5))
        +(mode==='cloze'?'':mode==='reading'?'':wbInput('参考要点 / 关键异同','Reference',m.reference)+wbInput('核对标准 / 评分量规','Rubric',m.rubric))
        +(mode==='contrast'?wbInput('对比对象（每行一个，至少两个）','Objects',(m.objects||[]).join('\n'))+wbInput('对比维度（每行一个）','Dimensions',(m.dimensions||[]).join('\n')):'')
        +reviewMaterialAiGeneratorHtml(mode);
      refreshWorkbenchAiAvailability();
      wb('Actions').innerHTML=s.sessionItemId?'<button data-save-start onclick="saveWorkbenchMaterial(true)">保存材料并开始本轮复习</button>':'<button onclick="saveWorkbenchMaterial()">确认并保存正式材料</button>';
      if(mode==='cloze')initClozeEditor();
      updateWorkbenchPreparation();
    }
  }catch(err){if(reviewWorkbench===s){renderWorkbenchReadiness('error','暂时无法确认材料；请重试，或使用原复习流程');wb('Error').textContent=err.message;wb('Actions').innerHTML='<button onclick="loadReviewWorkbenchMode(reviewWorkbench.mode,false)">重新加载</button><button onclick="switchWorkbenchToAvailableMode()">返回原复习流程</button>';}}
  finally{if(reviewWorkbench===s){s.busy=false;wb('Mode').disabled=false;if(s.inline)renderCenterReviewToolbar();}}
}
async function saveWorkbenchMaterial(startAfterSave=false){
  const s=reviewWorkbench;if(!s||s.busy||(s.sessionItemId&&!s.editing))return;s.busy=true;wb('Error').textContent='';const material=readWorkbenchMaterial();
  if(s.aiDraft&&s.beforeAi){
    s.busy=false;wb('Error').textContent='请先明确选择“采纳”或“不采纳”本次 AI 生成结果。';return;
  }
  mistakeStorageSet(reviewWorkbenchKey(s)+':draft',material);
  const missing=workbenchMaterialMissing(s.mode,material);
  if(missing.length){s.busy=false;updateWorkbenchPreparation();wb('Error').textContent='请先补齐上方材料；输入已保留，尚未保存或开始。';return;}
  try{
    const data=await (await requestApi(reviewWorkbenchBase(s)+'/materials/'+s.mode,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:s.version,confirmed:true,material})})).json();
    if(reviewWorkbench!==s)return;s.version=data.version;mistakeStorageSet(reviewWorkbenchKey(s)+':draft',null);
    if(typeof updateResourceAiActions==='function')void updateResourceAiActions();
    if(!s.sessionItemId){
      if(['material','note'].includes(s.type)){
        const retry=s.mode==='standard'&&s.modeChoice==='retry';
        if(retry){
          mistakeStorageSet(resourceRetryKey(s),{version:1,mode:'standard'});
          if(mistakeStorageGet(resourceRetryKey(s))?.mode!=='standard')throw Error('材料已保存，但重新作答方式未能保存，请重试');
        }
        if(!saveResourceAiMethod(s,retry?'retry':s.mode))throw Error('材料已保存，但复习方式未能保存到本浏览器，请重试');
        clearResourceSessionChoices(s);
      }
      // Do not let close() re-create the just-confirmed form as an unsaved draft.
      wb('Editor').innerHTML='';s.busy=false;closeReviewWorkbench();showToast('保存成功');return;
    }
    showToast('保存成功；未更改 AI 建议或评分');
    if(s.sessionItemId&&currentCenterItem()?.id===s.sessionItemId)await prepareCenterQuickMode(currentCenterItem(),centerReview.session);
    renderWorkbenchReadiness('ready','正式材料已保存，可以开始；尚未作答或评分');
    if(s.sessionItemId){s.editing=false;s.busy=false;wb('Editor').innerHTML='';await loadReviewWorkbenchMode(s.mode,false);if(startAfterSave&&reviewWorkbench===s&&!s.attempt&&s.version)await startWorkbenchAttempt();}
  }catch(err){if(reviewWorkbench===s)wb('Error').textContent=err.message+'；输入已保留，未声称保存成功。';}
  finally{if(reviewWorkbench===s)s.busy=false;}
}
async function editWorkbenchMaterial(){const s=reviewWorkbench;if(!s||s.busy)return;s.editing=true;await loadReviewWorkbenchMode(s.mode,false);}
async function switchWorkbenchToAvailableMode(){
  const s=reviewWorkbench;if(!s||s.busy)return;
  if(s.type==='mistake')return loadReviewWorkbenchMode('standard');
  rememberReviewSelection(s,'reading');writeReviewActive(s,null);closeReviewWorkbench();
}
async function startWorkbenchAttempt(){
  const s=reviewWorkbench;if(!s||s.busy||!s.sessionItemId)return;s.busy=true;wb('Error').textContent='';
  if(s.type==='mistake'&&(mistakeDetailState?.pending||mistakeStorageGet(mistakePendingKey(mistakeDetailState)))){s.busy=false;wb('Error').textContent='原流程有提交待确认，请先返回并重试。';return;}
  s.startRequestId ||= reviewRequestId();
  try{
    const body={modeId:s.mode,expectedMaterialVersion:s.version,requestId:s.startRequestId,sessionItemId:s.sessionItemId};if(s.planItemId)body.planItemId=s.planItemId;
    const attempt=await (await requestApi(reviewWorkbenchBase(s)+'/attempts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
    if(reviewWorkbench!==s)return;s.attempt=attempt;s.lastExecutableMode=attempt.modeId;rememberReviewSelection(s,s.retryExecution?'retry':attempt.modeId);syncCenterQuickMode(s.retryExecution?'retry':attempt.modeId);writeReviewActive(s,{mode:attempt.modeId,...(s.retryExecution?{viaRetry:true}:{})});mistakeStorageSet(reviewWorkbenchKey(s),{attemptId:attempt.id});renderWorkbenchAttempt();
  }catch(err){if(reviewWorkbench===s)wb('Error').textContent=err.message;}
  finally{if(reviewWorkbench===s)s.busy=false;}
}
const REVIEW_ANSWER_IGNORED=/[\s\u3000，。；：、,.!?！？；：""''（）()\[\]【】]/;
function reviewAnswerTokens(value){
  return Array.from(String(value??'').toLowerCase()).filter(char=>!REVIEW_ANSWER_IGNORED.test(char));
}
function reviewAnswerMatchMask(answer,input){
  const chars=Array.from(String(answer??'')),tokens=chars.map((char,index)=>({char,index})).filter(item=>!REVIEW_ANSWER_IGNORED.test(item.char));
  const expected=tokens.map(item=>item.char.toLowerCase()),actual=reviewAnswerTokens(input),rows=expected.length+1,cols=actual.length+1;
  const table=Array.from({length:rows},()=>new Uint16Array(cols));
  for(let i=1;i<rows;i++)for(let j=1;j<cols;j++){
    table[i][j]=expected[i-1]===actual[j-1]?table[i-1][j-1]+1:Math.max(table[i-1][j],table[i][j-1]);
  }
  const matched=new Set();let i=expected.length,j=actual.length;
  while(i>0&&j>0){
    if(expected[i-1]===actual[j-1]){matched.add(tokens[i-1].index);i--;j--;}
    else if(table[i-1][j]>=table[i][j-1])i--;
    else j--;
  }
  return matched;
}
function reviewAnswerDiffHtml(answer,input,correct){
  const value=String(answer||'');
  if(correct)return `<span class="review-answer-all-correct">${escapeHtml(value)}</span>`;
  const matched=reviewAnswerMatchMask(value,input);
  return Array.from(value).map((char,index)=>{
    if(REVIEW_ANSWER_IGNORED.test(char)||matched.has(index))return `<span class="review-answer-hit">${escapeHtml(char)}</span>`;
    return `<span class="review-answer-miss">${escapeHtml(char)}</span>`;
  }).join('');
}
function workbenchClozeHtml(p,pending){
  const m=p.material;
  return '<div class="review-cloze-text" data-cloze-prompt>'+m.prompt.split(/(【[A-Za-z][A-Za-z0-9_]*】)/g).map(part=>{
    const b=m.blanks.find(b=>part==='【'+b.id+'】');if(!b)return escapeHtml(part);
    if(p.stage==='question')return `<label class="review-inline-blank"><span class="sr-only">${escapeHtml(b.id)} ${escapeHtml(b.hint)}</span><input data-review-blank="${escapeHtml(b.id)}" aria-label="${escapeHtml(b.id+' '+b.hint)}" placeholder="${escapeHtml(b.hint||b.id)}" value="${escapeHtml(pending?.answer?.[b.id]||'')}" autocomplete="off" maxlength="2000"></label>`;
    const correct=p.result?.results.some(r=>r.id===b.id&&r.correct);
    const submitted=String(p.firstAnswer?.[b.id]||''),unanswered=!submitted.trim();
    return `<span class="review-blank-result ${correct?'is-correct':'is-wrong'}" data-blank-result="${escapeHtml(b.id)}"><span class="review-blank-submitted">${escapeHtml(unanswered?'（未作答）':submitted)}</span> · <strong class="review-result-status">${unanswered?'未作答，按不会记录':correct?'正确':'错误'}</strong>（答案：<span class="review-answer-diff">${reviewAnswerDiffHtml(b.answer,submitted,correct)}</span>${b.aliases.length?'；别名：'+escapeHtml(b.aliases.join('、')):''}）</span>`;
  }).join('')+'</div>';
}
function workbenchContrastHtml(m,answer='',readonly=false){
  let values={};try{const parsed=JSON.parse(answer);if(parsed?.kind==='contrast-v1'&&parsed.fields&&typeof parsed.fields==='object')values=parsed.fields;}catch{}
  const field=(key,label)=>`<label>${escapeHtml(label)}<textarea data-contrast-field="${key}" rows="3" maxlength="3000" ${readonly?'readonly':''}>${escapeHtml(values[key]||'')}</textarea></label>`;
  return `<section data-contrast-task><h4>比较对象：${escapeHtml(m.objects.join(' / '))}</h4><div class="review-contrast-scroll"><table><caption>逐维度独立比较</caption><thead><tr><th>维度</th>${m.objects.map(o=>'<th scope="col">'+escapeHtml(o)+'</th>').join('')}</tr></thead><tbody>${m.dimensions.map((d,i)=>`<tr><th scope="row">${escapeHtml(d)}</th>${m.objects.map((o,j)=>`<td>${field('d'+i+'o'+j,o+' · '+d)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="review-contrast-summary">${[['same','相同点'],['different','不同点'],['conditions','适用条件 / 反例'],['pitfalls','易混点 / 易错点']].map(([key,label])=>field(key,label)).join('')}</div>${readonly&&!Object.keys(values).length?'<p>旧版首次作答：'+escapeHtml(answer)+'</p>':''}</section>`;
}
function workbenchResultField(title,body,attributes=''){
  return `<section class="review-result-field"><h4>${escapeHtml(title)}</h4><div class="detail-content" ${attributes}>${body}</div></section>`;
}
function workbenchCheckpoints(p){
  const points=(p.material.reference+'\n'+p.material.rubric).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const checked=mistakeStorageGet(reviewWorkbenchKey()+':checkpoints:'+p.id)||[];
  return `<section class="review-result-field review-checkpoint-field"><h4>逐项核对 <small>（不自动判分）</small></h4><fieldset class="review-checkpoint-card" data-review-checkpoints aria-label="逐项核对，不自动判分"><div class="review-checkpoint-list">${points.map((point,i)=>`<label class="review-check"><input type="checkbox" data-review-checkpoint="${i}" ${checked.includes(i)?'checked':''} onchange="saveWorkbenchCheckpoints()"><span>${escapeHtml(point)}</span></label>`).join('')}</div></fieldset></section>`;
}
function saveWorkbenchCheckpoints(){const s=reviewWorkbench;if(s?.attempt)mistakeStorageSet(reviewWorkbenchKey(s)+':checkpoints:'+s.attempt.id,[...wb('Attempt').querySelectorAll('[data-review-checkpoint]:checked')].map(n=>Number(n.dataset.reviewCheckpoint)));}
function renderWorkbenchAttempt(){
  clearWorkbenchAutoAdvance(reviewWorkbench);
  renderWorkbenchReadiness('active','当前执行已确认材料的复习轮次；评分仍使用原有规则');
  const s=reviewWorkbench,p=s.attempt,m=p.material;wb('Editor').innerHTML='';
  let pending=mistakeStorageGet(reviewWorkbenchKey(s)+':pending')||s.pending;
  if(pending&&pending.expectedVersion<p.version){mistakeStorageSet(reviewWorkbenchKey(s)+':pending',null);s.pending=null;pending=null;}
  pending ||= mistakeStorageGet(reviewWorkbenchKey(s)+':answer:'+p.id);
  renderWorkbenchInfo(s);
  let content=`<h3 data-executing-mode="${escapeHtml(p.modeId)}">实际执行：${escapeHtml(AI_REVIEW_METHODS[s.retryExecution?'retry':p.modeId])}</h3>`;
  if(p.modeId==='cloze')content+=workbenchClozeHtml(p,pending);
  else content+=`<${p.modeId==='reading'?'article':'div'} class="${p.modeId==='reading'?'review-reading-body':'detail-content'}">${escapeHtml(m.prompt)}</${p.modeId==='reading'?'article':'div'}>`;
  if(p.stage==='question'){
    if(p.modeId==='contrast')content+=workbenchContrastHtml(m,pending?.answer);
    else if(p.modeId==='reading')content+='<p>只记录阅读曝光，不评标准答案，不计为“已掌握”，不完成掌握型任务。</p>'+wbInput('可选：一句话总结 / 疑问','Answer',pending?.answer||'',2)+'<label class="review-check"><input id="reviewWbReadComplete" type="checkbox"><span>我已完成本段阅读</span></label>';
    else if(p.modeId!=='cloze')content+=`<p>${p.modeId==='self_explain'?'用自己的话解释概念、原因、例子；提交后才能查看要点与量规。':'先独立回忆或解题；提交后查看参考答案，自评最高为“基本掌握”。'}</p>`+wbInput(p.modeId==='self_explain'?'我的讲解（概念、原因与例子）':'看答案前的独立作答 / 回忆','Answer',typeof pending?.answer==='string'?pending.answer:'',p.modeId==='self_explain'?10:5);
    if(p.modeId!=='reading')content+='<p class="ai-help">留空提交按不会记录；部分作答会保留，空白项按未答处理。离开页面不会自动提交。</p>';
    wb('Actions').innerHTML=`<button onclick="submitWorkbenchAttempt('${p.modeId==='reading'?'complete':'submit'}')">${p.modeId==='reading'?'记录阅读曝光（不评分）':'提交作答'}</button>`
      +(!['reading','cloze'].includes(p.modeId)?'<button onclick="submitWorkbenchAttempt(\'submit\',undefined,true)">不会，查看参考</button>':'');
  }else{
    if(p.result?.unanswered)content+='<p class="ai-help" data-unanswered>本轮未作答，按不会记录。可对照参考学习，再开始新一轮尝试；本轮不提供 AI 批改。</p>';
    if(p.modeId==='contrast'&&!p.result?.unanswered)content+=workbenchContrastHtml(m,p.firstAnswer,true);
    else if(p.modeId!=='cloze')content+=workbenchResultField(p.modeId==='reading'?'阅读记录':'我的作答',escapeHtml(p.result?.unanswered?'（未作答）':p.firstAnswer||'（无）'));
    if(!['cloze','reading'].includes(p.modeId))content+=workbenchResultField('参考解释 / 知识要点',escapeHtml(m.reference||''),'data-review-reference')+workbenchResultField('评分量规',escapeHtml(m.rubric||'未另设量规，请核对参考要点'))+(['self_explain','contrast'].includes(p.modeId)?workbenchCheckpoints(p):'');
    wb('Actions').innerHTML=p.stage==='answer'?'<p>本轮已查看参考答案，自评可选“未掌握”或“基本掌握”。</p><button onclick="submitWorkbenchAttempt(\'judge\',1)">未掌握</button><button onclick="submitWorkbenchAttempt(\'judge\',2)">基本掌握</button>':'';
    if(p.stage==='completed'){
      const gradeClass=p.grade===null?'is-neutral':p.grade>=2?'is-correct':'is-wrong';
      content+=`<p class="review-saved-result ${gradeClass}">${p.grade===null?'已记录曝光，未产生评分':`已保存评分：${['','未掌握','基本掌握','已掌握','熟练掌握'][p.grade]}`} · ${p.durationMs} ms</p>`;
    }
  }
  wb('Attempt').innerHTML=content;
  if(typeof mountWorkbenchFeedback==='function')mountWorkbenchFeedback(s);
  if(p.stage==='completed'){
    if(workbenchNeedsAnswerReading(p)){
      clearWorkbenchAutoAdvance(s);
      if(s.sessionId&&s.sessionItemId)wb('Actions').innerHTML='<p>已按未掌握保存，请对照答案和解析学习，阅读后再继续。</p><button onclick="finishWorkbenchAttempt()">看完了，继续复习</button>';
    }else if(scheduleWorkbenchAutoAdvance(s))wb('Actions').innerHTML='<p class="review-auto-next" role="status" aria-live="polite">结果已保存，正在进入下一项…</p>';
  }
}
function workbenchNeedsAnswerReading(p){return !!(p?.result?.unanswered||p?.result?.results?.some(row=>row.unanswered));}
function clearWorkbenchAutoAdvance(s=reviewWorkbench){
  if(s?.autoAdvanceTimer){clearTimeout(s.autoAdvanceTimer);s.autoAdvanceTimer=null;}
}
function scheduleWorkbenchAutoAdvance(s){
  if(workbenchNeedsAnswerReading(s?.attempt)){clearWorkbenchAutoAdvance(s);return false;}
  if(!s?.sessionId||!s.sessionItemId||typeof centerReview==='undefined'||!centerReview||centerReview.session.id!==s.sessionId)return false;
  clearWorkbenchAutoAdvance(s);
  s.autoAdvanceTimer=setTimeout(()=>{
    s.autoAdvanceTimer=null;
    if(reviewWorkbench===s&&s.attempt?.stage==='completed'&&!s.busy)void finishWorkbenchAttempt();
  },1800);
  return true;
}
async function submitWorkbenchAttempt(action,grade,unanswered=false){
  const s=reviewWorkbench;if(!s?.attempt||s.busy)return;
  const key=reviewWorkbenchKey(s),saved=mistakeStorageGet(key+':pending')||s.pending;
  const body=saved||{action,requestId:reviewRequestId(),expectedVersion:s.attempt.version,durationMs:Math.max(1,Math.min(86400000,Date.now()-Date.parse(s.attempt.startedAt)))};
  if(!saved){
    if(action==='judge')body.grade=grade;
    else if(s.attempt.modeId==='cloze')body.answer=Object.fromEntries([...wb('Attempt').querySelectorAll('[data-review-blank]')].map(n=>[n.dataset.reviewBlank,n.value]));
    else if(s.attempt.modeId==='contrast'){
      const fields=Object.fromEntries([...wb('Attempt').querySelectorAll('[data-contrast-field]')].map(n=>[n.dataset.contrastField,n.value]));
      body.answer=JSON.stringify({kind:'contrast-v1',fields});
    }else{
      if(action==='complete'&&!wb('ReadComplete')?.checked){wb('Error').textContent='请先勾选已完成阅读；总结可留空。';return;}
      body.answer=wb('Answer').value;
    }
    if(unanswered&&action==='submit')body.answer='';
    mistakeStorageSet(key+':pending',body);s.pending=body;
  }
  s.busy=true;wb('Error').textContent='';
  try{
    const attempt=await (await requestApi(reviewWorkbenchBase(s)+'/attempts/'+encodeURIComponent(s.attempt.id)+'/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s.pending||body)})).json();
    if(reviewWorkbench!==s)return;s.attempt=attempt;s.pending=null;mistakeStorageSet(key+':pending',null);renderWorkbenchAttempt();
  }catch(err){if(reviewWorkbench===s){wb('Error').textContent=err.message+'；输入已保留，请重试。';if(err.status&&err.status<500){s.pending=null;mistakeStorageSet(key+':pending',null);if(err.status===409)wb('Actions').insertAdjacentHTML('beforeend','<button onclick="loadReviewWorkbenchMode(reviewWorkbench.mode)">重新核对服务器步骤</button>');}}}
  finally{if(reviewWorkbench===s)s.busy=false;}
}
async function finishWorkbenchAttempt(){
  const s=reviewWorkbench;if(!s||s.busy)return;s.busy=true;
  clearWorkbenchAutoAdvance(s);
  try{
    if(s.sessionId){const session=await(await requestApi(`${API}/courses/${s.courseId}/review-sessions/${s.sessionId}`)).json();if(!session.pending)await recordedReviewAction(s.sessionId,'finish');}
    s.busy=false;closeReviewWorkbench();if(centerReview)await centerReviewItemFinished();
  }catch(err){wb('Error').textContent=err.message;}finally{if(reviewWorkbench===s)s.busy=false;}
}
async function runExistingReviewMode(){
  const s=reviewWorkbench;if(!s?.sessionItemId||s.busy)return;
  if(s.type==='mistake'&&(mistakeDetailState?.pending||mistakeStorageGet(mistakePendingKey(mistakeDetailState)))){wb('Error').textContent='原流程有提交待确认，请先返回重试。';return;}
  if(s.mode==='retry'&&(s.type==='mistake'?s.lastExecutableMode:s.resourceRetryTarget)){
    // A completed task must use the existing repeat-session action, not lose its restore pointer.
    if(s.sessionId){
      s.busy=true;
      try{const session=await(await requestApi(`${API}/courses/${s.courseId}/review-sessions/${s.sessionId}`)).json();if(reviewWorkbench!==s)return;if(session.items.find(item=>item.id===s.sessionItemId)?.status!=='pending'){wb('Error').textContent='本项目已处理。请返回队列，在复习记录点击“再次复习”创建新会话；旧轮次仍保留。';return;}}
      catch(err){wb('Error').textContent=err.message;return;}finally{if(reviewWorkbench===s)s.busy=false;}
    }
    const target=s.type==='mistake'?s.lastExecutableMode:s.resourceRetryTarget,targetState={...s,mode:target};
    if(mistakeStorageGet(reviewWorkbenchKey(targetState)+':pending')){wb('Error').textContent='旧轮次有待确认提交，请先返回该模式重试，不能丢弃。';return;}
    s.retryExecution=s.type!=='mistake';s.mode=target;wb('Mode').value=target;mistakeStorageSet(reviewWorkbenchKey(s),null);
    await loadReviewWorkbenchMode(target,false);if(s.version)await startWorkbenchAttempt();return;
  }
  if(s.type!=='mistake'){
    await loadReviewWorkbenchMode('retry',false);
    return;
  }
  s.busy=true;
  try{
    const state=mistakeDetailState;if(state?.id!==s.id||state.sessionItemId!==s.sessionItemId)throw Error('当前项目已变化，请返回队列重新进入');
    const target=s.mode==='retry'?(state.progress.mode.availableModes.some(m=>m.id==='choice_reproduction')?'choice_reproduction':'standard'):s.mode;
    if(state.progress.mode.id!==target){await requestApi(`${API}/courses/${s.courseId}/mistakes/${s.id}/mode`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({modeId:target})});state.firstAnswerDraft='';document.getElementById('mistakeFirstAnswer')?.remove();}
    await refreshMistakeReview(state);
    if(!state.progress?.reviewable)throw Error('请先在错题详情补齐题目和参考答案');
    if(s.mode==='retry'||state.progress.allowedActions.includes('start'))await submitMistakeReview(s.mode==='retry'&&state.progress.allowedActions.includes('restart')?'restart':'start');
    if(state.pending||mistakeStorageGet(mistakePendingKey(state)))throw Error('本轮操作尚未确认，请返回原流程重试');
    if(mistakeQueueCurrent(state)){mistakeQueue.rounds[state.id]=state.progress.round;saveMistakeQueue();}
    rememberReviewSelection(s,s.mode);syncCenterQuickMode(s.mode);writeReviewActive(s,null);mistakeStorageSet(reviewSelectionKey(s)+':native-mode',s.mode);
    s.busy=false;closeReviewWorkbench();
  }catch(err){wb('Error').textContent=err.message;}finally{if(reviewWorkbench===s)s.busy=false;}
}
async function requestWorkbenchDraft(useShared=false){
  const s=reviewWorkbench;if(!s||s.busy||(s.sessionItemId&&!s.editing))return;s.busy=true;wb('Error').textContent='';
  refreshWorkbenchAiAvailability();
  let credentials;
  try{
    const input=readWorkbenchMaterial();let source=input.prompt;
    if(s.mode==='cloze'){
      for(const blank of input.blanks)if(blank.answer.trim())source=source.split('【'+blank.id+'】').join(blank.answer);
      if(/【[A-Za-z][A-Za-z0-9_]*】/.test(source))throw new Error('请先补齐空位答案，或使用原文生成草稿；手动编辑仍可继续');
    }
    if(useShared&&(!source.trim()||source.length>4000||input.reference.length>4000))throw new Error('请先选择并校对不超过 4000 字符的题面和参考文字；不会读取附件或静默截断。');
    const realInput={kind:s.type,mode_id:s.mode,content:source,reference:input.reference};
    if(useShared&&new TextEncoder().encode(JSON.stringify(realInput)).length>15000)throw new Error('本次文字过多，请缩小材料片段后生成。');
    if(useShared&&!coursesAiSettings.realReady())throw new Error('需要接入真实 AI API，请先打开“AI 设置”完成配置。');
    if(useShared)credentials=coursesAiSettings.read();
    wb('DraftStatus').textContent=credentials?'正在请求 '+coursesAiSettings.describe(credentials)+'（可能计费）；不会自动采用，请稍候…':'正在生成 Mock 演示草稿，不调用真实模型…';
    s.draftController=new AbortController();
    refreshWorkbenchAiAvailability();
    let draft;
    if(credentials){
      const pending=fetchReviewMaterialDraft(realInput,credentials,s.draftController.signal);credentials.apiKey='';draft=await pending;
    }else draft=await(await requestApi(API+'/ai/review-draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modeId:s.mode,text:source}),signal:AbortSignal.any([s.draftController.signal,AbortSignal.timeout(20000)])})).json();
    if(reviewWorkbench!==s)return;
    if(s.draftController.signal.aborted)throw new Error('生成已取消，未采用任何内容');
    // Independent editable preview. Nothing in the user's form is replaced automatically.
    s.aiDraft=draft.material;s.aiDraftReal=!!credentials;s.aiDraftSource=coursesAiSettings.describe(credentials);
    renderEditableReviewDraft(s,draft);
    wb('DraftStatus').textContent=draft.material?'草稿已生成，原材料未改动；请编辑、核实后明确采用。':'信息不足，未生成可采用材料；请补充文字或手动准备。';
    if(!draft.material)wb('Error').textContent='信息不足，未生成可采用材料；请按提示补充，或继续手动准备。';
  }catch(err){if(reviewWorkbench===s){wb('Error').textContent=err.message+'；手动输入保留，可直接手动保存。';wb('DraftStatus').textContent='生成未完成，不自动重试或回退 Mock；原输入和已有草稿保留。';}}
  finally{if(credentials)credentials.apiKey='';if(reviewWorkbench===s){s.busy=false;s.draftController=null;refreshWorkbenchAiAvailability();}}
}
async function adoptWorkbenchDraft(replace){
  const s=reviewWorkbench;if(!s?.aiDraft||s.busy)return;
  if(s.aiDraftReal&&!wb('DraftAccept')?.checked){wb('Error').textContent='请先核实或编辑 AI 草稿并勾选确认；原输入未改变。';return;}
  const edited=readEditedReviewDraft(s);
  if(!validReviewMaterialDraft(s.mode,edited)){wb('Error').textContent='草稿格式或必需材料不完整，请核对题面、空位与参考要点；原输入未改变。';return;}
  if(replace&&!await showConfirm('将替换当前表单但不保存。原表单将保留，可撤回。是否继续？','采用 AI 草稿'))return;
  if(reviewWorkbench!==s)return;
  const m=edited;s.beforeAi=readWorkbenchMaterial();
  for(const [name,value] of [['Prompt',m.prompt],['Reference',m.reference],['Rubric',m.rubric],['Objects',(m.objects||[]).join('\n')],['Dimensions',(m.dimensions||[]).join('\n')]])if(wb(name)&&(replace||!wb(name).value.trim()))wb(name).value=value||'';
  // Blank rows must match the adopted prompt; never append unmatched blanks to user text.
  if(wb('Blanks')&&(replace||!s.beforeAi.prompt.trim()))wb('Blanks').innerHTML=(m.blanks||[]).map(wbBlank).join('');
  wb('Draft').insertAdjacentHTML('beforeend','<button type="button" onclick="undoWorkbenchDraft()">撤回采用，恢复原稿</button>');
  updateWorkbenchPreparation();
  if(wb('DraftAccept'))wb('DraftAccept').checked=false;
}
function undoWorkbenchDraft(){
  const s=reviewWorkbench,m=s?.beforeAi;if(!m)return;
  for(const [name,value] of [['Prompt',m.prompt],['Reference',m.reference],['Rubric',m.rubric],['Objects',(m.objects||[]).join('\n')],['Dimensions',(m.dimensions||[]).join('\n')]])if(wb(name))wb(name).value=value||'';
  if(wb('Blanks'))wb('Blanks').innerHTML=m.blanks.map(wbBlank).join('');s.beforeAi=null;
  updateWorkbenchPreparation();
}
