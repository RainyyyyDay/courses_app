/* One manual editor and attempt UI for cloze/open-answer/reading; existing choice and standard stay intact. */
let reviewWorkbench=null;
const wb=name=>document.getElementById('reviewWb'+name);
function reviewWorkbenchBase(s=reviewWorkbench){return `${API}/courses/${s.courseId}/review-items/${s.type}/${s.id}`;}
function reviewWorkbenchKey(s=reviewWorkbench){return `review-workbench:${s.courseId}:${s.type}:${s.id}:${s.sessionItemId||'prepare'}:${s.mode}`;}
function ensureReviewWorkbench(){
  if(wb('Dialog'))return;
  const dialog=document.createElement('dialog');dialog.id='reviewWbDialog';dialog.className='review-workbench';
  dialog.innerHTML=`<header><h2>复习材料与作答</h2><button type="button" class="btn-cancel" onclick="closeReviewWorkbench()">关闭</button></header>
    <div class="review-workbench-body"><p id="reviewWbInfo" class="mistake-ai-note"></p>
    <label>模式<select id="reviewWbMode" onchange="loadReviewWorkbenchMode(this.value)"></select></label>
    <div id="reviewWbEditor"></div><div id="reviewWbAttempt"></div><p id="reviewWbError" role="alert" class="mistake-inline-error"></p></div>
    <footer id="reviewWbActions" class="modal-actions"></footer>`;
  document.body.append(dialog);dialog.addEventListener('cancel',event=>{event.preventDefault();closeReviewWorkbench();});
}
function closeReviewWorkbench(){if(reviewWorkbench?.busy)return;if(reviewWorkbench&&!reviewWorkbench.sessionItemId&&wb('Prompt'))mistakeStorageSet(reviewWorkbenchKey()+':draft',readWorkbenchMaterial());wb('Dialog')?.close();reviewWorkbench=null;}
function mountReviewPreparation(host,type,row){
  let button=host.querySelector('[data-review-preparation]');if(!button){button=document.createElement('button');button.type='button';button.className='btn-cancel';button.dataset.reviewPreparation='';host.append(button);}
  button.textContent='准备复习材料（手动 / 可选 AI）';button.onclick=()=>openReviewWorkbench(type,row.id,{sourceText:row.content||row.ocr_text||'',referenceText:row.answer_content||row.explanation||''});
}
async function openReviewWorkbench(type,id,context={}){
  if(reviewWorkbench?.busy)return;
  ensureReviewWorkbench();if(reviewWorkbench)closeReviewWorkbench();
  wb('Editor').innerHTML='';wb('Attempt').innerHTML='';
  const s={courseId:currentCourseId,type,id,mode:'cloze',version:0,busy:false,...context};reviewWorkbench=s;
  wb('Info').textContent=s.sessionItemId?'从总复习 / 计划进入：先独立作答，再核对；阅读只记录曝光。':'材料准备：手动填写即可，AI 可选。确认保存后请从总复习或考前计划进入实际复习。';
  const methods={...AI_REVIEW_METHODS};if(type!=='mistake')delete methods.choice_reproduction;
  wb('Mode').replaceChildren(...Object.entries(methods).map(([value,label])=>new Option(label,value)));
  wb('Mode').value=s.mode;wb('Dialog').showModal();await loadReviewWorkbenchMode(s.mode);
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
async function loadReviewWorkbenchMode(mode){
  const s=reviewWorkbench;if(!s||s.busy)return;
  if(s.mode && wb('Prompt') && !s.sessionItemId)mistakeStorageSet(reviewWorkbenchKey(s)+':draft',readWorkbenchMaterial());
  s.mode=mode;s.startRequestId=null;s.attempt=null;s.pending=null;wb('Error').textContent='';wb('Editor').innerHTML='';wb('Attempt').innerHTML='';wb('Actions').innerHTML='';
  wb('Mode').value=mode;
  if(mode==='retry'||mode==='choice_reproduction'||(mode==='standard'&&s.type==='mistake')){
    wb('Editor').textContent=mode==='retry'?'重新执行当前项目的既有模式，不另建材料或判分流程。':'复用原有错题复习流程。';
    wb('Actions').innerHTML=s.sessionItemId?'<button onclick="runExistingReviewMode()">进入现有流程</button>':'<p>请从总复习或考前计划中运行。</p>';return;
  }
  s.busy=true;wb('Mode').disabled=true;
  try{
    const response=await requestApi(reviewWorkbenchBase(s)+'/materials/'+mode+(s.sessionItemId?'?view=practice':''));const data=await response.json();if(reviewWorkbench!==s)return;s.version=data.version;
    if(s.sessionItemId){
      const saved=mistakeStorageGet(reviewWorkbenchKey(s));
      if(saved?.attemptId){try{s.attempt=await (await requestApi(reviewWorkbenchBase(s)+'/attempts/'+encodeURIComponent(saved.attemptId))).json();}catch(err){if(!err.message.includes('404'))throw err;}}
      if(s.attempt){s.lastExecutableMode=s.attempt.modeId;renderWorkbenchAttempt();}
      else {wb('Editor').textContent=data.version?'材料已准备，开始后显示题面。':'此模式尚未准备材料，请先到内容详情手动准备。';wb('Actions').innerHTML=data.version?'<button onclick="startWorkbenchAttempt()">开始本轮复习</button>':'';}
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
  finally{if(reviewWorkbench===s){s.busy=false;wb('Mode').disabled=false;}}
}
async function saveWorkbenchMaterial(){
  const s=reviewWorkbench;if(!s||s.busy||s.sessionItemId)return;s.busy=true;wb('Error').textContent='';const material=readWorkbenchMaterial();mistakeStorageSet(reviewWorkbenchKey(s)+':draft',material);
  try{
    const data=await (await requestApi(reviewWorkbenchBase(s)+'/materials/'+s.mode,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:s.version,confirmed:true,material})})).json();
    if(reviewWorkbench!==s)return;s.version=data.version;mistakeStorageSet(reviewWorkbenchKey(s)+':draft',null);showToast('正式材料已保存，可从总复习进入；未更改 AI 建议');
  }catch(err){if(reviewWorkbench===s)wb('Error').textContent=err.message+'；输入已保留，未声称保存成功。';}
  finally{if(reviewWorkbench===s)s.busy=false;}
}
async function startWorkbenchAttempt(){
  const s=reviewWorkbench;if(!s||s.busy||!s.sessionItemId)return;s.busy=true;wb('Error').textContent='';
  s.startRequestId ||= reviewRequestId();
  try{
    const body={modeId:s.mode,expectedMaterialVersion:s.version,requestId:s.startRequestId,sessionItemId:s.sessionItemId};if(s.planItemId)body.planItemId=s.planItemId;
    const attempt=await (await requestApi(reviewWorkbenchBase(s)+'/attempts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
    if(reviewWorkbench!==s)return;s.attempt=attempt;s.lastExecutableMode=s.mode;mistakeStorageSet(reviewWorkbenchKey(s),{attemptId:attempt.id});renderWorkbenchAttempt();
  }catch(err){if(reviewWorkbench===s)wb('Error').textContent=err.message;}
  finally{if(reviewWorkbench===s)s.busy=false;}
}
function renderWorkbenchAttempt(){
  const s=reviewWorkbench,p=s.attempt,m=p.material;wb('Editor').innerHTML='';
  let pending=mistakeStorageGet(reviewWorkbenchKey(s)+':pending')||s.pending;
  if(pending&&pending.expectedVersion<p.version){mistakeStorageSet(reviewWorkbenchKey(s)+':pending',null);s.pending=null;pending=null;}
  let content=`<h3>${escapeHtml(AI_REVIEW_METHODS[p.modeId])}</h3><div class="detail-content">${escapeHtml(m.prompt)}</div>`;
  if(p.modeId==='contrast')content+=`<p>对比对象：${escapeHtml(m.objects.join('、'))}</p><p>对比维度：${escapeHtml(m.dimensions.join('、'))}</p>`;
  if(p.stage==='question'){
    if(p.modeId==='cloze')content+=m.blanks.map(b=>`<label>${escapeHtml(b.id)} · ${escapeHtml(b.hint)}<input data-review-blank="${escapeHtml(b.id)}" value="${escapeHtml(pending?.answer?.[b.id]||'')}"></label>`).join('');
    else content+=wbInput(p.modeId==='reading'?'可选阅读标记 / 一句话总结':'看参考要点前的首次作答','Answer',typeof pending?.answer==='string'?pending.answer:'',5);
    wb('Actions').innerHTML=`<button onclick="submitWorkbenchAttempt('${p.modeId==='reading'?'complete':'submit'}')">${p.modeId==='reading'?'记录阅读曝光（不评分）':'提交首次作答'}</button>`;
  }else{
    content+=`<p>首次作答：${escapeHtml(typeof p.firstAnswer==='object'?JSON.stringify(p.firstAnswer):p.firstAnswer||'（无）')}</p>`;
    if(p.modeId==='cloze')content+=m.blanks.map(b=>`<p>${escapeHtml(b.id)}：${escapeHtml(b.answer)} · ${p.result?.results.find(r=>r.id===b.id)?.correct?'正确':'错误'}</p>`).join('');
    else content+=`<h4>参考要点</h4><div class="detail-content">${escapeHtml(m.reference||'')}</div><div class="detail-content">${escapeHtml(m.rubric||'')}</div>`;
    wb('Actions').innerHTML=p.stage==='answer'?'<p>已看答案，最终评分最高 Hard。</p><button onclick="submitWorkbenchAttempt(\'judge\',1)">Again · 未掌握</button><button onclick="submitWorkbenchAttempt(\'judge\',2)">Hard · 基本掌握</button>':'<button onclick="finishWorkbenchAttempt()">返回复习队列</button>';
    if(p.stage==='completed')content+=`<p>${p.grade===null?'已记录曝光，未产生评分':`已保存评分：${['','Again','Hard','Good','Easy'][p.grade]}`} · ${p.durationMs} ms</p>`;
  }
  wb('Attempt').innerHTML=content;
}
async function submitWorkbenchAttempt(action,grade){
  const s=reviewWorkbench;if(!s?.attempt||s.busy)return;
  const key=reviewWorkbenchKey(s),saved=mistakeStorageGet(key+':pending')||s.pending;
  const body=saved||{action,requestId:reviewRequestId(),expectedVersion:s.attempt.version,durationMs:Math.max(1,Math.min(86400000,Date.now()-Date.parse(s.attempt.startedAt)))};
  if(!saved){if(action==='judge')body.grade=grade;else body.answer=s.mode==='cloze'?Object.fromEntries([...wb('Attempt').querySelectorAll('[data-review-blank]')].map(n=>[n.dataset.reviewBlank,n.value])):wb('Answer').value;mistakeStorageSet(key+':pending',body);s.pending=body;}
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
  if(s.mode==='retry'&&s.lastExecutableMode){
    const target=s.lastExecutableMode;s.mode=target;wb('Mode').value=target;mistakeStorageSet(reviewWorkbenchKey(s),null);mistakeStorageSet(reviewWorkbenchKey(s)+':pending',null);
    await loadReviewWorkbenchMode(target);if(s.version)await startWorkbenchAttempt();return;
  }
  if(s.type!=='mistake'){s.mode='reading';wb('Mode').value=s.mode;await loadReviewWorkbenchMode(s.mode);return;}
  s.busy=true;
  try{
    if(s.mode!=='retry')await requestApi(`${API}/courses/${s.courseId}/mistakes/${s.id}/mode`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({modeId:s.mode})});
    const state=mistakeDetailState;await refreshMistakeReview(state);
    if(s.mode==='retry')await submitMistakeReview(state.progress.allowedActions.includes('restart')?'restart':'start');
    s.busy=false;closeReviewWorkbench();
  }catch(err){wb('Error').textContent=err.message;}finally{if(reviewWorkbench===s)s.busy=false;}
}
async function requestWorkbenchDraft(){
  const s=reviewWorkbench;if(!s||s.busy||s.sessionItemId)return;s.busy=true;wb('Error').textContent='';
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
