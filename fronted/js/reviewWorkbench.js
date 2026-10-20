/* One manual editor and attempt UI for cloze/open-answer/reading; existing choice and standard stay intact. */
let reviewWorkbench=null;
const wb=name=>document.getElementById('reviewWb'+name);
const WORKBENCH_REQUIREMENTS={cloze:'挖空题面、空位编号、每个空位的答案及可选别名',self_explain:'讲解任务、参考要点及可选评分量规',contrast:'至少两个比较对象、比较维度、关键异同与核对要点',reading:'阅读正文或片段',standard:'任务与参考答案或核对要点'};
function reviewModeSelectionKey(s){return `review-mode-selection:${s.courseId}:${s.sessionItemId}:${s.type}:${s.id}`;}
const reviewModeSelections=new Map();
function rememberReviewModeSelection(s,mode){
  if(!s.sessionItemId)return;
  reviewModeSelections.set(reviewModeSelectionKey(s),mode);mistakeStorageSet(reviewModeSelectionKey(s),mode);
}
// A confirmed suggestion chooses a mode, never supplies its materials or a grade.
function recommendReviewMode(type,row={},explicit=null,ai=null){
  const confirmed=row.question_format_confirmed===1;
  let options=[];try{options=Array.isArray(row.options_json)?row.options_json:JSON.parse(row.options_json||'[]');}catch{}
  const choice=type==='mistake'&&confirmed&&row.question_format==='choice'&&Array.isArray(options)&&options.length>=2&&options.length<=26&&!!(row.choice_ready||row.correct_option);
  const alternatives=type!=='mistake'?['cloze','standard','self_explain','contrast','reading','retry']
    :[...(choice?['choice_reproduction']:[]),...(confirmed&&row.mistake_type==='execution'?['retry','standard']:['standard','retry']),
      ...(row.mistake_type==='knowledge'?['cloze']:row.mistake_type==='thinking'?['self_explain','contrast']:[]),'reading'];
  if(explicit&&Object.hasOwn(AI_REVIEW_METHODS,explicit))return {mode:explicit,source:'user',alternatives};
  if(ai&&Object.hasOwn(AI_REVIEW_METHODS,ai))return {mode:ai,source:'ai',alternatives};
  return {mode:type!=='mistake'?'cloze':choice?'choice_reproduction':confirmed&&row.mistake_type==='execution'?'retry':'standard',source:'rule',alternatives};
}
function workbenchSelection(s){
  const explicit=readReviewModeChoice(s);
  const ai=s.type==='mistake'&&typeof readMistakeAiMethod==='function'?readMistakeAiMethod(s):null;
  return recommendReviewMode(s.type,s.row||{},explicit,ai);
}

