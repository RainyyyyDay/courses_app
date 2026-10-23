/* Uses the existing tab-memory credentials and official JSON provider; never saves materials. */
async function fetchReviewMaterialDraft(input,credentials,signal){
  const endpoint=new URL((globalThis.COURSES_AI_API_BASE??API).replace(/\/$/,'')+'/ai/material-draft',location.href);
  if(endpoint.origin!==location.origin||endpoint.username||endpoint.password||!(endpoint.protocol==='https:'||endpoint.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)))throw mistakeAiError('AI_TEMP_KEY_ORIGIN');
  let body=JSON.stringify({provider:credentials.provider||'deepseek',api_key:credentials.apiKey,model:credentials.model,confirm_cost:credentials.confirmCost,...(credentials.provider==='compatible'?{base_url:credentials.baseUrl,...(credentials.workspaceId?{workspace_id:credentials.workspaceId}:{})}:{}),input});
  if(new TextEncoder().encode(body).length>16384)throw mistakeAiError('BODY_TOO_LARGE');
  const controller=new AbortController(),abort=()=>controller.abort();
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,100000),release=coursesAiSettings.track(credentials,abort);
  try{
    if(controller.signal.aborted)throw Object.assign(new Error('已取消'),{name:'AbortError'});
    const response=await fetch(endpoint.href,{method:'POST',headers:{'Content-Type':'application/json'},body,signal:controller.signal,cache:'no-store'});
    const data=await response.json().catch(()=>null);
    if(controller.signal.aborted||!coursesAiSettings.valid(credentials))throw Object.assign(new Error('已取消'),{name:'AbortError'});
    if(!response.ok)throw mistakeAiError(data?.error||data?.detail,response.status);
    const draft=data?.draft;
    if(data?.provider!==(credentials.provider||'deepseek')||data.mode_id!==input.mode_id||draft?.needs_review!==true||typeof draft.needs_more_information!=='boolean'||!Array.isArray(draft.caveats)||draft.caveats.length>3||draft.caveats.some(v=>typeof v!=='string'||v.length>300)
      ||(draft.material===null?(!draft.needs_more_information||!draft.caveats.length):!validReviewMaterialDraft(input.mode_id,draft.material)))throw mistakeAiError('INVALID_RESPONSE');
    return draft;
  }catch(err){
    if(controller.signal.aborted){if(signal?.aborted||!coursesAiSettings.valid(credentials))throw Object.assign(new Error('已取消'),{name:'AbortError'});throw mistakeAiError('AI_TIMEOUT');}
    throw err.code?err:mistakeAiError('NETWORK_ERROR');
  }finally{body=null;release();clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function validReviewMaterialDraft(mode,m){
  if(!m||['prompt','reference','rubric'].some(k=>typeof m[k]!=='string'||m[k].length>4000))return false;
  for(const key of ['objects','dimensions'])if(!Array.isArray(m[key])||m[key].length>20||m[key].some(v=>typeof v!=='string'||!v.trim()||v.length>1000))return false;
  if(!Array.isArray(m.blanks)||m.blanks.length>20||m.blanks.some(b=>!b||typeof b.id!=='string'||typeof b.answer!=='string'||typeof b.hint!=='string'||b.answer.length>2000||b.hint.length>2000||!Array.isArray(b.aliases)||b.aliases.length>20||b.aliases.some(v=>typeof v!=='string'||!v.trim()||v.length>2000)))return false;
  return !workbenchMaterialMissing(mode,m).length&&(mode==='cloze'||!m.blanks.length);
}
function reviewMaterialAiGeneratorHtml(mode){
  const label=mode==='cloze'?'生成挖空材料':mode==='contrast'?'生成对比内容':'生成讲解要点';
  return `<details class="review-ai-generator"><summary>AI 生成材料<span class="ai-optional-tag">可选</span></summary><p class="ai-help">可使用已接入的真实 AI 生成可编辑材料；结果会放入当前编辑器，采纳前不会保存为正式材料。</p>
    <p class="review-api-note" id="reviewWbAiUnavailable">需要接入真实 AI API。请先打开“AI 设置”完成配置。</p>
    <div class="ai-action-row"><button type="button" class="ai-primary" data-material-ai-generate onclick="requestWorkbenchDraft(true)">${label}</button><button type="button" onclick="coursesAiSettings.open()">AI 设置</button><button type="button" class="ai-text-button" id="reviewWbCancelDraft" onclick="reviewWorkbench?.draftController?.abort()" hidden>取消生成</button></div>
    <p id="reviewWbDraftStatus" role="status"></p><div id="reviewWbDraft" class="review-ai-draft"></div></details>`;
}
function refreshWorkbenchAiAvailability(){
  const s=reviewWorkbench,generate=wb('GenerateDraft')||document.querySelector('[data-material-ai-generate]');
  if(!s||!generate)return;
  const ready=typeof coursesAiSettings.realReady==='function'&&coursesAiSettings.realReady();
  generate.disabled=!ready||!!s.busy;
  const note=document.getElementById('reviewWbAiUnavailable');if(note)note.hidden=ready;
  const cancel=document.getElementById('reviewWbCancelDraft');if(cancel)cancel.hidden=!s.draftController;
}
function applyReviewMaterialDraftToEditor(s,m){
  wb('Prompt').value=m.prompt;
  if(s.mode==='cloze'){
    wb('Blanks').innerHTML=(m.blanks||[]).map(wbBlank).join('');
    refreshClozeEditor();
  }else{
    if(wb('Reference'))wb('Reference').value=m.reference||'';
    if(wb('Rubric'))wb('Rubric').value=m.rubric||'';
    if(s.mode==='contrast'){
      if(wb('Objects'))wb('Objects').value=(m.objects||[]).join('\n');
      if(wb('Dimensions'))wb('Dimensions').value=(m.dimensions||[]).join('\n');
    }
  }
  updateWorkbenchPreparation();
}
function renderEditableReviewDraft(s,draft){
  const m=draft.material;
  if(!m){wb('Draft').innerHTML='<p>信息不足，未生成材料。</p><p>'+escapeHtml((draft.caveats||[]).join('；'))+'</p>';return;}
  s.beforeAi ||= readWorkbenchMaterial();
  applyReviewMaterialDraftToEditor(s,m);
  wb('Draft').innerHTML=`<p>${escapeHtml(s.aiDraftReal?(s.aiDraftSource||'AI'):'AI')} 生成结果已放入编辑器，可以直接修改。</p><p>${escapeHtml((draft.caveats||[]).join('；'))}</p><div class="ai-action-row"><button type="button" class="ai-primary" onclick="adoptWorkbenchGeneratedMaterial()">采纳</button><button type="button" class="btn-cancel" onclick="discardReviewMaterialDraft()">不采纳</button></div>`;
}
function adoptWorkbenchGeneratedMaterial(){
  const s=reviewWorkbench;if(!s||s.busy)return;
  const material=readWorkbenchMaterial(),missing=workbenchMaterialMissing(s.mode,material);
  if(missing.length){wb('Error').textContent='采纳前请先补全：'+missing.join('；');return;}
  s.aiDraft=null;s.beforeAi=null;s.aiDraftReal=false;s.aiDraftSource='';
  wb('Error').textContent='';
  wb('Draft').innerHTML='<p>已采纳 AI 生成结果。可以继续手动修改，之后使用底部按钮保存正式材料。</p>';
  wb('DraftStatus').textContent='AI 生成结果已采纳，尚未保存正式材料。';
  updateWorkbenchPreparation();
}
function readEditedReviewDraft(s){
  const m=s.aiDraft;if(!m||!wb('DraftPrompt'))return m;
  const lines=name=>(wb('Draft'+name)?.value||'').split('\n').map(v=>v.trim()).filter(Boolean);
  return {prompt:wb('DraftPrompt').value,reference:wb('DraftReference')?.value??m.reference,rubric:wb('DraftRubric')?.value??m.rubric,
    objects:s.mode==='contrast'?lines('Objects'):m.objects,dimensions:s.mode==='contrast'?lines('Dimensions'):m.dimensions,
    blanks:m.blanks.map(b=>({...b,answer:wb('DraftBlanks').querySelector('[data-draft-id="'+b.id+'"]').value,
      aliases:wb('DraftBlanks').querySelector('[data-draft-aliases="'+b.id+'"]').value.split('\n').map(v=>v.trim()).filter(Boolean),hint:wb('DraftBlanks').querySelector('[data-draft-hint="'+b.id+'"]').value}))};
}
function discardReviewMaterialDraft(){
  const s=reviewWorkbench;if(!s||s.busy)return;
  const before=s.beforeAi;
  s.aiDraft=null;s.aiDraftReal=false;s.aiDraftSource='';s.beforeAi=null;
  wb('Error').textContent='';
  if(before)applyReviewMaterialDraftToEditor(s,before);
  wb('Draft').innerHTML='<p>已不采纳本次 AI 生成结果，已恢复生成前的材料。</p>';
  if(wb('DraftStatus'))wb('DraftStatus').textContent='';
  refreshWorkbenchAiAvailability();
}
addEventListener('pagehide',()=>reviewWorkbench?.draftController?.abort());