const REVIEW_MATERIAL_NEEDS=WORKBENCH_REQUIREMENTS;
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
  const context=centerWorkbenchContext(item,session),active=readReviewActive(context),explicit=readReviewModeChoice(context);
  if(active?.mode)await openReviewWorkbench(item.item_type,item.item_id,{...context,mode:active.mode});
  else if(item.item_type==='mistake'&&centerReview.quickMode?.aiMode&&centerReview.quickMode.modeId===centerReview.quickMode.aiMode&&mistakeStorageGet(reviewSelectionKey(context)+':native-mode')!==centerReview.quickMode.modeId)
    await openReviewWorkbench(item.item_type,item.item_id,{...context,mode:centerReview.quickMode.modeId});
  else if(item.item_type!=='mistake'&&explicit&&explicit!=='reading')await openReviewWorkbench(item.item_type,item.item_id,{...context,mode:explicit});
}
// Only selects a flow; execution remains in the native controller / material workbench.
async function prepareCenterQuickMode(item,session){
  if(item.item_type!=='mistake'||item.status!=='pending')return;
  const owner=centerReview,context=centerWorkbenchContext(item,session),record=readMistakeAiRecord(context),aiMode=record?.method;
  const originalKey=reviewSelectionKey(context)+':original-mode';
  const originalMode=mistakeStorageGet(originalKey)||mistakeStorageGet(legacyReviewSelectionKey(context)+':original-mode')||mistakeDetailState?.progress?.mode?.id||'standard';
  mistakeStorageSet(originalKey,originalMode);
  const q={itemId:item.id,aiMode,originalMode,ready:false,modeId:originalMode,reason:'没有已确认的 AI 建议，沿用原复习。',busy:false};
  if(record?.needsReselection)q.reason='AI 建议无效或版本过旧，使用标准复习。';
  if(aiMode){
    if(['standard','retry'].includes(aiMode))q.ready=!!mistakeDetailState?.progress?.reviewable;
    else if(aiMode==='choice_reproduction')q.ready=mistakeDetailState?.row?.question_format_confirmed===1&&mistakeDetailState.progress.mode.availableModes.some(m=>m.id===aiMode);
    else try{const data=await(await requestApi(reviewWorkbenchBase(context)+'/materials/'+aiMode+'?view=practice')).json();q.ready=data.version>0&&!!data.material;}catch{q.reason='无法确认建议材料，暂用标准复习；可从手动材料入口重试。';}
    if(q.ready)q.reason='建议材料可用；点击确认开始后执行，不会自动评分。';
    else if(!q.reason.startsWith('无法'))q.reason=`${AI_REVIEW_METHODS[aiMode]}所需材料或题型不完整；请在本页准备材料，或切换原复习。`;
  }
  const explicit=readReviewModeChoice(context);
  const active=readReviewActive(context);
  q.modeId=explicit&&Object.hasOwn(AI_REVIEW_METHODS,explicit)?explicit:aiMode||originalMode;
  // Restore a real in-progress flow without replacing it with a new default.
  if(active?.mode)q.modeId=active.mode;
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
    // Recheck availability on confirm, so a displayed label cannot start a stale/invalid mode.
    if(selected===q.aiMode&&!['standard','retry','choice_reproduction'].includes(selected)){
      const context=centerWorkbenchContext(item,owner.session);let data=null;
      try{data=await(await requestApi(reviewWorkbenchBase(context)+'/materials/'+selected+'?view=practice')).json();}catch{}
      if(!data?.version||!data.material){
        q.ready=false;q.reason='建议材料无法确认或已不可用；请准备材料，或切换原复习。';
        if(centerReview===owner&&currentCenterItem()?.id===item.id)await openReviewWorkbench('mistake',item.item_id,{...context,mode:selected});
        return;
      }
    }
    if(centerReview!==owner||currentCenterItem()?.id!==item.id)return;
    const context=centerWorkbenchContext(item,owner.session);rememberReviewSelection(context,q.modeId);
    await openReviewWorkbench('mistake',item.item_id,{...context,mode:q.modeId});
    if(reviewWorkbench?.mode!==q.modeId)return;
    if(['standard','retry','choice_reproduction'].includes(q.modeId))await runExistingReviewMode();
    else if(!reviewWorkbench.attempt)await startWorkbenchAttempt();
    else {writeReviewActive(context,{mode:reviewWorkbench.attempt.modeId});renderWorkbenchAttempt();}
  }catch(err){if(centerReview===owner)showToast('未开始复习：'+err.message);}
  finally{q.busy=false;if(centerReview===owner)renderCenterReviewToolbar();}
}
function renderWorkbenchInfo(s){
  const actual=s.attempt?.modeId||readReviewActive(s)?.mode||(s.type==='mistake'?mistakeDetailState?.progress?.mode?.id:'reading');
  const suggestion=s.type==='mistake'?readMistakeAiMethod(s):null,selection=workbenchSelection(s);
  wb('Info').textContent=s.sessionItemId?`当前实际流程：${AI_REVIEW_METHODS[actual]||'尚未开始'}。待使用：${AI_REVIEW_METHODS[s.mode]}（${{user:'本次明确选择',ai:'已保存的 AI 建议，尚需本次采用',rule:'规则推荐'}[selection.source]}）。选择/准备不评分；开始本轮后才执行选中模式。切换不会改写历史、评分或计划；已完成项目请在记录中再次复习。`:'材料准备：手动填写即可，AI 可选。确认保存后从总复习或计划进入。';
  wb('Suggestion').innerHTML=s.sessionItemId&&suggestion?`<p>已保存的 AI 建议：${escapeHtml(AI_REVIEW_METHODS[suggestion])}；不等于已创建材料。</p><button type="button" onclick="useWorkbenchSuggestion()">本次使用此建议（先检查材料）</button>`:'';
}
async function useWorkbenchSuggestion(){const s=reviewWorkbench,mode=s&&readMistakeAiMethod(s);if(mode)await loadReviewWorkbenchMode(mode);}
function reviewWorkbenchBase(s=reviewWorkbench){return `${API}/courses/${s.courseId}/review-items/${s.type}/${s.id}`;}
function reviewWorkbenchKey(s=reviewWorkbench){return `review-workbench:${s.courseId}:${s.type}:${s.id}:${s.sessionItemId||'prepare'}:${s.mode}`;}
function ensureReviewWorkbench(){
  if(wb('Dialog'))return;
  const dialog=document.createElement('dialog');dialog.id='reviewWbDialog';dialog.className='review-workbench';
  dialog.innerHTML=`<div id="reviewWbPanel" class="review-workbench-content"><header id="reviewWbHeader"><h2>复习材料与作答</h2><button type="button" class="btn-cancel" onclick="closeReviewWorkbench()">关闭</button></header>
    <div class="review-workbench-body"><details id="reviewWbSettings" open><summary>复习设置 / 模式选择</summary><p id="reviewWbInfo" class="mistake-ai-note"></p>
    <div id="reviewWbSuggestion"></div><label>本次待使用的模式<select id="reviewWbMode" onchange="loadReviewWorkbenchMode(this.value)"></select></label>
    </details>
    <div id="reviewWbEditor"></div><div id="reviewWbAttempt"></div><p id="reviewWbError" role="alert" class="mistake-inline-error"></p></div>
    <footer id="reviewWbActions" class="modal-actions"></footer></div>`;
  document.body.append(dialog);dialog.addEventListener('cancel',event=>{event.preventDefault();closeReviewWorkbench();});
}
function saveWorkbenchAnswerDraft(){
  const s=reviewWorkbench;if(!s?.attempt||s.attempt.stage!=='question')return;
  const answer=s.attempt.modeId==='cloze'?Object.fromEntries([...wb('Attempt').querySelectorAll('[data-review-blank]')].map(n=>[n.dataset.reviewBlank,n.value])):s.attempt.modeId==='contrast'?JSON.stringify({kind:'contrast-v1',fields:Object.fromEntries([...wb('Attempt').querySelectorAll('[data-contrast-field]')].map(n=>[n.dataset.contrastField,n.value]))}):wb('Answer')?.value||'';
  mistakeStorageSet(reviewWorkbenchKey(s)+':answer:'+s.attempt.id,{answer});
}
function closeReviewWorkbench(refresh=true){
  if(reviewWorkbench?.busy)return;
  saveWorkbenchAnswerDraft();
  if(reviewWorkbench&&wb('Prompt'))mistakeStorageSet(reviewWorkbenchKey()+':draft',readWorkbenchMaterial());
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
  wb('Header').hidden=true;wb('Settings').open=false;
}
async function openCenterReviewSettings(){
  const item=currentCenterItem(),owner=centerReview;if(!item||!owner)return;
  if(reviewWorkbench?.inline&&reviewWorkbench.sessionItemId===item.id){wb('Settings').open=!wb('Settings').open;return;}
  const context=centerWorkbenchContext(item,owner.session),mode=readReviewActive(context)?.mode||owner.quickMode?.modeId||workbenchSelection(context).mode;
  await openReviewWorkbench(item.item_type,item.item_id,{...context,mode});
  if(reviewWorkbench?.sessionItemId===item.id)wb('Settings').open=true;
}
function mountReviewPreparation(host,type,row){
  let button=host.querySelector('[data-review-preparation]');if(!button){button=document.createElement('button');button.type='button';button.className='btn-cancel';button.dataset.reviewPreparation='';host.append(button);}
  button.textContent='准备复习材料（手动 / 可选 AI）';button.onclick=()=>openReviewWorkbench(type,row.id,{row,sourceText:row.content||row.ocr_text||'',referenceText:row.answer_content||row.explanation||''});
}
async function openReviewWorkbench(type,id,context={}){
  if(reviewWorkbench?.busy)return;
  ensureReviewWorkbench();if(reviewWorkbench)closeReviewWorkbench();
  wb('Editor').innerHTML='';wb('Attempt').innerHTML='';
  const s={courseId:currentCourseId,type,id,version:0,busy:false,...context};s.inline=!!s.sessionItemId;reviewWorkbench=s;
  if(!s.row&&type==='mistake'&&mistakeDetailState?.id===id&&mistakeDetailState.courseId===s.courseId)s.row=mistakeDetailState.row;
  s.modeChoice=context.mode||null;s.mode=context.mode||workbenchSelection(s).mode;
  s.lastExecutableMode=readReviewActive(s)?.mode||null;
  const methods={...AI_REVIEW_METHODS};if(type!=='mistake')delete methods.choice_reproduction;
  wb('Mode').replaceChildren(...Object.entries(methods).map(([value,label])=>new Option(label,value)));
  wb('Mode').value=s.mode;
  if(s.inline)mountInlineReviewWorkbench(s);
  else {wb('Dialog').append(wb('Panel'));wb('Header').hidden=false;wb('Settings').open=true;wb('Dialog').showModal();}
  await loadReviewWorkbenchMode(s.mode,false);
  if(s.inline&&typeof centerReview!=='undefined'&&centerReview)renderCenterReviewToolbar();
}
function wbInput(label,id,value='',rows=3){return `<label>${escapeHtml(label)}<textarea id="reviewWb${id}" rows="${rows}">${escapeHtml(value)}</textarea></label>`;}
function wbBlank(blank){return `<div class="edit-card review-blank"><label>编号<input data-blank="id" value="${escapeHtml(blank.id)}"></label><label>答案<input data-blank="answer" value="${escapeHtml(blank.answer||'')}"></label><label>别名（每行一个）<textarea data-blank="aliases" rows="2">${escapeHtml((blank.aliases||[]).join('\n'))}</textarea></label><label>提示<input data-blank="hint" value="${escapeHtml(blank.hint||'')}"></label><button type="button" onclick="removeReviewBlank(this)">删除此空位</button></div>`;}
function addReviewBlank(){
  const ids=[...wb('Blanks').querySelectorAll('[data-blank="id"]')].map(n=>n.value);let n=1;while(ids.includes('b'+n))n++;
  wb('Blanks').insertAdjacentHTML('beforeend',wbBlank({id:'b'+n}));
}
function removeReviewBlank(button){const row=button.closest('.review-blank'),id=row.querySelector('[data-blank="id"]').value,answer=row.querySelector('[data-blank="answer"]').value;wb('Prompt').value=wb('Prompt').value.split('【'+id+'】').join(answer);row.remove();}
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
  if(explicit){s.modeChoice=mode;rememberReviewSelection(s,mode);if(s.sessionItemId)syncCenterQuickMode(mode);s.editing=false;}
  s.aiDraft=null;s.beforeAi=null;
  s.mode=mode;s.startRequestId=null;s.attempt=null;s.pending=null;wb('Error').textContent='';wb('Editor').innerHTML='';wb('Attempt').innerHTML='';wb('Actions').innerHTML='';
  wb('Mode').value=mode;renderWorkbenchInfo(s);
  if(mode==='retry'||mode==='choice_reproduction'||(mode==='standard'&&s.type==='mistake')){
    const incompatible=mode==='choice_reproduction'&&!recommendReviewMode(s.type,s.row||{}).alternatives.includes(mode);
    wb('Editor').textContent=incompatible?'当前缺少已确认且完整的选择题选项和正确答案。请在错题详情编辑题型，或明确切换标准复习。':mode==='retry'?'将隐藏旧作答、答案和解析，开启新轮次。复用已有流程和判分，旧轮次证据保留；不会覆盖历史。':'使用原题和答案，不需要额外材料。进入后先独立作答，再揭示答案并自评。切换原生模式会重新开始本轮，但不改变记忆状态。';
    wb('Actions').innerHTML=incompatible?'<button onclick="loadReviewWorkbenchMode(\'standard\')">切换标准复习</button>':s.sessionItemId?'<button onclick="runExistingReviewMode()">确认并进入本轮流程</button>':'<p>请从总复习或考前计划中运行。</p>';return;
  }
  s.busy=true;wb('Mode').disabled=true;
  if(s.inline)renderCenterReviewToolbar();
  try{
    const response=await requestApi(reviewWorkbenchBase(s)+'/materials/'+mode+(s.sessionItemId&&!s.editing?'?view=practice':''));const data=await response.json();if(reviewWorkbench!==s)return;s.version=data.version;
    if(s.sessionItemId&&!s.editing){
      const saved=mistakeStorageGet(reviewWorkbenchKey(s));
      if(saved?.attemptId){try{s.attempt=await (await requestApi(reviewWorkbenchBase(s)+'/attempts/'+encodeURIComponent(saved.attemptId))).json();}catch(err){if(!err.message.includes('404'))throw err;}}
      if(s.attempt){s.lastExecutableMode=s.attempt.modeId;renderWorkbenchAttempt();}
      else {wb('Editor').textContent=data.version?'材料已准备，确认开始后将使用此模式的新轮次。':`缺少${AI_REVIEW_METHODS[mode]}正式材料：${REVIEW_MATERIAL_NEEDS[mode]}。保存 AI 建议不会创建这些材料。`;
        wb('Actions').innerHTML=(data.version?'<button onclick="startWorkbenchAttempt()">确认模式并开始本轮复习</button>':'')+'<button onclick="editWorkbenchMaterial()">手动准备材料</button><button onclick="switchWorkbenchToAvailableMode()">'+(s.type==='mistake'?'切换标准复习（使用原题）':'返回现有阅读流程')+'</button>';}
    }else{
      const draft=mistakeStorageGet(reviewWorkbenchKey(s)+':draft');
      const saved=data.material||{prompt:s.sourceText||'',reference:s.referenceText||'',rubric:'',blanks:[]};const m=draft||saved;
      wb('Editor').innerHTML=(draft?'<p class="mistake-ai-note">已恢复本浏览器未确认草稿，尚未覆盖正式材料。</p>':'')+wbInput(mode==='cloze'?'题面（空位写为【b1】、【b2】）':'任务 / 阅读正文','Prompt',m.prompt,5)
        +(mode==='cloze'?`<div id="reviewWbBlanks">${(m.blanks||[]).map(wbBlank).join('')}</div><button type="button" onclick="addReviewBlank()">添加空位</button>`:mode==='reading'?'':wbInput('参考要点 / 关键异同','Reference',m.reference)+wbInput('核对标准 / 评分量规','Rubric',m.rubric))
        +(mode==='contrast'?wbInput('对比对象（每行一个，至少两个）','Objects',(m.objects||[]).join('\n'))+wbInput('对比维度（每行一个）','Dimensions',(m.dimensions||[]).join('\n')):'')
        +'<details><summary>AI 辅助（可选，固定 Mock 草稿）</summary><button type="button" onclick="requestWorkbenchDraft()">生成独立草稿</button><div id="reviewWbDraft"></div></details>';
      wb('Actions').innerHTML='<button onclick="saveWorkbenchMaterial()">确认并保存正式材料</button>';
    }
  }catch(err){if(reviewWorkbench===s){wb('Error').textContent=err.message;wb('Actions').innerHTML='<button onclick="loadReviewWorkbenchMode(reviewWorkbench.mode)">重新加载</button>';}}
  finally{if(reviewWorkbench===s){s.busy=false;wb('Mode').disabled=false;if(s.inline)renderCenterReviewToolbar();}}
}
async function saveWorkbenchMaterial(){
  const s=reviewWorkbench;if(!s||s.busy||(s.sessionItemId&&!s.editing))return;s.busy=true;wb('Error').textContent='';const material=readWorkbenchMaterial();mistakeStorageSet(reviewWorkbenchKey(s)+':draft',material);
  try{
    const data=await (await requestApi(reviewWorkbenchBase(s)+'/materials/'+s.mode,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:s.version,confirmed:true,material})})).json();
    if(reviewWorkbench!==s)return;s.version=data.version;mistakeStorageSet(reviewWorkbenchKey(s)+':draft',null);showToast('正式材料已保存；未更改 AI 建议或评分');
    if(s.sessionItemId&&s.type==='mistake'&&currentCenterItem()?.id===s.sessionItemId)await prepareCenterQuickMode(currentCenterItem(),centerReview.session);
    if(s.sessionItemId){s.editing=false;s.busy=false;await loadReviewWorkbenchMode(s.mode,false);}
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
    if(reviewWorkbench!==s)return;s.attempt=attempt;s.lastExecutableMode=attempt.modeId;rememberReviewSelection(s,attempt.modeId);syncCenterQuickMode(attempt.modeId);writeReviewActive(s,{mode:attempt.modeId});mistakeStorageSet(reviewWorkbenchKey(s),{attemptId:attempt.id});renderWorkbenchAttempt();
  }catch(err){if(reviewWorkbench===s)wb('Error').textContent=err.message;}
  finally{if(reviewWorkbench===s)s.busy=false;}
}
function workbenchClozeHtml(p,pending){
  const m=p.material;
  return '<div class="review-cloze-text" data-cloze-prompt>'+m.prompt.split(/(【[A-Za-z][A-Za-z0-9_]*】)/g).map(part=>{
    const b=m.blanks.find(b=>part==='【'+b.id+'】');if(!b)return escapeHtml(part);
    if(p.stage==='question')return `<label class="review-inline-blank"><span class="sr-only">${escapeHtml(b.id)} ${escapeHtml(b.hint)}</span><input data-review-blank="${escapeHtml(b.id)}" aria-label="${escapeHtml(b.id+' '+b.hint)}" placeholder="${escapeHtml(b.hint||b.id)}" value="${escapeHtml(pending?.answer?.[b.id]||'')}" autocomplete="off" maxlength="2000"></label>`;
    const correct=p.result?.results.some(r=>r.id===b.id&&r.correct);
    return `<span class="review-blank-result" data-blank-result="${escapeHtml(b.id)}">${escapeHtml(p.firstAnswer?.[b.id]||'（未填）')} · ${correct?'正确':'错误'}（答案：${escapeHtml(b.answer)}${b.aliases.length?'；别名：'+escapeHtml(b.aliases.join('、')):''}）</span>`;
  }).join('')+'</div>';
}
function workbenchContrastHtml(m,answer='',readonly=false){
  let values={};try{const parsed=JSON.parse(answer);if(parsed?.kind==='contrast-v1'&&parsed.fields&&typeof parsed.fields==='object')values=parsed.fields;}catch{}
  const field=(key,label)=>`<label>${escapeHtml(label)}<textarea data-contrast-field="${key}" rows="3" maxlength="3000" ${readonly?'readonly':''}>${escapeHtml(values[key]||'')}</textarea></label>`;
  return `<section data-contrast-task><h4>比较对象：${escapeHtml(m.objects.join(' / '))}</h4><div class="review-contrast-scroll"><table><caption>逐维度独立比较</caption><thead><tr><th>维度</th>${m.objects.map(o=>'<th scope="col">'+escapeHtml(o)+'</th>').join('')}</tr></thead><tbody>${m.dimensions.map((d,i)=>`<tr><th scope="row">${escapeHtml(d)}</th>${m.objects.map((o,j)=>`<td>${field('d'+i+'o'+j,o+' · '+d)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="review-contrast-summary">${[['same','相同点'],['different','不同点'],['conditions','适用条件 / 反例'],['pitfalls','易混点 / 易错点']].map(([key,label])=>field(key,label)).join('')}</div>${readonly&&!Object.keys(values).length?'<p>旧版首次作答：'+escapeHtml(answer)+'</p>':''}</section>`;
}
function workbenchCheckpoints(p){
  const points=(p.material.reference+'\n'+p.material.rubric).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const checked=mistakeStorageGet(reviewWorkbenchKey()+':checkpoints:'+p.id)||[];
  return `<fieldset data-review-checkpoints><legend>逐项核对（不自动判分）</legend>${points.map((point,i)=>`<label class="review-check"><input type="checkbox" data-review-checkpoint="${i}" ${checked.includes(i)?'checked':''} onchange="saveWorkbenchCheckpoints()"><span>${escapeHtml(point)}</span></label>`).join('')}</fieldset>`;
}
function saveWorkbenchCheckpoints(){const s=reviewWorkbench;if(s?.attempt)mistakeStorageSet(reviewWorkbenchKey(s)+':checkpoints:'+s.attempt.id,[...wb('Attempt').querySelectorAll('[data-review-checkpoint]:checked')].map(n=>Number(n.dataset.reviewCheckpoint)));}
function renderWorkbenchAttempt(){
  const s=reviewWorkbench,p=s.attempt,m=p.material;wb('Editor').innerHTML='';
  let pending=mistakeStorageGet(reviewWorkbenchKey(s)+':pending')||s.pending;
  if(pending&&pending.expectedVersion<p.version){mistakeStorageSet(reviewWorkbenchKey(s)+':pending',null);s.pending=null;pending=null;}
  pending ||= mistakeStorageGet(reviewWorkbenchKey(s)+':answer:'+p.id);
  renderWorkbenchInfo(s);
  let content=`<h3 data-executing-mode="${escapeHtml(p.modeId)}">实际执行：${escapeHtml(AI_REVIEW_METHODS[p.modeId])}</h3>`;
  if(p.modeId==='cloze')content+=workbenchClozeHtml(p,pending);
  else content+=`<${p.modeId==='reading'?'article':'div'} class="${p.modeId==='reading'?'review-reading-body':'detail-content'}">${escapeHtml(m.prompt)}</${p.modeId==='reading'?'article':'div'}>`;
  if(p.stage==='question'){
    if(p.modeId==='contrast')content+=workbenchContrastHtml(m,pending?.answer);
    else if(p.modeId==='reading')content+='<p>只记录阅读曝光，不评标准答案，不计 Good，不完成掌握型任务。</p>'+wbInput('可选：一句话总结 / 疑问','Answer',pending?.answer||'',2)+'<label class="review-check"><input id="reviewWbReadComplete" type="checkbox"><span>我已完成本段阅读</span></label>';
    else if(p.modeId!=='cloze')content+=`<p>${p.modeId==='self_explain'?'用自己的话解释概念、原因、例子；提交后才能查看要点与量规。':'先独立回忆或解题；提交后查看参考答案，自评最高 Hard。'}</p>`+wbInput(p.modeId==='self_explain'?'我的讲解（概念、原因与例子）':'看答案前的独立作答 / 回忆','Answer',typeof pending?.answer==='string'?pending.answer:'',p.modeId==='self_explain'?10:5);
    wb('Actions').innerHTML=`<button onclick="submitWorkbenchAttempt('${p.modeId==='reading'?'complete':'submit'}')">${p.modeId==='reading'?'记录阅读曝光（不评分）':'提交首次作答'}</button>`;
  }else{
    if(p.modeId==='contrast')content+=workbenchContrastHtml(m,p.firstAnswer,true);
    else if(p.modeId!=='cloze')content+=`<h4>${p.modeId==='reading'?'阅读记录':'不可改写的首次作答'}</h4><div class="detail-content">${escapeHtml(p.firstAnswer||'（无）')}</div>`;
    if(!['cloze','reading'].includes(p.modeId))content+=`<h4>参考解释 / 知识要点</h4><div class="detail-content" data-review-reference>${escapeHtml(m.reference||'')}</div><h4>评分量规</h4><div class="detail-content">${escapeHtml(m.rubric||'未另设量规，请核对参考要点')}</div>`+(['self_explain','contrast'].includes(p.modeId)?workbenchCheckpoints(p):'');
    wb('Actions').innerHTML=p.stage==='answer'?'<p>已看答案，最终评分最高 Hard。</p><button onclick="submitWorkbenchAttempt(\'judge\',1)">Again · 未掌握</button><button onclick="submitWorkbenchAttempt(\'judge\',2)">Hard · 基本掌握</button>':'<button onclick="finishWorkbenchAttempt()">返回复习队列</button>';
    if(p.stage==='completed')content+=`<p>${p.grade===null?'已记录曝光，未产生评分':`已保存评分：${['','Again','Hard','Good','Easy'][p.grade]}`} · ${p.durationMs} ms</p>`;
  }
  wb('Attempt').innerHTML=content;
}
async function submitWorkbenchAttempt(action,grade){
  const s=reviewWorkbench;if(!s?.attempt||s.busy)return;
  const key=reviewWorkbenchKey(s),saved=mistakeStorageGet(key+':pending')||s.pending;
  const body=saved||{action,requestId:reviewRequestId(),expectedVersion:s.attempt.version,durationMs:Math.max(1,Math.min(86400000,Date.now()-Date.parse(s.attempt.startedAt)))};
  if(!saved){
    if(action==='judge')body.grade=grade;
    else if(s.attempt.modeId==='cloze')body.answer=Object.fromEntries([...wb('Attempt').querySelectorAll('[data-review-blank]')].map(n=>[n.dataset.reviewBlank,n.value]));
    else if(s.attempt.modeId==='contrast'){
      const fields=Object.fromEntries([...wb('Attempt').querySelectorAll('[data-contrast-field]')].map(n=>[n.dataset.contrastField,n.value]));
      if(!Object.values(fields).some(v=>v.trim())){wb('Error').textContent='请先填写比较内容；不会也可以在对应字段写“不记得”。';return;}
      body.answer=JSON.stringify({kind:'contrast-v1',fields});
    }else{
      if(action==='complete'&&!wb('ReadComplete')?.checked){wb('Error').textContent='请先勾选已完成阅读；总结可留空。';return;}
      body.answer=wb('Answer').value;
    }
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
  try{
    if(s.sessionId){const session=await(await requestApi(`${API}/courses/${s.courseId}/review-sessions/${s.sessionId}`)).json();if(!session.pending)await recordedReviewAction(s.sessionId,'finish');}
    s.busy=false;closeReviewWorkbench();if(centerReview)await centerReviewItemFinished();
  }catch(err){wb('Error').textContent=err.message;}finally{if(reviewWorkbench===s)s.busy=false;}
}
async function runExistingReviewMode(){
  const s=reviewWorkbench;if(!s?.sessionItemId||s.busy)return;
  if(s.type==='mistake'&&(mistakeDetailState?.pending||mistakeStorageGet(mistakePendingKey(mistakeDetailState)))){wb('Error').textContent='原流程有提交待确认，请先返回重试。';return;}
  if(s.mode==='retry'&&s.lastExecutableMode){
    // A completed task must use the existing repeat-session action, not lose its restore pointer.
    if(s.sessionId){
      s.busy=true;
      try{const session=await(await requestApi(`${API}/courses/${s.courseId}/review-sessions/${s.sessionId}`)).json();if(reviewWorkbench!==s)return;if(session.items.find(item=>item.id===s.sessionItemId)?.status!=='pending'){wb('Error').textContent='本项目已处理。请返回队列，在复习记录点击“再次复习”创建新会话；旧轮次仍保留。';return;}}
      catch(err){wb('Error').textContent=err.message;return;}finally{if(reviewWorkbench===s)s.busy=false;}
    }
    const target=s.lastExecutableMode,targetState={...s,mode:target};
    if(mistakeStorageGet(reviewWorkbenchKey(targetState)+':pending')){wb('Error').textContent='旧轮次有待确认提交，请先返回该模式重试，不能丢弃。';return;}
    s.mode=target;wb('Mode').value=target;mistakeStorageSet(reviewWorkbenchKey(s),null);
    await loadReviewWorkbenchMode(target,false);if(s.version)await startWorkbenchAttempt();return;
  }
  if(s.type!=='mistake'){wb('Editor').textContent='本项目尚无可重开的工作台轮次。请选择标准复习准备任务，或明确返回已有阅读流程。';wb('Actions').innerHTML='<button onclick="loadReviewWorkbenchMode(\'standard\')">准备标准复习</button><button onclick="switchWorkbenchToAvailableMode()">返回现有阅读流程</button>';return;}
  s.busy=true;
  try{
    const state=mistakeDetailState;if(state?.id!==s.id||state.sessionItemId!==s.sessionItemId)throw Error('当前项目已变化，请返回队列重新进入');
    if(s.mode!=='retry'&&state.progress.mode.id!==s.mode){await requestApi(`${API}/courses/${s.courseId}/mistakes/${s.id}/mode`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({modeId:s.mode})});state.firstAnswerDraft='';document.getElementById('mistakeFirstAnswer')?.remove();}
    await refreshMistakeReview(state);
    if(!state.progress?.reviewable)throw Error('请先在错题详情补齐题目和参考答案');
    if(s.mode==='retry'||state.progress.allowedActions.includes('start'))await submitMistakeReview(s.mode==='retry'&&state.progress.allowedActions.includes('restart')?'restart':'start');
    if(state.pending||mistakeStorageGet(mistakePendingKey(state)))throw Error('本轮操作尚未确认，请返回原流程重试');
    if(mistakeQueueCurrent(state)){mistakeQueue.rounds[state.id]=state.progress.round;saveMistakeQueue();}
    rememberReviewSelection(s,s.mode);syncCenterQuickMode(s.mode);writeReviewActive(s,null);mistakeStorageSet(reviewSelectionKey(s)+':native-mode',s.mode);
    s.busy=false;closeReviewWorkbench();
  }catch(err){wb('Error').textContent=err.message;}finally{if(reviewWorkbench===s)s.busy=false;}
}
async function requestWorkbenchDraft(){
  const s=reviewWorkbench;if(!s||s.busy||(s.sessionItemId&&!s.editing))return;s.busy=true;wb('Error').textContent='';
  try{
    const input=readWorkbenchMaterial();let source=input.prompt;
    if(s.mode==='cloze'){
      for(const blank of input.blanks)if(blank.answer.trim())source=source.split('【'+blank.id+'】').join(blank.answer);
      if(/【[A-Za-z][A-Za-z0-9_]*】/.test(source))throw new Error('请先补齐空位答案，或使用原文生成草稿；手动编辑仍可继续');
    }
    const draft=await(await requestApi(API+'/ai/review-draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modeId:s.mode,text:source}),signal:AbortSignal.timeout(20000)})).json();
    if(reviewWorkbench!==s)return;
    // Independent editable preview. Nothing in the user's form is replaced automatically.
    s.aiDraft=draft.material;
    wb('Draft').innerHTML=`<p>Mock 演示草稿，尚未采用或保存。采用后可在正常表单任意修改、删除。</p><div class="detail-content">${escapeHtml(draft.material.prompt)}</div>
      <p>${escapeHtml(draft.material.blanks.map(b=>b.id+'：'+b.answer).join('；')||draft.material.reference)}</p>
      <button type="button" onclick="adoptWorkbenchDraft(false)">仅补充空白字段</button><button type="button" onclick="adoptWorkbenchDraft(true)">替换表单（保留原稿供撤回）</button>`;
  }catch(err){if(reviewWorkbench===s)wb('Error').textContent=err.message+'；手动输入保留，可直接手动保存。';}
  finally{if(reviewWorkbench===s)s.busy=false;}
}
async function adoptWorkbenchDraft(replace){
  const s=reviewWorkbench;if(!s?.aiDraft||s.busy)return;
  if(replace&&!await showConfirm('将替换当前表单但不保存。原表单将保留，可撤回。是否继续？','采用 AI 草稿'))return;
  if(reviewWorkbench!==s)return;
  const m=s.aiDraft;s.beforeAi=readWorkbenchMaterial();
  for(const [name,value] of [['Prompt',m.prompt],['Reference',m.reference],['Rubric',m.rubric],['Objects',(m.objects||[]).join('\n')],['Dimensions',(m.dimensions||[]).join('\n')]])if(wb(name)&&(replace||!wb(name).value.trim()))wb(name).value=value||'';
  // Blank rows must match the adopted prompt; never append unmatched blanks to user text.
  if(wb('Blanks')&&(replace||!s.beforeAi.prompt.trim()))wb('Blanks').innerHTML=(m.blanks||[]).map(wbBlank).join('');
  wb('Draft').insertAdjacentHTML('beforeend','<button type="button" onclick="undoWorkbenchDraft()">撤回采用，恢复原稿</button>');
}
function undoWorkbenchDraft(){
  const s=reviewWorkbench,m=s?.beforeAi;if(!m)return;
  for(const [name,value] of [['Prompt',m.prompt],['Reference',m.reference],['Rubric',m.rubric],['Objects',(m.objects||[]).join('\n')],['Dimensions',(m.dimensions||[]).join('\n')]])if(wb(name))wb(name).value=value||'';
  if(wb('Blanks'))wb('Blanks').innerHTML=m.blanks.map(wbBlank).join('');s.beforeAi=null;
}
